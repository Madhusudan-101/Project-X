import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  FileBarChart,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/store/auth";
import { useCollegeGuard } from "@/hooks/use-college-guard";

export const Route = createFileRoute("/college")({
  component: CollegeLayout,
});

const NAV_ITEMS = [
  { to: "/college", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/college/students", label: "Students", icon: Users, exact: false },
  { to: "/college/drives", label: "Campus Drives", icon: CalendarCheck, exact: false },
  { to: "/college/departments", label: "Departments", icon: Building2, exact: false },
  { to: "/college/analytics", label: "Placement Analytics", icon: BarChart3, exact: false },
  { to: "/college/shortlist", label: "Shortlist", icon: ListChecks, exact: false },
  { to: "/college/reports", label: "Reports", icon: FileBarChart, exact: false },
] as const;

function CollegeLayout() {
  const navigate = useNavigate();
  const session = useCollegeGuard();
  const logout = useAuthStore((s) => s.logout);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const displayName = useMemo(() => {
    const u = session?.user;
    if (!u) return "";
    if (u.firstName || u.lastName) return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    return u.name ?? "";
  }, [session]);

  const initials = useMemo(() => {
    const u = session?.user;
    const source =
      u?.firstName || u?.lastName ? `${u?.firstName ?? ""} ${u?.lastName ?? ""}` : u?.name;
    if (!source) return "C";
    return source
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }, [session]);

  const signOut = () => {
    logout();
    navigate({ to: "/" });
  };

  if (!session) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-surface-2">
        {/* ── Sticky top bar — matches candidate portal exactly ── */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 md:px-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="font-display text-sm font-semibold">Project X</div>
                <div className="text-[11px] text-muted-foreground">College / TPO</div>
              </div>
            </Link>

            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
              <div className="ml-2 hidden text-right text-xs md:block">
                <div className="font-medium">{displayName || "TPO"}</div>
                <div className="text-muted-foreground">
                  {session?.user?.email ?? "you@college.edu"}
                </div>
              </div>
              <div className="ml-2 grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials}
              </div>
              <Button variant="ghost" size="sm" onClick={signOut} className="ml-1">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>

          {/* ── Section tabs — same style as candidate & original college portal ── */}
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="flex h-11 gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.exact
                  ? pathname === item.to
                  : pathname.startsWith(item.to) && pathname !== "/college";
                const isActive = item.exact ? pathname === "/college" : active;

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`relative inline-flex h-11 items-center gap-1.5 rounded-none border-b-2 px-3 text-sm transition-colors ${
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
          </div>
        </header>

        {/* ── Page content ── */}
        <div className="mx-auto max-w-7xl px-4 py-6 pb-12 md:px-8">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
