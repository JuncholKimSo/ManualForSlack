"""트랜스크립트를 타임스탬프 링크가 있는 Obsidian Markdown으로 변환한다."""

from __future__ import annotations

from datetime import date

from .transcript import Segment, Transcript


def format_timestamp(seconds: float) -> str:
    """초를 HH:MM:SS 또는 MM:SS 문자열로 변환한다."""
    total = int(seconds)
    h, remainder = divmod(total, 3600)
    m, s = divmod(remainder, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def timestamp_link(video_id: str, seconds: float) -> str:
    """클릭하면 해당 시각으로 이동하는 YouTube 링크를 만든다."""
    label = format_timestamp(seconds)
    url = f"https://www.youtube.com/watch?v={video_id}&t={int(seconds)}s"
    return f"[{label}]({url})"


def group_segments(segments: list[Segment], window: float = 30.0) -> list[Segment]:
    """자막 조각을 window(초) 단위 문단으로 묶어 읽기 좋게 만든다."""
    if not segments:
        return []

    grouped: list[Segment] = []
    current_start = segments[0].start
    current_texts: list[str] = []

    for seg in segments:
        if seg.start - current_start >= window and current_texts:
            grouped.append(
                Segment(
                    start=current_start,
                    duration=seg.start - current_start,
                    text=" ".join(current_texts),
                )
            )
            current_start = seg.start
            current_texts = []
        current_texts.append(seg.text.replace("\n", " ").strip())

    last_seg = segments[-1]
    grouped.append(
        Segment(
            start=current_start,
            duration=last_seg.start + last_seg.duration - current_start,
            text=" ".join(current_texts),
        )
    )
    return grouped


def build_note(
    transcript: Transcript,
    title: str,
    url: str,
    analysis: str | None = None,
    group_window: float = 30.0,
) -> str:
    """frontmatter + 분석 + 타임스탬프 트랜스크립트로 구성된 노트를 만든다."""
    today = date.today().isoformat()
    lines = [
        "---",
        f'title: "{title}"',
        f"url: {url}",
        f"video_id: {transcript.video_id}",
        f"date: {today}",
        f"language: {transcript.language}",
        f"transcript_source: {transcript.source}",
        "tags:",
        "  - youtube",
        "  - transcript",
        "---",
        "",
        f"# {title}",
        "",
        f"> 🎬 원본 영상: {url}",
        "",
    ]

    if analysis:
        lines += ["## 🤖 Claude 분석", "", analysis.strip(), "", "---", ""]

    lines += ["## 📝 트랜스크립트", ""]
    for seg in group_segments(transcript.segments, window=group_window):
        link = timestamp_link(transcript.video_id, seg.start)
        lines.append(f"**{link}** {seg.text}")
        lines.append("")

    return "\n".join(lines)
