/*
 * Local evaluation worker.
 *
 * Runs on YOUR machine, beside Ollama. Production cannot call it — localhost on
 * a Render container is that container — so the worker pulls instead:
 *
 *   lease pending answers  ->  grade with local Ollama  ->  post scores back
 *
 * Everything it posts is re-validated and re-totalled by the server, so a bug
 * here can leave a mark unset but can never inflate a candidate's total.
 *
 * Start it whenever you like. It picks up everything that accumulated while it
 * was off, then keeps polling. Stop it at any time: a lease left half-finished
 * is reclaimed by the server after a timeout and offered again.
 *
 *   EVALUATOR_API_KEY=…  API_BASE_URL=https://…onrender.com  node scripts/evaluationWorker.js
 *   node scripts/evaluationWorker.js --once     # drain the queue and exit
 */
require("dotenv").config();
const ollama = require("../utils/ollama");

const API   = (process.env.API_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const KEY   = process.env.EVALUATOR_API_KEY || "";
const BATCH = parseInt(process.env.EVAL_BATCH) || 5;
const POLL  = parseInt(process.env.EVAL_POLL_MS) || 20000;
const ONCE  = process.argv.includes("--once");

const log = (...a) => console.log(`[worker ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function api(path, opts = {}) {
  const r = await fetch(`${API}/api/evaluation${path}`, {
    ...opts,
    headers: { "X-Evaluator-Key": KEY, "Content-Type": "application/json", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message || `${path} -> HTTP ${r.status}`);
  return body.data;
}

/*
 * The rubric IS the reference. The model is told to compare the answer against
 * it rather than judge the answer on how confident it sounds, and to accept a
 * different-but-valid approach — a trainer explaining a concept another correct
 * way must not be marked down for wording.
 */
function buildPrompt(job) {
  const outputPrediction = !job.openEnded;
  const rubricLabel = outputPrediction ? "EXPECTED OUTPUT / ANSWER" : "WHAT TO LOOK FOR (evaluation guidance)";
  const scale = job.maxMarks === 2
    ? `${job.maxMarks}/2 — correct output AND sound reasoning.
1/2 — output correct but the explanation is missing or partly wrong, OR the output is partly right and the reasoning shows real understanding.
0/2 — output wrong and reasoning wrong.`
    : `3/3 — technically correct, complete, well reasoned, covers the expected concepts.
2/3 — mostly correct and relevant, but misses an important point or has a minor technical gap.
1/3 — some relevant understanding, but incomplete, vague, or with significant gaps.
0/3 — incorrect, irrelevant, or no meaningful answer.`;

  return `You are evaluating one answer from a technical screening for a Data Science & Data Analytics TRAINER position.

Judge technical correctness and relevance strictly.
Do not award marks because an answer sounds confident.
Do not penalise different wording when the underlying concept is correct.
Do not require the candidate's approach to match the reference when several technically valid approaches exist.
Award partial marks where the candidate shows partial understanding.
Do not invent anything that is not in the candidate's answer.
If the answer is empty or meaningless, the score is 0.

QUESTION:
${job.question}
${job.reference ? `\nREFERENCE MATERIAL SHOWN TO THE CANDIDATE:\n${job.reference}\n` : ""}
${rubricLabel}:
${job.rubric || "(none supplied — judge on technical correctness alone)"}

CANDIDATE ANSWER:
${job.answer || "(no answer given)"}

MAXIMUM MARKS: ${job.maxMarks}

SCORING RUBRIC:
${scale}

Return ONLY valid JSON, no prose and no code fences:
{"score": <integer 0..${job.maxMarks}>, "maxScore": ${job.maxMarks}, "reason": "<one or two sentences>", "matchedCriteria": ["…"], "missingCriteria": ["…"], "confidence": <0..1>}`;
}

// Models wrap JSON in prose or fences however they are asked not to; take the
// outermost object rather than failing the whole evaluation on a stray word.
function parseJson(text) {
  const cleaned = String(text || "").replace(/```json/gi, "```").split("```").join("\n");
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error("no JSON object in the model output");
  return JSON.parse(cleaned.slice(a, b + 1));
}

async function evaluate(job) {
  const raw = await ollama.generate(buildPrompt(job), { temperature: 0.1, timeoutMs: 300000 });
  const j = parseJson(raw);
  const score = Number(j.score);
  // Checked here as well as on the server: catching it now means the retry
  // happens immediately instead of after a round trip.
  if (!Number.isInteger(score) || score < 0 || score > job.maxMarks) {
    throw new Error(`model returned score ${j.score} for a ${job.maxMarks}-mark question`);
  }
  return {
    candidateId: job.candidateId, qid: job.qid, score,
    reason: j.reason || j.explanation || "",
    matched: j.matchedCriteria || j.matched || [],
    missing: j.missingCriteria || j.missing || [],
    confidence: j.confidence,
  };
}

async function tick() {
  const { jobs } = await api(`/jobs?limit=${BATCH}`);
  if (!jobs.length) return 0;
  log(`leased ${jobs.length} answer(s)`);

  const results = [];
  for (const job of jobs) {
    try {
      const r = await evaluate(job);
      results.push(r);
      log(`  ${job.section} ${job.qid.slice(-6)} -> ${r.score}/${job.maxMarks}`);
    } catch (e) {
      // Reported as an error, never as a zero. The server decides whether that
      // means another attempt or FAILED — a model outage must not become a mark.
      results.push({ candidateId: job.candidateId, qid: job.qid, error: e.message });
      log(`  ${job.section} ${job.qid.slice(-6)} -> FAILED: ${e.message}`);
    }
  }
  // Posted after each batch, so a crash costs at most this batch's work.
  const out = await api("/results", { method: "POST", body: JSON.stringify({ results }) });
  log(`saved ${out.accepted} · rejected ${out.rejected}`);
  return jobs.length;
}

(async () => {
  if (!KEY) { console.error("EVALUATOR_API_KEY is not set — refusing to start."); process.exit(1); }
  const av = await ollama.isAvailable();
  if (!av.ok) { console.error(`Ollama: ${av.message}`); process.exit(1); }
  if (!av.hasModel) console.warn(`Warning: model "${av.model}" is not pulled. Run: ollama pull ${av.model}`);
  log(`Ollama ready (${av.model}) · API ${API}`);

  const h = await api("/health").catch((e) => { console.error(`Cannot reach the API: ${e.message}`); process.exit(1); });
  log(`queue: ${h.pendingCandidates} pending · ${h.processingCandidates} processing · ${h.failedCandidates} failed`);

  let idle = 0;
  for (;;) {
    let n = 0;
    try { n = await tick(); }
    catch (e) { log(`tick failed: ${e.message}`); }        // keep polling; the server reclaims leases
    if (n === 0) {
      if (ONCE) { log("queue empty — done."); break; }
      if (++idle === 1) log("queue empty — waiting…");
    } else { idle = 0; }
    if (ONCE && n === 0) break;
    await new Promise((r) => setTimeout(r, n ? 250 : POLL));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
