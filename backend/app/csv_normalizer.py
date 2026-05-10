"""
Telemetry normalizer for imported CSV data.
Computes derived metrics, track position, lap segmentation, and trajectory smoothing.
Uses lapIndex and lapFlag to properly distinguish out laps from flying laps.
"""
import math
import logging
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class NormalizedSample:
    bin_index: int
    lap_index: int
    lap_num: int
    valid_bin: bool
    lap_flag: bool
    
    # Position
    world_position_x: float
    world_position_y: float
    world_position_z: float
    world_right_x: Optional[float]
    world_right_y: Optional[float]
    world_right_z: Optional[float]
    
    # Velocity
    velocity_x: float
    velocity_y: float
    velocity_z: float
    speed: float  # m/s
    speed_kmh: float
    
    # Inputs
    throttle: float
    brake: float
    steering: float
    gear: int
    rpm: int
    
    # G-Force
    gforce_lat: float
    gforce_lon: float
    gforce_vert: float
    
    # Race
    race_position: int
    
    # Timing
    lap_time: Optional[float]
    delta_time: float = 0.0
    sector: int = 1
    
    # Computed
    normalized_track_position: float = 0.0
    cumulative_distance: float = 0.0
    trajectory_curvature: float = 0.0
    
    # Metadata
    raw: Dict[str, Any] = None

    def __post_init__(self):
        if self.raw is None:
            self.raw = {}


@dataclass
class NormalizedLap:
    lap_index: int          # Sequential lap index from CSV (0, 1, 2, ...)
    lap_number: int         # Timed lap number (may differ from lap_index)
    lap_time_ms: Optional[int]
    valid: bool
    samples: List[NormalizedSample]
    
    # Lap classification
    is_out_lap: bool = False
    is_flying_lap: bool = False
    is_in_lap: bool = False
    is_pit_lap: bool = False
    
    # Statistics
    max_speed: float = 0.0
    avg_speed: float = 0.0
    min_speed: float = 0.0
    valid_bin_count: int = 0
    total_bin_count: int = 0
    sector1_ms: Optional[int] = None
    sector2_ms: Optional[int] = None
    sector3_ms: Optional[int] = None


def compute_speed(velocity_x: float, velocity_y: float, velocity_z: float) -> Tuple[float, float]:
    """Compute speed in m/s and km/h from velocity vectors."""
    speed_ms = math.sqrt(velocity_x ** 2 + velocity_y ** 2 + velocity_z ** 2)
    speed_kmh = speed_ms * 3.6
    return speed_ms, speed_kmh


def compute_cumulative_distance(samples: List[NormalizedSample]) -> None:
    """Compute cumulative distance along trajectory."""
    if not samples:
        return
    
    samples[0].cumulative_distance = 0.0
    
    for i in range(1, len(samples)):
        dx = samples[i].world_position_x - samples[i-1].world_position_x
        dy = samples[i].world_position_y - samples[i-1].world_position_y
        dz = samples[i].world_position_z - samples[i-1].world_position_z
        dist = math.sqrt(dx**2 + dy**2 + dz**2)
        samples[i].cumulative_distance = samples[i-1].cumulative_distance + dist


def compute_normalized_track_position(samples: List[NormalizedSample], track_length: float) -> None:
    """Compute normalized track position [0.0, 1.0] based on cumulative distance."""
    if not samples or track_length <= 0:
        return
    
    compute_cumulative_distance(samples)
    total_dist = samples[-1].cumulative_distance if samples else 0
    
    for sample in samples:
        if total_dist > 0:
            sample.normalized_track_position = sample.cumulative_distance / total_dist
        else:
            sample.normalized_track_position = 0.0
    
    # Ensure last sample is exactly 1.0
    if samples:
        samples[-1].normalized_track_position = 1.0


def compute_trajectory_curvature(samples: List[NormalizedSample]) -> None:
    """Compute trajectory curvature using three-point method."""
    if len(samples) < 3:
        return
    
    for i in range(1, len(samples) - 1):
        p1 = (samples[i-1].world_position_x, samples[i-1].world_position_z)
        p2 = (samples[i].world_position_x, samples[i].world_position_z)
        p3 = (samples[i+1].world_position_x, samples[i+1].world_position_z)
        
        # Compute curvature using cross product
        dx1 = p2[0] - p1[0]
        dz1 = p2[1] - p1[1]
        dx2 = p3[0] - p2[0]
        dz2 = p3[1] - p2[1]
        
        cross = abs(dx1 * dz2 - dz1 * dx2)
        denom = (math.sqrt(dx1**2 + dz1**2) * math.sqrt(dx2**2 + dz2**2)) + 1e-10
        
        samples[i].trajectory_curvature = cross / denom
    
    # Boundary conditions
    if samples:
        samples[0].trajectory_curvature = samples[1].trajectory_curvature if len(samples) > 1 else 0.0
        samples[-1].trajectory_curvature = samples[-2].trajectory_curvature if len(samples) > 1 else 0.0


def detect_sectors(samples: List[NormalizedSample]) -> None:
    """Detect sectors based on normalized track position."""
    for sample in samples:
        pos = sample.normalized_track_position
        if pos < 0.33:
            sample.sector = 1
        elif pos < 0.66:
            sample.sector = 2
        else:
            sample.sector = 3


def compute_delta_times(samples: List[NormalizedSample], best_lap_samples: Optional[List[NormalizedSample]] = None) -> None:
    """Compute delta time relative to best lap at each track position."""
    if not best_lap_samples:
        for sample in samples:
            sample.delta_time = 0.0
        return
    
    # Build lookup from best lap by normalized position
    best_lookup = {}
    for s in best_lap_samples:
        # Round to 2 decimal places for matching
        key = round(s.normalized_track_position, 2)
        if key not in best_lookup:
            best_lookup[key] = s.lap_time or 0
    
    for sample in samples:
        key = round(sample.normalized_track_position, 2)
        best_time = best_lookup.get(key, sample.lap_time or 0)
        current_time = sample.lap_time or 0
        sample.delta_time = current_time - best_time


def normalize_samples(raw_rows: List[Dict[str, Any]]) -> List[NormalizedSample]:
    """Convert raw CSV rows to normalized samples."""
    samples = []
    
    for row in raw_rows:
        vx = row.get("velocity_X", 0) or 0
        vy = row.get("velocity_Y", 0) or 0
        vz = row.get("velocity_Z", 0) or 0
        speed_ms, speed_kmh = compute_speed(vx, vy, vz)
        
        sample = NormalizedSample(
            bin_index=row.get("binIndex", 0) or 0,
            lap_index=row.get("lapIndex", 0) or 0,
            lap_num=row.get("lapNum", 0) or 0,
            valid_bin=row.get("validBin", True),
            lap_flag=row.get("lapFlag", False),
            world_position_x=row.get("world_position_X", 0) or 0,
            world_position_y=row.get("world_position_Y", 0) or 0,
            world_position_z=row.get("world_position_Z", 0) or 0,
            world_right_x=row.get("world_right_X"),
            world_right_y=row.get("world_right_Y"),
            world_right_z=row.get("world_right_Z"),
            velocity_x=vx,
            velocity_y=vy,
            velocity_z=vz,
            speed=speed_ms,
            speed_kmh=speed_kmh,
            throttle=row.get("throttle", 0) or 0,
            brake=row.get("brake", 0) or 0,
            steering=row.get("steering", 0) or 0,
            gear=row.get("gear", 0) or 0,
            rpm=row.get("rpm", 0) or 0,
            gforce_lat=row.get("gforce_Y", 0) or 0,
            gforce_lon=0.0,
            gforce_vert=0.0,
            race_position=row.get("race_position", 0) or 0,
            lap_time=row.get("lap_time"),
            raw=row,
        )
        samples.append(sample)
    
    return samples


def classify_lap(lap_samples: List[NormalizedSample]) -> Tuple[bool, bool, bool]:
    """Classify a lap as out lap, flying lap, or in lap based on lapFlag and speed patterns.
    
    Returns: (is_out_lap, is_flying_lap, is_in_lap)
    """
    if not lap_samples:
        return False, False, False
    
    # Check lapFlag - if any sample has lapFlag=True, it's an out lap
    has_lap_flag = any(s.lap_flag for s in lap_samples)
    if has_lap_flag:
        return True, False, False
    
    # Analyze speed patterns for laps without explicit flags
    speeds = [s.speed_kmh for s in lap_samples if s.speed_kmh is not None]
    if not speeds:
        return False, False, False
    
    avg_speed = sum(speeds) / len(speeds)
    max_speed = max(speeds)
    
    # Very low average speed suggests pit/garage (not a flying lap)
    if avg_speed < 30:
        return False, False, False
    
    # High max speed with reasonable average = flying lap
    if max_speed > 100 and avg_speed > 60:
        return False, True, False
    
    # Moderate speed could be in lap or out lap
    if avg_speed < 60:
        # Check if speed builds up (out lap) or drops off (in lap)
        first_third = speeds[:len(speeds)//3]
        last_third = speeds[-len(speeds)//3:]
        if first_third and last_third:
            first_avg = sum(first_third) / len(first_third)
            last_avg = sum(last_third) / len(last_third)
            if first_avg < last_avg * 0.7:
                return True, False, False  # Speed builds up = out lap
            elif last_avg < first_avg * 0.7:
                return False, False, True   # Speed drops = in lap
    
    # Default: assume flying lap if speed is reasonable
    return False, True, False


def segment_laps(samples: List[NormalizedSample]) -> List[NormalizedLap]:
    """Segment samples into laps based on lapIndex (not lapNum).
    
    lapIndex is the sequential lap counter and is more reliable than lapNum
    which may repeat values (e.g., both out lap and first flying lap can have lapNum=0).
    """
    lap_groups = defaultdict(list)
    
    for sample in samples:
        lap_groups[sample.lap_index].append(sample)
    
    laps = []
    for lap_index in sorted(lap_groups.keys()):
        lap_samples = lap_groups[lap_index]
        
        # Sort by bin_index to ensure order
        lap_samples.sort(key=lambda s: s.bin_index)
        
        # Classify the lap
        is_out, is_flying, is_in = classify_lap(lap_samples)
        
        # Determine lap validity
        valid = all(s.valid_bin for s in lap_samples) and len(lap_samples) > 0
        
        # Get lap time from last sample or compute from lap_time field
        # Only consider lap time if lap has enough samples to be complete
        lap_time_ms = None
        if lap_samples and len(lap_samples) > 100:
            last_time = lap_samples[-1].lap_time
            if last_time is not None and last_time > 0:
                lap_time_ms = int(last_time * 1000)
        
        # Compute statistics
        speeds = [s.speed_kmh for s in lap_samples if s.speed_kmh is not None]
        
        lap = NormalizedLap(
            lap_index=lap_index,
            lap_number=lap_samples[0].lap_num if lap_samples else lap_index,
            lap_time_ms=lap_time_ms,
            valid=valid,
            samples=lap_samples,
            is_out_lap=is_out,
            is_flying_lap=is_flying,
            is_in_lap=is_in,
            max_speed=max(speeds) if speeds else 0.0,
            avg_speed=sum(speeds) / len(speeds) if speeds else 0.0,
            min_speed=min(speeds) if speeds else 0.0,
            valid_bin_count=sum(1 for s in lap_samples if s.valid_bin),
            total_bin_count=len(lap_samples),
        )
        laps.append(lap)
    
    return laps


def normalize_telemetry_data(raw_rows: List[Dict[str, Any]], track_length: float = 0) -> Tuple[List[NormalizedLap], Dict[str, Any]]:
    """
    Full normalization pipeline.
    Returns normalized laps and session metadata.
    """
    if not raw_rows:
        return [], {}
    
    # Step 1: Normalize raw samples
    samples = normalize_samples(raw_rows)
    
    # Step 2: Segment into laps using lapIndex
    laps = segment_laps(samples)
    
    # Step 3: Find best flying lap for delta calculation
    best_lap = None
    best_time = float('inf')
    for lap in laps:
        if lap.is_flying_lap and lap.valid and lap.lap_time_ms and lap.lap_time_ms < best_time:
            best_time = lap.lap_time_ms
            best_lap = lap
    
    # If no flying lap found, fall back to any valid lap
    if best_lap is None:
        for lap in laps:
            if lap.valid and lap.lap_time_ms and lap.lap_time_ms < best_time:
                best_time = lap.lap_time_ms
                best_lap = lap
    
    # Step 4: Compute per-lap metrics
    for lap in laps:
        # Compute track position
        lap_track_length = track_length
        if lap_track_length <= 0 and len(lap.samples) > 1:
            # Estimate track length from cumulative distance
            compute_cumulative_distance(lap.samples)
            lap_track_length = lap.samples[-1].cumulative_distance if lap.samples else 0
        
        compute_normalized_track_position(lap.samples, lap_track_length)
        compute_trajectory_curvature(lap.samples)
        detect_sectors(lap.samples)
        compute_delta_times(lap.samples, best_lap.samples if best_lap else None)
    
    # Session metadata
    car_ids = set(s.raw.get("carId") for s in samples if s.raw.get("carId"))
    track_ids = set(s.raw.get("trackId") for s in samples if s.raw.get("trackId"))
    track_lengths = set(s.raw.get("trackLength") for s in samples if s.raw.get("trackLength"))
    
    flying_laps = [l for l in laps if l.is_flying_lap]
    out_laps = [l for l in laps if l.is_out_lap]
    in_laps = [l for l in laps if l.is_in_lap]
    
    metadata = {
        "car_id": list(car_ids)[0] if car_ids else "unknown",
        "track_id": list(track_ids)[0] if track_ids else "unknown",
        "track_length": list(track_lengths)[0] if track_lengths else track_length,
        "total_samples": len(samples),
        "lap_count": len(laps),
        "flying_lap_count": len(flying_laps),
        "out_lap_count": len(out_laps),
        "in_lap_count": len(in_laps),
        "best_lap_time_ms": best_time if best_time != float('inf') else None,
        "best_lap_number": best_lap.lap_number if best_lap else None,
        "best_lap_index": best_lap.lap_index if best_lap else None,
    }
    
    return laps, metadata
