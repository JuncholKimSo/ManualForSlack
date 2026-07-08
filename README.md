# youtube2obsidian

YouTube 링크 하나로 다음 파이프라인을 실행하는 CLI 서비스입니다.

```
YouTube URL
   │
   ▼
① 트랜스크립트 추출 (타임스탬프 포함)
   ├─ 1차: YouTube 자막 API (수동/자동 생성 자막, 무료·빠름)
   └─ 2차: 자막이 없으면 yt-dlp로 오디오 다운로드 → faster-whisper 로컬 음성 인식
   │
   ▼
② Claude 분석 (claude-opus-4-8)
   └─ 한 줄 요약 / 핵심 요약 / 핵심 포인트 / 타임라인 / 인사이트
   │
   ▼
③ Obsidian Vault에 Markdown 노트로 저장
   └─ frontmatter + 분석 + 클릭 가능한 타임스탬프([MM:SS]) 트랜스크립트
```

노트의 모든 타임스탬프는 `https://youtube.com/watch?v=...&t=NNs` 링크라서,
Obsidian에서 클릭하면 영상의 해당 시각으로 바로 이동합니다.

## 설치

```bash
# 기본 (자막 있는 영상 + Claude 분석)
pip install -e .

# 자막이 없는 영상까지 처리하려면 (Whisper 음성 인식)
pip install -e ".[whisper]"
# ※ Whisper 경로는 ffmpeg가 필요합니다: apt install ffmpeg / brew install ffmpeg
```

## 설정

```bash
# Claude API 인증 (또는 `ant auth login` 프로필 사용)
export ANTHROPIC_API_KEY="sk-ant-..."

# Obsidian Vault 경로 (또는 실행 시 --vault 옵션)
export OBSIDIAN_VAULT_PATH="$HOME/Documents/MyVault"
```

## 사용법

```bash
# 기본: 자막 추출 → Claude 분석 → Vault/YouTube/ 폴더에 저장
yt2obsidian "https://www.youtube.com/watch?v=VIDEO_ID"

# 옵션 예시
yt2obsidian "https://youtu.be/VIDEO_ID" \
  --vault ~/Documents/MyVault \
  --subfolder "Clippings/YouTube" \
  --languages ko,en,ja \
  --whisper-model medium

# Claude 분석 없이 트랜스크립트만 저장
yt2obsidian "https://youtu.be/VIDEO_ID" --no-analysis

# 저장하지 않고 결과를 터미널로 확인
yt2obsidian "https://youtu.be/VIDEO_ID" --stdout --no-analysis
```

## 생성되는 노트 예시

```markdown
---
title: "영상 제목"
url: https://www.youtube.com/watch?v=VIDEO_ID
video_id: VIDEO_ID
date: 2026-07-08
language: ko
transcript_source: youtube-captions
tags:
  - youtube
  - transcript
---

# 영상 제목

> 🎬 원본 영상: https://www.youtube.com/watch?v=VIDEO_ID

## 🤖 Claude 분석

### 한 줄 요약
...

### 핵심 포인트
- [2:15](...&t=135s) 첫 번째 핵심 내용
...

## 📝 트랜스크립트

**[0:00](...&t=0s)** 안녕하세요, 오늘은 ...

**[0:30](...&t=30s)** 먼저 첫 번째 주제로 ...
```

## 구조

| 모듈 | 역할 |
|---|---|
| `transcript.py` | URL 파싱, 자막 추출, Whisper 음성 인식 폴백 |
| `markdown_builder.py` | 타임스탬프 링크 생성, 구간 묶기, 노트 조립 |
| `claude_analyzer.py` | Claude API 호출 (스트리밍 + adaptive thinking) |
| `obsidian_writer.py` | 파일명 정리, Vault 저장, 중복 파일명 처리 |
| `video_info.py` | oEmbed로 영상 제목 조회 (API 키 불필요) |
| `cli.py` | `yt2obsidian` 명령 진입점 |

## 테스트

```bash
pip install -e ".[dev]"
pytest
```

## 참고 사항

- **자막 vs Whisper**: 대부분의 영상은 자동 생성 자막이 있어 1차 경로로 몇 초 안에 처리됩니다.
  자막이 전혀 없는 영상만 Whisper 경로를 타며, 이때는 영상 길이와 모델 크기에 따라 시간이 걸립니다.
- **긴 영상**: 트랜스크립트가 약 35만 자를 넘으면 분석 전에 오류로 알려줍니다
  (Claude의 1M 토큰 컨텍스트 안에서 안전하게 동작하도록 보수적으로 제한).
- **Obsidian 연동**: Obsidian은 Vault가 일반 폴더이므로 별도 플러그인 없이 저장만 하면
  즉시 노트로 인식됩니다.
