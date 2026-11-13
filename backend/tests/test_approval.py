from fastapi.testclient import TestClient
from app.main import app
import uuid
c=TestClient(app)
def test_approval_is_required_before_ready():
    email=f"approval-{uuid.uuid4()}@example.com"
    token=c.post('/api/v1/auth/register',json={"email":email,"password":"StrongPassword123!"}).json()['access_token']; h={"Authorization":f"Bearer {token}"}
    o=c.post('/api/v1/opportunities',headers=h,json={"title":"Python automation project","description":"Build a Python workflow for processing invoices and extracting structured fields.","required_skills":["Python"]}).json()
    p=c.post('/api/v1/proposals/generate',headers=h,json={"opportunity_id":o['id']}).json()
    assert c.post(f"/api/v1/applications/{p['id']}/mark-ready",headers=h).status_code==403
    a=c.post(f"/api/v1/proposals/{p['id']}/request-approval",headers=h).json()
    c.post(f"/api/v1/approvals/{a['id']}/decision",headers=h,json={"decision":"approved"})
    assert c.post(f"/api/v1/applications/{p['id']}/mark-ready",headers=h).status_code==200

def test_approval_fingerprint_includes_commercial_terms():
    from app.agents import proposal_fingerprint
    class Proposal:
        content = "Same proposal text"
        proposed_price = 1000
        currency = "INR"
    original = proposal_fingerprint(Proposal())
    Proposal.proposed_price = 1500
    assert proposal_fingerprint(Proposal()) != original
