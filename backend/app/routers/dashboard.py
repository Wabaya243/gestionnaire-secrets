from datetime import timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import func, delete, update
from sqlmodel import Session, select
from app.database import get_session
from app.deps import current_user, admin_user
from app.models import User, VaultItem, EncryptedFile, FileShare, SharingKey, AuditEvent, utcnow
from app.schemas import AccountStateIn
from app.account_state import account_available, account_available_state, available_in_sql
from app.security import is_locked
from app.audit import record
from app.config import settings

router = APIRouter(prefix="/api", tags=["dashboards"])


def count(session, model, *filters):
    return session.exec(select(func.count()).select_from(model).where(*filters)).one()


def bytes_used(session, user_id=None):
    query = select(func.coalesce(func.sum(EncryptedFile.size_bytes), 0))
    if user_id is not None:
        query = query.where(EncryptedFile.user_id == user_id)
    return session.exec(query).one()


def event_out(event):
    return {"id": event.id, "action": event.action, "resource_id": event.resource_id,
            "target_user_id": event.target_user_id, "created_at": event.created_at}


@router.get("/dashboard")
def personal(user: User = Depends(current_user), session: Session = Depends(get_session)):
    sent = count(session, FileShare, FileShare.file_id.in_(select(EncryptedFile.id).where(EncryptedFile.user_id == user.id)))
    received = count(session, FileShare, FileShare.recipient_id == user.id)
    events = session.exec(select(AuditEvent).where(AuditEvent.user_id == user.id)
                          .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(30)).all()
    return {"secrets": count(session, VaultItem, VaultItem.user_id == user.id),
            "files": count(session, EncryptedFile, EncryptedFile.user_id == user.id),
            "sent_shares": sent, "received_shares": received,
            "storage_bytes": bytes_used(session, user.id), "quota_bytes": settings.FILE_QUOTA_BYTES,
            "last_login_at": user.last_login_at, "mfa_enabled": user.mfa_enabled,
            "activity": [event_out(e) for e in events]}


@router.get("/admin/overview")
def overview(user: User = Depends(admin_user), session: Session = Depends(get_session)):
    return {"users": count(session, User), "active_users": count(session, User, available_in_sql()),
            "mfa_users": count(session, User, User.mfa_enabled == True),
            "secrets": count(session, VaultItem), "files": count(session, EncryptedFile),
            "shares": count(session, FileShare), "storage_bytes": bytes_used(session)}


@router.get("/admin/users")
def users(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
          q: str = Query("", max_length=254),
          user: User = Depends(admin_user), session: Session = Depends(get_session)):
    # Correlated aggregates: no secret/blob loading, no N+1 query per account.
    secret_count = select(func.count()).select_from(VaultItem).where(VaultItem.user_id == User.id).correlate(User).scalar_subquery()
    file_count = select(func.count()).select_from(EncryptedFile).where(EncryptedFile.user_id == User.id).correlate(User).scalar_subquery()
    storage = select(func.coalesce(func.sum(EncryptedFile.size_bytes), 0)).where(EncryptedFile.user_id == User.id).correlate(User).scalar_subquery()
    search = q.strip()
    pattern = "%" + search.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
    filters = (User.email.ilike(pattern, escape="!"),) if search else ()
    rows = session.exec(select(User.id, User.email, User.is_active, User.is_admin, User.mfa_enabled,
                               User.failed_attempts, User.locked_until, User.suspended_until, User.created_at, User.last_login_at,
                               secret_count.label("secrets"), file_count.label("files"), storage.label("storage_bytes"))
                        .where(*filters).order_by(User.id).offset(offset).limit(limit)).all()
    result = []
    for row in rows:
        info = dict(row._mapping)
        info["is_locked"] = is_locked(info["locked_until"])
        info["is_available"] = account_available_state(info["is_active"], info["suspended_until"])
        result.append(info)
    return {"items": result, "total": count(session, User, *filters)}


@router.patch("/admin/users/{user_id}/state")
def state(user_id: int, data: AccountStateIn, user: User = Depends(admin_user),
          session: Session = Depends(get_session)):
    target = session.exec(select(User).where(User.id == user_id).with_for_update()).first()
    if target is None:
        raise HTTPException(404, "Compte introuvable")
    if target.is_admin:
        raise HTTPException(409, "Les comptes administrateurs se gèrent depuis la console serveur")
    if data.is_active and data.suspend_minutes is not None:
        raise HTTPException(422, "Durée incompatible avec la réactivation")
    target.is_active = data.is_active or data.suspend_minutes is not None
    target.suspended_until = (utcnow() + timedelta(minutes=data.suspend_minutes)
                              if data.suspend_minutes is not None else None)
    target.session_version += 1  # old JWTs stay invalid after reactivation
    action = "admin.account.enabled" if data.is_active else ("admin.account.suspended" if data.suspend_minutes else "admin.account.disabled")
    record(session, user.id, action, target_user_id=target.id)
    session.add(target)
    session.commit()
    return {"status": "ok"}


@router.post("/admin/users/{user_id}/promote")
def promote(user_id: int, user: User = Depends(admin_user), session: Session = Depends(get_session)):
    target = session.exec(select(User).where(User.id == user_id).with_for_update()).first()
    if target is None:
        raise HTTPException(404, "Compte introuvable")
    if target.is_admin:
        raise HTTPException(409, "Déjà administrateur")
    if not account_available(target) or not target.mfa_enabled:
        raise HTTPException(409, "Le compte doit être actif et avoir activé le MFA")
    target.is_admin = True
    target.session_version += 1
    record(session, user.id, "admin.role.granted", target_user_id=target.id)
    session.add(target)
    session.commit()
    return {"status": "ok"}


@router.delete("/admin/users/{user_id}", status_code=204)
def remove_account(user_id: int, user: User = Depends(admin_user), session: Session = Depends(get_session)):
    target = session.exec(select(User).where(User.id == user_id).with_for_update()).first()
    if target is None:
        raise HTTPException(404, "Compte introuvable")
    if target.is_admin:
        raise HTTPException(409, "Suppression des administrateurs interdite depuis le tableau de bord")
    owned_files = select(EncryptedFile.id).where(EncryptedFile.user_id == target.id)
    session.exec(delete(FileShare).where((FileShare.recipient_id == target.id) |
                                         FileShare.file_id.in_(owned_files)))
    session.exec(delete(EncryptedFile).where(EncryptedFile.user_id == target.id))
    session.exec(delete(VaultItem).where(VaultItem.user_id == target.id))
    session.exec(delete(SharingKey).where(SharingKey.user_id == target.id))
    session.exec(delete(AuditEvent).where(AuditEvent.user_id == target.id))
    session.exec(update(AuditEvent).where(AuditEvent.target_user_id == target.id)
                 .values(target_user_id=None))
    record(session, user.id, "admin.account.deleted", resource_id=target.id)
    session.delete(target)
    session.commit()


@router.post("/admin/users/{user_id}/unlock")
def unlock(user_id: int, user: User = Depends(admin_user), session: Session = Depends(get_session)):
    target = session.exec(select(User).where(User.id == user_id).with_for_update()).first()
    if target is None:
        raise HTTPException(404, "Compte introuvable")
    target.failed_attempts = 0
    target.locked_until = None
    record(session, user.id, "admin.account.unlocked", target_user_id=target.id)
    session.add(target)
    session.commit()
    return {"status": "ok"}


@router.get("/admin/activity")
def activity(user: User = Depends(admin_user), session: Session = Depends(get_session)):
    events = session.exec(select(AuditEvent).where(AuditEvent.action.like("admin.%"))
                          .order_by(AuditEvent.id.desc()).limit(50)).all()
    return [{**event_out(e), "user_id": e.user_id} for e in events]
