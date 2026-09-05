import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Award,
  Bell,
  Brain,
  Briefcase,
  Building2,
  Code2,
  Copy,
  Dna,
  FileText,
  Filter,
  Flame,
  Github,
  Loader2,
  LogIn,
  LogOut,
  Play,
  Search,
  Settings,
  Sparkles,
  Target,
  TerminalSquare,
  Users,
  Video,
  X as CloseIcon,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuthStore } from "@/store/auth";
import { useCandidateGuard } from "@/hooks/candidate/use-candidate-guard";
import { useResumeAnalysisStore } from "@/store/candidate/resumeAnalysis";
import { ProfileAnalyzerPanel, ScoreRing, verdictTone } from "@/components/candidate/ProfileSyncPanel";
import { computeDnaBreakdown, computeDnaScore, computeSkillDna } from "@/lib/skillDna";
import { practiceService } from "@/services/api/candidate/practice";
import { peerService } from "@/services/api/candidate/peer";
import { toast } from "sonner";
import { PeerInterviewMatchModal } from "@/components/candidate/PeerInterviewMatchModal";
import { usePeerInterviewStore } from "@/store/candidate/peerInterview";
import { extractLeetCodeUsername, syncService } from "@/services/api/candidate/sync";
import { ApiClientError } from "@/services/api/client";
import type { PracticeRecommendations } from "@/types/candidate/practice";

export const Route = createFileRoute("/candidate")({
  component: CandidatePortal,
});

// ---------- data ----------
// No shared demo data. Each user starts empty and their own activity is per-user.
// Wire these to the API / per-user store later.

const learningCurve: { week: string; score: number; hours: number }[] = [];

const companyTracks: {
  company: string;
  tag: "FAANG" | "Product" | "India";
  problems: number;
  focus: string;
  difficulty: "Easy" | "Medium" | "Hard";
}[] = [];

// ---------- component ----------

function CandidatePortal() {
  const [tab, setTab] = useState("overview");
  const navigate = useNavigate();
  useCandidateGuard();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const clearResumeAnalysis = useResumeAnalysisStore((s) => s.clear);
  const setResumeAnalysisResult = useResumeAnalysisStore((s) => s.setResult);

  // Resume analysis is persisted client-side (localStorage) with no account
  // scoping of its own, so a previous account's result could otherwise
  // linger and show up under a different login on the same browser. Clear
  // immediately on every account change, then hydrate from this account's
  // own saved analysis in the database (never trust the stale local cache).
  useEffect(() => {
    if (!session?.user.id) return;
    clearResumeAnalysis();
    let cancelled = false;
    syncService
      .getMyResumeAnalysis()
      .then((saved) => {
        if (cancelled || !saved) return;
        setResumeAnalysisResult(saved.resume_analysis, saved.role_target);
      })
      .catch(() => {
        // Best-effort hydration — if it fails, the account simply shows no
        // resume analysis yet instead of risking stale/wrong-account data.
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, clearResumeAnalysis, setResumeAnalysisResult]);

  const displayName = useMemo(() => {
    const u = session?.user;
    if (!u) return "";
    if (u.firstName || u.lastName) return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    return u.name ?? "";
  }, [session]);

  const initials = useMemo(() => {
    const u = session?.user;
    const source = u?.firstName || u?.lastName ? `${u?.firstName ?? ""} ${u?.lastName ?? ""}` : u?.name;
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
    clearResumeAnalysis();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-surface-2">
      {/* Top bar — compact, no gradient wash */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 md:px-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="font-display text-sm font-semibold">Mirracle</div>
              <div className="text-[11px] text-muted-foreground">Candidate</div>
            </div>
          </Link>

          <div className="relative ml-2 hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Jump to a problem, module, company…" className="h-9 rounded-lg pl-9" />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
            <div className="ml-2 hidden text-right text-xs md:block">
              <div className="font-medium">{displayName || "New candidate"}</div>
              <div className="text-muted-foreground">{session?.user?.email ?? "you@mirracle.ai"}</div>
            </div>
            <div className="ml-2 grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="ml-1">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>

        {/* Section tabs live in the header — the three sections the user asked for */}
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-11 gap-1 bg-transparent p-0">
              {[
                { v: "overview", label: "Overview", icon: Activity },
                { v: "analyzer", label: "Analyzer", icon: Zap },
                { v: "practice", label: "Practice", icon: TerminalSquare },
                { v: "dna", label: "Skill DNA", icon: Dna },
              ].map((t) => {
                const Icon = t.icon;
                const active = tab === t.v;
                return (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    className={`relative h-11 rounded-none border-b-2 px-3 text-sm data-[state=active]:bg-transparent data-[state=active]:shadow-none ${
                      active
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="mr-1.5 h-4 w-4" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* Tab bodies */}
            <div className="pt-6 pb-12">
              <TabsContent value="overview" className="mt-0" forceMount>
                <OverviewTab />
              </TabsContent>
              <TabsContent value="analyzer" className="mt-0" forceMount>
                <AnalyzerTab />
              </TabsContent>
              <TabsContent value="practice" className="mt-0" forceMount>
                <PracticeTab />
              </TabsContent>
              <TabsContent value="dna" className="mt-0" forceMount>
                <TechDnaTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </header>
    </div>
  );
}

// ---------- Overview ----------

function OverviewTab() {
  const session = useAuthStore((s) => s.session);
  const [peerModalOpen, setPeerModalOpen] = useState(false);
  const activePeerRoom = usePeerInterviewStore((s) => s.activeRoom);
  const clearPeerRoom = usePeerInterviewStore((s) => s.clearActiveRoom);
  const firstName =
    session?.user?.firstName ?? session?.user?.name?.split(" ")[0] ?? "";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{today}</div>
          <h1 className="mt-1 font-display text-2xl font-semibold md:text-3xl">
            Hey {firstName || "there"} — welcome to your workspace.
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {firstName
              ? `Nothing recorded yet, ${firstName}. Kick off a mock or connect your accounts to start building your profile.`
              : "Nothing recorded yet. Kick off a mock or connect your accounts to start building your profile."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="bg-gradient-brand text-primary-foreground">
            <Play className="mr-2 h-4 w-4" /> Start a mock
          </Button>
          <Button size="sm" variant="outline">
            <FileText className="mr-2 h-4 w-4" /> Upload resume
          </Button>
        </div>
      </div>

      {/* Stat strip incl. Learning curve */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Target} label="Industry readiness" value="—" hint="Complete 1 mock to unlock" />
        <StatCard icon={Briefcase} label="Applications" value="0" hint="No applications yet" />
        <StatCard icon={Flame} label="Streak" value="0 days" hint="Start today" />
        <LearningCurveCard />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionHeader title="Your workspace" hint="Small tools, one job each." />
          <div className="grid gap-3 sm:grid-cols-2">
            <ModuleCard icon={Brain} title="AI Interview" body="Adaptive mocks, honest feedback." status="Live" />
            {activePeerRoom ? (
              <ActivePeerRoomCard
                roomId={activePeerRoom.roomId}
                onEnter={async () => {
                  const peermeetUrl = import.meta.env.VITE_PEERMEET_URL as string | undefined;
                  if (!peermeetUrl) {
                    toast.error("Peer Interview is not configured. Set VITE_PEERMEET_URL.");
                    return;
                  }
                  try {
                    const { token } = await peerService.createSessionToken();
                    const url = new URL("/", peermeetUrl);
                    url.searchParams.set("token", token);
                    url.searchParams.set("room", activePeerRoom.roomId);
                    url.searchParams.set("init", "1");
                    url.searchParams.set("private", activePeerRoom.keepPrivate ? "1" : "0");
                    window.open(url.toString(), "_blank", "noopener,noreferrer");
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Could not open Peer Interview.",
                    );
                  }
                }}
                onCopy={async () => {
                  try {
                    await navigator.clipboard.writeText(activePeerRoom.roomId);
                    toast.success("Room ID copied");
                  } catch {
                    toast.error("Could not copy — select the ID and copy manually.");
                  }
                }}
                onEnd={() => {
                  clearPeerRoom();
                  toast.success("Peer Interview session cleared.");
                }}
              />
            ) : (
              <ModuleCard
                icon={Users}
                title="Peer Interview"
                body="Trade rounds with other candidates."
                status="Live"
                onClick={() => setPeerModalOpen(true)}
              />
            )}
            <ModuleCard icon={Video} title="Expert Interview" body="Book seniors from real hiring loops." status="Beta" />
            <ModuleCard icon={FileText} title="Resume Analyzer" body="ATS score, gaps, rewrites for the role." status="Live" />
            <ModuleCard icon={TerminalSquare} title="LeetCode Practice" body="Company-wise DSA sets and timed rounds." status="Live" />
            <ModuleCard icon={Dna} title="Skill DNA" body="What your work says you actually are." status="Beta" />
          </div>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display font-semibold">First step</h3>
              <Badge variant="outline" className="border-primary/30 text-primary">Focus</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              A 10-minute intro mock benchmarks where you actually stand — no prep required.
            </p>
            <Button size="sm" className="mt-4 bg-gradient-brand text-primary-foreground">Run intro mock</Button>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display font-semibold">Recent</h3>
              <Button variant="ghost" size="sm" className="text-primary h-7">See all</Button>
            </div>
            <div className="rounded-md border border-dashed border-border/70 bg-surface/60 p-4 text-center text-sm text-muted-foreground">
              No activity yet. Anything you do here shows up in this feed.
            </div>
          </Card>
        </aside>
      </div>

      <PeerInterviewMatchModal open={peerModalOpen} onOpenChange={setPeerModalOpen} />
    </div>
  );
}

function ActivePeerRoomCard({
  roomId,
  onEnter,
  onCopy,
  onEnd,
}: {
  roomId: string;
  onEnter: () => void;
  onCopy: () => void;
  onEnd: () => void;
}) {
  return (
    <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-surface to-surface p-4">
      <div className="flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          Room ready
        </Badge>
      </div>
      <div className="mt-3">
        <div className="font-display text-sm font-semibold">Peer Interview</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Share this room ID with your peer so they can join.
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{roomId}</code>
        <Button size="sm" variant="outline" onClick={onCopy} aria-label="Copy room ID">
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="flex-1 bg-gradient-brand text-primary-foreground"
          onClick={onEnter}
        >
          <LogIn className="mr-1.5 h-3.5 w-3.5" />
          Enter interview
        </Button>
        <Button size="sm" variant="ghost" onClick={onEnd} aria-label="End session">
          <CloseIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}

// ---------- Analyzer ----------

function AnalyzerTab() {
  const resumeResult = useResumeAnalysisStore((s) => s.result);
  const analyzedRole = useResumeAnalysisStore((s) => s.role);
  const tone = resumeResult ? verdictTone(resumeResult.overall_rating.score) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            Connect your profiles to build your candidate signal.
          </p>
        </div>
      </div>

      {/* Sync + AI analysis */}
      <ProfileAnalyzerPanel />

      {resumeResult && tone ? (
        <div className={`relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br ${tone.ring} via-surface to-surface p-6`}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ScoreRing score={resumeResult.overall_rating.score} />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-muted-foreground">
                <Award className="h-3.5 w-3.5 text-primary" />
                Latest Analysis{analyzedRole ? ` · ${analyzedRole}` : ""}
              </div>
              <Badge className={`${tone.text} border-current/30 bg-current/10 text-base font-semibold px-3 py-1`}>
                {resumeResult.overall_rating.verdict}
              </Badge>
              <p className="text-lg leading-relaxed text-foreground/90">
                {resumeResult.overall_rating.summary}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold">No analysis yet</h2>
              <p className="text-base text-muted-foreground">Your latest results will be summarized here.</p>
            </div>
            <Badge variant="outline">No runs yet</Badge>
          </div>
          <div className="rounded-lg border border-dashed border-border/70 bg-surface/60 p-6 text-center text-base text-muted-foreground">
            Upload your resume above — insights show here once your first analysis completes.
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Practice (LeetCode platform) ----------

function PracticeTab() {
  const [filter, setFilter] = useState<"All" | "FAANG" | "Product" | "India">("All");
  const list = companyTracks.filter((c) => (filter === "All" ? true : c.tag === filter));

  const [lcInput, setLcInput] = useState("");
  const [recommendations, setRecommendations] = useState<PracticeRecommendations | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSyncLeetCode = async () => {
    const username = extractLeetCodeUsername(lcInput);
    if (!username) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const data = await practiceService.getRecommendations(username);
      setRecommendations(data);
    } catch (err: unknown) {
      setSyncError(err instanceof ApiClientError ? err.message : "Could not reach the server.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Practice — Company DSA rounds</h1>
          <p className="text-sm text-muted-foreground">
            Curated question sets that mirror what each company actually asks in DSA rounds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {(["All", "FAANG", "Product", "India"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              className={filter === f ? "bg-gradient-brand text-primary-foreground" : ""}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <h3 className="mt-3 font-display text-base font-semibold">No practice tracks loaded yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sync your LeetCode to auto-generate company DSA tracks tailored to your gaps.
          </p>
          <Button size="sm" className="mt-4 bg-gradient-brand text-primary-foreground">
            <Play className="mr-2 h-4 w-4" /> Sync LeetCode
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <Card key={c.company} className="group cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30">
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <Badge variant="outline" className="text-xs">{c.tag}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="font-display text-base font-semibold">{c.company}</div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </div>
              <div className="mt-1 text-sm text-muted-foreground">Focus: {c.focus}</div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{c.problems} problems</span>
                <span
                  className={
                    c.difficulty === "Hard"
                      ? "text-destructive"
                      : c.difficulty === "Medium"
                        ? "text-warning"
                        : "text-success"
                  }
                >
                  {c.difficulty}
                </span>
              </div>
              <Button size="sm" className="mt-4 w-full bg-gradient-brand text-primary-foreground">
                <Play className="mr-2 h-4 w-4" /> Start round
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Prioritized practice</h2>
            <p className="text-sm text-muted-foreground">
              Ranked by your weakest LeetCode topics — click any question to solve it on leetcode.com.
            </p>
          </div>
        </div>

        {!recommendations && !syncing && (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-border/70 bg-surface/60 p-6 sm:flex-row sm:items-center">
            <Input
              placeholder="https://leetcode.com/u/username"
              value={lcInput}
              onChange={(e) => setLcInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lcInput.trim() && handleSyncLeetCode()}
              className="flex-1"
            />
            <Button
              onClick={handleSyncLeetCode}
              disabled={!lcInput.trim()}
              className="bg-gradient-brand text-primary-foreground"
            >
              <Play className="mr-2 h-4 w-4" /> Sync LeetCode
            </Button>
          </div>
        )}

        {syncing && (
          <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border/70 bg-surface/60 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing your LeetCode topic strengths…
          </div>
        )}

        {syncError && (
          <p className="mt-2 text-sm text-destructive">{syncError}</p>
        )}

        {recommendations && (
          <div className="space-y-3">
            {recommendations.weak_topics.map((topic) => (
              <Collapsible key={topic.tag_slug} defaultOpen className="rounded-md border border-border/70">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{topic.tier}</Badge>
                    <span className="text-sm font-semibold">{topic.tag_name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{topic.problems_solved} solved</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/70 px-4">
                  {topic.fetch_warning ? (
                    <p className="py-3 text-sm text-muted-foreground">{topic.fetch_warning}</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {topic.questions.map((q) => (
                        <li key={q.title_slug} className="flex items-center justify-between gap-3 py-3">
                          <a
                            href={q.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {q.title}
                          </a>
                          <Badge
                            variant="outline"
                            className={
                              q.difficulty === "Hard"
                                ? "border-destructive/30 text-destructive"
                                : q.difficulty === "Medium"
                                  ? "border-warning/40 text-warning"
                                  : "border-success/40 text-success"
                            }
                          >
                            {q.difficulty}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
            {recommendations.warnings.length > 0 && (
              <p className="text-xs text-muted-foreground">{recommendations.warnings.join(" ")}</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Skill DNA ----------

function TechDnaTab() {
  const resumeResult = useResumeAnalysisStore((s) => s.result);
  const analyzedRole = useResumeAnalysisStore((s) => s.role);
  const matchedSkills = useMemo(
    () => resumeResult?.role_fit.matched_skills ?? [],
    [resumeResult],
  );
  const skillDna = useMemo(() => computeSkillDna(matchedSkills), [matchedSkills]);
  const dnaBreakdown = useMemo(() => computeDnaBreakdown(matchedSkills), [matchedSkills]);
  const dnaScore = useMemo(() => computeDnaScore(matchedSkills), [matchedSkills]);
  const hasData = matchedSkills.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Skill DNA</h1>
          <p className="text-sm text-muted-foreground">
            {hasData
              ? `Computed from the skills your resume matched against ${analyzedRole || "your target role"}.`
              : "The mix of skills in your DNA — pulled from your resume, weighted by role fit."}
          </p>
        </div>
        <Badge className="bg-primary/10 text-primary border-primary/20">
          DNA score {dnaScore !== null ? `${dnaScore}/100` : "—/100"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Skill radar</h2>
            <span className="text-xs text-muted-foreground">
              {hasData ? "Recomputed nightly" : "Awaiting your first sync"}
            </span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={skillDna} outerRadius="75%">
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis dataKey="skill" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} />
                <Radar
                  dataKey="value"
                  stroke="var(--color-primary)"
                  fill="var(--color-primary)"
                  fillOpacity={hasData ? 0.25 : 0.05}
                />
                <Tooltip
                  contentStyle={{ background: "var(--color-popover)", color: "var(--color-popover-foreground)", border: "1px solid var(--color-border)", borderRadius: 8 }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-display text-lg font-semibold">Breakdown</h2>
          {dnaBreakdown.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 bg-surface/60 p-6 text-center text-sm text-muted-foreground">
              Connect an analyzer to unlock a per-dimension breakdown of your DNA.
            </div>
          ) : (
            <div className="space-y-4">
              {dnaBreakdown.map((d) => (
                <div key={d.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{d.label}</span>
                    <span className="text-muted-foreground">{d.value}/100</span>
                  </div>
                  <Progress value={d.value} className="h-2" />
                  <div className="mt-1 text-xs text-muted-foreground">{d.note}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">What this actually means</h2>
            <p className="text-sm text-muted-foreground">Written in plain English once we have enough signal.</p>
          </div>
          <Award className="h-5 w-5 text-primary" />
        </div>
        {hasData && resumeResult ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-surface/60 p-5 text-sm leading-relaxed text-foreground/90">
            <p>{resumeResult.role_fit.fit_summary}</p>
            <p className="text-muted-foreground">{resumeResult.overall_rating.summary}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-surface/60 p-6 text-center text-sm text-muted-foreground">
            Your personal DNA read-out appears here after your first resume analysis — run one from the Analyzer tab.
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- small pieces ----------

function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  hint,
}: {
  icon: typeof Target;
  label: string;
  value: string;
  delta?: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        {delta && <span className="text-xs font-medium text-success">{delta}</span>}
      </div>
      <div className="mt-3 font-display text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div>}
    </Card>
  );
}

function LearningCurveCard() {
  const hasData = learningCurve.length >= 2;
  const latest = hasData ? learningCurve[learningCurve.length - 1].score : 0;
  const first = hasData ? learningCurve[0].score : 0;
  const delta = latest - first;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary/10 text-secondary">
          <Activity className="h-4 w-4" />
        </div>
        {hasData ? (
          <span className="text-xs font-medium text-success">+{delta} in {learningCurve.length} wks</span>
        ) : (
          <span className="text-xs text-muted-foreground">No data yet</span>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <div>
          <div className="font-display text-xl font-semibold">{hasData ? latest : "—"}</div>
          <div className="text-xs text-muted-foreground">Learning curve</div>
        </div>
      </div>
      <div className="mt-2 -mx-1 h-14">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={learningCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="lc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="week" hide />
              <YAxis hide domain={[0, 100]} />
              <Tooltip
                cursor={{ stroke: "var(--color-border)" }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-popover)", color: "var(--color-popover-foreground)" }}
              />
              <Area type="monotone" dataKey="score" stroke="var(--color-primary)" strokeWidth={2} fill="url(#lc)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-[11px] text-muted-foreground">
            Complete a session to plot your curve
          </div>
        )}
      </div>
    </Card>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function ModuleCard({
  icon: Icon,
  title,
  body,
  status,
  onClick,
}: {
  icon: typeof Brain;
  title: string;
  body: string;
  status: "Live" | "Beta" | "Coming soon";
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="group cursor-pointer p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30"
    >
      <div className="flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <Badge
          variant="outline"
          className={
            status === "Live"
              ? "border-success/30 bg-success/10 text-success"
              : status === "Beta"
                ? "border-secondary/30 bg-secondary/10 text-secondary"
                : "border-border text-muted-foreground"
          }
        >
          {status}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="font-display text-sm font-semibold">{title}</div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </Card>
  );
}

function AnalyzerCard({
  icon: Icon,
  title,
  body,
  cta,
  stat,
}: {
  icon: typeof FileText;
  title: string;
  body: string;
  cta: string;
  stat: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-xs text-muted-foreground">{stat}</span>
      </div>
      <div className="mt-4 font-display text-base font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Button size="sm" className="mt-4 bg-gradient-brand text-primary-foreground">
        {cta}
      </Button>
    </Card>
  );
}
