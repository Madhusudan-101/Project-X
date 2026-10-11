import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CollegeShell } from "@/components/college/CollegeShell";
import { DEMO_COLLEGE_NAME } from "@/lib/demo/college/mode";
import { useCollegeDemoStore } from "@/store/demo/collegeDemo";

/**
 * College Portal — Demo Mode (/demo/college/*). Public on purpose: it serves only the
 * fictional sample dataset held in this tab's sessionStorage and never calls the API.
 *
 * Deliberately does NOT use useCollegeGuard / useAuthStore: it neither reads nor writes
 * the visitor's real session, and it trusts no client-supplied role. A signed-in user can
 * open it and their session is left exactly as it was.
 */
export const Route = createFileRoute("/demo/college")({
  head: () => ({
    meta: [
      { title: `College Portal demo — ${DEMO_COLLEGE_NAME} · Mirracle` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DemoCollegeLayout,
});

function DemoCollegeLayout() {
  const navigate = useNavigate();
  const [resetCount, setResetCount] = useState(0);

  const resetDemo = () => {
    useCollegeDemoStore.getState().reset();
    setResetCount((n) => n + 1); // remount the page so every list reloads from the fresh data
    toast.success("Demo data reset to the original sample college.");
  };

  const exitDemo = () => {
    // Leave no demo state behind; the real auth session (if any) is not touched.
    useCollegeDemoStore.getState().reset();
    navigate({ to: "/auth/login", search: { role: "college" } as never });
  };

  return (
    <CollegeShell
      demo
      displayName="Demo TPO"
      email="demo.tpo@northstar-demo.example"
      initials="DT"
      onExit={exitDemo}
      onResetDemo={resetDemo}
      contentKey={resetCount}
    />
  );
}
