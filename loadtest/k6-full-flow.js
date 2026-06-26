/*
 * FULL candidate-journey load test — WRITES DATA + SENDS EMAILS.
 * ⚠️  DO NOT run against production. Use a STAGING/LOCAL backend with a throwaway DB
 *     and email DISABLED (unset EMAIL_USER/EMAIL_PASS/BREVO_API_KEY), or you will
 *     create thousands of candidates and send thousands of real emails.
 *
 * Requires an ACTIVE WALK_IN drive and its test code.
 *
 * Run (staging):
 *   k6 run -e BASE_URL=http://localhost:8080 -e TEST_CODE=MH001 loadtest/k6-full-flow.js
 *
 * Scenarios mirror the real flow:
 *   validate → register → start → save(xN) → submit
 * Ramps 20 → 50 → 100 → 150 → 200 VUs.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const TEST_CODE = __ENV.TEST_CODE || "MH001";
const J = { headers: { "Content-Type": "application/json" }, timeout: "30s" };

const tRegister = new Trend("flow_register_ms", true);
const tStart    = new Trend("flow_start_ms", true);
const tSave     = new Trend("flow_save_ms", true);
const tSubmit   = new Trend("flow_submit_ms", true);
const flowOk    = new Rate("flow_completed");

export const options = {
  scenarios: {
    students: {
      executor: "ramping-vus", startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },  { duration: "2m", target: 20 },
        { duration: "1m", target: 50 },  { duration: "2m", target: 50 },
        { duration: "1m", target: 100 }, { duration: "2m", target: 100 },
        { duration: "1m", target: 150 }, { duration: "2m", target: 150 },
        { duration: "1m", target: 200 }, { duration: "3m", target: 200 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    "flow_register_ms": ["p(95)<3000"],
    "flow_start_ms":    ["p(95)<3000"],
    "flow_save_ms":     ["p(95)<1500"],
    "flow_submit_ms":   ["p(95)<4000"],
    "flow_completed":   ["rate>0.95"],
    "http_req_failed":  ["rate<0.05"],
  },
};

// Tiny valid PDF data URL (~1 KB) so resume upload exercises the pipeline realistically.
const PDF_B64 = "JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MDAgODAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCnRyYWlsZXIKPDwvUm9vdCAxIDAgUi9TaXplIDQ+PgpzdGFydHhyZWYKMTUwCiUlRU9G";
const FIRST = ["Aarav","Vivaan","Aditya","Ananya","Diya","Ishaan","Kabir","Sara","Riya","Arjun","Meera","Rohan","Neha","Karan","Pooja"];
const LAST  = ["Sharma","Verma","Patel","Reddy","Nair","Iyer","Gupta","Rao","Das","Mehta","Shetty","Kulkarni"];
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

export default function () {
  // Unique identity per virtual student (VU + iteration + time → no duplicates).
  const uid = `${__VU}_${__ITER}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `${rand(FIRST)} ${rand(LAST)}`;
  const cand = {
    testCode: TEST_CODE, name,
    email: `lt_${uid}@loadtest.local`,
    usn: `LT${digits(6)}`, phone: digits(10), aadhaar: digits(12),
    gender: rand(["Male", "Female"]), dob: "2002-05-15",
    college: "Load Test College", course: "B.E", branch: "CSE", location: "Test City",
    resume: { filename: `${name.replace(/\s/g, "_")}_CV.pdf`, mime: "application/pdf", data: `data:application/pdf;base64,${PDF_B64}` },
  };

  // 1) validate
  let r = http.post(`${BASE}/api/walkin/validate`, JSON.stringify({ testCode: TEST_CODE }), J);
  if (!check(r, { "validate ok": (x) => x.status === 200 })) { flowOk.add(false); return; }

  // 2) register → token
  r = http.post(`${BASE}/api/walkin/register`, JSON.stringify(cand), J);
  tRegister.add(r.timings.duration);
  if (!check(r, { "register ok": (x) => x.status === 201 || x.status === 200 })) { flowOk.add(false); return; }
  const token = r.json("token");
  if (!token) { flowOk.add(false); return; }

  sleep(Math.random() * 2 + 1);

  // 3) start → questions
  r = http.post(`${BASE}/api/candidate/${token}/start`, JSON.stringify({}), J);
  tStart.add(r.timings.duration);
  if (!check(r, { "start ok": (x) => x.status === 200 })) { flowOk.add(false); return; }
  const questions = r.json("data.questions") || [];

  // 4) answer + autosave (a few times, like a real attempt)
  const answers = {};
  const rounds = Math.min(questions.length, 8);
  for (let i = 0; i < rounds; i++) {
    answers[questions[i].id] = Math.floor(Math.random() * 4);
    if (i % 3 === 2) {
      const s = http.post(`${BASE}/api/candidate/${token}/save`,
        JSON.stringify({ answers, currentQuestion: i, violations: {} }), J);
      tSave.add(s.timings.duration);
      check(s, { "save ok": (x) => x.status === 200 });
    }
    sleep(Math.random() * 1.5 + 0.5); // think time between questions
  }

  // 5) submit
  r = http.post(`${BASE}/api/candidate/${token}/submit`,
    JSON.stringify({ answers, violations: {} }), J);
  tSubmit.add(r.timings.duration);
  const done = check(r, { "submit ok": (x) => x.status === 200 });
  flowOk.add(done);
}
