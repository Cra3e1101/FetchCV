"""Scoped immutable tool-result readback."""
from alembic import op
import sqlalchemy as sa
revision = "20261021_0007"
down_revision = "20260721_0006"
branch_labels = None
depends_on = None

def upgrade():
    if "tool_result_archives" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table("tool_result_archives", sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("scope", sa.String(120), nullable=False), sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_tool_result_archives_scope", "tool_result_archives", ["scope"])

def downgrade():
    op.drop_index("ix_tool_result_archives_scope", table_name="tool_result_archives")
    op.drop_table("tool_result_archives")
