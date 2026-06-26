/*
 * Node-based staged capacity test (READ-ONLY: GET /api/health — no DB write, no email).
 * Used because Hostinger's edge firewall drops k6's TLS fingerprint (JA3) but accepts
 * Node/browser TLS. This is real HTTPS traffic to production.
 *
 * Run: node loadtest/node-capacity.mjs
 */
const BASE = process.env.BASE_URL || "https://quizportal.mandi-hariyanna-academy.com";
const PATH = "/api/health";
const STAGES = [20, 50, 100, 150, 200, 250, 300];
const STAGE_SECONDS = 30;
const GAP_SECONDS = 30;
const TIMEOUT_MS = 20000;
const SUCCESS_THRESHOLD = 0.95; // continue only if >=95% success

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

async function oneReq() {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t = Date.now();
  try {
    const r = await fetch(BASE + PATH, { signal: ctrl.signal });
    await r.text();
    return { ms: Date.now() - t, status: r.status, ok: r.status === 200 };
  } catch (e) {
    return { ms: Date.now() - t, status: 0, ok: false, err: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message) };
  } finally { clearTimeout(to); }
}

async function runStage(concurrency) {
  const lat = []; let ok = 0, fail = 0; const status = {}; const errs = {};
  const endAt = Date.now() + STAGE_SECONDS * 1000;
  const worker = async () => {
    while (Date.now() < endAt) {
      const r = await oneReq();
      lat.push(r.ms);
      status[r.status] = (status[r.status] || 0) + 1;
      if (r.ok) ok++; else { fail++; if (r.err) errs[r.err] = (errs[r.err] || 0) + 1; }
      await sleep(500 + Math.random() * 1000); // 0.5–1.5s think time
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const secs = (Date.now() - t0) / 1000;
  const total = ok + fail;
  return {
    concurrency, total, ok, fail,
    successPct: total ? (ok / total * 100) : 0,
    failPct: total ? (fail / total * 100) : 0,
    rps: +(total / secs).toFixed(1),
    avg: total ? +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(0) : 0,
    min: lat.length ? Math.min(...lat) : 0, max: lat.length ? Math.max(...lat) : 0,
    p50: pct(lat, 50), p90: pct(lat, 90), p95: pct(lat, 95), p99: pct(lat, 99),
    status, errs,
  };
}

(async () => {
  console.log(`\nTarget: ${BASE}${PATH}  (read-only)\nStages: ${STAGES.join(", ")} concurrent · ${STAGE_SECONDS}s each · ${GAP_SECONDS}s gap\n`);
  const results = [];
  for (let i = 0; i < STAGES.length; i++) {
    const c = STAGES[i];
    process.stdout.write(`Stage ${i + 1} — ${c} concurrent … `);
    const r = await runStage(c);
    results.push(r);
    console.log(
      `done\n  reqs=${r.total} rps=${r.rps} | success=${r.successPct.toFixed(1)}% fail=${r.failPct.toFixed(1)}% ` +
      `| avg=${r.avg}ms p50=${r.p50} p90=${r.p90} p95=${r.p95} p99=${r.p99} min=${r.min} max=${r.max}ms ` +
      `| status=${JSON.stringify(r.status)}${Object.keys(r.errs).length ? " errs=" + JSON.stringify(r.errs) : ""}`
    );
    const verdict = r.successPct >= SUCCESS_THRESHOLD * 100 ? "PASS ✅" : "FAIL ❌";
    console.log(`  Verdict: ${verdict}\n`);
    if (r.successPct < SUCCESS_THRESHOLD * 100) {
      console.log(`>>> Breaking point reached at ${c} concurrent. Stopping (previous stage was the last stable level).`);
      break;
    }
    if (i < STAGES.length - 1) { console.log(`  (waiting ${GAP_SECONDS}s before next stage…)\n`); await sleep(GAP_SECONDS * 1000); }
  }
  const fs = await import("fs");
  fs.writeFileSync(new URL("./node-capacity-results.json", import.meta.url), JSON.stringify(results, null, 2));
  console.log("\nSaved → loadtest/node-capacity-results.json");
})();
