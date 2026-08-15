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
