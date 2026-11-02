import base64
import hashlib
import hmac
import io
import json
import subprocess
import time
import wave

from fastapi.testclient import TestClient

import brain.app as app_module
from brain.app import create_app
from brain.settings import Settings
from brain.voice import whisper
from brain.voice.whisper import TranscribeRequest, hear

SECRET = "s" * 40


def speech_wav(seconds: float = 0.5, rate: int = 16_000, channels: int = 1) -> bytes:
    """Silence in the shape the practice phone records (16 kHz mono 16-bit)."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(channels)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(b"\x00\x00" * int(rate * seconds) * channels)
    return buffer.getvalue()


def recording(audio: bytes) -> TranscribeRequest:
    return TranscribeRequest(audio_wav=base64.b64encode(audio).decode())


PARENT = {"PATH": "/bin", "HOME": "/h", "WHISPER_MODEL_PATH": "/models/ggml-small.bin", "DATABASE_URL": "secret", "BRAIN_SHARED_SECRET": "secret"}


def test_whisper_hears_the_recording_offline_and_locked_down():
    seen = {}

    def fake_run(args, folder, env):
        seen.update(args=args, folder=folder, env=env)
        with open(args[args.index("-f") + 1], "rb") as file:
            seen["audio"] = file.read()
        return 0, b" Are you open tonight?\n [BLANK_AUDIO]\n"

    audio = speech_wav()
    heard = hear(recording(audio), run=fake_run, parent_env=PARENT)
    assert heard.kind == "ok" and heard.text == "Are you open tonight?"
    assert seen["audio"] == audio and seen["args"][:3] == ["whisper-cli", "-m", "/models/ggml-small.bin"]
    assert "-l" in seen["args"] and seen["args"][seen["args"].index("-l") + 1] == "auto" and "--no-prints" in seen["args"]
    assert seen["env"] == {"PATH": "/bin", "HOME": "/h"}, "never ansa's secrets"


def test_whisper_refuses_what_it_shouldnt_hear_and_names_failures():
    def never(args, folder, env):
        raise AssertionError("not run")

    assert hear(TranscribeRequest(audio_wav="not base64!"), run=never, parent_env=PARENT).error_name == "NotBase64"
    assert hear(recording(speech_wav(rate=44_100)), run=never, parent_env=PARENT).error_name == "NotA16kMonoWav"
    assert hear(recording(speech_wav(channels=2)), run=never, parent_env=PARENT).error_name == "NotA16kMonoWav"
    assert hear(recording(b"RIFF" + b"\x00" * 60), run=never, parent_env=PARENT).error_name == "NotA16kMonoWav"
    assert hear(recording(speech_wav()), run=never, parent_env={"PATH": "/bin"}).error_name == "WhisperModelNotSet"

    def slow(args, folder, env):
        raise subprocess.TimeoutExpired(args, whisper.TIMEOUT_SECONDS)

    def missing(args, folder, env):
        raise FileNotFoundError

    assert hear(recording(speech_wav()), run=slow, parent_env=PARENT).error_name == "WhisperTimeout"
    assert hear(recording(speech_wav()), run=missing, parent_env=PARENT).error_name == "WhisperNotFound"
    assert hear(recording(speech_wav()), run=lambda a, f, e: (1, b""), parent_env=PARENT).error_name == "WhisperFailed"


def signed(body: bytes) -> dict[str, str]:
    now = str(int(time.time()))
    signature = hmac.new(SECRET.encode(), now.encode() + b"." + body, hashlib.sha256).hexdigest()
    return {"Content-Type": "application/json", "X-Ansa-Timestamp": now, "X-Ansa-Signature": signature}


def test_the_endpoint_is_development_only(monkeypatch):
    body = json.dumps({"audio_wav": base64.b64encode(speech_wav()).decode()}).encode()
    production = TestClient(create_app(Settings(shared_secret=SECRET)))
    assert production.post("/v1/voice/transcribe", content=body, headers=signed(body)).status_code == 404
    monkeypatch.setattr(app_module, "hear", lambda request: whisper.Heard(kind="ok", text="Hello"))
    development = TestClient(create_app(Settings(shared_secret=SECRET, development=True)))
    assert development.post("/v1/voice/transcribe", content=body, headers={"Content-Type": "application/json"}).status_code == 401
    answered = development.post("/v1/voice/transcribe", content=body, headers=signed(body))
    assert answered.status_code == 200 and answered.json() == {"text": "Hello"}
    monkeypatch.setattr(app_module, "hear", lambda request: whisper.Heard(kind="error", error_name="WhisperNotFound"))
    failed = development.post("/v1/voice/transcribe", content=body, headers=signed(body))
    assert failed.status_code == 503 and failed.json() == {"error": "WhisperNotFound"}
