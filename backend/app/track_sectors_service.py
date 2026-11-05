"""
Learned track geometry: one row per track_id holding sector lines (each only ever
lowered) and DRS zones (matched by start, grown at both ends).
"""
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TrackSectors
from app.sector_bounds import Zone, merge_drs_zones

Bounds = Tuple[Optional[float], Optional[float]]
# Bumped when the DRS learner changes in a way that makes stored zones untrustworthy.
DRS_ZONES_VERSION = 2


def merge_bounds(stored: Bounds, new: Bounds) -> Bounds:
    """Per sector, the smaller of stored and new; None means unknown and never wins."""
    return (_smaller(stored[0], new[0]), _smaller(stored[1], new[1]))


def _smaller(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None:
        return b
    if b is None:
        return a
    return min(a, b)


def _row_dict(row: TrackSectors) -> Dict[str, Any]:
    return {"sectors": (row.sector1_m, row.sector2_m), "drs_zones": list(row.drs_zones or [])}


class TrackSectorsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self) -> Dict[int, Dict[str, Any]]:
        """Every stored track as {track_id: {"sectors": (s1, s2), "drs_zones": [...]}}."""
        result = await self.db.execute(select(TrackSectors))
        return {row.track_id: _row_dict(row) for row in result.scalars().all()}

    async def merge(self, track_id: int, s1: Optional[float], s2: Optional[float],
                    drs_zones: Optional[List[Zone]] = None) -> Dict[str, Any]:
        """Fold new bounds and zones into the stored row. Returns the stored values."""
        existing = await self.db.get(TrackSectors, track_id)
        if existing is None:
            existing = TrackSectors(track_id=track_id)
            self.db.add(existing)
        before = _row_dict(existing)
        merged = merge_bounds(before["sectors"], (s1, s2))
        zones = merge_drs_zones(before["drs_zones"], drs_zones or [])
        after = {"sectors": merged, "drs_zones": zones}
        if after != before:
            existing.sector1_m, existing.sector2_m = merged
            existing.drs_zones = zones
            existing.updated_at = datetime.utcnow()
        existing.drs_zones_version = DRS_ZONES_VERSION
        await self.db.commit()
        return after
