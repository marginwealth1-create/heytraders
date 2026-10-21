"""Instrument logos: symbol guard, SVG safety, exact-match search, resolution.

    pytest -q backend/tests/test_symbol_logos.py
"""

from __future__ import annotations

import pytest

from app.services.symbol_logo_service import (
    is_safe_svg,
    pick_logoid,
    static_logoid,
    underlying_of,
    valid_symbol,
)

TV_FILE = b'<!-- by TradingView --><svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path fill="#F7931A" d="M0 0h18v18H0z"/></svg>'


@pytest.mark.parametrize("sym", ["M&M", "BAJAJ-AUTO", "RELIANCE", "NIFTY_50", "360ONE26OCTFUT"])
def test_real_symbols_pass_the_guard(sym):
    assert valid_symbol(sym)


@pytest.mark.parametrize("sym", ["../etc/passwd", "..", "", "A" * 25, "AAPL.US", "NIFTY 50", "a/b"])
def test_path_traversal_and_junk_are_rejected(sym):
    assert not valid_symbol(sym)


def test_tradingview_file_with_leading_comment_is_safe():
    assert is_safe_svg(TV_FILE)
    assert is_safe_svg(b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')


@pytest.mark.parametrize(
    "body",
    [
        b'<svg><script>alert(1)</script></svg>',
        b'<svg onload="alert(1)"></svg>',
        b'<svg><a href="javascript:alert(1)"/></svg>',
        b'<svg><foreignObject><iframe/></foreignObject></svg>',
        b'<html><svg></svg></html>',
        b"",
        b"<svg>" + b" " * 200_001 + b"</svg>",
    ],
    # Explicit ids: a 200 KB auto-id lands in PYTEST_CURRENT_TEST and breaks
    # Windows' 32 KB env-var limit.
    ids=["script", "onload", "javascript", "foreignObject", "html-root", "empty", "oversized"],
)
def test_unsafe_or_oversized_svgs_are_rejected(body):
    assert not is_safe_svg(body)


def test_search_takes_only_the_exact_symbol():
    results = [
        {"symbol": "<em>RELIANCE</em>POWER", "exchange": "NSE", "logoid": "reliance-power"},
        {"symbol": "<em>RELIANCE</em>", "exchange": "NSE", "logoid": "reliance"},
    ]
    assert pick_logoid(results, "RELIANCE", {"NSE"}) == "reliance"


def test_no_exact_hit_means_no_logo():
    # A delisted ticker's fuzzy first hit is a different company.
    results = [{"symbol": "TATAMOTORS", "exchange": "NSE", "logoid": "tata-motors"}]
    assert pick_logoid(results, "TATAMTRDVR", {"NSE"}) is None


def test_exact_hit_on_the_wrong_exchange_is_ignored():
    results = [{"symbol": "AAPL", "exchange": "BMV", "logo": {"logoid": "apple"}}]
    assert pick_logoid(results, "AAPL", {"NASDAQ", "NYSE"}) is None
    results.append({"symbol": "AAPL", "exchange": "NASDAQ", "logo": {"style": "single", "logoid": "apple"}})
    assert pick_logoid(results, "AAPL", {"NASDAQ", "NYSE"}) == "apple"


@pytest.mark.parametrize(
    ("sym", "und"),
    [
        ("NIFTY26OCTFUT", "NIFTY"),
        ("NIFTY26O0622600CE", "NIFTY"),
        ("CRUDEOIL26OCTFUT", "CRUDEOIL"),
        ("360ONE26OCTFUT", "360ONE"),
        ("M&M26OCT3500CE", "M&M"),
        ("RELIANCE", "RELIANCE"),
    ],
)
def test_derivatives_map_to_their_underlying(sym, und):
    assert underlying_of(sym) == und


@pytest.mark.parametrize(
    ("und", "logoid"),
    [
        ("NIFTY", "indices/nifty-50"),
        ("NIFTY_50", "indices/nifty-50"),     # "NIFTY 50" as the frontend sends it
        ("NIFTY_BANK", "indices/nifty-bank-index"),
        ("NIFTY_ALPHA_50", "source/NSE"),
        ("SENSEX", "indices/bse-sensex"),
        ("SPX500", "indices/s-and-p-500"),
        ("XAUUSD", "metal/gold"),
        ("GOLDM", "metal/gold"),
        ("USOIL", "crude-oil"),
        ("EURUSD", "country/EU"),
        ("USDINR", "country/US"),
        ("RELIANCE", None),                    # a company — resolved by search, not a map
    ],
)
def test_indices_commodities_and_forex_never_hit_a_stock_source(und, logoid):
    assert static_logoid(und) == logoid
