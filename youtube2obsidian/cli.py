"""CLI 진입점: YouTube URL → 트랜스크립트 → Claude 분석 → Obsidian 저장."""

from __future__ import annotations

import argparse
import sys

from .claude_analyzer import DEFAULT_MODEL, analyze_transcript
from .markdown_builder import build_note
from .obsidian_writer import save_note
from .transcript import extract_video_id, get_transcript
from .video_info import fetch_video_title


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="yt2obsidian",
        description="YouTube 영상을 타임스탬프 트랜스크립트로 변환해 "
        "Obsidian에 저장하고 Claude로 분석합니다.",
    )
    parser.add_argument("url", help="YouTube 영상 URL 또는 video ID")
    parser.add_argument(
        "--vault",
        help="Obsidian Vault 경로 (기본: OBSIDIAN_VAULT_PATH 환경 변수)",
    )
    parser.add_argument(
        "--subfolder",
        default="YouTube",
        help="Vault 내 저장 폴더 (기본: YouTube)",
    )
    parser.add_argument(
        "--languages",
        default="ko,en",
        help="자막 언어 우선순위, 쉼표 구분 (기본: ko,en)",
    )
    parser.add_argument(
        "--whisper-model",
        default="small",
        help="자막이 없을 때 사용할 faster-whisper 모델 크기 (기본: small)",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"분석에 사용할 Claude 모델 (기본: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--no-analysis",
        action="store_true",
        help="Claude 분석을 건너뛰고 트랜스크립트만 저장",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Vault에 저장하지 않고 노트를 표준 출력으로 내보냄",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        video_id = extract_video_id(args.url)
        url = f"https://www.youtube.com/watch?v={video_id}"

        print(f"▶ 영상 정보 조회 중: {video_id}", file=sys.stderr)
        title = fetch_video_title(video_id)

        print("▶ 트랜스크립트 추출 중 (자막 → Whisper 순서)...", file=sys.stderr)
        transcript = get_transcript(
            url,
            languages=[x.strip() for x in args.languages.split(",") if x.strip()],
            whisper_model=args.whisper_model,
        )
        print(
            f"  ✓ {len(transcript.segments)}개 구간, "
            f"언어={transcript.language}, 출처={transcript.source}",
            file=sys.stderr,
        )

        analysis = None
        if not args.no_analysis:
            print(f"▶ Claude 분석 중 ({args.model})...", file=sys.stderr)
            analysis = analyze_transcript(transcript, title, model=args.model)
            print("  ✓ 분석 완료", file=sys.stderr)

        note = build_note(transcript, title=title, url=url, analysis=analysis)

        if args.stdout:
            print(note)
        else:
            path = save_note(note, title=title, vault=args.vault, subfolder=args.subfolder)
            print(f"✅ Obsidian에 저장됨: {path}", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"❌ 오류: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
