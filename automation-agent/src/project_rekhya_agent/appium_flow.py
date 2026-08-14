from __future__ import annotations

from datetime import date
from pathlib import Path
from time import sleep

from .adb import AdbDevice
from .evidence import EvidenceStore
from .models import IssueType, JobResult, Stage
from .rules import classify_login_error
from .selectors import Locator, SelectorProfile


class ManualReviewRequired(RuntimeError):
    pass


class AppiumFlow:
    def __init__(self, appium_url: str, package: str, activity: str, device: AdbDevice, profile: SelectorProfile, evidence: EvidenceStore):
        from appium import webdriver
        from appium.options.android import UiAutomator2Options
        options = UiAutomator2Options().load_capabilities({"platformName": "Android", "automationName": "UiAutomator2", "appium:deviceName": device.serial or "Android", "appium:udid": device.serial, "appium:appPackage": package, "appium:appActivity": activity, "appium:noReset": True, "appium:newCommandTimeout": 180})
        self.driver = webdriver.Remote(appium_url, options=options)
        self.package = package
        self.device = device
        self.profile = profile
        self.evidence = evidence

    def _find(self, locators: list[Locator], timeout: int = 15):
        from selenium.webdriver.support.ui import WebDriverWait
        def locate(_driver):
            for locator in locators:
                try:
                    element = _driver.find_element(locator.by, locator.value)
                    if element.is_displayed():
                        return element
                except Exception:
                    continue
            return False
        return WebDriverWait(self.driver, timeout).until(locate)

    def _shot(self, user_id: str, name: str, category: str, label: str) -> Path:
        path = self.evidence.screenshot_path(user_id, name, category, label)
        self.driver.get_screenshot_as_file(str(path))
        return path

    def _text(self, key: str) -> str:
        return self._find(self.profile.locators(key)).text.strip()

    def set_sim_number(self, expected_user_id: str):
        self.device.start_settings()
        self._find(self.profile.locators("sim_number_open"), timeout=20).click()
        field = self._find(self.profile.locators("sim_number_field"), timeout=20)
        field.click(); field.clear(); field.send_keys(expected_user_id)
        saved = self._text("sim_number_value")
        if saved.replace(" ", "") != expected_user_id:
            raise ManualReviewRequired("SIM number editor does not contain the expected User ID")
        self._find(self.profile.locators("sim_number_save")).click()
        sleep(1)

    def verify_account(self, expected_user_id: str, worker_name: str, password: str, start_date: date, end_date: date) -> JobResult:
        result = JobResult(expected_user_id=expected_user_id)
        self.set_sim_number(expected_user_id)
        self.driver.activate_app(self.package)
        self._find(self.profile.locators("google_phone_number_choice"), timeout=20).click()
        selected = self._text("login_mobile_value").replace(" ", "")
        if selected != expected_user_id:
            raise ManualReviewRequired("Google phone-number selection does not match the expected User ID")
        password_field = self._find(self.profile.locators("login_password")); password_field.clear(); password_field.send_keys(password)
        self._find(self.profile.locators("login_button")).click()
        sleep(2)
        page = self.driver.page_source
        if "did not match" in page.lower() or "snackbar" in page.lower() and "error" in page.lower():
            message = self._text("login_error_message")
            result.issue_type = IssueType(classify_login_error(message)); result.error_message = message
            self._shot(expected_user_id, worker_name, "errors", "Login_Error")
            return result
        self._find(self.profile.locators("pmfby_insurance")).click()
        for selector in ("state_assam", "season_kharif", "scheme_pmfby", "year_2026", "submit_next"):
            self._find(self.profile.locators(selector)).click()
        self._find(self.profile.locators("dashboard_menu")).click()
        result.displayed_name = self._text("menu_displayed_name")
        result.displayed_user_id = self._text("menu_displayed_user_id").replace(" ", "")
        self._shot(expected_user_id, worker_name, "identity", "Logged_In_Identity")
        if result.displayed_user_id != expected_user_id:
            result.issue_type = IssueType.WRONG_ID; result.error_message = "Displayed User ID does not match expected User ID"
            return result
        self._find(self.profile.locators("menu_close")).click()
        unpaid_text = self._text("dashboard_unpaid_count")
        if not unpaid_text.isdigit():
            raise ManualReviewRequired("Dashboard Unpaid count is not a reliable integer")
        result.dashboard_unpaid = int(unpaid_text)
        self._shot(expected_user_id, worker_name, "dashboard", "Unpaid_Applications_Count")
        self._find(self.profile.locators("unpaid_tile")).click()
        list_text = self._text("unpaid_list_header_count")
        digits = "".join(character for character in list_text if character.isdigit())
        if not digits:
            raise ManualReviewRequired("Unpaid list header count is unreadable")
        result.unpaid_list_count = int(digits)
        if result.dashboard_unpaid != result.unpaid_list_count:
            result.issue_type = IssueType.COUNT_MISMATCH
        raise ManualReviewRequired("Physical list-card calibration is required before app record extraction can be accepted")

    def logout(self):
        self._find(self.profile.locators("dashboard_menu")).click()
        self._find(self.profile.locators("sign_out")).click()
        self._find(self.profile.locators("login_mobile_value"), timeout=25)

    def close(self):
        self.driver.quit()
