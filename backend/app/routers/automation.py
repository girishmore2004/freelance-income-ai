import secrets
from fastapi import APIRouter,Header,HTTPException,Depends
from sqlalchemy.orm import Session
from ..core import settings
from ..database import get_db
from ..models import User,Notification,AgentEvent
from ..schemas import N8NEventIn
router=APIRouter(prefix="/api/v1/integrations/n8n",tags=["automation"])
@router.post("/event")
def event(data:N8NEventIn,x_fia_webhook_secret:str=Header(default=""),db:Session=Depends(get_db)):
    if not settings.n8n_webhook_secret or not secrets.compare_digest(settings.n8n_webhook_secret,x_fia_webhook_secret): raise HTTPException(401,"Invalid automation webhook credential")
    if not db.get(User,data.user_id): raise HTTPException(404,"User not found")
    n=Notification(user_id=data.user_id,title=data.title[:240],message=data.message[:5000],channel="n8n",status="received"); db.add(n); db.add(AgentEvent(user_id=data.user_id,agent_name="n8n",event_type=data.event_type[:60],detail=data.message[:5000])); db.commit(); return {"accepted":True,"notification_id":n.id}
