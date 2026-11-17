import { expect, test, hydrated, signedIn, API, EMAIL, PASSWORD, SUPER_EMAIL, apiLogin } from "./helpers";
import type { Page } from "@playwright/test";

const SUPER_PAGES: [string, string][] = [
  ["Colleges", "/colleges"], ["Companies", "/companies"], ["Partnerships", "/partnerships"],
  ["Candidates", "/candidates"], ["Departments", "/departments"], ["Placement analytics", "/placements"],
  ["Users & Access", "/users"], ["Admin Management", "/admin-users"], ["Live Activity", "/activity"],
  ["Audit Log", "/audit-log"], ["Alerts", "/alerts"], ["Peer safety", "/peer-safety"],
  ["System Health", "/system-health"], ["Financial overview", "/finance"], ["Reports", "/reports"],
];

const frame = (page: Page) => page.locator(".super-admin-frame");
const banner = (page: Page) => page.getByText("SUPER ADMIN PORTAL", { exact: true });

async function signInAtAdminPortal(page: Page, email: string, password = PASSWORD) {
  await page.goto("/auth/login?role=admin");
  await hydrated(page);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Rewrites the persisted session the way someone with devtools open would. */
async function tamper(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((p) => {
    const raw = JSON.parse(localStorage.getItem("mirracle.auth")!);
    raw.state.session.user = { ...raw.state.session.user, ...p };
    localStorage.setItem("mirracle.auth", JSON.stringify(raw));
  }, patch);
}

test.describe("one sign-in page, two portals", () => {
  test("the Admin Portal page offers no social sign-in", async ({ page }) => {
    await page.goto("/auth/login?role=admin");
    await expect(page.getByRole("heading", { name: "Admin Portal" })).toBeVisible();
    await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
  });

  test("an Admin lands on the Admin dashboard, without the gold identity", async ({ page }) => {
    await signInAtAdminPortal(page, EMAIL.admin);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText("Platform overview")).toBeVisible();
    await expect(frame(page)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
  });

  test("a Super Admin on the same page lands in the Super Admin Portal", async ({ page }) => {
    await signInAtAdminPortal(page, SUPER_EMAIL);
    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page.getByText("Super Admin dashboard")).toBeVisible();
    await expect(banner(page)).toBeVisible();
  });

  test("wrong credentials: one neutral message, no session, no redirect", async ({ page }) => {
    for (const [email, password] of [[EMAIL.admin, "not-the-password"], ["nobody@e2e.dev", PASSWORD]]) {
      await signInAtAdminPortal(page, email, password);
      await expect(page.getByText("Invalid email or password.").first()).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/login/);
      const stored = await page.evaluate(() => localStorage.getItem("mirracle.auth"));
      expect(stored === null || /"session":null/.test(stored)).toBe(true);
    }
  });

  test("a valid candidate login is refused at the Admin Portal", async ({ page }) => {
    await signInAtAdminPortal(page, EMAIL.candidate);
    await expect(page.getByText("This account does not have access to the Admin Portal.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test.describe("direct URLs and a tampered browser", () => {
  test("anonymous visitor to /super-admin is sent to the Admin sign-in", async ({ page }) => {
    await page.goto("/super-admin/users");
    await expect(page).toHaveURL(/\/auth\/login\?role=admin/);
  });

  test("an Admin typing a Super Admin URL is sent back to the Admin Portal", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/super-admin/admin-users");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(frame(page)).toHaveCount(0);
  });

  test("other roles are kept out of /super-admin", async ({ page, request }) => {
    await signedIn(page, request, "company", "/super-admin");
    await expect(page).toHaveURL(/\/portals/);
  });

  test("a Super Admin on an /admin URL moves to the same page in their portal, filters intact", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/admin/candidates?college=col-1", SUPER_EMAIL);
    await expect(page).toHaveURL(/\/super-admin\/candidates\?college=col-1$/);
  });

  test("editing localStorage cannot make an Admin a Super Admin", async ({ page, request }) => {
    await signedIn(page, request, "admin");
    await tamper(page, { portal: "super_admin", is_super_admin: true, isSuperAdmin: true });
    await page.goto("/super-admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(frame(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin Management" })).toHaveCount(0);
  });

  test("editing localStorage cannot make a candidate an Admin", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await tamper(page, { role: "admin", portal: "super_admin" });
    await page.goto("/super-admin");
    await expect(page).toHaveURL(/\/portals/);
    await expect(page.getByText("Super Admin dashboard")).toHaveCount(0);
  });

  test("no portal content is on screen before the backend has answered", async ({ page, request }) => {
    await page.route("**/admin/me", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    // signedIn() waits for something clickable, which this screen deliberately doesn't have.
    const session = await apiLogin(request, "admin", SUPER_EMAIL);
    await page.addInitScript((s) => localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: s }, version: 0 })), session);
    await page.goto("/super-admin");
    await expect(page.getByRole("status", { name: "Checking your access" })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
  });

  test("if the backend can't confirm access the portal shows why, not the dashboard", async ({ page, request }) => {
    await page.route("**/admin/me", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
                      body: JSON.stringify({ detail: "The database is missing a column" }) }));
    await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
    await expect(page.getByRole("alert").filter({ hasText: "missing a column" })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test("a delegated admin sees their own permissions, not admin management", async ({ page, request }) => {
    await signedIn(page, request, "admin");
    await page.getByRole("link", { name: "My permissions" }).click();
    await expect(page.getByText("Your permissions")).toBeVisible();
    await expect(page.getByRole("button", { name: /Add delegated admin/ })).toHaveCount(0);
  });
});

test.describe("refresh and logout", () => {
  test("both portals survive a hard reload", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/super-admin/colleges", SUPER_EMAIL);
    await page.reload();
    await expect(page).toHaveURL(/\/super-admin\/colleges$/);
    await expect(banner(page)).toBeVisible();
  });

  test("signing out revokes the session on the server and clears the gold identity", async ({ page, request }) => {
    const session = await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
    const me = () => request.get(`${API}/admin/me`, { headers: { Authorization: `Bearer ${session.token}` } });
    expect((await me()).status()).toBe(200);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/super-admin/);
    await expect(page.locator("html")).not.toHaveClass(/super-admin-portal/);

    await expect.poll(async () => (await me()).status()).toBe(401);
    const refreshed = await request.post(`${API}/auth/refresh`, { data: { refreshToken: session.refreshToken } });
    expect(refreshed.status()).toBe(401);

    await page.goBack();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("every other portal's Sign out also revokes the session", async ({ page, request }) => {
    const session = await signedIn(page, request, "candidate");
    // The candidate page rebuilds itself after a hydration mismatch, which can swallow an early click.
    await expect(async () => {
      await page.getByRole("button", { name: "Sign out" }).click({ timeout: 1000 });
      await expect(page).not.toHaveURL(/\/candidate$/, { timeout: 1000 });
    }).toPass();
    await expect.poll(async () =>
      (await request.get(`${API}/auth/profile`, { headers: { Authorization: `Bearer ${session.token}` } })).status()).toBe(401);
  });
});

test.describe("the Super Admin Portal", () => {
  for (const [label, path] of SUPER_PAGES) {
    test(`'${label}' keeps the portal's URL and gold frame`, async ({ page, request, problems }) => {
      await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
      await page.getByRole("link", { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/super-admin${path}`));
      await page.waitForLoadState("networkidle");
      await expect(frame(page)).toHaveCount(1);
      await expect(banner(page)).toBeVisible();
      await expect(page.getByText("Something went wrong").or(page.getByText("This page didn't load"))).toHaveCount(0);
      expect(problems.filter((p) => p.startsWith("pageerror"))).toEqual([]);
    });
  }

  test("links inside a page stay in the portal", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/super-admin/users", SUPER_EMAIL);
    await page.getByRole("row").filter({ hasText: "cand@e2e.dev" }).getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "View" }).click();
    await expect(page).toHaveURL(/\/super-admin\/users\/u-cand$/);
    await page.getByRole("link", { name: "All users" }).click();
    await expect(page).toHaveURL(/\/super-admin\/users$/);
  });

  test("the frame is real, click-through and outside the layout", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
    const style = await frame(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { position: s.position, pointerEvents: s.pointerEvents, width: s.borderTopWidth, source: s.borderImageSource };
    });
    expect(style).toMatchObject({ position: "fixed", pointerEvents: "none", width: "4px" });
    expect(style.source).toContain("gradient");
    const hit = await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, 2)?.className ?? "");
    expect(String(hit)).not.toContain("super-admin-frame");
  });

  test("the frame stays visible over a modal, which stays usable", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/super-admin/admin-users", SUPER_EMAIL);
    await page.getByRole("button", { name: /Add delegated admin/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const z = await frame(page).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThan(50);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("the banner stays pinned while the page scrolls", async ({ page, request }) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
    await expect(banner(page)).toBeVisible();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const box = await banner(page).boundingBox();
    expect(box!.y).toBeLessThan(40);
  });

  for (const [name, width, height] of [["phone", 375, 700], ["tablet", 768, 1024]] as const) {
    test(`on a ${name} the identity stays and nothing scrolls sideways`, async ({ page, request }) => {
      await page.setViewportSize({ width, height });
      await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
      await expect(banner(page)).toBeVisible();
      await expect(frame(page)).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(page.getByRole("link", { name: "Admin Management" })).toBeVisible();
    });
  }

  test("nothing of it leaks into another portal in the same tab", async ({ page, request }) => {
    await signedIn(page, request, "admin", "/super-admin", SUPER_EMAIL);
    await expect(banner(page)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/super-admin/);
    const session = await apiLogin(request, "admin");
    await page.evaluate((s) => localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: s }, version: 0 })), session);
    await page.goto("/admin");
    await expect(page.getByText("Platform overview")).toBeVisible();
    await expect(frame(page)).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveClass(/super-admin-portal/);
  });
});
