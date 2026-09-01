"""Add FetchCV material library and complete experience entities.

Revision ID: 20260717_0003
Revises: 20260716_0002
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260717_0003"
down_revision: str | None = "20260716_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if {"material_assets", "experiences", "agent_messages"}.issubset(existing):
        return
    op.create_table(
        "material_assets",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("candidate_id", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=240), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.String(length=160), nullable=True),
        sa.Column("status", sa.String(length=80), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_material_candidate_kind", "material_assets", ["candidate_id", "kind"])
    op.create_table(
        "experiences",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("candidate_id", sa.String(length=40), nullable=False),
        sa.Column("source_asset_id", sa.String(length=40), nullable=True),
        sa.Column("kind", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=320), nullable=False),
        sa.Column("organization", sa.String(length=320), nullable=True),
        sa.Column("role", sa.String(length=240), nullable=True),
        sa.Column("start_date", sa.String(length=32), nullable=True),
        sa.Column("end_date", sa.String(length=32), nullable=True),
        sa.Column("location", sa.String(length=240), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("details_json", sa.JSON(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("fact_ids", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_asset_id"], ["material_assets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_experience_candidate_kind", "experiences", ["candidate_id", "kind"])
    op.create_index("ix_experience_source", "experiences", ["source_asset_id"])
    op.create_table(
        "agent_messages",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("candidate_id", sa.String(length=40), nullable=False),
        sa.Column("job_id", sa.String(length=40), nullable=False),
        sa.Column("run_id", sa.String(length=40), nullable=True),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_message_job_created", "agent_messages", ["job_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_message_job_created", table_name="agent_messages")
    op.drop_table("agent_messages")
    op.drop_index("ix_experience_source", table_name="experiences")
    op.drop_index("ix_experience_candidate_kind", table_name="experiences")
    op.drop_table("experiences")
    op.drop_index("ix_material_candidate_kind", table_name="material_assets")
    op.drop_table("material_assets")
