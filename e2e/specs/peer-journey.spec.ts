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

/** The pre-join lobby in the PeerMeet tab: accept the rules, optionally opt in to AI, join. */
async function passLobby(page: Page, ai = false) {
  await expect(page.getByRole("heading", { name: "Get ready to join" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/I have read these rules/).check();
  if (ai) await page.getByLabel(/Turn on live captions and AI feedback/).check(); else await page.getByLabel(/Turn on live captions and AI feedback/).uncheck();
  await page.getByRole("button", { name: "Join meeting" }).click();
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

/** Both people from the dashboard land in one room and pass the lobby. */
async function pairUp(a: any, b: any, opts: { share?: boolean } = {}) {
  const popA = await findPartner(a.page, a.ctx, opts);
  const popB = await findPartner(b.page, b.ctx, opts);
  const [pa, pb] = [await popA, await popB];
  await expect.poll(() => pa.url(), { timeout: 30_000 }).toMatch(/\/room\//);
  await expect.poll(() => pb.url(), { timeout: 30_000 }).toMatch(/\/room\//);
  await passLobby(pa);
  await passLobby(pb);
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
    await passLobby(pa);
    await passLobby(pb);
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
    await passLobby(pa);
    await passLobby(pb);
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
    await passLobby(pa);
    await passLobby(pb);
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

  test("reporting and blocking from inside the meeting: stored with evidence, and they are never matched again", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const a = await candidate(browser, request, EMAIL.candidate);
    const b = await candidate(browser, request, "cand2@e2e.dev");
    const { pa, pb } = await pairUp(a, b, { share: true });
    await expect(pa.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    await expect(pb.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });

    await pa.getByRole("button", { name: "Report the other person" }).click();
    await pa.getByLabel("Harassment or abuse").check();
    await pa.getByLabel(/Details/).fill("rude");
    await pa.getByRole("button", { name: "Send report" }).click();
    await expect(pa.getByRole("status").filter({ hasText: /sent to the Mirracle team/ })).toBeVisible({ timeout: 15_000 });

    const st = await (await request.get(`${API}/__e2e/state`)).json();
    expect(st.peer_user_reports_rows).toHaveLength(1);
    const row = st.peer_user_reports_rows[0];
    expect(row.source).toBe("meeting");
    expect(row.reason).toBe("harassment");
    expect(Array.isArray(row.evidence?.transcript)).toBe(true);
    expect(st.peer_blocks_rows).toHaveLength(1);                       // "also block" is on by default

    // after reporting the reporter leaves automatically; both leave the match
    await expect(pa).toHaveURL(/\/left\//, { timeout: 15_000 });
    await a.page.getByText("Peer Interview", { exact: true }).first().click().catch(() => {});
    await a.ctx.close(); await b.ctx.close();
  });
});
