/*
 * Multi-backend staged capacity test (READ-ONLY: GET /api/health). No writes, no email.
 * Each virtual user is assigned a backend round-robin (like the frontend's sticky
 * per-session pick) → also proves load distribution across all 5 Render instances.
 */
const BACKENDS = [
  "https://csr-recutment2-by0j.onrender.com",
  "https://csr-recutment2-1.onrender.com",
  "https://csr-recutment2-gyrc.onrender.com",
  "https://csr-recutment2-7i09.onrender.com",
  "https://csr-recutment2.onrender.com",
];
const STAGES = [20, 50, 100, 150, 200, 250, 300];
const STAGE_S = 30, GAP_S = 20, TIMEOUT = 20000, OKPCT = 95;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

async function hit(base) {
  const c = new AbortController(); const to = setTimeout(() => c.abort(), TIMEOUT); const t = Date.now();
  try { const r = await fetch(base + "/api/health", { signal: c.signal }); await r.text(); return { ms: Date.now() - t, ok: r.status === 200, st: r.status }; }
  catch (e) { return { ms: Date.now() - t, ok: false, st: 0, err: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message) }; }
  finally { clearTimeout(to); }
}

async function stage(n) {
  const lat = []; let ok = 0, fail = 0; const status = {}, errs = {}, perBackend = {};
  const end = Date.now() + STAGE_S * 1000;
  const worker = async (id) => {
    const base = BACKENDS[id % BACKENDS.length];           // round-robin assignment (sticky per worker)
    perBackend[base] = perBackend[base] || { ok: 0, fail: 0 };
    while (Date.now() < end) {
      const r = await hit(base);
      lat.push(r.ms); status[r.st] = (status[r.st] || 0) + 1;
      if (r.ok) { ok++; perBackend[base].ok++; } else { fail++; perBackend[base].fail++; if (r.err) errs[r.err] = (errs[r.err] || 0) + 1; }
      await sleep(500 + Math.random() * 1000);
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, (_, i) => worker(i)));
  const secs = (Date.now() - t0) / 1000, total = ok + fail;
  return { n, total, ok, fail, successPct: total ? ok / total * 100 : 0, rps: +(total / secs).toFixed(1),
    avg: total ? +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(0) : 0,
    p90: pct(lat, 90), p95: pct(lat, 95), p99: pct(lat, 99), max: lat.length ? Math.max(...lat) : 0,
    status, errs, perBackend };
}

(async () => {
  console.log(`\n5 backends · stages ${STAGES.join(", ")} · ${STAGE_S}s each · ${GAP_S}s gap · READ-ONLY\n`);
  const out = [];
  for (let i = 0; i < STAGES.length; i++) {
    const c = STAGES[i];
    process.stdout.write(`Stage ${i + 1}: ${c} concurrent (~${Math.round(c / 5)}/backend) … `);
    const r = await stage(c); out.push(r);
    console.log(`done
  reqs=${r.total} rps=${r.rps} success=${r.successPct.toFixed(1)}% fail=${(100 - r.successPct).toFixed(1)}% avg=${r.avg}ms p95=${r.p95} p99=${r.p99} max=${r.max}ms
  status=${JSON.stringify(r.status)}${Object.keys(r.errs).length ? " errs=" + JSON.stringify(r.errs) : ""}
  per-backend ok/fail: ${Object.entries(r.perBackend).map(([b, v]) => b.split("//")[1].split(".")[0] + "=" + v.ok + "/" + v.fail).join("  ")}
  verdict: ${r.successPct >= OKPCT ? "PASS ✅" : "FAIL ❌"}\n`);
    if (r.successPct < OKPCT) { console.log(`>>> Breaking point at ${c} concurrent. Last stable = ${i > 0 ? STAGES[i - 1] : "<20"}.`); break; }
    if (i < STAGES.length - 1) await sleep(GAP_S * 1000);
  }
  const fs = await import("fs");
  fs.writeFileSync(new URL("./node-multi-results.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log("\nSaved → loadtest/node-multi-results.json");
})();
