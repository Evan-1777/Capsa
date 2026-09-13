"""Static validation of the container orchestration files."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_compose_services_volumes_and_health_dependency():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    assert set(compose["services"]) == {"capsa", "caddy"}
    assert compose["services"]["capsa"]["restart"] == "unless-stopped"
    assert compose["services"]["capsa"]["volumes"] == ["capsa-data:/data", "capsa-backup:/backup"]
    assert compose["services"]["capsa"]["expose"] == ["8000"]
    assert compose["services"]["caddy"]["depends_on"]["capsa"]["condition"] == "service_healthy"
    assert {name for name in compose["volumes"]} == {
        "capsa-data",
        "capsa-backup",
        "caddy-data",
        "caddy-config",
    }


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


def test_caddyfile_matches_the_request_body_contract():
    text = (ROOT / "Caddyfile").read_text(encoding="utf-8")
    assert "max_size 1MB" in text
    assert "flush_interval -1" in text
    assert "reverse_proxy capsa:8000" in text


def test_cron_line_is_documented():
    text = (ROOT / ".docs" / "Project.md").read_text(encoding="utf-8")
    cron = [line for line in text.splitlines() if "docker compose" in line and "capsa backup" in line]
    assert len(cron) == 1
    assert "0 3 * * * docker compose" in cron[0]
