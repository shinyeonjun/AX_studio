import tempfile
import threading
import unittest
from pathlib import Path

from artifact_store import atomic_copy_file, atomic_write_text
from write.pdf_to_html_engine.convert import escape_template_braces


class AtomicWriteTest(unittest.TestCase):
    def test_concurrent_writers_leave_one_complete_file_and_no_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "manifest.json"
            payloads = [str(index) * 50_000 for index in range(8)]
            threads = [threading.Thread(target=atomic_write_text, args=(target, payload)) for payload in payloads]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertIn(target.read_text(encoding="utf-8"), payloads)
            self.assertEqual([path.name for path in Path(tmp).iterdir()], ["manifest.json"])

    def test_atomic_copy_replaces_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.pdf"
            target = Path(tmp) / "nested" / "original.pdf"
            source.write_bytes(b"%PDF-new")
            atomic_copy_file(source, target)
            self.assertEqual(target.read_bytes(), b"%PDF-new")


class TemplateBraceEscapeTest(unittest.TestCase):
    def test_pdf_text_cannot_open_handlebars_tags(self) -> None:
        escaped = escape_template_braces("<p>{{constructor}} {{{raw}}} a{b}</p>")
        self.assertNotIn("{{", escaped)
        self.assertIn("a{b}", escaped)
        self.assertEqual(escape_template_braces(escaped), escaped)


if __name__ == "__main__":
    unittest.main()
