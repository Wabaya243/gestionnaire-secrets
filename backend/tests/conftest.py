import os
import sys
from pathlib import Path
os.environ.setdefault('JWT_SECRET', 'test-secret-with-at-least-thirty-two-bytes')
os.environ.setdefault('DATABASE_URL', 'sqlite://')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine, SQLModel, Session
from fastapi.testclient import TestClient
from app.database import get_session
from app.main import app
from app.models import User
from app.routers.auth import limiter
from app.security import create_access_token, hash_auth


@pytest.fixture
def db():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    @event.listens_for(engine, 'connect')
    def foreign_keys(dbapi_connection, _):
        dbapi_connection.execute('PRAGMA foreign_keys=ON')
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def clients(db):
    def session():
        with Session(db) as s:
            yield s
    app.dependency_overrides[get_session] = session
    limiter.enabled = False  # test authorization independently from per-IP rate limits
    users = []
    with Session(db) as s:
        for i in range(4):
            u = User(email=f'user{i}@example.cd', kdf_salt='A' * 24,
                     auth_hash=hash_auth('A' * 44), is_admin=i == 3, mfa_enabled=i == 3)
            s.add(u); s.flush(); users.append(u.id)
        s.commit()
    all_clients = []
    for uid in users:
        c = TestClient(app, headers={'X-Vault-Request': '1'})
        c.cookies.set('access_token', create_access_token(uid))
        all_clients.append(c)
    yield all_clients
    for c in all_clients:
        c.close()
    limiter.enabled = True
    app.dependency_overrides.clear()
