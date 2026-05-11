#!/usr/bin/env python3
"""Extract WF CPZ operational hours from PDF maps.

Strategy: pdftotext first. If no hours match, fall back to OCR via pdftoppm + tesseract.
Normalises hours to OSM opening_hours syntax.
"""

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

PDF_DIR = Path('/Users/dxwz/Projects/parking-finder/osm_spike/wf_pdfs')
TMP_DIR = Path('/Users/dxwz/Projects/parking-finder/osm_spike/wf_pdfs/_ocr')
TMP_DIR.mkdir(exist_ok=True)

DAY_MAP = {
    'mon': 'Mo', 'tue': 'Tu', 'wed': 'We', 'thu': 'Th',
    'fri': 'Fr', 'sat': 'Sa', 'sun': 'Su',
}

HOURS_RE = re.compile(
    r'(mon|tue|wed|thu|fri|sat|sun)\s*(?:to|-)\s*(mon|tue|wed|thu|fri|sat|sun)'
    r'\s*-?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*'
    r'(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?',
    re.IGNORECASE,
)

def to_24h(hour_str, minute_str, ampm):
    h = int(hour_str)
    m = int(minute_str) if minute_str else 0
    if ampm:
        ampm = ampm.lower()
        if ampm == 'pm' and h != 12:
            h += 12
        elif ampm == 'am' and h == 12:
            h = 0
    return '{:02d}:{:02d}'.format(h, m)

def parse_hours(text):
    m = HOURS_RE.search(text)
    if not m:
        return None
    d1, d2, h1, m1, ap1, h2, m2, ap2 = m.groups()
    if ap1 and not ap2:
        ap2 = ap1 if int(h2) >= int(h1) else ('pm' if ap1 == 'am' else 'am')
    if ap2 and not ap1:
        ap1 = ap2 if int(h1) <= int(h2) else ('am' if ap2 == 'pm' else 'pm')
    start = to_24h(h1, m1, ap1)
    end = to_24h(h2, m2, ap2)
    day_start = DAY_MAP[d1.lower()]
    day_end = DAY_MAP[d2.lower()]
    days = day_start if day_start == day_end else '{}-{}'.format(day_start, day_end)
    return '{} {}-{}'.format(days, start, end)

def pdftotext(pdf):
    try:
        result = subprocess.run(
            ['pdftotext', '-layout', str(pdf), '-'],
            capture_output=True, text=True, timeout=30,
        )
        return result.stdout
    except Exception:
        return ''

def ocr(pdf):
    base = TMP_DIR / pdf.stem
    subprocess.run(
        ['pdftoppm', '-r', '200', str(pdf), str(base), '-png'],
        capture_output=True, timeout=60,
    )
    text_parts = []
    for png in sorted(TMP_DIR.glob('{}-*.png'.format(pdf.stem))):
        result = subprocess.run(
            ['tesseract', str(png), '-'],
            capture_output=True, text=True, timeout=60,
        )
        text_parts.append(result.stdout)
    return '\n'.join(text_parts)

def extract_zone_name(text, zone_code):
    pattern = re.compile(
        r'([A-Z][A-Za-z\'\s\-]+?)\s*\(\s*' + re.escape(zone_code) + r'\s*\)',
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if m:
        name = m.group(1).strip()
        if 1 < len(name) < 60:
            return name
    return None

def process(pdf):
    zone_code = pdf.stem
    text = pdftotext(pdf)
    hours = parse_hours(text)
    method = 'pdftotext'
    if not hours:
        text_ocr = ocr(pdf)
        hours = parse_hours(text_ocr)
        if hours:
            text = text_ocr
            method = 'ocr'
        else:
            text = text + '\n' + text_ocr
            method = 'failed'
    name = extract_zone_name(text, zone_code)
    return {
        'zone_code': zone_code,
        'zone_name': name,
        'hours_osm_syntax': hours,
        'extraction_method': method,
    }

def main():
    pdfs = sorted(p for p in PDF_DIR.glob('*.pdf'))
    results = []
    for pdf in pdfs:
        sys.stderr.write('processing {}...\n'.format(pdf.name))
        results.append(process(pdf))
    print(json.dumps(results, indent=2))

if __name__ == '__main__':
    main()
