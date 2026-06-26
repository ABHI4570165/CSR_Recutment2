/*
 * Cleanup after the load test. Two modes:
 *   DROP_DB=true  → drop the ENTIRE isolated test database (cleanest; for the throwaway DB).
 *   default       → delete ONLY tagged test data (isTestCandidate + LOAD TEST drives) — safe
 *                   to run even against the real DB; never touches real candidates.
 *   node loadtest/cleanup.mjs
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const backendPkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backend", "package.json");
const require = createRequire(backendPkg);
const mongoose = require("mongoose");
const Assessment = require("./models/Assessment");
const Candidate = require("./models/Candidate");
const Question = require("./models/Question");

const URI = process.env.TEST_MONGO_URI || process.env.MONGO_URI;
(async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });

  if (process.env.DROP_DB === "true") {
    if (!/loadtest/i.test(URI)) { console.error("Refusing to DROP: URI must contain 'loadtest'."); process.exit(1); }
    await mongoose.connection.dropDatabase();
    console.log("Dropped entire test database.");
  } else {
    const c = await Candidate.deleteMany({ isTestCandidate: true });
    const a = await Assessment.deleteMany({ name: "LOAD TEST DRIVE" });
    const q = await Question.deleteMany({ section: "loadtest" });
    console.log(`Deleted: candidates=${c.deletedCount} testDrives=${a.deletedCount} testQuestions=${q.deletedCount}`);
    const remaining = await Candidate.countDocuments({ isTestCandidate: true });
    console.log(`Verification: remaining test candidates = ${remaining} (must be 0)`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
