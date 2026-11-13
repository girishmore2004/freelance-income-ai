'use client';
import {useEffect,useMemo,useState} from 'react';

const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000';
type Row=Record<string,any>;

export default function PaymentsPage(){
 const [token,setToken]=useState('');
 const [data,setData]=useState<Row>({by_currency:{},invoices:[]});
 const [invoiceId,setInvoiceId]=useState('');
 const [eventType,setEventType]=useState('receipt');
 const [amount,setAmount]=useState('');
 const [reference,setReference]=useState('');
 const [evidence,setEvidence]=useState('');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 async function req(path:string,method='GET',body?:Row){
  const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json().catch(()=>({detail:'Invalid response'}));
  if(!r.ok)throw new Error(j.detail||'Request failed');
  return j;
 }
 async function load(){
  if(!token)return;
  const result=await req('/api/v1/payment-reconciliation');
  setData(result);
  if(!invoiceId&&result.invoices?.length)setInvoiceId(result.invoices[0].id);
 }
 useEffect(()=>{setToken(localStorage.getItem('fia_token')||'')},[]);
 useEffect(()=>{if(token)load().catch(e=>setError(e.message))},[token]);
 const selected=useMemo(()=>data.invoices?.find((x:Row)=>x.id===invoiceId),[data,invoiceId]);
 async function submit(){
  if(!selected)return;
  setBusy(true);setError('');setMessage('');
  try{
   await req(`/api/v1/invoices/${invoiceId}/payment-events`,'POST',{
    event_type:eventType,amount:Number(amount||0),currency:selected.currency,
    reference,evidence_reference:evidence,note
   });
   setAmount('');setReference('');setEvidence('');setNote('');
   await load();
   setMessage('Evidence event saved. No payment was initiated or bank-verified.');
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 if(!token)return <main style={{padding:30}}>Sign in to Freelance Income AI, then open this page.</main>;
 return <main style={{maxWidth:1100,margin:'28px auto',padding:20,fontFamily:'sans-serif'}}>
  <a href="/">← Back to dashboard</a>
  <h1>Payment Reconciliation</h1>
  <p>Record receipts, refunds and dispute events against invoices. This is an evidence ledger only: it does not connect to banks, collect money or verify external transactions.</p>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" style={{color:'crimson'}}>{error}</p>}
  <h2>Totals by currency</h2>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10}}>
   {Object.entries(data.by_currency||{}).map(([currency,totals]:[string,any])=><section key={currency} style={{border:'1px solid #ddd',borderRadius:10,padding:14}}>
    <h3>{currency}</h3><p>Invoiced: {totals.invoiced}</p><p>Received: {totals.received}</p><p>Refunded: {totals.refunded}</p><b>Net paid: {totals.net_paid}</b><p>Outstanding: {totals.outstanding}</p><small>{totals.invoice_count} invoices</small>
   </section>)}
  </div>
  <h2 style={{marginTop:26}}>Record a payment event</h2>
  <section style={{display:'grid',gap:9,border:'1px solid #ddd',borderRadius:10,padding:14}}>
   <label>Invoice<select value={invoiceId} onChange={e=>setInvoiceId(e.target.value)} style={{display:'block',width:'100%',padding:9}}><option value="">Select invoice</option>{(data.invoices||[]).map((x:Row)=><option key={x.id} value={x.id}>{x.invoice_number} · {x.currency} {x.amount} · {x.status}</option>)}</select></label>
   {selected&&<p>Currency: <b>{selected.currency}</b> · Outstanding: <b>{selected.outstanding}</b> · Net received: {selected.net_paid}</p>}
   <label>Event type<select value={eventType} onChange={e=>setEventType(e.target.value)} style={{display:'block',width:'100%',padding:9}}><option value="receipt">Payment received</option><option value="refund">Refund recorded</option><option value="dispute_opened">Dispute opened</option><option value="dispute_resolved">Dispute resolved</option></select></label>
   {['receipt','refund'].includes(eventType)&&<label>Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount in invoice currency" style={{display:'block',width:'100%',padding:9}}/></label>}
   <label>Transaction / case reference<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={240} style={{display:'block',width:'100%',padding:9}}/></label>
   <label>Evidence reference (required)<input value={evidence} onChange={e=>setEvidence(e.target.value)} minLength={8} placeholder="Bank statement line, receipt file, processor reference..." style={{display:'block',width:'100%',padding:9}}/></label>
   <label>Notes<textarea value={note} onChange={e=>setNote(e.target.value)} style={{display:'block',width:'100%',padding:9}}/></label>
   <button disabled={busy||!selected||evidence.trim().length<8||(['receipt','refund'].includes(eventType)&&Number(amount)<=0)} onClick={submit}>{busy?'Saving…':'Save evidence event'}</button>
  </section>
  <h2 style={{marginTop:26}}>Invoice ledger</h2>
  {(data.invoices||[]).map((x:Row)=><section key={x.id} style={{border:'1px solid #ddd',borderRadius:10,padding:14,marginBottom:10}}>
   <b>{x.invoice_number}</b> · {x.currency} {x.amount} · <b>{x.status}</b>
   <p>Received {x.received} · Refunded {x.refunded} · Net paid {x.net_paid} · Outstanding {x.outstanding}</p>
   <p>Open disputes: {x.open_disputes} · Events: {x.event_count}</p>
   {x.events?.map((event:Row)=><p key={event.id} style={{fontSize:13,color:'#555'}}>{event.event_type} · {event.currency} {event.amount} · {event.occurred_at} · {event.evidence_reference}</p>)}
  </section>)}
  {!data.invoices?.length&&<p>No invoices yet. Create an invoice in the Delivery & Finance workspace first.</p>}
 </main>;
}
