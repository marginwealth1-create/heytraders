"""Commodities (XAUUSD, USOIL…) priced from Binance USDⓈ-M perpetuals.

    pytest -q backend/tests/test_binance_commodity_feed.py
"""

from __future__ import annotations

import asyncio

from app.core.config import settings
from app.services import binance_service as bs
from app.services import market_data_service as mds


def test_contract_map_has_the_renames_nobody_guesses():
    assert bs.COMMODITY_CONTRACTS["XAUUSD"] == "XAUUSDT"
    assert bs.COMMODITY_CONTRACTS["USOIL"] == "CLUSDT"
    assert bs.COMMODITY_CONTRACTS["UKOIL"] == "BZUSDT"


def test_futures_routes_split_book_from_trades():
    # Measured 2026-10-20: fstream's /public route carries bookTicker only and
    # /market carries aggTrade + ticker; the legacy /stream URL silently
    # delivers just the book, which left gold with bid/ask but no last price.
    routes = dict(bs.binance_futures._routes)
    assert routes["wss://fstream.binance.com/public/stream"] == ("bookTicker",)
    assert routes["wss://fstream.binance.com/market/stream"] == ("aggTrade", "ticker")


def test_overlay_prices_gold_from_the_perpetual(monkeypatch):
    feed = bs.BinanceFeed("t", (), enabled=lambda: True, symbols=lambda: ["XAUUSDT"])
    feed._handle({"stream": "xauusdt@ticker", "data": {"s": "XAUUSDT", "c": "4142.0", "p": "-13.4", "P": "-0.32"}})
    feed._handle({"stream": "xauusdt@bookTicker", "data": {"s": "XAUUSDT", "b": "4142.97", "a": "4142.98"}})
    feed._handle({"stream": "xauusdt@aggTrade", "data": {"s": "XAUUSDT", "p": "4142.97"}})

    monkeypatch.setattr(bs, "binance_futures", feed)
    monkeypatch.setattr(settings, "BINANCE_CRYPTO_FEED", False)

    async def _sym(_token):
        return "XAUUSD"

    monkeypatch.setattr(mds, "_resolve_symbol", _sym)
    monkeypatch.setattr(mds, "get_usd_inr_rate", lambda: 85.0)

    q = asyncio.run(mds._infoway_overlay("XAUUSD", {"ltp": 0, "bid": 0, "ask": 0}))
    assert q["source"] == "binance_futures"
    assert q["ltp"] == 4142.97
    assert (q["bid"], q["ask"]) == (4142.97, 4142.98)
    assert q["change_pct"] == -0.32


class _FakeMetaApi:
    def __init__(self, ticks):
        self.ticks = ticks

    def is_enabled(self):
        return True

    def get_tick(self, sym):
        return self.ticks.get(sym)


def test_metaapi_spot_beats_the_perpetual_and_binance_is_the_fallback(monkeypatch):
    from app.services import metaapi_service

    perp = bs.BinanceFeed("t", (), enabled=lambda: True, symbols=lambda: ["XAUUSDT"])
    perp._handle({"stream": "xauusdt@aggTrade", "data": {"s": "XAUUSDT", "p": "4150.10"}})
    monkeypatch.setattr(bs, "binance_futures", perp)
    monkeypatch.setattr(settings, "BINANCE_CRYPTO_FEED", False)

    async def _sym(_token):
        return "XAUUSD"

    monkeypatch.setattr(mds, "_resolve_symbol", _sym)
    monkeypatch.setattr(mds, "get_usd_inr_rate", lambda: 85.0)

    spot = {"XAUUSD": {"ltp": 4136.50, "bid": 4136.40, "ask": 4136.60}}
    monkeypatch.setattr(metaapi_service, "metaapi", _FakeMetaApi(spot))
    q = asyncio.run(mds._infoway_overlay("XAUUSD", {"ltp": 0, "bid": 0, "ask": 0}))
    assert (q["source"], q["ltp"]) == ("metaapi", 4136.50)

    monkeypatch.setattr(metaapi_service, "metaapi", _FakeMetaApi({}))  # not streamed
    q = asyncio.run(mds._infoway_overlay("XAUUSD", {"ltp": 0, "bid": 0, "ask": 0}))
    assert (q["source"], q["ltp"]) == ("binance_futures", 4150.10)
