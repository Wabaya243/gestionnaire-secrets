from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    DATABASE_URL: str = "sqlite:///./vault.db"
    JWT_SECRET: str 
    JWT_EXPIRE_MINUTES: int = 15
    ENVIRONMENT: str = "development"

    # Paramètres Argon2id côté serveur (OWASP 2024)
    ARGON2_TIME_COST: int = 3
    ARGON2_MEMORY_COST: int = 65536   # 64 Mio
    ARGON2_PARALLELISM: int = 4

    # Verrouillage
    MAX_FAILED_ATTEMPTS: int = 5
    LOCKOUT_MINUTES: int = 15


    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def db_url(self) -> str:
        """
        Render fournit DATABASE_URL au format postgres://
        SQLAlchemy attend postgresql:// et, sans précision, cherche
        le pilote psycopg2. Nous utilisons psycopg 3, d'où le suffixe
        +psycopg qui l'indique explicitement.
        """
        url = self.DATABASE_URL

        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)

        return url



settings = Settings()