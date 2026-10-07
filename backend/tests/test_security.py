import base64
from datetime import timedelta
from uuid import uuid4
import pytest
import pyotp
from sqlalchemy import text
from sqlmodel import create_engine, Session, select
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from app.models import User, AuditEvent, VaultItem, SharingKey, EncryptedFile, FileShare, utcnow
from app.migrations import migrate
from app.config import settings
from app.security import create_access_token


def b64(raw): return base64.b64encode(raw).decode()
def file_body():
    return {'id': str(uuid4()), 'metadata_enc': b64(b'M' * 48), 'owner_key_enc': b64(b'K' * 60), 'ciphertext': b64(b'C' * 100)}

@pytest.fixture(scope='module')
def public_key():
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    return b64(key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo))


def create_share(owner, recipient, item, key):
    assert recipient.post('/api/files/keys/me', json={'public_key': key, 'private_key_enc': b64(b'P' * 200)}).status_code == 201
    found = owner.post('/api/files/recipient', json={'email': 'user1@example.cd'}).json()
    return owner.post(f'/api/files/{item["id"]}/shares', json={
        'recipient_id': found['id'], 'recipient_public_key': found['public_key'], 'wrapped_key': b64(b'W' * 384)})


def test_legacy_migration_preserves_secrets(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "old.db"}')
    with engine.begin() as c:
        c.execute(text('CREATE TABLE "user" (id INTEGER PRIMARY KEY, email VARCHAR UNIQUE, kdf_salt VARCHAR, auth_hash VARCHAR, totp_secret VARCHAR, mfa_enabled BOOLEAN, failed_attempts INTEGER, locked_until TIMESTAMP, created_at TIMESTAMP)'))
        c.execute(text("INSERT INTO user VALUES (1, 'legacy@example.cd', 'old-salt', 'old-hash', NULL, 0, 2, NULL, '2026-01-01')"))
        c.execute(text('CREATE TABLE vaultitem (id INTEGER PRIMARY KEY, user_id INTEGER, label_enc VARCHAR, payload_enc VARCHAR, created_at TIMESTAMP, updated_at TIMESTAMP)'))
        c.execute(text("INSERT INTO vaultitem VALUES (7, 1, 'original-label-blob', 'original-secret-blob', '2026-01-01', '2026-01-01')"))
    migrate(engine); migrate(engine)
    with engine.connect() as c:
        row = c.execute(text('SELECT auth_hash, kdf_salt, failed_attempts, is_admin, is_active, session_version FROM user')).one()
        assert tuple(row) == ('old-hash', 'old-salt', 2, 0, 1, 0)
        assert c.execute(text('SELECT is_superadmin FROM user')).scalar_one() == 0
        assert c.execute(text('SELECT payload_enc FROM vaultitem')).scalar_one() == 'original-secret-blob'
        assert c.execute(text('SELECT COUNT(*) FROM schema_revision')).scalar_one() == 3
        assert c.execute(text('SELECT suspended_until FROM user')).scalar_one() is None


def test_superadmin_migration_does_not_elevate_existing_admin(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "existing-admin.db"}')
    with engine.begin() as c:
        c.execute(text('CREATE TABLE "user" (id INTEGER PRIMARY KEY, email VARCHAR, is_admin BOOLEAN, is_active BOOLEAN)'))
        c.execute(text("INSERT INTO user VALUES (1, 'existing@example.cd', 1, 1)"))
        c.execute(text('CREATE TABLE schema_revision (revision VARCHAR(64) PRIMARY KEY)'))
        c.execute(text("INSERT INTO schema_revision VALUES ('001_files_dashboards'), ('002_admin_controls')"))
    migrate(engine); migrate(engine)
    with engine.connect() as c:
        assert tuple(c.execute(text('SELECT is_admin, is_superadmin FROM user')).one()) == (1, 0)
        assert c.execute(text('SELECT COUNT(*) FROM schema_revision')).scalar_one() == 3


def test_upload_idor_and_metadata_isolation(clients):
    owner, recipient, stranger, admin = clients
    body = file_body()
    assert owner.post('/api/files', json=body).status_code == 201
    assert len(owner.get('/api/files').json()['owned']) == 1
    assert recipient.get('/api/files').json()['owned'] == []
    for c in [recipient, stranger, admin]:
        assert c.get(f'/api/files/{body["id"]}/content').status_code == 404
        assert c.get(f'/api/files/{body["id"]}/shares').status_code == 404
        assert c.delete(f'/api/files/{body["id"]}').status_code == 404
    raw = owner.get(f'/api/files/{body["id"]}/content')
    assert raw.content == b'C' * 100
    assert raw.headers['cache-control'] == 'no-store'
    assert owner.post('/api/files', json=body).status_code == 409


def test_share_revoke_and_delete(clients, public_key, db):
    owner, recipient, stranger, admin = clients
    item = file_body(); assert owner.post('/api/files', json=item).status_code == 201
    assert create_share(owner, recipient, item, public_key).status_code == 201
    shared = recipient.get('/api/files').json()['received'][0]
    assert shared['wrapped_key'] == b64(b'W' * 384)
    assert 'owner_key_enc' not in shared and 'ciphertext' not in shared
    assert recipient.get(f'/api/files/{item["id"]}/content').status_code == 200
    assert stranger.get(f'/api/files/{item["id"]}/content').status_code == 404
    sid = owner.get(f'/api/files/{item["id"]}/shares').json()[0]['id']
    assert stranger.delete(f'/api/files/{item["id"]}/shares/{sid}').status_code == 404
    assert owner.delete(f'/api/files/{uuid4()}/shares/{sid}').status_code == 404
    assert owner.delete(f'/api/files/{item["id"]}/shares/{sid}').status_code == 204
    assert recipient.get(f'/api/files/{item["id"]}/content').status_code == 404
    assert recipient.get('/api/files').json()['received'] == []
    found = owner.post('/api/files/recipient', json={'email': 'user1@example.cd'}).json()
    share_body = {'recipient_id': found['id'], 'recipient_public_key': found['public_key'], 'wrapped_key': b64(b'W' * 384)}
    assert owner.post(f'/api/files/{item["id"]}/shares', json={**share_body, 'recipient_public_key': 'replacement'}).status_code == 409
    assert owner.post(f'/api/files/{item["id"]}/shares', json=share_body).status_code == 201
    assert owner.post(f'/api/files/{item["id"]}/shares', json=share_body).status_code == 409
    assert owner.delete(f'/api/files/{item["id"]}').status_code == 204
    with Session(db) as s:
        assert s.exec(select(FileShare)).all() == []
        assert s.exec(select(EncryptedFile)).all() == []


def test_public_identity_immutable_and_never_exposes_private_key(clients, public_key):
    owner, recipient, *_ = clients
    key = {'public_key': public_key, 'private_key_enc': b64(b'P' * 100)}
    assert recipient.post('/api/files/keys/me', json=key).status_code == 201
    assert recipient.post('/api/files/keys/me', json=key).status_code == 409
    found = owner.post('/api/files/recipient', json={'email': 'user1@example.cd'})
    assert set(found.json()) == {'id', 'email', 'public_key'}
    assert owner.post('/api/files/recipient', json={'email': 'absent@example.cd'}).status_code == 404
    assert owner.post('/api/files/recipient', json={'email': 'user2@example.cd'}).status_code == 404
    assert owner.post('/api/files/keys/me', json={'public_key': b64(b'X' * 400), 'private_key_enc': b64(b'P' * 100)}).status_code == 422


def test_admin_disable_revokes_old_sessions_even_after_reenable(clients, db):
    owner, _, _, admin = clients
    assert owner.get('/api/admin/users').status_code == 403
    info = admin.get('/api/admin/users').json()
    target = info['items'][0]
    assert not {'auth_hash', 'totp_secret', 'kdf_salt', 'private_key_enc'} & set(target)
    assert admin.patch(f'/api/admin/users/{target["id"]}/state', json={'is_active': False}).status_code == 200
    assert owner.get('/api/dashboard').status_code == 401
    assert admin.patch(f'/api/admin/users/{target["id"]}/state', json={'is_active': True}).status_code == 200
    assert owner.get('/api/dashboard').status_code == 401
    owner.cookies.set('access_token', create_access_token(target['id'], 2))
    assert owner.get('/api/dashboard').status_code == 200
    aid = info['items'][-1]['id']
    assert admin.patch(f'/api/admin/users/{aid}/state', json={'is_active': False}).status_code == 409
    with Session(db) as s:
        u = s.get(User, aid); u.mfa_enabled = False; s.add(u); s.commit()
    assert admin.get('/api/admin/overview').status_code == 403


def test_admin_search_promote_requires_mfa_and_revokes_session(clients, db):
    owner, recipient, _, admin = clients
    assert owner.get('/api/admin/users?q=user1').status_code == 403
    assert admin.get('/api/admin/users?q=user1').json()['total'] == 1
    assert admin.get('/api/admin/users?q=%25').json()['total'] == 0  # literal percent, not SQL wildcard
    target_id = admin.get('/api/admin/users?q=user1').json()['items'][0]['id']
    assert admin.post(f'/api/admin/users/{target_id}/promote').status_code == 403
    with Session(db) as s:
        operator = s.exec(select(User).where(User.email == 'user3@example.cd')).one()
        operator.is_superadmin = True; s.add(operator); s.commit()
    assert admin.post(f'/api/admin/users/{target_id}/promote').status_code == 409
    with Session(db) as s:
        target = s.get(User, target_id); target.mfa_enabled = True; s.add(target); s.commit()
    assert admin.post(f'/api/admin/users/{target_id}/promote').status_code == 200
    assert recipient.get('/api/auth/me').status_code == 401
    recipient.cookies.set('access_token', create_access_token(target_id, 1))
    assert recipient.get('/api/auth/me').json()['is_admin'] is True
    assert recipient.get('/api/admin/users').status_code == 200
    assert admin.patch(f'/api/admin/users/{target_id}/state', json={'is_active': False}).status_code == 409
    assert admin.delete(f'/api/admin/users/{target_id}').status_code == 409
    assert admin.delete(f'/api/admin/users/{admin.get("/api/auth/me").json()["id"]}').status_code == 409


def test_superadmin_demotes_accidental_admin_and_revokes_sessions(clients, db):
    owner, recipient, _, admin = clients
    target_id = admin.get('/api/admin/users?q=user1').json()['items'][0]['id']
    with Session(db) as s:
        operator = s.exec(select(User).where(User.email == 'user3@example.cd')).one()
        operator.is_superadmin = True
        target = s.get(User, target_id); target.mfa_enabled = True
        s.add_all([operator, target]); s.commit()
    assert owner.post(f'/api/admin/users/{target_id}/demote').status_code == 403
    assert admin.post(f'/api/admin/users/{target_id}/demote').status_code == 409
    assert admin.post(f'/api/admin/users/{target_id}/promote').status_code == 200
    recipient.cookies.set('access_token', create_access_token(target_id, 1))
    assert recipient.get('/api/admin/users').status_code == 200
    assert recipient.get('/api/auth/me').json()['is_superadmin'] is False
    assert recipient.post(f'/api/admin/users/{target_id}/demote').status_code == 403
    assert admin.post(f'/api/admin/users/{target_id}/demote').status_code == 200
    assert recipient.get('/api/auth/me').status_code == 401
    recipient.cookies.set('access_token', create_access_token(target_id, 2))
    assert recipient.get('/api/auth/me').json()['is_admin'] is False
    assert recipient.get('/api/admin/users').status_code == 403
    assert admin.post(f'/api/admin/users/{target_id}/demote').status_code == 409
    assert admin.post(f'/api/admin/users/{admin.get("/api/auth/me").json()["id"]}/demote').status_code == 409
    assert admin.get('/api/admin/users?q=user3').json()['items'][0]['is_superadmin'] is True


def test_console_guards_last_superadmin(clients, db, monkeypatch):
    import sys
    from app import manage
    _, _, _, admin = clients
    uid = admin.get('/api/auth/me').json()['id']
    monkeypatch.setattr(manage, 'engine', db)
    monkeypatch.setattr(manage, 'init_db', lambda: None)
    monkeypatch.setattr(sys, 'argv', ['manage', 'grant-superadmin', 'user3@example.cd'])
    manage.main()
    assert admin.get('/api/auth/me').status_code == 401
    admin.cookies.set('access_token', create_access_token(uid, 1))
    assert admin.get('/api/auth/me').json()['is_superadmin'] is True
    for action in ('revoke-admin', 'revoke-superadmin'):
        monkeypatch.setattr(sys, 'argv', ['manage', action, 'user3@example.cd'])
        with pytest.raises(SystemExit):
            manage.main()
    with Session(db) as s:
        another = s.exec(select(User).where(User.email == 'user0@example.cd')).one()
        another.mfa_enabled = True; s.add(another); s.commit()
    monkeypatch.setattr(sys, 'argv', ['manage', 'grant-superadmin', 'user0@example.cd'])
    manage.main()
    with Session(db) as s:
        another = s.exec(select(User).where(User.email == 'user0@example.cd')).one()
        another.is_active = False; s.add(another); s.commit()
    monkeypatch.setattr(sys, 'argv', ['manage', 'revoke-superadmin', 'user3@example.cd'])
    with pytest.raises(SystemExit):
        manage.main()
    with Session(db) as s:
        another = s.exec(select(User).where(User.email == 'user0@example.cd')).one()
        another.is_active = True; s.add(another); s.commit()
    monkeypatch.setattr(sys, 'argv', ['manage', 'revoke-superadmin', 'user3@example.cd'])
    manage.main()
    assert admin.get('/api/auth/me').status_code == 401
    admin.cookies.set('access_token', create_access_token(uid, 2))
    assert admin.get('/api/auth/me').json()['is_superadmin'] is False
    assert admin.get('/api/admin/overview').status_code == 200


def test_timed_suspension_expires_and_reactivation_revokes_old_tokens(clients, db, public_key):
    owner, recipient, _, admin = clients
    item = file_body(); assert owner.post('/api/files', json=item).status_code == 201
    assert create_share(owner, recipient, item, public_key).status_code == 201
    uid = admin.get('/api/admin/users').json()['items'][0]['id']
    assert admin.patch(f'/api/admin/users/{uid}/state', json={'is_active': True, 'suspend_minutes': 60}).status_code == 422
    assert admin.patch(f'/api/admin/users/{uid}/state', json={'is_active': False, 'suspend_minutes': 60}).status_code == 200
    assert owner.get('/api/dashboard').status_code == 401
    assert recipient.get(f'/api/files/{item["id"]}/content').status_code == 404
    listing = admin.get('/api/admin/users?q=user0').json()['items'][0]
    assert not listing['is_available'] and listing['suspended_until']
    with Session(db) as s:
        target = s.get(User, uid); target.suspended_until = utcnow() - timedelta(minutes=1); s.add(target); s.commit()
    assert owner.get('/api/dashboard').status_code == 401  # old JWT must remain revoked
    assert recipient.get(f'/api/files/{item["id"]}/content').status_code == 200
    owner.cookies.set('access_token', create_access_token(uid, 1))
    assert owner.get('/api/dashboard').status_code == 200
    assert admin.get('/api/admin/users?q=user0').json()['items'][0]['is_available']
    assert admin.patch(f'/api/admin/users/{uid}/state', json={'is_active': False}).status_code == 200
    assert admin.patch(f'/api/admin/users/{uid}/state', json={'is_active': True}).status_code == 200
    assert owner.get('/api/dashboard').status_code == 401


def test_admin_delete_removes_blobs_and_shares_without_orphans(clients, db, public_key):
    owner, recipient, _, admin = clients
    item = file_body(); assert owner.post('/api/files', json=item).status_code == 201
    assert create_share(owner, recipient, item, public_key).status_code == 201
    secret = {'label_enc': b64(b'L' * 40), 'payload_enc': b64(b'P' * 60)}
    assert owner.post('/api/vault', json=secret).status_code == 201
    uid = admin.get('/api/admin/users?q=user0').json()['items'][0]['id']
    assert owner.delete(f'/api/admin/users/{uid}').status_code == 403
    assert admin.delete(f'/api/admin/users/{uid}').status_code == 204
    assert admin.delete(f'/api/admin/users/{uid}').status_code == 404
    assert owner.get('/api/dashboard').status_code == 401
    assert recipient.get(f'/api/files/{item["id"]}/content').status_code == 404
    with Session(db) as s:
        assert s.get(User, uid) is None
        assert s.exec(select(EncryptedFile)).all() == []
        assert s.exec(select(FileShare)).all() == []
        assert s.exec(select(VaultItem).where(VaultItem.user_id == uid)).all() == []
        assert s.get(SharingKey, uid) is None
        assert s.exec(select(AuditEvent).where(AuditEvent.user_id == uid)).all() == []
        assert s.exec(select(AuditEvent).where(AuditEvent.target_user_id == uid)).all() == []


def test_disabled_owner_suspends_shared_files(clients, public_key):
    owner, recipient, _, admin = clients
    item = file_body(); owner.post('/api/files', json=item)
    assert create_share(owner, recipient, item, public_key).status_code == 201
    uid = admin.get('/api/admin/users').json()['items'][0]['id']
    admin.patch(f'/api/admin/users/{uid}/state', json={'is_active': False})
    assert recipient.get(f'/api/files/{item["id"]}/content').status_code == 404
    assert recipient.get('/api/files').json()['received'] == []


def test_admin_unlock_and_failed_totp_persistent_lockout(clients, db):
    owner, _, _, admin = clients
    secret = pyotp.random_base32()
    bad = '000000' if not pyotp.TOTP(secret).verify('000000', valid_window=1) else '999999'
    with Session(db) as s:
        u = s.exec(select(User).where(User.email == 'user0@example.cd')).one()
        u.mfa_enabled = True; u.totp_secret = secret; s.add(u); s.commit(); uid = u.id
    for _ in range(5):
        assert owner.post('/api/auth/login', json={'email': 'user0@example.cd', 'auth_hash': 'A' * 44, 'totp_code': bad}).status_code == 401
    assert owner.post('/api/auth/login', json={'email': 'user0@example.cd', 'auth_hash': 'A' * 44, 'totp_code': bad}).status_code == 423
    with Session(db) as s:
        assert s.get(User, uid).locked_until is not None
    assert admin.post(f'/api/admin/users/{uid}/unlock').status_code == 200
    with Session(db) as s:
        assert s.get(User, uid).locked_until is None
        assert s.get(User, uid).failed_attempts == 0


def test_mfa_disable_needs_valid_code_and_can_be_reenabled(clients, db):
    owner, _, _, admin = clients
    secret = pyotp.random_base32()
    with Session(db) as s:
        person = s.exec(select(User).where(User.email == 'user0@example.cd')).one()
        person.totp_secret = secret
        person.mfa_enabled = True
        s.add(person)
        s.commit()
        uid = person.id

    bad = '000000' if not pyotp.TOTP(secret).verify('000000', valid_window=1) else '999999'
    assert owner.post('/api/auth/mfa/disable', json={'totp_code': bad}).status_code == 400
    with Session(db) as s:
        assert s.get(User, uid).mfa_enabled is True
        assert s.get(User, uid).totp_secret == secret

    assert owner.post('/api/auth/mfa/disable', json={'totp_code': pyotp.TOTP(secret).now()}).status_code == 200
    assert owner.get('/api/auth/me').json()['mfa_enabled'] is False
    with Session(db) as s:
        assert s.get(User, uid).totp_secret is None
    assert owner.post('/api/auth/mfa/disable', json={'totp_code': bad}).status_code == 409

    setup = owner.post('/api/auth/mfa/setup')
    assert setup.status_code == 200
    new_secret = setup.json()['secret']
    assert new_secret != secret
    assert owner.post('/api/auth/mfa/activate', json={'totp_code': pyotp.TOTP(new_secret).now()}).status_code == 200
    assert owner.get('/api/auth/me').json()['mfa_enabled'] is True

    # The same mechanism removes admin access until MFA is enabled again.
    with Session(db) as s:
        person = s.exec(select(User).where(User.email == 'user3@example.cd')).one()
        person.totp_secret = secret
        s.add(person)
        s.commit()
    assert admin.get('/api/admin/overview').status_code == 200
    assert admin.post('/api/auth/mfa/disable', json={'totp_code': pyotp.TOTP(secret).now()}).status_code == 200
    assert admin.get('/api/admin/overview').status_code == 403


def test_payload_limits_csrf_and_overposting(clients, monkeypatch):
    owner = clients[0]
    assert owner.post('/api/files', json={**file_body(), 'user_id': 99}).status_code == 422
    assert owner.post('/api/files', json={**file_body(), 'ciphertext': 'not-base64'}).status_code == 422
    assert owner.post('/api/files', json={**file_body(), 'ciphertext': b64(b'short')}).status_code == 422
    assert owner.post('/api/auth/logout', headers={'X-Vault-Request': ''}).status_code == 403
    assert owner.post('/api/auth/logout', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert owner.post('/api/files/recipient', content=b'X' * 65537).status_code == 413
    monkeypatch.setattr(settings, 'MAX_FILE_BYTES', 10)
    assert owner.post('/api/files', json=file_body()).status_code == 422
    monkeypatch.setattr(settings, 'MAX_FILE_BYTES', 1024)
    monkeypatch.setattr(settings, 'FILE_QUOTA_BYTES', 99)
    assert owner.post('/api/files', json=file_body()).status_code == 413


def test_existing_vault_and_personal_dashboard(clients):
    owner, recipient, *_ = clients
    data = {'label_enc': b64(b'L' * 40), 'payload_enc': b64(b'P' * 60)}
    created = owner.post('/api/vault', json=data)
    assert created.status_code == 201
    iid = created.json()['id']
    assert recipient.put(f'/api/vault/{iid}', json=data).status_code == 404
    assert owner.put(f'/api/vault/{iid}', json=data).status_code == 200
    dashboard = owner.get('/api/dashboard').json()
    assert dashboard['secrets'] == 1
    assert any(a['action'] == 'secret.created' for a in dashboard['activity'])
    assert not any('label_enc' in a or 'payload_enc' in a for a in dashboard['activity'])
    assert recipient.get('/api/dashboard').json()['secrets'] == 0
    assert owner.delete(f'/api/vault/{iid}').status_code == 204


def test_legacy_jwt_and_failed_password_lockout(clients, db):
    import jwt
    owner, _, _, admin = clients
    uid = admin.get('/api/admin/users').json()['items'][0]['id']
    legacy = jwt.encode({'sub': str(uid), 'iat': utcnow(), 'exp': utcnow() + timedelta(minutes=15)},
                        settings.JWT_SECRET, algorithm='HS256')
    owner.cookies.set('access_token', legacy)
    assert owner.get('/api/auth/me').status_code == 200
    for _ in range(5):
        assert owner.post('/api/auth/login', json={'email': 'user0@example.cd', 'auth_hash': 'B' * 44}).status_code == 401
    assert owner.post('/api/auth/login', json={'email': 'user0@example.cd', 'auth_hash': 'B' * 44}).status_code == 423
    with Session(db) as s:
        assert s.get(User, uid).locked_until is not None


def test_zero_length_files_cannot_bypass_item_limit(clients, db):
    owner = clients[0]
    uid = owner.get('/api/auth/me').json()['id']
    with Session(db) as s:
        for _ in range(100):
            s.add(EncryptedFile(id=str(uuid4()), user_id=uid, metadata_enc='opaque', owner_key_enc='opaque',
                                ciphertext=b'X' * 28, size_bytes=28))
        s.commit()
    assert owner.post('/api/files', json=file_body()).status_code == 413
