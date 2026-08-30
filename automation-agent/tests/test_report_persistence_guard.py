from pathlib import Path

def test_success_is_not_marked_before_report_visibility_check():
    source = Path("src/project_rekhya_agent/runner.py").read_text(encoding="utf-8")
    persist = source.index("self.cloud.persist_app_result(")
    verify = source.index("self.cloud.assert_app_result_visible(", persist)
    update = source.index('self.cloud.update_job(job["id"], {', verify)
    assert persist < verify < update

def test_report_guard_checks_summary_records_and_rpc():
    source = Path("src/project_rekhya_agent/cloud.py").read_text(encoding="utf-8")
    start = source.index("    def assert_app_result_visible(")
    end = source.index("    def persist_app_result(", start)
    block = source[start:end]
    assert 'table("app_summaries")' in block
    assert 'table("app_records")' in block
    assert '"get_reconciliation_report"' in block
    assert "REPORT VISIBILITY FAILURE" in block
