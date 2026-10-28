"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  Clock,
  RotateCcw,
  CreditCard,
  FileText,
  IndianRupee,
  KeyRound,
  Loader2,
  Mail,
  Megaphone,
  Moon,
  Palette,
  Play,
  ShieldCheck,
  Sun,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { useAdminAuthStore } from "@/stores/authStore";
import { SettingsAPI, AdminAuthAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/PageHeader";
import { cn } from "@/lib/utils";
import { playNotifyPing } from "@/lib/notify-sound";

/**
 * Slimmed-down Platform Settings — operator request was to drop every
 * auto-generated platform.* knob and surface only the three controls
 * an admin actually touches day-to-day:
 *
 *   1. Theme        — light / dark / system, via next-themes
 *   2. Profile      — read-only identity card (name / email / mobile /
 *                     role) pulled from the auth store
 *   3. Notifications — master on/off for the WhatsApp-style live
 *                     toast + ping (deposit / withdrawal request
 *                     events from AdminWsBridge). Persisted in
 *                     localStorage under NOTIFY_KEY so the WsBridge
 *                     can read it without re-mounting.
 *
 * Everything else (platform.name, support_email, currency, …) was
 * noise on a mobile screen and was driving operators away from this
 * page. If those knobs ever need a UI again, give them their own
 * /settings/branding-style page.
 */

const NOTIFY_KEY = "admin.notifications.enabled";

/** Read the persisted notification toggle. Default: ON. Kept local to
 *  the page (not exported) — Next.js App Router only allows the
 *  default page export from a `page.tsx` file. AdminWsBridge defines
 *  its own copy of this helper since it runs even when the settings
 *  page isn't mounted. */
function readNotifyEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(NOTIFY_KEY);
  return v === null ? true : v === "1";
}

export default function PlatformSettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Platform settings"
        description="Theme, your profile, and live notification preferences."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ThemeCard />
        <ProfileCard />
        <ChangePasswordCard />
        <NotificationsCard />
        <WeeklySettlementCard />
        <UsdInrRateCard />
        <MarketHoursCard />
        <PromoButtonCard />
        <PaymentGatewayCard />
        <CarryForwardToggleCard />
        <TermsCard />
      </div>
    </div>
  );
}


// ── Market trading hours (market-wise start and end time) ─────────────
type MarketHourRow = {
  name: string;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
  days?: number[];
  description?: string;
};

const DEFAULT_HOURS: Record<string, MarketHourRow> = {
  NSE: {
    name: "NSE (Equity & F&O)",
    start_time: "09:15",
    end_time: "15:30",
    is_enabled: true,
    days: [1, 2, 3, 4, 5],
    description: "National Stock Exchange equity, futures & options",
  },
  BSE: {
    name: "BSE (Equity & F&O)",
    start_time: "09:15",
    end_time: "15:30",
    is_enabled: true,
    days: [1, 2, 3, 4, 5],
    description: "Bombay Stock Exchange equity, Sensex futures & options",
  },
  MCX: {
    name: "MCX (Commodities)",
    start_time: "09:00",
    end_time: "23:30",
    is_enabled: true,
    days: [1, 2, 3, 4, 5],
    description: "Multi Commodity Exchange: Gold, Silver, Crude Oil, Natural Gas",
  },
  FOREX: {
    name: "Forex & Global (24/5)",
    start_time: "00:00",
    end_time: "23:59",
    is_enabled: true,
    days: [1, 2, 3, 4, 5],
    description: "Foreign exchange currencies, global indices & commodities",
  },
  CRYPTO: {
    name: "Crypto (24/7)",
    start_time: "00:00",
    end_time: "23:59",
    is_enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    description: "Cryptocurrency 24/7 spot & futures markets",
  },
};

function MarketHoursCard() {
  const [hours, setHours] = useState<Record<string, MarketHourRow>>(DEFAULT_HOURS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    SettingsAPI.getMarketHours()
      .then((res) => {
        if (!alive || !res) return;
        setHours((prev) => ({ ...prev, ...res }));
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function updateRow(key: string, patch: Partial<MarketHourRow>) {
    setHours((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await SettingsAPI.setMarketHours(hours);
      toast.success("Market hours configuration saved successfully", {
        description: "Trading window checks will immediately enforce these hours.",
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to save market hours");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setHours(DEFAULT_HOURS);
    toast.info("Market hours reset to standard defaults. Click Save to apply.");
  }

  const markets = [
    { key: "NSE", label: "NSE", badgeColor: "bg-blue-500/15 text-blue-500" },
    { key: "BSE", label: "BSE", badgeColor: "bg-indigo-500/15 text-indigo-500" },
    { key: "MCX", label: "MCX", badgeColor: "bg-amber-500/15 text-amber-500" },
    { key: "FOREX", label: "FOREX", badgeColor: "bg-emerald-500/15 text-emerald-500" },
    { key: "CRYPTO", label: "CRYPTO", badgeColor: "bg-purple-500/15 text-purple-500" },
  ];

  return (
    <Card className="overflow-hidden lg:col-span-3">
      <CardHeader>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-primary" /> Market Trading Hours
            </CardTitle>
            <CardDescription>
              Configure market-wise start time and end time (IST). When a user places a trade in the trading window, orders outside these configured hours will be rejected.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={saving || !loaded}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" /> Defaults
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || !loaded}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save Market Hours
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Market</th>
                <th className="px-4 py-3">Trading Session (IST)</th>
                <th className="px-4 py-3">Days</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {markets.map(({ key, label, badgeColor }) => {
                const row = hours[key] || DEFAULT_HOURS[key];
                const isEnabled = row?.is_enabled ?? true;
                const isCrypto = key === "CRYPTO";

                return (
                  <tr key={key} className={cn("transition-colors", !isEnabled && "opacity-60")}>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded px-2 py-0.5 text-xs font-bold", badgeColor)}>
                          {label}
                        </span>
                        <span className="font-semibold text-foreground">{row?.name || label}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {row?.description || ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Start</span>
                          <Input
                            type="time"
                            value={row?.start_time || "09:15"}
                            onChange={(e) => updateRow(key, { start_time: e.target.value })}
                            className="h-8 w-28 text-xs font-medium"
                            disabled={!isEnabled || saving}
                          />
                        </div>
                        <span className="text-muted-foreground">→</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">End</span>
                          <Input
                            type="time"
                            value={row?.end_time || "15:30"}
                            onChange={(e) => updateRow(key, { end_time: e.target.value })}
                            className="h-8 w-28 text-xs font-medium"
                            disabled={!isEnabled || saving}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs font-medium text-muted-foreground">
                      {isCrypto ? "24/7 (Mon - Sun)" : "Mon - Fri"}
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <button
                        type="button"
                        onClick={() => updateRow(key, { is_enabled: !isEnabled })}
                        disabled={saving}
                        aria-pressed={isEnabled}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50",
                          isEnabled ? "bg-emerald-500" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
                            isEnabled ? "translate-x-6" : "translate-x-1",
                          )}
                        />
                      </button>
                      <div className="mt-1 text-[11px] font-medium text-muted-foreground">
                        {isEnabled ? "Open" : "Closed"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          ℹ Times are configured in Indian Standard Time (IST). When a user places an order on web or mobile, the trading window verifies whether the selected market is currently within its configured start and end time. Outside these hours, orders are blocked with an informative message.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Carry-Forward user toggle (per-admin) ────────────────────────────
// OFF (default): the platform's normal auto-carry runs at EOD and users
// see no toggle. ON: every user's open position gets a per-position
// Carry-Forward switch (default OFF) — only positions the user flips ON
// carry overnight; the rest are squared off at EOD.
function CarryForwardToggleCard() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    SettingsAPI.getCarryToggle()
      .then((r) => {
        if (alive) {
          setEnabled(!!r?.enabled);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      await SettingsAPI.setCarryToggle(next);
      setEnabled(next);
      toast.success(
        next
          ? "Carry-Forward toggle ON — users choose per position"
          : "Carry-Forward toggle OFF — normal auto-carry",
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" /> Carry-Forward toggle
        </CardTitle>
        <CardDescription>
          When ON, each of your users&apos; open positions shows a Carry-Forward
          switch (default OFF). Only positions the user turns ON carry overnight;
          the rest are squared off at market close. OFF = normal auto-carry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Let users choose carry-forward</div>
            <div className="text-[11px] text-muted-foreground">
              {enabled
                ? "On — per-position toggle live for your users"
                : "Off — positions auto-carry when affordable"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggle(!enabled)}
            disabled={!loaded || saving}
            aria-pressed={enabled}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-emerald-500" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Terms & Conditions (per-admin) ───────────────────────────────────
// The admin types their trading terms here; they show on every one of
// their users' profile under "Terms & Conditions". Each admin has their
// own — a user sees their owning admin's text (super-admin's is the
// platform default fallback).
function TermsCard() {
  const [terms, setTerms] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    SettingsAPI.getTerms()
      .then((r) => {
        if (alive) {
          setTerms(r?.terms ?? "");
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await SettingsAPI.setTerms(terms);
      toast.success(
        terms.trim()
          ? "Terms & Conditions saved — live on your users' profile"
          : "Terms & Conditions cleared",
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-primary" /> Terms &amp; Conditions
        </CardTitle>
        <CardDescription>
          Type your trading terms — they appear on every one of your users&apos;
          profile under &quot;Terms &amp; Conditions&quot;. A line ending with
          &quot;:&quot; or a numbered line (1., 2.) renders as a bold heading.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          disabled={!loaded}
          rows={12}
          placeholder={"1. Trading Rules:\nAll trades are subject to broker approval.\n\n2. Risk Disclosure:\nTrading in derivatives involves risk of loss."}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        />
        <Button onClick={save} disabled={saving || !loaded} size="sm" className="w-full sm:w-auto">
          {saving ? "Saving…" : "Save Terms & Conditions"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Promo button (super-admin only) ──────────────────────────────────
// A blinking button shown in EVERY user's dashboard header. Super-admin sets
// the URL it opens + a short label, then flips it ON. OFF → hidden for all.
const PROMO_ENABLED_KEY = "promo.button_enabled";
const PROMO_URL_KEY = "promo.button_url";
const PROMO_LABEL_KEY = "promo.button_label";

function PromoButtonCard() {
  const admin = useAdminAuthStore((s) => s.admin);
  const isSuperAdmin = String(admin?.role || "") === "SUPER_ADMIN";
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let alive = true;
    SettingsAPI.platformList("general")
      .then((rows) => {
        if (!alive) return;
        const get = (k: string) =>
          (rows || []).find((r: any) => r?.key === k)?.value;
        setEnabled(Boolean(get(PROMO_ENABLED_KEY)));
        setUrl(String(get(PROMO_URL_KEY) ?? ""));
        setLabel(String(get(PROMO_LABEL_KEY) ?? ""));
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  async function saveDetails() {
    setSaving(true);
    try {
      await SettingsAPI.updatePlatform(PROMO_URL_KEY, url.trim());
      await SettingsAPI.updatePlatform(PROMO_LABEL_KEY, label.trim());
      toast.success("Promo URL & label saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(next: boolean) {
    if (next && !url.trim()) {
      toast.error("Set and save the button URL before turning it ON");
      return;
    }
    setSaving(true);
    try {
      await SettingsAPI.updatePlatform(PROMO_ENABLED_KEY, next);
      setEnabled(next);
      toast.success(
        next
          ? "Promo button ON — blinking on every user's dashboard"
          : "Promo button OFF — hidden for all users",
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" /> Promo button
        </CardTitle>
        <CardDescription>
          A blinking button shown in every user&apos;s dashboard header. Set the
          URL it opens, save, then turn it ON.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Button URL
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/offer"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Button label (short)
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Offer"
            maxLength={24}
          />
        </div>
        <Button
          onClick={saveDetails}
          disabled={saving}
          size="sm"
          variant="outline"
          className="w-full"
        >
          Save URL &amp; label
        </Button>
        <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Show to all users</div>
            <div className="text-[11px] text-muted-foreground">
              {enabled
                ? "On — blinking button live on every dashboard"
                : "Off — hidden for everyone"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggle(!enabled)}
            disabled={!loaded || saving}
            aria-pressed={enabled}
            aria-label={enabled ? "Hide promo button" : "Show promo button"}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-emerald-500" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}


// ── Theme ────────────────────────────────────────────────────────────

function ThemeCard() {
  const { resolvedTheme, setTheme, theme: setting } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: "light" | "dark" | "system" = mounted
    ? (setting as any) || "system"
    : "system";
  const effective = mounted ? resolvedTheme : "dark";

  const options: { key: "light" | "dark" | "system"; label: string; Icon: typeof Sun }[] = [
    { key: "light",  label: "Light",  Icon: Sun },
    { key: "dark",   label: "Dark",   Icon: Moon },
    { key: "system", label: "System", Icon: Palette },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-4 text-primary" /> Theme
        </CardTitle>
        <CardDescription>
          Currently active: <span className="font-semibold capitalize text-foreground">{effective}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map(({ key, label, Icon }) => {
          const active = current === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTheme(key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} />
              <span className="flex-1 text-left font-medium">{label}</span>
              {active && <Check className="size-4 text-primary" />}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}


// ── Profile ─────────────────────────────────────────────────────────

function ProfileCard() {
  const admin = useAdminAuthStore((s) => s.admin);
  if (!admin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4 text-primary" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not signed in.</p>
        </CardContent>
      </Card>
    );
  }

  const initials = (admin.full_name || admin.user_code || "?")
    .split(/\s+/)
    .map((s: string) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="size-4 text-primary" /> Profile
        </CardTitle>
        <CardDescription>Signed-in admin identity</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
          <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-base font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{admin.full_name || "—"}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {admin.user_code || "—"}
            </div>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            {admin.role}
          </span>
        </div>

        <ul className="space-y-1.5 text-sm">
          <ProfileRow Icon={Mail} label="Email" value={admin.email || "—"} />
          <ProfileRow
            Icon={ShieldCheck}
            label="Role"
            value={String(admin.role).replace(/_/g, " ")}
          />
        </ul>
      </CardContent>
    </Card>
  );
}

function ProfileRow({
  Icon,
  label,
  value,
}: {
  Icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md bg-muted/30 px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </li>
  );
}


// ── Notifications ───────────────────────────────────────────────────

function NotificationsCard() {
  const [enabled, setEnabled] = useState<boolean>(() => readNotifyEnabled());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function toggle(v: boolean) {
    setEnabled(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NOTIFY_KEY, v ? "1" : "0");
      // Broadcast to any open admin tab/window so they all flip together.
      window.dispatchEvent(new StorageEvent("storage", { key: NOTIFY_KEY, newValue: v ? "1" : "0" }));
    }
  }

  function testPing() {
    if (!enabled) return;
    playNotifyPing();
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {enabled ? (
            <Bell className="size-4 text-emerald-500" />
          ) : (
            <BellOff className="size-4 text-muted-foreground" />
          )}
          Notifications
        </CardTitle>
        <CardDescription>
          Live toast + ping when a user submits a deposit / withdrawal request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Master switch — large pill row that's easy to tap on phones */}
        <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Live alerts</div>
            <div className="text-[11px] text-muted-foreground">
              {enabled ? "On — deposits / withdrawals will ping" : "Off — silent mode"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggle(!enabled)}
            aria-pressed={enabled}
            aria-label={enabled ? "Turn notifications off" : "Turn notifications on"}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors",
              enabled ? "bg-emerald-500" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>

        {/* Test button — proves the sound permission is granted and the
            file is reachable. Disabled while notifications are off so
            the operator can't ping themselves through a silenced state. */}
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center gap-2"
          disabled={!mounted || !enabled}
          onClick={testPing}
        >
          {enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          Test sound
        </Button>

        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>· Toast pops top-right with the user name + amount.</li>
          <li>· One short ping plays at the same time.</li>
          <li>· Each toast has a "View" button that opens /payments.</li>
          <li>· Setting is saved to this browser only.</li>
        </ul>
      </CardContent>
    </Card>
  );
}


// ── Weekly settlement ───────────────────────────────────────────────

/**
 * Weekly mark-to-market settlement control. Super-admin only.
 *
 *   • Toggle  — flips the `weekly_settlement.enabled` PlatformSetting via
 *               the backend (kill-switch; default ON).
 *   • Run now — manually triggers the batch for the current ISO week so the
 *               operator can verify it end-to-end before the first scheduled
 *               Saturday. Idempotent on the backend (unique per-week batch).
 *
 * The engine itself runs server-side every Saturday 00:00 IST regardless of
 * this page — this card only exposes the on/off switch + a manual trigger.
 */
const WEEKLY_SETTLEMENT_KEY = "weekly_settlement.enabled";

// ── USD→INR rate (super-admin) ─────────────────────────────────────
// One operator-set number: forex / crypto / COMEX / US stocks & indices are
// margined and settled in rupees at this rate. Positions opened before the
// conversion existed keep settling 1:1.
const USD_INR_KEY = "fx.usd_inr_rate";

function UsdInrRateCard() {
  const admin = useAdminAuthStore((s) => s.admin);
  const isSuperAdmin = String(admin?.role || "") === "SUPER_ADMIN";
  const [live, setLive] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let alive = true;
    SettingsAPI.platformList("trading")
      .then((rows) => {
        const row = (rows || []).find((r: any) => r?.key === USD_INR_KEY);
        const n = Number(row?.value);
        if (alive && n > 0) {
          setLive(n);
          setValue(String(n));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  async function save() {
    const n = Number(value);
    if (!(n > 0 && n <= 1000)) {
      toast.error("Enter a rate between 0 and 1000");
      return;
    }
    setSaving(true);
    try {
      await SettingsAPI.updatePlatform(USD_INR_KEY, n);
      setLive(n);
      toast.success(`USD→INR set to ₹${n}`, { description: "All workers re-price within 30 s." });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update rate");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IndianRupee className="size-4 text-primary" /> USD → INR rate
        </CardTitle>
        <CardDescription>
          Forex, crypto, COMEX and international stocks/indices are margined and
          settled in rupees at this rate. Older positions stay 1:1.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-[11px] text-muted-foreground">
          Currently live: {live != null ? `₹${live} per $1` : "—"}
        </div>
        <div className="flex gap-2">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="USD to INR rate"
          />
          <Button onClick={save} disabled={saving || !value}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WeeklySettlementCard() {
  const admin = useAdminAuthStore((s) => s.admin);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [loaded, setLoaded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);

  const role = String(admin?.role || "");
  // Card is visible to ADMIN + SUPER_ADMIN only (brokers / sub-brokers excluded).
  const canSee = role === "SUPER_ADMIN" || role === "ADMIN";
  // The platform-wide auto-run kill-switch is super-admin only; admins get
  // the scoped "Run now" for their own user pool.
  const isSuperAdmin = role === "SUPER_ADMIN";

  useEffect(() => {
    if (!isSuperAdmin) return;
    let alive = true;
    SettingsAPI.platformList("trading")
      .then((rows) => {
        if (!alive) return;
        const row = (rows || []).find((r: any) => r?.key === WEEKLY_SETTLEMENT_KEY);
        // Default ON when the row doesn't exist yet (matches backend default).
        setEnabled(row ? Boolean(row.value) : true);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [isSuperAdmin]);

  if (!canSee) return null;

  async function toggle(next: boolean) {
    setToggling(true);
    try {
      await SettingsAPI.setWeeklySettlementEnabled(next);
      setEnabled(next);
      toast.success(next ? "Weekly settlement enabled" : "Weekly settlement disabled");
    } catch (e: any) {
      toast.error(e?.message || "Failed to update setting");
    } finally {
      setToggling(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await SettingsAPI.weeklySettlementRun();
      if ((res as any)?.skipped_reason || (res as any)?.skipped) {
        toast.message("Settlement not run", {
          description: `Reason: ${(res as any)?.reason || (res as any)?.skipped_reason || "disabled / already done"}`,
        });
      } else {
        toast.success(`Settlement ${res.week_key ?? ""} done`, {
          description: `Settled ${res.settled ?? 0} · skipped ${res.skipped ?? 0} · failed ${res.failed ?? 0} (of ${res.total ?? 0})`,
        });
      }
    } catch (e: any) {
      toast.error(e?.message || "Settlement run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" /> Weekly settlement
        </CardTitle>
        <CardDescription>
          Saturday 00:00 IST: books open-position P&amp;L to wallets and re-opens
          each position at the settlement price.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Platform-wide auto-run switch — SUPER_ADMIN only. */}
        {isSuperAdmin ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Auto-run weekly</div>
              <div className="text-[11px] text-muted-foreground">
                {enabled ? "On — fires every Saturday (all users)" : "Off — engine paused"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggle(!enabled)}
              disabled={!loaded || toggling}
              aria-pressed={enabled}
              aria-label={enabled ? "Disable weekly settlement" : "Enable weekly settlement"}
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50",
                enabled ? "bg-emerald-500" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
                  enabled ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            Auto-run is managed platform-wide by the super-admin. You can settle
            <span className="font-medium text-foreground"> your own users </span>
            on demand below.
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full justify-center gap-2"
          disabled={running}
          onClick={runNow}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? "Running…" : "Run now (my users)"}
        </Button>

        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>· Settles only the users you own ({isSuperAdmin ? "your pool" : "your clients & brokers"}).</li>
          <li>· Profit credited / loss debited to each user's wallet.</li>
          <li>· Same side &amp; lots kept; entry price resets, P&amp;L back to 0.</li>
          <li>· "Run now" is idempotent — safe to test before Saturday.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Divinepay payment gateway (super-admin's own pool) ───────────────
// Controls the auto-crediting UPI pay-in for the super-admin's OWN users
// (assigned_admin_id is None). Per-admin pools are toggled on the sub-admins
// list. Ships OFF; the whole platform stays manual until turned on.
function PaymentGatewayCard() {
  const admin = useAdminAuthStore((s) => s.admin);
  const isSuperAdmin = String(admin?.role || "") === "SUPER_ADMIN";
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let alive = true;
    SettingsAPI.getPaymentGateway()
      .then((d) => {
        if (!alive) return;
        setEnabled(Boolean(d?.enabled));
        setConfigured(Boolean(d?.configured));
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      await SettingsAPI.setPaymentGateway(next);
      setEnabled(next);
      toast.success(
        next
          ? "Online payment ON for your own pool"
          : "Online payment OFF — your users use manual deposits",
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4 text-primary" /> Payment gateway
        </CardTitle>
        <CardDescription>
          Divinepay UPI online pay-in that auto-credits the wallet. This switch
          is for YOUR OWN users; turn it on per admin from the Sub-admins list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-600">
            Gateway key not set on the server (DIVINEPAY_API_KEY). Deposits stay
            manual until it&apos;s configured.
          </div>
        )}
        <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Online payment (my pool)</div>
            <div className="text-[11px] text-muted-foreground">
              {enabled
                ? "On — your users get the UPI pay-in flow"
                : "Off — your users use the manual deposit flow"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggle(!enabled)}
            disabled={!loaded || saving}
            aria-pressed={enabled}
            aria-label={enabled ? "Disable payment gateway" : "Enable payment gateway"}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-emerald-500" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Change my password (every admin-tier user: admin / broker / sub-broker) ──
function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!current) return toast.error("Enter your current password");
    if (next.length < 6) return toast.error("New password must be at least 6 characters");
    if (next !== confirm) return toast.error("New passwords don't match");
    if (next === current) return toast.error("New password must be different");
    setSaving(true);
    try {
      await AdminAuthAPI.changePassword(current, next);
      toast.success("Password changed successfully");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? e?.message ?? "Could not change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" /> Change password
        </CardTitle>
        <CardDescription>Update your own login password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Current password</label>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">New password</label>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Confirm new password</label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter new password"
          />
        </div>
        <Button
          onClick={submit}
          disabled={saving || !current || !next || !confirm}
          size="sm"
          className="w-full"
        >
          {saving ? "Saving…" : "Change password"}
        </Button>
      </CardContent>
    </Card>
  );
}
