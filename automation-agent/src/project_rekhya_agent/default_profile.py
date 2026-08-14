from __future__ import annotations


def _text(value: str) -> dict[str, str]:
    escaped = value.replace('"', '\\"')
    return {"by": "-android uiautomator", "value": f'new UiSelector().text("{escaped}")'}


def _text_contains(value: str) -> dict[str, str]:
    escaped = value.replace('"', '\\"')
    return {"by": "-android uiautomator", "value": f'new UiSelector().textContains("{escaped}")'}


# Project Rekhya's supported physical setup: Realme RMX3867 and the official
# com.application.pmfby.aide application.  Each entry contains conservative
# fallbacks so normal operation does not require the operator to answer a long
# sequence of numbered calibration questions.
DEFAULT_SELECTORS: dict[str, list[dict[str, str]]] = {
    "sim_number_open": [_text("SIM number")],
    "sim_number_field": [
        {"by": "id", "value": "com.android.phone:id/dialog_bottom_sheet_edit_text_layoutnormal_bottom_sheet_edit_text"},
    ],
    "sim_number_save": [{"by": "id", "value": "android:id/button1"}, _text("OK")],
    "sim_number_value": [
        {"by": "id", "value": "com.android.phone:id/dialog_bottom_sheet_edit_text_layoutnormal_bottom_sheet_edit_text"},
    ],
    "google_phone_number_choice": [
        {"by": "id", "value": "com.google.android.gms:id/phone_number_list_item"},
        {"by": "id", "value": "com.google.android.gms:id/phone_number"},
    ],
    "login_mobile_value": [{"by": "id", "value": "com.application.pmfby.aide:id/et_mobile_number"}],
    "login_password": [{"by": "id", "value": "com.application.pmfby.aide:id/et_password"}],
    "login_button": [{"by": "id", "value": "com.application.pmfby.aide:id/tv_login"}, _text("Login")],
    "login_error_message": [
        {"by": "id", "value": "com.application.pmfby.aide:id/snackbar_text"},
        {"by": "xpath", "value": "//*[contains(translate(@text,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'did not match')]"},
    ],
    "pmfby_insurance": [_text_contains("PMFBY")],
    "state_assam": [_text("Assam")],
    "season_kharif": [_text("Kharif")],
    "scheme_pmfby": [_text("PMFBY"), _text_contains("Pradhan Mantri Fasal Bima Yojana")],
    "year_2026": [_text("2026")],
    "submit_next": [
        {"by": "-android uiautomator", "value": 'new UiSelector().textMatches("(?i)^(submit|next|continue)$")'},
    ],
    "dashboard_menu": [
        {"by": "id", "value": "com.application.pmfby.aide:id/iv_navigation"},
        {"by": "accessibility id", "value": "Open navigation drawer"},
    ],
    "menu_displayed_name": [
        {"by": "xpath", "value": "//*[contains(@resource-id,'user_name') or contains(@resource-id,'tv_name') or contains(@resource-id,'profile_name')]"},
    ],
    "menu_displayed_user_id": [
        {"by": "xpath", "value": "//*[contains(@resource-id,'user_id') or contains(@resource-id,'userid') or contains(@resource-id,'mobile_number')]"},
    ],
    "menu_close": [
        {"by": "id", "value": "com.application.pmfby.aide:id/iv_navigation"},
        {"by": "accessibility id", "value": "Close navigation drawer"},
    ],
    "dashboard_unpaid_count": [
        {"by": "xpath", "value": "//*[contains(@resource-id,'unpaid') and (contains(@resource-id,'count') or contains(@resource-id,'total'))]"},
    ],
    "unpaid_tile": [_text("Unpaid Application"), _text_contains("Unpaid Application")],
    "unpaid_list_header_count": [
        {"by": "xpath", "value": "//*[contains(@resource-id,'unpaid') and (contains(@resource-id,'count') or contains(@resource-id,'total') or contains(@resource-id,'header'))]"},
    ],
    "sign_out": [
        {"by": "-android uiautomator", "value": 'new UiSelector().textMatches("(?i)^sign[ -]?out$")'},
    ],
}


def default_profile_payload() -> dict[str, object]:
    return {
        "project": "project-rekhya",
        "schema_version": 1,
        "profile": "realme-rmx3867-pmfby",
        "selectors": DEFAULT_SELECTORS,
        "regions": {},
    }
