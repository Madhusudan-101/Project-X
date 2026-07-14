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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  syncService,
  extractGitHubUsername,
  extractLeetCodeUsername,
} from "@/services/api/sync";
import type {
  GitHubProfileData,
  LeetCodeProfileData,
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

  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 duration-400 space-y-4">
      {/* 1. Score + Pacing Strip */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
          <Brain className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-semibold">Employability Analysis Summary</span>
          <Badge className="ml-auto border-primary/30 bg-primary/10 text-primary text-[11px]">
            Gemini 3.5 Flash
          </Badge>
        </div>

        <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
          {/* Score ring */}
          <ScoreRing score={result.overall_score} />

          {/* Right side */}
          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-semibold">AI Suitability Assessment</span>
              <Badge className={`${ratingStyle[result.consistency_analysis.rating] ?? "border-border bg-muted text-muted-foreground"} text-xs font-semibold`}>
                {result.consistency_analysis.rating} Pacing
              </Badge>
            </div>

            {/* Consistency evaluation */}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {result.consistency_analysis.evaluation}
            </p>
          </div>
        </div>
      </Card>

      {/* 2. LeetCode Skill & Topic Distribution */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/40 pb-2">
          <Trophy className="h-4 w-4 text-primary" />
          <span>Algorithmic Profile & Topic Distribution</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">Strong Topics</div>
            <div className="flex flex-wrap gap-1.5">
              {result.leetcode_skills.strong_topics.map((tag) => (
                <Badge
                  key={tag}
                  className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs px-2.5 py-1"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Growth Areas</div>
            <div className="flex flex-wrap gap-1.5">
              {result.leetcode_skills.growth_areas.map((tag) => (
                <Badge
                  key={tag}
                  className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs px-2.5 py-1"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="text-sm text-muted-foreground pt-1 bg-surface-2/20 p-3 rounded-lg border border-border/40">
          <span className="font-semibold block mb-0.5 text-foreground text-xs uppercase tracking-wider">DSA Depth Summary:</span>
          {result.leetcode_skills.algorithmic_depth_summary}
        </div>
      </Card>

      {/* 3. GitHub Project Depth & Implementation Rigor */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/40 pb-2">
          <Code2 className="h-4 w-4 text-primary" />
          <span>Project Rigor & Engineering Complexity</span>
        </div>

        <div className="grid gap-3">
          {result.project_rigor.map((repo, i) => {
            const complexityColors = {
              Low: "border-muted bg-muted/20 text-muted-foreground",
              Medium: "border-primary/20 bg-primary/10 text-primary",
              High: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              Advanced: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
            };
            return (
              <div key={i} className="rounded-lg border border-border/60 bg-surface/40 p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="font-display font-semibold text-sm text-foreground truncate block">
                      {repo.repo_name}
                    </span>
                  </div>
                  <Badge className={`${complexityColors[repo.inferred_complexity] ?? "border-border text-foreground"} text-[10px] font-semibold px-2 py-0.5 shrink-0`}>
                    {repo.inferred_complexity} Complexity
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {repo.analysis}
                </p>

                <div className="flex flex-wrap gap-1 pt-1">
                  {repo.skills_developed.map((skill) => (
                    <Badge key={skill} variant="outline" className="text-[10px] px-1.5 py-0.5 text-muted-foreground border-border/80">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 4. Career Alignment & Flags */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Recommended Roles & Flags */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/40 pb-2">
            <Users className="h-4 w-4 text-primary" />
            <span>Target Roles & Career Alignment</span>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">Recommended Career Tracks:</span>
              <div className="flex flex-wrap gap-1.5">
                {recommendedRoles.map((role) => (
                  <Badge key={role} className="bg-primary/10 text-primary border-primary/20 text-xs px-2.5 py-1">
                    {role}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Signals Verification */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/40 pb-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>Engineering Signals & Authenticity Checks</span>
          </div>

          <div className="space-y-3">
            {greenFlags.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider block">Observed Green Flags:</span>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {greenFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {redFlags.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-rose-500 uppercase tracking-wider block">Risk Factors / Red Flags:</span>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {redFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {greenFlags.length === 0 && redFlags.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">No flags analyzed.</div>
            )}
          </div>
        </Card>
      </div>

      {/* 5. Actionable Engineering Mentorship Feedback */}
      <Card className="p-5 border-primary/20 bg-primary/5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-primary/20 pb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Actionable Engineering Roadmap</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-foreground/90 font-medium">
          {result.actionable_feedback}
        </p>
      </Card>
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
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#333] text-white">
          <Github className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">GitHub Analyzer</h3>
          <p className="text-xs text-muted-foreground">
            Paste your GitHub profile link to import your coding activity.
          </p>
        </div>
        {data && (
          <Badge className="border-success/30 bg-success/10 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Synced
          </Badge>
        )}
      </div>

      <div className="px-5 py-4">
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
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
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
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#FFA116]/15 text-[#FFA116]">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">LeetCode Analyzer</h3>
          <p className="text-xs text-muted-foreground">
            Paste your LeetCode profile link to import your problem-solving stats.
          </p>
        </div>
        {data && (
          <Badge className="border-success/30 bg-success/10 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Synced
          </Badge>
        )}
      </div>

      <div className="px-5 py-4">
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
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {data && <LeetCodeResultCard data={data} />}
      </div>
    </Card>
  );
}

// ── Composite panel with AI CTA ───────────────────────────────────────

export function ProfileAnalyzerPanel() {
  const [ghUsername, setGhUsername] = useState<string | null>(null);
  const [lcUsername, setLcUsername] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [formattedMetrics, setFormattedMetrics] = useState<FormattedMetrics | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Resume states
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeAnalyzing, setResumeAnalyzing] = useState(false);
  const [resumeResult, setResumeResult] = useState<ResumeAnalysisResult | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const canAnalyze = ghUsername !== null || lcUsername !== null;

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
    if (!resumeFile) return;
    setResumeAnalyzing(true);
    setResumeError(null);
    setResumeResult(null);
    try {
      const res = await syncService.analyzeResume(resumeFile, ghUsername, lcUsername);
      setResumeResult(res);
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
      const res = await syncService.analyze(ghUsername, lcUsername);
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
  }, [ghUsername, lcUsername]);

  return (
    <div className="space-y-6">
      {/* ── Resume Analyzer Card ── */}
      <Card className="p-5">
        <div className="flex items-center gap-3 border-b border-border/60 pb-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-base font-semibold">Resume Analyzer</h3>
            <p className="text-xs text-muted-foreground">
              Cross-reference your PDF resume with your verified portfolio coding metrics.
            </p>
          </div>
          {resumeResult && (
            <Badge className="border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Analyzed
            </Badge>
          )}
        </div>

        <div className="pt-4 space-y-4">
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
              <div className="flex items-center gap-2 bg-surface/80 px-3 py-1.5 rounded-lg border border-border text-sm">
                <span className="font-medium text-foreground truncate max-w-[200px]">
                  {resumeFile.name}
                </span>
                <span className="text-xs text-muted-foreground">
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
                disabled={resumeAnalyzing}
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

          {resumeError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive animate-in fade-in duration-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {resumeError}
            </div>
          )}

          {/* Resume Analysis Output */}
          {resumeResult && (
            <div className="space-y-4 pt-4 border-t border-border/60 animate-in fade-in duration-300">
              {/* Discrepancies */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-rose-500 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Detected Discrepancies (Resume Claims vs Portfolio Reality)
                </h4>
                {resumeResult.detected_discrepancies.length > 0 ? (
                  <div className="grid gap-2">
                    {resumeResult.detected_discrepancies.map((disc, i) => (
                      <div key={i} className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs space-y-1">
                        <div className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                          <span className="text-rose-500 font-bold">CLAIM:</span> {disc.resume_claim}
                        </div>
                        <div className="text-muted-foreground flex items-start gap-1 leading-relaxed">
                          <span className="text-emerald-500 font-bold">REALITY:</span> {disc.portfolio_reality}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                    No discrepancies detected! Your resume claims perfectly match your verified coding profiles.
                  </div>
                )}
              </div>

              {/* Strengths & Weaknesses side-by-side */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Resume Strengths
                  </h4>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {resumeResult.strengths.map((str, i) => (
                      <li key={i} className="flex items-start gap-1.5 bg-emerald-500/5 p-2 rounded-md border border-emerald-500/10">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{str}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500/80" />
                    Formatting & Layout Weaknesses
                  </h4>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {resumeResult.weaknesses.map((weak, i) => (
                      <li key={i} className="flex items-start gap-1.5 bg-amber-500/5 p-2 rounded-md border border-amber-500/10">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500/80 shrink-0 mt-0.5" />
                        <span>{weak}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 7-day Daily action plan */}
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  7-Day Portfolio & Resume Action Plan
                </h4>
                <div className="grid gap-2 sm:grid-cols-7">
                  {resumeResult.next_week_action_plan.map((task, i) => (
                    <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] leading-relaxed flex flex-col justify-between">
                      <div>
                        <div className="font-bold text-primary mb-1 uppercase tracking-wider text-[10px]">
                          Day {i + 1}
                        </div>
                        <p className="text-muted-foreground">{task}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Sync cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <GitHubSyncCard onSynced={setGhUsername} />
        <LeetCodeSyncCard onSynced={setLcUsername} />
      </div>

      {/* AI Analysis CTA — only visible once at least one profile is synced */}
      {canAnalyze && (
        <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col items-center gap-4 px-6 py-6 text-center sm:flex-row sm:text-left">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-base font-semibold">
                Ready to run AI analysis
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Gemini will score your consistency, detect fake activity, and summarise your strengths.
                {ghUsername && lcUsername
                  ? " Both GitHub and LeetCode are connected."
                  : ghUsername
                    ? " Add LeetCode for a fuller picture."
                    : " Add GitHub for a fuller picture."}
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
            <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
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
  const [activeTab, setActiveTab] = useState<"github" | "leetcode">(
    gh ? "github" : "leetcode"
  );
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  const toggleReadme = (repoName: string) => {
    setExpandedRepo(expandedRepo === repoName ? null : repoName);
  };

  if (!gh && !lc) return null;

  return (
    <Card className="overflow-hidden mt-4">
      {/* Tab Headers */}
      <div className="flex border-b border-border/60 bg-surface/40">
        {gh && (
          <button
            onClick={() => setActiveTab("github")}
            className={`flex-1 py-3 px-4 font-display text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
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
            className={`flex-1 py-3 px-4 font-display text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === "leetcode"
                ? "border-primary text-primary bg-background/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code2 className="h-4 w-4" />
            LeetCode Algorithmic Insights
          </button>
        )}
      </div>

      <div className="p-5">
        {activeTab === "github" && gh && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-display text-sm font-semibold flex items-center gap-2 text-foreground">
                <FolderGit2 className="h-4 w-4 text-primary" />
                Original Repositories ({gh.repos.filter((r) => !r.is_fork).length})
              </h4>
              <span className="text-xs text-muted-foreground">
                Total stars received: {gh.total_stars_received}
              </span>
            </div>

            <div className="grid gap-3">
              {gh.repos.map((repo) => (
                <div
                  key={repo.name}
                  className="rounded-lg border border-border/60 bg-surface/40 p-4 transition-all hover:border-primary/20"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-sm font-semibold text-foreground">
                          {repo.name}
                        </span>
                        {repo.primary_language && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                            {repo.primary_language}
                          </Badge>
                        )}
                        {repo.is_fork && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 text-muted-foreground">
                            Fork
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                        <span>Size: {repo.size_kb} KB</span>
                        <span>Created: {repo.created}</span>
                        <span>Last push: {repo.last_push}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center">
                      {repo.commit_dates.length > 0 && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-[11px] flex items-center gap-1">
                          <History className="h-3 w-3" />
                          {repo.commit_dates.length} commits
                        </Badge>
                      )}
                      {repo.readme_snippet && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleReadme(repo.name)}
                          className="h-8 text-xs flex items-center gap-1 text-primary hover:text-primary hover:bg-primary/10"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          {expandedRepo === repo.name ? "Hide README" : "View README"}
                          {expandedRepo === repo.name ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {expandedRepo === repo.name && repo.readme_snippet && (
                    <div className="mt-4 p-3.5 rounded-md bg-background/80 border border-border/80 text-xs leading-relaxed text-muted-foreground overflow-x-auto font-mono max-h-60 overflow-y-auto whitespace-pre-wrap">
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
              <h4 className="font-display text-sm font-semibold flex items-center gap-2 text-foreground">
                <Tag className="h-4 w-4 text-primary" />
                Solve DNA (Topic Tags)
              </h4>

              {lc.topic_tags ? (
                <div className="space-y-4">
                  {/* Advanced */}
                  {lc.topic_tags.advanced.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-rose-500 uppercase tracking-wider">
                        Advanced Algorithms
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lc.topic_tags.advanced.map((tag) => (
                          <Badge
                            key={tag.tagName}
                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/20 text-xs px-2.5 py-1"
                          >
                            {tag.tagName} ({tag.problemsSolved})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Intermediate */}
                  {lc.topic_tags.intermediate.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-amber-500 uppercase tracking-wider">
                        Intermediate Core
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lc.topic_tags.intermediate.map((tag) => (
                          <Badge
                            key={tag.tagName}
                            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs px-2.5 py-1"
                          >
                            {tag.tagName} ({tag.problemsSolved})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fundamental */}
                  {lc.topic_tags.fundamental.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">
                        Fundamentals
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lc.topic_tags.fundamental.map((tag) => (
                          <Badge
                            key={tag.tagName}
                            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs px-2.5 py-1"
                          >
                            {tag.tagName} ({tag.problemsSolved})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/70 bg-surface/40 p-6 text-center text-xs text-muted-foreground">
                  No topic tag data found.
                </div>
              )}
            </div>

            {/* Recent Submissions */}
            <div className="space-y-4">
              <h4 className="font-display text-sm font-semibold flex items-center gap-2 text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Recent Submissions
              </h4>

              {lc.recent_submissions.length > 0 ? (
                <div className="rounded-lg border border-border/60 bg-surface/20 divide-y divide-border/60 max-h-[360px] overflow-y-auto">
                  {lc.recent_submissions.map((sub, i) => (
                    <div
                      key={i}
                      className="px-4 py-3 flex items-center justify-between gap-4 text-xs hover:bg-surface/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground truncate block">
                          {sub.title}
                        </span>
                        <a
                          href={`https://leetcode.com/problems/${sub.titleSlug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline"
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
                <div className="rounded-lg border border-dashed border-border/70 bg-surface/40 p-6 text-center text-xs text-muted-foreground">
                  No recent submissions found.
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
    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
          <div className="text-xs text-muted-foreground truncate">
            @{data.username}
            {data.bio && ` · ${data.bio}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat icon={GitFork}  label="Public repos"  value={String(data.public_repos)} />
        <MiniStat icon={Users}    label="Followers"     value={formatNumber(data.followers)} />
        <MiniStat icon={Star}     label="Following"     value={formatNumber(data.following)} />
        <MiniStat icon={Calendar} label="Account age"
          value={`${Math.floor(data.account_age_days / 365)}y ${data.account_age_days % 365}d`}
        />
      </div>

      {data.top_languages.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Top Languages
          </div>
          <div className="space-y-2">
            {data.top_languages.slice(0, 6).map((lang) => (
              <div key={lang.language} className="flex items-center gap-3">
                <span className="w-20 text-xs font-medium truncate">{lang.language}</span>
                <div className="flex-1">
                  <Progress
                    value={totalLangBytes > 0 ? (lang.bytes / totalLangBytes) * 100 : 0}
                    className="h-2"
                  />
                </div>
                <span className="w-12 text-right text-xs text-muted-foreground">
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
    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
          <div className="text-xs text-muted-foreground">
            @{data.username}
            {data.ranking && ` · Rank #${formatNumber(data.ranking)}`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-primary">{data.total_solved}</div>
          <div className="text-[11px] text-muted-foreground">Total Solved</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DifficultyBar label="Easy"   solved={breakdown.easy}   total={TOTAL_EASY}
          color="text-success" bgColor="bg-success/15" progressColor="[&>div]:bg-success" />
        <DifficultyBar label="Medium" solved={breakdown.medium} total={TOTAL_MEDIUM}
          color="text-warning-foreground" bgColor="bg-warning/15" progressColor="[&>div]:bg-warning" />
        <DifficultyBar label="Hard"   solved={breakdown.hard}   total={TOTAL_HARD}
          color="text-destructive" bgColor="bg-destructive/15" progressColor="[&>div]:bg-destructive" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat icon={Flame}    label="Current streak"  value={`${streak.current_streak}d`} />
        <MiniStat icon={Trophy}   label="Longest streak"  value={`${streak.longest_streak}d`} />
        <MiniStat icon={Calendar} label="Active days"     value={String(streak.total_active_days)} />
      </div>
    </div>
  );
}

// ── Shared tiny components ────────────────────────────────────────────

function MiniStat({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface/60 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{value}</div>
        <div className="text-[10px] text-muted-foreground truncate">{label}</div>
      </div>
    </div>
  );
}

function DifficultyBar({ label, solved, total, color, bgColor, progressColor }: {
  label: string; solved: number; total: number;
  color: string; bgColor: string; progressColor: string;
}) {
  return (
    <div className={`rounded-lg ${bgColor} p-3`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-xs font-semibold ${color}`}>{label}</span>
        <span className="text-[11px] text-muted-foreground">{solved}/{total}</span>
      </div>
      <Progress value={total > 0 ? (solved / total) * 100 : 0} className={`mt-2 h-1.5 ${progressColor}`} />
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
