import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { dashboardPathForRole, onboardingPathForRole } from "@/lib/roles";
import { computeDnaBreakdown, computeDnaScore, computeSkillDna } from "@/lib/skillDna";
import { ROLES_MASTER_LIST } from "@/lib/rolesMasterList";
import { SKILLS_MASTER_LIST } from "@/lib/skillsMasterList";
import { renderErrorPage } from "@/lib/error-page";
import { fmtDuration } from "@/components/company/assessment/format";
import {
  NA,
  fmtDecimal,
  fmtInr,
  fmtInt,
  fmtPct,
  placementRate,
  ratio,
  fmtDate,
  fmtRelative,
} from "@/components/admin/format";
import { ApiClientError } from "@/services/api/client";
import { errorMessage } from "@/components/admin/status";

describe("cn", () => {
  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });
});

describe("role routing", () => {
  it.each([
    ["candidate", "/candidate"],
    ["company", "/company"],
    ["college", "/college"],
    ["admin", "/admin"],
  ] as const)("dashboard path for %s", (role, path) => {
    expect(dashboardPathForRole(role)).toBe(path);
  });

  it("sends first-time users to the right onboarding", () => {
    expect(onboardingPathForRole("company")).toBe("/auth/company-onboarding");
    expect(onboardingPathForRole("college")).toBe("/auth/college-onboarding");
    expect(onboardingPathForRole("candidate")).toBe("/auth/profile-setup");
    expect(onboardingPathForRole("admin")).toBe("/auth/profile-setup");
  });
});

describe("skill DNA", () => {
  it("always returns all six axes, zero when nothing matched", () => {
    const dna = computeSkillDna([]);
    expect(dna.map((d) => d.skill)).toEqual([
      "DSA",
      "System Design",
      "Backend",
      "Frontend",
      "DevOps",
      "ML/AI",
    ]);
    expect(dna.every((d) => d.value === 0)).toBe(true);
  });

  it("returns null score for no skills", () => {
    expect(computeDnaScore([])).toBeNull();
  });

  it("caps a dimension at 100", () => {
    const dna = computeSkillDna(["React", "Vue", "Angular", "Svelte", "Redux", "Tailwind"]);
    expect(dna.find((d) => d.skill === "Frontend")!.value).toBe(100);
  });

  it("scores 30 points per matched skill", () => {
    const dna = computeSkillDna(["Docker", "Kubernetes"]);
    expect(dna.find((d) => d.skill === "DevOps")!.value).toBe(60);
  });

  it("breakdown only lists dimensions with matches and names the skills", () => {
    const b = computeDnaBreakdown(["Docker", "PyTorch"]);
    expect(b.map((x) => x.label).sort()).toEqual(["DevOps", "ML/AI"]);
    expect(b.find((x) => x.label === "DevOps")!.note).toBe("Docker");
  });

  it("radar and breakdown agree (single categorisation rule)", () => {
    const skills = ["React", "Docker", "PostgreSQL", "Machine Learning", "Kafka"];
    const dna = computeSkillDna(skills);
    const b = computeDnaBreakdown(skills);
    for (const item of b) {
      expect(dna.find((d) => d.skill === item.label)!.value).toBe(item.value);
    }
  });

  it("overall score is the rounded mean over six dimensions", () => {
    expect(computeDnaScore(["Docker"])).toBe(Math.round(30 / 6));
  });

  it("does not file JavaScript under Backend because of the 'java' keyword", () => {
    const dna = computeSkillDna(["JavaScript"]);
    expect(dna.find((d) => d.skill === "Frontend")!.value).toBe(30);
    expect(dna.find((d) => d.skill === "Backend")!.value).toBe(0);
  });

  it("does not match short keywords inside unrelated words", () => {
    // 'rest' inside 'Interpersonal... interest', 'api' inside 'Capital', 'go lang'
    const dna = computeSkillDna(["Interest Rate Modelling", "Capital Markets"]);
    expect(dna.find((d) => d.skill === "Backend")!.value).toBe(0);
  });

  it("still recognises Java and REST proper as Backend", () => {
    const dna = computeSkillDna(["Java", "REST APIs"]);
    expect(dna.find((d) => d.skill === "Backend")!.value).toBe(60);
  });

  it("matches stems such as 'scalab' (scalable/scalability)", () => {
    const dna = computeSkillDna(["Scalability"]);
    expect(dna.find((d) => d.skill === "System Design")!.value).toBe(30);
  });
});

describe("master lists", () => {
  it("roles have unique names and a category", () => {
    const names = ROLES_MASTER_LIST.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(ROLES_MASTER_LIST.every((r) => r.category.length > 0)).toBe(true);
  });
  it("skills have unique names (case-insensitive) and a category", () => {
    const names = SKILLS_MASTER_LIST.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(SKILLS_MASTER_LIST.every((s) => s.category.length > 0)).toBe(true);
  });
});

describe("error page", () => {
  it("is a complete html document with a retry and home action", () => {
    const html = renderErrorPage();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("location.reload()");
    expect(html).toContain('href="/"');
  });
});

describe("admin formatters", () => {
  it("never shows a fake 0 for missing data", () => {
    expect(fmtInt(null)).toBe(NA);
    expect(fmtInt(undefined)).toBe(NA);
    expect(fmtPct(null)).toBe(NA);
    expect(fmtDecimal(undefined)).toBe(NA);
    expect(fmtInr(null)).toBe(NA);
  });
  it("shows real zeros", () => {
    expect(fmtInt(0)).toBe("0");
    expect(fmtPct(0)).toBe("0.0%");
  });
  it("uses Indian digit grouping", () => {
    expect(fmtInt(1234567)).toBe("12,34,567");
  });
  it("formats ratios as percentages", () => {
    expect(fmtPct(0.425)).toBe("42.5%");
  });
  it("ratio is null when denominator is 0", () => {
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(0, 4)).toBe(0);
  });
  it("placement rate = selected / applicants, N/A when nobody applied", () => {
    expect(placementRate({ selected_applicants: 3, applicants: 6 })).toBe(0.5);
    expect(placementRate({ selected_applicants: 0, applicants: 0 })).toBeNull();
  });
  it("dates", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("2026-03-05T10:00:00")).toBe("5 Mar 2026");
    expect(fmtRelative(null)).toBe("No activity yet");
    expect(fmtRelative(new Date(Date.now() - 3600_000).toISOString())).toContain("ago");
  });
});

describe("assessment duration format", () => {
  it("handles null, zero and padding", () => {
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(0)).toBe("0m 00s");
    expect(fmtDuration(65)).toBe("1m 05s");
    expect(fmtDuration(3600)).toBe("60m 00s");
  });
});

describe("admin errorMessage", () => {
  it("maps 403 and 401 to friendly text", () => {
    expect(errorMessage(new ApiClientError("x", 403))).toMatch(/Admin access/);
    expect(errorMessage(new ApiClientError("x", 401))).toMatch(/expired/);
  });
  it("passes other api errors through", () => {
    expect(errorMessage(new ApiClientError("Boom", 500))).toBe("Boom");
  });
  it("handles plain errors and unknowns", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("weird")).toBe("Something went wrong.");
  });
});
