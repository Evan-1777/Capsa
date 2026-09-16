"""Static validation of the manual image build workflow."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "build-image.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _steps() -> list[dict]:
    return _workflow()["jobs"]["build"]["steps"]


def _step_using(action: str) -> dict:
    matches = [s for s in _steps() if str(s.get("uses", "")).startswith(f"{action}@")]
    assert len(matches) == 1
    return matches[0]


def test_only_manual_trigger_with_a_tag_input():
    # PyYAML 按 YAML 1.1 把未加引号的 on 解析为布尔 True
    workflow = _workflow()
    triggers = workflow.get("on") or workflow.get(True)
    assert set(triggers) == {"workflow_dispatch"}
    assert triggers["workflow_dispatch"]["inputs"]["tag"]["default"] == "latest"


def test_permissions_are_minimal():
    assert _workflow()["permissions"] == {"contents": "read", "packages": "write"}


def test_login_uses_the_builtin_token():
    with_config = _step_using("docker/login-action")["with"]
    assert with_config["registry"] == "ghcr.io"
    assert with_config["password"] == "${{ secrets.GITHUB_TOKEN }}"


def test_build_pushes_the_image_tagged_from_the_input():
    build = _step_using("docker/build-push-action")["with"]
    assert build["context"] == "."
    assert build["file"] == "./Dockerfile"
    assert build["push"] is True
    assert build["tags"] == "${{ steps.meta.outputs.image }}:${{ inputs.tag }}"


def test_image_name_is_lowercased_from_the_repository():
    meta = [s for s in _steps() if s.get("id") == "meta"]
    assert len(meta) == 1
    assert 'image=ghcr.io/${GITHUB_REPOSITORY,,}' in meta[0]["run"]
