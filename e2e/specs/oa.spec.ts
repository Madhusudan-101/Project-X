import { expect, test, signedIn, API, bearer, apiLogin, anyHydrated, type Page } from "./helpers";
import fs from "node:fs";
import path from "node:path";

const SOLUTIONS = path.resolve(__dirname, "../../backend/scripts/oa_import/solutions");
const solution = (slug: string) => fs.readFileSync(path.join(SOLUTIONS, `${slug}.py`), "utf8");

async function setup(request: any) {
  const cand = await apiLogin(request, "candidate");
  const hr = await apiLogin(request, "company");
  const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
  const app = await (await request.post(`${API}/candidate/jobs/${jobs[0].id}/apply`, { headers: bearer(cand.token) })).json();
  return { cand, hr, job: jobs[0], appId: app.id as string };
}

async function startTest(page: Page, request: any) {
  const { appId, ...rest } = await setup(request);
  await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
  const start = page.getByRole("button", { name: "Start assessment" });
  await expect(start).toBeDisabled();                       // consent is required first
  await page.getByRole("checkbox").click();
  await start.click();
  await expect(page.getByText("Section 1 of 3")).toBeVisible();
  await page.locator("select").first().selectOption("python");      // editor defaults to JavaScript
  return { appId, ...rest };
}

/** Replace the editor contents (CodeEditor is a textarea). */
async function typeCode(page: Page, code: string) {
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill(code);
}

test.describe("online assessment (candidate)", () => {
  test("overview describes the test, sections and rules before starting", async ({ page, request }) => {
    const { appId } = await setup(request);
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
    await expect(page.getByText("Online assessment").first()).toBeVisible();
    await expect(page.getByText("Backend Engineer — Online Assessment")).toBeVisible();
    await expect(page.getByText(/closes in/)).toBeVisible();
    await expect(page.getByText("This test contains 3 sections and 3 questions — 90 minutes in total.")).toBeVisible();
    await expect(page.getByText("Once you've moved past a section you will NOT be able to revisit it.")).toBeVisible();
    for (const t of ["Coding 1", "Coding 2", "Coding 3"]) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeDisabled();
    await page.getByRole("checkbox").click();
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeEnabled();
  });

  test("starting shows section 1 with a countdown and the real problem statement", async ({ page, request }) => {
    await startTest(page, request);
    await expect(page.getByText("Two Sum").first()).toBeVisible();
    await expect(page.getByText(/^1[45]:\d\d$/)).toBeVisible();
    await expect(page.getByText(/two numbers|indices/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit section" })).toBeVisible();
  });

  test("a correct solution passes Run and Submit (hidden tests included)", async ({ page, request }) => {
    await startTest(page, request);
    await typeCode(page, solution("two-sum"));
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText("Accepted").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3500);                     // server-side cooldown between runs
    const submitted = page.waitForResponse((r) => r.url().endsWith("/submit") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    expect((await submitted).status()).toBe(200);
    await expect(page.getByText(/Passed \d+\/\d+ tests/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("All tests passed!")).toBeVisible();
    await expect(page.getByText(/Best: \d+\/\d+ tests · 100\/100 pts/)).toBeVisible();
  });

  test("a wrong solution is graded 'Wrong answer' and scores less than full marks", async ({ page, request }) => {
    await startTest(page, request);
    await typeCode(page, "def two_sum(nums, target):\n    return [0, 0]\n");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Wrong answer").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Best: 0\/\d+ tests/)).toBeVisible();
  });

  test("hammering Run is throttled and the candidate is told to slow down", async ({ page, request }) => {
    await startTest(page, request);
    await typeCode(page, solution("two-sum"));
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText("Accepted").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText(/Slow down/i).first()).toBeVisible();
  });

  test("a syntax error is reported as a compile error, not a crash", async ({ page, request }) => {
    await startTest(page, request);
    await typeCode(page, "def two_sum(nums, target:\n  pass\n");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText(/compile error/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("a runtime exception is reported as a runtime error", async ({ page, request }) => {
    await startTest(page, request);
    await typeCode(page, "def two_sum(nums, target):\n    return 1 // 0\n");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText(/runtime error/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("an infinite loop is stopped by the time limit", async ({ page, request }) => {
    test.setTimeout(90_000);
    await startTest(page, request);
    await typeCode(page, "def two_sum(nums, target):\n    while True:\n        pass\n");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText(/time limit/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("answers autosave: reload mid-test restores the code and the section", async ({ page, request }) => {
    await startTest(page, request);
    const code = "def two_sum(nums, target):\n    return [1, 2]  # autosave-marker\n";
    await typeCode(page, code);
    await page.waitForTimeout(2500);                     // autosave debounce
    await page.reload();
    await anyHydrated(page);
    await expect(page.getByText("Section 1 of 3")).toBeVisible();
    await expect(page.locator("textarea").first()).toHaveValue(/autosave-marker/);
  });

  test("submitting a section is one-way and moves to the next section", async ({ page, request }) => {
    await startTest(page, request);
    await page.getByRole("button", { name: "Submit section" }).click();
    const confirm = page.getByRole("button", { name: /submit|confirm|yes/i }).last();
    if (await page.getByRole("alertdialog").isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByText("Section 2 of 3")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Coding 2").first()).toBeVisible();
  });

  test("the answer key / hidden tests never reach the browser", async ({ page, request }) => {
    const seen: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/candidate/oa/")) seen.push(await r.text().catch(() => ""));
    });
    await startTest(page, request);
    const all = seen.join("\n");
    expect(all).not.toContain("correct_option");
    expect(all).not.toContain('"is_visible":false');
  });

  test("before the window opens the candidate cannot start", async ({ page, request }) => {
    const { appId } = await setup(request);
    const soon = new Date(Date.now() + 36e5).toISOString();
    const later = new Date(Date.now() + 5 * 36e5).toISOString();
    await request.post(`${API}/__e2e/patch`, { data: { table: "job_drives", where: {}, set: { oa_window_start: soon, oa_window_end: later } } });
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
    await expect(page.getByText(/opens in|starts in|upcoming|not open/i).first()).toBeVisible();
    await expect(page.getByText("The assessment is open")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeDisabled();
  });

  test("after the window closes the assessment is closed", async ({ page, request }) => {
    const { appId } = await setup(request);
    await request.post(`${API}/__e2e/patch`, {
      data: { table: "job_drives", where: {}, set: { oa_window_start: "2000-01-01T00:00:00+00:00", oa_window_end: "2000-01-02T00:00:00+00:00" } } });
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
    await expect(page.getByText("The assessment is open")).toHaveCount(0);
    await expect(page.getByText(/closed|ended/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeDisabled();
  });

  test("another candidate cannot open someone else's assessment", async ({ page, request }) => {
    const { appId } = await setup(request);
    await request.post(`${API}/auth/signup`, { data: { email: "intruder@e2e.dev", password: "Passw0rd!x", role: "candidate", name: "Ian Intruder" } });
    const intruder = await apiLogin(request, "candidate", "intruder@e2e.dev");
    const r = await request.get(`${API}/candidate/oa/${appId}`, { headers: bearer(intruder.token) });
    expect(r.status()).toBe(404);
  });
});
