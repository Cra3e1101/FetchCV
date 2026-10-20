"""Add Stage 3 harness trace and recovery fields.

Revision ID: 20260716_0002
Revises: 20260716_0001
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260716_0002"
down_revision: str | None = "20260716_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    run_columns = {item["name"] for item in inspector.get_columns("agent_runs")}
    if "idempotency_key" not in run_columns:
        op.add_column("agent_runs", sa.Column("idempotency_key", sa.String(length=160), nullable=True))
    if "resume_stage" not in run_columns:
        op.add_column("agent_runs", sa.Column("resume_stage", sa.String(length=160), nullable=True))
    run_indexes = {item["name"] for item in inspector.get_indexes("agent_runs")}
    run_constraints = {item["name"] for item in inspector.get_unique_constraints("agent_runs")}
    if "uq_agent_runs_idempotency_key" not in run_indexes | run_constraints:
        op.create_index("uq_agent_runs_idempotency_key", "agent_runs", ["idempotency_key"], unique=True)
    step_columns = {item["name"] for item in inspector.get_columns("agent_run_steps")}
    for column in (
        sa.Column("event_type", sa.String(length=80), server_default="stage", nullable=False),
        sa.Column("actor", sa.String(length=160), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=120), nullable=True),
    ):
        if column.name not in step_columns:
            op.add_column("agent_run_steps", column)


def downgrade() -> None:
    with op.batch_alter_table("agent_run_steps") as batch:
        batch.drop_column("error_code")
        batch.drop_column("reason")
        batch.drop_column("actor")
        batch.drop_column("event_type")
    with op.batch_alter_table("agent_runs") as batch:
        batch.drop_constraint("uq_agent_runs_idempotency_key", type_="unique")
        batch.drop_column("resume_stage")
        batch.drop_column("idempotency_key")
