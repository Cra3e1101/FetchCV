"""Default backend FTS5/BM25 knowledge indexes and transactional sync."""
from alembic import op
from applyos_domain.knowledge_search import install_search_index, drop_search_index
revision = "20261021_0009"
down_revision = "20261021_0008"
branch_labels = None
depends_on = None


def upgrade():
    install_search_index(op.get_bind())


def downgrade():
    drop_search_index(op.get_bind())
