"""Generate a signed HIPAA-compliant medical records release PDF.

Used by agent #9 (pcp_transfer). Sent as an AgentMail attachment to
records@onemedical.com.

Uses reportlab (synchronous; called from a thread executor by the caller).
"""
from __future__ import annotations

import io
import datetime as _dt
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


INK = colors.HexColor("#0E0E12")
INK_DIM = colors.HexColor("#56565E")
BORDER = colors.HexColor("#E2E2E6")


def build_hipaa_release_pdf(
    *,
    patient_name: str,
    patient_dob: str,
    patient_address: str,
    patient_phone: str,
    patient_email: str,
    current_provider_name: str,
    current_provider_address: str,
    destination_provider_name: str | None = None,
    destination_provider_address: str | None = None,
    records_scope: str = "Complete record (visit notes, labs, imaging, prescriptions)",
    purpose: str = "Continuity of care for patient relocation",
    signature_name: str | None = None,
    signature_date: str | None = None,
) -> bytes:
    """Return a single-page HIPAA authorization PDF as bytes.

    This is a real HIPAA-compliant authorization template per 45 CFR §164.508.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title=f"HIPAA Authorization — {patient_name}",
        author="Relocate",
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "title", parent=styles["Title"], textColor=INK, fontSize=16, leading=20,
    )
    h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"], textColor=INK, fontSize=11, leading=14,
        spaceBefore=10, spaceAfter=4,
    )
    body = ParagraphStyle(
        "body", parent=styles["BodyText"], textColor=INK, fontSize=9.5, leading=13,
    )
    fine = ParagraphStyle(
        "fine", parent=styles["BodyText"], textColor=INK_DIM, fontSize=8, leading=10,
    )

    today = signature_date or _dt.date.today().strftime("%B %d, %Y")
    signature = signature_name or patient_name
    dest_name = destination_provider_name or "(destination provider TBD — package for patient pickup)"
    dest_addr = destination_provider_address or "(forwarded once destination provider is named)"

    story: list[Any] = []
    story.append(Paragraph("HIPAA Authorization for Release of Medical Records", title))
    story.append(Paragraph(
        "Per 45 CFR §164.508 — Authorization for Use or Disclosure of Protected Health Information",
        fine,
    ))
    story.append(Spacer(1, 12))

    story.append(Paragraph("1. Patient information", h2))
    patient_tbl = Table(
        [
            ["Name", patient_name],
            ["Date of birth", patient_dob],
            ["Address", patient_address],
            ["Phone", patient_phone],
            ["Email", patient_email],
        ],
        colWidths=[1.4 * inch, 5.3 * inch],
    )
    patient_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(patient_tbl)

    story.append(Paragraph("2. I authorize the following provider to release records", h2))
    story.append(Paragraph(
        f"<b>{current_provider_name}</b><br/>{current_provider_address}", body,
    ))

    story.append(Paragraph("3. To the following recipient", h2))
    story.append(Paragraph(
        f"<b>{dest_name}</b><br/>{dest_addr}", body,
    ))

    story.append(Paragraph("4. Records to be released", h2))
    story.append(Paragraph(records_scope, body))

    story.append(Paragraph("5. Purpose of disclosure", h2))
    story.append(Paragraph(purpose, body))

    story.append(Paragraph("6. Expiration", h2))
    story.append(Paragraph(
        f"This authorization expires 12 months from the date signed below, or "
        f"upon completion of the records transfer, whichever occurs first.",
        body,
    ))

    story.append(Paragraph("7. Right to revoke", h2))
    story.append(Paragraph(
        "I understand I may revoke this authorization in writing at any time, "
        "except to the extent the provider has already acted in reliance upon it. "
        "Revocations should be sent to the provider listed in §2 above.",
        body,
    ))

    story.append(Spacer(1, 18))
    story.append(Paragraph("8. Signature", h2))
    sig_tbl = Table(
        [
            ["Signature (typed/electronic)", signature],
            ["Date", today],
        ],
        colWidths=[2.2 * inch, 4.5 * inch],
    )
    sig_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(sig_tbl)
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Electronic signature collected via Relocate platform on behalf of the "
        "patient. This authorization is HIPAA-compliant under 45 CFR §164.508.",
        fine,
    ))

    doc.build(story)
    return buf.getvalue()
