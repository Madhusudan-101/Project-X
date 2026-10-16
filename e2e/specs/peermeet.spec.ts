import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";

const PM = "http://127.0.0.1:5173";
const PM_SERVER = "http://127.0.0.1:5001";
// eslint-disable-next-line @typescript-eslint/no-require-imports
declare const require: (id: string) => any;

// Real WebRTC with Chromium's fake camera/microphone, two independent users.
const test = base.extend<{ alice: Page; bob: Page; newUser: () => Promise<Page> }>({
  newUser: async ({ browser }, use) => {
    const ctxs: BrowserContext[] = [];
    await use(async () => {
      const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
      ctxs.push(ctx);
      return ctx.newPage();
    });
    await Promise.all(ctxs.map((c) => c.close()));
  },
  alice: async ({ newUser }, use) => use(await newUser()),
  bob: async ({ newUser }, use) => use(await newUser()),
});

test.use({ launchOptions: {
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
} });

/** The "Get ready" screen: say Yes, wait for the camera and microphone check, click Ready. */
async function sayYes(page: Page) {
  await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await expect(page.getByText("You said Yes.")).toBeVisible();
  await expect(page.getByText("Camera and microphone are working.")).toBeVisible({ timeout: 15_000 });
}
async function passReady(page: Page) {
  await sayYes(page);
  await page.getByRole("button", { name: /^Ready/ }).click();
}

/** The person who started the meeting is shown the interview setup; most tests just want a plain call. */
async function skipSetup(page: Page) {
  const skip = page.getByRole("button", { name: "Skip (plain meeting)" });
  await skip.waitFor({ state: "visible", timeout: 20_000 });
  await skip.click();
}

async function createRoom(page: Page) {
  await page.goto(PM);
  await page.locator("#btn-create-meeting").click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f]+/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await passReady(page);
  await expect(page.getByText("Waiting for your partner to join…")).toBeVisible();
  return id;
}

async function openRoom(page: Page, id: string) {
  await page.goto(PM);
  await page.locator("#tab-join").click();
  await page.locator("#join-room-input").fill(id);
  await page.locator("#btn-join-meeting").click();
}
async function joinRoom(page: Page, id: string) {
  await openRoom(page, id);
  await passReady(page);
}

const remoteFrames = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("video")].filter((v) => v.srcObject && v.videoWidth > 0 && !v.muted).length);

/** Count the messages a page sent over its websocket whose text contains `needle`. */
function countSent(page: Page, needle: string) {
  const state = { n: 0 };
  page.on("websocket", (ws) => ws.on("framesent", (f) => { if (typeof f.payload === "string" && f.payload.includes(needle)) state.n += 1; }));
  return state;
}

test.describe("PeerMeet video interview room", () => {
  test("landing page offers create / join tabs", async ({ alice }) => {
    await alice.goto(PM);
    await expect(alice.getByText("Video Calls, Reimagined")).toBeVisible();
    await alice.locator("#tab-join").click();
    await expect(alice.locator("#join-room-input")).toBeVisible();
    await expect(alice.locator("#btn-join-meeting")).toBeVisible();
  });

  test("creating a room shows a shareable meeting id on the Ready screen and waits for a partner", async ({ alice }) => {
    const id = await createRoom(alice);
    await expect(alice.getByText(id).first()).toBeVisible();
    await expect(alice.getByRole("button", { name: /Ready\. Waiting for your partner/ })).toBeDisabled();
  });

  test("two users connect: both reach 'Connected' and receive the other's live video", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => remoteFrames(alice), { timeout: 25_000 }).toBeGreaterThan(0);
    await expect.poll(() => remoteFrames(bob), { timeout: 25_000 }).toBeGreaterThan(0);
  });

  test("the interview clock starts when the partner joins", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await alice.waitForTimeout(2500);
    await expect(alice.getByText(/^00:0[1-9]$|^00:[1-5]\d$/).first()).toBeVisible();
  });

  test("a third person cannot join a full room", async ({ alice, bob, newUser }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(bob.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    const carol = await newUser();
    await openRoom(carol, id);
    await expect(carol.getByText(/full|cannot join|already/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(carol.getByText("Connected")).toHaveCount(0);
  });

  test("joining a room that does not exist shows a clear error", async ({ bob }) => {
    await openRoom(bob, "does-not-exist");
    await expect(bob.getByText(/not found|doesn't exist|does not exist|invalid/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("mute / stop-video controls toggle their labels", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await skipSetup(alice);
    const btn = (t: string) => alice.locator("button", { hasText: new RegExp(`^${t}$`) });
    await btn("Mute").click();
    await expect(btn("Unmute")).toBeVisible();
    await btn("Unmute").click();
    await expect(btn("Mute")).toBeVisible();
    await btn("Stop Video").click();
    await expect(btn("Start Video")).toBeVisible();
  });

  test("leaving ends the call for the other participant", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await bob.getByRole("button", { name: "Leave meeting" }).click();
    // leaving asks first, then shows the "you left" page
    await expect(bob.getByRole("alertdialog", { name: "Leave this meeting?" })).toBeVisible();
    await bob.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(bob).toHaveURL(/\/left\//, { timeout: 10_000 });
    await expect(bob.getByText("You left the meeting")).toBeVisible();
    await expect(alice.getByText(/left|disconnected|waiting/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("the host sees the AI interview setup once the partner is in", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Interview Setup")).toBeVisible({ timeout: 20_000 });
    await expect(alice.getByText("Both participants will see that AI assistance is active.")).toBeVisible();
    await expect(alice.locator("#interview-domain option", { hasText: "System Design" })).toHaveCount(1);
    await expect(bob.getByText("Interview Setup")).toHaveCount(0);   // the guest never sees the setup
  });

  test("skipping setup gives a plain meeting with no AI disclosure", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await skipSetup(alice);
    await expect(alice.getByText("Interview Setup")).toHaveCount(0);
    await expect(alice.getByText(/AI assistance is active/)).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Leave" })).toBeEnabled();
  });

  test("starting an AI-assisted interview tells BOTH people their role and that AI assistance is active", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Interview Setup")).toBeVisible({ timeout: 20_000 });
    await alice.locator("#interview-domain").selectOption("DSA");
    await alice.getByRole("button", { name: "Start AI-assisted interview" }).click();
    await expect(alice.getByText("Interview Setup")).toHaveCount(0);
    for (const page of [alice, bob]) await expect(page.getByText(/AI assistance is active/)).toBeVisible({ timeout: 15_000 });
    await expect(alice.getByText(/You are the interviewer/).first()).toBeVisible();
    await expect(bob.getByText(/You are the candidate/)).toBeVisible();
    // only the person being interviewed gets the "answer out loud" note
    await expect(bob.getByRole("note")).toContainText("too short to judge");
    await expect(alice.getByRole("note")).toHaveCount(0);
  });

  test("a missing speech-to-text key degrades gracefully instead of breaking the call", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await skipSetup(alice);
    // captions live in the side panel
    await alice.getByRole("button", { name: "Open chat" }).click();
    await alice.getByRole("tab", { name: "Captions" }).click();
    await expect(alice.getByText("DEEPGRAM_API_KEY is not configured")).toBeVisible();
    await expect(alice.getByRole("button", { name: "Leave" })).toBeEnabled();
  });

  test("chat messages reach the other person, as plain text", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await skipSetup(alice);
    await alice.getByRole("button", { name: "Open chat" }).click();
    await bob.getByRole("button", { name: "Open chat" }).click();
    await alice.getByLabel("Message", { exact: true }).fill("<b>hello</b> there");
    await alice.getByRole("button", { name: "Send message" }).click();
    await expect(bob.getByText("<b>hello</b> there")).toBeVisible({ timeout: 10_000 });
    await expect(bob.locator("b", { hasText: "hello" })).toHaveCount(0);   // never rendered as markup
  });

  test("the people panel shows both participants, and Report appears once there are two", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await skipSetup(alice);
    await alice.getByRole("button", { name: "Show who is in the meeting" }).click();
    await expect(alice.getByText("(you)")).toBeVisible();
    await alice.getByRole("button", { name: "Report the other person" }).click();
    await expect(alice.getByRole("dialog", { name: /Report this person/ })).toBeVisible();
    await alice.getByLabel("Harassment or abuse").check();
    await alice.getByRole("button", { name: "Send report" }).click();
    // anonymous guests cannot be attributed, so they are told to report from the dashboard
    await expect(alice.getByRole("alert").filter({ hasText: /signed in/ })).toBeVisible({ timeout: 10_000 });
    // reporting did not end the call
    await expect(alice.getByRole("button", { name: "Leave meeting" })).toBeVisible();
  });

  test("a hostile link cannot smuggle in a strange room id", async ({ alice }) => {
    await alice.goto(`${PM}/?room=${encodeURIComponent("../../etc/passwd")}&init=1`);
    await alice.waitForTimeout(800);
    expect(new URL(alice.url()).pathname).toBe("/");  // ignored: no navigation into a room
    await expect(alice.getByText("Video Calls, Reimagined")).toBeVisible();
  });
});

test.describe("the Ready screen (before the call)", () => {
  test("shows your own preview, and Ready cannot be clicked until you say Yes", async ({ alice }) => {
    await alice.goto(PM);
    await alice.locator("#btn-create-meeting").click();
    await expect(alice.getByRole("heading", { name: "Get ready" })).toBeVisible();
    await expect(alice.getByText("This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?")).toBeVisible();
    await expect(alice.getByText(/Be kind and respectful/)).toBeVisible();
    await expect.poll(() => alice.evaluate(() => (document.querySelector("video") as HTMLVideoElement | null)?.videoWidth ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(alice.getByText("Camera and microphone are working.")).toBeVisible({ timeout: 15_000 });
    const ready = alice.getByRole("button", { name: /^Ready/ });
    await expect(ready).toBeDisabled();            // devices fine, but no Yes yet
    await alice.getByRole("button", { name: "Yes, continue" }).click();
    await expect(ready).toBeEnabled();
  });

  test("no video, no call: nothing is shared until BOTH people have clicked Ready", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await sayYes(bob);                                  // bob said Yes but is not ready yet
    await expect(alice.getByText("Your partner is getting ready.")).toBeVisible({ timeout: 15_000 });
    await alice.waitForTimeout(3000);
    await expect(alice.getByText("Connected")).toHaveCount(0);
    await expect(bob.getByText("Connected")).toHaveCount(0);
    expect(await remoteFrames(alice)).toBe(0);
    expect(await remoteFrames(bob)).toBe(0);
    await expect(alice.getByRole("button", { name: "Leave meeting" })).toHaveCount(0);   // still the Ready screen
    await bob.getByRole("button", { name: /^Ready/ }).click();
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
  });

  test("a double click on Ready sends it once", async ({ alice, bob }) => {
    const sent = countSent(bob, "precall:ready");   // before the page opens, so its websocket is seen
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await sayYes(bob);
    await bob.getByRole("button", { name: /^Ready/ }).dblclick();
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    expect(sent.n).toBe(1);
  });

  test("a refresh in the middle keeps your Yes, and you still have to click Ready again", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await sayYes(bob);
    await bob.reload();
    await expect(bob.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(bob.getByText("You said Yes.")).toBeVisible({ timeout: 15_000 });   // the server remembered it
    await expect(bob.getByText("Connected")).toHaveCount(0);
    await expect(bob.getByText("Camera and microphone are working.")).toBeVisible({ timeout: 15_000 });
    await bob.getByRole("button", { name: /^Ready/ }).click();
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
  });

  test("a refresh during the call goes straight back into it", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(bob.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await bob.reload();
    await expect(bob.getByRole("button", { name: "Leave meeting" })).toBeVisible({ timeout: 30_000 });
    await expect(bob.getByText("Connected").first()).toBeVisible({ timeout: 30_000 });
    await expect(bob.getByRole("heading", { name: "Get ready" })).toHaveCount(0);
  });

  test("when the partner leaves the Ready screen, you see it and can wait or leave", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await sayYes(bob);
    await expect(alice.getByText("Your partner is getting ready.")).toBeVisible({ timeout: 15_000 });
    await bob.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(alice.getByText("Waiting for your partner to join…")).toBeVisible({ timeout: 15_000 });
    await expect(alice.getByText("Connected")).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Leave", exact: true })).toBeVisible();
  });

  test("camera denied: a clear message, how to fix it, and Ready stays off", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    });
    const page = await ctx.newPage();
    await page.goto(PM);
    await page.locator("#btn-create-meeting").click();
    await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /blocking the camera or microphone/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Yes, continue" }).click();
    await expect(page.getByRole("button", { name: /^Ready/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await ctx.close();
  });

  test("a No cancels the session for both, and the partner is never told why", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await expect(bob.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    await expect(alice.getByText("Your partner is getting ready.")).toBeVisible({ timeout: 15_000 });
    await bob.getByRole("button", { name: "No, cancel the session" }).click();
    await expect(bob.getByRole("heading", { name: "Session cancelled" })).toBeVisible({ timeout: 10_000 });
    await expect(bob.getByText(/You chose not to continue/)).toBeVisible();
    await expect(alice.getByRole("heading", { name: "Session cancelled" })).toBeVisible({ timeout: 10_000 });
    await expect(alice.getByText(/cancelled before it started/)).toBeVisible();
    await expect(alice.getByText(/declin|refus|said no|chose not/i)).toHaveCount(0);
    await expect(alice.getByText("Connected")).toHaveCount(0);
    await expect(bob.getByText("Connected")).toHaveCount(0);
  });

  test("nobody clicking Ready ends the screen with a clear message (timeout)", async ({ alice, bob }) => {
    test.skip(!process.env.PRECALL_TIMEOUT_E2E, "needs PEERMEET_PRECALL_TIMEOUT_MS set low on the PeerMeet server");
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await expect(alice.getByRole("heading", { name: "Not ready in time" })).toBeVisible({ timeout: 60_000 });
  });

  test("calling the start endpoints directly without consent does nothing", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await openRoom(bob, id);
    await expect(bob.getByRole("heading", { name: "Get ready" })).toBeVisible({ timeout: 30_000 });
    // a third connection that hits the endpoints by hand (as a script would), in the same room, as nobody
    const { io } = require("../../PeerMeet/client/node_modules/socket.io-client");
    const s = io(PM_SERVER, { transports: ["websocket"], forceNew: true });
    const seen: string[] = [];
    for (const ev of ["interview:error", "interview:role", "interview:started", "transcription:error", "transcription:started", "ready", "room-full"]) s.on(ev, (p: any) => seen.push(`${ev}:${p?.reason ?? ""}`));
    await new Promise((r) => s.on("connect", r));
    s.emit("join-room", { roomId: id, participantId: "script-user-1" });
    await alice.waitForTimeout(500);
    s.emit("interview:configure", { roomId: id, config: { domain: "DSA", whoStarts: "interviewer" } });
    s.emit("interview:start", { roomId: id });
    s.emit("transcription:start", { roomId: id, mimeType: "audio/webm" });
    await alice.waitForTimeout(1500);
    s.close();
    expect(seen.some((x) => x.startsWith("interview:started") || x.startsWith("interview:role") || x.startsWith("transcription:started"))).toBe(false);
    await expect(alice.getByText("Interview Setup")).toHaveCount(0);
    await expect(alice.getByText(/AI assistance is active/)).toHaveCount(0);
  });
});
