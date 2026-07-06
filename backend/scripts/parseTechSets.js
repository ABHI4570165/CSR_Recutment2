/*
 * Parse the two Technical Round DOCX files into structured questions.
 * Reads pre-extracted word/document.xml (docx is a zip). Pure parser — no DB writes.
 * Exported so the seeder can reuse it. Questions live in the DB (editable in admin),
 * never hard-coded into app logic.
 */
const fs = require("fs");
const path = require("path");

function paragraphs(documentXmlPath) {
  const xml = fs.readFileSync(documentXmlPath, "utf8");
  return xml.split(/<\/w:p>/).map((p) => {
    const runs = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    return runs.join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .trim();
  }).filter(Boolean);
}

// Parse one document's paragraphs into questions. `set` = "A" | "B".
// Two question types:
//   mcq  — Section A: 4 options A–D, ✔ marks the correct one.
//   text — Sections B/C ("Type the exact output"): a typed answer given by "Answer: X".
function parseSet(paras, set) {
  const questions = [];
  let sectionKey = null, sectionDisplay = null, secLetter = null, cur = null;
  const flush = () => {
    if (!cur) return;
    // keep a question only if it's a complete MCQ (4 opts + answer) or a text Q with an answer
    if ((cur.type === "mcq" && cur.options.length === 4 && cur.correctIndex >= 0) ||
        (cur.type === "text" && cur.answerText != null && cur.answerText !== "")) {
      questions.push(cur);
    }
    cur = null;
  };

  for (const p of paras) {
    const secM = p.match(/^SECTION\s+([A-Z])\s*[—–-]\s*(.*)$/i);
    if (secM) {
      flush();
      secLetter = secM[1].toUpperCase();
      sectionKey = `t_sec_${secLetter.toLowerCase()}`;                 // t_sec_a | t_sec_b | t_sec_c
      sectionDisplay = `Section ${secLetter} — ${secM[2].replace(/\(.*$/, "").trim()}`;
      continue;
    }
    const qM = p.match(/^Q(\d+)[.．]?\s*(.*)$/);
    if (qM) {
      flush();
      const markM = p.match(/\[(\d+)\s*mark/i);
      const text = qM[2].replace(/\[\d+\s*mark[s]?\]/i, "").trim();
      cur = {
        set, round: 2, section: sectionKey, sectionDisplay, qno: parseInt(qM[1]),
        text, type: "mcq", options: [], correctIndex: -1, answerText: null,
        marks: markM ? parseInt(markM[1]) : (secLetter === "A" ? 1 : 2),
      };
      continue;
    }
    if (!cur) continue;
    // Typed-answer line → this is a text question.
    const ansM = p.match(/^Answer[:：]\s*(.*)$/i);
    if (ansM) { cur.type = "text"; cur.answerText = ansM[1].trim(); continue; }
    // MCQ option line.
    const oM = p.match(/^([A-D])[)）]\s*(.*)$/);
    if (oM) {
      let opt = oM[2];
      if (/[✔✓]/.test(opt)) cur.correctIndex = cur.options.length;
      cur.options.push(opt.replace(/[✔✓]/g, "").trim());
      continue;
    }
    // Continuation of the question stem (code / multi-line) — before options/answer.
    if (cur.options.length === 0 && cur.answerText == null && !/^(INSTRUCTIONS|Marking|FOR TL|•)/i.test(p)) {
      cur.text += (cur.text ? "\n" : "") + p;
    }
  }
  flush();
  return questions;
}

function loadSet(dir, set) {
  return parseSet(paragraphs(path.join(dir, "word", "document.xml")), set);
}

module.exports = { paragraphs, parseSet, loadSet };

// ── CLI: validate both files ──────────────────────────────────────────────────
if (require.main === module) {
  const root = path.join(__dirname, "..", "..");
  for (const [set, dir] of [["A", ".docx_tmp/A"], ["B", ".docx_tmp/B"]]) {
    const qs = loadSet(path.join(root, dir), set);
    console.log(`\n===== SET ${set}: ${qs.length} questions =====`);
    const bySec = {};
    qs.forEach((q) => { (bySec[q.section] ||= []).push(q); });
    Object.entries(bySec).forEach(([s, arr]) => {
      const marks = arr.reduce((a, q) => a + q.marks, 0);
      console.log(`  ${s} (${arr[0].sectionDisplay}): ${arr.length} Qs, ${marks} marks`);
    });
    const mcq = qs.filter((q) => q.type === "mcq"), text = qs.filter((q) => q.type === "text");
    console.log(`  types: mcq=${mcq.length}, text=${text.length} | total marks: ${qs.reduce((a, q) => a + q.marks, 0)}`);
    const bad = qs.filter((q) => (q.type === "mcq" && (q.options.length !== 4 || q.correctIndex < 0)) || (q.type === "text" && !q.answerText));
    console.log(`  PROBLEM questions: ${bad.length}`);
    bad.slice(0, 8).forEach((q) => console.log(`    ⚠ Q${q.qno} [${q.type}] :: ${q.text.slice(0, 50)}`));
    console.log(`  sample text Q: Q${text[0]?.qno} answer="${text[0]?.answerText}"`);
  }
}
