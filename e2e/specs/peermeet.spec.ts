import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";

const PM = "http://127.0.0.1:5173";

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

/** The pre-join lobby: accept the rules, optionally opt in to captions + AI feedback, and join. */
async function passLobby(page: Page, ai = false) {
  await expect(page.getByRole("heading", { name: "Get ready to join" })).toBeVisible();
  await page.getByLabel(/I have read these rules/).check();
  if (ai) await page.getByLabel(/Turn on live captions and AI feedback/).check();
  await page.getByRole("button", { name: "Join meeting" }).click();
}

/** `ai` = this person opted in to live captions and AI feedback in the lobby. */
async function createRoom(page: Page, ai = false) {
  await page.goto(PM);
  await page.locator("#btn-create-meeting").click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f]+/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await passLobby(page, ai);
  await expect(page.getByText("Waiting for your interview partner…")).toBeVisible();
  return id;
}

async function joinRoom(page: Page, id: string, ai = false) {
  await page.goto(PM);
  await page.locator("#tab-join").click();
  await page.locator("#join-room-input").fill(id);
  await page.locator("#btn-join-meeting").click();
  await passLobby(page, ai);
}

const remoteFrames = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll("video")].filter((v) => v.srcObject && v.videoWidth > 0 && !v.muted).length);

test.describe("PeerMeet video interview room", () => {
  test("landing page offers create / join tabs", async ({ alice }) => {
    await alice.goto(PM);
    await expect(alice.getByText("Video Calls, Reimagined")).toBeVisible();
    await alice.locator("#tab-join").click();
    await expect(alice.locator("#join-room-input")).toBeVisible();
    await expect(alice.locator("#btn-join-meeting")).toBeVisible();
  });

  test("creating a room shows a shareable meeting id and waits for a partner", async ({ alice }) => {
    const id = await createRoom(alice);
    await expect(alice.getByText(id).first()).toBeVisible();
    await expect(alice.getByText("The room supports 2 participants")).toBeVisible();
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
    await joinRoom(carol, id);
    await expect(carol.getByText(/full|cannot join|already/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(carol.getByText("Connected")).toHaveCount(0);
  });

  test("joining a room that does not exist shows a clear error", async ({ bob }) => {
    await joinRoom(bob, "does-not-exist");
    await expect(bob.getByText(/not found|doesn't exist|does not exist|invalid/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("mute / stop-video controls toggle their labels", async ({ alice, bob }) => {
    const id = await createRoom(alice, true);
    await joinRoom(bob, id, true);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await alice.getByRole("button", { name: "Skip (plain meeting)" }).click();
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
    const id = await createRoom(alice, true);
    await joinRoom(bob, id, true);
    await expect(alice.getByText("Interview Setup")).toBeVisible({ timeout: 20_000 });
    await expect(alice.getByText("Both participants will see that AI assistance is active.")).toBeVisible();
    await expect(alice.locator("#interview-domain option", { hasText: "System Design" })).toHaveCount(1);
  });

  test("skipping setup gives a plain meeting with no AI disclosure", async ({ alice, bob }) => {
    const id = await createRoom(alice, true);
    await joinRoom(bob, id, true);
    await alice.getByRole("button", { name: "Skip (plain meeting)" }).click();
    await expect(alice.getByText("Interview Setup")).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Leave" })).toBeEnabled();
  });

  test("starting an AI-assisted interview discloses AI assistance to BOTH participants", async ({ alice, bob }) => {
    const id = await createRoom(alice, true);
    await joinRoom(bob, id, true);
    await expect(alice.getByText("Interview Setup")).toBeVisible({ timeout: 20_000 });
    await alice.locator("#interview-domain").selectOption("DSA");
    await alice.getByRole("button", { name: "Start AI-assisted interview" }).click();
    await expect(alice.getByText("Interview Setup")).toHaveCount(0);
    await expect(bob.getByText(/AI/).first()).toBeVisible({ timeout: 15_000 });
    await expect(alice.getByText(/AI/).first()).toBeVisible();
  });

  test("a missing speech-to-text key degrades gracefully instead of breaking the call", async ({ alice, bob }) => {
    const id = await createRoom(alice, true);
    await joinRoom(bob, id, true);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await alice.getByRole("button", { name: "Skip (plain meeting)" }).click();   // close the AI setup first
    // captions live in the side panel
    await alice.getByRole("button", { name: "Open chat" }).click();
    await alice.getByRole("tab", { name: "Captions" }).click();
    await expect(alice.getByText("DEEPGRAM_API_KEY is not configured")).toBeVisible();
    await expect(alice.getByRole("button", { name: "Leave" })).toBeEnabled();
  });

  test("the lobby shows a camera preview and cannot be skipped: nobody joins until they accept the rules", async ({ alice }) => {
    await alice.goto(PM);
    await alice.locator("#btn-create-meeting").click();
    await expect(alice.getByRole("heading", { name: "Get ready to join" })).toBeVisible();
    const join = alice.getByRole("button", { name: "Join meeting" });
    await expect(alice.locator("video").first()).toBeVisible();
    await expect.poll(() => alice.evaluate(() => (document.querySelector("video") as HTMLVideoElement | null)?.videoWidth ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(join).toBeDisabled(); // rules not yet accepted
    await alice.getByLabel(/I have read these rules/).check();
    await expect(join).toBeEnabled();
    await expect(alice.getByLabel(/Turn on live captions and AI feedback/)).not.toBeChecked(); // opt-in, never pre-ticked for anonymous visitors
  });

  test("without consent there are no captions and no AI interview for that person", async ({ alice, bob }) => {
    const id = await createRoom(alice, false);   // alice did not opt in
    await joinRoom(bob, id, true);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await expect(alice.getByText("Interview Setup")).toHaveCount(0);   // the host cannot start AI without consent
    await alice.getByRole("button", { name: "Open chat" }).click();
    await alice.getByRole("tab", { name: "Captions" }).click();
    await expect(alice.getByText(/Live captions are off for this meeting/)).toBeVisible();
  });

  test("chat messages reach the other person, as plain text", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await alice.getByRole("button", { name: "Open chat" }).click();
    await bob.getByRole("button", { name: "Open chat" }).click();
    await alice.getByLabel("Message", { exact: true }).fill("<b>hello</b> there");
    await alice.getByRole("button", { name: "Send message" }).click();
    await expect(bob.getByText("<b>hello</b> there")).toBeVisible({ timeout: 10_000 });
    await expect(bob.locator("b", { hasText: "hello" })).toHaveCount(0);   // never rendered as markup
  });

  test("the people panel shows both participants, and Report appears once there are two", async ({ alice, bob }) => {
    const id = await createRoom(alice);
    await expect(alice.getByRole("button", { name: "Report the other person" })).toHaveCount(0);
    await joinRoom(bob, id);
    await expect(alice.getByText("Connected").first()).toBeVisible({ timeout: 20_000 });
    await alice.getByRole("button", { name: "Show who is in the meeting" }).click();
    await expect(alice.getByText("(you)")).toBeVisible();
    await alice.getByRole("button", { name: "Report the other person" }).click();
    await expect(alice.getByRole("dialog", { name: /Report this person/ })).toBeVisible();
    await alice.getByLabel("Harassment or abuse").check();
    await alice.getByRole("button", { name: "Send report" }).click();
    // anonymous guests cannot be attributed, so they are told to report from the dashboard
    await expect(alice.getByRole("alert").filter({ hasText: /signed in/ })).toBeVisible({ timeout: 10_000 });
  });

  test("a hostile link cannot smuggle in a strange room id", async ({ alice }) => {
    await alice.goto(`${PM}/?room=${encodeURIComponent("../../etc/passwd")}&init=1`);
    await alice.waitForTimeout(800);
    expect(new URL(alice.url()).pathname).toBe("/");  // ignored: no navigation into a room
    await expect(alice.getByText("Video Calls, Reimagined")).toBeVisible();
  });
});
