"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useAdminAuthStore } from "@/stores/authStore";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InstallPWAButton } from "@/components/pwa/InstallPWAButton";

const schema = z.object({
  identifier: z.string().min(3, "Enter your admin email or user code"),
  password: z.string().min(6, "Minimum 6 characters"),
});
type FormValues = z.infer<typeof schema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const login = useAdminAuthStore((s) => s.login);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await login(values.identifier, values.password);
      toast.success("Authenticated");
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  return (
    <main className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-[#060914] p-4 text-foreground sm:p-6">
      {/* Trading-desk ambient gradients */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(16,185,129,0.22),transparent_65%),radial-gradient(ellipse_60%_45%_at_95%_100%,rgba(59,130,246,0.18),transparent_60%),radial-gradient(ellipse_50%_40%_at_5%_90%,rgba(245,158,11,0.12),transparent_60%)]"
      />
      {/* Subtle market grid lines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />

      {/* Decorative subtle trading chart trendline in the background */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -bottom-10 right-0 h-80 w-full max-w-4xl text-emerald-500/10"
        viewBox="0 0 1000 300"
        fill="none"
      >
        <path
          d="M0 240 Q 200 220 350 160 T 650 120 T 850 60 T 1000 20"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray="6 6"
        />
        <path
          d="M0 260 Q 250 210 450 140 T 750 90 T 1000 30"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>

      <Card className="relative z-10 w-full max-w-[27rem] rounded-3xl border border-white/10 bg-[#0B1020]/80 p-3 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-5">
        <CardHeader className="flex flex-col items-center space-y-3 pb-3 text-center">
          {/* Centered Circular Hey Traders Brand Emblem */}
          <div className="relative mb-1 flex items-center justify-center">
            <div className="absolute -inset-2.5 rounded-full bg-gradient-to-tr from-emerald-500/40 via-teal-500/25 to-amber-500/35 blur-md opacity-85" />
            <div className="relative size-20 rounded-full border-2 border-emerald-500/50 bg-[#070b16] p-1 shadow-2xl shadow-emerald-950 ring-4 ring-emerald-500/15">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="Hey Traders"
                className="size-full rounded-full object-contain"
              />
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold tracking-wider text-rose-400">
            <ShieldCheck className="size-3.5" />
            <span>RESTRICTED ACCESS · ADMIN DESK</span>
          </div>

          <div className="space-y-1">
            <CardTitle className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Hey Traders Admin
            </CardTitle>
            <CardDescription className="text-xs text-white/60">
              Sign in with your administrator credentials
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-xs font-medium text-white/80">
                Admin email or user code
              </Label>
              <Input
                id="identifier"
                placeholder="admin@heytraders.live or ADM01"
                autoComplete="username"
                className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/30 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-0"
                {...form.register("identifier")}
              />
              {form.formState.errors.identifier && (
                <p className="text-xs text-destructive">{form.formState.errors.identifier.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-white/80">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/30 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-0"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="h-11 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400"
              loading={form.formState.isSubmitting}
            >
              Sign in {!form.formState.isSubmitting && <ArrowRight className="size-4 ml-1" />}
            </Button>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-center">
              <p className="text-[11px] leading-relaxed text-white/50">
                Encrypted terminal. IP allow-listing and activity audit logs are enforced server-side.
              </p>
            </div>
          </form>

          {/* Install web app prompt */}
          <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white">Install Hey Traders Admin app</div>
                <p className="text-[11px] leading-snug text-white/50">
                  One-tap home-screen launcher. Stays signed in like a native app.
                </p>
              </div>
            </div>
            <InstallPWAButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
