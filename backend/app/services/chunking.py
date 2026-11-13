"""Deterministic chunking for portfolio documents."""
import re

def chunk_text(text: str, max_chars: int = 1100, overlap: int = 140) -> list[str]:
    text = re.sub(r"\\s+", " ", (text or "")).strip()
    if not text:
        return []
    if max_chars < 200 or overlap < 0 or overlap >= max_chars:
        raise ValueError("Invalid chunking configuration")
    chunks, start = [], 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            boundary = text.rfind(" ", start + max_chars // 2, end)
            if boundary > start:
                end = boundary
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks
