# step-receipt-chain

Turn a multi-step workflow into an **offline-verifiable receipt chain**, and verify it in three
**separate** assessments so a pass on one is never read as a pass on another:

| Assessment | What it decides | Verdicts |
| --- | --- | --- |
| **Integrity** | every `selfSha256` and every `prevReceiptSha256` link, recomputed from the delivered bytes | a receipt changed *without* re-emitting the chain is detected |
| **Outcome** | each recorded result vs the expectation frozen before the run (**subset** comparison) | `MATCH` · `MISMATCH` · `NOT_CHECKED` |
| **Negative control** | a control with `expectedToFail: true` must not satisfy that expectation | `FAILED_AS_EXPECTED` · `DID_NOT_FAIL` · `NOT_PROVIDED` · `NOT_CHECKED` |
| **Completeness** | the chain vs an anchor supplied from **outside** the chain | `checked` · `failed` · `unknown` |

Author: **Workflow Atlas** (`@workflow-atlas`). License: MIT. Zero dependencies. Node >= 18.
Version 0.1.2 — package: **38 regular files**, well inside the managed-hosting intake limits
(2 MiB compressed · 8 MiB expanded · 64 regular files · 512 KiB per file).

## Install / run

No install step: it is a single dependency-free Node script.

```sh
node bin/step-receipt-chain.mjs emit   fixtures/workflow.json --out chain.json   # build a chain
node bin/step-receipt-chain.mjs verify chain.json --expect-steps 2 --expect-ids S3,S4
node bin/step-receipt-chain.mjs verify chain.json --expect-terminal-sha256 <independently recorded digest>
node bin/step-receipt-chain.mjs demo                                            # self-check
node evidence/capture.mjs                                                       # full evidence run
```

## Commands

- `emit <workflow.json> [--out <chain.json>]` — reads a workflow (`steps[]` with
  `id, name, class, level, inputs[], expectation, observed, negativeControl?, omission?`) and prints
  the chained receipts as JSON. **Nothing is executed**: the workflow file *is* a declaration, and
  `emit` freezes, binds and assesses it.
- `verify <chain.json> [anchors]` — prints the result object described below. Anchors:
  `--expect-steps N`, `--expect-ids S3,S4` (ordered), `--expect-terminal-sha256 <hex64>`.
- `demo` — runs the declared dispositions in-process.

**Exit codes:** `0` every performed check passed **and** completeness was anchored · `1` a check
failed or could not be established · `2` usage / input / schema error (the document was not verified).

## What the anchors bind — read this before quoting a result

The hashes are **unkeyed**. Two different situations must not be merged:

1. **Changed without re-hashing** (edited in place, inserted, deleted mid-chain, reordered): detected.
2. **Rewritten and fully re-hashed** (every check, self hash and prev link recomputed): **not
   detectable from the chain itself** — `integrity.ok` stays `true` because the bytes are internally
   consistent. An actor who can change the chain can also recompute it.

| Anchor | Binds | Reported as |
| --- | --- | --- |
| `--expect-steps N`, `--expect-ids S3,S4` | **structure** — count, ids, order | `anchor.binds.structure`, `contentBound: false`, warning `CONTENT_UNBOUND` |
| `--expect-terminal-sha256 <hex64>` | **content** — the terminal receipt and, through the prev links, every earlier receipt, relative to that digest | `anchor.binds.content`, `contentBound: true` |

Only an **independently retained, previously recorded** terminal digest (or a separately
authenticated equivalent) turns "these bytes are consistent" into "the content has not changed since
that record". Where the digest came from, when it was recorded and whether it is trusted are separate
questions this tool cannot answer. No anchor establishes authorship, timing, or that the recorded run
happened. A count or hash stored only *inside* the chain is not an independent anchor.

## Result fields (exact semantics)

| Field | Meaning |
| --- | --- |
| `ok` | `true` only when `errors[]` is empty: integrity consistent, no outcome mismatch, no control that failed to fail, and completeness **anchored and matched**. `ok` does **not** mean content is authentic |
| `receipts` | number of receipts in the chain (the 0.1.0 field `recipes` was renamed to this) |
| `integrity.ok` / `.errors[]` | recomputed self-hash and prev-link result (`RECEIPT_MODIFIED`, `CHAIN_BROKEN`, `CHECKS_STALE`) |
| `outcome.match` / `.mismatch` / `.notChecked` | outcome assessments over all receipts |
| `negativeControl.failedAsExpected` / `.didNotFail` / `.notProvided` / `.notChecked` | control assessments over all receipts |
| `completeness.assessment` | `checked` (anchor supplied and matched) / `failed` (anchor mismatch) / `unknown` (no anchor) |
| `completeness.anchor.binds` | what the supplied anchors constrain: `{structure: [...], content: [...]}` |
| `completeness.anchor.contentBound` | `true` only when a content-binding anchor was supplied |
| `completeness.anchor.limit` | the plain-language limit of what was bound |
| `warnings[]` | `CONTENT_UNBOUND` when only structure was constrained (does not change the exit code) |
| `errors[]` | `RECEIPT_MODIFIED`, `CHAIN_BROKEN`, `CHECKS_STALE`, `OUTCOME_MISMATCH`, `CONTROL_DID_NOT_FAIL`, `CHAIN_INCOMPLETE`, `COMPLETENESS_UNANCHORED`, `INVALID_CHAIN`, `EMPTY_CHAIN`, `UNSUPPORTED_CHAIN_SCHEMA` |

`verify` **recomputes** the assessments from the stored fields and compares them with the file's own
`checks`; a difference is reported as `CHECKS_STALE`. A file can never certify itself.

## Inputs and schema

`emit` takes a workflow object: `{ workflow, at, steps[] }`. `verify` takes a chain document
`{ schema: "workflow-atlas.step-receipt-chain.v0.1.1", workflow, declarationBoundary, chain[] }`.
The document format is unchanged from 0.1.1; package version 0.1.2 changes the verification result
(the anchor binding report and the `CONTENT_UNBOUND` warning), not the chain format.

Each receipt carries: `step` (`id`, `name`, `class`, `level`), `inputs` (`ref` + `sha256`),
`expectation` (`expected`, `frozenAt`, `sha256`), `observed`, `negativeControl`, `checks` (recomputed
by `verify`), `omission`, `prevReceiptSha256`, `selfSha256`.

The **declaration boundary** is stated in the chain: `inputs`, `expectation.expected`,
`expectation.frozenAt`, `observed`, `negativeControl`, `omission` and `at` are **author-supplied and
hash-bound, not verified**; `expectation.sha256`, `checks`, `prevReceiptSha256` and `selfSha256` are
computed by this tool. Hash-binding ties the delivered bytes together; it does not show the declared
run happened, who wrote it, or when.

A malformed document is an input error (exit 2): `{}`, a non-array `chain`, a receipt missing
required fields, or an empty chain (`EMPTY_CHAIN` — reported as empty / no work with completeness
unknown, never as a checked chain). A `v0.1` chain is refused with `UNSUPPORTED_CHAIN_SCHEMA`.

## Evidence

`evidence/declared.json` holds the expectations **declared and committed before the run**;
`evidence/capture.mjs` replays **fifteen** cases as separate processes. Each case is stored as one
JSON record at `evidence/raw/<case>.json` holding the exact argv, exit code and the verbatim
stdout/stderr strings (0.1.2 consolidated three files per case into one to stay inside the 64-file
intake limit). Deterministic: no timestamps are generated, so a re-run on the same Node major
reproduces every file byte-for-byte.

`evidence/history.json` consolidates the earlier evidence so it stays retrievable and hash-verifiable
without inflating the package: set `0.1.0` (the original three-case run) and set `0.1.1-run-1` (the
10/12 run, preserved **before** its one declaration amendment and one implementation correction were
applied). The 0.1.1 run-2 bytes are not duplicated here — they are the delivered 0.1.1 archive.
`fixtures/legacy-0.1.0-chain.json` is the byte-identical 0.1.0 chain used by the compatibility case.

## Changes in 0.1.2

Follow-up from the 0.1.1 precheck (2026-10-28):

1. **Package size.** 0.1.1 shipped 118 regular files; the managed-hosting intake limit is 64, so it
   was rejected with 413 `PACKAGE_LIMIT`. 0.1.2 packs 38: the per-case evidence files were
   consolidated, and the 0.1.0 / 0.1.1-run-1 evidence moved into `evidence/history.json` with
   per-file SHA256 values.
2. **What the anchors establish.** `--expect-steps` / `--expect-ids` were reported with a shared
   `strength` label that also covered `--expect-terminal-sha256`; that made a structure-only anchor
   look like a content check. The result now separates `binds.structure` from `binds.content`, exposes
   `contentBound`, warns `CONTENT_UNBOUND`, and the documentation distinguishes a change made without
   re-hashing (detected) from a full rewrite (not detectable from the chain).
3. **Regression added.** `rehash-structure` and `rehash-content` re-run the reported probe: a modified,
   fully re-hashed chain passes with count/ID anchors (`contentBound: false`) and is caught by the
   retained original terminal digest (`CHAIN_INCOMPLETE`, `integrity.ok` still `true`).

## Changes in 0.1.1

Reported against 0.1.0 on 2026-10-27, with reproducers:

1. **Completeness is no longer assumed.** 0.1.0 returned `ok:true`, `recipes:1` for a chain with its
   final receipt removed. 0.1.1 requires an external anchor and reports `CHAIN_INCOMPLETE` (anchor
   mismatch) or `COMPLETENESS_UNANCHORED` (no anchor) instead.
2. **Invalid input is no longer a success.** 0.1.0 returned `ok:true`, exit 0 for `{}` and for an
   explicitly empty chain, and crashed with a `TypeError` on a non-array `chain`. 0.1.1 validates the
   document and reports `INVALID_CHAIN` / `EMPTY_CHAIN` with exit 2.
3. **The claims now match the checks.** 0.1.0 never compared `observed` with `expectation.expected`
   — `observed.status: PASS` was copied from the author's file — and never enforced that a negative
   control fails, while the description claimed both. 0.1.1 computes and reports outcome and control
   separately, so a false PASS is reported as `MISMATCH` / `DID_NOT_FAIL`.

## What it checks / what it cannot establish

Checks: the delivered chain is internally consistent; a recorded result satisfies the frozen
expectation (subset semantics); a declared negative control fails; and — against an external anchor —
that the chain matches in structure and, if a terminal digest was supplied, in content relative to
that digest. Cannot establish: that the expectation was right or that it predates the observation;
that the author-supplied results are true; content authenticity without an independently trusted
digest; authorship; timing; live-source behaviour; correctness of the underlying work; that
"structurally valid" means "executed".
