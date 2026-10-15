import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  FileBarChart,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  LogOut,
  RotateCcw,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DEMO_BASE, DEMO_COLLEGE_NAME, LIVE_BASE } from "@/lib/demo/college/mode";

// Paths are relative to the portal base ("/college" or "/demo/college").
const NAV_ITEMS = [
  { path: "", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { path: "/students", label: "Students", icon: Users, exact: false },
  { path: "/drives", label: "Campus Drives", icon: CalendarCheck, exact: false },
  { path: "/departments", label: "Departments", icon: Building2, exact: false },
  { path: "/analytics", label: "Placement Analytics", icon: BarChart3, exact: false },
  { path: "/shortlist", label: "Shortlist", icon: ListChecks, exact: false },
  { path: "/reports", label: "Reports", icon: FileBarChart, exact: false },
] as const;

interface CollegeShellProps {
  /** Demo Mode: banner, "Exit demo" / "Reset" actions, and no account controls. */
  demo?: boolean;
  displayName: string;
  email: string;
  initials: string;
  /** Live: sign out. Demo: leave the demo. */
  onExit: () => void;
  /** Demo only: restore the original sample data. */
  onResetDemo?: () => void;
  /** Changing this remounts the page — used so a demo reset reloads every list. */
  contentKey?: string | number;
}

/**
 * The College Portal chrome (top bar, section tabs, content outlet), shared by the real
 * portal (/college) and Demo Mode (/demo/college) so the demo looks and behaves like the product.
 */
export function CollegeShell({
  demo = false,
  displayName,
  email,
  initials,
  onExit,
  onResetDemo,
  contentKey,
}: CollegeShellProps) {
  const base = demo ? DEMO_BASE : LIVE_BASE;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // On narrow screens the section tabs scroll sideways; keep the current page's tab in view so
  // the active indicator is never off-screen.
  const tabStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabStrip.current;
    const active = strip?.querySelector<HTMLElement>("[data-active]");
    if (!strip || !active) return;
    const left = active.offsetLeft - strip.offsetLeft;
    const visible =
      left >= strip.scrollLeft && left + active.offsetWidth <= strip.scrollLeft + strip.clientWidth;
    if (!visible) strip.scrollTo({ left: Math.max(0, left - 16) });
  }, [pathname]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-surface-2">
        {/* ── Demo explainer (scrolls away; the sticky bar below keeps a DEMO badge + Exit visible) ── */}
        {demo && (
          <div role="status" className="border-b border-primary/20 bg-primary-soft text-primary">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 text-xs md:flex-row md:items-center md:gap-3 md:px-8">
              <p className="flex-1 leading-snug">
                You're exploring sample data for the fictional <strong>{DEMO_COLLEGE_NAME}</strong>.
                Anything you change is temporary, stays in this browser tab, and never touches a
                real college's records.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-fit shrink-0 border-primary/30 bg-surface/70"
                onClick={onResetDemo}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Reset demo data
              </Button>
            </div>
          </div>
        )}

        {/* ── Sticky top bar — matches candidate portal exactly ── */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-4 md:px-8">
            <Link to={(demo ? DEMO_BASE : "/") as never} className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="font-display text-sm font-semibold">Mirracle</div>
                <div className="text-[11px] text-muted-foreground">College / TPO</div>
              </div>
            </Link>
            {demo && (
              <Badge className="shrink-0 gap-1 whitespace-nowrap bg-primary px-2 text-[10px] tracking-wider text-primary-foreground sm:text-xs">
                <FlaskConical className="h-3 w-3" aria-hidden="true" /> DEMO MODE
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-1">
              {demo ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="hidden sm:inline-flex" tabIndex={0}>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled
                        aria-label="Settings (unavailable in the demo)"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Account settings aren't available in the demo.</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="ghost" size="icon">
                  <Settings className="h-4 w-4" />
                </Button>
              )}
              <div className="ml-2 hidden text-right text-xs md:block">
                <div className="font-medium">{displayName || "TPO"}</div>
                <div className="text-muted-foreground">{email || "you@college.edu"}</div>
              </div>
              <div className="ml-2 grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials}
              </div>
              <Button
                variant={demo ? "outline" : "ghost"}
                size="sm"
                onClick={onExit}
                className="ml-1"
              >
                <LogOut className="mr-2 h-4 w-4" /> {demo ? "Exit demo" : "Sign out"}
              </Button>
            </div>
          </div>

          {/* ── Section tabs — same style as candidate & original college portal ── */}
          <nav aria-label="College portal sections" className="mx-auto max-w-7xl px-4 md:px-8">
            <div
              ref={tabStrip}
              className="flex h-11 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const to = `${base}${item.path}`;
                const isActive = item.exact
                  ? pathname === base || pathname === `${base}/`
                  : pathname.startsWith(to);

                return (
                  <Link
                    key={item.path}
                    to={to as never}
                    // Without this, the Dashboard link (a prefix of every other path) is also
                    // announced as the current page.
                    activeOptions={{ exact: item.exact }}
                    aria-current={isActive ? "page" : undefined}
                    // Same-render marker for the scroll effect (the router's own aria-current settles a render later).
                    data-active={isActive ? "" : undefined}
                    className={`relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-none border-b-2 px-3 text-sm transition-colors ${
                      isActive
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </header>

        {/* ── Page content ── */}
        <div className="mx-auto max-w-7xl px-4 py-6 pb-12 md:px-8">
          <Outlet key={contentKey} />
        </div>
      </div>
    </TooltipProvider>
  );
}
