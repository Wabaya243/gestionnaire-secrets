from app.models import AuditEvent


def record(session, user_id, action, resource_id=None, target_user_id=None):
    # Commit with the operation itself: no passwords, filenames, blobs or IPs.
    session.add(AuditEvent(user_id=user_id, action=action,
                           resource_id=str(resource_id) if resource_id is not None else None,
                           target_user_id=target_user_id))
