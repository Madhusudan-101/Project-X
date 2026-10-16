import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiInterviewTab } from "@/components/candidate/ai-interview/AiInterviewTab";
import { checkBrowserSupport } from "@/components/candidate/ai-interview/supportCheck";
import { capturePendingInvite, clearPendingInvite, readPendingInvite } from "@/lib/pendingInvite";
import type { AiInterviewAssignment } from "@/types/candidate/aiInterview";

const room = vi.hoisted(() => ({
  phase: "setup" as string,
  roomName: null as string | null,
  error: null as string | null,
  start: vi.fn(),
  startInvite: vi.fn(),
  end: vi.fn(),
  reset: vi.fn(),
  rejoin: vi.fn(),
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
  requestAccommodation: vi.fn(),
}));
vi.mock("@/services/api/candidate/aiInterview", () => ({ aiInterviewService: api }));
vi.mock("@/services/api/client", () => ({
  request: vi.fn(),
  ApiClientError: class ApiClientError extends Error {},
}));
vi.mock("@/components/candidate/ai-interview/supportCheck", async (orig) => ({
  ...(await orig<typeof import("@/components/candidate/ai-interview/supportCheck")>()),
  detectBrowserSupport: () => ({ problems: [], warnings: [] }),
}));
vi.mock("@/components/candidate/ai-interview/DeviceCheck", () => ({
  DeviceCheck: (p: { testOnly?: boolean; onBack: () => void }) => (
    <div>
      <p>{p.testOnly ? "Equipment test" : "Device check"}</p>
      <button onClick={p.onBack}>Back from check</button>
    </div>
  ),
}));

const A: AiInterviewAssignment = {
  id: "inv-12345678",
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
  consentVersion: "v",
};

beforeEach(() => {
  Object.assign(room, { phase: "setup", roomName: null, error: null });
  [room.start, room.startInvite, room.end, room.reset, room.rejoin].forEach((f) => f.mockReset());
  Object.values(api).forEach((f) => f.mockReset());
  api.listAssignments.mockResolvedValue([A]);
  api.getConfig.mockResolvedValue(CONFIG);
  api.listReports.mockResolvedValue([]);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/candidate");
});

describe("pending invitation link", () => {
  it("is remembered from the URL and read back", () => {
    expect(capturePendingInvite("?ai_interview_invite=inv-12345678")).toBe("inv-12345678");
    expect(readPendingInvite()).toBe("inv-12345678");
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });

  it("ignores a missing or malformed id", () => {
    expect(capturePendingInvite("")).toBeNull();
    expect(capturePendingInvite("?ai_interview_invite=%3Cscript%3E")).toBeNull();
    expect(readPendingInvite()).toBeNull();
  });

  it("expires after a day", () => {
    capturePendingInvite("?ai_interview_invite=inv-12345678", 1_000);
    expect(readPendingInvite(1_000 + 23 * 3600_000)).toBe("inv-12345678");
    expect(readPendingInvite(1_000 + 25 * 3600_000)).toBeNull();
    expect(readPendingInvite()).toBeNull(); // and is dropped
  });

  it("survives a login redirect: the briefing opens from storage with no URL param", async () => {
    capturePendingInvite("?ai_interview_invite=inv-12345678");
    render(<AiInterviewTab />);
    expect(await screen.findByText(/Interview for Acme/)).toBeTruthy();
    expect(readPendingInvite()).toBeNull();
  });
});

describe("browser support check", () => {
  const ok = {
    hasGetUserMedia: true,
    hasPeerConnection: true,
    hasAudioContext: true,
    userAgent: "Mozilla/5.0 (X11; Linux) Chrome/120",
    secure: true,
  };
  it("passes a normal desktop browser", () => {
    expect(checkBrowserSupport(ok)).toEqual({ problems: [], warnings: [] });
  });
  it.each([
    [{ hasGetUserMedia: false }, /camera and microphone/],
    [{ hasPeerConnection: false }, /live video calls/],
    [{ hasAudioContext: false }, /call audio/],
    [{ secure: false }, /https/],
  ])("blocks when %j", (over, msg) => {
    expect(checkBrowserSupport({ ...ok, ...over }).problems.join(" ")).toMatch(msg);
  });
  it("only warns on a phone", () => {
    const r = checkBrowserSupport({ ...ok, userAgent: "Mozilla/5.0 (iPhone)" });
    expect(r.problems).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/laptop or desktop/);
  });
});

describe("interrupted and unavailable states", () => {
  it("offers rejoin and end when the connection dropped", async () => {
    room.phase = "interrupted";
    const user = userEvent.setup();
    render(<AiInterviewTab />);
    expect(screen.getByText("Connection lost")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Rejoin interview" }));
    expect(room.rejoin).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "End interview" }));
    expect(room.end).toHaveBeenCalledTimes(1);
  });

  it("says the attempt was not used when the interviewer never joined", async () => {
    room.phase = "unavailable";
    render(<AiInterviewTab />);
    expect(screen.getByText(/couldn.t start your interview/i)).toBeTruthy();
    expect(screen.getByText(/did not count towards your daily limit/i)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(room.reset).toHaveBeenCalled();
  });
});

describe("briefing extras", () => {
  it("test my setup opens the equipment test without starting anything", async () => {
    const user = userEvent.setup();
    render(<AiInterviewTab />);
    await screen.findByText("Interviews from companies");
    await user.click(screen.getByRole("button", { name: /test my camera and microphone/i }));
    expect(screen.getByText("Equipment test")).toBeTruthy();
    expect(room.start).not.toHaveBeenCalled();
    expect(room.startInvite).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back from check" }));
    expect(screen.getByText(/Practice interview/)).toBeTruthy();
  });

  it("asks the company for an accommodation and then shows it was sent", async () => {
    api.requestAccommodation.mockResolvedValue({ ok: true, company_emailed: true });
    capturePendingInvite("?ai_interview_invite=inv-12345678");
    const user = userEvent.setup();
    render(<AiInterviewTab />);
    await screen.findByText(/Interview for Acme/);
    expect(screen.getByText(/makes the hiring decision/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /extra time or another format/i }));
    const send = screen.getByRole("button", { name: "Send request" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("What do you need?"), "Extra 15 minutes please");
    await user.click(send);
    await waitFor(() =>
      expect(api.requestAccommodation).toHaveBeenCalledWith(
        "inv-12345678",
        "Extra 15 minutes please",
      ),
    );
    expect(await screen.findByText(/Accommodation requested/)).toBeTruthy();
  });

  it("shows an earlier accommodation request as already sent", async () => {
    api.listAssignments.mockResolvedValue([{ ...A, accommodation_requested: true }]);
    capturePendingInvite("?ai_interview_invite=inv-12345678");
    render(<AiInterviewTab />);
    expect(await screen.findByText(/Accommodation requested/)).toBeTruthy();
  });
});
