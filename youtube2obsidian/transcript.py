"""YouTube 영상에서 타임스탬프가 포함된 트랜스크립트를 추출한다.

1차: YouTube 자막 API (youtube-transcript-api) — 빠르고 무료
2차: yt-dlp로 오디오 다운로드 후 faster-whisper 로컬 음성 인식
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse


@dataclass
class Segment:
    """트랜스크립트의 한 구간."""

    start: float  # 초 단위 시작 시각
    duration: float
    text: str


@dataclass
class Transcript:
    video_id: str
    segments: list[Segment]
    language: str
    source: str  # "youtube-captions" | "whisper"

    @property
    def full_text(self) -> str:
        return " ".join(s.text for s in self.segments)


_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> str:
    """다양한 YouTube URL 형식에서 11자리 video ID를 추출한다."""
    if _VIDEO_ID_RE.match(url):
        return url

    parsed = urlparse(url)
    host = (parsed.hostname or "").removeprefix("www.").removeprefix("m.")

    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
        else:
            # /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
            parts = [p for p in parsed.path.split("/") if p]
            candidate = parts[1] if len(parts) >= 2 else ""
    else:
        raise ValueError(f"YouTube URL이 아닙니다: {url}")

    if not _VIDEO_ID_RE.match(candidate):
        raise ValueError(f"URL에서 video ID를 찾을 수 없습니다: {url}")
    return candidate


def fetch_youtube_captions(
    video_id: str, languages: list[str] | None = None
) -> Transcript:
    """YouTube 자막(수동/자동 생성)을 가져온다. 자막이 없으면 예외 발생."""
    from youtube_transcript_api import YouTubeTranscriptApi

    languages = languages or ["ko", "en"]

    api = YouTubeTranscriptApi()
    if hasattr(api, "fetch"):  # v1.x
        fetched = api.fetch(video_id, languages=languages)
        segments = [
            Segment(start=s.start, duration=s.duration, text=s.text)
            for s in fetched
        ]
        language = fetched.language_code
    else:  # v0.6.x
        raw = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        segments = [
            Segment(start=s["start"], duration=s.get("duration", 0.0), text=s["text"])
            for s in raw
        ]
        language = languages[0]

    return Transcript(
        video_id=video_id,
        segments=segments,
        language=language,
        source="youtube-captions",
    )


def transcribe_with_whisper(
    video_id: str,
    model_size: str = "small",
    language: str | None = None,
) -> Transcript:
    """자막이 없는 영상: 오디오를 받아 faster-whisper로 음성 인식한다."""
    import tempfile
    from pathlib import Path

    import yt_dlp
    from faster_whisper import WhisperModel

    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": str(Path(tmpdir) / "%(id)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            audio_path = ydl.prepare_filename(info)

        model = WhisperModel(model_size, device="auto", compute_type="auto")
        whisper_segments, info = model.transcribe(
            audio_path, language=language, vad_filter=True
        )
        segments = [
            Segment(start=s.start, duration=s.end - s.start, text=s.text.strip())
            for s in whisper_segments
        ]

    return Transcript(
        video_id=video_id,
        segments=segments,
        language=info.language,
        source="whisper",
    )


def get_transcript(
    url: str,
    languages: list[str] | None = None,
    whisper_model: str = "small",
) -> Transcript:
    """자막 우선, 실패 시 Whisper 음성 인식으로 트랜스크립트를 얻는다."""
    video_id = extract_video_id(url)
    try:
        return fetch_youtube_captions(video_id, languages=languages)
    except Exception as caption_error:
        try:
            return transcribe_with_whisper(video_id, model_size=whisper_model)
        except ImportError as e:
            raise RuntimeError(
                "이 영상에는 자막이 없어 음성 인식이 필요합니다. "
                "`pip install 'youtube2obsidian[whisper]'`로 yt-dlp와 "
                f"faster-whisper를 설치하세요. (자막 조회 실패 원인: {caption_error})"
            ) from e
