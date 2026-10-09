import { expect, test as base, type Page, type APIRequestContext } from "@playwright/test";

export const API = "http://127.0.0.1:8000";
export const PASSWORD = "Passw0rd!x";
export type Role = "candidate" | "company" | "college" | "admin";
export const EMAIL: Record<Role, string> = {
  candidate: "cand@e2e.dev",
  company: "hr@e2e.dev",
  college: "tpo@e2e.dev",
  admin: "admin@e2e.dev",
};
export const HOME: Record<Role, string> = {
  candidate: "/candidate",
  company: "/company",
  college: "/college",
  admin: "/admin",
};

// Console noise that is not an app defect (blocked third-party fonts in the sandbox, etc.)
const IGNORED = [/fonts\.(googleapis|gstatic)/, /Failed to load resource: net::ERR_(FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION)/, /favicon/];

/** Every test gets a freshly seeded backend and fails on uncaught page errors / unexpected console errors. */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page, request }, use) => {
      await request.post(`${API}/__e2e/reset`);
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (!IGNORED.some((re) => re.test(t))) problems.push(`console: ${t.slice(0, 300)}`);
      });
      await use(problems);
    },
    { auto: true },
  ],
});
export { expect };

export async function apiLogin(request: APIRequestContext, role: Role, email = EMAIL[role], password = PASSWORD) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password, role } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/** Fast path: put a real session (obtained from the real login endpoint) into the app's persisted store. */
export async function signedIn(page: Page, request: APIRequestContext, role: Role, path = HOME[role]) {
  const session = await apiLogin(request, role);
  await page.addInitScript((s) => {
    // only seed once, so a test (or the app) can later change / clear the stored session
    if (localStorage.getItem("mirracle.auth") === null) {
      localStorage.setItem("mirracle.auth", JSON.stringify({ state: { session: s }, version: 0 }));
    }
  }, session);
  await page.goto(path);
  await anyHydrated(page);
  return session as { token: string; refreshToken: string; user: Record<string, any> };
}

export async function anyHydrated(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button,input,a")].some((e) => Object.keys(e).some((k) => k.startsWith("__react"))),
  );
}

/** Wait until React has hydrated the page (an earlier submit would be a native form post). */
export async function hydrated(page: Page, selector = "#email") {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    },
    selector,
  );
}

/** Slow path: drive the real login form. */
export async function loginViaForm(page: Page, role: Role, email = EMAIL[role], password = PASSWORD) {
  await page.goto(`/auth/login?role=${role}`);
  await hydrated(page);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("button[type=submit]").click();
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
