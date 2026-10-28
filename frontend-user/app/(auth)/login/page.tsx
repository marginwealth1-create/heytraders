"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, GraduationCap, Loader2, Wrench, Zap } from "lucide-react";
import { BrandGlyph } from "@/components/layout/BrandGlyph";
import { useBranding } from "@/lib/branding-context";
import { useAuthStore } from "@/stores/authStore";
import { ApiError, AuthAPI, ProfileAPI, setTokens } from "@/lib/api";
import { API_URL, STORAGE_KEYS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InstallPwaButton } from "@/components/common/InstallPwaButton";
import { cn } from "@/lib/utils";
import { FIELD, GOLD_BTN } from "../styles";

const schema = z.object({
  identifier: z.string().min(3, "Enter your user ID or mobile no."),
  password: z.string().min(6, "Minimum 6 characters"),
  two_fa_code: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSplash subtitle="Loading…" />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginSplash({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-primary/10">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Signing you in…</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function LoginHeroLogo() {
  const { branding } = useBranding();
  const [imgLoaded, setImgLoaded] = useState(false);
  const logoSrc = branding?.logo_url ? `${API_URL}${branding.logo_url}` : null;
  const alt = (branding?.brand_name ?? "").trim() || "Brand logo";

  return (
    <div className="relative mx-auto grid size-20 place-items-center overflow-hidden rounded-full border-2 border-emerald-500/40 bg-[#070B16] shadow-[0_0_32px_rgba(16,185,129,0.28)] ring-4 ring-emerald-500/10">
      <BrandGlyph className="size-9 text-emerald-400" />
      {logoSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt={alt}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(false)}
          className={cn(
            "absolute inset-0 size-full rounded-full bg-[#070B16] object-cover p-1 transition-opacity",
            imgLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const setUser = useAuthStore((s) => s.setUser);
  const hydrated = useAuthStore((s) => s.hydrated);
  const currentUser = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const [showPwd, setShowPwd] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  // Maintenance popup — shown both when a live session gets kicked here
  // (?maintenance=1, set by the api interceptor) and when a fresh login is
  // rejected with MAINTENANCE_MODE below.
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);
  useEffect(() => {
    if (searchParams?.get("maintenance") === "1") {
      setMaintenanceMsg(
        "The platform is under maintenance. Please try again later.",
      );
    }
  }, [searchParams]);

  // Capture a shared referral link's ?ref= BEFORE the user tries the demo,
  // so admin/broker/sub-broker attribution survives demo-login → logout →
  // register (the URL query is lost across those hops). Persisted under a key
  // clearTokens() never touches; the register page consumes it on signup.
  const urlRef = (searchParams?.get("ref") || "").trim().toUpperCase();
  useEffect(() => {
    if (typeof window !== "undefined" && urlRef) {
      window.localStorage.setItem(STORAGE_KEYS.referralCode, urlRef);
    }
  }, [urlRef]);

  useEffect(() => {
    if (!hydrated || !currentUser) return;
    const hasRefresh =
      typeof window !== "undefined" &&
      !!window.localStorage.getItem(STORAGE_KEYS.refreshToken);
    if (hasRefresh) {
      router.replace("/dashboard");
    } else {
      try {
        window.localStorage.removeItem("nb.auth");
      } catch {
        /* ignore */
      }
      setUser(null);
    }
  }, [hydrated, currentUser, router, setUser]);

  const impAccess = searchParams?.get("access");
  const impRefresh = searchParams?.get("refresh");
  const isImpersonating = !!(impAccess && impRefresh);
  const [impersonationFailed, setImpersonationFailed] = useState(false);

  useEffect(() => {
    if (!isImpersonating || !impAccess || !impRefresh) return;
    setTokens(impAccess, impRefresh);
    router.prefetch("/dashboard");
    ProfileAPI.me()
      .then((u: any) => {
        setUser(u as any);
        router.replace("/dashboard");
      })
      .catch(() => {
        toast.error("Impersonation token rejected");
        setImpersonationFailed(true);
      });
  }, [isImpersonating, impAccess, impRefresh, router, setUser]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", password: "", two_fa_code: "" },
  });

  async function handleDemoLogin() {
    setDemoLoading(true);
    try {
      const pair = await AuthAPI.demoLogin();
      setSession(pair as any);
      toast.success("Demo account ready — ₹50,00,000 virtual balance");
      router.push("/dashboard");
    } catch {
      toast.error("Could not start demo. Please try again.");
    } finally {
      setDemoLoading(false);
    }
  }

  async function onSubmit(values: FormValues) {
    try {
      await login(values.identifier, values.password, values.two_fa_code || undefined);
      toast.success("Welcome back");
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "TWO_FA_REQUIRED") {
          setNeeds2fa(true);
          toast.info("Enter your 2FA code to continue");
          return;
        }
        if (err.code === "MAINTENANCE_MODE") {
          // Pool locked by the admin → prominent popup, not a toast.
          setMaintenanceMsg(err.message);
          return;
        }
        toast.error(err.message);
      } else {
        toast.error("Login failed. Please try again.");
      }
    }
  }

  if (isImpersonating && !impersonationFailed) {
    return <LoginSplash subtitle="Redirecting to your dashboard" />;
  }

  if (!hydrated) {
    return <LoginSplash subtitle="Restoring your session…" />;
  }

  if (currentUser) {
    return <LoginSplash subtitle="Redirecting to your dashboard" />;
  }

  return (
    <div>
      {maintenanceMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setMaintenanceMsg(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-amber-500/15 text-amber-500">
              <Wrench className="size-6" />
            </div>
            <h3 className="text-lg font-semibold">Under maintenance</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{maintenanceMsg}</p>
            <Button className="mt-5 w-full" onClick={() => setMaintenanceMsg(null)}>
              OK
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center text-center">
        <LoginHeroLogo />
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          Virtual Trading Terminal
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white">
          Welcome back
        </h1>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Sign in with your user ID or registered mobile number
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="identifier" className="text-xs text-muted-foreground">
            User ID or mobile
          </Label>
          <Input
            id="identifier"
            placeholder="K7M2QX or 9999900000"
            autoComplete="username"
            className={FIELD}
            {...form.register("identifier")}
          />
          {form.formState.errors.identifier && (
            <p className="text-xs text-destructive">{form.formState.errors.identifier.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs text-muted-foreground">
              Password
            </Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-gold hover:text-gold/80"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              className={cn(FIELD, "pr-16")}
              {...form.register("password")}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? "Hide password" : "Show password"}
            >
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        {needs2fa && (
          <div className="space-y-1.5">
            <Label htmlFor="two_fa_code" className="text-xs text-muted-foreground">
              2FA code
            </Label>
            <Input
              id="two_fa_code"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              autoComplete="one-time-code"
              className={cn(FIELD, "tracking-[0.3em]")}
              {...form.register("two_fa_code")}
            />
          </div>
        )}

        <Button type="submit" className={GOLD_BTN} loading={form.formState.isSubmitting}>
          Sign in {!form.formState.isSubmitting && <ArrowRight className="size-4" />}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="h-px flex-1 bg-white/10" />
        or practice with demo
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-12 w-full rounded-xl border-emerald-500/25 bg-emerald-500/[0.04] text-xs font-semibold hover:bg-emerald-500/[0.08]"
        onClick={handleDemoLogin}
        loading={demoLoading}
      >
        {!demoLoading && <Zap className="size-4 text-gold" />}
        <span>
          Try demo — <span className="font-bold text-emerald-400">₹50,00,000</span> virtual funds
        </span>
      </Button>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <GraduationCap className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              Educational &amp; Training Notice
            </span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              Zero Risk
            </span>
          </div>
          <p className="mt-1.5 text-xs font-bold leading-relaxed text-white">
            No real money involved. This is a Virtual Trading Application which has all features to trade.
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            This application is used for exchanging views on markets for individual students for training purpose only.
          </p>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        New here?{" "}
        <Link
          href={urlRef ? `/register?ref=${encodeURIComponent(urlRef)}` : "/register"}
          className="font-semibold text-gold hover:text-gold/80"
        >
          Open an account
        </Link>
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
        <InstallPwaButton variant="compact" />
        <TelegramLink />
      </div>
    </div>
  );
}

/** Per-admin Telegram link — shows ONLY when the resolved brand (this
 *  admin's referral / custom domain) has a telegram_link set. Renders http(s)
 *  links only so a stored value can never become a javascript: href. */
function TelegramLink() {
  const { branding } = useBranding();
  const link = (branding?.telegram_link ?? "").trim();
  if (!link || !/^https?:\/\//i.test(link)) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      Join us on Telegram
    </a>
  );
}
