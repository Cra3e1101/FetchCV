"""Add bounded JD context and acquisition provenance; legacy stays unknown."""
from alembic import op
import sqlalchemy as sa

revision = "20261025_0011"
down_revision = "20261025_0010"
branch_labels = None
depends_on = None


def upgrade():
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("jobs")}
    for name, kind, default in (("context_json", sa.JSON(), "'{}'"), ("jd_provenance", sa.JSON(), "'{}'"),
                                ("input_revision", sa.Integer(), "1")):
        if name not in columns:
            op.add_column("jobs", sa.Column(name, kind, nullable=False, server_default=sa.text(default)))


def downgrade():
    for name in ("input_revision", "jd_provenance", "context_json"):
        op.drop_column("jobs", name)
