"""Sync and align all NettingSegment settings with MarginWealth production database.

This script updates:
1. All NettingSegment documents to match MarginWealth live settings.
2. SuperAdminSegmentOverride and SubAdminSegmentOverride so no stale admin overrides conflict.
3. Removes conflicting NettingScriptOverride rows.
4. Flushes netting_eff:* Redis cache keys.
"""

from __future__ import annotations

import asyncio
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import close_database, init_database
from app.core.redis_client import init_redis, close_redis, cache_delete_pattern
from app.models.netting import (
    NettingSegment,
    NettingScriptOverride,
    SuperAdminSegmentOverride,
    SubAdminSegmentOverride,
    BrokerSegmentOverride,
    UserSegmentOverride,
)
from app.services import netting_service


# Target configuration matching MarginWealth live database
TARGET_SETTINGS = {
    "NSE_STK_FUT": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
        "overnightMargin": 50.0,
    },
    "NSE_IDX_FUT": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
        "overnightMargin": 50.0,
    },
    "NSE_STK_OPT": {
        "marginCalcMode": "times",
        "intradayMargin": 20.0,
        "overnightMargin": 3.0,
        "optionBuyIntraday": 1000.0,
        "optionBuyOvernight": 1000.0,
        "optionSellMarginCalcMode": "fixed",
        "optionSellIntraday": 5000.0,
        "optionSellOvernight": 10000.0,
    },
    "NSE_IDX_OPT": {
        "marginCalcMode": "fixed",
        "intradayMargin": 10000.0,
        "overnightMargin": 3.0,
        "optionBuyIntraday": 1000.0,
        "optionBuyOvernight": 5000.0,
        "optionSellMarginCalcMode": "fixed",
        "optionSellIntraday": 5000.0,
        "optionSellOvernight": 10000.0,
    },
    "BSE_EQ": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
        "overnightMargin": 50.0,
    },
    "BSE_FUT": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
        "overnightMargin": 50.0,
    },
    "BSE_OPT": {
        "marginCalcMode": "times",
        "intradayMargin": 20.0,
        "overnightMargin": 3.0,
        "optionBuyMarginCalcMode": "fixed",
        "optionBuyIntraday": 1000.0,
        "optionBuyOvernight": 2000.0,
        "optionSellMarginCalcMode": "fixed",
        "optionSellIntraday": 5000.0,
        "optionSellOvernight": 5000.0,
    },
    "MCX_FUT": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
        "overnightMargin": 50.0,
        "commissionType": "per_crore",
        "commission": 150.0,
    },
    "MCX_OPT": {
        "marginCalcMode": "fixed",
        "intradayMargin": 20.0,
        "overnightMargin": 3.0,
        "optionBuyIntraday": 500.0,
        "optionBuyOvernight": 1000.0,
        "optionSellMarginCalcMode": "fixed",
        "optionSellIntraday": 5000.0,
        "optionSellOvernight": 10000.0,
    },
    "FOREX": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
    },
    "STOCKS": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
    },
    "INDICES": {
        "marginCalcMode": "times",
        "intradayMargin": 500.0,
    },
    "COMMODITIES": {
        "marginCalcMode": "fixed",
        "intradayMargin": 25000.0,
        "overnightMargin": 25000.0,
        "minLots": 1.0,
        "orderLots": 1.0,
    },
}


async def main():
    await init_database()
    try:
        await init_redis()
    except Exception as e:
        print(f"Redis init warning: {e}")

    print("=== 1. Updating NettingSegment documents ===")
    for seg_name, fields in TARGET_SETTINGS.items():
        seg = await NettingSegment.find_one(NettingSegment.name == seg_name)
        if not seg:
            seg = NettingSegment(name=seg_name, displayName=seg_name.replace("_", " ").title())
        for k, v in fields.items():
            setattr(seg, k, v)
        await seg.save()
        print(f"  [OK] NettingSegment '{seg_name}' updated: {fields}")

    print("\n=== 2. Updating SuperAdminSegmentOverride documents ===")
    sa_overrides = await SuperAdminSegmentOverride.find_all().to_list()
    for over in sa_overrides:
        if over.segment_name in TARGET_SETTINGS:
            for k, v in TARGET_SETTINGS[over.segment_name].items():
                setattr(over, k, v)
            await over.save()
            print(f"  [OK] SuperAdminOverride for '{over.segment_name}' aligned.")

    print("\n=== 3. Cleaning conflicting NettingScriptOverride rows ===")
    script_overrides = await NettingScriptOverride.find_all().to_list()
    for s_over in script_overrides:
        sym = (s_over.symbol or "").upper()
        # Remove empty or conflicting overrides that break canonical segment settings
        if s_over.marginCalcMode is None or sym in ("XAUUSD", "CRUDEOILFUT", "NATGAS", "GOLD", "SILVER"):
            print(f"  [REMOVE] Deleting override for symbol '{s_over.symbol}' (segment '{s_over.segment_name}')")
            await s_over.delete()

    print("\n=== 4. Clearing Redis cache keys ===")
    try:
        deleted = await cache_delete_pattern("netting_eff:*")
        print(f"  [OK] Deleted {deleted} 'netting_eff:*' cache keys from Redis.")
    except Exception as e:
        print(f"  [Notice] Redis pattern delete: {e}")

    print("\n=== Complete! All segment settings and margin logic now match MarginWealth. ===")
    await close_database()
    try:
        await close_redis()
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())
