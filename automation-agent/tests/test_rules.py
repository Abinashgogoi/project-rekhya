from datetime import date
from pathlib import Path
from unittest import TestCase

from project_rekhya_agent.models import AppRecord
from project_rekhya_agent.retry import RetryBudget
from project_rekhya_agent.rules import classify_login_error, classify_records, flag_duplicate_candidates


class RuleTests(TestCase):
    def record(self, amount: float, day: int, policy: str = "P"):
        return AppRecord(policy, "Farmer", amount, date(2026, 8, day), "Unpaid", Path("evidence.png"))

    def test_app_entry_is_record_count_not_rupee_sum(self):
        result = classify_records([self.record(100, 1), self.record(100, 2), self.record(350, 3), self.record(225, 4)], date(2026, 8, 1), date(2026, 8, 3))
        self.assertEqual((result.normal_total, result.high_total, result.app_entry), (2, 1, 3))

    def test_pre_cutoff_is_preserved_outside_selected_total(self):
        result = classify_records([self.record(100, 1), self.record(100, 5)], date(2026, 8, 5), date(2026, 8, 5))
        self.assertEqual(result.pre_cutoff_count, 1)
        self.assertEqual(result.app_entry, 1)

    def test_finalized_end_date_is_inclusive_and_later_dates_are_excluded(self):
        result = classify_records(
            [self.record(100, 13), self.record(100, 14), self.record(350, 15)],
            date(2026, 8, 1),
            date(2026, 8, 13),
        )
        self.assertEqual((result.normal_total, result.high_total, result.app_entry), (1, 0, 1))

    def test_duplicate_candidates_are_not_deleted(self):
        records = [self.record(350, 3), self.record(350, 3)]
        self.assertEqual(len(flag_duplicate_candidates(records)), 2)

    def test_retry_budgets_are_bounded(self):
        budget = RetryBudget()
        self.assertEqual([budget.allow_password_retry() for _ in range(3)], [True, True, False])
        self.assertEqual([budget.allow_transient_retry() for _ in range(5)], [True, True, True, True, False])

    def test_login_error_classification(self):
        self.assertEqual(classify_login_error("Mobile and password did not match"), "password")
        self.assertEqual(classify_login_error("Server unavailable"), "network_server")
