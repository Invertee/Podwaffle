from __future__ import annotations

import hashlib
import json
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from faster_whisper import WhisperModel
from pydantic import BaseModel, Field, ValidationError

APP_VERSION = "1"
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small.en")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:4b")
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(1024 * 1024 * 1024)))
DOWNLOAD_TIMEOUT_SECONDS = float(os.getenv("DOWNLOAD_TIMEOUT_SECONDS", "120"))
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "1800"))

app = FastAPI(title="Podwaffle Chapter Worker", version=APP_VERSION)


class GenerateRequest(BaseModel):
    feedId: str
    episodeGuid: str
    title: str = ""
    podcastTitle: str = ""
    audioUrl: str
    duration: float = 0
    detectAds: bool = True


class Chapter(BaseModel):
    startTime: float = Field(ge=0)
    title: str = Field(min_length=1, max_length=160)
    type: Literal["content", "advertisement", "intro", "outro"] = "content"
    confidence: float = Field(default=0.5, ge=0, le=1)


class ChapterResponse(BaseModel):
    chapters: list[Chapter]
    duration: float = 0
    generator: dict[str, str]


@lru_cache(maxsize=1)
def whisper_model() -> WhisperModel:
    return WhisperModel(
        WHISPER_MODEL,
        device=WHISPER_DEVICE,
        compute_type=WHISPER_COMPUTE_TYPE,
    )


def _suffix_from_url(url: str) -> str:
    path = url.split("?", 1)[0].split("#", 1)[0]
    suffix = Path(path).suffix.lower()
    return suffix if suffix in {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"} else ".audio"


async def download_audio(url: str, destination: Path) -> None:
    total = 0
    timeout = httpx.Timeout(DOWNLOAD_TIMEOUT_SECONDS, connect=30)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        async with client.stream("GET", url, headers={"User-Agent": "Podwaffle-ChapterWorker/1.0"}) as response:
            response.raise_for_status()
            content_length = int(response.headers.get("content-length") or 0)
            if content_length > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="Episode audio exceeds the configured size limit")
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        raise HTTPException(status_code=413, detail="Episode audio exceeds the configured size limit")
                    output.write(chunk)


def build_windows(segments: list[dict], target_seconds: float = 120) -> list[dict]:
    windows: list[dict] = []
    current: dict | None = None

    for segment in segments:
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        start = float(segment.get("start") or 0)
        end = float(segment.get("end") or start)
        if current is None:
            current = {"start": start, "end": end, "text": text}
            continue

        if end - float(current["start"]) <= target_seconds:
            current["end"] = end
            current["text"] = f"{current['text']} {text}".strip()
        else:
            windows.append(current)
            current = {"start": start, "end": end, "text": text}

    if current is not None:
        windows.append(current)

    return windows


def transcript_audio(audio_path: Path) -> tuple[list[dict], float]:
    model = whisper_model()
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        vad_filter=True,
        word_timestamps=False,
    )
    materialized = [
        {"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip()}
        for segment in segments
        if segment.text and segment.text.strip()
    ]
    duration = max((segment["end"] for segment in materialized), default=float(getattr(info, "duration", 0) or 0))
    return build_windows(materialized), duration


def chapter_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "chapters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "startTime": {"type": "number"},
                        "title": {"type": "string"},
                        "type": {
                            "type": "string",
                            "enum": ["content", "advertisement", "intro", "outro"],
                        },
                        "confidence": {"type": "number"},
                    },
                    "required": ["startTime", "title", "type", "confidence"],
                },
            }
        },
        "required": ["chapters"],
    }


def build_prompt(request: GenerateRequest, windows: list[dict], duration: float) -> str:
    ad_instruction = (
        "Classify likely sponsor reads, dynamically inserted adverts, cross-promotions, and calls to purchase as advertisement. "
        if request.detectAds
        else "Do not classify sections as advertisements; use content, intro, or outro only. "
    )
    return f"""/no_think
You are generating navigation chapters for a podcast episode.

Episode: {request.title}
Podcast: {request.podcastTitle}
Duration: {round(duration, 1)} seconds

Choose chapter boundaries only from the supplied window start timestamps. Create useful topic chapters, normally 3 to 12 minutes long. Avoid tiny chapters unless a short advert, intro, or outro is clearly present. Use concise factual titles. Do not invent subjects that are absent from the transcript. {ad_instruction}A confidence score should reflect confidence in both the boundary and classification. The first chapter must start at 0.

Timestamped transcript windows:
{json.dumps(windows, ensure_ascii=False)}
"""


async def generate_with_ollama(request: GenerateRequest, windows: list[dict], duration: float) -> list[Chapter]:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": build_prompt(request, windows, duration)}],
        "stream": False,
        "format": chapter_schema(),
        "options": {"temperature": 0},
    }
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_SECONDS, connect=30)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()

    raw_content = data.get("message", {}).get("content", "")
    try:
        parsed = json.loads(raw_content)
        raw_chapters = parsed.get("chapters", [])
        chapters = [Chapter.model_validate(item) for item in raw_chapters]
    except (json.JSONDecodeError, ValidationError, AttributeError) as exc:
        raise HTTPException(status_code=502, detail=f"Ollama returned invalid chapter JSON: {exc}") from exc

    return validate_chapters(chapters, duration)


def validate_chapters(chapters: list[Chapter], duration: float) -> list[Chapter]:
    ordered = sorted((chapter for chapter in chapters if chapter.startTime < max(duration, 1)), key=lambda item: item.startTime)
    unique: list[Chapter] = []
    for chapter in ordered:
        if unique and chapter.startTime <= unique[-1].startTime + 0.25:
            continue
        if unique and chapter.startTime - unique[-1].startTime < 45:
            if chapter.type == "advertisement" and unique[-1].type != "advertisement":
                unique.append(chapter)
            continue
        unique.append(chapter)

    if not unique or unique[0].startTime > 2:
        unique.insert(0, Chapter(startTime=0, title="Introduction", type="intro", confidence=0.5))
    else:
        unique[0].startTime = 0

    return unique[:200]


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "whisperModel": WHISPER_MODEL,
        "whisperDevice": WHISPER_DEVICE,
        "ollamaUrl": OLLAMA_URL,
        "ollamaModel": OLLAMA_MODEL,
    }


@app.post("/v1/generate", response_model=ChapterResponse)
async def generate(request: GenerateRequest) -> ChapterResponse:
    if not request.audioUrl.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="audioUrl must use HTTP or HTTPS")

    request_hash = hashlib.sha256(f"{request.feedId}:{request.episodeGuid}".encode()).hexdigest()[:12]
    with tempfile.TemporaryDirectory(prefix=f"podwaffle-{request_hash}-") as temp_dir:
        audio_path = Path(temp_dir) / f"episode{_suffix_from_url(request.audioUrl)}"
        await download_audio(request.audioUrl, audio_path)
        windows, detected_duration = transcript_audio(audio_path)

    duration = max(float(request.duration or 0), detected_duration)
    if not windows:
        raise HTTPException(status_code=422, detail="No speech was detected in this episode")

    chapters = await generate_with_ollama(request, windows, duration)
    if len(chapters) < 2:
        raise HTTPException(status_code=422, detail="The model did not identify enough chapter boundaries")

    return ChapterResponse(
        chapters=chapters,
        duration=duration,
        generator={
            "workerVersion": APP_VERSION,
            "transcriptionModel": WHISPER_MODEL,
            "chapterModel": OLLAMA_MODEL,
        },
    )
