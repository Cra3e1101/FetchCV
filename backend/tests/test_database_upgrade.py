from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from applyos_domain.database import Database


def test_desktop_schema_upgrade_adds_mcp_write_policy_column(tmp_path):
    path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE mcp_server_configs (
                id VARCHAR(40) PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                transport VARCHAR(40) NOT NULL,
                command TEXT NOT NULL,
                args_json JSON NOT NULL,
                cwd TEXT,
                env_keys JSON NOT NULL,
                enabled BOOLEAN NOT NULL,
                approved BOOLEAN NOT NULL,
                allowed_tools JSON NOT NULL,
                discovered_tools JSON NOT NULL,
                status VARCHAR(40) NOT NULL,
                last_error TEXT,
                last_checked_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
    engine.dispose()

    database = Database(f"sqlite:///{path.as_posix()}")
    database.create_schema()
    try:
        assert "tool_policies" in {item["name"] for item in inspect(database.engine).get_columns("mcp_server_configs")}
    finally:
        database.engine.dispose()
