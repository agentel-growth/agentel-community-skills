---
name: step-receipt-chain
description: Turn a multi-step workflow into an offline-verifiable receipt chain and verify it in three SEPARATE assessments — integrity (recomputed self hashes and prev links detect a receipt changed WITHOUT re-emitting the chain), outcome (each recorded result is compared against the expectation frozen before the run, subset semantics), and negative control (a control that declared expectedToFail=true must not satisfy that expectation). Completeness requires an anchor supplied from OUTSIDE the chain. The hashes are unkeyed and unsigned: they establish internal consistency, not authenticity — an actor who can rewrite the chain can also recompute every hash, so only an independently recorded terminal digest (--expect-terminal-sha256) binds content, and only relative to that digest. Count and step-id anchors constrain shape and order only. It does not establish authorship, timing, that the author-supplied observed values are true, live-source behaviour, or that the work executed or achieved its business outcome.
---

# Step Receipt Chain

Wrap every handoff in a receipt a stranger can verify offline, and report four things
**separately** so a pass on one is never read as a pass on another.

## What it checks

- **Integrity.** Every receipt's `selfSha256` and every `prevReceiptSha256` link are recomputed from
  the delivered bytes. A receipt **changed without re-emitting the chain** — edited in place, inserted,
  deleted mid-chain, or reordered — is detected. This is *internal consistency of the delivered bytes*.
- **Outcome vs expectation.** Each recorded result is compared against the expectation frozen before
  the run, with **subset semantics**: the expectation asserts the fields it names, each named field
  must be present and equal in the result, arrays and scalars must be deep-equal, and unnamed fields
  in the result are listed as `extraKeys` without deciding the verdict. Result:
  `MATCH` / `MISMATCH` / `NOT_CHECKED`.
- **Negative control.** A control with `expectedToFail: true` must **not** satisfy the same
  expectation. Result: `FAILED_AS_EXPECTED` / `DID_NOT_FAIL` / `NOT_PROVIDED` / `NOT_CHECKED`.
  A control that cannot fail measures nothing and is reported as such — it does not become a pass.
- **Completeness.** Only an anchor supplied from **outside** the chain can establish it. Anchors are
  reported by what they bind (see the next section). Anchor mismatch → `CHAIN_INCOMPLETE`; no anchor →
  `COMPLETENESS_UNANCHORED` and exit 1, because a valid prefix is indistinguishable from a complete
  chain.

## What an unsigned hash chain can and cannot establish

All hashes here are **unkeyed**. That has a precise consequence, and the two cases must not be merged:

| Case | Result |
| --- | --- |
| A record is changed **without** recomputing the chain (edit in place, insert, delete mid-chain, reorder) | **Detected** — `RECEIPT_MODIFIED` / `CHAIN_BROKEN` / `CHECKS_STALE` |
| The chain is **rewritten and fully re-hashed** (every check, self hash and prev link recomputed) | **Not detectable from the chain itself** — `integrity.ok` is `true`, because the bytes are internally consistent |

An actor who can change the chain can also recompute it. Therefore:

- `--expect-steps` and `--expect-ids` bind **structure** — count, ids, order. They constrain the
  *shape* of the chain and nothing about its content. The result reports
  `completeness.anchor.binds.structure` with `contentBound: false`, and emits the warning
  `CONTENT_UNBOUND` rather than implying more.
- `--expect-terminal-sha256` binds **content**: the terminal receipt's self hash covers its own body
  including `prevReceiptSha256`, so the whole chain is pinned *through the prev links* — but only
  relative to **that digest**. Where the digest came from, when it was recorded, and whether it is
  trusted are separate questions this tool cannot answer. An independently retained, previously
  recorded terminal digest (or a separately authenticated equivalent) is what turns "the file is
  consistent" into "the content has not changed since that record".
- Neither anchor establishes **who** produced the chain, **when**, or that the recorded run happened.

Completeness follows the same rule: a count or hash stored only *inside* the chain travels with
whatever is under test and is not an independent anchor.

## What it does NOT establish

- That the frozen expectation was the right one.
- That the expectation was written **before** the observation. A hash binds text; it does not date it.
  `frozenAt` is an author declaration.
- That the author-supplied `observed` / `negativeControl` values are true. They are hash-bound
  declarations, listed in the chain's `declarationBoundary`.
- Authorship, provenance or content authenticity of the chain as a whole (see above).
- Live-source behaviour, or that a live scope was fully enumerated.
- That the underlying work is correct, or that a structurally valid chain means the work *executed*
  or achieved its business outcome.
- Anything about a step's object beyond its own pin — that object can be checked separately (see
  "Compose with").

## The step ledger (per step)

`class` = `D` (deterministic) / `J` (judgment) / `H` (human gate). `level` = `prepared` / `action` /
`outcome` — a claim may only be cited at the level whose receipt exists (this level vocabulary is
credited to Applied AI's Receipt Schema). `inputs` are bound **by reference** (`ref` + `sha256`),
never retyped. `omission` records what was **not** done; unfinished work travels with the receipt.

## Insufficient evidence

A missing or unusable input pin forces the recorded result to `UNKNOWN` **and** the outcome
assessment to `NOT_CHECKED` — never a false PASS, and never a promoted verified success. "Nobody
pinned it" is not "it is wrong": an unusable pin is absence of evidence, kept distinct from failure.

## Commands

```
node bin/step-receipt-chain.mjs emit   <workflow.json> [--out <chain.json>]
node bin/step-receipt-chain.mjs verify <chain.json> [--expect-steps N] [--expect-ids S3,S4] [--expect-terminal-sha256 <hex64>]
node bin/step-receipt-chain.mjs demo
```

Exit codes: `0` every performed check passed **and** completeness was anchored; `1` a check failed
or could not be established; `2` usage / input / schema error — the document was not verified at all.
Warnings (`CONTENT_UNBOUND`) do not change the exit code; they name a limit of what was bound.

`verify` output: `ok`, `receipts`, `integrity{ok, receiptsChecked, errors[]}`, `outcome{match,
mismatch, notChecked}`, `negativeControl{failedAsExpected, didNotFail, notProvided, notChecked}`,
`completeness{assessment, anchor{supplied, binds{structure, content}, contentBound, limit}, mismatch[],
reason}`, `warnings[]`, `errors[]` with codes `RECEIPT_MODIFIED`, `CHAIN_BROKEN`, `CHECKS_STALE`,
`OUTCOME_MISMATCH`, `CONTROL_DID_NOT_FAIL`, `CHAIN_INCOMPLETE`, `COMPLETENESS_UNANCHORED`,
`INVALID_CHAIN`, `EMPTY_CHAIN`, `UNSUPPORTED_CHAIN_SCHEMA`. `verify` **recomputes** the assessments
from the stored fields; it never trusts the file's own `checks`, so a document cannot certify itself.

An invalid, mis-shaped or empty chain document is an input error (exit 2) — `{}`, a non-array
`chain`, a receipt missing required fields, or a chain with no receipts are all reported, never
treated as a successful verification. Chains from the 0.1.0 format (`…v0.1`) are refused with
`UNSUPPORTED_CHAIN_SCHEMA` rather than silently reinterpreted.

## Compose with

Applied AI's *Source Receipt Checker* checks one saved file against one retrieval receipt
(integrity / completeness / format). This skill anchors the **seams between steps**; that one anchors
the **object inside a step**. Use both: verify the chain here, the artifact there. Neither substitutes
for an independently recorded digest when content authenticity matters.

## Offline verification

No network, no credentials, no dependencies. Node >= 18. `verify` reports the exact position of a
break and never "repairs" a broken hash.
