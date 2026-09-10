import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

# Regex de contrôle de format Base64 standard (caractères autorisés + padding '=' facultatif)
B64 = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")

# Limites de taille pour éviter les attaques par déni de service (DoS via payload massif)
MAX_BLOB = 8192          # ~6 Ko de clair après décodage base64 (pour le secret chiffré)
MAX_LABEL = 1024         # Taille max pour le nom/libellé chiffré de l'élément


def _check_b64(v: str) -> str:
    """Valide que la chaîne fournie respecte bien la syntaxe base64."""
    if not B64.match(v):
        raise ValueError("encodage base64 invalide")
    return v


#  Inscription 

class RegisterIn(BaseModel):
    """Données requises lors de la création d'un compte."""
    email: EmailStr
    kdf_salt: str = Field(min_length=16, max_length=64)     # Sel public généré par le client
    auth_hash: str = Field(min_length=32, max_length=256)   # Hash dérivé côté navigateur

    # Application du validateur réutilisable sur les champs encodés en Base64
    _v_salt = field_validator("kdf_salt")(_check_b64)
    _v_hash = field_validator("auth_hash")(_check_b64)


# Connexion 

class SaltIn(BaseModel):
    """Étape 1 : Le client envoie l'email pour réclamer le sel de dérivation."""
    email: EmailStr


class SaltOut(BaseModel):
    """Réponse de l'étape 1 : Le serveur renvoie le sel (vrai ou factice anti-énumération)."""
    kdf_salt: str


class LoginIn(BaseModel):
    """Étape 2 : Tentative d'authentification avec le hash calculé et le 2FA optionnel."""
    email: EmailStr
    auth_hash: str = Field(min_length=32, max_length=256)
    totp_code: Optional[str] = None  # Fourni directement si le 2FA est déjà activé

    _v_hash = field_validator("auth_hash")(_check_b64)

    @field_validator("totp_code")
    @classmethod
    def check_code(cls, v: Optional[str]) -> Optional[str]:
        """Vérifie que le code 2FA est bien composé d'exactement 6 chiffres s'il est présent."""
        if v is None:
            return v
        if not (v.isdigit() and len(v) == 6):
            raise ValueError("code TOTP invalide")
        return v


class LoginOut(BaseModel):
    """Indique au frontend si l'utilisateur doit encore fournir son code 2FA pour finaliser."""
    mfa_required: bool = False


# MFA 

class MfaSetupOut(BaseModel):
    """Données renvoyées pour initialiser le 2FA (génération du QR code côté client)."""
    secret: str
    provisioning_uri: str


class MfaActivateIn(BaseModel):
    """Confirmation de l'activation du 2FA par l'utilisateur."""
    totp_code: str = Field(min_length=6, max_length=6)       # Premier code saisi pour prouver la config
    @field_validator("totp_code")
    @classmethod
    def only_digits(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError("code TOTP invalide")
        return v


# Profil

class MeOut(BaseModel):
    """Informations du compte connecté : aucune donnée sensible n'est exposée."""
    email: EmailStr
    mfa_enabled: bool
    created_at: datetime


# Coffre

class VaultItemIn(BaseModel):
    """Création ou mise à jour d'un secret (le serveur ne voit que des octets chiffrés)."""
    # min_length=24 impose au minimum un nonce + un tag d'intégrité (ex: AES-GCM / ChaCha20-Poly1305)
    label_enc: str = Field(min_length=24, max_length=MAX_LABEL)
    payload_enc: str = Field(min_length=24, max_length=MAX_BLOB)

    _v_label = field_validator("label_enc")(_check_b64)
    _v_payload = field_validator("payload_enc")(_check_b64)


class VaultItemOut(BaseModel):
    """Modèle renvoyé au client lors de la lecture d'un élément du coffre-fort."""
    id: int
    label_enc: str
    payload_enc: str
    created_at: datetime
    updated_at: datetime