#!/usr/bin/env node
// step-receipt-chain — evidence capture (v0.1.2). Runs every declared case as a SEPARATE process and
// compares each against the expectations declared BEFORE the run in evidence/declared.json.
//
//   node evidence/capture.mjs
// Exit 0 = every declared disposition matched; 1 = a mismatch; 2 = setup error.
//
// Raw output format (0.1.2): one JSON record per case at evidence/raw/<case>.json holding the exact
// argv, exit code and the verbatim stdout/stderr strings. Earlier versions wrote three files per case
// (.stdout.txt/.stderr.txt/.exit.txt); the managed-hosting intake limit is 64 regular files, and this
// keeps the package at 38 while preserving the same bytes. Deterministic: no timestamps are generated,
// so a re-run on the same Node major reproduces every file byte-for-byte.
//
// The 0.1.1 cases are kept; 0.1.2 adds the content-binding cases (normal-verify-content,
// rehash-structure, rehash-content) that qualify what an unsigned hash chain establishes.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { assess, canonical, sha256 } from "../bin/step-receipt-chain.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const raw = join(here, "raw");
mkdirSync(raw, { recursive: true });
const CLI = join(root, "bin", "step-receipt-chain.mjs");
const rel = (p) => relative(root, p);
const fileSha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const declared = readJson(join(here, "declared.json"));
const failures = [];
const results = {};
const anchors = {};

function run(name, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  writeFileSync(
    join(raw, name + ".json"),
    JSON.stringify({ case: name, argv: [rel(CLI), ...args], exit: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }, null, 2) + "\n",
  );
  console.log(`$ node ${rel(CLI)} ${args.join(" ")}   (exit ${r.status})`);
  let doc = null;
  try {
    doc = JSON.parse(r.stdout);
  } catch {}
  return { r, doc };
}

const norm = (v) => (Array.isArray(v) ? [...new Set(v)].sort() : v);

function check(name, actual) {
  const expected = declared.cases[name].expect;
  const mism = Object.entries(expected).filter(([k, v]) => JSON.stringify(norm(v)) !== JSON.stringify(norm(actual[k])));
  results[name] = { expected, actual, pass: mism.length === 0 };
  console.log(`  ${name}: ${mism.length ? "FAIL " + JSON.stringify(mism) : "PASS"}`);
  if (mism.length) failures.push(name);
}

const codes = (doc) => [...new Set((doc?.errors ?? []).map((e) => e.code))];
const warns = (doc) => [...new Set((doc?.warnings ?? []).map((w) => w.code))];
const confirm = (name, r, doc, extra) =>
  check(name, { exit: r.status, errorCodes: codes(doc), warningCodes: warns(doc), ...(extra ?? {}) });

console.log("step-receipt-chain evidence capture (v0.1.2)");
console.log("node:", process.version, "| platform:", process.platform);
for (const f of ["fixtures/workflow.json", "fixtures/workflow-missing-pin.json", "fixtures/workflow-mismatch.json", "fixtures/legacy-0.1.0-chain.json"])
  console.log(f.padEnd(36), "sha256", fileSha(join(root, f)));
console.log("");

// --- 1-3: normal chain, structure anchor and content anchor --------------------------------
const e1 = run("normal-emit", ["emit", "fixtures/workflow.json", "--out", "evidence/raw/normal-chain.json"]);
const chain = readJson(join(raw, "normal-chain.json"));
check("normal-emit", {
  exit: e1.r.status,
  receipts: chain.chain.length,
  s3Pin: chain.chain[0].checks.inputPin.assessment,
  s3Outcome: chain.chain[0].checks.outcome.assessment,
  s4Outcome: chain.chain[1].checks.outcome.assessment,
  s3Control: chain.chain[0].checks.negativeControl.assessment,
  s4Control: chain.chain[1].checks.negativeControl.assessment,
});

const v1 = run("normal-verify", ["verify", "evidence/raw/normal-chain.json", "--expect-steps", "2", "--expect-ids", "S3,S4"]);
confirm("normal-verify", v1.r, v1.doc, {
  ok: v1.doc?.ok,
  receipts: v1.doc?.receipts,
  integrityErrors: v1.doc?.integrity?.errors?.length ?? null,
  outcomeMatch: v1.doc?.outcome?.match ?? null,
  outcomeMismatch: v1.doc?.outcome?.mismatch ?? null,
  controlFailedAsExpected: v1.doc?.negativeControl?.failedAsExpected ?? null,
  completeness: v1.doc?.completeness?.assessment ?? null,
  contentBound: v1.doc?.completeness?.anchor?.contentBound ?? null,
});

anchors.normalTerminalSha256 = chain.chain[chain.chain.length - 1].selfSha256;
const v2 = run("normal-verify-content", ["verify", "evidence/raw/normal-chain.json", "--expect-terminal-sha256", anchors.normalTerminalSha256]);
confirm("normal-verify-content", v2.r, v2.doc, {
  ok: v2.doc?.ok,
  completeness: v2.doc?.completeness?.assessment ?? null,
  contentBound: v2.doc?.completeness?.anchor?.contentBound ?? null,
});

// --- 4: deliberately invalid (one receipt edited, chain reordered) -------------------------
const a = chain.chain.map((r) => JSON.parse(JSON.stringify(r)));
a[0].observed.status = "FAIL";
writeFileSync(join(raw, "tampered-chain.json"), JSON.stringify({ ...chain, chain: [a[1], a[0]] }, null, 2));
const v3 = run("invalid-verify", ["verify", "evidence/raw/tampered-chain.json", "--expect-steps", "2", "--expect-ids", "S3,S4"]);
confirm("invalid-verify", v3.r, v3.doc, { ok: v3.doc?.ok });

// --- 5: insufficient evidence (missing pin) ------------------------------------------------
const e4 = run("insufficient-emit", ["emit", "fixtures/workflow-missing-pin.json", "--out", "evidence/raw/insufficient-chain.json"]);
const c4 = readJson(join(raw, "insufficient-chain.json"));
check("insufficient-emit", {
  exit: e4.r.status,
  receipts: c4.chain.length,
  s3ObservedStatus: c4.chain[0].observed.status,
  s3Pin: c4.chain[0].checks.inputPin.assessment,
  s3Outcome: c4.chain[0].checks.outcome.assessment,
  s3Control: c4.chain[0].checks.negativeControl.assessment,
});

// --- 6-7: final-receipt removal, anchored and unanchored -----------------------------------
writeFileSync(join(raw, "tail-drop-chain.json"), JSON.stringify({ ...chain, chain: chain.chain.slice(0, -1) }, null, 2));
const v5 = run("tail-drop-verify", ["verify", "evidence/raw/tail-drop-chain.json", "--expect-steps", "2", "--expect-ids", "S3,S4"]);
confirm("tail-drop-verify", v5.r, v5.doc, {
  ok: v5.doc?.ok,
  receipts: v5.doc?.receipts,
  integrityErrors: v5.doc?.integrity?.errors?.length ?? null,
});
const v6 = run("tail-drop-unanchored", ["verify", "evidence/raw/tail-drop-chain.json"]);
confirm("tail-drop-unanchored", v6.r, v6.doc, {
  ok: v6.doc?.ok,
  receipts: v6.doc?.receipts,
  integrityErrors: v6.doc?.integrity?.errors?.length ?? null,
});

// --- 8-10: empty and mis-shaped documents ---------------------------------------------------
// Derived inputs are named input-*: a case record is `<case>.json`, so a document called
// empty-object.json would be overwritten by the record of the case that reads it.
writeFileSync(join(raw, "input-empty-object.json"), "{}\n");
const v7 = run("empty-object", ["verify", "evidence/raw/input-empty-object.json"]);
confirm("empty-object", v7.r, v7.doc, { ok: v7.doc?.ok, invalid: v7.doc?.invalid });

writeFileSync(join(raw, "input-empty-chain.json"), JSON.stringify({ schema: chain.schema, workflow: null, chain: [] }, null, 2));
const v8 = run("empty-chain", ["verify", "evidence/raw/input-empty-chain.json"]);
confirm("empty-chain", v8.r, v8.doc, { ok: v8.doc?.ok, empty: v8.doc?.empty });

writeFileSync(join(raw, "input-wrong-schema.json"), JSON.stringify({ chain: "not-an-array" }, null, 2));
const v9 = run("wrong-schema", ["verify", "evidence/raw/input-wrong-schema.json"]);
confirm("wrong-schema", v9.r, v9.doc, { ok: v9.doc?.ok, invalid: v9.doc?.invalid });

// --- 11: the preserved 0.1.0 chain is refused, not reinterpreted -----------------------------
const v10 = run("superseded-schema", ["verify", "fixtures/legacy-0.1.0-chain.json"]);
confirm("superseded-schema", v10.r, v10.doc, { ok: v10.doc?.ok, invalid: v10.doc?.invalid });

// --- 12-13: outcome mismatch + a negative control that cannot fail ---------------------------
const e11 = run("mismatch-emit", ["emit", "fixtures/workflow-mismatch.json", "--out", "evidence/raw/mismatch-chain.json"]);
const c11 = readJson(join(raw, "mismatch-chain.json"));
check("mismatch-emit", {
  exit: e11.r.status,
  receipts: c11.chain.length,
  s3Outcome: c11.chain[0].checks.outcome.assessment,
  s3Control: c11.chain[0].checks.negativeControl.assessment,
});
const v12 = run("mismatch-verify", ["verify", "evidence/raw/mismatch-chain.json", "--expect-steps", "1", "--expect-ids", "S3"]);
confirm("mismatch-verify", v12.r, v12.doc, { ok: v12.doc?.ok });

// --- 14-15: a rewritten and fully re-hashed chain (the unsigned-hash limit) ------------------
// Mirrors the reported probe: change a recorded field, then recompute every derived check, self hash
// and prev link, exactly as an actor with the tool could. No assessment reads `observed.reviewProbe`,
// so outcome and control still match; only the retained terminal digest reveals the difference.
const rehashed = JSON.parse(JSON.stringify(chain));
rehashed.chain[0].observed.reviewProbe = "modified after original emission";
let prev = null;
for (const receipt of rehashed.chain) {
  receipt.prevReceiptSha256 = prev;
  receipt.checks = assess(receipt.inputs, receipt.expectation, receipt.observed, receipt.negativeControl);
  delete receipt.selfSha256;
  receipt.selfSha256 = sha256(canonical(receipt));
  prev = receipt.selfSha256;
}
writeFileSync(join(raw, "rehashed-chain.json"), JSON.stringify(rehashed, null, 2));
const rehashedTerminal = rehashed.chain[rehashed.chain.length - 1].selfSha256;

const v13 = run("rehash-structure", ["verify", "evidence/raw/rehashed-chain.json", "--expect-steps", "2", "--expect-ids", "S3,S4"]);
confirm("rehash-structure", v13.r, v13.doc, {
  ok: v13.doc?.ok,
  receipts: v13.doc?.receipts,
  integrityErrors: v13.doc?.integrity?.errors?.length ?? null,
  completeness: v13.doc?.completeness?.assessment ?? null,
  contentBound: v13.doc?.completeness?.anchor?.contentBound ?? null,
  terminalDiffers: rehashedTerminal !== anchors.normalTerminalSha256,
});

const v14 = run("rehash-content", ["verify", "evidence/raw/rehashed-chain.json", "--expect-terminal-sha256", anchors.normalTerminalSha256]);
confirm("rehash-content", v14.r, v14.doc, {
  ok: v14.doc?.ok,
  integrityErrors: v14.doc?.integrity?.errors?.length ?? null,
  completeness: v14.doc?.completeness?.assessment ?? null,
  contentBound: v14.doc?.completeness?.anchor?.contentBound ?? null,
});

writeFileSync(
  join(raw, "summary.json"),
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      evidenceFormat: "one JSON record per case: {case, argv, exit, stdout, stderr}; stdout/stderr are verbatim strings",
      anchors,
      results,
      failures,
    },
    null,
    2,
  ) + "\n",
);
console.log("");
console.log(failures.length ? "CAPTURE: MISMATCH " + failures.join(",") : "CAPTURE: all declared dispositions matched");
process.exit(failures.length ? 1 : 0);
