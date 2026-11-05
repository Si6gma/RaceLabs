"""
Track nicknames: one optional display name per track_id.
"""
from typing import Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TrackAlias


class TrackAliasService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_aliases(self) -> Dict[str, str]:
        """All nicknames as {track_id: nickname}."""
        result = await self.db.execute(select(TrackAlias))
        return {row.track_id: row.nickname for row in result.scalars().all()}

    async def set_alias(self, track_id: str, nickname: str) -> Dict[str, str]:
        """Upsert the nickname for a track; an empty nickname removes it. Returns the full map."""
        existing = await self.db.get(TrackAlias, track_id)
        if not nickname:
            if existing is not None:
                await self.db.delete(existing)
        elif existing is None:
            self.db.add(TrackAlias(track_id=track_id, nickname=nickname))
        else:
            existing.nickname = nickname
        await self.db.commit()
        return await self.get_aliases()
