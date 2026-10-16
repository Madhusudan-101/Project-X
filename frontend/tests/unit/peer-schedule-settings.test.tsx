import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildIcs, foldLine, icsEscape, icsTime } from "@/lib/ics";
import {
  DEFAULT_PREFERENCES,
  PeerSettingsDialog,
  browserTimezone,
  timezoneChoices,
} from "@/components/candidate/peer/PeerSettingsDialog";
import {
  RescheduleDialog,
  toLocalInput,
  validateNewTime,
} from "@/components/candidate/peer/RescheduleDialog";
import type { ScheduledMeeting } from "@/services/api/candidate/peer";

const api = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  rescheduleMeeting: vi.fn(),
}));
vi.mock("@/services/api/candidate/peer", () => ({ peerService: api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe("calendar file", () => {
  const meeting = {
    id: "m-1",
    title: "Mock, round; 1\nline",
    scheduled_at: "2030-03-04T09:30:00Z",
    duration_minutes: 45,
  };

  it("is a valid event with UTC start and end from the duration", () => {
    const ics = buildIcs(meeting, new Date("2030-03-01T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20300304T093000Z");
    expect(ics).toContain("DTEND:20300304T101500Z");
    expect(ics).toContain("DTSTAMP:20300301T000000Z");
    expect(ics).toContain("UID:m-1@mirracle");
    expect(ics).toContain("TRIGGER:-PT15M");
  });

  it("escapes text so a title cannot inject calendar fields", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const ics = buildIcs({ ...meeting, title: "x\r\nBEGIN:VEVENT\r\nSUMMARY:evil" });
    expect(ics.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length).toBe(1); // no injected event line
    expect(ics).toContain("SUMMARY:x\\nBEGIN:VEVENT\\nSUMMARY:evil");
  });

  it("uses a default title and folds long lines", () => {
    expect(buildIcs({ ...meeting, title: null })).toContain("SUMMARY:Peer interview");
    const folded = foldLine("X".repeat(200));
    expect(folded.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("X".repeat(200));
    expect(icsTime(new Date("2030-12-31T23:59:59Z"))).toBe("20301231T235959Z");
  });
});

describe("timezone helpers", () => {
  it("always offers the browser's zone and the saved one", () => {
    const zones = timezoneChoices("Pacific/Auckland");
    expect(zones).toContain("Pacific/Auckland");
    expect(zones).toContain(browserTimezone());
    expect([...zones].sort()).toEqual(zones);
  });
});

describe("PeerSettingsDialog", () => {
  it("loads the saved settings and saves changes", async () => {
    api.getPreferences.mockResolvedValue({
      default_private: true,
      timezone: "Europe/London",
      email_invites: true,
      email_reminders: true,
    });
    api.setPreferences.mockImplementation(async (p) => p);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<PeerSettingsDialog open onOpenChange={onOpenChange} />);
    const priv = (await screen.findByLabelText(
      /Keep my identity private by default/,
    )) as HTMLInputElement;
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect((screen.getByLabelText("Your timezone") as HTMLSelectElement).value).toBe(
      "Europe/London",
    );
    await user.click(priv);
    await user.click(screen.getByLabelText(/Reminders before a meeting/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.setPreferences).toHaveBeenCalledWith({
        default_private: false,
        timezone: "Europe/London",
        email_invites: true,
        email_reminders: false,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("will not save until it has loaded, and says when it cannot load or save", async () => {
    api.getPreferences.mockRejectedValueOnce(new Error("x"));
    const { unmount } = render(<PeerSettingsDialog open onOpenChange={() => undefined} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not load/i);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    api.getPreferences.mockResolvedValue(DEFAULT_PREFERENCES);
    api.setPreferences.mockRejectedValue(new Error("Unknown timezone"));
    const user = userEvent.setup();
    render(<PeerSettingsDialog open onOpenChange={() => undefined} />);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Unknown timezone/);
  });
});

describe("rescheduling", () => {
  const MEETING = {
    id: "meeting-1234",
    room_id: "room",
    title: null,
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    duration_minutes: 30,
    keep_private: false,
    status: "scheduled",
    creator_id: "a",
    invitee_id: "b",
    role: "creator",
  } as ScheduledMeeting;

  it("validates the new time", () => {
    const now = new Date("2030-01-01T10:00:00");
    expect(validateNewTime("", now)).toBeTruthy();
    expect(validateNewTime("garbage", now)).toBeTruthy();
    expect(validateNewTime("2029-12-31T10:00", now)).toBeTruthy();
    expect(validateNewTime("2030-01-01T10:30", now)).toBeNull();
  });

  it("round-trips an ISO time through the date input in local time", () => {
    const iso = "2030-06-01T08:15:00Z";
    expect(new Date(toLocalInput(iso)).getTime()).toBe(new Date(iso).getTime());
  });

  it("moves the meeting, tells the host the invitee was emailed, and reports the new row", async () => {
    const moved = { ...MEETING, scheduled_at: new Date(Date.now() + 7200_000).toISOString() };
    api.rescheduleMeeting.mockResolvedValue(moved);
    const onMoved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RescheduleDialog meeting={MEETING} onClose={onClose} onMoved={onMoved} />);
    expect(screen.getByText(/Your invitee will be told/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move meeting" }));
    await waitFor(() =>
      expect(api.rescheduleMeeting).toHaveBeenCalledWith(
        "meeting-1234",
        expect.stringMatching(/Z$/),
      ),
    );
    expect(onMoved).toHaveBeenCalledWith(moved);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's reason (for example someone already joined) and stays open", async () => {
    api.rescheduleMeeting.mockRejectedValue(new Error("This meeting can no longer be moved."));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RescheduleDialog meeting={MEETING} onClose={onClose} onMoved={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Move meeting" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no longer be moved/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("will not send a time in the past", async () => {
    const user = userEvent.setup();
    render(
      <RescheduleDialog meeting={MEETING} onClose={() => undefined} onMoved={() => undefined} />,
    );
    const input = screen.getByLabelText("New date and time") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "2001-01-01T10:00");
    await user.click(screen.getByRole("button", { name: "Move meeting" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/future/);
    expect(api.rescheduleMeeting).not.toHaveBeenCalled();
  });
});
