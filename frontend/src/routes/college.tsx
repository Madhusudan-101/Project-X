import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  GraduationCap,
  LineChart,
  Medal,
  Presentation,
  School,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { EngagingDashboard } from "@/components/dashboard/EngagingDashboard";

export const Route = createFileRoute("/college")({
  component: () => (
    <EngagingDashboard
      role="College"
      tagline="Placement season, simplified"
      headline="Turn every batch into a |placement-ready| cohort."
      subhead="Track readiness, run campus drives, and give every student a data-backed path to their first offer."
      primaryCta={{ label: "Schedule campus drive", icon: CalendarCheck }}
      secondaryCta={{ label: "View placement report", icon: BarChart3 }}
      stats={[]}
      modules={[
        { label: "Students", description: "Unified roster with readiness scores and interview history.", icon: Users, status: "Live", accent: "primary" },
        { label: "Departments", description: "Compare readiness and outcomes across departments.", icon: School, status: "Live", accent: "secondary" },
        { label: "Placement Analytics", description: "Live funnels: applications → interviews → offers.", icon: LineChart, status: "Live", accent: "primary" },
        { label: "Companies", description: "Manage recruiter relationships and eligibility criteria.", icon: Building2, status: "Live", accent: "secondary" },
        { label: "Campus Drives", description: "Schedule, invite, and coordinate on-campus drives.", icon: CalendarCheck, status: "Live", accent: "primary" },
        { label: "Reports", description: "Auto-generated NAAC / NIRF-ready placement reports.", icon: Presentation, status: "Beta", accent: "secondary" },
        { label: "Faculty", description: "Assign mentors and monitor per-mentor readiness.", icon: UsersRound, status: "Live", accent: "primary" },
        { label: "Readiness Goals", description: "Set cohort targets and track weekly progress.", icon: Target, status: "Beta", accent: "secondary" },
      ]}
      goals={[]}
      activity={[]}
      highlight={{
        eyebrow: "This week",
        title: "Boost weakest cohort with a targeted bootcamp",
        body: "AI flagged Mechanical batch A for a 5-day DSA + aptitude sprint. One click to launch.",
        icon: Sparkles,
      }}
    />
  ),
});

export const CollegeIcons = { Building2 };
