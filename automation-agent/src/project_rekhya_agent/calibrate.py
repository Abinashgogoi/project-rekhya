from __future__ import annotations

import json
from pathlib import Path
from xml.etree import ElementTree

from .settings import Settings

REQUIRED_KEYS = [
    "sim_number_field", "sim_number_save", "sim_number_value", "google_phone_number_choice",
    "login_mobile_value", "login_password", "login_button", "login_error_message", "pmfby_insurance",
    "state_assam", "season_kharif", "scheme_pmfby", "year_2026", "submit_next", "dashboard_menu",
    "menu_displayed_name", "menu_displayed_user_id", "menu_close", "dashboard_unpaid_count", "unpaid_tile",
    "unpaid_list_header_count", "sign_out",
]


def candidates(xml_source: str):
    root = ElementTree.fromstring(xml_source)
    values: list[dict[str, str]] = []
    for element in root.iter():
        attributes = element.attrib
        resource_id = attributes.get("resource-id", "").strip()
        description = attributes.get("content-desc", "").strip()
        text = attributes.get("text", "").strip()
        if resource_id:
            values.append({"label": f"ID: {resource_id}", "by": "id", "value": resource_id})
        if description:
            values.append({"label": f"Accessibility: {description}", "by": "accessibility id", "value": description})
        if text:
            escaped = text.replace('"', '\\"')
            values.append({"label": f"Exact text: {text}", "by": "-android uiautomator", "value": f'new UiSelector().text("{escaped}")'})
    unique: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for value in values:
        identity = (value["by"], value["value"])
        if identity not in seen:
            seen.add(identity); unique.append(value)
    return unique


def main():
    from appium import webdriver
    from appium.options.android import UiAutomator2Options
    settings = Settings()
    options = UiAutomator2Options().load_capabilities({
        "platformName": "Android",
        "automationName": "UiAutomator2",
        "appium:deviceName": settings.device_serial or "Android",
        "appium:udid": settings.device_serial,
        "appium:appPackage": settings.android_package,
        "appium:appActivity": settings.android_activity,
        "appium:noReset": True,
        # Physical calibration requires the operator to navigate between several
        # OEM settings and app screens. Keep the session alive while they do so.
        "appium:newCommandTimeout": 3600,
        # Realme Phone Manager can hold USB APK installs for manual review.
        "appium:uiautomator2ServerInstallTimeout": 120000,
        "appium:adbExecTimeout": 120000,
    })
    driver = webdriver.Remote(settings.appium_url, options=options)
    selected: dict[str, list[dict[str, str]]] = {}
    try:
        for key in REQUIRED_KEYS:
            input(f"Navigate until '{key}' is visible, then press Enter. No password text is saved. ")
            available = candidates(driver.page_source)
            for index, candidate in enumerate(available, 1):
                print(f"{index:>3}. {candidate['label']}")
            choice = int(input(f"Select the reliable element for {key}: "))
            if choice < 1 or choice > len(available):
                raise ValueError("Invalid selector choice")
            picked = dict(available[choice - 1]); picked.pop("label", None)
            selected[key] = [picked]
    finally:
        try:
            driver.quit()
        except Exception:
            # The device or Appium server may already have ended the session.
            pass
    payload = {"project": "project-rekhya", "schema_version": 1, "selectors": selected, "regions": {}}
    Path(settings.selector_profile).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Saved Project Rekhya selector profile to {settings.selector_profile}")


if __name__ == "__main__":
    main()
