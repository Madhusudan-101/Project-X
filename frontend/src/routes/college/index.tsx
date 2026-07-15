import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  FileBarChart,
  GraduationCap,
  ListChecks,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthStore } from "@/store/auth";

export const Route = createFileRoute("/college/")({
  component: CollegeDashboard,
});

// ── Module card definitions ──────────────────────────────────────────────────
// status: "live" = navigates to route | "disabled" = no backend endpoint yet

interface CollegeModule {
  label: string;
  description: string;
  icon: LucideIcon;
  accent: "primary" | "secondary" | "accent" | "success";
  status: "live" | "disabled";
  to?: string;
  disabledReason?: string;
}

const MODULES: CollegeModule[] = [
  {
    label: "Students",
    description: "View, search, filter, and upload your full student roster via CSV.",
    icon: Users,
    accent: "primary",
    status: "live",
    to: "/college/students",
  },
  {
    label: "Campus Drives",
    description: "Schedule company drives, set eligibility criteria, and track status.",
    icon: CalendarCheck,
    accent: "secondary",
    status: "live",
    to: "/college/drives",
  },
  {
    label: "Placement Analytics",
    description: "Live stats — total students, avg. employability score, score distribution chart.",
    icon: BarChart3,
    accent: "accent",
    status: "live",
    to: "/college/analytics",
  },
  {
    label: "Reports",
    description:
      "Placement readiness snapshot with NAAC/NIRF-style score distribution and CSV export.",
    icon: FileBarChart,
    accent: "success",
    status: "live",
    to: "/college/reports",
  },
  {
    label: "Shortlist",
    description:
      "Filter students by branch, grad year, score and verification status. Export to CSV.",
    icon: ListChecks,
    accent: "primary",
    status: "live",
    to: "/college/shortlist",
  },
  {
    label: "Departments",
    description: "Department-level breakdown of student counts and placement rates.",
    icon: Building2,
    accent: "secondary",
    status: "live",
    to: "/college/departments",
  },
  {
    label: "Companies",
    description: "Manage company partnerships, contacts, and historical placement data.",
    icon: Briefcase,
    accent: "accent",
    status: "disabled",
    disabledReason: "Backend endpoint not implemented.",
  },
  {
    label: "Faculty",
    description: "Faculty directory, mentor assignments, and placement committee view.",
    icon: GraduationCap,
    accent: "success",
    status: "disabled",
    disabledReason: "Backend endpoint not implemented.",
  },
  {
    label: "Readiness Goals",
    description: "Set college-level placement targets and track department progress.",
    icon: Target,
    accent: "primary",
    status: "disabled",
    disabledReason: "Backend endpoint not implemented.",
  },
];

const accentStyles: Record<string, string> = {
  primary: "from-primary/15 to-primary/5 text-primary",
  secondary: "from-secondary/15 to-secondary/5 text-secondary",
  accent: "from-accent/25 to-accent/5 text-accent-foreground",
  success: "from-success/20 to-success/5 text-success",
};

export function CollegeDashboard() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);

  const firstName = useMemo(() => {
    const u = session?.user;
    return u?.firstName ?? u?.name?.split(" ")[0] ?? "";
  }, [session]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // Redirect to profile-setup if name not set yet
  useEffect(() => {
    if (session?.user && !session.user.firstName) {
      navigate({ to: "/auth/profile-setup" });
    }
  }, [session, navigate]);

  return (
    <div className="space-y-8">
      {/* ── Hero greeting ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl border border-primary/15 bg-hero p-6 md:p-10 shadow-soft"
      >
        <div className="absolute inset-0 -z-10 opacity-60 bg-gradient-brand-soft" />
        <Badge className="bg-surface/70 text-primary border-primary/30 backdrop-blur">
          College / TPO Portal
        </Badge>
        {firstName && (
          <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
            Hey {firstName} —
          </div>
        )}
        <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold leading-tight md:text-4xl">
          Your placement <span className="text-gradient">command centre.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground md:text-base">
          {today} · Manage students, campus drives, analytics and reports — all in one place.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            asChild
            size="lg"
            className="bg-gradient-brand text-primary-foreground shadow-glow hover:opacity-95"
          >
            <Link to="/college/students">
              <Users className="mr-2 h-4 w-4" /> View students
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-primary/30 bg-surface/60 backdrop-blur"
          >
            <Link to="/college/drives">
              <CalendarCheck className="mr-2 h-4 w-4" /> Campus drives
            </Link>
          </Button>
        </div>
      </motion.div>

      {/* ── Module grid ── */}
      <div>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Your workspace</h2>
            <p className="text-sm text-muted-foreground">
              Everything you can manage from the college portal.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, i) => {
            const Icon = m.icon;
            const accentCls = accentStyles[m.accent];

            if (m.status === "live" && m.to) {
              return (
                <motion.div
                  key={m.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.03 * i }}
                >
                  <Link to={m.to} className="block h-full">
                    <Card className="group relative h-full cursor-pointer overflow-hidden border-border/70 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-glow">
                      <div className="flex items-start justify-between">
                        <div
                          className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${accentCls}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <Badge
                          variant="outline"
                          className="border-success/30 bg-success/10 text-success"
                        >
                          Live
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <div className="font-display text-base font-semibold">{m.label}</div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                    </Card>
                  </Link>
                </motion.div>
              );
            }

            // Disabled card — shows tooltip
            return (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.03 * i }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Card className="relative h-full cursor-not-allowed overflow-hidden border-border/50 p-5 opacity-60">
                        <div className="flex items-start justify-between">
                          <div
                            className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${accentCls}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <Badge
                            variant="outline"
                            className="border-border bg-muted text-muted-foreground"
                          >
                            Coming soon
                          </Badge>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-2">
                          <div className="font-display text-base font-semibold">{m.label}</div>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                      </Card>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {m.disabledReason}
                  </TooltipContent>
                </Tooltip>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
