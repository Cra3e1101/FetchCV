"""Pagination never accepts a caller-supplied scope or filesystem path."""
import hashlib
import json
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.dialects.sqlite import insert
from applyos_domain.models import ToolResultArchive
from applyos_harness.errors import HarnessError
from applyos_harness.trace import sanitize_trace

class ReadToolResultInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result_id: str = Field(pattern=r"^[a-f0-9]{64}$", description="Exact result_id returned by a tool in the current task or conversation. Do not invent IDs.")
    offset: int = Field(default=0, ge=0, description="Character offset. Start at 0; use the previous page's next_offset for continuation.")
    limit: int = Field(default=4000, ge=1, le=12000, description="Maximum number of archived-result characters to return in this page.")

def archive_result(session, scope, result):
    text = json.dumps(sanitize_trace(result), ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(text.encode()).hexdigest()
    ident = hashlib.sha256((scope + "\0" + digest).encode()).hexdigest()
    # Identical parallel reads share one immutable archive. SQLite arbitrates
    # the unique key atomically, instead of a read-then-insert race.
    session.execute(
        insert(ToolResultArchive)
        .values(id=ident, scope=scope, content=text, content_hash=digest)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    return {"tool": "read_tool_result", "arguments": {"result_id": ident, "offset": 0, "limit": 4000},
            "total_chars": len(text), "sha256": digest}

def read_result(session, scope, arguments):
    args = ReadToolResultInput.model_validate(arguments)
    row = session.get(ToolResultArchive, args.result_id)
    if row is None or row.scope != scope:
        raise HarnessError("tool_result_not_found", "当前任务或对话中没有此工具结果")
    if hashlib.sha256(row.content.encode()).hexdigest() != row.content_hash:
        raise HarnessError("tool_result_integrity_failed", "工具结果完整性校验失败")
    end = min(len(row.content), args.offset + args.limit)
    return {"result_id": row.id, "text": row.content[args.offset:end], "offset": args.offset,
            "next_offset": end if end < len(row.content) else None, "total_chars": len(row.content),
            "sha256": row.content_hash}

def definition():
    return {"name": "read_tool_result", "description": "Read the complete archived tool result for the current task or conversation in pages. Use the returned result_id and pass next_offset as offset to continue. Never guess truncated content.",
            "input_schema": ReadToolResultInput.model_json_schema(), "read_only": True, "side_effect": False}

def register_result_reader(gateway):
    from applyos_harness.permissions import ToolSpec, ToolPermission
    from applyos_harness.state_machine import PipelineStage
    class Result(BaseModel):
        model_config = ConfigDict(extra="allow")
    gateway.register(ToolSpec(name="read_tool_result", description=definition()["description"],
        input_model=ReadToolResultInput, output_model=Result, permission=ToolPermission.READ,
        allowed_stages=set(PipelineStage), handler=lambda context, args: read_result(context.session, "run:" + context.run.id, args.model_dump())))
