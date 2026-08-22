import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  LogOut,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/auth";

export interface DashboardStat {
  label: string;
  value: string;
  delta?: string;
  icon: LucideIcon;
  tone?: "primary" | "secondary" | "accent" | "success";
}

export interface DashboardModule {
  label: string;
  description: string;
  icon: LucideIcon;
  status?: "Live" | "Beta" | "Coming soon";
  accent?: "primary" | "secondary" | "accent";
}

export interface DashboardActivity {
  title: string;
  meta: string;
  status: string;
  tone?: "primary" | "success" | "warning" | "secondary";
}

export interface DashboardGoal {
  label: string;
  value: number;
  hint: string;
}

interface Props {
  role: "Candidate" | "Company" | "College";
  tagline: string;
  headline: string;
  subhead: string;
  primaryCta: { label: string; icon: LucideIcon };
  secondaryCta: { label: string; icon: LucideIcon };
  stats: DashboardStat[];
  modules: DashboardModule[];
  activity: DashboardActivity[];
  goals: DashboardGoal[];
  highlight: {
    eyebrow: string;
    title: string;
    body: string;
    icon: LucideIcon;
  };
}

const toneRing: Record<string, string> = {
  primary: "from-primary/15 to-primary/5 text-primary",
  secondary: "from-secondary/15 to-secondary/5 text-secondary",
  accent: "from-accent/25 to-accent/5 text-accent-foreground",
  success: "from-success/20 to-success/5 text-success",
};

const badgeTone: Record<string, string> = {
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/15 text-warning-foreground border-warning/30",
  secondary: "bg-secondary/10 text-secondary border-secondary/20",
};

export function EngagingDashboard({
  role,
  tagline,
  headline,
  subhead,
  primaryCta,
  secondaryCta,
  stats,
  modules,
  activity,
  goals,
  highlight,
}: Props) {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);

  const signOut = () => {
    logout();
    navigate({ to: "/" });
  };

  // If the logged-in user hasn't given us a real name yet, send them to
  // profile setup so the dashboard can greet them properly.
  useEffect(() => {
    if (session?.user && !session.user.firstName) {
      navigate({ to: "/auth/profile-setup" });
    }
  }, [session, navigate]);

  // Placeholder handler for buttons whose feature isn't wired yet. Replace the
  // toast with a real navigate / API call when the feature ships — every
  // button already flows through here so future work is a one-line swap.
  const handlePending = (label: string) => {
    toast(`${label} — coming soon`, {
      description: "This action will be wired to the API in the next milestone.",
    });
  };

  const u = session?.user;
  const displayName =
    u?.firstName || u?.lastName
      ? `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim()
      : u?.name ?? "";
  const firstName = u?.firstName ?? u?.name?.split(" ")[0] ?? "";
  const initialsSource = displayName || role;
  const initials =
    initialsSource
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || role[0];

  const PrimaryIcon = primaryCta.icon;
  const SecondaryIcon = secondaryCta.icon;
  const HighlightIcon = highlight.icon;

  return (
    <div className="min-h-screen bg-mesh">
      {/* Top bar */}
      <header className="glass-strong sticky top-0 z-30 border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <div className="font-display text-sm font-bold leading-none">Mirracle</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{role} Portal</div>
            </div>
          </Link>

          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={`Search ${role.toLowerCase()} workspace…`}
              className="h-10 rounded-xl border-border/70 bg-surface pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-gradient-brand" />
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
            <div className="hidden text-right text-xs md:block">
              <div className="font-medium text-foreground">{displayName || `${role} user`}</div>
              <div className="text-muted-foreground">{session?.user?.email ?? "preview@mirracle.ai"}</div>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-brand text-xs font-semibold text-primary-foreground">
              {initials}
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="ml-1">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-3xl border border-primary/15 bg-hero p-6 md:p-10 shadow-soft"
        >
          <div className="absolute inset-0 -z-10 opacity-60 bg-gradient-brand-soft" />
          <Badge className="bg-surface/70 text-primary border-primary/30 backdrop-blur">{tagline}</Badge>
          {firstName && (
            <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
              Hey {firstName} —
            </div>
          )}
          <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold leading-tight md:text-5xl">
            {headline.split("|").map((chunk, i) =>
              i === 1 ? (
                <span key={i} className="text-gradient">
                  {chunk}
                </span>
              ) : (
                <span key={i}>{chunk}</span>
              ),
            )}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground md:text-lg">{subhead}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={() => handlePending(primaryCta.label)}
              className="bg-gradient-brand text-primary-foreground shadow-glow hover:opacity-95"
            >
              <PrimaryIcon className="mr-2 h-4 w-4" /> {primaryCta.label}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => handlePending(secondaryCta.label)}
              className="border-primary/30 bg-surface/60 backdrop-blur"
            >
              <SecondaryIcon className="mr-2 h-4 w-4" /> {secondaryCta.label}
            </Button>
          </div>
        </motion.section>

        {/* Stats */}
        {stats.length > 0 ? (
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s, i) => {
              const Icon = s.icon;
              return (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.05 * i }}
                >
                  <Card className="group relative overflow-hidden border-border/70 p-5 transition-shadow hover:shadow-soft">
                    <div
                      className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${toneRing[s.tone ?? "primary"]} opacity-70 blur-xl transition-transform group-hover:scale-125`}
                    />
                    <div className="flex items-center justify-between">
                      <div
                        className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${toneRing[s.tone ?? "primary"]}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      {s.delta && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          <TrendingUp className="h-3 w-3" /> {s.delta}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 font-display text-2xl font-bold">{s.value}</div>
                    <div className="text-sm text-muted-foreground">{s.label}</div>
                  </Card>
                </motion.div>
              );
            })}
          </section>
        ) : (
          <section className="mt-8 rounded-2xl border border-dashed border-border/70 bg-surface/60 p-8 text-center">
            <div className="font-display text-base font-semibold">No stats yet, {firstName || "there"}.</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Your numbers are personal — they populate as you and your team start using the {role.toLowerCase()} workspace.
            </p>
          </section>
        )}

        {/* Modules + side rail */}
        <section className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="font-display text-xl font-bold">Your workspace</h2>
                <p className="text-sm text-muted-foreground">
                  Everything you can launch from the {role.toLowerCase()} portal.
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-primary">
                View all <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {modules.map((m, i) => {
                const Icon = m.icon;
                const accent = m.accent ?? "primary";
                return (
                  <motion.div
                    key={m.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: 0.03 * i }}
                  >
                    <Card
                      onClick={() => handlePending(m.label)}
                      className="group relative h-full cursor-pointer overflow-hidden border-border/70 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-glow"
                    >
                      <div className="flex items-start justify-between">
                        <div
                          className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${toneRing[accent]}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        {m.status && (
                          <Badge
                            variant="outline"
                            className={
                              m.status === "Live"
                                ? "border-success/30 bg-success/10 text-success"
                                : m.status === "Beta"
                                  ? "border-secondary/30 bg-secondary/10 text-secondary"
                                  : "border-border bg-muted text-muted-foreground"
                            }
                          >
                            {m.status}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <div className="font-display text-base font-semibold">{m.label}</div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            {/* Highlight card */}
            <Card className="relative overflow-hidden border-primary/20 bg-gradient-brand p-6 text-primary-foreground shadow-glow">
              <div className="absolute inset-0 -z-0 opacity-30 [background:radial-gradient(600px_200px_at_100%_0%,white,transparent_60%)]" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur">
                  <HighlightIcon className="h-3.5 w-3.5" /> {highlight.eyebrow}
                </div>
                <h3 className="mt-3 font-display text-xl font-bold">{highlight.title}</h3>
                <p className="mt-1 text-sm text-primary-foreground/85">{highlight.body}</p>
                <Button size="sm" variant="secondary" className="mt-4 bg-background text-primary hover:bg-background/90">
                  Get started <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </Card>

            {/* Goals */}
            <Card className="border-border/70 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display font-semibold">Progress this week</h3>
                <Badge variant="outline" className="border-primary/30 text-primary">
                  Live
                </Badge>
              </div>
              {goals.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 bg-surface/60 p-4 text-center text-sm text-muted-foreground">
                  No goals set yet. Add one to start tracking weekly progress.
                </div>
              ) : (
                <div className="space-y-4">
                  {goals.map((g) => (
                    <div key={g.label}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-medium">{g.label}</span>
                        <span className="text-muted-foreground">{g.value}%</span>
                      </div>
                      <Progress value={g.value} className="h-2" />
                      <div className="mt-1 text-xs text-muted-foreground">{g.hint}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Activity */}
            <Card className="border-border/70 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display font-semibold">Recent activity</h3>
                <Button variant="ghost" size="sm" className="text-primary">
                  See all
                </Button>
              </div>
              {activity.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 bg-surface/60 p-4 text-center text-sm text-muted-foreground">
                  Nothing yet — anything you do here shows up in this feed.
                </div>
              ) : (
                <ul className="space-y-3">
                  {activity.map((a) => (
                    <li
                      key={a.title}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-surface p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.meta}</div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${badgeTone[a.tone ?? "primary"]}`}
                      >
                        {a.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </section>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-primary/30 bg-primary-soft/40 p-5">
          <div className="text-sm">
            <span className="font-semibold text-foreground">Phase 1 preview.</span>{" "}
            <span className="text-muted-foreground">
              Live data + deep module screens ship in the next {role.toLowerCase()} prompt.
            </span>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/portals">Switch portal</Link>
            </Button>
            <Button asChild size="sm" className="bg-gradient-brand text-primary-foreground">
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
