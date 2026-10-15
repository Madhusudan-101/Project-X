#!/usr/bin/env node
/**
 * Converts the leetcode_OA clone's problem files (TypeScript, with grading logic
 * inside `handlerFunction`) into plain data: statement + examples + hidden tests.
 *
 *   node extract_problems.mjs <clone-root> <out.json> [report.json]
 *
 * How tests are recovered: each handler is run against a spy `fn` that records
 * its arguments and returns an "everything proxy". `assert` is swapped for a
 * recorder that captures what the handler EXPECTED. A problem is only accepted
 * when
 *   - every fn call is followed by exactly one assertion on its raw return value
 *     (no normalisation, no in-place mutation checks),
 *   - args and expected values are plain JSON (no trees / linked lists / classes),
 *   - the recovered table, replayed through the ORIGINAL handler as an oracle
 *     `fn`, makes the handler return true.
 * Everything else is reported with a reason and left out.
 *
 * NOTE: this proves the data is faithful to the handler. It cannot prove the
 * handler's own reference solution is correct — see validate_solutions.py.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import nodeAssert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = require("/opt/node22/lib/node_modules/typescript"); }

const ARGS = process.argv[2] === "--one" ? [process.argv[4], "/dev/null"] : process.argv.slice(2);
const [root, outFile, reportFile] = ARGS;
if (!root || !outFile) { console.error("usage: extract_problems.mjs <clone-root> <out.json> [report.json]"); process.exit(2); }

const PROBLEMS_DIR = path.join(root, "src/utils/problems");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts/manifest.json"), "utf8"));
const meta = new Map(manifest.map((m) => [m.id, m]));

function loadModule(file, assertImpl) {
  const src = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const m = new Module(file);
  m.filename = file;
  m.paths = [];
  const req = (id) => {
    if (id === "assert") return assertImpl;
    if (id.startsWith(".")) return {};            // type-only imports
    return require(id);
  };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", outputText);
  fn(m.exports, req, m, file, path.dirname(file));
  return m.exports;
}

// Every operation on the dummy yields a NEW proxy (tracked in `proxies`), so we can tell
// apart "the raw return value" (=== DUMMY), "something computed from it" (a proxy, not
// DUMMY: e.g. a normalising sort) and "unrelated data" (not a proxy: e.g. a mutated arg).
const proxies = new WeakSet();
function makeProxy() {
  const p = new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.iterator ? function* () {} : k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : makeProxy()),
    apply: () => makeProxy(),
    construct: () => makeProxy(),
  });
  proxies.add(p);
  return p;
}
const everythingProxy = makeProxy;

const isPlain = (v) => {
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlain);
  if (t === "object") {
    const proto = Object.getPrototypeOf(v);
    return (proto === Object.prototype || proto === null) && Object.values(v).every(isPlain);
  }
  return false;
};
const clone = (v) => JSON.parse(JSON.stringify(v));

function recordHandler(handler, silence) {
  const DUMMY = everythingProxy();
  const events = [];
  const rec = (kind) => (actual, expected) => { events.push({ t: "assert", kind, raw: actual === DUMMY, derived: proxies.has(actual), expected }); };
  const assertImpl = Object.assign(() => {}, {
    deepStrictEqual: rec("deepStrictEqual"), deepEqual: rec("deepEqual"),
    strictEqual: rec("strictEqual"), equal: rec("equal"),
    ok: () => events.push({ t: "other" }), notStrictEqual: () => events.push({ t: "other" }),
    notDeepStrictEqual: () => events.push({ t: "other" }), throws: () => events.push({ t: "other" }),
  });
  const spy = (...args) => {
    if (!isPlain(args)) { events.push({ t: "badargs" }); return DUMMY; }
    events.push({ t: "call", args: clone(args) });
    return DUMMY;
  };
  return { DUMMY, events, assertImpl, spy };
}

function processFile(file) {
  let entry = null;
  const id = file.replace(/\.ts$/, "");
  const report = { id, status: "excluded", reason: "" };
  const fail = (reason) => { report.reason = reason; };
  try {
    const log = console.log; console.log = () => {};
    let problem, rec;
    try {
      rec = recordHandler();
      const mod = loadModule(path.join(PROBLEMS_DIR, file), rec.assertImpl);
      problem = Object.values(mod).find((v) => v && typeof v === "object" && v.id && v.starterCode);
      if (!problem) { console.log = log; fail("no Problem export"); return { report, entry: null }; }
      if (typeof problem.handlerFunction !== "function") { console.log = log; fail("handler not a function"); return { report, entry: null }; }
      try { problem.handlerFunction(rec.spy); } catch (e) { console.log = log; fail("handler threw on spy: " + String(e.message).slice(0, 80)); return { report, entry: null }; }
    } finally { console.log = log; }

    const ev = rec.events;
    if (ev.some((e) => e.t === "badargs")) { fail("non-JSON arguments (tree/list/class)"); return { report, entry: null }; }
    if (ev.some((e) => e.t === "other")) { fail("uses non-equality assertions"); return { report, entry: null }; }
    const tests = [];
    let pending = null, bad = "", transformed = false;
    for (const e of ev) {
      if (e.t === "call") { if (pending) { bad = "fn called twice before an assertion"; break; } pending = e; }
      else if (e.t === "assert") {
        if (!pending) { bad = "assertion without a call"; break; }
        if (!e.derived) { bad = "compares something other than the return value (in-place mutation check)"; break; }
        if (!e.raw) transformed = true;
        if (!isPlain(e.expected)) { bad = "expected value isn't plain JSON"; break; }
        tests.push({ args: pending.args, expected: clone(e.expected) }); pending = null;
      }
    }
    if (!bad && pending) bad = "call never asserted";
    if (!bad && tests.length === 0) bad = "no assertions recorded";
    if (bad) { fail(bad); return { report, entry: null }; }

    // dedupe + conflict check
    const table = new Map();
    for (const t of tests) {
      const k = JSON.stringify(t.args);
      if (table.has(k) && JSON.stringify(table.get(k)) !== JSON.stringify(t.expected)) { bad = "same input, different expected"; break; }
      table.set(k, t.expected);
    }
    if (bad) { fail(bad); return { report, entry: null }; }

    // replay through the ORIGINAL handler using the table as the solution
    let replayOk = false;
    try {
      const log = console.log; console.log = () => {};
      try {
        const live = loadModule(path.join(PROBLEMS_DIR, file), nodeAssert);
        const p2 = Object.values(live).find((v) => v && typeof v === "object" && v.id && v.starterCode);
        const oracle = (...args) => { const k = JSON.stringify(args); if (!table.has(k)) throw new Error("unknown input"); return clone(table.get(k)); };
        replayOk = p2.handlerFunction(oracle) === true;
      } finally { console.log = log; }
    } catch (e) { fail("replay failed: " + String(e.message).slice(0, 80)); return { report, entry: null }; }
    if (!replayOk) { fail("replay returned falsy"); return { report, entry: null }; }

    // signature
    const sig = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(problem.starterCode);
    if (!sig) { fail("can't parse starter signature"); return { report, entry: null }; }
    const functionName = sig[1];
    const params = sig[2].split(",").map((s) => s.trim()).filter(Boolean);
    if (tests.some((t) => t.args.length !== params.length)) { fail("arg count != param count"); return { report, entry: null }; }

    // visible examples ("nums = [1,2], target = 3" → args)
    const examples = [];
    let exBad = "";
    for (const ex of problem.examples ?? []) {
      try {
        const parts = []; let depth = 0, q = null, cur = "";
        for (let i = 0; i < ex.inputText.length; i++) {
          const ch = ex.inputText[i];
          if (q) { cur += ch; if (ch === q && ex.inputText[i - 1] !== "\\") q = null; continue; }
          if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
          if ("[{(".includes(ch)) depth++; if ("]})".includes(ch)) depth--;
          if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
          cur += ch;
        }
        if (cur.trim()) parts.push(cur);
        const named = new Map(parts.map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), new Function(`"use strict";return (${p.slice(i + 1).trim()});`)()]; }));
        const args = params.map((n) => { if (!named.has(n)) throw new Error("missing " + n); return named.get(n); });
        const expected = new Function(`"use strict";return (${ex.outputText.trim()});`)();
        if (!isPlain(args) || !isPlain(expected)) throw new Error("non-plain");
        examples.push({ args: clone(args), expected: clone(expected), explanation: ex.explanation ?? null });
      } catch (e) { exBad = "example not parseable: " + String(e.message).slice(0, 60); break; }
    }
    if (exBad || examples.length === 0) { fail(exBad || "no examples"); return { report, entry: null }; }

    const m = meta.get(id) ?? {};
    entry = {
      id, title: String(problem.title).replace(/^\d+\.\s*/, ""),
      difficulty: m.difficulty ?? null, topics: m.topics ?? [],
      statement_html: problem.problemStatement, constraints_html: problem.constraints,
      function_name: functionName, params,
      starter_code: { javascript: problem.starterCode },
      transformed,
      examples, tests: [...table].map(([k, expected]) => ({ args: JSON.parse(k), expected })),
    };
    report.status = "ok"; report.tests = table.size;
  } catch (e) { report.reason = "extractor error: " + String(e.message).slice(0, 100); }
  return { report, entry };
}


import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "--one") {
  const { report, entry } = processFile(process.argv[3]);
  process.stdout.write("\n@@RESULT@@" + JSON.stringify({ report, entry }));
  process.exit(0);
}

const results = [];
const out = [];
for (const file of fs.readdirSync(PROBLEMS_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts").sort()) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--one", file, root], { timeout: 10000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  const id = file.replace(/\.ts$/, "");
  const marker = (r.stdout ?? "").lastIndexOf("@@RESULT@@");
  if (r.error || marker < 0) { results.push({ id, status: "excluded", reason: r.error ? "timed out / crashed (handler didn't terminate against the spy)" : "no result" }); continue; }
  const { report, entry } = JSON.parse(r.stdout.slice(marker + 10));
  results.push(report);
  if (entry) out.push(entry);
}

fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const ok = results.filter((r) => r.status === "ok").length;
const byReason = {};
for (const r of results.filter((r) => r.status !== "ok")) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
const summary = { total: results.length, extracted: ok, excluded: results.length - ok, byReason };
if (reportFile) fs.writeFileSync(reportFile, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
