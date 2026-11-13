'use client';
import {useEffect,useMemo,useState} from 'react';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000';
type Action={priority:number;category:string;title:string;reason:string;evidence:{type:string;id:string};suggested_action:string;due_date:string|null;requires_human_approval:boolean};
type Plan={as_of_date:string;actions:Action[];total_actionable_records:number;returned_actions:number;policy:string};
const labels:Record<string,string>={finance:'Finance',delivery:'Delivery',approval:'Approvals',communication:'Communication',pipeline:'Pipeline'};
export default function AgentPlanPage(){
 const [token,setToken]=useState('');const [plan,setPlan]=useState<Plan|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [filter,setFilter]=useState('all');
 async function load(currentToken:string){
  setBusy(true);setError('');
  try{const r=await fetch(API+'/api/v1/agent/action-plan?limit=50',{headers:{Authorization:`Bearer ${currentToken}`}});
   const d=await r.json();if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Unable to load action plan');setPlan(d);
  }catch(e:unknown){setError(e instanceof Error?e.message:'Unable to load action plan');}
  finally{setBusy(false);}
 }
 useEffect(()=>{const saved=localStorage.getItem('fia_token')||'';setToken(saved);if(saved)void load(saved);},[]);
 const categories=useMemo(()=>Array.from(new Set((plan?.actions||[]).map(a=>a.category))),[plan]);
 const visible=(plan?.actions||[]).filter(a=>filter==='all'||a.category===filter);
 const counts=useMemo(()=>{const result:Record<string,number>={};for(const a of plan?.actions||[])result[a.category]=(result[a.category]||0)+1;return result;},[plan]);
 if(!token)return <main className="shell"><p>Sign in first to view your account action plan.</p><a href="/">Back to dashboard</a></main>;
 return <main className="shell">
  <header className="top"><div><div className="brand">AI Action Planner</div><div className="muted">A single prioritized queue across sales, approvals, delivery and cash flow</div></div><nav className="row"><a className="btn" href="/workspace">Workspace</a><a className="btn" href="/delivery">Delivery</a><a className="btn" href="/marketplaces">Marketplaces</a><a className="btn" href="/coach">AI Coach</a></nav></header>
  <section className="card"><div className="row" style={{justifyContent:'space-between',alignItems:'center'}}><div><h2>Recommended next actions</h2><p className="muted">As of {plan?.as_of_date||'—'} · {plan?.total_actionable_records??'—'} open action signals</p></div><button className="btn" disabled={busy} onClick={()=>void load(token)}>{busy?'Refreshing…':'Refresh'}</button></div>
   {error&&<p className="error" role="alert">{error}</p>}
   {plan&&<><div className="grid">{Object.entries(labels).map(([key,label])=><article className="card" key={key}><small className="muted">{label}</small><h2>{counts[key]||0}</h2></article>)}</div>
    <label>Filter actions<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All categories</option>{categories.map(c=><option value={c} key={c}>{labels[c]||c}</option>)}</select></label>
    {visible.length===0?<p className="muted">No actions in this category. This only reflects records currently saved in your account.</p>:visible.map((a,i)=><article className="item" key={`${a.evidence.type}:${a.evidence.id}`}><div className="row" style={{justifyContent:'space-between'}}><span className="muted">#{i+1} · Priority {a.priority} · {labels[a.category]||a.category}</span>{a.due_date&&<span className="muted">Due {a.due_date}</span>}</div><h3>{a.title}</h3><p>{a.reason}</p><p><b>Suggested next step:</b> {a.suggested_action}</p><small className="muted">Evidence: {a.evidence.type} · {a.evidence.id}</small><p><span className="muted">Human decision required · No action is executed automatically</span></p></article>)}
   </>}
  </section>
  <p className="muted">{plan?.policy||'Recommendations only. No messages, proposals, invoices or payments are executed.'}</p>
 </main>;
}
