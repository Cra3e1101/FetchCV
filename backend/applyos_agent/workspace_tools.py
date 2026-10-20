from __future__ import annotations

import hashlib
import json
import mimetypes
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage

from .tools import PipelineToolResult


MAX_FILE_BYTES = 512 * 1024
MAX_WRITE_BYTES = 1024 * 1024
MAX_LIST_RESULTS = 300
TEXT_SUFFIXES = {".csv", ".html", ".json", ".md", ".rst", ".text", ".txt", ".xml", ".yaml", ".yml"}
IGNORED_PARTS = {".git", ".svn", "node_modules", "__pycache__"}


class WorkspaceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListWorkspaceInput(WorkspaceInput):
    path: str = Field(default=".", max_length=1024)
    max_results: int = Field(default=120, ge=1, le=MAX_LIST_RESULTS)


class ReadWorkspaceInput(WorkspaceInput):
    path: str = Field(min_length=1, max_length=1024)
    max_chars: int = Field(default=30000, ge=1000, le=100000)


class SearchWorkspaceInput(WorkspaceInput):
    query: str = Field(min_length=2, max_length=300)
    path: str = Field(default=".", max_length=1024)
    max_results: int = Field(default=40, ge=1, le=100)


class WorkspaceCommandInput(WorkspaceInput):
    command: Literal["sha256", "validate_json", "count_text"]
    path: str = Field(min_length=1, max_length=1024)


class WriteWorkspaceInput(WorkspaceInput):
    path: str = Field(min_length=1, max_length=1024)
    content: str = Field(max_length=MAX_WRITE_BYTES)
    overwrite: bool = False


class MoveWorkspaceInput(WorkspaceInput):
    source_path: str = Field(min_length=1, max_length=1024)
    destination_path: str = Field(min_length=1, max_length=1024)


class DeleteWorkspaceInput(WorkspaceInput):
    path: str = Field(min_length=1, max_length=1024)


def _target_path(root: Path, raw: str) -> Path:
    root = root.resolve()
    candidate = (root / str(raw or ".")).resolve()
    if not candidate.is_relative_to(root):
        raise HarnessError("workspace_path_denied", "工作区路径越界", details={"path": str(raw)})
    if any(part in IGNORED_PARTS or part.startswith(".") for part in candidate.relative_to(root).parts):
        raise HarnessError("workspace_path_denied", "工作区隐藏或依赖目录不可访问", details={"path": str(raw)})
    return candidate


def _safe_path(root: Path, raw: str, *, file: bool | None = None) -> Path:
    candidate = _target_path(root, raw)
    if not candidate.exists():
        raise HarnessError("workspace_path_not_found", "工作区路径不存在", details={"path": str(raw)})
    if file is True and not candidate.is_file():
        raise HarnessError("workspace_file_required", "该操作需要工作区文件")
    if file is False and not candidate.is_dir():
        raise HarnessError("workspace_directory_required", "该操作需要工作区目录")
    return candidate


def _approval_target(tool_name: str, payload: BaseModel) -> str:
    encoded = json.dumps(
        {"tool": tool_name, "arguments": payload.model_dump(mode="json", exclude_none=True)},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"workspace:{hashlib.sha256(encoded).hexdigest()}"


def _snapshot_file(root: Path, path: Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    relative = path.resolve().relative_to(root.resolve())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = root / ".fetchcv-history" / relative.parent / f"{relative.name}.{timestamp}.{digest}.bak"
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup)
    return backup.relative_to(root).as_posix()


def _relative(root: Path, value: Path) -> str:
    return value.resolve().relative_to(root.resolve()).as_posix()


def _read_text(path: Path, max_chars: int) -> tuple[str, bool]:
    if path.suffix.lower() not in TEXT_SUFFIXES:
        raise HarnessError("workspace_file_type_denied", "只允许读取工作区中的文本、Markdown、JSON、CSV、HTML、XML 或 YAML 文件")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise HarnessError("workspace_file_too_large", "工作区文本文件超过 512 KB 限制")
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[:max_chars], len(text) > max_chars


def register_workspace_tools(gateway: ToolGateway) -> ToolGateway:
    root = gateway.workspace_root
    root.mkdir(parents=True, exist_ok=True)
    stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED, PipelineStage.FAILED, PipelineStage.BLOCKED}

    def output(context: ToolContext, summary: str, data: dict[str, Any], artifacts: list[str] | None = None) -> PipelineToolResult:
        return PipelineToolResult(
            stage=context.run.current_stage or PipelineStage.CREATED.value,
            status=context.run.status.value,
            summary=summary,
            data=data,
            artifacts=artifacts or [],
        )

    def list_files(context: ToolContext, payload: ListWorkspaceInput) -> PipelineToolResult:
        directory = _safe_path(root, payload.path, file=False)
        items = []
        for item in sorted(directory.rglob("*"), key=lambda value: value.as_posix().casefold()):
            relative = item.relative_to(root)
            if len(relative.parts) > 5 or any(part in IGNORED_PARTS or part.startswith(".") for part in relative.parts):
                continue
            if item.is_symlink() or not item.is_file():
                continue
            items.append({"path": relative.as_posix(), "size_bytes": item.stat().st_size, "mime_type": mimetypes.guess_type(item.name)[0] or "application/octet-stream"})
            if len(items) >= payload.max_results:
                break
        return output(context, f"已列出工作区中的 {len(items)} 个文件。", {"root": ".", "files": items, "truncated": len(items) >= payload.max_results})

    def read_file(context: ToolContext, payload: ReadWorkspaceInput) -> PipelineToolResult:
        path = _safe_path(root, payload.path, file=True)
        text, truncated = _read_text(path, payload.max_chars)
        relative = _relative(root, path)
        return output(context, f"已读取工作区文件：{relative}", {"path": relative, "text": text, "truncated": truncated}, [f"workspace:{relative}"])

    def search_files(context: ToolContext, payload: SearchWorkspaceInput) -> PipelineToolResult:
        directory = _safe_path(root, payload.path, file=False)
        needle = payload.query.casefold()
        matches = []
        for path in sorted(directory.rglob("*")):
            relative = path.relative_to(root)
            if len(relative.parts) > 5 or path.is_symlink() or not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            if any(part in IGNORED_PARTS or part.startswith(".") for part in relative.parts) or path.stat().st_size > MAX_FILE_BYTES:
                continue
            for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
                if needle in line.casefold():
                    matches.append({"path": relative.as_posix(), "line": line_number, "preview": line.strip()[:500]})
                    if len(matches) >= payload.max_results:
                        return output(context, f"工作区搜索返回 {len(matches)} 条匹配。", {"query": payload.query, "matches": matches, "truncated": True})
        return output(context, f"工作区搜索返回 {len(matches)} 条匹配。", {"query": payload.query, "matches": matches, "truncated": False})

    def run_command(context: ToolContext, payload: WorkspaceCommandInput) -> PipelineToolResult:
        path = _safe_path(root, payload.path, file=True)
        raw = path.read_bytes()
        if len(raw) > MAX_FILE_BYTES:
            raise HarnessError("workspace_file_too_large", "工作区文件超过命令处理限制")
        if payload.command == "sha256":
            result = {"sha256": hashlib.sha256(raw).hexdigest(), "size_bytes": len(raw)}
        elif payload.command == "validate_json":
            if path.suffix.lower() != ".json":
                raise HarnessError("workspace_command_input_invalid", "validate_json 只接受 JSON 文件")
            parsed = json.loads(raw.decode("utf-8"))
            result = {"valid": True, "root_type": type(parsed).__name__, "size_bytes": len(raw)}
        else:
            text, _ = _read_text(path, MAX_FILE_BYTES)
            result = {"characters": len(text), "lines": len(text.splitlines()), "words": len(text.split())}
        relative = _relative(root, path)
        return output(context, f"工作区固定命令 {payload.command} 已完成。", {"command": payload.command, "path": relative, "result": result}, [f"workspace:{relative}"])

    def write_file(context: ToolContext, payload: WriteWorkspaceInput) -> PipelineToolResult:
        path = _target_path(root, payload.path)
        if path.exists() and not path.is_file():
            raise HarnessError("workspace_file_required", "写入目标必须是文件")
        if path.exists() and not payload.overwrite:
            raise HarnessError("workspace_file_exists", "目标文件已存在；覆盖时必须明确设置 overwrite=true", details={"path": payload.path})
        encoded = payload.content.encode("utf-8")
        if len(encoded) > MAX_WRITE_BYTES:
            raise HarnessError("workspace_file_too_large", "单次写入内容超过 1 MB 限制")
        backup = _snapshot_file(root, path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encoded)
        relative = _relative(root, path)
        return output(
            context,
            f"已写入工作区文件：{relative}",
            {"path": relative, "size_bytes": len(encoded), "backup_path": backup},
            [f"workspace:{relative}"],
        )

    def move_file(context: ToolContext, payload: MoveWorkspaceInput) -> PipelineToolResult:
        source = _safe_path(root, payload.source_path, file=True)
        destination = _target_path(root, payload.destination_path)
        if destination.exists():
            raise HarnessError("workspace_file_exists", "目标文件已存在，移动操作不会静默覆盖", details={"path": payload.destination_path})
        destination.parent.mkdir(parents=True, exist_ok=True)
        source_relative = _relative(root, source)
        shutil.move(str(source), str(destination))
        destination_relative = _relative(root, destination)
        return output(
            context,
            f"已移动工作区文件：{source_relative} -> {destination_relative}",
            {"source_path": source_relative, "destination_path": destination_relative},
            [f"workspace:{destination_relative}"],
        )

    def delete_file(context: ToolContext, payload: DeleteWorkspaceInput) -> PipelineToolResult:
        path = _safe_path(root, payload.path, file=True)
        relative = _relative(root, path)
        backup = _snapshot_file(root, path)
        path.unlink()
        return output(
            context,
            f"已删除工作区文件：{relative}",
            {"path": relative, "backup_path": backup, "recoverable": bool(backup)},
            [f"workspace-backup:{backup}"] if backup else [],
        )

    specs = [
        ToolSpec(name="list_workspace_files", description="列出 FetchCV 隔离工作区中的用户文件；不访问项目源码、隐藏目录或系统路径。", input_model=ListWorkspaceInput, output_model=PipelineToolResult, permission=ToolPermission.READ, allowed_stages=stages, handler=list_files),
        ToolSpec(name="read_workspace_file", description="读取隔离工作区中的有限大小文本文件。", input_model=ReadWorkspaceInput, output_model=PipelineToolResult, permission=ToolPermission.READ, allowed_stages=stages, handler=read_file),
        ToolSpec(name="search_workspace_text", description="在隔离工作区文本文件中进行字面量搜索。", input_model=SearchWorkspaceInput, output_model=PipelineToolResult, permission=ToolPermission.READ, allowed_stages=stages, handler=search_files),
        ToolSpec(name="run_workspace_command", description="执行 sha256、validate_json 或 count_text 三种固定工作区检查；不接受 Shell、参数拼接或外部可执行文件。", input_model=WorkspaceCommandInput, output_model=PipelineToolResult, permission=ToolPermission.READ, allowed_stages=stages, handler=run_command),
        ToolSpec(name="write_workspace_file", description="在 FetchCV 隔离工作区创建或覆盖 UTF-8 文本文件。每次具体写入都必须由用户审批；覆盖前保留本地备份。", input_model=WriteWorkspaceInput, output_model=PipelineToolResult, permission=ToolPermission.CONFIRMED_WRITE, allowed_stages=stages, handler=write_file, read_only=False, side_effect=True, approval_action="workspace_write", auto_request_approval=True, approval_target_builder=lambda payload: _approval_target("write_workspace_file", payload), path_fields=("path",)),
        ToolSpec(name="move_workspace_file", description="移动或重命名 FetchCV 隔离工作区中的单个文件。每次具体操作都必须由用户审批，且不会覆盖已有目标。", input_model=MoveWorkspaceInput, output_model=PipelineToolResult, permission=ToolPermission.CONFIRMED_WRITE, allowed_stages=stages, handler=move_file, read_only=False, side_effect=True, approval_action="workspace_move", auto_request_approval=True, approval_target_builder=lambda payload: _approval_target("move_workspace_file", payload), path_fields=("source_path", "destination_path")),
        ToolSpec(name="delete_workspace_file", description="删除 FetchCV 隔离工作区中的单个文件。每次具体删除都必须由用户审批，并在删除前建立可恢复备份。", input_model=DeleteWorkspaceInput, output_model=PipelineToolResult, permission=ToolPermission.DELETE, allowed_stages=stages, handler=delete_file, read_only=False, side_effect=True, approval_action="workspace_delete", auto_request_approval=True, approval_target_builder=lambda payload: _approval_target("delete_workspace_file", payload), path_fields=("path",)),
    ]
    for spec in specs:
        gateway.register(spec)
    return gateway
