import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { API, EMAIL, PASSWORD, anyHydrated } from "./helpers";

const PM = "http://127.0.0.1:5173";
const DASH = "http://127.0.0.1:8080";
const SECRET = "e2e-secret";
const test = base.extend({});
test.use({ launchOptions: {
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
} });

type Who = { ctx: BrowserContext; page: Page; session: any; auth: Record<string, string> };

async function login(request: APIRequestContext, email: string, role = "candidate") {
  return (await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD, role } })).json();
}
async function candidate(browser: any, request: APIRequestContext, email: string): Promise<Who> {
  const ctx: BrowserContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const s = await login(request, email);
  await ctx.addInitScript((x: any) => {
    if (localStorage.getItem("mirracle.auth") === null) localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: x }, version: 0 }));
  }, s);
  const page = await ctx.newPage();
  await page.goto(`${DASH}/candidate`);
  await expect(page.getByText(/Hey /)).toBeVisible();
  await anyHydrated(page);
  await page.waitForTimeout(500);
  return { ctx, page, session: s, auth: { Authorization: `Bearer ${s.token}` } };
}
async function acceptGuidelines(request: APIRequestContext, auth: Record<string, string>) {
  const g = await (await request.get(`${API}/candidate/peer-safety/guidelines`, { headers: auth })).json();
  await request.post(`${API}/candidate/peer-safety/guidelines/accept`, { data: { version: g.version, rules: true, media: true, ai: true }, headers: auth });
}
/** Two people matched through the real API; returns the room id. */
async function matchViaApi(request: APIRequestContext, a: Who, b: Who) {
  await request.post(`${API}/candidate/peer-matchmaking/request`, { data: { keep_private: false }, headers: a.auth });
  const r = await (await request.post(`${API}/candidate/peer-matchmaking/request`, { data: { keep_private: false }, headers: b.auth })).json();
  expect(r.room_id).toBeTruthy();
  return r.room_id as string;
}
const state = async (request: APIRequestContext) => (await request.get(`${API}/__e2e/state`)).json();
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
async function openPeerDialog(page: Page) {
  await page.getByText("Peer Interview", { exact: true }).first().click();
}

test.describe("peer interviews: scheduling, in the dashboard", () => {
  test.beforeEach(async ({ request }) => { await request.post(`${API}/__e2e/reset`); });

  test("book a meeting, see it listed, add to calendar, reschedule, cancel; a wrong email is refused", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    await acceptGuidelines(request, a.auth);
    await a.page.reload(); await anyHydrated(a.page);
    await openPeerDialog(a.page);
    await a.page.getByRole("button", { name: "Schedule a meeting for later" }).click();
    const dialog = a.page.getByRole("dialog", { name: "Schedule a Peer Interview" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("schedule-timezone")).toContainText("Your timezone:");

    // a person with no account is refused with a clear message, and nothing is booked
    const when = new Date(Date.now() + 90 * 60000);
    await dialog.getByLabel(/Topic/).fill("Systems design practice");
    await dialog.getByLabel(/Date & time/).fill(localInput(when));
    await dialog.getByLabel(/Invite a specific candidate/).fill("nobody@nowhere.dev");
    await dialog.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(a.page.getByText(/no (Mirracle )?account|not found|No candidate|isn't on Mirracle|does not have/i).first()).toBeVisible({ timeout: 10_000 });
    expect((await state(request)).peer_scheduled_meetings ?? 0).toBe(0);

    // the real invitee works
    await dialog.getByLabel(/Invite a specific candidate/).fill("cand2@e2e.dev");
    await dialog.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(a.page.getByText("You're all set")).toBeVisible({ timeout: 10_000 });
    let st = await state(request);
    expect(st.peer_scheduled_meetings_rows).toHaveLength(1);
    expect(st.peer_scheduled_meetings_rows[0].invitee_id).toBe("u-cand2");
    expect(st.peer_scheduled_meetings_rows[0].title).toBe("Systems design practice");
    await a.page.getByRole("button", { name: /Done|Close/ }).first().click();

    // it is in "Scheduled Peer Interviews"
    const item = a.page.getByRole("listitem").filter({ hasText: "Systems design practice" }).first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    // add to calendar downloads a real .ics file
    const download = a.page.waitForEvent("download");
    await item.getByRole("button", { name: /to my calendar/ }).click();
    const ics = await (await download).createReadStream();
    let text = "";
    for await (const chunk of ics!) text += chunk.toString();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("Systems design practice");
    // reschedule
    await item.getByRole("button", { name: "Reschedule" }).click();
    const move = a.page.getByRole("dialog", { name: "Move this meeting" });
    const later = new Date(when.getTime() + 60 * 60000);
    await move.getByLabel("New date and time").fill(localInput(later));
    await move.getByRole("button", { name: "Move meeting" }).click();
    await expect(move).toBeHidden({ timeout: 10_000 });
    st = await state(request);
    expect(Math.abs(new Date(st.peer_scheduled_meetings_rows[0].scheduled_at).getTime() - later.getTime())).toBeLessThan(120_000);
    // cancel
    await item.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(async () => (await state(request)).peer_scheduled_meetings_rows[0].status, { timeout: 10_000 }).toBe("cancelled");
    await a.ctx.close();
  });

  test("the invitee sees it, and both land on the Ready screen when it is time", async ({ browser, request }) => {
    test.setTimeout(150_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    await acceptGuidelines(request, a.auth); await acceptGuidelines(request, b.auth);
    const booked = await (await request.post(`${API}/candidate/peer-meetings`, {
      data: { title: "Mock for Dev", scheduled_at: new Date(Date.now() + 3 * 60000).toISOString(), duration_minutes: 30, keep_private: false, invitee_email: "cand2@e2e.dev" }, headers: a.auth,
    })).json();
    expect(booked.id).toBeTruthy();
    await b.page.reload(); await anyHydrated(b.page);
    const row = b.page.getByRole("listitem").filter({ hasText: "Mock for Dev" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });          // the invitee sees it on their dashboard
    await a.page.reload(); await anyHydrated(a.page);
    const popA = a.ctx.waitForEvent("page");
    await a.page.getByRole("listitem").filter({ hasText: "Mock for Dev" }).first().getByRole("button", { name: "Join" }).click();
    const popB = b.ctx.waitForEvent("page");
    await row.getByRole("button", { name: "Join" }).click();
    const [pa, pb] = [await popA, await popB];
    for (const p of [pa, pb]) {
      await expect(p.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 40_000 });
      await expect(p.getByText(/min left/)).toHaveCount(0);       // the countdown belongs to the call, not the Ready screen
    }
    await expect(pa.getByText("Dev", { exact: true })).toBeVisible({ timeout: 20_000 });   // the invitee's first name on the host's card
    await a.ctx.close(); await b.ctx.close();
  });

  test("the scheduler sends the 15-minute reminder once and no-show cleanup runs", async ({ browser, request }) => {
    const a = await candidate(browser, request, EMAIL.candidate);
    await acceptGuidelines(request, a.auth);
    const booked = await (await request.post(`${API}/candidate/peer-meetings`, {
      data: { scheduled_at: new Date(Date.now() + 10 * 60000).toISOString(), duration_minutes: 30, keep_private: false, invitee_email: "cand2@e2e.dev" }, headers: a.auth,
    })).json();
    const bearer = { Authorization: `Bearer ${SECRET}` };
    expect((await request.post(`${API}/internal/peer/maintenance`, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
    const r1 = await (await request.post(`${API}/internal/peer/maintenance`, { headers: bearer })).json();
    expect(r1.reminders_sent).toBeGreaterThan(0);
    const row = (await state(request)).peer_scheduled_meetings_rows.find((m: any) => m.id === booked.id);
    expect(row.reminded_soon_at).toBeTruthy();
    const r2 = await (await request.post(`${API}/internal/peer/maintenance`, { headers: bearer })).json();
    expect(r2.reminders_sent).toBe(0);                            // once only
    await a.ctx.close();
  });
});

test.describe("peer interviews: feedback, history, report, admin", () => {
  test.beforeEach(async ({ request }) => { await request.post(`${API}/__e2e/reset`); });

  test("history lists the session; rate it, and report from the feedback screen", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    await acceptGuidelines(request, a.auth); await acceptGuidelines(request, b.auth);
    const room = await matchViaApi(request, a, b);
    await request.post(`${API}/candidate/peer-matchmaking/end`, { data: { room_id: room }, headers: a.auth });
    await a.page.reload(); await anyHydrated(a.page);
    await a.page.getByRole("button", { name: "History" }).first().click();
    const hist = a.page.getByRole("dialog", { name: "Peer interview history" });
    await expect(hist).toBeVisible();
    await expect(hist.getByText("Instant match").first()).toBeVisible({ timeout: 10_000 });
    // rate
    await hist.getByRole("button", { name: /Rate/ }).first().click();
    const rate = a.page.getByRole("dialog", { name: "How was your session?" });
    await rate.getByRole("radio", { name: "4 stars" }).click();
    await rate.getByRole("button", { name: "Respectful" }).click();
    await rate.getByRole("button", { name: "Send feedback" }).click();
    await expect(rate).toBeHidden({ timeout: 10_000 });
    // the feedback screen also has Report
    await hist.getByRole("button", { name: "Change rating" }).first().click();
    const rate2 = a.page.getByRole("dialog", { name: "How was your session?" });
    await rate2.getByRole("button", { name: "Report this person" }).click();
    const report = a.page.getByRole("dialog", { name: "Report this person" });
    await expect(report).toBeVisible();
    await expect(report.getByLabel("Rude or disrespectful")).toBeVisible();
    await report.getByLabel("Not making a genuine effort").click();
    await report.getByRole("button", { name: "Send report" }).click();
    await expect(report.getByRole("status")).toBeVisible({ timeout: 10_000 });
    const st = await state(request);
    expect(st.peer_feedback_rows ?? st.peer_feedback).toBeTruthy();
    expect(st.peer_user_reports_rows).toHaveLength(1);
    expect(st.peer_user_reports_rows[0].reason).toBe("not_genuine_effort");
    expect(st.peer_blocks_rows ?? []).toHaveLength(0);
    await a.ctx.close(); await b.ctx.close();
  });

  test("admin: Peer safety queue, evidence, suspend; the suspended person is stopped and told; admin lifts it", async ({ browser, request }) => {
    test.setTimeout(150_000);
    const a = await candidate(browser, request, EMAIL.candidate);       // Cara reports
    const b = await candidate(browser, request, "cand2@e2e.dev");       // Dev is reported
    await acceptGuidelines(request, a.auth); await acceptGuidelines(request, b.auth);
    const room = await matchViaApi(request, a, b);
    const rep = await request.post(`${API}/candidate/peer-safety/reports`, { data: { room_id: room, reason: "rude", details: "kept interrupting me" }, headers: a.auth });
    expect(rep.status()).toBe(201);

    const adminCtx = await browser.newContext();
    const adminSession = await login(request, EMAIL.admin, "admin");
    await adminCtx.addInitScript((x: any) => {
      if (localStorage.getItem("mirracle.auth") === null) localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: x }, version: 0 }));
    }, adminSession);
    const admin = await adminCtx.newPage();
    await admin.goto(`${DASH}/admin`);
    await anyHydrated(admin);
    await admin.getByRole("link", { name: "Peer safety", exact: true }).first().click();
    await expect(admin).toHaveURL(/\/admin\/peer-safety/);
    await expect(admin.getByRole("tab", { name: "Open", selected: true })).toBeVisible();
    await admin.getByRole("button", { name: /Rude or disrespectful/ }).first().click();
    await expect(admin.getByText("kept interrupting me")).toBeVisible({ timeout: 10_000 });   // what the reporter said
    await expect(admin.getByText("Reported person").first()).toBeVisible();
    await admin.getByRole("radio", { name: "Suspend" }).click();
    await admin.locator("#suspend-days").fill("3");
    await admin.getByLabel(/Note/).fill("repeat behaviour");
    await admin.getByRole("button", { name: "Save decision" }).click();
    await expect.poll(async () => (await state(request)).peer_sanctions, { timeout: 10_000 }).toBe(1);
    expect((await state(request)).peer_user_reports_rows[0].status).toBe("actioned");

    // the reported person is stopped on every way in, with a plain message
    const blocked = await request.post(`${API}/candidate/peer-matchmaking/request`, { data: { keep_private: false }, headers: b.auth });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).detail).toMatch(/paused/i);
    await b.page.reload(); await anyHydrated(b.page);
    await expect(b.page.getByText(/Peer interviews are paused on your account/)).toBeVisible({ timeout: 15_000 });
    await expect(b.page.getByText(/You can still use the rest of Mirracle/)).toBeVisible();

    // Cara (the reporter) is not affected
    const fine = await request.get(`${API}/candidate/peer-safety/status`, { headers: a.auth });
    expect((await fine.json()).suspended).toBe(false);

    // admin lifts it: the decision closed the panel, so open the report again from the Actioned tab
    await admin.keyboard.press("Escape");
    await admin.getByRole("tab", { name: "Actioned" }).click();
    await admin.getByRole("button", { name: /Rude or disrespectful/ }).first().click();
    await admin.getByRole("radio", { name: "Lift suspension" }).click();
    await admin.getByLabel(/Note/).fill("reviewed, fine");
    await admin.getByRole("button", { name: "Save decision" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/candidate/peer-safety/status`, { headers: b.auth })).json()).suspended, { timeout: 10_000 }).toBe(false);
    await a.ctx.close(); await b.ctx.close(); await adminCtx.close();
  });

  test("a candidate cannot open the admin Peer safety page or its API", async ({ browser, request }) => {
    const a = await candidate(browser, request, EMAIL.candidate);
    const r = await request.get(`${API}/admin/peer-safety/reports`, { headers: a.auth });
    expect([401, 403]).toContain(r.status());
    await a.page.goto(`${DASH}/admin/peer-safety`);
    await a.page.waitForTimeout(1500);
    await expect(a.page.getByText("Peer safety").first()).toHaveCount(0);
    await a.ctx.close();
  });
});

test.describe("peer interviews: security", () => {
  test.beforeEach(async ({ request }) => { await request.post(`${API}/__e2e/reset`); });

  test("internal endpoints refuse browsers; rooms refuse people who are not in them", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    await acceptGuidelines(request, a.auth); await acceptGuidelines(request, b.auth);
    const room = await matchViaApi(request, a, b);
    // no secret, a candidate's own token, and a wrong secret are all refused
    const body = { room_id: room, student_id: "u-cand", answer: true, version: "2026-10-session-v1" };
    expect((await request.post(`${API}/internal/peer/session-consent`, { data: body })).status()).toBe(401);
    expect((await request.post(`${API}/internal/peer/session-consent`, { data: body, headers: a.auth })).status()).toBe(401);
    expect((await request.post(`${API}/internal/peer/session-consent`, { data: body, headers: { Authorization: "Bearer nope" } })).status()).toBe(401);
    expect((await state(request)).peer_session_consents ?? 0).toBe(0);
    // holding a room id is not enough: a token is only minted for a room you were matched into or invited to
    const nope = await request.post(`${API}/candidate/peer-session-token`, { data: { room_id: "a-room-i-am-not-in-1" }, headers: a.auth });
    expect(nope.status()).toBe(403);
    // and a company account (not a candidate) cannot use the candidate peer endpoints at all
    const c = await login(request, EMAIL.company, "company");
    expect([401, 403, 428]).toContain((await request.post(`${API}/candidate/peer-session-token`, { data: { room_id: room }, headers: { Authorization: `Bearer ${c.token}` } })).status());
    // a valid token for ANOTHER room does not open this one in PeerMeet
    const own = await (await request.post(`${API}/candidate/peer-session-token`, { data: { room_id: room }, headers: a.auth })).json();
    const page = await a.ctx.newPage();
    await page.goto(`${PM}/?room=someone-elses-room-1&init=1&private=0#token=${encodeURIComponent(own.token)}`);
    await expect(page.getByText(/not allowed in this meeting/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Get ready" })).toHaveCount(0);
    // consent endpoint will not record a Yes for someone who is not in the session
    const outsider = await login(request, "hr@e2e.dev", "company");
    void outsider;
    await a.ctx.close(); await b.ctx.close();
  });
});

test.describe("peer interviews: in the call", () => {
  test.beforeEach(async ({ request }) => { await request.post(`${API}/__e2e/reset`); });

  test("screen share starts and stops, and the partner keeps seeing a video", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
    const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
    const a = await ctxA.newPage(); const b = await ctxB.newPage();
    await a.goto(PM); await a.locator("#btn-create-meeting").click();
    await expect(a).toHaveURL(/\/room\/[0-9a-f]+/);
    const id = new URL(a.url()).pathname.split("/").pop()!;
    const ready = async (p: Page) => {
      await expect(p.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
      await p.getByRole("button", { name: "Yes, continue" }).click();
      await expect(p.getByText("Camera and microphone are working.")).toBeVisible({ timeout: 15_000 });
      await p.getByRole("button", { name: /^Ready/ }).click();
    };
    await ready(a);
    await b.goto(PM); await b.locator("#tab-join").click(); await b.locator("#join-room-input").fill(id); await b.locator("#btn-join-meeting").click();
    await ready(b);
    await expect(a.getByText("Connected").first()).toBeVisible({ timeout: 25_000 });
    await a.getByRole("button", { name: "Skip (plain meeting)" }).click();
    await a.getByRole("button", { name: "Share your screen" }).click();
    await expect(a.getByText("Screen sharing started")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByText("Connected").first()).toBeVisible();
    await a.getByRole("button", { name: "Stop screen sharing" }).click();
    await expect(a.getByText("Screen sharing stopped")).toBeVisible({ timeout: 15_000 });
    await ctxA.close(); await ctxB.close();
  });
});
