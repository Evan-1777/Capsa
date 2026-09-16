"""Static validation of the container deployment files."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _compose() -> dict:
    return yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))


def test_compose_is_a_single_pull_only_service():
    compose = _compose()
    service = compose["services"]["capsa"]
    assert set(compose["services"]) == {"capsa"}
    assert "build" not in service
    assert service["image"] == "ghcr.io/evan-1777/capsa:${CAPSA_TAG:-latest}"
    assert service["restart"] == "unless-stopped"
    assert service["environment"] == ["CAPSA_DB_PATH=/data/capsa.db"]
    assert service["volumes"] == ["capsa-data:/data", "capsa-backup:/backup"]
    assert set(compose["volumes"]) == {"capsa-data", "capsa-backup"}


def test_compose_port_binds_loopback_unless_overridden():
    assert _compose()["services"]["capsa"]["ports"] == ["${CAPSA_BIND:-127.0.0.1}:8000:8000"]


def test_dockerfile_is_multi_stage_and_never_runs_as_root():
    text = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert len(re.findall(r"^FROM ", text, re.M)) == 2
    assert re.search(r"^USER capsa$", text, re.M)
    assert "HEALTHCHECK" in text
    assert "http://localhost:8000/healthz" in text
    assert "CAPSA_DB_PATH=/data/capsa.db" in text


def test_frontend_build_output_path_matches_the_copy_source():
    text = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    declared = re.search(r"^ENV CAPSA_STATIC_DIR=(\S+)$", text, re.M).group(1)
    assert re.search(rf"mkdir -p \$CAPSA_STATIC_DIR", text)
    copy = re.search(r"^COPY --from=web-builder \S+ (\S+/) capsa/static/$", text, re.M)
    assert copy.group(1) == f"{declared}/"


def test_cron_line_is_documented():
    text = (ROOT / ".docs" / "Project.md").read_text(encoding="utf-8")
    cron = [line for line in text.splitlines() if "docker compose" in line and "capsa backup" in line]
    assert len(cron) == 1
    assert "0 3 * * * docker compose" in cron[0]
