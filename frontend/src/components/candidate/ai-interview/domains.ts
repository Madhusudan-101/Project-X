import type { AiInterviewDomain } from "@/types/candidate/aiInterview";

export interface DomainInfo {
  id: AiInterviewDomain;
  label: string;
  /** Formal role title shown on the briefing and in the meeting room. */
  role: string;
  blurb: string;
  topics: string[];
}

export const DOMAINS: DomainInfo[] = [
  {
    id: "ai_ml",
    label: "AI / ML",
    role: "AI / ML Engineer",
    blurb: "Fundamentals, overfitting, productionizing models",
    topics: ["Model fundamentals", "Evaluation and overfitting", "Productionizing models"],
  },
  {
    id: "web_dev",
    label: "Web Development",
    role: "Web Developer",
    blurb: "HTTP, rendering, APIs, caching, auth",
    topics: ["HTTP and APIs", "Rendering and performance", "Caching and authentication"],
  },
  {
    id: "dsa",
    label: "Data Structures & Algorithms",
    role: "Software Engineer",
    blurb: "Complexity, core structures, classic problems",
    topics: ["Complexity analysis", "Core data structures", "Classic problems"],
  },
];

export const domainInfo = (id: AiInterviewDomain) => DOMAINS.find((d) => d.id === id);

/** Fallback shown before a session exists; the live timer uses the server's maxMinutes. */
export const DEFAULT_MAX_MINUTES = 20;
