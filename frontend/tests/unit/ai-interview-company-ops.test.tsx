import type { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitesPanel } from "@/components/company/ai-interviews/InvitesPanel";
import { ResultsPanel } from "@/components/company/ai-interviews/ResultsPanel";
import { TemplateFormDialog } from "@/components/company/ai-interviews/TemplateFormDialog";
import {
  csvCell,
  defaultDecisionMessage,
  filterRows,
  plannedTopics,
  resultsToCsv,
  sortRows,
} from "@/components/company/ai-interviews/rubric";
import type {
  InterviewTemplate,
  InviteRow,
  ResultDetail,
  ResultRow,
  ResultsPayload,
} from "@/types/company/aiInterview";

const requestMock = vi.hoisted(() => vi.fn());
const svc = vi.hoisted(() => ({
  presets: vi.fn(),
  listInvites: vi.fn(),
  invite: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  retake: vi.fn(),
  extend: vi.fn(),
  applicants: vi.fn(),
  results: vi.fn(),
  resultDetail: vi.fn(),
  setDecision: vi.fn(),
  setIntegrityReview: vi.fn(),
  draftRubric: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/services/api/company/aiInterviews", () => ({ companyAiInterviewService: svc }));
vi.mock("@/services/api/company/jobs", () => ({
  jobsService: { list: vi.fn().mockResolvedValue([{ id: "job-1", title: "Backend Engineer" }]) },
}));
vi.mock("@/services/api/client", () => ({
  request: requestMock,
  ApiClientError: class ApiClientError extends Error {},
}));

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

const zeroIntegrity = {
  total: 0,
  by_kind: {},
  flagged: false,
} as unknown as ResultRow["integrity"];
const flagged = {
  total: 3,
  by_kind: { tab_hidden: 3 },
  flagged: true,
} as unknown as ResultRow["integrity"];

const row = (over: Partial<ResultRow>): ResultRow =>
  ({
    id: "i",
    email: "a@x.dev",
    name: null,
    has_account: true,
    status: "completed",
    expires_at: "2030-01-01T00:00:00Z",
    started_at: "2030-01-01T10:00:00Z",
    completed_at: "2030-01-01T10:30:00Z",
    last_emailed_at: null,
    email_status: null,
    decision: null,
    overall_score: 50,
    technical_score: null,
    communication_score: null,
    recommendation: null,
    partial: false,
    competencies: [],
    integrity: zeroIntegrity,
    ...over,
  }) as ResultRow;

describe("results: sorting, filtering and export", () => {
  const rows = [
    row({
      id: "1",
      email: "low@x.dev",
      name: "Low",
      overall_score: 30,
      completed_at: "2030-01-02T00:00:00Z",
    }),
    row({
      id: "2",
      email: "high@x.dev",
      name: "High",
      overall_score: 90,
      completed_at: "2030-01-01T00:00:00Z",
      integrity: flagged,
    }),
    row({
      id: "3",
      email: "none@x.dev",
      name: "Zed",
      overall_score: null,
      incomplete: true,
      completed_at: "2030-01-03T00:00:00Z",
    }),
    row({
      id: "4",
      email: "d@x.dev",
      name: "Dee",
      overall_score: 60,
      decision: "advance",
      integrity: flagged,
      integrity_review: "dismissed",
    }),
  ];
  const ids = (r: ResultRow[]) => r.map((x) => x.id);

  it("sorts by score with unscored last, by recency, name and flags, without mutating", () => {
    const copy = [...rows];
    expect(ids(sortRows(rows, "score"))).toEqual(["2", "4", "1", "3"]);
    expect(ids(sortRows(rows, "recent"))[0]).toBe("3");
    expect(ids(sortRows(rows, "name"))).toEqual(["4", "2", "1", "3"]);
    expect(sortRows(rows, "flags")[0].integrity.total).toBe(3);
    expect(rows).toEqual(copy);
  });

  it("filters, and a dismissed flag is no longer flagged", () => {
    expect(ids(filterRows(rows, "all"))).toHaveLength(4);
    expect(ids(filterRows(rows, "flagged"))).toEqual(["2"]);
    expect(ids(filterRows(rows, "undecided"))).toEqual(["1", "2", "3"]);
    expect(ids(filterRows(rows, "incomplete"))).toEqual(["3"]);
  });

  it("defuses spreadsheet formulas and quotes awkward cells", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });

  it("exports one line per candidate with a header", () => {
    const csv = resultsToCsv([rows[1], row({ id: "9", email: "=evil@x.dev", name: "Eve, E." })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Name,Email,Status,Score,AI recommendation,Integrity flags,Integrity review,Decision,Completed at",
    );
    expect(lines[1]).toContain("High,high@x.dev,Completed,90");
    expect(lines[2]).toContain('"Eve, E."');
    expect(lines[2]).toContain("'=evil@x.dev");
  });
});

describe("candidate preview and decision message", () => {
  it("lists topics by weight, highest first, skipping blank names", () => {
    const t = plannedTopics([
      { name: "A", weight: 20, questions: [] },
      { name: " ", weight: 50, questions: [] },
      { name: "B", weight: 80, questions: ["q"] },
    ]);
    expect(t.map((x) => x.name)).toEqual(["B", "A"]);
    expect(t[0].seeds).toEqual(["q"]);
  });
  it("prefills advance and reject messages, nothing otherwise", () => {
    expect(defaultDecisionMessage("advance", "Backend", "Acme")).toMatch(/next step/);
    expect(defaultDecisionMessage("reject", "Backend", "Acme")).toMatch(/not to move forward/);
    expect(defaultDecisionMessage("hold", "Backend")).toBe("");
    expect(defaultDecisionMessage(null, "Backend")).toBe("");
  });
});

const TEMPLATE = {
  id: "t1",
  title: "Round 1",
  role_title: "Backend Engineer",
  level: "mid",
  job_id: "job-1",
  instructions: "",
  duration_minutes: 25,
  status: "active",
  version: 1,
  rubric: [
    {
      name: "Design",
      description: "",
      weight: 100,
      questions: [],
      expected_concepts: "",
      weight_pct: 100,
    },
  ],
  counts: { invited: 0, started: 0, completed: 0 },
  created_at: "",
  updated_at: "",
} as InterviewTemplate;

const invite = (over: Partial<InviteRow>): InviteRow => ({
  id: "i1",
  email: "ada@x.dev",
  name: "Ada",
  has_account: true,
  status: "invited",
  expires_at: "2030-01-01T00:00:00Z",
  started_at: null,
  completed_at: null,
  last_emailed_at: null,
  email_status: "sent",
  decision: null,
  overall_score: null,
  ...over,
});

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  svc.applicants.mockResolvedValue([]);
  svc.listInvites.mockResolvedValue([]);
});

describe("invites panel: applicants, retake, extend", () => {
  it("invites chosen applicants of the linked job by application id", async () => {
    svc.applicants.mockResolvedValue([
      {
        application_id: "a1",
        name: "Ada",
        email: "ada@x.dev",
        application_status: "applied",
        already_invited: false,
      },
      {
        application_id: "a2",
        name: "Bob",
        email: "bob@x.dev",
        application_status: "applied",
        already_invited: true,
      },
    ]);
    svc.invite.mockResolvedValue({
      invited: 1,
      reinvited: 0,
      already_invited: 0,
      already_taken: 0,
      invalid: [],
      emails_sent: 1,
      emails_skipped: 0,
      emails_failed: 0,
    });
    const user = userEvent.setup();
    wrap(<InvitesPanel template={TEMPLATE} />);
    const ada = await screen.findByRole("checkbox", { name: /Ada/ });
    expect(screen.queryByRole("checkbox", { name: /Bob/ })).toBeNull(); // already invited
    const send = screen.getByRole("button", { name: /send invitations/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.click(ada);
    expect(send.disabled).toBe(false);
    await user.click(send);
    await waitFor(() =>
      expect(svc.invite).toHaveBeenCalledWith("t1", {
        emails: [],
        application_ids: ["a1"],
        expires_in_days: 7,
      }),
    );
  });

  it("does not offer applicants when the interview has no linked job", async () => {
    wrap(<InvitesPanel template={{ ...TEMPLATE, job_id: null }} />);
    await screen.findByText(/no one has been invited yet/i);
    expect(svc.applicants).not.toHaveBeenCalled();
  });

  it("allows a retake for someone who started or finished, and shows the badges", async () => {
    svc.listInvites.mockResolvedValue([
      invite({ status: "completed", retakes: 1, accommodation_request: "extra time" }),
    ]);
    svc.retake.mockResolvedValue({ email: "sent", retakes: 2 });
    const user = userEvent.setup();
    wrap(<InvitesPanel template={TEMPLATE} />);
    expect(await screen.findByText("Retake 1")).toBeTruthy();
    expect(screen.getByText("Accommodation requested")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /another attempt for ada@x.dev/i }));
    await waitFor(() => expect(svc.retake).toHaveBeenCalledWith("t1", "i1", 7));
  });

  it("extends an expired or open invitation", async () => {
    svc.listInvites.mockResolvedValue([invite({ status: "expired" })]);
    svc.extend.mockResolvedValue({ expires_at: "x", email: "sent" });
    const user = userEvent.setup();
    wrap(<InvitesPanel template={TEMPLATE} />);
    await user.click(
      await screen.findByRole("button", { name: /extend the deadline for ada@x.dev/i }),
    );
    await waitFor(() => expect(svc.extend).toHaveBeenCalledWith("t1", "i1", 7));
  });
});

const RESULTS = (rows: ResultRow[]): ResultsPayload => ({
  template: TEMPLATE,
  summary: { taken: rows.length, reported: 1, average_score: 60, flagged: 1 },
  rows,
});

const DETAIL = (over: Partial<ResultDetail> = {}): ResultDetail => ({
  candidate: invite({ id: "i1", status: "completed", name: "Ada" }),
  rubric: [],
  consent: { accepted_at: null, version: null, audio: true, video: true },
  report: null,
  integrity: flagged,
  integrity_events: [],
  decision: { decision: null, note: "", decided_at: null },
  integrity_review: { review: null, note: "" },
  previous_attempts: [],
  accommodation: { request: null, at: null },
  ...over,
});

describe("results panel", () => {
  const two = [
    row({ id: "i1", email: "ada@x.dev", name: "Ada", overall_score: 40 }),
    row({ id: "i2", email: "bob@x.dev", name: "Bob", overall_score: 80, integrity: flagged }),
  ];
  const order = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("button")[0].textContent);

  it("sorts by score and filters to flagged candidates", async () => {
    svc.results.mockResolvedValue(RESULTS(two));
    const user = userEvent.setup();
    wrap(<ResultsPanel templateId="t1" />);
    await screen.findByText("Ada");
    await user.selectOptions(screen.getByLabelText("Sort results"), "score");
    expect(order()).toEqual(["Bob", "Ada"]);
    await user.selectOptions(screen.getByLabelText("Filter results"), "flagged");
    expect(order()).toEqual(["Bob"]);
    await user.selectOptions(screen.getByLabelText("Filter results"), "incomplete");
    expect(screen.getByText(/no one matches this filter/i)).toBeTruthy();
  });

  it("flags an interview that finished without a report", async () => {
    svc.results.mockResolvedValue(
      RESULTS([row({ id: "i1", name: "Ada", incomplete: true, overall_score: null })]),
    );
    wrap(<ResultsPanel templateId="t1" />);
    expect(await screen.findByText("No report")).toBeTruthy();
  });

  it("emails the candidate with the team's own message when asked", async () => {
    svc.results.mockResolvedValue(RESULTS(two));
    svc.resultDetail.mockResolvedValue(DETAIL());
    svc.setDecision.mockResolvedValue({
      decision: "reject",
      note: "",
      application_status: "rejected",
      candidate_email: "sent",
    });
    const user = userEvent.setup();
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada" }));
    await screen.findByRole("heading", { name: "Your decision" });
    expect(screen.queryByLabelText(/email the candidate/i)).toBeNull(); // nothing to email yet
    await user.click(screen.getByRole("radio", { name: "Reject" }));
    await user.click(screen.getByLabelText(/email the candidate/i));
    const msg = screen.getByLabelText("Message to the candidate") as HTMLTextAreaElement;
    expect(msg.value).toMatch(/not to move forward/);
    await user.click(screen.getByRole("button", { name: /save decision/i }));
    await waitFor(() =>
      expect(svc.setDecision).toHaveBeenCalledWith("t1", "i1", "reject", "", {
        message: expect.stringMatching(/not to move forward/),
      }),
    );
  });

  it("never offers to email a hold decision", async () => {
    svc.results.mockResolvedValue(RESULTS(two));
    svc.resultDetail.mockResolvedValue(DETAIL());
    const user = userEvent.setup();
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada" }));
    await user.click(await screen.findByRole("radio", { name: "Hold" }));
    expect(screen.queryByLabelText(/email the candidate/i)).toBeNull();
  });

  it("lets the team dismiss or confirm integrity flags", async () => {
    svc.results.mockResolvedValue(RESULTS(two));
    svc.resultDetail.mockResolvedValue(DETAIL());
    svc.setIntegrityReview.mockResolvedValue({ review: "dismissed", note: "ok" });
    const user = userEvent.setup();
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada" }));
    await user.type(await screen.findByLabelText("Review note"), "ok");
    await user.click(screen.getByRole("button", { name: /dismiss as false alarm/i }));
    await waitFor(() =>
      expect(svc.setIntegrityReview).toHaveBeenCalledWith("t1", "i1", "dismissed", "ok"),
    );
    await user.click(screen.getByRole("button", { name: /confirm concern/i }));
    await waitFor(() =>
      expect(svc.setIntegrityReview).toHaveBeenCalledWith("t1", "i1", "confirmed", "ok"),
    );
  });

  it("shows the accommodation request and earlier attempts", async () => {
    svc.results.mockResolvedValue(RESULTS(two));
    svc.resultDetail.mockResolvedValue(
      DETAIL({
        accommodation: { request: "I need extra time", at: "2030-01-01T00:00:00Z" },
        previous_attempts: [
          {
            started_at: "2030-01-01T00:00:00Z",
            ended_reason: "swept",
            overall_score: null,
            partial: false,
            has_report: false,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada" }));
    expect(await screen.findByText("I need extra time")).toBeTruthy();
    expect(screen.getByText("Earlier attempts")).toBeTruthy();
  });
});

describe("interview builder: AI rubric and preview", () => {
  const renderDialog = () =>
    wrap(<TemplateFormDialog open onOpenChange={() => undefined} onSaved={() => undefined} />);

  beforeEach(() => {
    svc.presets.mockResolvedValue([]);
  });

  it("drafts a rubric from the role and puts it in the form for editing", async () => {
    svc.draftRubric.mockResolvedValue({
      competencies: [
        {
          name: "Systems",
          description: "d",
          weight: 60,
          questions: [],
          expected_concepts: "",
          weight_pct: 60,
        },
        {
          name: "Testing",
          description: "d",
          weight: 40,
          questions: [],
          expected_concepts: "",
          weight_pct: 40,
        },
      ],
    });
    const user = userEvent.setup();
    renderDialog();
    const draftBtn = (await screen.findByRole("button", {
      name: "Draft with AI",
    })) as HTMLButtonElement;
    expect(draftBtn.disabled).toBe(true); // needs a role first
    await user.type(screen.getByLabelText("Role"), "Backend Engineer");
    await user.click(draftBtn);
    await waitFor(() =>
      expect(svc.draftRubric).toHaveBeenCalledWith({
        role_title: "Backend Engineer",
        level: "junior",
        job_id: null,
      }),
    );
    expect(await screen.findByDisplayValue("Systems")).toBeTruthy();
    expect(screen.getByDisplayValue("Testing")).toBeTruthy();
  });

  it("previews what the candidate will experience", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(await screen.findByLabelText("Role"), "Data Analyst");
    await user.click(screen.getByRole("button", { name: /preview candidate experience/i }));
    const region = screen.getByRole("region", { name: "Candidate preview" });
    expect(within(region).getByText(/Data Analyst/)).toBeTruthy();
    expect(within(region).getByText(/never see this rubric/i)).toBeTruthy();
  });
});
