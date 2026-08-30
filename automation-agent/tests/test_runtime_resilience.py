from pathlib import Path

def test_checkpoint_insert_omits_generated_sequence_number():
    source = Path("src/project_rekhya_agent/cloud.py").read_text(encoding="utf-8")
    start = source.index("    def save_checkpoint(")
    end = source.index("    def latest_checkpoint", start)
    block = source[start:end]
    assert '"sequence_no"' not in block
    assert 'table("verification_checkpoints").insert({' in block

def test_command_loop_handles_poll_disconnect():
    source = Path("src/project_rekhya_agent/runner.py").read_text(encoding="utf-8")
    start = source.index("    def command_loop(self):")
    end = source.index("    def device_health_loop", start)
    block = source[start:end]
    assert "Cloud command poll interrupted" in block
    assert "self.service_stop.wait(2)" in block
