"""Versioned synthetic parser corpus; no personal data or human quality claims."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import zipfile
from html import escape

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from workers.parser.formats import parse_bytes
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw

root = Path(os.environ['M1_ALLOWED_DELETE_ROOT']).resolve()
assert root.is_dir()
corpus = root / 'parser-corpus'
corpus.mkdir()
deletions = []

def audit(event, args):
    if event in ('os.remove', 'os.rmdir', 'os.rename'):
        deletions.append({'event': event, 'path': str(args[0])})
        raise RuntimeError('corpus generation never deletes or moves files')
    if event == 'open' and isinstance(args[0], (str, bytes)):
        flags = args[2]
        if isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            target = Path(os.fsdecode(args[0])).resolve()
            if not target.is_relative_to(root):
                raise RuntimeError('write outside synthetic corpus root')
sys.addaudithook(audit)

def save(name, data):
    with (corpus / name).open('xb') as stream:
        stream.write(data)
    return hashlib.sha256(data).hexdigest()

def locator_errors(ir, facts, fmt, scanned=False):
    text, errors = ir['source_text'], []
    for block in ir['blocks']:
        start, end = block['charStart'], block['charEnd']
        if not (0 <= start < end <= len(text)) or text[start:end] != block['text']: errors.append('invalid_quote_range')
        if len(block['indexMap']) != len(block['index_text']) or any(not start <= n < end for n in block['indexMap']): errors.append('invalid_index_map')
        if not block.get('originRef', {}).get('type'): errors.append('missing_origin')
        if fmt == 'pdf' and block['page'] not in (1, 2): errors.append('invalid_page')
    if not scanned:
        for fact in facts:
            located = False
            for block in ir['blocks']:
                offset = block['text'].find(fact)
                start = block['charStart'] + offset
                if offset >= 0 and text[start:start+len(fact)] == fact:
                    located = True
                    break
            if not located: errors.append('fact_without_matching_block')
    return errors

# Prove the checker rejects facts retained in source_text but lost from blocks.
probe = {'source_text': 'fact', 'blocks': [{'text': 'fact', 'charStart': 0, 'charEnd': 4,
         'index_text': 'fact', 'indexMap': [0, 1, 2, 3], 'originRef': {'type': 'text'}}]}
assert locator_errors(probe, ['fact'], 'txt') == []
assert 'fact_without_matching_block' in locator_errors({'source_text': 'fact', 'blocks': []}, ['fact'], 'txt')

def pdf(lines, scanned, index):
    output = io.BytesIO()
    canvas = Canvas(output, pagesize=(600, 800), invariant=1)
    if scanned:
        image = Image.new('RGB', (600, 400), 'white')
        draw = ImageDraw.Draw(image)
        for n, line in enumerate(lines):
            draw.text((20, 20 + n * 40), line, fill='black')
        canvas.drawImage(ImageReader(image), 0, 300, width=600, height=400)
    else:
        for n, line in enumerate(lines):
            canvas.drawString(30, 750 - n * 35, line)
        if index % 2:
            canvas.showPage()
            canvas.drawString(30, 750, f'Appendix {index}: no additional achievement claims.')
    canvas.showPage()
    canvas.save()
    return output.getvalue()

def docx(lines):
    paragraph = lambda value: '<w:p><w:r><w:t xml:space="preserve">' + escape(value) + '</w:t></w:r></w:p>'
    rows = ''.join('<w:tr><w:tc>' + paragraph(line) + '</w:tc><w:tc>' + paragraph(str(i)) + '</w:tc></w:tr>' for i, line in enumerate(lines[1:]))
    xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraph(lines[0]) + '<w:tbl>' + rows + '</w:tbl></w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr('word/document.xml', xml)
    return buffer.getvalue()

manifest, results = [], []
for kind in ('text-pdf', 'scan-pdf', 'docx', 'html', 'md', 'chat'):
    for i in range(10):
        identity = f'{kind}-{i:02d}'
        facts = [f'Record {identity}; synthetic only.', f'Project {1000+i}: processed {17+i} records.',
                 f'Period 2026-{i+1:02d}; NOT a revenue improvement.', f'Permission: candidate-{i}; scope is not public.']
        if kind not in ('text-pdf', 'scan-pdf'):
            facts.append(f'中文定位😀：编号 {200+i}；未声称增长。')
        fmt = 'pdf' if kind.endswith('pdf') else kind
        extension = 'json' if kind == 'chat' else fmt
        if fmt == 'pdf': data = pdf(facts, kind == 'scan-pdf', i)
        elif fmt == 'docx': data = docx(facts)
        elif fmt == 'html': data = ('<h1>' + escape(facts[0]) + '</h1><table>' + ''.join('<tr><td>'+escape(f)+'</td></tr>' for f in facts[1:]) + '</table><script>EXCLUDED_SECRET_SYNTHETIC</script>').encode()
        elif fmt == 'md': data = ('# ' + facts[0] + '\n\n' + '\n\n'.join(facts[1:])).encode()
        else: data = json.dumps([{'id': f'm{n}', 'role': 'user' if n % 2 == 0 else 'assistant', 'text': f} for n, f in enumerate(facts)], ensure_ascii=False).encode()
        filename = f'{identity}.{extension}'
        # Freeze each expectation file before observing the parser output.
        record = {'id': identity, 'family': identity, 'format': kind, 'parserFormat': fmt, 'file': filename,
                  'sha256': save(filename, data), 'facts': facts, 'annotationOrigin': 'synthetic', 'humanReviewed': False}
        manifest.append(record)
        save(f'{identity}.expected.json', json.dumps(record, ensure_ascii=False, indent=2).encode())
        ir = parse_bytes(data, fmt)
        save(f'{identity}.ir.json', json.dumps(ir, ensure_ascii=False, indent=2).encode())
        text = ir['source_text']
        recovered = sum(fact in text for fact in facts)
        scanned = kind == 'scan-pdf'
        errors = locator_errors(ir, facts, fmt, scanned)
        passed = not errors and (ir['quality']['status'] == 'needs_review' and ir['quality']['ocrRequired'] and not text.strip() if scanned else recovered == len(facts) and ir['quality']['status'] == 'ready')
        if kind == 'html' and 'EXCLUDED_SECRET_SYNTHETIC' in text: passed = False
        results.append({'id': identity, 'format': kind, 'facts': len(facts), 'factsRecovered': recovered,
                        'blocks': len(ir['blocks']), 'locatorErrors': errors, 'quality': ir['quality'], 'passed': passed})

save('manifest.json', json.dumps({'revision': 'synthetic-parser-corpus-2', 'sources': manifest}, ensure_ascii=False, indent=2).encode())
report = {'revision': 'synthetic-parser-corpus-2', 'sources': len(results), 'passed': all(r['passed'] for r in results),
          'results': results, 'deletions': deletions, 'formalM5ToM8Complete': False,
          'limitations': ['templated synthetic fixtures; no human semantic or layout validation',
                          'in-process production parse_bytes; not a repeated AppContainer isolation test',
                          'text PDF facts are ASCII; Chinese/emoji covered in DOCX/HTML/MD/chat only',
                          'scan fixtures contain raster text but OCR is not run; needs_review is the expected safe outcome',
                          'exact fact-string coverage is not full table-cell or visual layout fidelity',
                          'Python deletion audit covers events after hook installation, not earlier dependency imports',
                          'no sealed 400-query or 100-dialogue benchmark is claimed']}
save('report.json', json.dumps(report, ensure_ascii=False, indent=2).encode())
print(json.dumps({'sources': len(results), 'passed': report['passed'], 'failed': [r['id'] for r in results if not r['passed']], 'report': str(corpus / 'report.json')}))
sys.exit(0 if report['passed'] else 2)
