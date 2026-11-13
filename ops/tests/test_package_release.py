import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "package_release.py"
spec = importlib.util.spec_from_file_location("package_release", MODULE)
package_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_release)

class ReleasePackageTests(unittest.TestCase):
    def test_excludes_secrets_caches_and_local_databases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "src"
            root.mkdir()
            (root / "VERSION").write_text("4.6.0")
            (root / "README.md").write_text("safe")
            (root / ".env").write_text("SECRET=never")
            (root / ".env.example").write_text("SAFE=example")
            (root / ".env.production").write_text("SECRET=never")
            (root / "local.db").write_text("database")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "package.js").write_text("cache")
            out = Path(tmp) / "release.zip"
            result = package_release.build(root, out)
            self.assertEqual(result["crc"], "PASS")
            with zipfile.ZipFile(out) as archive:
                names = archive.namelist()
                self.assertTrue(any(name.endswith("/README.md") for name in names))
                self.assertTrue(any(name.endswith("/.env.example") for name in names))
                self.assertFalse(any(name.endswith("/.env") for name in names))
                self.assertFalse(any(".env.production" in name for name in names))
                self.assertFalse(any(name.endswith("local.db") for name in names))
                self.assertFalse(any("/node_modules/" in name for name in names))
                self.assertTrue(any(name.endswith("/FILE_MANIFEST.json") for name in names))

    def test_rejects_invalid_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "VERSION").write_text("latest")
            with self.assertRaises(SystemExit):
                package_release.build(root, root.parent / "bad.zip")

if __name__ == "__main__":
    unittest.main()
