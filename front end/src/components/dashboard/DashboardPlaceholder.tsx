import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Construction, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/store/auth";

interface Props {
  role: "Candidate" | "Company" | "College" | "Admin";
  modules: string[];
}

export function DashboardPlaceholder({ role, modules }: Props) {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);

  const signOut = () => {
    logout();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-mesh">
      <header className="glass-strong sticky top-0 z-20 border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="font-display text-sm font-bold leading-none">Project X</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{role} Portal</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            {session?.user && (
              <div className="hidden text-right text-xs md:block">
                <div className="font-medium text-foreground">{session.user.name}</div>
                <div className="text-muted-foreground">{session.user.email}</div>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-16 md:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="border-primary/20 p-10 text-center shadow-glow">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground">
              <Construction className="h-8 w-8" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-bold">
              {role} Dashboard — <span className="text-gradient">coming next</span>
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
              Phase 1 shipped the foundation, landing page, portal selection and auth flows. The full{" "}
              {role.toLowerCase()} workspace is scoped for the next module prompt.
            </p>

            <div className="mt-8 grid gap-2 text-left sm:grid-cols-2">
              {modules.map((m) => (
                <div
                  key={m}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-gradient-brand" />
                  {m}
                </div>
              ))}
            </div>

            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline">
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to home
                </Link>
              </Button>
              <Button asChild className="bg-gradient-brand text-primary-foreground">
                <Link to="/portals">Switch portal</Link>
              </Button>
            </div>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
