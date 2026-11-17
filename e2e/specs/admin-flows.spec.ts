import { expect, test, signedIn, API, EMAIL, PASSWORD, SUPER_EMAIL, apiLogin } from "./helpers";
import type { Page } from "@playwright/test";

/** The management flows of both portals, driven through the real UI and checked against the API. */
const asSuper = (page: Page, request: any, path: string) => signedIn(page, request, "admin", path, SUPER_EMAIL);
const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

async function openRowMenu(page: Page, text: string) {
  await row(page, text).getByRole("button", { name: /Actions for/ }).click();
}

test.describe("Users & Access", () => {
  test("lists real accounts; search and role filter narrow them; refresh keeps working", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/users");
    await expect(row(page, "cand@e2e.dev")).toBeVisible();
    await expect(row(page, "tpo@e2e.dev")).toBeVisible();
    await page.getByPlaceholder(/search/i).first().fill("hana");
    await expect(row(page, "hr@e2e.dev")).toBeVisible();
    await expect(row(page, "cand@e2e.dev")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: /Users/ }).first()).toBeVisible();
  });

  test("a search with no match shows the empty state, not a blank table", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/users");
    await page.getByPlaceholder(/search/i).first().fill("zzz-nobody");
    await expect(page.getByText(/No .*(users|accounts|match)/i).first()).toBeVisible();
  });

  test("block needs a reason, takes effect on the account's next request, and unblock restores it", async ({ page, request }) => {
    const candidate = await apiLogin(request, "candidate");
    const profile = () => request.get(`${API}/auth/profile`, { headers: { Authorization: `Bearer ${candidate.token}` } });
    expect((await profile()).status()).toBe(200);

    await asSuper(page, request, "/super-admin/users");
    await openRowMenu(page, "cand@e2e.dev");
    await page.getByRole("menuitem", { name: /Block/ }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Block", exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill("Abuse report");
    await confirm.click();
    await expect(page.getByText(/has been temporarily blocked/)).toBeVisible();
    await expect(row(page, "cand@e2e.dev").getByText(/Blocked|Temporary/).first()).toBeVisible();
    expect((await profile()).status()).toBe(403);

    await page.reload();
    await expect(row(page, "cand@e2e.dev").getByText(/Blocked|Temporary/).first()).toBeVisible();

    await openRowMenu(page, "cand@e2e.dev");
    await page.getByRole("menuitem", { name: /Unblock/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unblock" }).click();
    await expect(page.getByText(/has been unblocked/)).toBeVisible();
    expect((await profile()).status()).toBe(200);
  });

  test("a reason typed and cancelled never reaches the next person's dialog", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/users");
    await openRowMenu(page, "cand@e2e.dev");
    await page.getByRole("menuitem", { name: /Block/ }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Meant for the candidate");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await openRowMenu(page, "hr@e2e.dev");
    await page.getByRole("menuitem", { name: /Block/ }).click();
    await expect(page.getByRole("dialog").getByLabel(/Reason/)).toHaveValue("");
  });

  test("user detail opens from the list and shows the account", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/users");
    await openRowMenu(page, "cand@e2e.dev");
    await page.getByRole("menuitem", { name: "View" }).click();
    await expect(page).toHaveURL(/\/admin\/users\/u-cand$/);
    await expect(page.getByText("cand@e2e.dev").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("cand@e2e.dev").first()).toBeVisible();
  });

  test("an unknown user id says so", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/users/not-a-real-id");
    await expect(page.getByText(/not found/i).first()).toBeVisible();
  });

  test("an Admin blocking another admin is refused, with the reason on screen", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/users");
    await openRowMenu(page, "super@e2e.dev");
    await page.getByRole("menuitem", { name: /Block/ }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Trying it");
    await page.getByRole("dialog").getByRole("button", { name: "Block", exact: true }).click();
    await expect(page.getByText("Only a Super Admin can disable or re-enable an Admin account.").first()).toBeVisible();
  });

  test("CSV export downloads the file", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/users");
    await expect(row(page, "cand@e2e.dev")).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export/ }).first().click()]);
    expect(download.suggestedFilename()).toBe("users.csv");
  });
});

test.describe("College management", () => {
  test("Add college: validates, creates, shows it, and links the new TPO", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/colleges");
    await expect(row(page, "Alpha College")).toBeVisible();
    await page.getByRole("button", { name: "Add college" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog.getByText("Enter the college name")).toBeVisible();
    await expect(dialog.getByText("Enter a valid email")).toBeVisible();

    await dialog.getByLabel("College name").fill("Beta Institute");
    await dialog.getByLabel("City (optional)").fill("Jaipur");
    await dialog.getByLabel("Contact first name").fill("Tina");
    await dialog.getByLabel("Contact last name").fill("Rao");
    await dialog.getByLabel("Contact email").fill("tina@beta.edu");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, "Beta Institute")).toBeVisible();

    await page.reload();
    await expect(row(page, "Beta Institute")).toBeVisible();
  });

  test("Add college: an email already in use is refused and the form stays open", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/colleges");
    await page.getByRole("button", { name: "Add college" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("College name").fill("Gamma College");
    await dialog.getByLabel("Contact first name").fill("A");
    await dialog.getByLabel("Contact last name").fill("B");
    await dialog.getByLabel("Contact email").fill(EMAIL.candidate);
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/already registered/).first()).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("suspend blocks the college's TPO; reactivate restores exactly that", async ({ page, request }) => {
    const tpo = await apiLogin(request, "college", "tpo2@e2e.dev");
    const asTpo = () => request.get(`${API}/auth/profile`, { headers: { Authorization: `Bearer ${tpo.token}` } });

    await asSuper(page, request, "/super-admin/colleges");
    await page.getByRole("link", { name: "Delta College" }).click();
    await expect(page).toHaveURL(/\/super-admin\/colleges\/5a5a5a5a-/);
    await page.getByRole("button", { name: "Suspend college" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /Suspend/ })).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill("Contract ended");
    await dialog.getByRole("button", { name: /Suspend/ }).click();
    await expect(page.getByText("Delta College has been suspended.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate college" })).toBeVisible();
    expect((await asTpo()).status()).toBe(403);

    await page.getByRole("button", { name: "Reactivate college" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Reactivate/ }).click();
    await expect(page.getByText("Delta College has been reactivated.")).toBeVisible();
    expect((await asTpo()).status()).toBe(200);
  });

  test("a failed list shows the error and Try again recovers", async ({ page, request }) => {
    let fail = true;
    await page.route("**/admin/colleges?*", async (route) => {
      if (!fail) return route.continue();
      await route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
                            body: JSON.stringify({ detail: "Failed to load admin analytics." }) });
    });
    await signedIn(page, request, "admin", "/admin/colleges");
    await expect(page.getByText("Failed to load admin analytics.")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(row(page, "Alpha College")).toBeVisible();
  });
});

test.describe("Student management", () => {
  test("candidates list shows real students and search narrows it", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/candidates");
    await expect(row(page, "cand@e2e.dev")).toBeVisible();
    await expect(row(page, "cand2@e2e.dev")).toBeVisible();
    await page.getByPlaceholder(/search/i).first().fill("Dev Candidate");
    await expect(row(page, "cand2@e2e.dev")).toBeVisible();
    await expect(row(page, "cand@e2e.dev")).toHaveCount(0);
  });

  test("CSV export downloads the file", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/candidates");
    await expect(row(page, "cand@e2e.dev")).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export/ }).first().click()]);
    expect(download.suggestedFilename()).toBe("candidates.csv");
  });
});

test.describe("Admin Management (Super Admin only)", () => {
  async function addDelegate(page: Page) {
    await page.getByRole("button", { name: /Add delegated admin/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("First name").fill("Nia");
    await dialog.getByLabel("Last name").fill("Delegate");
    await dialog.getByLabel("Email").fill("nia@e2e.dev");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, "nia@e2e.dev")).toBeVisible();
  }

  test("create: validates the form, and the new account can do nothing yet", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/admin-users");
    await page.getByRole("button", { name: /Add delegated admin/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("dialog").getByText("Enter a first name")).toBeVisible();
    await page.keyboard.press("Escape");
    await addDelegate(page);
    await openRowMenu(page, "nia@e2e.dev");
    await page.getByRole("menuitem", { name: "Permissions" }).click();
    await expect(page.getByRole("dialog").getByText("No permissions granted yet.")).toBeVisible();
  });

  test("grant then revoke a permission", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/admin-users");
    await openRowMenu(page, "bare@e2e.dev");
    await page.getByRole("menuitem", { name: "Permissions" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Grant permission" })).toBeDisabled();
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "users.view" }).click();
    await dialog.getByRole("button", { name: "Grant permission" }).click();
    await expect(page.getByText("Granted users.view.")).toBeVisible();
    await expect(dialog.getByText("users.view", { exact: true }).first()).toBeVisible();

    const bare = await apiLogin(request, "admin", "bare@e2e.dev");
    const list = () => request.get(`${API}/admin/users`, { headers: { Authorization: `Bearer ${bare.token}` } });
    expect((await list()).status()).toBe(200);

    await dialog.getByRole("button", { name: "Revoke users.view" }).click();
    await expect(page.getByText("Permission revoked.")).toBeVisible();
    expect((await list()).status()).toBe(403);
  });

  test("disabling an admin shows at once and locks them out; re-enabling restores them", async ({ page, request }) => {
    const bare = await apiLogin(request, "admin", "bare@e2e.dev");
    const me = () => request.get(`${API}/admin/me`, { headers: { Authorization: `Bearer ${bare.token}` } });

    await asSuper(page, request, "/super-admin/admin-users");
    await openRowMenu(page, "bare@e2e.dev");
    await page.getByRole("menuitem", { name: "Disable" }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Left the team");
    await page.getByRole("dialog").getByRole("button", { name: "Block", exact: true }).click();
    await expect(row(page, "bare@e2e.dev").getByText(/Disabled/)).toBeVisible();
    expect((await me()).status()).toBe(403);

    await openRowMenu(page, "bare@e2e.dev");
    await page.getByRole("menuitem", { name: "Re-enable" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unblock" }).click();
    await expect(row(page, "bare@e2e.dev").getByText("Active")).toBeVisible();
    expect((await me()).status()).toBe(200);
  });

  test("a half-filled grant does not follow the dialog to the next admin", async ({ page, request }) => {
    await asSuper(page, request, "/super-admin/admin-users");
    await openRowMenu(page, "bare@e2e.dev");
    await page.getByRole("menuitem", { name: "Permissions" }).click();
    await page.getByRole("dialog").getByRole("combobox").first().click();
    await page.getByRole("option", { name: "users.block" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
    await openRowMenu(page, "admin@e2e.dev");
    await page.getByRole("menuitem", { name: "Permissions" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Grant permission" })).toBeDisabled();
  });
});

test.describe("an Admin with no grants", () => {
  test("sees only what they may use, and a typed URL explains itself instead of crashing", async ({ page, request, problems }) => {
    await signedIn(page, request, "admin", "/admin", "bare@e2e.dev");
    await expect(page.getByText("Platform overview")).toBeVisible();
    await expect(page.getByRole("link", { name: "Users & Access" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Colleges" })).toHaveCount(0);
    await page.goto("/admin/users");
    await expect(page.getByText("Your account doesn't have Admin access to this data.").first()).toBeVisible();
    expect(problems.filter((p) => p.startsWith("pageerror"))).toEqual([]);
  });
});

test.describe("session expiry", () => {
  test("a revoked session mid-use goes back to the Admin sign-in", async ({ page, request }) => {
    const session = await signedIn(page, request, "admin");
    await request.post(`${API}/auth/logout`, { headers: { Authorization: `Bearer ${session.token}` } });
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("an expired access token is renewed without the user noticing", async ({ page, request }) => {
    const session = await apiLogin(request, "admin", SUPER_EMAIL, PASSWORD);
    const stale = { ...session, token: "expired-access-token" };
    await page.addInitScript((s) => {
      if (localStorage.getItem("mirracle.auth") === null) localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: s }, version: 0 }));
    }, stale);
    await page.goto("/super-admin");
    await expect(page.getByText("Super Admin dashboard")).toBeVisible();
  });
});
