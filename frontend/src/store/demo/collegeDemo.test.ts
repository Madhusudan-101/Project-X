// Run with: npm test   (Node's built-in test runner; no extra dependencies)
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as engine from "../../lib/demo/college/engine.ts";
import { useCollegeDemoStore } from "./collegeDemo.ts";

const store = () => useCollegeDemoStore.getState();

describe("demo store — a private, resettable copy of the sample college", () => {
  beforeEach(() => store().reset());

  it("starts from the full sample roster", () => {
    assert.equal(store().data.students.length, 72);
  });

  it("commits a successful mutation", () => {
    store().mutate((d) =>
      engine.createStudent(d, {
        name: "Temp",
        email: "temp@example.test",
        branch: "CSE",
        graduationYear: 2027,
      }),
    );
    assert.equal(store().data.students.length, 73);
  });

  it("rolls back completely when a mutation throws partway", () => {
    const before = JSON.stringify(store().data);
    assert.throws(() =>
      store().mutate((d) => {
        engine.createStudent(d, {
          name: "Half",
          email: "half@example.test",
          branch: "CSE",
          graduationYear: 2027,
        });
        engine.createStudent(d, {
          name: "Dup",
          email: "half@example.test",
          branch: "CSE",
          graduationYear: 2027,
        }); // 409
      }),
    );
    assert.equal(
      JSON.stringify(store().data),
      before,
      "the first insert must not survive the failure",
    );
  });

  it("is copy-on-write: an earlier snapshot is never changed by a later mutation", () => {
    const first = store().data.students[0];
    const originalName = first.name;
    store().mutate((d) => engine.updateStudent(d, first.id, { name: "Changed" }));
    assert.equal(first.name, originalName);
    assert.equal(store().data.students[0].name, "Changed");
  });

  it("reset restores the original sample data", () => {
    store().mutate((d) => engine.removeStudent(d, d.students[0].id));
    store().mutate((d) => engine.removeDrive(d, d.drives[0].id));
    store().reset();
    assert.equal(store().data.students.length, 72);
    assert.equal(store().data.drives.length, 9);
  });
});
