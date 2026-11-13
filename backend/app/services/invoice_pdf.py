from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import re
def safe_text(value):
    return str(value or "").encode("latin-1", errors="replace").decode("latin-1")
def safe_filename(value):
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", str(value or "invoice"))
    return cleaned[:80] or "invoice"
def build_invoice_pdf(invoice,seller):
    out=BytesIO(); pdf=canvas.Canvas(out,pagesize=A4); _,height=A4
    pdf.setTitle(f"Invoice {invoice['invoice_number']}"); pdf.setFont("Helvetica-Bold",20); pdf.drawString(48,height-60,"INVOICE"); pdf.setFont("Helvetica",10)
    lines=[f"Invoice number: {invoice['invoice_number']}",f"Seller: {seller.get('full_name') or 'Freelancer'}",f"Email: {seller.get('email') or ''}",f"Project: {invoice.get('project_title') or 'Not specified'}",f"Due date: {invoice.get('due_date') or 'Not specified'}",f"Status: {invoice['status']}","",f"Total: {invoice['currency']} {invoice['amount']:.2f}","","Generated invoice record; not proof of payment."]
    y=height-105
    for line in lines: pdf.drawString(48,y,safe_text(line[:110])); y-=24
    pdf.showPage(); pdf.save(); return out.getvalue()
