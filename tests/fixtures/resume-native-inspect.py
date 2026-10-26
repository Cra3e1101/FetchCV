"""Read the smoke test's PDF to verify Chinese text and embedded fonts."""
from __future__ import annotations

import json
import sys

from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
fonts = {}
for page in reader.pages:
    resources = page["/Resources"].get_object().get("/Font", {})
    resources = resources.get_object() if hasattr(resources, "get_object") else resources
    for reference in resources.values():
        font = reference.get_object()
        name = str(font.get("/BaseFont", ""))
        descendants = font.get("/DescendantFonts") or []
        actual = descendants[0].get_object() if descendants else font
        descriptor = actual.get("/FontDescriptor")
        descriptor = descriptor.get_object() if descriptor else {}
        fonts[name] = any(key in descriptor for key in ("/FontFile", "/FontFile2", "/FontFile3"))
text = "\n".join(page.extract_text() for page in reader.pages)
print(json.dumps({"pages": len(reader.pages), "text": text, "fonts": fonts}))
