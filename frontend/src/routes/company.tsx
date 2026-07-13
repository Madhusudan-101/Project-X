import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  ClipboardList,
  Layers,
  LineChart,
  LogOut,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Star,
  Users,
  Wand2,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/store/auth";
import { useCompanyStore } from "@/store/company";
import { companyService } from "@/services/api/company";
import { rolesService } from "@/services/api/roles";
import type { Company } from "@/types/company";
import type { Role } from "@/types/role";

// ── Route ──────────────────────────────────────────────────────────────

export const Route = createFileRoute("/company")({
  component: CompanyPortal,
});

export const CompanyIcons = { Building2, BarChart3, Users };

// ── Root component ─────────────────────────────────────────────────────

function CompanyPortal() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const storedCompany = useCompanyStore((s) => s.company);
  const setCompany = useCompanyStore((s) => s.setCompany);
  const clearCompany = useCompanyStore((s) => s.clearCompany);
  const [tab, setTab] = useState("overview");

  // ── Auth + role guard ──────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login", search: { role: "company" } as never });
      return;
    }
    if (session.user.role !== "company") {
      toast.error("This dashboard is for Company accounts only.");
      navigate({ to: "/portals" });
    }
  }, [session, navigate]);

  // ── Company profile (hydrate from store or fetch) ──────────────────
  const { data: company, isLoading: companyLoading } = useQuery<Company>({
    queryKey: ["company", "me"],
    queryFn: () => companyService.getMe(),
    enabled: !!session && session.user.role === "company",
    initialData: storedCompany ?? undefined,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  // Sync fetched company into persistent store
  useEffect(() => {
    if (company) setCompany(company);
  }, [company, setCompany]);

  // ── Sign out ────────────────────────────────────────────────────────
  const signOut = () => {
    logout();
    clearCompany();
    navigate({ to: "/" });
  };

  // ── Derived display values ──────────────────────────────────────────
  const { displayName, initials, email } = useMemo(() => {
    const u = session?.user;
    const name =
      u?.firstName || u?.lastName
        ? `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim()
        : (u?.name ?? "");
    const ini =
      name
        .split(" ")
        .filter(Boolean)
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "CO";
    return { displayName: name || "HR User", initials: ini, email: u?.email ?? "" };
  }, [session]);

  if (!session || session.user.role !== "company") return null;

  return (
    <div className="min-h-screen bg-surface-2">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 md:px-8">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="font-display text-sm font-semibold">Project X</div>
              <div className="text-[11px] text-muted-foreground">
                {companyLoading ? (
                  <Skeleton className="h-3 w-20" />
                ) : (
                  (company?.name ?? "Company Portal")
                )}
              </div>
            </div>
          </Link>

          {/* Search */}
          <div className="relative ml-2 hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search jobs, applicants, interviews…"
              className="h-9 rounded-lg pl-9"
              aria-label="Dashboard search"
            />
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <Settings className="h-4 w-4" />
            </Button>
            <div className="ml-2 hidden text-right text-xs md:block">
              <div className="font-medium">{displayName}</div>
              <div className="text-muted-foreground">{email}</div>
            </div>
            <div
              className="ml-2 grid h-8 w-8 place-items-center rounded-full bg-gradient-brand text-xs font-semibold text-primary-foreground"
              aria-hidden="true"
            >
              {initials}
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="ml-1">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-11 gap-1 bg-transparent p-0" role="tablist">
              {[
                { v: "overview", label: "Overview", icon: Building2 },
                { v: "jobs", label: "Jobs", icon: Briefcase },
                { v: "applicants", label: "Applicants", icon: Users },
                { v: "analytics", label: "Analytics", icon: BarChart3 },
              ].map((t) => {
                const Icon = t.icon;
                const active = tab === t.v;
                return (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    role="tab"
                    aria-selected={active}
                    className={`relative h-11 rounded-none border-b-2 px-3 text-sm data-[state=active]:bg-transparent data-[state=active]:shadow-none ${
                      active
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <div className="pt-6 pb-12">
              <TabsContent value="overview" className="mt-0">
                <OverviewTab company={company ?? null} loading={companyLoading} />
              </TabsContent>
              <TabsContent value="jobs" className="mt-0">
                <JobsTabEntry />
              </TabsContent>
              <TabsContent value="applicants" className="mt-0">
                <ComingSoonTab
                  icon={Users}
                  title="Applicant Pipeline"
                  body="Kanban board showing every candidate from Applied → Screening → Interview → Offer → Hired."
                  feature="Feature 3"
                />
              </TabsContent>
              <TabsContent value="analytics" className="mt-0">
                <ComingSoonTab
                  icon={LineChart}
                  title="Hiring Analytics"
                  body="Funnel metrics, source breakdown, time-to-hire, and offer acceptance rate — all in one view."
                  feature="Feature 4"
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </header>
    </div>
  );
}

// ── Overview tab ───────────────────────────────────────────────────────

interface OverviewTabProps {
  company: Company | null;
  loading: boolean;
}

function OverviewTab({ company, loading }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Welcome + company info */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <Card className="relative overflow-hidden border-primary/20 p-6">
          <div className="absolute inset-0 -z-0 opacity-20 [background:radial-gradient(800px_200px_at_80%_-20%,oklch(0.72_0.19_265),transparent_60%)]" aria-hidden="true" />
          <div className="relative">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : company ? (
                  <>
                    <h1 className="font-display text-2xl font-bold md:text-3xl">
                      {company.name}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {company.industry} · {company.size} employees
                    </p>
                    {company.website && (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 text-xs text-primary hover:underline"
                      >
                        {company.website}
                      </a>
                    )}
                  </>
                ) : (
                  <h1 className="font-display text-2xl font-bold">Welcome to your workspace</h1>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                <Badge
                  variant="outline"
                  className="w-fit border-success/30 bg-success/10 text-success"
                >
                  ✓ Registered
                </Badge>
                {company && !company.isVerified && (
                  <Badge
                    variant="outline"
                    className="w-fit border-warning/30 bg-warning/10 text-xs text-warning-foreground"
                  >
                    Pending verification
                  </Badge>
                )}
              </div>
            </div>

            {/* Hiring domains */}
            {company && company.hiringDomains.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Active hiring domains
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {company.hiringDomains.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      className="border-primary/20 bg-primary/5 text-primary"
                    >
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Quick start modules grid */}
      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Your workspace</h2>
            <p className="text-xs text-muted-foreground">Modules coming live in upcoming features.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m, i) => {
            const Icon = m.icon;
            const cardContent = (
              <Card
                className={`group p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 ${
                  m.to ? "cursor-pointer" : "cursor-not-allowed opacity-80"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      m.status === "Live"
                        ? "border-success/30 bg-success/10 text-success"
                        : m.status === "Beta"
                          ? "border-secondary/30 bg-secondary/10 text-secondary"
                          : "border-border text-muted-foreground"
                    }
                  >
                    {m.status}
                  </Badge>
                </div>
                <div className="mt-3 font-display text-sm font-semibold">{m.label}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.desc}</p>
              </Card>
            );
            return (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.05 * i }}
              >
                {m.to ? (
                  <Link to={m.to} className="block">
                    {cardContent}
                  </Link>
                ) : (
                  cardContent
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Recent activity — empty state */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display font-semibold">Recent activity</h3>
          <Button variant="ghost" size="sm" className="text-primary" disabled>
            See all
          </Button>
        </div>
        <div className="rounded-md border border-dashed border-border/70 bg-surface/60 p-6 text-center text-sm text-muted-foreground">
          No activity yet. Post your first job to start building your hiring pipeline.
        </div>
      </Card>
    </div>
  );
}

// ── Jobs tab entry (Feature 2: Role Posting) ───────────────────────────

function JobsTabEntry() {
  const { data: roles, isLoading } = useQuery<Role[]>({
    queryKey: ["company-roles"],
    queryFn: () => rolesService.list(),
    staleTime: 60 * 1000,
  });

  const counts = useMemo(() => {
    const all = roles ?? [];
    return {
      total: all.length,
      draft: all.filter((r) => r.status === "draft").length,
      published: all.filter((r) => r.status === "published").length,
      archived: all.filter((r) => r.status === "archived").length,
    };
  }, [roles]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative overflow-hidden p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
              <Briefcase className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">Role Postings</h2>
              <p className="mt-0.5 max-w-sm text-sm text-muted-foreground">
                Create, publish, archive and manage every role you&apos;re hiring for.
              </p>
            </div>
          </div>
          <Link to="/company-roles">
            <Button className="bg-gradient-brand text-primary-foreground shadow-soft">
              Manage roles
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total", value: counts.total },
            { label: "Draft", value: counts.draft },
            { label: "Published", value: counts.published },
            { label: "Archived", value: counts.archived },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border/60 bg-surface/60 p-3 text-center"
            >
              {isLoading ? (
                <Skeleton className="mx-auto h-6 w-8" />
              ) : (
                <div className="font-display text-xl font-bold">{stat.value}</div>
              )}
              <div className="mt-0.5 text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

// ── Coming-soon placeholder ────────────────────────────────────────────

interface ComingSoonTabProps {
  icon: typeof Briefcase;
  title: string;
  body: string;
  feature: string;
}

function ComingSoonTab({ icon: Icon, title, body, feature }: ComingSoonTabProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="mx-auto max-w-lg p-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
          <Icon className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-xl font-bold">{title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
        <Badge
          variant="outline"
          className="mt-4 border-primary/30 bg-primary/5 text-primary"
        >
          {feature} — coming soon
        </Badge>
      </Card>
    </motion.div>
  );
}

// ── Static module data ─────────────────────────────────────────────────

const MODULES: Array<{
  label: string;
  desc: string;
  icon: typeof Briefcase;
  status: "Live" | "Beta" | "Soon";
  to?: string;
}> = [
  {
    label: "Jobs",
    desc: "Publish and manage job listings.",
    icon: Briefcase,
    status: "Live",
    to: "/company-roles",
  },
  { label: "Applicants", desc: "AI-scored pipeline view.", icon: Users, status: "Soon" },
  { label: "AI Interview Studio", desc: "Structured AI interviews.", icon: Wand2, status: "Beta" },
  { label: "OA Builder", desc: "Coding & MCQ assessments.", icon: ClipboardList, status: "Soon" },
  { label: "Interview Templates", desc: "Battle-tested question sets.", icon: Layers, status: "Soon" },
  { label: "Candidate Ranking", desc: "Explainable AI ranking.", icon: Star, status: "Beta" },
  { label: "Analytics", desc: "Funnel & diversity metrics.", icon: LineChart, status: "Soon" },
  { label: "Settings", desc: "Team roles, SSO & integrations.", icon: Settings2, status: "Soon" },
];
