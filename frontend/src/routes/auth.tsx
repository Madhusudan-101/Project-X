import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Sparkles, Bot, ShieldCheck, BarChart3 } from "lucide-react";
import { z } from "zod";
import type { UserRole } from "@/types";

const roleEnum = z.enum(["candidate", "company", "college", "admin"]);

export const Route = createFileRoute("/auth")({
  validateSearch: (search) =>
    z.object({ role: roleEnum.optional() }).parse(search),
  component: AuthLayout,
});

const HIGHLIGHTS = [
  { icon: Bot, title: "AI Interviewer", desc: "Adaptive voice + avatar interviews with live scoring." },
  { icon: ShieldCheck, title: "Enterprise-ready", desc: "SOC2-aligned. SSO, audit logs and per-tenant keys." },
  { icon: BarChart3, title: "Actionable analytics", desc: "From candidate performance to placement rates." },
];

function AuthLayout() {
  const { role } = Route.useSearch();
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-hero lg:block">
        <div className="absolute inset-0 bg-gradient-mesh opacity-70" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold">Mirracle</span>
          </Link>

          <div className="max-w-md">
            <h2 className="font-display text-4xl font-bold leading-tight">
              The AI-powered <span className="text-gradient">hiring ecosystem</span> for candidates,
              companies & colleges.
            </h2>
            <p className="mt-4 text-muted-foreground">
              One platform. Every workflow. From resume to signed offer.
            </p>

            <div className="mt-8 space-y-4">
              {HIGHLIGHTS.map((h) => (
                <div key={h.title} className="flex items-start gap-3 rounded-xl glass p-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-brand text-primary-foreground">
                    <h.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{h.title}</div>
                    <div className="text-xs text-muted-foreground">{h.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Mirracle. All rights reserved.
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-surface px-4 py-12 md:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link to="/" className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-display text-lg font-bold">Mirracle</span>
            </Link>
          </div>
          <Outlet />
          <PortalHint role={role} />
        </div>
      </div>
    </div>
  );
}

function PortalHint({ role }: { role?: UserRole }) {
  if (!role) return null;
  return (
    <div className="mt-6 rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-xs text-primary">
      Signing in to the <span className="font-semibold capitalize">{role}</span> portal.{" "}
      <Link to="/portals" className="underline">
        Change
      </Link>
    </div>
  );
}
