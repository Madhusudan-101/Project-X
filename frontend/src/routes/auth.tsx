import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Sparkles, Bot, ShieldCheck, BarChart3, ArrowUpRight } from "lucide-react";
import { z } from "zod";
import type { UserRole } from "@/types";

const roleEnum = z.enum(["candidate", "company", "college", "admin"]);

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => z.object({ role: roleEnum.optional() }).parse(search),
  component: AuthLayout,
});

const HIGHLIGHTS = [
  { icon: Bot, title: "AI Interviewer", desc: "Adaptive voice interviews with live scoring." },
  { icon: ShieldCheck, title: "Enterprise-ready", desc: "SSO, audit logs and per-tenant keys." },
  {
    icon: BarChart3,
    title: "Actionable analytics",
    desc: "From candidate performance to placement.",
  },
];

function AuthLayout() {
  const { role } = Route.useSearch();
  return (
    <div className="theme-light flex min-h-screen flex-col px-4 pb-6 pt-4 md:px-8">
      <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-2 py-3 md:px-12">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">Mirracle</span>
        </Link>
        <Link
          to="/portals"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Portals
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1400px] flex-1 items-center gap-10 rounded-[2rem] bg-auth-panel px-6 py-10 md:px-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:px-20">
        {/* Brand copy */}
        <div className="hidden lg:block">
          <h2 className="text-5xl font-medium leading-[1.08] xl:text-6xl">
            Simple, Fast & Smarter Way to Hire
          </h2>
          <p className="mt-5 max-w-lg text-base text-foreground/80">
            One platform for candidates, companies & colleges. From resume to signed offer.
          </p>

          <div className="mt-10 grid max-w-xl gap-3">
            {HIGHLIGHTS.map((h) => (
              <div
                key={h.title}
                className="flex items-start gap-3 rounded-xl border border-white/80 bg-white/70 p-4 shadow-soft"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <h.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{h.title}</div>
                  <div className="text-xs text-muted-foreground">{h.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form card */}
        <div className="mx-auto w-full max-w-md lg:ml-auto lg:mr-0">
          <div className="auth-card-ring">
            <div className="rounded-[1.25rem] bg-white p-6 shadow-sm sm:p-8">
              <Outlet />
            </div>
          </div>
          <PortalHint role={role} />
        </div>
      </main>

      <footer className="mx-auto mt-4 w-full max-w-[1400px] px-2 text-xs text-muted-foreground md:px-12">
        © {new Date().getFullYear()} Mirracle. All rights reserved.
      </footer>
    </div>
  );
}

function PortalHint({ role }: { role?: UserRole }) {
  if (!role) return null;
  return (
    <div className="mt-4 rounded-lg border border-white/80 bg-white/70 px-3 py-2 text-center text-xs text-foreground/80">
      Signing in to the <span className="font-semibold capitalize">{role}</span> portal.{" "}
      <Link to="/portals" className="font-medium text-foreground underline">
        Change
      </Link>
    </div>
  );
}
