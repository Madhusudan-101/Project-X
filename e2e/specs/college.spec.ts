import { expect, test, signedIn, API } from "./helpers";
import fs from "node:fs";
import path from "node:path";

test.describe("college / TPO portal", () => {
  test("dashboard and every sidebar page load without errors", async ({ page, request, problems }) => {
    await signedIn(page, request, "college");
    await expect(page.getByText("Your placement command centre.")).toBeVisible();
    for (const [label, url] of [["Students", /students/], ["Campus Drives", /drives/], ["Departments", /departments/],
                                ["Placement Analytics", /analytics/], ["Shortlist", /shortlist/], ["Reports", /reports/]] as const) {
      await page.getByRole("link", { name: label }).first().click();
      await expect(page).toHaveURL(url);
      await page.waitForLoadState("networkidle");
    }
    expect(problems).toEqual([]);
  });

  test("roster lists the seeded student", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/students");
    await expect(page.getByRole("cell", { name: "Sam Student", exact: true }).first()).toBeVisible();
    await expect(page.getByText("1 student").first()).toBeVisible();
  });

  test("add a student through the dialog, then it shows in the table", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/students");
    await page.getByRole("button", { name: "Add student" }).first().click();
    await page.locator("#add-name").fill("Jane Doe");
    await page.locator("#add-email").fill("JANE@college.edu");
    await page.locator("#add-branch").fill("ECE");
    await page.locator("#add-grad").fill("2027");
    await page.getByRole("button", { name: "Add student" }).last().click();
    await expect(page.getByRole("cell", { name: "Jane Doe", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "jane@college.edu", exact: true }).first()).toBeVisible();
  });

  test("invalid student (bad email) is rejected with a message and not added", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/students");
    await page.getByRole("button", { name: "Add student" }).first().click();
    await page.locator("#add-name").fill("Bad Email");
    await page.locator("#add-email").fill("not-an-email");
    await page.locator("#add-branch").fill("CSE");
    await page.locator("#add-grad").fill("2027");
    const submit = page.getByRole("button", { name: "Add student" }).last();
    if (await submit.isEnabled()) await submit.click();
    // either the form refuses to submit, or the server's validation message is shown — never a new row
    await page.waitForTimeout(800);
    await expect(page.getByText("Bad Email")).toHaveCount(0);
    const state = await (await request.get(`${API}/__e2e/state`)).json();
    expect(state.students_rows.map((x: any) => x.email)).not.toContain("not-an-email");
  });

  test("CSV upload adds students; a bad CSV is rejected", async ({ page, request }, info) => {
    const good = path.join(info.outputDir, "good.csv");
    const bad = path.join(info.outputDir, "bad.csv");
    fs.mkdirSync(info.outputDir, { recursive: true });
    fs.writeFileSync(good, "name,email,branch,graduationYear,employabilityScore\nUma Upload,uma@x.com,IT,2026,64\nVic Upload,vic@x.com,CSE,2027,88\n");
    fs.writeFileSync(bad, "name,email,branch,graduationYear\nNo Email,,CSE,2026\n");
    await signedIn(page, request, "college", "/college/students");
    await page.getByRole("button", { name: "Upload CSV" }).click();
    await page.locator("input[type=file]").setInputFiles(bad);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Some rows were rejected:")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Line 2: missing email/)).toBeVisible();
    await page.locator("input[type=file]").setInputFiles(good);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Uma Upload", exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("cell", { name: "Vic Upload", exact: true }).first()).toBeVisible();
    const state = await (await request.get(`${API}/__e2e/state`)).json();
    expect(state.students_rows.map((s: any) => s.email).sort()).toEqual(["sam@e2e.dev", "uma@x.com", "vic@x.com"]);
  });

  test("search narrows the roster", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/students");
    await page.getByPlaceholder("Search name, email, or branch…").fill("zzz-nobody");
    await expect(page.getByRole("cell", { name: "Sam Student", exact: true }).first()).toHaveCount(0);
    await page.getByPlaceholder("Search name, email, or branch…").fill("sam");
    await expect(page.getByRole("cell", { name: "Sam Student", exact: true }).first()).toBeVisible();
  });

  test("CSV export downloads a file with the roster", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/students");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const text = fs.readFileSync(await download.path(), "utf8");
    expect(text).toContain("sam@e2e.dev");
    expect(text.split("\n")[0]).toContain("graduationYear");
  });

  test("create a campus drive and see it listed", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/drives");
    await page.getByRole("button", { name: "Create drive" }).first().click();
    await page.locator("#drive-company").fill("Initech");
    await page.locator("#drive-role").fill("SDE-1");
    await page.locator("#drive-date").fill("2030-06-01");
    await page.locator("#drive-branch").fill("CSE");
    await page.locator("#drive-grad").fill("2026");
    await page.locator("#drive-score").fill("60");
    await page.getByRole("button", { name: "Create drive" }).last().click();
    await expect(page.getByText("Initech").first()).toBeVisible();
    await expect(page.getByText("1 drive")).toBeVisible();
  });

  test("dashboard stats reflect the roster", async ({ page, request }) => {
    await signedIn(page, request, "college", "/college/analytics");
    await expect(page.getByText("71").first()).toBeVisible();     // avg employability of the single seeded student
  });

  test("a company user cannot open the college portal", async ({ page, request }) => {
    await signedIn(page, request, "company", "/college");
    await expect(page).toHaveURL(/\/portals/);
  });
});
