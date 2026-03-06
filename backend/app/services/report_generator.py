"""
PDF report generator using ReportLab.
"""
import io
import json
from datetime import datetime

from app.models.analysis import AnalysisJob
from app.models.project import Project
from app.core.storage import download_bytes


async def generate_pdf_report(job: AnalysisJob, project: Project) -> bytes:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib import colors
    except ImportError:
        return _fallback_pdf(project, job)

    # Load analysis results
    raw = download_bytes(job.result_path)
    results = json.loads(raw)
    stats = results.get("statistics", {})
    zones = results.get("panel_zones", [])

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("SolarSight — Solar Analysis Report", styles["Title"]))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(f"Project: {project.name}", styles["Heading2"]))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles["Normal"]))
    story.append(Spacer(1, 1 * cm))

    story.append(Paragraph("Irradiance Statistics", styles["Heading2"]))
    stat_data = [
        ["Metric", "Value"],
        ["Maximum", f"{stats.get('max', 0):.1f} kWh/m²"],
        ["Average", f"{stats.get('avg', 0):.1f} kWh/m²"],
        ["Minimum", f"{stats.get('min', 0):.1f} kWh/m²"],
    ]
    t = Table(stat_data, colWidths=[8 * cm, 8 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.8 * cm))

    if zones:
        story.append(Paragraph(f"Top Panel Zones ({len(zones)} identified)", styles["Heading2"]))
        zone_data = [["Zone", "Avg kWh/m²", "Area m²", "Tilt °", "Est. Yield kWh/yr"]]
        for z in zones[:10]:
            zone_data.append([
                str(z.get("id", "?")),
                f"{z.get('avg_irradiance', 0):.0f}",
                f"{z.get('area_m2', 0):.1f}",
                f"{z.get('tilt_deg', 0):.1f}",
                f"{z.get('estimated_annual_yield_kwh', 0):.0f}",
            ])
        zt = Table(zone_data, colWidths=[2 * cm, 3.5 * cm, 3 * cm, 3 * cm, 4.5 * cm])
        zt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(zt)

    doc.build(story)
    return buffer.getvalue()


def _fallback_pdf(project: Project, job: AnalysisJob) -> bytes:
    """Minimal PDF without ReportLab."""
    content = (
        f"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj "
        f"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj "
        f"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Contents 4 0 R>>endobj "
        f"4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 100 700 Td "
        f"(SolarSight Report: {project.name}) Tj ET\nendstream endobj "
        f"xref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\n%%EOF"
    )
    return content.encode()
