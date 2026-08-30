from pathlib import Path



def test_prelogin_failures_do_not_force_logout():
    source = (
        Path(__file__).parents[1]
        / "src"
        / "project_rekhya_agent"
        / "runner.py"
    ).read_text(encoding="utf-8")
    assert "account_session_started = False" in source
    assert "account_session_started = True" in source
    assert "if not setup_error and account_session_started:" in source


def test_credential_api_reports_server_error_body():
    source = (
        Path(__file__).parents[1]
        / "src"
        / "project_rekhya_agent"
        / "cloud.py"
    ).read_text(encoding="utf-8")
    assert "Credential API {response.status_code}" in source
    assert "payload.get(\"error\")" in source
