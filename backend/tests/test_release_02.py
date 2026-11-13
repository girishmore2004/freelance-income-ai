from fastapi.testclient import TestClient
from app.main import app
import uuid
c=TestClient(app)
def auth():
 e=f"r02-{uuid.uuid4()}@example.com"; r=c.post('/api/v1/auth/register',json={"email":e,"password":"StrongPassword123!"}); return {"Authorization":f"Bearer {r.json()['access_token']}"}
def test_project_tasks_and_milestones_are_scoped():
 h=auth(); project=c.post('/api/v1/projects',headers=h,json={"title":"Test project","budget":1000}).json()
 task=c.post('/api/v1/tasks',headers=h,json={"project_id":project["id"],"title":"Build API"}); assert task.status_code==200
 milestone=c.post('/api/v1/milestones',headers=h,json={"project_id":project["id"],"title":"MVP","amount":500}); assert milestone.status_code==200
def test_n8n_webhook_rejects_missing_secret():
 r=c.post('/api/v1/integrations/n8n/event',json={"event_type":"test","title":"test","message":"test","user_id":"unknown"}); assert r.status_code==401
def test_agent_registry_is_explicit_about_disabled_outreach():
 h=auth(); data=c.get('/api/v1/agents/registry',headers=h).json(); item=next(x for x in data if x["name"]=="outreach_agent"); assert item["status"]=="disabled"
