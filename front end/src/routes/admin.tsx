import { createFileRoute } from "@tanstack/react-router";
import { DashboardPlaceholder } from "@/components/dashboard/DashboardPlaceholder";

export const Route = createFileRoute("/admin")({
  component: () => (
    <DashboardPlaceholder
      role="Admin"
      modules={[
        "Users",
        "Candidates",
        "Companies",
        "Colleges",
        "Interviewers",
        "Payments",
        "Subscriptions",
        "Question Banks",
        "Support",
        "Analytics",
        "Revenue",
        "System Monitoring",
      ]}
    />
  ),
});
