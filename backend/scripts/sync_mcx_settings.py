"""Diagnostic and update script for MCX FUT segment settings.
Aligns MCX FUT margin to 500x Times and brokerage to 150/Crore to match MarginWealth.
"""

from __future__ import annotations

import asyncio
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import close_database, init_database
from app.models.netting import NettingSegment, NettingScriptOverride, UserSegmentOverride
from app.services import netting_service


async def main():
    await init_database()
    print("--- 1. Checking NettingSegment for MCX_FUT ---")
    seg = await NettingSegment.find_one(NettingSegment.name == "MCX_FUT")
    if seg:
        print(f"Current MCX_FUT: marginCalcMode={seg.marginCalcMode}, intradayMargin={seg.intradayMargin}, overnightMargin={seg.overnightMargin}, commissionType={seg.commissionType}, commission={seg.commission}")
        seg.marginCalcMode = "times"
        seg.intradayMargin = 500.0
        seg.overnightMargin = 50.0
        seg.commissionType = "per_crore"
        seg.commission = 150.0
        await seg.save()
        print("Updated MCX_FUT: marginCalcMode='times', intradayMargin=500.0, overnightMargin=50.0, commissionType='per_crore', commission=150.0")
    else:
        print("MCX_FUT segment not found in netting_segments!")

    print("\n--- 2. Checking NettingScriptOverride for GOLD / MCX ---")
    script_overrides = await NettingScriptOverride.find_all().to_list()
    for o in script_overrides:
        print(f"ScriptOverride: symbol={o.symbol}, segment={o.segment_name}, marginCalcMode={o.marginCalcMode}, intradayMargin={o.intradayMargin}, commissionType={o.commissionType}, commission={o.commission}")
        if "GOLD" in o.symbol.upper() or o.segment_name == "MCX_FUT":
            print(f"Removing outdated script override for {o.symbol} so it inherits canonical 500x MCX_FUT settings...")
            await o.delete()

    print("\n--- 3. Clearing netting cache in Redis ---")
    try:
        from app.core.redis import redis_client
        if redis_client:
            keys = await redis_client.keys("netting_eff:*")
            if keys:
                await redis_client.delete(*keys)
                print(f"Deleted {len(keys)} netting_eff cache keys from Redis.")
            else:
                print("No netting_eff cache keys found in Redis.")
    except Exception as e:
        print(f"Redis cache clear notice: {e}")

    print("\nDone! Settings are now aligned with MarginWealth.")
    await close_database()


if __name__ == "__main__":
    asyncio.run(main())
