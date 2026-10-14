import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


class WorkerStdoutTest(unittest.TestCase):
    """The host parses stdout as one JSON answer; nothing else may reach it."""

    def run_script(self, body: str) -> subprocess.CompletedProcess[bytes]:
        src = Path(__file__).resolve().parent
        script = (
            "import os, sys\n"
            f"sys.path.insert(0, {str(src)!r})\n"
            "from protocol import EngineResponse\n"
            "from worker_engine.stdio import _configure_stdio, _write_json_response, capture_stderr_tail\n"
            "_configure_stdio()\n"
            + body
        )
        return subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=60, env=dict(os.environ))

    def test_prints_and_native_writes_while_handling_stay_off_the_answer(self) -> None:
        completed = self.run_script(
            "with capture_stderr_tail():\n"
            "    print('a library warning')\n"
            "    sys.stdout.flush()\n"
            "    os.write(1, b'native noise\\n')\n"
            "_write_json_response(EngineResponse(id='r1', ok=True))\n"
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout.decode("utf-8"))["id"], "r1")
        self.assertIn(b"a library warning", completed.stderr)
        self.assertIn(b"native noise", completed.stderr)

    def test_a_print_before_handling_does_not_reach_the_answer(self) -> None:
        completed = self.run_script(
            "print('import-time banner')\n"
            "_write_json_response(EngineResponse(id='r2', ok=False, error='empty_request'))\n"
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout.decode("utf-8"))["error"], "empty_request")
        self.assertIn(b"import-time banner", completed.stderr)


if __name__ == "__main__":
    unittest.main()
