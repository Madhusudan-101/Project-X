import { chromium } from "@playwright/test";
import { expect, test, signedIn, API, bearer, apiLogin, anyHydrated, type Page } from "./helpers";
import type { BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The newer OA features in a real browser, following the manual test workflow:
 * Java / C++ in the editor, camera consent + snapshots, the integrity event log,
 * and the similarity check. Real Chromium, real UI, real FastAPI; only Supabase,
 * Storage and the camera hardware (Chromium's fake device) are stand-ins.
 */

const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WEB = "http://127.0.0.1:8080";
const solution = (slug: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../backend/scripts/oa_import/solutions", `${slug}.py`), "utf8");

const JAVA_TWO_SUM = `import java.util.*;
class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            if (seen.containsKey(target - nums[i])) return new int[]{seen.get(target - nums[i]), i};
            seen.put(nums[i], i);
        }
        return new int[0];
    }
}
`;
const CPP_TWO_SUM = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};
            seen[nums[i]] = i;
        }
        return {};
    }
};
`;

type Session = { token: string; refreshToken: string; user: Record<string, any> };

/** Company creates the assessment (as the builder would) and returns everything a test needs. */
async function world(request: any, webcam: "off" | "optional" | "required") {
  const hr = await apiLogin(request, "company");
  const cand = await apiLogin(request, "candidate");
  const cand2 = await apiLogin(request, "candidate", "cand2@e2e.dev");
  const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
  const job = jobs[0];
  const drive = (await (await request.get(`${API}/company/jobs/${job.id}/drives`, { headers: bearer(hr.token) })).json())[0];
  const base = `${API}/company/jobs/${job.id}/drives/${drive.id}/assessment`;
  const put = await request.put(base, {
    headers: bearer(hr.token),
    data: { title: "Features OA", invite_mode: "all", template: "coding", webcam_mode: webcam },
  });
  expect(put.ok(), await put.text()).toBeTruthy();
  const apply = async (s: Session) =>
    (await (await request.post(`${API}/candidate/jobs/${job.id}/apply`, { headers: bearer(s.token) })).json()).id as string;
  return { hr, cand, cand2, job, drive, base, apply };
}

async function open(browserCtx: BrowserContext, session: Session, url: string): Promise<Page> {
  const page = await browserCtx.newPage();
  await page.addInitScript((s) => {
    if (localStorage.getItem("mirracle.auth") === null)
      localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: s }, version: 0 }));
  }, session);
  await page.goto(`${WEB}${url}`);
  await anyHydrated(page);
  return page;
}

const honesty = (p: Page) => p.getByRole("checkbox", { name: /I have read the instructions/ });
const cameraBox = (p: Page) => p.getByRole("checkbox", { name: /Camera monitoring/ });

// Chromium's fake camera + auto-granted permission for the whole file (Playwright only allows this at top level).
test.use({
  launchOptions: {
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["camera"],
});

test.describe("camera snapshots (fake camera granted)", () => {
  test("required camera: cannot start without consent; with it, photos are taken and the recruiter sees them", async ({ page, request, browser }) => {
    test.setTimeout(120_000);
    const w = await world(request, "required");
    const appId = await w.apply(w.cand);
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);

    // 1. the instructions page asks for consent, and "required" really blocks starting
    await expect(cameraBox(page)).toBeVisible();
    await expect(page.getByText(/Camera monitoring \(required\)/)).toBeVisible();
    const start = page.getByRole("button", { name: "Start assessment" });
    await honesty(page).click();
    await expect(start).toBeDisabled();
    await expect(page.getByText(/needs camera monitoring/)).toBeVisible();
    await cameraBox(page).click();
    await expect(start).toBeEnabled();

    // 2. start: self-view + indicator, and the first snapshot goes out within seconds
    const firstSnapshot = page.waitForResponse((r) => r.url().endsWith("/snapshots") && r.request().method() === "POST", { timeout: 30_000 });
    await start.click();
    await expect(page.getByText("Section 1 of 3")).toBeVisible();
    await expect(page.getByText("Camera on")).toBeVisible({ timeout: 15_000 });
    const resp = await firstSnapshot;
    expect(resp.status()).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, stored: true });

    // 3. the recruiter's API shows the photo with a signed URL that serves a real JPEG
    const gallery = await (await request.get(`${w.base}/results/${appId}/snapshots`, { headers: bearer(w.hr.token) })).json();
    expect(gallery.mode).toBe("required");
    expect(gallery.items.length).toBeGreaterThanOrEqual(1);
    const img = await request.get(gallery.items[0].url);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toBe("image/jpeg");
    expect((await img.body()).subarray(0, 3).toString("hex")).toBe("ffd8ff");

    // 4. the recruiter's UI: Results -> candidate -> Camera snapshots with thumbnails
    const hrPage = await open(await browser.newContext(), w.hr, `/company-jobs/${w.job.id}`);   // own browser profile: never share the candidate's login
    await hrPage.getByRole("tab", { name: /Results/ }).click();
    await hrPage.getByText("Cara Candidate").first().click();
    await expect(hrPage.getByRole("heading", { name: "Camera snapshots" })).toBeVisible({ timeout: 15_000 });
    await expect(hrPage.locator('img[alt^="Camera at"]').first()).toBeVisible({ timeout: 15_000 });
    expect(await hrPage.locator('img[alt^="Camera at"]').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await expect(hrPage.getByText(/\d+ photos?/).first()).toBeVisible();
  });

  test("optional camera: a candidate who declines is never photographed", async ({ page, request }) => {
    const w = await world(request, "optional");
    const appId = await w.apply(w.cand);
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
    await expect(page.getByText(/Camera monitoring \(optional\)/)).toBeVisible();
    await honesty(page).click();
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeEnabled();   // camera box left unticked
    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByText("Section 1 of 3")).toBeVisible();
    await expect(page.getByText("Camera on")).toHaveCount(0);
    // a browser that tries anyway is refused by the server
    const q = (await (await request.get(`${API}/candidate/oa/${appId}/session`, { headers: bearer(w.cand.token) })).json()).section.questions[0].id;
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]).toString("base64");
    const r = await request.post(`${API}/candidate/oa/${appId}/snapshots`, { headers: bearer(w.cand.token), data: { image: jpeg, question_id: q } });
    expect(r.status()).toBe(403);
    const gallery = await (await request.get(`${w.base}/results/${appId}/snapshots`, { headers: bearer(w.hr.token) })).json();
    expect(gallery.items).toEqual([]);
    expect(gallery.consented_at).toBeNull();
  });

  test("camera off in the builder: no consent box at all", async ({ page, request }) => {
    const w = await world(request, "off");
    const appId = await w.apply(w.cand);
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
    await expect(page.getByRole("button", { name: "Start assessment" })).toBeDisabled();
    await expect(cameraBox(page)).toHaveCount(0);
  });
});

test.describe("company builder", () => {
  test("the recruiter switches camera monitoring to Required in the builder and it is saved", async ({ page, request }) => {
    test.setTimeout(90_000);
    const hr = await apiLogin(request, "company");
    const jobs = await (await request.get(`${API}/company/jobs`, { headers: bearer(hr.token) })).json();
    const drive = (await (await request.get(`${API}/company/jobs/${jobs[0].id}/drives`, { headers: bearer(hr.token) })).json())[0];
    await signedIn(page, request, "company", `/company-jobs/${jobs[0].id}`);
    await page.getByRole("button", { name: /Coding rounds/ }).click();
    await expect(page.getByText("Assessment created. Now invite your applicants.")).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).last().click();      // the first "Edit" edits the job itself
    await expect(page.getByRole("heading", { name: "Edit assessment" })).toBeVisible();
    const select = page.getByLabel("Camera monitoring");
    await expect(select).toHaveValue("off");                       // default
    await select.selectOption("required");
    await page.getByRole("button", { name: "Save assessment" }).click();
    await expect(page.getByRole("heading", { name: "Edit assessment" })).toBeHidden({ timeout: 15_000 });

    const saved = await (await request.get(`${API}/company/jobs/${jobs[0].id}/drives/${drive.id}/assessment`, { headers: bearer(hr.token) })).json();
    expect(saved.webcam_mode).toBe("required");
    expect(saved.sections.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe("camera blocked", () => {
  // No fake-UI flag and no granted permission: getUserMedia is refused.
  test("required camera denied mid-test: a blocking screen, and the timeline records it", async ({ request }) => {
    test.setTimeout(90_000);
    const w = await world(request, "required");
    const appId = await w.apply(w.cand);
    const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
    const ctx = await browser.newContext();
    try {
      const page = await open(ctx, w.cand, `/candidate-oa/${appId}`);
      await honesty(page).click();
      await cameraBox(page).click();
      await page.getByRole("button", { name: "Start assessment" }).click();
      await expect(page.getByRole("alertdialog", { name: "Camera required" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Camera access is required")).toBeVisible();
      // the denial is on the recruiter's timeline
      await expect.poll(async () => {
        const d = await (await request.get(`${w.base}/results/${appId}`, { headers: bearer(w.hr.token) })).json();
        return d.events.counts.camera_denied ?? 0;
      }, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    } finally {
      await browser.close();
    }
  });
});

test.describe("languages and integrity log", () => {
  async function started(page: Page, request: any, webcam: "off" | "optional" | "required" = "off") {
    const w = await world(request, webcam);
    const appId = await w.apply(w.cand);
    await signedIn(page, request, "candidate", `/candidate-oa/${appId}`);
    await honesty(page).click();
    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByText("Section 1 of 3")).toBeVisible();
    return { ...w, appId };
  }

  test("the editor offers Python, JavaScript, Java and C++, each with typed starter code", async ({ page, request }) => {
    await started(page, request);
    const lang = page.locator("select").first();
    await expect(lang.locator("option")).toHaveText(["JavaScript", "Python 3", "Java", "C++"].map((t) => t) as any, { useInnerText: true }).catch(async () => {
      // option order is the server's; assert the set instead
      const labels = await lang.locator("option").allTextContents();
      expect(labels.sort()).toEqual(["C++", "Java", "JavaScript", "Python 3"]);
    });
    const ta = page.locator("textarea").first();
    await lang.selectOption("java");
    await expect(ta).toHaveValue(/class Solution[\s\S]*public int\[\] twoSum\(int\[\] nums, int target\)/);
    await lang.selectOption("cpp");
    await expect(ta).toHaveValue(/vector<int> twoSum\(vector<int>& nums, int target\)/);
  });

  test("a Java and a C++ solution are graded by the real judge; a Java syntax error names its line", async ({ page, request }) => {
    test.setTimeout(150_000);
    await started(page, request);
    const lang = page.locator("select").first();
    const ta = page.locator("textarea").first();
    const run = page.getByRole("button", { name: "Run", exact: true });

    await lang.selectOption("java");
    await ta.fill(JAVA_TWO_SUM);
    await run.click();
    await expect(page.getByText("Accepted").first()).toBeVisible({ timeout: 60_000 });

    await page.waitForTimeout(3500);                      // server-side cooldown between runs
    await lang.selectOption("cpp");
    await ta.fill(CPP_TWO_SUM);
    await run.click();
    await expect(page.getByText("Accepted").first()).toBeVisible({ timeout: 60_000 });

    await page.waitForTimeout(3500);
    await lang.selectOption("java");
    await ta.fill(JAVA_TWO_SUM.replace("return new int[0];", "return new int[0]"));
    await run.click();
    await expect(page.getByText(/Line \d+:.*expected/).first()).toBeVisible({ timeout: 60_000 });

    await page.waitForTimeout(3500);
    const submitted = page.waitForResponse((r) => r.url().endsWith("/submit") && r.request().method() === "POST");
    await ta.fill(JAVA_TWO_SUM);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    expect((await submitted).status()).toBe(200);
    await expect(page.getByText("All tests passed!")).toBeVisible({ timeout: 60_000 });
  });

  test("tab switch, fullscreen exit, paste and copy land on the recruiter's timeline with what was pasted", async ({ page, request, browser }) => {
    test.setTimeout(120_000);
    const w = await started(page, request);
    const ta = page.locator("textarea").first();
    const posted = () => page.waitForResponse((r) => r.url().endsWith("/events") && r.request().method() === "POST");

    // paste a long block into the editor
    const BIG = "def helper(x):\n    return x * 2\n".repeat(20);
    const p1 = posted();
    await ta.focus();
    await page.evaluate((text) => {
      const el = document.querySelector("textarea")!;
      const dt = new DataTransfer();
      dt.setData("text", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, BIG);
    await p1;

    // leave the tab and come back
    const p2 = posted();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p2;
    await page.waitForTimeout(1200);
    const p3 = posted();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p3;

    // copy a bit of the problem statement
    const p4 = posted();
    await page.evaluate(() => {
      const h = document.querySelector("h2")!;
      const range = document.createRange();
      range.selectNodeContents(h);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
    });
    await p4;

    // what the server stored
    const detail = await (await request.get(`${w.base}/results/${w.appId}`, { headers: bearer(w.hr.token) })).json();
    const types = detail.events.items.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["paste", "tab_switch", "tab_return", "copy"]));
    const paste = detail.events.items.find((e: any) => e.type === "paste");
    expect(paste.detail.length).toBe(BIG.length);
    expect(paste.detail.text).toBe(BIG);
    expect(paste.question.title).toBe("Two Sum");
    expect(detail.events.items.find((e: any) => e.type === "tab_return").detail.away_ms).toBeGreaterThan(900);
    expect(detail.events.largest_paste).toBe(BIG.length);

    // the recruiter's UI
    const hrPage = await open(await browser.newContext(), w.hr, `/company-jobs/${w.job.id}`);
    await hrPage.getByRole("tab", { name: /Results/ }).click();
    await hrPage.getByText("Cara Candidate").first().click();
    await expect(hrPage.getByRole("heading", { name: "Activity timeline" })).toBeVisible({ timeout: 15_000 });
    await expect(hrPage.getByText(/1 large paste/)).toBeVisible();
    await expect(hrPage.getByText("Left the tab", { exact: true })).toBeVisible();
    await expect(hrPage.getByText("Back on the tab", { exact: true })).toBeVisible();
    await expect(hrPage.getByText("Pasted", { exact: true })).toBeVisible();
    await hrPage.getByRole("button", { name: "show" }).first().click();
    await expect(hrPage.locator("pre").filter({ hasText: "def helper(x):" }).first()).toBeVisible();
  });
});

test.describe("similarity check", () => {
  test("two candidates with the same solution (variables renamed) are flagged; a different solution is not", async ({ request, browser }) => {
    test.setTimeout(150_000);
    const w = await world(request, "off");
    const a1 = await w.apply(w.cand);
    const a2 = await w.apply(w.cand2);
    const original = solution("two-sum");
    const renamed = original.replace(/\bseen\b/g, "cache").replace(/\bnums\b/g, "arr").replace(/\btarget\b/g, "goal");
    expect(renamed).not.toBe(original);

    const submit = async (s: Session, appId: string, code: string, lang = "python") => {
      const sess = await (await request.post(`${API}/candidate/oa/${appId}/start`, { headers: bearer(s.token), data: {} })).json();
      const qid = sess.section.questions[0].id;
      const r = await request.post(`${API}/candidate/oa/${appId}/questions/${qid}/submit`, {
        headers: bearer(s.token), data: { language: lang, source: code },
      });
      expect(r.status(), await r.text()).toBe(200);
    };
    await submit(w.cand, a1, original);
    await submit(w.cand2, a2, renamed);

    const hrPage = await open(await browser.newContext(), w.hr, `/company-jobs/${w.job.id}`);
    await hrPage.getByRole("tab", { name: "Similarity" }).click();
    await expect(hrPage.getByText(/not proof/)).toBeVisible({ timeout: 20_000 });
    await expect(hrPage.getByText("1 flagged pair")).toBeVisible();
    const pair = hrPage.getByRole("button", { name: /Cara Candidate.*Dev Candidate|Dev Candidate.*Cara Candidate/ });
    await expect(pair).toBeVisible();
    await expect(pair).toContainText(/High · \d+%/);

    // side by side, with the shared lines highlighted
    await pair.click();
    const dialog = hrPage.getByRole("dialog");
    await expect(dialog.getByText(/of the shorter solution is shared/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("cache").first()).toBeVisible();      // the renamed side
    await expect(dialog.locator(".bg-destructive\\/25").first()).toBeVisible();
    await hrPage.keyboard.press("Escape");

    // a different approach is no longer flagged
    const different = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []\n";
    const sub2 = await (await request.get(`${API}/candidate/oa/${a2}/session`, { headers: bearer(w.cand2.token) })).json();
    await request.post(`${API}/candidate/oa/${a2}/questions/${sub2.section.questions[0].id}/submit`, {
      headers: bearer(w.cand2.token), data: { language: "python", source: different },
    });
    // equal scores: the latest submission is the one compared, so the pair drops out once it is genuinely different
    const sim = await (await request.get(`${w.base}/similarity`, { headers: bearer(w.hr.token) })).json();
    expect(sim.summary.flagged_pairs).toBe(0);
    await hrPage.reload();
    await anyHydrated(hrPage);
    await hrPage.getByRole("tab", { name: "Similarity" }).click();
    await expect(hrPage.getByText("No pairs above the threshold.").first()).toBeVisible({ timeout: 20_000 });
  });
});
