import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Briefcase,
  Building2,
  ClipboardList,
  FileCheck2,
  Layers,
  LineChart,
  Rocket,
  Settings2,
  Sparkles,
  Star,
  Target,
  UserPlus,
  Users,
  Video,
  Wand2,
} from "lucide-react";
import { EngagingDashboard } from "@/components/dashboard/EngagingDashboard";

export const Route = createFileRoute("/company")({
  component: () => (
    <EngagingDashboard
      role="Company"
      tagline="Hiring, on autopilot"
      headline="Ship better hires with an |AI-native| interviewing studio."
      subhead="Post roles, auto-screen candidates, run structured AI interviews, and rank talent — all in one workspace."
      primaryCta={{ label: "Post a new role", icon: Rocket }}
      secondaryCta={{ label: "Launch AI interview", icon: Video }}
      stats={[]}
      modules={[
        { label: "Jobs", description: "Publish, clone, and A/B test job listings in seconds.", icon: Briefcase, status: "Live", accent: "primary" },
        { label: "Applicants", description: "Unified pipeline with AI screening scores and notes.", icon: Users, status: "Live", accent: "secondary" },
        { label: "AI Interview Studio", description: "Design branching interviews with rubric-based scoring.", icon: Wand2, status: "Beta", accent: "primary" },
        { label: "OA Builder", description: "Drag-and-drop coding, MCQ, and case assessments.", icon: ClipboardList, status: "Live", accent: "secondary" },
        { label: "Interview Templates", description: "Battle-tested question sets by role and level.", icon: Layers, status: "Live", accent: "primary" },
        { label: "Candidate Ranking", description: "Explainable AI ranks candidates against your rubric.", icon: Star, status: "Beta", accent: "secondary" },
        { label: "Analytics", description: "Funnel, source, and diversity metrics that matter.", icon: LineChart, status: "Live", accent: "primary" },
        { label: "Team & Settings", description: "Roles, SSO, integrations, and interviewer calibration.", icon: Settings2, status: "Live", accent: "secondary" },
      ]}
      goals={[]}
      activity={[]}
      highlight={{
        eyebrow: "Studio tip",
        title: "Turn your best interview into a template",
        body: "Clone a high-signal interview, share it with your team, and calibrate in one click.",
        icon: Sparkles,
      }}
    />
  ),
});

export const CompanyIcons = { Building2, BarChart3, FileCheck2, UserPlus };
