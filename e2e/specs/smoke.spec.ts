import { expect, test, signedIn, hydrated, API, EMAIL, type Role } from "./helpers";

const PUBLIC = ["/", "/portals", "/auth/login", "/auth/signup", "/auth/company-signup", "/auth/forgot-password",
                "/auth/reset-password", "/auth/otp", "/auth/confirm", "/auth/oauth-callback"];

test.describe("public site & routing", () => {
  for (const path of PUBLIC) {
    test(`${path} renders without crashing or console errors`, async ({ page, problems }) => {
      const res = await page.goto(path);
      expect(res!.status()).toBeLessThan(500);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toBeEmpty();
      await expect(page.getByText("This page didn't load")).toHaveCount(0);
      expect(problems.filter((p) => p.startsWith("pageerror"))).toEqual([]);
    });
  }

  test("unknown URL shows the friendly 404 with a way home", async ({ page }) => {
    await page.goto("/definitely/not/a/page");
    await expect(page.getByText("Page not found")).toBeVisible();
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:8080\/$/);
  });

  test("portal picker offers all four portals", async ({ page }) => {
    await page.goto("/portals");
    for (const t of [/candidate/i, /compan/i, /college/i]) await expect(page.getByText(t).first()).toBeVisible();
  });

  test("forgot-password sends a recovery request and confirms", async ({ page }) => {
    await page.goto("/auth/forgot-password?role=candidate");
    await hydrated(page);
    await page.locator("#email").fill(EMAIL.candidate);
    await page.locator("button[type=submit]").click();
    await expect(page.getByText(/check your|sent|email/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("sitemap.xml is served", async ({ request }) => {
    const r = await request.get("http://127.0.0.1:8080/sitemap.xml");
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain("<urlset");
  });

  test("backend CORS allows the frontend origin and blocks a foreign one", async ({ request }) => {
    const ok = await request.fetch(`${API}/auth/login`, { method: "OPTIONS", headers: {
      Origin: "http://127.0.0.1:8080", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    expect(ok.headers()["access-control-allow-origin"]).toBe("http://127.0.0.1:8080");
    const evil = await request.fetch(`${API}/auth/login`, { method: "OPTIONS", headers: {
      Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(evil.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("API docs and health are reachable; protected data is not", async ({ request }) => {
    expect((await request.get(`${API}/`)).status()).toBe(200);
    expect((await request.get(`${API}/docs`)).status()).toBe(200);
    for (const p of ["/candidate/jobs", "/company/jobs", "/api/students/", "/admin/overview", "/company/me"]) {
      expect((await request.get(`${API}${p}`)).status(), p).toBe(401);
    }
  });
});

test.describe("responsive layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });      // phone

  const overflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  for (const path of ["/", "/portals", "/auth/login", "/auth/signup"]) {
    test(`${path} has no horizontal scroll on a phone`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  }

  for (const role of ["candidate", "company", "college"] as Role[]) {
    test(`${role} dashboard has no horizontal scroll on a phone`, async ({ page, request }) => {
      await signedIn(page, request, role);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("college portal pages", () => {
  test("shortlist filters the roster and exports", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/shortlist");
    await expect(page.getByText("Filter your roster and export a shortlist CSV")).toBeVisible();
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText("Sam Student").first()).toBeVisible({ timeout: 15_000 });

  });

  test("departments page lets a TPO add a department", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/departments");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /add department|new department|create/i }).first().click();
    await page.getByLabel(/name/i).first().fill("Computer Science");
    await page.getByRole("button", { name: /save|add|create/i }).last().click();
    await expect(page.getByText("Computer Science").first()).toBeVisible({ timeout: 10_000 });
  });

  test("reports page renders readiness data without errors", async ({ page, request, problems }) => {
    await signedIn(page, request, "college", "/college/reports");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/report|readiness|distribution/i).first()).toBeVisible();
    expect(problems.filter((p) => p.startsWith("pageerror"))).toEqual([]);
  });
});
