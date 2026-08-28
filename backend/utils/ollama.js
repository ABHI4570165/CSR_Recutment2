// OLLAMA_BASE_URL is the documented name; OLLAMA_URL is accepted for the older
// config. This address is only ever dialled by a process running ON the same
// machine as Ollama — the local evaluation worker, never the production API.
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

// Distinguishes "Ollama is not reachable" from "Ollama answered badly". The
// first must never cost a candidate a retry, let alone a mark; the second is a
// genuine evaluation failure. Anything else would let a laptop being asleep turn
// into FAILED answers.
class OllamaUnavailable extends Error {
  constructor(message) { super(message); this.name = "OllamaUnavailable"; this.unavailable = true; }
}

/*
 * Single Ollama client for the whole backend.
 *
 * Ollama runs locally and is NEVER exposed to the browser: the frontend calls
 * our API, the API calls Ollama. No cloud AI service is involved.
 */
async function isAvailable() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, message: `Ollama returned ${r.status}.` };
    const j = await r.json();
    const models = (j.models || []).map(m => m.name);
    return { ok: true, models, model: OLLAMA_MODEL, hasModel: models.includes(OLLAMA_MODEL) };
  } catch (e) {
    return { ok: false, message: `Ollama is not reachable at ${OLLAMA_URL}. Start it and try again.` };
  }
}

/*
 * Streaming completion.
 *
 * MUST stream: with stream:false Ollama sends no bytes until the whole answer
 * is ready, and Node's fetch (undici) aborts after 300s of silence — which is
 * shorter than a large analysis takes. Streaming keeps bytes flowing, so the
 * connection stays alive for as long as generation needs.
 */
async function generate(prompt, { timeoutMs = 1800000, temperature = 0.3, onToken = null } = {}) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL, prompt, stream: true,
      options: { temperature, num_ctx: 16384, num_predict: 4096 },
    }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Connection refused / DNS / timeout — Ollama is down, not wrong.
    throw new OllamaUnavailable(`Ollama is not reachable at ${OLLAMA_URL}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let out = "", buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();                       // keep the partial line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        if (j.response) { out += j.response; onToken?.(j.response); }
      } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
    }
  }
  return out.trim();
}

module.exports = { isAvailable, generate, OllamaUnavailable, OLLAMA_URL, OLLAMA_MODEL };
