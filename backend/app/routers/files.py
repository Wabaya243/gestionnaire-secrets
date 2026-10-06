import base64
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import exists, func, or_
from sqlalchemy.orm import defer
from sqlmodel import Session, select
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.database import get_session
from app.deps import current_user
from app.audit import record
from app.account_state import available_in_sql
from app.models import EncryptedFile, FileShare, SharingKey, User
from app.schemas import FileIn, RecipientIn, ShareIn, SharingKeyIn
from app.routers.auth import limiter

router = APIRouter(prefix="/api/files", tags=["encrypted files"])
NOT_FOUND = HTTPException(404, "Fichier introuvable")


def owned(file_id, user, session):
    item = session.exec(select(EncryptedFile).options(defer(EncryptedFile.ciphertext)).where(
        EncryptedFile.id == file_id, EncryptedFile.user_id == user.id)).first()
    if item is None:
        raise NOT_FOUND
    return item


def accessible(file_id, user, session):
    # Authorization entirely in SQL, including revoked shares and suspended owners.
    shared = exists().where(FileShare.file_id == EncryptedFile.id,
                            FileShare.recipient_id == user.id)
    item = session.exec(select(EncryptedFile).join(User, User.id == EncryptedFile.user_id).where(
        EncryptedFile.id == file_id, available_in_sql(),
        or_(EncryptedFile.user_id == user.id, shared))).first()
    if item is None:
        raise NOT_FOUND
    return item


def file_info(item):
    # Never serialize ORM files: that would also expose the large binary field.
    return {"id": item.id, "user_id": item.user_id, "metadata_enc": item.metadata_enc,
            "size_bytes": item.size_bytes, "created_at": item.created_at}


@router.get("/keys/me")
def own_keys(user: User = Depends(current_user), session: Session = Depends(get_session)):
    key = session.get(SharingKey, user.id)
    if not key:
        return None
    return {"public_key": key.public_key, "private_key_enc": key.private_key_enc}


@router.post("/keys/me", status_code=201)
@limiter.limit("5/minute")
def create_keys(request: Request, data: SharingKeyIn, user: User = Depends(current_user),
                session: Session = Depends(get_session)):
    try:
        public = load_der_public_key(base64.b64decode(data.public_key, validate=True))
        if not isinstance(public, RSAPublicKey) or public.key_size != 3072 or public.public_numbers().e != 65537:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "Clé publique RSA-3072 invalide")
    session.add(SharingKey(user_id=user.id, **data.model_dump()))
    record(session, user.id, "sharing.initialized")
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Identité de partage déjà initialisée")
    return {"status": "created"}


@router.post("/recipient")
@limiter.limit("10/minute")
def recipient(request: Request, data: RecipientIn, user: User = Depends(current_user),
              session: Session = Depends(get_session)):
    # No global directory. Exact authenticated lookup only; availability is disclosed.
    row = session.exec(select(User, SharingKey).join(SharingKey, SharingKey.user_id == User.id).where(
        User.email == data.email, available_in_sql(), User.id != user.id)).first()
    if row is None:
        raise HTTPException(404, "Destinataire indisponible ou partage non initialisé")
    person, key = row
    return {"id": person.id, "email": person.email, "public_key": key.public_key}


@router.get("")
def list_files(user: User = Depends(current_user), session: Session = Depends(get_session)):
    mine = session.exec(select(EncryptedFile.id, EncryptedFile.user_id, EncryptedFile.metadata_enc,
                               EncryptedFile.owner_key_enc, EncryptedFile.size_bytes, EncryptedFile.created_at)
                        .where(EncryptedFile.user_id == user.id).order_by(EncryptedFile.created_at.desc())).all()
    received = session.exec(select(EncryptedFile.id, EncryptedFile.user_id, EncryptedFile.metadata_enc,
                                   EncryptedFile.size_bytes, EncryptedFile.created_at, FileShare.wrapped_key, User.email)
                            .join(FileShare, FileShare.file_id == EncryptedFile.id)
                            .join(User, User.id == EncryptedFile.user_id)
                            .where(FileShare.recipient_id == user.id, available_in_sql())
                            .order_by(FileShare.created_at.desc())).all()
    return {"owned": [dict(r._mapping) for r in mine],
            "received": [dict(r._mapping) for r in received],
            "max_file_bytes": settings.MAX_FILE_BYTES, "quota_bytes": settings.FILE_QUOTA_BYTES}


@router.post("", status_code=201)
@limiter.limit("10/minute")
def upload(request: Request, data: FileIn, user: User = Depends(current_user),
           session: Session = Depends(get_session)):
    # Serialize uploads for this owner in PostgreSQL, so concurrent requests can't bypass quota.
    session.exec(select(User).where(User.id == user.id).with_for_update()).first()
    file_count = session.exec(select(func.count()).select_from(EncryptedFile)
                              .where(EncryptedFile.user_id == user.id)).one()
    if file_count >= 100:
        raise HTTPException(413, "Limite de 100 fichiers par compte atteinte")
    raw = base64.b64decode(data.ciphertext, validate=True)
    used = session.exec(select(func.coalesce(func.sum(EncryptedFile.size_bytes), 0))
                        .where(EncryptedFile.user_id == user.id)).one()
    if used + len(raw) > settings.FILE_QUOTA_BYTES:
        raise HTTPException(413, "Quota de stockage atteint")
    item = EncryptedFile(id=str(data.id), user_id=user.id, metadata_enc=data.metadata_enc,
                         owner_key_enc=data.owner_key_enc, ciphertext=raw, size_bytes=len(raw))
    session.add(item)
    record(session, user.id, "file.uploaded", item.id)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Identifiant de fichier indisponible")
    return file_info(item)


@router.get("/{file_id}/content")
@limiter.limit("30/minute")
def download(request: Request, file_id: str, user: User = Depends(current_user),
             session: Session = Depends(get_session)):
    item = accessible(file_id, user, session)
    record(session, user.id, "file.downloaded", item.id)
    session.commit()
    return Response(item.ciphertext, media_type="application/octet-stream",
                    headers={"Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="encrypted.bin"'})


@router.get("/{file_id}/shares")
def list_shares(file_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    owned(file_id, user, session)
    rows = session.exec(select(FileShare.id, FileShare.recipient_id, FileShare.created_at, User.email)
                        .join(User, User.id == FileShare.recipient_id).where(FileShare.file_id == file_id)).all()
    return [dict(r._mapping) for r in rows]


@router.post("/{file_id}/shares", status_code=201)
@limiter.limit("20/minute")
def share(request: Request, file_id: str, data: ShareIn, user: User = Depends(current_user),
          session: Session = Depends(get_session)):
    owned(file_id, user, session)
    recipient = session.exec(select(User).where(User.id == data.recipient_id,
                                              available_in_sql(), User.id != user.id)).first()
    key = session.get(SharingKey, data.recipient_id)
    if not recipient or not key:
        raise HTTPException(404, "Destinataire indisponible")
    if data.recipient_public_key != key.public_key:
        raise HTTPException(409, "Clé du destinataire modifiée : vérifiez son empreinte")
    # Lock the parent to serialize share creation and deletion in PostgreSQL.
    session.exec(select(EncryptedFile.id).where(EncryptedFile.id == file_id,
                                               EncryptedFile.user_id == user.id).with_for_update()).first()
    share_count = session.exec(select(func.count()).select_from(FileShare)
                               .where(FileShare.file_id == file_id)).one()
    if share_count >= 100:
        raise HTTPException(409, "Limite de 100 destinataires par fichier atteinte")
    session.add(FileShare(file_id=file_id, recipient_id=recipient.id, wrapped_key=data.wrapped_key))
    record(session, user.id, "file.shared", file_id, recipient.id)
    record(session, recipient.id, "file.received", file_id, user.id)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Fichier déjà partagé avec ce destinataire")
    return {"status": "shared"}


@router.delete("/{file_id}/shares/{share_id}", status_code=204)
def revoke(file_id: str, share_id: int, user: User = Depends(current_user),
           session: Session = Depends(get_session)):
    # Join owner constraint as well as both IDs: no orphan or cross-file revocation.
    row = session.exec(select(FileShare).join(EncryptedFile, EncryptedFile.id == FileShare.file_id).where(
        FileShare.id == share_id, FileShare.file_id == file_id, EncryptedFile.user_id == user.id)).first()
    if row is None:
        raise NOT_FOUND
    record(session, user.id, "file.revoked", file_id, row.recipient_id)
    session.delete(row)
    session.commit()


@router.delete("/{file_id}", status_code=204)
def delete(file_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    item = session.exec(select(EncryptedFile).options(defer(EncryptedFile.ciphertext)).where(
        EncryptedFile.id == file_id, EncryptedFile.user_id == user.id).with_for_update()).first()
    if item is None:
        raise NOT_FOUND
    for row in session.exec(select(FileShare).where(FileShare.file_id == item.id)).all():
        session.delete(row)
    session.flush()  # children before parent, including with SQLite foreign keys on
    record(session, user.id, "file.deleted", item.id)
    session.delete(item)
    session.commit()
