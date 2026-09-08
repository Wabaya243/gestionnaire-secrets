from sqlmodel import create_engine, Session, SQLModel
from app.config import settings

# Si on utilise SQLite, on désactive la vérification des threads (nécessaire pour FastAPI)
connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}

# Création du "moteur" : c'est l'interface principale qui gère la communication avec la base de données
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)


def init_db() -> None:
    """Crée toutes les tables dans la base de données en fonction de tes modèles."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Générateur de session : fournit une connexion à la BDD pour chaque requête (très utile pour FastAPI)."""
    with Session(engine) as session:
        yield session