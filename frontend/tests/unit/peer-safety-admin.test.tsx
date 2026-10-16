import type { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerSafetyPage } from "@/components/admin/PeerSafetyPage";
import { validateResolution } from "@/services/api/admin/peerSafety";

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), resolve: vi.fn() }));
vi.mock("@/services/api/admin/peerSafety", async (orig) => ({
  ...(await orig<typeof import("@/services/api/admin/peerSafety")>()),
  adminPeerSafetyService: api,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

const ROW = {
  id: "rep-1-abcdef",
  reporter_id: "a",
  reported_id: "b",
  room_id: "room",
  reason: "harassment",
  status: "open" as const,
  source: "meeting" as const,
  created_at: new Date().toISOString(),
  reporter: { id: "a", name: "Alice A", email: "a@x.dev" },
  reported: { id: "b", name: "Bob B", email: "b@x.dev" },
};
const DETAIL = {
  ...ROW,
  details: "He kept insulting me",
  evidence: { transcript: ["Reporter: hi", "Other person: you are useless"] },
  resolution_note: null,
  reviewed_at: null,
  history: { total_reports: 3, distinct_reporters: 3, reports: [] },
  sanctions: [
    {
      id: "s1",
      kind: "suspension" as const,
      reason: "Automatic: reported by 3 different people in 30 days",
      ends_at: "2031-01-01T00:00:00Z",
      lifted_at: null,
      created_at: new Date().toISOString(),
    },
  ],
  active_suspension: true,
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.list.mockResolvedValue({ items: [ROW] });
  api.detail.mockResolvedValue(DETAIL);
});

describe("validateResolution", () => {
  it("needs an action, and a sensible length for a suspension", () => {
    expect(validateResolution("", null)).toBeTruthy();
    expect(validateResolution("dismiss", null)).toBeNull();
    expect(validateResolution("warn", null)).toBeNull();
    expect(validateResolution("lift", null)).toBeNull();
    expect(validateResolution("suspend", null)).toBeTruthy();
    expect(validateResolution("suspend", 0)).toBeTruthy();
    expect(validateResolution("suspend", 366)).toBeTruthy();
    expect(validateResolution("suspend", 14)).toBeNull();
  });
});

describe("PeerSafetyPage", () => {
  it("lists reports for the chosen status and shows who reported whom", async () => {
    const user = userEvent.setup();
    wrap(<PeerSafetyPage />);
    expect(await screen.findByText(/Alice A reported Bob B/)).toBeTruthy();
    expect(screen.getByText(/from inside the meeting/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("open");
    await user.click(screen.getByRole("tab", { name: "Dismissed" }));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith("dismissed"));
  });

  it("shows an empty state", async () => {
    api.list.mockResolvedValue({ items: [] });
    wrap(<PeerSafetyPage />);
    expect(await screen.findByText("No reports here")).toBeTruthy();
  });

  it("opens a report with the evidence and the reported person's history", async () => {
    const user = userEvent.setup();
    wrap(<PeerSafetyPage />);
    await user.click(await screen.findByText(/Alice A reported Bob B/));
    expect(await screen.findByText("He kept insulting me")).toBeTruthy();
    expect(screen.getByText(/3 reports from 3 different people/)).toBeTruthy();
    expect(screen.getByText("Currently suspended")).toBeTruthy();
    expect(screen.getByText(/Transcript attached to the report \(2 lines\)/)).toBeTruthy();
  });

  it("will not save a decision until it is valid, then resolves with the days and note", async () => {
    api.resolve.mockResolvedValue({ ok: true, status: "actioned" });
    const user = userEvent.setup();
    wrap(<PeerSafetyPage />);
    await user.click(await screen.findByText(/Alice A reported Bob B/));
    const save = (await screen.findByRole("button", {
      name: /save decision/i,
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const group = screen.getByRole("radiogroup", { name: "Action" });
    await user.click(within(group).getByRole("radio", { name: "Suspend" }));
    const days = screen.getByLabelText("Days");
    await user.clear(days);
    expect(save.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/between 1 and 365/);
    await user.type(days, "14");
    await user.type(screen.getByLabelText(/note/i), "Repeated abuse");
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith("rep-1-abcdef", {
        action: "suspend",
        days: 14,
        note: "Repeated abuse",
      }),
    );
  });

  it("dismissing sends no days", async () => {
    api.resolve.mockResolvedValue({ ok: true, status: "dismissed" });
    const user = userEvent.setup();
    wrap(<PeerSafetyPage />);
    await user.click(await screen.findByText(/Alice A reported Bob B/));
    await user.click(
      within(await screen.findByRole("radiogroup", { name: "Action" })).getByRole("radio", {
        name: "Dismiss",
      }),
    );
    await user.click(screen.getByRole("button", { name: /save decision/i }));
    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith("rep-1-abcdef", {
        action: "dismiss",
        days: undefined,
        note: "",
      }),
    );
  });
});
