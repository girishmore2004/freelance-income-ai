import httpx
from .core import settings
class ModelUnavailable(RuntimeError): pass
async def generate_text(system: str, prompt: str) -> str:
    provider = settings.ai_provider.lower()
    if provider == "openai":
        if not settings.openai_api_key: raise ModelUnavailable("OPENAI_API_KEY is not configured")
        from openai import AsyncOpenAI
        kwargs = {"api_key": settings.openai_api_key}
        if settings.openai_base_url: kwargs["base_url"] = settings.openai_base_url
        client = AsyncOpenAI(**kwargs)
        response = await client.chat.completions.create(model=settings.openai_model, messages=[{"role":"system","content":system},{"role":"user","content":prompt}], temperature=0.3)
        return response.choices[0].message.content or ""
    if provider == "ollama":
        url = settings.ollama_base_url.rstrip("/") + "/api/chat"
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json={"model": settings.ollama_model, "stream": False, "messages": [{"role":"system","content":system},{"role":"user","content":prompt}]})
            r.raise_for_status(); data = r.json(); return data.get("message", {}).get("content", "")
    raise ModelUnavailable("AI_PROVIDER must be ollama or openai")
