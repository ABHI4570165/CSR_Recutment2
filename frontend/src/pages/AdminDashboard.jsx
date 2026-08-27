import React, { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  adminLogin, clearAdminToken, fetchStats, fetchUsers, fetchAttempts,
  fetchSettings, updateSettings, fetchQuestions, addQuestion, updateQuestion,
  deleteQuestion, deleteUser, fetchCutoff, fetchSections,
  fetchAssessments, fetchOverview, createAssessment, updateAssessment, deleteAssessment,
  uploadCandidates, scheduleInvites, fetchCandidates, fetchCandidateStats,
  fetchDriveColleges, setCandidateStatus, deleteCandidate, downloadResume, downloadResumeFile, testEmail, fetchCandidateAnswers, terminateCandidate, refreshTestCode,
  getSystemStatus, setActiveMode, sendHeartbeat, warmAllBackends, BACKEND_COUNT,
  fetchRoundSummary, fetchCandidateJourney, moveToTechnical, fetchQuestionCatalog
} from "../utils/api";
import "./AdminDashboard.css";
// Multi-workspace recruitment module (additive — the legacy screens below are untouched).
import WorkspaceModule, { WorkspaceProvider, WorkspaceSwitcherSlot, useWorkspace } from "./workspace/WorkspaceModule";
import RoundsPage from "./workspace/RoundsPage";
import RoundPanel from "./workspace/RoundPanel";

// Read-only viewer? (role stored at login). Mutating UI is hidden when true;
// the backend ALSO rejects mutations from viewer tokens (defence in depth).
const isViewer = () => localStorage.getItem("adminRole") === "viewer";

const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—";
const fmtDateTime = d => d ? new Date(d).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "—";
const fmtTimeOnly = d => d ? new Date(d).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "—";
const fmtSecs = s => { if(s==null) return "—"; const m=Math.floor(s/60); return `${m}m ${s%60}s`; };
const mmss = s => { const m=Math.floor(s/60), ss=s%60; return `${m}:${String(ss).padStart(2,"0")}`; };

// Live "Time Left" cell for the candidates table. Self-ticks every second so the
// countdown moves without re-fetching. Mirrors the backend's authoritative calc:
// remaining = durationMinutes*60 − (now − startedAt).  (backend: remainingSeconds())
function TimeLeftCell({ candidate: c, durationMinutes }) {
  const [, force] = useState(0);
  const active = (c.status === "started" || c.status === "in-progress") && c.startedAt;
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(iv);
  }, [active]);

  if (c.status === "completed") return <span style={{fontSize:12,color:"#059669",fontWeight:700}}>✓ Done</span>;
  if (c.status === "disqualified" || c.status === "timed-out") return <span style={{fontSize:12,color:"#DC2626"}}>—</span>;
  if (!active) return <span style={{fontSize:12,color:"#94A3B8"}}>—</span>;

  const total = (durationMinutes || 40) * 60;
  const elapsed = Math.floor((Date.now() - new Date(c.startedAt).getTime()) / 1000);
  const left = Math.max(0, total - elapsed);
  if (left <= 0) return <span style={{fontSize:12,color:"#DC2626",fontWeight:700}}>⏳ Time up</span>;
  const color = left <= 120 ? "#DC2626" : left <= 300 ? "#D97706" : "#0F766E";
  return <span className="ad-mono" style={{fontSize:13,fontWeight:700,color}} title="Time remaining (live)">⏱ {mmss(left)}</span>;
}

// Generate a color from a section name (for sections without defined color)
const PALETTE = ["#4F46E5","#7C3AED","#0891B2","#059669","#D97706","#DC2626","#0D9488","#7C3AED","#BE185D","#1D4ED8"];
function sectionColor(sec, idx) {
  return sec.color || PALETTE[idx % PALETTE.length];
}

const Spinner = ({dark}) => <span className={dark?"ad-spin-dark":"ad-spin"}/>;

// Round-2 technical section options (for the section dropdown when editing/creating).
const TECH_SECTION_OPTS = [
  { name:"t_sec_a", displayName:"[R2] Section A — MCQs" },
  { name:"t_sec_b", displayName:"[R2] Section B — Python / Output" },
  { name:"t_sec_c", displayName:"[R2] Section C — Advanced / SQL" },
  { name:"t_sec_d", displayName:"[R2] Section D — DSA" },
  // Trainer bank (set T) — its own section keys so it never mixes with sets A–D.
  { name:"tr_sec_a", displayName:"[Trainer] Section A — Data Analytics MCQs" },
  { name:"tr_sec_b", displayName:"[Trainer] Section B — Data Science / ML MCQs" },
  { name:"tr_sec_c", displayName:"[Trainer] Section C — Application-Level" },
  { name:"tr_sec_d", displayName:"[Trainer] Section D — Output Prediction" },
  { name:"tr_sec_e", displayName:"[Trainer] Section E — Scenario-Based" },
];
// Round-2 versions: Version A = Sets A & B (aptitude), Version B = Sets C & D (advanced),
// Trainer = the DS/DA trainer screening bank (single set T, so every candidate gets it).
const ROUND2_VERSIONS = {
  A:  { label:"Version A — Aptitude · Set A & B · 30 Q · 30 marks (1 each)",                        sets:["A","B"] },
  B:  { label:"Version B — Advanced Python/SQL/DSA · Set C & D · 40 Q · 40 marks (1 each)",         sets:["C","D"] },
  T1: { label:"Trainer (DS/DA) — MCQ Screening · Set T · 24 Q · fully auto-scored",                 sets:["T"] },
  T2: { label:"Trainer (DS/DA) — Full Bank A–E · Set T · 54 Q · Sections C/D/E reviewed by hand",   sets:["T"] },
};
const SET_TO_VERSION = { A:"A", B:"A", C:"B", D:"B", T:"T2" };

// ── Question Form (MCQ or typed-answer) ───────────────────────────────────────
function QuestionForm({ initial, onSave, onCancel, saving, sections }) {
  const [text,   setText]   = useState(initial?.text||"");
  const [type,   setType]   = useState(initial?.type||"mcq");
  const [opts,   setOpts]   = useState(initial?.options||["","","",""]);
  const [correct,setCorrect]= useState(initial?.correctIndex??0);
  const [answerText,setAnswerText]=useState(initial?.answerText||"");
  const [longAnswer,setLongAnswer]=useState(!!initial?.longAnswer);
  const [marks,  setMarks]  = useState(initial?.marks||1);
  const [section,setSection]= useState(initial?.section||(sections[0]?.name||"aptitude"));
  const [round,  setRound]  = useState(initial?.round||1);
  const [set,    setSet]    = useState(initial?.set||"");
  const [err,    setErr]    = useState("");

  // Section options: round-1 pool + the round-2 tech sections + the question's own section.
  const secOpts=[...sections.map(s=>({name:s.name,displayName:s.displayName})),...TECH_SECTION_OPTS];
  if(initial?.section && !secOpts.some(s=>s.name===initial.section)) secOpts.push({name:initial.section,displayName:initial.section});

  const save = () => {
    if(!text.trim())          { setErr("Question text is required."); return; }
    if(!section)              { setErr("Please select a section."); return; }
    if(Number(round)===2 && !set){ setErr("Round 2 questions must belong to a Set (A/B in Version A, C/D in Version B, T for the Trainer bank)."); return; }
    const base={ text:text.trim(), type, marks:Number(marks)||1, section,
      round:Number(round)||1, set: Number(round)===2 ? set : null };
    if(type==="text"){
      if(!answerText.trim()){ setErr(longAnswer?"Enter the model answer / rubric an evaluator should mark against.":"Enter the expected answer for this text question."); return; }
      onSave({ ...base, answerText:answerText.trim(), longAnswer });
    } else {
      if(opts.some(o=>!o.trim())){ setErr("All 4 options are required."); return; }
      onSave({ ...base, options:opts.map(o=>o.trim()), correctIndex:correct });
    }
  };

  return (
    <div className="ad-qform">
      <div className="ad-qform-row">
        <div className="ad-field" style={{flex:2}}>
          <label className="ad-label">Question Text</label>
          <textarea className="ad-input ad-textarea" rows={3} value={text}
            onChange={e=>{setText(e.target.value);setErr("");}} placeholder="Enter question text..."/>
        </div>
        <div className="ad-field" style={{gap:8}}>
          <label className="ad-label">Type</label>
          <select className="ad-input ad-select" value={type} onChange={e=>setType(e.target.value)}>
            <option value="mcq">Multiple choice (4 options)</option>
            <option value="text">Typed answer</option>
          </select>
          <label className="ad-label" style={{marginTop:6}}>Section</label>
          <select className="ad-input ad-select" value={section} onChange={e=>setSection(e.target.value)}>
            {secOpts.map(s=>(<option key={s.name} value={s.name}>{s.displayName}</option>))}
          </select>
          <label className="ad-label" style={{marginTop:6}}>Marks</label>
          <input type="number" className="ad-input" value={marks} min={1}
            onChange={e=>setMarks(e.target.value)} style={{height:38}}/>
          <label className="ad-label" style={{marginTop:6}}>Round</label>
          <select className="ad-input ad-select" value={round} onChange={e=>setRound(Number(e.target.value))}>
            <option value={1}>Round 1 (Aptitude pool)</option>
            <option value={2}>Round 2 (Technical)</option>
          </select>
          {Number(round)===2 && (<>
            <label className="ad-label" style={{marginTop:6}}>Version · Set</label>
            <select className="ad-input ad-select" value={set} onChange={e=>setSet(e.target.value)}>
              <option value="">Select set…</option>
              <optgroup label="Version A (Aptitude)">
                <option value="A">Set A</option>
                <option value="B">Set B</option>
              </optgroup>
              <optgroup label="Version B (Advanced)">
                <option value="C">Set C</option>
                <option value="D">Set D</option>
              </optgroup>
              <optgroup label="Trainer (DS/DA)">
                <option value="T">Set T</option>
              </optgroup>
            </select>
          </>)}
        </div>
      </div>
      {type==="text" ? (
        <div className="ad-field" style={{marginTop:4}}>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,marginBottom:8,cursor:"pointer"}}>
            <input type="checkbox" checked={longAnswer} onChange={e=>setLongAnswer(e.target.checked)}/>
            Open-ended / essay answer — show a large text box and mark it by hand
          </label>
          <label className="ad-label">
            {longAnswer ? "Model Answer / Rubric (shown to the evaluator only — never auto-scored)"
                        : "Expected Answer (exact output — case/space insensitive)"}
          </label>
          {longAnswer
            ? <textarea className="ad-input ad-textarea" rows={4} value={answerText}
                onChange={e=>{setAnswerText(e.target.value);setErr("");}}
                placeholder="What to look for: …"/>
            : <input className="ad-input" value={answerText} onChange={e=>{setAnswerText(e.target.value);setErr("");}}
                placeholder="e.g. 4"/>}
        </div>
      ) : (
        <div className="ad-qform-opts">
          {opts.map((o,i)=>(
            <div key={i} className="ad-opt-row">
              <button type="button" className={`ad-radio ${correct===i?"ad-radio--on":""}`}
                onClick={()=>setCorrect(i)} title="Mark as correct answer">
                {correct===i?"✓":"○"}
              </button>
              <input className="ad-input" value={o}
                onChange={e=>{const n=[...opts];n[i]=e.target.value;setOpts(n);setErr("");}}
                placeholder={`Option ${i+1}`}/>
            </div>
          ))}
          <p className="ad-hint">Click ✓/○ to mark the correct answer</p>
        </div>
      )}
      {err && <p className="ad-form-err">{err}</p>}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button className="ad-btn ad-btn--primary" style={{flex:1}} onClick={save} disabled={saving}>
          {saving?<><Spinner/>Saving…</>:initial?"Update Question":"Add Question"}
        </button>
        <button className="ad-btn ad-btn--outline" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, onConfirm, onCancel, loading, confirmLabel="Delete", busyLabel="Deleting…" }) {
  return (
    <div className="ad-overlay" onClick={onCancel}>
      <div className="ad-modal ad-modal--sm" onClick={e=>e.stopPropagation()}>
        <h3 className="ad-modal-title">{title}</h3>
        <p style={{color:"var(--text-2)",fontSize:14,marginBottom:20,whiteSpace:"pre-line"}}>{message}</p>
        <div style={{display:"flex",gap:10}}>
          <button className="ad-btn ad-btn--outline" style={{flex:1}} onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="ad-btn ad-btn--danger"  style={{flex:1}} onClick={onConfirm} disabled={loading}>
            {loading?<><Spinner/>{busyLabel}</>:confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Color Palette for new sections ────────────────────────────────────────────
const COLOR_PALETTE = [
  { hex:"#4F46E5", label:"Indigo"  },
  { hex:"#7C3AED", label:"Violet"  },
  { hex:"#0891B2", label:"Cyan"    },
  { hex:"#059669", label:"Emerald" },
  { hex:"#D97706", label:"Amber"   },
  { hex:"#DC2626", label:"Red"     },
  { hex:"#0EA5E9", label:"Sky"     },
  { hex:"#8B5CF6", label:"Purple"  },
  { hex:"#EC4899", label:"Pink"    },
  { hex:"#14B8A6", label:"Teal"    },
];

// ── Settings Tab (with custom section manager) ─────────────────────────────────
function SettingsTab({ settings, setSettings, updateSection, handleSaveSettings, setSaving, setMsg, onSectionsChange }) {
  const [newSec,      setNewSec]      = useState({ name:"", displayName:"", questionCount:20, color:"#4F46E5" });
  const [addingErr,   setAddingErr]   = useState("");
  const [addingSaving,setAddingSaving]= useState(false);
  const [deleting,    setDeleting]    = useState("");

  const handleAddSection = async () => {
    if (!newSec.name.trim() || !newSec.displayName.trim()) { setAddingErr("Both internal name and display name are required."); return; }
    setAddingErr(""); setAddingSaving(true);
    try {
      await addSection(newSec);
      setNewSec({ name:"", displayName:"", questionCount:20, color:"#4F46E5" });
      await onSectionsChange();
    } catch(e) { setAddingErr(e.message||"Failed to add section."); }
    finally { setAddingSaving(false); }
  };

  const handleDeleteSection = async (name) => {
    if (!window.confirm(`Delete section "${name}"? Questions in this section will remain but won't appear in the quiz.`)) return;
    setDeleting(name);
    try {
      await deleteSection(name);
      await onSectionsChange();
    } catch(e) { alert(e.message||"Failed to delete section."); }
    finally { setDeleting(""); }
  };

  return (
    <div style={{maxWidth:680}}>
      {/* ── Quiz timing & scoring ── */}
      <div className="ad-settings-card" style={{marginBottom:20}}>
        <div className="ad-page-title">Quiz Settings</div>
        <div className="ad-settings-grid">
          <div className="ad-field">
            <label className="ad-label">Time Limit (minutes)</label>
            <input type="number" className="ad-input" value={settings.timeLimitMinutes} min={1} max={300}
              onChange={e=>setSettings(s=>({...s,timeLimitMinutes:parseInt(e.target.value)||40}))}/>
            <span className="ad-hint">Server enforced — quiz auto-submits on expiry</span>
          </div>
          <div className="ad-field">
            <label className="ad-label">Passing Score — Internal Only</label>
            <input type="number" className="ad-input" value={settings.passingScore} min={1}
              onChange={e=>setSettings(s=>({...s,passingScore:parseInt(e.target.value)||30}))}/>
            <span className="ad-hint">Used for admin filters. Not shown to students.</span>
          </div>
        </div>
        {setMsg && <p style={{fontSize:13,color:setMsg.startsWith("✅")?"#059669":"#DC2626",marginBottom:12,fontWeight:600}}>{setMsg}</p>}
        <button className="ad-btn ad-btn--primary" style={{width:"auto",paddingInline:32}} onClick={handleSaveSettings} disabled={setSaving}>
          {setSaving?<><Spinner/>Saving...</>:"Save Settings"}
        </button>
      </div>

      {/* ── Section manager ── */}
      <div className="ad-settings-card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
          <div className="ad-page-title" style={{marginBottom:0}}>Sections Manager</div>
          <span style={{fontSize:12,color:"var(--text-3)"}}>Changes apply to future quiz sessions</span>
        </div>

        {/* Existing sections */}
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
          {(settings.sections||[]).length === 0 && <div className="ad-empty" style={{padding:"20px"}}>No sections yet. Add one below.</div>}
          {(settings.sections||[]).map((sec,i)=>(
            <div key={sec.name} className="ad-sec-edit-row">
              <div className="ad-sec-edit-color" style={{background:sec.color||"#4F46E5"}}/>
              <div style={{flex:1,minWidth:0}}>
                <div className="ad-field" style={{marginBottom:8}}>
                  <label className="ad-label">Display Name</label>
                  <input className="ad-input" value={sec.displayName}
                    onChange={e=>updateSection(i,"displayName",e.target.value)}
                    style={{height:38}}/>
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <div className="ad-field" style={{flex:1,minWidth:100}}>
                    <label className="ad-label">Questions Count</label>
                    <input type="number" className="ad-input" value={sec.questionCount} min={1}
                      onChange={e=>updateSection(i,"questionCount",parseInt(e.target.value)||1)}
                      style={{height:38}}/>
                  </div>
                  <div className="ad-field" style={{flex:1,minWidth:100}}>
                    <label className="ad-label">Color</label>
                    <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",paddingTop:4}}>
                      {COLOR_PALETTE.map(c=>(
                        <button key={c.hex} title={c.label}
                          style={{width:20,height:20,borderRadius:4,background:c.hex,border:sec.color===c.hex?"3px solid #1E1B4B":"1.5px solid transparent",cursor:"pointer",flexShrink:0}}
                          onClick={()=>updateSection(i,"color",c.hex)}/>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{fontSize:11,color:"var(--text-3)",marginTop:4}}>
                  Internal key: <code style={{background:"var(--surface-2)",color:"var(--text-2)",padding:"1px 5px",borderRadius:3}}>{sec.name}</code>
                </div>
              </div>
              <button className="ad-btn ad-btn--sm ad-btn--danger" style={{alignSelf:"flex-start",marginTop:4,flexShrink:0}}
                onClick={()=>handleDeleteSection(sec.name)} disabled={deleting===sec.name}>
                {deleting===sec.name?<><Spinner/>...</>:"Delete"}
              </button>
            </div>
          ))}
        </div>

        {/* Save existing section edits */}
        {(settings.sections||[]).length > 0 && (
          <button className="ad-btn ad-btn--outline" style={{width:"100%",marginBottom:20}} onClick={handleSaveSettings} disabled={setSaving}>
            {setSaving?<><Spinner/>Saving...</>:"Save Section Changes"}
          </button>
        )}

        {/* Add new section */}
        <div className="ad-new-section-box">
          <div style={{fontSize:13,fontWeight:700,color:"var(--text-1)",marginBottom:12}}>+ Add New Section</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <div className="ad-field" style={{flex:1,minWidth:120}}>
              <label className="ad-label">Internal Key (slug)</label>
              <input className="ad-input" value={newSec.name} placeholder="e.g. gk, math, science"
                onChange={e=>{ setNewSec(s=>({...s,name:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"_")})); setAddingErr(""); }}/>
              <span className="ad-hint">Lowercase, no spaces (auto-converted)</span>
            </div>
            <div className="ad-field" style={{flex:1,minWidth:120}}>
              <label className="ad-label">Display Name</label>
              <input className="ad-input" value={newSec.displayName} placeholder="e.g. General Knowledge"
                onChange={e=>{ setNewSec(s=>({...s,displayName:e.target.value})); setAddingErr(""); }}/>
            </div>
            <div className="ad-field" style={{width:110}}>
              <label className="ad-label">Questions</label>
              <input type="number" className="ad-input" value={newSec.questionCount} min={1}
                onChange={e=>setNewSec(s=>({...s,questionCount:parseInt(e.target.value)||20}))}/>
            </div>
          </div>
          <div className="ad-field" style={{marginBottom:12}}>
            <label className="ad-label">Section Color</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",paddingTop:4}}>
              {COLOR_PALETTE.map(c=>(
                <button key={c.hex} title={c.label}
                  style={{width:24,height:24,borderRadius:6,background:c.hex,border:newSec.color===c.hex?"3px solid #1E1B4B":"1.5px solid transparent",cursor:"pointer"}}
                  onClick={()=>setNewSec(s=>({...s,color:c.hex}))}/>
              ))}
            </div>
          </div>
          {addingErr && <p className="ad-form-err" style={{marginBottom:8}}>{addingErr}</p>}
          <button className="ad-btn ad-btn--primary" style={{width:"100%"}} onClick={handleAddSection} disabled={addingSaving}>
            {addingSaving?<><Spinner/>Adding...</>:`+ Add "${newSec.displayName||"Section"}" to Quiz`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ mode = "admin", onLogin }) {
  const [user,setUser]= useState("");
  const [pass,setPass]= useState("");
  const [err, setErr] = useState("");
  const [loading,setLoading]= useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const res = await adminLogin({ username:user, password:pass });
      const role = res.data.role || "admin";
      if (role !== mode) {  // credentials belong to the other dashboard
        setErr(mode==="admin"
          ? "These credentials are not valid for the admin dashboard."
          : "These credentials are not valid for the viewer dashboard.");
        setLoading(false); return;
      }
      localStorage.setItem("adminToken", res.data.token);          // persistent (survives browser close)
      localStorage.setItem("adminRole", role);                     // "admin" | "viewer"
      // A new session always begins at the GLOBAL OVERVIEW — drop any workspace
      // an earlier session had open so nothing is auto-selected.
      localStorage.removeItem("mh_workspace");
      onLogin();
    } catch(er) { setErr(er.message||"Invalid credentials"); }
    finally { setLoading(false); }
  };
  return (
    <div className="ad-login-page">
      <div className="ad-login-card">
        <div className="ad-login-logo"><img src="/logo.png" alt="M H Foundation" style={{width:"100%",height:"100%",objectFit:"contain",borderRadius:"inherit"}} onError={e=>{e.currentTarget.parentNode.textContent="M";}}/></div>
        <div className="ad-login-brand">M H FOUNDATION</div>
        <div className="ad-login-sub">M H Foundation® · {mode==="viewer"?"Viewer (Read-only)":"Admin"} Portal</div>
        <form className="ad-login-form" onSubmit={submit}>
          <div className="ad-field">
            <label className="ad-label">Username</label>
            <input className="ad-input" value={user} onChange={e=>setUser(e.target.value)} placeholder="Admin username" autoComplete="off"/>
          </div>
          <div className="ad-field">
            <label className="ad-label">Password</label>
            <input type="password" className="ad-input" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Password"/>
          </div>
          {err && <p className="ad-form-err">{err}</p>}
          <button className="ad-btn ad-btn--primary" type="submit" disabled={loading} style={{width:"100%",marginTop:4}}>
            {loading?<><Spinner/>Signing in…</>:"Sign In →"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────
function Pagination({ pag, page, setPage }) {
  if (!pag?.pages || pag.pages <= 1) return null;
  return (
    <div className="ad-pagination">
      <span className="ad-pag-info">Showing {(page-1)*15+1}–{Math.min(page*pag.limit||15,pag.total)} of {pag.total}</span>
      <div className="ad-pag-btns">
        <button className="ad-pag-btn" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>← Prev</button>
        {Array.from({length:Math.min(pag.pages,7)},(_,i)=>i+1).map(p=>(
          <button key={p} className={`ad-pag-btn ${p===page?"ad-pag-btn--active":""}`} onClick={()=>setPage(p)}>{p}</button>
        ))}
        <button className="ad-pag-btn" disabled={page>=pag.pages} onClick={()=>setPage(p=>p+1)}>Next →</button>
      </div>
    </div>
  );
}

// ── Cutoff Tab ─────────────────────────────────────────────────────────────────
function CutoffTab() {
  const [cutoff,    setCutoff]    = useState("");
  const [preview,   setPreview]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [confirming,setConfirming]= useState(false);
  const [drives,    setDrives]    = useState([]);
  const [assessmentId, setAssessmentId] = useState("");   // "" = all drives
  useEffect(()=>{ (async()=>{ try{ const r=await fetchAssessments(); setDrives(r.data.data||[]); }catch{} })(); },[]);
  const [exporting, setExporting] = useState(false);
  const [page,      setPage]      = useState(1);
  const [err,       setErr]       = useState("");

  const loadPreview = async (pg=1) => {
    const c = parseInt(cutoff);
    if (isNaN(c)||c<0) { setErr("Please enter a valid cutoff score."); return; }
    setErr(""); setLoading(true);
    try {
      const res = await fetchCutoff({ cutoff:c, page:pg, limit:500, assessmentId:assessmentId||undefined });
      setPreview(res.data.data); setPage(pg);
    } catch(e) { setErr(e.message||"Failed to load."); }
    finally { setLoading(false); }
  };

  const handleExport = async () => {
    setExporting(true); setConfirming(false);
    try {
      const cutoffValue = parseInt(cutoff);
      let allUsers = [];
      let currentPage = 1;
      let hasMore = true;

      // Fetch all pages to get all students
      while (hasMore) {
        const res = await fetchCutoff({ cutoff:cutoffValue, page:currentPage, limit:100000, assessmentId:assessmentId||undefined });
        const users = res.data.data.users || [];
        allUsers = allUsers.concat(users);
        
        // Check if there are more pages
        const total = res.data.data.total || 0;
        if (allUsers.length >= total) {
          hasMore = false;
        } else {
          currentPage++;
        }
      }

      // Format and export to Excel
      const rows = allUsers;
      const ws = XLSX.utils.json_to_sheet(rows.map((u,i)=>({
        "#":i+1, Name:u.name, Email:u.email, College:u.college, Drive:u.drive||"",
        USN:u.rollNo, Phone:u.phone, Score:u.score, "Total Marks":u.totalMarks,
        Completed:fmtDate(u.createdAt),
      })));
      ws["!cols"]=[6,22,28,22,26,14,14,8,12,14].map(w=>({wch:w}));
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,`Cutoff_${cutoff}`);
      XLSX.writeFile(wb,`MHA_Cutoff_${cutoff}_Students.xlsx`);
    } catch(e) { alert("Export failed: "+e.message); }
    finally { setExporting(false); }
  };

  return (
    <div>
      <div className="ad-page-title">Cutoff Filter & Export</div>
      <p style={{fontSize:13,color:"var(--text-3)",marginBottom:20}}>Enter a minimum score, preview the list, then export to Excel.</p>
      <div className="ad-cutoff-step">
        <div className="ad-cutoff-step-num">1</div>
        <div style={{flex:1}}>
          <div className="ad-label" style={{marginBottom:8}}>Enter Cutoff Score</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <input type="number" className="ad-input" style={{width:160}} placeholder="e.g. 30" value={cutoff}
              onChange={e=>{setCutoff(e.target.value);setPreview(null);setErr("");}}
              onKeyDown={e=>e.key==="Enter"&&loadPreview(1)}/>
            <select className="ad-select" style={{minWidth:220}} value={assessmentId}
              onChange={e=>{setAssessmentId(e.target.value);setPreview(null);}}>
              <option value="">All Rounds</option>
              {drives.map(d=><option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
            <button className="ad-btn ad-btn--primary" onClick={()=>loadPreview(1)} disabled={loading||!cutoff}>
              {loading?<><Spinner/>Loading…</>:"Preview Results"}
            </button>
          </div>
          <span className="ad-hint">Cutoff runs across this workspace. Narrow it to one round’s test, or leave “All Rounds” to include everyone.</span>
          {err && <p className="ad-form-err" style={{marginTop:8}}>{err}</p>}
        </div>
      </div>
      {preview && (
        <>
          <div className="ad-cutoff-step">
            <div className="ad-cutoff-step-num">2</div>
            <div style={{flex:1}}>
              <div className="ad-label" style={{marginBottom:12}}>Preview — Score ≥ {preview.cutoff}</div>
              <div className="ad-cutoff-stats">
                <div className="ad-cutoff-stat" style={{borderTopColor:"#4F46E5"}}>
                  <div className="ad-cutoff-stat-val" style={{color:"#4F46E5"}}>{preview.total}</div>
                  <div className="ad-cutoff-stat-lbl">Students Above Cutoff</div>
                </div>
                <div className="ad-cutoff-stat" style={{borderTopColor:"#059669"}}>
                  <div className="ad-cutoff-stat-val" style={{color:"#059669"}}>{preview.topScore}</div>
                  <div className="ad-cutoff-stat-lbl">Highest Score</div>
                </div>
                <div className="ad-cutoff-stat" style={{borderTopColor:"#D97706"}}>
                  <div className="ad-cutoff-stat-val" style={{color:"#D97706"}}>{preview.cutoff}</div>
                  <div className="ad-cutoff-stat-lbl">Cutoff Score</div>
                </div>
              </div>
              {preview.users.length===0
                ? <div className="ad-empty">No students scored ≥ {preview.cutoff}.</div>
                : <>
                    <div className="ad-table-wrap" style={{marginBottom:10}}>
                      <table className="ad-table">
                        <thead><tr><th>#</th><th>Name</th><th>College</th><th>Drive</th><th>Score</th><th>Total</th></tr></thead>
                        <tbody>{preview.users.map((u,i)=>(
                          <tr key={u._id}>
                            <td className="ad-td-num">{(page-1)*50+i+1}</td>
                            <td><div className="ad-td-name"><div className="ad-avatar">{u.name.charAt(0)}</div>{u.name}</div></td>
                            <td className="ad-td-sm">{u.college}</td>
                            <td className="ad-td-sm">{u.drive||"—"}</td>
                            <td><strong style={{color:"#4F46E5",fontSize:15}}>{u.score}</strong></td>
                            <td className="ad-td-sm">{u.totalMarks}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <Pagination pag={{pages:preview.pages,total:preview.total,limit:500}} page={page} setPage={pg=>loadPreview(pg)}/>
                  </>
              }
            </div>
          </div>
          {preview.total > 0 && (
            <div className="ad-cutoff-step">
              <div className="ad-cutoff-step-num">3</div>
              <div style={{flex:1}}>
                <div className="ad-label" style={{marginBottom:8}}>Finalize & Export</div>
                <p style={{fontSize:13,color:"var(--text-3)",marginBottom:14}}>
                  Export all <strong>{preview.total}</strong> students (score ≥ {preview.cutoff}) to Excel.
                </p>
                {confirming ? (
                  <div className="ad-cutoff-confirm">
                    <p style={{fontSize:14,fontWeight:600,color:"var(--text-1)",marginBottom:12}}>
                      Export <strong>{preview.total} students</strong> with score ≥ <strong>{preview.cutoff}</strong>?
                    </p>
                    <div style={{display:"flex",gap:10}}>
                      <button className="ad-btn ad-btn--outline" onClick={()=>setConfirming(false)}>Cancel</button>
                      <button className="ad-btn ad-btn--export" onClick={handleExport} disabled={exporting}>
                        {exporting?<><Spinner/>Exporting…</>:"⬇ Confirm Export"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="ad-btn ad-btn--primary" onClick={()=>setConfirming(true)}>
                    ⬇ Export {preview.total} Students to Excel
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Campus Drives Tab (invitation-based assessments) ───────────────────────────
const STATUS_META = [
  { key:"invited",     label:"Invited",     color:"#64748B" },
  { key:"email-sent",  label:"Link Sent",   color:"#0891B2" },
  { key:"in-progress", label:"In Progress", color:"#D97706" },
  { key:"completed",   label:"Completed",   color:"#059669" },
  { key:"disqualified",label:"Disqualified",color:"#DC2626" },
  { key:"shortlisted", label:"Shortlisted", color:"#2563EB" },
  { key:"rejected",    label:"Rejected",    color:"#991B1B" },
];

const LINK_SEND_OPTIONS = [
  { value:"immediately", label:"Send Immediately" },
  { value:"15min",       label:"15 Minutes Before Start" },
  { value:"30min",       label:"30 Minutes Before Start" },
  { value:"1hour",       label:"1 Hour Before Start" },
  { value:"2hours",      label:"2 Hours Before Start" },
  { value:"custom",      label:"Custom Date & Time" },
];

// Human-readable violation breakdown for the dashboard tooltip.
const VIOL_LABELS = {
  fullscreenExits:"Fullscreen exits", tabSwitches:"Tab switches", focusLoss:"Focus loss", multipleFaces:"Multiple faces",
  refresh:"Refreshes", devtools:"DevTools", clipboard:"Clipboard", idle:"Idle", windowResize:"Window resize",
  location:"Location", cameraDisconnect:"Camera disconnect", faceHidden:"Face hidden",
};
function violBreakdown(c){
  const v=c.violations||{};
  const parts=Object.entries(VIOL_LABELS).filter(([k])=>(v[k]||0)>0).map(([k,l])=>`${l}: ${v[k]}`);
  return parts.length?parts.join("\n"):"No violations";
}

const SECURITY_KEYS = [
  ["desktopOnly",           "Desktop Only"],
  ["fullscreenEnforcement", "Fullscreen Enforcement"],
  ["cameraMonitoring",      "Camera Monitoring"],
  ["faceVerification",      "Face Verification"],
  ["multipleFaceDetection", "Multiple Face Detection"],
  ["faceVisibilityDetection","Face Visibility (auto-terminate)"],
  ["cameraDisconnectDetection","Camera Disconnect Detection"],
  ["tabSwitchDetection",    "Tab Switch Detection"],
  ["violationTracking",     "Violation Tracking"],
  ["refreshProtection",     "Browser Refresh Protection"],
  ["rightClickProtection",  "Right-Click / Copy-Paste Block"],
  ["keyboardBlocking",      "Keyboard Shortcut Blocking"],
  ["devToolsDetection",     "DevTools Detection"],
  ["clipboardMonitoring",   "Clipboard Monitoring"],
  ["idleDetection",         "Idle Detection"],
  ["windowResizeDetection", "Window Resize Detection"],
  ["screenResolutionCheck", "Screen Resolution Check"],
  ["browserCompatibility",  "Browser Compatibility"],
  ["incognitoDetection",    "Incognito Detection"],
];
const DEFAULT_SECURITY = SECURITY_KEYS.reduce((o, [k]) => (o[k] = true, o), { locationRestriction: false });
const DEFAULT_SEC_CONFIG = {
  maxViolations: 3, idleSeconds: 120, clipboardLimit: 3, minScreenWidth: 1024, minScreenHeight: 600,
  cameraGraceSeconds: 10, location: { lat: null, lng: null, radiusMeters: 200, label: "" },
};

function SecurityToggles({ value, onChange, config, onConfigChange }) {
  const v = value || DEFAULT_SECURITY;
  const cfg = { ...DEFAULT_SEC_CONFIG, ...(config || {}), location: { ...DEFAULT_SEC_CONFIG.location, ...((config || {}).location || {}) } };
  const setCfg = (patch) => onConfigChange({ ...cfg, ...patch });
  const setLoc = (patch) => onConfigChange({ ...cfg, location: { ...cfg.location, ...patch } });
  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  // Browser geolocation on a laptop/desktop (no GPS) returns a WiFi/IP fix that
  // is often off by 100s of metres. Instead of taking the first (worst) reading,
  // watch for ~12s and keep the most ACCURATE fix; GPS-equipped devices refine
  // over time. Show the accuracy and warn when it's clearly imprecise.
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { alert("Geolocation not supported by this browser."); return; }
    setLocating(true); setAccuracy(null);
    let best = null, id = null, done = false;
    const started = Date.now();
    const finish = () => {
      if (done) return; done = true;
      if (id != null) navigator.geolocation.clearWatch(id);
      setLocating(false);
      if (best) {
        setLoc({ lat: best.lat, lng: best.lng });
        if (best.acc > 100) {
          alert(`Location captured, but accuracy is only ±${Math.round(best.acc)} m — this device likely has no GPS.\n\nFor an exact point either:\n• Open this admin page on your phone and tap "Use My Current Location", or\n• Get the coordinates from Google Maps (right-click the exact spot → click the lat, lng at the top to copy) and paste them into the Latitude/Longitude fields.`);
        }
      }
    };
    id = navigator.geolocation.watchPosition(
      (p) => {
        const acc = p.coords.accuracy;
        if (!best || acc < best.acc) {
          best = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc };
          setAccuracy(Math.round(acc));
        }
        if (acc <= 20 || Date.now() - started > 12000) finish();   // good enough or time's up
      },
      (e) => { finish(); if (!best) alert("Could not get location: " + e.message); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    setTimeout(finish, 13000);   // hard stop
  };
  const numField = (label, key, min = 0) => (
    <div className="ad-field">
      <label className="ad-label">{label}</label>
      <input className="ad-input" type="number" min={min} value={cfg[key]} onChange={e => setCfg({ [key]: Number(e.target.value) })} />
    </div>
  );
  return (
    <div className="ad-field" style={{marginTop:10}}>
      <label className="ad-label">Assessment Security (all on by default)</label>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 14px",marginTop:4}}>
        {SECURITY_KEYS.map(([k,label])=>(
          <label key={k} style={{display:"flex",gap:8,alignItems:"center",fontSize:13,cursor:"pointer"}}>
            <input type="checkbox" checked={v[k]!==false} onChange={e=>onChange({...v,[k]:e.target.checked})}/>
            {label}
          </label>
        ))}
      </div>

      <div className="ad-label" style={{marginTop:14}}>Security Configuration</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px 12px",marginTop:4}}>
        {numField("Max Violations","maxViolations",1)}
        {numField("Idle Timeout (sec)","idleSeconds",10)}
        {numField("Clipboard Limit","clipboardLimit",1)}
        {numField("Min Screen Width","minScreenWidth",320)}
        {numField("Min Screen Height","minScreenHeight",240)}
        {numField("Camera Grace (sec)","cameraGraceSeconds",3)}
      </div>

      {/* ── Batch B: Location restriction ── */}
      <label style={{display:"flex",gap:8,alignItems:"center",fontSize:13,cursor:"pointer",marginTop:14,fontWeight:700}}>
        <input type="checkbox" checked={v.locationRestriction===true} onChange={e=>onChange({...v,locationRestriction:e.target.checked})}/>
        📍 Location Restriction (candidate must be within radius)
      </label>
      {v.locationRestriction===true && (
        <div style={{marginTop:8,padding:12,border:"1px solid var(--border)",borderRadius:10,background:"var(--surface-2)"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px 12px"}}>
            <div className="ad-field"><label className="ad-label">Latitude</label>
              <input className="ad-input" type="number" step="0.000001" value={cfg.location.lat ?? ""} onChange={e=>setLoc({lat:e.target.value===""?null:Number(e.target.value)})}/></div>
            <div className="ad-field"><label className="ad-label">Longitude</label>
              <input className="ad-input" type="number" step="0.000001" value={cfg.location.lng ?? ""} onChange={e=>setLoc({lng:e.target.value===""?null:Number(e.target.value)})}/></div>
            <div className="ad-field"><label className="ad-label">Radius (metres)</label>
              <select className="ad-select" value={cfg.location.radiusMeters} onChange={e=>setLoc({radiusMeters:Number(e.target.value)})}>
                <option value={100}>100 m</option><option value={200}>200 m</option><option value={500}>500 m</option><option value={1000}>1 km</option>
              </select></div>
          </div>
          <div className="ad-field" style={{marginTop:8}}><label className="ad-label">Location Label (optional)</label>
            <input className="ad-input" value={cfg.location.label} placeholder="e.g. RVCE Main Block" onChange={e=>setLoc({label:e.target.value})}/></div>
          <button type="button" className="ad-btn ad-btn--outline ad-btn--sm" style={{marginTop:8}} onClick={useCurrentLocation} disabled={locating}>
            {locating ? `📡 Locating…${accuracy!=null?` (±${accuracy} m, refining)`:""}` : "📍 Use My Current Location"}
          </button>
          {cfg.location.lat!=null && !locating && <span style={{fontSize:12,color:"var(--text-3)",marginLeft:10}}>Set: {cfg.location.lat}, {cfg.location.lng}{accuracy!=null?` · ±${accuracy} m`:""}</span>}
          <div style={{fontSize:11.5,color:"var(--text-3)",marginTop:8,lineHeight:1.5}}>
            💡 On a laptop the location can be off by 100s of metres (no GPS). For an exact point, use your <strong>phone</strong>, or copy the coordinates from <strong>Google Maps</strong> (right-click the spot → click the lat, lng to copy) and paste above. Increase the <strong>radius</strong> if candidates report being marked outside.
          </div>
        </div>
      )}
    </div>
  );
}

// Combine a yyyy-mm-dd date input and HH:MM time input into an ISO datetime.
function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return undefined;
  const dt = new Date(`${dateStr}T${timeStr}`);
  return isNaN(dt) ? undefined : dt.toISOString();
}

function toLocalInput(d){ if(!d) return ""; const dt=new Date(d); const p=n=>String(n).padStart(2,"0"); return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`; }

// Round 2 = fed Technical sets A/B. Fixed section structure (questions live in the DB,
// tagged round:2/set — editable in the Questions tab). One set per candidate, alternating.
const ROUND2_SECTIONS = [
  { name:"t_sec_a", displayName:"Section A — Tricky Concept MCQs",          questionCount:10, color:"#4F46E5" },
  { name:"t_sec_b", displayName:"Section B — Predict the Output",           questionCount:10, color:"#7C3AED" },
  { name:"t_sec_c", displayName:"Section C — Predict the Output: Advanced", questionCount:10, color:"#0891B2" },
];
// Sets C/D — advanced 4-section paper (MCQ, Python, SQL with reference tables, DSA).
const ROUND2_SECTIONS_CD = [
  { name:"t_sec_a", displayName:"Section A — Logic & Technical MCQs",     questionCount:10, color:"#4F46E5" },
  { name:"t_sec_b", displayName:"Section B — Python Output Prediction",   questionCount:10, color:"#7C3AED" },
  { name:"t_sec_c", displayName:"Section C — SQL Output Prediction",      questionCount:10, color:"#0891B2" },
  { name:"t_sec_d", displayName:"Section D — Data Structures & Algorithms", questionCount:10, color:"#059669" },
];
// Set T — DS/DA Trainer Technical Screening bank (seeded by scripts/seedTrainerSet.js).
// Two paper layouts over the SAME set: the MCQ-only screen, and the full A–E bank.
const TRAINER_SECTIONS_MCQ = [
  { name:"tr_sec_a", displayName:"Section A — Data Analytics MCQs (SQL, Statistics, BI)", questionCount:12, color:"#4F46E5" },
  { name:"tr_sec_b", displayName:"Section B — Data Science / Machine Learning MCQs",      questionCount:12, color:"#7C3AED" },
];
const TRAINER_SECTIONS_FULL = [
  ...TRAINER_SECTIONS_MCQ,
  { name:"tr_sec_c", displayName:"Section C — Application-Level Questions",               questionCount:10, color:"#0891B2" },
  { name:"tr_sec_d", displayName:"Section D — Output Prediction (Python / Pandas / SQL)", questionCount:10, color:"#059669" },
  { name:"tr_sec_e", displayName:"Section E — Scenario-Based Questions",                  questionCount:10, color:"#D97706" },
];
// FALLBACK ONLY. The real list comes from GET /questions/catalog, which derives
// it from the questions actually in the DB — so seeding a new set is enough to
// make it selectable, with no frontend change. These hard-coded papers are used
// only if that request fails (offline / older backend).
const ROUND2_PAPERS = {
  A:  { label:ROUND2_VERSIONS.A.label,  sets:["A","B"], sections:ROUND2_SECTIONS },
  B:  { label:ROUND2_VERSIONS.B.label,  sets:["C","D"], sections:ROUND2_SECTIONS_CD },
  T1: { label:ROUND2_VERSIONS.T1.label, sets:["T"],     sections:TRAINER_SECTIONS_MCQ },
  T2: { label:ROUND2_VERSIONS.T2.label, sets:["T"],     sections:TRAINER_SECTIONS_FULL },
};
// Extra fields an admin can choose to collect at Round-2 walk-in registration
// (beyond the always-on Name / Email / Mobile).
const WALKIN_FIELD_OPTS = [
  ["resume","Resume"], ["college","College"], ["usn","USN"], ["course","Course"], ["branch","Branch"],
  ["gender","Gender"], ["dob","Date of Birth"], ["aadhaar","Aadhaar"], ["location","Location"],
];

function CreateDriveModal({ sections, rounds = null, lockedRound = null, onClose, onCreated }) {
  const [name,setName]=useState("");
  const [driveType,setDriveType]=useState("PRE_REGISTERED");
  const [round,setRound]=useState(lockedRound ? Number(lockedRound) : 1);
  const [round2Paper,setRound2Paper]=useState("B");   // default to Version B (Sets C&D · 40 Q); A = Sets A&B · 30 Q
  const [walkInFields,setWalkInFields]=useState([]);  // extra registration fields to collect (round 2 walk-in)
  const [maxCandidates,setMaxCandidates]=useState("");
  const [duration,setDuration]=useState(40);
  const [passing,setPassing]=useState(30);
  const [date,setDate]=useState("");
  const [startTime,setStartTime]=useState("10:00");
  const [endTime,setEndTime]=useState("13:00");
  const [linkSendOption,setLinkSendOption]=useState("30min");
  const [linkSendCustom,setLinkSendCustom]=useState("");
  const [secs,setSecs]=useState(()=>(sections||[]).map(s=>({...s,include:true})));
  const [security,setSecurity]=useState({...DEFAULT_SECURITY});
  const [secConfig,setSecConfig]=useState({...DEFAULT_SEC_CONFIG});
  const [collegesText,setCollegesText]=useState("");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  // Papers come from the backend (derived from the seeded questions). The
  // hard-coded ROUND2_PAPERS are only a fallback if that call fails.
  const [papers,setPapers]=useState(null);
  const [papersErr,setPapersErr]=useState("");

  useEffect(()=>{
    let alive=true;
    fetchQuestionCatalog({round:2})
      .then(r=>{
        if(!alive) return;
        const list=r?.data?.data?.papers||[];
        if(!list.length){ setPapersErr("No Round-2 question sets found in the database for this workspace."); return; }
        const map={}; list.forEach(p=>{ map[p.key]=p; });
        setPapers(map);
        setRound2Paper(prev=>map[prev]?prev:list[0].key);   // keep the choice if it still exists
      })
      .catch(()=>{ if(alive) setPapersErr("Could not load question sets from the server — showing the built-in list."); });
    return ()=>{ alive=false; };
  },[]);

  const paperMap = papers || ROUND2_PAPERS;

  const save=async()=>{
    if(!name.trim()){ setErr("Drive name is required."); return; }
    const collegesArr=collegesText.split("\n").map(s=>s.trim()).filter(Boolean);
    if(driveType==="WALK_IN" && round!==2 && !collegesArr.length){ setErr("Add at least one college (one per line) for the walk-in dropdown."); return; }
    // Round 2 uses the sections of the chosen set-paper; Round 1 uses the chosen pool sections.
    const paper = paperMap[round2Paper] || Object.values(paperMap)[0];
    if(round===2 && !paper){ setErr("No Round-2 question set is available. Seed questions first."); return; }
    const chosen = round===2
      ? paper.sections
      : secs.filter(s=>s.include).map(({name,displayName,questionCount,color})=>({name,displayName,questionCount:Number(questionCount)||1,color}));
    if(round!==2 && !chosen.length){ setErr("Select at least one section."); return; }
    if(!date){ setErr("Assessment date is required."); return; }
    const startAt=combineDateTime(date,startTime);
    const endAt=combineDateTime(date,endTime);
    if(!startAt||!endAt){ setErr("Valid start and end times are required."); return; }
    if(new Date(endAt)<=new Date(startAt)){ setErr("End time must be after start time."); return; }
    if(linkSendOption==="custom" && !linkSendCustom){ setErr("Pick a custom link send date & time."); return; }
    setSaving(true); setErr("");
    try{
      await createAssessment({
        name:name.trim(), driveType, round, durationMinutes:Number(duration)||40, passingScore:Number(passing)||0, sections:chosen,
        ...(round===2 ? { round2Sets: paper.sets } : {}),
        ...(round===2 && walkInFields.length ? { walkInFields } : {}),
        assessmentDate:combineDateTime(date,"00:00"), startAt, endAt,
        deadline:endAt, // link expiry defaults to the window end
        linkSendOption,
        linkSendAt: linkSendOption==="custom" ? new Date(linkSendCustom).toISOString() : undefined,
        ...(driveType==="WALK_IN" && maxCandidates ? { maxCandidates:Number(maxCandidates) } : {}),
        colleges:collegesArr,
        security, securityConfig:secConfig,
      });
      onCreated(round);
    }catch(e){ setErr(e.message||"Failed to create."); }
    finally{ setSaving(false); }
  };

  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-modal ad-modal--wide" onClick={e=>e.stopPropagation()}>
        <div className="ad-modal-head">
          <div>
            <h3 className="ad-modal-title">New Campus Drive</h3>
            <p className="ad-modal-sub">Configure the assessment details, schedule, questions and security.</p>
          </div>
          <button className="ad-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ad-modal-body">
          <section className="ad-card-section">
            <div className="ad-card-section-title">📋 Basic Information</div>
            <div className="ad-field"><label className="ad-label">Drive / Assessment Name</label>
              <input className="ad-input" value={name} onChange={e=>{setName(e.target.value);setErr("");}} placeholder="e.g. Inference Labs Campus Drive 2026"/></div>
            <div className="ad-grid-2" style={{marginTop:12}}>
              <div className="ad-field"><label className="ad-label">Assessment Round</label>
                <select className="ad-input ad-select" value={round} onChange={e=>setRound(Number(e.target.value))} disabled={!!lockedRound}>
                  {(rounds && rounds.length
                    ? rounds.map(r=>({v:r.sequence,l:`Round ${r.sequence} — ${r.name}`}))
                    : [{v:1,l:"Round 1 — Aptitude pool (existing questions)"},
                       {v:2,l:"Round 2 — Technical Sets A & B (auto-distributed)"}]
                  ).map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                {lockedRound && <div className="ad-hint">This drive belongs to the round you opened it from.</div>}</div>
              <div className="ad-field"><label className="ad-label">Drive Type</label>
                <select className="ad-input ad-select" value={driveType} onChange={e=>setDriveType(e.target.value)}>
                  <option value="PRE_REGISTERED">Pre-Registered (email invitations)</option>
                  <option value="WALK_IN">Walk-In (test code at /test)</option>
                </select></div>
              {driveType==="WALK_IN" && (
                <div className="ad-field"><label className="ad-label">Max Candidates</label>
                  <input type="number" className="ad-input" value={maxCandidates} min={1} placeholder="e.g. 100" onChange={e=>setMaxCandidates(e.target.value)}/>
                  <span className="ad-hint">A unique test code is generated on save.</span></div>
              )}
            </div>
            <div className="ad-grid-2" style={{marginTop:12}}>
              <div className="ad-field"><label className="ad-label">Duration (minutes)</label>
                <input type="number" className="ad-input" value={duration} min={1} onChange={e=>setDuration(e.target.value)}/></div>
              <div className="ad-field"><label className="ad-label">Passing Score (internal)</label>
                <input type="number" className="ad-input" value={passing} min={0} onChange={e=>setPassing(e.target.value)}/></div>
            </div>
            {driveType==="WALK_IN" && round!==2 && (
              <div className="ad-field" style={{marginTop:12}}><label className="ad-label">Colleges — one per line (students pick from this dropdown)</label>
                <textarea className="ad-input ad-textarea" rows={4} value={collegesText} placeholder={"RV College of Engineering\nBMS College of Engineering\nPES University"} onChange={e=>setCollegesText(e.target.value)}/>
                <span className="ad-hint">Candidates can only select from these — they can't type their own college.</span></div>
            )}
            {driveType==="WALK_IN" && round===2 && (
              <div className="ad-note" style={{marginTop:12,fontSize:12.5}}>ℹ️ Round 2 collects only Name, Email &amp; Mobile — no college list needed.</div>
            )}
          </section>

          <section className="ad-card-section">
            <div className="ad-card-section-title">🗓️ Assessment Schedule</div>
            <div className="ad-grid-3">
              <div className="ad-field"><label className="ad-label">Assessment Date</label>
                <input type="date" className="ad-input" value={date} onChange={e=>{setDate(e.target.value);setErr("");}}/></div>
              <div className="ad-field"><label className="ad-label">Start Time</label>
                <input type="time" className="ad-input" value={startTime} onChange={e=>setStartTime(e.target.value)}/></div>
              <div className="ad-field"><label className="ad-label">End Time</label>
                <input type="time" className="ad-input" value={endTime} onChange={e=>setEndTime(e.target.value)}/></div>
            </div>
            {driveType==="WALK_IN"
              ? <div className="ad-note ad-note--purple" style={{marginTop:12}}>
                  🚶 Walk-in drive — no email links. Share the <strong>/test</strong> portal link; students self-register with the test code. Registration opens before the start time; the assessment begins at the start time.
                </div>
              : <div className="ad-field" style={{marginTop:12}}><label className="ad-label">Assessment Link Send Time</label>
                  <select className="ad-input ad-select" value={linkSendOption} onChange={e=>setLinkSendOption(e.target.value)}>
                    {LINK_SEND_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {linkSendOption==="custom"
                    ? <input type="datetime-local" className="ad-input" style={{marginTop:8}} value={linkSendCustom} onChange={e=>setLinkSendCustom(e.target.value)}/>
                    : <span className="ad-hint">Shortlist email sends immediately on upload. The assessment link sends {linkSendOption==="immediately"?"immediately":`${LINK_SEND_OPTIONS.find(o=>o.value===linkSendOption)?.label.toLowerCase()}`}.</span>}
                </div>}
          </section>

          <section className="ad-card-section">
            <div className="ad-card-section-title">❓ Question Configuration</div>
            {round===2 ? (<>
              <div className="ad-field">
                <label className="ad-label">Question Version for this drive</label>
                <select className="ad-input ad-select" value={round2Paper} onChange={e=>setRound2Paper(e.target.value)}>
                  {Object.entries(paperMap).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                </select>
                <span className="ad-hint">Version A = Set A &amp; Set B · Version B = Set C &amp; Set D — each candidate gets ONE set, alternating between students. The two <strong>Trainer (DS/DA)</strong> versions both use Set T, so every candidate sits the same paper.</span>
              </div>
              {driveType==="WALK_IN" && (
                <div className="ad-field">
                  <label className="ad-label">Extra details to collect at registration</label>
                  <span className="ad-hint" style={{display:"block",marginBottom:8}}>Walk-in Round 2 always collects <strong>Name, Email &amp; Mobile</strong>. Tick any extra fields to also collect — e.g. <strong>Resume</strong> for pre-registered students who never submitted one.</span>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {WALKIN_FIELD_OPTS.map(([k,label])=>{ const on=walkInFields.includes(k); return (
                      <label key={k} style={{display:"flex",alignItems:"center",gap:6,fontSize:13,background:on?"#e0e7ff":"#f1f5f9",border:`1px solid ${on?"#818cf8":"#e2e8f0"}`,borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>
                        <input type="checkbox" checked={on} onChange={e=>setWalkInFields(p=>e.target.checked?[...p,k]:p.filter(x=>x!==k))} />
                        {label}
                      </label>
                    );})}
                  </div>
                </div>
              )}
              <div className="ad-note ad-note--info" style={{marginTop:10}}>
                <strong>Selected: {paperMap[round2Paper]?.label}.</strong> Questions are jumbled within each section; MCQ options shuffled.
                SQL questions show their reference tables. Edit these in the <strong>Questions</strong> tab (Round 2 · Set {paperMap[round2Paper]?.sets.join(" / ")}).
              </div>
              {papersErr && <div className="ad-note ad-note--purple" style={{marginTop:10}}>{papersErr}</div>}
              {(paperMap[round2Paper]?.manualCount>0) && (
                <div className="ad-note ad-note--purple" style={{marginTop:10}}>
                  ⚠️ <strong>{paperMap[round2Paper].manualCount} of {paperMap[round2Paper].questionCount}</strong> questions in this paper are open-ended,
                  so exact-match scoring cannot grade them — the engine marks them 0. The auto score is effectively the
                  remaining <strong>{paperMap[round2Paper].marks - paperMap[round2Paper].manualCount} marks</strong>; mark the written answers by hand from
                  <strong> Candidates → View Responses</strong>, where each typed answer sits beside its model answer / rubric.
                  {paperMap[round2Paper].sections.some(x=>x.longAnswer>0) && (
                    <> Open-ended sections: <strong>{paperMap[round2Paper].sections.filter(x=>x.longAnswer>0).map(x=>x.displayName.split("—")[0].trim()).join(", ")}</strong>.</>
                  )}
                </div>
              )}
            </>) : (<>
              <span className="ad-hint" style={{display:"block",marginBottom:6}}>Sections are drawn from the shared question pool. Tick the sections to include and set the question count.</span>
              <div className="ad-sec-pick-list">
                {secs.map((s,i)=>(
                  <div key={s.name} className={`ad-sec-pick ${s.include?"ad-sec-pick--on":""}`}>
                    <input type="checkbox" checked={s.include} aria-label={`Include ${s.displayName}`}
                      onChange={e=>setSecs(p=>p.map((x,idx)=>idx===i?{...x,include:e.target.checked}:x))}/>
                    <span className="ad-sec-pick-name">{s.displayName}</span>
                    <input type="number" className="ad-input ad-sec-pick-count" value={s.questionCount} min={1} aria-label={`Question count for ${s.displayName}`}
                      onChange={e=>setSecs(p=>p.map((x,idx)=>idx===i?{...x,questionCount:e.target.value}:x))}/>
                    <span className="ad-sec-pick-qs">Qs</span>
                  </div>
                ))}
                {!secs.length && <div className="ad-empty" style={{padding:14}}>No sections found. Add sections under Settings first.</div>}
              </div>
            </>)}
          </section>

          <section className="ad-card-section">
            <div className="ad-card-section-title">🔒 Security Configuration</div>
            <SecurityToggles value={security} onChange={setSecurity} config={secConfig} onConfigChange={setSecConfig}/>
          </section>

          {err && <p className="ad-form-err" style={{margin:"4px 2px 0"}}>{err}</p>}
        </div>

        <div className="ad-modal-foot">
          <button className="ad-btn ad-btn--outline" onClick={onClose}>Cancel</button>
          <button className="ad-btn ad-btn--primary" onClick={save} disabled={saving}>{saving?<><Spinner/>Creating…</>:"Create Drive"}</button>
        </div>
      </div>
    </div>
  );
}

function EditDriveModal({ drive, onClose, onSaved }) {
  const [name,setName]=useState(drive.name||"");
  const [status,setStatus]=useState(drive.status||"ACTIVE");
  const [duration,setDuration]=useState(drive.durationMinutes||40);
  const [cutoff,setCutoff]=useState(drive.cutoff??"");
  const [maxCandidates,setMaxCandidates]=useState(drive.maxCandidates??"");
  const [security,setSecurity]=useState({...DEFAULT_SECURITY,...(drive.security||{})});
  const [secConfig,setSecConfig]=useState({...DEFAULT_SEC_CONFIG,...(drive.securityConfig||{}),location:{...DEFAULT_SEC_CONFIG.location,...((drive.securityConfig||{}).location||{})}});
  const [collegesText,setCollegesText]=useState((drive.colleges||[]).join("\n"));
  // Editable schedule — prefill from the drive's current start/end (local time).
  const _p=n=>String(n).padStart(2,"0");
  const _s=drive.startAt?new Date(drive.startAt):null;
  const _e=drive.endAt?new Date(drive.endAt):null;
  const [date,setDate]=useState(_s?`${_s.getFullYear()}-${_p(_s.getMonth()+1)}-${_p(_s.getDate())}`:"");
  const [startTime,setStartTime]=useState(_s?`${_p(_s.getHours())}:${_p(_s.getMinutes())}`:"");
  const [endTime,setEndTime]=useState(_e?`${_p(_e.getHours())}:${_p(_e.getMinutes())}`:"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  const save=async()=>{
    if(!name.trim()){ setErr("Drive name is required."); return; }
    // Schedule (optional to change, but if provided it must be valid).
    let sched={};
    if(date && startTime && endTime){
      const startAt=combineDateTime(date,startTime), endAt=combineDateTime(date,endTime);
      if(!startAt||!endAt){ setErr("Enter valid start and end times."); return; }
      if(new Date(endAt)<=new Date(startAt)){ setErr("End time must be after start time."); return; }
      sched={ assessmentDate:combineDateTime(date,"00:00"), startAt, endAt, deadline:endAt };
    } else if(date || startTime || endTime){
      setErr("To change the schedule, set the date, start time and end time."); return;
    }
    setSaving(true); setErr("");
    try{
      await updateAssessment(drive._id,{
        name:name.trim(), status, durationMinutes:Number(duration)||40,
        cutoff: cutoff===""?null:Number(cutoff),
        ...(drive.driveType==="WALK_IN" ? { maxCandidates: maxCandidates===""?null:Number(maxCandidates) } : {}),
        colleges: collegesText.split("\n").map(s=>s.trim()).filter(Boolean),
        ...sched,
        security, securityConfig:secConfig,
      });
      onSaved();
    }catch(e){ setErr(e.message||"Failed to save."); }
    finally{ setSaving(false); }
  };

  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-modal ad-modal--wide" onClick={e=>e.stopPropagation()}>
        <div className="ad-modal-head">
          <div>
            <h3 className="ad-modal-title">Edit Drive {drive.testCode?`· ${drive.testCode}`:""}</h3>
            <p className="ad-modal-sub">Update the schedule, capacity, cutoff and security configuration.</p>
          </div>
          <button className="ad-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ad-modal-body">
          <section className="ad-card-section">
            <div className="ad-card-section-title">📋 Basic Information</div>
            <div className="ad-field"><label className="ad-label">Drive Name</label>
              <input className="ad-input" value={name} onChange={e=>{setName(e.target.value);setErr("");}}/></div>
            <div className="ad-grid-2" style={{marginTop:12}}>
              <div className="ad-field"><label className="ad-label">Status</label>
                <select className="ad-input ad-select" value={status} onChange={e=>setStatus(e.target.value)}>
                  {["DRAFT","ACTIVE","COMPLETED","ARCHIVED"].map(s=><option key={s} value={s}>{s}</option>)}
                </select></div>
              <div className="ad-field"><label className="ad-label">Duration (minutes)</label>
                <input type="number" className="ad-input" value={duration} min={1} onChange={e=>setDuration(e.target.value)}/></div>
            </div>
            <div className="ad-grid-2" style={{marginTop:12}}>
              <div className="ad-field"><label className="ad-label">Cutoff (selection)</label>
                <input type="number" className="ad-input" value={cutoff} min={0} placeholder="e.g. 30" onChange={e=>setCutoff(e.target.value)}/>
                <span className="ad-hint">Candidates scoring ≥ cutoff count as Selected (recalculated live).</span></div>
              {drive.driveType==="WALK_IN" && (
                <div className="ad-field"><label className="ad-label">Max Candidates</label>
                  <input type="number" className="ad-input" value={maxCandidates} min={1} onChange={e=>setMaxCandidates(e.target.value)}/>
                  <span className="ad-hint">{drive.walkInCount||0} registered so far.</span></div>
              )}
            </div>
            {drive.driveType==="WALK_IN" && (
              <div className="ad-field" style={{marginTop:12}}><label className="ad-label">Colleges — one per line (students pick from this dropdown)</label>
                <textarea className="ad-input ad-textarea" rows={4} value={collegesText} placeholder={"RV College of Engineering\nBMS College of Engineering"} onChange={e=>setCollegesText(e.target.value)}/>
                <span className="ad-hint">Candidates can only select from these — they can't type their own college.</span></div>
            )}
          </section>

          <section className="ad-card-section">
            <div className="ad-card-section-title">🗓️ Assessment Schedule</div>
            <div className="ad-grid-3">
              <div className="ad-field"><label className="ad-label">Assessment Date</label>
                <input type="date" className="ad-input" value={date} onChange={e=>{setDate(e.target.value);setErr("");}}/></div>
              <div className="ad-field"><label className="ad-label">Start Time</label>
                <input type="time" className="ad-input" value={startTime} onChange={e=>{setStartTime(e.target.value);setErr("");}}/></div>
              <div className="ad-field"><label className="ad-label">End Time</label>
                <input type="time" className="ad-input" value={endTime} onChange={e=>{setEndTime(e.target.value);setErr("");}}/></div>
            </div>
            <span className="ad-hint">Reschedule the drive here anytime after creation.</span>
          </section>

          <section className="ad-card-section">
            <div className="ad-card-section-title">🔒 Security Configuration</div>
            <SecurityToggles value={security} onChange={setSecurity} config={secConfig} onConfigChange={setSecConfig}/>
          </section>

          {err && <p className="ad-form-err" style={{margin:"4px 2px 0"}}>{err}</p>}
        </div>

        <div className="ad-modal-foot">
          <button className="ad-btn ad-btn--outline" onClick={onClose}>Cancel</button>
          <button className="ad-btn ad-btn--primary" onClick={save} disabled={saving}>{saving?<><Spinner/>Saving…</>:"Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

function UploadModal({ assessment, onClose, onDone }) {
  const [rows,setRows]=useState([]);     // {name,email,college}
  const [manual,setManual]=useState("");
  const [sendShortlist,setSendShortlist]=useState(true);
  const [err,setErr]=useState(""); const [busy,setBusy]=useState(false); const [result,setResult]=useState(null);

  const parseFile=async(file)=>{
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const json=XLSX.utils.sheet_to_json(ws,{defval:""});
      const mapped=json.map(r=>{
        const get=(...keys)=>{ for(const k of Object.keys(r)){ if(keys.some(x=>k.trim().toLowerCase()===x)) return String(r[k]).trim(); } return ""; };
        return { name:get("name","candidate name","full name"), email:get("email","email address","mail"), college:get("college","college name","institution") };
      }).filter(r=>r.name||r.email||r.college);
      setRows(mapped); setErr(mapped.length?"":"No rows found. Expected columns: Name, Email, College.");
    }catch(e){ setErr("Could not read file: "+e.message); }
  };

  const parseManual=()=>{
    const lines=manual.split(/\n/).map(l=>l.trim()).filter(Boolean);
    const mapped=lines.map(l=>{ const [name,email,college]=l.split(",").map(x=>(x||"").trim()); return {name,email,college}; });
    setRows(mapped);
  };

  const allRows=()=>{ if(rows.length) return rows; parseManual(); return manual.split(/\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const[n,e,c]=l.split(",").map(x=>(x||"").trim());return{name:n,email:e,college:c};}); };

  const submit=async()=>{
    const data=allRows();
    if(!data.length){ setErr("Add candidates via file or manual entry first."); return; }
    setBusy(true); setErr("");
    try{
      const res=await uploadCandidates({ assessmentId:assessment._id, candidates:data, sendShortlist });
      setResult(res.data);
    }catch(e){ setErr(e.message||"Upload failed."); }
    finally{ setBusy(false); }
  };

  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
        <h3 className="ad-modal-title">Upload Candidates — {assessment.name}</h3>
        {result ? (
          <div>
            <div className="ad-note ad-note--success" style={{padding:18,textAlign:"left"}}>
              ✅ {result.addedCount} added · {result.skippedCount} skipped
              {result.skippedCount>0 && <div style={{fontSize:12,marginTop:8,textAlign:"left"}}>
                {result.skipped.slice(0,8).map((s,i)=><div key={i}>• {s.email||"row"} — {s.reason}</div>)}
                {result.skipped.length>8 && <div>…and {result.skipped.length-8} more</div>}
              </div>}
            </div>
            <button className="ad-btn ad-btn--primary" style={{width:"100%",marginTop:14}} onClick={onDone}>Done</button>
          </div>
        ) : (
          <>
            <div className="ad-field"><label className="ad-label">Upload CSV / Excel</label>
              <input type="file" accept=".csv,.xlsx,.xls" className="ad-input" onChange={e=>e.target.files[0]&&parseFile(e.target.files[0])}/>
              <span className="ad-hint">Columns: <strong>Name, Email, College</strong> (header row required).</span></div>
            <div className="ad-field" style={{marginTop:10}}><label className="ad-label">…or paste manually (one per line: Name, Email, College)</label>
              <textarea className="ad-input ad-textarea" rows={4} value={manual} onChange={e=>setManual(e.target.value)} placeholder={"Asha R, asha@rvce.edu.in, RVCE\nKiran M, kiran@bmsce.ac.in, BMSCE"}/></div>
            {rows.length>0 && <div style={{fontSize:13,color:"#059669",fontWeight:600,margin:"6px 0"}}>{rows.length} candidate(s) ready</div>}

            <div className="ad-field" style={{marginTop:8}}>
              <label className="ad-agree-row" style={{display:"flex",gap:8,alignItems:"center",fontSize:13.5,fontWeight:600,cursor:"pointer"}}>
                <input type="checkbox" checked={sendShortlist} onChange={e=>setSendShortlist(e.target.checked)}/>
                Send shortlist email immediately
              </label>
            </div>
            <div className="ad-note ad-note--info" style={{padding:"12px 14px",textAlign:"left",fontSize:12.5,lineHeight:1.6,marginTop:8}}>
              📧 The <strong>assessment link</strong> is delivered automatically per this drive's send-time setting
              {assessment.linkSendAt ? <> (≈ {fmtDateTime(assessment.linkSendAt)})</> : null}.
              Link expiry follows the drive's end time.
            </div>

            {err && <p className="ad-form-err" style={{marginTop:8}}>{err}</p>}
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="ad-btn ad-btn--outline" style={{flex:1}} onClick={onClose}>Cancel</button>
              <button className="ad-btn ad-btn--primary" style={{flex:1}} onClick={submit} disabled={busy}>{busy?<><Spinner/>Uploading…</>:"Upload & Schedule"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DrivesTab({ wsRounds = null, lockedRound = null }) {
  // wsRounds  — the OPEN WORKSPACE's rounds ({sequence,name}). When supplied the
  //             round tabs below are generated from them instead of the two
  //             hard-coded legacy labels, so a workspace with 5 rounds shows 5.
  // lockedRound — when a drive is created from inside a round, it belongs to
  //             that round and the selector is fixed.
  const [drives,setDrives]=useState([]);
  const [sections,setSections]=useState([]);
  const [sel,setSel]=useState(null);            // selected assessment
  const [stats,setStats]=useState(null);
  const [colleges,setColleges]=useState([]);
  const [cands,setCands]=useState([]);
  const [pag,setPag]=useState({}); const [page,setPage]=useState(1);
  const [fCollege,setFCollege]=useState(""); const [fStatus,setFStatus]=useState(""); const [fSource,setFSource]=useState(""); const [fMinScore,setFMinScore]=useState(""); const [search,setSearch]=useState("");
  const [showCreate,setShowCreate]=useState(false); const [showUpload,setShowUpload]=useState(false);
  const [editDrive,setEditDrive]=useState(null);
  const [confirmState,setConfirmState]=useState(null); // {title,message,onConfirm}
  const [confirmBusy,setConfirmBusy]=useState(false);
  const [resumeView,setResumeView]=useState(null); // candidate whose resume is open
  const [profileCand,setProfileCand]=useState(null); // candidate whose profile dialog is open
  const [driveFilter,setDriveFilter]=useState("active"); // active | archived | all
  const [roundFilter,setRoundFilter]=useState(lockedRound?String(lockedRound):"1");   // round SEQUENCE as a string
  const [picked,setPicked]=useState(new Set());
  const [loading,setLoading]=useState(false); const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState(null);   // {type:'success'|'error', title, lines:[]}
  const showToast=(t)=>{ setToast(t); setTimeout(()=>setToast(null), 9000); };

  const loadDrives=useCallback(async()=>{ try{const r=await fetchAssessments(); setDrives(r.data.data||[]);}catch{} },[]);
  const loadSections=useCallback(async()=>{ try{const r=await fetchSections(); setSections(r.data.data||[]);}catch{} },[]);
  useEffect(()=>{ loadDrives(); loadSections(); },[loadDrives,loadSections]);

  // silent=true → background auto-refresh: update data WITHOUT the loading flash/re-mount.
  const loadDriveData=useCallback(async(assessmentId,{silent=false}={})=>{
    if(!silent) setLoading(true);
    try{
      const [s,c,cl]=await Promise.all([
        fetchCandidateStats({assessmentId}),
        fetchCandidates({assessmentId,page,limit:20,college:fCollege||undefined,status:fStatus||undefined,source:fSource||undefined,minScore:fMinScore||undefined,search:search||undefined}),
        fetchDriveColleges({assessmentId}),
      ]);
      setStats(s.data.data); setCands(c.data.data); setPag(c.data.pagination); setColleges(cl.data.data);
    }catch{} finally{ if(!silent) setLoading(false); }
  },[page,fCollege,fStatus,fSource,fMinScore,search]);

  useEffect(()=>{ if(sel) loadDriveData(sel._id); },[sel,loadDriveData]);

  const openDrive=(d)=>{ setSel(d); setPage(1); setFCollege(""); setFStatus(""); setFSource(""); setFMinScore(""); setSearch(""); setPicked(new Set()); };

  const sendInvites=async()=>{
    setBusy(true);
    try{
      const r=await scheduleInvites({ assessmentId:sel._id, sendNow:true });
      const d=r.data||{};
      await loadDriveData(sel._id);
      if(d.emailConfigured===false){
        showToast({ type:"error", title:"Email not configured on the server",
          lines:[`${d.scheduledCount||0} invitation(s) queued.`,"Set EMAIL_USER / EMAIL_PASS and RESTART the backend, then click again."] });
      } else if(d.smtpError){
        showToast({ type:"error", title:"SMTP authentication failed",
          lines:[`${d.scheduledCount||0} queued.`, d.smtpError] });
      } else {
        const lines=[`${d.sentCount||0} sent`, `${d.failedCount||0} failed`, `${d.scheduledCount||0} matched/queued`];
        if(d.errors&&d.errors.length) lines.push("First error: "+(d.errors[0].error||"unknown")+" ("+(d.errors[0].email||"")+")");
        showToast({ type:(d.failedCount>0?"error":"success"), title:(d.failedCount>0?"Sent with some failures":"Invitations sent"), lines });
      }
    }
    catch(e){ showToast({ type:"error", title:"Request failed", lines:[e.message] }); }
    finally{ setBusy(false); }
  };
  const runTestEmail=async()=>{
    const to=window.prompt("Send a test email to which address? (leave blank to only verify SMTP auth)","");
    if(to===null) return;
    setBusy(true);
    try{
      const r=await testEmail(to.trim());
      const d=r.data||{};
      showToast({ type:"success", title:d.step==="sent"?"Test email sent":"SMTP verified",
        lines:[d.message||"OK", `host: ${d.diag?.host}`, `from: ${d.diag?.from}`] });
    }catch(e){
      const extra=e.diag?` (host ${e.diag.host}, userSet=${e.diag.userSet}, passSet=${e.diag.passSet})`:"";
      showToast({ type:"error", title:"Email test failed", lines:[e.message, (e.step?("step: "+e.step):"")+extra] });
    }finally{ setBusy(false); }
  };
  // Modern confirm: runs `fn` after the user confirms in a styled modal.
  const askConfirm=(title,message,fn,opts={})=>setConfirmState({title,message,onConfirm:fn,...opts});
  const runConfirm=async()=>{
    if(!confirmState?.onConfirm) return;
    setConfirmBusy(true);
    try{ await confirmState.onConfirm(); setConfirmState(null); }
    catch(e){ showToast({type:"error",title:"Action failed",lines:[e.message]}); }
    finally{ setConfirmBusy(false); }
  };

  const bulkStatus=async(status)=>{
    if(!picked.size){ showToast({type:"error",title:"Select candidates first"}); return; }
    setBusy(true);
    try{ await setCandidateStatus({ candidateIds:[...picked], status }); setPicked(new Set()); await loadDriveData(sel._id); showToast({type:"success",title:`Marked ${status}`}); }
    catch(e){ showToast({type:"error",title:"Failed",lines:[e.message]}); } finally{ setBusy(false); }
  };
  const removeCand=(id)=>askConfirm("Delete candidate?","This permanently removes the candidate and their attempt. This cannot be undone.",
    async()=>{ await deleteCandidate(id); await loadDriveData(sel._id); showToast({type:"success",title:"Candidate deleted"}); });
  const terminateCand=(c)=>askConfirm(`Terminate ${c.name}'s test?`,
    "This will immediately end the student's assessment.\n\n• Their current answers will be saved.\n• The assessment cannot be resumed.\n• Their status becomes Terminated.\n• This cannot be undone.\n\nAre you sure you want to terminate this assessment?",
    async()=>{ await terminateCandidate(c._id); await loadDriveData(sel._id); showToast({type:"success",title:`${c.name}'s assessment terminated successfully`}); },
    { confirmLabel:"Terminate Test", busyLabel:"Terminating…" });
  const refreshCode=()=>askConfirm("Refresh test code?",`Issue a NEW random test code for "${sel.name}". Students who have already registered or are currently testing are NOT affected — they use their personal link. Only new registrations will need the new code. Use this between batches to stop code sharing.`,
    async()=>{ const r=await refreshTestCode(sel._id); setSel(s=>({...s,testCode:r.data.testCode})); await loadDrives(); showToast({type:"success",title:`New test code: ${r.data.testCode}`,lines:[`Previous code (${r.data.previous||"—"}) no longer works for new sign-ups.`,"Students already testing are unaffected."]}); });
  const delDrive=(d)=>askConfirm(`Delete drive "${d.name}"?`,"This also deletes ALL its candidates and cannot be undone.",
    async()=>{ await deleteAssessment(d._id,true); if(sel?._id===d._id) setSel(null); await loadDrives(); showToast({type:"success",title:"Drive deleted"}); });
  const copyLink=(link)=>{ navigator.clipboard?.writeText(link).then(()=>showToast({type:"success",title:"Copied to clipboard"}),()=>{}); };
  const getResume=async(c)=>{
    // Cloudinary-hosted → open the public URL directly.
    if(c.resume?.url){ window.open(c.resume.url,"_blank","noopener"); return; }
    try{
      const r=await downloadResume(c._id);
      const url=URL.createObjectURL(r.data);
      const a=document.createElement("a"); a.href=url;
      a.download=`${c.name.replace(/\s+/g,"_")}_${c.resume?.filename||"resume"}`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch(e){ showToast({type:"error",title:"No resume on file",lines:[e.message]}); }
  };

  const archiveDrive=async(d)=>{
    const to = d.status==="ARCHIVED" ? "ACTIVE" : "ARCHIVED";
    try{ await updateAssessment(d._id,{status:to}); if(sel?._id===d._id) setSel({...sel,status:to}); await loadDrives(); showToast({type:"success",title:to==="ARCHIVED"?"Drive archived":"Drive unarchived"}); }
    catch(e){ showToast({type:"error",title:"Failed",lines:[e.message]}); }
  };

  // Build an .xlsx of a drive's candidates with the full V3 column set.
  const exportDriveCandidates=async(drive, picks)=>{
    try{
      const r=await fetchCandidates({assessmentId:drive._id,page:1,limit:99999});
      let rows=r.data.data;
      if(picks && picks.size) rows=rows.filter(c=>picks.has(c._id));
      const cutoff=drive.cutoff;
      const ws=XLSX.utils.json_to_sheet(rows.map(c=>({
        Name:c.name, USN:c.usn||"", Email:c.email, Phone:c.phone||"", Course:c.course||"", Branch:c.branch||"",
        Gender:c.gender||"", DOB:c.dob||"", Aadhaar:c.aadhaar||"", College:c.college,
        Drive:drive.name, "Drive Type":drive.driveType, Source:c.candidateSource||"PRE_REGISTERED",
        Resume:c.resume?.filename?"Yes":"No",
        Score:c.score??"-", "Total":c.totalMarks??"-",
        Percentage:(c.score!=null&&c.totalMarks)?Math.round(c.score/c.totalMarks*100)+"%":"-",
        Status:c.status, Violations:c.violations?.total||0,
        Refreshes:c.refreshCount||0, "Termination Reason":c.terminationReason||"",
        "Location":c.geo&&c.geo.inside!=null?(c.geo.inside?"Inside":"Outside"):"", "Distance(m)":c.geo?.distance??"",
        Selected:(cutoff!=null&&c.score!=null)?(c.score>=cutoff?"Yes":"No"):"-",
        Completed:fmtDate(c.completedAt),
      })));
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Candidates");
      XLSX.writeFile(wb,`${drive.name.replace(/\s+/g,"_")}_candidates.xlsx`);
    }catch(e){ showToast({type:"error",title:"Export failed",lines:[e.message]}); }
  };
  const exportCands=()=>exportDriveCandidates(sel, picked.size?picked:null);

  const togglePick=(id)=>setPicked(p=>{const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n;});

  // Auto-refresh so DB changes (deletes, new walk-in registrations, submissions)
  // reflect in the dashboard without a manual reload.
  useEffect(()=>{
    const iv=setInterval(()=>{
      if(profileCand||resumeView) return;                 // pause while viewing a candidate/resume
      if(sel){ loadDriveData(sel._id,{silent:true}); }    // silent → data updates, no loading flash
      else { loadDrives(); }                              // drive list: setDrives only, already silent
    }, 12000);
    return ()=>clearInterval(iv);
  },[sel,loadDriveData,loadDrives,profileCand,resumeView]);

  const confirmEl = (
    <>
      {confirmState && <ConfirmModal title={confirmState.title} message={confirmState.message}
        confirmLabel={confirmState.confirmLabel} busyLabel={confirmState.busyLabel}
        onConfirm={runConfirm} onCancel={()=>setConfirmState(null)} loading={confirmBusy} />}
      {resumeView && <ResumeViewer candidate={resumeView} onClose={()=>setResumeView(null)} />}
      {profileCand && <CandidateProfile candidate={profileCand} onClose={()=>setProfileCand(null)} />}
    </>
  );

  const toastEl = toast && (
    <div onClick={()=>setToast(null)} style={{position:"fixed",top:18,right:18,zIndex:9999,maxWidth:360,
      background:toast.type==="error"?"#FEF2F2":"#ECFDF5",border:`1px solid ${toast.type==="error"?"#FECACA":"#A7F3D0"}`,
      color:toast.type==="error"?"#991B1B":"#065F46",borderRadius:12,padding:"14px 16px",boxShadow:"0 10px 30px rgba(0,0,0,.15)",cursor:"pointer"}}>
      <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>{toast.type==="error"?"⚠ ":"✅ "}{toast.title}</div>
      {(toast.lines||[]).filter(Boolean).map((l,i)=><div key={i} style={{fontSize:12.5,lineHeight:1.5}}>{l}</div>)}
      <div style={{fontSize:10,opacity:.6,marginTop:6}}>click to dismiss</div>
    </div>
  );

  // ── Drive list view ──
  if(!sel) return (
    <div>
      {toastEl}{confirmEl}
      {showCreate && <CreateDriveModal sections={sections} rounds={wsRounds} lockedRound={lockedRound || roundFilter} onClose={()=>setShowCreate(false)} onCreated={(createdRound)=>{setShowCreate(false); if(createdRound) setRoundFilter(String(createdRound)); loadDrives();}}/>}
      {editDrive && <EditDriveModal drive={editDrive} onClose={()=>setEditDrive(null)} onSaved={()=>{setEditDrive(null);loadDrives();}}/>}
      <div className="ad-section-head">
        <div className="ad-page-title">Campus Drives</div>
        {!isViewer() && <button className="ad-btn ad-btn--primary" onClick={()=>setShowCreate(true)}>+ New Drive</button>}
      </div>
      {/* Round switcher — hidden when the tab is opened from INSIDE a round:
          there the page shows only that round's drives. */}
      {!lockedRound && <div className="ad-round-tabs" style={{display:"flex",gap:8,marginBottom:12,borderBottom:"2px solid var(--border)",paddingBottom:2}}>
        {(wsRounds && wsRounds.length
            ? wsRounds.map(r=>[String(r.sequence), `Round ${r.sequence} — ${r.name}`])
            : [["1","🎯 First Round"],["2","🚀 Second Round"]]).map(([v,l])=>{
          const count=drives.filter(d=>(Number(d.round)||1)===Number(v)).length;
          const on=roundFilter===v;
          return (
            <button key={v} onClick={()=>setRoundFilter(v)}
              style={{border:"none",background:"none",cursor:"pointer",padding:"8px 14px",fontSize:14,
                fontWeight:on?800:600,color:on?"var(--accent, #2563EB)":"var(--text-3)",
                borderBottom:on?"3px solid var(--accent, #2563EB)":"3px solid transparent",marginBottom:-2}}>
              {l} <span style={{fontSize:12,opacity:.7}}>({count})</span>
            </button>
          );
        })}
      </div>}
      <div className="ad-toolbar" style={{marginBottom:14}}>
        {[["active","Active"],["archived","Archived"],["all","All"]].map(([v,l])=>(
          <button key={v} className={`ad-btn ad-btn--sm ${driveFilter===v?"ad-btn--primary":"ad-btn--outline"}`} onClick={()=>setDriveFilter(v)}>{l}</button>
        ))}
      </div>
      {(()=>{ const filtered=drives.filter(d=>{
          const inRound=(Number(d.round)||1)===Number(roundFilter);
          const inStatus=driveFilter==="all"?true:driveFilter==="archived"?d.status==="ARCHIVED":d.status!=="ARCHIVED";
          return inRound && inStatus;
        });
        return filtered.length===0 ? <div className="ad-empty">No {roundFilter==="2"?"Second":"First"} Round {driveFilter==="all"?"":driveFilter} drives yet.</div> :
        <div className="ad-drive-grid">
          {filtered.map(d=>{
            const isWk=d.driveType==="WALK_IN";
            const typeC=isWk?"#8B5CF6":"#3B82F6";
            const stC={ACTIVE:"#10B981",DRAFT:"#64748B",COMPLETED:"#3B82F6",ARCHIVED:"#EF4444"}[d.status]||"#64748B";
            return (
            <div key={d._id} className="ad-drive-card" onClick={()=>openDrive(d)}>
              <span className="ad-drive-accent" style={{background:typeC}} />
              <div className="ad-drive-head">
                <span className="ad-badge" style={{background:typeC+"22",color:typeC}}>{isWk?"WALK-IN":"PRE-REG"}</span>
                <span className="ad-badge" style={{background:stC+"22",color:stC}}>{d.status||"ACTIVE"}</span>
                {Number(d.round)===2 && <span className="ad-badge" style={{background:"#7C3AED22",color:"#7C3AED"}}>ROUND 2</span>}
              </div>
              <div className="ad-drive-name">{d.name}</div>
              {d.college && <div className="ad-drive-college">🏫 {d.college}</div>}
              {isWk && d.testCode && (
                <div className="ad-drive-code">{d.testCode}
                  {d.maxCandidates!=null && <span className="ad-drive-cap">{d.walkInCount||0}/{d.maxCandidates}</span>}
                </div>
              )}
              <div className="ad-drive-meta">
                <span>📅 {d.startAt?fmtDate(d.assessmentDate||d.startAt):fmtDate(d.deadline)}</span>
                {d.startAt && <span>⏰ {fmtTimeOnly(d.startAt)}–{fmtTimeOnly(d.endAt)}</span>}
                <span>⏱ {d.durationMinutes} min</span>
                <span>👥 {d.candidateCount} · ✅ {d.completedCount}</span>
                {d.cutoff!=null && <span style={{color:"#D97706",fontWeight:700}}>🎯 Cutoff {d.cutoff}</span>}
              </div>
              <div className="ad-drive-actions" onClick={e=>e.stopPropagation()}>
                <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>openDrive(d)}>View</button>
                <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>exportDriveCandidates(d)}>Export</button>
                {!isViewer() && <>
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setEditDrive(d)}>Edit</button>
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>archiveDrive(d)}>{d.status==="ARCHIVED"?"Unarchive":"Archive"}</button>
                  <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={()=>delDrive(d)}>Delete</button>
                </>}
              </div>
            </div>
            );
          })}
        </div>; })()}
    </div>
  );

  // ── Single drive view ──
  const isWalkIn = sel.driveType === "WALK_IN";
  const portalUrl = `${window.location.origin}/test`;
  const counterCards = isWalkIn
    ? [
        {label:"Registered",   val:stats?.counters?.uploaded,     color:"#7C3AED"},
        {label:"Started",      val:stats?.counters?.started,      color:"#D97706"},
        {label:"Completed",    val:stats?.counters?.completed,    color:"#059669"},
        {label:"Disqualified", val:stats?.counters?.disqualified, color:"#DC2626"},
      ]
    : [
        {label:"Candidates Uploaded", val:stats?.counters?.uploaded,            color:"#4F46E5"},
        {label:"Shortlist Emails Sent",val:stats?.counters?.shortlistEmailsSent, color:"#0891B2"},
        {label:"Assessment Links Sent",val:stats?.counters?.linkEmailsSent,      color:"#2563EB"},
        {label:"Started",             val:stats?.counters?.started,             color:"#D97706"},
        {label:"Completed",           val:stats?.counters?.completed,           color:"#059669"},
        {label:"Disqualified",        val:stats?.counters?.disqualified,        color:"#DC2626"},
      ];
  // Hide email-only statuses (Invited / Link Sent) on walk-in drives.
  const pipelineMeta = isWalkIn ? STATUS_META.filter(s=>!["invited","email-sent"].includes(s.key)) : STATUS_META;

  return (
    <div>
      {toastEl}{confirmEl}
      {showUpload && <UploadModal assessment={sel} onClose={()=>setShowUpload(false)} onDone={()=>{setShowUpload(false);loadDriveData(sel._id);}}/>}
      <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setSel(null)} style={{marginBottom:14}}>← All Drives</button>
      <div className="ad-section-head">
        <div className="ad-page-title" style={{marginBottom:0}}>{sel.name}</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {isWalkIn ? (
            <button className="ad-btn ad-btn--primary" onClick={()=>copyLink(portalUrl)}>🔗 Copy Test Portal Link</button>
          ) : (
            <>
              {!isViewer() && <button className="ad-btn ad-btn--primary" onClick={()=>setShowUpload(true)}>+ Upload Candidates</button>}
              {!isViewer() && <button className="ad-btn ad-btn--outline" onClick={sendInvites} disabled={busy}>{busy?<><Spinner/>…</>:"📧 Send Pending Invites"}</button>}
              <button className="ad-btn ad-btn--outline" onClick={runTestEmail} disabled={busy}>✉ Test Email</button>
            </>
          )}
          <button className="ad-btn ad-btn--export" onClick={exportCands}>⬇ Export</button>
        </div>
      </div>

      {/* Schedule summary */}
      <div style={{textAlign:"left",padding:"14px 18px",marginBottom:16,background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:12,color:"var(--text-1)",display:"flex",gap:24,flexWrap:"wrap",fontSize:13}}>
        <span><strong>Date:</strong> {fmtDate(sel.assessmentDate||sel.startAt)}</span>
        <span><strong>Start:</strong> {fmtTimeOnly(sel.startAt)}</span>
        <span><strong>End:</strong> {fmtTimeOnly(sel.endAt)}</span>
        {isWalkIn ? (
          <>
            <span style={{color:"#7C3AED",fontWeight:700}}><strong>Test Code:</strong> {sel.testCode||"—"}
              {!isViewer() && <button className="ad-btn ad-btn--sm ad-btn--outline" style={{marginLeft:8}} title="Issue a new code for the next batch. Students already testing are NOT affected." onClick={refreshCode}>🔄 Refresh Code</button>}
            </span>
            <span><strong>Capacity:</strong> {sel.walkInCount||0}{sel.maxCandidates!=null?` / ${sel.maxCandidates}`:" (unlimited)"}</span>
          </>
        ) : (
          <span><strong>Link Send:</strong> {LINK_SEND_OPTIONS.find(o=>o.value===sel.linkSendOption)?.label || "—"}{sel.linkSendAt?` (${fmtDateTime(sel.linkSendAt)})`:""}</span>
        )}
      </div>

      {/* Delivery / pipeline counters */}
      {stats?.counters && (
        <div className="ad-stats-grid" style={{marginBottom:14}}>
          {counterCards.map(s=>(
            <div key={s.label} className="ad-stat-card" style={{borderTopColor:s.color}}>
              <div className="ad-stat-val" style={{color:s.color}}>{s.val||0}</div>
              <div className="ad-stat-lbl">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Status pipeline counters */}
      {stats && (
        <div className="ad-stats-grid" style={{marginBottom:18}}>
          {pipelineMeta.map(s=>(
            <div key={s.key} className="ad-stat-card" style={{borderTopColor:s.color}}>
              <div className="ad-stat-val" style={{color:s.color}}>{stats.statusCounts[s.key]||0}</div>
              <div className="ad-stat-lbl">{s.label}</div>
            </div>
          ))}
          <div className="ad-stat-card" style={{borderTopColor:"#DC2626"}}>
            <div className="ad-stat-val" style={{color:"#DC2626"}}>{stats.totalViolations||0}</div>
            <div className="ad-stat-lbl">Total Violations</div>
          </div>
        </div>
      )}

      {/* College-wise breakdown */}
      {stats?.byCollege?.length>0 && (
        <div className="ad-table-wrap" style={{marginBottom:18}}>
          <table className="ad-table">
            <thead><tr><th>College</th><th>Candidates</th><th>Completed</th><th>Shortlisted</th><th>Avg Score</th></tr></thead>
            <tbody>{stats.byCollege.map(c=>(
              <tr key={c.college}><td><strong>{c.college}</strong></td><td>{c.total}</td><td>{c.completed}</td><td>{c.shortlisted}</td><td>{c.avgScore??"—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div className="ad-toolbar">
        <input className="ad-search" placeholder="Search name, email, USN, Aadhaar, phone…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        <select className="ad-select" value={fCollege} onChange={e=>{setFCollege(e.target.value);setPage(1);}}>
          <option value="">All Colleges</option>{colleges.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select className="ad-select" value={fSource} onChange={e=>{setFSource(e.target.value);setPage(1);}}>
          <option value="">All Sources</option><option value="WALK_IN">Walk-In</option><option value="PRE_REGISTERED">Pre-Registered</option>
        </select>
        <select className="ad-select" value={fStatus} onChange={e=>{setFStatus(e.target.value);setPage(1);}}>
          <option value="">All Status</option>{STATUS_META.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input type="number" className="ad-search" style={{width:120}} placeholder="Min score" value={fMinScore} onChange={e=>{setFMinScore(e.target.value);setPage(1);}}/>
      </div>

      {/* Bulk actions */}
      {picked.size>0 && (
        <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
          <span style={{fontSize:13,fontWeight:600}}>{picked.size} selected</span>
          <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={()=>bulkStatus("shortlisted")} disabled={busy}>Shortlist</button>
          <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={()=>bulkStatus("rejected")} disabled={busy}>Reject</button>
        </div>
      )}

      <div className="ad-table-wrap">
        {loading?<div className="ad-loading"><Spinner dark/>Loading…</div>
        :cands.length===0?<div className="ad-empty">{isWalkIn?"No candidates registered yet. Share the test portal link.":"No candidates yet. Click \"Upload Candidates\"."}</div>
        :<table className="ad-table">
          <thead><tr><th></th><th>#</th><th>Name</th><th>College</th><th>Source</th><th>Status</th><th>Time Left</th>{!isWalkIn&&<th>Shortlist</th>}{!isWalkIn&&<th>Link</th>}<th>Score</th><th>Viol.</th><th>Actions</th><th></th></tr></thead>
          <tbody>{cands.map((c,i)=>{
            const sm=STATUS_META.find(s=>s.key===c.status)||{label:c.status,color:"#64748B"};
            const walkIn=c.candidateSource==="WALK_IN";
            return (
              <tr key={c._id}>
                <td><input type="checkbox" checked={picked.has(c._id)} onChange={()=>togglePick(c._id)}/></td>
                <td className="ad-td-num">{(page-1)*20+i+1}</td>
                <td><div className="ad-td-name"><div className="ad-avatar">{c.name.charAt(0)}</div>{c.name}</div></td>
                <td className="ad-td-sm">{c.college}</td>
                <td><span className="ad-badge" style={{background:(walkIn?"#7C3AED":"#1a56db")+"22",color:walkIn?"#7C3AED":"#1a56db"}}>{walkIn?"Walk-in":"Pre-reg"}</span></td>
                <td>
                  <span className="ad-badge" style={{background:(c.submissionReason==="manual-terminate"?"#B45309":sm.color)+"22",color:c.submissionReason==="manual-terminate"?"#B45309":sm.color}}>{c.submissionReason==="manual-terminate"?"Manually Terminated":sm.label}</span>
                  {c.status==="disqualified"&&c.terminationReason&&<div style={{fontSize:11,color:"#DC2626",marginTop:3}}>⛔ {c.terminationReason}</div>}
                  {c.geo&&c.geo.inside!=null&&<div style={{fontSize:11,color:c.geo.inside?"#059669":"#DC2626",marginTop:2}}>📍 {c.geo.inside?"Inside":"Outside"}{c.geo.distance!=null?` · ${c.geo.distance}m`:""}</div>}
                </td>
                <td><TimeLeftCell candidate={c} durationMinutes={sel?.durationMinutes}/></td>
                {!isWalkIn&&<td className="ad-td-sm">{c.shortlistEmail?.status||"—"}</td>}
                {!isWalkIn&&<td className="ad-td-sm">{c.emailStatus}</td>}
                <td>{c.score!=null?<strong>{c.score}/{c.totalMarks}</strong>:"—"}</td>
                <td><span className={`ad-badge ${(c.violations?.total||0)>=3?"ad-badge--red":(c.violations?.total||0)>0?"ad-badge--amber":"ad-badge--green"}`} title={violBreakdown(c)}>{c.violations?.total||0}</span>{(c.refreshCount||0)>0&&<span title="Refreshes" style={{fontSize:11,color:"#D97706",marginLeft:4}}>↻{c.refreshCount}</span>}</td>
                <td style={{display:"flex",gap:4}}>
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setProfileCand(c)}>View</button>
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>copyLink(c.link)}>Copy</button>
                  {c.resume?.filename && <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setResumeView(c)}>📄 CV</button>}
                  {["started","in-progress"].includes(c.status) && !isViewer() &&
                    <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={()=>terminateCand(c)} title="End this student's live test now">⛔ Terminate</button>}
                </td>
                <td><button className="ad-btn ad-btn--sm ad-btn--danger" onClick={()=>removeCand(c._id)}>Delete</button></td>
              </tr>
            );
          })}</tbody>
        </table>}
      </div>
      <Pagination pag={pag} page={page} setPage={setPage}/>
    </div>
  );
}

// ── Resume Viewer modal (Phase 6/8) ────────────────────────────────────────────
function resumeName(c) {
  const ext = (c.resume?.ext || (c.resume?.filename || "").split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = String(c.name || "Candidate").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  const usn = c.usn ? `_${String(c.usn).replace(/[^a-z0-9]+/gi, "_")}` : "";
  return `${name}${usn}_Resume.${ext}`;
}
function ResumeViewer({ candidate, onClose }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const ext = (candidate.resume?.ext || (candidate.resume?.filename || "").split(".").pop() || "").toLowerCase();
  const isPdf = ext === "pdf" || (candidate.resume?.mime || "").includes("pdf");
  const isDoc = ["doc", "docx"].includes(ext) || (candidate.resume?.mime || "").includes("word");
  const fname = resumeName(candidate);

  useEffect(() => {
    let obj;
    (async () => {
      try {
        const r = await downloadResume(candidate._id);
        obj = URL.createObjectURL(r.data);
        setUrl(obj);
      } catch (e) { setErr(e.message || "Resume is temporarily unavailable."); }
      finally { setLoading(false); }
    })();
    return () => { if (obj) URL.revokeObjectURL(obj); };
  }, [candidate._id]);

  const download = async () => {
    try {
      const r = await downloadResumeFile(candidate._id);
      const u = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = u; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch { /* surfaced by viewer */ }
  };
  const printIt = () => { const f = document.getElementById("ad-resume-frame"); try { f?.contentWindow?.focus(); f?.contentWindow?.print(); } catch { window.open(url, "_blank"); } };

  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-modal" style={{ maxWidth: 920, width: "95%", height: "90vh", display: "flex", flexDirection: "column", padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
          <div className="ad-modal-title" style={{ margin: 0 }}>📄 {candidate.name} · Resume</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {isPdf && url && <>
              <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.15).toFixed(2)))}>－</button>
              <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setZoom(z => Math.min(2.5, +(z + 0.15).toFixed(2)))}>＋</button>
              <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setRot(r => (r + 90) % 360)}>⟳ Rotate</button>
              <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={printIt}>🖨 Print</button>
            </>}
            {url && <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => window.open(url, "_blank", "noopener")}>↗ New Tab</button>}
            <button className="ad-btn ad-btn--sm ad-btn--export" onClick={download}>⬇ Download</button>
            <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div style={{ padding: "6px 18px", fontSize: 12, color: "var(--text-3)", borderBottom: "1px solid var(--border)" }}>
          {candidate.resume?.filename || fname}
          {candidate.resume?.size ? ` · ${(candidate.resume.size / 1024).toFixed(0)} KB` : ""}
          {ext ? ` · ${ext.toUpperCase()}` : ""}
          {candidate.resume?.uploadedAt ? ` · uploaded ${fmtDate(candidate.resume.uploadedAt)}` : ""}
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "#525659", display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
          {loading ? <div style={{ color: "#fff", margin: "auto", display: "flex", gap: 10, alignItems: "center" }}><Spinner /> Loading resume…</div>
            : err ? <div style={{ color: "#fff", margin: "auto", textAlign: "center" }}>{err}<br /><button className="ad-btn ad-btn--export" style={{ marginTop: 12 }} onClick={download}>⬇ Download Resume</button></div>
            : isPdf && url ? (
              <iframe id="ad-resume-frame" title="resume" src={url}
                style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, border: "none", transform: `scale(${zoom}) rotate(${rot}deg)`, transformOrigin: "top center", background: "#fff" }} />
            ) : isDoc && candidate.resume?.url ? (
              <iframe title="resume" src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(candidate.resume.url)}`}
                style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />
            ) : (
              <div style={{ color: "#fff", margin: "auto", textAlign: "center" }}>
                Preview unavailable for this file type.<br />
                <button className="ad-btn ad-btn--export" style={{ marginTop: 12 }} onClick={download}>⬇ Download Resume</button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// ── Candidate Profile dialog (tabbed) ──────────────────────────────────────────
function Field({ label, value }) {
  return (
    <div className="ad-pf-field">
      <span className="ad-pf-k">{label}</span>
      <span className="ad-pf-v">{value || value === 0 ? value : "—"}</span>
    </div>
  );
}
function CandidateProfile({ candidate: c, onClose }) {
  const [tab, setTab] = useState("personal");
  const [resumeOpen, setResumeOpen] = useState(false);
  const [ansData, setAnsData] = useState(null);       // { candidate, answers, note? }
  const [ansLoading, setAnsLoading] = useState(false);
  const [ansErr, setAnsErr] = useState("");
  const [journey, setJourney] = useState(null);       // { currentRound, overallStatus, rounds[] }
  const [jLoading, setJLoading] = useState(false);
  useEffect(() => {
    if (tab !== "journey" || journey || jLoading) return;
    (async () => {
      setJLoading(true);
      try { const r = await fetchCandidateJourney(c._id); setJourney(r.data.data); }
      catch { setJourney({ rounds: [], overallStatus: "" }); }
      finally { setJLoading(false); }
    })();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== "answers" || ansData || ansLoading) return;
    (async () => {
      setAnsLoading(true); setAnsErr("");
      try { const r = await fetchCandidateAnswers(c._id); setAnsData(r.data.data); }
      catch (e) { setAnsErr(e.message || "Failed to load answers."); }
      finally { setAnsLoading(false); }
    })();
  }, [tab]);
  const sm = STATUS_META.find(s => s.key === c.status) || { label: c.status, color: "#64748B" };
  const pct = (c.score != null && c.totalMarks) ? Math.round(c.score / c.totalMarks * 100) + "%" : "—";
  const v = c.violations || {};
  const TABS = [["personal","Personal"],["journey","Journey"],["assessment","Assessment"],["answers","Answers"],["security","Security"],["resume","Resume"]];
  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-modal ad-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="ad-modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="ad-avatar" style={{ width: 44, height: 44, fontSize: 18 }}>{(c.name || "?").charAt(0)}</div>
            <div>
              <h3 className="ad-modal-title" style={{ margin: 0 }}>{c.name}</h3>
              <p className="ad-modal-sub">{c.email} · <span className="ad-badge" style={{ background: sm.color + "22", color: sm.color }}>{sm.label}</span></p>
            </div>
          </div>
          <button className="ad-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ad-pf-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`ad-pf-tab ${tab === id ? "ad-pf-tab--active" : ""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        <div className="ad-modal-body">
          {tab === "personal" && (
            <section className="ad-card-section">
              <div className="ad-card-section-title">👤 Personal Information</div>
              <div className="ad-pf-grid">
                <Field label="Full Name" value={c.name} />
                <Field label="USN" value={c.usn} />
                <Field label="Email" value={c.email} />
                <Field label="Phone" value={c.phone} />
                <Field label="Gender" value={c.gender} />
                <Field label="Date of Birth" value={c.dob} />
                <Field label="Aadhaar" value={c.aadhaar} />
                <Field label="College" value={c.college} />
                <Field label="Course" value={c.course} />
                <Field label="Branch" value={c.branch} />
                <Field label="Address" value={c.location} />
                <Field label="Source" value={c.candidateSource === "WALK_IN" ? "Walk-in" : "Pre-registered"} />
              </div>
            </section>
          )}
          {tab === "journey" && (
            <section className="ad-card-section">
              <div className="ad-card-section-title">🪜 Recruitment Journey</div>
              {jLoading ? <div className="ad-loading"><Spinner dark/>Loading…</div> : (
                <div>
                  <div style={{marginBottom:12,fontSize:13}}>
                    Current stage: <strong>{journey?.currentRoundName||"—"}</strong>
                    {journey?.overallStatus && <span className="ad-badge" style={{marginLeft:8,background:"#4F46E522",color:"#4F46E5"}}>{String(journey.overallStatus).replace(/_/g," ")}</span>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {(journey?.rounds||[]).map(r=>{
                      const done=r.roundStatus!=="NOT_STARTED";
                      const icon=r.roundStatus==="SELECTED"?"✓":r.roundStatus==="REJECTED"?"✗":done?"✓":"→";
                      const col=r.roundStatus==="SELECTED"?"#16A34A":r.roundStatus==="REJECTED"?"#DC2626":done?"#4F46E5":"#94A3B8";
                      return (
                        <div key={r.candidateId} style={{border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div style={{fontWeight:800}}><span style={{color:col,marginRight:8}}>{icon}</span>{r.roundName}</div>
                            <span className="ad-badge" style={{background:col+"22",color:col}}>{String(r.roundStatus).replace(/_/g," ")}</span>
                          </div>
                          <div style={{fontSize:13,color:"var(--text-2)",marginTop:4,marginLeft:24}}>
                            {r.score!=null ? <>Score: <strong>{r.score}/{r.totalScore}</strong>{r.percentage!=null?` (${r.percentage}%)`:""}</> : "No result yet"}
                            {r.driveName?` · ${r.driveName}`:""}
                          </div>
                        </div>
                      );
                    })}
                    {(!journey?.rounds||journey.rounds.length===0) && <div className="ad-empty">No round history found.</div>}
                    <div style={{border:"1px dashed var(--border)",borderRadius:10,padding:"10px 14px",color:"var(--text-2)"}}>
                      <span style={{marginRight:8}}>{journey?.overallStatus==="FINALLY_SELECTED"?"✓":"○"}</span>
                      <strong>Final Selection</strong> — {journey?.overallStatus==="FINALLY_SELECTED"?"Selected":"Pending"}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
          {tab === "assessment" && (
            <section className="ad-card-section">
              <div className="ad-card-section-title">📝 Assessment</div>
              <div className="ad-pf-grid">
                {c.drive?.name && <Field label="Drive" value={c.drive.name} />}
                <Field label="Status" value={sm.label} />
                <Field label="Score" value={c.score != null ? `${c.score} / ${c.totalMarks}` : "—"} />
                <Field label="Percentage" value={pct} />
                <Field label="Result" value={c.passed == null ? "—" : (c.passed ? "Pass" : "Fail")} />
                <Field label="Started" value={fmtDateTime(c.startedAt)} />
                <Field label="Completed" value={fmtDateTime(c.completedAt)} />
                <Field label="Submission" value={c.submissionReason || "—"} />
              </div>
            </section>
          )}
          {tab === "answers" && (
            <section className="ad-card-section">
              <div className="ad-card-section-title">📝 Answer Sheet {ansData?.candidate?.assignedSet ? `· Set ${ansData.candidate.assignedSet}` : ""}</div>
              {ansLoading ? <div className="ad-loading"><Spinner dark/>Loading answers…</div>
              : ansErr ? <p className="ad-form-err">{ansErr}</p>
              : !ansData || !ansData.answers?.length ? (
                <div className="ad-empty">{ansData?.note || "No answers recorded for this candidate yet."}</div>
              ) : (
                <>
                  <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:12,fontSize:13}}>
                    <span>✅ Correct: <strong style={{color:"#059669"}}>{ansData.answers.filter(a=>a.isCorrect).length}</strong></span>
                    <span>❌ Wrong: <strong style={{color:"#DC2626"}}>{ansData.answers.filter(a=>!a.isCorrect && a.given!=null).length}</strong></span>
                    <span>⭕ Unanswered: <strong style={{color:"#64748B"}}>{ansData.answers.filter(a=>a.given==null).length}</strong></span>
                    {c.score!=null && <span>🎯 Score: <strong>{c.score}/{c.totalMarks}</strong></span>}
                  </div>
                  <div className="ad-table-wrap" style={{maxHeight:420,overflowY:"auto"}}>
                    <table className="ad-table">
                      <thead><tr><th>#</th><th style={{minWidth:260}}>Question</th><th>Student's Answer</th><th>Correct Answer</th><th></th></tr></thead>
                      <tbody>{ansData.answers.map(a=>(
                        <tr key={a.n} style={{background:a.given==null?"transparent":a.isCorrect?"#ECFDF522":"#FEF2F222"}}>
                          <td className="ad-td-num">{a.n}</td>
                          <td style={{fontSize:12.5,whiteSpace:"pre-wrap",fontFamily:a.text?.includes("\n")?"ui-monospace,Consolas,monospace":"inherit",maxWidth:420}}>{a.text}</td>
                          <td style={{fontSize:12.5,fontFamily:"ui-monospace,Consolas,monospace"}}>{a.given==null?<span style={{color:"#94A3B8"}}>— not answered —</span>:a.given}</td>
                          <td style={{fontSize:12.5,fontFamily:"ui-monospace,Consolas,monospace",color:"#059669"}}>{a.correct??"—"}</td>
                          <td>{a.given==null?"⭕":a.isCorrect?"✅":"❌"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
          {tab === "security" && (
            <section className="ad-card-section">
              <div className="ad-card-section-title">🔐 Security & Integrity</div>
              {c.status === "disqualified" && c.terminationReason &&
                <div className="ad-note" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", marginBottom: 12 }}>⛔ Terminated — {c.terminationReason}</div>}
              <div className="ad-pf-grid">
                <Field label="Total Violations" value={v.total || 0} />
                <Field label="Refreshes" value={c.refreshCount || 0} />
                <Field label="Fullscreen Exits" value={v.fullscreenExits || 0} />
                <Field label="Tab Switches" value={v.tabSwitches || 0} />
                <Field label="Focus Loss" value={v.focusLoss || 0} />
                <Field label="Multiple Faces" value={v.multipleFaces || 0} />
                <Field label="DevTools" value={v.devtools || 0} />
                <Field label="Clipboard" value={v.clipboard || 0} />
                <Field label="Idle" value={v.idle || 0} />
                <Field label="Window Resize" value={v.windowResize || 0} />
                <Field label="Camera Disconnect" value={v.cameraDisconnect || 0} />
                <Field label="Face Hidden" value={v.faceHidden || 0} />
                <Field label="Location" value={c.geo && c.geo.inside != null ? (c.geo.inside ? "Inside radius" : `Outside (${c.geo.distance}m)`) : "—"} />
              </div>
            </section>
          )}
          {tab === "resume" && (
            <section className="ad-card-section">
              <div className="ad-card-section-title">📄 Resume</div>
              {c.resume?.filename ? (
                <>
                  <div className="ad-pf-grid">
                    <Field label="File" value={c.resume.filename} />
                    <Field label="Type" value={(c.resume.ext || "").toUpperCase() || "—"} />
                    <Field label="Size" value={c.resume.size ? `${(c.resume.size / 1024).toFixed(0)} KB` : "—"} />
                    <Field label="Uploaded" value={fmtDate(c.resume.uploadedAt)} />
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button className="ad-btn ad-btn--primary ad-btn--sm" onClick={() => setResumeOpen(true)}>👁 Open Resume</button>
                  </div>
                </>
              ) : <div className="ad-empty" style={{ padding: 24 }}>No resume on file.</div>}
            </section>
          )}
        </div>

        <div className="ad-modal-foot">
          <button className="ad-btn ad-btn--outline" onClick={onClose}>Close</button>
        </div>
      </div>
      {resumeOpen && <ResumeViewer candidate={c} onClose={() => setResumeOpen(false)} />}
    </div>
  );
}

// ── Global All-Candidates view (across every drive) ────────────────────────────
function AllCandidatesTab() {
  const [rows,setRows]=useState([]); const [pag,setPag]=useState({}); const [page,setPage]=useState(1);
  const [search,setSearch]=useState(""); const [college,setCollege]=useState(""); const [source,setSource]=useState("");
  const [status,setStatus]=useState(""); const [minScore,setMinScore]=useState(""); const [driveId,setDriveId]=useState("");
  const [round,setRound]=useState("");
  const [colleges,setColleges]=useState([]); const [drives,setDrives]=useState([]);
  const [loading,setLoading]=useState(false); const [exporting,setExporting]=useState(false); const [toast,setToast]=useState(null);
  const showToast=(t)=>{ setToast(t); setTimeout(()=>setToast(null),6000); };

  const params=()=>({ page, limit:20, search:search||undefined, college:college||undefined, source:source||undefined,
    status:status||undefined, minScore:minScore||undefined, assessmentId:driveId||undefined, round:round||undefined });

  const load=useCallback(async({silent=false}={})=>{
    if(!silent) setLoading(true);
    try{ const r=await fetchCandidates(params()); setRows(r.data.data); setPag(r.data.pagination); }
    catch{} finally{ if(!silent) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[page,search,college,source,status,minScore,driveId,round]);

  const [resumeView,setResumeView]=useState(null);
  const [profileCand,setProfileCand]=useState(null);

  useEffect(()=>{ (async()=>{ try{const [cl,dr]=await Promise.all([fetchDriveColleges({}),fetchAssessments()]); setColleges(cl.data.data||[]); setDrives(dr.data.data||[]);}catch{} })(); },[]);
  useEffect(()=>{ load(); },[load]);
  // Silent auto-refresh — updates data only, no loading flash; paused while viewing a candidate/resume.
  useEffect(()=>{
    const iv=setInterval(()=>{ if(!profileCand && !resumeView) load({silent:true}); },15000);
    return ()=>clearInterval(iv);
  },[load,profileCand,resumeView]);
  const exportAll=async()=>{
    setExporting(true);
    try{
      const r=await fetchCandidates({...params(),page:1,limit:99999});
      const ws=XLSX.utils.json_to_sheet((r.data.data||[]).map(c=>({
        Name:c.name, USN:c.usn||"", Email:c.email, Phone:c.phone||"", Course:c.course||"", Branch:c.branch||"",
        Gender:c.gender||"", DOB:c.dob||"", Aadhaar:c.aadhaar||"", College:c.college,
        Round:c.roundName||"", Drive:c.drive?.name||"", "Drive Type":c.drive?.driveType||"", Source:c.candidateSource||"PRE_REGISTERED",
        Resume:c.resume?.filename?"Yes":"No", Score:c.score??"-", Total:c.totalMarks??"-",
        Percentage:(c.score!=null&&c.totalMarks)?Math.round(c.score/c.totalMarks*100)+"%":"-",
        Status:c.status, Violations:c.violations?.total||0,
        Refreshes:c.refreshCount||0, "Termination Reason":c.terminationReason||"",
        "Location":c.geo&&c.geo.inside!=null?(c.geo.inside?"Inside":"Outside"):"", "Distance(m)":c.geo?.distance??"",
        Selected:(c.drive?.cutoff!=null&&c.score!=null)?(c.score>=c.drive.cutoff?"Yes":"No"):"-",
        Completed:fmtDate(c.completedAt),
      })));
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"All Candidates"); XLSX.writeFile(wb,"MH_All_Candidates.xlsx");
    }catch(e){ showToast({type:"error",title:"Export failed",lines:[e.message]}); } finally{ setExporting(false); }
  };

  const toastEl = toast && (
    <div onClick={()=>setToast(null)} style={{position:"fixed",top:18,right:18,zIndex:9999,maxWidth:340,background:toast.type==="error"?"#FEF2F2":"#ECFDF5",border:`1px solid ${toast.type==="error"?"#FECACA":"#A7F3D0"}`,color:toast.type==="error"?"#991B1B":"#065F46",borderRadius:12,padding:"12px 14px",cursor:"pointer"}}>
      <div style={{fontWeight:800,fontSize:13}}>{toast.title}</div>
    </div>
  );

  return (
    <div>
      {toastEl}
      {resumeView && <ResumeViewer candidate={resumeView} onClose={()=>setResumeView(null)} />}
      {profileCand && <CandidateProfile candidate={profileCand} onClose={()=>setProfileCand(null)} />}
      <div className="ad-section-head">
        <div className="ad-page-title">All Candidates ({pag.total||0})</div>
        <button className="ad-btn ad-btn--export" onClick={exportAll} disabled={exporting}>{exporting?<><Spinner/>Exporting…</>:"⬇ Export Excel"}</button>
      </div>
      <div className="ad-toolbar">
        <input className="ad-search" placeholder="Search name, email, USN, Aadhaar, phone…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        <select className="ad-select" value={round} onChange={e=>{setRound(e.target.value);setPage(1);}}>
          <option value="">All Rounds</option><option value="1">Aptitude</option><option value="2">Technical Round</option>
        </select>
        <select className="ad-select" value={driveId} onChange={e=>{setDriveId(e.target.value);setPage(1);}}>
          <option value="">All Drives</option>{drives.map(d=><option key={d._id} value={d._id}>{d.name}</option>)}
        </select>
        <select className="ad-select" value={college} onChange={e=>{setCollege(e.target.value);setPage(1);}}>
          <option value="">All Colleges</option>{colleges.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select className="ad-select" value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}>
          <option value="">All Sources</option><option value="WALK_IN">Walk-In</option><option value="PRE_REGISTERED">Pre-Registered</option>
        </select>
        <select className="ad-select" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
          <option value="">All Status</option>{STATUS_META.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input type="number" className="ad-search" style={{width:120}} placeholder="Min score" value={minScore} onChange={e=>{setMinScore(e.target.value);setPage(1);}}/>
      </div>
      <div className="ad-table-wrap">
        {loading?<div className="ad-loading"><Spinner dark/>Loading…</div>
        :rows.length===0?<div className="ad-empty">No candidates match these filters.</div>
        :<table className="ad-table">
          <thead><tr><th>#</th><th>Name</th><th>Email</th><th>College</th><th>Source</th><th>Round</th><th>Drive</th><th>Status</th><th>Score</th><th>Viol.</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((c,i)=>{
            const sm=STATUS_META.find(s=>s.key===c.status)||{label:c.status,color:"#64748B"};
            const walkIn=c.candidateSource==="WALK_IN";
            return (
              <tr key={c._id}>
                <td className="ad-td-num">{(page-1)*20+i+1}</td>
                <td><div className="ad-td-name"><div className="ad-avatar">{c.name.charAt(0)}</div>{c.name}</div></td>
                <td className="ad-td-sm">{c.email}</td>
                <td className="ad-td-sm">{c.college}</td>
                <td><span className="ad-badge" style={{background:(walkIn?"#7C3AED":"#1a56db")+"22",color:walkIn?"#7C3AED":"#1a56db"}}>{walkIn?"Walk-in":"Pre-reg"}</span></td>
                <td><span className="ad-badge" style={{background:"#4F46E522",color:"#4F46E5"}}>{c.roundName||"—"}</span></td>
                <td className="ad-td-sm">{c.drive?.name||"—"}</td>
                <td><span className="ad-badge" style={{background:sm.color+"22",color:sm.color}}>{sm.label}</span></td>
                <td>{c.score!=null?<strong>{c.score}/{c.totalMarks}</strong>:"—"}</td>
                <td><span className={`ad-badge ${(c.violations?.total||0)>=3?"ad-badge--red":(c.violations?.total||0)>0?"ad-badge--amber":"ad-badge--green"}`}>{c.violations?.total||0}</span></td>
                <td style={{display:"flex",gap:4}}>
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setProfileCand(c)}>View</button>
                  {c.resume?.filename&&<button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setResumeView(c)}>📄</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>}
      </div>
      <Pagination pag={pag} page={page} setPage={setPage}/>
    </div>
  );
}

// ── Rounds (Aptitude / Technical) segregation dashboard ────────────────────────
const ROUND_LABELS = { 1: "Aptitude", 2: "Technical Round" };
function RoundsTab() {
  const [summary,setSummary]=useState(null);
  const [round,setRound]=useState(1);              // 1 = Aptitude, 2 = Technical Round
  const [stats,setStats]=useState(null);
  const [rows,setRows]=useState([]); const [pag,setPag]=useState({}); const [page,setPage]=useState(1);
  const [search,setSearch]=useState(""); const [status,setStatus]=useState(""); const [college,setCollege]=useState("");
  const [colleges,setColleges]=useState([]);
  const [sel,setSel]=useState(()=>new Set());       // selected candidate ids (bulk move)
  const [loading,setLoading]=useState(false); const [exporting,setExporting]=useState(false);
  const [profileCand,setProfileCand]=useState(null); const [resumeView,setResumeView]=useState(null);
  const [confirmMove,setConfirmMove]=useState(false); const [moving,setMoving]=useState(false);
  const [toast,setToast]=useState(null); const showToast=(t)=>{ setToast(t); setTimeout(()=>setToast(null),6000); };

  const params=()=>({ page, limit:20, round, search:search||undefined, status:status||undefined, college:college||undefined });
  const loadSummary=useCallback(async()=>{ try{ const r=await fetchRoundSummary(); setSummary(r.data.data); }catch{} },[]);
  const loadStats=useCallback(async()=>{ try{ const r=await fetchCandidateStats({round}); setStats(r.data.data); }catch{} },[round]);
  const load=useCallback(async({silent=false}={})=>{
    if(!silent) setLoading(true);
    try{ const r=await fetchCandidates(params()); setRows(r.data.data); setPag(r.data.pagination); }
    catch{} finally{ if(!silent) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[page,round,search,status,college]);
  useEffect(()=>{ loadSummary(); },[loadSummary]);
  useEffect(()=>{ loadStats(); setSel(new Set()); setPage(1); },[round,loadStats]);
  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ (async()=>{ try{const cl=await fetchDriveColleges({}); setColleges(cl.data.data||[]);}catch{} })(); },[]);
  useEffect(()=>{ const iv=setInterval(()=>{ if(!profileCand && !resumeView){ load({silent:true}); loadStats(); } },20000); return ()=>clearInterval(iv); },[load,loadStats,profileCand,resumeView]);

  const sc = stats?.statusCounts||{};
  const cards = [
    { label:`${ROUND_LABELS[round]} Candidates`, val:(summary?.rounds?.find(r=>r.roundNumber===round)?.total)||pag.total||0, color:"#4F46E5" },
    { label:"Started",       val:(sc.started||0)+(sc["in-progress"]||0), color:"#0EA5E9" },
    { label:"Completed",     val:(sc.completed||0)+(sc.shortlisted||0)+(sc.rejected||0), color:"#10B981" },
    { label:"Selected",      val:sc.shortlisted||0, color:"#16A34A" },
    { label:"Rejected",      val:(sc.rejected||0)+(sc.disqualified||0), color:"#DC2626" },
    { label:"Not Attempted", val:(sc.invited||0)+(sc["email-sent"]||0), color:"#64748B" },
  ];

  const selectable = (c)=> round===1 && c.status==="shortlisted";   // only Aptitude-SELECTED can advance
  const pageSelectable = rows.filter(selectable).map(c=>c._id);
  const allSelected = pageSelectable.length>0 && pageSelectable.every(id=>sel.has(id));
  const toggle=(id)=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleAll=()=>setSel(s=>{ const n=new Set(s); if(allSelected) pageSelectable.forEach(id=>n.delete(id)); else pageSelectable.forEach(id=>n.add(id)); return n; });
  const doMove=async()=>{
    setMoving(true);
    try{ const r=await moveToTechnical([...sel]); const d=r.data.data;
      showToast({type:"success",title:`Moved ${d.moved} candidate(s) to Technical`,lines:[`${d.linkedExistingTechnical||0} existing Technical record(s) linked. ${d.skipped||0} skipped (not Aptitude-selected).`]});
      setSel(new Set()); setConfirmMove(false); load(); loadSummary();
    }catch(e){ showToast({type:"error",title:"Move failed",lines:[e.message]}); }
    finally{ setMoving(false); }
  };

  const exportRound=async()=>{
    setExporting(true);
    try{
      const r=await fetchCandidates({...params(),page:1,limit:99999});
      const ws=XLSX.utils.json_to_sheet((r.data.data||[]).map(c=>({
        Name:c.name, Email:c.email, Phone:c.phone||"", USN:c.usn||"", College:c.college,
        Round:c.roundName||ROUND_LABELS[round], Drive:c.drive?.name||"",
        Score:c.score??"-", Total:c.totalMarks??"-",
        Percentage:(c.score!=null&&c.totalMarks)?Math.round(c.score/c.totalMarks*100)+"%":"-",
        Status:c.status, "Round Status":c.roundStatus||"", Completed:fmtDate(c.completedAt),
      })));
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,ROUND_LABELS[round]);
      XLSX.writeFile(wb,`MH_${ROUND_LABELS[round].replace(/\s+/g,"_")}${status?"_"+status:""}.xlsx`);
    }catch(e){ showToast({type:"error",title:"Export failed",lines:[e.message]}); } finally{ setExporting(false); }
  };

  const toastEl = toast && (
    <div onClick={()=>setToast(null)} style={{position:"fixed",top:18,right:18,zIndex:9999,maxWidth:360,background:toast.type==="error"?"#FEF2F2":"#ECFDF5",border:`1px solid ${toast.type==="error"?"#FECACA":"#A7F3D0"}`,color:toast.type==="error"?"#991B1B":"#065F46",borderRadius:12,padding:"12px 14px",cursor:"pointer"}}>
      <div style={{fontWeight:800,fontSize:13}}>{toast.title}</div>
      {(toast.lines||[]).map((l,i)=><div key={i} style={{fontSize:12,marginTop:2}}>{l}</div>)}
    </div>
  );

  return (
    <div>
      {toastEl}
      {resumeView && <ResumeViewer candidate={resumeView} onClose={()=>setResumeView(null)} />}
      {profileCand && <CandidateProfile candidate={profileCand} onClose={()=>setProfileCand(null)} />}
      {confirmMove && <ConfirmModal title="Move to Technical Round"
        message={`You are about to move ${sel.size} candidate(s) from Aptitude to Technical Round. Their Aptitude results stay intact. Continue?`}
        confirmLabel="Move" busyLabel="Moving…" loading={moving} onConfirm={doMove} onCancel={()=>setConfirmMove(false)} />}

      <div className="ad-section-head">
        <div className="ad-page-title">Rounds</div>
        <button className="ad-btn ad-btn--export" onClick={exportRound} disabled={exporting}>{exporting?<><Spinner/>Exporting…</>:"⬇ Export Round"}</button>
      </div>

      {/* Recruitment funnel */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
        {(summary?.rounds||[]).map(r=>(
          <button key={r.roundNumber} onClick={()=>setRound(r.roundNumber)}
            style={{textAlign:"left",cursor:"pointer",flex:"1 1 200px",minWidth:180,border:round===r.roundNumber?"2px solid #4F46E5":"1px solid var(--border)",borderRadius:12,padding:"12px 16px",background:"var(--surface)"}}>
            <div style={{fontSize:12,color:"var(--text-2)",fontWeight:700}}>{r.roundName}</div>
            <div style={{fontSize:24,fontWeight:800}}>{r.total}</div>
            <div style={{fontSize:12,color:"#16A34A",fontWeight:700}}>{r.selected} Selected</div>
          </button>
        ))}
        <div style={{flex:"1 1 200px",minWidth:180,border:"1px dashed var(--border)",borderRadius:12,padding:"12px 16px",background:"var(--surface)"}}>
          <div style={{fontSize:12,color:"var(--text-2)",fontWeight:700}}>Final Selection</div>
          <div style={{fontSize:24,fontWeight:800}}>{summary?.final?.selected||0}</div>
          <div style={{fontSize:12,color:"var(--text-2)"}}>from Technical</div>
        </div>
      </div>

      {/* Round toggle */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[1,2].map(n=>(
          <button key={n} className={`ad-btn ad-btn--sm ${round===n?"ad-btn--primary":"ad-btn--outline"}`} onClick={()=>setRound(n)}>{ROUND_LABELS[n]}</button>
        ))}
      </div>

      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:16}}>
        {cards.map(c=>(
          <div key={c.label} style={{border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px",background:"var(--surface)"}}>
            <div style={{fontSize:12,color:"var(--text-2)",fontWeight:700}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Filters + move action */}
      <div className="ad-toolbar">
        <input className="ad-search" placeholder="Search name, email, phone, USN…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        <select className="ad-select" value={college} onChange={e=>{setCollege(e.target.value);setPage(1);}}>
          <option value="">All Colleges</option>{colleges.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select className="ad-select" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
          <option value="">All Status</option>{STATUS_META.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {round===1 && sel.size>0 && (
          <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={()=>setConfirmMove(true)}>Move {sel.size} to Technical →</button>
        )}
      </div>

      <div className="ad-table-wrap">
        {loading?<div className="ad-loading"><Spinner dark/>Loading…</div>
        :rows.length===0?<div className="ad-empty">No candidates in {ROUND_LABELS[round]} match these filters.</div>
        :<table className="ad-table">
          <thead><tr>
            {round===1 && <th style={{width:28}}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all selectable on page"/></th>}
            <th>#</th><th>Name</th><th>College</th><th>Email</th><th>Round</th><th>Score</th><th>%</th><th>Status</th><th>Completed</th><th>Action</th>
          </tr></thead>
          <tbody>{rows.map((c,i)=>{
            const sm=STATUS_META.find(s=>s.key===c.status)||{label:c.status,color:"#64748B"};
            const pct=(c.score!=null&&c.totalMarks)?Math.round(c.score/c.totalMarks*100)+"%":"—";
            return (
              <tr key={c._id}>
                {round===1 && <td>{selectable(c)?<input type="checkbox" checked={sel.has(c._id)} onChange={()=>toggle(c._id)}/>:null}</td>}
                <td className="ad-td-num">{(page-1)*20+i+1}</td>
                <td><div className="ad-td-name"><div className="ad-avatar">{c.name.charAt(0)}</div>{c.name}</div></td>
                <td className="ad-td-sm">{c.college}</td>
                <td className="ad-td-sm">{c.email}</td>
                <td><span className="ad-badge" style={{background:"#4F46E522",color:"#4F46E5"}}>{c.roundName||ROUND_LABELS[round]}</span></td>
                <td>{c.score!=null?<strong>{c.score}/{c.totalMarks}</strong>:"—"}</td>
                <td className="ad-td-sm">{pct}</td>
                <td><span className="ad-badge" style={{background:sm.color+"22",color:sm.color}}>{sm.label}</span></td>
                <td className="ad-td-sm">{fmtDate(c.completedAt)}</td>
                <td><button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setProfileCand(c)}>View</button></td>
              </tr>
            );
          })}</tbody>
        </table>}
      </div>
      <Pagination pag={pag} page={page} setPage={setPage}/>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
/* WORKSPACE-LEVEL navigation. These tabs exist ONLY inside an open workspace —
 * at the global level the admin manages companies and nothing else. The screens
 * below are the original ones, now scoped to the open workspace. */
const TABS = [
  { id:"workspace",  icon:"📊", label:"Overview"  },
  { id:"ws-students",icon:"👥", label:"Students"  },
  { id:"ws-rounds",  icon:"🪜", label:"Rounds"    },
  { id:"ws-results", icon:"🏆", label:"Results"   },
  { id:"questions",  icon:"❓", label:"Questions" },
  { id:"cutoff",     icon:"🎯", label:"Cutoff"    },
  { id:"ws-reports", icon:"🤖", label:"Reports"   },
  { id:"ws-settings",icon:"⚙️",  label:"Settings"  },
];
// Which workspace section each tab renders. There is no drive tab: a workspace
// runs ONE recruitment process and the admin navigates straight to its rounds.
const WS_SECTION = {
  workspace: "overview", "ws-students": "students", "ws-rounds": "rounds",
  "ws-results": "results", "ws-reports": "reports", "ws-settings": "settings",
};

// ── Main Dashboard ─────────────────────────────────────────────────────────────
// ── Assessment Active Mode banner (Render keep-awake) ──────────────────────────
// Sensible default shutoff: today 10 PM local; if already past, now + 2h.
// (toLocalInput is defined once, higher up in this file, and reused here.)
const defaultOff=()=>{ const d=new Date(); d.setHours(22,0,0,0); if(d.getTime()<=Date.now()) d.setTime(Date.now()+2*3600e3); return toLocalInput(d); };

function ActiveModeBanner() {
  const [st,setSt]=useState(null);
  const [busy,setBusy]=useState(false);
  const [warn,setWarn]=useState(false);
  const [offTime,setOffTime]=useState(defaultOff);   // admin-chosen auto-off time (local)
  const hbRef=useRef(null);

  // Mirror the server's current shutoff time into the picker when active.
  useEffect(()=>{ if(st?.autoOffAt) setOffTime(toLocalInput(new Date(st.autoOffAt))); },[st?.autoOffAt]);

  const load=useCallback(async()=>{ try{const r=await getSystemStatus(); setSt(r.data.data);}catch{} },[]);
  useEffect(()=>{ load(); const iv=setInterval(load,60000); return ()=>clearInterval(iv); },[load]);

  // While Active Mode is ON, keep EVERY backend awake — not just the one this
  // browser picked. warmAllBackends() pings all 6 Render instances directly
  // (incl. the live-proctoring signaling server). Every 10 min beats Render's
  // 15-min idle-sleep with margin (pinging at exactly 15 would race the sleep).
  // sendHeartbeat() still records lastHeartbeat for the status card.
  useEffect(()=>{
    if(st?.activeMode){
      const tick=()=>{ warmAllBackends(); sendHeartbeat().catch(()=>{}); };
      tick();
      hbRef.current=setInterval(tick,10*60*1000);
      return ()=>clearInterval(hbRef.current);
    }
  },[st?.activeMode]);

  // 10 PM warning: when within 15 min of auto-off and still active.
  useEffect(()=>{
    if(!st?.activeMode||!st?.autoOffAt){ setWarn(false); return; }
    const check=()=>{ const off=new Date(st.autoOffAt).getTime(); const now=Date.now();
      setWarn(now>=off-15*60*1000 && now<off); };
    check(); const iv=setInterval(check,30000); return ()=>clearInterval(iv);
  },[st?.activeMode,st?.autoOffAt]);

  const toggle=async(payload)=>{ setBusy(true); try{const r=await setActiveMode(payload); setSt(r.data.data); if(!payload.on&&!payload.extend) setWarn(false); if(payload.extend) setWarn(false);}catch(e){alert(e.message);}finally{setBusy(false);} };

  const active=st?.activeMode;
  const fmt=d=>d?new Date(d).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—";

  return (
    <>
      <div className={`ad-status-widget ${active?"ad-status-widget--on":""}`}>
        <div className="ad-status-main">
          <span className={`ad-status-dot ${active?"ad-status-dot--on":""}`} />
          <div>
            <div className="ad-status-title">{active?"Assessment Mode Active":"Assessment Mode Disabled"}</div>
            <div className="ad-status-sub">{active?`Pinging all ${BACKEND_COUNT} servers every 10 min (incl. live-camera server)`:"Backend may sleep between assessments"}</div>
          </div>
        </div>
        {active && st && (
          <div className="ad-status-metrics">
            <div><span className="ad-status-k">Heartbeat</span><span className="ad-status-v">🟢 Active</span></div>
            <div><span className="ad-status-k">Last Ping</span><span className="ad-status-v">{fmt(st.lastHeartbeat)}</span></div>
            <div><span className="ad-status-k">Memory</span><span className="ad-status-v">{st.memoryMB} MB</span></div>
            <div><span className="ad-status-k">Auto Shutdown</span><span className="ad-status-v">{fmt(st.autoOffAt)}</span></div>
          </div>
        )}
        <div className="ad-status-actions" style={{flexWrap:"wrap",gap:8,alignItems:"flex-end"}}>
          <label style={{display:"flex",flexDirection:"column",fontSize:11,color:"var(--text-2)",gap:3}}>
            {active?"Auto-off at (edit to reschedule)":"Auto-off at"}
            <input type="datetime-local" className="ad-input" style={{padding:"6px 8px",fontSize:13}}
              value={offTime} min={toLocalInput(new Date())}
              onChange={e=>setOffTime(e.target.value)} disabled={busy}/>
          </label>
          {active
            ? <>
                <button className="ad-btn ad-btn--sm ad-btn--outline" disabled={busy}
                  onClick={()=>toggle({on:true, autoOffAt:new Date(offTime).toISOString()})}>Update time</button>
                <button className="ad-btn ad-btn--sm ad-btn--outline" disabled={busy} onClick={()=>toggle({extend:true})}>Extend 2h</button>
                <button className="ad-btn ad-btn--sm ad-btn--danger" disabled={busy} onClick={()=>toggle({on:false})}>Disable</button>
              </>
            : <button className="ad-btn ad-btn--sm ad-btn--primary" disabled={busy}
                onClick={()=>toggle({on:true, autoOffAt:new Date(offTime).toISOString()})}>
                {busy?"…":"Enable"}
              </button>}
        </div>
      </div>
      {warn && (
        <div className="ad-overlay">
          <div className="ad-modal ad-modal--sm">
            <h3 className="ad-modal-title">Assessment Active Mode is still enabled</h3>
            <p style={{color:"var(--text-2)",fontSize:14,marginBottom:18}}>
              Keeping the server active overnight may consume resources unnecessarily. Do you want to keep Assessment Mode active?
              If you don't respond, it will turn off automatically.
            </p>
            <div style={{display:"flex",gap:10}}>
              <button className="ad-btn ad-btn--outline" style={{flex:1}} onClick={()=>toggle({on:false})}>Turn Off Now</button>
              <button className="ad-btn ad-btn--primary" style={{flex:1}} onClick={()=>toggle({extend:true})}>Keep Active 2 Hours</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* Workspace → Rounds → Drives.
 * Loads the rounds of the OPEN workspace and renders the existing DrivesTab
 * with them, so a round's drives appear under that round. Nothing about the
 * drive/assessment engine changes — only where the UI lives. */
function WorkspaceRoundDrives({ readOnly }) {
  // LEVEL 1: the round list.  LEVEL 2: one round — its cutoff/students and its
  // drives. A round OWNS both; a drive belongs to exactly one round.
  const [openRound,setOpenRound]=useState(null);
  const [sub,setSub]=useState("manage");

  if(!openRound) return <RoundsPage readOnly={readOnly} onOpenRound={(r)=>{setSub("manage");setOpenRound(r);}}/>;

  return (
    <div>
      <div className="ws-crumb">
        <button onClick={()=>setOpenRound(null)}>← Back to Rounds</button>
        <span>/</span>
        <span>Round {openRound.sequence} — {openRound.name}</span>
      </div>

      <div className="ws-sub-tabs">
        <button className={`ws-sub-tab ${sub==="manage"?"ws-sub-tab--active":""}`} onClick={()=>setSub("manage")}>
          🎯 Cutoff &amp; Students
        </button>
        <button className={`ws-sub-tab ${sub==="drives"?"ws-sub-tab--active":""}`} onClick={()=>setSub("drives")}>
          🎓 Drives
        </button>
      </div>

      {/* Cutoff, preview/apply, advance-to-next-round and this round's student
          list — scoped to THIS round only. Round 1's cutoff never touches
          Round 2, and progression stays gated by the backend. */}
      {sub==="manage" && (
        <RoundPanel round={openRound} readOnly={readOnly}
          onBack={()=>setOpenRound(null)} onChanged={()=>{}}/>
      )}

      {/* The ORIGINAL Campus Drives UI, locked to this round: create/edit,
          pre-registered upload + invitations, walk-in test codes, schedule,
          security configuration, export and archive — all unchanged. */}
      {sub==="drives" && (
        <div>
          <div className="ws-hint" style={{marginBottom:12}}>
            Drives belonging to <strong>{openRound.name}</strong> only. Creating a drive here
            attaches it to Round {openRound.sequence}.
          </div>
          <DrivesTab lockedRound={openRound.sequence} readOnly={readOnly}/>
        </div>
      )}
    </div>
  );
}

function Dashboard({ onLogout }) {
  // Theme is scoped to the admin dashboard only (applied to .ad-page, not the
  // document) so it never affects the candidate/walk-in pages.
  const [theme, setTheme] = useState(()=> localStorage.getItem("mh_theme") || "light");
  useEffect(()=>{ localStorage.setItem("mh_theme", theme); },[theme]);
  const toggleTheme=()=>setTheme(t=>t==="dark"?"light":"dark");

  // Landing screen is the GLOBAL OVERVIEW (Level 1) — workspace management only.
  const [tab,        setTab]       = useState("workspace");
  // Level detector. No workspace open = global level, where the recruitment
  // tabs below do not exist at all (they are not rendered, not merely hidden).
  const wsCtx = useWorkspace();
  const inWorkspace = !!wsCtx?.activeId;
  // Leaving a workspace always returns to the workspace-management screen.
  useEffect(()=>{ if(!inWorkspace) setTab("workspace"); },[inWorkspace]);
  const [stats,      setStats]     = useState(null);
  const [overview,   setOverview]  = useState(null);
  const [users,      setUsers]     = useState([]);
  const [userPag,    setUserPag]   = useState({});
  const [userPage,   setUserPage]  = useState(1);
  const [userSearch, setUserSearch]= useState("");
  const [userStatus, setUserStatus]= useState("");
  const [userMin,    setUserMin]   = useState("");
  const [attempts,   setAttempts]  = useState([]);
  const [attPag,     setAttPag]    = useState({});
  const [attPage,    setAttPage]   = useState(1);
  const [attSearch,  setAttSearch] = useState("");
  const [attStatus,  setAttStatus] = useState("");
  const [attPassed,  setAttPassed] = useState("");
  const [questions,  setQuestions] = useState([]);
  const [allSections,setAllSections]= useState([
    {name:"aptitude",displayName:"Aptitude",color:"#4F46E5"},
    {name:"logical",displayName:"Logical Reasoning",color:"#7C3AED"},
    {name:"english",displayName:"English",color:"#0891B2"},
  ]);
  const [qSection,   setQSection]  = useState("");
  const [qRound,     setQRound]    = useState("");
  const [qSet,       setQSet]      = useState("");
  const [showAddQ,   setShowAddQ]  = useState(false);
  const [editQ,      setEditQ]     = useState(null);
  const [qSaving,    setQSaving]   = useState(false);
  const [deleteTarget,setDeleteTarget]=useState(null);
  const [deleting,   setDeleting]  = useState(false);
  const [settings,   setSettings]  = useState({ timeLimitMinutes:40, passingScore:30, sections:[] });
  const [setMsg,     setSetMsg]    = useState("");
  const [setSaving,  setSetSaving] = useState(false);
  const [loading,    setLoading]   = useState(false);
  const [exporting,  setExporting] = useState(false);
  // New section form state
  const [newSec,     setNewSec]    = useState({ name:"", displayName:"", questionCount:20, color:"#4F46E5" });
  const [newSecErr,  setNewSecErr] = useState("");

  const loadStats = useCallback(async()=>{ try{const r=await fetchStats();setStats(r?.data?.data||r?.data||null);}catch{} },[]);
  const loadOverview = useCallback(async()=>{ try{const r=await fetchOverview();setOverview(r.data.data);}catch{} },[]);
  const loadSections = useCallback(async()=>{
    try{
      const r=await fetchSections();
      if(r.data.data?.length) setAllSections(r.data.data);
    }catch{}
  },[]);
  const loadUsers = useCallback(async()=>{
    setLoading(true);
    try{ const r=await fetchUsers({page:userPage,limit:15,search:userSearch,status:userStatus,minScore:userMin||undefined}); setUsers(r.data.data);setUserPag(r.data.pagination); }
    catch{}finally{setLoading(false);}
  },[userPage,userSearch,userStatus,userMin]);
  const loadAttempts = useCallback(async()=>{
    setLoading(true);
    try{ const r=await fetchAttempts({page:attPage,limit:15,search:attSearch,status:attStatus,passed:attPassed}); setAttempts(r.data.data);setAttPag(r.data.pagination); }
    catch{}finally{setLoading(false);}
  },[attPage,attSearch,attStatus,attPassed]);
  const loadQuestions = useCallback(async()=>{
    setLoading(true);
    try{ const r=await fetchQuestions({section:qSection||undefined, round:qRound||undefined, set:qSet||undefined});setQuestions(r.data.data); }
    catch{}finally{setLoading(false);}
  },[qSection,qRound,qSet]);
  const loadSettings = useCallback(async()=>{
    try{
      const r=await fetchSettings();
      setSettings(r.data.data);
      if(r.data.data?.sections?.length) setAllSections(r.data.data.sections);
    }catch{}
  },[]);

  useEffect(()=>{
    loadSections();
    if(tab==="students")  loadUsers();
    if(tab==="attempts")  loadAttempts();
    if(tab==="questions") { loadSections(); loadQuestions(); }
    if(tab==="ws-settings") loadSettings();
  },[tab]);
  useEffect(()=>{ if(tab==="students")  loadUsers(); },[userPage,userSearch,userStatus,userMin]);
  useEffect(()=>{ if(tab==="attempts")  loadAttempts(); },[attPage,attSearch,attStatus,attPassed]);
  useEffect(()=>{ if(tab==="questions") loadQuestions(); },[qSection,qRound,qSet]);

  const handleAddQ  = async(d)=>{ setQSaving(true);try{await addQuestion(d);await loadQuestions();setShowAddQ(false);}catch(e){alert(e.message);}finally{setQSaving(false);} };
  const handleEditQ = async(d)=>{ setQSaving(true);try{await updateQuestion(editQ._id,d);await loadQuestions();setEditQ(null);}catch(e){alert(e.message);}finally{setQSaving(false);} };
  const handleDelQ  = async(id)=>{ if(!window.confirm("Delete this question?")) return; try{await deleteQuestion(id);await loadQuestions();}catch(e){alert(e.message);} };
  const handleDelUser= async()=>{ setDeleting(true);try{await deleteUser(deleteTarget._id);setDeleteTarget(null);await loadUsers();await loadStats();}catch(e){alert(e.message);}finally{setDeleting(false);} };

  const handleSaveSettings = async()=>{
    setSetSaving(true);setSetMsg("");
    try{
      await updateSettings(settings);
      setSetMsg("✅ Settings saved and quiz cache refreshed!");
      if(settings.sections?.length) setAllSections(settings.sections);
    }
    catch(e){setSetMsg("❌ "+e.message);}
    finally{setSetSaving(false);}
  };

  const updateSection = (i,field,val)=>setSettings(s=>({...s,sections:s.sections.map((sec,idx)=>idx===i?{...sec,[field]:val}:sec)}));

  const addNewSection = () => {
    const name = newSec.name.trim().toLowerCase().replace(/\s+/g,"_");
    const displayName = newSec.displayName.trim();
    if(!name)        { setNewSecErr("Internal name is required."); return; }
    if(!displayName) { setNewSecErr("Display name is required."); return; }
    if(settings.sections?.some(s=>s.name===name)) { setNewSecErr("A section with this name already exists."); return; }
    setSettings(s=>({...s, sections:[...(s.sections||[]), { name, displayName, questionCount:Number(newSec.questionCount)||20, color:newSec.color||"#4F46E5" }]}));
    setNewSec({ name:"", displayName:"", questionCount:20, color:"#4F46E5" });
    setNewSecErr("");
  };

  const removeSection = (i) => {
    if(!window.confirm("Remove this section? Questions with this section will remain but section won't appear in quiz.")) return;
    setSettings(s=>({...s, sections:s.sections.filter((_,idx)=>idx!==i)}));
  };

  const exportUsers = async()=>{
    setExporting(true);
    try{
      const r=await fetchUsers({page:1,limit:9999,search:userSearch,status:userStatus,minScore:userMin||undefined});
      const ws=XLSX.utils.json_to_sheet(r.data.data.map(u=>({Name:u.name,Email:u.email,College:u.college,RollNo:u.rollNo,Phone:u.phone,Status:u.quizCompleted?"Completed":u.quizStarted?"In Progress":"Not Started",Score:u.score??"-",TotalMarks:u.totalMarks??"-",Registered:fmtDate(u.createdAt)})));
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Students");XLSX.writeFile(wb,"MHA_Students.xlsx");
    }catch(e){alert(e.message);}finally{setExporting(false);}
  };
  const exportAttempts = async()=>{
    setExporting(true);
    try{
      const r=await fetchAttempts({page:1,limit:9999,search:attSearch,status:attStatus,passed:attPassed});
      const ws=XLSX.utils.json_to_sheet(r.data.data.map(a=>({Name:a.name,Email:a.email,RollNo:a.rollNo,Score:a.score,TotalMarks:a.totalMarks,Passed:a.passed?"Yes":"No",Status:a.status,TimeTaken:fmtSecs(a.timeTakenSeconds),Malpractice:a.malpracticeCount,Completed:fmtDate(a.completedAt)})));
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Attempts");XLSX.writeFile(wb,"MHA_Attempts.xlsx");
    }catch(e){alert(e.message);}finally{setExporting(false);}
  };

  return (
    <div className="ad-page" data-theme={theme}>
      <header className="ad-topbar">
        <div className="ad-topbar-left">
          <div className="ad-topbar-logo"><img src="/logo.png" alt="M H Foundation" style={{width:"100%",height:"100%",objectFit:"contain",borderRadius:"inherit"}} onError={e=>{e.currentTarget.parentNode.textContent="M";}}/></div>
          <div>
            <div className="ad-topbar-title">M H FOUNDATION</div>
            <div className="ad-topbar-sub">{isViewer()?"Viewer (read-only) · M H Foundation®":"Admin Dashboard · M H Foundation®"}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <WorkspaceSwitcherSlot readOnly={isViewer()}/>
          <button className="ad-theme-toggle" onClick={toggleTheme} title={theme==="dark"?"Switch to light mode":"Switch to dark mode"} aria-label="Toggle theme">
            <span className="ad-theme-knob">{theme==="dark"?"🌙":"☀️"}</span>
          </button>
          <button className="ad-btn ad-btn--outline ad-btn--logout" onClick={onLogout}>Sign Out</button>
        </div>
      </header>

      {!isViewer() && <div style={{padding:"0 0"}}><ActiveModeBanner/></div>}

      {/* GLOBAL LEVEL has no recruitment navigation — the tab bar exists only
          once a workspace is open. */}
      {inWorkspace && (
        <nav className="ad-tabs">
          {TABS.filter(t=>!isViewer() || !["questions","cutoff","settings"].includes(t.id)).map(t=>(
            <button key={t.id} className={`ad-tab ${tab===t.id?"ad-tab--active":""}`} onClick={()=>setTab(t.id)}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="ad-content">


        {/* Global overview (no workspace open) and every workspace section are
            rendered by the same module — the section decides which screen. */}
        {WS_SECTION[tab] && WS_SECTION[tab] !== "rounds" &&
          <WorkspaceModule readOnly={isViewer()} section={WS_SECTION[tab]}/>}

        {/* ROUNDS → DRIVES. The workspace's rounds drive the tabs; each round
            holds its own drives. This is the ORIGINAL Campus Drives UI (create,
            edit, upload candidates, invitations, walk-in test codes, security
            config, export, archive) reused unchanged inside the round. */}
        {WS_SECTION[tab] === "rounds" && (inWorkspace
          ? <WorkspaceRoundDrives readOnly={isViewer()}/>
          : <WorkspaceModule readOnly={isViewer()} section="rounds"/>)}

        {tab==="students" && (
          <div>
            <div className="ad-section-head">
              <div className="ad-page-title">Students ({userPag.total||0})</div>
              <button className="ad-btn ad-btn--export" onClick={exportUsers} disabled={exporting}>
                {exporting?<><Spinner/>Exporting…</>:"⬇ Export Excel"}
              </button>
            </div>
            <div className="ad-toolbar">
              <input className="ad-search" placeholder="Search name, email, roll…" value={userSearch} onChange={e=>{setUserSearch(e.target.value);setUserPage(1);}}/>
              <select className="ad-select" value={userStatus} onChange={e=>{setUserStatus(e.target.value);setUserPage(1);}}>
                <option value="">All Status</option><option value="completed">Completed</option>
                <option value="started">In Progress</option><option value="notStarted">Not Started</option>
              </select>
              <input type="number" className="ad-search" placeholder="Min score" value={userMin} style={{width:110}} onChange={e=>{setUserMin(e.target.value);setUserPage(1);}}/>
            </div>
            <div className="ad-table-wrap">
              {loading?<div className="ad-loading"><Spinner dark/>Loading…</div>
              :users.length===0?<div className="ad-empty">No students found.</div>
              :<table className="ad-table">
                <thead><tr><th>#</th><th>Name</th><th>Email</th><th>College</th><th>Roll No</th><th>Status</th><th>Score</th><th>Registered</th><th></th></tr></thead>
                <tbody>{users.map((u,i)=>(
                  <tr key={u._id}>
                    <td className="ad-td-num">{(userPage-1)*15+i+1}</td>
                    <td><div className="ad-td-name"><div className="ad-avatar">{u.name.charAt(0)}</div>{u.name}</div></td>
                    <td className="ad-td-sm">{u.email}</td>
                    <td className="ad-td-sm">{u.college}</td>
                    <td><span className="ad-mono">{u.rollNo}</span></td>
                    <td><span className={`ad-badge ${u.quizCompleted?"ad-badge--green":u.quizStarted?"ad-badge--amber":"ad-badge--gray"}`}>{u.quizCompleted?"Completed":u.quizStarted?"In Progress":"Not Started"}</span></td>
                    <td>{u.score!=null?<strong>{u.score}/{u.totalMarks}</strong>:"—"}</td>
                    <td className="ad-td-sm">{fmtDate(u.createdAt)}</td>
                    <td><button className="ad-btn ad-btn--sm ad-btn--danger" onClick={()=>setDeleteTarget(u)}>Delete</button></td>
                  </tr>
                ))}</tbody>
              </table>}
            </div>
            <Pagination pag={userPag} page={userPage} setPage={setUserPage}/>
          </div>
        )}

        {tab==="attempts" && (
          <div>
            <div className="ad-section-head">
              <div className="ad-page-title">Quiz Attempts ({attPag.total||0})</div>
              <button className="ad-btn ad-btn--export" onClick={exportAttempts} disabled={exporting}>
                {exporting?<><Spinner/>Exporting…</>:"⬇ Export Excel"}
              </button>
            </div>
            <div className="ad-toolbar">
              <input className="ad-search" placeholder="Search name, email, roll…" value={attSearch} onChange={e=>{setAttSearch(e.target.value);setAttPage(1);}}/>
              <select className="ad-select" value={attStatus} onChange={e=>{setAttStatus(e.target.value);setAttPage(1);}}>
                <option value="">All Status</option><option value="completed">Completed</option>
                <option value="in-progress">In Progress</option><option value="timed-out">Timed Out</option>
                <option value="auto-submitted">Auto Submitted</option>
              </select>
              <select className="ad-select" value={attPassed} onChange={e=>{setAttPassed(e.target.value);setAttPage(1);}}>
                <option value="">All Results</option><option value="true">Passed</option><option value="false">Not Passed</option>
              </select>
            </div>
            <div className="ad-table-wrap">
              {loading?<div className="ad-loading"><Spinner dark/>Loading…</div>
              :attempts.length===0?<div className="ad-empty">No attempts found.</div>
              :<table className="ad-table">
                <thead><tr><th>#</th><th>Name</th><th>Roll No</th><th>Score</th><th>Result</th><th>Status</th><th>Violations</th><th>Time</th><th>Date</th></tr></thead>
                <tbody>{attempts.map((a,i)=>(
                  <tr key={a._id}>
                    <td className="ad-td-num">{(attPage-1)*15+i+1}</td>
                    <td><div className="ad-td-name"><div className="ad-avatar">{a.name?.charAt(0)||"?"}</div>{a.name}</div></td>
                    <td><span className="ad-mono">{a.rollNo}</span></td>
                    <td><strong>{a.score}/{a.totalMarks}</strong></td>
                    <td><span className={`ad-badge ${a.passed?"ad-badge--green":"ad-badge--amber"}`}>{a.passed?"Passed":"Not Passed"}</span></td>
                    <td><span className={`ad-badge ${a.status==="completed"?"ad-badge--green":a.status==="in-progress"?"ad-badge--blue":"ad-badge--gray"}`}>{a.status}</span></td>
                    <td><span className={`ad-badge ${(a.malpracticeCount||0)>=4?"ad-badge--red":(a.malpracticeCount||0)>0?"ad-badge--amber":"ad-badge--green"}`}>{a.malpracticeCount||0}/4</span></td>
                    <td>{fmtSecs(a.timeTakenSeconds)}</td>
                    <td className="ad-td-sm">{fmtDate(a.completedAt)}</td>
                  </tr>
                ))}</tbody>
              </table>}
            </div>
            <Pagination pag={attPag} page={attPage} setPage={setAttPage}/>
          </div>
        )}

        {tab==="questions" && (
          <div>
            <div className="ad-section-head">
              <div className="ad-page-title">Questions ({questions.length})</div>
              {!showAddQ&&!editQ&&<button className="ad-btn ad-btn--primary" onClick={()=>setShowAddQ(true)}>+ Add Question</button>}
            </div>
            <div className="ad-toolbar">
              <select className="ad-select" value={qRound} onChange={e=>{setQRound(e.target.value);setQSection("");if(e.target.value!=="2")setQSet("");}}>
                <option value="">All Rounds</option>
                <option value="1">Round 1 (Aptitude pool)</option>
                <option value="2">Round 2 (Technical)</option>
              </select>
              {qRound==="2" && (
                <select className="ad-select" value={qSet} onChange={e=>setQSet(e.target.value)}>
                  <option value="">All Versions / Sets</option>
                  <optgroup label="Version A (Aptitude)">
                    <option value="A">Set A</option>
                    <option value="B">Set B</option>
                  </optgroup>
                  <optgroup label="Version B (Advanced)">
                    <option value="C">Set C</option>
                    <option value="D">Set D</option>
                  </optgroup>
                  <optgroup label="Trainer (DS/DA)">
                    <option value="T">Set T</option>
                  </optgroup>
                </select>
              )}
              <select className="ad-select" value={qSection} onChange={e=>setQSection(e.target.value)}>
                <option value="">All Sections</option>
                {(qRound==="2"?TECH_SECTION_OPTS:allSections).map(s=><option key={s.name} value={s.name}>{s.displayName}</option>)}
              </select>
              <div className="ad-q-counts">
                {(qRound==="2"?TECH_SECTION_OPTS:allSections).map((s,i)=>(
                  <span key={s.name} className="ad-q-count-pill" style={{background:sectionColor(s,i)+"22",color:sectionColor(s,i),border:`1px solid ${sectionColor(s,i)}44`}}>
                    {s.displayName}: {questions.filter(q=>q.section===s.name).length}
                  </span>
                ))}
              </div>
            </div>
            {showAddQ&&<div style={{marginBottom:16}}><QuestionForm sections={allSections} onSave={handleAddQ} onCancel={()=>setShowAddQ(false)} saving={qSaving}/></div>}
            {questions.length===0&&!showAddQ&&<div className="ad-empty">No questions yet. Click "Add Question" to start.</div>}
            <div className="ad-q-list">
              {questions.map((q,i)=>(
                <div key={q._id}>
                  {editQ?._id===q._id
                    ?<div style={{marginBottom:12}}><QuestionForm sections={allSections} initial={q} onSave={handleEditQ} onCancel={()=>setEditQ(null)} saving={qSaving}/></div>
                    :<div className="ad-q-card">
                      <div className="ad-q-card-head">
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",flex:1}}>
                          <span className="ad-q-num">Q{i+1}</span>
                          {(() => {
                            const si = allSections.findIndex(s=>s.name===q.section);
                            const clr = sectionColor(allSections[si]||{},si);
                            // Round-2 sections aren't in the round-1 pool, so fall back to
                            // the tech/trainer section labels before showing the raw key.
                            const lbl = allSections.find(s=>s.name===q.section)?.displayName
                                     || TECH_SECTION_OPTS.find(s=>s.name===q.section)?.displayName
                                     || q.section;
                            return <span className="ad-q-sec-pill" style={{background:clr+"22",color:clr}}>{lbl}</span>;
                          })()}
                          <span className="ad-q-marks">{q.marks}M</span>
                          <span className="ad-q-text">{q.text}</span>
                        </div>
                        <div style={{display:"flex",gap:6,flexShrink:0}}>
                          <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={()=>setEditQ(q)}>Edit</button>
                          <button className="ad-btn ad-btn--sm ad-btn--danger"  onClick={()=>handleDelQ(q._id)}>Delete</button>
                        </div>
                      </div>
                      {q.type==="text" ? (
                        <div className="ad-q-opts">
                          <div className="ad-q-opt ad-q-opt--correct" style={{whiteSpace:"pre-wrap"}}>{q.longAnswer?"📝 Rubric: ":"✓ Answer: "}{q.answerText}</div>
                          <div className="ad-q-opt" style={{opacity:.7}}>{q.longAnswer?"Open-ended — marked by hand":"Typed-answer question"}{q.round===2&&q.set?` · Round 2 · Set ${q.set}`:""}</div>
                        </div>
                      ) : (
                        <div className="ad-q-opts">
                          {(q.options||[]).map((o,oi)=>(
                            <div key={oi} className={`ad-q-opt ${oi===q.correctIndex?"ad-q-opt--correct":""}`}>
                              {oi===q.correctIndex?"✓ ":""}{o}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  }
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==="cutoff" && <CutoffTab/>}

        {/* Quiz configuration (time limit, passing score, sections) lives under
            the workspace Settings tab so nothing became unreachable. */}
        {tab==="ws-settings" && (
          <div className="ad-settings-wrap">
            <div className="ad-settings-card">
              <div className="ad-page-title">Quiz Settings</div>
              <div className="ad-settings-grid">
                <div className="ad-field">
                  <label className="ad-label">Time Limit (minutes)</label>
                  <input type="number" className="ad-input" value={settings.timeLimitMinutes||40} min={1} max={300}
                    onChange={e=>setSettings(s=>({...s,timeLimitMinutes:parseInt(e.target.value)}))}/>
                  <span className="ad-hint">Quiz auto-submits when time expires (server enforced)</span>
                </div>
                <div className="ad-field">
                  <label className="ad-label">Passing Score — Internal Only</label>
                  <input type="number" className="ad-input" value={settings.passingScore||30} min={1}
                    onChange={e=>setSettings(s=>({...s,passingScore:parseInt(e.target.value)}))}/>
                  <span className="ad-hint">Used for admin reports only. Not displayed to students.</span>
                </div>
              </div>

              {/* Section Manager */}
              <div className="ad-settings-section-head">
                <div className="ad-label" style={{fontSize:13}}>Section Manager</div>
                <span className="ad-hint">Add, edit, or remove quiz sections. Click Save Settings to apply.</span>
              </div>
              {(settings.sections||[]).map((sec,i)=>(
                <div key={i} className="ad-sec-row">
                  <div className="ad-sec-color-dot" style={{background:sec.color||"#4F46E5"}}/>
                  <div className="ad-field" style={{flex:1,minWidth:120}}>
                    <label className="ad-label">Display Name</label>
                    <input className="ad-input" value={sec.displayName} onChange={e=>updateSection(i,"displayName",e.target.value)}/>
                  </div>
                  <div className="ad-field" style={{flex:1,minWidth:120}}>
                    <label className="ad-label">Internal Key</label>
                    <input className="ad-input" value={sec.name} readOnly style={{background:"var(--surface-2)",color:"var(--text-3)",cursor:"not-allowed"}}/>
                  </div>
                  <div className="ad-field" style={{width:120}}>
                    <label className="ad-label">No. of Questions</label>
                    <input type="number" className="ad-input" value={sec.questionCount} min={1}
                      onChange={e=>updateSection(i,"questionCount",parseInt(e.target.value))}/>
                  </div>
                  <div className="ad-field" style={{width:60}}>
                    <label className="ad-label">Color</label>
                    <input type="color" className="ad-input" value={sec.color||"#4F46E5"} style={{height:42,padding:2,cursor:"pointer"}}
                      onChange={e=>updateSection(i,"color",e.target.value)}/>
                  </div>
                  <button className="ad-btn ad-btn--sm ad-btn--danger" style={{alignSelf:"flex-end"}} onClick={()=>removeSection(i)}>✕ Remove</button>
                </div>
              ))}

              {/* Add new section */}
              <div className="ad-new-sec-box">
                <div className="ad-label" style={{marginBottom:10}}>+ Add New Section</div>
                <div className="ad-sec-row" style={{background:"var(--surface-2)",borderRadius:10,padding:14}}>
                  <div className="ad-field" style={{flex:1}}>
                    <label className="ad-label">Display Name</label>
                    <input className="ad-input" placeholder="e.g. General Knowledge" value={newSec.displayName}
                      onChange={e=>setNewSec(s=>({...s,displayName:e.target.value}))}/>
                  </div>
                  <div className="ad-field" style={{flex:1}}>
                    <label className="ad-label">Internal Key (auto from name)</label>
                    <input className="ad-input" placeholder="e.g. general_knowledge" value={newSec.name}
                      onChange={e=>setNewSec(s=>({...s,name:e.target.value}))}/>
                  </div>
                  <div className="ad-field" style={{width:120}}>
                    <label className="ad-label">Questions Count</label>
                    <input type="number" className="ad-input" value={newSec.questionCount} min={1}
                      onChange={e=>setNewSec(s=>({...s,questionCount:e.target.value}))}/>
                  </div>
                  <div className="ad-field" style={{width:60}}>
                    <label className="ad-label">Color</label>
                    <input type="color" className="ad-input" value={newSec.color} style={{height:42,padding:2,cursor:"pointer"}}
                      onChange={e=>setNewSec(s=>({...s,color:e.target.value}))}/>
                  </div>
                  <button className="ad-btn ad-btn--primary" style={{alignSelf:"flex-end"}} onClick={addNewSection}>
                    + Add Section
                  </button>
                </div>
                {newSecErr && <p className="ad-form-err" style={{marginTop:6}}>{newSecErr}</p>}
              </div>

              {setMsg && <p style={{fontSize:13,color:setMsg.startsWith("✅")?"#059669":"#DC2626",marginBottom:12,fontWeight:600,marginTop:12}}>{setMsg}</p>}
              <button className="ad-btn ad-btn--primary" style={{width:"auto",paddingInline:32}} onClick={handleSaveSettings} disabled={setSaving}>
                {setSaving?<><Spinner/>Saving…</>:"Save Settings"}
              </button>
            </div>
          </div>
        )}

      </main>

      {deleteTarget && (
        <ConfirmModal
          title="Delete Student?"
          message={`Permanently delete "${deleteTarget.name}" and all their quiz data? This cannot be undone.`}
          onConfirm={handleDelUser} onCancel={()=>setDeleteTarget(null)} loading={deleting}
        />
      )}
    </div>
  );
}

export default function AdminDashboard({ mode = "admin" }) {
  // The URL decides which dashboard this is (admin vs viewer). A cached session for
  // the OTHER role must NOT carry over — e.g. opening the admin URL while logged in
  // as viewer should require an admin login, not silently show the viewer dashboard.
  const [loggedIn,setLoggedIn] = useState(()=>{
    const hasToken = !!localStorage.getItem("adminToken");
    const role = localStorage.getItem("adminRole") || "admin";
    if (hasToken && role !== mode) { clearAdminToken(); return false; } // wrong role for this URL → re-login
    return hasToken;
  });
  if(!loggedIn) return <LoginScreen mode={mode} onLogin={()=>setLoggedIn(true)}/>;
  // The provider must sit ABOVE Dashboard: Dashboard itself calls useWorkspace()
  // to decide whether to show the workspace navigation, and a component can only
  // read a context supplied by an ancestor.
  return (
    <WorkspaceProvider>
      <Dashboard onLogout={()=>{ clearAdminToken(); setLoggedIn(false); }}/>
    </WorkspaceProvider>
  );
}
