import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/auth";
import type { CollegeOnboardingState } from "@/types/college/college";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  updateProfile: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ ...(options as object) }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/services/api/college/onboarding", () => ({
  collegeOnboardingService: { get: mocks.get, save: mocks.save },
}));
vi.mock("@/services/api/auth", () => ({ authService: { updateProfile: mocks.updateProfile } }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { Route } from "@/routes/auth.college-onboarding";

const Page = (Route as unknown as { component: () => JSX.Element }).component;

const saved = (over: Partial<CollegeOnboardingState> = {}): CollegeOnboardingState => ({
  college: {
    name: "Alpha College",
    website: "https://alpha.edu",
    city: "Pune",
    state: "Maharashtra",
    type: "Private University",
    customType: null,
    studentStrength: "2,000-5,000",
    onboardingCompleted: false,
  },
  contact: { designation: "TPO", customDesignation: null, phone: "+91 98765 43210" },
  departments: ["Computer Science", "Mechanical"],
  intents: ["placement_mgmt", "jd_matching"],
  consent: { tosVersion: "tos-v1", consentVersion: "data-consent-v1", acceptedAt: null },
  consentVersions: { tos: "tos-v1", dataConsent: "data-consent-v1" },
  ...over,
});

const emptyState = (): CollegeOnboardingState =>
  saved({
    college: {
      name: "Alpha College",
      website: null,
      city: null,
      state: null,
      type: null,
      customType: null,
      studentStrength: null,
      onboardingCompleted: false,
    },
    contact: null,
    departments: [],
    intents: [],
    consent: null,
  });

const user = userEvent.setup();

async function renderLoaded() {
  render(<Page />);
  await screen.findByDisplayValue("Alpha College");
}

async function advanceToTheLastStep() {
  for (let i = 0; i < 4; i++) {
    await user.click(await screen.findByRole("button", { name: /continue/i }));
  }
  await screen.findByLabelText(/I agree to the Terms of Service/);
}

beforeEach(() => {
  // Radix's Checkbox measures itself with ResizeObserver, which jsdom does not provide.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.values(mocks).forEach((m) => {
    if (typeof m === "function") m.mockReset();
  });
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
  useAuthStore.setState({
    session: {
      token: "t",
      refreshToken: "r",
      expiresAt: "9999999999",
      user: {
        id: "tpo-1",
        email: "tpo@alpha.edu",
        name: "Asha Rao",
        firstName: "Asha",
        role: "college",
      },
    } as never,
  });
  mocks.updateProfile.mockResolvedValue({ id: "tpo-1", onboarded: true });
});

describe("College onboarding page", () => {
  it("loads what was saved before and shows the college name as read-only", async () => {
    mocks.get.mockResolvedValue(saved());
    await renderLoaded();
    const name = screen.getByDisplayValue("Alpha College");
    expect(name).toBeDisabled();
    expect(screen.getByDisplayValue("https://alpha.edu")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pune")).toBeInTheDocument();
    expect(screen.getByText(/Set by the Mirracle team/)).toBeInTheDocument();
  });

  it("no longer asks for things that nothing stores (a logo, the placement cycle status)", async () => {
    mocks.get.mockResolvedValue(saved());
    await renderLoaded();
    expect(screen.queryByText("College logo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /continue/i }));
    expect(await screen.findByText("Total student strength")).toBeInTheDocument();
    expect(screen.queryByText("Current placement cycle status")).not.toBeInTheDocument();
  });

  it("saves everything on the server first, then marks the account onboarded, then opens the dashboard", async () => {
    mocks.get.mockResolvedValue(saved());
    mocks.save.mockResolvedValue(
      saved({ college: { ...saved().college, onboardingCompleted: true } }),
    );
    await renderLoaded();
    await advanceToTheLastStep();
    expect(screen.getByLabelText(/I agree to the Terms of Service/)).toBeChecked(); // on file for the current wording

    await user.click(screen.getByRole("button", { name: /enter dashboard/i }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/college" }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith({
      website: "https://alpha.edu",
      city: "Pune",
      state: "Maharashtra",
      type: "Private University",
      customType: undefined,
      designation: "TPO",
      customDesignation: undefined,
      phone: "+91 98765 43210",
      studentStrength: "2,000-5,000",
      departments: ["Computer Science", "Mechanical"],
      intents: ["placement_mgmt", "jd_matching"],
      tosAccepted: true,
      dataConsentAccepted: true,
    });
    expect(mocks.updateProfile).toHaveBeenCalledWith({ onboarded: true });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateProfile.mock.invocationCallOrder[0],
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Workspace ready!");
  });

  it("a failed save shows the server's message, does not mark the account onboarded and does not leave the page", async () => {
    mocks.get.mockResolvedValue(saved());
    mocks.save.mockRejectedValue(
      new Error(
        "Could not save your departments. Your workspace is not marked ready yet — nothing is lost, submit again to finish.",
      ),
    );
    await renderLoaded();
    await advanceToTheLastStep();
    await user.click(screen.getByRole("button", { name: /enter dashboard/i }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.stringContaining("submit again to finish"),
      ),
    );
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalledWith({ to: "/college" });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /enter dashboard/i })).toBeEnabled(); // can simply try again
  });

  it("without the acceptances ticked nothing is sent", async () => {
    mocks.get.mockResolvedValue(saved({ consent: null }));
    await renderLoaded();
    await advanceToTheLastStep();
    expect(screen.getByLabelText(/I agree to the Terms of Service/)).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /enter dashboard/i }));
    expect((await screen.findAllByText("Required to continue")).length).toBeGreaterThan(0);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("tells the user when the saved details could not be loaded instead of pretending the form is blank", async () => {
    mocks.get.mockRejectedValue(new Error("Could not load your saved details."));
    render(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your saved details/i);
    expect(mocks.toast.error).toHaveBeenCalledWith("Could not load your saved details.");
  });

  it("a first visit starts empty and will not continue without the required details", async () => {
    mocks.get.mockResolvedValue(emptyState());
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      (await screen.findAllByText(/Enter a city|Enter a state|Select a type/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Total student strength")).not.toBeInTheDocument();
  });

  it("an account that is not a College account is sent away", async () => {
    useAuthStore.setState({
      session: {
        token: "t",
        refreshToken: "r",
        expiresAt: "9",
        user: { id: "c", email: "c@x", name: "C", role: "candidate" },
      } as never,
    });
    mocks.get.mockResolvedValue(saved());
    render(<Page />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/portals" }));
  });
});
