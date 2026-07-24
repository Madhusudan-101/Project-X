/**
 * Derives a "Skill DNA" radar + breakdown from the skills the resume analyzer
 * matched against the candidate's target role. Keeps the categorization rule
 * (keyword → dimension) in one place so the radar and the breakdown panel
 * can never disagree with each other.
 */

export interface SkillDnaPoint {
  skill: string;
  value: number;
}

export interface SkillDnaBreakdownItem {
  label: string;
  value: number;
  note: string;
}

const DNA_DIMENSIONS = ["DSA", "System Design", "Backend", "Frontend", "DevOps", "ML/AI"] as const;

type DnaDimension = (typeof DNA_DIMENSIONS)[number];

const DIMENSION_KEYWORDS: Record<DnaDimension, string[]> = {
  DSA: ["data structure", "algorithm", "dsa", "leetcode", "competitive programming", "problem solving", "problem-solving"],
  "System Design": ["system design", "distributed system", "microservice", "scalab", "architecture", "load balanc", "high availability", "caching", "message queue", "kafka", "event-driven", "event driven"],
  Backend: ["backend", "back-end", "node", "express", "django", "flask", "spring", "api", "rest", "graphql", "sql", "postgres", "mysql", "mongodb", "redis", "server-side", "java", "golang", "go lang", "c#", ".net", "fastapi"],
  Frontend: ["frontend", "front-end", "react", "vue", "angular", "javascript", "typescript", "css", "html", "next.js", "nextjs", "tailwind", "ui/ux", "ui design", "redux", "svelte"],
  DevOps: ["docker", "kubernetes", "k8s", "ci/cd", "cicd", "aws", "azure", "gcp", "terraform", "devops", "jenkins", "cloud infra", "linux", "ansible", "monitoring", "observability"],
  "ML/AI": ["machine learning", "deep learning", "pytorch", "tensorflow", "nlp", "computer vision", "artificial intelligence", "ml engineer", "data science", "llm", "neural network", "generative ai"],
};

/** Points per skill mapping into a dimension, capped at 100. Tuned so 3–4 relevant skills read as strong. */
const POINTS_PER_SKILL = 30;

function dimensionsForSkill(skill: string): DnaDimension[] {
  const lower = ` ${skill.toLowerCase()} `;
  return DNA_DIMENSIONS.filter((dim) => DIMENSION_KEYWORDS[dim].some((kw) => lower.includes(kw)));
}

function bucketSkills(matchedSkills: string[]): Map<DnaDimension, string[]> {
  const buckets = new Map<DnaDimension, string[]>(DNA_DIMENSIONS.map((d) => [d, []]));
  for (const skill of matchedSkills) {
    for (const dim of dimensionsForSkill(skill)) {
      buckets.get(dim)!.push(skill);
    }
  }
  return buckets;
}

/** Radar chart data — one point per dimension, always includes all six axes (0 when unmatched). */
export function computeSkillDna(matchedSkills: string[]): SkillDnaPoint[] {
  const buckets = bucketSkills(matchedSkills);
  return DNA_DIMENSIONS.map((skill) => ({
    skill,
    value: Math.min(100, buckets.get(skill)!.length * POINTS_PER_SKILL),
  }));
}

/** Per-dimension breakdown for dimensions with at least one matched skill. */
export function computeDnaBreakdown(matchedSkills: string[]): SkillDnaBreakdownItem[] {
  const buckets = bucketSkills(matchedSkills);
  return DNA_DIMENSIONS.map((label) => {
    const skills = buckets.get(label)!;
    return {
      label,
      value: Math.min(100, skills.length * POINTS_PER_SKILL),
      note: skills.length > 0 ? skills.join(", ") : "No matched skills in this area yet.",
    };
  }).filter((d) => d.value > 0);
}

/** Overall DNA score — the mean strength across all six dimensions. */
export function computeDnaScore(matchedSkills: string[]): number | null {
  if (matchedSkills.length === 0) return null;
  const dna = computeSkillDna(matchedSkills);
  return Math.round(dna.reduce((sum, d) => sum + d.value, 0) / dna.length);
}
