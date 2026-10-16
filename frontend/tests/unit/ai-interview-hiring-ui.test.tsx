import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssignedInterviews } from "@/components/candidate/ai-interview/AssignedInterviews";
import { InterviewBriefing } from "@/components/candidate/ai-interview/InterviewBriefing";
import { InvitesPanel } from "@/components/company/ai-interviews/InvitesPanel";
import { ResultsPanel } from "@/components/company/ai-interviews/ResultsPanel";
import { TemplateFormDialog } from "@/components/company/ai-interviews/TemplateFormDialog";
import type { AiInterviewAssignment, AiInterviewConfig } from "@/types/candidate/aiInterview";
import type {
  InterviewTemplate,
  InviteRow,
  ResultDetail,
  ResultsPayload,
} from "@/types/company/aiInterview";

const svc = vi.hoisted(() => ({
  presets: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listInvites: vi.fn(),
  invite: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  results: vi.fn(),
  resultDetail: vi.fn(),
  setDecision: vi.fn(),
}));
vi.mock("@/services/api/company/aiInterviews", () => ({ companyAiInterviewService: svc }));
vi.mock("@/services/api/company/jobs", () => ({
  jobsService: { list: vi.fn().mockResolvedValue([{ id: "job-1", title: "Backend Engineer" }]) },
}));
vi.mock("@/services/api/client", () => ({
  request: vi.fn(),
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

const TEMPLATE: InterviewTemplate = {
  id: "t1",
  title: "Backend round 1",
  role_title: "Backend Engineer",
  level: "mid",
  job_id: null,
  instructions: "Be on time.",
  duration_minutes: 25,
  status: "active",
  version: 2,
  counts: { invited: 1, started: 0, completed: 1 },
  created_at: "",
  updated_at: "",
  rubric: [
    {
      name: "System design",
      description: "Designs for scale.",
      weight: 60,
      weight_pct: 60,
      questions: ["URL shortener?"],
      expected_concepts: "",
    },
    {
      name: "Communication",
      description: "",
      weight: 40,
      weight_pct: 40,
      questions: [],
      expected_concepts: "",
    },
  ],
};

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
});

// ═══ builder ═════════════════════════════════════════════════════════
describe("TemplateFormDialog", () => {
  const PRESETS = [
    {
      id: "ai_ml",
      label: "AI / ML Engineer",
      role_title: "AI / ML Engineer",
      competencies: [
        {
          name: "ML fundamentals",
          description: "Basics.",
          weight: 25,
          weight_pct: 25,
          questions: ["q1"],
          expected_concepts: "bias-variance",
        },
        {
          name: "Productionizing",
          description: "",
          weight: 75,
          weight_pct: 75,
          questions: [],
          expected_concepts: "",
        },
      ],
    },
  ];

  const open = (props: Partial<Parameters<typeof TemplateFormDialog>[0]> = {}) => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    svc.presets.mockResolvedValue(PRESETS);
    wrap(<TemplateFormDialog open onOpenChange={onOpenChange} onSaved={onSaved} {...props} />);
    return { onOpenChange, onSaved };
  };

  it("will not save an incomplete interview and says what is missing", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /create and activate/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/give the interview a title/i);
    expect(alert.textContent).toMatch(/enter the role/i);
    expect(alert.textContent).toMatch(/enter a name/i);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("starting from a template fills the rubric and shows each share of the score", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("option", { name: "AI / ML Engineer" });
    await user.selectOptions(screen.getByLabelText(/start from a template/i), "ai_ml");
    expect((screen.getByLabelText("Interview title") as HTMLInputElement).value).toBe(
      "AI / ML Engineer interview",
    );
    expect((screen.getByLabelText("Role") as HTMLInputElement).value).toBe("AI / ML Engineer");
    expect(
      (screen.getByLabelText("Name", { selector: "#c-name-0" }) as HTMLInputElement).value,
    ).toBe("ML fundamentals");
    expect(screen.getByText(/Competency 1 · 25% of the score/)).toBeTruthy();
    expect(screen.getByText(/Competency 2 · 75% of the score/)).toBeTruthy();
  });

  it("changing a weight updates every competency's share straight away", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("option", { name: "AI / ML Engineer" });
    await user.selectOptions(screen.getByLabelText(/start from a template/i), "ai_ml");
    const w = screen.getByLabelText("Weight", { selector: "#c-weight-0" });
    await user.clear(w);
    await user.type(w, "75");
    expect(screen.getByText(/Competency 1 · 50% of the score/)).toBeTruthy();
    expect(screen.getByText(/Competency 2 · 50% of the score/)).toBeTruthy();
  });

  it("creates and activates with trimmed, clean data", async () => {
    const user = userEvent.setup();
    svc.create.mockResolvedValue({ ...TEMPLATE, id: "new" });
    const { onSaved, onOpenChange } = open();
    await user.type(screen.getByLabelText("Interview title"), "  Backend round 1 ");
    await user.type(screen.getByLabelText("Role"), "Backend Engineer");
    await user.type(screen.getByLabelText("Name", { selector: "#c-name-0" }), " System design ");
    await user.type(
      screen.getByLabelText(/Seed questions/, { selector: "#c-q-0" }),
      "How to scale?\n\n  \nWhy?",
    );
    await user.click(screen.getByRole("button", { name: /create and activate/i }));
    await waitFor(() => expect(svc.create).toHaveBeenCalledOnce());
    const [draft, status] = svc.create.mock.calls[0];
    expect(status).toBe("active");
    expect(draft).toMatchObject({
      title: "Backend round 1",
      role_title: "Backend Engineer",
      level: "junior",
      duration_minutes: 20,
    });
    expect(draft.rubric[0]).toMatchObject({
      name: "System design",
      weight: 20,
      questions: ["How to scale?", "Why?"],
    });
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can save as a draft instead", async () => {
    const user = userEvent.setup();
    svc.create.mockResolvedValue(TEMPLATE);
    open();
    await user.type(screen.getByLabelText("Interview title"), "Draft one");
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.type(screen.getByLabelText("Name", { selector: "#c-name-0" }), "Depth");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(svc.create.mock.calls[0][1]).toBe("draft"));
  });

  it("adds and removes competencies, keeping at least one and at most eight", async () => {
    const user = userEvent.setup();
    open();
    const remove = () => screen.getAllByRole("button", { name: /remove competency/i });
    expect((remove()[0] as HTMLButtonElement).disabled).toBe(true);
    const add = screen.getByRole("button", { name: /add competency/i });
    for (let i = 0; i < 7; i++) await user.click(add);
    expect(remove()).toHaveLength(8);
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await user.click(remove()[3]);
    expect(remove()).toHaveLength(7);
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });

  it("editing an existing interview opens it filled in and sends only an update", async () => {
    const user = userEvent.setup();
    svc.update.mockResolvedValue(TEMPLATE);
    open({ template: TEMPLATE });
    expect((screen.getByLabelText("Interview title") as HTMLInputElement).value).toBe(
      "Backend round 1",
    );
    expect(screen.getByText(/candidates who already started keep the rubric/i)).toBeTruthy();
    expect(screen.queryByLabelText(/start from a template/i)).toBeNull();
    const title = screen.getByLabelText("Interview title");
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledOnce());
    expect(svc.update.mock.calls[0][0]).toBe("t1");
    expect(svc.update.mock.calls[0][1]).toMatchObject({ title: "Renamed", duration_minutes: 25 });
    expect(svc.create).not.toHaveBeenCalled();
  });
});

// ═══ invites ═════════════════════════════════════════════════════════
describe("InvitesPanel", () => {
  const row = (over: Partial<InviteRow>): InviteRow => ({
    id: "i1",
    email: "ada@x.dev",
    name: "Ada Lovelace",
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

  it("counts valid addresses, flags the ones that are not, and sends them", async () => {
    const user = userEvent.setup();
    svc.listInvites.mockResolvedValue([]);
    svc.invite.mockResolvedValue({
      invited: 2,
      reinvited: 0,
      already_invited: 0,
      already_taken: 0,
      invalid: [],
      emails_sent: 2,
      emails_skipped: 0,
      emails_failed: 0,
    });
    wrap(<InvitesPanel template={TEMPLATE} />);
    await screen.findByText(/no one has been invited yet/i);
    const box = screen.getByLabelText("Email addresses");
    await user.type(box, "Ada@X.dev, bob@x.dev nope");
    expect(screen.getByText(/2 valid addresses/)).toBeTruthy();
    expect(screen.getByText(/not valid: nope/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Valid for"), "14");
    await user.click(screen.getByRole("button", { name: /send invitations/i }));
    await waitFor(() => expect(svc.invite).toHaveBeenCalledOnce());
    expect(svc.invite).toHaveBeenCalledWith("t1", {
      emails: ["ada@x.dev", "bob@x.dev"],
      expires_in_days: 14,
    });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
  });

  it("cannot send with nothing valid to send", async () => {
    svc.listInvites.mockResolvedValue([]);
    wrap(<InvitesPanel template={TEMPLATE} />);
    await screen.findByText(/no one has been invited yet/i);
    expect(
      (screen.getByRole("button", { name: /send invitations/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("asks to activate a draft first and locks the form", async () => {
    svc.listInvites.mockResolvedValue([]);
    wrap(<InvitesPanel template={{ ...TEMPLATE, status: "draft" }} />);
    await screen.findByText(/activate this interview before inviting/i);
    expect((screen.getByLabelText("Email addresses") as HTMLTextAreaElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /send invitations/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("lists invitations; only open ones can be reminded or withdrawn", async () => {
    const user = userEvent.setup();
    svc.listInvites.mockResolvedValue([
      row({}),
      row({
        id: "i2",
        email: "bob@x.dev",
        name: null,
        has_account: false,
        status: "completed",
        decision: "advance",
      }),
      row({ id: "i3", email: "cy@x.dev", name: null, status: "expired" }),
    ]);
    svc.resend.mockResolvedValue({ email: "sent" });
    svc.revoke.mockResolvedValue(undefined);
    wrap(<InvitesPanel template={TEMPLATE} />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Advance")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("No account yet")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /send a reminder/i })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /send a reminder to ada@x.dev/i }));
    await waitFor(() => expect(svc.resend).toHaveBeenCalledWith("t1", "i1"));
    await user.click(
      screen.getByRole("button", { name: /withdraw the invitation for ada@x.dev/i }),
    );
    await waitFor(() => expect(svc.revoke).toHaveBeenCalledWith("t1", "i1"));
  });
});

// ═══ results ═════════════════════════════════════════════════════════
describe("ResultsPanel and candidate report", () => {
  const integrity = { tab_switches: 0, camera_lost: 0, mic_lost: 0, video_flags: 0, total: 0 };
  const RESULTS: ResultsPayload = {
    template: TEMPLATE,
    summary: { taken: 2, reported: 1, average_score: 71.4, flagged: 1 },
    rows: [
      {
        ...({} as InviteRow),
        id: "i1",
        email: "ada@x.dev",
        name: "Ada Lovelace",
        status: "completed",
        overall_score: 71.4,
        decision: null,
        technical_score: 70,
        communication_score: 75,
        recommendation: "Hire",
        partial: false,
        competencies: [],
        integrity: { ...integrity, tab_switches: 1, video_flags: 1, total: 2 },
      },
      {
        ...({} as InviteRow),
        id: "i2",
        email: "bob@x.dev",
        name: null,
        status: "started",
        overall_score: null,
        decision: "hold",
        technical_score: null,
        communication_score: null,
        recommendation: null,
        partial: false,
        competencies: [],
        integrity,
      },
    ],
  };
  const DETAIL: ResultDetail = {
    candidate: {
      ...({} as InviteRow),
      id: "i1",
      email: "ada@x.dev",
      name: "Ada Lovelace",
      status: "completed",
    },
    rubric: TEMPLATE.rubric,
    consent: { accepted_at: "2026-10-16T09:00:00Z", version: "v3", audio: true, video: true },
    report: {
      partial: false,
      overall_score: 71.4,
      technical_score: 70,
      communication_score: 75,
      competencies: [
        { name: "System design", score: 68, weight: 60, evidence: "Sharded by hash." },
        { name: "Communication", score: 77, weight: 40, evidence: "Explained clearly." },
      ],
      strengths: ["Clear thinker"],
      weaknesses: ["Light on caching"],
      red_flags: ["Hesitated on consistency"],
      per_question: [{ question: "Design a shortener", feedback: "Good start.", score: 7 }],
      recommendation: "Hire",
      report_markdown: "# Written report",
      transcript: "Q1 A1",
      duration_seconds: 600,
    },
    integrity: { ...integrity, tab_switches: 1, video_flags: 1, total: 2 },
    integrity_events: [
      { kind: "tab_hidden", offset_seconds: 75, source: "browser" },
      { kind: "multiple_faces", offset_seconds: 130, source: "agent" },
    ],
    decision: { decision: null, note: "", decided_at: null },
  };

  it("shows the scoreboard with scores, the AI's recommendation, integrity flags and decisions", async () => {
    svc.results.mockResolvedValue(RESULTS);
    wrap(<ResultsPanel templateId="t1" />);
    await screen.findByText("Ada Lovelace");
    const tiles = screen.getByText("Took the interview").parentElement as HTMLElement;
    expect(within(tiles).getByText("2")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("71")).toBeTruthy(); // overall, rounded
    expect(screen.getByText("Hire")).toBeTruthy();
    expect(screen.getByText("2 flags")).toBeTruthy();
    expect(screen.getByText("Clear")).toBeTruthy();
    expect(screen.getByText("Hold")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("explains an empty scoreboard", async () => {
    svc.results.mockResolvedValue({
      ...RESULTS,
      summary: { taken: 0, reported: 0, average_score: null, flagged: 0 },
      rows: [],
    });
    wrap(<ResultsPanel templateId="t1" />);
    await screen.findByText(/no one has taken this interview yet/i);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("opens a candidate's full report: scores with evidence, integrity timeline, consent", async () => {
    const user = userEvent.setup();
    svc.results.mockResolvedValue(RESULTS);
    svc.resultDetail.mockResolvedValue(DETAIL);
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada Lovelace" }));
    await screen.findByText("Sharded by hash.");
    expect(svc.resultDetail).toHaveBeenCalledWith("t1", "i1");
    expect(screen.getByText("AI recommends: Hire")).toBeTruthy();
    expect(screen.getByText(/60% of score/)).toBeTruthy();
    expect(screen.getByText("Explained clearly.")).toBeTruthy();
    expect(screen.getByText("Clear thinker")).toBeTruthy();
    expect(screen.getByText("Hesitated on consistency")).toBeTruthy();
    expect(screen.getByText("Session integrity")).toBeTruthy();
    expect(screen.getByText("Left the interview tab")).toBeTruthy();
    expect(screen.getByText("1:15")).toBeTruthy();
    expect(screen.getByText(/More than one person in view/)).toBeTruthy();
    expect(screen.getByText(/seen by the interviewer/)).toBeTruthy();
    expect(screen.getByText(/allowed audio and camera analysis/i)).toBeTruthy();
    expect(screen.getByText("Transcript")).toBeTruthy();
  });

  it("records the hiring team's decision and note, and the AI cannot make it for them", async () => {
    const user = userEvent.setup();
    svc.results.mockResolvedValue(RESULTS);
    svc.resultDetail.mockResolvedValue(DETAIL);
    svc.setDecision.mockResolvedValue({ decision: "advance", note: "Strong design." });
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada Lovelace" }));
    await screen.findByRole("heading", { name: "Your decision" });
    const save = screen.getByRole("button", { name: /save decision/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing to save yet
    await user.click(screen.getByRole("radio", { name: "Advance" }));
    await user.type(screen.getByLabelText(/note/i), "Strong design.");
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() =>
      expect(svc.setDecision).toHaveBeenCalledWith("t1", "i1", "advance", "Strong design."),
    );
  });

  it("says so when the report is not ready yet", async () => {
    const user = userEvent.setup();
    svc.results.mockResolvedValue(RESULTS);
    svc.resultDetail.mockResolvedValue({
      ...DETAIL,
      report: null,
      candidate: { ...DETAIL.candidate, status: "started" },
    });
    wrap(<ResultsPanel templateId="t1" />);
    await user.click(await screen.findByRole("button", { name: "Ada Lovelace" }));
    await screen.findByText(/in progress or the report is still being prepared/i);
  });
});

// ═══ candidate side ══════════════════════════════════════════════════
const ASSIGNMENT: AiInterviewAssignment = {
  id: "inv-1",
  company_name: "Acme",
  role_title: "Backend Engineer",
  level: "mid",
  duration_minutes: 25,
  instructions: "Be on time.",
  expires_at: "2030-01-01T00:00:00Z",
  status: "invited",
};

describe("AssignedInterviews", () => {
  it("shows nothing when there is nothing from a company", () => {
    const { container } = render(<AssignedInterviews assignments={[]} onStart={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("lets the candidate start an open interview", async () => {
    const onStart = vi.fn();
    render(<AssignedInterviews assignments={[ASSIGNMENT]} onStart={onStart} />);
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Backend Engineer")).toBeTruthy();
    expect(screen.getByText(/Up to 25 min/)).toBeTruthy();
    expect(screen.getByText(/once/i)).toBeTruthy();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: /start the backend engineer interview for acme/i }),
      );
    expect(onStart).toHaveBeenCalledWith(ASSIGNMENT);
  });

  it("offers no start button once it has been taken, expired or used", () => {
    render(
      <AssignedInterviews
        assignments={[
          { ...ASSIGNMENT, id: "a", status: "completed" },
          { ...ASSIGNMENT, id: "b", status: "expired" },
          { ...ASSIGNMENT, id: "c", status: "started" },
        ]}
        onStart={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getByText(/sent to the hiring team/i)).toBeTruthy();
  });
});

describe("InterviewBriefing for a company interview", () => {
  const CONFIG: AiInterviewConfig = {
    maxMinutes: 20,
    dailyLimit: 3,
    usedToday: 3,
    remainingToday: 0,
    consentVersion: "v",
  };
  const setup = () => {
    const onContinue = vi.fn();
    render(
      <InterviewBriefing
        domain={null}
        onDomain={vi.fn()}
        onContinue={onContinue}
        error={null}
        config={CONFIG}
        configError={null}
        onRetryConfig={vi.fn()}
        assignment={ASSIGNMENT}
      />,
    );
    return { onContinue };
  };
  const tick = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/i have read the rules/i));
    await user.click(screen.getByLabelText(/allow the ai interviewer to listen/i));
    await user.click(screen.getByLabelText(/allow the ai interviewer to view my camera/i));
    return user;
  };

  it("names the company and role and hides the practice track picker", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Backend Engineer" })).toBeTruthy();
    expect(screen.getByText(/Step 1 of 3 · Interview for Acme/)).toBeTruthy();
    expect(screen.getByText("Be on time.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("Up to 25 min")).toBeTruthy(); // the company's duration, not the practice default
    expect(screen.getByText("Sent to Acme")).toBeTruthy();
  });

  it("tells the candidate the company will see the report and they will not", () => {
    setup();
    expect(
      screen.getByText(/shared with Acme's hiring team\. You will not see the report/i),
    ).toBeTruthy();
  });

  it("is not blocked by the practice daily limit", async () => {
    const { onContinue } = setup();
    expect(screen.queryByText(/interviews left today/i)).toBeNull();
    expect(screen.queryByText(/used all 3 interviews/i)).toBeNull();
    const user = await tick();
    const btn = screen.getByRole("button", {
      name: /continue to equipment check/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await user.click(btn);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("still needs every consent", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/i have read the rules/i));
    await user.click(screen.getByLabelText(/allow the ai interviewer to listen/i));
    expect(
      (screen.getByRole("button", { name: /continue to equipment check/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
