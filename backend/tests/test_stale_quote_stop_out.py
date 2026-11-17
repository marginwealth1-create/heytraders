"""17 Nov, V5HMK3: a short GOLD option opened at 1786 was stopped out at
2305.50 — a tick left in memory since noon, read by the risk loop the moment
the token was re-subscribed, while the live book stood at 1787 / 1795.5.

- A quote from before a position opened is no price for its token; a quiet
  contract's quote that printed after the open still stands.
- A stop-out books at the live close side, not at a mark >1% away from it;
  an SL / TP fire, and a parked LIMIT / SL exit, still book the user's own
  price exactly.
- With no live price at all an entry is refused (and the feed asked for the
  token), not booked at the client's price; an exit still goes through.
- An entry's SL / TP legs are checked against its actual fill.
- An unsubscribed token keeps no last tick; the WS pool and a watchlist
  removal leave a held / parked token streaming.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
import pytest_asyncio
from beanie import init_beanie
from bson import Decimal128
from motor.motor_asyncio import AsyncIOMotorClient

from app.api.v1.user import marketwatch
from app.core.config import settings
from app.core.database import _document_models
from app.core.exceptions import OrderRejectedError
from app.models._base import Exchange, InstrumentType, OrderAction, OrderType, ProductType
from app.models.instrument import Instrument
from app.models.order import InstrumentRef, Order, OrderStatus
from app.models.position import Position, PositionStatus
from app.models.trade import Trade
from app.models.user import User, UserRole, UserStatus
from app.models.wallet import Wallet
from app.services import market_data_service, matching_engine, order_service
from app.services.zerodha_service import zerodha
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


LIVE = {"ltp": 1785, "bid": 1787, "ask": 1795.5}


async def _forced_buy(
    user: User,
    reason: str | None,
    mark: str,
    order_type: OrderType = OrderType.MARKET,
    *,
    book: dict = LIVE,
    squareoff: bool = True,
) -> Decimal:
    """BUY 100 at `mark` — by default a forced close of the short, the live
    book 1787 / 1795.5."""
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
        is_squareoff=squareoff,
        close_reason=reason,
    )
    await order.insert()

    async def quote(_token):
        return book

    with patch.object(market_data_service, "get_quote", quote):
        trade = await matching_engine.execute_market_order(
            order, cached_ltp=Decimal(str(book.get("ltp", 0))), expected_price=Decimal(mark)
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


@pytest.fixture
def feed(monkeypatch):
    """What the feed was asked to stream."""
    asked: list = []
    monkeypatch.setattr(market_data_service, "subscribe", asked.extend)
    return asked


async def test_an_entry_with_no_live_price_is_refused(client, feed):
    with pytest.raises(OrderRejectedError) as e:
        await _forced_buy(client, None, "1786", book={}, squareoff=False)
    assert e.value.code == "STALE_FEED"
    assert feed == ["TSQ1"]
    assert not await Position.find_one(Position.user_id == client.id)


async def test_an_exit_with_no_live_price_still_books(client):
    await market(client, "SELL", 100, "1786", instrument=GOLD_CE)
    assert await _forced_buy(client, "STOP_OUT", "1790", book={}) == Decimal("1790")


async def test_a_held_or_parked_token_stays_subscribed(client):
    dropped: list = []

    async def unsubscribe(tokens):
        dropped.extend(tokens)

    with patch.object(zerodha, "unsubscribe_tokens_on_demand", unsubscribe):
        await Position(
            user_id=client.id,
            instrument=GOLD_CE.model_copy(update={"token": "101"}),
            segment_type="MCX_OPTION",
            product_type="MIS",
            quantity=-100,
            status=PositionStatus.OPEN,
        ).insert()
        await Order(
            order_number="SQPARK",
            user_id=client.id,
            instrument=GOLD_CE.model_copy(update={"token": "102"}),
            action=OrderAction.BUY,
            order_type=OrderType.SL_M,
            product_type=ProductType.MIS,
            lots=1,
            quantity=100,
            pending_quantity=100,
            placed_by=client.id,
            status=OrderStatus.OPEN,
        ).insert()
        for token in ("101", "102", "103"):
            await marketwatch._zerodha_unsubscribe_if_orphan(token)
    assert dropped == [103]


async def test_an_entry_leg_on_the_wrong_side_of_its_fill_is_refused(client):
    # Screen 2000 passed the placement guard for an SL at 1850; the cap fills
    # at the 1795.5 ask, and the 1787 bid the risk loop marks a long at is
    # already through that SL.
    order = Order(
        order_number="SQLEG",
        user_id=client.id,
        instrument=GOLD_CE,
        action=OrderAction.BUY,
        order_type=OrderType.MARKET,
        product_type=ProductType.MIS,
        lots=1,
        quantity=100,
        pending_quantity=100,
        placed_by=client.id,
        bracket_stop_loss=Decimal128("1850"),
    )
    await order.insert()

    async def quote(_token):
        return LIVE

    with patch.object(market_data_service, "get_quote", quote), pytest.raises(OrderRejectedError) as e:
        await matching_engine.execute_market_order(
            order, cached_ltp=Decimal("1785"), expected_price=Decimal("2000")
        )
    assert e.value.code == "BRACKET_WRONG_SIDE"
    assert not await Trade.find_one(Trade.order_id == order.id)


def test_an_unsubscribed_token_keeps_no_last_tick():
    tick = {"token": 987, "symbol": "TSQTICK", "ltp": 2305.5, "exchange_timestamp": 1}
    zerodha.ticks_by_token[987] = tick
    zerodha.ticks_by_symbol["TSQTICK"] = tick
    zerodha._ws_unsubscribe([987])
    assert 987 not in zerodha.ticks_by_token and "TSQTICK" not in zerodha.ticks_by_symbol


def test_the_ws_pool_keeps_what_positions_and_orders_hold(feed):
    market_data_service.hold_tokens("risk", {"555", "TSQ1"})
    market_data_service.hold_tokens("pending_orders", {"556"})
    try:
        assert {555, 556} <= zerodha._protected_now()
    finally:
        market_data_service._held.pop("risk", None)
        market_data_service._held.pop("pending_orders", None)


async def test_a_parked_entry_legs_check_against_its_own_limit(client, monkeypatch):
    # LTP 100: a BUY LIMIT 90 with SL 95 passed the LTP check, then filled at
    # 90 with its SL already through the book.
    inst = Instrument(
        token="TSQ2",
        symbol="TSQLEG",
        trading_symbol="TSQLEG",
        name="TSQLEG",
        exchange=Exchange.NSE,
        segment="NSE_EQUITY",
        instrument_type=InstrumentType.EQ,
    )

    async def get_by_token(_token):
        return inst

    async def ltp(_token):
        return Decimal("100")

    monkeypatch.setattr(order_service.instrument_service, "get_by_token", get_by_token)
    monkeypatch.setattr(market_data_service, "get_ltp", ltp)
    order = {"token": "TSQ2", "action": "BUY", "product_type": "MIS", "lots": 1}
    with pytest.raises(OrderRejectedError) as e:
        await order_service.place_order(
            user=client, payload={**order, "order_type": "LIMIT", "price": 90, "stop_loss": 95}
        )
    assert e.value.code == "BRACKET_WRONG_SIDE"
    with pytest.raises(OrderRejectedError) as e:  # a stop-buy: its TP below the trigger
        await order_service.place_order(
            user=client, payload={**order, "order_type": "SL_M", "trigger_price": 110, "target": 105}
        )
    assert e.value.code == "BRACKET_WRONG_SIDE"
