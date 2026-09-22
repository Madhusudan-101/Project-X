import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
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
import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";
import { DateRangeFilter } from "./DateRangeFilter";
import { GlobalSearch } from "./GlobalSearch";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV: { label?: string; items: NavItem[] }[] = [
  { items: [{ to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true }] },
  {
    label: "Organizations",
    items: [
      { to: "/admin/colleges", label: "Colleges", icon: GraduationCap },
      { to: "/admin/companies", label: "Companies", icon: Building2 },
      { to: "/admin/partnerships", label: "Partnerships", icon: Handshake },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/admin/candidates", label: "Candidates", icon: Users },
      { to: "/admin/departments", label: "Departments", icon: GraduationCap },
    ],
  },
  { label: "Placements", items: [{ to: "/admin/placements", label: "Placement analytics", icon: BarChart3 }] },
  {
    label: "Platform control",
    items: [
      { to: "/admin/users", label: "Users & Access", icon: ShieldCheck },
      { to: "/admin/activity", label: "Live Activity", icon: Activity },
      { to: "/admin/audit-log", label: "Audit Log", icon: ClipboardList },
      { to: "/admin/alerts", label: "Alerts", icon: AlertTriangle },
      { to: "/admin/system-health", label: "System Health", icon: HeartPulse },
    ],
  },
  {
    label: "Finance & Reports",
    items: [
      { to: "/admin/finance", label: "Financial overview", icon: Landmark },
      { to: "/admin/reports", label: "Reports", icon: FileBarChart },
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
            {NAV.map((group, i) => (
              <SidebarGroup key={group.label ?? i}>
                {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
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
            ))}
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
