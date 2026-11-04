from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/telemetry"
    UDP_PORT: int = 20777
    WS_PORT: int = 8000
    APP_NAME: str = "Telemetry Suite"
    DEBUG: bool = True
    # Room lamps through Home Assistant. Off unless both URL and token are set.
    HA_URL: str = ""
    HA_TOKEN: str = ""
    HA_LIGHT_LEFT: str = "light.left"
    HA_LIGHT_RIGHT: str = "light.right"
    # Where the dashboard's on/off and brightness for the lamps are kept.
    LIGHTS_STATE_FILE: str = "lights_state.json"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
