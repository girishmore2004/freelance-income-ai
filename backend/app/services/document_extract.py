from pathlib import Path
ALLOWED={".txt",".md",".pdf"}
def extract_text(filename,content_type,raw):
    suffix=Path(filename).suffix.lower()
    if suffix not in ALLOWED: raise ValueError("Only PDF, TXT and Markdown files are supported")
    if suffix in {".txt",".md"}: return raw.decode("utf-8",errors="replace")[:200000]
    try:
        from pypdf import PdfReader
        import io
        text="\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(raw)).pages)
        if not text.strip(): raise ValueError("PDF has no extractable text; scanned PDF OCR is not enabled")
        return text[:200000]
    except ImportError as exc: raise ValueError("Install pypdf to extract PDF files") from exc
