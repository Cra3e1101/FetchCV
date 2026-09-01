"""agent platform queue context skills and mcp

Revision ID: 20260719_0004
Revises: 20260717_0003
Create Date: 2026-07-19
"""

from alembic import op
import sqlalchemy as sa


revision = "20260719_0004"
down_revision = "20260717_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if {"agent_tasks", "queued_agent_messages", "agent_context_snapshots", "agent_skills", "mcp_server_configs"}.issubset(existing):
        return
    op.create_table(
        "agent_tasks",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("run_id", sa.String(40), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False, server_default="resume"),
        sa.Column("status", sa.String(40), nullable=False, server_default="queued"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("result_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("pause_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("locked_by", sa.String(120)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_task_run_status", "agent_tasks", ["run_id", "status"])
    op.create_index("ix_agent_task_queue", "agent_tasks", ["status", "priority", "created_at"])
    op.create_table(
        "queued_agent_messages",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("candidate_id", sa.String(40), sa.ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(40), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(40), sa.ForeignKey("agent_runs.id", ondelete="SET NULL")),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("thinking_level", sa.String(40), nullable=False, server_default="balanced"),
        sa.Column("status", sa.String(40), nullable=False, server_default="queued"),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("result_message_id", sa.String(40), sa.ForeignKey("agent_messages.id", ondelete="SET NULL")),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_queued_message_job_status", "queued_agent_messages", ["job_id", "status", "created_at"])
    op.create_table(
        "agent_context_snapshots",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("run_id", sa.String(40), sa.ForeignKey("agent_runs.id", ondelete="CASCADE")),
        sa.Column("job_id", sa.String(40), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("pinned_context", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("compacted_message_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("recent_message_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("token_estimate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_context_run_version", "agent_context_snapshots", ["run_id", "version"])
    op.create_index("ix_context_job_updated", "agent_context_snapshots", ["job_id", "updated_at"])
    op.create_table(
        "agent_skills",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("path", name="uq_agent_skill_path"),
    )
    op.create_index("ix_agent_skill_enabled", "agent_skills", ["enabled", "name"])
    op.create_table(
        "mcp_server_configs",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("transport", sa.String(40), nullable=False, server_default="stdio"),
        sa.Column("command", sa.Text(), nullable=False),
        sa.Column("args_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("cwd", sa.Text()),
        sa.Column("env_keys", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("allowed_tools", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("discovered_tools", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(40), nullable=False, server_default="unconfigured"),
        sa.Column("last_error", sa.Text()),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="uq_mcp_server_name"),
    )
    op.create_index("ix_mcp_server_enabled", "mcp_server_configs", ["enabled", "approved"])


def downgrade() -> None:
    op.drop_table("mcp_server_configs")
    op.drop_table("agent_skills")
    op.drop_table("agent_context_snapshots")
    op.drop_table("queued_agent_messages")
    op.drop_table("agent_tasks")
