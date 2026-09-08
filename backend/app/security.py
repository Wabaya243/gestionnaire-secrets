"""
Module d'utilitaires de sécurité et d'authentification.
Gère le hachage des mots de passe (Argon2), la génération et validation des jetons JWT,
l'authentification à double facteur (TOTP) et le verrouillage de compte (Anti-Brute Force).
"""

import base64
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from app.config import settings

# Algorithme utilisé pour signer les jetons JWT. 
# HS256 utilise une clé secrète partagée (symétrique).
JWT_ALGORITHM = "HS256"

# Initialisation du hacheur Argon2id (recommandé par l'OWASP).
# Les paramètres (temps, mémoire, parallélisme) sont chargés depuis la configuration
# pour permettre de les durcir à l'avenir au fur et à mesure que la puissance matérielle augmente.
_hasher = PasswordHasher(
    time_cost=settings.ARGON2_TIME_COST,
    memory_cost=settings.ARGON2_MEMORY_COST,
    parallelism=settings.ARGON2_PARALLELISM,
)

# SELS DE HACHAGE (SALTS)


def generate_kdf_salt() -> str:
    """
    Génère un sel aléatoire cryptographiquement sûr pour le client (16 octets).
    Ce sel sera renvoyé au navigateur pour dériver une clé avant de l'envoyer au serveur
    (utile pour une architecture à divulgation nulle de connaissance / Zero-Knowledge).
    """
    return base64.b64encode(os.urandom(16)).decode()


def deterministic_fake_salt(email: str) -> str:
    """
    Sel factice mais STABLE pour un email inconnu.
    Sécurité : Empêche l'énumération de comptes (savoir si un email est inscrit ou non). 
    Le client reçoit toujours un sel (vrai si l'utilisateur existe, factice s'il n'existe pas), 
    et le temps de réponse du serveur reste similaire, ce qui évite les attaques temporelles.
    """
    import hashlib
    # Utilisation du secret JWT et de l'email pour garantir que le sel généré 
    # sera toujours le même pour un email donné, sans avoir besoin de le stocker.
    digest = hashlib.sha256((settings.JWT_SECRET + email.lower()).encode()).digest()
    return base64.b64encode(digest[:16]).decode()



#  HACHAGE SERVEUR (ARGON2)

def hash_auth(client_hash: str) -> str:
    """
    Applique une seconde couche de hachage (Argon2id) côté serveur.
    Même si la base de données fuite, l'attaquant n'aura que le double-hash
    et ne pourra pas retrouver le hash client initial.
    """
    return _hasher.hash(client_hash)


def verify_auth(stored: str, client_hash: str) -> bool:
    """
    Vérifie si le hash fourni par le client correspond à celui stocké en base.
    L'opération s'effectue en temps constant pour éviter les attaques par canal auxiliaire (timing attacks).
    Capture toutes les exceptions Argon2 pour renvoyer un simple booléen.
    """
    try:
        _hasher.verify(stored, client_hash)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        # Le mot de passe est incorrect ou le hash est corrompu
        return False


def needs_rehash(stored: str) -> bool:
    """
    Vérifie si le hash stocké a 
    été créé avec des paramètres plus faibles 
    que ceux actuellement définis dans settings (ex: augmentation du time_cost).
    Si True, l'application devrait re-hacher le mot de passe lors de la prochaine connexion réussie.
    """
    return _hasher.check_needs_rehash(stored)


# ==========================================
# --- JETONS D'ACCÈS (JSON WEB TOKENS)
# ==========================================

def create_access_token(user_id: int) -> str:
    """
    Génère un jeton JWT contenant l'ID de l'utilisateur.
    Le jeton a une durée de vie limitée définie dans la configuration.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id), # "sub" (subject) : l'identité concernée par ce jeton
        "iat": now,          # "iat" (issued at) : date de création
        "exp": now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES), # "exp" : date d'expiration
    }
    # Signature du jeton avec le secret du serveur
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[int]:
    """
    Vérifie la validité du jeton JWT et extrait l'ID utilisateur.
    Retourne None si le jeton est invalide, expiré ou corrompu.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[JWT_ALGORITHM], # Sécurité critique : bloque la faille de l'algorithme "none"
        )
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        # PyJWTError attrape les jetons expirés ou dont la signature est invalide
        return None


# ==========================================
# --- AUTHENTIFICATION DOUBLE FACTEUR (TOTP)
# ==========================================

def generate_totp_secret() -> str:
    """
    Génère une clé secrète encodée en base32 (standard attendu par les apps d'authentification).
    Cette clé doit être stockée de manière sécurisée en base de données.
    """
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str) -> str:
    """
    Génère l'URI (format otpauth://) utilisée pour créer un QR Code.
    L'utilisateur scannera ce QR code avec Google Authenticator, Authy, etc.
    """
    return pyotp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name="Gestionnaire de secrets", # Nom de l'app qui apparaîtra dans l'authentificateur
    )


def verify_totp(secret: str, code: str) -> bool:
    """
    Vérifie si le code à 6 chiffres fourni correspond au code temporel actuel.
    """
    # Validation basique du format pour éviter les erreurs inutiles
    if not code or not code.isdigit() or len(code) != 6:
        return False
    
    # valid_window=1 tolère une désynchronisation d'environ 30 secondes (1 cycle)
    # entre l'horloge de l'appareil de l'utilisateur et le serveur.
    return pyotp.TOTP(secret).verify(code, valid_window=1)


# ==========================================
# --- VERROUILLAGE DE COMPTE (ANTI BRUTE-FORCE)
# ==========================================

def is_locked(locked_until: Optional[datetime]) -> bool:
    """
    Vérifie si un compte est actuellement verrouillé (suite à trop de tentatives échouées).
    Gère la compatibilité avec les objets datetime "naïfs" (sans fuseau horaire) en forçant l'UTC.
    """
    if locked_until is None:
        return False
    
    # Sécurisation du timezone : si le datetime n'a pas d'info de fuseau, on assume que c'est de l'UTC
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
        
    # Le compte est verrouillé si la date de fin de verrouillage est dans le futur
    return datetime.now(timezone.utc) < locked_until


def lockout_deadline() -> datetime:
    """
    Calcule et retourne la date/heure exacte de fin de verrouillage,
    en ajoutant le délai configuré à l'heure actuelle (en UTC).
    """
    return datetime.now(timezone.utc) + timedelta(minutes=settings.LOCKOUT_MINUTES)