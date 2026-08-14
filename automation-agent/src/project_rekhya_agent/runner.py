from __future__ import annotations

import threading
from datetime import date
from time import sleep

from .adb import AdbDevice, PreflightResult
from .appium_flow import AppiumFlow, ManualReviewRequired
from .cloud import CloudClient
from .evidence import EvidenceStore
from .retry import RetryBudget
from .selectors import SelectorProfile
from .settings import Settings


class AgentRunner:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.device = AdbDevice(settings.device_serial)
        self.cloud = CloudClient(settings.supabase_url, settings.supabase_publishable_key, settings.agent_email, settings.agent_password)
        self.pause_event = threading.Event(); self.stop_event = threading.Event(); self.pause_event.set()
        self.service_stop = threading.Event()
        self.worker_thread: threading.Thread | None = None
        self.current_run_id: str | None = None

    def preflight(self):
        result = self.device.preflight(self.settings.android_package)
        try:
            SelectorProfile(self.settings.selector_profile)
        except Exception as error:
            result = PreflightResult(result.device_connected, result.adb_authorized, result.sim_detected, result.official_app_ready, result.internet_ready, result.device_serial, result.problems + (str(error),))
        self.cloud.heartbeat(device_connected=result.device_connected, adb_authorized=result.adb_authorized, sim_detected=result.sim_detected, official_app_ready=result.official_app_ready, cloud_sync_connected=True, status="idle" if not result.problems else "disconnected", heartbeat_at="now()")
        return result

    def process_run(self, run_id: str, start_date: date, end_date: date):
        preflight = self.preflight()
        if preflight.problems:
            raise RuntimeError("; ".join(preflight.problems))
        self.current_run_id = run_id; self.stop_event.clear(); self.pause_event.set()
        self.cloud.update_run(run_id, {"status": "running", "started_at": "now()"})
        self.cloud.heartbeat(status="running", current_stage="Starting verification")
        flow = AppiumFlow(self.settings.appium_url, self.settings.android_package, self.settings.android_activity, self.device, SelectorProfile(self.settings.selector_profile), EvidenceStore(self.settings.evidence_dir))
        try:
            jobs = self.cloud.queued_jobs(run_id)
            for job in jobs:
                if self.stop_event.is_set():
                    break
                self.pause_event.wait()
                worker = job["workers"]; budget = RetryBudget()
                self.cloud.heartbeat(current_user_id=worker["user_id"], current_stage="Signing in")
                self.cloud.update_job(job["id"], {"status": "running", "current_stage": "Signing in", "started_at": "now()"})
                while True:
                    try:
                        password = self.cloud.credential(self.settings.dashboard_url, worker["id"])
                        if not password.strip():
                            self.cloud.update_job(job["id"], {"status": "pending", "issue_type": "password", "error_message": "Password is missing in the uploaded Master workbook.", "password_attempts": 0, "completed_at": "now()"})
                            break
                        result = flow.verify_account(worker["user_id"], worker["name"], password, start_date, end_date)
                        if result.issue_type and result.issue_type.value == "password" and budget.allow_password_retry():
                            continue
                        status = "pending" if result.issue_type else "ok"
                        self.cloud.update_job(job["id"], {"status": status, "issue_type": result.issue_type.value if result.issue_type else None, "displayed_user_id": result.displayed_user_id, "displayed_name": result.displayed_name, "dashboard_unpaid": result.dashboard_unpaid, "unpaid_list_count": result.unpaid_list_count, "error_message": result.error_message, "password_attempts": budget.password_attempts, "completed_at": "now()"})
                        break
                    except ManualReviewRequired as error:
                        self.cloud.update_job(job["id"], {"status": "manual_review", "issue_type": "uncertain_read", "error_message": str(error), "completed_at": "now()"})
                        break
                    except Exception as error:
                        if budget.allow_transient_retry():
                            sleep(2); continue
                        self.cloud.update_job(job["id"], {"status": "pending", "issue_type": "network_server", "error_message": str(error), "transient_attempts": budget.transient_attempts, "completed_at": "now()"})
                        break
                try:
                    flow.logout()
                except Exception:
                    pass
                self.cloud.refresh_agent_counts(run_id)
        finally:
            flow.close()
            final_status = "stopped" if self.stop_event.is_set() else "ok"
            self.cloud.update_run(run_id, {"status": final_status, "completed_at": "now()"})
            self.cloud.heartbeat(status="idle", running_ids=0, current_user_id=None, current_stage=None)
            self.current_run_id = None

    def pause(self): self.pause_event.clear(); self.cloud.heartbeat(status="paused")
    def resume(self): self.pause_event.set(); self.cloud.heartbeat(status="running")
    def stop_safely(self): self.stop_event.set(); self.pause_event.set()

    def _start_run(self, run_id: str):
        if self.worker_thread and self.worker_thread.is_alive():
            raise RuntimeError("A verification run is already active")
        run = self.cloud.run(run_id)
        self.worker_thread = threading.Thread(target=self.process_run, args=(run_id, date.fromisoformat(run["start_date"]), date.fromisoformat(run["end_date"])), daemon=True, name="project-rekhya-runner")
        self.worker_thread.start()

    def handle_command(self, command: dict):
        name = command["command"]; run_id = command.get("run_id")
        if name == "start":
            if not run_id: raise RuntimeError("Start command has no verification run")
            self._start_run(run_id)
        elif name == "pause": self.pause()
        elif name == "resume": self.resume()
        elif name == "stop_safely": self.stop_safely()
        elif name == "retry_pending":
            self.cloud.retry_pending_jobs(run_id or self.current_run_id)
            target = run_id or self.current_run_id
            if target and not (self.worker_thread and self.worker_thread.is_alive()): self._start_run(target)

    def command_loop(self):
        while not self.service_stop.is_set():
            command = self.cloud.next_command()
            if not command:
                sleep(2); continue
            self.cloud.accept_command(command["id"])
            try:
                self.handle_command(command)
                self.cloud.complete_command(command["id"])
            except Exception as error:
                self.cloud.complete_command(command["id"], str(error))
            sleep(1)

    def start_command_loop(self):
        thread = threading.Thread(target=self.command_loop, daemon=True, name="project-rekhya-command-loop")
        thread.start()
        return thread

    def shutdown(self):
        self.service_stop.set(); self.stop_safely()
