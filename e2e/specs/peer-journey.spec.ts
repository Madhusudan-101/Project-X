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

/** The dialog defaults to "Keep my identity private" ON; `share: true` switches it off first. */
async function findPartner(page: Page, ctx: BrowserContext, opts: { share?: boolean } = {}) {
  await page.getByText("Peer Interview", { exact: true }).first().click();
  if (opts.share) await page.getByText("Keep my identity private").click();
  const popup = ctx.waitForEvent("page", { timeout: 40_000 });
  await page.getByRole("button", { name: "Find a partner now" }).click();
  return popup;
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
    await expect(pb.getByText("Anonymous Candidate").first()).toBeVisible({ timeout: 40_000 });
    await expect(pb.getByText("Cara Candidate")).toHaveCount(0);
    await expect(pa.getByText("Dev Candidate").first()).toBeVisible({ timeout: 40_000 });
    await a.ctx.close(); await b.ctx.close();
  });

  test("a lone candidate waits in the queue and can cancel", async ({ browser, request }) => {
    const a = await candidate(browser, request, EMAIL.candidate);
    await a.page.getByText("Peer Interview", { exact: true }).first().click();
    await a.page.getByRole("button", { name: "Find a partner now" }).click();
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
});
