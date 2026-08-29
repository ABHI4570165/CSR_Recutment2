/*
 * Two related repairs for candidates uploaded straight into a drive.
 *
 * 1. The unique index {applicationId, roundId} applied wherever isPrimary was
 *    true, including rows with NO applicationId — so all of them keyed as
 *    (null, roundId) and only one per round could be primary. The filter now
 *    also requires applicationId to exist.
 *
 * 2. Those candidates were given a roundId but never isPrimary, and every
 *    round-level query filters on it — so the round's student list, cutoff
 *    preview, apply and advance all skipped them.
 *
 *   node scripts/fixRoundParticipation.js [--dry]
 */
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  const dry = process.argv.includes("--dry");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const col = mongoose.connection.collection("candidates");
  const Candidate = require("../models/Candidate");

  const WANT = { isPrimary: true, applicationId: { $exists: true } };
  const ix = (await col.indexes()).find(i => i.name === "applicationId_1_roundId_1");
  const current = JSON.stringify(ix?.partialFilterExpression || null);
  console.log("  index filter now :", current);
  console.log("  index filter want:", JSON.stringify(WANT));

  if (current !== JSON.stringify(WANT)) {
    if (dry) console.log("  would drop and recreate the index");
    else {
      await col.dropIndex("applicationId_1_roundId_1");
      await col.createIndex({ applicationId: 1, roundId: 1 }, { unique: true, partialFilterExpression: WANT });
      console.log("  index recreated");
    }
  } else console.log("  index already correct");

  const rows = await Candidate.find({ roundId: { $exists: true }, isPrimary: { $exists: false } });
  console.log(`\n  candidates with a roundId but no isPrimary: ${rows.length}`);
  let n = 0;
  for (const c of rows) {
    if (!dry) {
      c.isPrimary = true;
      // Derived from how far the attempt actually got — never invented.
      if (!c.roundStatus) {
        c.roundStatus = c.status === "completed" ? "COMPLETED"
          : c.status === "disqualified" ? "REJECTED"
          : c.status === "in-progress" ? "IN_PROGRESS" : "NOT_STARTED";
      }
      await c.save();
    }
    n++;
  }
  console.log(`  ${dry ? "would fix" : "fixed"} ${n}`);
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
