from __future__ import annotations

from pathlib import Path
from typing import Any
from datetime import UTC, datetime


class CloudClient:
    def __init__(self, url: str, publishable_key: str, email: str, password: str):
        from supabase import create_client
        self.client = create_client(url, publishable_key)
        response = self.client.auth.sign_in_with_password({"email": email, "password": password})
        if not response.session:
            raise RuntimeError("Technical-officer cloud sign-in failed")

    @staticmethod
    def _timestamps(values: dict[str, Any]):
        return {key: datetime.now(UTC).isoformat() if value == "now()" else value for key, value in values.items()}

    def heartbeat(self, **values: Any):
        self.client.table("agent_status").update(self._timestamps(values)).eq("singleton", True).execute()

    def next_command(self):
        response = self.client.table("agent_commands").select("*").eq("status", "queued").order("requested_at").limit(1).execute()
        return response.data[0] if response.data else None

    def accept_command(self, command_id: str):
        self.client.table("agent_commands").update({"status": "accepted", "accepted_at": datetime.now(UTC).isoformat()}).eq("id", command_id).execute()

    def complete_command(self, command_id: str, error: str | None = None):
        values = {"status": "failed" if error else "completed", "completed_at": datetime.now(UTC).isoformat(), "error_message": error}
        self.client.table("agent_commands").update(values).eq("id", command_id).execute()

    def run(self, run_id: str):
        response = self.client.table("verification_runs").select("*").eq("id", run_id).single().execute()
        return response.data

    def update_run(self, run_id: str, values: dict[str, Any]):
        self.client.table("verification_runs").update(self._timestamps(values)).eq("id", run_id).execute()

    def queued_jobs(self, run_id: str):
        return self.client.table("verification_jobs").select("*,workers(id,user_id,name)").eq("run_id", run_id).order("queue_position").execute().data

    def retry_pending_jobs(self, run_id: str | None):
        query = self.client.table("verification_jobs").update({"status": "queued", "final_retry_attempted": True}).eq("status", "pending")
        if run_id:
            query = query.eq("run_id", run_id)
        return query.execute().data

    def update_job(self, job_id: str, values: dict[str, Any]):
        self.client.table("verification_jobs").update(self._timestamps(values)).eq("id", job_id).execute()

    def refresh_agent_counts(self, run_id: str):
        jobs = self.client.table("verification_jobs").select("status,issue_type").eq("run_id", run_id).execute().data
        finished = {"ok", "pending", "manual_review", "failed", "stopped"}
        self.heartbeat(total_ids=len(jobs), completed_ids=sum(job["status"] in finished for job in jobs), running_ids=sum(job["status"] == "running" for job in jobs), password_pending=sum(job["status"] == "pending" and job.get("issue_type") == "password" for job in jobs), network_pending=sum(job["status"] == "pending" and job.get("issue_type") == "network_server" for job in jobs))

    def credential(self, dashboard_url: str, worker_id: str) -> str:
        import httpx
        session = self.client.auth.get_session()
        response = httpx.get(f"{dashboard_url.rstrip('/')}/api/credentials/{worker_id}", headers={"Authorization": f"Bearer {session.access_token}"}, timeout=30)
        response.raise_for_status()
        return response.json()["password"]

    def upload_evidence(self, local_path: Path, remote_path: str, mime_type: str):
        with local_path.open("rb") as source:
            self.client.storage.from_("project-rekhya-evidence").upload(remote_path, source, {"content-type": mime_type, "upsert": "false"})
