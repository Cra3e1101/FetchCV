"""interview experience knowledge base

Revision ID: 20260721_0006
Revises: 20260719_0005
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260721_0006"
down_revision = "20260719_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interview_sources",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("candidate_id", sa.String(length=40), nullable=False),
        sa.Column("job_id", sa.String(length=40), nullable=True),
        sa.Column("platform", sa.String(length=80), nullable=False),
        sa.Column("company", sa.String(length=240), nullable=False),
        sa.Column("business_unit", sa.String(length=240), nullable=True),
        sa.Column("role", sa.String(length=240), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("url_hash", sa.String(length=64), nullable=False),
        sa.Column("author", sa.String(length=240), nullable=True),
        sa.Column("published_at", sa.String(length=80), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("extracted_questions", sa.JSON(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("candidate_id", "url_hash", name="uq_interview_source_candidate_url"),
    )
    op.create_index("ix_interview_source_candidate_company", "interview_sources", ["candidate_id", "company"])
    op.create_index("ix_interview_source_job", "interview_sources", ["job_id", "updated_at"])

    op.create_table(
        "interview_briefs",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("candidate_id", sa.String(length=40), nullable=False),
        sa.Column("job_id", sa.String(length=40), nullable=True),
        sa.Column("run_id", sa.String(length=40), nullable=True),
        sa.Column("company", sa.String(length=240), nullable=False),
        sa.Column("business_unit", sa.String(length=240), nullable=True),
        sa.Column("role", sa.String(length=240), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("common_questions", sa.JSON(), nullable=False),
        sa.Column("recommendations", sa.JSON(), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=False),
        sa.Column("query_terms", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_interview_brief_candidate_company", "interview_briefs", ["candidate_id", "company"])
    op.create_index("ix_interview_brief_job", "interview_briefs", ["job_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("ix_interview_brief_job", table_name="interview_briefs")
    op.drop_index("ix_interview_brief_candidate_company", table_name="interview_briefs")
    op.drop_table("interview_briefs")
    op.drop_index("ix_interview_source_job", table_name="interview_sources")
    op.drop_index("ix_interview_source_candidate_company", table_name="interview_sources")
    op.drop_table("interview_sources")
