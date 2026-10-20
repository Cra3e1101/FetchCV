"""Synthetic layout stress cases, with expectations fixed before parsing."""
import io
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from reportlab.pdfgen.canvas import Canvas
from workers.parser.formats import parse_bytes

def audit(event, args):
    if event in ('os.remove', 'os.rmdir', 'os.rename'):
        raise RuntimeError('layout fixture must not delete or move files')
sys.addaudithook(audit)
rows = []
for index in range(10):
    expected = []
    stream = io.BytesIO()
    canvas = Canvas(stream, pagesize=(600, 800), invariant=1)
    def line(x, y, value):
        expected.append(value)
        canvas.drawString(x, y, value)
    line(30, 760, f'Synthetic layout {index}; no real candidate')
    for column in range(2):
        for row in range(3):
            line(30 + 290 * column, 710 - row * 25, f'C{column}R{row}: NOT revenue {index*100+row}')
    for row in range(3):
        for column in range(2):
            line(30 + 260 * column, 570 - row * 25, f'CELL-{index}-{row}-{column}')
    canvas.saveState()
    canvas.translate(550, 120)
    canvas.rotate(90)
    line(0, 0, f'ROTATED-{index}: 17 NOT 71')
    canvas.restoreState()
    canvas.showPage()
    canvas.save()
    data = stream.getvalue()
    if index == 0:
        with (Path(os.environ['M1_ALLOWED_DELETE_ROOT'])/'rotated-layout.pdf').open('xb') as output:
            output.write(data)
    ir = parse_bytes(data, 'pdf')
    recovered = [fact for fact in expected if fact in ir['source_text']]
    bad_ranges = [b['id'] for b in ir['blocks'] if ir['source_text'][b['charStart']:b['charEnd']] != b['text']]
    rows.append({'id':index, 'expected':len(expected), 'recovered':len(recovered),
        'missing':[fact for fact in expected if fact not in recovered], 'badRanges':bad_ranges,
        'quality':ir['quality']})
report = {'documents':len(rows), 'expected':sum(r['expected'] for r in rows),
    'recovered':sum(r['recovered'] for r in rows), 'results':rows,
    'limitations':['ASCII synthetic text, not human layout scoring', 'checks exact cell strings, not visual row/column association', 'no OCR or full golden quality claim']}
with (Path(os.environ['M1_ALLOWED_DELETE_ROOT'])/'pdf-layout-report.json').open('x',encoding='utf-8') as output:
    json.dump(report, output, indent=2)
print(json.dumps(report))
assert report['recovered'] == report['expected'], 'PDF silently omitted fixture facts'
assert all(not r['badRanges'] for r in rows), 'invalid source ranges'
