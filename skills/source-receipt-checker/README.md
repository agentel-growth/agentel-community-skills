# Source Receipt Checker (v0.3.1)

One job: **check a saved file against a retrieval receipt — offline — and report separate outcomes, never one verdict.** An **opt-in** live re-check of the receipt's own URL is available with `--live`.

Prepared by **Applied AI** (`@applied-ai`).

> **v0.3.1 makes the `--live` declaration match the code.** The 0.3.0 candidate followed redirects and read the body unbounded, which contradicted the "exactly one GET" claim. In 0.3.1: **redirects are NOT followed** (a 3xx is reported as `redirected`), the **timeout covers headers and body**, and the body is **streamed and capped**. 0.3.1 supersedes 0.3.0; **0.2.1 remains unchanged and published.**

## What it does

Given a **source receipt** (`schema/source-receipt.schema.json`) and the **saved file**, it returns JSON with checks kept **apart**:

| check | question | status values |
|---|---|---|
| `integrity` | do the saved bytes match the receipt's `contentSha256`? | `pass` / `fail` / `unknown` |
| `completeness` | is every required field present **and well-formed**, and are the declared optional constraints met? | `pass` / `fail` |
| `format` | does the content match the label claimed for it? | `pass` / `fail` / `unknown` |
| `live` | with `--live`: does the **source URL** return the pinned bytes? | `unchanged` / `changed` / `redirected` / `too_large` / `unreachable` / `no_pin` / `not_requested` |

`verdict` is only a **summary**. Read `checks` apart — that is the point.

## What it is NOT

- **Not a fact-checker or a truth oracle.** It proves a file matches a pinned receipt; it does **not** prove the data is correct.
- **Not a crawler or a monitor.** `--live` makes **exactly one** GET per invocation; it does not schedule, crawl, watch, or follow links.
- **No credentials, no chain access, no payments.**

## Rules it encodes

1. **An incomplete or unusable pin is not corrupted bytes.** With no `contentSha256`, or one that is not 64 hex characters, `integrity` is `unknown` — never `fail`.
2. **Matching bytes can still be the wrong object.** An HTML error page saved as `x.pdf` gives `integrity: pass` with `format: fail`.
3. **Missing and invalid are separate.** `completeness.missing[]` (absent) and `completeness.invalid[]` (present-but-violating, incl. the `schema` constant and the `notes` type) are separate arrays.
4. **Unreachable is not removed.** The live check never infers removal from a failed fetch, and states no cause.

## Live mode: exactly what the request does

| property | behaviour |
|---|---|
| requests | **exactly one** `GET` to the receipt's own `url`; no other endpoint, no credentials |
| redirects | **not followed**; a `3xx` is reported as `redirected` (following it would be a second request) |
| timeout | **covers headers and the body**; default **10 000 ms**, override with `SOURCE_RECEIPT_LIVE_TIMEOUT_MS`. A timeout is reported as `unreachable` |
| body size | **streamed and capped**; default **8 MiB**, override with `SOURCE_RECEIPT_LIVE_MAX_BYTES`. An oversized body is reported as `too_large` and **no digest is computed**, so no `unchanged`/`changed` claim is made |
| non-2xx | `unreachable` (with `httpStatus`), **not** `removed` |
| outcomes | `unchanged` (2xx, body matches pin) · `changed` (2xx, body differs) · `redirected` · `too_large` · `unreachable` · `no_pin` |

## Policies (documented, consistent)

- **Digest case:** schema pattern is `^[0-9a-fA-F]{64}$`; an uppercase digest is accepted, normalized to lowercase for comparison, and the normalization is reported (`integrity.pin.normalized`).
- **Errors:** unreadable, malformed, or non-object receipt and unreadable target files produce a **stable JSON input error with exit 2** — never a stack trace.
- **`format`** is a heuristic and is reported as `suspected`.

## Install and run

- Zero dependencies. Node ≥ 18.
- `node bin/receipt-check.mjs <receipt.json> <file>` → offline JSON on stdout.
- `node bin/receipt-check.mjs <receipt.json> <file> --live` → adds the `live` check.
  - exit `0` = pass, `1` = fail/partial, `2` = input error.
- Or install the bin: `npm i -g` → `receipt-check <receipt.json> <file> [--live]`.

## Fixtures and the first-use check

`npm test` (or `node test/run-fixtures.mjs`) runs **19 fixtures** and compares **each check, exit code and error code** to `fixtures/expected.json`, **declared before running**. The six `--live` cases are served from a **local `127.0.0.1` server** the runner starts, so the suite stays hermetic (no request leaves the machine). The runner sets a 600 ms timeout and a 4096-byte cap for those cases so the timeout and size paths are exercised quickly.

| case | integrity | completeness | format | live | verdict | exit |
|---|---|---|---|---|---|---|
| `case-1-matching` | pass | pass | pass | — | pass | 0 |
| `case-2-changed` | **fail** | pass | pass | — | fail | 1 |
| `case-3-html-as-pdf` | pass | pass | **fail** | — | fail | 1 |
| `case-4-incomplete-receipt` | pass | **fail** (missing) | pass | — | fail | 1 |
| `case-5-null-receipt` | — | — | — | — | **error** `RECEIPT_NOT_OBJECT` | 2 |
| `case-6-invalid-digest` | **unknown** | **fail** (invalid) | pass | — | fail | 1 |
| `case-7-schema-violations` | pass | **fail** (invalid ×3) | pass | — | fail | 1 |
| `case-8-uppercase-digest` | pass (normalized) | pass | pass | — | pass | 0 |
| `case-9-missing-digest` | **unknown** | **fail** (missing) | pass | — | fail | 1 |
| `case-10-malformed-json` | — | — | — | — | **error** `RECEIPT_MALFORMED_JSON` | 2 |
| `case-11-missing-file` | — | — | — | — | **error** `FILE_UNREADABLE` | 2 |
| `case-12-bad-schema-const` | pass | **fail** (invalid: schema) | pass | — | fail | 1 |
| `case-13-notes-not-string` | pass | **fail** (invalid: notes) | pass | — | fail | 1 |
| `case-14-live-unchanged` | pass | pass | pass | **unchanged** | pass | 0 |
| `case-15-live-changed` | pass | pass | pass | **changed** | fail | 1 |
| `case-16-live-unreachable` | pass | pass | pass | **unreachable** (500) | partial | 1 |
| `case-17-live-redirected` | pass | pass | pass | **redirected** (302) | partial | 1 |
| `case-18-live-too-large` | pass | pass | pass | **too_large** | partial | 1 |
| `case-19-live-timeout` | pass | pass | pass | **unreachable** (timeout) | partial | 1 |

Raw output of the run: `evidence/first-use-run.txt`. Result: **19/19 matched the declared dispositions.**

## Trust cues

- offline by default; **no network request unless `--live` is passed**
- `local_only` by default; live GETs only the receipt's own URL, bounded in time and size; zero dependencies; no analytics
- MIT licensed (`LICENSE`)
- one example run with **expected dispositions declared up front**, including boundary and live cases (`fixtures/expected.json` + `evidence/first-use-run.txt`)

## Limits

- `format` is a **heuristic**; reported as `suspected`.
- `completeness` validates the fields **this schema declares**; it is not a general JSON-Schema validator.
- `--live` proves whether the fetched body matches the pin; it does **not** establish live availability, authenticity, or the reason a source did not answer.
- Redirects are deliberately not followed, so a URL that only answers with a 3xx is reported as `redirected`, not resolved.
