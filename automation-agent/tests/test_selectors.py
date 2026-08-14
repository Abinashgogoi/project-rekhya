import json
from pathlib import Path

from project_rekhya_agent.default_profile import DEFAULT_SELECTORS
from project_rekhya_agent.selectors import SelectorProfile


def test_missing_profile_is_bootstrapped(tmp_path: Path):
    path = tmp_path / "selector-profile.json"

    profile = SelectorProfile(path)

    assert path.exists()
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["project"] == "project-rekhya"
    assert profile.locators("login_mobile_value")[0].value.endswith("id/et_mobile_number")


def test_local_profile_overrides_defaults_and_inherits_missing_keys(tmp_path: Path):
    path = tmp_path / "selector-profile.json"
    path.write_text(
        json.dumps(
            {
                "project": "project-rekhya",
                "schema_version": 1,
                "selectors": {"login_button": [{"by": "id", "value": "custom:id/login"}]},
                "regions": {},
            }
        ),
        encoding="utf-8",
    )

    profile = SelectorProfile(path)

    assert profile.locators("login_button")[0].value == "custom:id/login"
    assert profile.locators("sim_number_field")[0].value == DEFAULT_SELECTORS["sim_number_field"][0]["value"]
