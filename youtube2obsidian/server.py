"""크롬 확장용 로컬 컴패니언 서버.

브라우저에서는 음성 인식이 불가능하므로, 확장이 이 서버에 작업을 맡긴다:
Whisper 음성 인식(또는 자막 추출) → Claude 분석 → Obsidian Vault 저장.

실행:
    export ANTHROPIC_API_KEY=sk-ant-...
    export OBSIDIAN_VAULT_PATH=~/Documents/MyVault
    yt2obsidian-server            # 기본 http://127.0.0.1:8765

API:
    GET  /health            → {"ok": true}
    POST /jobs              → {"job_id": "..."}   (본문: {url, use_whisper, do_analysis, ...})
    GET  /jobs/<job_id>     → {"status": "queued|running|done|error", "detail", "result", "error"}
"""

from __future__ import annotations

import argparse
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .claude_analyzer import DEFAULT_MODEL, analyze_transcript
from .markdown_builder import build_note
from .obsidian_writer import save_note
from .transcript import (
    extract_video_id,
    fetch_youtube_captions,
    transcribe_with_whisper,
)
from .video_info import fetch_video_title

_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()
_VAULT: str | None = None  # --vault 인자 (없으면 OBSIDIAN_VAULT_PATH 사용)


def _update(job_id: str, **fields) -> None:
    with _LOCK:
        _JOBS[job_id].update(fields)


def _run_job(job_id: str, params: dict) -> None:
    try:
        _update(job_id, status="running", detail="영상 정보 조회 중...")
        video_id = extract_video_id(params["url"])
        url = f"https://www.youtube.com/watch?v={video_id}"
        title = fetch_video_title(video_id)

        languages = params.get("languages") or ["ko", "en"]
        whisper_model = params.get("whisper_model", "small")

        if params.get("use_whisper"):
            _update(
                job_id,
                detail="오디오 다운로드 → Whisper 음성 인식 중... "
                "(영상 길이에 따라 수 분 걸릴 수 있습니다)",
            )
            transcript = transcribe_with_whisper(video_id, model_size=whisper_model)
        else:
            _update(job_id, detail="자막 추출 중...")
            try:
                transcript = fetch_youtube_captions(video_id, languages=languages)
            except Exception:
                _update(job_id, detail="자막이 없어 Whisper 음성 인식으로 전환...")
                transcript = transcribe_with_whisper(video_id, model_size=whisper_model)

        analysis = None
        if params.get("do_analysis", True):
            _update(job_id, detail="Claude 분석 중...")
            analysis = analyze_transcript(
                transcript, title, model=params.get("model", DEFAULT_MODEL)
            )

        _update(job_id, detail="노트 저장 중...")
        note = build_note(transcript, title=title, url=url, analysis=analysis)
        path = save_note(
            note, title=title, vault=_VAULT, subfolder=params.get("subfolder", "YouTube")
        )
        _update(
            job_id,
            status="done",
            detail="완료",
            result={
                "saved_to": str(path),
                "title": title,
                "analyzed": analysis is not None,
                "segments": len(transcript.segments),
                "source": transcript.source,
            },
        )
    except ImportError:
        _update(
            job_id,
            status="error",
            error="Whisper 의존성이 없습니다. 서버 환경에서 "
            "`pip install -e \".[whisper]\"` 를 실행하고 ffmpeg를 설치하세요.",
        )
    except Exception as e:  # noqa: BLE001 — 작업 오류는 모두 클라이언트에 전달
        _update(job_id, status="error", error=str(e))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 — CORS preflight
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True})
            return
        if self.path.startswith("/jobs/"):
            job_id = self.path.removeprefix("/jobs/")
            with _LOCK:
                job = _JOBS.get(job_id)
            if job is None:
                self._send(404, {"error": "존재하지 않는 작업입니다."})
            else:
                self._send(200, job)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/jobs":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            params = json.loads(self.rfile.read(length) or b"{}")
            if not params.get("url"):
                raise ValueError("url 필드가 필요합니다.")
        except (ValueError, json.JSONDecodeError) as e:
            self._send(400, {"error": f"잘못된 요청: {e}"})
            return

        job_id = uuid.uuid4().hex[:12]
        with _LOCK:
            _JOBS[job_id] = {"status": "queued", "detail": "대기 중...", "result": None, "error": None}
        threading.Thread(target=_run_job, args=(job_id, params), daemon=True).start()
        self._send(202, {"job_id": job_id})

    def log_message(self, fmt: str, *args) -> None:
        # 표준 라이브러리의 요청 로그를 간결하게 유지
        print(f"[server] {self.address_string()} {fmt % args}")


def main(argv: list[str] | None = None) -> int:
    global _VAULT

    parser = argparse.ArgumentParser(
        prog="yt2obsidian-server",
        description="크롬 확장용 로컬 서버 (Whisper 음성 인식 + Claude 분석 + Obsidian 저장)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--vault", help="Obsidian Vault 경로 (기본: OBSIDIAN_VAULT_PATH 환경 변수)"
    )
    args = parser.parse_args(argv)
    _VAULT = args.vault

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"🚀 yt2obsidian 서버 실행 중: http://{args.host}:{args.port}")
    print("   크롬 확장 팝업에서 '음성 인식(Whisper) 사용'을 켜고 실행하세요. (종료: Ctrl+C)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
