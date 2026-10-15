import { expect, test, signedIn } from "./helpers";

const PAGES: [string, RegExp][] = [
  ["Colleges", /\/admin\/colleges/], ["Companies", /\/admin\/companies/], ["Partnerships", /\/admin\/partnerships/],
  ["Candidates", /\/admin\/candidates/], ["Departments", /\/admin\/departments/], ["Placement analytics", /\/admin\/placements/],
  ["Users & Access", /\/admin\/users/], ["Admin Management", /\/admin\/admin-users/], ["Live Activity", /\/admin\/activity/],
  ["Audit Log", /\/admin\/audit-log/], ["Alerts", /\/admin\/alerts/], ["System Health", /\/admin\/system-health/],
  ["Financial overview", /\/admin\/finance/], ["Reports", /\/admin\/reports/],
];

test.describe("admin portal", () => {
  test("overview renders platform KPIs from the analytics function", async ({ page, request }) => {
    await signedIn(page, request, "admin");
    await expect(page.getByText("Platform overview")).toBeVisible();
    await expect(page.getByText("Total users")).toBeVisible();
    await expect(page.getByText("1 recruiters · 1 college · 1 admin")).toBeVisible();
    await expect(page.getByText("Platform placement rate")).toBeVisible();
    await expect(page.getByText("N/A").first()).toBeVisible();        // zero applicants => N/A, never a fake 0%
  });

  for (const [label, url] of PAGES) {
    test(`'${label}' page opens from the sidebar without a crash`, async ({ page, request, problems }) => {
      await signedIn(page, request, "admin");
      await page.getByRole("link", { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(url);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Something went wrong").or(page.getByText("This page didn't load"))).toHaveCount(0);
      expect(problems.filter((p) => p.startsWith("pageerror"))).toEqual([]);
    });
  }

  test("the date-range filter offers presets and changes the label", async ({ page, request }) => {
    await signedIn(page, request, "admin");
    await page.getByRole("button", { name: /Last 30 days/ }).click();
    await page.getByRole("option", { name: /Last 7 days/ }).or(page.getByText("Last 7 days")).first().click();
    await expect(page.getByText(/Showing Last 7 days/)).toBeVisible();
  });

  test("global search opens with the keyboard shortcut", async ({ page, request }) => {
    await signedIn(page, request, "admin");
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
  });

  test("non-admins are kept out of /admin", async ({ page, request }) => {
    await signedIn(page, request, "college", "/admin");
    await expect(page).toHaveURL(/\/portals|\/auth\/login/);
  });

  test("signing out of the admin console returns to the public site", async ({ page, request }) => {
    await signedIn(page, request, "admin");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/\/admin/);
  });
});
