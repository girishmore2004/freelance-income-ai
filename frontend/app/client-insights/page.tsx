'use client';
import {useEffect,useState} from 'react';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000';
type Client={id:string;name:string;company?:string};
type Data=Record<string,any>;
export default function ClientInsightsPage(){
 const [token,setToken]=useState(''),[clients,setClients]=useState<Client[]>([]),[clientId,setClientId]=useState('');
 const [insights,setInsights]=useState<Data|null>(null),[profit,setProfit]=useState<Data|null>(null),[costs,setCosts]=useState<Data[]>([]);
 const [form,setForm]=useState({project_id:'',category:'software',description:'',amount:'',currency:'INR',cost_date:new Date().toISOString().slice(0,10),evidence_reference:''});
 const [projects,setProjects]=useState<Data[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function req(path:string,method='GET',body?:Data){const r=await fetch(API+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({detail:'Invalid response'}));if(!r.ok)throw new Error(j.detail||'Request failed');return j}
 async function loadClients(){const [c,p]=await Promise.all([req('/api/v1/clients'),req('/api/v1/projects')]);setClients(c);setProjects(p);if(!clientId&&c.length)setClientId(c[0].id)}
 async function loadClient(id:string){if(!id)return;setBusy(true);setError('');try{const [i,p,c]=await Promise.all([req(`/api/v1/clients/${id}/insights`),req(`/api/v1/clients/${id}/profitability`),req(`/api/v1/clients/${id}/costs`)]);setInsights(i);setProfit(p);setCosts(c)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{setToken(localStorage.getItem('fia_token')||'')},[]);
 useEffect(()=>{if(token)loadClients().catch(e=>setError(e.message))},[token]);
 useEffect(()=>{if(token&&clientId)loadClient(clientId)},[token,clientId]);
 async function saveCost(){setBusy(true);setError('');setMessage('');try{await req(`/api/v1/clients/${clientId}/costs`,'POST',{...form,amount:Number(form.amount),project_id:form.project_id||null});setMessage('Direct cost saved. Refreshing client profitability.');setForm(v=>({...v,description:'',amount:'',evidence_reference:''}));await loadClient(clientId)}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 if(!token)return <main style={{padding:30}}>Sign in to Freelance Income AI to view client insights.</main>;
 const selected=clients.find(c=>c.id===clientId);
 const money=(v:any)=>Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
 return <main style={{maxWidth:1150,margin:'24px auto',padding:20,fontFamily:'sans-serif'}}>
  <a href="/clients">← Back to Clients</a><h1>Client Profitability & Health</h1>
  <p>Explainable business metrics from your recorded invoices, payment evidence, time entries, costs and communication logs. This is not a credit score or accounting statement.</p>
  {error&&<p role="alert" style={{color:'crimson'}}>{error}</p>}{message&&<p role="status">{message}</p>}
  <label>Client<select value={clientId} onChange={e=>setClientId(e.target.value)} style={{display:'block',padding:10,width:'100%',marginTop:6}}><option value="">Select client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.company?` · ${c.company}`:''}</option>)}</select></label>
  {selected&&<h2>{selected.name} {selected.company?`· ${selected.company}`:''}</h2>}
  {busy&&<p>Loading client data…</p>}
  {insights&&<section style={{border:'1px solid #ddd',borderRadius:12,padding:16,marginTop:16}}>
   <h2>Relationship health</h2><div style={{fontSize:34,fontWeight:700}}>{insights.health.score}/100 · {insights.health.label.replaceAll('_',' ')}</div>
   <p>{insights.health.warning}</p><ul>{insights.health.factors.map((f:Data,i:number)=><li key={i}>{f.reason}</li>)}</ul>
   <p>Average recorded payment delay: {insights.payment_behavior.average_days_late===null?'Not enough payment timing data':`${insights.payment_behavior.average_days_late} days`}</p>
   <p>Last recorded contact: {insights.relationship.last_recorded_contact||'No communication record'}</p>
   <p>Open balances: {insights.payment_behavior.open_balances.length}</p>
  </section>}
  {profit&&<section style={{marginTop:16}}>
   <h2>Profitability by currency</h2><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
   {Object.entries(profit.by_currency||{}).map(([cur,v]:[string,any])=><article key={cur} style={{border:'1px solid #ddd',borderRadius:12,padding:14}}>
    <h3>{cur}</h3><p>Invoiced: {money(v.invoiced)}</p><p>Net received: {money(v.net_received)}</p><p>Outstanding: {money(v.outstanding)}</p><p>Labor cost estimate: {money(v.labor_cost_estimate)}</p><p>Direct costs: {money(v.direct_costs)}</p><p>Total recorded cost: {money(v.total_recorded_cost)}</p><b>Cash contribution estimate: {money(v.cash_contribution_estimate)}</b><p>Cash margin: {v.cash_margin_percent===null?'N/A':`${v.cash_margin_percent}%`}</p>
   </article>)}
   </div><p>Projects: {profit.project_count} · Hours: {profit.hours_recorded} · Cost entries: {profit.direct_cost_entries}</p>
   <details><summary>Calculation limitations</summary><ul>{profit.limitations.map((x:string,i:number)=><li key={i}>{x}</li>)}</ul></details>
  </section>}
  <section style={{border:'1px solid #ddd',borderRadius:12,padding:16,marginTop:18}}>
   <h2>Record a direct client cost</h2><p>Enter software, subcontractor, equipment or other project costs with supporting evidence.</p>
   <div style={{display:'grid',gap:9}}>
    <label>Linked project<select value={form.project_id} onChange={e=>setForm(v=>({...v,project_id:e.target.value}))} style={{display:'block',width:'100%',padding:9}}><option value="">Client-level cost</option>{projects.filter(p=>p.client_id===clientId).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    <label>Category<select value={form.category} onChange={e=>setForm(v=>({...v,category:e.target.value}))} style={{display:'block',width:'100%',padding:9}}>{['software','subcontractor','equipment','travel','platform_fee','other'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Description<input value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} style={{display:'block',width:'100%',padding:9}}/></label>
    <label>Amount<input type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>setForm(v=>({...v,amount:e.target.value}))} style={{display:'block',width:'100%',padding:9}}/></label>
    <label>Currency<input value={form.currency} onChange={e=>setForm(v=>({...v,currency:e.target.value.toUpperCase()}))} maxLength={8} style={{display:'block',width:'100%',padding:9}}/></label>
    <label>Cost date<input type="date" value={form.cost_date} onChange={e=>setForm(v=>({...v,cost_date:e.target.value}))} style={{display:'block',width:'100%',padding:9}}/></label>
    <label>Evidence reference<input value={form.evidence_reference} onChange={e=>setForm(v=>({...v,evidence_reference:e.target.value}))} style={{display:'block',width:'100%',padding:9}}/></label>
    <button disabled={busy||!clientId||form.description.trim().length<2||Number(form.amount)<=0} onClick={saveCost}>Save cost record</button>
   </div>
  </section>
  <section style={{marginTop:18}}><h2>Recorded direct costs</h2>{costs.map(c=><p key={c.id}>{c.cost_date} · {c.category} · {c.description} · {c.currency} {money(c.amount)} {c.evidence_reference?`· Evidence: ${c.evidence_reference}`:''}</p>)}{!costs.length&&<p>No direct cost entries recorded.</p>}</section>
 </main>;
}
