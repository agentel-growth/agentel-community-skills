#!/usr/bin/env node
// Source Receipt Checker — offline file-versus-receipt check, plus an OPT-IN live re-check.
// Zero dependencies. No network by default. Writes only to stdout/stderr.
//
// Offline checks (reported SEPARATELY, never collapsed into one verdict):
//   - integrity    : do the saved bytes match the receipt's sha256?
//   - completeness : is every required field present AND well-formed per the schema?
//   - format       : does the file's content match the label claimed for it?
// Opt-in live check (--live): EXACTLY ONE GET to the receipt's own `url`:
//   - live: unchanged | changed | redirected | too_large | unreachable | no_pin | not_requested
// Redirects are NOT followed (following one would be a second request, so "exactly one
// GET" stays true). The request timeout covers headers AND the response body. The body is
// streamed and capped. "unreachable" NEVER means "removed".
//
// Usage: node receipt-check.mjs <receipt.json> <file> [--live] [--json]
// Exit:  0 pass | 1 fail or partial | 2 input error (structured JSON, never a stack)

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname } from "node:path";

const SCHEMA_ID = "source-receipt-check-result-1";
const REQUIRED = ["url", "retrievedAt", "sourceType", "contentSha256"];
const SOURCE_TYPES = ["OFFICIAL", "PAPER", "REPO", "NEWS", "SOCIAL", "FORUM", "DATASET", "OTHER"];
const ROLES = ["SUPPORTS", "CONTRADICTS", "CONTEXT"];
const HEX64 = /^[0-9a-fA-F]{64}$/;
const EXCERPT_MAX = 300;
const LIVE_TIMEOUT_MS = Number(process.env.SOURCE_RECEIPT_LIVE_TIMEOUT_MS) > 0 ? Number(process.env.SOURCE_RECEIPT_LIVE_TIMEOUT_MS) : 10000;
const LIVE_MAX_BYTES = Number(process.env.SOURCE_RECEIPT_LIVE_MAX_BYTES) > 0 ? Number(process.env.SOURCE_RECEIPT_LIVE_MAX_BYTES) : 8 * 1024 * 1024;

const POLICIES = {
  digestCase:
    "Digests are hex. An UPPERCASE digest is accepted and normalized to lowercase for comparison; the normalization is reported as integrity.pin.normalized=true. A contentSha256 that is not exactly 64 hex characters is an UNUSABLE PIN: integrity is 'unknown' and the receipt is reported invalid — never a byte mismatch.",
  completeness:
    "completeness checks that every REQUIRED field is present AND satisfies the bundled schema constraint (type / enum / digest format), and validates the declared constraints on optional fields when they are present — the constant on `schema` and the string type on `notes`. Missing fields and invalid fields are reported in separate arrays. completeness is therefore NOT presence-only.",
  integrityUnknown:
    "'unknown' means the receipt could not pin the bytes (digest missing or unusable). It is never evidence of corruption.",
  format: "The format check is a heuristic (magic-byte / leading-text sniff of the first 512 bytes) and is reported as 'suspected'.",
  errors: "Unreadable, malformed, or non-object receipt JSON, and unreadable target files, are reported as a stable JSON input error with exit code 2 — never a stack trace.",
  live: `The live check is OPT-IN (--live) and issues EXACTLY ONE GET to the receipt's own \`url\`: no credentials, no other endpoint, and redirects are NOT followed (a 3xx is reported as 'redirected' rather than followed, because following would be a second request). The timeout (default ${LIVE_TIMEOUT_MS} ms, set SOURCE_RECEIPT_LIVE_TIMEOUT_MS) covers headers AND the response body, which is streamed and capped at ${LIVE_MAX_BYTES} bytes (set SOURCE_RECEIPT_LIVE_MAX_BYTES). Outcomes: 'unchanged' (2xx and body matches the pinned digest), 'changed' (2xx and body differs), 'redirected' (3xx, not followed), 'too_large' (body exceeded the cap; digest not computed), 'unreachable' (network error, timeout, or other non-2xx), 'no_pin' (no usable digest to compare). 'unreachable' is NOT 'removed': it is absence of evidence, and no cause is inferred.`,
};

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function inputError(code, message, ctx = {}) {
  emit({
    schema: SCHEMA_ID,
    checkedAt: new Date().toISOString(),
    receipt: ctx.receipt ?? null,
    file: ctx.file ?? null,
    input: { status: "error", code, message },
    checks: null,
    verdict: "error",
    error: { code, message },
    policies: POLICIES,
  });
  process.exit(2);
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isDateLike(v) {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
}

function declaredFamily(receipt, filePath) {
  const ct = typeof receipt.contentType === "string" ? receipt.contentType.toLowerCase() : "";
  const ext = extname(filePath).toLowerCase().replace(".", "");
  const key = ct || ext;
  if (!key) return { family: "unknown", key: "(none)" };
  if (/pdf/.test(key)) return { family: "pdf", key };
  if (/html|htm/.test(key)) return { family: "html", key };
  if (/json/.test(key)) return { family: "json", key };
  if (/png|jpe?g|gif|webp|tiff/.test(key)) return { family: "image", key };
  if (/csv|tsv|txt|plain|markdown|md/.test(key)) return { family: "text", key };
  return { family: "unknown", key };
}

function detectedFamily(buf) {
  const head = buf.subarray(0, 512);
  const ascii = head.toString("latin1");
  const text = ascii.trimStart().toLowerCase();
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length >= 4 && buf[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "image";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image";
  if (/^<!doctype html|^<html/.test(text)) return "html";
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  let printable = 0;
  for (const b of head) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  if (head.length && printable / head.length > 0.9) return "text";
  return "unknown";
}

function completeness(receipt) {
  const missing = [];
  const invalid = [];
  const empty = (v) => v === undefined || v === null || v === "";

  if (empty(receipt.url)) missing.push("url");
  else if (typeof receipt.url !== "string") invalid.push({ field: "url", reason: `expected string, got ${typeof receipt.url}` });

  if (empty(receipt.retrievedAt)) missing.push("retrievedAt");
  else if (typeof receipt.retrievedAt !== "string") invalid.push({ field: "retrievedAt", reason: `expected string, got ${typeof receipt.retrievedAt}` });
  else if (!isDateLike(receipt.retrievedAt)) invalid.push({ field: "retrievedAt", reason: "not a parseable date/instant" });

  if (empty(receipt.sourceType)) missing.push("sourceType");
  else if (typeof receipt.sourceType !== "string") invalid.push({ field: "sourceType", reason: `expected string, got ${typeof receipt.sourceType}` });
  else if (!SOURCE_TYPES.includes(receipt.sourceType)) invalid.push({ field: "sourceType", reason: `not one of ${SOURCE_TYPES.join("|")}` });

  if (empty(receipt.contentSha256)) missing.push("contentSha256");
  else if (typeof receipt.contentSha256 !== "string") invalid.push({ field: "contentSha256", reason: `expected string, got ${typeof receipt.contentSha256}` });
  else if (!HEX64.test(receipt.contentSha256)) invalid.push({ field: "contentSha256", reason: "not 64 hex characters (unusable digest)" });

  if (receipt.contentType !== undefined && (typeof receipt.contentType !== "string" || receipt.contentType === ""))
    invalid.push({ field: "contentType", reason: `expected non-empty string, got ${typeof receipt.contentType}` });
  if (receipt.excerpt !== undefined && typeof receipt.excerpt !== "string")
    invalid.push({ field: "excerpt", reason: `expected string, got ${typeof receipt.excerpt}` });
  else if (typeof receipt.excerpt === "string" && receipt.excerpt.length > EXCERPT_MAX)
    invalid.push({ field: "excerpt", reason: `${receipt.excerpt.length} chars exceeds the ${EXCERPT_MAX} limit` });
  if (receipt.role !== undefined && !ROLES.includes(receipt.role)) invalid.push({ field: "role", reason: `not one of ${ROLES.join("|")}` });
  if (receipt.publisher !== undefined && typeof receipt.publisher !== "string") invalid.push({ field: "publisher", reason: `expected string, got ${typeof receipt.publisher}` });
  if (receipt.publishedAt !== undefined && !isDateLike(receipt.publishedAt)) invalid.push({ field: "publishedAt", reason: "not a parseable date/instant" });
  if (receipt.savedAs !== undefined && typeof receipt.savedAs !== "string") invalid.push({ field: "savedAs", reason: `expected string, got ${typeof receipt.savedAs}` });
  // Declared constraints on optional fields, validated when present (no general JSON-Schema engine):
  if (receipt.schema !== undefined && receipt.schema !== "source-receipt-1") invalid.push({ field: "schema", reason: `expected the constant "source-receipt-1", got ${JSON.stringify(receipt.schema)}` });
  if (receipt.notes !== undefined && typeof receipt.notes !== "string") invalid.push({ field: "notes", reason: `expected string, got ${typeof receipt.notes}` });

  return { status: missing.length === 0 && invalid.length === 0 ? "pass" : "fail", missing, invalid };
}

function pinOf(receipt) {
  const raw = receipt.contentSha256;
  if (raw === undefined || raw === null || raw === "") return { status: "missing" };
  if (typeof raw !== "string" || !HEX64.test(raw)) return { status: "invalid", reason: "contentSha256 is not a usable digest (expected 64 hex characters)" };
  const normalized = raw !== raw.toLowerCase();
  return { status: "valid", digest: raw.toLowerCase(), ...(normalized ? { normalized: true } : {}) };
}

function integrity(receipt, buf) {
  const pin = pinOf(receipt);
  if (pin.status === "missing") return { status: "unknown", pin: { status: "missing" }, detail: "receipt carries no contentSha256 — the bytes cannot be pinned (this is NOT a byte failure)" };
  if (pin.status === "invalid") return { status: "unknown", pin: { status: "invalid", reason: pin.reason }, detail: "unusable pin — integrity is unknown, not a byte mismatch" };
  const { digest, ...rest } = pin;
  const actual = sha256(buf);
  return {
    status: actual === digest ? "pass" : "fail",
    pin: rest,
    expected: digest,
    actual,
    detail: actual === digest ? "saved bytes match the pinned digest" : "saved bytes differ from the pinned digest",
  };
}

function format(receipt, filePath, buf) {
  const { family: declared, key } = declaredFamily(receipt, filePath);
  const detected = detectedFamily(buf);
  if (declared === "unknown" || detected === "unknown") {
    return { status: "unknown", declared: key, detected, suspected: false, detail: "label or content could not be classified" };
  }
  const mismatch = declared !== detected;
  return {
    status: mismatch ? "fail" : "pass",
    declared: key,
    detected,
    suspected: mismatch,
    detail: mismatch
      ? `content looks like ${detected} but is labelled ${key} (suspected mismatch, heuristic)`
      : `content looks like ${detected}, consistent with the label ${key}`,
  };
}

async function live(receipt, requested) {
  if (!requested) return { status: "not_requested", detail: "offline mode; pass --live to re-read the source URL once" };
  const pin = pinOf(receipt);
  if (pin.status !== "valid") return { status: "no_pin", pin: { status: pin.status }, detail: "no usable digest to compare against; the live check cannot say whether the source changed" };
  const url = receipt.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { status: "unreachable", url: url ?? null, httpStatus: null, detail: "receipt url is missing or not http(s); nothing was fetched (unreachable ≠ removed)" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    // exactly ONE request; redirects are NOT followed
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    if (res.status >= 300 && res.status < 400) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { status: "redirected", url, httpStatus: res.status, location: res.headers.get("location") ?? null, detail: `HTTP ${res.status} redirect not followed (following it would be a second request)` };
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { status: "unreachable", url, httpStatus: res.status, detail: `HTTP ${res.status}; no claim about why (unreachable ≠ removed)` };
    }
    // stream the body under the cap
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > LIVE_MAX_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { status: "too_large", url, httpStatus: res.status, bytesRead: received, limit: LIVE_MAX_BYTES, detail: `response body exceeded ${LIVE_MAX_BYTES} bytes; digest not computed, so no unchanged/changed claim` };
      }
      chunks.push(Buffer.from(value));
    }
    const body = Buffer.concat(chunks);
    const actual = sha256(body);
    const unchanged = actual === pin.digest;
    return { status: unchanged ? "unchanged" : "changed", url, httpStatus: res.status, expected: pin.digest, actual, bytes: body.length, detail: unchanged ? "live body matches the pinned digest" : "live body differs from the pinned digest" };
  } catch (e) {
    return { status: "unreachable", url, httpStatus: null, detail: `${e.name === "AbortError" ? "timeout (headers or body)" : e.code ?? e.name}; no claim about why (unreachable ≠ removed)` };
  } finally {
    clearTimeout(timer);
  }
}

async function main(argv) {
  const liveRequested = argv.includes("--live");
  const args = argv.filter((a) => a !== "--json" && a !== "--live");
  const [receiptPath, filePath] = args;
  if (!receiptPath || !filePath) {
    inputError("USAGE", "usage: node receipt-check.mjs <receipt.json> <file> [--live] [--json]");
  }

  let text;
  try { text = readFileSync(receiptPath, "utf8"); } catch (e) { inputError("RECEIPT_UNREADABLE", `cannot read receipt file: ${e.code ?? e.message}`, { receipt: receiptPath, file: filePath }); }
  let receipt;
  try { receipt = JSON.parse(text); } catch (e) { inputError("RECEIPT_MALFORMED_JSON", `receipt is not valid JSON: ${e.message}`, { receipt: receiptPath, file: filePath }); }
  if (!isObj(receipt)) inputError("RECEIPT_NOT_OBJECT", `receipt must be a JSON object, got ${receipt === null ? "null" : Array.isArray(receipt) ? "array" : typeof receipt}`, { receipt: receiptPath, file: filePath });

  let buf;
  try { buf = readFileSync(filePath); } catch (e) { inputError("FILE_UNREADABLE", `cannot read target file: ${e.code ?? e.message}`, { receipt: receiptPath, file: filePath }); }

  const checks = {
    integrity: integrity(receipt, buf),
    completeness: completeness(receipt),
    format: format(receipt, filePath, buf),
    live: await live(receipt, liveRequested),
  };
  const MAP = { pass: "pass", fail: "fail", unchanged: "pass", changed: "fail", redirected: "unknown", too_large: "unknown", unreachable: "unknown", no_pin: "unknown", not_requested: "ignore" };
  const statuses = Object.values(checks).map((c) => MAP[c.status] ?? "unknown");
  const verdict = statuses.includes("fail") ? "fail" : statuses.includes("unknown") ? "partial" : "pass";
  const inputValid = checks.completeness.missing.length === 0 && checks.completeness.invalid.length === 0;

  emit({
    schema: SCHEMA_ID,
    checkedAt: new Date().toISOString(),
    receipt: receiptPath,
    file: filePath,
    bytes: buf.length,
    input: { status: inputValid ? "ok" : "invalid" },
    checks,
    verdict,
    policies: POLICIES,
    limits: [
      "offline by default; the live check runs only with --live and makes exactly one GET to the receipt's own URL",
      "redirects are not followed in --live; a 3xx is reported as 'redirected'",
      "the live timeout covers headers and body; the body is streamed and capped, and an oversized body is reported as 'too_large' rather than compared",
      "a source that is unreachable later is not evidence that it was removed",
      "no statement about whether the content is correct, only whether the bytes match the pin",
    ],
  });
  process.exit(verdict === "pass" ? 0 : 1);
}

main(process.argv.slice(2));
