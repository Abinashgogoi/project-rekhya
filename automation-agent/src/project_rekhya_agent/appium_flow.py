from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from time import sleep

from .adb import AdbDevice
from .evidence import EvidenceStore
from .models import AppRecord, IssueType, JobResult
from .rules import classify_login_error
from .selectors import Locator, SelectorProfile


class ManualReviewRequired(RuntimeError):
    pass


class AutomationSetupError(RuntimeError):
    """A systematic phone/app navigation failure that must stop the batch."""


class AppiumFlow:
    DATE_PATTERNS = (
        "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y",
        "%d-%m-%y", "%d/%m/%y", "%d.%m.%y",
    )
    DATE_RE = re.compile(r"\b([0-3]?\d[-/.][01]?\d[-/.](?:20)?\d{2})\b")

    def __init__(self, appium_url: str, package: str, activity: str, device: AdbDevice, profile: SelectorProfile, evidence: EvidenceStore):
        from appium import webdriver
        from appium.options.android import UiAutomator2Options

        options = UiAutomator2Options().load_capabilities({
            "platformName": "Android",
            "automationName": "UiAutomator2",
            "appium:deviceName": device.serial or "Android",
            "appium:udid": device.serial,
            "appium:appPackage": package,
            "appium:appActivity": activity,
            "appium:noReset": True,
            "appium:newCommandTimeout": 180,
        })
        self.driver = webdriver.Remote(appium_url, options=options)
        self.package = package
        self.device = device
        self.profile = profile
        self.evidence = evidence

    def _find(self, locators: list[Locator], timeout: int = 15):
        from selenium.webdriver.support.ui import WebDriverWait

        def locate(driver):
            for locator in locators:
                try:
                    element = driver.find_element(locator.by, locator.value)
                    if element.is_displayed():
                        return element
                except Exception:
                    continue
            return False

        return WebDriverWait(self.driver, timeout).until(locate)

    def _find_optional(self, key: str, timeout: int = 2):
        try:
            return self._find(self.profile.locators(key), timeout=timeout)
        except Exception:
            return None

    def _shot(self, user_id: str, name: str, category: str, label: str) -> Path:
        path = self.evidence.screenshot_path(user_id, name, category, label)
        self.driver.get_screenshot_as_file(str(path))
        return path

    def _text(self, key: str) -> str:
        return self._find(self.profile.locators(key)).text.strip()

    @staticmethod
    def _digits(value: str) -> str:
        return "".join(character for character in value if character.isdigit())

    @classmethod
    def _phone10(cls, value: str) -> str:
        digits = cls._digits(value)
        return digits[-10:] if len(digits) >= 10 else digits

    def set_sim_number(self, expected_user_id: str):
        self.device.start_settings()
        self._find(self.profile.locators("sim_number_open"), timeout=20).click()
        field = self._find(self.profile.locators("sim_number_field"), timeout=20)
        field.click()
        field.clear()
        field.send_keys(expected_user_id)
        saved = self._text("sim_number_value")
        if self._phone10(saved) != self._phone10(expected_user_id):
            raise ManualReviewRequired("SIM number editor does not contain the expected User ID")
        self._find(self.profile.locators("sim_number_save")).click()
        sleep(1)

    def _candidate_text(self, element) -> str:
        values = []
        for attr in ("text", "content-desc", "resource-id"):
            try:
                value = element.get_attribute(attr)
                if value:
                    values.append(str(value))
            except Exception:
                pass
        try:
            if element.text:
                values.append(element.text)
        except Exception:
            pass
        return " ".join(values)

    def _click_matching_phone_choice(self, expected_user_id: str):
        """Click the expected number, its clickable parent, or finally its centre point."""
        target = self._phone10(expected_user_id)
        candidates = []

        for locator in self.profile.locators("google_phone_number_choice"):
            try:
                candidates.extend(self.driver.find_elements(locator.by, locator.value))
            except Exception:
                pass

        try:
            candidates.extend(self.driver.find_elements(
                "xpath",
                "//*[contains(@package,'google.android.gms') or contains(@resource-id,'phone_number')]",
            ))
        except Exception:
            pass

        seen = set()
        ordered = []
        for element in candidates:
            try:
                key = element.id
            except Exception:
                key = id(element)
            if key not in seen:
                seen.add(key)
                ordered.append(element)

        matching = [
            element for element in ordered
            if self._phone10(self._candidate_text(element)) == target
        ]
        chosen = matching if matching else ordered

        for element in chosen:
            current = element
            for _ in range(6):
                try:
                    if current.is_displayed() and str(current.get_attribute("clickable")).lower() == "true":
                        current.click()
                        sleep(1)
                        return
                except Exception:
                    pass
                try:
                    current = current.find_element("xpath", "..")
                except Exception:
                    break

            try:
                rect = element.rect
                self.driver.execute_script("mobile: clickGesture", {
                    "x": int(rect["x"] + rect["width"] / 2),
                    "y": int(rect["y"] + rect["height"] / 2),
                })
                sleep(1)
                return
            except Exception:
                continue

        raise AutomationSetupError(
            "Google phone-number picker opened but the expected number could not be selected"
        )

    def _select_login_phone_number(self, expected_user_id: str):
        if self._find_optional("google_phone_number_choice", timeout=2) is None:
            self._find(self.profile.locators("login_mobile_value"), timeout=20).click()
            sleep(1)

        self._click_matching_phone_choice(expected_user_id)

        selected = self._phone10(self._text("login_mobile_value"))
        expected = self._phone10(expected_user_id)
        if selected != expected:
            raise AutomationSetupError(
                f"Selected phone number {selected or '[blank]'} does not match expected User ID {expected}"
            )

    @classmethod
    def _parse_date(cls, value: str) -> date | None:
        match = cls.DATE_RE.search(value or "")
        if not match:
            return None
        raw = match.group(1)
        for fmt in cls.DATE_PATTERNS:
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        return None

    @staticmethod
    def _parse_amount(value: str) -> float | None:
        text = value or ""
        currency = re.search(r"(?:â‚¹|Rs\.?|INR)\s*([0-9]+(?:\.[0-9]{1,2})?)", text, re.I)
        if currency:
            return float(currency.group(1))
        labelled = re.search(
            r"(?:amount|premium)\s*[:\-]?\s*(?:â‚¹|Rs\.?|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)",
            text,
            re.I,
        )
        if labelled:
            return float(labelled.group(1))
        return None

    @staticmethod
    def _node_text(node: ET.Element) -> str:
        parts = []
        for key in ("text", "content-desc", "hint"):
            value = node.attrib.get(key)
            if value:
                parts.append(value.strip())
        return " ".join(part for part in parts if part)

    @classmethod
    def _subtree_texts(cls, node: ET.Element) -> list[str]:
        values = []
        for child in node.iter():
            text = cls._node_text(child)
            if text:
                values.append(text)
        return values

    def _visible_record_cards(self, evidence_path: Path) -> list[AppRecord]:
        try:
            root = ET.fromstring(self.driver.page_source)
        except ET.ParseError as error:
            raise ManualReviewRequired("Android UI hierarchy could not be parsed") from error

        parents = {child: parent for parent in root.iter() for child in parent}
        records = []
        card_signatures = set()

        for node in root.iter():
            application_date = self._parse_date(self._node_text(node))
            if application_date is None:
                continue

            current = node
            chosen_texts = None
            amount = None

            for _ in range(8):
                texts = self._subtree_texts(current)
                dates = [self._parse_date(text) for text in texts]
                dates = [value for value in dates if value is not None]
                amounts = [self._parse_amount(text) for text in texts]
                amounts = [value for value in amounts if value is not None]

                if len(dates) == 1 and len(amounts) == 1:
                    chosen_texts = texts
                    application_date = dates[0]
                    amount = amounts[0]
                    break

                current = parents.get(current)
                if current is None:
                    break

            if not chosen_texts or amount is None:
                continue

            signature = tuple(chosen_texts)
            if signature in card_signatures:
                continue
            card_signatures.add(signature)

            combined = " | ".join(chosen_texts)
            policy_match = re.search(
                r"(?:policy(?:\s*id)?|application(?:\s*id)?)\s*[:#\-]?\s*([A-Za-z0-9/_-]+)",
                combined,
                re.I,
            )
            name_match = re.search(r"(?:farmer|applicant|name)\s*[:\-]\s*([^|]{2,80})", combined, re.I)
            status_match = re.search(r"(?:status)\s*[:\-]\s*([^|]{2,40})", combined, re.I)

            records.append(AppRecord(
                policy_id=policy_match.group(1).strip() if policy_match else None,
                applicant_name=name_match.group(1).strip() if name_match else None,
                amount=float(amount),
                application_date=application_date,
                status=status_match.group(1).strip() if status_match else None,
                evidence_path=evidence_path,
            ))

        return records

    @staticmethod
    def _record_key(record: AppRecord) -> tuple:
        return (
            record.policy_id,
            record.applicant_name,
            round(record.amount, 2),
            record.application_date.isoformat(),
            record.status,
        )

    @classmethod
    def _merge_scrolled_page(cls, accumulated: list[AppRecord], page: list[AppRecord]) -> list[AppRecord]:
        if not accumulated:
            return list(page)

        left = [cls._record_key(record) for record in accumulated]
        right = [cls._record_key(record) for record in page]
        overlap = 0

        for size in range(min(len(left), len(right)), 0, -1):
            if left[-size:] == right[:size]:
                overlap = size
                break

        return accumulated + page[overlap:]

    def _scroll_unpaid_records(
        self,
        expected_user_id: str,
        worker_name: str,
        start_date: date,
        end_date: date,
    ) -> list[AppRecord]:
        records: list[AppRecord] = []
        previous_source = None
        stagnant = 0

        for page_number in range(1, 80):
            evidence_path = self._shot(
                expected_user_id,
                worker_name,
                "unpaid-list",
                f"Unpaid_List_{page_number:02d}",
            )
            page_records = self._visible_record_cards(evidence_path)
            records = self._merge_scrolled_page(records, page_records)

            source = self.driver.page_source
            if source == previous_source:
                stagnant += 1
            else:
                stagnant = 0
            previous_source = source

            page_dates = [record.application_date for record in page_records]
            if page_dates and max(page_dates) < start_date:
                break
            if stagnant >= 1:
                break

            try:
                size = self.driver.get_window_size()
                self.driver.execute_script("mobile: scrollGesture", {
                    "left": int(size["width"] * 0.05),
                    "top": int(size["height"] * 0.20),
                    "width": int(size["width"] * 0.90),
                    "height": int(size["height"] * 0.65),
                    "direction": "down",
                    "percent": 0.82,
                })
                sleep(0.8)
            except Exception:
                try:
                    size = self.driver.get_window_size()
                    self.driver.swipe(
                        int(size["width"] * 0.5),
                        int(size["height"] * 0.78),
                        int(size["width"] * 0.5),
                        int(size["height"] * 0.30),
                        700,
                    )
                    sleep(0.8)
                except Exception as error:
                    raise ManualReviewRequired("Unpaid list could not be scrolled safely") from error

        if not records:
            raise ManualReviewRequired(
                "No date-and-amount application cards could be read from the Unpaid list"
            )

        return records

    def verify_account(
        self,
        expected_user_id: str,
        worker_name: str,
        password: str,
        start_date: date,
        end_date: date,
    ) -> JobResult:
        result = JobResult(expected_user_id=expected_user_id)

        self.set_sim_number(expected_user_id)
        self.driver.activate_app(self.package)

        try:
            self._select_login_phone_number(expected_user_id)
        except Exception as error:
            if isinstance(error, AutomationSetupError):
                raise
            raise AutomationSetupError(
                "Phone-number picker could not be opened or selected; batch stopped before another User ID"
            ) from error

        password_field = self._find(self.profile.locators("login_password"))
        password_field.clear()
        password_field.send_keys(password)
        self._find(self.profile.locators("login_button")).click()
        sleep(2)

        page = self.driver.page_source
        lowered = page.lower()

        if "did not match" in lowered or ("snackbar" in lowered and "error" in lowered):
            try:
                message = self._text("login_error_message")
            except Exception:
                message = "Login failed with an unreadable error message"

            result.issue_type = IssueType(classify_login_error(message))
            result.error_message = message
            self._shot(expected_user_id, worker_name, "errors", "Login_Error")
            return result

        # Some sessions land directly on the dashboard; fresh sessions need scheme selection.
        if self._find_optional("dashboard_menu", timeout=3) is None:
            self._find(self.profile.locators("pmfby_insurance"), timeout=20).click()
            for selector in (
                "state_assam",
                "season_kharif",
                "scheme_pmfby",
                "year_2026",
                "submit_next",
            ):
                self._find(self.profile.locators(selector), timeout=20).click()

        # Mandatory identity verification before any count is accepted.
        self._find(self.profile.locators("dashboard_menu"), timeout=25).click()
        result.displayed_name = self._text("menu_displayed_name")
        result.displayed_user_id = self._text("menu_displayed_user_id").replace(" ", "")
        self._shot(expected_user_id, worker_name, "identity", "Logged_In_Identity")

        if self._phone10(result.displayed_user_id or "") != self._phone10(expected_user_id):
            result.issue_type = IssueType.WRONG_ID
            result.error_message = "Displayed User ID does not match expected User ID"
            return result

        self._find(self.profile.locators("menu_close")).click()

        unpaid_text = self._text("dashboard_unpaid_count")
        unpaid_digits = self._digits(unpaid_text)
        if not unpaid_digits:
            raise ManualReviewRequired("Dashboard Unpaid count is not a reliable integer")

        result.dashboard_unpaid = int(unpaid_digits)
        self._shot(expected_user_id, worker_name, "dashboard", "Unpaid_Applications_Count")

        self._find(self.profile.locators("unpaid_tile")).click()
        sleep(1)

        header = self._find_optional("unpaid_list_header_count", timeout=5)
        if header is not None:
            digits = self._digits(header.text)
            if digits:
                result.unpaid_list_count = int(digits)

        # Continue through the list rather than deliberately stopping for calibration.
        result.records = self._scroll_unpaid_records(
            expected_user_id,
            worker_name,
            start_date,
            end_date,
        )

        if result.unpaid_list_count is None:
            result.unpaid_list_count = len(result.records)
            result.metadata["unpaid_list_count_source"] = "extracted_cards"
        else:
            result.metadata["unpaid_list_count_source"] = "header"

        if result.dashboard_unpaid != result.unpaid_list_count:
            result.issue_type = IssueType.COUNT_MISMATCH
            result.error_message = (
                f"Dashboard Unpaid={result.dashboard_unpaid}; "
                f"Unpaid list={result.unpaid_list_count}"
            )

        return result

    def logout(self):
        # Unpaid list may be several screens deep. Back out until the dashboard menu exists.
        for _ in range(4):
            if self._find_optional("dashboard_menu", timeout=2) is not None:
                break
            try:
                self.driver.back()
                sleep(0.6)
            except Exception:
                break

        self._find(self.profile.locators("dashboard_menu"), timeout=15).click()
        self._find(self.profile.locators("sign_out"), timeout=15).click()
        self._find(self.profile.locators("login_mobile_value"), timeout=25)

    def close(self):
        self.driver.quit()
