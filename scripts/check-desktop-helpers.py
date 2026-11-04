"""Offline behavior checks for the desktop helpers; every write is in a fixture."""
import asyncio
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import shlex
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Import without installing websockets or permitting an accidental real connection.
websockets_stub = types.ModuleType("websockets")
websockets_stub.connect = mock.AsyncMock(side_effect=AssertionError("Unexpected network connection"))
with mock.patch.dict(sys.modules, {"websockets": websockets_stub}):
    lgtv = load_module("desktop_lgtv_fixture", "lgtv.py")
with mock.patch.dict(sys.modules, {"lgtv": lgtv}):
    sync_apps = load_module("desktop_sync_apps_fixture", "sync-apps.py")


def socket():
    return types.SimpleNamespace(send=mock.AsyncMock(), recv=mock.AsyncMock(), close=mock.AsyncMock())


class PairingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.folder = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix="lg-pairing-test-")))
        self.keys = self.folder / "keys.json"
        self.keys.write_text(json.dumps({"saved-tv": "saved-key"}))
        self.stack.enter_context(mock.patch.object(lgtv, "KEY_FILE", str(self.keys)))
        self.stack.enter_context(mock.patch.object(lgtv, "insecure_ctx", return_value=None))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    async def pair(self, ws):
        with mock.patch.object(websockets_stub, "connect", mock.AsyncMock(return_value=ws)) as connect:
            result = await lgtv.session("fixture-tv")
        self.assertEqual(connect.await_args.args[0], "wss://fixture-tv:3001")
        return result

    async def test_success_publishes_key_and_returns_open_socket(self):
        ws = socket()
        ws.recv.return_value = json.dumps({"type": "registered", "payload": {"client-key": "new-key"}})
        self.assertIs(await self.pair(ws), ws)
        ws.close.assert_not_awaited()
        self.assertEqual(json.loads(self.keys.read_text()), {"saved-tv": "saved-key", "fixture-tv": "new-key"})
        self.assertEqual(self.keys.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.folder.iterdir()), [self.keys])
        original = self.keys.stat()
        ws.send.reset_mock()
        self.assertIs(await self.pair(ws), ws)
        self.assertEqual(self.keys.stat().st_ino, original.st_ino, "A reusable key does not rewrite the credential file")
        self.assertEqual(json.loads(ws.send.await_args.args[0])["payload"]["client-key"], "new-key")

    async def test_pairing_timeout_malformed_denied_cancel_and_missing_key_close_socket(self):
        cases = [
            (asyncio.TimeoutError(), asyncio.TimeoutError),
            ("not-json", lgtv.TVError),
            ("[]", lgtv.TVError),
            (json.dumps({"type": "error", "error": "User denied pairing"}), lgtv.TVError),
            (json.dumps({"type": "registered", "payload": {}}), lgtv.TVError),
            (asyncio.CancelledError(), asyncio.CancelledError),
        ]
        before = self.keys.read_bytes()
        for reply, expected in cases:
            with self.subTest(reply=repr(reply)):
                ws = socket()
                if isinstance(reply, BaseException):
                    ws.recv.side_effect = reply
                else:
                    ws.recv.return_value = reply
                with self.assertRaises(expected):
                    await self.pair(ws)
                ws.close.assert_awaited_once()
                self.assertEqual(self.keys.read_bytes(), before)
                self.assertEqual(list(self.folder.iterdir()), [self.keys])

    async def test_register_send_failure_closes_socket(self):
        ws = socket()
        ws.send.side_effect = OSError("Disconnected during registration")
        with self.assertRaises(OSError):
            await self.pair(ws)
        ws.close.assert_awaited_once()

    async def test_cancelling_pairing_task_closes_unreturned_socket(self):
        ws = socket()
        receiving = asyncio.Event()

        async def pending_pairing():
            receiving.set()
            await asyncio.Event().wait()

        ws.recv.side_effect = pending_pairing
        task = asyncio.create_task(self.pair(ws))
        await receiving.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        ws.close.assert_awaited_once()
        self.assertEqual(json.loads(self.keys.read_text()), {"saved-tv": "saved-key"})

    async def test_failed_key_write_preserves_credentials_and_removes_staging_file(self):
        before = self.keys.read_bytes()
        for target, name in [(lgtv.os, "replace"), (lgtv.json, "dump")]:
            with self.subTest(failure=name):
                ws = socket()
                ws.recv.return_value = json.dumps({"type": "registered", "payload": {"client-key": "new-key"}})
                with mock.patch.object(target, name, side_effect=OSError("Fixture disk failure")):
                    with self.assertRaises(OSError):
                        await self.pair(ws)
                ws.close.assert_awaited_once()
                self.assertEqual(self.keys.read_bytes(), before)
                self.assertEqual(list(self.folder.iterdir()), [self.keys])

    async def test_receive_deadline_cancels_a_stalled_read(self):
        ws = socket()
        cancelled = asyncio.Event()

        async def stalled():
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        ws.recv.side_effect = stalled
        with self.assertRaises(asyncio.TimeoutError):
            await lgtv.receive(ws, asyncio.get_running_loop().time() + 0.01)
        self.assertTrue(cancelled.is_set())
        ws.recv.reset_mock()
        with self.assertRaises(asyncio.TimeoutError):
            await lgtv.receive(ws, asyncio.get_running_loop().time() - 1)
        ws.recv.assert_not_awaited()

    async def test_rpc_rejects_error_frames_failed_payloads_and_invalid_payloads(self):
        for reply in [
            {"type": "error", "error": "permission denied"},
            {"type": "response", "payload": {"returnValue": False, "errorText": "Denied"}},
            {"type": "response", "payload": []},
            {"type": "response"},
        ]:
            with self.subTest(reply=reply):
                ws = socket()

                async def respond():
                    message = dict(reply)
                    message["id"] = json.loads(ws.send.await_args.args[0])["id"]
                    return json.dumps(message)

                ws.recv.side_effect = respond
                with self.assertRaises(lgtv.TVError):
                    await lgtv.call(ws, "ssap://fixture/request")
                ws.close.assert_not_awaited()  # A caller owns an already-returned session.

    async def test_rpc_ignores_unrelated_events_and_returns_matching_result(self):
        ws = socket()
        replies = 0

        async def respond():
            nonlocal replies
            replies += 1
            if replies == 1:
                return json.dumps({"id": "unrelated", "type": "response", "payload": {"value": "old"}})
            return json.dumps({"id": json.loads(ws.send.await_args.args[0])["id"], "type": "response",
                               "payload": {"returnValue": True, "value": "current"}})

        ws.recv.side_effect = respond
        self.assertEqual((await lgtv.call(ws, "ssap://fixture/request"))["value"], "current")
        self.assertEqual(ws.recv.await_count, 2)


class AppSyncTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.folder = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix="lg-sync-test-")))
        self.app = self.folder / "app"
        self.icons = self.app / "icons"
        self.icons.mkdir(parents=True)
        self.manifest = self.app / "apps.js"
        self.original_manifest = b"// previously working inventory\nwindow.TV_APPS = {\"apps\":[{\"id\":\"old\"}],\"inputs\":[]};\n"
        self.manifest.write_bytes(self.original_manifest)
        self.cache = self.folder / "icon-cache.json"
        self.stack.enter_context(mock.patch.object(sync_apps, "APP_DIR", str(self.app)))
        self.stack.enter_context(mock.patch.object(sync_apps, "ICON_CACHE", str(self.cache)))
        self.stack.enter_context(mock.patch.object(lgtv, "insecure_ctx", return_value=None))
        self.ws = socket()
        self.stack.enter_context(mock.patch.object(lgtv, "session", mock.AsyncMock(return_value=self.ws)))
        self.call = self.stack.enter_context(mock.patch.object(lgtv, "call", mock.AsyncMock()))
        self.urlopen = self.stack.enter_context(mock.patch.object(sync_apps.urllib.request, "urlopen", side_effect=OSError("Fixture download failure")))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    async def run_sync(self, points, devices=None, list_only=False):
        self.call.side_effect = [points, {"devices": []} if devices is None else devices]
        return await sync_apps.main("fixture-tv", list_only)

    def inventory(self):
        body = self.manifest.read_text().split("window.TV_APPS = ", 1)[1].rsplit(";", 1)[0]
        return json.loads(body)

    async def test_bad_or_empty_inventory_preserves_last_manifest(self):
        replies = [None, {}, {"launchPoints": []}, {"launchPoints": {}}, {"launchPoints": [None]},
                   {"launchPoints": [{"title": "Missing ID"}]}, {"launchPoints": [{"id": ""}]},
                   {"launchPoints": [{"id": "app"}], "returnValue": False}]
        for reply in replies:
            with self.subTest(reply=reply):
                self.ws.close.reset_mock()
                with self.assertRaises(lgtv.TVError):
                    await self.run_sync(reply)
                self.ws.close.assert_awaited_once()
                self.assertEqual(self.manifest.read_bytes(), self.original_manifest)
                self.urlopen.assert_not_called()

    async def test_invalid_inputs_and_rpc_errors_also_preserve_inventory(self):
        for reply in [{}, {"devices": None}, {"devices": [False]}, {"devices": [], "returnValue": False}]:
            with self.subTest(reply=reply):
                with self.assertRaises(lgtv.TVError):
                    await self.run_sync({"launchPoints": [{"id": "app"}]}, reply)
                self.assertEqual(self.manifest.read_bytes(), self.original_manifest)
        self.ws.close.reset_mock()
        self.call.side_effect = lgtv.TVError("RPC denied")
        with self.assertRaises(lgtv.TVError):
            await sync_apps.main("fixture-tv", False)
        self.ws.close.assert_awaited_once()
        self.assertEqual(self.manifest.read_bytes(), self.original_manifest)

    async def test_icon_failures_keep_cached_and_placeholder_apps(self):
        cached = b"previous icon"
        (self.icons / "cached.png").write_bytes(cached)
        digest = hashlib.sha256(cached).hexdigest()
        self.cache.write_text(json.dumps({"cached.png": digest}))
        await self.run_sync({"launchPoints": [
            {"id": "cached", "title": "Cached app", "largeIcon": "https://fixture/large", "icon": "https://fixture/small"},
            {"id": "new", "title": "New app", "icon": "https://fixture/new"},
        ]})
        apps = self.inventory()["apps"]
        self.assertEqual([item["id"] for item in apps], ["cached", "new"])
        self.assertEqual(apps[0]["icon"], "icons/cached.png?v=" + digest[:16])
        self.assertEqual(apps[1]["icon"], "")
        self.assertEqual((self.icons / "cached.png").read_bytes(), cached)
        self.assertEqual(json.loads(self.cache.read_text()), {"cached.png": digest})
        self.ws.close.assert_awaited_once()

    async def test_small_icon_fallback_keeps_app_and_download_is_bounded(self):
        class Download(io.BytesIO):
            def read(self, size=-1):
                self.requested_size = size
                return super().read(size)

        download = Download(b"small icon")
        self.urlopen.side_effect = [OSError("large icon unavailable"), download]
        await self.run_sync({"launchPoints": [{"id": "app", "largeIcon": "https://fixture/large", "icon": "https://fixture/small"}]})
        self.assertEqual((self.icons / "app.png").read_bytes(), b"small icon")
        self.assertEqual(download.requested_size, 10 * 1024 * 1024 + 1)
        self.assertTrue(download.closed)
        self.assertEqual([call.args[0] for call in self.urlopen.call_args_list], ["https://fixture/large", "https://fixture/small"])
        self.assertEqual(self.inventory()["apps"][0]["id"], "app")

    async def test_owned_icon_pruning_preserves_custom_files_and_versions_updates(self):
        digest = lambda data: hashlib.sha256(data).hexdigest()
        (self.icons / "removed.png").write_bytes(b"owned removed icon")
        (self.icons / "modified.png").write_bytes(b"custom replacement")
        (self.icons / "bundled.png").write_bytes(b"bundled asset")
        (self.app / "outside.png").write_bytes(b"outside cache directory")
        self.cache.write_text(json.dumps({"removed.png": digest(b"owned removed icon"),
                                          "modified.png": digest(b"previous downloaded icon"),
                                          "../outside.png": digest(b"outside cache directory")}))
        points = {"launchPoints": [{"id": "current", "icon": "https://fixture/current"}]}
        self.urlopen.side_effect = lambda *args, **kwargs: io.BytesIO(b"first icon")
        await self.run_sync(points, {"devices": [{"appId": "hdmi1", "label": "Console"}]})
        first_icon = self.inventory()["apps"][0]["icon"]
        self.assertEqual(first_icon, "icons/current.png?v=" + digest(b"first icon")[:16])
        self.assertFalse((self.icons / "removed.png").exists())
        self.assertEqual((self.icons / "modified.png").read_bytes(), b"custom replacement")
        self.assertTrue((self.icons / "bundled.png").exists())
        self.assertTrue((self.app / "outside.png").exists())
        self.assertEqual(json.loads(self.cache.read_text()), {"current.png": digest(b"first icon")})
        self.assertEqual(self.inventory()["inputs"], [{"appId": "hdmi1", "label": "Console"}])
        self.urlopen.side_effect = lambda *args, **kwargs: io.BytesIO(b"updated icon")
        await self.run_sync(points)
        self.assertNotEqual(self.inventory()["apps"][0]["icon"], first_icon)
        self.assertEqual(self.inventory()["apps"][0]["icon"], "icons/current.png?v=" + digest(b"updated icon")[:16])

    async def test_malformed_optional_metadata_uses_valid_icon_and_text_fallbacks(self):
        self.urlopen.side_effect = lambda *args, **kwargs: io.BytesIO(b"fallback icon")
        await self.run_sync({"launchPoints": [
            {"id": "first", "largeIcon": {"invalid": "object"}, "icon": "https://fixture/first",
             "title": {"invalid": "title"}, "iconColor": ["invalid"], "bgColor": "#345678"},
            {"id": "second", "largeIcon": ["invalid"], "icon": "https://fixture/second",
             "title": ["invalid"], "iconColor": {"invalid": "color"}, "bgColor": {"invalid": "fallback"}},
        ]}, {"devices": [
            {"appId": "hdmi1", "label": {"invalid": "label"}, "id": "Console"},
            {"appId": "hdmi2", "label": ["invalid"], "id": {"invalid": "id"}},
            {"appId": "hdmi3", "label": "Computer"},
            {"appId": {"invalid": "app id"}, "label": "Invalid"},
            {"appId": 42, "label": "Invalid"},
        ]})
        self.assertEqual([call.args[0] for call in self.urlopen.call_args_list],
                         ["https://fixture/first", "https://fixture/second"])
        apps = self.inventory()["apps"]
        self.assertEqual([app["title"] for app in apps], ["first", "second"])
        self.assertEqual([app["iconColor"] for app in apps], ["#345678", ""])
        self.assertTrue(all(app["icon"].startswith("icons/") for app in apps))
        self.assertEqual(self.inventory()["inputs"], [
            {"appId": "hdmi1", "label": "Console"},
            {"appId": "hdmi2", "label": "hdmi2"},
            {"appId": "hdmi3", "label": "Computer"},
        ])

    async def test_publication_preserves_existing_modes_and_new_assets_are_readable(self):
        self.manifest.chmod(0o640)
        existing_icon = self.icons / "existing.png"
        existing_icon.write_bytes(b"old icon")
        existing_icon.chmod(0o640)
        self.urlopen.side_effect = lambda *args, **kwargs: io.BytesIO(b"new icon")
        await self.run_sync({"launchPoints": [
            {"id": "existing", "icon": "https://fixture/existing"},
            {"id": "new", "icon": "https://fixture/new"},
        ]})
        self.assertEqual(existing_icon.read_bytes(), b"new icon")
        self.assertEqual(existing_icon.stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.manifest.stat().st_mode & 0o777, 0o640)
        self.assertEqual((self.icons / "new.png").stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.cache.stat().st_mode & 0o777, 0o644)

    async def test_list_only_does_not_write_files_or_download_icons(self):
        await self.run_sync({"launchPoints": [{"id": "app", "title": "App", "icon": "https://fixture/icon"}]}, list_only=True)
        self.assertEqual(self.manifest.read_bytes(), self.original_manifest)
        self.assertFalse(self.cache.exists())
        self.urlopen.assert_not_called()
        self.ws.close.assert_awaited_once()

    async def test_manifest_replace_failure_leaves_old_file_and_no_partial_file(self):
        real_replace = os.replace

        def fail_manifest(source, destination):
            if str(destination) == str(self.manifest):
                raise OSError("Fixture manifest write failed")
            return real_replace(source, destination)

        with mock.patch.object(sync_apps.os, "replace", side_effect=fail_manifest):
            with self.assertRaises(OSError):
                await self.run_sync({"launchPoints": [{"id": "app"}]})
        self.assertEqual(self.manifest.read_bytes(), self.original_manifest)
        self.assertEqual(sorted(path.name for path in self.app.iterdir()), ["apps.js", "icons"])


class MacWatcherTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        temporary = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix="lg-launch-agent-test-")))
        self.folder = temporary / "Watcher & Preview"
        self.folder.mkdir()
        self.bin = self.folder / "bin"
        self.venv = self.folder / "venv" / "bin"
        self.bin.mkdir(); self.venv.mkdir(parents=True)
        self.plist = self.folder / "LaunchAgents" / "watcher.plist"
        self.plist.parent.mkdir()
        self.log = self.folder / "Logs" / "watcher.log"
        self.commands = self.folder / "launchctl.jsonl"
        self.running = self.folder / "running-job.plist"
        self.original = plistlib.dumps({"Label": "com.tvvibehack.homewatch", "ProgramArguments": ["previous watcher"]})
        self.plist.write_bytes(self.original)
        self.running.write_bytes(self.original)
        self.script = self.folder / "home-watch-mac.sh"
        source = (ROOT / "home-watch-mac.sh").read_text()
        old_plist = 'PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"'
        old_log = 'LOG="$HOME/Library/Logs/tv-vibehack-home-watch.log"'
        if old_plist not in source or old_log not in source:
            self.fail("Fixture destinations need updating before running the Mac script")
        source = source.replace(old_plist, "PLIST=" + shlex.quote(str(self.plist)))
        source = source.replace(old_log, "LOG=" + shlex.quote(str(self.log)))
        self.script.write_text(source)
        self.write_executable(self.venv / "python", "#!/bin/sh\n"
                              'if [ "$1" = "-c" ]; then exit "${DESKTOP_FIXTURE_IMPORT_FAIL:-0}"; fi\n'
                              'if [ "${DESKTOP_FIXTURE_STAGE_FAIL:-0}" = 1 ]; then exit 7; fi\n'
                              "exec " + shlex.quote(sys.executable) + ' "$@"\n')
        self.write_executable(self.venv / "pip", '#!/bin/sh\nexit "${DESKTOP_FIXTURE_PIP_FAIL:-0}"\n')
        self.write_executable(self.bin / "launchctl", "#!" + sys.executable + "\n" + '''
import json, os, pathlib, sys
folder = pathlib.Path(os.environ['DESKTOP_FIXTURE_DIRECTORY'])
command = sys.argv[1]
record = {'command': command, 'arguments': sys.argv[2:]}
if command == 'bootstrap':
    record['configuration'] = pathlib.Path(sys.argv[3]).read_text()
with open(folder / 'launchctl.jsonl', 'a') as output:
    output.write(json.dumps(record) + '\\n')
running = folder / 'running-job.plist'
if command == 'bootout':
    if running.exists():
        running.unlink()
        sys.exit(0)
    sys.exit(1)
if command == 'bootstrap':
    marker = folder / 'bootstrap-failed'
    if os.environ.get('DESKTOP_FIXTURE_BOOTSTRAP_FAIL') == '1' and not marker.exists():
        marker.write_text('failed once')
        sys.exit(9)
    running.write_bytes(pathlib.Path(sys.argv[3]).read_bytes())
    sys.exit(0)
raise RuntimeError('Unexpected launchctl operation: ' + command)
''')

    def write_executable(self, path, contents):
        path.write_text(contents)
        path.chmod(0o755)

    def run_script(self, host="192.0.2.50", arguments=(), **options):
        env = os.environ.copy()
        env.pop("TV_HOST", None)
        if host is not None:
            env["TV_HOST"] = host
        env["PATH"] = str(self.bin) + os.pathsep + env.get("PATH", os.defpath)
        env["DESKTOP_FIXTURE_DIRECTORY"] = str(self.folder)
        env.update({"DESKTOP_FIXTURE_" + key: str(value) for key, value in options.items()})
        return subprocess.run(["/bin/bash", str(self.script), *arguments], env=env, cwd=self.folder,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)

    def operations(self):
        return [json.loads(line) for line in self.commands.read_text().splitlines()] if self.commands.exists() else []

    def assert_existing_untouched(self):
        self.assertEqual(self.plist.read_bytes(), self.original)
        self.assertEqual(self.running.read_bytes(), self.original)
        self.assertEqual(self.operations(), [])
        self.assertEqual(list(self.plist.parent.iterdir()), [self.plist])

    def test_missing_host_leaves_existing_job_untouched(self):
        result = self.run_script(host=None)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("set TV_HOST", result.stderr)
        self.assert_existing_untouched()

    def test_dependency_failure_leaves_existing_job_untouched(self):
        result = self.run_script(IMPORT_FAIL=1, PIP_FAIL=1)
        self.assertNotEqual(result.returncode, 0)
        self.assert_existing_untouched()

    def test_configuration_generation_failure_keeps_working_job_and_cleans_staging(self):
        result = self.run_script(STAGE_FAIL=1)
        self.assertNotEqual(result.returncode, 0)
        self.assert_existing_untouched()

    def test_success_publishes_valid_plist_and_replaces_job_after_preparation(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([operation["command"] for operation in self.operations()], ["bootout", "bootstrap"])
        configuration = plistlib.loads(self.plist.read_bytes())
        self.assertEqual(configuration["WorkingDirectory"], str(self.folder))
        self.assertEqual(configuration["ProgramArguments"][-1], "192.0.2.50")
        self.assertEqual(configuration["StandardOutPath"], str(self.log))
        self.assertEqual(self.running.read_bytes(), self.plist.read_bytes())
        self.assertEqual(list(self.plist.parent.iterdir()), [self.plist])

    def test_failed_bootstrap_restores_and_restarts_previous_configuration(self):
        result = self.run_script(BOOTSTRAP_FAIL=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([operation["command"] for operation in self.operations()], ["bootout", "bootstrap", "bootstrap"])
        self.assertEqual(self.plist.read_bytes(), self.original)
        self.assertEqual(self.running.read_bytes(), self.original)
        self.assertEqual(list(self.plist.parent.iterdir()), [self.plist])

    def test_failed_first_install_removes_unusable_plist(self):
        self.plist.unlink(); self.running.unlink()
        result = self.run_script(BOOTSTRAP_FAIL=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.plist.exists())
        self.assertFalse(self.running.exists())
        self.assertEqual(list(self.plist.parent.iterdir()), [])
        self.assertEqual([operation["command"] for operation in self.operations()], ["bootout", "bootstrap"])

    def test_uninstall_removes_only_fixture_job_without_requiring_host(self):
        result = self.run_script(host=None, arguments=("uninstall",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.plist.exists()); self.assertFalse(self.running.exists())
        self.assertEqual([operation["command"] for operation in self.operations()], ["bootout"])


if __name__ == "__main__":
    unittest.main()
