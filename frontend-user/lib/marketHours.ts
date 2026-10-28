/**
 * Frontend market-hours guard — used so the UI doesn't fire close / new
 * orders when the backend will obviously reject them with MARKET_CLOSED.
 *
 * Why: previously, clicking "Close" on a position outside market hours
 * triggered the same optimistic-remove pipeline as any other close — the
 * row disappeared for ~1 s, then the backend rejected and the row came
 * back with a tiny error toast. Traders kept thinking the close worked
 * for a moment and then "got reversed." Pre-checking here means we show
 * one clear "Market is closed" message and the position stays put.
 *
 * Market hours are dynamically configured by the Administrator in Platform Settings
 * (/settings/platform). The trading window fetches and enforces the configured
 * start time and end time per market (NSE, BSE, MCX, FOREX, CRYPTO).
 */

import { useQuery } from "@tanstack/react-query";
import { MarketHoursAPI } from "./api";

export type MarketHoursConfig = {
  [market: string]: {
    name: string;
    start_time: string;
    end_time: string;
    is_enabled: boolean;
    days?: number[];
    description?: string;
  };
};

const STORAGE_KEY = "app.market_hours";

let _configuredHours: MarketHoursConfig | null = null;

// Initialise from localStorage if in browser
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) _configuredHours = JSON.parse(raw);
  } catch {}
}

export function setConfiguredMarketHours(cfg: MarketHoursConfig | null) {
  _configuredHours = cfg;
  if (typeof window !== "undefined" && cfg) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {}
  }
}

export function getConfiguredMarketHours(): MarketHoursConfig | null {
  return _configuredHours;
}

/** Hook to fetch and sync latest market hours set by admin */
export function useMarketHours() {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-market-hours"],
    queryFn: async () => {
      try {
        const res = await MarketHoursAPI.get();
        if (res) {
          setConfiguredMarketHours(res);
          return res;
        }
      } catch {}
      return getConfiguredMarketHours();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return { hours: data || getConfiguredMarketHours(), isLoading };
}

/** Minutes since IST midnight for the given JS Date (no tz library needed). */
function _istMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/** IST day-of-week (0 = Sun, 6 = Sat). */
function _istDay(date: Date): number {
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60_000);
  return ist.getUTCDay();
}

/** Map exchange and segment to canonical market key (NSE, BSE, MCX, FOREX, CRYPTO) */
export function resolveMarket(segmentType?: string | null, exchange?: string | null): string {
  const seg = (segmentType || "").toUpperCase();
  const exch = (exchange || "").toUpperCase();

  if (seg.includes("CRYPTO") || exch === "CRYPTO" || exch === "BINANCE") return "CRYPTO";
  if (seg.startsWith("MCX") || exch === "MCX" || seg === "COMMODITIES") return "MCX";
  if (seg.startsWith("BSE") || seg.startsWith("BFO") || exch === "BSE" || exch === "BFO") return "BSE";
  if (
    seg === "FOREX" ||
    seg === "STOCKS" ||
    seg === "INDICES" ||
    seg.includes("FOREX") ||
    seg.includes("FX") ||
    exch === "CDS" ||
    seg.startsWith("CDS")
  ) {
    return "FOREX";
  }
  return "NSE";
}

/** Information helper for a given instrument's market hours */
export function getMarketHoursInfo(segmentType?: string | null, exchange?: string | null) {
  const market = resolveMarket(segmentType, exchange);
  const cfg = _configuredHours?.[market];
  const defaults: Record<string, { name: string; start: string; end: string }> = {
    NSE: { name: "NSE", start: "09:15", end: "15:30" },
    BSE: { name: "BSE", start: "09:15", end: "15:30" },
    MCX: { name: "MCX", start: "09:00", end: "23:30" },
    FOREX: { name: "Forex", start: "00:00", end: "23:59" },
    CRYPTO: { name: "Crypto", start: "00:00", end: "23:59" },
  };
  const d = defaults[market] || defaults.NSE;
  return {
    market,
    name: cfg?.name || d.name,
    startTime: cfg?.start_time || d.start,
    endTime: cfg?.end_time || d.end,
    isEnabled: cfg?.is_enabled ?? true,
  };
}

/**
 * Returns true when the segment's exchange is currently accepting trades.
 * Checks against the admin-configured market hours if available, with standard
 * exchange defaults as fallback.
 */
export function isInstrumentMarketOpen(
  segmentType?: string | null,
  exchange?: string | null,
  now: Date = new Date(),
): boolean {
  const market = resolveMarket(segmentType, exchange);
  const cfg = _configuredHours?.[market];

  const min = _istMinutes(now);
  const day = _istDay(now);

  // If dynamic config is available, enforce it
  if (cfg) {
    // 1. Is market enabled?
    if (cfg.is_enabled === false) return false;

    // 2. Day of week check
    if (Array.isArray(cfg.days) && !cfg.days.includes(day)) return false;

    // 3. Time check
    const [sh, sm] = (cfg.start_time || "09:15").split(":").map(Number);
    const [eh, em] = (cfg.end_time || "15:30").split(":").map(Number);
    const startMin = (sh || 0) * 60 + (sm || 0);
    const endMin = (eh || 0) * 60 + (em || 0);

    if (startMin <= endMin) {
      return min >= startMin && min <= endMin;
    } else {
      // Overnight session (e.g. 17:00 to 02:30)
      return min >= startMin || min <= endMin;
    }
  }

  // --- Fallback standard exchange defaults when config is not yet loaded ---
  const seg = (segmentType || "").toUpperCase();
  const exch = (exchange || "").toUpperCase();
  const weekday = day !== 0 && day !== 6;

  // Crypto trades 24/7
  if (seg.includes("CRYPTO") || exch === "CRYPTO" || exch === "BINANCE") return true;

  // International FX / OTC forex clock
  if (
    seg === "FOREX" ||
    seg === "STOCKS" ||
    seg === "INDICES" ||
    seg === "COMMODITIES" ||
    seg.includes("FOREX") ||
    seg.includes("FX") ||
    exch === "CDS"
  ) {
    const etParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const etDay = etParts.find((p) => p.type === "weekday")?.value ?? "";
    const etH = Number(etParts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const etM = Number(etParts.find((p) => p.type === "minute")?.value ?? "0");
    const etMin = etH * 60 + etM;
    const CLOSE = 17 * 60; // 17:00 ET
    const REOPEN = 18 * 60; // 18:00 ET
    if (etDay === "Sat") return false;
    if (etDay === "Sun") return etMin >= CLOSE;
    if (etDay === "Fri") return etMin < CLOSE;
    return !(etMin >= CLOSE && etMin < REOPEN);
  }

  // MCX commodities: Mon-Fri 09:00-23:30 IST
  if (seg.startsWith("MCX") || exch === "MCX") {
    if (!weekday) return false;
    return min >= 9 * 60 && min <= 23 * 60 + 30;
  }

  // NSE / BSE equity, F&O — Mon-Fri 09:15-15:30 IST
  if (!weekday) return false;
  return min >= 9 * 60 + 15 && min <= 15 * 60 + 30;
}

/** Friendly label used in the "Market is closed" toast */
export function marketLabel(segmentType?: string | null, exchange?: string | null): string {
  const market = resolveMarket(segmentType, exchange);
  const cfg = _configuredHours?.[market];
  if (cfg?.name) return cfg.name;

  const seg = (segmentType || "").toUpperCase();
  const exch = (exchange || "").toUpperCase();
  if (seg.includes("CRYPTO") || exch === "CRYPTO") return "Crypto";
  if (seg === "FOREX" || seg.includes("FOREX") || seg.includes("FX") || exch === "CDS") return "Forex";
  if (seg === "COMMODITIES") return "Commodities";
  if (seg === "STOCKS") return "Global stocks";
  if (seg === "INDICES") return "Global indices";
  if (seg.startsWith("MCX") || exch === "MCX") return "MCX";
  if (seg.startsWith("BSE") || exch === "BSE") return "BSE";
  return "NSE";
}
