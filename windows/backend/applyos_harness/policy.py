from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from applyos_domain.models import WorkspaceSetting
from .permissions import ToolGateway, ToolPermission


DEFAULT_PERMISSION_SETTINGS: dict[str, Any] = {
    "web_access": "allow",
    "workspace_read": "allow",
    "workspace_write": "ask",
    "file_delete": "ask",
    "browser_bridge": "allow",
}

DEFAULT_GENERAL_SETTINGS: dict[str, Any] = {
    "accent": "coral",
    "density": "comfortable",
    "theme": "system",
}


def _settings_path(session: Session) -> Path:
    configured = os.getenv("FETCHCV_SETTINGS_FILE", "").strip()
    if configured:
        return Path(configured).expanduser()
    database_url = str(session.bind.url) if session.bind is not None else ""
    if database_url.startswith("sqlite:///"):
        return Path(database_url.removeprefix("sqlite:///")) .with_name("fetchcv-settings.json")
    return Path(__file__).resolve().parents[1] / "data" / "fetchcv-settings.json"


def _read_file(session: Session) -> dict[str, Any]:
    path = _settings_path(session)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}


def _write_file(session: Session, value: dict[str, Any]) -> None:
    path = _settings_path(session)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def permission_settings(session: Session) -> dict[str, Any]:
    raw = _read_file(session)
    stored = raw.get("permissions") if isinstance(raw.get("permissions"), dict) else raw
    if not stored:
        try:
            row = session.get(WorkspaceSetting, "local")
        except SQLAlchemyError:
            row = None
        stored = row.values_json if row else {}
    values = {**DEFAULT_PERMISSION_SETTINGS, **stored}
    for key in ("web_access", "workspace_read", "browser_bridge"):
        if values[key] not in {"allow", "ask", "deny"}:
            values[key] = "allow"
    if values["workspace_write"] not in {"ask", "deny"}:
        values["workspace_write"] = "ask"
    if values["file_delete"] not in {"ask", "deny"}:
        values["file_delete"] = "ask"
    return values


def save_permission_settings(session: Session, updates: dict[str, Any]) -> dict[str, Any]:
    current = permission_settings(session)
    for key in DEFAULT_PERMISSION_SETTINGS:
        if key in updates:
            current[key] = updates[key]
    raw = _read_file(session)
    raw["permissions"] = current
    _write_file(session, raw)
    return current


def general_settings(session: Session) -> dict[str, Any]:
    raw = _read_file(session)
    stored = raw.get("general") if isinstance(raw.get("general"), dict) else {}
    return {**DEFAULT_GENERAL_SETTINGS, **stored}


def save_general_settings(session: Session, updates: dict[str, Any]) -> dict[str, Any]:
    current = {**general_settings(session), **updates}
    if current["accent"] not in {"coral", "sage", "slate", "amber"}:
        current["accent"] = DEFAULT_GENERAL_SETTINGS["accent"]
    if current["density"] not in {"comfortable", "compact"}:
        current["density"] = DEFAULT_GENERAL_SETTINGS["density"]
    if current["theme"] not in {"system", "light", "dark"}:
        current["theme"] = DEFAULT_GENERAL_SETTINGS["theme"]
    raw = _read_file(session)
    raw["general"] = current
    _write_file(session, raw)
    return current


def apply_gateway_policy(gateway: ToolGateway, values: dict[str, Any]) -> ToolGateway:
    """Hide disabled capabilities before definitions reach the model."""
    blocked = set()
    if values.get("web_access") == "deny":
        blocked.update({"search_web", "read_web_page", "web_search", "web_read", "import_job_posting", "discover_interview_sources", "capture_interview_source"})
    if values.get("browser_bridge") == "deny":
        blocked.update({"open_browser_page", "read_browser_page"})
    if values.get("workspace_read") == "deny":
        blocked.update({"list_workspace_files", "read_workspace_file", "search_workspace_text", "run_workspace_command"})
    if values.get("workspace_write") == "deny":
        blocked.update({"write_workspace_file", "move_workspace_file"})
    if values.get("file_delete") == "deny":
        blocked.add("delete_workspace_file")
    for name in blocked:
        gateway.registry.pop(name, None)
    if values.get("web_access") == "ask":
        for spec in gateway.registry.values():
            if spec.permission == ToolPermission.NETWORK_READ and spec.name not in {"open_browser_page", "read_browser_page"}:
                spec.approval_action = f"permission:{spec.name}"
                spec.auto_request_approval = True
                spec.target_type = "permission"
    if values.get("browser_bridge") == "ask":
        for name in ("open_browser_page", "read_browser_page"):
            spec = gateway.registry.get(name)
            if spec is not None:
                spec.approval_action = f"permission:{spec.name}"
                spec.auto_request_approval = True
                spec.target_type = "permission"
    if values.get("workspace_read") == "ask":
        for spec in gateway.registry.values():
            if spec.name in {"list_workspace_files", "read_workspace_file", "search_workspace_text", "run_workspace_command"}:
                spec.approval_action = f"permission:{spec.name}"
                spec.auto_request_approval = True
                spec.target_type = "permission"
    return gateway


def granted_permissions(values: dict[str, Any], *, include_pipeline: bool = False) -> set[ToolPermission]:
    permissions = {ToolPermission.READ, ToolPermission.DRAFT_WRITE, ToolPermission.EXPORT}
    if values.get("web_access") != "deny":
        permissions.add(ToolPermission.NETWORK_READ)
    if values.get("workspace_write") != "deny":
        permissions.add(ToolPermission.CONFIRMED_WRITE)
    if values.get("file_delete") != "deny":
        permissions.add(ToolPermission.DELETE)
    return permissions
