from datetime import date
from pathlib import Path

from project_rekhya_agent.appium_flow import AppiumFlow
from project_rekhya_agent.models import AppRecord


def record(day: int, amount: float, policy: str) -> AppRecord:
    return AppRecord(
        policy_id=policy,
        applicant_name="Worker",
        amount=amount,
        application_date=date(2026, 8, day),
        status=None,
        evidence_path=Path("evidence.png"),
    )


def test_digits_normalizes_formatted_phone_number():
    assert AppiumFlow._digits("+91-075770 59876") == "9107577059876"


def test_phone10_compares_country_code_and_plain_number():
    assert AppiumFlow._phone10("+91 7577059876") == "7577059876"
    assert AppiumFlow._phone10("7577059876") == "7577059876"


def test_parse_date_accepts_supported_formats():
    assert AppiumFlow._parse_date("Date: 14/08/2026") == date(2026, 8, 14)
    assert AppiumFlow._parse_date("14-08-26") == date(2026, 8, 14)


def test_parse_amount_requires_currency_or_label():
    assert AppiumFlow._parse_amount("Premium: Rs. 100") == 100.0
    assert AppiumFlow._parse_amount("â‚¹240") == 240.0
    assert AppiumFlow._parse_amount("Policy 123456") is None


def test_merge_scrolled_page_keeps_legitimate_duplicates_but_removes_scroll_overlap():
    first = [record(15, 100, "A"), record(14, 100, "B"), record(13, 200, "C")]
    second = [record(13, 200, "C"), record(12, 100, "D")]
    merged = AppiumFlow._merge_scrolled_page(first, second)
    assert [item.policy_id for item in merged] == ["A", "B", "C", "D"]

    legitimate_duplicate = [record(12, 100, "D"), record(12, 100, "D")]
    merged = AppiumFlow._merge_scrolled_page([], legitimate_duplicate)
    assert len(merged) == 2


def test_parse_amount_accepts_real_rupee_symbol():
    assert AppiumFlow._parse_amount("\u20b9100") == 100.0
    assert AppiumFlow._parse_amount("Premium: \u20b9240") == 240.0


def test_parse_amount_accepts_mojibake_rupee_symbol():
    assert AppiumFlow._parse_amount("Ã¢â€šÂ¹240") == 240.0



def test_physically_calibrated_dashboard_cycle_selectors():
    from project_rekhya_agent.default_profile import DEFAULT_SELECTORS

    expected = {
        "dashboard_menu":
            "com.application.pmfby.aide:id/iv_hamburger",
        "menu_displayed_user_id":
            "com.application.pmfby.aide:id/tv_code",
        "menu_close":
            "com.application.pmfby.aide:id/iv_close",
        "dashboard_unpaid_count":
            "com.application.pmfby.aide:id/tv_draft_count",
        "unpaid_tile":
            "com.application.pmfby.aide:id/cl_draft_application",
        "unpaid_page_title":
            "com.application.pmfby.aide:id/tv_title",
        "unpaid_back":
            "com.application.pmfby.aide:id/iv_navigation",
        "unpaid_list":
            "com.application.pmfby.aide:id/rv_policy",
        "sign_out":
            "com.application.pmfby.aide:id/nav_sign_out",
        "logout_yes":
            "com.application.pmfby.aide:id/tv_yes",
    }

    for key, resource_id in expected.items():
        assert DEFAULT_SELECTORS[key][0] == {
            "by": "id",
            "value": resource_id,
        }


def test_unpaid_scroll_captures_every_viewport_before_reading_cards():
    import inspect
    source = inspect.getsource(AppiumFlow._scroll_unpaid_records)
    shot = source.index("self._shot(")
    read = source.index("self._visible_record_cards(")
    scroll = source.index('"mobile: scrollGesture"')
    assert shot < read < scroll
    assert '"Unpaid_List_{page_number:02d}"' in source
    assert "if len(records) != expected_total:" in source
    assert "DETECTOR COUNT MISMATCH" in source


def test_authenticated_recovery_skips_login_landing():
    flow = object.__new__(AppiumFlow)
    stages = []

    class FakeElement:
        text = "Login to continue"

    def fake_find_optional(key, timeout=2):
        if key == "pmfby_landing_text":
            return FakeElement()
        raise AssertionError(f"Recovery must not probe {key} after login landing is detected")

    flow._find_optional = fake_find_optional
    flow._report = stages.append

    assert flow._recover_authenticated_dashboard() is False
    assert stages == ["PMFBY login landing detected - authenticated recovery skipped"]


def test_authenticated_recovery_rejects_generic_tv_title():
    flow = object.__new__(AppiumFlow)

    class GenericTitle:
        text = "Simplifying Insurance Management"

    def fake_find_optional(key, timeout=2):
        if key == "pmfby_landing_text":
            return None
        if key == "dashboard_menu":
            return None
        if key == "unpaid_list":
            return None
        if key == "unpaid_list_header_count":
            return GenericTitle()
        return None

    flow._find_optional = fake_find_optional
    flow._report = lambda stage: None

    assert flow._recover_authenticated_dashboard() is False
