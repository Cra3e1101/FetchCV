from __future__ import annotations

from dataclasses import dataclass, field
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.runtime import AgentRuntime, build_runtime
from applyos_harness.errors import HarnessError


ResumeKind = Literal["education", "experience", "project", "skill", "campus", "award", "summary"]


class AiResumeItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ResumeKind
    start_date: str = ""
    end_date: str = ""
    title: str = ""
    organization: str = ""
    role: str = ""
    summary: str = ""
    source_quotes: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)


class AiResumeSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    kind: ResumeKind
    items: list[AiResumeItem] = Field(default_factory=list)


class AiResumeStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sections: list[AiResumeSection] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class RedactedResume:
    text: str
    placeholders: dict[str, str]
    categories: list[str]

    def restore(self, value: str) -> str:
        restored = str(value or "")
        for placeholder, original in self.placeholders.items():
            restored = restored.replace(placeholder, original)
        return restored


@dataclass
class AiParsingResult:
    used: bool = False
    items: list[dict] = field(default_factory=list)
    provider: str = ""
    model: str = ""
    redacted_fields: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _replace_matches(
    text: str,
    pattern: re.Pattern[str],
    category: str,
    placeholders: dict[str, str],
) -> str:
    values: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        value = match.group(0)
        if value not in values:
            placeholder = f"<{category}_{len(values) + 1}>"
            values[value] = placeholder
            placeholders[placeholder] = value
        return values[value]

    return pattern.sub(replace, text)


def redact_resume_text(text: str, profile: dict[str, str] | None = None) -> RedactedResume:
    """Remove direct identifiers locally while preserving stable references."""
    redacted = str(text or "")
    placeholders: dict[str, str] = {}
    categories: list[str] = []

    name = str((profile or {}).get("name") or "").strip()
    if len(name) >= 2 and name in redacted:
        placeholders["<PERSON_1>"] = name
        redacted = redacted.replace(name, "<PERSON_1>")
        categories.append("姓名")

    patterns = [
        ("EMAIL", "邮箱", re.compile(r"(?i)(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])")),
        ("PHONE", "电话", re.compile(r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)")),
        ("ID", "证件号码", re.compile(r"(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\d)")),
    ]
    for placeholder_type, label, pattern in patterns:
        before = len(placeholders)
        redacted = _replace_matches(redacted, pattern, placeholder_type, placeholders)
        if len(placeholders) > before:
            categories.append(label)

    address_pattern = re.compile(r"(?m)(?<=地址[：:])[^\n]{5,80}|(?<=住址[：:])[^\n]{5,80}")
    before = len(placeholders)
    redacted = _replace_matches(redacted, address_pattern, "ADDRESS", placeholders)
    if len(placeholders) > before:
        categories.append("详细地址")

    return RedactedResume(text=redacted, placeholders=placeholders, categories=categories)


def _evidence_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).lower()
    normalized = normalized.replace("至今", "present").replace("现在", "present")
    normalized = re.sub(r"[年月./~—–至到]", "-", normalized)
    return re.sub(r"[^a-z0-9\u4e00-\u9fff<>_-]", "", normalized)


def _supported(value: str, evidence: str) -> bool:
    key = _evidence_key(value)
    return not key or (len(key) >= 2 and key in _evidence_key(evidence))


def _supported_quote(quote: str, source_text: str) -> bool:
    key = _evidence_key(quote)
    return len(key) >= 4 and key in _evidence_key(source_text)


def _validated_field(value: str, evidence: str) -> str:
    value = str(value or "").strip()
    return value if _supported(value, evidence) else ""


def _validate_structure(structure: AiResumeStructure, redacted: RedactedResume) -> tuple[list[dict], list[str]]:
    accepted: list[dict] = []
    warnings: list[str] = list(structure.warnings)
    rejected = 0
    for section in structure.sections:
        for item in section.items:
            quotes = [quote.strip() for quote in item.source_quotes if _supported_quote(quote, redacted.text)]
            if not quotes:
                rejected += 1
                continue
            evidence = "\n".join(quotes)
            fields = {
                key: _validated_field(getattr(item, key), evidence)
                for key in ("start_date", "end_date", "title", "organization", "role", "summary")
            }
            section_title = section.title.strip() if _supported(section.title, redacted.text) else ""
            accepted.append(
                {
                    "kind": item.kind or section.kind,
                    "section_title": redacted.restore(section_title),
                    "source_text": redacted.restore(evidence),
                    "fields": {key: redacted.restore(value) for key, value in fields.items()},
                    "confidence": item.confidence,
                    "warnings": list(item.warnings),
                }
            )
    if rejected:
        warnings.append(f"{rejected} 条模型结果缺少可核对的原文证据，已忽略")
    return _coalesce_skill_items(accepted), warnings


def _coalesce_skill_items(items: list[dict]) -> list[dict]:
    """The source editor renders one skill block with multiple subheadings."""
    merged: list[dict] = []
    skill_by_section: dict[str, dict] = {}
    for item in items:
        if item.get("kind") != "skill":
            merged.append(item)
            continue
        section_key = str(item.get("section_title") or "专业技能")
        existing = skill_by_section.get(section_key)
        if existing is None:
            existing = {
                **item,
                "fields": {**(item.get("fields") or {})},
                "warnings": list(item.get("warnings") or []),
            }
            skill_by_section[section_key] = existing
            merged.append(existing)
            continue
        source_text = str(item.get("source_text") or "").strip()
        if source_text and source_text not in str(existing.get("source_text") or ""):
            existing["source_text"] = "\n".join(part for part in [existing.get("source_text"), source_text] if part)
        existing["confidence"] = min(float(existing.get("confidence") or 0), float(item.get("confidence") or 0))
        existing["warnings"].extend(value for value in item.get("warnings") or [] if value not in existing["warnings"])
    return merged


SYSTEM_PROMPT = """你是简历文档结构解析器。你的任务仅是识别原文结构，不是改写、润色或推断。
必须遵守：
1. 每个字段只能摘录自输入文本；不确定就留空。
2. 保持章节和条目的原始顺序。
3. 每个条目必须提供 source_quotes，且逐字复制足以支撑该条目的原文片段。
4. 不合并不同学校、公司或项目，也不把教育期间的奖项拆成独立教育经历。同一个技能章节下的数据分析、统计知识、综合能力等小标题必须保留在一个 skill 条目中。
5. 日期统一为 YYYY-MM；原文为“至今”时 end_date 填“至今”。
6. education 的 organization=学校，role=专业/学历；experience 的 organization=公司，role=岗位；project 的 title=项目名，role 可放奖项/角色。
7. 输入中的 <PERSON_1>、<PHONE_1> 等是本地隐私占位符，必须原样保留，禁止猜测真实值。
8. 不输出输入中没有的事实。"""


def parse_resume_with_model(
    text: str,
    profile: dict[str, str],
    *,
    settings: AgentSettings | None = None,
    runtime: AgentRuntime | None = None,
) -> AiParsingResult:
    settings = settings or AgentSettings.from_env()
    if settings.runtime == RuntimeMode.MOCK or not settings.api_key_configured:
        return AiParsingResult(warnings=["未连接可用模型，已使用本地解析"])

    redacted = redact_resume_text(text, profile)
    prompt_text = redacted.text[:30000]
    warnings = ["简历文本较长，仅发送前 30000 个字符"] if len(redacted.text) > len(prompt_text) else []
    try:
        output, runtime_result = (runtime or build_runtime(settings)).generate(
            agent_name="resume_structure_parser",
            prompt=f"请解析以下已在本地脱敏的简历文本：\n<resume>\n{prompt_text}\n</resume>",
            system_prompt=SYSTEM_PROMPT,
            output_model=AiResumeStructure,
            mock_data={"sections": [], "warnings": []},
        )
        items, validation_warnings = _validate_structure(output, redacted)
        warnings.extend(validation_warnings)
        if not items:
            warnings.append("模型结果未通过原文证据校验，已使用本地解析")
            return AiParsingResult(redacted_fields=redacted.categories, warnings=warnings)
        usage = runtime_result.usage or {}
        return AiParsingResult(
            used=True,
            items=items,
            provider=str(usage.get("provider") or settings.provider_name or settings.runtime.value),
            model=str(usage.get("model") or settings.model),
            redacted_fields=redacted.categories,
            warnings=warnings,
        )
    except (HarnessError, ValueError, TypeError) as exc:
        # Provider errors can contain request metadata, so expose only a stable
        # fallback message and never persist the redacted prompt or raw response.
        return AiParsingResult(
            redacted_fields=redacted.categories,
            warnings=[*warnings, f"AI 识别失败（{getattr(exc, 'code', type(exc).__name__)}），已使用本地解析"],
        )
