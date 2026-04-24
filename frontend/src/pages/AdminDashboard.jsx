import React, { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  adminLogin, clearAdminToken, fetchStats, fetchUsers, fetchAttempts,
  fetchSettings, updateSettings, fetchQuestions, addQuestion, updateQuestion,
  deleteQuestion, deleteUser, fetchCutoff, fetchSections
} from "../utils/api";
import "./AdminDashboard.css";

const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—";
const fmtSecs = s => { if(s==null) return "—"; const m=Math.floor(s/60); return `${m}m ${s%60}s`; };

// Generate a color from a section name (for sections without defined color)
const PALETTE = ["#4F46E5","#7C3AED","#0891B2","#059669","#D97706","#DC2626","#0D9488","#7C3AED","#BE185D","#1D4ED8"];
function sectionColor(sec, idx) {
  return sec.color || PALETTE[idx % PALETTE.length];
}

const Spinner = ({dark}) => <span className={dark?"ad-spin-dark":"ad-spin"}/>;

// ── Question Form ─────────────────────────────────────────────────────────────
function QuestionForm({ initial, onSave, onCancel, saving, sections }) {
  const [text,   setText]   = useState(initial?.text||"");
  const [opts,   setOpts]   = useState(initial?.options||["","","",""]);
  const [correct,setCorrect]= useState(initial?.correctIndex??0);
  const [marks,  setMarks]  = useState(initial?.marks||1);
  const [section,setSection]= useState(initial?.section||(sections[0]?.name||"aptitude"));
  const [err,    setErr]    = useState("");

  const save = () => {
    if(!text.trim())          { setErr("Question text is required."); return; }
    if(opts.some(o=>!o.trim())){ setErr("All 4 options are required."); return; }
    if(!section)               { setErr("Please select a section."); return; }
    onSave({ text:text.trim(), options:opts.map(o=>o.trim()), correctIndex:correct, marks:Number(marks), section });
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
          <label className="ad-label">Section</label>
          <select className="ad-input ad-select" value={section} onChange={e=>setSection(e.target.value)}>
            {sections.map(s=>(
              <option key={s.name} value={s.name}>{s.displayName}</option>
            ))}
          </select>
          <label className="ad-label" style={{marginTop:6}}>Marks</label>
          <input type="number" className="ad-input" value={marks} min={1}
            onChange={e=>setMarks(e.target.value)} style={{height:38}}/>
        </div>
      </div>
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
function ConfirmModal({ title, message, onConfirm, onCancel, loading }) {
  return (
    <div className="ad-overlay" onClick={onCancel}>
      <div className="ad-modal ad-modal--sm" onClick={e=>e.stopPropagation()}>
        <h3 className="ad-modal-title">{title}</h3>
        <p style={{color:"var(--text-2)",fontSize:14,marginBottom:20}}>{message}</p>
        <div style={{display:"flex",gap:10}}>
          <button className="ad-btn ad-btn--outline" style={{flex:1}} onClick={onCancel}>Cancel</button>
          <button className="ad-btn ad-btn--danger"  style={{flex:1}} onClick={onConfirm} disabled={loading}>
            {loading?<><Spinner/>Deleting…</>:"Delete"}
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
                  Internal key: <code style={{background:"#F1F0FA",padding:"1px 5px",borderRadius:3}}>{sec.name}</code>
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
function LoginScreen({ onLogin }) {
  const [user,setUser]= useState("");
  const [pass,setPass]= useState("");
  const [err, setErr] = useState("");
  const [loading,setLoading]= useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const res = await adminLogin({ username:user, password:pass });
      sessionStorage.setItem("adminToken", res.data.token);
      onLogin();
    } catch(er) { setErr(er.message||"Invalid credentials"); }
    finally { setLoading(false); }
  };
  return (
    <div className="ad-login-page">
      <div className="ad-login-card">
        <div className="ad-login-logo">M</div>
        <div className="ad-login-brand">Mandi Hariyanna Academy</div>
        <div className="ad-login-sub">Mandi Harish Foundation® · Admin Portal</div>
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
  const [exporting, setExporting] = useState(false);
  const [page,      setPage]      = useState(1);
  const [err,       setErr]       = useState("");

  const loadPreview = async (pg=1) => {
    const c = parseInt(cutoff);
    if (isNaN(c)||c<0) { setErr("Please enter a valid cutoff score."); return; }
    setErr(""); setLoading(true);
    try {
      const res = await fetchCutoff({ cutoff:c, page:pg, limit:50 });
      setPreview(res.data.data); setPage(pg);
    } catch(e) { setErr(e.message||"Failed to load."); }
    finally { setLoading(false); }
  };

  const handleExport = async () => {
    setExporting(true); setConfirming(false);
    try {
      const res = await fetchCutoff({ cutoff:parseInt(cutoff), page:1, limit:5000 });
      const rows = res.data.data.users;
      const ws = XLSX.utils.json_to_sheet(rows.map((u,i)=>({
        "#":i+1, Name:u.name, Email:u.email, College:u.college,
        "Roll No":u.rollNo, Phone:u.phone, Score:u.score, "Total Marks":u.totalMarks,
        Registered:fmtDate(u.createdAt),
      })));
      ws["!cols"]=[6,22,28,22,14,14,8,12,14].map(w=>({wch:w}));
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
            <button className="ad-btn ad-btn--primary" onClick={()=>loadPreview(1)} disabled={loading||!cutoff}>
              {loading?<><Spinner/>Loading…</>:"Preview Results"}
            </button>
          </div>
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
                        <thead><tr><th>#</th><th>Name</th><th>Roll No</th><th>College</th><th>Score</th><th>Total</th></tr></thead>
                        <tbody>{preview.users.map((u,i)=>(
                          <tr key={u._id}>
                            <td className="ad-td-num">{(page-1)*50+i+1}</td>
                            <td><div className="ad-td-name"><div className="ad-avatar">{u.name.charAt(0)}</div>{u.name}</div></td>
                            <td><span className="ad-mono">{u.rollNo}</span></td>
                            <td className="ad-td-sm">{u.college}</td>
                            <td><strong style={{color:"#4F46E5",fontSize:15}}>{u.score}</strong></td>
                            <td className="ad-td-sm">{u.totalMarks}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <Pagination pag={{pages:preview.pages,total:preview.total,limit:50}} page={page} setPage={pg=>loadPreview(pg)}/>
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

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id:"dashboard", icon:"📊", label:"Dashboard"  },
  { id:"students",  icon:"👥", label:"Students"   },
  { id:"attempts",  icon:"📋", label:"Attempts"   },
  { id:"questions", icon:"❓", label:"Questions"  },
  { id:"cutoff",    icon:"🎯", label:"Cutoff"     },
  { id:"settings",  icon:"⚙️",  label:"Settings"   },
];

// ── Main Dashboard ─────────────────────────────────────────────────────────────
function Dashboard({ onLogout }) {
  const [tab,        setTab]       = useState("dashboard");
  const [stats,      setStats]     = useState(null);
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
    try{ const r=await fetchQuestions({section:qSection||undefined});setQuestions(r.data.data); }
    catch{}finally{setLoading(false);}
  },[qSection]);
  const loadSettings = useCallback(async()=>{
    try{
      const r=await fetchSettings();
      setSettings(r.data.data);
      if(r.data.data?.sections?.length) setAllSections(r.data.data.sections);
    }catch{}
  },[]);

  useEffect(()=>{
    loadSections();
    if(tab==="dashboard") loadStats();
    if(tab==="students")  loadUsers();
    if(tab==="attempts")  loadAttempts();
    if(tab==="questions") { loadSections(); loadQuestions(); }
    if(tab==="settings")  loadSettings();
  },[tab]);
  useEffect(()=>{ if(tab==="students")  loadUsers(); },[userPage,userSearch,userStatus,userMin]);
  useEffect(()=>{ if(tab==="attempts")  loadAttempts(); },[attPage,attSearch,attStatus,attPassed]);
  useEffect(()=>{ if(tab==="questions") loadQuestions(); },[qSection]);

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
    <div className="ad-page">
      <header className="ad-topbar">
        <div className="ad-topbar-left">
          <div className="ad-topbar-logo">M</div>
          <div>
            <div className="ad-topbar-title">Mandi Hariyanna Academy</div>
            <div className="ad-topbar-sub">Admin Dashboard · Mandi Harish Foundation®</div>
          </div>
        </div>
        <button className="ad-btn ad-btn--outline ad-btn--logout" onClick={onLogout}>Sign Out</button>
      </header>

      <nav className="ad-tabs">
        {TABS.map(t=>(
          <button key={t.id} className={`ad-tab ${tab===t.id?"ad-tab--active":""}`} onClick={()=>setTab(t.id)}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      <main className="ad-content">

        {tab==="dashboard" && (
          <div>
            <div className="ad-page-title">Dashboard Overview</div>
            {!stats && <div className="ad-loading"><Spinner dark/>Loading stats…</div>}
            {stats && (
              <div className="ad-stats-grid">
                {[
                  {label:"Total Registered",val:stats.total,      icon:"👥",color:"#4F46E5"},
                  {label:"Quiz Started",    val:stats.started,    icon:"▶️",  color:"#7C3AED"},
                  {label:"Completed",       val:stats.completed,  icon:"✅",color:"#059669"},
                  {label:"Passed",          val:stats.passed,     icon:"🏆",color:"#D97706"},
                  {label:"Not Started",     val:stats.notStarted, icon:"⏳",color:"#64748B"},
                  {label:"Avg Score",       val:stats.avgScore,   icon:"📈",color:"#0891B2"},
                ].map(s=>(
                  <div key={s.label} className="ad-stat-card" style={{borderTopColor:s.color}}>
                    <div className="ad-stat-icon">{s.icon}</div>
                    <div className="ad-stat-val" style={{color:s.color}}>{s.val}</div>
                    <div className="ad-stat-lbl">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
              <select className="ad-select" value={qSection} onChange={e=>setQSection(e.target.value)}>
                <option value="">All Sections</option>
                {allSections.map(s=><option key={s.name} value={s.name}>{s.displayName}</option>)}
              </select>
              <div className="ad-q-counts">
                {allSections.map((s,i)=>(
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
                            const lbl = allSections.find(s=>s.name===q.section)?.displayName||q.section;
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
                      <div className="ad-q-opts">
                        {(q.options||[]).map((o,oi)=>(
                          <div key={oi} className={`ad-q-opt ${oi===q.correctIndex?"ad-q-opt--correct":""}`}>
                            {oi===q.correctIndex?"✓ ":""}{o}
                          </div>
                        ))}
                      </div>
                    </div>
                  }
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==="cutoff" && <CutoffTab/>}

        {tab==="settings" && (
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
                    <input className="ad-input" value={sec.name} readOnly style={{background:"#F1F0FA",color:"#9490C0",cursor:"not-allowed"}}/>
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
                <div className="ad-sec-row" style={{background:"#F8F7FF",borderRadius:10,padding:14}}>
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

export default function AdminDashboard() {
  const [loggedIn,setLoggedIn] = useState(()=>!!sessionStorage.getItem("adminToken"));
  if(!loggedIn) return <LoginScreen onLogin={()=>setLoggedIn(true)}/>;
  return <Dashboard onLogout={()=>{ clearAdminToken(); setLoggedIn(false); }}/>;
}
