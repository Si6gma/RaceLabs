"""
Telemetry resampler — aligns lap data to a fixed-distance grid using linear interpolation.

This is the core primitive for lap comparison. Every lap, regardless of original sample count,
is resampled to a common set of normalized track positions [0.0, 1.0].
"""
import math
from typing import List, Dict, Any, Optional

# Number of bins per lap. 2000 ≈ 1 bin per 2.5 m on a 5 km track.
DEFAULT_BINS = 2000

# Channels that should use nearest-neighbour (discrete values) rather than linear interpolation.
NEAREST_CHANNELS = {"gear"}


def _lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation between a and b at factor t (0→1)."""
    return a + (b - a) * t


def _find_interpolation_bounds(
    samples: List[Dict[str, Any]], target_pos: float
) -> Optional[tuple[int, int, float]]:
    """
    Find the two surrounding samples for a target normalized_track_position.
    Returns (left_idx, right_idx, factor) or None if out of bounds.
    """
    n = len(samples)
    if n == 0:
        return None
    if n == 1:
        return (0, 0, 0.0)

    # Fast path: exact match or before first / after last
    first_pos = samples[0]["normalized_track_position"]
    last_pos = samples[-1]["normalized_track_position"]

    if target_pos <= first_pos:
        return (0, 0, 0.0)
    if target_pos >= last_pos:
        return (n - 1, n - 1, 0.0)

    # Binary search for the bracket
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        mid_pos = samples[mid]["normalized_track_position"]
        if mid_pos < target_pos:
            lo = mid
        else:
            hi = mid

    left_pos = samples[lo]["normalized_track_position"]
    right_pos = samples[hi]["normalized_track_position"]
    span = right_pos - left_pos
    if span < 1e-12:
        return (lo, hi, 0.0)
    factor = (target_pos - left_pos) / span
    return (lo, hi, factor)


def resample_lap(
    samples: List[Dict[str, Any]],
    bins: int = DEFAULT_BINS,
) -> Optional[Dict[str, Any]]:
    """
    Resample a lap's telemetry onto a fixed-distance grid.

    Input samples must have keys:
        normalized_track_position, cumulative_distance,
        speed_kmh, throttle, brake, steering, gear, rpm,
        gforce_lat, world_position_x, world_position_y, world_position_z,
        lap_time

    Returns a compact column-oriented dict:
    {
        "bin_count": int,
        "normalized_track_position": [float, ...],
        "cumulative_distance": [float, ...],
        "speed_kmh": [float, ...],
        ...
    }
    """
    if not samples or bins < 2:
        return None

    # Ensure sorted by track position
    sorted_samples = sorted(
        samples,
        key=lambda s: s.get("normalized_track_position", 0) or 0,
    )

    channels = [
        "speed_kmh",
        "throttle",
        "brake",
        "steering",
        "gear",
        "rpm",
        "gforce_lat",
        "world_position_x",
        "world_position_y",
        "world_position_z",
        "lap_time",
        "cumulative_distance",
    ]

    result: Dict[str, Any] = {
        "bin_count": bins,
        "normalized_track_position": [],
    }
    for ch in channels:
        result[ch] = []

    for b in range(bins):
        target_pos = b / (bins - 1)
        bounds = _find_interpolation_bounds(sorted_samples, target_pos)
        if bounds is None:
            continue

        left_idx, right_idx, factor = bounds
        left = sorted_samples[left_idx]
        right = sorted_samples[right_idx]

        result["normalized_track_position"].append(target_pos)

        for ch in channels:
            lv = left.get(ch, 0) or 0
            rv = right.get(ch, 0) or 0

            if ch in NEAREST_CHANNELS:
                # Nearest-neighbour for discrete channels
                val = lv if factor < 0.5 else rv
            else:
                val = _lerp(lv, rv, factor)

            result[ch].append(val)

    return result


def build_resampled_point_list(resampled: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert column-oriented resampled data back to a list of point dicts."""
    bins = resampled.get("bin_count", 0)
    if bins == 0:
        return []

    channels = [
        "normalized_track_position",
        "cumulative_distance",
        "speed_kmh",
        "throttle",
        "brake",
        "steering",
        "gear",
        "rpm",
        "gforce_lat",
        "world_position_x",
        "world_position_y",
        "world_position_z",
        "lap_time",
    ]

    points = []
    for b in range(bins):
        point = {ch: resampled[ch][b] for ch in channels}
        points.append(point)
    return points
