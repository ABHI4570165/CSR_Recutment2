/*
 * Parser for the SET C / SET D technical papers, which use a NEW format:
 *   - Separate files: "<Set>_QuestionPaper.docx" and "<Set>_AnswerKey.docx".
 *   - 4 sections A–D (MCQ, Python, SQL, DSA), 40 questions, 1 mark each.
 *   - Section A answers are option letters; B/C/D answers are exact outputs.
 *   - Section C (SQL) has shared REFERENCE TABLES that every SQL question uses;
 *     they are captured as HTML and attached to each SQL question so students
 *     see the tables with every question. Code indentation is preserved.
 *
 * Questions live in the DB (editable in admin) — nothing hard-coded in app logic.
 */
const fs = require("fs");
const path = require("path");

const decode = (s) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Text of a <w:p>, preserving <w:br/>→newline and <w:tab/>→tab (keeps indentation).
function paraText(pXml) {
  let out = "";
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>|<w:tab\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(pXml)) !== null) {
    if (m[1] !== undefined) out += decode(m[1]);
    else if (/<w:tab/.test(m[0])) out += "\t";
    else out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

function tableRows(tblXml) {
  return [...tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
    [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
      [...c[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => decode(x[1])).join("").trim()
    )
  );
}

// Ordered sequence of paragraphs and tables from the document body.
function walkBody(xmlPath) {
  const xml = fs.readFileSync(xmlPath, "utf8");
  const items = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith("<w:tbl")) items.push({ type: "table", rows: tableRows(m[0]) });
    else { const t = paraText(m[0]); if (t.trim()) items.push({ type: "para", text: t }); }
  }
  return items;
}

function tableToHtml(name, rows) {
  if (!rows.length) return "";
  const head = rows[0], body = rows.slice(1);
  const th = head.map((h) => `<th>${esc(h)}</th>`).join("");
  const trs = body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<div class="qp-ref-table">${name ? `<div class="qp-ref-name">${esc(name)}</div>` : ""}` +
    `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

// Parse the ANSWER KEY doc → { "1": "B", "11": "16", ... } (question number → answer).
function parseAnswerKey(xmlPath) {
  const items = walkBody(xmlPath);
  const map = {};
  // Primary: a two-column table (Question | Answer), one row per question.
  for (const it of items) {
    if (it.type !== "table") continue;
    for (const row of it.rows) {
      if (row.length < 2) continue;
      const qm = String(row[0]).match(/^Q\s*(\d+)$/i);
      if (qm) map[qm[1]] = String(row[1]).trim();
    }
  }
  // Fallback: flattened paragraph pairs "Q1","B",...
  const paras = items.filter((i) => i.type === "para").map((i) => i.text.trim());
  for (let i = 0; i < paras.length - 1; i++) {
    const qm = paras[i].match(/^Q\s*(\d+)$/i);
    if (qm && map[qm[1]] == null) { const ans = paras[i + 1]; if (ans && !/^Q\s*\d+$/i.test(ans)) map[qm[1]] = ans; }
  }
  return map;
}

// Parse the QUESTION PAPER doc + answer map → question objects for one set.
function parseQuestionPaper(xmlPath, set, answers) {
  const items = walkBody(xmlPath);
  const questions = [];
  let sectionKey = null, sectionDisplay = null, secLetter = null, cur = null;
  let refHtml = "";              // reference-table HTML for the current (SQL) section
  let lastParaText = "";         // to name a table from its preceding paragraph

  const flush = () => {
    if (!cur) return;
    const ans = answers[String(cur.qno)];
    if (cur.type === "mcq") {
      // map answer letter (A–D) → correctIndex
      const idx = ans ? "ABCD".indexOf(ans.trim().toUpperCase()[0]) : -1;
      cur.correctIndex = idx;
      if (cur.options.length === 4 && idx >= 0) questions.push(cur);
    } else {
      cur.answerText = ans != null ? String(ans).trim() : null;
      if (cur.answerText) {
        if (cur.section === "t_sec_c" && refHtml) cur.reference = refHtml;
        questions.push(cur);
      }
    }
    cur = null;
  };

  for (const it of items) {
    if (it.type === "table") {
      // Reference table inside a section (SQL) — accumulate as HTML, named by the
      // paragraph immediately before it (e.g. "Emp", "Dept", "Sales").
      const name = /^[A-Za-z][\w ]{0,20}$/.test(lastParaText) ? lastParaText : "";
      refHtml += tableToHtml(name, it.rows);
      continue;
    }
    const p = it.text;
    lastParaText = p;

    const secM = p.match(/^SECTION\s+([A-Z])\b\s*[—–-]?\s*(.*)$/i);
    if (secM) {
      flush();
      secLetter = secM[1].toUpperCase();
      sectionKey = `t_sec_${secLetter.toLowerCase()}`;
      sectionDisplay = `Section ${secLetter} — ${secM[2].replace(/\(.*$/, "").trim()}`;
      refHtml = "";              // reference tables belong to the section they appear in
      continue;
    }
    const qM = p.match(/^Q(\d+)[.．]?\s*(.*)$/s);
    if (qM) {
      flush();
      const markM = p.match(/\[(\d+)\s*mark/i);
      const text = qM[2].replace(/\[\d+\s*mark[s]?\]/i, "").trim();
      // Sections B/C/D are "predict the output" typed-answer; Section A is MCQ.
      const isText = secLetter !== "A";
      cur = {
        set, round: 2, section: sectionKey, sectionDisplay, qno: parseInt(qM[1]),
        text, type: isText ? "text" : "mcq", options: [], correctIndex: -1,
        answerText: null, reference: null, marks: markM ? parseInt(markM[1]) : 1,
      };
      continue;
    }
    if (!cur) continue;
    // "Answer:" placeholder line in the question paper — ignore (real answer from key).
    if (/^Answer[:：]?\s*$/i.test(p)) continue;
    // MCQ option line.
    const oM = p.match(/^([A-D])[)）.]\s*(.*)$/);
    if (cur.type === "mcq" && oM) { cur.options.push(oM[2].trim()); continue; }
    // Continuation of the question stem (code / SQL, multi-line) before options.
    if (cur.options.length === 0 && !/^(INSTRUCTIONS|Marking|REFERENCE|[0-9]+ Questions|•)/i.test(p)) {
      cur.text += (cur.text ? "\n" : "") + p;
    }
  }
  flush();
  return questions;
}

function loadSetCD(root, set) {
  const q = path.join(root, `.docx_tmp/${set}_q/word/document.xml`);
  const a = path.join(root, `.docx_tmp/${set}_a/word/document.xml`);
  const answers = parseAnswerKey(a);
  return parseQuestionPaper(q, set, answers);
}

module.exports = { loadSetCD, parseAnswerKey, parseQuestionPaper, walkBody, tableToHtml };

// ── CLI validation ────────────────────────────────────────────────────────────
if (require.main === module) {
  const root = path.join(__dirname, "..", "..");
  for (const set of ["C", "D"]) {
    const qs = loadSetCD(root, set);
    console.log(`\n===== SET ${set}: ${qs.length} questions =====`);
    const bySec = {};
    qs.forEach((q) => { (bySec[q.section] ||= []).push(q); });
    Object.entries(bySec).forEach(([s, arr]) => {
      const withRef = arr.filter((q) => q.reference).length;
      console.log(`  ${s} (${arr[0].sectionDisplay}): ${arr.length} Qs, type=${arr[0].type}${withRef ? `, ${withRef} with ref-table` : ""}`);
    });
    const mcq = qs.filter((q) => q.type === "mcq"), text = qs.filter((q) => q.type === "text");
    console.log(`  mcq=${mcq.length} (all have correctIndex: ${mcq.every((q) => q.correctIndex >= 0)}), text=${text.length} (all have answer: ${text.every((q) => q.answerText)})`);
    const sample = text.find((q) => q.text.includes("\n"));
    if (sample) { console.log(`  sample code Q${sample.qno} (answer=${sample.answerText}):`); console.log(sample.text.split("\n").map((l) => "      " + l).join("\n")); }
  }
}
