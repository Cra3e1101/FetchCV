"""Add versioned per-proposal personal fact evidence (legacy remains unverified)."""
from alembic import op
import sqlalchemy as sa

revision = "20261025_0010"
down_revision = "20261021_0009"
branch_labels = None
depends_on = None


def upgrade():
    if "claim_contract" not in {item["name"] for item in sa.inspect(op.get_bind()).get_columns("rewrite_proposals")}:
        op.add_column("rewrite_proposals", sa.Column("claim_contract", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade():
    op.drop_column("rewrite_proposals", "claim_contract")
