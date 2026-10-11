// Run with: npm test   (Node's built-in test runner; no extra dependencies)
//
// Source-level guarantees about WHAT DEMO CODE IS ALLOWED TO TOUCH. These fail if someone
// later wires the demo to the live API, the real session, or a privileged client.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p: string) => relative(SRC, p).replaceAll("\\", "/");
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Everything that makes up the demo's data path.
const DEMO_DATA_FILES = [
  ...walk(join(SRC, "lib/demo")).filter((f) => !f.endsWith(".test.ts")),
  join(SRC, "services/demo/collegeDemoService.ts"),
  join(SRC, "store/demo/collegeDemo.ts"),
].map(rel);

// Demo UI entry points.
const DEMO_ROUTE_FILES = readdirSync(join(SRC, "routes"))
  .filter((f) => f.startsWith("demo.college"))
  .map((f) => `routes/${f}`);

describe("the demo data path cannot reach auth, the HTTP client, or privileged clients", () => {
  const forbidden: [RegExp, string][] = [
    [/store\/auth/, "the real auth store"],
    [/supabase/i, "Supabase (service-role or otherwise)"],
    [/getAuthHeader|Authorization/, "an Authorization header"],
    [/\brequest\s*\(/, "the live HTTP request() helper"],
    [/\bfetch\s*\(/, "network fetch"],
    [/localStorage/, "persistent storage shared with the real session"],
    [/VITE_|import\.meta\.env|process\.env/, "environment / secrets"],
    [/service[_-]?role/i, "a service-role key"],
  ];

  for (const file of DEMO_DATA_FILES) {
    it(`${file} imports/uses none of them`, () => {
      let code = stripComments(read(file));
      // The adapter legitimately imports an error class from the client module — nothing else.
      if (file === "services/demo/collegeDemoService.ts") {
        code = code.replace('import { ApiClientError } from "../api/client";', "");
      }
      for (const [pattern, what] of forbidden) {
        assert.ok(!pattern.test(code), `${file} must not touch ${what}`);
      }
    });
  }

  it("the demo adapter only imports ApiClientError from the HTTP client module", () => {
    const imports = [
      ...read("services/demo/collegeDemoService.ts").matchAll(
        /import\s+([^;]+?)\s+from\s+"([^"]*client)"/g,
      ),
    ];
    assert.deepEqual(
      imports.map((m) => m[1]),
      ["{ ApiClientError }"],
    );
  });
});

describe("demo routes do not use the real portal's guards or session", () => {
  it("there is a demo route for every section of the live nav", () => {
    for (const name of [
      "index",
      "students",
      "drives",
      "departments",
      "analytics",
      "shortlist",
      "reports",
    ]) {
      assert.ok(DEMO_ROUTE_FILES.includes(`routes/demo.college.${name}.tsx`), name);
    }
    assert.ok(DEMO_ROUTE_FILES.includes("routes/demo.college.tsx"));
  });

  for (const file of DEMO_ROUTE_FILES) {
    it(`${file} has no role guard, auth store, or session read`, () => {
      const code = stripComments(read(file));
      assert.ok(
        !/useCollegeGuard|useRoleGuard|useAuthStore|store\/auth|setSession|\bsession\b/.test(code),
        file,
      );
    });
  }

  it("every demo page declares its own distinct document title", () => {
    const titles = DEMO_ROUTE_FILES.filter((f) => f !== "routes/demo.college.tsx").map((f) => {
      const m = read(f).match(/demoPageTitle\("([^"]+)"\)/);
      assert.ok(m, `${f} must set a title via demoPageTitle()`);
      return m![1];
    });
    assert.equal(titles.length, 7);
    assert.equal(
      new Set(titles).size,
      titles.length,
      "titles must be unique so pages are distinguishable",
    );
  });

  it("the demo layout keeps demo pages out of search indexes", () => {
    assert.match(read("routes/demo.college.tsx"), /noindex/);
  });

  it("Exit demo leaves via the College login without clearing the real session", () => {
    const layout = stripComments(read("routes/demo.college.tsx"));
    assert.match(layout, /\/auth\/login/);
    assert.ok(!/logout|signOut/.test(layout));
  });
});

describe("the live client refuses to run on demo pages", () => {
  const client = read("services/api/client.ts");

  it("request() and getAuthHeader() both assert the live API is allowed, before doing anything", () => {
    assert.equal(
      (client.match(/assertLiveApiAllowed\(window\.location\.pathname\)/g) ?? []).length,
      2,
    );
    const reqBody = client.slice(client.indexOf("export async function request"));
    assert.ok(
      reqBody.indexOf("assertLiveApiAllowed") < reqBody.indexOf("await fetch"),
      "guard runs before any fetch",
    );
    const hdrBody = client.slice(
      client.indexOf("export async function getAuthHeader"),
      client.indexOf("export async function request"),
    );
    assert.ok(
      hdrBody.indexOf("assertLiveApiAllowed") < hdrBody.indexOf("useAuthStore"),
      "guard runs before the token is read",
    );
  });
});

describe("every College Portal service is demo-aware", () => {
  it("college.ts exports each service only through withDemo", () => {
    const code = read("services/api/college/college.ts");
    for (const name of [
      "dashboardService",
      "studentsService",
      "drivesService",
      "shortlistService",
      "departmentsService",
    ]) {
      assert.match(code, new RegExp(`export const ${name} = withDemo\\(`), name);
    }
    assert.ok(
      !/export const \w+Service = \{/.test(code),
      "no service is exported without the demo switch",
    );
  });

  it("college page components get their data from those services (no direct HTTP)", () => {
    for (const f of readdirSync(join(SRC, "components/college")).filter((n) =>
      n.endsWith(".tsx"),
    )) {
      const code = stripComments(read(`components/college/${f}`));
      assert.ok(
        !/\brequest\s*\(|getAuthHeader|services\/api\/client"/.test(code),
        `${f} bypasses the service layer`,
      );
    }
  });
});
