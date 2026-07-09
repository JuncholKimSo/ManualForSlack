---
title: YouTube→Obsidian 변경 이력
date: 2026-07-09
tags:
  - changelog
  - youtube2obsidian
---

# YouTube → Obsidian 변경 이력

| 버전 | 변경 내용 |
|---|---|
| 0.1.0 | 최초 크롬 확장 (자막 추출 → Claude 분석 → Obsidian 저장) + Python CLI |
| 0.3.0 | 자막 추출을 get_transcript API로 교체, 콘텐츠 스크립트 자동 주입, Whisper 로컬 서버 모드 추가 |
| 0.3.1 | get_transcript 토큰 디코딩 수정, 모바일(ANDROID) API 폴백 추가 |
| 0.3.2 | XML 자막 파싱 지원, 모바일 경로 2순위 승격 — **자막 추출 안정화** |
| 0.4.0 | 전 과정 백그라운드 처리 (팝업 닫아도 진행), 완료 시스템 알림, 상태 복원 |
| 0.5.0 | 진행 바 + % + 예상 남은 시간 (분석은 자막 분량, Whisper는 영상 길이 기반) |
| 0.5.1 | Obsidian 키의 `Bearer ` 접두어 자동 제거, 401 오류에 한국어 안내 |
| 0.6.0 | **작업 중지 버튼** (Claude 호출 즉시 차단·서버 중지 연동), 자막 30초 문단 압축으로 입력 토큰 절감, 저비용 모델 안내 |
| 0.6.1 | 분석 모델 드롭다운 (Sonnet 5 추천/Opus 4.8/Haiku 4.5), 유령 작업 자동 정리로 중지 무반응 수정 |

## 현재 버전 확인 방법

`chrome://extensions` → "YouTube → Obsidian" 카드의 버전 번호

## 업데이트 루틴

```bash
cd ~/Documents/yt2obsidian && git pull
```

→ 확장 카드 새로고침(↻) → YouTube 탭 새로고침
