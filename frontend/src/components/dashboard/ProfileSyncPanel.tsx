/**
 * ProfileSyncPanel
 * ────────────────
 * Self-contained panel that lives inside the candidate dashboard's Analyzer tab.
 * Allows users to paste their GitHub / LeetCode profile URLs, extracts the username,
 * calls the backend sync endpoints, and displays the fetched data in rich result cards.
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
import type { GitHubProfileData, LeetCodeProfileData } from "@/types/sync";

// ── GitHub Panel ─────────────────────────────────────────────────────

export function GitHubSyncCard() {
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
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to reach the server.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input]);

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#333] text-white">
          <Github className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">
            GitHub Analyzer
          </h3>
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
        {/* Input row */}
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

        {/* Result card */}
        {data && <GitHubResultCard data={data} />}
      </div>
    </Card>
  );
}

function GitHubResultCard({ data }: { data: GitHubProfileData }) {
  const totalLangBytes = data.top_languages.reduce((s, l) => s + l.bytes, 0);

  return (
    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Profile row */}
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

      {/* Stat chips */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat
          icon={GitFork}
          label="Public repos"
          value={String(data.public_repos)}
        />
        <MiniStat
          icon={Users}
          label="Followers"
          value={formatNumber(data.followers)}
        />
        <MiniStat
          icon={Star}
          label="Following"
          value={formatNumber(data.following)}
        />
        <MiniStat
          icon={Calendar}
          label="Account age"
          value={`${Math.floor(data.account_age_days / 365)}y ${data.account_age_days % 365}d`}
        />
      </div>

      {/* Language breakdown */}
      {data.top_languages.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Top Languages
          </div>
          <div className="space-y-2">
            {data.top_languages.slice(0, 6).map((lang) => (
              <div key={lang.language} className="flex items-center gap-3">
                <span className="w-20 text-xs font-medium truncate">
                  {lang.language}
                </span>
                <div className="flex-1">
                  <Progress
                    value={
                      totalLangBytes > 0
                        ? (lang.bytes / totalLangBytes) * 100
                        : 0
                    }
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

// ── LeetCode Panel ───────────────────────────────────────────────────

export function LeetCodeSyncCard() {
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
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to reach the server.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input]);

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#FFA116]/15 text-[#FFA116]">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">
            LeetCode Analyzer
          </h3>
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
        {/* Input row */}
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

        {/* Result card */}
        {data && <LeetCodeResultCard data={data} />}
      </div>
    </Card>
  );
}

function LeetCodeResultCard({ data }: { data: LeetCodeProfileData }) {
  const { breakdown, streak } = data;
  // LeetCode totals (approximate for percentage calculations)
  const TOTAL_EASY = 830;
  const TOTAL_MEDIUM = 1740;
  const TOTAL_HARD = 760;

  return (
    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Profile row */}
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
          <div className="font-display text-2xl font-bold text-primary">
            {data.total_solved}
          </div>
          <div className="text-[11px] text-muted-foreground">Total Solved</div>
        </div>
      </div>

      {/* Difficulty breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <DifficultyBar
          label="Easy"
          solved={breakdown.easy}
          total={TOTAL_EASY}
          color="text-success"
          bgColor="bg-success/15"
          progressColor="[&>div]:bg-success"
        />
        <DifficultyBar
          label="Medium"
          solved={breakdown.medium}
          total={TOTAL_MEDIUM}
          color="text-warning-foreground"
          bgColor="bg-warning/15"
          progressColor="[&>div]:bg-warning"
        />
        <DifficultyBar
          label="Hard"
          solved={breakdown.hard}
          total={TOTAL_HARD}
          color="text-destructive"
          bgColor="bg-destructive/15"
          progressColor="[&>div]:bg-destructive"
        />
      </div>

      {/* Streak row */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat
          icon={Flame}
          label="Current streak"
          value={`${streak.current_streak}d`}
        />
        <MiniStat
          icon={Trophy}
          label="Longest streak"
          value={`${streak.longest_streak}d`}
        />
        <MiniStat
          icon={Calendar}
          label="Active days"
          value={String(streak.total_active_days)}
        />
      </div>
    </div>
  );
}

// ── Shared tiny components ───────────────────────────────────────────

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Star;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface/60 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{value}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {label}
        </div>
      </div>
    </div>
  );
}

function DifficultyBar({
  label,
  solved,
  total,
  color,
  bgColor,
  progressColor,
}: {
  label: string;
  solved: number;
  total: number;
  color: string;
  bgColor: string;
  progressColor: string;
}) {
  return (
    <div className={`rounded-lg ${bgColor} p-3`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-xs font-semibold ${color}`}>{label}</span>
        <span className="text-[11px] text-muted-foreground">
          {solved}/{total}
        </span>
      </div>
      <Progress
        value={total > 0 ? (solved / total) * 100 : 0}
        className={`mt-2 h-1.5 ${progressColor}`}
      />
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
