import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Users,
  FileText,
  Code2,
  GraduationCap,
  Building2,
  BarChart3,
  Sparkles,
  ShieldCheck,
  Play,
  Check,
  Star,
  Zap,
  Brain,
  Video,
} from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const FEATURES = [
  { icon: Bot, title: "AI Interviews", desc: "Adaptive AI interviewer with voice, avatar, code editor and live scoring." },
  { icon: Users, title: "Peer Interviews", desc: "Smart matchmaking with shared code editor, whiteboard and feedback." },
  { icon: FileText, title: "Resume Analyzer", desc: "ATS score, keyword gap, and AI-rewritten resume in seconds." },
  { icon: Code2, title: "Code Analyzers", desc: "Github & Leetcode deep-dive with AI-generated insights." },
  { icon: Brain, title: "OA Platform", desc: "MCQ, coding, SQL, aptitude — proctored with a live leaderboard." },
  { icon: BarChart3, title: "Placement Analytics", desc: "Department-level dashboards, rankings, and campus drive reporting." },
];

const STATS = [
  { value: "50K+", label: "Interviews conducted" },
  { value: "1.2K", label: "Partner companies" },
  { value: "320", label: "Colleges onboarded" },
  { value: "97%", label: "Recruiter satisfaction" },
];

const STEPS = [
  { icon: Sparkles, title: "Sign up", desc: "Pick your portal — Candidate, Company, College or Admin." },
  { icon: Zap, title: "Configure", desc: "Upload resumes, create interviews, or import your placement cell." },
  { icon: Video, title: "Interview", desc: "Run AI, peer, or expert interviews with rich, real-time evaluation." },
  { icon: BarChart3, title: "Analyze", desc: "Ship data-backed hiring and placement decisions faster." },
];

const TESTIMONIALS = [
  {
    quote: "Project X replaced three separate tools. Our time-to-hire dropped 42% in a single quarter.",
    name: "Aditi Rao",
    role: "Head of Talent, Northwind",
  },
  {
    quote: "The AI interviewer feels like our best senior engineer — consistent, unbiased, and thorough.",
    name: "Marcus Lee",
    role: "VP Engineering, Helios",
  },
  {
    quote: "Placement analytics across departments finally gave us the visibility we lacked for years.",
    name: "Dr. Priya Menon",
    role: "Placement Director, BITS",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    desc: "For individual candidates.",
    features: ["AI Interview trials", "Resume Analyzer", "Public Leaderboard", "Community support"],
    cta: "Get started",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$49",
    period: "per user / mo",
    desc: "For growing teams and colleges.",
    features: ["Unlimited AI Interviews", "Peer + Expert interviews", "OA Platform", "Analytics dashboards", "Priority support"],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    desc: "For large campuses & enterprises.",
    features: ["SSO & SAML", "Custom question banks", "Dedicated CSM", "SLA & audit logs", "On-prem AI options"],
    cta: "Talk to sales",
    highlighted: false,
  },
];

const FAQS = [
  { q: "Is Project X available for individual candidates?", a: "Yes — sign up on the Candidate portal to access AI interviews, resume analysis, and code portfolio insights for free." },
  { q: "Can we bring our own question banks?", a: "Absolutely. Companies and colleges can import CSV/JSON banks or build them visually in the studio." },
  { q: "Which languages does the AI interviewer support?", a: "The interviewer supports 12+ languages including English, Hindi, Spanish, French, German, and Japanese." },
  { q: "How is candidate data handled?", a: "SOC2-aligned controls, region-pinned storage, and per-tenant encryption keys are standard on Growth and above." },
  { q: "Do you offer campus-wide licensing?", a: "Yes — Enterprise includes unlimited students, department dashboards, and dedicated placement analytics." },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden bg-hero">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 md:px-6 lg:grid-cols-2 lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col justify-center"
          >
            <Badge className="w-fit border border-primary/20 bg-primary-soft text-primary hover:bg-primary-soft">
              <Sparkles className="mr-1 h-3 w-3" /> AI-native hiring ecosystem
            </Badge>
            <h1 className="mt-5 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Hire smarter. <span className="text-gradient">Prepare faster.</span>
              <br />
              Place better.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Project X connects candidates, companies, and colleges in one AI-powered hiring
              platform — interviews, assessments, analytics, and placement in a single workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-gradient-brand text-primary-foreground shadow-glow transition-transform hover:-translate-y-0.5"
              >
                <Link to="/portals">
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="border-primary/30">
                <Play className="mr-2 h-4 w-4" /> Book a Demo
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> SOC2-aligned
              </div>
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" /> 4.9 / 5 average rating
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Set up in minutes
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="relative"
          >
            <div className="glass-strong rounded-3xl p-6 shadow-glow">
              <div className="flex items-center justify-between border-b border-border/60 pb-4">
                <div className="flex items-center gap-2">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand">
                    <Bot className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Frontend Engineer · Round 2</div>
                    <div className="text-xs text-muted-foreground">AI Interviewer · 42:18 elapsed</div>
                  </div>
                </div>
                <Badge className="bg-success/15 text-success hover:bg-success/15">Live</Badge>
              </div>
              <div className="mt-4 rounded-2xl bg-surface-2 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Current question</div>
                <div className="mt-2 font-medium">
                  Design a debounced search input that cancels in-flight requests. Walk me through your
                  approach.
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  { l: "Communication", v: 92 },
                  { l: "Technical depth", v: 88 },
                  { l: "Problem solving", v: 84 },
                ].map((m) => (
                  <div key={m.l} className="rounded-xl border border-border bg-surface p-3">
                    <div className="text-xs text-muted-foreground">{m.l}</div>
                    <div className="mt-1 text-2xl font-semibold text-gradient">{m.v}</div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-gradient-brand" style={{ width: `${m.v}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-primary-soft p-3 text-sm text-primary">
                <Sparkles className="h-4 w-4" /> AI suggested follow-up: cache invalidation strategy
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* STATS */}
      <section className="border-y border-border/60 bg-surface">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 md:grid-cols-4 md:px-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-3xl font-bold text-gradient md:text-4xl">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 md:px-6">
        <div className="max-w-2xl">
          <Badge className="border border-primary/20 bg-primary-soft text-primary hover:bg-primary-soft">Features</Badge>
          <h2 className="mt-3 font-display text-4xl font-bold">One platform. Every hiring workflow.</h2>
          <p className="mt-3 text-muted-foreground">
            Purpose-built modules for candidates, companies, and colleges — sharing a unified data
            layer so every insight compounds.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <Card className="group h-full border-border/60 p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-soft">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-brand-soft text-primary transition-transform group-hover:scale-110">
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* PORTALS ANCHORS */}
      <section className="mx-auto max-w-7xl px-4 pb-12 md:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { id: "candidates", icon: GraduationCap, title: "For Candidates", desc: "Interview practice, code portfolio and OA prep — all AI-powered." },
            { id: "companies", icon: Building2, title: "For Companies", desc: "Custom AI interviews, ranking, and end-to-end applicant tracking." },
            { id: "colleges", icon: GraduationCap, title: "For Colleges", desc: "Placement analytics, campus drives and department dashboards." },
          ].map((p) => (
            <Card key={p.id} id={p.id} className="scroll-mt-24 border-border/60 p-6">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-brand text-primary-foreground">
                <p.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
              <Button asChild variant="link" className="mt-3 h-auto p-0 text-primary">
                <Link to="/portals">
                  Explore portal <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </Card>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="about" className="scroll-mt-20 bg-mesh py-24">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="max-w-2xl">
            <Badge className="border border-primary/20 bg-primary-soft text-primary hover:bg-primary-soft">How it works</Badge>
            <h2 className="mt-3 font-display text-4xl font-bold">From signup to signed offer — in one flow.</h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Card key={s.title} className="relative border-border/60 p-6">
                <div className="absolute right-4 top-4 font-display text-4xl font-bold text-primary/10">
                  0{i + 1}
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-brand text-primary-foreground">
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="mt-4 font-semibold">{s.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="mx-auto max-w-7xl px-4 py-24 md:px-6">
        <div className="max-w-2xl">
          <Badge className="border border-primary/20 bg-primary-soft text-primary hover:bg-primary-soft">Loved by teams</Badge>
          <h2 className="mt-3 font-display text-4xl font-bold">Trusted by recruiters, engineers and placement cells.</h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <Card key={t.name} className="border-border/60 p-6">
              <div className="flex gap-1 text-primary">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-foreground">"{t.quote}"</p>
              <div className="mt-5 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground">
                  {t.name[0]}
                </div>
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="scroll-mt-20 bg-surface-2 py-24">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <Badge className="border border-primary/20 bg-primary-soft text-primary hover:bg-primary-soft">Pricing</Badge>
            <h2 className="mt-3 font-display text-4xl font-bold">Simple, scalable pricing.</h2>
            <p className="mt-3 text-muted-foreground">Start free. Upgrade when your team is ready.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PLANS.map((p) => (
              <Card
                key={p.name}
                className={`relative p-6 ${p.highlighted ? "border-primary/40 shadow-glow" : "border-border/60"}`}
              >
                {p.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-brand px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Most popular
                  </div>
                )}
                <div className="text-sm font-semibold text-muted-foreground">{p.name}</div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold">{p.price}</span>
                  <span className="text-sm text-muted-foreground">/ {p.period}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
                <ul className="mt-6 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className={`mt-6 w-full ${p.highlighted ? "bg-gradient-brand text-primary-foreground shadow-soft" : ""}`}
                  variant={p.highlighted ? "default" : "outline"}
                >
                  <Link to="/portals">{p.cta}</Link>
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-4xl px-4 py-24 md:px-6">
        <div className="text-center">
          <Badge className="border border-primary/20 bg-primary-soft text-primary hover:bg-primary-soft">FAQ</Badge>
          <h2 className="mt-3 font-display text-4xl font-bold">Answers to common questions.</h2>
        </div>
        <Accordion type="single" collapsible className="mt-10">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left font-medium">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-24 md:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-brand p-10 shadow-glow md:p-16">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h3 className="font-display text-3xl font-bold text-primary-foreground md:text-4xl">
                Ready to modernize your hiring pipeline?
              </h3>
              <p className="mt-2 max-w-xl text-primary-foreground/80">
                Start free. Invite your team. Ship better hiring decisions this quarter.
              </p>
            </div>
            <div className="flex gap-3">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90">
                <Link to="/portals">
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="border-white/40 bg-transparent text-primary-foreground hover:bg-white/10">
                Book Demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
