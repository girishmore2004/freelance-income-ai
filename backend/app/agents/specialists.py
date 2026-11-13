from ..scoring import score_opportunity
def discovery_agent(items): return {"agent":"discovery_agent","count":len(items),"items":items}
def matching_agent(profile,opportunity):
    score,breakdown=score_opportunity(profile,opportunity); return {"agent":"matching_agent","score":score,"breakdown":breakdown}
def research_agent(evidence): return {"agent":"research_agent","evidence":evidence,"verified_count":sum(1 for x in evidence if x.get("confidence")=="verified" and x.get("evidence_url"))}
def pricing_agent(opportunity,estimated_hours=8.0,hourly_floor=500.0): return {"agent":"pricing_agent","estimated_hours":estimated_hours,"floor_estimate":round(max(0,estimated_hours)*max(0,hourly_floor),2),"client_budget_max":opportunity.get("budget_max"),"recommendation":"review_scope_before_quote"}
def proposal_agent_status(): return {"agent":"proposal_agent","capability":"LLM proposal drafting with safe template fallback"}
def approval_agent(proposal_hash,approved_hash): return {"agent":"approval_agent","approved":bool(proposal_hash and approved_hash and proposal_hash==approved_hash)}
def outreach_agent(approved): return {"agent":"outreach_agent","allowed":False,"reason":"Marketplace submission connector is disabled" if approved else "Approval required"}
def delivery_agent(project,tasks): return {"agent":"delivery_agent","project_id":project.get("id"),"task_count":len(tasks)}
def finance_agent(invoices):
    paid=sum(float(x.get("amount",0)) for x in invoices if x.get("status")=="paid"); due=sum(float(x.get("amount",0)) for x in invoices if x.get("status") in {"unpaid","overdue"})
    return {"agent":"finance_agent","paid_total":round(paid,2),"outstanding_total":round(due,2)}
def learning_agent(feedback): return {"agent":"learning_agent","feedback_count":len(feedback),"outcomes":{k:sum(1 for x in feedback if x.get("outcome")==k) for k in sorted({x.get("outcome","unknown") for x in feedback})}}
