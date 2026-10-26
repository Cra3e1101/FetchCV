from types import SimpleNamespace

import pytest

from applyos_harness.errors import HarnessError
from integrations.resume.native_artifacts import _require_pdf_prose


class ExtractedPage:
    def __init__(self, plain, layout):
        self.plain, self.layout = plain, layout

    def extract_text(self, **options):
        return self.layout if options.get("extraction_mode") == "layout" else self.plain


def snapshot(body):
    return {"sections": [{"id": "skills", "items": [{"body": body}]}]}


def test_native_prose_retains_math_order_and_recovers_kerned_words_without_removing_spaces():
    reader = SimpleNamespace(pages=[ExtractedPage("A/B T est | T ableau | W orkflow\nOnly assisted, R2 = 0.92", "A/B Test | Tableau | Workflow\n2\nOnly assisted, R = 0.92")])
    _require_pdf_prose(reader, snapshot("A/B Test | Tableau | Workflow<br>Only assisted, R^2 = 0.92"))


@pytest.mark.parametrize("expected,rendered", [
    ("I only supported the analysis.", "I supported the analysis."),
    ("I did not lead the project.", "I did lead the project."),
    ("not able to lead", "notable to lead"),
])
def test_native_prose_still_rejects_missing_qualifiers_and_changed_word_boundaries(expected, rendered):
    reader = SimpleNamespace(pages=[ExtractedPage(rendered, rendered)])
    with pytest.raises(HarnessError, match="排版未完整保留"):
        _require_pdf_prose(reader, snapshot(expected))
