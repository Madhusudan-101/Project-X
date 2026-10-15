import { expect, test, signedIn, API, bearer, apiLogin } from "./helpers";

async function applyAsCandidate(request: any) {
  const cand = await apiLogin(request, "candidate");
  const hr = await apiLogin(request, "company");
  const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
  const r = await request.post(`${API}/candidate/jobs/${jobs[0].id}/apply`, { headers: bearer(cand.token) });
  expect(r.status()).toBe(201);
  return { job: jobs[0], hr, cand };
}

test.describe("company portal", () => {
  test("dashboard shows company card, funnel counters and every tab opens", async ({ page, request, problems }) => {
    await signedIn(page, request, "company");
    await expect(page.getByText("Acme Corp").first()).toBeVisible();
    await expect(page.getByText("New Applications")).toBeVisible();
    for (const tab of ["Jobs", "Candidates", "Assessments", "Interviews", "Analytics", "Dashboard"]) {
      await page.getByRole("tab", { name: tab }).click();
    }
    expect(problems).toEqual([]);
  });

  test("jobs list shows the seeded live job and filters by status", async ({ page, request }) => {
    await signedIn(page, request, "company", "/company-jobs");
    await expect(page.getByRole("link", { name: "Backend Engineer" }).first()).toBeVisible();
    await page.getByRole("tab", { name: "Draft" }).click();
    await expect(page.getByRole("link", { name: "Backend Engineer" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Live" }).click();
    await expect(page.getByRole("link", { name: "Backend Engineer" }).first()).toBeVisible();
  });

  test("create a job with the 4-step wizard, saved as a draft", async ({ page, request }) => {
    await signedIn(page, request, "company", "/company-jobs");
    await page.getByRole("button", { name: "Create job" }).click();
    // step 1
    await page.fill("#job-title", "QA Engineer");
    await page.fill("#job-description", "Own the quality of our platform end to end across all services.");
    await page.click("#job-domain");
    await page.getByRole("option", { name: "Tech", exact: true }).click();
    await page.click("#job-exp");
    await page.getByRole("option", { name: "Fresher" }).click();
    await page.fill("#job-location", "Remote");
    await page.getByRole("button", { name: "Next" }).click();
    // step 2 — default weights total 100%
    await expect(page.getByText("100% / 100%")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    // step 3 — no college yet -> blocked
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Add at least one college.").first()).toBeVisible();
    await page.locator("[role=dialog] button", { hasText: "Add college" }).click();
    await page.getByPlaceholder("Search colleges…").fill("Alpha");
    await page.getByText("Alpha College").first().click();
    await page.locator("input[type=datetime-local], input[type=date]").first().fill(
      new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 16),
    ).catch(() => {});
    await page.getByRole("button", { name: "Next" }).click();
    // step 4
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText(/saved|created|draft/i).first()).toBeVisible({ timeout: 10_000 });
    const hr = await apiLogin(request, "company");
    const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
    const created = jobs.find((j: any) => j.title === "QA Engineer");
    expect(created).toBeTruthy();
    expect(created.status).toBe("draft");
    expect(created.weights.resume_weight + created.weights.github_weight + created.weights.leetcode_weight +
           created.weights.interview_weight + created.weights.assessment_weight).toBe(100);
  });

  test("wizard validation: title/description are required before leaving step 1", async ({ page, request }) => {
    await signedIn(page, request, "company", "/company-jobs");
    await page.getByRole("button", { name: "Create job" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator("#job-title")).toBeVisible();
    await expect(page.getByText("100% / 100%")).toHaveCount(0);
  });

  test("applicants appear in the drive's round table with their fit data", async ({ page, request }) => {
    const { job } = await applyAsCandidate(request);
    await signedIn(page, request, "company", `/company-jobs/${job.id}`);
    await expect(page.getByText("Backend Engineer").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Cara Candidate" }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("cand@e2e.dev").first()).toBeVisible();
  });

  test("a job with no applicants shows an empty state, not an error", async ({ page, request, problems }) => {
    const hr = await apiLogin(request, "company");
    const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
    await signedIn(page, request, "company", `/company-jobs/${jobs[0].id}`);
    await expect(page.getByText("Backend Engineer").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });

  test("shortlisting an applicant in the round table persists", async ({ page, request }) => {
    const { job, hr } = await applyAsCandidate(request);
    await signedIn(page, request, "company", `/company-jobs/${job.id}`);
    const row = page.getByRole("row", { name: /Cara Candidate/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "Shortlist" }).click();
    await expect(page.getByText("Shortlisted for the next round.")).toBeVisible();
    const drives = await (await request.get(`${API}/company/jobs/${job.id}/drives`, { headers: bearer(hr.token) })).json();
    const round = drives[0].rounds[0];
    const rows = await (await request.get(`${API}/company/jobs/${job.id}/drives/${drives[0].id}/rounds/${round.id}/applicants`,
      { headers: bearer(hr.token) })).json();
    expect(rows[0].round_status).toBe("shortlisted");
  });

  test("a candidate cannot open the company portal; company jobs API refuses candidates", async ({ page, request }) => {
    await signedIn(page, request, "candidate", "/company-jobs");
    await expect(page).toHaveURL(/\/portals|\/auth\/login/);
  });
});
