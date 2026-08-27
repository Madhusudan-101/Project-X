/**
 * ProfileSyncPanel
 * ────────────────
 * ProfileAnalyzerPanel: the candidate uploads only their resume + target
 * role. The backend extracts GitHub/LeetCode/Codeforces profile links from
 * the resume's own hyperlinks, fetches whichever it finds, and returns one
 * unified analysis (resume authenticity + employability), rendered by
 * CombinedAnalysisResultView. Whichever platforms had no link found are
 * asked about one at a time via MissingPlatformPrompt.
 */

import { useState } from "react";
import {
  Code2,
  Loader2,
  Users,
  Trophy,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Brain,
  FileText,
  PenLine,
  Target,
  Award,
  Linkedin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  syncService,
  extractGitHubUsername,
  extractLeetCodeUsername,
  extractCodeforcesHandle,
} from "@/services/api/candidate/sync";
import { linkedinService } from "@/services/api/candidate/linkedin";
import { useResumeAnalysisStore } from "@/store/candidate/resumeAnalysis";
import { TECH_ROLES } from "@/types/candidate/sync";
import type {
  AnalysisResult,
  ResumeAnalysisResult,
  CombinedAnalysisResponse,
  MissingPlatform,
} from "@/types/candidate/sync";
import type { LinkedInAnalysisResult, LinkedInSectionRating } from "@/types/candidate/linkedin";

// ── Score ring (SVG donut) ────────────────────────────────────────────

export function ScoreRing({ score }: { score: number }) {
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
        <span className={`font-display text-4xl font-bold leading-none ${colorClass.text}`}>
          {score}
        </span>
        <span className="mt-0.5 text-xs text-muted-foreground">/100</span>
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

const sectionRatingStyle: Record<LinkedInSectionRating, string> = {
  Strong: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "Needs Work": "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Missing: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

// ── Combined Analysis Result — resume authenticity + employability, as one ──

export function verdictTone(score: number) {
  if (score >= 85) return { text: "text-emerald-500", ring: "from-emerald-500/15" };
  if (score >= 65) return { text: "text-primary", ring: "from-primary/15" };
  if (score >= 40) return { text: "text-amber-500", ring: "from-amber-500/15" };
  return { text: "text-destructive", ring: "from-destructive/15" };
}

function CombinedAnalysisResultView({
  resume,
  profile,
  linkedin,
  role,
}: {
  resume: ResumeAnalysisResult;
  profile: AnalysisResult | null;
  linkedin?: LinkedInAnalysisResult | null;
  role: string;
}) {
  const { overall_rating, role_fit, detected_discrepancies, strengths, weaknesses, resume_corrections, next_week_action_plan } =
    resume;
  const resumeTone = verdictTone(overall_rating.score);
  const profileTone = profile ? verdictTone(profile.overall_score) : null;
  // LinkedIn only ever contributes flags/improvement scope to the Employability
  // Score section — its own score stays separate (see linkedinTone below), it
  // never blends into profile.overall_score.
  const linkedinUsable = linkedin && linkedin.is_valid_linkedin_export ? linkedin : null;
  const greenFlags = profile?.career_alignment?.green_flags ?? [];
  const redFlags = profile?.career_alignment?.red_flags ?? [];
  const recommendedRoles = profile?.career_alignment?.recommended_roles ?? [];
  const complexityColors = {
    Low: "border-muted bg-muted/20 text-muted-foreground",
    Medium: "border-primary/20 bg-primary/10 text-primary",
    High: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    Advanced: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  };

  return (
    <div className="space-y-5 pt-5 border-t border-border/60 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Dual hero — resume authenticity and employability, side by side as one verdict */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className={`relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br ${resumeTone.ring} via-surface to-surface p-6`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ScoreRing score={overall_rating.score} />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-muted-foreground">
                <Award className="h-3.5 w-3.5 text-primary" />
                Resume Authenticity
              </div>
              <Badge className={`${resumeTone.text} border-current/30 bg-current/10 text-base font-semibold px-3 py-1`}>
                {overall_rating.verdict}
              </Badge>
              <p className="text-lg leading-relaxed text-foreground/90">
                {overall_rating.summary}
              </p>
            </div>
          </div>
        </div>

        {profile && profileTone ? (
          <div className={`relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br ${profileTone.ring} via-surface to-surface p-6`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ScoreRing score={profile.overall_score} />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-muted-foreground">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  Employability Score
                </div>
                <Badge className={`${ratingStyle[profile.consistency_analysis.rating] ?? "border-border bg-muted text-muted-foreground"} text-base font-semibold`}>
                  {profile.consistency_analysis.rating} Pacing
                </Badge>
                <p className="text-lg leading-relaxed text-foreground/90">
                  {profile.consistency_analysis.evaluation}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-surface/40 p-6 text-center">
            <Brain className="h-6 w-6 text-muted-foreground" />
            <p className="text-lg font-semibold text-foreground">Employability Score locked</p>
            <p className="text-base leading-relaxed text-muted-foreground">
              Add a GitHub, LeetCode, or Codeforces profile below to unlock this.
            </p>
          </div>
        )}
      </div>

      {/* One flat tab bar — everything about this candidate, in one place */}
      <Tabs defaultValue="fit" className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-surface/60 p-1.5">
          <TabsTrigger value="fit" className="text-base">
            <Target className="mr-1.5 h-3.5 w-3.5" />
            Role Fit
          </TabsTrigger>
          <TabsTrigger value="discrepancies" className="text-base">
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            Discrepancies
            {detected_discrepancies.length > 0 && (
              <Badge className="ml-1.5 h-5 min-w-5 justify-center rounded-full border-rose-500/30 bg-rose-500/10 px-1 text-sm text-rose-500">
                {detected_discrepancies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="feedback" className="text-base">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Strengths & Fixes
          </TabsTrigger>
          {profile && (
            <TabsTrigger value="dsa" className="text-base">
              <Trophy className="mr-1.5 h-3.5 w-3.5" />
              DSA Profile
            </TabsTrigger>
          )}
          {profile && (
            <TabsTrigger value="projects" className="text-base">
              <Code2 className="mr-1.5 h-3.5 w-3.5" />
              Project Rigor
            </TabsTrigger>
          )}
          {profile && (
            <TabsTrigger value="career" className="text-base">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Career Alignment
              {redFlags.length > 0 && (
                <Badge className="ml-1.5 h-5 min-w-5 justify-center rounded-full border-rose-500/30 bg-rose-500/10 px-1 text-sm text-rose-500">
                  {redFlags.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="roadmap" className="text-base">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Roadmap
          </TabsTrigger>
          {linkedinUsable && (
            <TabsTrigger value="linkedin" className="text-base">
              <Linkedin className="mr-1.5 h-3.5 w-3.5" />
              LinkedIn Cross-Check
              {linkedinUsable.cross_check_flags.length > 0 && (
                <Badge className="ml-1.5 h-5 min-w-5 justify-center rounded-full border-rose-500/30 bg-rose-500/10 px-1 text-sm text-rose-500">
                  {linkedinUsable.cross_check_flags.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/* Role fit */}
        <TabsContent value="fit" className="space-y-5 pt-4">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-violet-500">
              <Target className="h-3.5 w-3.5" />
              Fit for {role || "your target role"}
            </h4>
            <p className="text-lg leading-relaxed text-foreground/90">{role_fit.fit_summary}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="block text-base font-semibold uppercase tracking-wider text-emerald-500">
                Skills you have
              </span>
              <div className="flex flex-wrap gap-2">
                {role_fit.matched_skills.length > 0 ? (
                  role_fit.matched_skills.map((skill, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-lg text-emerald-600 dark:text-emerald-400"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-lg text-muted-foreground">None identified yet.</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <span className="block text-base font-semibold uppercase tracking-wider text-amber-500">
                Skills you're missing
              </span>
              <div className="flex flex-wrap gap-2">
                {role_fit.missing_skills.length > 0 ? (
                  role_fit.missing_skills.map((skill, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-lg text-amber-600 dark:text-amber-400"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-lg text-muted-foreground">No gaps found — great fit!</span>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Discrepancies */}
        <TabsContent value="discrepancies" className="pt-4">
          {detected_discrepancies.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {detected_discrepancies.map((disc, i) => (
                <div key={i} className="space-y-4 rounded-xl border border-border/60 bg-surface p-5">
                  <div>
                    <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-rose-500">
                      <FileText className="h-3.5 w-3.5" />
                      Resume claims
                    </h4>
                    <p className="mt-2 border-l-2 border-rose-500/30 pl-3 text-lg leading-relaxed text-foreground/90">
                      {disc.resume_claim}
                    </p>
                  </div>
                  <div>
                    <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-emerald-500">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      What we verified
                    </h4>
                    <p className="mt-2 border-l-2 border-emerald-500/30 pl-3 text-lg leading-relaxed text-muted-foreground">
                      {disc.portfolio_reality}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-lg text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              No discrepancies detected — your resume claims match your verified coding profiles perfectly.
            </div>
          )}
        </TabsContent>

        {/* Strengths, weaknesses & edits */}
        <TabsContent value="feedback" className="space-y-6 pt-4">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-emerald-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                Resume Strengths
              </h4>
              <ul className="space-y-3">
                {strengths.map((str, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 text-lg leading-relaxed text-foreground/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{str}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-amber-500">
                <AlertCircle className="h-3.5 w-3.5" />
                Formatting & Layout Weaknesses
              </h4>
              <ul className="space-y-3">
                {weaknesses.map((weak, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-amber-500/10 bg-amber-500/5 p-4 text-lg leading-relaxed text-foreground/90">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500/80" />
                    <span>{weak}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {resume_corrections.length > 0 && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-sky-500">
                <PenLine className="h-3.5 w-3.5" />
                Recommended Resume Edits
              </h4>
              <ul className="grid gap-3 sm:grid-cols-2">
                {resume_corrections.map((fix, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-sky-500/10 bg-sky-500/5 p-4 text-lg leading-relaxed text-foreground/90">
                    <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                    <span>{fix}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        {/* DSA Skill & Topic Distribution (LeetCode + Codeforces) */}
        {profile && (
          <TabsContent value="dsa" className="space-y-5 pt-4">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2.5">
                <div className="text-base font-semibold text-emerald-500 uppercase tracking-wider">Strong Topics</div>
                <div className="flex flex-wrap gap-2">
                  {profile.dsa_skills.strong_topics.map((tag) => (
                    <Badge
                      key={tag}
                      className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-base px-3 py-1.5"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="text-base font-semibold text-amber-500 uppercase tracking-wider">Growth Areas</div>
                <div className="flex flex-wrap gap-2">
                  {profile.dsa_skills.growth_areas.map((tag) => (
                    <Badge
                      key={tag}
                      className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/20 text-base px-3 py-1.5"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="text-lg leading-relaxed text-muted-foreground bg-surface-2/20 p-4 rounded-xl border border-border/40">
              <span className="font-semibold block mb-1 text-foreground text-base uppercase tracking-wider">DSA Depth Summary</span>
              {profile.dsa_skills.algorithmic_depth_summary}
            </div>
          </TabsContent>
        )}

        {/* GitHub Project Depth & Implementation Rigor */}
        {profile && (
          <TabsContent value="projects" className="pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {profile.project_rigor.map((repo, i) => (
                <div key={i} className="rounded-xl border border-border/60 bg-surface/40 p-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <span className="font-display font-semibold text-lg text-foreground">
                      {repo.repo_name}
                    </span>
                    <Badge className={`${complexityColors[repo.inferred_complexity] ?? "border-border text-foreground"} text-sm font-semibold px-2.5 py-1 shrink-0`}>
                      {repo.inferred_complexity} Complexity
                    </Badge>
                  </div>

                  <p className="text-lg leading-relaxed text-muted-foreground">
                    {repo.analysis}
                  </p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {repo.skills_developed.map((skill) => (
                      <Badge
                        key={skill}
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-500/20 text-base px-3 py-1.5"
                      >
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        )}

        {/* Career Alignment & Flags */}
        {profile && (
          <TabsContent value="career" className="space-y-5 pt-4">
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-violet-500">
                <Users className="h-3.5 w-3.5" />
                Recommended Career Tracks
              </h4>
              <div className="flex flex-wrap gap-2">
                {recommendedRoles.map((r) => (
                  <Badge key={r} className="bg-primary/10 text-primary border-primary/20 text-base px-3 py-1.5">
                    {r}
                  </Badge>
                ))}
              </div>
            </div>

            {greenFlags.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-emerald-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Observed Green Flags
                </h4>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {greenFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 text-lg leading-relaxed text-foreground/90">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {redFlags.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-rose-500">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Risk Factors / Red Flags
                </h4>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {redFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 text-lg leading-relaxed text-foreground/90">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {greenFlags.length === 0 && redFlags.length === 0 && (
              <div className="text-lg text-muted-foreground text-center py-4">No flags analyzed.</div>
            )}
          </TabsContent>
        )}

        {/* Roadmap (from employability analysis) + 7-day plan (from resume analysis) */}
        <TabsContent value="roadmap" className="space-y-5 pt-4">
          {profile && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
              <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Actionable Engineering Roadmap
              </h4>
              <p className="mt-3 text-lg leading-relaxed text-foreground/90 font-medium">
                {profile.actionable_feedback}
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {next_week_action_plan.map((task, i) => (
              <div key={i} className="rounded-xl border border-primary/15 bg-primary/5 p-4">
                <p className="text-lg leading-relaxed text-foreground/90">
                  {task.replace(/^Day\s*\d+\s*:?\s*/i, "")}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* LinkedIn Cross-Check — parallel to Discrepancies / Strengths & Fixes, self-contained */}
        {linkedinUsable && (
          <TabsContent value="linkedin" className="space-y-5 pt-4">
            {linkedinUsable.cross_check_flags.length > 0 ? (
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wider text-rose-500">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Resume vs. LinkedIn — Cross-Check Flags
                </h4>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {linkedinUsable.cross_check_flags.map((flag, i) => (
                    <li key={i} className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 text-lg leading-relaxed text-foreground/90 space-y-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                        {flag.field}
                      </div>
                      <p className="text-base text-muted-foreground">Resume: {flag.resume_value}</p>
                      <p className="text-base text-muted-foreground">LinkedIn: {flag.linkedin_value}</p>
                      <p>{flag.note}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-lg text-muted-foreground text-center py-4">
                No contradictions found between your resume and LinkedIn export.
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ── Missing-platform follow-up prompt ──────────────────────────────────

const PLATFORM_LABEL: Record<MissingPlatform, string> = {
  github: "GitHub",
  leetcode: "LeetCode",
  codeforces: "Codeforces",
};

const PLATFORM_PLACEHOLDER: Record<MissingPlatform, string> = {
  github: "https://github.com/username",
  leetcode: "https://leetcode.com/u/username",
  codeforces: "https://codeforces.com/profile/handle",
};

function MissingPlatformPrompt({
  platform,
  submitting,
  onSkip,
  onSubmit,
}: {
  platform: MissingPlatform;
  submitting: boolean;
  onSkip: () => void;
  onSubmit: (rawInput: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  return (
    <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-col items-center gap-4 px-6 py-5 text-center sm:flex-row sm:text-left">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold">
              We didn't find your {PLATFORM_LABEL[platform]}
            </h3>
            <p className="mt-0.5 text-base leading-relaxed text-muted-foreground">
              Want to add it for a fuller analysis?
            </p>
          </div>
          {!open && (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={onSkip} disabled={submitting}>
                No
              </Button>
              <Button
                size="sm"
                onClick={() => setOpen(true)}
                disabled={submitting}
                className="bg-gradient-brand text-primary-foreground"
              >
                Yes, add it
              </Button>
            </div>
          )}
        </div>
        <CollapsibleContent>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-6 py-4">
            <Input
              placeholder={PLATFORM_PLACEHOLDER[platform]}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && onSubmit(input)}
              className="min-w-[220px] flex-1"
              disabled={submitting}
            />
            <Button
              onClick={() => onSubmit(input)}
              disabled={submitting || !input.trim()}
              className="bg-gradient-brand text-primary-foreground"
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {submitting ? "Analyzing…" : "Submit"}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ── Composite panel ─────────────────────────────────────────────────────

export function ProfileAnalyzerPanel() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [targetRole, setTargetRole] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [combined, setCombined] = useState<CombinedAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [knownUsernames, setKnownUsernames] = useState<{
    github?: string;
    leetcode?: string;
    codeforces?: string;
  }>({});
  const [dismissedPlatforms, setDismissedPlatforms] = useState<Set<MissingPlatform>>(new Set());
  const setResumeAnalysisResult = useResumeAnalysisStore((s) => s.setResult);

  // ── LinkedIn analyzer state (independent of the resume flow above — its
  // result feeds into CombinedAnalysisResultView once both exist) ──
  const [linkedinFile, setLinkedinFile] = useState<File | null>(null);
  const [linkedinConsent, setLinkedinConsent] = useState(false);
  const [linkedinAnalyzing, setLinkedinAnalyzing] = useState(false);
  const [linkedinResult, setLinkedinResult] = useState<LinkedInAnalysisResult | null>(null);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);

  const currentMissingPlatform: MissingPlatform | null =
    combined?.missing_platforms.find((p) => !dismissedPlatforms.has(p)) ?? null;

  const onLinkedinFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf")) {
        setLinkedinFile(selected);
        setLinkedinError(null);
        setLinkedinResult(null);
      } else {
        setLinkedinError("Please select a PDF file.");
      }
    }
  };

  const handleAnalyzeLinkedin = async () => {
    if (!linkedinFile || !linkedinConsent) return;
    setLinkedinAnalyzing(true);
    setLinkedinError(null);
    setLinkedinResult(null);
    try {
      const res = await linkedinService.analyze(linkedinFile);
      setLinkedinResult(res);
      if (!res.is_valid_linkedin_export) {
        setLinkedinError(res.invalid_reason ?? "This PDF doesn't look like a LinkedIn profile export.");
      }
    } catch (err: unknown) {
      setLinkedinError(err instanceof Error ? err.message : "LinkedIn analysis failed.");
    } finally {
      setLinkedinAnalyzing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf")) {
        setResumeFile(selected);
        setError(null);
        setCombined(null);
        setKnownUsernames({});
        setDismissedPlatforms(new Set());
      } else {
        setError("Please select a PDF file.");
      }
    }
  };

  const runAnalysis = async (usernames: typeof knownUsernames) => {
    if (!resumeFile || !targetRole) return;
    const res = await syncService.analyzeResume(resumeFile, targetRole, usernames);
    setCombined(res);
    setKnownUsernames((prev) => ({ ...prev, ...res.detected_profiles }));
    setResumeAnalysisResult(res.resume_analysis, targetRole);
  };

  const handleAnalyze = async () => {
    if (!resumeFile || !targetRole) return;
    setAnalyzing(true);
    setError(null);
    setCombined(null);
    try {
      await runAnalysis({});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMissingPlatformSubmit = async (platform: MissingPlatform, rawInput: string) => {
    const normalize =
      platform === "github" ? extractGitHubUsername
      : platform === "leetcode" ? extractLeetCodeUsername
      : extractCodeforcesHandle;
    const nextKnown = { ...knownUsernames, [platform]: normalize(rawInput) };
    setRefreshing(true);
    setError(null);
    try {
      await runAnalysis(nextKnown);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* LinkedIn Analyzer — self-export PDF, analyzed the same way the resume is; no
          legitimate API can fetch an arbitrary LinkedIn profile by URL. */}
      <Card className="p-6">
        <div className="flex items-center gap-3 border-b border-border/60 pb-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Linkedin className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-xl font-semibold">LinkedIn Analyzer</h3>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Upload your LinkedIn profile as a PDF — we'll analyze it directly and cross-check
              it against your resume once you've analyzed that too.
            </p>
          </div>
          {linkedinResult?.is_valid_linkedin_export && (
            <Badge className="border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Analyzed
            </Badge>
          )}
        </div>

        <div className="pt-5 space-y-5">
          {/* Guidance steps */}
          <ol className="grid gap-2 sm:grid-cols-2 text-lg leading-relaxed text-foreground/90">
            {[
              "Go to your LinkedIn profile page.",
              'Click the "Resources" dropdown, just below your profile photo.',
              'Select "Save to PDF".',
              "Upload the downloaded PDF below.",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-border/50 bg-surface/40 p-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-base font-semibold text-primary">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {/* Upload + consent + analyze */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <input
                type="file"
                accept=".pdf"
                onChange={onLinkedinFileChange}
                className="hidden"
                id="linkedin-upload-input"
                disabled={linkedinAnalyzing}
              />
              <Button
                asChild
                variant="outline"
                className="cursor-pointer"
                disabled={linkedinAnalyzing}
              >
                <label htmlFor="linkedin-upload-input" className="flex items-center gap-2">
                  <Linkedin className="h-4 w-4" />
                  {linkedinFile ? "Change PDF" : "Select LinkedIn PDF"}
                </label>
              </Button>
            </div>

            {linkedinFile && (
              <div className="flex items-center gap-2 bg-surface/80 px-4 py-2 rounded-xl border border-border text-lg">
                <span className="font-medium text-foreground truncate max-w-[240px]">
                  {linkedinFile.name}
                </span>
                <span className="text-base text-muted-foreground">
                  ({(linkedinFile.size / 1024).toFixed(1)} KB)
                </span>
                <button
                  onClick={() => {
                    setLinkedinFile(null);
                    setLinkedinResult(null);
                    setLinkedinError(null);
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                  disabled={linkedinAnalyzing}
                >
                  &times;
                </button>
              </div>
            )}

            {linkedinFile && (
              <Button
                onClick={handleAnalyzeLinkedin}
                disabled={linkedinAnalyzing || !linkedinConsent}
                title={!linkedinConsent ? "Confirm consent below first" : undefined}
                className="bg-gradient-brand text-primary-foreground flex items-center gap-2"
              >
                {linkedinAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4" />
                    Analyze LinkedIn
                  </>
                )}
              </Button>
            )}
          </div>

          <label className="flex items-start gap-2 text-lg leading-relaxed text-foreground/90">
            <Checkbox
              checked={linkedinConsent}
              onCheckedChange={(checked) => setLinkedinConsent(checked === true)}
              disabled={linkedinAnalyzing}
              className="mt-0.5"
            />
            <span>I consent to my LinkedIn PDF export being analyzed by AI for this assessment.</span>
          </label>

          {linkedinFile && !linkedinConsent && (
            <p className="text-base text-amber-500 flex items-center gap-1.5 leading-relaxed">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Confirm consent above to enable analysis.
            </p>
          )}

          {linkedinError && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-lg leading-relaxed text-destructive animate-in fade-in duration-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {linkedinError}
            </div>
          )}

          {/* Standalone LinkedIn summary — folds into the combined view below once the resume is also analyzed */}
          {linkedinResult?.is_valid_linkedin_export && (
            <div className="rounded-2xl border border-primary/20 bg-surface/40 p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <ScoreRing score={linkedinResult.overall_rating_score} />
                <div className="flex-1 space-y-1">
                  {linkedinResult.headline && (
                    <p className="text-lg font-semibold text-foreground">{linkedinResult.headline}</p>
                  )}
                  <p className="text-lg leading-relaxed text-foreground/90">{linkedinResult.overall_rating_summary}</p>
                </div>
              </div>

              {linkedinResult.sections.length > 0 && (
                <Accordion type="single" collapsible className="w-full">
                  {linkedinResult.sections.map((s) => (
                    <AccordionItem key={s.section} value={s.section}>
                      <AccordionTrigger className="text-lg hover:no-underline">
                        <div className="flex items-center gap-2.5">
                          <Badge className={`${sectionRatingStyle[s.rating]} text-sm font-semibold px-2 py-0.5`}>
                            {s.rating}
                          </Badge>
                          <span className="font-medium">{s.section}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 text-lg">
                        <div className="space-y-1">
                          <h5 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            <FileText className="h-3 w-3" />
                            Current Profile
                          </h5>
                          <p className="text-foreground/90">{s.current_summary}</p>
                        </div>
                        {s.gap_reason && (
                          <div className="space-y-1">
                            <h5 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-amber-500">
                              <AlertCircle className="h-3 w-3" />
                              Gaps in Profile
                            </h5>
                            <p className="text-foreground/90">{s.gap_reason}</p>
                          </div>
                        )}
                        {s.suggestions.length > 0 && (
                          <div className="space-y-1.5">
                            <h5 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-primary">
                              <PenLine className="h-3 w-3" />
                              Improvement Suggestions
                            </h5>
                            <ul className="space-y-1.5">
                              {s.suggestions.map((sugg, i) => (
                                <li key={i} className="flex items-start gap-2 text-foreground/90">
                                  <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                                  <span>{sugg}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3 border-b border-border/60 pb-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-xl font-semibold">Resume Analyzer</h3>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Upload your resume and pick a target role — we'll pull your GitHub, LeetCode, and
              Codeforces profiles straight from the links inside it and run one complete analysis.
            </p>
          </div>
          {combined && (
            <Badge className="border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Analyzed
            </Badge>
          )}
        </div>

        <div className="pt-5 space-y-5">
          {/* Step 1: target role */}
          <div className="space-y-2">
            <label className="text-base font-semibold text-foreground flex items-center gap-1.5">
              <Target className="h-4 w-4 text-primary" />
              Target Role <span className="text-destructive">*</span>
            </label>
            <Select
              value={targetRole}
              onValueChange={setTargetRole}
              disabled={analyzing}
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
                disabled={analyzing}
              />
              <Button
                asChild
                variant="outline"
                className="cursor-pointer"
                disabled={analyzing}
              >
                <label htmlFor="resume-upload-input" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {resumeFile ? "Change PDF" : "Select Resume PDF"}
                </label>
              </Button>
            </div>

            {resumeFile && (
              <div className="flex items-center gap-2 bg-surface/80 px-4 py-2 rounded-xl border border-border text-lg">
                <span className="font-medium text-foreground truncate max-w-[240px]">
                  {resumeFile.name}
                </span>
                <span className="text-base text-muted-foreground">
                  ({(resumeFile.size / 1024).toFixed(1)} KB)
                </span>
                <button
                  onClick={() => {
                    setResumeFile(null);
                    setCombined(null);
                    setError(null);
                    setKnownUsernames({});
                    setDismissedPlatforms(new Set());
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                  disabled={analyzing}
                >
                  &times;
                </button>
              </div>
            )}

            {resumeFile && (
              <Button
                onClick={handleAnalyze}
                disabled={analyzing || !targetRole}
                title={!targetRole ? "Select a target role first" : undefined}
                className="bg-gradient-brand text-primary-foreground flex items-center gap-2"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4" />
                    Analyze
                  </>
                )}
              </Button>
            )}
          </div>

          {resumeFile && !targetRole && (
            <p className="text-base text-amber-500 flex items-center gap-1.5 leading-relaxed">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Select a target role above to enable analysis.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-lg leading-relaxed text-destructive animate-in fade-in duration-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Combined analysis output */}
          {combined && (
            <CombinedAnalysisResultView
              resume={combined.resume_analysis}
              profile={combined.profile_analysis}
              linkedin={linkedinResult}
              role={targetRole}
            />
          )}
        </div>
      </Card>

      {/* Sequential missing-platform follow-up — asks about one platform at a time */}
      {currentMissingPlatform && (
        <MissingPlatformPrompt
          key={currentMissingPlatform}
          platform={currentMissingPlatform}
          submitting={refreshing}
          onSkip={() =>
            setDismissedPlatforms((prev) => new Set(prev).add(currentMissingPlatform))
          }
          onSubmit={(raw) => handleMissingPlatformSubmit(currentMissingPlatform, raw)}
        />
      )}
    </div>
  );
}

