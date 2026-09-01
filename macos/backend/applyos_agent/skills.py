from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import AgentSkill
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage


MAX_SKILL_BYTES = 128 * 1024


class SkillInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReadSkillInput(SkillInput):
    name: str = Field(min_length=1, max_length=160)


class SkillResult(BaseModel):
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class SkillLoader:
    def __init__(self, session: Session, *, project_root: str | Path):
        self.session = session
        self.project_root = Path(project_root).resolve()

    def roots(self) -> list[Path]:
        configured = [Path(item).expanduser() for item in os.getenv("FETCHCV_SKILL_ROOTS", "").split(os.pathsep) if item.strip()]
        candidates = [self.project_root / "skills", Path.home() / ".fetchcv" / "skills", *configured]
        roots: list[Path] = []
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved not in roots:
                roots.append(resolved)
        return roots

    def sync(self) -> list[AgentSkill]:
        discovered: dict[str, tuple[Path, str, dict[str, str]]] = {}
        for root in self.roots():
            if not root.is_dir():
                continue
            for path in root.rglob("SKILL.md"):
                resolved = path.resolve()
                if not resolved.is_relative_to(root) or not resolved.is_file() or resolved.stat().st_size > MAX_SKILL_BYTES:
                    continue
                content = resolved.read_text(encoding="utf-8")
                metadata, body = self._frontmatter(content)
                default_name = resolved.parent.name
                name = (metadata.get("name") or default_name).strip()[:160]
                discovered[str(resolved)] = (resolved, body, {**metadata, "name": name})

        existing = {item.path: item for item in self.session.scalars(select(AgentSkill)).all()}
        for path, (_, body, metadata) in discovered.items():
            digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
            description = (metadata.get("description") or self._description(body))[:2000]
            item = existing.get(path)
            if item is None:
                item = AgentSkill(name=metadata["name"], description=description, path=path, content_hash=digest, metadata_json={"available": True})
                self.session.add(item)
            else:
                item.name = metadata["name"]
                item.description = description
                item.content_hash = digest
                item.metadata_json = {**(item.metadata_json or {}), "available": True}
        for path, item in existing.items():
            if path not in discovered:
                item.enabled = False
                item.metadata_json = {**(item.metadata_json or {}), "available": False}
        self.session.flush()
        return list(self.session.scalars(select(AgentSkill).order_by(AgentSkill.name)).all())

    def read(self, skill: AgentSkill) -> str:
        path = Path(skill.path).resolve()
        allowed = any(path.is_relative_to(root) for root in self.roots())
        if not allowed or not path.is_file() or path.name != "SKILL.md":
            raise HarnessError("skill_path_denied", "Skill 路径不在允许目录内")
        if path.stat().st_size > MAX_SKILL_BYTES:
            raise HarnessError("skill_too_large", "Skill 文件超过 128 KB 限制")
        content = path.read_text(encoding="utf-8")
        _, body = self._frontmatter(content)
        return body

    @staticmethod
    def _frontmatter(content: str) -> tuple[dict[str, str], str]:
        if not content.startswith("---\n"):
            return {}, content
        end = content.find("\n---\n", 4)
        if end < 0:
            return {}, content
        metadata: dict[str, str] = {}
        for line in content[4:end].splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", key.strip()):
                metadata[key.strip().lower()] = value.strip().strip("\"'")
        return metadata, content[end + 5 :]

    @staticmethod
    def _description(body: str) -> str:
        for line in body.splitlines():
            value = line.strip().lstrip("#").strip()
            if value:
                return value
        return ""


def register_skill_tools(gateway: ToolGateway, loader: SkillLoader) -> ToolGateway:
    stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED}

    def list_skills(_: ToolContext, __: SkillInput) -> SkillResult:
        skills = loader.sync()
        return SkillResult(summary=f"发现 {len(skills)} 个 Skill。", data={"skills": [{"name": item.name, "description": item.description, "enabled": item.enabled} for item in skills]})

    def read_skill(_: ToolContext, payload: ReadSkillInput) -> SkillResult:
        skill = gateway.session.scalar(select(AgentSkill).where(AgentSkill.name == payload.name, AgentSkill.enabled.is_(True)))
        if skill is None:
            raise HarnessError("skill_not_found", "未找到已启用的 Skill", details={"name": payload.name})
        content = loader.read(skill)
        return SkillResult(summary=f"已读取 Skill：{skill.name}", data={"name": skill.name, "content": content})

    for name, description, model, handler in (
        ("list_skills", "列出 FetchCV 已配置的只读 Skill 指令资源。", SkillInput, list_skills),
        ("read_skill", "完整读取一个已启用 Skill 的说明。Skill 不能授予权限或直接执行代码。", ReadSkillInput, read_skill),
    ):
        gateway.register(ToolSpec(name=name, description=description, input_model=model, output_model=SkillResult, permission=ToolPermission.READ, allowed_stages=stages, handler=handler, read_only=True))
    return gateway
