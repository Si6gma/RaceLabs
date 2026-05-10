from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime
import uuid

Base = declarative_base()


class Session(Base):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    track = Column(String, nullable=False)
    session_type = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    weather = Column(String)
    track_temp = Column(Float)
    air_temp = Column(Float)
    extra_data = Column(JSON, default=dict)

    laps = relationship("Lap", back_populates="session", cascade="all, delete-orphan")


class Lap(Base):
    __tablename__ = "laps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    lap_number = Column(Integer, nullable=False)
    lap_time_ms = Column(Integer)
    sector1_ms = Column(Integer)
    sector2_ms = Column(Integer)
    sector3_ms = Column(Integer)
    valid = Column(Boolean, default=True)
    driver_name = Column(String)
    car_name = Column(String)
    tyre_compound = Column(String)
    fuel_at_start = Column(Float)
    fuel_at_end = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    extra_data = Column(JSON, default=dict)

    session = relationship("Session", back_populates="laps")


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    number = Column(Integer)
    team = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
