from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PROJECT_REKHYA_", extra="ignore")
    supabase_url: str
    supabase_publishable_key: str
    agent_email: str
    agent_password: str
    dashboard_url: str
    appium_url: str = "http://127.0.0.1:4723"
    android_package: str
    android_activity: str
    device_serial: str | None = None
    selector_profile: Path = Path("selector-profile.json")
    evidence_dir: Path = Path("Evidence")
