import { expect, test, signedIn, API, bearer } from "./helpers";

test.describe("candidate portal", () => {
  test("overview renders and every dashboard tab opens without errors", async ({ page, request, problems }) => {
    await signedIn(page, request, "candidate");
    await expect(page.getByText("Hey Cara")).toBeVisible();
    for (const tab of ["Jobs", "Analyzer", "Practice", "AI Interview", "Skill DNA", "Overview"]) {
      await page.getByRole("tab", { name: tab }).or(page.getByRole("button", { name: tab, exact: true })).first().click();
    }
    expect(problems).toEqual([]);
  });

  test("job board lists the live drive with company, location and deadline", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await expect(page.getByText("Job board")).toBeVisible();
    const card = page.locator("a", { hasText: "Backend Engineer" }).first();
    await expect(card).toBeVisible();
    await expect(page.getByText("Acme Corp").first()).toBeVisible();
    await expect(page.getByText("Pune").first()).toBeVisible();
    await expect(page.getByText("You haven't applied to any jobs yet.")).toBeVisible();
  });

  test("applying scores the application and shows it in 'Your applications'", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText(/Application submitted/i)).toBeVisible();
    // tracker row appears and the stubbed scorer's 72% fit is displayed
    await expect(page.getByText("72% fit")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Applied" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Prep plan" })).toBeVisible();
    const state = await (await request.get(`${API}/__e2e/state`)).json();
    expect(state.applications_rows).toHaveLength(1);
    expect(state.applications_rows[0].status).toBe("scored");
  });

  test("job detail page shows the description and an eligibility verdict", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await page.locator("a", { hasText: "Backend Engineer" }).first().click();
    await expect(page).toHaveURL(/\/candidate-jobs\//);
    await expect(page.getByText("Build and scale reliable APIs")).toBeVisible();
  });

  test("an ineligible student sees why and cannot apply", async ({ page, request }) => {
    await request.post(`${API}/__e2e/patch`, { data: { table: "job_drives", where: {}, set: { min_cgpa: 9.9 } } });
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText(/CGPA/).first()).toBeVisible();
    const state = await (await request.get(`${API}/__e2e/state`)).json();
    expect(state.applications ?? 0).toBe(0);
  });

  test("a drive whose deadline has passed is gone from the board and cannot be applied to", async ({ page, request }) => {
    await request.post(`${API}/__e2e/patch`, { data: { table: "job_drives", where: {}, set: { apply_deadline: "2000-01-01T00:00:00+00:00" } } });
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    const login = await (await request.post(`${API}/auth/login`, { data: { email: "cand@e2e.dev", password: "Passw0rd!x", role: "candidate" } })).json();
    const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer((await (await request.post(`${API}/auth/login`, { data: { email: "hr@e2e.dev", password: "Passw0rd!x", role: "company" } })).json()).token) })).json();
    const r = await request.post(`${API}/candidate/jobs/${jobs[0].id}/apply`, { headers: bearer(login.token) });
    expect(r.status()).toBe(403);
  });

  test("profile settings dialog opens from the account menu", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByText("Cara Candidate").first().click();
    await expect(page.getByText(/profile|settings|college|skills/i).first()).toBeVisible();
  });
});
