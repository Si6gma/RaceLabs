"""
CSV Import Service - orchestrates parsing, normalization, and database storage.
"""
import uuid
import logging
from typing import List, Dict, Any, Optional, AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.csv_parser import validate_csv_preview, stream_csv_rows, CSVParseStats
from app.csv_normalizer import normalize_telemetry_data
from app.models import ImportedSession, ImportedLap, TelemetrySample

logger = logging.getLogger(__name__)


class CSVImportService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def validate_upload(self, file_content: str) -> Dict[str, Any]:
        """Validate a CSV file and return preview info."""
        result = validate_csv_preview(file_content)
        
        return {
            "valid": result.valid,
            "headers": result.headers,
            "missing_required": result.missing_required,
            "unknown_columns": result.unknown_columns,
            "estimated_rows": result.row_count,
            "sample_rows": result.sample_rows[:5],
            "errors": result.errors,
        }
    
    async def import_csv(
        self,
        file_content: str,
        file_name: str,
        session_name: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Import a CSV file with progress updates.
        Yields progress dicts with status and percentage.
        """
        # Step 1: Validate
        yield {"status": "validating", "progress": 0, "message": "Validating CSV..."}
        validation = validate_csv_preview(file_content)
        if not validation.valid:
            yield {
                "status": "error",
                "progress": 0,
                "message": f"Invalid CSV: missing {validation.missing_required}",
            }
            return
        
        # Step 2: Parse and normalize in chunks
        yield {"status": "parsing", "progress": 10, "message": "Parsing telemetry data..."}
        
        all_rows = []
        for chunk in stream_csv_rows(file_content, chunk_size=5000):
            all_rows.extend(chunk)
            yield {
                "status": "parsing",
                "progress": min(10 + int(len(all_rows) / max(validation.row_count, 1) * 30), 40),
                "message": f"Parsed {len(all_rows)} rows...",
            }
        
        if not all_rows:
            yield {"status": "error", "progress": 0, "message": "No valid data found in file"}
            return
        
        # Step 3: Normalize
        yield {"status": "normalizing", "progress": 45, "message": "Computing derived metrics..."}
        
        track_length = all_rows[0].get("trackLength", 0) or 0
        laps, metadata = normalize_telemetry_data(all_rows, track_length)
        
        yield {
            "status": "normalizing",
            "progress": 60,
            "message": f"Normalized {len(laps)} laps...",
        }
        
        # Step 4: Store in database
        yield {"status": "storing", "progress": 65, "message": "Storing session..."}
        
        session = ImportedSession(
            id=uuid.uuid4(),
            name=session_name or file_name.replace(".csv", "").replace("_", " "),
            track=metadata.get("track_id", "Unknown"),
            track_id=metadata.get("track_id"),
            track_length=metadata.get("track_length", 0),
            car_id=metadata.get("car_id"),
            file_name=file_name,
            sample_count=metadata.get("total_samples", 0),
            lap_count=metadata.get("lap_count", 0),
            best_lap_time_ms=metadata.get("best_lap_time_ms"),
            extra_data={
                "import_version": "1.0",
                "source": "csv",
                "original_file": file_name,
                **metadata,
            },
        )
        
        self.db.add(session)
        
        # Store laps and samples in batches to minimize DB roundtrips
        lap_count = len(laps)
        sample_flush_threshold = 2000  # Flush samples every N records
        total_samples_added = 0
        
        for i, lap in enumerate(laps):
            progress = 65 + int((i / max(lap_count, 1)) * 20)
            yield {
                "status": "storing",
                "progress": progress,
                "message": f"Storing lap {i+1}/{lap_count}...",
            }
            
            lap_record = ImportedLap(
                id=uuid.uuid4(),
                session_id=session.id,
                lap_number=lap.lap_number,
                lap_index=lap.lap_index,
                lap_time_ms=lap.lap_time_ms,
                valid=lap.valid,
                valid_bin_count=lap.valid_bin_count,
                total_bin_count=lap.total_bin_count,
                max_speed=lap.max_speed,
                avg_speed=lap.avg_speed,
                min_speed=lap.min_speed,
                extra_data={
                    "sample_count": len(lap.samples),
                    "is_out_lap": lap.is_out_lap,
                    "is_flying_lap": lap.is_flying_lap,
                    "is_in_lap": lap.is_in_lap,
                    "is_pit_lap": lap.is_pit_lap,
                    "phases_seen": ["out_lap"] if lap.is_out_lap else (["flying_lap"] if lap.is_flying_lap else (["in_lap"] if lap.is_in_lap else ["unknown"])),
                },
            )
            self.db.add(lap_record)
            
            # Buffer samples and flush in batches
            for sample in lap.samples:
                sample_record = TelemetrySample(
                    id=uuid.uuid4(),
                    session_id=session.id,
                    lap_id=lap_record.id,
                    bin_index=sample.bin_index,
                    normalized_track_position=sample.normalized_track_position,
                    world_position_x=sample.world_position_x,
                    world_position_y=sample.world_position_y,
                    world_position_z=sample.world_position_z,
                    world_right_x=sample.world_right_x,
                    world_right_y=sample.world_right_y,
                    world_right_z=sample.world_right_z,
                    velocity_x=sample.velocity_x,
                    velocity_y=sample.velocity_y,
                    velocity_z=sample.velocity_z,
                    speed=sample.speed,
                    speed_kmh=sample.speed_kmh,
                    gforce_lat=sample.gforce_lat,
                    gforce_lon=sample.gforce_lon,
                    gforce_vert=sample.gforce_vert,
                    throttle=sample.throttle,
                    brake=sample.brake,
                    steering=sample.steering,
                    gear=sample.gear,
                    rpm=sample.rpm,
                    race_position=sample.race_position,
                    lap_time=sample.lap_time,
                    delta_time=sample.delta_time,
                    sector=sample.sector,
                    cumulative_distance=sample.cumulative_distance,
                    trajectory_curvature=sample.trajectory_curvature,
                )
                self.db.add(sample_record)
                total_samples_added += 1
                
                if total_samples_added >= sample_flush_threshold:
                    await self.db.flush()
                    total_samples_added = 0
        
        await self.db.commit()
        
        yield {
            "status": "complete",
            "progress": 100,
            "message": f"Import complete: {lap_count} laps, {metadata.get('total_samples', 0)} samples",
            "session_id": str(session.id),
            "session": {
                "id": str(session.id),
                "name": session.name,
                "track": session.track,
                "lap_count": session.lap_count,
                "sample_count": session.sample_count,
                "best_lap_time_ms": session.best_lap_time_ms,
                "created_at": session.created_at.isoformat() if session.created_at else None,
            },
        }
    
    async def get_sessions(self) -> List[Dict[str, Any]]:
        """Get all imported sessions."""
        result = await self.db.execute(
            select(ImportedSession).order_by(ImportedSession.created_at.desc())
        )
        sessions = result.scalars().all()
        
        return [
            {
                "id": str(s.id),
                "name": s.name,
                "track": s.track,
                "track_id": s.track_id,
                "track_length": s.track_length,
                "car_id": s.car_id,
                "session_type": s.session_type,
                "source": s.source,
                "file_name": s.file_name,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "sample_count": s.sample_count,
                "lap_count": s.lap_count,
                "best_lap_time_ms": s.best_lap_time_ms,
                "status": s.status,
                "extra_data": s.extra_data,
            }
            for s in sessions
        ]
    
    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get a single session with its laps."""
        result = await self.db.execute(
            select(ImportedSession).where(ImportedSession.id == uuid.UUID(session_id))
        )
        session = result.scalar_one_or_none()
        if not session:
            return None
        
        # Get laps
        laps_result = await self.db.execute(
            select(ImportedLap).where(ImportedLap.session_id == uuid.UUID(session_id))
            .order_by(ImportedLap.lap_number)
        )
        laps = laps_result.scalars().all()
        
        return {
            "id": str(session.id),
            "name": session.name,
            "track": session.track,
            "track_id": session.track_id,
            "track_length": session.track_length,
            "car_id": session.car_id,
            "session_type": session.session_type,
            "source": session.source,
            "file_name": session.file_name,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "sample_count": session.sample_count,
            "lap_count": session.lap_count,
            "best_lap_time_ms": session.best_lap_time_ms,
            "status": session.status,
            "extra_data": session.extra_data,
            "laps": [
                {
                    "id": str(lap.id),
                    "lap_number": lap.lap_number,
                    "lap_index": lap.lap_index,
                    "lap_time_ms": lap.lap_time_ms,
                    "valid": lap.valid,
                    "valid_bin_count": lap.valid_bin_count,
                    "total_bin_count": lap.total_bin_count,
                    "max_speed": lap.max_speed,
                    "avg_speed": lap.avg_speed,
                    "min_speed": lap.min_speed,
                }
                for lap in laps
            ],
        }
    
    async def get_lap_telemetry(self, lap_id: str) -> List[Dict[str, Any]]:
        """Get all telemetry samples for a lap."""
        result = await self.db.execute(
            select(TelemetrySample)
            .where(TelemetrySample.lap_id == uuid.UUID(lap_id))
            .order_by(TelemetrySample.bin_index)
        )
        samples = result.scalars().all()
        
        return [
            {
                "bin_index": s.bin_index,
                "normalized_track_position": s.normalized_track_position,
                "world_position_x": s.world_position_x,
                "world_position_y": s.world_position_y,
                "world_position_z": s.world_position_z,
                "velocity_x": s.velocity_x,
                "velocity_y": s.velocity_y,
                "velocity_z": s.velocity_z,
                "speed": s.speed,
                "speed_kmh": s.speed_kmh,
                "throttle": s.throttle,
                "brake": s.brake,
                "steering": s.steering,
                "gear": s.gear,
                "rpm": s.rpm,
                "gforce_lat": s.gforce_lat,
                "race_position": s.race_position,
                "lap_time": s.lap_time,
                "delta_time": s.delta_time,
                "sector": s.sector,
                "cumulative_distance": s.cumulative_distance,
                "trajectory_curvature": s.trajectory_curvature,
            }
            for s in samples
        ]
    
    async def get_session_telemetry(self, session_id: str, lap_numbers: Optional[List[int]] = None) -> Dict[str, Any]:
        """Get telemetry for a session, optionally filtered by lap numbers."""
        result = await self.db.execute(
            select(ImportedSession).where(ImportedSession.id == uuid.UUID(session_id))
        )
        session = result.scalar_one_or_none()
        if not session:
            return {}
        
        # Build query for samples
        query = select(TelemetrySample).where(TelemetrySample.session_id == uuid.UUID(session_id))
        
        if lap_numbers:
            # Get lap IDs for these lap numbers
            laps_result = await self.db.execute(
                select(ImportedLap).where(
                    ImportedLap.session_id == uuid.UUID(session_id),
                    ImportedLap.lap_number.in_(lap_numbers)
                )
            )
            laps = laps_result.scalars().all()
            lap_ids = [lap.id for lap in laps]
            query = query.where(TelemetrySample.lap_id.in_(lap_ids))
        
        query = query.order_by(TelemetrySample.lap_id, TelemetrySample.bin_index)
        
        samples_result = await self.db.execute(query)
        samples = samples_result.scalars().all()
        
        return {
            "session_id": session_id,
            "samples": [
                {
                    "bin_index": s.bin_index,
                    "lap_id": str(s.lap_id) if s.lap_id else None,
                    "normalized_track_position": s.normalized_track_position,
                    "world_position_x": s.world_position_x,
                    "world_position_y": s.world_position_y,
                    "world_position_z": s.world_position_z,
                    "speed_kmh": s.speed_kmh,
                    "throttle": s.throttle,
                    "brake": s.brake,
                    "steering": s.steering,
                    "gear": s.gear,
                    "rpm": s.rpm,
                    "gforce_lat": s.gforce_lat,
                    "delta_time": s.delta_time,
                    "sector": s.sector,
                    "cumulative_distance": s.cumulative_distance,
                }
                for s in samples
            ],
            "count": len(samples),
        }
    
    async def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its data.
        
        Deletes child records (samples, laps) first to avoid FK constraint violations,
        since the raw SQL delete does not trigger SQLAlchemy ORM cascades.
        """
        sid = uuid.UUID(session_id)
        try:
            # Delete samples first (they reference both session and lap)
            await self.db.execute(
                delete(TelemetrySample).where(TelemetrySample.session_id == sid)
            )
            # Delete laps (they reference session)
            await self.db.execute(
                delete(ImportedLap).where(ImportedLap.session_id == sid)
            )
            # Delete the session itself
            result = await self.db.execute(
                delete(ImportedSession).where(ImportedSession.id == sid)
            )
            await self.db.commit()
            return result.rowcount > 0
        except Exception as e:
            logger.error(f"Error deleting session: {e}")
            await self.db.rollback()
            return False
    
    async def export_session_csv(self, session_id: str, lap_numbers: Optional[List[int]] = None) -> str:
        """Export session data to CSV string."""
        import csv
        import io
        
        result = await self.db.execute(
            select(ImportedSession).where(ImportedSession.id == uuid.UUID(session_id))
        )
        session = result.scalar_one_or_none()
        if not session:
            return ""
        
        # Get samples
        query = select(TelemetrySample).where(TelemetrySample.session_id == uuid.UUID(session_id))
        
        if lap_numbers:
            laps_result = await self.db.execute(
                select(ImportedLap).where(
                    ImportedLap.session_id == uuid.UUID(session_id),
                    ImportedLap.lap_number.in_(lap_numbers)
                )
            )
            laps = laps_result.scalars().all()
            lap_ids = [lap.id for lap in laps]
            query = query.where(TelemetrySample.lap_id.in_(lap_ids))
        
        query = query.order_by(TelemetrySample.lap_id, TelemetrySample.bin_index)
        
        samples_result = await self.db.execute(query)
        samples = samples_result.scalars().all()
        
        # Build CSV
        output = io.StringIO()
        fieldnames = [
            "session_id", "lap_id", "bin_index", "normalized_track_position",
            "world_position_X", "world_position_Y", "world_position_Z",
            "velocity_X", "velocity_Y", "velocity_Z",
            "speed", "speed_kmh", "throttle", "brake", "steering",
            "gear", "rpm", "gforce_lat", "delta_time", "sector",
            "cumulative_distance",
        ]
        
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        
        for s in samples:
            writer.writerow({
                "session_id": str(s.session_id),
                "lap_id": str(s.lap_id) if s.lap_id else "",
                "bin_index": s.bin_index,
                "normalized_track_position": round(s.normalized_track_position, 6) if s.normalized_track_position else 0,
                "world_position_X": s.world_position_x,
                "world_position_Y": s.world_position_y,
                "world_position_Z": s.world_position_z,
                "velocity_X": s.velocity_x,
                "velocity_Y": s.velocity_y,
                "velocity_Z": s.velocity_z,
                "speed": round(s.speed, 4) if s.speed else 0,
                "speed_kmh": round(s.speed_kmh, 2) if s.speed_kmh else 0,
                "throttle": s.throttle,
                "brake": s.brake,
                "steering": s.steering,
                "gear": s.gear,
                "rpm": s.rpm,
                "gforce_lat": round(s.gforce_lat, 4) if s.gforce_lat else 0,
                "delta_time": round(s.delta_time, 4) if s.delta_time else 0,
                "sector": s.sector,
                "cumulative_distance": round(s.cumulative_distance, 4) if s.cumulative_distance else 0,
            })
        
        return output.getvalue()
