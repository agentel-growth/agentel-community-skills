#!/usr/bin/env node
// step-receipt-chain — `demo`: run the declared dispositions in-process and report them.
// Exit 0 = every declared disposition matched; 1 = a mismatch. Quick local check; the authoritative
// evidence is produced by evidence/capture.mjs, which spawns the CLI as separate processes.
import { emitChain, verifyDocument, canonical, sha256, assess, CHAIN_SCHEMA } from "./step-receipt-chain.mjs";

const PIN = "a".repeat(64);

const workflowNormal = {
  workflow: { id: "example-paginated-fetch", name: "paginated list fetch — 2 steps" },
  at: "2026-10-18T00:00:00Z",
  steps: [
    { id: "S3", name: "fetch page 1; decide from the pointer", class: "D", level: "action",
      inputs: [{ ref: "page1", sha256: PIN }],
      expectation: { expected: { status: "PASS", ids: ["ctr"] }, frozenAt: "2026-10-18T00:00:00Z" },
      observed: { status: "PASS", ids: ["ctr"] },
      negativeControl: { client: "naive items.length", observed: { status: "FAIL", ids: [] }, expectedToFail: true },
      omission: "none observed" },
    { id: "S4", name: "page 2 unavailable", class: "D", level: "outcome",
      inputs: [{ ref: "page2", sha256: PIN }],
      expectation: { expected: { status: "UNKNOWN" }, frozenAt: "2026-10-18T00:00:00Z" },
      observed: { status: "UNKNOWN", ids: [], reason: "page-2 fetch error" },
      omission: "no fallback proposed when page 2 is unavailable" },
  ],
};

const workflowMissingPin = {
  workflow: { id: "example-missing-pin", name: "one step with an unusable input pin" },
  at: "2026-10-18T00:00:00Z",
  steps: [
    { id: "S3", name: "fetch page 1", class: "D", level: "action",
      inputs: [{ ref: "page1", sha256: null }],
      expectation: { expected: { status: "PASS", ids: ["ctr"] }, frozenAt: "2026-10-18T00:00:00Z" },
      observed: { status: "PASS", ids: ["ctr"] },
      omission: "none observed" },
  ],
};

const workflowMismatch = {
  workflow: { id: "adversarial-mismatch", name: "expectation different from the result, control cannot fail" },
  at: "2026-10-27T00:00:00Z",
  steps: [
    { id: "S3", name: "same step, adversarial expectation", class: "D", level: "action",
      inputs: [{ ref: "page1", sha256: PIN }],
      expectation: { expected: { wanted: "completely different" }, frozenAt: "2026-10-27T00:00:00Z" },
      observed: { status: "PASS", ids: ["ctr"] },
      negativeControl: { client: "cannot fail", observed: { wanted: "completely different" }, expectedToFail: true },
      omission: "none observed" },
  ],
};

export function demo() {
  const fails = [];
  const ok = (name, cond, note) => {
    console.log(`  ${name.padEnd(22)} ${cond ? "PASS" : "FAIL"}  ${note}`);
    if (!cond) fails.push(name);
  };
  const codes = (res) => [...new Set(res.errors.map((e) => e.code))];

  const c1 = emitChain(workflowNormal);
  const anchored = verifyDocument(JSON.parse(JSON.stringify(c1)), { steps: 2, ids: ["S3", "S4"] });
  const c1checks = c1.chain.map((r) => r.checks);
  ok("normal", anchored.ok && c1checks[0].outcome.assessment === "MATCH" && c1checks[1].outcome.assessment === "MATCH",
    "ok " + anchored.ok + ", outcomes " + c1checks.map((c) => c.outcome.assessment).join("/") + ", control " + c1checks[0].negativeControl.assessment);

  const tampered = JSON.parse(JSON.stringify(c1));
  tampered.chain[0].observed.status = "FAIL";
  const t = verifyDocument(tampered, { steps: 2 });
  ok("tamper-detected", t.integrity.errors.some((e) => e.code === "RECEIPT_MODIFIED") && !t.integrity.ok, "codes " + codes(t).join(","));

  const c3 = emitChain(workflowMissingPin);
  ok("insufficient", c3.chain[0].observed.status === "UNKNOWN" && c3.chain[0].checks.outcome.assessment === "NOT_CHECKED",
    "status " + c3.chain[0].observed.status + ", outcome " + c3.chain[0].checks.outcome.assessment + " (never a promoted PASS)");

  const prefix = JSON.parse(JSON.stringify(c1));
  prefix.chain = prefix.chain.slice(0, -1);
  const pAnchored = verifyDocument(prefix, { steps: 2, ids: ["S3", "S4"] });
  const pPlain = verifyDocument(JSON.parse(JSON.stringify(prefix)));
  ok("tail-drop-anchored", !pAnchored.ok && codes(pAnchored).includes("CHAIN_INCOMPLETE") && pAnchored.integrity.ok,
    "integrity ok " + pAnchored.integrity.ok + " (the prefix is intact), anchor " + codes(pAnchored).join(","));
  ok("tail-drop-unanchored", !pPlain.ok && codes(pPlain).includes("COMPLETENESS_UNANCHORED"), "codes " + codes(pPlain).join(",") + ", exit is 1 not 0");

  const emptyObj = verifyDocument({});
  ok("empty-object", emptyObj.invalid === true && emptyObj.ok === false, "codes " + codes(emptyObj).join(",") + " (input error, not a pass)");

  const emptyChain = verifyDocument({ schema: CHAIN_SCHEMA, workflow: null, chain: [] });
  ok("empty-chain", emptyChain.empty === true && emptyChain.ok === false, "codes " + codes(emptyChain).join(","));

  const c10 = emitChain(workflowMismatch);
  const m = verifyDocument(JSON.parse(JSON.stringify(c10)), { steps: 1, ids: ["S3"] });
  ok("mismatch+control", codes(m).includes("OUTCOME_MISMATCH") && codes(m).includes("CONTROL_DID_NOT_FAIL"),
    "checks " + c10.chain[0].checks.outcome.assessment + "/" + c10.chain[0].checks.negativeControl.assessment + ", codes " + codes(m).join(","));

  ok("structure-only", anchored.completeness.anchor.contentBound === false && anchored.warnings.some((w) => w.code === "CONTENT_UNBOUND"),
    "contentBound " + anchored.completeness.anchor.contentBound + ", warning " + anchored.warnings.map((w) => w.code).join(",") + " (count/ID anchors do not bind content)");

  const originalTerminal = c1.chain[c1.chain.length - 1].selfSha256;
  const rehashed = JSON.parse(JSON.stringify(c1));
  rehashed.chain[0].observed.reviewProbe = "modified after original emission";
  let prev = null;
  for (const r of rehashed.chain) {
    r.prevReceiptSha256 = prev;
    r.checks = assess(r.inputs, r.expectation, r.observed, r.negativeControl);
    delete r.selfSha256;
    r.selfSha256 = sha256(canonical(r));
    prev = r.selfSha256;
  }
  const rs = verifyDocument(JSON.parse(JSON.stringify(rehashed)), { steps: 2, ids: ["S3", "S4"] });
  const rc = verifyDocument(JSON.parse(JSON.stringify(rehashed)), { terminal: originalTerminal });
  ok("rehash-structure", rs.ok && rs.integrity.ok && rs.completeness.anchor.contentBound === false,
    "rewritten + re-hashed passes with count/ID anchors (ok " + rs.ok + ", contentBound " + rs.completeness.anchor.contentBound + ") — the documented limit");
  ok("rehash-content", !rc.ok && rc.integrity.ok && codes(rc).includes("CHAIN_INCOMPLETE"),
    "integrity still ok " + rc.integrity.ok + "; the retained original digest gives " + codes(rc).join(","));

  console.log(fails.length ? "DEMO: MISMATCH " + fails.join(",") : "DEMO: all declared dispositions matched");
  return fails.length ? 1 : 0;
}
