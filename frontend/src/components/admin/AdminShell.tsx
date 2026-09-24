import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  ClipboardList,
  FileBarChart,
  GraduationCap,
  Handshake,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Landmark,
  LogOut,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { adminService } from "@/services/api/admin/admin";
import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";
import { DateRangeFilter } from "./DateRangeFilter";
import { GlobalSearch } from "./GlobalSearch";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Any ONE of these makes the item visible to a delegated admin. Omitted
   * = always visible (an unscoped endpoint, or Admin Management itself,
   * which every admin can open to see at least their own permissions).
   * A Super Admin always sees everything regardless of this list — and so
   * does anyone while their own permissions are still loading, so the nav
   * never flickers empty on first paint. This is UX only: the backend is
   * the real gate, via require_permission (see services/admin/permissions.py) — hiding
   * a link here never substitutes for that. */
  anyOf?: string[];
}

const NAV: { label?: string; items: NavItem[] }[] = [
  { items: [{ to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true }] },
  {
    label: "Organizations",
    items: [
      { to: "/admin/colleges", label: "Colleges", icon: GraduationCap, anyOf: ["colleges.view"] },
      { to: "/admin/companies", label: "Companies", icon: Building2, anyOf: ["companies.view"] },
      { to: "/admin/partnerships", label: "Partnerships", icon: Handshake, anyOf: ["partnerships.view"] },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/admin/candidates", label: "Candidates", icon: Users, anyOf: ["candidates.view"] },
      { to: "/admin/departments", label: "Departments", icon: GraduationCap, anyOf: ["analytics.view"] },
    ],
  },
  { label: "Placements", items: [{ to: "/admin/placements", label: "Placement analytics", icon: BarChart3, anyOf: ["analytics.view"] }] },
  {
    label: "Platform control",
    items: [
      { to: "/admin/users", label: "Users & Access", icon: ShieldCheck, anyOf: ["users.view"] },
      { to: "/admin/admin-users", label: "Admin Management", icon: KeyRound },
      { to: "/admin/activity", label: "Live Activity", icon: Activity, anyOf: ["audit.view"] },
      { to: "/admin/audit-log", label: "Audit Log", icon: ClipboardList, anyOf: ["audit.view"] },
      { to: "/admin/alerts", label: "Alerts", icon: AlertTriangle, anyOf: ["alerts.view"] },
      { to: "/admin/system-health", label: "System Health", icon: HeartPulse, anyOf: ["system.view"] },
    ],
  },
  {
    label: "Finance & Reports",
    items: [
      { to: "/admin/finance", label: "Financial overview", icon: Landmark, anyOf: ["billing.view"] },
      { to: "/admin/reports", label: "Reports", icon: FileBarChart, anyOf: ["reports.view", "reports.export"] },
    ],
  },
];

export function AdminShell({ session }: { session: Session }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const name =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.name || "Admin";

  const signOut = () => {
    logout();
    // Platform-wide data must not linger in memory for the next sign-in on this browser.
    queryClient.clear();
    navigate({ to: "/" });
  };

  const me = useQuery({ queryKey: ["admin", "me"], queryFn: () => adminService.me(), staleTime: 60_000 });
  const isSuperAdmin = me.data?.is_super_admin ?? true; // default open while loading — see NavItem.anyOf docs
  const held = new Set((me.data?.permissions ?? []).filter((g) => g.is_active).map((g) => g.permission));
  const visible = (item: NavItem) => isSuperAdmin || !item.anyOf || item.anyOf.some((p) => held.has(p));

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <Link to="/admin" className="flex items-center gap-2 px-2 py-1.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
                <ShieldCheck className="h-4 w-4 text-primary-foreground" />
              </div>
              <div className="leading-tight">
                <div className="font-display text-sm font-semibold">Mirracle</div>
                <div className="text-[11px] text-muted-foreground">Admin console</div>
              </div>
            </Link>
          </SidebarHeader>
          <SidebarContent>
            {NAV.map((group, i) => {
              const items = group.items.filter(visible);
              if (items.length === 0) return null;
              return (
              <SidebarGroup key={group.label ?? i}>
                {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => {
                      const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                      return (
                        <SidebarMenuItem key={item.to}>
                          <SidebarMenuButton asChild isActive={active}>
                            <Link to={item.to} aria-current={active ? "page" : undefined}>
                              <item.icon />
                              <span>{item.label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              );
            })}
          </SidebarContent>
          <SidebarFooter>
            <div className="px-2 py-1 text-xs">
              <div className="truncate font-medium">{name}</div>
              <div className="truncate text-muted-foreground">{session.user.email}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="justify-start">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0 bg-surface-2">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur md:px-6">
            <SidebarTrigger aria-label="Toggle navigation" />
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <DateRangeFilter />
            </div>
          </header>
          <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 pb-12 md:px-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
