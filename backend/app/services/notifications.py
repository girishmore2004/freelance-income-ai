import httpx
from ..core import settings
async def send_telegram(text):
    if not settings.telegram_bot_token or not settings.telegram_chat_id:return False
    url=f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    async with httpx.AsyncClient(timeout=15) as client:
        r=await client.post(url,json={"chat_id":settings.telegram_chat_id,"text":text[:3900],"disable_web_page_preview":True}); r.raise_for_status(); return bool(r.json().get("ok"))
