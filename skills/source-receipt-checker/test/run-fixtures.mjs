#!/usr/bin/env node
// First-use run: executes the checker over every fixture and compares each
// check, exit code and error code to the disposition declared in
// fixtures/expected.json BEFORE the run. Also fails on a child startup crash.
// The three --live cases are served from a LOCAL http server on 127.0.0.1, so
// the suite stays hermetic: no request leaves the machine.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixtures = join(root, "fixtures");
const cli = join(root, "bin", "receipt-check.mjs");
const STACK = /\n\s+at\s|TypeError|ReferenceError|SyntaxError:/;

// spawn ASYNC so this process keeps serving the local HTTP routes while the child runs.
function run(cmd, args, extraEnv) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, extraEnv ? { env: { ...process.env, ...extraEnv } } : undefined);
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const sameBytes = readFileSync(join(fixtures, "case-14-live-unchanged", "data.csv"));
const server = createServer((req, res) => {
  if (req.url === "/same") { res.writeHead(200, { "content-type": "text/csv" }); res.end(sameBytes); }
  else if (req.url === "/diff") { res.writeHead(200, { "content-type": "text/csv" }); res.end("id,sku,price\n1,A-100,8.00\n"); }
  else if (req.url === "/gone") { res.writeHead(500); res.end("server error"); }
  else if (req.url === "/moved") { res.writeHead(302, { location: "/same" }); res.end(""); }
  else if (req.url === "/big") { res.writeHead(200, { "content-type": "text/csv" }); res.end(Buffer.alloc(8192, 0x61)); }
  else if (req.url === "/stall") { res.writeHead(200, { "content-type": "text/csv" }); res.write("id,sku,price\n"); /* never ends */ }
  else { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const tmp = mkdtempSync(join(tmpdir(), "src-live-"));

const expected = JSON.parse(readFileSync(join(fixtures, "expected.json"), "utf8"));
let failures = 0;
console.log("Source Receipt Checker — first-use run");
console.log(`declared: ${expected.declaredAt}  version ${expected.version}  (dispositions declared before running)`);
console.log(`live cases served from http://127.0.0.1:${PORT} (local only)`);
console.log("");

for (const c of expected.cases) {
  let receipt;
  let cliArgs;
  if (c.live) {
    const tpl = readFileSync(join(fixtures, c.case, "receipt.template.json"), "utf8").replace(/\{PORT\}/g, String(PORT));
    receipt = join(tmp, `${c.case}.receipt.json`);
    writeFileSync(receipt, tpl);
    cliArgs = [cli, receipt, join(fixtures, c.case, c.file), "--live"];
  } else {
    receipt = join(fixtures, c.case, "receipt.json");
    cliArgs = [cli, receipt, join(fixtures, c.case, c.file)];
  }

  const r = await run(process.execPath, cliArgs, c.live ? { SOURCE_RECEIPT_LIVE_TIMEOUT_MS: "600", SOURCE_RECEIPT_LIVE_MAX_BYTES: "4096" } : null);
  const exit = r.status;
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { out = null; }
  const crashed = STACK.test(r.stderr || "") || out === null;

  let ok;
  const notes = [];
  if (c.expectError) {
    ok = exit === c.exit && !!out && out.verdict === "error" && out.error?.code === c.expectError && !crashed;
    notes.push(`expected structured error ${c.expectError} + exit ${c.exit}`);
    notes.push(`got error=${out?.error?.code ?? "(none)"} verdict=${out?.verdict ?? "(none)"} exit ${exit}`);
  } else {
    const got = out
      ? { integrity: out.checks.integrity.status, completeness: out.checks.completeness.status, format: out.checks.format.status, verdict: out.verdict, ...(c.expect.live ? { live: out.checks.live.status } : {}) }
      : { integrity: "?", completeness: "?", format: "?", verdict: "?", live: "?" };
    const keys = Object.keys(c.expect);
    const mismatch = keys.filter((k) => got[k] !== c.expect[k]);
    ok = exit === c.exit && mismatch.length === 0 && !crashed;
    notes.push(`expected ${keys.map((k) => `${k}=${c.expect[k]}`).join(" ")}  exit ${c.exit}`);
    notes.push(`got      ${keys.map((k) => `${k}=${got[k]}`).join(" ")}  exit ${exit}`);
    if (mismatch.length) notes.push(`MISMATCH on: ${mismatch.join(", ")}`);
    if (out) {
      const ic = out.checks.integrity;
      if (ic.pin) notes.push(`integrity.pin=${ic.pin.status}${ic.pin.normalized ? " (normalized)" : ""}`);
      if (out.checks.completeness.missing?.length) notes.push(`missing: ${out.checks.completeness.missing.join(", ")}`);
      if (out.checks.completeness.invalid?.length) notes.push(`invalid: ${out.checks.completeness.invalid.map((x) => x.field).join(", ")}`);
      if (out.checks.format.suspected) notes.push(`format: ${out.checks.format.detail}`);
      if (c.live) notes.push(`live: status=${out.checks.live.status} http=${out.checks.live.httpStatus ?? "-"} (${out.checks.live.detail})`);
    }
  }
  if (crashed) notes.push(`CHILD CRASH/NO JSON (stderr: ${(r.stderr || "").split("\n")[0] || "empty"})`);
  if (!ok) failures++;

  console.log(`${ok ? "PASS" : "FAIL"}  ${c.case}`);
  for (const n of notes) console.log(`      ${n}`);
  console.log("");
}

console.log(`result: ${expected.cases.length - failures}/${expected.cases.length} cases matched the declared dispositions`);
server.closeAllConnections?.();
await new Promise((r) => server.close(r));
rmSync(tmp, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
