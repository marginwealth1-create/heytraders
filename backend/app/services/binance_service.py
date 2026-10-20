"""Binance public market-data feeds (free, no API key).

Two instances of one feed class:

* ``binance`` — crypto SPOT (``wss://stream.binance.com``) for BTCUSDT, ETHUSDT…
  Enabled by ``BINANCE_CRYPTO_FEED``.
* ``binance_futures`` — USDⓈ-M perpetuals for the COMEX/NYMEX-style commodity
  instruments (XAUUSD → XAUUSDT, USOIL → CLUSDT…). Enabled by
  ``BINANCE_COMMODITY_FEED``. Binance splits its futures sockets by stream
  family — ``/public`` carries ``bookTicker`` only, ``/market`` carries
  ``aggTrade`` + ``ticker`` (measured: the legacy ``/stream`` URL silently
  delivers only the book) — so this instance runs one connection per route.

Same in-memory-cache shape as ``infoway_service``: ``get_tick(symbol)`` returns
the latest ``{ltp, bid, ask, change, change_pct, volume, open, high, low,
close_24h}`` keyed by the BINANCE symbol, so
``market_data_service._infoway_overlay`` merges it identically. A symbol we
don't subscribe returns ``None`` and the overlay falls through to the next
provider.

NOTE: the commodity contracts are perpetual futures — close to COMEX spot
(~0.05% basis on gold) but never identical, and they carry 8-hourly funding.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections.abc import Callable
from typing import Any

import websockets

from app.core.config import settings

logger = logging.getLogger(__name__)

_STALE_RX_TIMEOUT_SEC = 30      # no frame this long → force reconnect (half-open heal)
_RECONNECT_CAP_SEC = 60
_STABLE_CONNECTION_SEC = 30     # stayed up this long → reset backoff to fast retry
# Reject a lone tick that jumps more than this fraction vs the previous price —
# a garbage print. Mirrors infoway_service / zerodha_service spike guards.
_MAX_TICK_SPIKE_PCT = 0.5

# Platform commodity symbol → Binance USDⓈ-M perpetual. USOIL / UKOIL can't be
# derived from the name (WTI = CL, Brent = BZ); the rest are symbol + "T".
COMMODITY_CONTRACTS: dict[str, str] = {
    "XAUUSD": "XAUUSDT",
    "XAGUSD": "XAGUSDT",
    "XPTUSD": "XPTUSDT",
    "XPDUSD": "XPDUSDT",
    "USOIL": "CLUSDT",
    "WTI": "CLUSDT",
    "UKOIL": "BZUSDT",
    "BRENT": "BZUSDT",
    "NATGAS": "NATGASUSDT",
    "COPPER": "COPPERUSDT",
}

# (websocket base, stream kinds carried by that route)
Route = tuple[str, tuple[str, ...]]


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


class BinanceFeed:
    """Singleton price feed. Lives in the running backend process (leader)."""

    def __init__(
        self,
        name: str,
        routes: tuple[Route, ...],
        enabled: Callable[[], bool],
        symbols: Callable[[], list[str]],
    ) -> None:
        self._name = name
        self._routes = routes
        self._enabled = enabled
        self._symbols_fn = symbols
        self._ticks: dict[str, dict[str, Any]] = {}
        self._symbols: list[str] = []
        self._ws: dict[str, Any] = {}
        self._connected: dict[str, bool] = {}
        self._last_rx: dict[str, float] = {}
        self._stop = False
        self._tasks: list[asyncio.Task[Any]] = []

    # ── public accessors ──────────────────────────────────────────────
    def is_enabled(self) -> bool:
        return bool(self._enabled())

    @property
    def is_connected(self) -> bool:
        return bool(self._connected) and all(self._connected.values())

    def get_tick(self, symbol: str | None) -> dict[str, Any] | None:
        if not symbol:
            return None
        return self._ticks.get(symbol.upper())

    def status(self) -> dict[str, Any]:
        now = time.monotonic()
        last = max(self._last_rx.values(), default=0.0)
        return {
            "enabled": self.is_enabled(),
            "connected": self.is_connected,
            "symbols": self._symbols,
            "tick_count": len(self._ticks),
            "last_rx_age_sec": round(now - last, 1) if last else None,
        }

    # ── lifecycle ─────────────────────────────────────────────────────
    async def start(self) -> None:
        if not self.is_enabled():
            logger.info("%s_feed_skipped: disabled", self._name)
            return
        self._symbols = self._symbols_fn()
        if not self._symbols:
            logger.warning("%s_feed_no_symbols_configured", self._name)
            return
        self._stop = False
        self._tasks = [
            asyncio.create_task(self._run_loop(base, kinds), name=f"{self._name}_feed")
            for base, kinds in self._routes
        ]
        logger.info("%s_feed_started symbols=%s", self._name, ",".join(self._symbols))

    async def stop(self) -> None:
        self._stop = True
        for ws in list(self._ws.values()):
            try:
                await ws.close()
            except Exception:
                pass
        for task in self._tasks:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def _run_loop(self, base: str, kinds: tuple[str, ...]) -> None:
        backoff = 1
        while not self._stop:
            connect_started = time.monotonic()
            try:
                await self._connect_once(base, kinds)
            except asyncio.CancelledError:
                break
            except Exception as e:  # noqa: BLE001
                logger.warning("%s_ws_error route=%s: %s", self._name, base, e)
            finally:
                self._connected[base] = False
            if self._stop:
                break
            # Reset backoff only if the connection did real work before dropping.
            if time.monotonic() - connect_started >= _STABLE_CONNECTION_SEC:
                backoff = 1
            ceiling = min(backoff, _RECONNECT_CAP_SEC)
            wait = ceiling / 2 + random.uniform(0, ceiling / 2)  # full jitter
            await asyncio.sleep(wait)
            backoff = min(backoff * 2, _RECONNECT_CAP_SEC)

    async def _connect_once(self, base: str, kinds: tuple[str, ...]) -> None:
        # Combined stream, one entry per (symbol, kind) so the price moves in
        # REAL TIME (sub-second), not once a second:
        #   @aggTrade   → last traded price; fires on every trade (fast)
        #   @bookTicker → best bid/ask; fires on every top-of-book change (fast)
        #   @ticker     → 24h change% / volume / OHLC (1 s cadence — fine for
        #                 these slow-moving stats)
        # The tick_loop (0.1 s) samples the resulting in-memory quote, so clients
        # get up to ~10 fresh updates/sec while the Binance msg flood stays cheap
        # (just an in-memory dict write).
        streams = "/".join(f"{s.lower()}@{k}" for s in self._symbols for k in kinds)
        url = f"{base}?streams={streams}"
        async with websockets.connect(
            url,
            ping_interval=20,   # our client-ping keeps the link warm; lib auto-pongs Binance pings
            ping_timeout=20,
            close_timeout=5,
            max_size=2**20,
        ) as ws:
            self._ws[base] = ws
            self._connected[base] = True
            self._last_rx[base] = time.monotonic()
            logger.info(
                "%s_ws_connected route=%s symbols=%d", self._name, base, len(self._symbols)
            )
            wd = asyncio.create_task(self._watchdog(ws, base), name=f"{self._name}_watchdog")
            try:
                async for raw in ws:
                    self._last_rx[base] = time.monotonic()
                    if self._stop:
                        break
                    try:
                        msg = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
                    except Exception:
                        continue
                    self._handle(msg)
            finally:
                wd.cancel()
                try:
                    await wd
                except (asyncio.CancelledError, Exception):
                    pass

    async def _watchdog(self, ws: Any, base: str) -> None:
        # Force a reconnect if the socket goes silent (half-open) so a wedged
        # connection self-heals instead of freezing prices at last value.
        while True:
            await asyncio.sleep(10)
            if time.monotonic() - self._last_rx.get(base, 0.0) > _STALE_RX_TIMEOUT_SEC:
                logger.warning("%s_stale_rx_forcing_reconnect route=%s", self._name, base)
                try:
                    await ws.close()
                except Exception:
                    pass
                return

    def _handle(self, msg: dict[str, Any]) -> None:
        stream = msg.get("stream") if isinstance(msg, dict) else None
        data = msg.get("data") if isinstance(msg, dict) else None
        if not isinstance(data, dict) or not stream:
            return
        sym = str(data.get("s") or "").upper()
        if not sym:
            return
        t = self._ticks.setdefault(sym, {})

        if stream.endswith("@aggTrade"):
            # Real-time last traded price.
            price = _f(data.get("p"))
            if price <= 0:
                return
            prev = _f(t.get("ltp"))
            if prev > 0 and abs(price - prev) / prev > _MAX_TICK_SPIKE_PCT:
                logger.warning(
                    "%s_bad_tick_skipped sym=%s prev=%s new=%s", self._name, sym, prev, price
                )
                return
            t["ltp"] = price
            if "change" in t:
                t["close_24h"] = price - _f(t.get("change"))
        elif stream.endswith("@bookTicker"):
            # Real-time best bid/ask.
            b = _f(data.get("b"))
            a = _f(data.get("a"))
            if b > 0:
                t["bid"] = b
            if a > 0:
                t["ask"] = a
        elif stream.endswith("@ticker"):
            # 24h rolling stats (1 s cadence) — change / volume / OHLC.
            t["change"] = _f(data.get("p"))
            t["change_pct"] = _f(data.get("P"))
            t["volume"] = _f(data.get("v"))
            t["open"] = _f(data.get("o"))
            t["high"] = _f(data.get("h"))
            t["low"] = _f(data.get("l"))
            # Seed ltp from the ticker's close if no @aggTrade has arrived yet,
            # so the overlay has a price to show from the very first frame.
            c = _f(data.get("c"))
            if c > 0 and not t.get("ltp"):
                t["ltp"] = c
            if t.get("ltp"):
                t["close_24h"] = _f(t.get("ltp")) - _f(t.get("change"))
        else:
            return
        t["ts"] = time.time()


def _spot_symbols() -> list[str]:
    raw = (getattr(settings, "BINANCE_CRYPTO_SYMBOLS", "") or "").strip()
    if not raw:
        # Fall back to the crypto list Infoway already uses — same Binance
        # USDT-pair names (BTCUSDT, ETHUSDT…), so no extra config needed.
        raw = getattr(settings, "INFOWAY_DEFAULT_CRYPTO", "") or ""
    return list(dict.fromkeys(s.strip().upper() for s in raw.split(",") if s.strip()))


binance = BinanceFeed(
    name="binance",
    routes=(("wss://stream.binance.com:9443/stream", ("aggTrade", "bookTicker", "ticker")),),
    enabled=lambda: bool(getattr(settings, "BINANCE_CRYPTO_FEED", False)),
    symbols=_spot_symbols,
)

binance_futures = BinanceFeed(
    name="binance_futures",
    routes=(
        ("wss://fstream.binance.com/public/stream", ("bookTicker",)),
        ("wss://fstream.binance.com/market/stream", ("aggTrade", "ticker")),
    ),
    enabled=lambda: bool(getattr(settings, "BINANCE_COMMODITY_FEED", False)),
    symbols=lambda: sorted(set(COMMODITY_CONTRACTS.values())),
)
