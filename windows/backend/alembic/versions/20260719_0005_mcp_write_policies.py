"""mcp per-tool write policies

Revision ID: 20260719_0005
Revises: 20260719_0004
Create Date: 2026-07-19
"""

from alembic import op
import sqlalchemy as sa


revision = "20260719_0005"
down_revision = "20260719_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("mcp_server_configs")}
    if "tool_policies" not in columns:
        op.add_column("mcp_server_configs", sa.Column("tool_policies", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("mcp_server_configs")}
    if "tool_policies" in columns:
        op.drop_column("mcp_server_configs", "tool_policies")
