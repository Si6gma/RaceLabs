from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import get_settings
from app.models import Base

settings = get_settings()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Migration: add resampled_data column to imported_laps if missing
        await conn.execute(text("""
            ALTER TABLE imported_laps
            ADD COLUMN IF NOT EXISTS resampled_data JSONB
        """))

        # Convert telemetry_samples to a TimescaleDB hypertable partitioned by time.
        # create_hypertable is idempotent when if_not_exists => TRUE.
        await conn.execute(text("""
            SELECT create_hypertable(
                'telemetry_samples', 'timestamp',
                if_not_exists => TRUE,
                migrate_data => TRUE
            )
        """))


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
