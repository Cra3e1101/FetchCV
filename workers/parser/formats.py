"""Deterministic local parsing; no model, database, path resolution or network.

IR locations address Unicode codepoints in source_text. Original bytes remain
the host's immutable blob. index_text is never substituted for quotation text.
"""
import io
import json
import logging
import re
import unicodedata
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

REVISION = 'local-structured-1.2'
MAX_BYTES = 50 * 1024 * 1024
MAX_TEXT = 2_000_000

class PDFWarnings(logging.Handler):
    """Do not copy library log text into evidence or persist document content."""
    def __init__(self):
        super().__init__(logging.WARNING)
        self.seen = False
    def emit(self, record):
        self.seen = True

def decode(data):
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        text = data.decode('utf-16')
    else:
        text = data.decode('utf-8-sig')
    if '\0' in text: raise ValueError('binary_text')
    return text

def indexed(text, start):
    output, mapping = [], []
    for index, char in enumerate(text):
        normalized = unicodedata.normalize('NFKC', char).casefold()
        for value in normalized:
            output.append(value)
            mapping.append(start + index)
    return ''.join(output), mapping

class IR:
    def __init__(self):
        self.text, self.blocks, self.headings = '', [], []
        self.quality = {'status':'ready', 'ocrRequired':False, 'layoutVerified':False}
    def add(self, text, kind='text', origin=None, page=None, level=None):
        if not text.strip(): return
        if len(self.text) + len(text) + 2 > MAX_TEXT: raise ValueError('text_limit')
        if kind == 'heading':
            self.headings = self.headings[:max(0, (level or 1)-1)] + [text]
        if self.blocks: self.text += '\n\n'
        start = len(self.text)
        self.text += text
        index_text, mapping = indexed(text, start)
        self.blocks.append({'id':str(len(self.blocks)), 'type':kind, 'order':len(self.blocks),
            'text':text, 'index_text':index_text, 'indexMap':mapping, 'prompt_text':text,
            'charStart':start, 'charEnd':len(self.text), 'page':page, 'bbox':None,
            'headingPath':list(self.headings), 'originRef':origin or {}, 'quality':{'verified':False}})
    def result(self, fmt):
        return {'schemaVersion':1,'parserId':'fetchcv-local','parserRevision':REVISION,
            'format':fmt,'offsetUnit':'unicode_codepoint','source_text':self.text,
            'blocks':self.blocks,'quality':self.quality}

class HTMLBlocks(HTMLParser):
    def __init__(self, ir):
        super().__init__(convert_charrefs=True)
        self.ir, self.buffer, self.kind, self.level, self.skip = ir, [], 'text', None, 0
        self.cell = False
    def flush(self):
        text = ''.join(self.buffer).strip()
        self.ir.add(text, self.kind, {'type':'html-element','ordinal':len(self.ir.blocks)}, level=self.level)
        self.buffer = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript','template'):
            self.skip += 1
            return
        if self.skip: return
        if tag in ('p','div','section','li','tr','h1','h2','h3','h4','h5','h6'):
            self.flush()
            self.kind = 'table' if tag=='tr' else 'list' if tag=='li' else 'heading' if re.fullmatch(r'h[1-6]',tag) else 'text'
            self.level = int(tag[1]) if self.kind=='heading' else None
            self.cell = False
        elif tag in ('td','th'):
            if self.cell: self.buffer.append('\t')
            self.cell = True
        elif tag == 'br': self.buffer.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript','template'):
            self.skip = max(0,self.skip-1)
        elif not self.skip and tag in ('p','div','section','li','tr','h1','h2','h3','h4','h5','h6'):
            self.flush()
    def handle_data(self, data):
        if not self.skip: self.buffer.append(data)

def parse_docx(data, ir):
    ns = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos)>2000 or sum(i.file_size for i in infos)>100*1024*1024: raise ValueError('zip_limit')
        names = set()
        for item in infos:
            name = item.filename.replace('\\','/')
            if name in names or name.startswith('/') or ':' in name or '..' in name.split('/') or item.flag_bits & 1:
                raise ValueError('unsafe_zip_member')
            if item.file_size>20*1024*1024 or item.file_size/max(1,item.compress_size)>200: raise ValueError('zip_expansion_limit')
            names.add(name)
        xml = archive.read('word/document.xml')
        if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper(): raise ValueError('xml_dtd_forbidden')
        root = ET.fromstring(xml)
        body = root.find('w:body',ns)
        if body is None: raise ValueError('docx_body_missing')
        def text(node):
            result=[]
            paragraph_seen = False
            for element in node.iter():
                if element.tag==f"{{{ns['w']}}}p":
                    if paragraph_seen: result.append('\n')
                    paragraph_seen = True
                elif element.tag==f"{{{ns['w']}}}t": result.append(element.text or '')
                elif element.tag==f"{{{ns['w']}}}tab": result.append('\t')
                elif element.tag==f"{{{ns['w']}}}br": result.append('\n')
            return ''.join(result)
        for index, node in enumerate(body):
            if node.tag.endswith('}p'):
                style = node.find('w:pPr/w:pStyle',ns)
                heading = re.fullmatch(r'Heading([1-9])',style.get(f"{{{ns['w']}}}val",''),re.I) if style is not None else None
                ir.add(text(node),'heading' if heading else 'text',{'type':'docx-paragraph','paragraph':index},level=int(heading[1]) if heading else None)
            elif node.tag.endswith('}tbl'):
                for row_index, row in enumerate(node.findall('w:tr',ns)):
                    cells = [text(cell) for cell in row.findall('w:tc',ns)]
                    ir.add('\t'.join(cells),'table',{'type':'docx-table-row','table':index,'row':row_index,'cells':cells})

def parse_bytes(data, fmt):
    if not isinstance(data,bytes) or len(data)>MAX_BYTES: raise ValueError('file_size_limit')
    ir = IR()
    if fmt in ('txt','md'):
        text = decode(data)
        for ordinal, paragraph in enumerate(re.split(r'\r?\n\s*\r?\n',text)):
            heading = re.fullmatch(r'(#{1,6})\s+([^\r\n]+)',paragraph) if fmt=='md' else None
            ir.add(heading[2] if heading else paragraph,'heading' if heading else 'text',
                   {'type':'paragraph','ordinal':ordinal},level=len(heading[1]) if heading else None)
    elif fmt=='html':
        parser=HTMLBlocks(ir); parser.feed(decode(data)); parser.close(); parser.flush()
    elif fmt=='docx':
        if not data.startswith(b'PK'): raise ValueError('format_mismatch')
        parse_docx(data,ir)
    elif fmt=='pdf':
        if not data.startswith(b'%PDF-'): raise ValueError('format_mismatch')
        from pypdf import PdfReader
        reader=PdfReader(io.BytesIO(data),strict=True)
        if reader.is_encrypted: raise ValueError('encrypted_pdf')
        if len(reader.pages)>500: raise ValueError('page_limit')
        for number,page in enumerate(reader.pages,1):
            contents=page.get_contents()
            if contents is not None and len(contents.get_data())>16*1024*1024: raise ValueError('pdf_stream_limit')
            warnings = PDFWarnings()
            logger = logging.getLogger('pypdf')
            logger.addHandler(warnings)
            try:
                text=page.extract_text(extraction_mode='layout',layout_mode_strip_rotated=False) or ''
            finally:
                logger.removeHandler(warnings)
                warnings.close()
            if warnings.seen:
                ir.quality.update(status='needs_review',layoutWarning=True)
            if len(text.strip())<10:
                ir.quality.update(status='needs_review',ocrRequired=True)
            ir.add(text,'text',{'type':'pdf-page','page':number,'rotation':page.rotation},page=number)
    elif fmt=='chat':
        messages=json.loads(decode(data))
        if not isinstance(messages,list) or len(messages)>10000: raise ValueError('invalid_chat')
        for message in messages:
            if not isinstance(message,dict) or message.get('role') not in ('user','assistant','tool') or not isinstance(message.get('text'),str) or not isinstance(message.get('id'),str):
                raise ValueError('invalid_chat')
            ir.add(message['text'],'text',{'type':'chat-message','messageId':message['id'],'role':message['role']})
    else: raise ValueError('unsupported_format')
    if not ir.text.strip(): ir.quality['status']='needs_review'
    return ir.result(fmt)
