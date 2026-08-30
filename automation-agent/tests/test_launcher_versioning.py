from pathlib import Path


def test_health_exposes_pid_and_revision():
    source = (
        Path(__file__).parents[1]
        / "src"
        / "project_rekhya_agent"
        / "main.py"
    ).read_text(encoding="utf-8")
    assert '"pid": os.getpid()' in source
    assert '"revision": RUNTIME_REVISION' in source


def test_launcher_replaces_stale_revision():
    source = (
        Path(__file__).parents[1]
        / "src"
        / "project_rekhya_agent"
        / "launcher.py"
    ).read_text(encoding="utf-8")
    assert "Stale agent detected" in source
    assert "_terminate_stale_agent" in source
    assert '["taskkill", "/PID", str(pid), "/T", "/F"]' in source
    assert "running == expected" in source
