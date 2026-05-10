from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/telemetry"
    INFLUXDB_URL: str = "http://localhost:8086"
    INFLUXDB_TOKEN: str = "telemetry-token"
    INFLUXDB_ORG: str = "motorsport"
    INFLUXDB_BUCKET: str = "telemetry"
    UDP_PORT: int = 20777
    WS_PORT: int = 8000
    REDIS_URL: str = "redis://localhost:6379"
    APP_NAME: str = "Telemetry Suite"
    DEBUG: bool = True

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
