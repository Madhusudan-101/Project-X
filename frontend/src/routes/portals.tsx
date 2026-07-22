import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { GraduationCap, Building2, School, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/types";

export const Route = createFileRoute("/portals")({
  head: () => ({
    meta: [
      { title: "Choose your portal — Mirracle" },
      { name: "description", content: "Sign in as a Candidate, Company, College or Admin to enter Mirracle." },
    ],
  }),
  component: PortalsPage,
});

interface Portal {
  role: UserRole;
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: string;
}

const PORTALS: Portal[] = [
  { role: "candidate", title: "Candidate", desc: "Practice AI interviews, analyze your resume, and track applications.", icon: GraduationCap, accent: "from-primary to-secondary" },
  { role: "company", title: "Company", desc: "Create interviews, run OAs, and rank candidates end-to-end.", icon: Building2, accent: "from-secondary to-accent" },
  { role: "college", title: "College", desc: "Manage students, campus drives and placement analytics.", icon: School, accent: "from-accent to-primary" },
  { role: "admin", title: "Admin", desc: "Operate the platform — users, billing, question banks and support.", icon: ShieldCheck, accent: "from-primary to-accent" },
];

function PortalsPage() {
  return (
    <div className="relative min-h-screen bg-hero">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <div className="text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold">Mirracle</span>
          </Link>
          <h1 className="mx-auto mt-8 max-w-2xl font-display text-4xl font-bold md:text-5xl">
            Choose your <span className="text-gradient">portal</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Every persona has a purpose-built workspace. Pick the one that matches your role to continue.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PORTALS.map((p, i) => (
            <motion.div
              key={p.role}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <Card className="group relative h-full overflow-hidden border-border/60 p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow">
                <div
                  className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${p.accent} opacity-80`}
                />
                <div className="flex items-start gap-4">
                  <div className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${p.accent} text-primary-foreground shadow-soft`}>
                    <p.icon className="h-7 w-7" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-xl font-semibold">{p.title}</h3>
                      <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
                    <div className="mt-4 flex gap-2">
                      <Button
                        asChild
                        size="sm"
                        className="bg-gradient-brand text-primary-foreground"
                      >
                        <Link to="/auth/login" search={{ role: p.role }}>Login</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to="/auth/signup" search={{ role: p.role }}>Sign up</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 text-center text-sm text-muted-foreground">
          <Link to="/" className="hover:text-primary">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
