import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiInterviewTab } from "@/components/candidate/ai-interview/AiInterviewTab";
import type { AiInterviewAssignment } from "@/types/candidate/aiInterview";

const room = vi.hoisted(() => ({
  phase: "setup" as string,
  roomName: null as string | null,
  error: null as string | null,
  start: vi.fn(),
  startInvite: vi.fn(),
  end: vi.fn(),
  reset: vi.fn(),
  audioHostRef: { current: null },
}));
vi.mock("@/components/candidate/ai-interview/useInterviewRoom", () => ({
  useInterviewRoom: () => room,
}));

const api = vi.hoisted(() => ({
  listAssignments: vi.fn(),
  getConfig: vi.fn(),
  listReports: vi.fn(),
  getReport: vi.fn(),
}));
vi.mock("@/services/api/candidate/aiInterview", () => ({ aiInterviewService: api }));
vi.mock("@/services/api/client", () => ({
  request: vi.fn(),
  ApiClientError: class ApiClientError extends Error {},
}));
vi.mock("@/components/candidate/ai-interview/DeviceCheck", () => ({
  DeviceCheck: (p: { roleTitle?: string; domain?: string; onJoin: (d: object) => void }) => (
    <div>
      <p>Device check for {p.roleTitle ?? p.domain}</p>
      <button onClick={() => p.onJoin({ micId: "m" })}>Join now</button>
    </div>
  ),
}));

const ASSIGNMENT: AiInterviewAssignment = {
  id: "inv-1",
  company_name: "Acme",
  role_title: "Backend Engineer",
  level: "mid",
  duration_minutes: 25,
  instructions: "",
  expires_at: "2030-01-01T00:00:00Z",
  status: "invited",
};
const CONFIG = {
  maxMinutes: 20,
  dailyLimit: 3,
  usedToday: 0,
  remainingToday: 3,
  consentVersion: "v-test",
};

const acceptAll = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByLabelText(/i have read the rules/i));
  await user.click(screen.getByLabelText(/allow the ai interviewer to listen/i));
  await user.click(screen.getByLabelText(/allow the ai interviewer to view my camera/i));
};

beforeEach(() => {
  Object.assign(room, { phase: "setup", roomName: null, error: null });
  [room.start, room.startInvite, room.end, room.reset].forEach((f) => f.mockReset());
  Object.values(api).forEach((f) => f.mockReset());
  api.listAssignments.mockResolvedValue([ASSIGNMENT]);
  api.getConfig.mockResolvedValue(CONFIG);
  api.listReports.mockResolvedValue([]);
  window.history.replaceState(null, "", "/candidate");
});

describe("AI Interview tab: company interviews beside practice", () => {
  it("shows the interviews a company sent, with practice still available below", async () => {
    render(<AiInterviewTab />);
    expect(await screen.findByText("Interviews from companies")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    // Practice is untouched: the track picker is still there.
    expect(screen.getByRole("radiogroup", { name: /interview track/i })).toBeTruthy();
    expect(screen.getByText(/Step 1 of 3 · Practice interview/)).toBeTruthy();
  });

  it("shows only practice when no company has sent anything", async () => {
    api.listAssignments.mockResolvedValue([]);
    render(<AiInterviewTab />);
    await screen.findByRole("radiogroup", { name: /interview track/i });
    expect(screen.queryByText("Interviews from companies")).toBeNull();
  });

  it("practice still works if the assignments request fails", async () => {
    api.listAssignments.mockRejectedValue(new Error("down"));
    render(<AiInterviewTab />);
    expect(await screen.findByRole("radiogroup", { name: /interview track/i })).toBeTruthy();
  });

  it("starting a company interview opens its briefing instead of the track picker, and can go back", async () => {
    const user = userEvent.setup();
    render(<AiInterviewTab />);
    await user.click(
      await screen.findByRole("button", { name: /start the backend engineer interview for acme/i }),
    );
    expect(screen.getByText(/Step 1 of 3 · Interview for Acme/)).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    await user.click(screen.getByRole("button", { name: /back to all interviews/i }));
    expect(await screen.findByRole("radiogroup", { name: /interview track/i })).toBeTruthy();
  });

  it("joining a company interview starts it from the invitation, never as practice", async () => {
    const user = userEvent.setup();
    render(<AiInterviewTab />);
    await user.click(
      await screen.findByRole("button", { name: /start the backend engineer interview for acme/i }),
    );
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    await user.click(await screen.findByLabelText(/i have read the rules/i)); // config loaded
    await user.click(screen.getByLabelText(/allow the ai interviewer to listen/i));
    await user.click(screen.getByLabelText(/allow the ai interviewer to view my camera/i));
    await user.click(await screen.findByRole("button", { name: /continue to equipment check/i }));
    expect(await screen.findByText("Device check for Backend Engineer")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Join now" }));
    expect(room.startInvite).toHaveBeenCalledWith("inv-1", "v-test", { micId: "m" });
    expect(room.start).not.toHaveBeenCalled();
  });

  it("joining practice still uses the chosen track", async () => {
    const user = userEvent.setup();
    render(<AiInterviewTab />);
    await user.click(await screen.findByRole("radio", { name: /software engineer/i }));
    await acceptAll(user);
    await user.click(await screen.findByRole("button", { name: /continue to equipment check/i }));
    await user.click(await screen.findByRole("button", { name: "Join now" }));
    expect(room.start).toHaveBeenCalledWith("dsa", "v-test", { micId: "m" });
    expect(room.startInvite).not.toHaveBeenCalled();
  });

  it("after a company interview the candidate sees it was submitted, not a report", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AiInterviewTab />);
    await user.click(
      await screen.findByRole("button", { name: /start the backend engineer interview for acme/i }),
    );
    room.phase = "ended";
    room.roomName = "ai-room1";
    rerender(<AiInterviewTab />);
    expect(await screen.findByText("Interview submitted")).toBeTruthy();
    expect(screen.getByText(/sent to Acme's hiring team/i)).toBeTruthy();
    expect(screen.getByText(/will not see a report/i)).toBeTruthy();
    expect(screen.queryByText(/generating your report/i)).toBeNull();
    // Nothing to wait for: the report belongs to the company.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.getReport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /back to my interviews/i }));
    expect(room.reset).toHaveBeenCalledOnce();
  });

  it("after practice the candidate still waits for and sees their own report", async () => {
    api.listAssignments.mockResolvedValue([]);
    api.getReport.mockResolvedValue({
      id: "r",
      room_id: "ai-room1",
      domain: "dsa",
      partial: false,
      overall_score: 80,
      technical_score: 80,
      communication_score: 80,
      strengths: [],
      weaknesses: [],
      red_flags: [],
      per_question: [],
      final_recommendation: "Hire",
      duration_seconds: 60,
      created_at: new Date().toISOString(),
      report_markdown: null,
      transcript: null,
    });
    const { rerender } = render(<AiInterviewTab />);
    await screen.findByRole("radiogroup", { name: /interview track/i });
    room.phase = "ended";
    room.roomName = "ai-room1";
    await act(async () => rerender(<AiInterviewTab />));
    await waitFor(() => expect(api.getReport).toHaveBeenCalledWith("ai-room1", expect.anything()));
    expect(screen.queryByText("Interview submitted")).toBeNull();
  });

  it("the invitation email's link opens that interview's briefing and cleans the address bar", async () => {
    window.history.replaceState(null, "", "/candidate?ai_interview_invite=inv-1&x=1");
    render(<AiInterviewTab />);
    expect(await screen.findByText(/Step 1 of 3 · Interview for Acme/)).toBeTruthy();
    expect(window.location.search).toBe("?x=1");
  });

  it("a link to an interview that is already taken or unknown opens nothing", async () => {
    api.listAssignments.mockResolvedValue([{ ...ASSIGNMENT, status: "completed" }]);
    window.history.replaceState(null, "", "/candidate?ai_interview_invite=inv-1");
    render(<AiInterviewTab />);
    await screen.findByText("Submitted");
    expect(screen.queryByText(/Step 1 of 3 · Interview for Acme/)).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("a failed start returns to the briefing with the reason", async () => {
    room.error = "This invitation has expired.";
    render(<AiInterviewTab />);
    expect(await screen.findByText("This invitation has expired.")).toBeTruthy();
  });
});
