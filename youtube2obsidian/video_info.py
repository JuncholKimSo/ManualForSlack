"""YouTube oEmbed API로 영상 제목 등 메타데이터를 가져온다 (API 키 불필요)."""

from __future__ import annotations

import json
import urllib.request


def fetch_video_title(video_id: str, timeout: float = 10.0) -> str:
    """oEmbed로 영상 제목을 가져온다. 실패하면 video ID를 그대로 반환."""
    url = (
        "https://www.youtube.com/oembed?format=json"
        f"&url=https://www.youtube.com/watch?v={video_id}"
    )
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("title") or video_id
    except Exception:
        return video_id
