"""Synthetic parser checks; all fixtures live in memory, no personal documents."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import io
import json
import zipfile
from workers.parser.formats import parse_bytes

deletions = []
def audit(event, args):
    if event in ('os.remove', 'os.rmdir', 'os.rename'):
        deletions.append(event)
        raise RuntimeError('parser fixture must never delete or move a file')
sys.addaudithook(audit)
checks = 0
def check(condition):
    global checks
    assert condition
    checks += 1
def valid(result):
    text = result['source_text']
    for block in result['blocks']:
        check(text[block['charStart']:block['charEnd']] == block['text'])
        check(len(block['indexMap']) == len(block['index_text']))
        check(all(block['charStart'] <= n < block['charEnd'] for n in block['indexMap']))
    return result
def rejected(data, fmt):
    try: parse_bytes(data, fmt)
    except ValueError: check(True)
    else: raise AssertionError('hostile input was accepted')

r = valid(parse_bytes('# 经历\n\nＳＱＬ😀 2026\r\n无业绩数字'.encode(), 'md'))
check('ＳＱＬ😀' in r['source_text']); check('sql😀' in ''.join(b['index_text'] for b in r['blocks']))
check(r['blocks'][1]['headingPath'] == ['经历'])
r = valid(parse_bytes('<h1>经历</h1><p>SQL &amp; 数据</p><script>EVIL</script><style>HIDDEN</style><table><tr><th>年</th><th>事</th></tr><tr><td>2026</td><td>分析</td></tr></table>'.encode(), 'html'))
check('EVIL' not in r['source_text'] and 'HIDDEN' not in r['source_text'])
check(any(b['type'] == 'table' for b in r['blocks']))
def docx(xml, extra=None):
    b = io.BytesIO()
    with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('word/document.xml', xml)
        if extra: z.writestr(*extra)
    return b.getvalue()
xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>经历</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>中文😀</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
r = valid(parse_bytes(docx(xml), 'docx')); check(r['blocks'][1]['text'] == '中文😀\t30')
check(r['blocks'][1]['originRef']['row'] == 0)
# Cell paragraphs must remain distinct; concatenating them can merge facts.
multi = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目 A：10</w:t></w:r></w:p><w:p><w:r><w:t>项目 B：20😀</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>未上线</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
r = valid(parse_bytes(docx(multi), 'docx'))
check(r['source_text'] == '项目 A：10\n项目 B：20😀\t未上线')
check(r['blocks'][0]['originRef']['cells'] == ['项目 A：10\n项目 B：20😀', '未上线'])
rejected(docx(xml, ('../escape','bad')), 'docx')
rejected(docx(xml, ('word/bomb', 'A'*2_000_000)), 'docx')
rejected(docx('<!DOCTYPE x [<!ENTITY a "bad">]>'+xml), 'docx')
rejected(b'not a pdf','pdf'); rejected(b'\x00\xff','txt')
rejected(b'{}', 'exe')
r = valid(parse_bytes('中文 UTF16'.encode('utf-16'), 'txt')); check(r['source_text']=='中文 UTF16')
from reportlab.pdfgen.canvas import Canvas
b = io.BytesIO(); c = Canvas(b); c.drawString(40,700,'SQL 2026 NOT 30 percent'); c.showPage(); c.save()
r = valid(parse_bytes(b.getvalue(), 'pdf')); check('SQL 2026 NOT 30 percent' in r['source_text']); check(r['blocks'][0]['page']==1)
b = io.BytesIO(); c = Canvas(b); c.showPage(); c.save()
r = parse_bytes(b.getvalue(), 'pdf'); check(r['quality']['status']=='needs_review'); check(r['quality']['ocrRequired'])
r=valid(parse_bytes(json.dumps([{'id':'m1','role':'user','text':'记住：一页简历'}],ensure_ascii=False).encode(),'chat'))
check(r['blocks'][0]['originRef']['messageId']=='m1')
print(json.dumps({'checks':checks,'deletions':len(deletions)}))
