from __future__ import annotations

import threading
from datetime import date
from time import monotonic, sleep

from .adb import AdbDevice, PreflightResult
from .appium_flow import AppiumFlow, AutomationSetupError, ManualReviewRequired
from .appium_service import AppiumService, AppiumServiceError
from .cloud import CloudClient
from .evidence import EvidenceStore
from .retry import RetryBudget
from .rules import classify_records
from .selectors import SelectorProfile
from .settings import Settings


class AgentRunner:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.device = AdbDevice(settings.device_serial)
        self.cloud = CloudClient(
            settings.supabase_url,
            settings.supabase_publishable_key,
            settings.agent_email,
            settings.agent_password,
        )
        self.appium = AppiumService(settings.appium_url)
        self.pause_event = threading.Event()
        self.stop_event = threading.Event()
        self.pause_event.set()
        self.service_stop = threading.Event()
        self.worker_thread: threading.Thread | None = None
        self.health_thread: threading.Thread | None = None
        self.command_thread: threading.Thread | None = None
        self.current_run_id: str | None = None
        self.current_job_id: str | None = None
        self.current_worker_id: str | None = None

    def preflight(self):
        try:
            result = self.device.preflight(self.settings.android_package)
        except Exception as error:
            result = PreflightResult(
                False, False, False, False, False, self.settings.device_serial,
                (f"ADB PREFLIGHT ERROR: {type(error).__name__}: {error}",),
            )
        problems = list(result.problems)

        try:
            SelectorProfile(self.settings.selector_profile)
        except Exception as error:
            problems.append(str(error))

        try:
            self.appium.ensure_started()
        except Exception as error:
            problems.append(str(error))

        result = PreflightResult(
            result.device_connected,
            result.adb_authorized,
            result.sim_detected,
            result.official_app_ready,
            result.internet_ready,
            result.device_serial,
            tuple(problems),
        )

        self.cloud.heartbeat(
            device_connected=result.device_connected,
            adb_authorized=result.adb_authorized,
            sim_detected=result.sim_detected,
            official_app_ready=result.official_app_ready,
            cloud_sync_connected=True,
            status="idle" if not result.problems else "disconnected",
            current_stage="Ready" if not result.problems else "Preflight blocked",
            current_user_id=None,
            running_ids=0,
            heartbeat_at="now()",
        )
        return result

    def report_stage(self, job_id: str, user_id: str, stage: str):
        print(f"[Project Rekhya] User {user_id}: {stage}", flush=True)
        self.cloud.heartbeat(
            status="running",
            current_user_id=user_id,
            current_stage=stage,
            heartbeat_at="now()",
        )
        self.cloud.update_job(job_id, {
            "current_stage": stage,
        })

    def wait_for_device_reconnect(self, timeout_seconds: int = 90) -> bool:
        deadline = monotonic() + timeout_seconds

        self.cloud.heartbeat(
            status="paused",
            device_connected=False,
            adb_authorized=False,
            current_stage="USB disconnected - waiting for reconnect",
            heartbeat_at="now()",
        )

        while monotonic() < deadline:
            if self.stop_event.is_set() or self.service_stop.is_set():
                return False

            try:
                state = self.device.preflight(self.settings.android_package)

                if state.device_connected and state.adb_authorized:
                    self.cloud.heartbeat(
                        device_connected=True,
                        adb_authorized=True,
                        sim_detected=state.sim_detected,
                        official_app_ready=state.official_app_ready,
                        cloud_sync_connected=True,
                        status="running",
                        current_stage="Device reconnected - resuming current worker",
                        heartbeat_at="now()",
                    )
                    sleep(2)
                    return True

            except Exception:
                pass

            self.service_stop.wait(2)

        return False

    def process_run(self, run_id: str, start_date: date, end_date: date):
        preflight = self.preflight()
        if preflight.problems:
            raise RuntimeError("; ".join(preflight.problems))

        self.current_run_id = run_id
        self.stop_event.clear()
        self.pause_event.set()
        self.cloud.update_run(run_id, {"status": "running", "started_at": "now()"})
        self.cloud.heartbeat(status="running", current_stage="Starting verification")

        flow = AppiumFlow(
            self.settings.appium_url,
            self.settings.android_package,
            self.settings.android_activity,
            self.device,
            SelectorProfile(self.settings.selector_profile),
            EvidenceStore(self.settings.evidence_dir),
        )

        setup_error: str | None = None

        try:
            jobs = self.cloud.queued_jobs(run_id)

            for job in jobs:
                if self.stop_event.is_set():
                    break

                self.pause_event.wait()
                worker = job["workers"]
                self.current_job_id = job["id"]
                self.current_worker_id = worker["id"]
                budget = RetryBudget()
                account_session_started = False

                self.cloud.heartbeat(
                    current_user_id=worker["user_id"],
                    current_stage="Signing in",
                )
                self.cloud.update_job(job["id"], {
                    "status": "running",
                    "current_stage": "Signing in",
                    "started_at": "now()",
                })

                flow.set_progress_callback(
                    lambda stage, job_id=job["id"], user_id=worker["user_id"]:
                        self.report_stage(job_id, user_id, stage)
                )

                while True:
                    try:
                        password = self.cloud.credential(
                            self.settings.dashboard_url,
                            worker["id"],
                        )
                        if not password.strip():
                            self.cloud.update_job(job["id"], {
                                "status": "pending",
                                "issue_type": "password",
                                "error_message": "Password is missing in the uploaded Master workbook.",
                                "password_attempts": 0,
                                "completed_at": "now()",
                            })
                            break

                        account_session_started = True
                        result = flow.verify_account(
                            worker["user_id"],
                            worker["name"],
                            password,
                            start_date,
                            end_date,
                        )
                        result.metadata["evidence_paths"] = [
                            str(path) for path in flow.captured_evidence_paths
                        ]

                        if (
                            result.issue_type
                            and result.issue_type.value == "password"
                            and budget.allow_password_retry()
                        ):
                            continue

                        status = "pending" if result.issue_type else "ok"
                        summary = classify_records(result.records, start_date, end_date)

                        self.cloud.persist_app_result(
                            run_id=run_id,
                            job_id=job["id"],
                            worker_id=worker["id"],
                            start_date=start_date,
                            end_date=end_date,
                            result=result,
                            summary=summary,
                            status=status,
                        )
                        self.cloud.assert_app_result_visible(
                            run_id=run_id,
                            job_id=job["id"],
                            worker_id=worker["id"],
                            user_id=worker["user_id"],
                            start_date=start_date,
                            end_date=end_date,
                            summary=summary,
                            status=status,
                        )

                        self.cloud.update_job(job["id"], {
                            "status": status,
                            "issue_type": result.issue_type.value if result.issue_type else None,
                            "displayed_user_id": result.displayed_user_id,
                            "displayed_name": result.displayed_name,
                            "dashboard_unpaid": result.dashboard_unpaid,
                            "unpaid_list_count": result.unpaid_list_count,
                            "error_message": result.error_message,
                            "password_attempts": budget.password_attempts,
                            "completed_at": "now()",
                        })
                        break

                    except ManualReviewRequired as error:
                        message = str(error)
                        try:
                            self.cloud.persist_captured_evidence(
                                run_id=run_id,
                                job_id=job["id"],
                                worker_id=worker["id"],
                                paths=list(flow.captured_evidence_paths),
                            )
                        except Exception as evidence_error:
                            message = f"{message}; evidence upload error: {evidence_error}"
                        lowered = message.lower()
                        issue_type = (
                            "count_mismatch"
                            if "count mismatch" in lowered
                            else "uncertain_read"
                        )
                        self.report_stage(
                            job["id"],
                            worker["user_id"],
                            f"MANUAL REVIEW REQUIRED: {message}",
                        )
                        self.cloud.update_job(job["id"], {
                            "status": "manual_review",
                            "issue_type": issue_type,
                            "error_message": message,
                            "completed_at": "now()",
                        })
                        self.cloud.save_checkpoint(
                            run_id=run_id,
                            job_id=job["id"],
                            worker_id=worker["id"],
                            stage="manual_review",
                            app_location="pmfby",
                            displayed_user_id=worker["user_id"],
                            last_completed_action="detector/manual review stop",
                            next_action="manual review",
                            interruption_reason=message,
                            resumable=False,
                            state={"issue_type": issue_type},
                        )
                        break

                    except AutomationSetupError as error:
                        setup_error = str(error)
                        try:
                            self.cloud.persist_captured_evidence(
                                run_id=run_id,
                                job_id=job["id"],
                                worker_id=worker["id"],
                                paths=list(flow.captured_evidence_paths),
                            )
                        except Exception as evidence_error:
                            setup_error = f"{setup_error}; evidence upload error: {evidence_error}"
                        self.report_stage(
                            job["id"],
                            worker["user_id"],
                            f"AUTOMATION SETUP ERROR: {error}",
                        )
                        self.cloud.update_job(job["id"], {
                            "status": "manual_review",
                            "issue_type": "uncertain_read",
                            "error_message": str(error),
                            "completed_at": "now()",
                        })
                        self.cloud.heartbeat(
                            status="paused",
                            current_stage="Setup error - batch stopped safely",
                            running_ids=0,
                        )
                        self.stop_event.set()
                        break

                    except Exception as error:
                        self.report_stage(
                            job["id"],
                            worker["user_id"],
                            f"Automation interrupted: {type(error).__name__}: {error}",
                        )
                        try:
                            device_state = self.device.preflight(
                                self.settings.android_package
                            )
                        except Exception:
                            device_state = None

                        device_lost = (
                            device_state is None
                            or not device_state.device_connected
                            or not device_state.adb_authorized
                        )

                        if device_lost:
                            try:
                                self.cloud.save_checkpoint(
                                    run_id=run_id,
                                    job_id=job["id"],
                                    worker_id=worker["id"],
                                    stage="device_interrupted",
                                    app_location="unknown",
                                    displayed_user_id=worker["user_id"],
                                    last_completed_action=job.get("current_stage"),
                                    next_action="reconcile current PMFBY page and resume same User ID",
                                    interruption_reason=str(error),
                                    resumable=True,
                                    state={"retry_same_worker": True},
                                )
                            except Exception:
                                pass
                            reconnected = self.wait_for_device_reconnect()

                            if reconnected:
                                self.cloud.update_job(job["id"], {
                                    "status": "running",
                                    "current_stage": "Resuming after USB reconnect",
                                    "error_message": None,
                                })
                                continue

                            self.cloud.update_job(job["id"], {
                                "status": "pending",
                                "issue_type": "device",
                                "error_message": (
                                    "Android device did not reconnect within "
                                    "the recovery window."
                                ),
                                "completed_at": "now()",
                            })
                            break

                        message = str(error)
                        non_transient_detector = any(
                            token in message.lower()
                            for token in ("detector", "selector", "calibration", "count mismatch")
                        )
                        if non_transient_detector:
                            self.cloud.update_job(job["id"], {
                                "status": "manual_review",
                                "issue_type": "count_mismatch" if "count mismatch" in message.lower() else "uncertain_read",
                                "error_message": message,
                                "completed_at": "now()",
                            })
                            break

                        if budget.allow_transient_retry():
                            sleep(2)
                            continue

                        self.cloud.update_job(job["id"], {
                            "status": "pending",
                            "issue_type": "network_server",
                            "error_message": str(error),
                            "transient_attempts": budget.transient_attempts,
                            "completed_at": "now()",
                        })
                        break

                if not setup_error and account_session_started:
                    try:
                        flow.logout()
                    except Exception as logout_error:
                        setup_error = (
                            f"LOGOUT VERIFICATION FAILED after User ID "
                            f"{worker['user_id']}: {logout_error}"
                        )
                        try:
                            self.cloud.persist_captured_evidence(
                                run_id=run_id,
                                job_id=job["id"],
                                worker_id=worker["id"],
                                paths=list(flow.captured_evidence_paths),
                            )
                        except Exception:
                            pass
                        try:
                            self.cloud.save_checkpoint(
                                run_id=run_id,
                                job_id=job["id"],
                                worker_id=worker["id"],
                                stage="logout_failed",
                                app_location="pmfby_authenticated_session",
                                displayed_user_id=worker["user_id"],
                                last_completed_action="account data collection",
                                next_action="verify logout before continuing batch",
                                interruption_reason=setup_error,
                                resumable=False,
                                state={"next_user_blocked": True},
                            )
                        except Exception:
                            pass
                        self.cloud.heartbeat(
                            status="paused",
                            current_stage=setup_error,
                            running_ids=0,
                        )
                        self.stop_event.set()

                self.cloud.refresh_agent_counts(run_id)

                if setup_error:
                    break

        finally:
            flow.close()
            self.cloud.finalize_run_status(
                run_id,
                stopped=self.stop_event.is_set(),
            )
            self.cloud.heartbeat(
                status="paused" if setup_error else "idle",
                running_ids=0,
                current_user_id=None,
                current_stage="Setup error - batch stopped safely" if setup_error else None,
            )
            self.current_run_id = None
            self.current_job_id = None
            self.current_worker_id = None

    def pause(self):
        # Boundary-safe pause: current User ID is allowed to finish/logout.
        self.pause_event.clear()
        self.cloud.heartbeat(
            status="paused",
            current_stage="Pause requested - finishing current User ID before pausing",
        )

    def resume(self):
        self.pause_event.set()
        self.cloud.heartbeat(
            status="running",
            current_stage="Resume requested",
        )

    def stop_safely(self):
        # Boundary-safe stop: current User ID is allowed to finish/logout.
        self.stop_event.set()
        self.pause_event.set()
        self.cloud.heartbeat(
            current_stage="Safe stop requested - finishing current User ID before stopping",
        )

    def _start_run(self, run_id: str):
        if self.worker_thread and self.worker_thread.is_alive():
            raise RuntimeError("A verification run is already active")

        run = self.cloud.run(run_id)
        self.worker_thread = threading.Thread(
            target=self.process_run,
            args=(
                run_id,
                date.fromisoformat(run["start_date"]),
                date.fromisoformat(run["end_date"]),
            ),
            daemon=True,
            name="project-rekhya-runner",
        )
        self.worker_thread.start()

    def handle_command(self, command: dict):
        name = command["command"]
        run_id = command.get("run_id")

        if name == "prepare":
            # Website-triggered preparation. preflight() updates cloud heartbeat
            # with exact Android/ADB/SIM/app readiness and starts Appium if needed.
            self.preflight()
        elif name == "start":
            if not run_id:
                raise RuntimeError("Start command has no verification run")
            self._start_run(run_id)
        elif name == "pause":
            if not (self.worker_thread and self.worker_thread.is_alive()):
                raise RuntimeError("Pause requires an active local verification run")
            self.pause()
        elif name == "resume":
            if self.worker_thread and self.worker_thread.is_alive():
                self.resume()
            else:
                if not run_id:
                    raise RuntimeError("Resume requires a specific verification run")
                self.cloud.prepare_resume_run(run_id)
                self._start_run(run_id)
        elif name == "stop_safely":
            if not (self.worker_thread and self.worker_thread.is_alive()):
                self.cloud.heartbeat(
                    status="idle",
                    current_stage="Safe stop acknowledged - no local run is active",
                )
            else:
                self.stop_safely()
        elif name == "retry_pending":
            target = run_id or self.current_run_id
            if not target:
                raise RuntimeError("Retry pending requires a specific verification run")
            if self.worker_thread and self.worker_thread.is_alive():
                raise RuntimeError(
                    "Retry pending cannot mutate an active run snapshot; "
                    "finish/stop the current run first"
                )
            self.cloud.retry_pending_jobs(target)
            self._start_run(target)

    def command_loop(self):
        while not self.service_stop.is_set():
            try:
                command = self.cloud.next_command()
            except Exception as error:
                print(
                    f"[Project Rekhya] Cloud command poll interrupted: {type(error).__name__}: {error}",
                    flush=True,
                )
                try:
                    self.cloud.heartbeat(
                        cloud_sync_connected=False,
                        current_stage=f"Cloud command poll interrupted: {type(error).__name__}: {error}",
                        heartbeat_at="now()",
                    )
                except Exception:
                    pass
                self.service_stop.wait(2)
                continue

            if not command:
                sleep(2)
                continue

            try:
                self.cloud.accept_command(command["id"])
                try:
                    self.handle_command(command)
                    self.cloud.complete_command(command["id"])
                except Exception as error:
                    self.cloud.complete_command(command["id"], str(error))
            except Exception as error:
                print(
                    f"[Project Rekhya] Command processing cloud I/O interrupted: {type(error).__name__}: {error}",
                    flush=True,
                )
            sleep(1)

    def device_health_loop(self):
        while not self.service_stop.is_set():
            try:
                result = self.device.preflight(self.settings.android_package)

                ready = (
                    result.device_connected
                    and result.adb_authorized
                    and result.sim_detected
                    and result.official_app_ready
                )

                if self.worker_thread and self.worker_thread.is_alive():
                    status = "running"
                else:
                    status = "idle" if ready else "disconnected"

                heartbeat_values = {
                    "device_connected": result.device_connected,
                    "adb_authorized": result.adb_authorized,
                    "sim_detected": result.sim_detected,
                    "official_app_ready": result.official_app_ready,
                    "cloud_sync_connected": True,
                    "status": status,
                    "heartbeat_at": "now()",
                }

                # Do not erase the real automation stage while a worker is active.
                if not (self.worker_thread and self.worker_thread.is_alive()):
                    heartbeat_values["current_stage"] = (
                        "Device ready"
                        if ready
                        else (
                            result.problems[0]
                            if result.problems
                            else "Device unavailable"
                        )
                    )

                self.cloud.heartbeat(**heartbeat_values)

            except Exception as error:
                try:
                    self.cloud.heartbeat(
                        device_connected=False,
                        adb_authorized=False,
                        sim_detected=False,
                        official_app_ready=False,
                        cloud_sync_connected=True,
                        status="disconnected",
                        current_stage=f"Device health error: {error}",
                        heartbeat_at="now()",
                    )
                except Exception:
                    pass

            self.service_stop.wait(3)

    def start_device_health_monitor(self):
        if self.health_thread and self.health_thread.is_alive():
            return self.health_thread

        self.health_thread = threading.Thread(
            target=self.device_health_loop,
            daemon=True,
            name="project-rekhya-device-health",
        )
        self.health_thread.start()
        return self.health_thread

    def start_command_loop(self):
        if self.command_thread and self.command_thread.is_alive():
            return self.command_thread

        self.command_thread = threading.Thread(
            target=self.command_loop,
            daemon=True,
            name="project-rekhya-command-loop",
        )
        self.command_thread.start()
        return self.command_thread

    def shutdown(self):
        self.service_stop.set()
        self.stop_safely()
