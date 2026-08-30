from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import AppRecord, CountSummary


class CloudClient:
    def __init__(self, url: str, publishable_key: str, email: str, password: str):
        from supabase import create_client
        self.client = create_client(url, publishable_key)
        response = self.client.auth.sign_in_with_password({"email": email, "password": password})
        if not response.session:
            raise RuntimeError("Technical-officer cloud sign-in failed")
        self.evidence_provider = os.getenv("REKHYA_EVIDENCE_PROVIDER", "supabase").strip().lower()
        self.gcs_bucket_name = os.getenv("REKHYA_GCS_BUCKET", "project-rekhya-evidence").strip()
        self.gcs_client = None
        if self.evidence_provider == "google_cloud_storage":
            from google.cloud import storage
            self.gcs_client = storage.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT") or None)

    @staticmethod
    def _timestamps(values: dict[str, Any]):
        return {
            key: datetime.now(UTC).isoformat() if value == "now()" else value
            for key, value in values.items()
        }

    def heartbeat(self, **values: Any):
        self.client.table("agent_status").update(self._timestamps(values)).eq("singleton", True).execute()

    def next_command(self):
        response = (
            self.client.table("agent_commands")
            .select("*")
            .eq("status", "queued")
            .order("requested_at")
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def accept_command(self, command_id: str):
        self.client.table("agent_commands").update({
            "status": "accepted",
            "accepted_at": datetime.now(UTC).isoformat(),
        }).eq("id", command_id).execute()

    def complete_command(self, command_id: str, error: str | None = None):
        values = {
            "status": "failed" if error else "completed",
            "completed_at": datetime.now(UTC).isoformat(),
            "error_message": error,
        }
        self.client.table("agent_commands").update(values).eq("id", command_id).execute()

    def run(self, run_id: str):
        return self.client.table("verification_runs").select("*").eq("id", run_id).single().execute().data

    def update_run(self, run_id: str, values: dict[str, Any]):
        self.client.table("verification_runs").update(self._timestamps(values)).eq("id", run_id).execute()

    def queued_jobs(self, run_id: str):
        # A restarted/resumed run must never replay already-finished jobs.
        return (
            self.client.table("verification_jobs")
            .select("*,workers(id,user_id,name)")
            .eq("run_id", run_id)
            .eq("status", "queued")
            .order("queue_position")
            .execute()
            .data
        )

    def prepare_resume_run(self, run_id: str):
        """Safely restore only resumable unfinished jobs for a stopped agent process.

        Completed/manual-review/password/network jobs are intentionally left untouched.
        A stale RUNNING job is re-queued only when its latest checkpoint explicitly says
        it is resumable. This prevents a historical completed job from being replayed.
        """
        jobs = (
            self.client.table("verification_jobs")
            .select("id,status,issue_type,queue_position")
            .eq("run_id", run_id)
            .order("queue_position")
            .execute()
            .data
        )

        requeued = []
        for job in jobs:
            status = job.get("status")
            if status == "queued":
                requeued.append(job["id"])
                continue

            checkpoint = self.latest_checkpoint(job["id"])
            checkpoint_resumable = bool(checkpoint and checkpoint.get("resumable"))

            safe_resume = (
                status in {"running", "paused"}
                or (status == "pending" and job.get("issue_type") == "device")
            )

            if safe_resume and checkpoint_resumable:
                self.client.table("verification_jobs").update({
                    "status": "queued",
                    "current_stage": "Queued for checkpoint-safe resume",
                    "error_message": None,
                    "completed_at": None,
                }).eq("id", job["id"]).execute()
                requeued.append(job["id"])

        if not requeued:
            raise RuntimeError(
                "This run has no queued or checkpoint-resumable job. "
                "Completed/manual-review/password/network jobs were not replayed."
            )

        self.client.table("verification_runs").update({
            "status": "queued",
            "completed_at": None,
        }).eq("id", run_id).execute()
        return requeued

    def retry_pending_jobs(self, run_id: str | None):
        query = (
            self.client.table("verification_jobs")
            .update({
                "status": "queued",
                "final_retry_attempted": True,
                "completed_at": None,
                "error_message": None,
            })
            .eq("status", "pending")
            .eq("final_retry_attempted", False)
        )
        if run_id:
            query = query.eq("run_id", run_id)
        rows = query.execute().data
        if not rows:
            raise RuntimeError("No pending verification jobs remain eligible for the one final retry")
        return rows

    def update_job(self, job_id: str, values: dict[str, Any]):
        self.client.table("verification_jobs").update(self._timestamps(values)).eq("id", job_id).execute()

    def refresh_agent_counts(self, run_id: str):
        jobs = (
            self.client.table("verification_jobs")
            .select("status,issue_type")
            .eq("run_id", run_id)
            .execute()
            .data
        )
        finished = {"ok", "pending", "manual_review", "failed", "stopped"}
        self.heartbeat(
            total_ids=len(jobs),
            completed_ids=sum(job["status"] in finished for job in jobs),
            running_ids=sum(job["status"] == "running" for job in jobs),
            password_pending=sum(
                job["status"] == "pending" and job.get("issue_type") == "password"
                for job in jobs
            ),
            network_pending=sum(
                job["status"] == "pending" and job.get("issue_type") == "network_server"
                for job in jobs
            ),
        )

    def credential(self, dashboard_url: str, worker_id: str) -> str:
        import httpx
        session = self.client.auth.get_session()
        response = httpx.get(
            f"{dashboard_url.rstrip('/')}/api/credentials/{worker_id}",
            headers={"Authorization": f"Bearer {session.access_token}"},
            timeout=30,
        )
        if response.status_code >= 400:
            try:
                payload = response.json()
                detail = payload.get("error") if isinstance(payload, dict) else None
            except Exception:
                detail = None
            raise RuntimeError(
                f"Credential API {response.status_code}: "
                f"{detail or 'server returned an unreadable error'}"
            )
        return response.json()["password"]

    def upload_evidence(self, local_path: Path, remote_path: str, mime_type: str):
        if self.evidence_provider == "google_cloud_storage":
            if self.gcs_client is None:
                raise RuntimeError("Google Cloud Storage client is not initialized")
            bucket = self.gcs_client.bucket(self.gcs_bucket_name)
            blob = bucket.blob(remote_path)
            if not blob.exists():
                blob.upload_from_filename(str(local_path), content_type=mime_type)
            return {
                "storage_provider": "google_cloud_storage",
                "storage_bucket": self.gcs_bucket_name,
                "storage_path": remote_path,
                "object_key": remote_path,
            }

        with local_path.open("rb") as source:
            self.client.storage.from_("project-rekhya-evidence").upload(
                remote_path,
                source,
                {"content-type": mime_type, "upsert": "false"},
            )
        return {
            "storage_provider": "supabase",
            "storage_bucket": "project-rekhya-evidence",
            "storage_path": remote_path,
            "object_key": remote_path,
        }

    def persist_captured_evidence(
        self,
        *,
        run_id: str,
        job_id: str,
        worker_id: str,
        paths: list[Path],
    ):
        seen_paths: set[Path] = set()
        for path in paths:
            path = Path(path)
            if path in seen_paths or not path.exists():
                continue
            seen_paths.add(path)

            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            remote_path = f"{run_id}/{worker_id}/{path.name}"
            try:
                storage_meta = self.upload_evidence(path, remote_path, "image/png")
            except Exception as error:
                if "already exists" not in str(error).lower() and "duplicate" not in str(error).lower():
                    raise
                storage_meta = {
                    "storage_provider": self.evidence_provider,
                    "storage_bucket": self.gcs_bucket_name if self.evidence_provider == "google_cloud_storage" else "project-rekhya-evidence",
                    "storage_path": remote_path,
                    "object_key": remote_path,
                }

            category = "unpaid-list"
            lowered = str(path).lower()
            if "identity" in lowered:
                category = "identity"
            elif "dashboard" in lowered:
                category = "dashboard"
            elif "error" in lowered:
                category = "errors"

            self.client.table("evidence_files").upsert({
                "worker_id": worker_id,
                "run_id": run_id,
                "job_id": job_id,
                "category": category,
                "storage_provider": storage_meta["storage_provider"],
                "storage_bucket": storage_meta["storage_bucket"],
                "storage_path": storage_meta["storage_path"],
                "object_key": storage_meta["object_key"],
                "file_size_bytes": path.stat().st_size,
                "run_scope": "current",
                "original_filename": path.name,
                "mime_type": "image/png",
                "sha256": digest,
                "metadata": {"source": "automation-agent"},
            }, on_conflict="storage_path").execute()

    def finalize_run_status(self, run_id: str, *, stopped: bool = False) -> str:
        if stopped:
            final_status = "stopped"
        else:
            rows = (
                self.client.table("verification_jobs")
                .select("status")
                .eq("run_id", run_id)
                .execute()
                .data
            )
            statuses = {row["status"] for row in rows}
            final_status = "ok" if statuses and statuses <= {"ok"} else "pending"

        self.update_run(run_id, {
            "status": final_status,
            "completed_at": "now()",
        })
        return final_status

    def save_checkpoint(
        self,
        *,
        run_id: str,
        job_id: str,
        worker_id: str,
        stage: str,
        app_location: str,
        displayed_user_id: str | None = None,
        last_completed_action: str | None = None,
        next_action: str | None = None,
        interruption_reason: str | None = None,
        resumable: bool = True,
        state: dict[str, Any] | None = None,
    ):
        self.client.table("verification_checkpoints").insert({
            "run_id": run_id,
            "job_id": job_id,
            "worker_id": worker_id,
            "stage": stage,
            "app_location": app_location,
            "displayed_user_id": displayed_user_id,
            "last_completed_action": last_completed_action,
            "next_action": next_action,
            "interruption_reason": interruption_reason,
            "resumable": resumable,
            "state": state or {},
        }).execute()

    def latest_checkpoint(self, job_id: str):
        rows = (
            self.client.table("verification_checkpoints")
            .select("*")
            .eq("job_id", job_id)
            .order("sequence_no", desc=True)
            .limit(1)
            .execute()
            .data
        )
        return rows[0] if rows else None

    def persist_app_result(
        self,
        *,
        run_id: str,
        job_id: str,
        worker_id: str,
        start_date,
        end_date,
        result,
        summary: CountSummary,
        status: str,
    ):
        # Re-running a job must not duplicate records from the same run/job.
        self.client.table("app_records").delete().eq("job_id", job_id).execute()

        if result.records:
            rows = []
            for position, record in enumerate(result.records, start=1):
                rows.append({
                    "run_id": run_id,
                    "job_id": job_id,
                    "worker_id": worker_id,
                    "policy_id": record.policy_id,
                    "applicant_name": record.applicant_name,
                    "amount": record.amount,
                    "application_date": record.application_date.isoformat(),
                    "status": record.status,
                    "list_position": position,
                    "evidence_sequence": position,
                    "possible_duplicate": record.possible_duplicate,
                    "review_reason": record.review_reason,
                })
            self.client.table("app_records").insert(rows).execute()

        summary_payload = {
            "run_id": run_id,
            "worker_id": worker_id,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "normal_total": summary.normal_total,
            "high_total": summary.high_total,
            "dashboard_unpaid": result.dashboard_unpaid,
            "unpaid_list_count": result.unpaid_list_count,
            "pre_cutoff_count": summary.pre_cutoff_count,
            "status": status,
            "issue_type": result.issue_type.value if result.issue_type else None,
        }
        self.client.table("app_summaries").upsert(
            summary_payload,
            on_conflict="run_id,worker_id,start_date,end_date",
        ).execute()

        # Upload every captured screenshot once, not just card-linked images.
        candidates = [Path(value) for value in result.metadata.get("evidence_paths", [])]
        candidates.extend(Path(record.evidence_path) for record in result.records)
        self.persist_captured_evidence(
            run_id=run_id,
            job_id=job_id,
            worker_id=worker_id,
            paths=candidates,
        )
