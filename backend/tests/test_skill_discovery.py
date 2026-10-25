from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from applyos_agent.skills import SkillLoader, enabled_skill_catalog
from applyos_api.main import create_app
from applyos_domain.models import AgentSkill


def write_skill(root, folder="review", body="Keep facts intact."):
    path = root / folder / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\nname: review\ndescription: Review facts\n---\n{body}", encoding="utf-8")
    return path


def approve(skill):
    skill.enabled = True
    skill.metadata_json = {**skill.metadata_json, "trusted_hash": skill.content_hash}


def test_missing_paths_are_retained_but_hidden_and_disabled(database, tmp_path, monkeypatch):
    root = tmp_path / "skills"
    path = write_skill(root)
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [root])
    with database.session() as session:
        loader = SkillLoader(session, project_root=tmp_path)
        skill = loader.sync()[0]
        approve(skill)
        path.unlink()
        assert loader.sync() == []
        assert loader.visible() == []
        assert session.get(AgentSkill, skill.id) is skill
        assert skill.enabled is False
        assert skill.metadata_json["available"] is False
        assert enabled_skill_catalog(session) == ""


def test_same_name_precedence_does_not_transfer_approval(database, tmp_path, monkeypatch):
    lower, higher = tmp_path / "lower", tmp_path / "higher"
    lower_path = write_skill(lower)
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [lower, higher])
    with database.session() as session:
        loader = SkillLoader(session, project_root=tmp_path)
        original = loader.sync()[0]
        approve(original)
        higher_path = write_skill(higher, body="Different instructions.")
        winner, = loader.sync()
        assert winner.path == str(higher_path)
        assert winner.enabled is False
        assert original.enabled is False
        assert winner.metadata_json["shadowed_paths"] == [str(lower_path)]
        assert original.metadata_json["shadowed_by"] == str(higher_path)
        approve(winner)
        assert loader.sync()[0].enabled is True
        assert enabled_skill_catalog(session).count("- review:") == 1
        higher_path.unlink()
        fallback, = loader.sync()
        assert fallback.id == original.id
        assert fallback.enabled is False
        assert not fallback.metadata_json["shadowed_by"]


def test_overlapping_roots_and_repeated_scan_are_idempotent(database, tmp_path, monkeypatch):
    path = write_skill(tmp_path)
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [tmp_path, path.parent])
    with database.session() as session:
        loader = SkillLoader(session, project_root=tmp_path)
        first, = loader.sync()
        approve(first)
        second, = loader.sync()
        assert first.id == second.id
        assert second.enabled is True
        assert len(list(session.scalars(select(AgentSkill)))) == 1


def test_legacy_approval_is_revoked_on_first_changed_scan(database, tmp_path, monkeypatch):
    write_skill(tmp_path)
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [tmp_path])
    with database.session() as session:
        loader = SkillLoader(session, project_root=tmp_path)
        skill = loader.sync()[0]
        skill.enabled = True
        write_skill(tmp_path, body="Changed before trust migration.")
        assert loader.sync()[0].enabled is False
        assert skill.metadata_json["trust_pending"] is True


def test_enable_revalidates_files_and_client_hash(database, tmp_path, monkeypatch):
    path = write_skill(tmp_path)
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [tmp_path])
    with TestClient(create_app(database)) as client:
        skill, = client.get("/api/skills").json()
        write_skill(tmp_path, body="Changed after settings loaded.")
        changed = client.patch(f"/api/skills/{skill['id']}", json={"enabled": True, "content_hash": skill["content_hash"]})
        assert changed.status_code == 409
        assert changed.json()["detail"] == "skill_content_changed"
        refreshed, = client.post("/api/skills/reload").json()
        # An older client view must remain invalid even after another scan.
        assert client.patch(f"/api/skills/{skill['id']}", json={"enabled": True, "content_hash": skill["content_hash"]}).status_code == 409
        enabled = client.patch(f"/api/skills/{skill['id']}", json={"enabled": True, "content_hash": refreshed["content_hash"]})
        assert enabled.status_code == 200 and enabled.json()["enabled"] is True
        path.unlink()
        missing = client.patch(f"/api/skills/{skill['id']}", json={"enabled": True})
        assert missing.status_code == 409
        assert missing.json()["detail"] == "skill_file_unavailable"
        assert client.post("/api/skills/reload").json() == []
        client.app.state.agent_ready = False
        assert client.get("/api/skills").json() == []


def test_api_rejects_shadowed_skill(database, tmp_path, monkeypatch):
    lower, higher = tmp_path / "lower", tmp_path / "higher"
    write_skill(lower)
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [lower, higher])
    with TestClient(create_app(database)) as client:
        original, = client.get("/api/skills").json()
        write_skill(higher)
        response = client.patch(f"/api/skills/{original['id']}", json={"enabled": True})
        assert response.status_code == 409
        assert response.json()["detail"] == "skill_shadowed"
        winner, = client.post("/api/skills/reload").json()
        assert winner["id"] != original["id"]


def test_invalid_utf8_does_not_break_other_skills(database, tmp_path, monkeypatch):
    write_skill(tmp_path)
    bad = tmp_path / "invalid" / "SKILL.md"
    bad.parent.mkdir()
    bad.write_bytes(b"\xff\xfe")
    monkeypatch.setattr(SkillLoader, "roots", lambda _: [tmp_path])
    with database.session() as session:
        assert len(SkillLoader(session, project_root=tmp_path).sync()) == 1


def test_root_precedence(tmp_path, monkeypatch, database):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    configured = tmp_path / "configured"
    monkeypatch.setenv("FETCHCV_SKILL_ROOTS", str(configured))
    with database.session() as session:
        roots = SkillLoader(session, project_root=tmp_path).roots()
        assert roots[0].name == "builtin_skills"
        assert roots[1:] == [tmp_path / "home" / ".fetchcv" / "skills", tmp_path / "skills", configured]
