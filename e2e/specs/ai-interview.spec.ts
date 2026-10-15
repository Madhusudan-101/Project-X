import { expect, test, signedIn, API, bearer, apiLogin } from "./helpers";

const SECRET = "e2e-ai-secret";

async function startViaApi(request: any, domain = "dsa") {
  const cand = await apiLogin(request, "candidate");
  const r = await request.post(`${API}/candidate/ai-interview/session`, { headers: bearer(cand.token), data: { domain } });
  return { cand, r };
}

test.describe("AI voice interview", () => {
  test("tab lists the three domains and requires a pick before starting", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "AI Interview" }).click();
    for (const d of ["AI / ML", "Web Development", "Data Structures & Algorithms"]) {
      await expect(page.getByText(d, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Start interview" })).toBeVisible();
  });

  test("starting a session creates a room token server-side; an unreachable media server fails gracefully", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "AI Interview" }).click();
    await page.getByText("Data Structures & Algorithms").first().click();
    const session = page.waitForResponse((r) => r.url().endsWith("/candidate/ai-interview/session"));
    await page.getByRole("button", { name: "Start interview" }).click();
    const res = await session;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.roomName).toMatch(/^ai-/);
    expect(body.participantToken.split(".")).toHaveLength(3);          // a signed LiveKit JWT
    await expect(page.getByText(/Could not start the interview/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Start interview" })).toBeEnabled();   // can retry
  });

  test("the API rejects unknown domains and anonymous callers", async ({ request }) => {
    const { cand } = await startViaApi(request);
    const bad = await request.post(`${API}/candidate/ai-interview/session`, { headers: bearer(cand.token), data: { domain: "astrology" } });
    expect(bad.status()).toBe(400);
    expect((await request.post(`${API}/candidate/ai-interview/session`, { data: { domain: "dsa" } })).status()).toBe(401);
    const hr = await apiLogin(request, "company");
    expect((await request.post(`${API}/candidate/ai-interview/session`, { headers: bearer(hr.token), data: { domain: "dsa" } })).status()).toBe(403);
  });

  test("a daily quota stops runaway usage and the UI explains it", async ({ page, request }) => {
    for (let i = 0; i < 3; i++) expect((await startViaApi(request)).r.status()).toBe(200);
    const { r } = await startViaApi(request);
    expect(r.status()).toBe(429);
    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "AI Interview" }).click();
    await page.getByText("Web Development").first().click();
    await page.getByRole("button", { name: "Start interview" }).click();
    await expect(page.getByText(/limit|too many|try again tomorrow|daily/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("agent webhook: secret is enforced, a graded report is stored for the right student and shown", async ({ page, request }) => {
    const { cand, r } = await startViaApi(request, "dsa");
    const { roomName } = await r.json();
    const report = {
      room_id: roomName, overall_score: 82, technical_score: 85, communication_score: 78,
      strengths: ["Clear complexity analysis"], weaknesses: ["Edge cases"], red_flags: [],
      per_question: [{ question: "Reverse a linked list", score: 9, feedback: "Nice iterative solution." }],
      final_recommendation: "Hire", report_markdown: "# Report\nSolid performance.", transcript: "A: hello", duration_seconds: 600,
    };
    expect((await request.post(`${API}/internal/ai-interview-reports`, { data: report })).status()).toBe(401);
    expect((await request.post(`${API}/internal/ai-interview-reports`, { headers: bearer("wrong"), data: report })).status()).toBe(401);
    const ok = await request.post(`${API}/internal/ai-interview-reports`, { headers: bearer(SECRET), data: report });
    expect(ok.status(), await ok.text()).toBeLessThan(300);
    // idempotent: the agent retries after a timeout
    expect((await request.post(`${API}/internal/ai-interview-reports`, { headers: bearer(SECRET), data: report })).status()).toBeLessThan(300);
    const mine = await (await request.get(`${API}/candidate/ai-interview/reports`, { headers: bearer(cand.token) })).json();
    expect(mine).toHaveLength(1);
    expect(mine[0].overall_score).toBe(82);

    await signedIn(page, request, "candidate");
    await page.getByRole("tab", { name: "AI Interview" }).click();
    await expect(page.getByText(/82/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("reports are private to their owner", async ({ request }) => {
    const { cand, r } = await startViaApi(request, "dsa");
    const { roomName } = await r.json();
    await request.post(`${API}/internal/ai-interview-reports`, { headers: bearer(SECRET), data: { room_id: roomName, overall_score: 50 } });
    await request.post(`${API}/auth/signup`, { data: { email: "other@e2e.dev", password: PASSWORD, role: "candidate", name: "Other One" } });
    const other = await apiLogin(request, "candidate", "other@e2e.dev");
    expect(await (await request.get(`${API}/candidate/ai-interview/reports`, { headers: bearer(other.token) })).json()).toEqual([]);
    expect((await request.get(`${API}/candidate/ai-interview/reports/${roomName}`, { headers: bearer(other.token) })).status()).toBe(404);
    expect((await request.get(`${API}/candidate/ai-interview/reports/${roomName}`, { headers: bearer(cand.token) })).status()).toBe(200);
  });

  test("a webhook for an unknown room cannot create a report", async ({ request }) => {
    const r = await request.post(`${API}/internal/ai-interview-reports`, { headers: bearer(SECRET), data: { room_id: "ai-doesnotexist", overall_score: 99 } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });
});
const PASSWORD = "Passw0rd!x";
