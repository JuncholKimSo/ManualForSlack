"""Claude API로 트랜스크립트를 분석한다 (요약·핵심 포인트·타임라인)."""

from __future__ import annotations

import anthropic

from .markdown_builder import format_timestamp
from .transcript import Transcript

DEFAULT_MODEL = "claude-opus-4-8"

SYSTEM_PROMPT = """\
당신은 YouTube 영상 트랜스크립트를 분석해 Obsidian 노트용 Markdown을 작성하는 전문가입니다.

입력으로 [MM:SS] 타임스탬프가 붙은 트랜스크립트를 받습니다.
다음 구조로 한국어 분석을 작성하세요:

### 한 줄 요약
영상 전체를 한 문장으로.

### 핵심 요약
3~5문단으로 영상의 내용을 요약.

### 핵심 포인트
- 중요한 내용을 불릿으로 정리하고, 각 항목 앞에 관련 타임스탬프를 `[MM:SS]` 형태로 표기.

### 타임라인
- `[MM:SS]` 주제 — 해당 구간에서 다루는 내용 한 줄 설명. 주요 구간 전환마다 하나씩.

### 인사이트 및 액션 아이템
- 시청자가 얻을 수 있는 통찰이나 실행할 만한 항목이 있으면 정리. 없으면 이 섹션은 생략.

타임스탬프는 반드시 입력에 실제로 존재하는 시각만 사용하세요. 내용을 지어내지 마세요.
제목/헤더 외에 불필요한 서두나 맺음말은 쓰지 마세요."""


def _render_transcript_for_prompt(transcript: Transcript, max_chars: int = 350_000) -> str:
    lines = [
        f"[{format_timestamp(seg.start)}] {seg.text.strip()}"
        for seg in transcript.segments
        if seg.text.strip()
    ]
    text = "\n".join(lines)
    if len(text) > max_chars:
        raise ValueError(
            f"트랜스크립트가 너무 깁니다 ({len(text):,}자 > {max_chars:,}자). "
            "영상을 나누어 처리하거나 max_chars를 조정하세요."
        )
    return text


def analyze_transcript(
    transcript: Transcript,
    title: str,
    model: str = DEFAULT_MODEL,
    client: anthropic.Anthropic | None = None,
) -> str:
    """트랜스크립트를 Claude에 보내 Markdown 분석을 돌려받는다.

    ANTHROPIC_API_KEY 환경 변수(또는 `ant auth login` 프로필)로 인증한다.
    """
    client = client or anthropic.Anthropic()
    prompt_transcript = _render_transcript_for_prompt(transcript)

    user_message = (
        f"영상 제목: {title}\n"
        f"영상 URL: https://www.youtube.com/watch?v={transcript.video_id}\n\n"
        f"<transcript>\n{prompt_transcript}\n</transcript>"
    )

    with client.messages.stream(
        model=model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        response = stream.get_final_message()

    if response.stop_reason == "refusal":
        raise RuntimeError("Claude가 이 콘텐츠의 분석을 거부했습니다.")

    return "".join(block.text for block in response.content if block.type == "text")
