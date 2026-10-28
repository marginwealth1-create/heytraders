"""Market trading hours configuration service.

Provides market-wise (NSE, BSE, MCX, FOREX, CRYPTO) start and end time
configuration stored in PlatformSetting ("trading.market_hours").

Used by:
  - Admin Platform Settings (/settings/platform) to view and set market hours
  - User instruments/market-hours endpoint to supply hours to frontend-user
  - Order validator to verify trades at submission time
"""

from __future__ import annotations

import logging
import time as _sys_time
from datetime import datetime, time
from typing import Any

from app.models.platform_setting import PlatformSetting, SettingType
from app.utils.time_utils import IST, now_ist, parse_hhmm, to_ist

logger = logging.getLogger(__name__)

SETTING_KEY = "trading.market_hours"

DEFAULT_MARKET_HOURS: dict[str, dict[str, Any]] = {
    "NSE": {
        "name": "NSE (Equity & F&O)",
        "start_time": "09:15",
        "end_time": "15:30",
        "is_enabled": True,
        "days": [1, 2, 3, 4, 5],  # 1=Mon .. 5=Fri (0=Sun, 6=Sat)
        "description": "National Stock Exchange equity, futures, and options",
    },
    "BSE": {
        "name": "BSE (Equity & F&O)",
        "start_time": "09:15",
        "end_time": "15:30",
        "is_enabled": True,
        "days": [1, 2, 3, 4, 5],
        "description": "Bombay Stock Exchange equity, Sensex futures, and options",
    },
    "MCX": {
        "name": "MCX (Commodities)",
        "start_time": "09:00",
        "end_time": "23:30",
        "is_enabled": True,
        "days": [1, 2, 3, 4, 5],
        "description": "Multi Commodity Exchange: Gold, Silver, Crude Oil, Natural Gas",
    },
    "FOREX": {
        "name": "Forex & Global (24/5)",
        "start_time": "00:00",
        "end_time": "23:59",
        "is_enabled": True,
        "days": [1, 2, 3, 4, 5],
        "description": "Foreign exchange currencies, global indices, and commodities",
    },
    "CRYPTO": {
        "name": "Crypto (24/7)",
        "start_time": "00:00",
        "end_time": "23:59",
        "is_enabled": True,
        "days": [0, 1, 2, 3, 4, 5, 6],
        "description": "Cryptocurrency 24/7 spot and futures markets",
    },
}

# In-memory cached market hours config with TTL to prevent DB hammering
_cached_config: dict[str, dict[str, Any]] | None = None
_cache_timestamp: float = 0.0
_CACHE_TTL_SEC: float = 15.0


def resolve_market(exchange: str | None, segment: str | None) -> str:
    """Resolve an instrument's exchange and segment to a canonical market key."""
    seg = (segment or "").upper()
    ex = (exchange or "").upper()

    if "CRYPTO" in seg or ex in ("CRYPTO", "BINANCE"):
        return "CRYPTO"
    if seg.startswith("MCX") or ex == "MCX" or seg == "COMMODITIES":
        return "MCX"
    if seg.startswith(("BSE", "BFO")) or ex in ("BSE", "BFO"):
        return "BSE"
    if (
        seg in ("FOREX", "STOCKS", "INDICES")
        or "FOREX" in seg
        or "FX" in seg
        or ex == "CDS"
        or seg.startswith("CDS")
    ):
        return "FOREX"
    return "NSE"


async def get_market_hours(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    """Retrieve the current market hours configuration, merging with defaults."""
    global _cached_config, _cache_timestamp

    now = _sys_time.time()
    if not force_refresh and _cached_config is not None and (now - _cache_timestamp < _CACHE_TTL_SEC):
        return _cached_config

    try:
        setting = await PlatformSetting.find_one(PlatformSetting.setting_key == SETTING_KEY)
    except Exception as e:
        logger.warning(f"Could not load market hours from PlatformSetting: {e}")
        setting = None

    result: dict[str, dict[str, Any]] = {}
    stored_val = setting.setting_value if setting and isinstance(setting.setting_value, dict) else {}

    for market_key, default_info in DEFAULT_MARKET_HOURS.items():
        market_data = dict(default_info)
        if market_key in stored_val and isinstance(stored_val[market_key], dict):
            user_val = stored_val[market_key]
            if "start_time" in user_val and isinstance(user_val["start_time"], str):
                market_data["start_time"] = user_val["start_time"].strip()
            if "end_time" in user_val and isinstance(user_val["end_time"], str):
                market_data["end_time"] = user_val["end_time"].strip()
            if "is_enabled" in user_val:
                market_data["is_enabled"] = bool(user_val["is_enabled"])
            if "days" in user_val and isinstance(user_val["days"], list):
                market_data["days"] = [int(d) for d in user_val["days"] if isinstance(d, (int, str)) and str(d).isdigit()]
        result[market_key] = market_data

    _cached_config = result
    _cache_timestamp = now
    return result


async def update_market_hours(new_config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Update and persist market hours configuration."""
    global _cached_config, _cache_timestamp

    current = await get_market_hours(force_refresh=True)

    for market_key, updates in new_config.items():
        if market_key not in current or not isinstance(updates, dict):
            continue
        entry = current[market_key]
        if "start_time" in updates:
            st = str(updates["start_time"]).strip()
            # Validate HH:MM format
            try:
                parse_hhmm(st)
                entry["start_time"] = st
            except Exception:
                pass
        if "end_time" in updates:
            et = str(updates["end_time"]).strip()
            try:
                parse_hhmm(et)
                entry["end_time"] = et
            except Exception:
                pass
        if "is_enabled" in updates:
            entry["is_enabled"] = bool(updates["is_enabled"])
        if "days" in updates and isinstance(updates["days"], list):
            entry["days"] = [int(d) for d in updates["days"] if str(d).isdigit()]

    setting = await PlatformSetting.find_one(PlatformSetting.setting_key == SETTING_KEY)
    if setting is None:
        setting = PlatformSetting(
            setting_key=SETTING_KEY,
            setting_value=current,
            setting_type=SettingType.JSON,
            category="trading",
            is_public=True,
            description="Market-wise start and end trading hours configuration",
        )
        await setting.insert()
    else:
        setting.setting_value = current
        setting.is_public = True
        await setting.save()

    _cached_config = current
    _cache_timestamp = _sys_time.time()
    return current


async def is_market_open_now(
    exchange: str | None,
    segment: str | None,
    at: datetime | None = None,
) -> tuple[bool, str, dict[str, Any]]:
    """Check if the market for the given exchange/segment is currently open.

    Returns:
        (is_open: bool, message: str, config: dict)
    """
    ist = to_ist(at) if at else now_ist()
    market = resolve_market(exchange, segment)
    all_hours = await get_market_hours()
    m_cfg = all_hours.get(market, DEFAULT_MARKET_HOURS.get(market, DEFAULT_MARKET_HOURS["NSE"]))

    market_name = m_cfg.get("name", market)

    # 1. Master enable flag
    if not m_cfg.get("is_enabled", True):
        return False, f"{market_name} market is currently disabled by administrator.", m_cfg

    # 2. Day of week check (0=Sunday, 1=Monday, ..., 6=Saturday)
    allowed_days = m_cfg.get("days", [1, 2, 3, 4, 5])
    # Convert Python weekday (0=Mon..6=Sun) to JS/standard weekday (0=Sun..6=Sat)
    js_day = (ist.weekday() + 1) % 7
    if allowed_days and js_day not in allowed_days:
        day_name = ist.strftime("%A")
        return False, f"{market_name} market is closed today ({day_name}).", m_cfg

    # 3. Start time and end time window
    start_str = m_cfg.get("start_time", "09:15")
    end_str = m_cfg.get("end_time", "15:30")

    try:
        start_t = parse_hhmm(start_str)
        end_t = parse_hhmm(end_str)
    except Exception:
        # Fallback to standard times if parse fails
        start_t = time(9, 15)
        end_t = time(15, 30)

    cur_t = ist.time()

    if start_t <= end_t:
        # Same-day session (e.g. 09:15 to 15:30)
        if not (start_t <= cur_t <= end_t):
            return (
                False,
                f"{market_name} market is closed. Trading hours: {start_str} - {end_str} IST.",
                m_cfg,
            )
    else:
        # Overnight session (e.g. 17:00 to 02:30)
        if not (cur_t >= start_t or cur_t <= end_t):
            return (
                False,
                f"{market_name} market is closed. Trading hours: {start_str} - {end_str} IST.",
                m_cfg,
            )

    return True, "", m_cfg
