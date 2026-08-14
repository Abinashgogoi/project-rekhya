from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from pathlib import Path
from typing import Any


class Stage(StrEnum):
    PREFLIGHT = "Pre-flight check"
    SIM_NUMBER = "Changing SIM 1 number"
    LOGIN = "Signing in"
    SCHEME = "Selecting PMFBY"
    VERIFY_ID = "Verifying logged-in User ID"
    DASHBOARD = "Reading Dashboard Unpaid Applications"
    UNPAID_LIST = "Reading Unpaid Applications"
    LOGOUT = "Signing out"
    COMPLETE = "Complete"


class IssueType(StrEnum):
    PASSWORD = "password"
    NETWORK_SERVER = "network_server"
    WRONG_ID = "wrong_id"
    COUNT_MISMATCH = "count_mismatch"
    POSSIBLE_DUPLICATE = "possible_duplicate"
    UNCERTAIN_READ = "uncertain_read"
    DEVICE = "device"
    OTHER = "other"


@dataclass(frozen=True)
class AppRecord:
    policy_id: str | None
    applicant_name: str | None
    amount: float
    application_date: date
    status: str | None
    evidence_path: Path
    possible_duplicate: bool = False
    review_reason: str | None = None


@dataclass(frozen=True)
class CountSummary:
    normal_total: int
    high_total: int
    app_entry: int
    pre_cutoff_count: int


@dataclass
class JobResult:
    expected_user_id: str
    displayed_user_id: str | None = None
    displayed_name: str | None = None
    dashboard_unpaid: int | None = None
    unpaid_list_count: int | None = None
    records: list[AppRecord] = field(default_factory=list)
    issue_type: IssueType | None = None
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
