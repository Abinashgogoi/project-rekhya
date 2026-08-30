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
        "%d %b %Y",
        "%d %B %Y",
    )
    DATE_RE = re.compile(
        r"\b("
        r"[0-3]?\d[-/.][01]?\d[-/.](?:20)?\d{2}"
        r"|[0-3]?\d\s+[A-Za-z]{3,9}\s+20\d{2}"
        r")\b",
        re.I,
    )

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
        self.progress_callback = None
        self.captured_evidence_paths: list[Path] = []

    def set_progress_callback(self, callback):
        self.progress_callback = callback

    def _report(self, stage: str):
        print(f"[PMFBY] {stage}", flush=True)
        if self.progress_callback:
            try:
                self.progress_callback(stage)
            except Exception:
                pass

    def _click_element_or_parent(self, element):
        current = element
        for _ in range(6):
            try:
                if (
                    current.is_displayed()
                    and str(current.get_attribute("clickable")).lower() == "true"
                ):
                    current.click()
                    return
            except Exception:
                pass

            try:
                current = current.find_element("xpath", "..")
            except Exception:
                break

        try:
            rect = element.rect
            self.driver.execute_script(
                "mobile: clickGesture",
                {
                    "x": int(rect["x"] + rect["width"] / 2),
                    "y": int(rect["y"] + rect["height"] / 2),
                },
            )
            return
        except Exception as error:
            raise AutomationSetupError(
                "Visible navigation item could not be clicked"
            ) from error

    def _open_pmfby_login_form_if_needed(self):
        self._report("Checking PMFBY start screen")

        landing = self._find_optional("pmfby_landing_text", timeout=3)
        if landing is None:
            return

        self._report("PMFBY start screen detected - opening Login")
        button = self._find(
            self.profile.locators("pmfby_landing_login"),
            timeout=10,
        )
        self._click_element_or_parent(button)

        self._report("Waiting for PMFBY login form")
        self._find(
            self.profile.locators("login_mobile_value"),
            timeout=20,
        )

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
        self.captured_evidence_paths.append(path)
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
        self._report("Opening Android mobile-network settings")
        self.device.start_settings()
        sleep(1)

        # State 1: SIM editor already open.
        field = self._find_optional("sim_number_field", timeout=2)

        if field is None:
            # State 2: already inside "SIM info & settings".
            sim_number_row = self._find_optional("sim_number_open", timeout=3)

            if sim_number_row is None:
                # State 3: top-level Mobile network screen.
                self._report("Mobile network screen detected - opening SIM1")
                sim1 = self._find_optional("sim1_overview", timeout=5)

                if sim1 is None:
                    # Extra fallback: current SIM number is visible on the SIM1 card.
                    target = self._phone10(expected_user_id)
                    try:
                        sim1 = self.driver.find_element(
                            "-android uiautomator",
                            f'new UiSelector().textContains("{target}")',
                        )
                    except Exception as error:
                        raise AutomationSetupError(
                            "Could not find SIM1 on Mobile network screen"
                        ) from error

                self._click_element_or_parent(sim1)
                sleep(1)

                self._report("SIM info & settings opened")

                sim_number_row = self._find(
                    self.profile.locators("sim_number_open"),
                    timeout=15,
                )

            self._report("Opening SIM number editor")
            self._click_element_or_parent(sim_number_row)

            field = self._find(
                self.profile.locators("sim_number_field"),
                timeout=15,
            )

        self._report(f"Setting SIM1 number to expected User ID {self._phone10(expected_user_id)}")
        field.click()
        field.clear()
        field.send_keys(expected_user_id)

        saved = self._text("sim_number_value")
        if self._phone10(saved) != self._phone10(expected_user_id):
            raise ManualReviewRequired(
                "SIM number editor does not contain the expected User ID"
            )

        self._report("Saving SIM number")
        self._find(self.profile.locators("sim_number_save")).click()
        sleep(1)
        self._report("SIM number saved and verified")

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
        """Select the exact visible expected number from the Android/Google phone chooser."""
        target = self._phone10(expected_user_id)
        candidates = []

        direct_locators = [
            ("-android uiautomator", f'new UiSelector().text("{target}")'),
            ("-android uiautomator", f'new UiSelector().textContains("{target}")'),
            ("xpath", f'//*[@text="{target}" or contains(@text,"{target}") or contains(@content-desc,"{target}")]'),
        ]
        for by, value in direct_locators:
            try:
                candidates.extend(self.driver.find_elements(by, value))
            except Exception:
                pass

        for locator in self.profile.locators("google_phone_number_choice"):
            try:
                candidates.extend(self.driver.find_elements(locator.by, locator.value))
            except Exception:
                pass

        try:
            candidates.extend(self.driver.find_elements(
                "xpath",
                "//*[contains(@resource-id,'phone_number') or contains(@resource-id,'account') or contains(@resource-id,'sim')]",
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

        matching = []
        unknown = []
        for element in ordered:
            phone = self._phone10(self._candidate_text(element))
            if phone == target:
                matching.append(element)
            elif not phone:
                unknown.append(element)

        chosen = matching or unknown

        for element in chosen:
            current = element
            for _ in range(7):
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
                if self._phone10(self._candidate_text(element)) == target:
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
            f"Phone-number chooser is open but expected number {target} could not be selected"
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

        # Android/UI text may contain one or more layers of UTF-8 text
        # accidentally decoded as Windows-1252. Repair those layers without
        # relying on fragile mojibake string literals.
        for _ in range(3):
            try:
                repaired = text.encode("cp1252").decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                break
            if repaired == text:
                break
            text = repaired

        # Repair UTF-8 rupee text that was decoded as Windows-1252,
        # e.g. mojibake such as Ã¢â€šÂ¹240, while preserving normal text.
        if "Ã¢" in text:
            try:
                repaired = text.encode("cp1252").decode("utf-8")
                if repaired:
                    text = repaired
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass

        # Build the rupee sign at runtime so source encoding cannot corrupt it.
        rupee = chr(0x20B9)

        currency_patterns = (
            re.escape(rupee) + r"\s*([0-9]+(?:\.[0-9]{1,2})?)",
            r"Rs\.?\s*([0-9]+(?:\.[0-9]{1,2})?)",
            r"INR\s*([0-9]+(?:\.[0-9]{1,2})?)",
        )
        for pattern in currency_patterns:
            match = re.search(pattern, text, re.I)
            if match:
                return float(match.group(1))

        labelled = re.search(
            r"(?:amount|premium)\s*[:\-]?\s*"
            + r"(?:(?:" + re.escape(rupee) + r"|Rs\.?|INR)\s*)?"
            + r"([0-9]+(?:\.[0-9]{1,2})?)",
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

    def _visible_record_cards(
        self,
        evidence_path: Path,
    ) -> list[AppRecord]:
        """Parse physically calibrated PMFBY Unpaid cards."""
        cards = self.driver.find_elements(
            "id",
            "com.application.pmfby.aide:id/cl_item",
        )

        records: list[AppRecord] = []

        def child_text(card, child_id: str) -> str:
            try:
                element = card.find_element(
                    "id",
                    f"com.application.pmfby.aide:id/{child_id}",
                )
                return (element.text or "").strip()
            except Exception:
                return ""

        for card in cards:
            policy_id = child_text(card, "tv_policy_id")
            status = child_text(card, "tv_application_status")
            applicant_name = child_text(card, "tv_application_holder")
            amount_text = child_text(card, "tv_amount")
            date_text = child_text(card, "tv_policy_date")

            application_date = self._parse_date(date_text)
            amount = self._parse_amount(amount_text)

            if application_date is None or amount is None:
                try:
                    rect = card.rect
                    viewport_height = int(self.driver.get_window_size().get("height", 0))
                    clipped = (
                        int(rect.get("y", 0)) <= 1
                        or int(rect.get("y", 0)) + int(rect.get("height", 0)) >= max(1, viewport_height - 1)
                    )
                except Exception:
                    clipped = False

                if clipped:
                    self._report(
                        "Skipping a partially clipped Unpaid card; "
                        "it must become readable in an overlapping viewport"
                    )
                    continue

                self._report(
                    "Detector calibration failure: "
                    f"date={date_text!r}, amount={amount_text!r}"
                )
                raise ManualReviewRequired(
                    "DETECTOR READ FAILURE: PMFBY Unpaid card date/amount "
                    "could not be read reliably"
                )

            records.append(
                AppRecord(
                    policy_id=policy_id or None,
                    applicant_name=applicant_name or None,
                    amount=float(amount),
                    application_date=application_date,
                    status=status or None,
                    evidence_path=evidence_path,
                )
            )

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
        expected_total: int,
    ) -> list[AppRecord]:
        """Traverse the complete PMFBY Unpaid RecyclerView.

        Date range is intentionally NOT a scrolling stop condition.
        The full Unpaid list is evidence. Date filtering happens only
        after collection/classification.
        """
        records: list[AppRecord] = []
        previous_signature = None
        stagnant = 0
        reached_end = False

        self._find(
            self.profile.locators("unpaid_list"),
            timeout=15,
        )

        if expected_total <= 0:
            raise ManualReviewRequired(
                f"Invalid expected Unpaid total: {expected_total}"
            )

        self._report(
            f"Full Unpaid traversal required - expected {expected_total} records"
        )

        for page_number in range(1, 120):
            self._report(
                f"Reading Unpaid records - screen {page_number}"
            )

            # Every viewport becomes evidence. A 36-record list therefore
            # produces as many screenshots as physically required.
            evidence_path = self._shot(
                expected_user_id,
                worker_name,
                "unpaid",
                f"Unpaid_List_{page_number:02d}",
            )

            visible = self._visible_record_cards(evidence_path)

            if not visible:
                raise ManualReviewRequired(
                    f"Unpaid screen {page_number} contained no readable cards "
                    f"while {expected_total} records were expected"
                )

            before = len(records)
            records = self._merge_scrolled_page(records, visible)
            after = len(records)

            self._report(
                f"Unpaid traversal progress: captured {after}/{expected_total}"
            )

            # Header total is authoritative for traversal completeness.
            if after >= expected_total:
                reached_end = True
                break

            signature = tuple(
                self._record_key(record)
                for record in visible
            )

            if signature == previous_signature:
                stagnant += 1
            else:
                stagnant = 0

            previous_signature = signature

            # Allow one repeated viewport because RecyclerView/Appium can
            # occasionally report the same viewport immediately after a swipe.
            if stagnant >= 2:
                self._report(
                    "Unpaid list stopped changing before expected total was reached"
                )
                break

            container = self._find(
                self.profile.locators("unpaid_list"),
                timeout=5,
            )

            rect = container.rect

            moved = self.driver.execute_script(
                "mobile: scrollGesture",
                {
                    "left": int(rect["x"]),
                    "top": int(rect["y"]),
                    "width": max(1, int(rect["width"])),
                    "height": max(1, int(rect["height"])),
                    "direction": "down",
                    "percent": 0.82,
                },
            )

            sleep(0.9)

            if moved is False:
                self._report(
                    "PMFBY RecyclerView reported physical end of list"
                )
                reached_end = True
                break

            if after == before:
                self._report(
                    "Scroll moved but produced no new merged records"
                )

        if not records:
            raise ManualReviewRequired(
                "No PMFBY Unpaid cards were read from non-zero list"
            )

        self._report(
            f"Unpaid detector captured {len(records)} records; "
            f"expected {expected_total}"
        )

        # Never silently approve partial evidence.
        if len(records) != expected_total:
            raise ManualReviewRequired(
                f"DETECTOR COUNT MISMATCH: Unpaid header expected "
                f"{expected_total}, but full scroll captured {len(records)}. "
                f"Manual evidence review required."
            )

        if not reached_end and len(records) < expected_total:
            raise ManualReviewRequired(
                "Unpaid list traversal ended before complete evidence was captured"
            )

        return records


    def _recover_authenticated_dashboard(self) -> bool:
        # Login/onboarding is explicitly unauthenticated. Never mistake a
        # generic PMFBY title on this screen for an Unpaid-list checkpoint.
        try:
            if self._find_optional("pmfby_landing_text", timeout=1) is not None:
                self._report("PMFBY login landing detected - authenticated recovery skipped")
                return False
        except Exception:
            pass

        # Fast path: already on the authenticated dashboard.
        try:
            if self._find_optional("dashboard_menu", timeout=2) is not None:
                return True
        except Exception:
            pass

        # If USB was lost while reading the Unpaid list, return only to the
        # nearest safe authenticated checkpoint. A generic tv_title is not
        # sufficient because PMFBY onboarding also uses tv_title.
        unpaid_screen = False
        try:
            if self._find_optional("unpaid_list", timeout=1) is not None:
                unpaid_screen = True
            else:
                title = self._find_optional("unpaid_list_header_count", timeout=1)
                title_text = ((title.text or "").strip().lower()) if title is not None else ""
                unpaid_screen = "unpaid" in title_text
        except Exception:
            unpaid_screen = False

        if not unpaid_screen:
            return False

        for _ in range(6):
            try:
                self.driver.back()
                sleep(0.8)
            except Exception:
                return False

            try:
                if self._find_optional("dashboard_menu", timeout=2) is not None:
                    return True
            except Exception:
                pass

        return False

    def _collect_from_authenticated_dashboard(
        self,
        result: JobResult,
        expected_user_id: str,
        worker_name: str,
        start_date: date,
        end_date: date,
    ) -> JobResult:
        # --------------------------------------------------------
        # 1. Mandatory logged-in User ID verification
        # --------------------------------------------------------
        self._report("Opening PMFBY navigation menu for User ID verification")

        self._find(
            self.profile.locators("dashboard_menu"),
            timeout=25,
        ).click()

        self._report("Reading logged-in User ID from navigation menu")

        result.displayed_user_id = (
            self._text("menu_displayed_user_id")
            .replace(" ", "")
            .strip()
        )

        # Name is secondary. Do not fail identity verification merely because
        # PMFBY does not expose a reliable name element in this drawer.
        name_element = self._find_optional(
            "menu_displayed_name",
            timeout=1,
        )
        if name_element is not None:
            try:
                result.displayed_name = name_element.text.strip()
            except Exception:
                result.displayed_name = worker_name
        else:
            result.displayed_name = worker_name

        self._shot(
            expected_user_id,
            worker_name,
            "identity",
            "Logged_In_Identity",
        )

        expected = self._phone10(expected_user_id)
        displayed = self._phone10(result.displayed_user_id or "")

        if displayed != expected:
            result.issue_type = IssueType.WRONG_ID
            result.error_message = (
                f"Displayed User ID {displayed or '[blank]'} "
                f"does not match expected User ID {expected}"
            )
            self._report(
                "WRONG-ID-LOGIN detected - stopping this account"
            )
            return result

        self._report("Logged-in User ID verified")

        # Physical calibration: drawer close is iv_close.
        self._report("Closing PMFBY navigation menu")
        self._find(
            self.profile.locators("menu_close"),
            timeout=10,
        ).click()

        # Assert that the dashboard is really visible again.
        self._find(
            self.profile.locators("dashboard_menu"),
            timeout=15,
        )

        # --------------------------------------------------------
        # 2. Dashboard Unpaid count
        # --------------------------------------------------------
        self._report("Reading Dashboard Unpaid Applications count")

        unpaid_text = self._text("dashboard_unpaid_count")
        unpaid_digits = self._digits(unpaid_text)

        if not unpaid_digits:
            raise ManualReviewRequired(
                "Dashboard Unpaid count is not a reliable integer"
            )

        result.dashboard_unpaid = int(unpaid_digits)

        self._shot(
            expected_user_id,
            worker_name,
            "dashboard",
            "Unpaid_Applications_Count",
        )

        self._report(
            f"Dashboard Unpaid Applications count = "
            f"{result.dashboard_unpaid}"
        )

        # --------------------------------------------------------
        # 3. Open Unpaid Applications page
        # --------------------------------------------------------
        self._report("Opening Unpaid Applications page")

        self._find(
            self.profile.locators("unpaid_tile"),
            timeout=15,
        ).click()

        title = self._find(
            self.profile.locators("unpaid_page_title"),
            timeout=15,
        )

        title_text = (title.text or "").strip()

        if "unpaid" not in title_text.lower():
            raise ManualReviewRequired(
                f"Unexpected page after opening Unpaid Applications: "
                f"{title_text or '[blank title]'}"
            )

        header_digits = self._digits(title_text)

        if header_digits:
            result.unpaid_list_count = int(header_digits)

        self._report(
            f"Unpaid page opened: {title_text or 'title detected'}"
        )

        # Always keep page proof, including the important zero case.
        self._shot(
            expected_user_id,
            worker_name,
            "unpaid",
            "Unpaid_Page_Opened",
        )

        # --------------------------------------------------------
        # 4. Zero and non-zero handling
        # --------------------------------------------------------
        if result.dashboard_unpaid == 0:
            self._report(
                "Unpaid count is zero - recording zero result without "
                "attempting card extraction"
            )

            result.records = []

            if result.unpaid_list_count is None:
                result.unpaid_list_count = 0
                result.metadata["unpaid_list_count_source"] = (
                    "dashboard_zero_and_verified_unpaid_page"
                )
            else:
                result.metadata["unpaid_list_count_source"] = "header"

        else:
            self._report(
                "Unpaid count is above zero - reading application records"
            )

            expected_total = (
                result.unpaid_list_count
                if result.unpaid_list_count is not None
                else result.dashboard_unpaid
            )

            result.records = self._scroll_unpaid_records(
                expected_user_id,
                worker_name,
                start_date,
                end_date,
                expected_total=expected_total,
            )

            if result.unpaid_list_count is None:
                result.unpaid_list_count = len(result.records)
                result.metadata["unpaid_list_count_source"] = (
                    "extracted_cards"
                )
            else:
                result.metadata["unpaid_list_count_source"] = "header"

            result.metadata["captured_unpaid_records"] = len(result.records)

            if len(result.records) != result.unpaid_list_count:
                result.issue_type = IssueType.COUNT_MISMATCH
                result.error_message = (
                    f"Unpaid header={result.unpaid_list_count}; "
                    f"captured records={len(result.records)}"
                )
                raise ManualReviewRequired(
                    "Full-scroll captured record count does not match "
                    "PMFBY Unpaid header count"
                )

        # Dashboard count and page/header count are separate measurements.
        if (
            result.unpaid_list_count is not None
            and result.dashboard_unpaid != result.unpaid_list_count
        ):
            result.issue_type = IssueType.COUNT_MISMATCH
            result.error_message = (
                f"Dashboard Unpaid={result.dashboard_unpaid}; "
                f"Unpaid list={result.unpaid_list_count}"
            )
            self._report(
                "COUNT MISMATCH between Dashboard and Unpaid page"
            )

        # --------------------------------------------------------
        # 5. Physical back-arrow route to Dashboard
        # --------------------------------------------------------
        self._report("Returning from Unpaid Applications to Dashboard")

        self._find(
            self.profile.locators("unpaid_back"),
            timeout=15,
        ).click()

        # Physical acceptance assertion:
        # hamburger + count + tile must exist again.
        self._find(
            self.profile.locators("dashboard_menu"),
            timeout=15,
        )
        self._find(
            self.profile.locators("dashboard_unpaid_count"),
            timeout=10,
        )
        self._find(
            self.profile.locators("unpaid_tile"),
            timeout=10,
        )

        self._report("Returned to PMFBY Dashboard successfully")

        return result

    def verify_account(
        self,
        expected_user_id: str,
        worker_name: str,
        password: str,
        start_date: date,
        end_date: date,
    ) -> JobResult:
        self.captured_evidence_paths = []
        result = JobResult(expected_user_id=expected_user_id)

        # After a temporary USB loss, first inspect the existing PMFBY
        # session. If authentication survived, resume from a safe checkpoint
        # instead of returning to SIM selector/login.
        self.driver.activate_app(self.package)

        if self._recover_authenticated_dashboard():
            return self._collect_from_authenticated_dashboard(
                result,
                expected_user_id,
                worker_name,
                start_date,
                end_date,
            )

        self.set_sim_number(expected_user_id)

        self._report("Launching official PMFBY app")
        self.driver.activate_app(self.package)

        self._open_pmfby_login_form_if_needed()

        try:
            self._report("Selecting expected mobile number")
            self._select_login_phone_number(expected_user_id)
        except Exception as error:
            if isinstance(error, AutomationSetupError):
                raise
            raise AutomationSetupError(
                "Phone-number picker could not be opened or selected; batch stopped before another User ID"
            ) from error

        self._report("Entering PMFBY password")
        password_field = self._find(self.profile.locators("login_password"))
        password_field.clear()
        password_field.send_keys(password)
        self._report("Submitting PMFBY login")
        self._find(self.profile.locators("login_button")).click()
        self._report("Waiting for PMFBY login response")
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
            self._report("Selecting PMFBY insurance")
            self._find(self.profile.locators("pmfby_insurance"), timeout=20).click()
            scheme_stages = {
                "season_kharif": "Selecting Kharif",
                "scheme_pmfby": "Selecting PMFBY scheme",
                "year_2026": "Selecting year 2026",
                "submit_next": "Submitting scheme selection",
            }
            for selector in (
                "season_kharif",
                "scheme_pmfby",
                "year_2026",
                "submit_next",
            ):
                self._report(scheme_stages[selector])
                self._find(self.profile.locators(selector), timeout=20).click()

        # One canonical dashboard/unpaid state machine is used for both
        # fresh login and reconnect/resume.
        return self._collect_from_authenticated_dashboard(
            result,
            expected_user_id,
            worker_name,
            start_date,
            end_date,
        )


    def logout(self):
        self._report("Preparing PMFBY logout")

        # Normal successful collector already returns to Dashboard.
        # Recovery fallback: if still on the Unpaid page, use the exact
        # physically-tested PMFBY back arrow, not blind multi-back.
        if self._find_optional("dashboard_menu", timeout=2) is None:
            unpaid_back = self._find_optional(
                "unpaid_back",
                timeout=3,
            )
            if unpaid_back is not None:
                self._report(
                    "Unpaid page still open - returning to Dashboard"
                )
                unpaid_back.click()
                sleep(1)

        # Dashboard must be explicitly confirmed before logout.
        self._find(
            self.profile.locators("dashboard_menu"),
            timeout=15,
        )

        self._report("Opening PMFBY navigation menu for Sign out")
        self._find(
            self.profile.locators("dashboard_menu"),
            timeout=15,
        ).click()

        self._report("Selecting Sign out")
        self._find(
            self.profile.locators("sign_out"),
            timeout=15,
        ).click()

        self._report("Waiting for Log Out confirmation")

        title = self._find(
            self.profile.locators("logout_title"),
            timeout=10,
        )

        title_text = (title.text or "").strip().lower()

        if "log out" not in title_text and "logout" not in title_text:
            raise ManualReviewRequired(
                "PMFBY logout confirmation dialog was not verified"
            )

        self._report("Confirming Log Out: Yes")

        self._find(
            self.profile.locators("logout_yes"),
            timeout=10,
        ).click()

        self._report("Waiting for PMFBY Login to continue screen")

        self._find(
            self.profile.locators("pmfby_landing_text"),
            timeout=30,
        )

        self._find(
            self.profile.locators("pmfby_landing_login"),
            timeout=10,
        )

        self._report(
            "Logout completed - Login to continue screen confirmed"
        )

    def close(self):
        self.driver.quit()
