/**
 * Fictional sample dataset for College Portal Demo Mode — Northstar Institute of
 * Technology. Nothing here is, or is derived from, a real college or person.
 *
 *  - Deterministic: a fixed PRNG seed, so every visitor (and every test run) sees
 *    the same roster. Only the date-relative fields move, with the `anchor` date.
 *  - Shaped exactly like the live API rows (types/college/college.ts). The schema has
 *    no CGPA / roll number / skills / company / package columns, so none are invented.
 *  - Every dashboard KPI and chart is computed from these rows by engine.ts — there are
 *    no hardcoded totals anywhere, so they cannot disagree with the roster.
 *  - Emails use the reserved ".example" TLD: they can never be delivered to anyone.
 */

import type {
  Department,
  Drive,
  PlacementStatus,
  Student,
  VerificationStatus,
} from "@/types/college/college";
import { DEMO_COLLEGE_ID } from "./mode.ts";

export type DemoDepartment = Omit<
  Department,
  "studentCount" | "avgEmployabilityScore" | "placedStudents" | "placementRate"
>;

export interface DemoState {
  /** Bumped when the seed's shape changes, so stale sessionStorage copies are discarded. */
  version: number;
  students: Student[];
  drives: Drive[];
  departments: DemoDepartment[];
}

export const DEMO_STATE_VERSION = 1;
export const DEMO_EMAIL_DOMAIN = "northstar-demo.example";

/** mulberry32 — tiny, fast, good enough for sample data; fully deterministic. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Aarav",
  "Aditi",
  "Aisha",
  "Akash",
  "Ananya",
  "Arjun",
  "Bhavya",
  "Chaitanya",
  "Deepa",
  "Dev",
  "Diya",
  "Farhan",
  "Gauri",
  "Harsh",
  "Isha",
  "Ishaan",
  "Jahnavi",
  "Kabir",
  "Kavya",
  "Krish",
  "Lakshmi",
  "Manav",
  "Meera",
  "Mihir",
  "Nandini",
  "Neel",
  "Nisha",
  "Om",
  "Pooja",
  "Pranav",
  "Rhea",
  "Rohan",
  "Saanvi",
  "Samar",
  "Sanya",
  "Shreya",
  "Tanvi",
  "Uday",
  "Vaani",
  "Yash",
];
const LAST_NAMES = [
  "Agarwal",
  "Banerjee",
  "Bhatt",
  "Chandra",
  "Desai",
  "Deshpande",
  "Fernandes",
  "Gill",
  "Gupta",
  "Iyer",
  "Jain",
  "Kapoor",
  "Kulkarni",
  "Malhotra",
  "Menon",
  "Mishra",
  "Nair",
  "Naidu",
  "Pandey",
  "Patel",
  "Pillai",
  "Rao",
  "Reddy",
  "Saxena",
  "Sethi",
  "Shah",
  "Sharma",
  "Singh",
  "Sinha",
  "Thakur",
  "Trivedi",
  "Varma",
  "Verma",
  "Yadav",
  "Zaveri",
];

interface BranchSpec {
  branch: string;
  name: string;
  hod: string;
  count: number;
  /** Added to the ability draw: coding-heavy branches score higher on GitHub / LeetCode. */
  codingBias: number;
}

// `branch` doubles as the department code; the live backend's branch aliasing
// (CSE → computer science, MECH → mechanical, …) therefore matches students to departments.
const BRANCHES: BranchSpec[] = [
  {
    branch: "CSE",
    name: "Computer Science & Engineering",
    hod: "Dr. Anita Deshmukh",
    count: 20,
    codingBias: 0.22,
  },
  {
    branch: "IT",
    name: "Information Technology",
    hod: "Dr. Rajiv Menon",
    count: 12,
    codingBias: 0.2,
  },
  {
    branch: "ECE",
    name: "Electronics & Communication",
    hod: "Dr. Sunita Rao",
    count: 14,
    codingBias: 0.04,
  },
  {
    branch: "EEE",
    name: "Electrical Engineering",
    hod: "Dr. Manoj Kulkarni",
    count: 8,
    codingBias: 0,
  },
  {
    branch: "MECH",
    name: "Mechanical Engineering",
    hod: "Dr. Farida Shaikh",
    count: 10,
    codingBias: -0.08,
  },
  {
    branch: "CIVIL",
    name: "Civil Engineering",
    hod: "Dr. Harish Nair",
    count: 8,
    codingBias: -0.1,
  },
];

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const dayMs = 86_400_000;
const isoDaysFrom = (anchor: Date, days: number) =>
  new Date(anchor.getTime() + days * dayMs).toISOString();
const dateOnlyDaysFrom = (anchor: Date, days: number) => isoDaysFrom(anchor, days).slice(0, 10);

/** Build the full demo dataset relative to `anchor` (defaults to now). */
export function buildSeedState(anchor: Date = new Date()): DemoState {
  const rng = makeRng(20_260_131);
  const gradNow = anchor.getUTCFullYear(); // batch finishing this year — mostly placed already
  const gradNext = gradNow + 1; // batch in the middle of placement season

  const used = new Set<string>();
  const pickName = () => {
    for (;;) {
      const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      const key = `${first} ${last}`;
      if (!used.has(key)) {
        used.add(key);
        return { first, last };
      }
    }
  };

  const students: Student[] = [];
  let n = 0;
  for (const spec of BRANCHES) {
    for (let i = 0; i < spec.count; i++) {
      n += 1;
      const { first, last } = pickName();
      const batch = rng() < 0.42 ? gradNow : gradNext;

      // Ability: average of three draws → bell-ish shape, then per-component noise.
      const ability = (rng() + rng() + rng()) / 3;
      const component = (bias: number, spread: number) =>
        round1(clamp(32 + 62 * clamp(ability + bias) + (rng() - 0.5) * spread));
      const resume = component(0.02, 14);
      const github = component(spec.codingBias, 22);
      const leetcode = component(spec.codingBias, 24);
      const interview = component(0, 16);
      const assessment = component(0.03, 14);
      const employability = round1(
        0.25 * resume + 0.15 * github + 0.15 * leetcode + 0.25 * interview + 0.2 * assessment,
      );

      // Placement odds rise with employability; the older batch is mostly done.
      const odds = 1 / (1 + Math.exp(-(employability - 56) / 8));
      const roll = rng();
      let placement: PlacementStatus = "not_placed";
      if (roll < odds * (batch === gradNow ? 0.95 : 0.5)) {
        placement = rng() < 0.07 ? "offer_declined" : "placed";
      }

      const v = rng();
      const verification: VerificationStatus =
        v < 0.82 ? "verified" : v < 0.95 ? "pending" : "rejected";

      const seq = String(n).padStart(3, "0");
      students.push({
        id: `demo-stu-${seq}`,
        college_id: DEMO_COLLEGE_ID,
        name: `${first} ${last}`,
        email: `${first}.${last}${seq}@${DEMO_EMAIL_DOMAIN}`.toLowerCase(),
        branch: spec.branch,
        graduation_year: batch,
        employability_score: employability,
        resume_score: resume,
        github_score: github,
        leetcode_score: leetcode,
        interview_score: interview,
        assessment_score: assessment,
        verification_status: verification,
        placement_status: placement,
        status: "active",
        blocked_until: null,
        blocked_reason: null,
        blocked_at: null,
        invited_at: rng() < 0.6 ? isoDaysFrom(anchor, -Math.floor(20 + rng() * 60)) : null,
        created_at: isoDaysFrom(anchor, -120),
        updated_at: isoDaysFrom(anchor, -Math.floor(rng() * 30)),
      });
    }
  }

  // A few access-control examples so the Blocked / Restricted KPIs and badges have
  // something to show. Chosen from the unplaced, so no placed student is "restricted".
  const unplaced = students.filter(
    (s) => s.placement_status === "not_placed" && s.graduation_year === gradNext,
  );
  const flag = (s: Student | undefined, patch: Partial<Student>) => s && Object.assign(s, patch);
  flag(unplaced[3], {
    status: "temporarily_blocked",
    blocked_until: isoDaysFrom(anchor, 2),
    blocked_reason: "Missed a mandatory pre-placement session (sample record).",
    blocked_at: isoDaysFrom(anchor, -1),
  });
  flag(unplaced[9], {
    status: "temporarily_blocked",
    blocked_until: isoDaysFrom(anchor, 5),
    blocked_reason: "Pending document verification (sample record).",
    blocked_at: isoDaysFrom(anchor, -2),
  });
  flag(unplaced[14], {
    status: "restricted",
    blocked_until: null,
    blocked_reason: "Withdrew from the campus placement programme (sample record).",
    blocked_at: isoDaysFrom(anchor, -15),
  });

  const drives: Drive[] = [
    {
      companyName: "Meridian Systems",
      role: "Software Development Trainee",
      status: "Closed",
      day: -78,
      eligibility: { branch: ["CSE", "IT"], graduationYear: gradNow, minimumScore: 65 },
    },
    {
      companyName: "Helix Analytics",
      role: "Data Analyst",
      status: "Closed",
      day: -54,
      eligibility: { branch: ["CSE", "IT", "ECE"], graduationYear: gradNow, minimumScore: 60 },
    },
    {
      companyName: "Orbitron Labs",
      role: "Embedded Systems Engineer",
      status: "Closed",
      day: -37,
      eligibility: { branch: ["ECE", "EEE"], graduationYear: gradNow, minimumScore: 60 },
    },
    {
      companyName: "Cobaltix Infrastructure",
      role: "Graduate Engineer Trainee",
      status: "Closed",
      day: -21,
      eligibility: { branch: ["MECH", "CIVIL"], graduationYear: gradNow, minimumScore: 55 },
    },
    {
      companyName: "Quillon Software",
      role: "Software Engineer",
      status: "Active",
      day: 6,
      eligibility: { branch: ["CSE", "IT"], graduationYear: gradNext, minimumScore: 70 },
    },
    {
      companyName: "BlueFern Payments",
      role: "Platform Engineer",
      status: "Active",
      day: 11,
      eligibility: { branch: ["CSE", "IT", "ECE"], graduationYear: gradNext, minimumScore: 72 },
    },
    {
      companyName: "Auralis Robotics",
      role: "Controls Engineer",
      status: "Active",
      day: 19,
      eligibility: { branch: ["ECE", "EEE", "MECH"], graduationYear: gradNext, minimumScore: 65 },
    },
    {
      companyName: "Tessera Networks",
      role: "Network Engineer",
      status: "Draft",
      day: 34,
      eligibility: { branch: ["ECE", "IT"], graduationYear: gradNext, minimumScore: 60 },
    },
    {
      companyName: "Pinecrest Consulting",
      role: "Technology Analyst",
      status: "Draft",
      day: 48,
      eligibility: { graduationYear: gradNext, minimumScore: 68 },
    },
  ].map(({ day, ...d }, i) => ({
    id: `demo-drive-${String(i + 1).padStart(2, "0")}`,
    ...d,
    date: dateOnlyDaysFrom(anchor, day),
  })) as Drive[];

  const departments: DemoDepartment[] = BRANCHES.map((b) => ({
    id: `demo-dept-${b.branch.toLowerCase()}`,
    name: b.name,
    code: b.branch,
    hodName: b.hod,
    createdAt: isoDaysFrom(anchor, -120),
    updatedAt: isoDaysFrom(anchor, -120),
  }));

  return { version: DEMO_STATE_VERSION, students, drives, departments };
}
