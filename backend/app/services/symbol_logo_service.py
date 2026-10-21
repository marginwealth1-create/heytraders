"""Instrument logos, proxied from public symbol-logo CDNs and cached on disk.

No exchange or broker API publishes logos, so we resolve each symbol to a logo
on one of two CDNs and serve it from our own origin (``GET /api/v1/logo/{sym}``):

* Dhan's CDN, keyed directly by NSE symbol — Indian stocks.
* TradingView's CDN, keyed by a "logoid". Indices, commodities, forex (base
  currency flag) and crypto are deterministic maps below; Indian stocks Dhan
  lacks and US stocks resolve through TradingView's symbol search, taking ONLY
  an exact symbol match — a fuzzy hit for a renamed ticker is a different
  company, and a confidently wrong logo is worse than initials.

Derivatives show their underlying's logo (NIFTY26OCT24500CE → NIFTY).

Cache: ``SYMBOL_LOGO_DIR`` (outside the public /uploads mount — an SVG served
without our CSP headers could run script). Writes go to ``.partial`` then an
atomic rename; misses leave a ``.missing`` marker honoured for 24 h so a page
of unknown names doesn't re-hit both vendors on every render.
"""
from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

SYMBOL_RE = re.compile(r"^[A-Z0-9&_-]{1,24}$")
_MAX_SVG_BYTES = 200_000
_MISS_TTL_SEC = 86_400

_DHAN_URL = "https://s3tv-symbol.dhan.co/symbols/{}.svg"
_TV_LOGO_URL = "https://s3-symbol-logo.tradingview.com/{}.svg"
_TV_SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ),
    "Accept": "image/svg+xml,*/*;q=0.8",
}

# Indices are not companies: a stock CDN has nothing for them, or a stock that
# shares the name. Keys are the symbol with spaces/underscores removed, so
# "NIFTY 50" (sent as NIFTY_50), "NIFTY50" and "NIFTY" all land here.
_INDEX_LOGOS: dict[str, str] = {
    "NIFTY": "indices/nifty-50",
    "NIFTY50": "indices/nifty-50",
    "BANKNIFTY": "indices/nifty-bank-index",
    "NIFTYBANK": "indices/nifty-bank-index",
    "FINNIFTY": "indices/nifty-financial-services-index",
    "NIFTYFINSERVICE": "indices/nifty-financial-services-index",
    "MIDCPNIFTY": "indices/nifty-midcap",
    "NIFTYMIDSELECT": "indices/nifty-midcap",
    "NIFTYNXT50": "indices/nifty-next-50-index",
    "NIFTYNEXT50": "indices/nifty-next-50-index",
    "NIFTYIT": "indices/nifty-it-index",
    "NIFTY500": "indices/nifty-500",
    "INDIAVIX": "indices/india-vix",
    "SENSEX": "indices/bse-sensex",
    "BSESENSEX": "indices/bse-sensex",
    "BANKEX": "sector/financial",
    "SPX500": "indices/s-and-p-500",
    "NAS100": "indices/nasdaq-100",
    "US30": "indices/dow-30",
    "UK100": "indices/uk-100",
    "DE40": "indices/dax",
    "JPN225": "indices/nikkei-225",
    "HK50": "indices/hang-seng",
}

# Spot metals / energy and the MCX contracts on the same commodity.
_COMMODITY_LOGOS: dict[str, str] = {
    **dict.fromkeys(("XAUUSD", "GOLD", "GOLDM", "GOLDGUINEA", "GOLDPETAL", "GOLDTEN"), "metal/gold"),
    **dict.fromkeys(("XAGUSD", "SILVER", "SILVERM", "SILVERMIC"), "metal/silver"),
    "XPTUSD": "metal/platinum",
    "XPDUSD": "metal/palladium",
    **dict.fromkeys(("USOIL", "UKOIL", "WTI", "BRENT", "CRUDEOIL", "CRUDEOILM"), "crude-oil"),
    **dict.fromkeys(("NATGAS", "NATURALGAS", "NATGASMINI"), "natural-gas"),
    **dict.fromkeys(("COPPER", "COPPERM"), "metal/copper"),
    **dict.fromkeys(("ZINC", "ZINCMINI"), "metal/zinc"),
    **dict.fromkeys(("LEAD", "LEADMINI"), "metal/lead"),
    **dict.fromkeys(("ALUMINIUM", "ALUMINI"), "metal/aluminum"),
    "MENTHAOIL": "menthol-oil",
}

# Forex pairs show their base currency's flag.
_CURRENCY_FLAGS: dict[str, str] = {
    "EUR": "EU", "USD": "US", "GBP": "GB", "JPY": "JP", "AUD": "AU", "CAD": "CA",
    "CHF": "CH", "NZD": "NZ", "INR": "IN", "CNH": "CN", "CNY": "CN", "SGD": "SG",
    "HKD": "HK", "ZAR": "ZA", "SEK": "SE", "NOK": "NO", "MXN": "MX", "TRY": "TR",
}

_US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "CBOE"}

# Zerodha-style derivative tradingsymbols: UNDERLYING + YY + (MON | weekly
# M-DD) + (FUT | STRIKE + CE/PE). NIFTY26OCTFUT, NIFTY26O0622600CE,
# 360ONE26OCTFUT, M&M26OCT3500CE.
_DERIV_RE = re.compile(
    r"^(?P<und>[A-Z0-9&-]+?)\d{2}"
    r"(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|[1-9OND]\d{2})"
    r"(?:FUT|\d+(?:CE|PE))$"
)

_SVG_ROOT_RE = re.compile(
    r"^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--.*?-->\s*)*<svg[\s>]", re.IGNORECASE | re.DOTALL
)
_SVG_DANGER_RE = re.compile(
    r"<script|javascript:|\bon[a-z]+\s*=|<foreignobject|<iframe|<embed|<object|<!doctype|<!entity",
    re.IGNORECASE,
)


def valid_symbol(symbol: str) -> bool:
    """Path-traversal guard — must pass before the symbol touches a path."""
    return bool(SYMBOL_RE.fullmatch(symbol or ""))


def underlying_of(symbol: str) -> str:
    m = _DERIV_RE.fullmatch(symbol)
    return m.group("und") if m else symbol


def is_safe_svg(body: bytes) -> bool:
    """We serve these from our own origin, where an SVG's script would run
    with our privileges — so only a small, plain <svg> document passes."""
    if not body or len(body) > _MAX_SVG_BYTES:
        return False
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return bool(_SVG_ROOT_RE.match(text)) and not _SVG_DANGER_RE.search(text)


def pick_logoid(results: list[dict[str, Any]], symbol: str, exchanges: set[str]) -> str | None:
    """Logoid of the TradingView search hit whose symbol EXACTLY equals ours
    on one of `exchanges` — never the first fuzzy hit."""
    for r in results:
        sym = re.sub(r"</?em>", "", str(r.get("symbol") or "")).upper()
        if sym != symbol or str(r.get("exchange") or "").upper() not in exchanges:
            continue
        logo = r.get("logo") if isinstance(r.get("logo"), dict) else {}
        logoid = r.get("logoid") or (logo or {}).get("logoid")
        if logoid:
            return str(logoid)
    return None


def static_logoid(und: str) -> str | None:
    """Logoid for symbols whose logo is fixed by what they are, not who."""
    compact = und.replace("_", "")
    if compact in _INDEX_LOGOS:
        return _INDEX_LOGOS[compact]
    if "_" in und and compact.startswith("NIFTY"):
        return "source/NSE"  # any other NSE index: the exchange's own mark
    if und in _COMMODITY_LOGOS:
        return _COMMODITY_LOGOS[und]
    if len(und) == 6 and und[:3] in _CURRENCY_FLAGS and und[3:] in _CURRENCY_FLAGS:
        return f"country/{_CURRENCY_FLAGS[und[:3]]}"
    return None


# ── fetching ──────────────────────────────────────────────────────────


def _cache_dir() -> Path:
    d = Path(settings.SYMBOL_LOGO_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


async def _segment_of(symbol: str) -> str | None:
    from app.models.instrument import Instrument

    inst = await Instrument.find_one(Instrument.symbol == symbol)
    return str(inst.segment) if inst else None


async def _tv_search(client: httpx.AsyncClient, symbol: str, params: dict[str, str]) -> list[dict]:
    try:
        r = await client.get(
            _TV_SEARCH_URL,
            params={"text": symbol, "hl": "1", "lang": "en", "domain": "production", **params},
            headers={"Origin": "https://www.tradingview.com"},
        )
        data = r.json() if r.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        return []
    rows = data.get("symbols") if isinstance(data, dict) else data
    return rows if isinstance(rows, list) else []


async def _candidate_urls(client: httpx.AsyncClient, und: str) -> AsyncIterator[str]:
    """Logo URLs to try in order. Lazy, so the TradingView search only runs
    when the cheaper source already missed."""
    logoid = static_logoid(und)
    if logoid:
        yield _TV_LOGO_URL.format(logoid)
        return
    segment = (await _segment_of(und) or "").upper()
    if segment.startswith("CRYPTO") or und.endswith("USDT"):
        base = re.sub(r"(USDT|USDC|USD)$", "", und)
        yield _TV_LOGO_URL.format(f"crypto/XTVC{base}")
        return
    if segment == "STOCKS":  # US-listed
        hit = pick_logoid(await _tv_search(client, und, {"search_type": "stocks"}), und, _US_EXCHANGES)
        if hit:
            yield _TV_LOGO_URL.format(hit)
        return
    yield _DHAN_URL.format(und)  # Indian stock (or a derivative's stock underlying)
    hit = pick_logoid(
        await _tv_search(client, und, {"exchange": "NSE", "search_type": "stocks"}), und, {"NSE"}
    )
    if hit:
        yield _TV_LOGO_URL.format(hit)


async def _download(client: httpx.AsyncClient, url: str) -> bytes | None:
    try:
        r = await client.get(url)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or not is_safe_svg(r.content):
        return None
    return r.content


async def logo_svg(symbol: str) -> bytes | None:
    """SVG bytes for `symbol` (already validated), or None when there is no
    trustworthy logo. Cached on disk either way."""
    und = underlying_of(symbol)
    cache = _cache_dir()
    path, missing = cache / f"{und}.svg", cache / f"{und}.missing"
    if path.is_file():
        return path.read_bytes()
    if missing.is_file() and time.time() - missing.stat().st_mtime < _MISS_TTL_SEC:
        return None

    body: bytes | None = None
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers=_HEADERS) as client:
        async for url in _candidate_urls(client, und):
            body = await _download(client, url)
            if body:
                break
    if body is None:
        missing.touch()
        return None
    tmp = cache / f"{und}.{os.getpid()}.partial"
    tmp.write_bytes(body)
    os.replace(tmp, path)  # atomic: a concurrent reader never sees half a file
    missing.unlink(missing_ok=True)
    return body
