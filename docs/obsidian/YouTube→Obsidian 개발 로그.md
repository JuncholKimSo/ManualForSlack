---
title: YouTube→Obsidian 개발 로그
date: 2026-07-09
tags:
  - devlog
  - youtube2obsidian
---

# YouTube → Obsidian 개발 로그

> Claude와 함께 만든 과정의 기록. 마주친 오류와 해결법 포함.

## 프로젝트 개요

- **목표**: YouTube 링크 → 음성/자막을 타임스탬프 텍스트로 → Obsidian 저장 → Claude 분석
- **저장소**: `~/Documents/yt2obsidian` (GitHub: JuncholKimSo/ManualForSlack, 브랜치 `claude/youtube-transcription-obsidian-bhft36`)
- **구성**: 크롬 확장(메인) + Python 로컬 서버/CLI(Whisper 음성 인식용)

## 진행 타임라인

1. **Python CLI 구현** — 자막 추출, Whisper 폴백, Claude 분석, Vault 저장 (테스트 20개)
2. **크롬 확장 전환 결정** — YouTube 페이지에서 원클릭 UX
3. **설치·설정 과정** — 개발자 모드 로드, Anthropic API 키 발급, Obsidian Local REST API 플러그인 설치(HTTP 서버 활성화)
4. **오류 잡기 여정** (아래 표)
5. **기능 고도화** — 백그라운드 처리, 진행률 %/예상 시간, 중지 버튼, 모델 선택, 토큰 절감

## 마주친 오류와 해결 (트러블슈팅 기록)

| # | 오류 | 원인 | 해결 |
|---|---|---|---|
| 1 | `Unexpected end of JSON input` | YouTube가 자막 URL에 보안 토큰(pot)을 요구하며 빈 응답 반환 | 추출 경로를 내부 get_transcript API로 교체 (v0.3.0) |
| 2 | `not a git repository` | ZIP으로 받은 폴더는 git 업데이트 불가 | `git clone`으로 새로 받음 (`~/Documents/yt2obsidian`) |
| 3 | `Receiving end does not exist` | 확장 설치 전에 열린 탭에는 스크립트 미주입 | 실패 시 자동 주입 후 재시도 (v0.3.0) |
| 4 | `get_transcript HTTP 400` | 페이지에서 추출한 토큰의 이스케이프(=) 미해제 | JSON 문자열 디코딩 (v0.3.1) |
| 5 | `Unexpected token '<'` | 모바일 API 자막이 JSON 대신 XML로 응답 | XML 파서 추가 + 모바일 경로 2순위 승격 (v0.3.2) → **자막 추출 성공** |
| 6 | `Obsidian REST API (401)` | 플러그인 화면의 `Bearer <키>`를 통째로 복사 | 키만 입력 + 코드가 접두어 자동 제거 (v0.5.1) |
| 7 | 팝업 닫으면 작업 중단 | 팝업이 흐름을 지휘하는 구조 | 백그라운드 전면 이관 (v0.4.0) |
| 8 | 중지 버튼 무반응 | 확장 새로고침으로 실행 주체가 사라진 유령 작업 | 시작/중지 시 자동 정리 (v0.6.1) |

## 배운 것

- YouTube는 자막 API 정책을 수시로 바꾼다 → 추출 경로를 3중으로 두는 게 답 (패널 API → 모바일 API → 웹 URL)
- 오류 메시지에 실패 원인을 자세히 담을수록 다음 디버깅이 빨라진다
- 크롬 확장(MV3)은 팝업이 쉽게 닫히므로 긴 작업은 반드시 백그라운드 서비스 워커에
- API 키 복사 시 `Bearer` 접두어 같은 함정은 코드가 흡수하는 게 낫다

## 남은 확인 사항 / 다음 아이디어

- [ ] 저장까지 전체 파이프라인 최종 성공 확인 (401 해결 후)
- [ ] Whisper 서버 첫 세팅 및 자막 없는 영상 테스트
- [ ] (아이디어) 여러 영상 일괄 처리, 재생목록 지원
- [ ] (아이디어) 분석 프롬프트 커스터마이징 옵션
