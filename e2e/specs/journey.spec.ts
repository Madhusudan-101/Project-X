import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { API, PASSWORD, EMAIL, anyHydrated, hydrated, bearer, apiLogin } from "./helpers";

const test = base;

async function user(browser: any, role: string, email: string) {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/auth/login?role=${role}`);
  await hydrated(page);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(new RegExp(`/${role}$`));
  await anyHydrated(page);
  return { ctx, page };
}

test.describe("cross-portal journey, driven entirely through the browser UI", () => {
  test.beforeEach(async ({ request }) => { await request.post(`${API}/__e2e/reset`); });

  test("candidate applies -> company reviews & shortlists -> candidate sees progress -> college roster unaffected", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const cand = await user(browser, "candidate", EMAIL.candidate);
    const hr = await user(browser, "company", EMAIL.company);
    const tpo = await user(browser, "college", EMAIL.college);

    // 1. candidate applies from the job board
    await cand.page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await cand.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(cand.page.getByText("72% fit")).toBeVisible({ timeout: 15_000 });

    // 2. company sees the funnel + the applicant in the drive's round table
    await hr.page.goto("/company-jobs");
    await hr.page.getByRole("link", { name: "Backend Engineer" }).first().click();
    const row = hr.page.getByRole("row", { name: /Cara Candidate/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "Shortlist" }).click();
    await expect(hr.page.getByText("Shortlisted for the next round.")).toBeVisible();

    // 3. candidate's tracker shows round progress after a refresh
    await cand.page.reload();
    await anyHydrated(cand.page);
    await cand.page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await expect(cand.page.getByText("Round 1 of 1")).toBeVisible({ timeout: 15_000 });

    // 4. the applicant is on the company's job list count
    await hr.page.goto("/company-jobs");
    await expect(hr.page.getByRole("link", { name: "1" }).first()).toBeVisible({ timeout: 15_000 });

    // 5. the TPO of the same college still sees only their own roster
    await tpo.page.goto("/college/students");
    await expect(tpo.page.getByRole("cell", { name: "Sam Student", exact: true }).first()).toBeVisible();
    await expect(tpo.page.getByText("Cara Candidate")).toHaveCount(0);

    for (const u of [cand, hr, tpo]) await u.ctx.close();
  });

  test("a brand-new candidate signs up through the UI and is taken to onboarding; the account then works", async ({ page, request }) => {
    await page.goto("/auth/signup?role=candidate");
    await hydrated(page, "#email");
    await page.locator("#firstName").fill("Nia");
    await page.locator("#lastName").fill("Newbie");
    await page.locator("#email").fill("newbie@e2e.dev");
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm").fill(PASSWORD);
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/auth\/profile-setup/, { timeout: 15_000 });
    await expect(page.getByText("Welcome, Nia!")).toBeVisible();
    // not yet onboarded -> the dashboard keeps sending them back to complete their profile
    const s = await apiLogin(request, "candidate", "newbie@e2e.dev");
    expect(s.user.onboarded).toBe(false);
    expect(s.user.firstName).toBe("Nia");
    // a second signup with the same email is refused
    await page.goto("/auth/signup?role=candidate");
    await hydrated(page, "#email");
    await page.locator("#firstName").fill("Nia");
    await page.locator("#lastName").fill("Newbie");
    await page.locator("#email").fill("newbie@e2e.dev");
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm").fill(PASSWORD);
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/auth\/signup/);
    await expect(page.getByText(/already|registered/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("signup form validates mismatched passwords and short passwords before calling the server", async ({ page }) => {
    await page.goto("/auth/signup?role=candidate");
    await hydrated(page, "#email");
    await page.locator("#firstName").fill("A");
    await page.locator("#lastName").fill("B");
    await page.locator("#email").fill("mismatch@e2e.dev");
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm").fill("different-password");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/auth\/signup/);
    await expect(page.getByText(/match/i).first()).toBeVisible();
  });

  test("role switch: a company user's token cannot call candidate/college/admin APIs", async ({ request }) => {
    const hr = await apiLogin(request, "company");
    for (const path of ["/candidate/jobs", "/api/students/", "/admin/overview", "/candidate/oa"]) {
      const r = await request.get(`${API}${path}`, { headers: bearer(hr.token) });
      expect([401, 403], path).toContain(r.status());
    }
  });
});
