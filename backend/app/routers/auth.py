from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.deps import COOKIE_NAME, current_user
from app.models import User
from app.schemas import (
    LoginIn, LoginOut, MfaActivateIn, MfaSetupOut,
    RegisterIn, SaltIn, SaltOut,
)
from app.security import (
    create_access_token, deterministic_fake_salt, generate_totp_secret,
    hash_auth, is_locked, lockout_deadline, totp_provisioning_uri,
    verify_auth, verify_totp,
)

# Routeur d'authentification regroupant les endpoints sous /api/auth
router = APIRouter(prefix="/api/auth", tags=["auth"])

# Rate limiter basé sur l'adresse IP cliente pour mitiger les attaques automatisées
limiter = Limiter(key_func=get_remote_address)

# Erreur générique en cas d'identifiants incorrects (anti-énumération)
BAD_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Identifiants invalides",
)


def _set_cookie(response: Response, token: str) -> None:
    """Configure le cookie de session avec les attributs de sécurité recommandés."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,                   # Inaccessible via JavaScript (atténue le vol par XSS)
        secure=settings.is_production,   # Transmis uniquement via HTTPS en production
        samesite="lax",                  # Protection contre les attaques CSRF
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
        path="/",
    )


#  Inscription 

@router.post("/register", status_code=201)
@limiter.limit("5/hour")  # Limite stricte : 5 créations de compte max par heure et par IP
def register(
    request: Request,
    data: RegisterIn,
    session: Session = Depends(get_session),
):
    # Vérifie si le compte existe déjà
    existing = session.exec(select(User).where(User.email == data.email)).first()
    if existing:
        # Message volontairement neutre pour ne pas confirmer l'existence de l'adresse
        raise HTTPException(status_code=409, detail="Inscription impossible")

    # Double hachage côté serveur : on applique Argon2id sur le hash client
    user = User(
        email=data.email,
        kdf_salt=data.kdf_salt,
        auth_hash=hash_auth(data.auth_hash),
    )
    session.add(user)
    session.commit()
    return {"status": "created"}


#  Récupération du sel 

@router.post("/login/salt", response_model=SaltOut)
@limiter.limit("30/minute")
def get_salt(
    request: Request,
    data: SaltIn,
    session: Session = Depends(get_session),
):
    """
    Renvoie le sel KDF nécessaire au client pour dériver son mot de passe.
    Si l'email est inconnu, renvoie un sel factice déterministe pour tromper l'attaquant.
    """
    user = session.exec(select(User).where(User.email == data.email)).first()
    if user:
        return SaltOut(kdf_salt=user.kdf_salt)

    # Email inexistant : génération d'un sel identique à chaque appel pour cet email
    return SaltOut(kdf_salt=deterministic_fake_salt(data.email))


#  Connexion 

@router.post("/login", response_model=LoginOut)
@limiter.limit("10/minute")  # Anti-brute force en amont sur les requêtes brutes
def login(
    request: Request,
    response: Response,
    data: LoginIn,
    session: Session = Depends(get_session),
):
    user = session.exec(select(User).where(User.email == data.email)).first()

    # Si l'utilisateur n'existe pas, on simule un hachage pour éviter une timing attack
    if user is None:
        hash_auth(data.auth_hash)
        raise BAD_CREDENTIALS

    # Vérification du verrouillage temporel du compte
    if is_locked(user.locked_until):
        raise HTTPException(status_code=423, detail="Compte temporairement verrouillé")

    # Vérification du mot de passe (temps constant via Argon2)
    if not verify_auth(user.auth_hash, data.auth_hash):
        user.failed_attempts += 1
        # Si le seuil d'échecs est atteint, on active le verrouillage
        if user.failed_attempts >= settings.MAX_FAILED_ATTEMPTS:
            user.locked_until = lockout_deadline()
            user.failed_attempts = 0
        session.add(user)
        session.commit()
        raise BAD_CREDENTIALS

    # Validation MFA si activée sur le compte
    if user.mfa_enabled:
        # Étape 1 MFA : mot de passe valide mais code TOTP absent
        if data.totp_code is None:
            return LoginOut(mfa_required=True)

        # Étape 2 MFA : vérification du code à 6 chiffres
        if not verify_totp(user.totp_secret, data.totp_code):
            user.failed_attempts += 1
            session.add(user)
            session.commit()
            raise BAD_CREDENTIALS

    # Réinitialisation des compteurs d'échecs après un succès complet
    user.failed_attempts = 0
    user.locked_until = None
    session.add(user)
    session.commit()

    # Génération du JWT et transmission au client via cookie HttpOnly
    _set_cookie(response, create_access_token(user.id))
    return LoginOut(mfa_required=False)


#  Déconnexion 

@router.post("/logout")
def logout(response: Response):
    """Révoque la session côté client en supprimant le cookie d'authentification."""
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}