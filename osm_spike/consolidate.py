#!/usr/bin/env python3
"""Build the final WF CPZ hours JSON.

Sources, in priority order:
  1. extracted_raw.json — pdftotext + 200dpi OCR (49 zones initially)
  2. high-res OCR rescues (5 zones)
  3. Manual Read-tool extractions (4 zones)
  4. Confirmed-unknown PDFs (5 zones with no hours on the map)
  5. No PDF found (21 zones — sourced from web search where possible)
"""

import json
from pathlib import Path

OSM_ZONES = [
    'MW', 'LSE', 'VFR', 'BL', 'HH', 'CHE', 'HS', 'HHN', 'VA', 'WXS(w)',
    'CH', 'KS', 'MH', 'SB(n)', 'CTN', 'WSE', 'CF', 'WSN', 'LBR', 'GGW',
    'GS', 'BP', 'OL', 'AM', 'BA', 'LSW', 'GGE', 'LH', 'FSR', 'LNS',
    'WSC', 'WSS', 'QB', 'LNN', 'GM', 'CHN', 'LPW', 'HF', 'HHE', 'MR',
    'LSN', 'SB(s)', 'LPN', 'FRN', 'GGS', 'CTS', 'WA', 'CML', 'SJP', 'FR',
    'HT', 'CE', 'HE', 'ML', 'HST', 'BLN', 'BWR', 'LNW', 'WXN', 'LPE',
    'LNE', 'WS', 'BR', 'TS', 'GGN', 'NC', 'HPS', 'WR', 'LSS', 'WD',
    'SNW', 'LS', 'MD', 'MC', 'RC', 'WXS(e)', 'CL', 'LK', 'Jacks Farm RPZ',
    'SR', 'TU', 'RA', 'TR', 'H-TD', 'FGN', 'CG',
]

# OSM uses parens; PDF filenames don't. Map OSM -> PDF stem.
OSM_TO_PDF_STEM = {
    'WXS(w)': 'WXSw',
    'WXS(e)': 'WXSe',
    'SB(n)': 'SBn',
    'SB(s)': 'SBs',
}

# Manual extractions via Read tool
MANUAL_READ = {
    'BL':  {'name': 'Blackhorse Lane',     'hours': 'Mo-Sa 08:00-18:30', 'source': 'pdf_read'},
    'BR':  {'name': 'Blackhorse Road',     'hours': 'Mo-Sa 08:00-18:30', 'source': 'pdf_read'},
    'LBR': {'name': 'Lea Bridge Road',     'hours': 'Mo-Sa 08:00-18:30', 'source': 'pdf_read'},
    'QB':  {'name': "Queen's Road Boundary Road",
            'hours': 'Mo-Fr 08:00-12:30, 14:30-18:30; Sa 08:00-18:30',
            'source': 'pdf_read'},
}

# Higher-res OCR rescues (extracted but only at -r 400)
HIRES_OCR = {
    'LNW': {'hours': 'Mo-Fr 10:00-16:00'},
    'MR':  {'hours': 'Mo-Sa 08:00-18:30'},
    'NC':  {'hours': 'Mo-Fr 10:00-16:00'},
    'SJP': {'hours': 'Mo-Fr 08:00-18:30'},
    'WSS': {'hours': 'Mo-Fr 10:00-16:00'},
}

# Confirmed by reading PDF — newer-style maps have NO hours text on the PDF
PDF_HAS_NO_HOURS = {
    'HST': 'High Street',
    'HT':  'Hilltop',
    'MH':  'Markhouse',
    'VA':  'Village Area',
    'WSC': 'Walthamstow Central',
}

# From web search results
WEB_SEARCH = {
    'TU': {'name': 'Tudor Road', 'hours': 'Mo-Su 07:30-22:30', 'note': '7-day operation, no weekend free period'},
    'AM': {'name': None,         'hours': 'Mo-Fr 08:00-18:30'},
}


def load_extracted():
    raw = json.loads(Path('/Users/dxwz/Projects/parking-finder/osm_spike/extracted_raw.json').read_text())
    return {r['zone_code']: r for r in raw}


def osm_to_pdf(osm):
    return OSM_TO_PDF_STEM.get(osm, osm)


def build():
    extracted = load_extracted()
    out = {}

    for osm_code in OSM_ZONES:
        pdf_stem = osm_to_pdf(osm_code)
        rec = {
            'osm_zone_tag': osm_code,
            'pdf_stem': pdf_stem,
            'zone_name': None,
            'hours_osm_syntax': None,
            'source': None,
            'pdf_url': None,
            'note': None,
        }

        # Manual Read tool extractions
        if pdf_stem in MANUAL_READ:
            m = MANUAL_READ[pdf_stem]
            rec.update(zone_name=m['name'], hours_osm_syntax=m['hours'], source=m['source'])
        # High-res OCR rescues
        elif pdf_stem in HIRES_OCR:
            rec.update(hours_osm_syntax=HIRES_OCR[pdf_stem]['hours'], source='ocr_400dpi')
            if pdf_stem in extracted:
                rec['zone_name'] = extracted[pdf_stem].get('zone_name')
        # Web search
        elif pdf_stem in WEB_SEARCH:
            w = WEB_SEARCH[pdf_stem]
            rec.update(zone_name=w.get('name'), hours_osm_syntax=w['hours'], source='web_search')
            if 'note' in w:
                rec['note'] = w['note']
        # Auto-extracted via pdftotext or 200dpi OCR
        elif pdf_stem in extracted:
            e = extracted[pdf_stem]
            rec.update(
                zone_name=e.get('zone_name'),
                hours_osm_syntax=e.get('hours_osm_syntax'),
                source=e.get('extraction_method'),
            )
            # PDFs that visually have no hours text (newer-style)
            if pdf_stem in PDF_HAS_NO_HOURS:
                rec['zone_name'] = PDF_HAS_NO_HOURS[pdf_stem]
                rec['source'] = 'pdf_has_no_hours'
                rec['note'] = 'PDF map shows boundary only; hours not on PDF — needs separate source'
        else:
            rec['source'] = 'no_pdf_found'
            rec['note'] = 'No PDF discovered at standard URL patterns; needs manual sourcing'

        out[osm_code] = rec

    return out


def main():
    data = build()
    output_path = Path('/Users/dxwz/Projects/parking-finder/osm_spike/waltham_forest_cpz_hours.json')
    output_path.write_text(json.dumps({
        'generated_at': '2026-05-10',
        'borough': 'London Borough of Waltham Forest',
        'osm_zone_count': len(data),
        'with_hours': sum(1 for r in data.values() if r['hours_osm_syntax']),
        'without_hours': sum(1 for r in data.values() if not r['hours_osm_syntax']),
        'zones': data,
    }, indent=2))

    # Summary
    by_source = {}
    for r in data.values():
        by_source.setdefault(r['source'], 0)
        by_source[r['source']] += 1

    print('zones total:', len(data))
    print('with hours:', sum(1 for r in data.values() if r['hours_osm_syntax']))
    print('without hours:', sum(1 for r in data.values() if not r['hours_osm_syntax']))
    print()
    print('breakdown by source:')
    for s, n in sorted(by_source.items(), key=lambda x: -x[1]):
        print('  {:<25} {}'.format(s or 'None', n))
    print()
    print('zones still missing hours:')
    for code, r in sorted(data.items()):
        if not r['hours_osm_syntax']:
            print('  {:<20} ({})'.format(code, r['source']))

if __name__ == '__main__':
    main()
