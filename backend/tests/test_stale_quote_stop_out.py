"""17 Nov, V5HMK3: a short GOLD option opened at 1786 was stopped out at
2305.50 — a tick left in memory since noon, read by the risk loop the moment
the token was re-subscribed, while the live book stood at 1787 / 1795.5.

- A quote from before a position opened is no price for its token; a quiet
  contract's quote that printed after the open still stands.
- A stop-out books at the live close side, not at a mark >1% away from it;
  an SL / TP fire, and a parked LIMIT / SL exit, still book the user's own
  price exactly.
"""

from __future__ import annotations

import secrets
from datetime import datetime
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
from app.models.user import User, UserRole, UserStatus
from app.models.wallet import Wallet
from app.services import market_data_service, matching_engine
from app.utils.time_utils import epoch
from tests._real_fill import market

_DB = f"{settings.MONGODB_DB_NAME}_test_stale_quote_stop_out"

GOLD_CE = InstrumentRef(
    token="TSQ1",
    symbol="GOLD26NOV135000CE",
    exchange=Exchange.MCX,
    segment="MCX_OPTION",
    lot_size=100,
)


def test_a_quote_from_before_the_open_is_no_price():
    at = lambda hhmm: epoch(datetime.fromisoformat(f"2026-11-17T{hhmm}:00+05:30"))  # noqa: E731
    ltp = {
        "noon": Decimal("2305.5"),
        "live": Decimal("1785"),
        "quiet": Decimal("412"),
        "untimed": Decimal("64644"),
    }
    quotes = {
        "noon": {"ltp": 2305.5, "ask": 2305.5, "exchange_timestamp": at("12:00")},
        "live": {"ltp": 1785, "ask": 1795.5, "exchange_timestamp": at("20:48") + 57},
        "quiet": {"ltp": 412, "exchange_timestamp": at("20:30")},  # no print for 18 min, opened 19:00
        "untimed": {"ltp": 64644},  # no exchange packet time: nothing to judge by
    }
    opened = {"noon": at("20:48"), "live": at("20:48"), "quiet": at("19:00"), "untimed": at("20:48")}
    assert market_data_service.drop_quotes_predating(ltp, quotes, opened) == ["noon"]
    assert ltp == {
        "noon": None,
        "live": Decimal("1785"),
        "quiet": Decimal("412"),
        "untimed": Decimal("64644"),
    }
    assert quotes["noon"] == {} and quotes["live"]["ask"] == 1795.5 and quotes["quiet"] and quotes["untimed"]


@pytest_asyncio.fixture
async def client():
    mongo = AsyncIOMotorClient(settings.MONGODB_URL, tz_aware=True)
    await mongo.drop_database(_DB)
    await init_beanie(database=mongo[_DB], document_models=_document_models(), skip_indexes=True)
    u = User(
        user_code="SQSO1",
        email="sqso1@example.com",
        mobile="9500099001",
        full_name="SQSO1",
        password_hash="x",
        role=UserRole.CLIENT,
        status=UserStatus.ACTIVE,
    )
    await u.insert()
    await Wallet(user_id=u.id, available_balance=Decimal128("100000")).insert()
    try:
        yield u
    finally:
        await mongo.drop_database(_DB)
        mongo.close()


async def _forced_buy(
    user: User, reason: str | None, mark: str, order_type: OrderType = OrderType.MARKET
) -> Decimal:
    """A forced close of the short: BUY 100 at `mark`, the live book
    1787 / 1795.5."""
    order = Order(
        order_number=f"SQ{secrets.token_hex(6)}",
        user_id=user.id,
        instrument=GOLD_CE,
        action=OrderAction.BUY,
        order_type=order_type,
        product_type=ProductType.MIS,
        lots=1,
        quantity=100,
        pending_quantity=100,
        placed_by=user.id,
        is_squareoff=True,
        close_reason=reason,
    )
    await order.insert()

    async def book(_token):
        return {"ltp": 1785, "bid": 1787, "ask": 1795.5}

    with patch.object(market_data_service, "get_quote", book):
        trade = await matching_engine.execute_market_order(
            order, cached_ltp=Decimal("1785"), expected_price=Decimal(mark)
        )
    return Decimal(str(trade.price))


async def test_a_stop_out_books_the_live_ask_not_a_stale_mark(client):
    await market(client, "SELL", 100, "1786", instrument=GOLD_CE)
    assert await _forced_buy(client, "STOP_OUT", "2305.5") == Decimal("1795.5")


async def test_a_stop_out_inside_one_percent_keeps_its_mark(client):
    await market(client, "SELL", 100, "1786", instrument=GOLD_CE)
    assert await _forced_buy(client, "STOP_OUT", "1797") == Decimal("1797")


async def test_an_sl_fire_still_books_its_own_trigger(client):
    await market(client, "SELL", 100, "1786", instrument=GOLD_CE)
    assert await _forced_buy(client, "SL_HIT", "1850") == Decimal("1850")


async def test_a_parked_exit_still_books_its_own_limit(client):
    # A per-fill TP parked as a LIMIT exit (no close_reason), fired late.
    await market(client, "SELL", 100, "1786", instrument=GOLD_CE)
    assert await _forced_buy(client, None, "1850", OrderType.LIMIT) == Decimal("1850")
