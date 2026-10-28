#!/usr/bin/env node
// step-receipt-chain v0.1.2 — dependency-free, offline verification for workflow step chains.
//
// 0.1.1 corrected three overclaims reported against 0.1.0. 0.1.2 qualifies what an UNSIGNED hash
// chain can establish at all:
//   * All hashes and links are unkeyed. Integrity therefore checks INTERNAL CONSISTENCY of the
//     delivered bytes. A receipt changed WITHOUT re-emitting the chain is detected; an actor who can
//     rewrite the chain can also recompute every self hash, prev link and derived check, and that
//     rewrite is NOT detectable from the chain itself.
//   * Anchors are split by what they bind: --expect-steps / --expect-ids bind STRUCTURE (count,
//     ids, order) and constrain shape only; --expect-terminal-sha256 binds CONTENT of the whole
//     chain through the prev links, but only if the digest was recorded independently and trusted —
//     the digest's provenance is a separate question this tool cannot answer.
//   * The result states which of the two was bound (`completeness.anchor.binds`,
//     `contentBound`) and warns CONTENT_UNBOUND when only structure was constrained.
//   * COMPLETENESS needs an anchor from outside the chain (COMPLETENESS_UNANCHORED / CHAIN_INCOMPLETE).
//   * The document is SCHEMA-VALIDATED first; invalid/empty input is an exit-2 input error.
//   * INTEGRITY, OUTCOME-vs-EXPECTATION and NEGATIVE-CONTROL are three SEPARATE assessments,
//     recomputed from the stored fields; an unperformed check is never promoted to a success.
//
// What it checks: the delivered chain is internally consistent; each recorded result satisfies the
// expectation frozen before the run (subset comparison); each negative control that declared
// expectedToFail=true does not satisfy that expectation; and, against a supplied anchor, that the
// chain matches in structure and — if a terminal digest was supplied — in content.
// What it does NOT establish: that the recorded values are true, that the chain was not rewritten
// and re-hashed as a whole, content authenticity without an independently trusted digest, authorship,
// timing (a hash binds text, it does not date it), live-source behaviour, or that the work executed
// or achieved its business outcome.
//
// Commands:
//   emit   <workflow.json> [--out <chain.json>]
//   verify <chain.json> [--expect-steps N] [--expect-ids S3,S4] [--expect-terminal-sha256 <hex64>]
//   demo
// Exit codes: 0 ok · 1 a check failed or could not be established · 2 usage / input / schema error.
// No network, no credentials, no dependencies. Node >= 18.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const VERSION = "0.1.2";
export const CHAIN_SCHEMA = "workflow-atlas.step-receipt-chain.v0.1.1";
export const RECEIPT_SCHEMA = "workflow-atlas.step-receipt.v0.1.1";
const SUPERSEDED_CHAIN_SCHEMA = "workflow-atlas.step-receipt-chain.v0.1";
const HEX64 = /^[0-9a-f]{64}$/;

// --- canonical form: recursively sort keys, no whitespace (RFC 8785-style, simplified) ---
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// --- declaration boundary, stated once for the whole chain --------------------------------
export const DECLARATION_BOUNDARY = {
  authorSupplied: ["inputs", "expectation.expected", "expectation.frozenAt", "observed", "negativeControl", "omission", "at"],
  computedHere: ["expectation.sha256", "checks", "prevReceiptSha256", "selfSha256"],
  note:
    "Author-supplied values are hash-bound, not verified. The hashes are unkeyed: they tie the " +
    "delivered bytes together, so a change made without re-emitting the chain is detected, but a whole " +
    "chain rewritten and re-hashed is not. They do not show that the declared run happened, that " +
    "`observed.status` is true, that the expectation was written before the observation, or who wrote it.",
};

// --- freeze an expectation BEFORE the run (the hash binds the text, it does not date it) ---
export function freezeExpectation(stepId, expected, frozenAt) {
  const body = { stepId, expected, frozenAt };
  return { ...body, sha256: sha256(canonical(body)) };
}

function pinUsable(inputs) {
  return (
    Array.isArray(inputs) &&
    inputs.length > 0 &&
    inputs.every((i) => isPlainObject(i) && typeof i.sha256 === "string" && HEX64.test(i.sha256))
  );
}

// Subset comparison: the expectation asserts the fields it names. Every named field must be present
// and equal in the observed result; arrays and scalars must be deep-equal; unnamed observed fields
// are listed as extraKeys and do not decide the result.
export function compareExpected(expected, observed) {
  const missing = [];
  const different = [];
  const walk = (e, o, path) => {
    if (isPlainObject(e)) {
      if (!isPlainObject(o)) {
        different.push({ path: path || "$", expected: e, observed: o });
        return;
      }
      for (const k of Object.keys(e)) {
        const p = path ? `${path}.${k}` : k;
        if (!Object.prototype.hasOwnProperty.call(o, k)) missing.push({ path: p, expected: e[k] });
        else walk(e[k], o[k], p);
      }
      return;
    }
    if (Array.isArray(e)) {
      if (!Array.isArray(o) || canonical(e) !== canonical(o)) different.push({ path: path || "$", expected: e, observed: o });
      return;
    }
    if (canonical(e) !== canonical(o)) different.push({ path: path || "$", expected: e, observed: o });
  };
  walk(expected, observed, "");
  const extraKeys =
    isPlainObject(expected) && isPlainObject(observed)
      ? Object.keys(observed).filter((k) => !Object.prototype.hasOwnProperty.call(expected, k))
      : [];
  return { missing, different, extraKeys };
}

// --- the three assessments, computed from stored fields only (never read from the file's `checks`) ---
export function assess(inputs, expectation, observed, negativeControl) {
  const usable = pinUsable(inputs);
  const hasExpectation =
    isPlainObject(expectation) && expectation.expected !== null && expectation.expected !== undefined;

  let outcome;
  if (!usable) {
    outcome = {
      assessment: "NOT_CHECKED",
      reason: "unusable input pin — insufficient evidence; the recorded result was forced to UNKNOWN and is not compared",
    };
  } else if (!hasExpectation) {
    outcome = { assessment: "NOT_CHECKED", reason: "no expectation declared for this step" };
  } else {
    const cmp = compareExpected(expectation.expected, observed);
    outcome =
      cmp.missing.length || cmp.different.length
        ? {
            assessment: "MISMATCH",
            reason: "the recorded result does not satisfy the frozen expectation (subset comparison over the fields the expectation names)",
            missing: cmp.missing,
            different: cmp.different,
            extraKeys: cmp.extraKeys,
          }
        : {
            assessment: "MATCH",
            reason: "every field the frozen expectation names is present and equal in the recorded result (subset comparison)",
            extraKeys: cmp.extraKeys,
          };
  }

  let control;
  if (!isPlainObject(negativeControl)) {
    control = { assessment: "NOT_PROVIDED", reason: "no negative control declared for this step" };
  } else if (negativeControl.expectedToFail !== true) {
    control = {
      assessment: "NOT_CHECKED",
      reason: "negativeControl.expectedToFail is not true — this is not being used as a negative control",
    };
  } else if (!hasExpectation) {
    control = { assessment: "NOT_CHECKED", reason: "no expectation for the control to fail" };
  } else {
    const cmp = compareExpected(expectation.expected, negativeControl.observed);
    control =
      cmp.missing.length || cmp.different.length
        ? {
            assessment: "FAILED_AS_EXPECTED",
            reason: "the control's recorded result does not satisfy the expectation (a control that cannot fail measures nothing)",
          }
        : {
            assessment: "DID_NOT_FAIL",
            reason: "the control's recorded result SATISFIES the expectation — this control cannot fail the check it is attached to",
          };
  }

  return {
    inputPin: {
      assessment: usable ? "OK" : "UNUSABLE",
      reason: usable
        ? "at least one input bound by reference (ref + sha256)"
        : "missing or unusable input pin — the recorded result was forced to UNKNOWN, never a false PASS",
    },
    outcome,
    negativeControl: control,
  };
}

// --- one step receipt, chained to the previous step's receipt ---
export function makeReceipt({ step, inputs = [], expectation, observed, negativeControl, omission, prev = null, at }) {
  const body = {
    schema: RECEIPT_SCHEMA,
    step: { id: step.id, name: step.name ?? null, class: step.class ?? null, level: step.level ?? null },
    inputs: inputs.map((i) => ({ ref: i?.ref ?? null, sha256: i?.sha256 ?? null })), // bound by reference, never retyped
    expectation, // frozen before the run; carries its own hash
    observed, // AUTHOR DECLARATION (forced to UNKNOWN when the input pin is unusable)
    negativeControl: negativeControl ?? null, // AUTHOR DECLARATION
    checks: assess(inputs, expectation, observed, negativeControl), // computed here; `verify` recomputes
    omission: omission || "none observed",
    prevReceiptSha256: prev ? prev.selfSha256 : null,
    at: at ?? null,
  };
  return { ...body, selfSha256: sha256(canonical(body)) };
}

// --- build a receipt chain from a workflow file. Nothing is executed: the file IS a declaration.
export function emitChain(workflow) {
  if (!isPlainObject(workflow) || !Array.isArray(workflow.steps)) {
    throw Object.assign(new Error("workflow must be a JSON object with a steps[] array"), { code: "INVALID_WORKFLOW" });
  }
  if (workflow.steps.length === 0) {
    throw Object.assign(
      new Error("workflow has no steps — an empty workflow is not a checked chain (completeness unknown)"),
      { code: "EMPTY_WORKFLOW" },
    );
  }
  const receipts = [];
  let prev = null;
  workflow.steps.forEach((step, i) => {
    if (!isPlainObject(step) || typeof step.id !== "string" || step.id.length === 0) {
      throw Object.assign(new Error(`workflow.steps[${i}] must be an object with a non-empty string id`), {
        code: "INVALID_WORKFLOW",
      });
    }
    const inputs = Array.isArray(step.inputs) ? step.inputs : [];
    const usable = pinUsable(inputs);
    const observed = usable
      ? isPlainObject(step.observed)
        ? { ...step.observed }
        : {}
      : { status: "UNKNOWN", ids: [], reason: "input pin missing or unusable — insufficient evidence" };
    const negativeControl = isPlainObject(step.negativeControl) ? { ...step.negativeControl } : null;
    const expectation = freezeExpectation(step.id, step.expectation?.expected ?? null, step.expectation?.frozenAt ?? null);
    receipts.push(
      makeReceipt({
        step,
        inputs,
        expectation,
        observed,
        negativeControl,
        omission: step.omission,
        prev,
        at: step.at ?? workflow.at ?? null,
      }),
    );
    prev = receipts[receipts.length - 1];
  });
  return {
    schema: CHAIN_SCHEMA,
    version: VERSION,
    workflow: workflow.workflow ?? null,
    declarationBoundary: DECLARATION_BOUNDARY,
    chain: receipts,
  };
}

// --- schema validation: an invalid document is an input error, not a verification result ---
const invalid = (path, detail, code = "INVALID_CHAIN") => ({ code, path, detail });

function validateReceipt(r, i) {
  const at = (f) => `$.chain[${i}]${f ? "." + f : ""}`;
  if (!isPlainObject(r)) return [invalid(at(), `receipt must be an object (got ${Array.isArray(r) ? "array" : typeof r})`)];
  const e = [];
  if (r.schema !== RECEIPT_SCHEMA) e.push(invalid(at("schema"), `expected ${RECEIPT_SCHEMA}, got ${JSON.stringify(r.schema ?? null)}`));
  if (!isPlainObject(r.step) || typeof r.step.id !== "string" || !r.step.id) e.push(invalid(at("step"), "step must be an object with a non-empty string id"));
  if (!isPlainObject(r.expectation)) e.push(invalid(at("expectation"), "expectation must be an object"));
  else {
    if (!Object.prototype.hasOwnProperty.call(r.expectation, "expected")) e.push(invalid(at("expectation.expected"), "missing (may be null, but the key must be present)"));
    if (typeof r.expectation.sha256 !== "string" || !HEX64.test(r.expectation.sha256)) e.push(invalid(at("expectation.sha256"), "must be a 64-char lowercase hex hash"));
  }
  if (!isPlainObject(r.observed) || typeof r.observed.status !== "string") e.push(invalid(at("observed"), "observed must be an object with a string status (it is an author declaration, but it must be well-formed)"));
  if (r.negativeControl !== null && r.negativeControl !== undefined && !isPlainObject(r.negativeControl)) e.push(invalid(at("negativeControl"), "must be null or an object"));
  if (!isPlainObject(r.checks)) e.push(invalid(at("checks"), "checks must be an object (integrity / outcome / negativeControl assessments)"));
  else {
    const allowed = { outcome: ["MATCH", "MISMATCH", "NOT_CHECKED"], negativeControl: ["FAILED_AS_EXPECTED", "DID_NOT_FAIL", "NOT_PROVIDED", "NOT_CHECKED"], inputPin: ["OK", "UNUSABLE"] };
    for (const [k, values] of Object.entries(allowed)) {
      const a = r.checks[k]?.assessment;
      if (!values.includes(a)) e.push(invalid(at(`checks.${k}.assessment`), `must be one of ${values.join(" | ")}, got ${JSON.stringify(a ?? null)}`));
    }
  }
  if (typeof r.selfSha256 !== "string" || !HEX64.test(r.selfSha256)) e.push(invalid(at("selfSha256"), "must be a 64-char lowercase hex hash"));
  if (r.prevReceiptSha256 !== null && !(typeof r.prevReceiptSha256 === "string" && HEX64.test(r.prevReceiptSha256))) e.push(invalid(at("prevReceiptSha256"), "must be null on the first receipt or a 64-char lowercase hex hash"));
  if (typeof r.omission !== "string") e.push(invalid(at("omission"), "must be a string"));
  return e;
}

export function validateDocument(doc) {
  if (!isPlainObject(doc)) {
    return [invalid("$", `chain document must be a JSON object (got ${Array.isArray(doc) ? "array" : typeof doc})`)];
  }
  // A superseded chain is refused for one reason: its version. Reporting every receipt-level field
  // as invalid as well would bury the actual cause.
  if (doc.schema === SUPERSEDED_CHAIN_SCHEMA) {
    return [
      invalid("$.schema", `v0.1 chains have different semantics; re-emit with ${CHAIN_SCHEMA}`, "UNSUPPORTED_CHAIN_SCHEMA"),
    ];
  }
  const e = [];
  if (doc.schema !== CHAIN_SCHEMA) {
    e.push(invalid("$.schema", `expected ${CHAIN_SCHEMA}, got ${JSON.stringify(doc.schema ?? null)}`));
  }
  if (!Array.isArray(doc.chain)) e.push(invalid("$.chain", "chain must be an array of receipts"));
  else doc.chain.forEach((r, i) => e.push(...validateReceipt(r, i)));
  return e;
}

// --- integrity: recompute self hashes and prev links offline (recomputed, never trusted) ---
export function verifyChain(receipts) {
  const errors = [];
  let prev = null;
  receipts.forEach((r, i) => {
    const { selfSha256, ...body } = r;
    if (sha256(canonical(body)) !== selfSha256)
      errors.push({ code: "RECEIPT_MODIFIED", at: i, step: r.step?.id ?? null, detail: "self hash mismatch (receipt content changed after emit)" });
    const expectedPrev = prev ? prev.selfSha256 : null;
    if (r.prevReceiptSha256 !== expectedPrev)
      errors.push({ code: "CHAIN_BROKEN", at: i, step: r.step?.id ?? null, detail: "prev link mismatch (a step was inserted, deleted or reordered)" });
    prev = r;
  });
  return errors;
}

// --- completeness: only an anchor supplied from outside the chain can establish it ---
export function completeness(receipts, anchors = {}) {
  const ids = receipts.map((r) => r.step?.id ?? null);
  const supplied = [];
  const structure = [];
  const content = [];
  const mismatch = [];
  if (anchors.steps !== undefined) {
    supplied.push("expect-steps");
    structure.push("step count");
    if (receipts.length !== anchors.steps) mismatch.push({ anchor: "expect-steps", expected: anchors.steps, actual: receipts.length });
  }
  if (anchors.ids !== undefined) {
    supplied.push("expect-ids");
    structure.push("step ids and their order");
    if (canonical(anchors.ids) !== canonical(ids)) mismatch.push({ anchor: "expect-ids", expected: anchors.ids, actual: ids });
  }
  if (anchors.terminal !== undefined) {
    supplied.push("expect-terminal-sha256");
    content.push("the terminal receipt's self hash, and through the prev links the bytes of every earlier receipt");
    const actual = receipts.length ? receipts[receipts.length - 1].selfSha256 ?? null : null;
    if (actual !== anchors.terminal) mismatch.push({ anchor: "expect-terminal-sha256", expected: anchors.terminal, actual });
  }
  if (supplied.length === 0) {
    return {
      assessment: "unknown",
      anchor: null,
      mismatch: [],
      reason:
        "no external anchor supplied — the delivered bytes are internally consistent, but a valid prefix is indistinguishable from a complete chain",
    };
  }
  const anchor = {
    supplied,
    binds: { structure, content },
    contentBound: content.length > 0,
    limit: content.length
      ? "content is bound only relative to the supplied digest; whether that digest was recorded independently, and before the rewrite, is outside this tool"
      : "structure only — a chain rewritten in full and re-hashed with the same step count and ids still matches this anchor; bind content with --expect-terminal-sha256 from an independently recorded digest",
  };
  if (mismatch.length) {
    return {
      assessment: "failed",
      anchor,
      mismatch,
      reason: "the chain does not match the supplied external anchor",
    };
  }
  return {
    assessment: "checked",
    anchor,
    mismatch: [],
    reason: "the chain matches the supplied external anchor (an anchor stored inside the chain is not independent)",
  };
}

// --- the verification result ------------------------------------------------------------------
export function verifyDocument(doc, anchors = {}) {
  const validation = validateDocument(doc);
  if (validation.length) {
    return {
      ok: false,
      invalid: true,
      receipts: 0,
      integrity: { ok: false, receiptsChecked: 0, errors: [] },
      outcome: { match: 0, mismatch: 0, notChecked: 0 },
      negativeControl: { failedAsExpected: 0, didNotFail: 0, notProvided: 0, notChecked: 0 },
      completeness: { assessment: "unknown", anchor: null, mismatch: [], reason: "document did not validate" },
      warnings: [],
      errors: validation,
    };
  }
  const receipts = doc.chain;
  if (receipts.length === 0) {
    return {
      ok: false,
      empty: true,
      receipts: 0,
      integrity: { ok: false, receiptsChecked: 0, errors: [] },
      outcome: { match: 0, mismatch: 0, notChecked: 0 },
      negativeControl: { failedAsExpected: 0, didNotFail: 0, notProvided: 0, notChecked: 0 },
      completeness: { assessment: "unknown", anchor: null, mismatch: [], reason: "empty chain — no work, completeness not established" },
      warnings: [],
      errors: [invalid("$.chain", "chain is empty: an empty chain is not a checked chain (no work, completeness unknown)", "EMPTY_CHAIN")],
    };
  }

  const integrityErrors = verifyChain(receipts);
  const outcome = { match: 0, mismatch: 0, notChecked: 0 };
  const control = { failedAsExpected: 0, didNotFail: 0, notProvided: 0, notChecked: 0 };
  const errors = [...integrityErrors];

  receipts.forEach((r, i) => {
    const recomputed = assess(r.inputs, r.expectation, r.observed, r.negativeControl);
    if (canonical(recomputed) !== canonical(r.checks)) {
      errors.push({
        code: "CHECKS_STALE",
        at: i,
        step: r.step?.id ?? null,
        detail: "the stored checks differ from the recomputed ones (the receipt was emitted under different comparison semantics)",
      });
    }
    const o = recomputed.outcome.assessment;
    if (o === "MATCH") outcome.match++;
    else if (o === "MISMATCH") {
      outcome.mismatch++;
      errors.push({
        code: "OUTCOME_MISMATCH",
        at: i,
        step: r.step?.id ?? null,
        detail: recomputed.outcome.reason,
        missing: recomputed.outcome.missing ?? [],
        different: recomputed.outcome.different ?? [],
      });
    } else outcome.notChecked++;

    const c = recomputed.negativeControl.assessment;
    if (c === "FAILED_AS_EXPECTED") control.failedAsExpected++;
    else if (c === "DID_NOT_FAIL") {
      control.didNotFail++;
      errors.push({ code: "CONTROL_DID_NOT_FAIL", at: i, step: r.step?.id ?? null, detail: recomputed.negativeControl.reason });
    } else if (c === "NOT_PROVIDED") control.notProvided++;
    else control.notChecked++;
  });

  const comp = completeness(receipts, anchors);
  if (comp.assessment === "unknown") {
    errors.push({ code: "COMPLETENESS_UNANCHORED", at: null, step: null, detail: comp.reason });
  } else if (comp.assessment === "failed") {
    errors.push({ code: "CHAIN_INCOMPLETE", at: null, step: null, detail: comp.reason, mismatch: comp.mismatch });
  }

  const warnings = [];
  if (comp.assessment === "checked" && !comp.anchor.contentBound) {
    warnings.push({ code: "CONTENT_UNBOUND", detail: comp.anchor.limit });
  }

  return {
    ok: errors.length === 0,
    receipts: receipts.length,
    integrity: { ok: integrityErrors.length === 0, receiptsChecked: receipts.length, errors: integrityErrors },
    outcome,
    negativeControl: control,
    completeness: comp,
    warnings,
    errors,
  };
}

// --- CLI ---------------------------------------------------------------------------------------
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function parseAnchors(rest) {
  const anchors = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--expect-steps") {
      const v = rest[++i];
      if (!/^\d+$/.test(String(v ?? ""))) throw Object.assign(new Error("--expect-steps requires a non-negative integer"), { code: "USAGE" });
      anchors.steps = Number(v);
    } else if (a === "--expect-ids") {
      const v = String(rest[++i] ?? "");
      if (!v) throw Object.assign(new Error("--expect-ids requires a comma-separated list of step ids"), { code: "USAGE" });
      anchors.ids = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--expect-terminal-sha256") {
      const v = String(rest[++i] ?? "");
      if (!HEX64.test(v)) throw Object.assign(new Error("--expect-terminal-sha256 requires a 64-char lowercase hex hash"), { code: "USAGE" });
      anchors.terminal = v;
    }
  }
  return anchors;
}

function fail(message, code = "USAGE") {
  console.log(JSON.stringify({ ok: false, errors: [{ code, path: null, detail: message }] }, null, 2));
  console.error(`step-receipt-chain: ${message}`);
  process.exit(2);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "emit") {
    const file = rest[0];
    if (!file || file.startsWith("--")) fail("usage: emit <workflow.json> [--out <chain.json>]");
    let chain;
    try {
      chain = emitChain(readJson(file));
    } catch (err) {
      return fail(`${file}: ${err.message}`, err.code ?? "INVALID_WORKFLOW");
    }
    const outIdx = rest.indexOf("--out");
    const text = JSON.stringify(chain, null, 2);
    if (outIdx !== -1 && rest[outIdx + 1]) writeFileSync(rest[outIdx + 1], text);
    console.log(text);
    process.exit(0);
  }
  if (cmd === "verify") {
    const file = rest.find((a) => !a.startsWith("--"));
    if (!file) fail("usage: verify <chain.json> [--expect-steps N] [--expect-ids S3,S4] [--expect-terminal-sha256 <hex64>]");
    let anchors;
    try {
      anchors = parseAnchors(rest);
    } catch (err) {
      return fail(err.message);
    }
    let doc;
    try {
      doc = readJson(file);
    } catch (err) {
      return fail(`${file}: not readable as JSON — ${err.message}`);
    }
    const result = verifyDocument(doc, anchors);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.invalid || result.empty ? 2 : result.ok ? 0 : 1);
  }
  if (cmd === "demo") {
    const { demo } = await import("./demo.mjs").catch(() => ({ demo: null }));
    if (demo) process.exit(demo());
    console.error("demo module not found");
    process.exit(2);
  }
  fail("usage: step-receipt-chain <emit|verify|demo> [args]");
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
