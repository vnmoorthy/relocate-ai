"""Generate the move-package PDF receipt — real artifact delivered to the homeowner.

This is the keystone "real-world artifact" of the demo: a branded, dated PDF that
lands in the judge's inbox during the 90-second pitch.

Uses reportlab (synchronous; called from a thread executor by AgentMail integration).
"""
from __future__ import annotations

import io
import time
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


MINT = colors.HexColor("#00C281")
INK = colors.HexColor("#0E0E12")
INK_DIM = colors.HexColor("#56565E")
BORDER = colors.HexColor("#E2E2E6")


def build_receipt_pdf(
    *,
    event_id: str,
    homeowner_name: str,
    spec: dict[str, Any],
    specialist_results: list[dict[str, Any]],
    pavo_summary: dict[str, Any],
) -> bytes:
    """Generate the PDF as bytes. Caller attaches to email or writes to disk.

    specialist_results: list of dicts with keys: name, state, outcome (str), tier (str)
    pavo_summary: dict with decisions, local_share_pct, pavo_cents, baseline_cents
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title=f"Relocate Package — {homeowner_name}",
    )

    base = getSampleStyleSheet()
    styles = {
        "brand": ParagraphStyle(
            "brand",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=32,
            leading=36,
            textColor=INK,
            spaceAfter=4,
        ),
        "tag": ParagraphStyle(
            "tag",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            textColor=INK_DIM,
            spaceAfter=18,
            leading=12,
            letterSpacing=1.2,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            textColor=INK,
            spaceBefore=14,
            spaceAfter=6,
            leading=15,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            textColor=INK,
            leading=14,
            spaceAfter=4,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            textColor=INK_DIM,
            leading=11,
        ),
    }

    flow = []

    # Header brand block
    flow.append(Paragraph("Relocate", styles["brand"]))
    flow.append(
        Paragraph(
            "AI RELOCATION OS &nbsp;·&nbsp; BUILT ON PAVO &nbsp;·&nbsp; TMLR 2026",
            styles["tag"],
        )
    )

    # Relocate spec table
    flow.append(Paragraph("YOUR MOVE", styles["h2"]))
    spec_rows = [
        ["Homeowner", homeowner_name or "—"],
        ["From", spec.get("origin_address", "—")],
        ["To", spec.get("destination_address", "—")],
        ["Relocate date", spec.get("move_date", "—")],
        ["Bedrooms", str(spec.get("household_size", "—"))],
        ["Event ID", event_id],
        ["Generated", time.strftime("%Y-%m-%d %H:%M %Z")],
    ]
    spec_tbl = Table(spec_rows, colWidths=[1.4 * inch, 5.0 * inch])
    spec_tbl.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
                ("TEXTCOLOR", (0, 0), (0, -1), INK_DIM),
                ("TEXTCOLOR", (1, 0), (1, -1), INK),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, BORDER),
            ]
        )
    )
    flow.append(spec_tbl)

    # Specialist results
    flow.append(Paragraph("SPECIALIST RESULTS", styles["h2"]))
    spec_header = ["Specialist", "Status", "Outcome", "Tier"]
    rows = [spec_header]
    for r in specialist_results:
        rows.append(
            [
                r.get("name", "—"),
                (r.get("state") or "—").upper(),
                (r.get("outcome") or "—")[:80],
                (r.get("tier") or "—").replace("-", " "),
            ]
        )
    spec_tbl = Table(rows, colWidths=[1.6 * inch, 0.9 * inch, 3.2 * inch, 0.9 * inch])
    spec_tbl.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
                ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
                ("TEXTCOLOR", (0, 0), (-1, 0), INK_DIM),
                ("TEXTCOLOR", (0, 1), (-1, -1), INK),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F4F4F6")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, BORDER),
                ("ALIGN", (1, 1), (1, -1), "LEFT"),
            ]
        )
    )
    flow.append(spec_tbl)

    # PAVO routing summary
    flow.append(Paragraph("PAVO ROUTING SUMMARY", styles["h2"]))
    decisions = pavo_summary.get("decisions", 0)
    local_pct = pavo_summary.get("local_share_pct", 0)
    pavo_cents = pavo_summary.get("pavo_cents", 0.0)
    baseline_cents = pavo_summary.get("baseline_cents", 0.0)
    saved_cents = max(0.0, baseline_cents - pavo_cents)
    ratio = (baseline_cents / pavo_cents) if pavo_cents > 0 else 0

    pavo_rows = [
        ["Routing decisions made", str(decisions)],
        ["Routed to Gemma-local", f"{local_pct}%"],
        ["Relocate LLM spend (PAVO-routed)", f"${pavo_cents / 100:.4f}"],
        ["Fixed-cloud counterfactual", f"${baseline_cents / 100:.4f}"],
        ["Saved this call", f"${saved_cents / 100:.4f}"],
        ["Cheaper than fixed-cloud", f"{ratio:.1f}×" if ratio else "—"],
    ]
    pavo_tbl = Table(pavo_rows, colWidths=[3.4 * inch, 3.0 * inch])
    pavo_tbl.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
                ("TEXTCOLOR", (0, 0), (0, -1), INK_DIM),
                ("TEXTCOLOR", (1, 0), (1, -1), INK),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, BORDER),
            ]
        )
    )
    flow.append(pavo_tbl)

    # Paper citation
    flow.append(Spacer(1, 0.2 * inch))
    flow.append(
        Paragraph(
            "From the paper (TMLR 2026): PAVO is 25% cheaper, 34% faster on median latency, "
            "71% less energy, and 7.9× fewer coherence failures vs. fixed-cloud baseline "
            "on the 50,000-turn PAVO-Bench dataset. "
            "<font color='#00C281'>huggingface.co/datasets/vnmoorthy/pavo-bench</font>",
            styles["small"],
        )
    )

    flow.append(Spacer(1, 0.25 * inch))
    flow.append(
        Paragraph(
            "Questions? Reply to this email. Relocate handles relocation tasks so you can focus on "
            "everything else moving rips out from under you.",
            styles["small"],
        )
    )

    doc.build(flow)
    return buf.getvalue()
