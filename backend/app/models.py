from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey, Text, BigInteger
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
    metadata = Column(JSON, default=dict)

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
    metadata = Column(JSON, default=dict)

    session = relationship("Session", back_populates="laps")


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    number = Column(Integer)
    team = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


# CSV Import Models

class ImportedSession(Base):
    __tablename__ = "imported_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    track = Column(String, nullable=False)
    track_id = Column(String)
    track_length = Column(Float)
    car_id = Column(String)
    session_type = Column(String, default="Imported")
    source = Column(String, default="csv")  # csv, motec, etc.
    file_name = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    imported_at = Column(DateTime, default=datetime.utcnow)
    sample_count = Column(BigInteger, default=0)
    lap_count = Column(Integer, default=0)
    best_lap_time_ms = Column(Integer)
    metadata = Column(JSON, default=dict)
    status = Column(String, default="active")  # active, archived

    laps = relationship("ImportedLap", back_populates="session", cascade="all, delete-orphan")
    samples = relationship("TelemetrySample", back_populates="session", cascade="all, delete-orphan")


class ImportedLap(Base):
    __tablename__ = "imported_laps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("imported_sessions.id"), nullable=False)
    lap_number = Column(Integer, nullable=False)
    lap_index = Column(Integer, default=0)
    lap_time_ms = Column(Integer)
    valid = Column(Boolean, default=True)
    valid_bin_count = Column(Integer, default=0)
    total_bin_count = Column(Integer, default=0)
    sector1_ms = Column(Integer)
    sector2_ms = Column(Integer)
    sector3_ms = Column(Integer)
    max_speed = Column(Float)
    avg_speed = Column(Float)
    min_speed = Column(Float)
    metadata = Column(JSON, default=dict)

    session = relationship("ImportedSession", back_populates="laps")
    samples = relationship("TelemetrySample", back_populates="lap")


class TelemetrySample(Base):
    __tablename__ = "telemetry_samples"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("imported_sessions.id"), nullable=False)
    lap_id = Column(UUID(as_uuid=True), ForeignKey("imported_laps.id"), nullable=True)
    
    # Position
    bin_index = Column(Integer)
    normalized_track_position = Column(Float)
    world_position_x = Column(Float)
    world_position_y = Column(Float)
    world_position_z = Column(Float)
    world_right_x = Column(Float)
    world_right_y = Column(Float)
    world_right_z = Column(Float)
    
    # Motion
    velocity_x = Column(Float)
    velocity_y = Column(Float)
    velocity_z = Column(Float)
    speed = Column(Float)
    speed_kmh = Column(Float)
    gforce_lat = Column(Float)
    gforce_lon = Column(Float)
    gforce_vert = Column(Float)
    
    # Inputs
    throttle = Column(Float)
    brake = Column(Float)
    steering = Column(Float)
    gear = Column(Integer)
    rpm = Column(Integer)
    
    # Race
    race_position = Column(Integer)
    
    # Timing
    lap_time = Column(Float)
    delta_time = Column(Float)
    sector = Column(Integer)
    
    # Computed
    cumulative_distance = Column(Float)
    trajectory_curvature = Column(Float)
    
    timestamp = Column(DateTime, default=datetime.utcnow)

    session = relationship("ImportedSession", back_populates="samples")
    lap = relationship("ImportedLap", back_populates="samples")
