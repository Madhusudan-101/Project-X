/**
 * ProfileSyncPanel
 * ────────────────
 * Three-layer UI:
 *   1. GitHubSyncCard  + LeetCodeSyncCard  — independent profile fetchers
 *   2. "Run AI Analysis" CTA — appears once at least one profile is synced
 *   3. AIAnalysisResultCard — Gemini analysis result rendered below the CTA
 *
 * ProfileAnalyzerPanel is the exported composite that wires all three layers.
 */

import { useState, useCallback } from "react";
import {
  Github,
  Code2,
  Loader2,
  ExternalLink,
  Star,
  Users,
  GitFork,
  Flame,
  Trophy,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Brain,
  ChevronDown,
  ChevronUp,
  History,
  Tag,
  Clock,
  FolderGit2,
  BookOpen,
  FileText,
  PenLine,
  Target,
  Award,
  Swords,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  syncService,
  extractGitHubUsername,
  extractLeetCodeUsername,
  extractCodeforcesHandle,
} from "@/services/api/sync";
import { useResumeAnalysisStore } from "@/store/resumeAnalysis";
import { TECH_ROLES } from "@/types/sync";
import type {
  GitHubProfileData,
  LeetCodeProfileData,
  CodeforcesProfileData,
  AnalysisResult,
  FormattedMetrics,
  ResumeAnalysisResult,
} from "@/types/sync";

// ── Score ring (SVG donut) ────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;

  const colorClass =
    score >= 85
      ? { text: "text-emerald-500", stroke: "stroke-emerald-500" }
      : score >= 65
        ? { text: "text-primary", stroke: "stroke-primary" }
        : score >= 40
          ? { text: "text-amber-500", stroke: "stroke-amber-500" }
          : { text: "text-destructive", stroke: "stroke-destructive" };

  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          className="stroke-border"
          strokeWidth="9"
        />
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          className={colorClass.stroke}
          strokeWidth="9"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display text-3xl font-bold leading-none ${colorClass.text}`}>
          {score}
        </span>
        <span className="mt-0.5 text-[10px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

// ── Rating badge ──────────────────────────────────────────────────────

const ratingStyle = {
  Sustained: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Fragmented: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Spiky: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

// ── AI Analysis Result Card ───────────────────────────────────────────

function AIAnalysisResultCard({ result }: { result: AnalysisResult }) {
  const greenFlags = result.career_alignment?.green_flags ?? [];
  const redFlags = result.career_alignment?.red_flags ?? [];
  const recommendedRoles = result.career_alignment?.recommended_roles ?? [];
  const tone = verdictTone(result.overall_score);
  const complexityColors = {
    Low: "border-muted bg-muted/20 text-muted-foreground",
    Medium: "border-primary/20 bg-primary/10 text-primary",
    High: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    Advanced: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 duration-400 space-y-5">
      {/* Hero — score, pacing verdict and headline evaluation, front and center */}
      <div className={`relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br ${tone.ring} via-surface to-surface p-6`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing score={result.overall_score} />
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Brain className="h-3.5 w-3.5 text-primary" />
              Employability Analysis Summary
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-semibold">AI Suitability Assessment</span>
              <Badge className={`${ratingStyle[result.consistency_analysis.rating] ?? "border-border bg-muted text-muted-foreground"} text-sm font-semibold`}>
                {result.consistency_analysis.rating} Pacing
              </Badge>
            </div>
            <p className="text-lg leading-relaxed text-foreground/90">
              {result.consistency_analysis.evaluation}
            </p>
          </div>
        </div>
      </div>

      {/* Chunked, tabbed detail — mirrors the Resume Analyzer's tab layout */}
      <Tabs defaultValue="dsa" className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-surface/60 p-1.5">
          <TabsTrigger value="dsa" className="text-sm">
            <Trophy className="mr-1.5 h-3.5 w-3.5" />
            DSA Profile
          </TabsTrigger>
          <TabsTrigger value="projects" className="text-sm">
            <Code2 className="mr-1.5 h-3.5 w-3.5" />
            Project Rigor
          </TabsTrigger>
          <TabsTrigger value="career" className="text-sm">
            <Users className="mr-1.5 h-3.5 w-3.5" />
            Career Alignment
            {redFlags.length > 0 && (
              <Badge className="ml-1.5 h-5 min-w-5 justify-center rounded-full border-rose-500/30 bg-rose-500/10 px-1 text-xs text-rose-500">
                {redFlags.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="roadmap" className="text-sm">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Roadmap
          </TabsTrigger>
        </TabsList>

        {/* DSA Skill & Topic Distribution (LeetCode + Codeforces) */}
        <TabsContent value="dsa" className="space-y-5 pt-4">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2.5">
              <div className="text-sm font-semibold text-emerald-500 uppercase tracking-wider">Strong Topics</div>
              <div className="flex flex-wrap gap-2">
                {result.dsa_skills.strong_topics.map((tag) => (
                  <Badge
                    key={tag}
                    className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-sm px-3 py-1.5"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-sm font-semibold text-amber-500 uppercase tracking-wider">Growth Areas</div>
              <div className="flex flex-wrap gap-2">
                {result.dsa_skills.growth_areas.map((tag) => (
                  <Badge
                    key={tag}
                    className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/20 text-sm px-3 py-1.5"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="text-base leading-relaxed text-muted-foreground bg-surface-2/20 p-4 rounded-xl border border-border/40">
            <span className="font-semibold block mb-1 text-foreground text-sm uppercase tracking-wider">DSA Depth Summary</span>
            {result.dsa_skills.algorithmic_depth_summary}
          </div>
        </TabsContent>

        {/* GitHub Project Depth & Implementation Rigor */}
        <TabsContent value="projects" className="space-y-4 pt-4">
          {result.project_rigor.map((repo, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-surface/40 p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <span className="font-display font-semibold text-base text-foreground">
                  {repo.repo_name}
                </span>
                <Badge className={`${complexityColors[repo.inferred_complexity] ?? "border-border text-foreground"} text-xs font-semibold px-2.5 py-1 shrink-0`}>
                  {repo.inferred_complexity} Complexity
                </Badge>
              </div>

              <p className="text-base leading-relaxed text-muted-foreground">
                {repo.analysis}
              </p>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {repo.skills_developed.map((skill) => (
                  <Badge key={skill} variant="outline" className="text-xs px-2 py-0.5 text-muted-foreground border-border/80">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* Career Alignment & Flags */}
        <TabsContent value="career" className="space-y-5 pt-4">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-violet-500">
              <Users className="h-3.5 w-3.5" />
              Recommended Career Tracks
            </h4>
            <div className="flex flex-wrap gap-2">
              {recommendedRoles.map((role) => (
                <Badge key={role} className="bg-primary/10 text-primary border-primary/20 text-sm px-3 py-1.5">
                  {role}
                </Badge>
              ))}
            </div>
          </div>

          {greenFlags.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-emerald-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                Observed Green Flags
              </h4>
              <ul className="space-y-2">
                {greenFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 text-base leading-relaxed text-foreground/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {redFlags.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-rose-500">
                <AlertCircle className="h-3.5 w-3.5" />
                Risk Factors / Red Flags
              </h4>
              <ul className="space-y-2">
                {redFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 text-base leading-relaxed text-foreground/90">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {greenFlags.length === 0 && redFlags.length === 0 && (
            <div className="text-base text-muted-foreground text-center py-4">No flags analyzed.</div>
          )}
        </TabsContent>

        {/* Actionable Engineering Mentorship Feedback */}
        <TabsContent value="roadmap" className="pt-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Actionable Engineering Roadmap
            </h4>
            <p className="mt-3 text-base leading-relaxed text-foreground/90 font-medium">
              {result.actionable_feedback}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Resume Analysis Result ────────────────────────────────────────────

function verdictTone(score: number) {
  if (score >= 85) return { text: "text-emerald-500", ring: "from-emerald-500/15" };
  if (score >= 65) return { text: "text-primary", ring: "from-primary/15" };
  if (score >= 40) return { text: "text-amber-500", ring: "from-amber-500/15" };
  return { text: "text-destructive", ring: "from-destructive/15" };
}

function ResumeAnalysisResultView({
  result,
  role,
}: {
  result: ResumeAnalysisResult;
  role: string;
}) {
  const { overall_rating, role_fit, detected_discrepancies, strengths, weaknesses, resume_corrections, next_week_action_plan } =
    result;
  const tone = verdictTone(overall_rating.score);

  return (
    <div className="space-y-5 pt-5 border-t border-border/60 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Hero — the headline verdict, front and center */}
      <div className={`relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br ${tone.ring} via-surface to-surface p-6`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing score={overall_rating.score} />
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Award className="h-3.5 w-3.5 text-primary" />
              Overall Resume Rating
            </div>
            <Badge className={`${tone.text} border-current/30 bg-current/10 text-sm font-semibold px-3 py-1`}>
              {overall_rating.verdict}
            </Badge>
            <p className="text-lg leading-relaxed text-foreground/90">
              {overall_rating.summary}
            </p>
          </div>
        </div>
      </div>

      {/* Chunked, tabbed detail — easier to read than one long wall of text */}
      <Tabs defaultValue="fit" className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-surface/60 p-1.5">
          <TabsTrigger value="fit" className="text-sm">
            <Target className="mr-1.5 h-3.5 w-3.5" />
            Role Fit
          </TabsTrigger>
          <TabsTrigger value="discrepancies" className="text-sm">
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            Discrepancies
            {detected_discrepancies.length > 0 && (
              <Badge className="ml-1.5 h-5 min-w-5 justify-center rounded-full border-rose-500/30 bg-rose-500/10 px-1 text-xs text-rose-500">
                {detected_discrepancies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="feedback" className="text-sm">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Strengths & Fixes
          </TabsTrigger>
          <TabsTrigger value="plan" className="text-sm">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            7-Day Plan
          </TabsTrigger>
        </TabsList>

        {/* Role fit */}
        <TabsContent value="fit" className="space-y-5 pt-4">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-violet-500">
              <Target className="h-3.5 w-3.5" />
              Fit for {role || "your target role"}
            </h4>
            <p className="text-base leading-relaxed text-foreground/90">{role_fit.fit_summary}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="block text-sm font-semibold uppercase tracking-wider text-emerald-500">
                Skills you have
              </span>
              <div className="flex flex-wrap gap-2">
                {role_fit.matched_skills.length > 0 ? (
                  role_fit.matched_skills.map((skill, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-base text-emerald-600 dark:text-emerald-400"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-base text-muted-foreground">None identified yet.</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-semibold uppercase tracking-wider text-amber-500">
                Skills you're missing
              </span>
              <div className="flex flex-wrap gap-2">
                {role_fit.missing_skills.length > 0 ? (
                  role_fit.missing_skills.map((skill, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-base text-amber-600 dark:text-amber-400"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-base text-muted-foreground">No gaps found — great fit!</span>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Discrepancies */}
        <TabsContent value="discrepancies" className="space-y-5 pt-4">
          {detected_discrepancies.length > 0 ? (
            detected_discrepancies.map((disc, i) => (
              <div key={i} className="space-y-4 rounded-xl border border-border/60 bg-surface p-5">
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-rose-500">
                    <FileText className="h-3.5 w-3.5" />
                    Resume claims
                  </h4>
                  <p className="mt-2 border-l-2 border-rose-500/30 pl-3 text-base leading-relaxed text-foreground/90">
                    {disc.resume_claim}
                  </p>
                </div>
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-emerald-500">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    What we verified
                  </h4>
                  <p className="mt-2 border-l-2 border-emerald-500/30 pl-3 text-base leading-relaxed text-muted-foreground">
                    {disc.portfolio_reality}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-base text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              No discrepancies detected — your resume claims match your verified coding profiles perfectly.
            </div>
          )}
        </TabsContent>

        {/* Strengths, weaknesses & edits */}
        <TabsContent value="feedback" className="space-y-6 pt-4">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-emerald-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                Resume Strengths
              </h4>
              <ul className="space-y-3">
                {strengths.map((str, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 text-base leading-relaxed text-foreground/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{str}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-amber-500">
                <AlertCircle className="h-3.5 w-3.5" />
                Formatting & Layout Weaknesses
              </h4>
              <ul className="space-y-3">
                {weaknesses.map((weak, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-amber-500/10 bg-amber-500/5 p-4 text-base leading-relaxed text-foreground/90">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500/80" />
                    <span>{weak}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {resume_corrections.length > 0 && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-sky-500">
                <PenLine className="h-3.5 w-3.5" />
                Recommended Resume Edits
              </h4>
              <ul className="space-y-3">
                {resume_corrections.map((fix, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-sky-500/10 bg-sky-500/5 p-4 text-base leading-relaxed text-foreground/90">
                    <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                    <span>{fix}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        {/* 7-day plan — vertical timeline, easier to scan than a squeezed 7-column grid */}
        <TabsContent value="plan" className="pt-4">
          <div className="overflow-hidden rounded-xl border border-primary/15 divide-y divide-primary/10">
            {next_week_action_plan.map((task, i) => (
              <div key={i} className="flex items-start gap-3 bg-primary/5 p-4">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-brand text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <p className="text-base leading-relaxed text-foreground/90">
                  <span className="mr-1.5 font-bold uppercase tracking-wider text-primary">Day {i + 1}:</span>
                  {task.replace(/^Day\s*\d+\s*:?\s*/i, "")}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── GitHub Sync Card ──────────────────────────────────────────────────

export function GitHubSyncCard({
  onSynced,
}: {
  onSynced?: (username: string) => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GitHubProfileData | null>(null);

  const handleSync = useCallback(async () => {
    const username = extractGitHubUsername(input);
    if (!username) {
      setError("Please enter a valid GitHub username or profile URL.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await syncService.github(username);
      if (res.ok && res.data) {
        setData(res.data);
        onSynced?.(username);
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reach the server.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input, onSynced]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#333] text-white">
          <Github className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold flex items-center gap-1">
            GitHub Analyzer <span className="text-destructive">*</span>
          </h3>
          <p className="text-base leading-relaxed text-muted-foreground">
            Paste your GitHub profile link to import your coding activity.
            <span className="text-destructive"> Required</span> for Resume Analysis.
          </p>
        </div>
        {data && (
          <Badge className="border-success/30 bg-success/10 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Synced
          </Badge>
        )}
      </div>

      <div className="px-5 py-5">
        <div className="flex gap-2">
          <Input
            id="github-url-input"
            placeholder="https://github.com/username"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSync()}
            className="flex-1"
            disabled={loading}
          />
          <Button
            id="github-sync-btn"
            onClick={handleSync}
            disabled={loading || !input.trim()}
            className="bg-gradient-brand text-primary-foreground min-w-[100px]"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            {loading ? "Syncing…" : "Sync"}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-base leading-relaxed text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {data && <GitHubResultCard data={data} />}
      </div>
    </Card>
  );
}

// ── LeetCode Sync Card ────────────────────────────────────────────────

export function LeetCodeSyncCard({
  onSynced,
}: {
  onSynced?: (username: string) => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeetCodeProfileData | null>(null);

  const handleSync = useCallback(async () => {
    const username = extractLeetCodeUsername(input);
    if (!username) {
      setError("Please enter a valid LeetCode username or profile URL.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await syncService.leetcode(username);
      if (res.ok && res.data) {
        setData(res.data);
        onSynced?.(username);
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reach the server.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input, onSynced]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#FFA116]/15 text-[#FFA116]">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold">LeetCode Analyzer</h3>
          <p className="text-base leading-relaxed text-muted-foreground">
            Paste your LeetCode profile link to import your problem-solving stats.
          </p>
        </div>
        {data && (
          <Badge className="border-success/30 bg-success/10 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Synced
          </Badge>
        )}
      </div>

      <div className="px-5 py-5">
        <div className="flex gap-2">
          <Input
            id="leetcode-url-input"
            placeholder="https://leetcode.com/u/username"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSync()}
            className="flex-1"
            disabled={loading}
          />
          <Button
            id="leetcode-sync-btn"
            onClick={handleSync}
            disabled={loading || !input.trim()}
            className="bg-gradient-brand text-primary-foreground min-w-[100px]"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            {loading ? "Syncing…" : "Sync"}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-base leading-relaxed text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {data && <LeetCodeResultCard data={data} />}
      </div>
    </Card>
  );
}

// ── Codeforces Sync Card ──────────────────────────────────────────────

export function CodeforcesSyncCard({
  onSynced,
}: {
  onSynced?: (handle: string) => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CodeforcesProfileData | null>(null);

  const handleSync = useCallback(async () => {
    const handle = extractCodeforcesHandle(input);
    if (!handle) {
      setError("Please enter a valid Codeforces handle or profile URL.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await syncService.codeforces(handle);
      if (res.ok && res.data) {
        setData(res.data);
        onSynced?.(handle);
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reach the server.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input, onSynced]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1F8ACB]/15 text-[#1F8ACB]">
          <Swords className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold">Codeforces Analyzer</h3>
          <p className="text-base leading-relaxed text-muted-foreground">
            Paste your Codeforces profile link to import your rating and contest history.
          </p>
        </div>
        {data && (
          <Badge className="border-success/30 bg-success/10 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Synced
          </Badge>
        )}
      </div>

      <div className="px-5 py-5">
        <div className="flex gap-2">
          <Input
            id="codeforces-url-input"
            placeholder="https://codeforces.com/profile/handle"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSync()}
            className="flex-1"
            disabled={loading}
          />
          <Button
            id="codeforces-sync-btn"
            onClick={handleSync}
            disabled={loading || !input.trim()}
            className="bg-gradient-brand text-primary-foreground min-w-[100px]"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            {loading ? "Syncing…" : "Sync"}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-base leading-relaxed text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {data && <CodeforcesResultCard data={data} />}
      </div>
    </Card>
  );
}

// ── Composite panel with AI CTA ───────────────────────────────────────

export function ProfileAnalyzerPanel() {
  const [ghUsername, setGhUsername] = useState<string | null>(null);
  const [lcUsername, setLcUsername] = useState<string | null>(null);
  const [cfUsername, setCfUsername] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [formattedMetrics, setFormattedMetrics] = useState<FormattedMetrics | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Resume states
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [targetRole, setTargetRole] = useState<string>("");
  const [resumeAnalyzing, setResumeAnalyzing] = useState(false);
  const [resumeResult, setResumeResult] = useState<ResumeAnalysisResult | null>(null);
  const [analyzedRole, setAnalyzedRole] = useState<string>("");
  const [resumeError, setResumeError] = useState<string | null>(null);
  const setResumeAnalysisResult = useResumeAnalysisStore((s) => s.setResult);

  const canAnalyze = ghUsername !== null || lcUsername !== null || cfUsername !== null;

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf")) {
        setResumeFile(selected);
        setResumeError(null);
        setResumeResult(null);
      } else {
        setResumeError("Please select a PDF file.");
      }
    }
  };

  const handleResumeAnalyze = async () => {
    if (!resumeFile || !targetRole || !ghUsername) return;
    const githubUsername = ghUsername;
    setResumeAnalyzing(true);
    setResumeError(null);
    setResumeResult(null);
    try {
      const res = await syncService.analyzeResume(resumeFile, githubUsername, lcUsername, targetRole, cfUsername);
      setResumeResult(res);
      setAnalyzedRole(targetRole);
      setResumeAnalysisResult(res, targetRole);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Resume analysis failed.";
      setResumeError(msg);
    } finally {
      setResumeAnalyzing(false);
    }
  };

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setFormattedMetrics(null);
    try {
      const res = await syncService.analyze(ghUsername, lcUsername, cfUsername);
      if (res.ok && res.analysis) {
        setAnalysisResult(res.analysis);
        setFormattedMetrics(res.formatted_metrics ?? null);
      } else {
        setAnalysisError(res.error ?? "Analysis failed — please try again.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not reach the server.";
      setAnalysisError(msg);
    } finally {
      setAnalyzing(false);
    }
  }, [ghUsername, lcUsername, cfUsername]);

  return (
    <div className="space-y-6">
      {/* Sync cards — GitHub sync is required before Resume Analysis below */}
      <div className="grid gap-6 md:grid-cols-3">
        <GitHubSyncCard onSynced={setGhUsername} />
        <LeetCodeSyncCard onSynced={setLcUsername} />
        <CodeforcesSyncCard onSynced={setCfUsername} />
      </div>

      {/* AI Analysis CTA — runs on the synced GitHub/LeetCode/Codeforces profiles above, so it lives right next to them */}
      {canAnalyze && (
        <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col items-center gap-4 px-6 py-6 text-center sm:flex-row sm:text-left">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-lg font-semibold">
                Ready to run AI analysis
              </h3>
              <p className="mt-1 text-base leading-relaxed text-muted-foreground">
                Gemini will score your consistency, detect fake activity, and summarise your strengths.
                {(() => {
                  const missing = [
                    !ghUsername && "GitHub",
                    !lcUsername && "LeetCode",
                    !cfUsername && "Codeforces",
                  ].filter(Boolean) as string[];
                  return missing.length === 0
                    ? " GitHub, LeetCode, and Codeforces are all connected."
                    : ` Add ${missing.join(" and ")} for a fuller picture.`;
                })()}
              </p>
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="shrink-0 bg-gradient-brand text-primary-foreground min-w-[160px]"
            >
              {analyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analysing…
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Run AI Analysis
                </>
              )}
            </Button>
          </div>

          {analysisError && (
            <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-base leading-relaxed text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {analysisError}
            </div>
          )}
        </Card>
      )}

      {/* Analysis result */}
      {analysisResult && <AIAnalysisResultCard result={analysisResult} />}

      {/* Deep metrics result */}
      {analysisResult && formattedMetrics && (
        <DeepMetricsResultCard metrics={formattedMetrics} />
      )}

      {/* ── Resume Analyzer Card ── */}
      <Card className="p-6">
        <div className="flex items-center gap-3 border-b border-border/60 pb-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold">Resume Analyzer</h3>
            <p className="text-base leading-relaxed text-muted-foreground">
              Cross-reference your PDF resume with your verified portfolio coding metrics.
              {!ghUsername && " Sync your GitHub profile above first."}
            </p>
          </div>
          {resumeResult && (
            <Badge className="border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Analyzed
            </Badge>
          )}
        </div>

        <div className="pt-5 space-y-5">
          {/* Step 1: target role */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Target className="h-4 w-4 text-primary" />
              Target Role <span className="text-destructive">*</span>
            </label>
            <Select
              value={targetRole}
              onValueChange={setTargetRole}
              disabled={resumeAnalyzing}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Which role are you applying for?" />
              </SelectTrigger>
              <SelectContent>
                {TECH_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Your resume will be verified against the skills this role typically requires.
            </p>
          </div>

          {/* Step 2: upload + analyze */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <input
                type="file"
                accept=".pdf"
                onChange={onFileChange}
                className="hidden"
                id="resume-upload-input"
                disabled={resumeAnalyzing}
              />
              <Button
                asChild
                variant="outline"
                className="cursor-pointer"
                disabled={resumeAnalyzing}
              >
                <label htmlFor="resume-upload-input" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {resumeFile ? "Change PDF" : "Select Resume PDF"}
                </label>
              </Button>
            </div>

            {resumeFile && (
              <div className="flex items-center gap-2 bg-surface/80 px-4 py-2 rounded-xl border border-border text-base">
                <span className="font-medium text-foreground truncate max-w-[240px]">
                  {resumeFile.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({(resumeFile.size / 1024).toFixed(1)} KB)
                </span>
                <button
                  onClick={() => {
                    setResumeFile(null);
                    setResumeResult(null);
                    setResumeError(null);
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                  disabled={resumeAnalyzing}
                >
                  &times;
                </button>
              </div>
            )}

            {resumeFile && (
              <Button
                onClick={handleResumeAnalyze}
                disabled={resumeAnalyzing || !targetRole || !ghUsername}
                title={
                  !targetRole
                    ? "Select a target role first"
                    : !ghUsername
                      ? "Sync your GitHub profile below first"
                      : undefined
                }
                className="bg-gradient-brand text-primary-foreground flex items-center gap-2"
              >
                {resumeAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4" />
                    Analyze Resume
                  </>
                )}
              </Button>
            )}
          </div>

          {resumeFile && (!targetRole || !ghUsername) && (
            <p className="text-sm text-amber-500 flex items-center gap-1.5 leading-relaxed">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {!targetRole && !ghUsername
                ? "Select a target role above and sync your GitHub profile below to enable analysis."
                : !targetRole
                  ? "Select a target role above to enable analysis."
                  : "Sync your GitHub profile below to enable analysis — it's required so we can verify your resume against real activity."}
            </p>
          )}

          {resumeError && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-base leading-relaxed text-destructive animate-in fade-in duration-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {resumeError}
            </div>
          )}

          {/* Resume Analysis Output */}
          {resumeResult && <ResumeAnalysisResultView result={resumeResult} role={analyzedRole} />}
        </div>
      </Card>
    </div>
  );
}

// ── Deep Metrics Result Card ──────────────────────────────────────────

interface DeepMetricsResultCardProps {
  metrics: FormattedMetrics;
}

export function DeepMetricsResultCard({ metrics }: DeepMetricsResultCardProps) {
  const gh = metrics.github;
  const lc = metrics.leetcode;
  const cf = metrics.codeforces;
  const [activeTab, setActiveTab] = useState<"github" | "leetcode" | "codeforces">(
    gh ? "github" : lc ? "leetcode" : "codeforces"
  );
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  const toggleReadme = (repoName: string) => {
    setExpandedRepo(expandedRepo === repoName ? null : repoName);
  };

  if (!gh && !lc && !cf) return null;

  return (
    <Card className="overflow-hidden mt-6">
      {/* Tab Headers */}
      <div className="flex border-b border-border/60 bg-surface/40">
        {gh && (
          <button
            onClick={() => setActiveTab("github")}
            className={`flex-1 py-4 px-4 font-display text-base font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === "github"
                ? "border-primary text-primary bg-background/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Github className="h-4 w-4" />
            GitHub Repository Insights
          </button>
        )}
        {lc && (
          <button
            onClick={() => setActiveTab("leetcode")}
            className={`flex-1 py-4 px-4 font-display text-base font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === "leetcode"
                ? "border-primary text-primary bg-background/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code2 className="h-4 w-4" />
            LeetCode Algorithmic Insights
          </button>
        )}
        {cf && (
          <button
            onClick={() => setActiveTab("codeforces")}
            className={`flex-1 py-4 px-4 font-display text-base font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === "codeforces"
                ? "border-primary text-primary bg-background/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Swords className="h-4 w-4" />
            Codeforces Insights
          </button>
        )}
      </div>

      <div className="p-6">
        {activeTab === "github" && gh && (
          <div className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
              <h4 className="font-display text-lg font-semibold flex items-center gap-2 text-foreground">
                <FolderGit2 className="h-4 w-4 text-primary" />
                Original Repositories ({gh.repos.filter((r) => !r.is_fork).length})
              </h4>
              <span className="text-sm text-muted-foreground">
                Total stars received: {gh.total_stars_received}
              </span>
            </div>

            <div className="grid gap-4">
              {gh.repos.map((repo) => (
                <div
                  key={repo.name}
                  className="rounded-xl border border-border/60 bg-surface/40 p-4 transition-all hover:border-primary/20"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-base font-semibold text-foreground">
                          {repo.name}
                        </span>
                        {repo.primary_language && (
                          <Badge variant="outline" className="text-xs px-2 py-0.5">
                            {repo.primary_language}
                          </Badge>
                        )}
                        {repo.is_fork && (
                          <Badge variant="outline" className="text-xs px-2 py-0.5 text-muted-foreground">
                            Fork
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                        <span>Size: {repo.size_kb} KB</span>
                        <span>Created: {repo.created}</span>
                        <span>Last push: {repo.last_push}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center">
                      {repo.commit_dates.length > 0 && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-xs flex items-center gap-1">
                          <History className="h-3 w-3" />
                          {repo.commit_dates.length} commits
                        </Badge>
                      )}
                      {repo.readme_snippet && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleReadme(repo.name)}
                          className="h-8 text-sm flex items-center gap-1 text-primary hover:text-primary hover:bg-primary/10"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          {expandedRepo === repo.name ? "Hide README" : "View README"}
                          {expandedRepo === repo.name ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {expandedRepo === repo.name && repo.readme_snippet && (
                    <div className="mt-4 p-4 rounded-lg bg-background/80 border border-border/80 text-sm leading-relaxed text-muted-foreground overflow-x-auto font-mono max-h-60 overflow-y-auto whitespace-pre-wrap">
                      {repo.readme_snippet}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "leetcode" && lc && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Topic Tags Breakdown */}
            <div className="space-y-4">
              <h4 className="font-display text-lg font-semibold flex items-center gap-2 text-foreground">
                <Tag className="h-4 w-4 text-primary" />
                Solve DNA (Topic Tags)
              </h4>

              {lc.topic_tags ? (
                <div className="space-y-5">
                  {/* Advanced */}
                  {lc.topic_tags.advanced.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-sm font-semibold text-rose-500 uppercase tracking-wider">
                        Advanced Algorithms
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {lc.topic_tags.advanced.map((tag) => (
                          <Badge
                            key={tag.tagName}
                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/20 text-sm px-3 py-1.5"
                          >
                            {tag.tagName} ({tag.problemsSolved})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Intermediate */}
                  {lc.topic_tags.intermediate.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-sm font-semibold text-amber-500 uppercase tracking-wider">
                        Intermediate Core
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {lc.topic_tags.intermediate.map((tag) => (
                          <Badge
                            key={tag.tagName}
                            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/20 text-sm px-3 py-1.5"
                          >
                            {tag.tagName} ({tag.problemsSolved})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fundamental */}
                  {lc.topic_tags.fundamental.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-sm font-semibold text-emerald-500 uppercase tracking-wider">
                        Fundamentals
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {lc.topic_tags.fundamental.map((tag) => (
                          <Badge
                            key={tag.tagName}
                            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-sm px-3 py-1.5"
                          >
                            {tag.tagName} ({tag.problemsSolved})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-surface/40 p-6 text-center text-base text-muted-foreground">
                  No topic tag data found.
                </div>
              )}
            </div>

            {/* Recent Submissions */}
            <div className="space-y-4">
              <h4 className="font-display text-lg font-semibold flex items-center gap-2 text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Recent Submissions
              </h4>

              {lc.recent_submissions.length > 0 ? (
                <div className="rounded-xl border border-border/60 bg-surface/20 divide-y divide-border/60 max-h-[360px] overflow-y-auto">
                  {lc.recent_submissions.map((sub, i) => (
                    <div
                      key={i}
                      className="px-4 py-3.5 flex items-center justify-between gap-4 text-sm hover:bg-surface/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground truncate block">
                          {sub.title}
                        </span>
                        <a
                          href={`https://leetcode.com/problems/${sub.titleSlug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          leetcode.com/problems/{sub.titleSlug}
                        </a>
                      </div>
                      <span className="text-muted-foreground whitespace-nowrap shrink-0">
                        {sub.timestamp
                          ? new Date(sub.timestamp).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Recent"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-surface/40 p-6 text-center text-base text-muted-foreground">
                  No recent submissions found.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "codeforces" && cf && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Top Tags */}
            <div className="space-y-4">
              <h4 className="font-display text-lg font-semibold flex items-center gap-2 text-foreground">
                <Tag className="h-4 w-4 text-primary" />
                Most-Solved Tags
              </h4>

              {cf.top_tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {cf.top_tags.map((tag) => (
                    <Badge
                      key={tag}
                      className="bg-[#1F8ACB]/10 hover:bg-[#1F8ACB]/20 text-[#1F8ACB] border-[#1F8ACB]/20 text-sm px-3 py-1.5"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-surface/40 p-6 text-center text-base text-muted-foreground">
                  No tag data found.
                </div>
              )}

              {cf.avg_problem_rating != null && (
                <div className="text-base leading-relaxed text-muted-foreground pt-1 bg-surface-2/20 p-4 rounded-xl border border-border/40">
                  <span className="font-semibold block mb-1 text-foreground text-sm uppercase tracking-wider">
                    Avg. Problem Difficulty:
                  </span>
                  {cf.avg_problem_rating} rating
                </div>
              )}

              {cf.rating_history.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Recent Contests
                  </div>
                  <div className="rounded-xl border border-border/60 bg-surface/20 divide-y divide-border/60 max-h-[180px] overflow-y-auto">
                    {cf.rating_history.slice(-10).reverse().map((r, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-foreground">{r.contest_name}</span>
                        <span className={r.new_rating >= r.old_rating ? "text-emerald-500" : "text-destructive"}>
                          {r.old_rating} → {r.new_rating}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Recently Solved */}
            <div className="space-y-4">
              <h4 className="font-display text-lg font-semibold flex items-center gap-2 text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Recently Solved
              </h4>

              {cf.solved_problems.length > 0 ? (
                <div className="rounded-xl border border-border/60 bg-surface/20 divide-y divide-border/60 max-h-[360px] overflow-y-auto">
                  {cf.solved_problems.map((p, i) => (
                    <div
                      key={i}
                      className="px-4 py-3.5 flex items-center justify-between gap-4 text-sm hover:bg-surface/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground truncate block">
                          {p.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.tags.slice(0, 3).join(", ")}
                        </span>
                      </div>
                      <span className="text-muted-foreground whitespace-nowrap shrink-0">
                        {p.rating ? `${p.rating}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-surface/40 p-6 text-center text-base text-muted-foreground">
                  No solved problems found.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}


// ── Result sub-cards ──────────────────────────────────────────────────

function GitHubResultCard({ data }: { data: GitHubProfileData }) {
  const totalLangBytes = data.top_languages.reduce((s, l) => s + l.bytes, 0);

  return (
    <div className="mt-5 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        {data.avatar_url && (
          <img
            src={data.avatar_url}
            alt={data.username}
            className="h-12 w-12 rounded-full border-2 border-border"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold truncate">
              {data.name ?? data.username}
            </span>
            <a
              href={`https://github.com/${data.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="text-sm text-muted-foreground truncate">
            @{data.username}
            {data.bio && ` · ${data.bio}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MiniStat icon={GitFork}  label="Public repos"  value={String(data.public_repos)} />
        <MiniStat icon={Users}    label="Followers"     value={formatNumber(data.followers)} />
        <MiniStat icon={Star}     label="Following"     value={formatNumber(data.following)} />
        <MiniStat icon={Calendar} label="Account age"
          value={`${Math.floor(data.account_age_days / 365)}y ${data.account_age_days % 365}d`}
        />
      </div>

      {data.top_languages.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Top Languages
          </div>
          <div className="space-y-3">
            {data.top_languages.slice(0, 6).map((lang) => (
              <div key={lang.language} className="flex items-center gap-3">
                <span className="w-28 text-sm font-medium truncate">{lang.language}</span>
                <div className="flex-1">
                  <Progress
                    value={totalLangBytes > 0 ? (lang.bytes / totalLangBytes) * 100 : 0}
                    className="h-2"
                  />
                </div>
                <span className="w-14 text-right text-sm text-muted-foreground">
                  {lang.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LeetCodeResultCard({ data }: { data: LeetCodeProfileData }) {
  const { breakdown, streak } = data;
  const TOTAL_EASY = 830;
  const TOTAL_MEDIUM = 1740;
  const TOTAL_HARD = 760;

  return (
    <div className="mt-5 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        {data.avatar_url && (
          <img
            src={data.avatar_url}
            alt={data.username}
            className="h-12 w-12 rounded-full border-2 border-border"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold truncate">
              {data.real_name ?? data.username}
            </span>
            <a
              href={`https://leetcode.com/u/${data.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="text-sm text-muted-foreground">
            @{data.username}
            {data.ranking && ` · Rank #${formatNumber(data.ranking)}`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-primary">{data.total_solved}</div>
          <div className="text-sm text-muted-foreground">Total Solved</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DifficultyBar label="Easy"   solved={breakdown.easy}   total={TOTAL_EASY}
          color="text-success" bgColor="bg-success/15" progressColor="[&>div]:bg-success" />
        <DifficultyBar label="Medium" solved={breakdown.medium} total={TOTAL_MEDIUM}
          color="text-warning" bgColor="bg-warning/15" progressColor="[&>div]:bg-warning" />
        <DifficultyBar label="Hard"   solved={breakdown.hard}   total={TOTAL_HARD}
          color="text-destructive" bgColor="bg-destructive/15" progressColor="[&>div]:bg-destructive" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MiniStat icon={Flame}    label="Current streak"  value={`${streak.current_streak}d`} />
        <MiniStat icon={Trophy}   label="Longest streak"  value={`${streak.longest_streak}d`} />
        <MiniStat icon={Calendar} label="Active days"     value={String(streak.total_active_days)} />
      </div>
    </div>
  );
}

function CodeforcesResultCard({ data }: { data: CodeforcesProfileData }) {
  const { streak } = data;

  return (
    <div className="mt-5 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-border bg-[#1F8ACB]/10 text-[#1F8ACB]">
          <Swords className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold truncate">{data.handle}</span>
            <a
              href={`https://codeforces.com/profile/${data.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="text-sm text-muted-foreground capitalize">
            {data.rank ?? "Unrated"}
            {data.contests_participated > 0 && ` · ${data.contests_participated} contests`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-primary">{data.total_solved}</div>
          <div className="text-sm text-muted-foreground">Total Solved</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MiniStat icon={Trophy} label="Rating" value={data.rating != null ? String(data.rating) : "—"} />
        <MiniStat icon={Star} label="Max rating" value={data.max_rating != null ? String(data.max_rating) : "—"} />
        <MiniStat icon={Flame} label="Current streak" value={`${streak.current_streak}d`} />
        <MiniStat icon={Calendar} label="Longest streak" value={`${streak.longest_streak}d`} />
        <MiniStat icon={Calendar} label="Active days" value={String(streak.total_active_days)} />
        <MiniStat icon={Users} label="Contribution" value={String(data.contribution)} />
      </div>
    </div>
  );
}

// ── Shared tiny components ────────────────────────────────────────────

function MiniStat({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-surface/60 p-5">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold leading-tight text-foreground">{value}</div>
    </div>
  );
}

function DifficultyBar({ label, solved, total, color, bgColor, progressColor }: {
  label: string; solved: number; total: number;
  color: string; bgColor: string; progressColor: string;
}) {
  return (
    <div className={`rounded-xl ${bgColor} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${color}`}>{label}</span>
        <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">{solved}/{total}</span>
      </div>
      <Progress value={total > 0 ? (solved / total) * 100 : 0} className={`mt-2.5 h-1.5 ${progressColor}`} />
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
