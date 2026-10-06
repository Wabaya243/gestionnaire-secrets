"""Server console only: python -m app.manage grant-admin person@example.cd."""
import argparse
from sqlmodel import Session, select
from app.database import engine, init_db
from app.models import User
from app.audit import record
from app.account_state import account_available


def main():
    parser = argparse.ArgumentParser(description="Administration locale du coffre")
    parser.add_argument("action", choices=["grant-admin", "revoke-admin"])
    parser.add_argument("email")
    args = parser.parse_args()
    init_db()
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == args.email)).first()
        if not user:
            parser.error("Compte absent : créer le compte depuis le navigateur d’abord")
        if args.action == "grant-admin" and (not account_available(user) or not user.mfa_enabled):
            parser.error("Le compte doit être actif et avoir activé le MFA")
        user.is_admin = args.action == "grant-admin"
        user.session_version += 1
        record(session, user.id, "admin.role.granted" if user.is_admin else "admin.role.revoked", target_user_id=user.id)
        session.add(user)
        session.commit()
    print("Rôle mis à jour. Reconnectez-vous dans le navigateur.")


if __name__ == "__main__":
    main()
