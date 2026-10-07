"""Trusted server console: assign the first superadmin after MFA activation."""
import argparse
from sqlmodel import Session, select
from app.database import engine, init_db
from app.models import User
from app.audit import record
from app.account_state import account_available


def main():
    parser = argparse.ArgumentParser(description="Administration locale du coffre")
    parser.add_argument("action", choices=["grant-admin", "revoke-admin", "grant-superadmin", "revoke-superadmin"])
    parser.add_argument("email")
    args = parser.parse_args()
    init_db()
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == args.email).with_for_update()).first()
        if not user:
            parser.error("Compte absent : créer le compte depuis le navigateur d’abord")
        if args.action.startswith("grant-") and (not account_available(user) or not user.mfa_enabled):
            parser.error("Le compte doit être actif et avoir activé le MFA")
        if args.action == "revoke-admin" and user.is_superadmin:
            parser.error("Retirez d’abord le rôle superadmin")
        if args.action == "revoke-superadmin":
            if not user.is_superadmin:
                parser.error("Ce compte n’est pas superadministrateur")
            # Keep at least one usable superadmin. Lock all candidates to serialize revocations.
            superadmins = session.exec(select(User).where(User.is_superadmin == True).with_for_update()).all()
            if not any(candidate.id != user.id and account_available(candidate) and candidate.mfa_enabled
                       for candidate in superadmins):
                parser.error("Il faut un autre superadministrateur actif avec MFA")
            user.is_superadmin = False
        elif args.action == "grant-superadmin":
            user.is_admin = True
            user.is_superadmin = True
        elif args.action == "grant-admin":
            user.is_admin = True
        else:
            user.is_admin = False
        user.session_version += 1
        actions = {"grant-admin": "admin.role.granted", "revoke-admin": "admin.role.revoked",
                   "grant-superadmin": "admin.superadmin.granted", "revoke-superadmin": "admin.superadmin.revoked"}
        record(session, user.id, actions[args.action], target_user_id=user.id)
        session.add(user)
        session.commit()
    print("Rôle mis à jour. Reconnectez-vous dans le navigateur.")


if __name__ == "__main__":
    main()
