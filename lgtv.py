"""Connection to an LG TV's remote-control service (wss://TV:3001), the one LG's phone app uses.

The first connection shows a prompt on the TV: accept it. The key is kept in .lgtv-key.json.
"""
import asyncio
import json
import os
import ssl
import tempfile
from itertools import count

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(HERE, ".lgtv-key.json")
_request_ids = count(1)


class TVError(RuntimeError):
    """The TV rejected a request or returned an invalid response."""

# Unsigned on purpose: newer firmware rejects the signed manifest that open-source clients share
# ("403 Pairing rejected: blacklisted certificate detected") but still accepts an unsigned one.
PERMISSIONS = [
    "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED", "CONTROL_AUDIO",
    "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_RECORDING",
    "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_TV", "CONTROL_POWER", "CONTROL_TV_SCREEN",
    "READ_APP_STATUS", "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST", "READ_NETWORK_STATE",
    "READ_RUNNING_APPS", "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST", "READ_POWER_STATE",
    "READ_COUNTRY_INFO", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS",
    "READ_SETTINGS", "READ_STORAGE_DEVICE_LIST",
]


def insecure_ctx():
    # The TV uses a certificate from LG's own CA.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def load_keys():
    try:
        with open(KEY_FILE) as f:
            keys = json.load(f)
            return keys if isinstance(keys, dict) else {}
    except (OSError, ValueError):
        return {}


async def session(host, **connect_args):
    keys = load_keys()
    ws = await websockets.connect(f"wss://{host}:3001", ssl=insecure_ctx(), open_timeout=10, max_size=None,
                                  **connect_args)
    payload = {
        "forcePairing": False,
        "pairingType": "PROMPT",
        "manifest": {"manifestVersion": 1, "appVersion": "1.1", "permissions": PERMISSIONS},
    }
    if host in keys:
        payload["client-key"] = keys[host]
    else:
        print("Accept the prompt on the TV...")
    try:
        await ws.send(json.dumps({"type": "register", "id": "register_0", "payload": payload}))
        deadline = asyncio.get_running_loop().time() + 60
        while True:
            msg = await receive(ws, deadline)
            if msg.get("type") == "registered":
                break
            if msg.get("type") == "error":
                raise TVError(f"Pairing failed: {msg.get('error', 'request rejected')}")
        registered = msg.get("payload")
        key = registered.get("client-key") if isinstance(registered, dict) else None
        if not isinstance(key, str) or not key:
            raise TVError("Pairing response did not contain a client key")
        if keys.get(host) != key:
            keys[host] = key
            # Keep the previous credentials intact if a write is interrupted.
            name = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", dir=os.path.dirname(KEY_FILE), delete=False) as f:
                    name = f.name
                    json.dump(keys, f, indent=1)
                os.replace(name, KEY_FILE)
            finally:
                if name and os.path.exists(name):
                    os.unlink(name)
        return ws
    except BaseException:
        # The caller cannot clean up a connection that was never returned.
        try:
            await ws.close()
        except Exception:
            pass
        raise


async def receive(ws, deadline):
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise asyncio.TimeoutError()
    try:
        msg = json.loads(await asyncio.wait_for(ws.recv(), remaining))
    except (TypeError, ValueError) as error:
        raise TVError("Invalid JSON response from TV") from error
    if not isinstance(msg, dict):
        raise TVError("Invalid response from TV")
    return msg


async def call(ws, uri, payload=None):
    rid = f"c{next(_request_ids)}"
    await ws.send(json.dumps({"type": "request", "id": rid, "uri": uri, "payload": payload or {}}))
    deadline = asyncio.get_running_loop().time() + 20
    while True:
        msg = await receive(ws, deadline)
        if msg.get("id") == rid:
            result = msg.get("payload")
            if msg.get("type") == "error" or not isinstance(result, dict) or result.get("returnValue") is False:
                detail = result.get("errorText") if isinstance(result, dict) else None
                raise TVError(f"{uri}: {detail or msg.get('error') or 'request failed'}")
            return result
