import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { useCollegeGuard } from "@/hooks/college/use-college-guard";
import { CollegeShell } from "@/components/college/CollegeShell";

export const Route = createFileRoute("/college")({
  component: CollegeLayout,
});

function CollegeLayout() {
  const navigate = useNavigate();
  const session = useCollegeGuard();
  const logout = useAuthStore((s) => s.logout);

  const displayName = useMemo(() => {
    const u = session?.user;
    if (!u) return "";
    if (u.firstName || u.lastName) return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    return u.name ?? "";
  }, [session]);

  const initials = useMemo(() => {
    const u = session?.user;
    const source =
      u?.firstName || u?.lastName ? `${u?.firstName ?? ""} ${u?.lastName ?? ""}` : u?.name;
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
    navigate({ to: "/" });
  };

  if (!session) return null;

  return (
    <CollegeShell
      displayName={displayName}
      email={session.user?.email ?? ""}
      initials={initials}
      onExit={signOut}
    />
  );
}
