from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Iterable

from .models import AppRecord, CountSummary


def classify_records(records: Iterable[AppRecord], start_date: date, end_date: date) -> CountSummary:
    if start_date > end_date:
        raise ValueError("Start Date must be on or before End Date")
    normal = high = pre_cutoff = 0
    for record in records:
        if record.application_date < start_date:
            pre_cutoff += 1
            continue
        if record.application_date > end_date:
            continue
        amount = Decimal(str(record.amount))
        if amount == Decimal("100"):
            normal += 1
        elif amount > Decimal("100"):
            high += 1
    return CountSummary(normal_total=normal, high_total=high, app_entry=normal + high, pre_cutoff_count=pre_cutoff)


def flag_duplicate_candidates(records: list[AppRecord]) -> list[tuple[int, str]]:
    grouped: dict[tuple[str | None, str | None, str, date, str | None], list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        key = (record.policy_id, record.applicant_name, str(Decimal(str(record.amount))), record.application_date, record.status)
        grouped[key].append(index)
    return [(index, "Same Policy ID, applicant, amount, date and status; preserved for manual review") for indexes in grouped.values() if len(indexes) > 1 for index in indexes]


def classify_login_error(message: str) -> str:
    normalized = " ".join(message.lower().split())
    if "mobile and password did not match" in normalized or ("password" in normalized and "did not match" in normalized):
        return "password"
    return "network_server"
