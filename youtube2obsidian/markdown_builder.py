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


import re as _re


def split_speaker_turns(segments: list[Segment]) -> list[tuple[Segment, bool]]:
    """자동 자막의 화자 전환 표시('>>')를 제거하고 (조각, 화자전환여부)로 펼친다."""
    out: list[tuple[Segment, bool]] = []
    for seg in segments:
        raw = seg.text.replace("\n", " ")
        starts_with_marker = bool(_re.match(r"^\s*>>", raw))
        parts = [p.strip() for p in _re.split(r"\s*>>\s*", raw) if p.strip()]
        for i, part in enumerate(parts):
            new_speaker = i > 0 or (i == 0 and starts_with_marker)
            out.append(
                (Segment(start=seg.start, duration=seg.duration, text=part), new_speaker)
            )
    return out


def group_segments(segments: list[Segment], window: float = 20.0) -> list[Segment]:
    """자막 조각을 window(초) 단위 문단으로 묶는다.

    화자가 바뀌는 것으로 추정되는 지점('>>')에서는 시간과 무관하게 새 문단.
    """
    turns = split_speaker_turns(segments)
    if not turns:
        return []

    grouped: list[Segment] = []
    current_start = turns[0][0].start
    current_texts: list[str] = []

    def flush(next_start: float) -> None:
        nonlocal current_texts
        if current_texts:
            grouped.append(
                Segment(
                    start=current_start,
                    duration=next_start - current_start,
                    text=" ".join(current_texts),
                )
            )
            current_texts = []

    for seg, new_speaker in turns:
        if current_texts and (new_speaker or seg.start - current_start >= window):
            flush(seg.start)
            current_start = seg.start
        current_texts.append(seg.text)

    last_seg = turns[-1][0]
    flush(last_seg.start + last_seg.duration)
    return grouped


def build_note(
    transcript: Transcript,
    title: str,
    url: str,
    analysis: str | None = None,
    group_window: float = 20.0,
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
