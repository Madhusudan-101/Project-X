import { expect, test, signedIn, API, bearer, apiLogin, anyHydrated, type Page } from "./helpers";
import fs from "node:fs";
import path from "node:path";

const solution = (slug: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../backend/scripts/oa_import/solutions", `${slug}.py`), "utf8");

async function applied(request: any) {
  const cand = await apiLogin(request, "candidate");
  const hr = await apiLogin(request, "company");
  const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
  const app = await (await request.post(`${API}/candidate/jobs/${jobs[0].id}/apply`, { headers: bearer(cand.token) })).json();
  return { cand, hr, job: jobs[0], appId: app.id as string };
}

async function createFromTemplate(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).click();
  await expect(page.getByText("Assessment created. Now invite your applicants.")).toBeVisible();
}

test.describe("company: online-assessment management", () => {
  test("pick a template -> assessment with 3 timed coding sections is created", async ({ page, request }) => {
    const { job } = await applied(request);
    await signedIn(page, request, "company", `/company-jobs/${job.id}`);
    await expect(page.getByText("No assessment for this drive yet.")).toBeVisible();
    await createFromTemplate(page, /Coding rounds/);
    await expect(page.getByText("Coding rounds — Online Assessment")).toBeVisible();
    await expect(page.getByText("90 min total")).toBeVisible();
    for (const q of ["Two Sum", "Merge Intervals", "Course Schedule"]) await expect(page.getByText(q).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Invites (0)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Results (0)" })).toBeVisible();
  });

  test("an invited-only assessment is closed to applicants until the company invites them, then results flow back", async ({ page, request }) => {
    test.setTimeout(120_000);
    const { job, cand, hr, appId } = await applied(request);
    await signedIn(page, request, "company", `/company-jobs/${job.id}`);
    await createFromTemplate(page, /Coding rounds/);

    // not invited yet -> candidate cannot open it
    const before = await request.get(`${API}/candidate/oa/${appId}`, { headers: bearer(cand.token) });
    expect([403, 404, 409]).toContain(before.status());

    // invite through the UI
    await page.getByRole("tab", { name: /Invites/ }).click();
    await expect(page.getByText("Cara Candidate").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("checkbox").first().click();
    await page.getByRole("button", { name: /invite/i }).first().click();
    await expect(page.getByRole("tab", { name: "Invites (1)" })).toBeVisible({ timeout: 15_000 });

    const after = await request.get(`${API}/candidate/oa/${appId}`, { headers: bearer(cand.token) });
    expect(after.status()).toBe(200);
    expect((await after.json()).state).toBe("open");

    // candidate takes Q1 in the browser and solves it
    const candPage = await page.context().browser()!.newContext();
    const cp = await candPage.newPage();
    const session = cand;
    await cp.addInitScript((s) => localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: s }, version: 0 })), session);
    await cp.goto(`http://127.0.0.1:8080/candidate-oa/${appId}`);
    await anyHydrated(cp);
    await cp.getByRole("checkbox").click();
    await cp.getByRole("button", { name: "Start assessment" }).click();
    await expect(cp.getByText("Section 1 of 3")).toBeVisible();
    await cp.locator("select").first().selectOption("python");
    await cp.locator("textarea").first().fill(solution("two-sum"));
    await cp.waitForTimeout(1800);
    const sub = cp.waitForResponse((r) => r.url().endsWith("/submit"));
    await cp.getByRole("button", { name: "Submit", exact: true }).click();
    expect((await sub).status()).toBe(200);
    await expect(cp.getByText("All tests passed!")).toBeVisible();
    await candPage.close();

    // company results (API shape is the contract the Results tab renders)
    const results = await (await request.get(`${API}/company/jobs/${job.id}/drives/${(await (await request.get(`${API}/company/jobs/${job.id}/drives`, { headers: bearer(hr.token) })).json())[0].id}/assessment/results`, { headers: bearer(hr.token) })).json();
    expect(JSON.stringify(results)).toContain("Cara");
    await page.reload();
    await anyHydrated(page);
    await page.getByRole("tab", { name: /Results/ }).click();
    await expect(page.getByText("Cara Candidate").first()).toBeVisible({ timeout: 15_000 });
  });

  test("a company cannot see or edit another company's assessment", async ({ request }) => {
    const { job, hr } = await applied(request);
    const drives = await (await request.get(`${API}/company/jobs/${job.id}/drives`, { headers: bearer(hr.token) })).json();
    await request.post(`${API}/auth/company-signup`, { data: {
      email: "rival@e2e.dev", password: "Passw0rd!x", first_name: "Rae", last_name: "Rival", company_name: "Rival Inc", industry: "Software", size: "1-10" } });
    const rival = await apiLogin(request, "company", "rival@e2e.dev");
    for (const [m, p] of [["get", "assessment"], ["get", "assessment/results"], ["get", "assessment/invites"]] as const) {
      const r = await request[m](`${API}/company/jobs/${job.id}/drives/${drives[0].id}/${p}`, { headers: bearer(rival.token) });
      expect(r.status(), p).toBe(404);
    }
  });
});
