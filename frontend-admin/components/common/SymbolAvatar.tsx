"use client";

import { useState } from "react";
import { API_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Symbols whose logo failed to load. Keyed by SYMBOL, not a per-row boolean:
// virtualised / re-sorted lists recycle rows, and a boolean would hide the
// logo of whichever symbol lands in that row next.
const failed = new Set<string>();

/** "NSE:NIFTY 50" → "NIFTY_50" — the form GET /api/v1/logo/{symbol} accepts. */
export function logoKey(symbol: string): string {
  return (symbol || "").replace(/^[A-Z_]+:/i, "").trim().toUpperCase().replace(/\s+/g, "_");
}

/** Instrument logo over a tinted initials badge. The initials always render
 *  first, so a missing / blocked logo costs nothing but the image. */
export function SymbolAvatar({
  symbol,
  changePct,
  size = 28,
  className,
}: {
  symbol: string;
  changePct?: number | null;
  size?: number;
  className?: string;
}) {
  const key = logoKey(symbol);
  const [, rerender] = useState(0);
  const initials = key.replace(/[^A-Z]/g, "").slice(0, 2) || "?";
  const pct = Number(changePct);
  const tone =
    changePct == null || !Number.isFinite(pct) || pct === 0
      ? "bg-muted text-muted-foreground"
      : pct > 0
        ? "bg-profit/15 text-profit"
        : "bg-loss/15 text-loss";

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-semibold leading-none",
        tone,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials}
      {key && !failed.has(key) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${API_URL}/api/v1/logo/${encodeURIComponent(key)}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full rounded-full bg-white object-contain"
          onError={() => {
            failed.add(key);
            rerender((n) => n + 1);
          }}
        />
      )}
    </span>
  );
}
