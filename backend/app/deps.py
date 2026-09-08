## Le garde qui protège les routes du coffre
from fastapi import Cookie, Depends, HTTPException, status
from sqlmodel import Session

# Dépendance fournissant une session BDD active pour chaque requête
from app.database import get_session
from app.models import User
# Fonction de vérification et décodage du jeton JWT pour extraire le user_id
from app.security import decode_access_token

# Nom du cookie HTTP contenant le JWT de session
COOKIE_NAME = "access_token"

# Exception standard : message délibérément opaque pour bloquer toute énumération/déduction
_unauthorized = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentification requise",
)


def current_user(
    access_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    session: Session = Depends(get_session),
) -> User:
    """
    Dépendance FastAPI injectant l'utilisateur connecté :
    1. Récupère le cookie HttpOnly.
    2. Décode et valide le JWT.
    3. Vérifie l'existence effective du compte en base.
    """
    # Échec immédiat si aucun cookie n'est fourni
    if not access_token:
        raise _unauthorized

    # Décodage de l'identifiant (sub) contenu dans le token
    user_id = decode_access_token(access_token)
    if user_id is None:
        raise _unauthorized

    # Vérification que l'utilisateur existe toujours dans la BDD
    user = session.get(User, user_id)
    if user is None:
        raise _unauthorized

    return user

### Le message d'erreur est volontairement vague : ni « jeton expiré », ni « utilisateur supprimé ». 
# Un attaquant ne doit rien déduire.