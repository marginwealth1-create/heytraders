"""Forex carries (operator 2026-11-20): its day closes at 03:30 IST, so the EOD
rollover runs for FOREX positions then, Tue-Sat; the admin's Overnight
Margin applies to it, and until a tier sets one the carry check keeps the
Intraday margin (the base row's seeded 100 would turn a 500x book into a
100x check overnight)."""

from __future__ import annotations

from datetime import date, time

import pytest_asyncio
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.api.v1.user.positions import _segment_carryable
from app.core.config import settings
from app.core.database import _document_models
from app.models.netting import SuperAdminSegmentOverride
from app.models.user import User, UserRole, UserStatus
from app.services import netting_service
from app.services.position_service import rollover_fire_at
from app.utils.time_utils import FOREX_ROLLOVER, NSE_BSE_CLOSE

_DB = f"{settings.MONGODB_DB_NAME}_test_forex_carry"
TUE, SAT, SUN, MON = date(2026, 11, 17), date(2026, 11, 21), date(2026, 11, 22), date(2026, 11, 23)


def test_forex_rolls_at_0330_tuesday_to_saturday():
    assert [rollover_fire_at("FOREX", FOREX_ROLLOVER, d) for d in (TUE, SAT, SUN, MON)] == [
        time(3, 30),
        time(3, 30),
        None,
        None,
    ]
    # The Indian groups keep their weekday close, and a Muhurat session's.
    assert rollover_fire_at("INDIAN_EQUITY_FNO", NSE_BSE_CLOSE, SAT) is None
    assert rollover_fire_at("INDIAN_EQUITY_FNO", NSE_BSE_CLOSE, TUE) == NSE_BSE_CLOSE
    assert rollover_fire_at("INDIAN_EQUITY_FNO", NSE_BSE_CLOSE, SUN, time(19, 15)) == time(19, 16)
    assert rollover_fire_at("FOREX", FOREX_ROLLOVER, SUN, time(19, 15)) is None


def test_a_forex_position_shows_its_carry_toggle():
    assert _segment_carryable("FOREX") and _segment_carryable("NFO_OPTION")
    assert not _segment_carryable("CRYPTO_SPOT") and not _segment_carryable("COMMODITIES")


@pytest_asyncio.fixture
async def sa(monkeypatch):
    client = AsyncIOMotorClient(settings.MONGODB_URL, tz_aware=True)
    await client.drop_database(_DB)
    await init_beanie(database=client[_DB], document_models=_document_models())
    monkeypatch.setattr(netting_service, "_SUPER_ADMIN_ID_CACHE", None)
    try:
        await netting_service.seed_default_segments()
        u = User(
            user_code="FXC1",
            email="fxc1@example.com",
            mobile="9500099201",
            full_name="FXC1",
            password_hash="x",
            role=UserRole.SUPER_ADMIN,
            status=UserStatus.ACTIVE,
        )
        await u.insert()
        yield u
    finally:
        await client.drop_database(_DB)
        client.close()


async def _overnight_leverage(user: User) -> float:
    out = await netting_service.get_effective_settings(
        user.id, "FOREX", action="BUY", product_type="NRML", symbol="GBPUSD"
    )
    return out["settings"]["overnight_leverage"]


async def test_forex_overnight_margin_is_the_admins_or_else_intraday(sa):
    doc = SuperAdminSegmentOverride(
        super_admin_id=sa.id, segment_name="FOREX", marginCalcMode="times", intradayMargin=500
    )
    await doc.insert()
    assert await _overnight_leverage(sa) == 500  # unset: the intraday 500x, not the seeded 100
    doc.overnightMargin = 200
    await doc.save()  # no Redis in tests: the resolver's 5-min cache is skipped
    assert await _overnight_leverage(sa) == 200
