import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { API, EMAIL, PASSWORD, anyHydrated } from "./helpers";

const test = base.extend({});
test.use({ launchOptions: {
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
} });

async function candidate(browser: any, request: any, email: string, session?: any) {
  const ctx: BrowserContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const s = await (await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD, role: "candidate" } })).json();
  await ctx.addInitScript((x: any) => {
    if (localStorage.getItem("mirracle.auth") === null) localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: x }, version: 0 }));
  }, s);
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:8080/candidate");
  await expect(page.getByText(/Hey /)).toBeVisible();
  await anyHydrated(page);
  await page.waitForTimeout(500);
  return { ctx, page, session: s };
}

/** First use: the server asks for the peer-interview guidelines before anything starts. Accept them. */
async function acceptGuidelines(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Peer interview guidelines" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel(/read the guidelines/).check();
  await dialog.getByLabel(/camera and microphone are shared/).check();
  await dialog.getByLabel(/live captions and AI feedback/).check();
  await dialog.getByRole("button", { name: /I agree, continue/ }).click();
  await expect(dialog).toBeHidden();
}

/** The "Get ready" screen in the PeerMeet tab: say Yes, wait for the device check, click Ready. */
async function sayYes(page: Page) {
  await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await expect(page.getByText("You said Yes.")).toBeVisible();
  await expect(page.getByText("Camera and microphone are working.")).toBeVisible({ timeout: 15_000 });
}
/** Whoever started the meeting is shown the interview setup. Returns [host, guest]. */
async function hostAndGuest(pa: Page, pb: Page): Promise<[Page, Page]> {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await pa.getByText("Interview Setup").isVisible().catch(() => false)) return [pa, pb];
    if (await pb.getByText("Interview Setup").isVisible().catch(() => false)) return [pb, pa];
    await pa.waitForTimeout(250);
  }
  throw new Error("nobody was shown the interview setup");
}
async function passReady(page: Page) {
  await sayYes(page);
  await page.getByRole("button", { name: /^Ready/ }).click();
}

/** The dialog defaults to "Keep my identity private" ON; `share: true` switches it off first. */
async function findPartner(page: Page, ctx: BrowserContext, opts: { share?: boolean; guidelines?: boolean } = {}) {
  await page.getByText("Peer Interview", { exact: true }).first().click();
  if (opts.share) await page.getByText("Keep my identity private").click();
  const popup = ctx.waitForEvent("page", { timeout: 60_000 });
  await page.getByRole("button", { name: "Find a partner now" }).click();
  if (opts.guidelines !== false) await acceptGuidelines(page);
  return popup;
}

/** Both people from the dashboard land in one room and pass the Ready screen. */
async function pairUp(a: any, b: any, opts: { share?: boolean } = {}) {
  const popA = await findPartner(a.page, a.ctx, opts);
  const popB = await findPartner(b.page, b.ctx, opts);
  const [pa, pb] = [await popA, await popB];
  await expect.poll(() => pa.url(), { timeout: 30_000 }).toMatch(/\/room\//);
  await expect.poll(() => pb.url(), { timeout: 30_000 }).toMatch(/\/room\//);
  await passReady(pa);
  await passReady(pb);
  return { pa, pb };
}

test.describe("dashboard peer-interview matchmaking -> PeerMeet room", () => {
  test.beforeEach(async ({ request }) => { await request.post(`${API}/__e2e/reset`); });

  test("two candidates are matched, land in the SAME PeerMeet room and see each other's video", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    const popA = await findPartner(a.page, a.ctx);                       // A waits in the queue
    const popB = await findPartner(b.page, b.ctx);                       // B claims A's ticket
    const [pa, pb] = [await popA, await popB];
    await expect.poll(() => pa.url(), { timeout: 30_000 }).toMatch(/\/room\//);
    await expect.poll(() => pb.url(), { timeout: 30_000 }).toMatch(/\/room\//);
    const room = (u: string) => new URL(u).pathname.split("/").pop();
    expect(room(pa.url())).toBe(room(pb.url()));
    await passReady(pa);
    await passReady(pb);
    await expect(pa.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    // identity token is stripped from the address bar (never left in history / Referer)
    expect(pa.url()).not.toContain("token=");
    expect(pb.url()).not.toContain("token=");
    await expect.poll(() => pa.evaluate(() => [...document.querySelectorAll("video")].filter((v) => v.videoWidth > 0).length), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await a.ctx.close(); await b.ctx.close();
  });

  test("peers see each other's real names (identity token verified by the PeerMeet server)", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    const popA = await findPartner(a.page, a.ctx, { share: true });
    const popB = await findPartner(b.page, b.ctx, { share: true });
    const [pa, pb] = [await popA, await popB];
    await passReady(pa);
    await passReady(pb);
    await expect(pa.getByText("Dev Candidate").first()).toBeVisible({ timeout: 40_000 });
    await expect(pb.getByText("Cara Candidate").first()).toBeVisible({ timeout: 40_000 });
    await a.ctx.close(); await b.ctx.close();
  });

  test("by default the peer is shown as 'Anonymous Candidate'; opting to share reveals the name", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);         // keeps the default (private)
    const b = await candidate(browser, request, "cand2@e2e.dev");         // shares their identity
    const popA = await findPartner(a.page, a.ctx);
    const popB = await findPartner(b.page, b.ctx, { share: true });
    const [pa, pb] = [await popA, await popB];
    await passReady(pa);
    await passReady(pb);
    await expect(pb.getByText("Anonymous Candidate").first()).toBeVisible({ timeout: 40_000 });
    await expect(pb.getByText("Cara Candidate")).toHaveCount(0);
    await expect(pa.getByText("Dev Candidate").first()).toBeVisible({ timeout: 40_000 });
    await a.ctx.close(); await b.ctx.close();
  });

  test("a lone candidate waits in the queue and can cancel", async ({ browser, request }) => {
    const a = await candidate(browser, request, EMAIL.candidate);
    await a.page.getByText("Peer Interview", { exact: true }).first().click();
    await a.page.getByRole("button", { name: "Find a partner now" }).click();
    await acceptGuidelines(a.page);
    const cancel = a.page.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeVisible({ timeout: 15_000 });
    expect((await (await request.get(`${API}/__e2e/state`)).json()).peer_matchmaking_tickets).toBe(1);
    await cancel.click();
    await expect.poll(async () => {
      const st = await (await request.get(`${API}/__e2e/state`)).json();
      return st.peer_matchmaking_tickets_rows?.[0]?.status;
    }, { timeout: 10_000 }).toBe("cancelled");
    await a.ctx.close();
  });

  test("the guidelines are asked once, and not again after they were accepted", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    await a.page.getByText("Peer Interview", { exact: true }).first().click();
    await a.page.getByRole("button", { name: "Find a partner now" }).click();
    await acceptGuidelines(a.page);
    const st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_consents_rows.length).toBe(1);
    // leave the queue, try again: no dialog this time
    await a.page.getByRole("button", { name: "Cancel" }).click();
    await a.page.getByRole("button", { name: "Find a partner now" }).click();
    await expect(a.page.getByRole("dialog", { name: "Peer interview guidelines" })).toHaveCount(0);
    await expect(a.page.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 15_000 });
    await a.ctx.close();
  });

  test("declining the guidelines starts nothing", async ({ browser, request }) => {
    const a = await candidate(browser, request, EMAIL.candidate);
    await a.page.getByText("Peer Interview", { exact: true }).first().click();
    await a.page.getByRole("button", { name: "Find a partner now" }).click();
    const dialog = a.page.getByRole("dialog", { name: "Peer interview guidelines" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: /I agree, continue/ })).toBeDisabled();   // all three statements are required
    await dialog.getByRole("button", { name: "Not now" }).click();
    const st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_matchmaking_tickets ?? 0).toBe(0);   // no ticket was ever created
    expect(st.peer_consents ?? 0).toBe(0);              // and nothing was recorded as accepted
    await a.ctx.close();
  });

  test("the Ready screen shows the partner's first name and college only (or nothing, if they are private)", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);         // Cara, CSE, Alpha College
    const b = await candidate(browser, request, "cand2@e2e.dev");         // Dev, IT, Alpha College
    const popA = await findPartner(a.page, a.ctx, { share: true });
    const popB = await findPartner(b.page, b.ctx);                        // Dev keeps the default: private
    const [pa, pb] = [await popA, await popB];
    await expect(pb.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByText("Cara", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(pb.getByText("Alpha College, CSE")).toBeVisible();
    await expect(pb.getByText("Candidate", { exact: true })).toHaveCount(0);    // no surname
    await expect(pa.getByText("They chose to keep their details private.")).toBeVisible({ timeout: 15_000 });
    await expect(pa.getByText("Dev", { exact: true })).toHaveCount(0);
    await expect(pa.getByText("Alpha College, IT")).toHaveCount(0);
    expect(await pa.content()).not.toContain("cand2@e2e.dev");
    await a.ctx.close(); await b.ctx.close();
  });

  test("full journey: match, Ready screen, consent, device check, both Ready, call starts, roles, AI notice, onboarding once, report", async ({ browser, request }) => {
    test.setTimeout(240_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    const popA = await findPartner(a.page, a.ctx, { share: true });
    const popB = await findPartner(b.page, b.ctx, { share: true });
    const [pa, pb] = [await popA, await popB];
    await expect.poll(() => pa.url(), { timeout: 30_000 }).toMatch(/\/room\//);

    // 1. both on the Ready screen: nothing starts yet
    await expect(pa.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(pa.getByRole("button", { name: /^Ready/ })).toBeDisabled();
    // 2. consent and device check, then Ready
    await sayYes(pa);
    await sayYes(pb);
    let st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_session_consents_rows).toHaveLength(2);                    // stored on the backend, one per person
    for (const row of st.peer_session_consents_rows) {
      expect(row.answer).toBe(true);
      expect(row.consent_version).toBeTruthy();
      expect(row.answered_at).toBeTruthy();
      expect(row.room_id).toBeTruthy();
    }
    await pa.getByRole("button", { name: /^Ready/ }).click();
    await expect(pb.getByText("Your partner is ready.")).toBeVisible({ timeout: 15_000 });
    await expect(pb.getByText("Connected")).toHaveCount(0);                   // one Ready is not enough
    await pb.getByRole("button", { name: /^Ready/ }).click();
    // 3. the call starts for both
    await expect(pa.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });

    // 4. the person who started sets the interview up
    const [host, guest] = await hostAndGuest(pa, pb);
    await expect(guest.getByText("Interview Setup")).toHaveCount(0);
    await host.getByRole("button", { name: "Start AI-assisted interview" }).click();
    // 5. roles and the AI notice, on both sides
    for (const page of [pa, pb]) await expect(page.getByText(/AI assistance is active/)).toBeVisible({ timeout: 15_000 });
    await expect(host.getByText(/You are the interviewer/).first()).toBeVisible();
    await expect(guest.getByText(/You are the candidate/)).toBeVisible();
    await expect(guest.getByRole("note")).toContainText("too short to judge");
    // 6. the interviewer's one-time message: shown, needs a click, saved for that person
    const onboarding = host.getByRole("dialog", { name: "You are the interviewer" });
    await expect(onboarding).toBeVisible({ timeout: 15_000 });
    await expect(onboarding).toContainText("guide, not a script");
    await expect(guest.getByRole("dialog", { name: "You are the interviewer" })).toHaveCount(0);
    await host.keyboard.press("Escape");
    await expect(onboarding).toBeVisible();                                  // Escape does not dismiss it
    st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_user_flags_rows ?? []).toHaveLength(0);                   // nothing saved until the click
    await onboarding.getByRole("button", { name: "Got it" }).click();
    await expect(onboarding).toHaveCount(0);
    await expect.poll(async () => (await (await request.get(`${API}/__e2e/state`)).json()).peer_user_flags_rows?.length, { timeout: 10_000 }).toBe(1);
    st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_user_flags_rows[0].interviewer_onboarding_seen_at).toBeTruthy();

    // 7. a report from inside the call does not end it
    await guest.getByRole("button", { name: "Report the other person" }).click();
    await guest.getByLabel("Rude or disrespectful").check();
    await guest.getByRole("button", { name: "Send report" }).click();
    await expect(guest.getByRole("status").filter({ hasText: /sent to the Mirracle team/ })).toBeVisible({ timeout: 15_000 });
    await guest.getByRole("dialog", { name: /Report this person/ }).getByRole("button", { name: "Close" }).last().click();
    await expect(guest.getByRole("button", { name: "Leave meeting" })).toBeVisible();
    await expect(guest.getByText("Connected").first()).toBeVisible();
    st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_user_reports_rows).toHaveLength(1);
    const row = st.peer_user_reports_rows[0];
    expect(row.reason).toBe("rude");
    expect(row.reporter_id).toBeTruthy(); expect(row.reported_id).toBeTruthy(); expect(row.room_id).toBeTruthy(); expect(row.created_at).toBeTruthy();
    expect(row.reporter_id).not.toBe(row.reported_id);
    expect(st.peer_blocks_rows ?? []).toHaveLength(0);                       // not blocked: only reported
    // ... and the reporter can leave without penalty
    await guest.getByRole("button", { name: "Leave meeting" }).click();
    await guest.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(guest).toHaveURL(/\/left\//, { timeout: 10_000 });
    st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_sanctions ?? 0).toBe(0);

    await a.ctx.close(); await b.ctx.close();
  });

  test("the interviewer's one-time message does not come back in a second session", async ({ browser, request }) => {
    test.setTimeout(300_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    async function session() {
      const popA = await findPartner(a.page, a.ctx, { share: true, guidelines: false });
      const popB = await findPartner(b.page, b.ctx, { share: true, guidelines: false });
      const [pa, pb] = [await popA, await popB];
      await passReady(pa);
      await passReady(pb);
      await expect(pa.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
      const [host] = await hostAndGuest(pa, pb);
      await host.getByRole("button", { name: "Start AI-assisted interview" }).click();
      return { pa, pb, host };
    }
    // first session: accept the dashboard guidelines once, then everything else as in the journey
    const popA1 = await findPartner(a.page, a.ctx, { share: true });
    const popB1 = await findPartner(b.page, b.ctx, { share: true });
    const [pa1, pb1] = [await popA1, await popB1];
    await passReady(pa1);
    await passReady(pb1);
    await expect(pa1.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    const [host1] = await hostAndGuest(pa1, pb1);
    await host1.getByRole("button", { name: "Start AI-assisted interview" }).click();
    const first = host1.getByRole("dialog", { name: "You are the interviewer" });
    await expect(first).toBeVisible({ timeout: 15_000 });
    await first.getByRole("button", { name: "Got it" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/__e2e/state`)).json()).peer_user_flags_rows?.length, { timeout: 10_000 }).toBe(1);

    // end that match from the dashboard's own "End session" button (it also asks the server to close it), then match again
    await pa1.close(); await pb1.close();
    for (const who of [a, b]) {
      await who.page.getByRole("button", { name: "End session" }).click();
      await expect(who.page.getByRole("button", { name: "End session" })).toHaveCount(0, { timeout: 10_000 });
      const feedback = who.page.getByRole("dialog", { name: "How was your session?" });
      if (await feedback.isVisible().catch(() => false)) await feedback.getByRole("button", { name: "Skip" }).click();
    }

    const second = await session();
    await expect(second.pa.getByText(/AI assistance is active/)).toBeVisible({ timeout: 15_000 });
    await expect(second.pb.getByText(/AI assistance is active/)).toBeVisible({ timeout: 15_000 });
    await second.host.waitForTimeout(3000);
    await expect(second.pa.getByRole("dialog", { name: "You are the interviewer" })).toHaveCount(0);
    await expect(second.pb.getByRole("dialog", { name: "You are the interviewer" })).toHaveCount(0);
    await a.ctx.close(); await b.ctx.close();
  });

  test("a No on the Ready screen is stored as No, cancels for both, and nothing is recorded", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    const popA = await findPartner(a.page, a.ctx, { share: true });
    const popB = await findPartner(b.page, b.ctx, { share: true });
    const [pa, pb] = [await popA, await popB];
    await expect(pa.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByText("Cara", { exact: true })).toBeVisible({ timeout: 15_000 });
    await pa.getByRole("button", { name: "No, cancel the session" }).click();
    await expect(pa.getByRole("heading", { name: "Session cancelled" })).toBeVisible({ timeout: 10_000 });
    await expect(pb.getByRole("heading", { name: "Session cancelled" })).toBeVisible({ timeout: 10_000 });
    await expect(pb.getByText(/declin|refus|said no|chose not/i)).toHaveCount(0);   // never says why
    const st = await (await request.get(`${API}/__e2e/state`)).json();
    const rows = st.peer_session_consents_rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toBe(false);
    await expect(pb.getByText("Connected")).toHaveCount(0);
    expect(st.peer_interview_reports_rows ?? []).toHaveLength(0);
    await a.ctx.close(); await b.ctx.close();
  });

  test("reporting with 'also block': stored with evidence, the reporter leaves, and they are never matched again", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    const { pa, pb } = await pairUp(a, b, { share: true });
    await expect(pa.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });

    await pa.getByRole("button", { name: "Report the other person" }).click();
    await pa.getByLabel("Harassment or abuse").check();
    await pa.getByLabel(/Details/).fill("rude");
    await expect(pa.getByLabel(/Also block this person/)).not.toBeChecked();      // a report alone never blocks
    await pa.getByLabel(/Also block this person/).check();
    await pa.getByRole("button", { name: "Send report" }).click();
    await expect(pa.getByRole("status").filter({ hasText: /sent to the Mirracle team/ })).toBeVisible({ timeout: 15_000 });

    const st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_user_reports_rows).toHaveLength(1);
    const row = st.peer_user_reports_rows[0];
    expect(row.source).toBe("meeting");
    expect(row.reason).toBe("harassment");
    expect(Array.isArray(row.evidence?.transcript)).toBe(true);
    expect(st.peer_blocks_rows).toHaveLength(1);

    // blocking is a choice to leave: the reporter is taken out of the meeting
    await expect(pa).toHaveURL(/\/left\//, { timeout: 15_000 });
    await a.ctx.close(); await b.ctx.close();
  });

  test("partner did not show: the waiting person marks it, it is stored as no_show with who was absent, and nobody is scored", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const a = await candidate(browser, request, EMAIL.candidate);         // Cara waits
    const b = await candidate(browser, request, "cand2@e2e.dev");         // Dev never comes
    const auth = { Authorization: `Bearer ${a.session.token}` };
    // Cara accepts the guidelines through the API and books a meeting with Dev that started 11 minutes ago
    await request.post(`${API}/candidate/peer-safety/guidelines/accept`, { data: { version: (await (await request.get(`${API}/candidate/peer-safety/guidelines`, { headers: auth })).json()).version, rules: true, media: true, ai: true }, headers: auth });
    const booked = await (await request.post(`${API}/candidate/peer-meetings`, {
      data: { scheduled_at: new Date(Date.now() + 5 * 60000).toISOString(), duration_minutes: 30, keep_private: false, invitee_email: "cand2@e2e.dev" }, headers: auth,
    })).json();
    expect(booked.id).toBeTruthy();
    await request.post(`${API}/__e2e/patch`, { data: { table: "peer_scheduled_meetings", where: { id: booked.id }, set: { scheduled_at: new Date(Date.now() - 11 * 60000).toISOString() } } });
    const join = await (await request.post(`${API}/candidate/peer-meetings/${booked.id}/join`, { headers: auth })).json();
    expect(join.token).toBeTruthy();

    // open PeerMeet the way the dashboard does
    const page = await a.ctx.newPage();
    const url = new URL("http://127.0.0.1:5173/");
    url.searchParams.set("room", join.room_id);
    url.searchParams.set("init", "1");
    url.searchParams.set("private", "0");
    url.searchParams.set("until", String(new Date(join.ends_at).getTime()));
    url.searchParams.set("start", String(new Date(join.starts_at).getTime()));
    url.hash = `token=${encodeURIComponent(join.token)}`;
    await page.goto(url.toString());
    await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Waiting for your partner to join…")).toBeVisible();
    await page.getByRole("button", { name: "Partner did not show" }).click();
    await expect(page.getByRole("heading", { name: "Marked as a no-show" })).toBeVisible({ timeout: 15_000 });

    const st = await (await request.get(`${API}/__e2e/state`)).json();
    const meeting = st.peer_scheduled_meetings_rows.find((m: any) => m.id === booked.id);
    expect(meeting.status).toBe("no_show");
    expect(meeting.absent_id).toBe("u-cand2");
    expect(st.peer_user_flags_rows.find((f: any) => f.student_id === "u-cand2").no_show_count).toBe(1);
    expect(st.peer_user_flags_rows.find((f: any) => f.student_id === "u-cand")).toBeUndefined();   // the waiting person is never marked
    expect(st.peer_interview_reports_rows ?? []).toHaveLength(0);                                    // no score, no feedback report
    expect(st.peer_sanctions ?? 0).toBe(0);                                                          // a count only: no punishment
    // the absent person (who has accepted the guidelines) cannot join it afterwards
    const authB = { Authorization: `Bearer ${b.session.token}` };
    await request.post(`${API}/candidate/peer-safety/guidelines/accept`, { data: { version: (await (await request.get(`${API}/candidate/peer-safety/guidelines`, { headers: authB })).json()).version, rules: true, media: true, ai: true }, headers: authB });
    const late = await request.post(`${API}/candidate/peer-meetings/${booked.id}/join`, { headers: { Authorization: `Bearer ${b.session.token}` } });
    expect(late.status()).toBe(410);
    await a.ctx.close(); await b.ctx.close();
  });

  test("partner did not show is not offered before the grace window", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const auth = { Authorization: `Bearer ${a.session.token}` };
    await request.post(`${API}/candidate/peer-safety/guidelines/accept`, { data: { version: (await (await request.get(`${API}/candidate/peer-safety/guidelines`, { headers: auth })).json()).version, rules: true, media: true, ai: true }, headers: auth });
    const booked = await (await request.post(`${API}/candidate/peer-meetings`, {
      data: { scheduled_at: new Date(Date.now() + 5 * 60000).toISOString(), duration_minutes: 30, keep_private: false, invitee_email: "cand2@e2e.dev" }, headers: auth,
    })).json();
    await request.post(`${API}/__e2e/patch`, { data: { table: "peer_scheduled_meetings", where: { id: booked.id }, set: { scheduled_at: new Date(Date.now() - 3 * 60000).toISOString() } } });
    const join = await (await request.post(`${API}/candidate/peer-meetings/${booked.id}/join`, { headers: auth })).json();
    const page = await a.ctx.newPage();
    const url = new URL("http://127.0.0.1:5173/");
    url.searchParams.set("room", join.room_id); url.searchParams.set("init", "1"); url.searchParams.set("private", "0");
    url.searchParams.set("until", String(new Date(join.ends_at).getTime())); url.searchParams.set("start", String(new Date(join.starts_at).getTime()));
    url.hash = `token=${encodeURIComponent(join.token)}`;
    await page.goto(url.toString());
    await expect(page.getByText("Waiting for your partner to join…")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Partner did not show" })).toHaveCount(0);
    await a.ctx.close();
  });
});
