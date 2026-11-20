"""20 Nov, U4Z84N: a GBPUSD BUY seen at 1.31152 (ask 1.31151) booked at 1.3100
— every price went through the 2-dp money rounding. A price keeps the feed's
decimals (to 6 dp); money amounts stay at 2 dp."""

from __future__ import annotations

import secrets
from decimal import Decimal
from unittest.mock import patch

import pytest_asyncio
from beanie import init_beanie
from bson import Decimal128
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.core.database import _document_models
from app.models._base import Exchange, OrderAction, OrderType, ProductType
from app.models.order import InstrumentRef, Order
from app.models.position import Position, PositionStatus
from app.models.user import User, UserRole, UserStatus
from app.models.wallet import Wallet
from app.services import market_data_service, matching_engine
from tests._real_fill import market, settle_weekly

_DB = f"{settings.MONGODB_DB_NAME}_test_feed_price_precision"

GBPUSD = InstrumentRef(token="TFX1", symbol="GBPUSD", exchange=Exchange.CDS, segment="FOREX", lot_size=1)


@pytest_asyncio.fixture
async def client():
    mongo = AsyncIOMotorClient(settings.MONGODB_URL, tz_aware=True)
    await mongo.drop_database(_DB)
    await init_beanie(database=mongo[_DB], document_models=_document_models(), skip_indexes=True)
    u = User(
        user_code="FXP1",
        email="fxp1@example.com",
        mobile="9500099101",
        full_name="FXP1",
        password_hash="x",
        role=UserRole.CLIENT,
        status=UserStatus.ACTIVE,
    )
    await u.insert()
    await Wallet(user_id=u.id, available_balance=Decimal128("10000000")).insert()
    try:
        yield u
    finally:
        await mongo.drop_database(_DB)
        mongo.close()


async def test_get_ltp_keeps_the_feed_decimals():
    async def quote(_token):
        return {"ltp": 1.311515}

    with patch.object(market_data_service, "get_quote", quote):
        assert await market_data_service.get_ltp("TFX1") == Decimal("1.311515")


async def test_a_forex_buy_books_the_ask_it_was_placed_at(client):
    order = Order(
        order_number=f"FX{secrets.token_hex(6)}",
        user_id=client.id,
        instrument=GBPUSD,
        action=OrderAction.BUY,
        order_type=OrderType.MARKET,
        product_type=ProductType.NRML,
        lots=1,
        quantity=200000,
        pending_quantity=200000,
        placed_by=client.id,
    )
    await order.insert()

    async def quote(_token):
        return {"ltp": 1.31146, "bid": 1.31141, "ask": 1.31151}

    with patch.object(market_data_service, "get_quote", quote):
        trade = await matching_engine.execute_market_order(
            order, cached_ltp=Decimal("1.31146"), expected_price=Decimal("1.31152")
        )
    assert Decimal(str(trade.price)) == Decimal("1.31152")
    pos = await Position.find_one(Position.user_id == client.id)
    assert Decimal(str(pos.avg_price)) == Decimal("1.31152")


async def test_a_weekly_settlement_reopens_at_the_full_price(client, monkeypatch):
    await market(client, "BUY", 1000, "1.31152", instrument=GBPUSD, product=ProductType.NRML)
    await settle_weekly(client, monkeypatch, "1.312514")
    reopened = await Position.find_one(Position.user_id == client.id, Position.status == PositionStatus.OPEN)
    assert Decimal(str(reopened.avg_price)) == Decimal("1.312514")
