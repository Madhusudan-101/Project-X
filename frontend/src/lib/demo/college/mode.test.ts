// Run with: npm test   (Node's built-in test runner; no extra dependencies)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withDemo } from "./dispatch.ts";
import {
  assertLiveApiAllowed,
  collegeBasePath,
  DEMO_BASE,
  demoPageTitle,
  isDemoPath,
  LiveApiBlockedError,
} from "./mode.ts";

describe("isDemoPath — demo is decided by the URL and nothing else", () => {
  it("accepts the demo root and its pages", () => {
    for (const p of [
      "/demo/college",
      "/demo/college/",
      "/demo/college/students",
      "/demo/college/drives",
    ]) {
      assert.equal(isDemoPath(p), true, p);
    }
  });

  it("rejects the real portal and look-alike paths", () => {
    for (const p of [
      "/college",
      "/college/students",
      "/college/demo/college",
      "/demo/college-evil",
      "/demo/colleges",
      "/demo",
      "/Demo/College",
      "/auth/login",
      "/admin",
      "/",
      "",
    ]) {
      assert.equal(isDemoPath(p), false, JSON.stringify(p));
    }
    assert.equal(isDemoPath(null), false);
    assert.equal(isDemoPath(undefined), false);
  });

  it("picks the link base from the location", () => {
    assert.equal(collegeBasePath("/demo/college/students"), "/demo/college");
    assert.equal(collegeBasePath("/college/students"), "/college");
    assert.equal(collegeBasePath("/somewhere/else"), "/college");
  });
});

describe("assertLiveApiAllowed — the HTTP client's last line of defence", () => {
  it("refuses on every demo page", () => {
    for (const p of [DEMO_BASE, `${DEMO_BASE}/students`, `${DEMO_BASE}/reports`]) {
      assert.throws(() => assertLiveApiAllowed(p), LiveApiBlockedError, p);
    }
  });

  it("does not interfere with the real portal or auth pages", () => {
    for (const p of ["/college", "/college/students", "/auth/login", "/candidate", "/admin"]) {
      assert.doesNotThrow(() => assertLiveApiAllowed(p), p);
    }
  });
});

describe("withDemo — per-call routing between live and demo implementations", () => {
  const make = () => {
    const calls: string[] = [];
    const live = { list: () => (calls.push("live"), "LIVE"), total: 1 };
    const demo = { list: () => (calls.push("demo"), "DEMO"), total: 2 };
    return { calls, live, demo };
  };

  it("never touches the live implementation while in demo", () => {
    const { calls, live, demo } = make();
    const svc = withDemo(live, demo, () => true);
    assert.equal(svc.list(), "DEMO");
    assert.deepEqual(calls, ["demo"]);
  });

  it("never touches the demo implementation outside demo", () => {
    const { calls, live, demo } = make();
    const svc = withDemo(live, demo, () => false);
    assert.equal(svc.list(), "LIVE");
    assert.deepEqual(calls, ["live"]);
  });

  it("decides on every call, so navigating between modes needs no re-wiring", () => {
    const { calls, live, demo } = make();
    let inDemo = false;
    const svc = withDemo(live, demo, () => inDemo);
    svc.list();
    inDemo = true;
    svc.list();
    inDemo = false;
    svc.list();
    assert.deepEqual(calls, ["live", "demo", "live"]);
  });
});

describe("demoPageTitle", () => {
  it("names the page, the demo, and the fictional college", () => {
    assert.equal(
      demoPageTitle("Students"),
      "Students — College Portal demo · Northstar Institute of Technology",
    );
  });
});
