import { expect, test, hydrated, loginViaForm, signedIn, HOME, EMAIL, PASSWORD, API, type Role } from "./helpers";

test.describe("authentication & route protection", () => {
  test("login page renders its form", async ({ page }) => {
    await page.goto("/auth/login?role=candidate");
    await expect(page.getByText("Welcome back").first()).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  for (const role of ["candidate", "company", "college", "admin"] as Role[]) {
    test(`${role} signs in through the form and lands in their own portal`, async ({ page }) => {
      await loginViaForm(page, role);
      await expect(page).toHaveURL(new RegExp(`${HOME[role]}$`));
      await expect(page.getByText(EMAIL[role]).first()).toBeVisible();
    });
  }

  test("wrong password shows an error and stays on the login page", async ({ page }) => {
    await loginViaForm(page, "candidate", EMAIL.candidate, "not-the-password");
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
    const stored = await page.evaluate(() => localStorage.getItem("mirracle.auth"));
    expect(stored === null || /"session":null/.test(stored)).toBe(true);
  });

  test("client-side validation blocks an empty / malformed form", async ({ page }) => {
    await page.goto("/auth/login?role=candidate");
    await hydrated(page);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.locator("#email").fill("not-an-email");
    await page.locator("#password").fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("signing into the wrong portal is refused with the real reason", async ({ page }) => {
    await loginViaForm(page, "company", EMAIL.candidate);
    await expect(page.getByText(/registered as a candidate account/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  for (const role of ["candidate", "company", "college", "admin"] as Role[]) {
    test(`anonymous visitor to /${role} is sent to login`, async ({ page }) => {
      await page.goto(HOME[role]);
      await expect(page).toHaveURL(/\/auth\/login/);
    });
  }

  test("a candidate opening another portal is bounced to the portal picker", async ({ page, request }) => {
    await signedIn(page, request, "candidate", "/company");
    await expect(page).toHaveURL(/\/portals/);
  });

  test("session survives a hard reload (no bounce to login)", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await expect(page.getByText("Hey Cara")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Hey Cara")).toBeVisible();
    await expect(page).toHaveURL(/\/candidate$/);
  });

  test("sign out clears the session and re-protects the portal", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/\/candidate$/);
    await page.goto("/candidate");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("an expired access token is refreshed transparently and the page still loads", async ({ page, request }) => {
    const s = await signedIn(page, request, "candidate");
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("mirracle.auth")!);
      raw.state.session.token = "expired-token";
      localStorage.setItem("mirracle.auth", JSON.stringify(raw));
    });
    await page.reload();
    await expect(page.getByText("Hey Cara")).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mirracle.auth")!).state.session.token);
    expect(stored).not.toBe("expired-token");
    expect(s.refreshToken).toBeTruthy();
  });

  test("a revoked session (bad token AND bad refresh token) ends at login", async ({ page, request }) => {
    await signedIn(page, request, "candidate");
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("mirracle.auth")!);
      raw.state.session.token = "bad";
      raw.state.session.refreshToken = "bad";
      localStorage.setItem("mirracle.auth", JSON.stringify(raw));
    });
    await page.reload();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  });

  test("blocked account sees the suspension reason at sign in", async ({ page, request }) => {
    // block via the real admin API, then try to log in through the UI
    const admin = await (await request.post(`${API}/auth/login`, { data: { email: EMAIL.admin, password: PASSWORD, role: "admin" } })).json();
    expect(admin.token).toBeTruthy();
    await request.post(`${API}/__e2e/block`, { data: { id: "u-cand", reason: "policy violation" } });
    await loginViaForm(page, "candidate");
    await expect(page.getByText(/suspended/i)).toBeVisible();
  });

  test("an un-hydrated login form never puts the password in the URL", async ({ page }) => {
    await page.route("**/*.{js,jsx,ts,tsx}*", (r) => r.abort());     // simulate JS failing to load
    await page.goto("/auth/login?role=candidate");
    await page.locator("#email").fill(EMAIL.candidate);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("button[type=submit]").click();
    await page.waitForTimeout(800);
    expect(page.url()).not.toContain(encodeURIComponent(PASSWORD));
    expect(page.url()).not.toContain("password=");
  });
});
