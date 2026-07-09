"""네트워크 없이 실행 가능한 단위 테스트."""

from pathlib import Path

import pytest

from youtube2obsidian.markdown_builder import (
    build_note,
    format_timestamp,
    group_segments,
    timestamp_link,
)
from youtube2obsidian.obsidian_writer import sanitize_filename, save_note
from youtube2obsidian.transcript import Segment, Transcript, extract_video_id


class TestExtractVideoId:
    @pytest.mark.parametrize(
        "url",
        [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
        ],
    )
    def test_valid_urls(self, url):
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    @pytest.mark.parametrize("url", ["https://vimeo.com/12345", "not a url"])
    def test_invalid_urls(self, url):
        with pytest.raises(ValueError):
            extract_video_id(url)


class TestTimestamps:
    def test_format_minutes(self):
        assert format_timestamp(0) == "0:00"
        assert format_timestamp(75) == "1:15"
        assert format_timestamp(3599) == "59:59"

    def test_format_hours(self):
        assert format_timestamp(3600) == "1:00:00"
        assert format_timestamp(3725.9) == "1:02:05"

    def test_link(self):
        link = timestamp_link("dQw4w9WgXcQ", 75.4)
        assert link == "[1:15](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s)"


class TestGroupSegments:
    def test_groups_by_window(self):
        segments = [Segment(start=i * 10.0, duration=10.0, text=f"s{i}") for i in range(7)]
        grouped = group_segments(segments, window=30.0)
        assert len(grouped) == 3
        assert grouped[0].text == "s0 s1 s2"
        assert grouped[1].start == 30.0

    def test_empty(self):
        assert group_segments([]) == []

    def test_speaker_change_breaks_group(self):
        segments = [
            Segment(start=0.0, duration=5.0, text="안녕하세요 오늘 주제는"),
            Segment(start=5.0, duration=5.0, text=">> 반갑습니다 저는 발표자입니다"),
            Segment(start=10.0, duration=5.0, text="이어서 설명드리면"),
        ]
        g = group_segments(segments, window=60.0)
        assert len(g) == 2
        assert g[0].text == "안녕하세요 오늘 주제는"
        assert g[1].text.startswith("반갑습니다")
        assert ">>" not in g[1].text
        assert g[1].start == 5.0

    def test_mid_segment_speaker_marker(self):
        segments = [
            Segment(start=0.0, duration=6.0, text="질문 있나요 >> 네 질문 있습니다"),
        ]
        g = group_segments(segments, window=60.0)
        assert len(g) == 2
        assert g[0].text == "질문 있나요"
        assert g[1].text == "네 질문 있습니다"


class TestBuildNote:
    def make_transcript(self):
        return Transcript(
            video_id="dQw4w9WgXcQ",
            segments=[
                Segment(start=0.0, duration=5.0, text="안녕하세요"),
                Segment(start=5.0, duration=5.0, text="오늘은 테스트입니다"),
            ],
            language="ko",
            source="youtube-captions",
        )

    def test_contains_frontmatter_and_transcript(self):
        note = build_note(
            self.make_transcript(),
            title="테스트 영상",
            url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )
        assert note.startswith("---")
        assert 'title: "테스트 영상"' in note
        assert "## 📝 트랜스크립트" in note
        assert "&t=0s" in note
        assert "## 🤖 Claude 분석" not in note

    def test_analysis_section(self):
        note = build_note(
            self.make_transcript(),
            title="테스트 영상",
            url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            analysis="### 한 줄 요약\n테스트 영상입니다.",
        )
        assert "## 🤖 Claude 분석" in note
        assert note.index("Claude 분석") < note.index("트랜스크립트")


class TestObsidianWriter:
    def test_sanitize(self):
        assert sanitize_filename('a/b:c*d?"e<f>g|h#i') == "abcdefghi"
        assert sanitize_filename("  많은   공백  ") == "많은 공백"
        assert sanitize_filename("") == "untitled"

    def test_save_and_dedupe(self, tmp_path: Path):
        p1 = save_note("본문1", title="제목", vault=tmp_path, subfolder="YouTube")
        p2 = save_note("본문2", title="제목", vault=tmp_path, subfolder="YouTube")
        assert p1.name == "제목.md"
        assert p2.name == "제목 (2).md"
        assert p1.read_text(encoding="utf-8") == "본문1"

    def test_missing_vault(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv("OBSIDIAN_VAULT_PATH", raising=False)
        with pytest.raises(ValueError):
            save_note("x", title="t", vault=None)
