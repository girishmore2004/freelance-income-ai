'use client';
import {useEffect,useState} from 'react';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000';
type Item=Record<string,any>;
export default function MarketplacesPage(){
 const [token,setToken]=useState(''); const [providers,setProviders]=useState<Item[]>([]);
 const [apps,setApps]=useState<Item[]>([]); const [credentialStatus,setCredentialStatus]=useState<Item>({}); const [opportunities,setOpportunities]=useState<Item[]>([]);
 const [provider,setProvider]=useState('manual'); const [opportunity,setOpportunity]=useState('');
 const [proposal,setProposal]=useState(''); const [note,setNote]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
 const [searchTerm,setSearchTerm]=useState(''); const [savedSearches,setSavedSearches]=useState<Item[]>([]); const [savedTerm,setSavedTerm]=useState(''); const [savedInterval,setSavedInterval]=useState(24); const [searchResults,setSearchResults]=useState<Item[]>([]); const [nextCursor,setNextCursor]=useState<string|null>(null); const [searchTotal,setSearchTotal]=useState(0);
 async function req(path:string,method='GET',body?:Item){const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({detail:'Invalid response'}));if(!r.ok)throw new Error(j.detail||'Request failed');return j}
 async function load(){if(!token)return;const [p,a,o,c,ss]=await Promise.all([req('/api/v1/marketplaces'),req('/api/v1/marketplace-applications'),req('/api/v1/opportunities'),req('/api/v1/marketplaces/upwork/credential-status').catch(()=>({credential_status:'unknown'})),req('/api/v1/marketplaces/saved-searches').catch(()=>[])]);setProviders(p);setApps(a);setOpportunities(o);setCredentialStatus(c);setSavedSearches(ss)}
 useEffect(()=>{const t=localStorage.getItem('fia_token')||'';setToken(t)},[]);
 useEffect(()=>{if(token)load().catch(e=>setMessage(e.message))},[token]);
 async function run(fn:()=>Promise<any>){setBusy(true);setMessage('');try{await fn();await load();setMessage('Saved. No external marketplace action was performed.')}catch(e:any){setMessage(e.message)}finally{setBusy(false)}}
 async function create(){await run(async()=>{await req('/api/v1/marketplace-applications','POST',{provider,opportunity_id:opportunity,proposal_id:proposal||null})})}
 async function connectUpwork(){setBusy(true);setMessage('');try{const r=await req('/api/v1/marketplaces/upwork/oauth/start','POST');window.location.assign(r.authorization_url)}catch(e:any){setMessage(e.message);setBusy(false)}}
 async function searchUpwork(cursor:string|null=null){setBusy(true);setMessage('');try{const r=await req('/api/v1/marketplaces/upwork/discovery/search','POST',{search_term:searchTerm,limit:20,cursor});setSearchResults(old=>cursor?[...old,...r.items]:r.items);setNextCursor(r.next_cursor||null);setSearchTotal(r.total_count||0);await load();setMessage(`Upwork API search completed: ${r.created} new opportunities, ${r.duplicates_refreshed} duplicates refreshed. No proposal was submitted.`)}catch(e:any){setMessage(e.message)}finally{setBusy(false)}}
 async function setMode(p:Item,mode:string){await run(()=>req(`/api/v1/marketplaces/${p.provider}/settings`,'PUT',{access_mode:mode}))}
 async function saveSearch(){await run(async()=>{await req('/api/v1/marketplaces/saved-searches','POST',{search_term:savedTerm,result_limit:20,interval_hours:savedInterval,is_active:true});setSavedTerm('')})}
 async function runSavedSearch(id:string){setBusy(true);setMessage('');try{const r=await req(`/api/v1/marketplaces/saved-searches/${id}/run`,'POST');await load();setMessage(`Saved search completed: ${r.result.created} new opportunities and ${r.result.duplicates_refreshed} refreshed.`)}catch(e:any){setMessage(e.message)}finally{setBusy(false)}}
 async function toggleSavedSearch(x:Item){await run(()=>req(`/api/v1/marketplaces/saved-searches/${x.id}`,'PATCH',{is_active:!x.is_active}))}
 async function deleteSavedSearch(id:string){await run(()=>req(`/api/v1/marketplaces/saved-searches/${id}`,'DELETE'))}
 if(!token)return <main style={{padding:32,fontFamily:'sans-serif'}}>Sign in to Freelance Income AI first, then open this page.</main>;
 return <main style={{maxWidth:1100,margin:'32px auto',padding:20,fontFamily:'sans-serif'}}>
 <a href="/">← Back to dashboard</a><h1>Marketplace integrations</h1><p>Official API access is provider-controlled. Upwork now supports read-only GraphQL opportunity search after approved API access and OAuth authorization. Other provider integrations remain pending verification. We do not scrape sites or submit proposals.</p>
 {message&&<p role="status">{message}</p>}
 {typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('oauth') && <p role="status">Upwork OAuth result: {new URLSearchParams(window.location.search).get('oauth')}. A received token is not proof of marketplace API access.</p>}
 <p><a href="/opportunity-intelligence">Open Opportunity Intelligence →</a></p><h2>Provider availability</h2><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12}}>
 {providers.map(p=><section key={p.provider} style={{border:'1px solid #ddd',borderRadius:10,padding:16}}>
 <h3>{p.name}</h3><p><b>Status:</b> {p.connection_status}</p><p>{p.discovery}</p><p>{p.submission}</p>{p.docs&&<p><a href={p.docs} target="_blank" rel="noreferrer">Official documentation</a></p>}
 <label>Access mode<br/><select value={p.access_mode} onChange={e=>setMode(p,e.target.value)} disabled={busy} style={{width:'100%',padding:8}}>
 {['manual','permitted_feed','official_api_pending','official_api_read_only'].map(x=><option key={x} disabled={x==='official_api_read_only'}>{x}</option>)}</select></label>
 </section>)}</div>
 <h2 style={{marginTop:32}}>Verified provider authorization</h2><section style={{border:'1px solid #ddd',borderRadius:10,padding:16,display:'grid',gap:8}}><h3>Upwork OAuth</h3><p>Credential status: <b>{credentialStatus.credential_status||'not_checked'}</b></p><p>OAuth uses the official authorization-code flow with PKCE. You must obtain API approval, configure the registered callback URL and request the read-only marketplace job-postings scope. API access is marked verified only after a successful GraphQL search.</p><p>Live API verified: <b>{credentialStatus.live_api_verified?'Yes':'Not yet'}</b></p><button disabled={busy} onClick={connectUpwork} style={{padding:10}}>Connect Upwork account</button><p style={{fontSize:13,color:'#666'}}>Freelancer.com: developer API and sandbox are documented, but its exact account authorization flow has not been verified for this app. No connect button is offered until that is confirmed.</p></section>

 <h2 style={{marginTop:32}}>Upwork read-only opportunity discovery</h2><section style={{border:'1px solid #ddd',borderRadius:10,padding:16,display:'grid',gap:10}}>
 <p>Search the official Upwork GraphQL API using your approved account. Results are imported into your opportunity pipeline and scored against your profile. This feature never applies to jobs.</p>
 <label>Search keywords<input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Python automation, React, data analysis..." style={{display:'block',padding:9,width:'100%',marginTop:5}}/></label>
 <button disabled={busy||searchTerm.trim().length<2} onClick={()=>{setSearchResults([]);setNextCursor(null);searchUpwork(null)}} style={{padding:10}}>Search and import Upwork opportunities</button>
 {searchTotal>0&&<p>Matching listings: {searchTotal} · Loaded: {searchResults.length}</p>}
 {searchResults.map(x=><div key={x.opportunity_id} style={{borderTop:'1px solid #eee',padding:'10px 0'}}><b>{x.title}</b><div>Profile match: {x.match_score}/100 · {x.is_new?'New import':'Existing opportunity refreshed'}</div><small>Opportunity ID: {x.opportunity_id}</small></div>)}
 {nextCursor&&<button disabled={busy} onClick={()=>searchUpwork(nextCursor)} style={{padding:10}}>Load next page</button>}
 </section>
 <h2 style={{marginTop:32}}>Saved searches & scheduled discovery</h2><section style={{border:'1px solid #ddd',borderRadius:10,padding:16,display:'grid',gap:10}}>
 <p>Save keyword searches to run manually or automatically through the scheduled backend Cron Job. Automatic discovery is read-only and depends on approved Upwork API access and the separate hourly listing-retention cleanup.</p>
 <label>Search keywords<input value={savedTerm} onChange={e=>setSavedTerm(e.target.value)} placeholder="Python automation, React, data analysis..." style={{display:'block',padding:9,width:'100%',marginTop:5}}/></label>
 <label>Repeat every<select value={savedInterval} onChange={e=>setSavedInterval(Number(e.target.value))} style={{display:'block',padding:9,width:'100%',marginTop:5}}><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option></select></label>
 <button disabled={busy||savedTerm.trim().length<2} onClick={saveSearch} style={{padding:10}}>Save recurring search</button>
 {savedSearches.length===0&&<p>No saved searches yet.</p>}
 {savedSearches.map(x=><div key={x.id} style={{borderTop:'1px solid #eee',padding:'12px 0',display:'grid',gap:6}}><b>{x.search_term}</b><span>Every {x.interval_hours} hours · {x.is_active?'Active':'Paused'} · Last results: {x.last_result_count}</span><small>Last run: {x.last_run_at?new Date(x.last_run_at).toLocaleString():'Not run yet'} · Next run: {x.next_run_at?new Date(x.next_run_at).toLocaleString():'Not scheduled'}</small>{x.last_error&&<small role="alert">Last error: {x.last_error}</small>}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={busy} onClick={()=>runSavedSearch(x.id)}>Run now</button><button disabled={busy} onClick={()=>toggleSavedSearch(x)}>{x.is_active?'Pause':'Resume'}</button><button disabled={busy} onClick={()=>deleteSavedSearch(x.id)}>Delete</button></div></div>)}
 </section>
 <h2 style={{marginTop:32}}>Create application tracking record</h2><section style={{border:'1px solid #ddd',borderRadius:10,padding:16,display:'grid',gap:10}}>
 <label>Provider<select value={provider} onChange={e=>setProvider(e.target.value)} style={{display:'block',padding:8,width:'100%'}}>{providers.map(p=><option value={p.provider} key={p.provider}>{p.name}</option>)}</select></label>
 <label>Opportunity<select value={opportunity} onChange={e=>setOpportunity(e.target.value)} style={{display:'block',padding:8,width:'100%'}}><option value="">Select opportunity</option>{opportunities.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
 <label>Proposal ID (optional)<input value={proposal} onChange={e=>setProposal(e.target.value)} placeholder="Paste proposal ID" style={{display:'block',padding:8,width:'100%'}}/></label>
 <button disabled={busy||!opportunity} onClick={create} style={{padding:10}}>Create draft record</button>
 </section>
 <h2 style={{marginTop:32}}>Application pipeline</h2><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Provider','Opportunity','Status','External reference','Created'].map(x=><th key={x} style={{textAlign:'left',padding:8,borderBottom:'1px solid #ccc'}}>{x}</th>)}</tr></thead><tbody>{apps.map(a=><tr key={a.id}>{[a.provider,a.opportunity_id,a.status,a.external_application_id||'—',new Date(a.created_at).toLocaleDateString()].map((x,i)=><td key={i} style={{padding:8,borderBottom:'1px solid #eee'}}>{x}</td>)}</tr>)}</tbody></table></div>
 <p style={{marginTop:20,fontSize:13,color:'#666'}}>Approval and submission endpoints record your manual action. They do not contact the marketplace. Access-mode settings are informational metadata. Upwork API verification requires a successful authenticated GraphQL search.</p>
 </main>
}
