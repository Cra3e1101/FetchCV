"""Bring managed migrations in line with desktop standalone chats."""
from alembic import op
import sqlalchemy as sa
revision = "20261021_0008"
down_revision = "20261021_0007"
branch_labels = None
depends_on = None

def upgrade():
    existing=set(sa.inspect(op.get_bind()).get_table_names())
    if "conversations" not in existing:
        op.create_table("conversations", sa.Column("id",sa.String(48),primary_key=True),sa.Column("title",sa.String(160),nullable=False),sa.Column("job_id",sa.String(40),sa.ForeignKey("jobs.id",ondelete="SET NULL")),sa.Column("active_turn_id",sa.String(48)),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False))
    if "conversation_messages" not in existing:
        op.create_table("conversation_messages",sa.Column("id",sa.String(48),primary_key=True),sa.Column("conversation_id",sa.String(48),sa.ForeignKey("conversations.id",ondelete="CASCADE"),nullable=False),sa.Column("role",sa.String(20),nullable=False),sa.Column("content",sa.Text(),nullable=False),sa.Column("metadata_json",sa.JSON(),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False))
        op.create_index("ix_conversation_messages_conversation_id","conversation_messages",["conversation_id"])

def downgrade():
    op.drop_table("conversation_messages")
    op.drop_table("conversations")
