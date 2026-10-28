import pytest
from datetime import datetime, time
import pytz

from app.services.market_hours_service import (
    resolve_market,
    DEFAULT_MARKET_HOURS,
    is_market_open_now,
)
from app.utils.time_utils import IST


def test_resolve_market():
    assert resolve_market("NSE", "NSE_EQUITY") == "NSE"
    assert resolve_market("NFO", "NSE_FUTURE") == "NSE"
    assert resolve_market("BSE", "BSE_EQUITY") == "BSE"
    assert resolve_market("BFO", "BSE_OPTION_BUY") == "BSE"
    assert resolve_market("MCX", "MCX_FUTURE") == "MCX"
    assert resolve_market("MCX", "COMMODITIES") == "MCX"
    assert resolve_market("CDS", "FOREX") == "FOREX"
    assert resolve_market("FOREX", "STOCKS") == "FOREX"
    assert resolve_market("CRYPTO", "CRYPTO_SPOT") == "CRYPTO"
    assert resolve_market("BINANCE", "CRYPTO_FUTURE") == "CRYPTO"


@pytest.mark.asyncio
async def test_is_market_open_now_nse():
    # Wednesday 11:00 AM IST (open)
    dt_open = datetime(2026, 10, 28, 11, 0, 0, tzinfo=IST)
    is_open, msg, _ = await is_market_open_now("NSE", "NSE_EQUITY", at=dt_open)
    assert is_open is True

    # Wednesday 08:30 AM IST (before 09:15 open)
    dt_early = datetime(2026, 10, 28, 8, 30, 0, tzinfo=IST)
    is_open, msg, _ = await is_market_open_now("NSE", "NSE_EQUITY", at=dt_early)
    assert is_open is False
    assert "09:15" in msg

    # Wednesday 16:30 PM IST (after 15:30 close)
    dt_late = datetime(2026, 10, 28, 16, 30, 0, tzinfo=IST)
    is_open, msg, _ = await is_market_open_now("NSE", "NSE_EQUITY", at=dt_late)
    assert is_open is False
    assert "15:30" in msg

    # Sunday (weekend closed)
    dt_sun = datetime(2026, 10, 25, 11, 0, 0, tzinfo=IST)
    is_open, msg, _ = await is_market_open_now("NSE", "NSE_EQUITY", at=dt_sun)
    assert is_open is False
    assert "Sunday" in msg


@pytest.mark.asyncio
async def test_is_market_open_now_mcx():
    # Wednesday 20:00 PM IST (evening session open)
    dt_eve = datetime(2026, 10, 28, 20, 0, 0, tzinfo=IST)
    is_open, msg, _ = await is_market_open_now("MCX", "MCX_FUTURE", at=dt_eve)
    assert is_open is True

    # Wednesday 23:45 PM IST (after 23:30 close)
    dt_closed = datetime(2026, 10, 28, 23, 45, 0, tzinfo=IST)
    is_open, msg, _ = await is_market_open_now("MCX", "MCX_FUTURE", at=dt_closed)
    assert is_open is False
    assert "23:30" in msg
