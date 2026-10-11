// Run with: npm test   (Node's built-in test runner; no extra dependencies)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as engine from "./engine.ts";
import { DEMO_COLLEGE_ID } from "./mode.ts";
import { buildSeedState, DEMO_EMAIL_DOMAIN, type DemoState } from "./seed.ts";

const ANCHOR = new Date("2026-10-11T00:00:00Z");
const fresh = (): DemoState => buildSeedState(ANCHOR);

describe("seed — fictional, deterministic, schema-shaped", () => {
  const s = fresh();

  it("is deterministic for a given anchor date", () => {
    assert.deepEqual(buildSeedState(ANCHOR), s);
  });

  it("has a substantial roster across several departments", () => {
    assert.equal(s.students.length, 72);
    assert.equal(new Set(s.students.map((x) => x.branch)).size, 6);
    assert.equal(s.departments.length, 6);
  });

  it("uses only reserved fictional email addresses and unique ids / emails / names", () => {
    for (const st of s.students) {
      assert.ok(st.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`), st.email);
      assert.ok(DEMO_EMAIL_DOMAIN.endsWith(".example"));
      assert.equal(st.college_id, DEMO_COLLEGE_ID);
      assert.ok(st.id.startsWith("demo-"), st.id);
    }
    for (const key of ["id", "email", "name"] as const) {
      assert.equal(new Set(s.students.map((x) => x[key])).size, s.students.length, key);
    }
  });

  it("keeps every score in range and every enum valid", () => {
    for (const st of s.students) {
      for (const k of [
        "employability_score",
        "resume_score",
        "github_score",
        "leetcode_score",
        "interview_score",
        "assessment_score",
      ] as const) {
        assert.ok(st[k] >= 0 && st[k] <= 100, `${st.id} ${k}=${st[k]}`);
      }
      assert.ok(["pending", "verified", "rejected"].includes(st.verification_status));
      assert.ok(["not_placed", "placed", "offer_declined"].includes(st.placement_status));
      assert.ok(["active", "temporarily_blocked", "restricted"].includes(st.status));
    }
  });

  it("contains the variety the UI needs to be worth exploring", () => {
    const st = engine.dashboardStats(s);
    assert.ok(
      st.placedStudents > 10 && st.notPlacedStudents > 10,
      "both placed and unplaced students",
    );
    assert.ok(st.offerDeclinedStudents >= 1);
    assert.ok(st.temporarilyBlockedStudents >= 1 && st.restrictedStudents >= 1);
    assert.ok(st.activeCompanyDrives >= 1 && st.draftDrives >= 1 && st.closedDrives >= 1);
    assert.ok(st.verifiedStudents > 0 && st.verifiedStudents < st.totalStudents);
    assert.deepEqual([...new Set(s.students.map((x) => x.graduation_year))].sort(), [2026, 2027]);
  });

  it("keeps drive dates relative to the anchor: closed in the past, active/draft ahead", () => {
    const today = ANCHOR.toISOString().slice(0, 10);
    for (const d of s.drives) {
      if (d.status === "Closed") assert.ok(d.date < today, `${d.companyName} ${d.date}`);
      else assert.ok(d.date > today, `${d.companyName} ${d.date}`);
    }
  });
});

describe("dashboard KPIs and charts are derived from the roster, never stored", () => {
  const s = fresh();
  const stats = engine.dashboardStats(s);

  it("agrees with a recount of the visible student list", () => {
    const rows = engine.listStudents(s);
    const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
    assert.equal(stats.totalStudents, rows.length);
    assert.equal(
      stats.placedStudents,
      count((r) => r.placement_status === "placed"),
    );
    assert.equal(
      stats.verifiedStudents,
      count((r) => r.verification_status === "verified"),
    );
    assert.equal(
      stats.placedStudents + stats.notPlacedStudents + stats.offerDeclinedStudents,
      stats.totalStudents,
    );
    assert.equal(
      stats.activeStudents + stats.temporarilyBlockedStudents + stats.restrictedStudents,
      stats.totalStudents,
    );
    assert.equal(
      stats.placementPercentage,
      Math.round((stats.placedStudents / stats.totalStudents) * 1000) / 10,
    );
    const avg = rows.reduce((a, r) => a + r.employability_score, 0) / rows.length;
    assert.equal(stats.averageEmployabilityScore, Math.round(avg * 100) / 100);
  });

  it("drive counts add up and match the drives list", () => {
    assert.equal(
      stats.activeCompanyDrives + stats.draftDrives + stats.closedDrives,
      stats.totalDrives,
    );
    assert.equal(stats.totalDrives, engine.listDrives(s).length);
  });

  it("score-distribution buckets add up to the roster", () => {
    const d = engine.scoreDistribution(s);
    assert.equal(
      Object.values(d).reduce((a, b) => a + b, 0),
      stats.totalStudents,
    );
  });

  it("department rows add up to the roster (every student belongs to exactly one department)", () => {
    const depts = engine.listDepartments(s);
    assert.equal(
      depts.reduce((a, d) => a + d.studentCount, 0),
      stats.totalStudents,
    );
    assert.equal(
      depts.reduce((a, d) => a + d.placedStudents, 0),
      stats.placedStudents,
    );
    for (const d of depts) assert.ok(d.placementRate >= 0 && d.placementRate <= 100);
  });

  it("stays consistent after the visitor changes data", () => {
    const draft = fresh();
    const target = draft.students.find((x) => x.placement_status === "not_placed")!;
    const before = engine.dashboardStats(draft);
    engine.updateStudent(draft, target.id, { placementStatus: "placed" });
    const after = engine.dashboardStats(draft);
    assert.equal(after.placedStudents, before.placedStudents + 1);
    assert.equal(after.notPlacedStudents, before.notPlacedStudents - 1);
    assert.equal(
      engine.listDepartments(draft).reduce((a, x) => a + x.studentCount, 0),
      after.totalStudents,
    );
  });
});

describe("students — filters mirror the live API", () => {
  const s = fresh();

  it("branch filter understands the same aliases as the backend", () => {
    const cse = engine.listStudents(s, { branch: "computer science" });
    assert.ok(cse.length > 0 && cse.every((r) => r.branch === "CSE"));
    assert.deepEqual(
      engine.listStudents(s, { branch: "cse" }).map((r) => r.id),
      cse.map((r) => r.id),
    );
  });

  it("graduation year and minimum score filters apply", () => {
    for (const r of engine.listStudents(s, { graduationYear: 2027, minimumScore: 70 })) {
      assert.equal(r.graduation_year, 2027);
      assert.ok(r.employability_score >= 70);
    }
  });

  it("returns copies — callers cannot corrupt the dataset", () => {
    const [first] = engine.listStudents(s);
    first.name = "TAMPERED";
    assert.notEqual(engine.listStudents(s)[0].name, "TAMPERED");
  });

  it("404s for an unknown student", () => {
    assert.throws(
      () => engine.getStudent(s, "nope"),
      (e: engine.DemoApiError) => e.status === 404,
    );
  });
});

describe("drives — eligibility follows the live rules", () => {
  const s = fresh();

  it("returns exactly the students that satisfy year, score and branch", () => {
    for (const drive of s.drives) {
      const { eligibleStudents } = engine.eligibleStudents(s, drive.id);
      const e = drive.eligibility;
      const allowed = e.branch ? (Array.isArray(e.branch) ? e.branch : [e.branch]) : [];
      for (const r of eligibleStudents) {
        assert.equal(r.graduation_year, e.graduationYear);
        assert.ok(r.employability_score >= (e.minimumScore ?? 0));
        assert.ok(engine.branchMatches(r.branch, allowed));
      }
      const expected = s.students.filter(
        (r) =>
          r.graduation_year === e.graduationYear &&
          r.employability_score >= (e.minimumScore ?? 0) &&
          engine.branchMatches(r.branch, allowed),
      );
      assert.equal(eligibleStudents.length, expected.length, drive.companyName);
    }
  });

  it("a drive with no branch restriction is open to every branch", () => {
    const open = s.drives.find((d) => !d.eligibility.branch)!;
    assert.ok(open, "seed includes an unrestricted drive");
    const branches = new Set(
      engine.eligibleStudents(s, open.id).eligibleStudents.map((r) => r.branch),
    );
    assert.ok(branches.size > 1);
  });

  it("creates, updates and deletes drives, and validates input", () => {
    const d = fresh();
    const { drive } = engine.createDrive(d, {
      companyName: "Testco",
      role: "Analyst",
      date: "2027-01-15",
      status: "Draft",
      eligibility: { branch: "CSE", graduationYear: 2027, minimumScore: 60 },
    });
    assert.deepEqual(drive.eligibility.branch, ["CSE"], "a single branch is normalised to a list");
    assert.equal(engine.dashboardStats(d).draftDrives, 3);
    engine.updateDrive(d, drive.id, { status: "Active" });
    assert.equal(engine.dashboardStats(d).activeCompanyDrives, 4);
    engine.removeDrive(d, drive.id);
    assert.equal(engine.dashboardStats(d).totalDrives, 9);
    assert.throws(() =>
      engine.createDrive(d, {
        companyName: "",
        role: "x",
        date: "2027-01-15",
        status: "Active",
        eligibility: {},
      }),
    );
    assert.throws(() =>
      engine.createDrive(d, {
        companyName: "A",
        role: "x",
        date: "15/01/2027",
        status: "Active",
        eligibility: {},
      }),
    );
    assert.throws(() =>
      engine.createDrive(d, {
        companyName: "A",
        role: "x",
        date: "2027-01-15",
        status: "Bogus" as never,
        eligibility: {},
      }),
    );
    assert.throws(
      () => engine.removeDrive(d, "nope"),
      (e: engine.DemoApiError) => e.status === 404,
    );
  });
});

describe("student mutations — validation and effects", () => {
  it("creates a student and rejects duplicates, bad emails and impossible years", () => {
    const d = fresh();
    const { student } = engine.createStudent(d, {
      name: "Test Person",
      email: "Test.Person@Example.test",
      branch: "CSE",
      graduationYear: 2027,
    });
    assert.equal(student.email, "test.person@example.test");
    assert.equal(engine.dashboardStats(d).totalStudents, 73);
    const dup = () =>
      engine.createStudent(d, {
        name: "X",
        email: "test.person@example.test",
        branch: "CSE",
        graduationYear: 2027,
      });
    assert.throws(dup, (e: engine.DemoApiError) => e.status === 409);
    assert.throws(
      () =>
        engine.createStudent(d, {
          name: "X",
          email: "not-an-email",
          branch: "CSE",
          graduationYear: 2027,
        }),
      (e: engine.DemoApiError) => e.status === 422,
    );
    assert.throws(
      () =>
        engine.createStudent(d, {
          name: "X",
          email: "a@b.cd",
          branch: "CSE",
          graduationYear: 1800,
        }),
      (e: engine.DemoApiError) => e.status === 422,
    );
  });

  it("updates, bulk-updates and deletes", () => {
    const d = fresh();
    const [a, b] = d.students;
    engine.updateStudent(d, a.id, { name: "Renamed" });
    assert.equal(engine.getStudent(d, a.id).name, "Renamed");
    assert.throws(
      () => engine.updateStudent(d, a.id, { email: b.email }),
      (e: engine.DemoApiError) => e.status === 409,
    );
    assert.throws(() => engine.updateStudent(d, a.id, { placementStatus: "hired" as never }));
    const res = engine.bulkUpdatePlacement(d, [a.id, b.id, "ghost"], "offer_declined");
    assert.equal(res.updatedCount, 2);
    assert.throws(() => engine.bulkUpdatePlacement(d, [], "placed"));
    engine.removeStudent(d, a.id);
    assert.equal(d.students.length, 71);
    assert.throws(
      () => engine.removeStudent(d, a.id),
      (e: engine.DemoApiError) => e.status === 404,
    );
  });

  it("block / restrict / unblock change the access state and its KPIs", () => {
    const d = fresh();
    const id = d.students.find((x) => x.status === "active")!.id;
    const base = engine.dashboardStats(d);
    const blocked = engine.blockStudent(d, id, { duration: "7d", reason: "Sample reason" });
    assert.equal(blocked.student.status, "temporarily_blocked");
    assert.ok(new Date(blocked.student.blocked_until!).getTime() > Date.now());
    assert.equal(blocked.accountRestricted, false, "no real account exists in the demo");
    assert.equal(
      engine.dashboardStats(d).temporarilyBlockedStudents,
      base.temporarilyBlockedStudents + 1,
    );
    engine.restrictStudent(d, id, "Withdrew");
    assert.equal(engine.getStudent(d, id).status, "restricted");
    assert.equal(engine.getStudent(d, id).blocked_until, null);
    engine.unblockStudent(d, id);
    assert.equal(engine.getStudent(d, id).status, "active");
    assert.deepEqual(engine.dashboardStats(d), base);
    assert.throws(() => engine.blockStudent(d, id, { duration: "7d", reason: "  " }));
    assert.throws(() =>
      engine.blockStudent(d, id, {
        duration: "custom",
        until: "2001-01-01T00:00:00Z",
        reason: "past",
      }),
    );
  });

  it("onboarding invites are a labelled no-op: nothing is 'sent', nothing is marked invited", () => {
    const d = fresh();
    const before = JSON.stringify(d);
    const res = engine.onboardStudents(d);
    assert.equal(res.invited, 0);
    assert.equal(res.failed, 0);
    assert.match(res.message, /not sent in Demo Mode/);
    assert.equal(JSON.stringify(d), before);
  });
});

describe("departments", () => {
  it("creates (no duplicate names), updates and deletes", () => {
    const d = fresh();
    const { department } = engine.createDepartment(d, {
      name: "Biotechnology",
      code: "BT",
      hodName: "Dr. Test",
    });
    assert.equal(department.studentCount, 0);
    assert.throws(
      () => engine.createDepartment(d, { name: "biotechnology" }),
      (e: engine.DemoApiError) => e.status === 409,
    );
    engine.updateDepartment(d, department.id, { hodName: "Dr. Changed" });
    assert.equal(engine.getDepartment(d, department.id).hodName, "Dr. Changed");
    engine.removeDepartment(d, department.id);
    assert.throws(
      () => engine.getDepartment(d, department.id),
      (e: engine.DemoApiError) => e.status === 404,
    );
  });

  it("department detail lists exactly its students", () => {
    const s = fresh();
    const detail = engine.getDepartment(s, "demo-dept-cse");
    assert.equal(detail.students.length, detail.studentCount);
    assert.ok(detail.students.every((r) => r.branch === "CSE"));
  });
});

describe("shortlist", () => {
  const s = fresh();
  it("filters by branch, year, score and verification status", () => {
    const res = engine.shortlist(s, {
      branch: "CSE",
      graduationYear: 2027,
      minimumScore: 60,
      verificationStatus: "verified",
    });
    assert.equal(res.total, res.students.length);
    for (const r of res.students) {
      assert.equal(r.branch, "CSE");
      assert.equal(r.graduation_year, 2027);
      assert.ok(r.employability_score >= 60);
      assert.equal(r.verification_status, "verified");
    }
  });
  it("an impossible filter yields an empty result, not an error", () => {
    assert.deepEqual(engine.shortlist(s, { minimumScore: 101 }), { total: 0, students: [] });
  });
});

describe("CSV export contains only the fictional dataset, in the live format", () => {
  const s = fresh();

  it("roster export has the live header and one line per filtered student", () => {
    const csv = engine.exportStudentsCsv(s, { graduationYear: 2027 });
    const lines = csv.trim().split("\n");
    assert.equal(
      lines[0],
      "name,email,branch,graduationYear,employabilityScore,resumeScore,githubScore,leetcodeScore,interviewScore,assessmentScore,verificationStatus,placementStatus",
    );
    assert.equal(lines.length - 1, engine.listStudents(s, { graduationYear: 2027 }).length);
  });

  it("every exported email is a reserved fictional address", () => {
    for (const csv of [engine.exportStudentsCsv(s), engine.exportShortlistCsv(s, {})]) {
      const emails = csv.match(/[\w.+-]+@[\w.-]+/g) ?? [];
      assert.ok(emails.length > 0);
      assert.ok(
        emails.every((e) => e.endsWith(`@${DEMO_EMAIL_DOMAIN}`)),
        "no non-demo address in an export",
      );
    }
  });

  it("neutralises spreadsheet formula injection and quotes awkward cells", () => {
    const d = fresh();
    engine.createStudent(d, {
      name: '=HYPERLINK("http://x")',
      email: "inj@example.test",
      branch: "A,B",
      graduationYear: 2027,
    });
    const csv = engine.exportStudentsCsv(d, {});
    assert.ok(
      csv.includes(`"'=HYPERLINK(""http://x"")"`),
      "formula prefixed with a quote and CSV-escaped",
    );
    assert.ok(csv.includes('"A,B"'));
  });
});

describe("CSV upload — mirrors the live parser and is all-or-nothing", () => {
  const header =
    "name,email,branch,graduationYear,employabilityScore,verificationStatus,placementStatus";

  it("adds new students and updates existing ones by email", () => {
    const d = fresh();
    const existing = d.students[0];
    const res = engine.uploadStudentsCsv(
      d,
      `${header}\nNew One,new.one@example.test,IT,2027,77,verified,placed\n${existing.name} Updated,${existing.email.toUpperCase()},CSE,2026,50,,\n`,
    );
    assert.equal(res.addedStudents, 2);
    assert.equal(d.students.length, 73, "one new + one updated in place");
    assert.equal(engine.getStudent(d, existing.id).name, `${existing.name} Updated`);
    assert.equal(
      d.students.find((x) => x.email === "new.one@example.test")!.placement_status,
      "placed",
    );
  });

  it("handles quoted fields, escaped quotes and CRLF", () => {
    const d = fresh();
    engine.uploadStudentsCsv(
      d,
      `${header}\r\n"Last, First ""Nick""",q@example.test,"Computer Science",2027,10,,\r\n`,
    );
    assert.equal(d.students.find((x) => x.email === "q@example.test")!.name, 'Last, First "Nick"');
  });

  it("accepts a UTF-8 BOM (Excel adds one) in front of the header", () => {
    const d = fresh();
    const bom = String.fromCharCode(0xfeff);
    const res = engine.uploadStudentsCsv(
      d,
      `${bom}${header}\nBom Case,bom@example.test,CSE,2027,10,,\n`,
    );
    assert.equal(res.addedStudents, 1);
  });

  it("rejects the whole file when any row is invalid — nothing is half-applied", () => {
    const d = fresh();
    const before = JSON.stringify(d);
    const bad = `${header}\nGood One,good@example.test,CSE,2027,50,,\n,missing@example.test,CSE,2027,50,,\nBad Email,nope,CSE,2027,50,,\n`;
    assert.throws(
      () => engine.uploadStudentsCsv(d, bad),
      (e: engine.DemoCsvError) =>
        e instanceof engine.DemoCsvError &&
        e.invalidRows!.some((r) => r.line === 3 && r.missing.includes("name")) &&
        e.invalidRows!.some((r) => r.line === 4 && r.missing.includes("email")),
    );
    assert.equal(JSON.stringify(d), before);
  });

  it("enforces the demo's size and row limits and rejects an empty file", () => {
    const d = fresh();
    const rows = Array.from(
      { length: engine.MAX_DEMO_CSV_ROWS + 1 },
      (_, i) => `S${i},s${i}@example.test,CSE,2027,1,,`,
    ).join("\n");
    assert.throws(
      () => engine.uploadStudentsCsv(d, `${header}\n${rows}`),
      (e: engine.DemoApiError) => e.status === 413,
    );
    assert.throws(
      () => engine.uploadStudentsCsv(d, "x".repeat(engine.MAX_DEMO_CSV_BYTES + 1)),
      (e: engine.DemoApiError) => e.status === 413,
    );
    assert.throws(() => engine.uploadStudentsCsv(d, ""));
    assert.throws(
      () => engine.uploadStudentsCsv(d, header),
      (e: engine.DemoApiError) => e.status === 400,
    );
  });
});
