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


settings = Settings()