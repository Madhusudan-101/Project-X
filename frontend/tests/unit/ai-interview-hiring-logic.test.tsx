import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import {
  MAX_COMPETENCIES,
  describeInviteResult,
  draftFromTemplate,
  emptyCompetency,
  emptyDraft,
  parseEmails,
  toPayload,
  validateDraft,
  weightPercentages,
} from "@/components/company/ai-interviews/rubric";
import type { InterviewTemplate, TemplateDraft } from "@/types/company/aiInterview";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/client", () => ({
  request: requestMock,
  ApiClientError: class ApiClientError extends Error {},
}));

const good = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  title: "Backend round 1",
  role_title: "Backend Engineer",
  level: "mid",
  job_id: null,
  instructions: "",
  duration_minutes: 25,
  rubric: [
    { name: "System design", description: "", weight: 60, questions: [], expected_concepts: "" },
    { name: "Communication", description: "", weight: 40, questions: [], expected_concepts: "" },
  ],
  ...over,
});

describe("weightPercentages", () => {
  it("shows each weight as a share of the total", () => {
    expect(weightPercentages([{ weight: 60 }, { weight: 40 }])).toEqual([60, 40]);
    expect(weightPercentages([{ weight: 1 }, { weight: 3 }])).toEqual([25, 75]);
  });

  it("always adds up to exactly 100, even when the shares do not divide evenly", () => {
    for (const weights of [
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [7, 11, 13],
      [33, 33, 34],
      [1, 2, 3, 4, 5, 6, 7, 8],
    ]) {
      const pct = weightPercentages(weights.map((weight) => ({ weight })));
      expect(pct.reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(weightPercentages([{ weight: 1 }, { weight: 1 }, { weight: 1 }])).toEqual([34, 33, 33]);
  });

  it("treats empty, zero and junk weights as nothing", () => {
    expect(weightPercentages([])).toEqual([]);
    expect(weightPercentages([{ weight: 0 }, { weight: 0 }])).toEqual([0, 0]);
    expect(weightPercentages([{ weight: NaN }, { weight: 10 }])).toEqual([0, 100]);
  });
});

describe("validateDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateDraft(good())).toEqual([]);
  });

  it.each([
    [{ title: " " }, /title/i],
    [{ role_title: "A" }, /role/i],
    [{ duration_minutes: 9 }, /between 10 and 60/],
    [{ duration_minutes: 61 }, /between 10 and 60/],
    [{ duration_minutes: 20.5 }, /between 10 and 60/],
    [{ rubric: [] }, /at least one competency/i],
  ] as const)("rejects %j", (over, message) => {
    expect(validateDraft(good(over as Partial<TemplateDraft>)).join(" ")).toMatch(message);
  });

  it("rejects too many competencies, duplicate names and bad weights", () => {
    const many = Array.from({ length: MAX_COMPETENCIES + 1 }, (_, i) => ({
      ...emptyCompetency(),
      name: `Skill ${i}`,
    }));
    expect(validateDraft(good({ rubric: many })).join(" ")).toMatch(/at most 8/);

    const dup = good();
    dup.rubric[1].name = " system DESIGN ";
    expect(validateDraft(dup).join(" ")).toMatch(/names must be different/);

    for (const weight of [0, 101, 2.5, -1]) {
      const d = good();
      d.rubric[0].weight = weight;
      expect(validateDraft(d).join(" ")).toMatch(/weight must be a whole number from 1 to 100/);
    }
    const noName = good();
    noName.rubric[0].name = "";
    expect(validateDraft(noName).join(" ")).toMatch(/Competency 1: enter a name/);
  });

  it("limits seed questions to three of 300 characters, ignoring blank lines", () => {
    const d = good();
    d.rubric[0].questions = ["a", "", "b", "  ", "c"];
    expect(validateDraft(d)).toEqual([]);
    d.rubric[0].questions = ["a", "b", "c", "d"];
    expect(validateDraft(d).join(" ")).toMatch(/at most 3 seed questions/);
    d.rubric[0].questions = ["x".repeat(301)];
    expect(validateDraft(d).join(" ")).toMatch(/300 characters/);
  });

  it("starts from an empty draft that needs filling in", () => {
    expect(validateDraft(emptyDraft()).length).toBeGreaterThan(0);
  });
});

describe("toPayload and draftFromTemplate", () => {
  it("trims text and drops blank seed questions", () => {
    const d = good({ title: "  T  ", role_title: " R ", instructions: " hi " });
    d.rubric[0] = {
      name: " N ",
      description: " d ",
      weight: 5,
      questions: [" q ", "", " "],
      expected_concepts: " e ",
    };
    const out = toPayload(d);
    expect([out.title, out.role_title, out.instructions]).toEqual(["T", "R", "hi"]);
    expect(out.rubric[0]).toEqual({
      name: "N",
      description: "d",
      weight: 5,
      questions: ["q"],
      expected_concepts: "e",
    });
  });

  it("an existing interview opens for editing without the server-computed percentage", () => {
    const t = {
      id: "1",
      title: "T",
      role_title: "R",
      level: "junior",
      job_id: "j",
      instructions: "i",
      duration_minutes: 30,
      status: "active",
      version: 3,
      counts: { invited: 0, started: 0, completed: 0 },
      created_at: "",
      updated_at: "",
      rubric: [
        {
          name: "A",
          description: "",
          weight: 7,
          questions: [],
          expected_concepts: "",
          weight_pct: 100,
        },
      ],
    } as InterviewTemplate;
    const d = draftFromTemplate(t);
    expect(d.rubric[0]).not.toHaveProperty("weight_pct");
    expect(d).toMatchObject({ title: "T", role_title: "R", job_id: "j", duration_minutes: 30 });
  });
});

describe("parseEmails", () => {
  it("splits on commas, semicolons, spaces and new lines, lowercases and removes duplicates", () => {
    const r = parseEmails("Ada@X.dev, bob@x.dev;\ncy@x.dev  ada@x.dev\n\n");
    expect(r).toEqual({ valid: ["ada@x.dev", "bob@x.dev", "cy@x.dev"], invalid: [] });
  });

  it("separates out what is not an email", () => {
    const r = parseEmails("ada@x.dev nope @x.dev a@b a@b.co");
    expect(r.valid).toEqual(["ada@x.dev", "a@b.co"]);
    expect(r.invalid).toEqual(["nope", "@x.dev", "a@b"]);
  });

  it("handles empty input", () => {
    expect(parseEmails("")).toEqual({ valid: [], invalid: [] });
    expect(parseEmails("  \n , ; ")).toEqual({ valid: [], invalid: [] });
  });
});

describe("describeInviteResult", () => {
  const base = {
    invited: 0,
    reinvited: 0,
    already_invited: 0,
    already_taken: 0,
    invalid: [],
    emails_sent: 0,
    emails_skipped: 0,
    emails_failed: 0,
  };

  it("says who was invited and that emails went out", () => {
    expect(describeInviteResult({ ...base, invited: 2, emails_sent: 2 })).toBe(
      "2 invited. 2 emails sent.",
    );
    expect(describeInviteResult({ ...base, invited: 1, emails_sent: 1 })).toBe(
      "1 invited. 1 email sent.",
    );
  });

  it("is honest when email is not set up, and when sending failed", () => {
    expect(describeInviteResult({ ...base, invited: 1, emails_skipped: 1 })).toMatch(
      /no emails sent/,
    );
    expect(describeInviteResult({ ...base, invited: 2, emails_sent: 1, emails_failed: 1 })).toMatch(
      /1 email sent\. 1 email failed/,
    );
  });

  it("reports repeats and people who already took it", () => {
    const text = describeInviteResult({
      ...base,
      reinvited: 1,
      already_invited: 2,
      already_taken: 1,
    });
    expect(text).toMatch(/1 invited again, 2 already invited, 1 already took it/);
  });
});

describe("API services", () => {
  beforeEach(() => requestMock.mockReset().mockResolvedValue({}));

  it("company: templates", async () => {
    const draft = good();
    await companyAiInterviewService.list();
    await companyAiInterviewService.list(true);
    await companyAiInterviewService.create(draft, "active");
    await companyAiInterviewService.update("t1", { title: "New" });
    await companyAiInterviewService.archive("t1");
    expect(requestMock.mock.calls.map((c) => [c[0], c[1]?.method ?? "GET"])).toEqual([
      ["/company/ai-interviews", "GET"],
      ["/company/ai-interviews?include_archived=true", "GET"],
      ["/company/ai-interviews", "POST"],
      ["/company/ai-interviews/t1", "PATCH"],
      ["/company/ai-interviews/t1", "DELETE"],
    ]);
    expect(requestMock.mock.calls[2][1].body).toEqual({ ...draft, status: "active" });
  });

  it("company: invites, results and decisions", async () => {
    await companyAiInterviewService.invite("t1", { emails: ["a@x.dev"], expires_in_days: 14 });
    await companyAiInterviewService.listInvites("t1");
    await companyAiInterviewService.resend("t1", "i1");
    await companyAiInterviewService.revoke("t1", "i1");
    await companyAiInterviewService.results("t1");
    await companyAiInterviewService.resultDetail("t1", "i1");
    await companyAiInterviewService.setDecision("t1", "i1", "advance", "Strong");
    expect(requestMock.mock.calls.map((c) => [c[0], c[1]?.method ?? "GET"])).toEqual([
      ["/company/ai-interviews/t1/invites", "POST"],
      ["/company/ai-interviews/t1/invites", "GET"],
      ["/company/ai-interviews/t1/invites/i1/resend", "POST"],
      ["/company/ai-interviews/t1/invites/i1", "DELETE"],
      ["/company/ai-interviews/t1/results", "GET"],
      ["/company/ai-interviews/t1/results/i1", "GET"],
      ["/company/ai-interviews/t1/results/i1/decision", "PUT"],
    ]);
    expect(requestMock.mock.calls[0][1].body).toEqual({ emails: ["a@x.dev"], expires_in_days: 14 });
    expect(requestMock.mock.calls[6][1].body).toEqual({ decision: "advance", note: "Strong" });
  });

  it("candidate: starting from an invitation sends the invite id and every consent", async () => {
    await aiInterviewService.startInviteSession("inv-1", "v9");
    expect(requestMock).toHaveBeenCalledWith("/candidate/ai-interview/session", {
      method: "POST",
      body: {
        inviteId: "inv-1",
        consent: true,
        audioConsent: true,
        videoConsent: true,
        consentVersion: "v9",
      },
    });
    const body = requestMock.mock.calls[0][1].body;
    expect(body).not.toHaveProperty("domain"); // exactly one of domain / inviteId
  });

  it("candidate: lists the interviews companies sent", async () => {
    await aiInterviewService.listAssignments();
    expect(requestMock).toHaveBeenCalledWith("/candidate/ai-interview/assignments", {
      signal: undefined,
    });
  });
});
