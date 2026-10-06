from datetime import timezone
from sqlalchemy import or_
from app.models import User, utcnow


def account_available_state(is_active: bool, until) -> bool:
    """A timed suspension expires without relying on an in-memory scheduler."""
    if until is not None and until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return is_active and (until is None or until <= utcnow())


def account_available(user: User) -> bool:
    return account_available_state(user.is_active, user.suspended_until)


def available_in_sql():
    return (User.is_active == True) & or_(User.suspended_until.is_(None),
                                          User.suspended_until <= utcnow())
