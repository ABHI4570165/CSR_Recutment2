// Shared config + data generators for the full-flow load test.
export const BASE = __ENV.BASE_URL || "http://localhost:8080";
export const TEST_CODE = __ENV.TEST_CODE || "MH001";
export const JSON_HEADERS = { headers: { "Content-Type": "application/json" }, timeout: "30s" };

// Staged ramp: 20 → 50 → 100 → 150 → 200 → 250 → 300, with holds + pauses.
export const STAGES = [
  { duration: "30s", target: 20 },  { duration: "1m", target: 20 },
  { duration: "30s", target: 50 },  { duration: "1m", target: 50 },
  { duration: "30s", target: 100 }, { duration: "1m", target: 100 },
  { duration: "30s", target: 150 }, { duration: "1m", target: 150 },
  { duration: "30s", target: 200 }, { duration: "1m", target: 200 },
  { duration: "30s", target: 250 }, { duration: "1m", target: 250 },
  { duration: "30s", target: 300 }, { duration: "1m30s", target: 300 },
  { duration: "20s", target: 0 },
];

// ~1 KB valid PDF (so resume upload exercises the pipeline; tiny so it never fills storage).
export const PDF_B64 =
  "JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MDAgODAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCnRyYWlsZXIKPDwvUm9vdCAxIDAgUi9TaXplIDQ+PgpzdGFydHhyZWYKMTUwCiUlRU9G";

const FIRST = ["Aarav","Vivaan","Aditya","Ananya","Diya","Ishaan","Kabir","Sara","Riya","Arjun","Meera","Rohan","Neha","Karan","Pooja","Sneha","Varun","Tara"];
const LAST  = ["Sharma","Verma","Patel","Reddy","Nair","Iyer","Gupta","Rao","Das","Mehta","Shetty","Kulkarni"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

// Unique candidate per virtual user (VU + iteration + time + rand → no duplicates).
export function makeCandidate() {
  const uid = `${__VU}_${__ITER}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `${rnd(FIRST)} ${rnd(LAST)}`;
  const d = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  return {
    testCode: TEST_CODE, name,
    email: `lt_${uid}@test.local`,
    usn: `USN${d(6)}`, phone: `9${d(9)}`, aadhaar: d(12),
    gender: rnd(["Male", "Female"]), dob: "2002-05-15",
    college: "Load Test College", course: "B.E", branch: "Computer Science", location: "Test Address",
    resume: { filename: `${name.replace(/\s/g, "_")}_CV.pdf`, mime: "application/pdf", data: `data:application/pdf;base64,${PDF_B64}` },
  };
}
