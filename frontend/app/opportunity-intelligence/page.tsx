'use client';
import {useEffect,useMemo,useState} from 'react';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000';
type Item=Record<string,any>;
export default function OpportunityIntelligencePage(){
 const [token,setToken]=useState(''),[items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(false);
 const [minScore,setMinScore]=useState('0'),[age,setAge]=useState('30'),[decision,setDecision]=useState(''),[source,setSource]=useState('');
 const [selected,setSelected]=useState<Item|null>(null),[review,setReview]=useState({decision:'saved',notes:'',next_action_date:''});
 const [risk,setRisk]=useState<Item|null>(null),[proposal,setProposal]=useState<Item|null>(null),[proposalEvidence,setProposalEvidence]=useState<Item|null>(null),[price,setPrice]=useState('');
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 async function req(path:string,method='GET',body?:Item){const r=await fetch(API+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({detail:'Invalid response'}));if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:'Request failed');return j}
 async function load(){if(!token)return;setBusy(true);setError('');try{const q=new URLSearchParams({limit:'100',min_score:minScore});if(age)q.set('max_age_days',age);if(decision)q.set('decision',decision);if(source)q.set('source',source);const result=await req('/api/v1/opportunity-intelligence?'+q.toString());setItems(result.items||[]);if(selected){const found=(result.items||[]).find((x:Item)=>x.opportunity.id===selected.opportunity.id);if(found)setSelected(found)}}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{setToken(localStorage.getItem('fia_token')||'')},[]);
 useEffect(()=>{if(token)load()},[token,minScore,age,decision,source]);
 async function saveReview(item:Item){setBusy(true);setError('');try{await req(`/api/v1/opportunities/${item.opportunity.id}/review`,'POST',review);setMessage('Opportunity review saved.');await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function assess(item:Item){setBusy(true);setError('');setRisk(null);try{const result=await req('/api/v1/research/assess','POST',{opportunity_id:item.opportunity.id});setRisk(result);setMessage('Risk assessment created from listing text and available recorded evidence.')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function inspectProposalEvidence(item:Item){setBusy(true);setError('');setProposalEvidence(null);try{const result=await req(`/api/v1/proposals/intelligence/${item.opportunity.id}`);setProposalEvidence(result);setMessage('Portfolio evidence retrieved from your own uploaded documents.')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function generate(item:Item){setBusy(true);setError('');setProposal(null);try{const result=await req('/api/v1/proposals/generate','POST',{opportunity_id:item.opportunity.id,proposed_price:price?Number(price):null,currency:item.opportunity.currency||'INR'});setProposal(result);setMessage('Grounded proposal draft generated. Verify all source claims before requesting approval.')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 if(!token)return <main style={{padding:30}}>Sign in to Freelance Income AI to access Opportunity Intelligence.</main>;
 return <main style={{maxWidth:1250,margin:'24px auto',padding:20,fontFamily:'sans-serif'}}>
  <a href="/">← Dashboard</a><h1>Opportunity Intelligence</h1>
  <p>Rank opportunities using your current profile, freshness, recorded outcomes and evidence-weighted listing risk. Review client-risk signals before deciding. This does not scrape marketplaces or submit applications.</p>
  {error&&<p role="alert" style={{color:'crimson'}}>{error}</p>}{message&&<p role="status">{message}</p>}
  <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,border:'1px solid #ddd',padding:14,borderRadius:12}}>
   <label>Minimum match score<input type="number" min="0" max="100" value={minScore} onChange={e=>setMinScore(e.target.value)} style={{display:'block',width:'100%',padding:8}}/></label>
   <label>Maximum age (days)<input type="number" min="1" max="365" value={age} onChange={e=>setAge(e.target.value)} style={{display:'block',width:'100%',padding:8}}/></label>
   <label>Review state<select value={decision} onChange={e=>setDecision(e.target.value)} style={{display:'block',width:'100%',padding:8}}><option value="">All</option>{['unreviewed','saved','interested','proposal_ready','revisit','dismissed'].map(x=><option key={x}>{x}</option>)}</select></label>
   <label>Source<input value={source} onChange={e=>setSource(e.target.value)} placeholder="Any source" style={{display:'block',width:'100%',padding:8}}/></label>
  </section>
  <p>{items.length} opportunities · ranked using current profile and freshness</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(330px,1fr))',gap:12}}>
   {items.map((x:Item)=>{const o=x.opportunity;return <article key={o.id} style={{border:'1px solid #ddd',borderRadius:12,padding:14}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:8}}><b>{o.title}</b><strong>{x.ranking.rank_score}/100</strong></div>
    <p>{o.client_name} · {o.source} · {o.currency} {o.budget_min??'—'}–{o.budget_max??'—'}</p>
    <p>Profile match: {o.match_score}/100 · Review: {x.review.decision}</p>
    <p>Client risk: <strong>{x.client_risk?.risk_level||'insufficient_data'}</strong> · {x.client_risk?.risk_score??0}/100 · Evidence {x.client_risk?.evidence_coverage??0}%</p>
    <p>{(o.required_skills||[]).slice(0,8).join(', ')}</p>
    <p>{(x.explanation||[]).slice(0,3).map((v:string)=><span key={v}>• {v}<br/></span>)}</p>
    {x.profile_eligibility.manual_review_required&&<p style={{color:'#9a6700'}}>Manual review required: profile warning or dealbreaker detected.</p>}
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
     <button onClick={()=>{setSelected(x);setReview({decision:x.review.decision==='unreviewed'?'saved':x.review.decision,notes:x.review.notes||'',next_action_date:x.review.next_action_date||''});setRisk(null);setProposal(null);setProposalEvidence(null)}}>Review</button>
     {o.source_url&&<a href={o.source_url} target="_blank" rel="noreferrer">Open original listing ↗</a>}
    </div>
   </article>})}
  </div>
  {!items.length&&!busy&&<p>No opportunities match these filters. Add permitted RSS/JSON sources or import listings manually.</p>}
  {selected&&<section style={{marginTop:22,border:'1px solid #aaa',borderRadius:12,padding:16}}>
   <button onClick={()=>setSelected(null)}>Close review</button>
   <h2>{selected.opportunity.title}</h2><p>{selected.opportunity.description}</p>
   <h3>Match explanation</h3><ul>{selected.explanation.map((v:string,i:number)=><li key={i}>{v}</li>)}</ul>
   <details><summary>Scoring, risk signals and provenance</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({score:selected.opportunity.score_breakdown,ranking:selected.ranking,client_risk:selected.client_risk,provenance:selected.provenance},null,2)}</pre></details>
   <h3>Shortlist decision</h3>
   <label>Decision<select value={review.decision} onChange={e=>setReview(v=>({...v,decision:e.target.value}))} style={{display:'block',padding:8,width:'100%'}}>{['saved','interested','proposal_ready','revisit','dismissed'].map(x=><option key={x}>{x}</option>)}</select></label>
   <label>Notes<textarea value={review.notes} onChange={e=>setReview(v=>({...v,notes:e.target.value}))} style={{display:'block',padding:8,width:'100%',minHeight:70}}/></label>
   <label>Next action date<input type="date" value={review.next_action_date} onChange={e=>setReview(v=>({...v,next_action_date:e.target.value}))} style={{display:'block',padding:8}}/></label>
   <button disabled={busy} onClick={()=>saveReview(selected)}>Save review</button>
   <hr/><h3>Client-risk screening</h3><p>Rule-based signals only; not a background check or fraud finding.</p>
   <button disabled={busy} onClick={()=>assess(selected)}>Run risk assessment</button>
   {risk&&<div><b>Risk: {risk.risk_level} · {risk.risk_score}/100</b><p>Evidence coverage: {risk.evidence_coverage}%</p><ul>{risk.signals?.map((v:Item)=><li key={v.id}>{v.title}: {v.explanation}</li>)}</ul><small>{risk.limitations?.join(' ')}</small></div>}
   <hr/><h3>Portfolio evidence for this opportunity</h3><p>Inspect which of your uploaded case studies and portfolio documents are relevant before drafting.</p><button disabled={busy} onClick={()=>inspectProposalEvidence(selected)}>Find relevant portfolio evidence</button>{proposalEvidence&&<div><b>Evidence coverage: {proposalEvidence.coverage_level} ({proposalEvidence.evidence_count} sources)</b><p>Retrieval: {proposalEvidence.retrieval_mode} · Coverage score: {proposalEvidence.coverage_score}</p>{(proposalEvidence.evidence||[]).map((e:Item)=><article key={e.chunk_id} style={{border:'1px solid #ddd',padding:10,marginTop:8,borderRadius:8}}><small>Document {e.document_id} · Chunk {e.chunk_index} · Similarity {e.similarity}</small><p>{e.content}</p></article>)}<small>{(proposalEvidence.limitations||[]).join(' ')}</small></div>}
   <hr/><h3>Prepare proposal draft</h3><label>Proposed price (optional)<input type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} style={{display:'block',padding:8}}/></label>
   <button disabled={busy} onClick={()=>generate(selected)}>Generate proposal draft</button>
   {proposal&&<div><p>Draft created: {proposal.id}. Open Proposals to review, edit and request approval.</p>{proposal.grounding&&<><b>Grounding: {proposal.grounding.coverage_level} · {proposal.grounding.evidence_count} portfolio chunks</b><ul>{(proposal.grounding.evidence||[]).map((e:Item)=><li key={e.chunk_id}>Document {e.document_id}, chunk {e.chunk_index} · similarity {e.similarity}</li>)}</ul><small>{(proposal.grounding.limitations||[]).join(' ')}</small></>}{proposal.claim_review&&<section style={{marginTop:12,padding:12,border:'1px solid var(--border)',borderRadius:8}}><b>Factual claim review: {proposal.claim_review.status.replaceAll('_',' ')}</b><p>{proposal.claim_review.finding_count} claim pattern(s) flagged for manual verification.</p>{(proposal.claim_review.findings||[]).map((f:Item,i:number)=><p key={`${f.category}-${i}`}><b>{f.category}:</b> {f.claim}<br/><small>{f.reason}</small></p>)}<small>Automated overlap is not proof. Verify each statement against the original source before requesting approval or sending.</small></section>}{proposal.quality_review&&<section style={{marginTop:12,padding:12,border:"1px solid var(--border)",borderRadius:8}}><b>Proposal quality review: {proposal.quality_review.status.replaceAll("_"," ")} · {proposal.quality_review.score}/100</b><p>Basic deterministic checks only; this score is not an approval to send.</p><ul>{Object.entries(proposal.quality_review.checks||{}).map(([k,v])=><li key={k}>{String(v?"✓":"Needs attention")} · {k.replaceAll("_"," ")}</li>)}</ul>{(proposal.quality_review.flags||[]).map((f:Item,i:number)=><p key={`${f.code}-${i}`}><b>{f.severity}: {f.code.replaceAll("_"," ")}</b> — {f.message}</p>)}<small>{(proposal.quality_review.limitations||[]).join(" ")}</small></section>}<a href="/proposals">Open proposals →</a></div>}
  </section>}
 </main>;
}
