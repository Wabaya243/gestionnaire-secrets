from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

def utcnow():
    """Garantit l'horodatage en temps universel (UTC) pour éviter les décalages de fuseaux."""
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    """Table des utilisateurs du gestionnaire de secrets."""
    id: Optional[int] = Field(default=None, primary_key=True)
    # L'index accélère les recherches de connexion ; unique garantit un seul compte par email
    email: str = Field(index=True, unique=True, max_length=254)

    # Paramètres d'authentification Zero-Knowledge
    kdf_salt: str           # Sel client public (base64) pour dériver la clé côté navigateur
    auth_hash: str     # Empreinte Argon2id calculée par le serveur sur le hash reçu

    # Authentification multifacteur (MFA / 2FA)
    topt_secret: Optional[str] = None  # Secret TOTP (base64)
    mfa_enabled: bool = Field(default=False)

    # Protection contre les attaques par force brute
    failed_attempts: int = Field(default=0)      # Compteur d'échecs consécutifs
    locked_until: Optional[datetime] = None       # Date/heure jusqu'à laquelle la connexion est bloquée

    created_at: datetime = Field(default_factory=utcnow)


class VaultItem(SQLModel, table=True):
    """Table des éléments chiffrés stockés dans le coffre-fort (mots de passe, notes, etc.)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    # Clé étrangère liant le secret à son propriétaire (indexé pour lister rapidement ses items)
    user_id: int = Field(foreign_key="user.id", index=True)

    # Données Zero-Knowledge : le serveur ne possède JAMAIS la clé pour les déchiffrer
    label_enc: str      # Titre/nom de l'élément chiffré (nonce + tag d'intégrité + texte chiffré)
    payload_enc: str    # Contenu secret chiffré (identifiant, mot de passe, notes, etc.)

    created_at: datetime = Field(default_factory=utcnow)
    # À mettre à jour côté applicatif lors d'une modification de l'élément
    updated_at: datetime = Field(default_factory=utcnow)