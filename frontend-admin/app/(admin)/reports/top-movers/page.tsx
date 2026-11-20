"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";

import { ReportsAdminAPI } from "@/lib/api";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatINR } from "@/lib/utils";
import { SymbolAvatar } from "@/components/common/SymbolAvatar";
import { istWeekSoFar } from "@/lib/time";

type SymbolRow = {
  token: string;
  symbol: string;
  exchange: string;
  segment?: string;
  ltp: number;
  change: number;
  change_pct: number;
};

type ClientRow = {
  user_id: string;
  user_code: string;
  name: string;
  pnl: number;
  trades: number;
};

type Payload = {
  symbols: { gainers: SymbolRow[]; losers: SymbolRow[] };
  clients: { gainers: ClientRow[]; losers: ClientRow[] };
  days: number;
};

export default function TopMoversPage() {
  // Clients rank over whole IST days; opens on this week so far, and any
  // other week (or range) is a date pick away. Cleared → the last 24 hours.
  const [fromDate, setFromDate] = useState(() => istWeekSoFar()[0]);
  const [toDate, setToDate] = useState(() => istWeekSoFar()[1]);
  const [includeOptions, setIncludeOptions] = useState(false);

  const { data, isFetching } = useQuery<Payload>({
    queryKey: ["admin", "top-movers", fromDate, toDate, includeOptions],
    queryFn: () =>
      ReportsAdminAPI.topMovers({
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        include_options: includeOptions,
      }),
    refetchInterval: 15_000,
  });
  const span =
    fromDate || toDate ? `${fromDate || "start"} → ${toDate || "now"}` : "last 24 hours";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Top gainers & losers"
        description="Instruments by live % move, and clients by their Billing Net P&L over the dates picked."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeOptions}
                onChange={(e) => setIncludeOptions(e.target.checked)}
              />
              Include options
            </label>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Clients from date"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Clients to date"
            />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SymbolCard
          title="Top gaining instruments"
          rows={data?.symbols.gainers ?? []}
          loading={isFetching && !data}
          up
        />
        <SymbolCard
          title="Top losing instruments"
          rows={data?.symbols.losers ?? []}
          loading={isFetching && !data}
        />
        <ClientCard
          title="Most profitable clients"
          description={`Net P&L, ${span}`}
          rows={data?.clients.gainers ?? []}
          loading={isFetching && !data}
          up
        />
        <ClientCard
          title="Biggest losing clients"
          description={`Net P&L, ${span}`}
          rows={data?.clients.losers ?? []}
          loading={isFetching && !data}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Instruments are ranked from the live feed, so only symbols currently
        streaming appear. Client figures count closed trades only; open positions
        are not marked here.
      </p>
    </div>
  );
}

function SymbolCard({
  title,
  rows,
  loading,
  up,
}: {
  title: string;
  rows: SymbolRow[];
  loading: boolean;
  up?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {up ? (
            <TrendingUp className="size-4 text-buy" />
          ) : (
            <TrendingDown className="size-4 text-sell" />
          )}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing moving right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.token} className="flex items-center justify-between py-1.5 text-sm">
                <SymbolAvatar symbol={r.symbol ?? ""} changePct={r.change_pct} size={24} />
                <div className="min-w-0 flex-1 pl-2">
                  <div className="truncate font-medium">{r.symbol}</div>
                  <div className="text-[11px] text-muted-foreground">{r.exchange}</div>
                </div>
                <div className="text-right">
                  <div className="font-tabular">{r.ltp}</div>
                  <div
                    className={cn(
                      "font-tabular text-[11px]",
                      r.change_pct >= 0 ? "text-buy" : "text-sell",
                    )}
                  >
                    {r.change_pct >= 0 ? "+" : ""}
                    {r.change_pct}%
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClientCard({
  title,
  description,
  rows,
  loading,
  up,
}: {
  title: string;
  description: string;
  rows: ClientRow[];
  loading: boolean;
  up?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {up ? (
            <TrendingUp className="size-4 text-buy" />
          ) : (
            <TrendingDown className="size-4 text-sell" />
          )}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No closed trades in this window.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.user_id} className="flex items-center justify-between py-1.5 text-sm">
                <div className="min-w-0">
                  <Link
                    href={`/users/${r.user_id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {r.name || r.user_code || r.user_id}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">
                    {r.user_code} · {r.trades} trade{r.trades === 1 ? "" : "s"}
                  </div>
                </div>
                <div
                  className={cn(
                    "font-tabular",
                    r.pnl >= 0 ? "text-buy" : "text-sell",
                  )}
                >
                  {formatINR(r.pnl)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
