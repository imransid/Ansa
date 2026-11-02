"""DEVELOPMENT ONLY: hears the practice phone's recordings with whisper.cpp
(its `whisper-cli` program) on this computer, offline: the caller's voice
never leaves the laptop. A production phone line hears its callers itself
(Vapi, Twilio and the others turn speech into text), so the brain refuses
this outside development (brain/app.py).

The recording (16 kHz mono 16-bit WAV, checked) is written to an empty
folder of its own, read by whisper-cli with only the few environment
variables a program needs (never ansa's secrets), and deleted with the
folder. Nothing it hears is ever logged; failures are a name only."""

import base64
import binascii
import os
import re
import struct
import subprocess
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# One recording may take this long to hear (core waits VoiceWait, 70 s:
# core/internal/brainclient/waits.go, whose test reads this line).
TIMEOUT_SECONDS = 60
# About 75 seconds of 16 kHz mono 16-bit speech.
MAX_AUDIO_BYTES = 2_500_000
# What a caller says in one turn, at most.
MAX_CHARACTERS = 2_000

# The only variables passed on: where programs are, the home folder, temp.
PASSED_ON = ["PATH", "HOME", "TMPDIR"]

# Runs the program: (arguments, folder, environment) -> (exit code, stdout).
Runner = Callable[[list[str], str, dict[str, str]], tuple[int, bytes]]


class TranscribeRequest(BaseModel):
    """The recording, base64 (as core sends a byte string), and its language
    when the caller chose one (a named language is heard better)."""

    model_config = ConfigDict(extra="forbid")
    audio_wav: str = Field(max_length=4 * 1024 * 1024)
    language: Literal["auto", "bn", "en"] = "auto"


@dataclass(frozen=True)
class Heard:
    """ok (with text) or error (with error_name)."""

    kind: str
    text: str = ""
    error_name: str = ""


def is_speech_wav(audio: bytes) -> bool:
    """A WAV the browser recorder writes: PCM, one channel, 16,000 a second, 16 bits."""
    if len(audio) < 44 or audio[0:4] != b"RIFF" or audio[8:12] != b"WAVE" or audio[12:16] != b"fmt ":
        return False
    audio_format, channels, rate = struct.unpack("<HHI", audio[20:28])
    bits = struct.unpack("<H", audio[34:36])[0]
    return audio_format == 1 and channels == 1 and rate == 16_000 and bits == 16


def arguments(binary: str, model: str, wav_path: str, language: str = "auto") -> list[str]:
    """Hear one file in whatever language it is; print only the words. On
    the CPU: Homebrew's whisper.cpp 1.9.5 aborts in its Metal (GPU) mode on
    some Macs ("pre-allocated tensor ... cannot run the operation"), and a
    turn of speech is quick enough on the CPU."""
    return [binary, "-m", model, "-f", wav_path, "-l", language, "--no-timestamps", "--no-prints", "--no-gpu"]


def environment(parent: Mapping[str, str]) -> dict[str, str]:
    """PASSED_ON from the brain's own environment. Nothing else."""
    return {name: parent[name] for name in PASSED_ON if parent.get(name)}


def run_program(args: list[str], folder: str, env: dict[str, str]) -> tuple[int, bytes]:
    """Runs whisper-cli once; a run past its time is stopped and counts as a failure."""
    completed = subprocess.run(args, capture_output=True, cwd=folder, env=env, timeout=TIMEOUT_SECONDS, check=False)
    return completed.returncode, completed.stdout


# What whisper.cpp writes for sounds that aren't words.
NOT_WORDS = re.compile(r"\[(BLANK_AUDIO|MUSIC|NOISE|SOUND|SILENCE)\]|\((silence|music|noise|inaudible)\)", re.IGNORECASE)


def clean(output: bytes) -> str:
    """The words as one plain line, without whisper's markers for silence or noise."""
    text = NOT_WORDS.sub(" ", output.decode("utf-8", "replace"))
    return " ".join(text.split())[:MAX_CHARACTERS]


def hear(request: TranscribeRequest, run: Runner = run_program, parent_env: Mapping[str, str] = os.environ) -> Heard:
    """The recording's words, heard by whisper.cpp on this computer."""
    try:
        audio = base64.b64decode(request.audio_wav, validate=True)
    except (binascii.Error, ValueError):
        return Heard(kind="error", error_name="NotBase64")
    if len(audio) > MAX_AUDIO_BYTES or not is_speech_wav(audio):
        return Heard(kind="error", error_name="NotA16kMonoWav")
    model = parent_env.get("WHISPER_MODEL_PATH") or ""
    if not model:
        return Heard(kind="error", error_name="WhisperModelNotSet")
    binary = parent_env.get("WHISPER_CLI_PATH") or "whisper-cli"
    with tempfile.TemporaryDirectory(prefix="ansa-whisper-") as folder:
        path = os.path.join(folder, "turn.wav")
        with open(path, "wb") as file:
            file.write(audio)
        try:
            code, output = run(arguments(binary, model, path, request.language), folder, environment(parent_env))
        except subprocess.TimeoutExpired:
            return Heard(kind="error", error_name="WhisperTimeout")
        except FileNotFoundError:
            return Heard(kind="error", error_name="WhisperNotFound")
        except OSError:
            return Heard(kind="error", error_name="WhisperFailed")
    if code != 0:
        return Heard(kind="error", error_name="WhisperFailed")
    return Heard(kind="ok", text=clean(output))
