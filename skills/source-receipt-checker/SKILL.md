---
name: source-receipt-checker
description: Check a saved file against a retrieval receipt, offline, and get separate outcomes (integrity, completeness, format) instead of one verdict. An opt-in --live flag makes exactly one GET to the receipt's own URL — redirects not followed, timeout covering headers and body, body capped — and reports unchanged / changed / redirected / too_large / unreachable, where unreachable is never "removed". An unusable pin leaves integrity unknown, not failed.
version: 0.3.1
license: MIT
---

# Source Receipt Checker

Check one saved file against one source receipt, **offline by default**, and get **separate outcomes** back — not one true/false. Pass `--live` to also re-read the receipt's own URL **once**.

## When to use it

- A delivery, post, or pack cites files (CSV, PDF, HTML, JSON) and you want to confirm the files still match what was pinned.
- You are reviewing someone's evidence and want a machine-readable result you can attach.
- You want to catch the quiet failure where an HTML error page was saved under a `.pdf` name, a receipt whose digest is unusable, or a receipt that violates its own declared schema.
- You explicitly want to know whether the **source URL** still returns the pinned bytes (`--live`).

## When NOT to use it

- You want to know whether the data is **correct**. This tool says nothing about correctness — only whether bytes match the pin.
- You want monitoring or crawling. `--live` is **exactly one** GET per invocation; it does not schedule, watch, or follow redirects.

## How to run

Requires Node ≥ 18. Zero dependencies.

```bash
node bin/receipt-check.mjs <receipt.json> <file>            # offline
node bin/receipt-check.mjs <receipt.json> <file> --live     # adds the live check
```

Result JSON on stdout:

```json
{
  "input": { "status": "ok|invalid" },
  "checks": {
    "integrity":    { "status": "pass|fail|unknown", "pin": { "status": "valid|invalid|missing", "normalized": true } },
    "completeness": { "status": "pass|fail", "missing": ["…"], "invalid": [ { "field": "…", "reason": "…" } ] },
    "format":       { "status": "pass|fail|unknown", "declared": "…", "detected": "…", "suspected": true|false },
    "live":         { "status": "unchanged|changed|redirected|too_large|unreachable|no_pin|not_requested", "httpStatus": 200, "expected": "…", "actual": "…" }
  },
  "verdict": "pass|fail|partial",
  "policies": { "…": "…" }
}
```

Input error (exit 2, never a stack):

```json
{ "input": { "status": "error", "code": "RECEIPT_NOT_OBJECT", "message": "…" }, "checks": null, "verdict": "error", "error": { "code": "…", "message": "…" } }
```

Exit codes: `0` pass, `1` fail/partial, `2` input error (`USAGE`, `RECEIPT_UNREADABLE`, `RECEIPT_MALFORMED_JSON`, `RECEIPT_NOT_OBJECT`, `FILE_UNREADABLE`).

## The receipt shape

`schema/source-receipt.schema.json`. Required: `url`, `retrievedAt`, `sourceType`, `contentSha256`. Optional: `schema` (constant `source-receipt-1`), `contentType`, `savedAs`, `excerpt` (≤300), `publisher`, `publishedAt`, `role`, `notes`.

## Rules and policies the tool encodes

1. An incomplete **or unusable** pin is **not** corrupted bytes: `integrity` is `unknown`, never `fail`.
2. Matching bytes can still be the wrong object: `integrity: pass` with `format: fail` is a real, useful state.
3. `completeness` is **not presence-only**: a present-but-invalid field (wrong type, bad enum, non-hex digest, a `schema` that is not the constant, a non-string `notes`) lands in `invalid[]` and fails completeness.
4. `format` is a heuristic and is reported as `suspected`.
5. **Uppercase digest policy (schema-aligned):** the schema pattern is `^[0-9a-fA-F]{64}$`; an uppercase digest is accepted, normalized to lowercase for comparison, and the normalization is reported.
6. **Live (`--live`) — exactly one GET**, no credentials, and:
   - **redirects are NOT followed**; a `3xx` is reported as `redirected`;
   - the **timeout covers headers and body** (default 10 000 ms, `SOURCE_RECEIPT_LIVE_TIMEOUT_MS`); a timeout is `unreachable`;
   - the body is **streamed and capped** (default 8 MiB, `SOURCE_RECEIPT_LIVE_MAX_BYTES`); an oversized body is `too_large` and no digest is computed;
   - `unreachable` (network error, timeout, non-2xx) is **absence of evidence, never evidence of removal**, and no cause is inferred.

## Verify the claim yourself

Run `npm test` — it compares each check, exit code and error code against `fixtures/expected.json` (19 cases), declared before running, and prints the raw result (also saved at `evidence/first-use-run.txt`). The live cases use a local `127.0.0.1` server, so nothing leaves the machine.
