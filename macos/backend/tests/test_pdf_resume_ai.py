from pathlib import Path

import pytest
from pypdf import PdfReader

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.schemas import RuntimeResult
from applyos_harness.errors import HarnessError
from integrations.resume_pdf.ai_parser import parse_resume_with_model, redact_resume_text
from integrations.resume_pdf.importer import PdfResumeImporter


class ScriptedRuntime:
    def __init__(self, data: dict | None = None, error: Exception | None = None):
        self.data = data or {"sections": [], "warnings": []}
        self.error = error
        self.prompts: list[str] = []

    def generate(self, *, prompt, output_model, **_):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        output = output_model.model_validate(self.data)
        return output, RuntimeResult(
            data=output.model_dump(mode="json"),
            usage={"provider": "test-provider", "model": "test-model"},
        )


def _settings() -> AgentSettings:
    return AgentSettings(
        runtime=RuntimeMode.COMPATIBLE,
        model="test-model",
        workspace_root=Path.cwd(),
        api_key_configured=True,
        provider_name="test-provider",
        provider_base_url="https://example.invalid",
        provider_api_key="not-a-real-secret",
    )


def test_redaction_removes_direct_identifiers_and_restores_only_locally():
    source = "高子强\n电话：139-5054-5605 邮箱：cra3egzq@163.com\n身份证：42010619990101123X\n地址：湖北省武汉市武昌区测试路18号"
    redacted = redact_resume_text(source, {"name": "高子强"})

    assert "高子强" not in redacted.text
    assert "13950545605" not in redacted.text
    assert "139-5054-5605" not in redacted.text
    assert "cra3egzq@163.com" not in redacted.text
    assert "42010619990101123X" not in redacted.text
    assert "湖北省武汉市武昌区测试路18号" not in redacted.text
    assert {"姓名", "电话", "邮箱", "证件号码", "详细地址"} <= set(redacted.categories)
    assert redacted.restore(redacted.text) == source


def test_model_receives_only_redacted_text_and_returns_evidence_backed_fields():
    source = """高子强
电话：139-5054-5605 邮箱：cra3egzq@163.com
教育背景
2024.09 - 至今 中南财经政法大学 统计学 硕士 GPA 3.8/4.0
"""
    runtime = ScriptedRuntime({
        "sections": [{
            "title": "教育背景",
            "kind": "education",
            "items": [{
                "kind": "education",
                "start_date": "2024-09",
                "end_date": "至今",
                "title": "中南财经政法大学",
                "organization": "中南财经政法大学",
                "role": "统计学 硕士 GPA 3.8/4.0",
                "summary": "",
                "source_quotes": ["2024.09 - 至今 中南财经政法大学 统计学 硕士 GPA 3.8/4.0"],
                "confidence": 0.98,
                "warnings": [],
            }],
        }],
        "warnings": [],
    })

    result = parse_resume_with_model(source, {"name": "高子强"}, settings=_settings(), runtime=runtime)

    assert result.used is True
    assert result.provider == "test-provider"
    assert result.items[0]["fields"]["organization"] == "中南财经政法大学"
    sent = runtime.prompts[0]
    assert "高子强" not in sent
    assert "13950545605" not in sent
    assert "139-5054-5605" not in sent
    assert "cra3egzq@163.com" not in sent
    assert "<PERSON_1>" in sent
    assert "<PHONE_1>" in sent
    assert "<EMAIL_1>" in sent


def test_hallucinated_model_items_are_rejected_and_provider_errors_fall_back():
    source = "教育背景\n2024.09 - 至今 中南财经政法大学 统计学 硕士"
    hallucinating = ScriptedRuntime({
        "sections": [{
            "title": "工作经历",
            "kind": "experience",
            "items": [{
                "kind": "experience",
                "organization": "不存在科技有限公司",
                "source_quotes": ["2025.01 不存在科技有限公司 高级工程师"],
            }],
        }],
        "warnings": [],
    })
    rejected = parse_resume_with_model(source, {}, settings=_settings(), runtime=hallucinating)
    assert rejected.used is False
    assert rejected.items == []
    assert any("原文证据校验" in warning for warning in rejected.warnings)

    failing = ScriptedRuntime(error=HarnessError("provider_timeout", "secret provider error", retryable=True))
    fallback = parse_resume_with_model(source, {}, settings=_settings(), runtime=failing)
    assert fallback.used is False
    assert fallback.warnings == ["AI 识别失败（provider_timeout），已使用本地解析"]


def test_skill_subheadings_stay_in_one_editor_item():
    source = "专业技能\n数据分析：Python SQL\n统计知识：A/B Test\n综合能力：CET-6"
    runtime = ScriptedRuntime({
        "sections": [{
            "title": "专业技能",
            "kind": "skill",
            "items": [
                {"kind": "skill", "source_quotes": ["数据分析：Python SQL"], "confidence": 0.9},
                {"kind": "skill", "source_quotes": ["统计知识：A/B Test"], "confidence": 0.8},
                {"kind": "skill", "source_quotes": ["综合能力：CET-6"], "confidence": 0.85},
            ],
        }],
        "warnings": [],
    })

    result = parse_resume_with_model(source, {}, settings=_settings(), runtime=runtime)

    assert result.used is True
    assert len(result.items) == 1
    assert result.items[0]["source_text"] == "数据分析：Python SQL\n统计知识：A/B Test\n综合能力：CET-6"
    assert result.items[0]["confidence"] == 0.8


def test_real_resume_redaction_and_ai_preview_do_not_send_pdf_or_identity(database):
    source = Path(__file__).resolve().parents[2] / "test use" / "高子强的简历.pdf"
    if not source.exists():
        pytest.skip("private real-resume fixture is not present")
    text = "\n".join(page.extract_text(extraction_mode="layout") or "" for page in PdfReader(source).pages)
    education_quote = next(line.strip() for line in text.splitlines() if "中南财经政法大学" in line and "2024" in line)
    runtime = ScriptedRuntime({
        "sections": [{
            "title": "教育背景",
            "kind": "education",
            "items": [{
                "kind": "education",
                "organization": "中南财经政法大学",
                "source_quotes": [education_quote],
                "confidence": 0.9,
            }],
        }],
        "warnings": [],
    })

    preview = PdfResumeImporter(database, settings=_settings(), runtime=runtime).preview(source, ai_enhanced=True)

    assert preview["recognition_mode"] == "ai_enhanced"
    assert "姓名" in preview["redacted_fields"]
    assert len(preview["experiences"]) >= 7
    sent = runtime.prompts[0]
    assert str(source) not in sent
    assert "%PDF" not in sent
    assert "高子强" not in sent
    assert "13950545605" not in sent
    assert "139-5054-5605" not in sent
    assert "cra3egzq@163.com" not in sent
