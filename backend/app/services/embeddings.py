"""Optional provider embeddings. Retrieval falls back to lexical cosine when embeddings are unavailable."""
import httpx
from ..core import settings

class EmbeddingUnavailable(RuntimeError):
    pass

async def embed_text(text: str) -> tuple[list[float], str]:
    provider = settings.embedding_provider.lower()
    if provider in {"lexical", "none", "disabled"}:
        raise EmbeddingUnavailable("Lexical-only retrieval is explicitly configured")
    if provider == "openai":
        if not settings.openai_api_key:
            raise EmbeddingUnavailable("OPENAI_API_KEY is not configured for embeddings")
        from openai import AsyncOpenAI
        kwargs = {"api_key": settings.openai_api_key}
        if settings.openai_base_url:
            kwargs["base_url"] = settings.openai_base_url
        client = AsyncOpenAI(**kwargs)
        response = await client.embeddings.create(
            model=settings.openai_embedding_model,
            input=text[:12000],
        )
        return response.data[0].embedding, settings.openai_embedding_model
    if provider == "ollama":
        base = settings.ollama_base_url.rstrip("/")
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                base + "/api/embed",
                json={"model": settings.ollama_embedding_model, "input": text[:12000]},
            )
            response.raise_for_status()
            payload = response.json()
            vectors = payload.get("embeddings") or []
            if not vectors:
                raise EmbeddingUnavailable("Ollama returned no embedding")
            return vectors[0], settings.ollama_embedding_model
    raise EmbeddingUnavailable("EMBEDDING_PROVIDER must be ollama or openai")
