from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, LargeBinary, UniqueConstraint

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
    totp_secret: Optional[str] = None  # Secret TOTP (base64)
    mfa_enabled: bool = Field(default=False)

    # Protection contre les attaques par force brute
    failed_attempts: int = Field(default=0)      # Compteur d'échecs consécutifs
    locked_until: Optional[datetime] = None       # Date/heure jusqu'à laquelle la connexion est bloquée

    is_admin: bool = Field(default=False)
    is_active: bool = Field(default=True)
    session_version: int = Field(default=0)
    last_login_at: Optional[datetime] = None
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

class SharingKey(SQLModel, table=True):
    # Immutable v1 identity: no silent rotation that would orphan old shares.
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    public_key: str  # SPKI DER, RSA-3072 / OAEP-SHA256, base64
    private_key_enc: str  # PKCS8 encrypted by the browser's vault key
    created_at: datetime = Field(default_factory=utcnow)


class EncryptedFile(SQLModel, table=True):
    id: str = Field(primary_key=True, max_length=36)  # client UUID, bound by AES AAD
    user_id: int = Field(foreign_key="user.id", index=True)
    metadata_enc: str  # filename, MIME and original size encrypted under file key
    owner_key_enc: str  # file key encrypted under vault key, bound to file UUID
    ciphertext: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    size_bytes: int  # ciphertext length, an explicitly disclosed metadata field
    created_at: datetime = Field(default_factory=utcnow)


class FileShare(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("file_id", "recipient_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    file_id: str = Field(foreign_key="encryptedfile.id", index=True)
    recipient_id: int = Field(foreign_key="user.id", index=True)
    wrapped_key: str  # RSA-OAEP(file key), recipient-bound label
    created_at: datetime = Field(default_factory=utcnow)


class AuditEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    action: str = Field(max_length=64)
    target_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    resource_id: Optional[str] = Field(default=None, max_length=36)
    created_at: datetime = Field(default_factory=utcnow)
