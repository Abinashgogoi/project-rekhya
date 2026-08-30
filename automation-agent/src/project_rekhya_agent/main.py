from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .runner import AgentRunner
from .settings import Settings

app = FastAPI(title="Project Rekhya Android Verification Agent", docs_url=None, redoc_url=None)
runner: AgentRunner | None = None


@app.on_event("startup")
def startup():
    global runner
    runner = AgentRunner(Settings())
    runner.preflight()
    runner.start_device_health_monitor()
    runner.start_command_loop()


@app.on_event("shutdown")
def shutdown():
    if runner:
        runner.shutdown()


@app.get("/health")
def health():
    return {"project": "project-rekhya", "status": "ready"}


@app.post("/preflight")
def preflight():
    if not runner:
        raise HTTPException(503, "Agent is not initialized")
    runner.start_device_health_monitor()
    runner.start_command_loop()
    return runner.preflight().as_dict()


def run():
    import uvicorn
    uvicorn.run("project_rekhya_agent.main:app", host="127.0.0.1", port=8765, log_level="info")
