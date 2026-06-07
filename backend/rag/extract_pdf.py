#!/usr/bin/env python3
"""
Offline ingestion step 1: extract per-page text chunks from the ICMR Standard
Treatment Workflow (STW) PDFs.

The STW PDFs are infographic-style: one clinical condition per page, with a fixed
banner ("Standard Treatment Workflow (STW)", a TITLE, and an "ICD-10-..." code).
Intra-page reading order is scrambled by the layout, so we deliberately keep each
page whole rather than trying to segment sections. Each retained page becomes one
RAG chunk with a stable, human-readable citation label.

Output: rag/data/chunks.json  (consumed by ingest.js, which adds embeddings)

Run:  python3 rag/extract_pdf.py
Requires: pypdf  (pip install pypdf)
"""
import json
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf not installed. Run: pip install pypdf")

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(HERE, "source_docs")
OUT_PATH = os.path.join(HERE, "data", "chunks.json")

# Friendly source labels per filename (used in citation labels).
DOC_LABELS = {
    "1725444938_stw_manual_v1_stw_i.pdf": "ICMR STW of India — Vol I",
    "1733131850_stw_vol_3_20222.pdf": "ICMR STW of India — Vol III (2022)",
    "1733131852_stw_vol_4_2024.pdf": "ICMR STW of India — Vol IV (2024)",
    "1733131854_icmr_stw_ptb_eptb.pdf": "ICMR STW — Paediatric & Extrapulmonary TB",
}

ICD_RE = re.compile(r"ICD[\s\-]*10[\s\-]*[A-Z]?[0-9]{1,3}(?:\.[0-9A-Za-z]+)?", re.IGNORECASE)
STW_BANNER_RE = re.compile(r"Standard\s+Treatment\s+Workflow", re.IGNORECASE)
CONTENT_KEYWORDS = (
    "MANAGEMENT", "TREATMENT", "WHEN TO SUSPECT", "DIAGNOSIS",
    "INVESTIGATION", "CLINICAL", "SYMPTOMS", "DOSE",
)
# Pages we never want as clinical chunks.
SKIP_KEYWORDS = ("CONTRIBUTORS", "ADVISORY COMMITTEE", "EDITORIAL BOARD",
                 "Suggested Citation", "All rights reserved")


def clean(text: str) -> str:
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")
    # strip PDF named-glyph artifacts (e.g. "/hyphen.case", "/period.sc")
    text = re.sub(r"/hyphen\.\w+", "-", text)
    text = re.sub(r"/[a-z]+\.[a-z]+", "", text)
    # collapse runs of blank lines / spaces
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def detect_title(text: str) -> str:
    """Title usually sits right after the STW banner, before the ICD line."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for i, line in enumerate(lines):
        if STW_BANNER_RE.search(line):
            # next non-trivial line that isn't the ICD code is the title
            for nxt in lines[i + 1:i + 4]:
                if ICD_RE.search(nxt):
                    continue
                if len(nxt) > 2 and not nxt.lower().startswith("icd"):
                    return nxt.title() if nxt.isupper() else nxt
    return ""


def is_content_page(text: str) -> bool:
    upper = text.upper()
    if any(sk.upper() in upper for sk in SKIP_KEYWORDS) and not ICD_RE.search(text):
        return False
    if ICD_RE.search(text):
        return True
    if len(text) > 800 and any(k in upper for k in CONTENT_KEYWORDS):
        return True
    return False


def main():
    if not os.path.isdir(SOURCE_DIR):
        sys.exit(f"Source dir not found: {SOURCE_DIR}")
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    chunks = []
    for fname in sorted(os.listdir(SOURCE_DIR)):
        if not fname.lower().endswith(".pdf"):
            continue
        label = DOC_LABELS.get(fname, fname)
        path = os.path.join(SOURCE_DIR, fname)
        try:
            reader = PdfReader(path)
        except Exception as e:  # noqa: BLE001
            print(f"  !! failed to read {fname}: {e}", file=sys.stderr)
            continue

        kept = 0
        for pidx, page in enumerate(reader.pages):
            raw = page.extract_text() or ""
            text = clean(raw)
            if len(text) < 120 or not is_content_page(text):
                continue
            icd_match = ICD_RE.search(text)
            icd = icd_match.group(0).strip() if icd_match else ""
            title = detect_title(text)
            page_no = pidx + 1
            if title and icd:
                citation = f"{label} — {title} ({icd}), p.{page_no}"
            elif title:
                citation = f"{label} — {title}, p.{page_no}"
            else:
                citation = f"{label} — p.{page_no}"
            chunks.append({
                "id": f"{fname[:8]}-p{page_no}",
                "source_file": fname,
                "doc_label": label,
                "page": page_no,
                "title": title,
                "icd": icd,
                "citation_label": citation,
                "text": text,
            })
            kept += 1
        print(f"  {fname}: kept {kept}/{len(reader.pages)} pages")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(chunks)} chunks -> {OUT_PATH}")


if __name__ == "__main__":
    main()
