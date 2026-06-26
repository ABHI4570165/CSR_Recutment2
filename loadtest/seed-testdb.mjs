/*
 * Seed an ISOLATED throwaway DB with sections, questions, and one ACTIVE walk-in drive.
 * Run with TEST_MONGO_URI pointing at a NON-production database name on the same cluster.
 *   node loadtest/seed-testdb.mjs
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const backendPkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backend", "package.json");
const require = createRequire(backendPkg);
const mongoose = require("mongoose");
const Assessment = require("./models/Assessment");
const Question = require("./models/Question");

const URI = process.env.TEST_MONGO_URI;
if (!URI || !/loadtest/i.test(URI)) {
  console.error("Refusing to seed: TEST_MONGO_URI must be set and contain 'loadtest' (safety guard).");
  process.exit(1);
}
const SECTION = "loadtest";
const CODE = "LT001";

(async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([Assessment.deleteMany({}), Question.deleteMany({})]); // fresh test DB
  const qs = [];
  for (let i = 0; i < 30; i++) {
    qs.push({ text: `Load test question ${i + 1}?`, options: ["A", "B", "C", "D"], correctIndex: i % 4, marks: 1, section: SECTION });
  }
  await Question.insertMany(qs);
  const drive = await Assessment.create({
    name: "LOAD TEST DRIVE", driveType: "WALK_IN", status: "ACTIVE", testCode: CODE,
    startAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 24 * 3600000),
    durationMinutes: 60, passingScore: 1,
    sections: [{ name: SECTION, displayName: "Load Test", questionCount: 10, color: "#4F46E5" }],
    maxCandidates: null, // unlimited for the test
  });
  console.log(`Seeded test DB. TEST_CODE=${CODE}  driveId=${drive._id}  questions=${qs.length}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
