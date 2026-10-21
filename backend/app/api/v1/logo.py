"""Public instrument-logo proxy: GET /api/v1/logo/{symbol}.

The browser never talks to the logo vendors — one source to change, one cache,
and a vendor outage costs a row of initials instead of broken images.
"""
from __future__ import annotations

from fastapi import APIRouter, Response

from app.services import symbol_logo_service

router = APIRouter(prefix="/logo", tags=["logo"])

_CACHE = {"Cache-Control": "public, max-age=86400"}
# Belt and braces: even if an unsafe SVG slipped past is_safe_svg, opening
# this URL directly runs nothing.
_SVG_HEADERS = {
    **_CACHE,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
}


@router.get("/{symbol}")
async def symbol_logo(symbol: str) -> Response:
    sym = symbol.strip().upper()
    if not symbol_logo_service.valid_symbol(sym):
        return Response(status_code=404, headers=_CACHE)
    body = await symbol_logo_service.logo_svg(sym)
    if body is None:
        return Response(status_code=404, headers=_CACHE)
    return Response(content=body, media_type="image/svg+xml", headers=_SVG_HEADERS)
