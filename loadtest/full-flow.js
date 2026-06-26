/*
 * FULL candidate journey load test (k6). validate → register → start → answer+autosave → submit.
 * ⚠️ Run only against a backend in TEST_MODE with a THROWAWAY DB + email disabled.
 *   k6 run -e BASE_URL=http://localhost:8080 -e TEST_CODE=MH001 loadtest/full-flow.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { BASE, TEST_CODE, JSON_HEADERS, STAGES, makeCandidate } from "./config.js";

const tRegister = new Trend("register_ms", true);
const tStart    = new Trend("start_ms", true);
const tSave     = new Trend("autosave_ms", true);
const tSubmit   = new Trend("submit_ms", true);
const rRegister = new Rate("register_ok");
const rStart    = new Rate("start_ok");
const rSave     = new Rate("autosave_ok");
const rSubmit   = new Rate("submit_ok");
const rFlow     = new Rate("flow_ok");

export const options = {
  scenarios: { students: { executor: "ramping-vus", startVUs: 0, stages: STAGES } },
  thresholds: {
    register_ok: ["rate>0.95"], start_ok: ["rate>0.95"], autosave_ok: ["rate>0.95"],
    submit_ok: ["rate>0.95"], flow_ok: ["rate>0.95"], http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  const c = makeCandidate();

  // 1) validate test code
  let r = http.post(`${BASE}/api/walkin/validate`, JSON.stringify({ testCode: TEST_CODE }), JSON_HEADERS);
  if (!check(r, { "validate 200": (x) => x.status === 200 })) { rFlow.add(false); return; }

  // 2) register → token
  r = http.post(`${BASE}/api/walkin/register`, JSON.stringify(c), JSON_HEADERS);
  tRegister.add(r.timings.duration);
  const regOk = check(r, { "register 200/201": (x) => x.status === 200 || x.status === 201 });
  rRegister.add(regOk);
  const token = regOk ? r.json("token") : null;
  if (!token) { rFlow.add(false); return; }

  sleep(2 + Math.random() * 2);

  // 3) start → questions
  r = http.post(`${BASE}/api/candidate/${token}/start`, JSON.stringify({}), JSON_HEADERS);
  tStart.add(r.timings.duration);
  const startOk = check(r, { "start 200": (x) => x.status === 200 });
  rStart.add(startOk);
  if (!startOk) { rFlow.add(false); return; }
  const questions = r.json("data.questions") || [];

  // 4) answer with realistic think time + periodic autosave
  const answers = {};
  const n = Math.min(questions.length, 10);
  for (let i = 0; i < n; i++) {
    answers[questions[i].id] = Math.floor(Math.random() * 4);
    if (i % 3 === 2) {
      const s = http.post(`${BASE}/api/candidate/${token}/save`,
        JSON.stringify({ answers, currentQuestion: i, violations: {} }), JSON_HEADERS);
      tSave.add(s.timings.duration);
      rSave.add(check(s, { "save 200": (x) => x.status === 200 }));
    }
    sleep(2 + Math.random() * 4); // 2–6s think time per question
  }

  // 5) submit
  r = http.post(`${BASE}/api/candidate/${token}/submit`, JSON.stringify({ answers, violations: {} }), JSON_HEADERS);
  tSubmit.add(r.timings.duration);
  const subOk = check(r, { "submit 200": (x) => x.status === 200 });
  rSubmit.add(subOk);
  rFlow.add(subOk);
}
