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
 *   npm run evaluation:worker        # continuous — the normal way to run it
 *   npm run evaluation:worker:once   # drain the queue once and exit
 */
require("dotenv").config();
const ollama = require("../utils/ollama");

/*
 * One or more production backends, comma-separated. They share one database, so
 * any of them can serve the queue — listing several means a single instance
 * being asleep, restarting or cold-starting does not stall evaluation.
 * Requests start at the first and rotate on failure.
 */
const APIS = String(process.env.API_BASE_URL || process.env.API_BASE_URLS || "http://localhost:8080")
  .split(",").map(u => u.trim().replace(/\/+$/, "")).filter(Boolean);
let apiIdx = 0;
const currentApi = () => APIS[apiIdx % APIS.length];
const KEY   = process.env.EVALUATOR_API_KEY || "";
const BATCH = parseInt(process.env.EVAL_BATCH) || 5;
// Idle poll. Short enough to pick work up promptly, long enough not to hammer
// the production API while the queue is empty.
const POLL  = parseInt(process.env.EVAL_POLL_MS) || 8000;
const ONCE  = process.argv.includes("--once");

const log = (...a) => console.log(`[worker ${new Date().toISOString().slice(11, 19)}]`, ...a);

/*
 * Try each backend in turn. A refused connection, a timeout or a 5xx means that
 * instance is unavailable, so move to the next — Render instances sleep and
 * cold-start, and one being slow should not stall the queue.
 *
 * A 4xx is NOT retried across instances: a rejected key or a malformed body is
 * rejected identically everywhere, so retrying would only multiply it.
 */
async function api(path, opts = {}) {
  let lastErr;
  for (let hop = 0; hop < APIS.length; hop++) {
    const base = currentApi();
    try {
      const r = await fetch(`${base}/api/evaluation${path}`, {
        ...opts,
        headers: { "X-Evaluator-Key": KEY, "Content-Type": "application/json", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(60000),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) return body.data;
      const err = new Error(body.message || `${path} -> HTTP ${r.status}`);
      // Marked so the catch below re-throws instead of rotating: a rejected key
      // or a malformed body gets the same answer from every instance.
      if (r.status < 500) { err.clientError = true; throw err; }
      lastErr = err;
    } catch (e) {
      if (e.clientError) throw e;
      lastErr = e;
    }
    apiIdx++;
    if (APIS.length > 1) log(`  backend unavailable — trying ${currentApi()}`);
  }
  throw lastErr || new Error("all backends unavailable");
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
  // An OllamaUnavailable thrown here propagates: the caller releases the lease
  // instead of recording a failure, so a stopped model never costs a mark.
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
  let downFrom = -1;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      const r = await evaluate(job);
      results.push(r);
      log(`  ${job.section} ${job.qid.slice(-6)} -> ${r.score}/${job.maxMarks}`);
    } catch (e) {
      if (e.unavailable) {
        // Ollama went away mid-batch. Everything from here on was never looked
        // at, so hand the whole remainder back untouched rather than recording
        // failures against answers nobody read.
        downFrom = i;
        break;
      }
      // Attempted but ungradable (bad JSON, impossible score). A real failure —
      // reported as an error, never as a zero.
      results.push({ candidateId: job.candidateId, qid: job.qid, error: e.message });
      log(`  ${job.section} ${job.qid.slice(-6)} -> error: ${e.message}`);
    }
  }
  if (downFrom >= 0) {
    jobs.slice(downFrom).forEach(j =>
      results.push({ candidateId: j.candidateId, qid: j.qid, release: true, reason: "Ollama unavailable" }));
    log(`  Ollama went away — released ${jobs.length - downFrom} unread answer(s) back to PENDING`);
  }
  // Posted after each batch, so a crash costs at most this batch's work.
  const out = await api("/results", { method: "POST", body: JSON.stringify({ results }) });
  log(`saved ${out.accepted} · errors ${out.rejected} · released ${out.released || 0}`);
  if (downFrom >= 0) throw new ollama.OllamaUnavailable("Ollama stopped responding");
  return jobs.length;
}

/*
 * Wait for something to come back, announcing it once rather than every retry.
 * Nothing here ever exits: a laptop that is asleep, a model that is stopped and
 * a network that is down are all temporary, and the queue is still there
 * afterwards. Exiting would mean the answers sat unevaluated until someone
 * noticed.
 */
async function waitFor(label, check, everyMs = POLL) {
  let announced = false;
  for (;;) {
    const r = await check();
    if (r.ok) {
      if (announced) log(`${label} is back — resuming.`);
      return r;
    }
    if (!announced) { log(`${label} unavailable — waiting… (${r.message})`); announced = true; }
    await new Promise((res) => setTimeout(res, everyMs));
  }
}

(async () => {
  if (!KEY) {
    // The one genuine misconfiguration: without the shared secret the worker
    // cannot authenticate at all, and waiting would never fix it.
    console.error("EVALUATOR_API_KEY is not set — refusing to start.");
    console.error("It authenticates this worker to the production API. It is NOT an Ollama key.");
    process.exit(1);
  }
  log(`API      ${APIS.length} backend(s): ${APIS.join(", ")}`);
  log(`Ollama   ${ollama.OLLAMA_URL}  model ${ollama.OLLAMA_MODEL}`);
  log("Ollama is dialled ONLY from this machine; the production server never calls it.");

  const av = await waitFor("Ollama", () => ollama.isAvailable());
  if (!av.hasModel) log(`Warning: model "${av.model}" is not pulled. Run:  ollama pull ${av.model}`);

  const h = await waitFor("Production API", async () => {
    try { return { ok: true, data: await api("/health") }; }
    catch (e) { return { ok: false, message: e.message }; }
  });
  const q = h.data;
  log(`queue: ${q.pendingCandidates} pending · ${q.processingCandidates} processing · ${q.failedCandidates} failed`);

  let idle = 0;
  for (;;) {
    let n = 0;
    try {
      n = await tick();
    } catch (e) {
      if (e.unavailable) {
        // Leases were already handed back inside tick(); wait for Ollama, then
        // carry on from wherever the queue now stands.
        await waitFor("Ollama", () => ollama.isAvailable());
        continue;
      }
      // A network blip or a restarting API. Leases expire server-side, so the
      // work is never lost — just try again shortly.
      log(`tick failed: ${e.message}`);
    }
    if (n === 0) {
      if (ONCE) { log("queue empty — done."); break; }
      if (++idle === 1) log(`queue empty — checking every ${Math.round(POLL / 1000)}s…`);
    } else { idle = 0; }
    await new Promise((r) => setTimeout(r, n ? 250 : POLL));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
