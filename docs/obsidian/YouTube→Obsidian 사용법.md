---
title: YouTube→Obsidian 사용법
date: 2026-07-09
tags:
  - manual
  - youtube2obsidian
---

# YouTube → Obsidian 사용법

YouTube 영상을 타임스탬프 트랜스크립트로 변환하고, Claude로 분석해 이 볼트에 자동 저장하는 도구.

## 평소 사용 (자막 모드 — 기본)

1. YouTube 영상 페이지를 연다
2. 크롬 툴바의 확장 아이콘 클릭
3. **[트랜스크립트 추출 → Obsidian 저장]** 버튼 클릭
4. 끝 — 팝업을 닫아도 백그라운드에서 진행되고, 완료되면 시스템 알림이 뜬다
5. 노트는 볼트의 `YouTube/` 폴더에 생성된다

- 진행 바에 % 와 예상 남은 시간이 표시된다
- 잘못 실행했으면 **[■ 작업 중지]** — 분석 시작 전에 멈추면 API 비용 없음
- "Claude로 분석 포함" 체크를 끄면 트랜스크립트만 저장 (비용 0원)

## 음성 인식 모드 (자막이 없는 영상)

터미널에서 서버를 켠 뒤, 팝업에서 **"음성 인식(Whisper) 사용"** 체크:

```bash
cd ~/Documents/yt2obsidian
export ANTHROPIC_API_KEY=sk-ant-본인키
export OBSIDIAN_VAULT_PATH="볼트 경로"
python3 -m youtube2obsidian.server
```

- 최초 1회 `python3 -m pip install -e ".[whisper]"` 필요
- 영상 길이에 따라 수 분 소요, 서버가 볼트에 직접 저장 (Obsidian 키 불필요)

## 설정 (확장 아이콘 우클릭 → 옵션)

| 항목 | 설명 |
|---|---|
| Anthropic API 키 | console.anthropic.com에서 발급 |
| 분석 모델 | **Sonnet 5 (균형·추천)** / Opus 4.8 (최고 품질) / Haiku 4.5 (최저 비용) |
| Local REST API 키 | Obsidian 플러그인 설정에서 복사 — **`Bearer` 단어 없이 키만** |
| Vault 내 저장 폴더 | 기본 `YouTube` |
| 자막 언어 우선순위 | 기본 `ko,en` |

## 업데이트 방법

```bash
cd ~/Documents/yt2obsidian
git pull
```

→ `chrome://extensions` 에서 확장 카드의 새로고침(↻) → YouTube 탭 새로고침

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `Receiving end does not exist` | 확장 업데이트 후 기존 탭에 스크립트 없음 → YouTube 탭 새로고침 (v0.3.0+ 자동 복구) |
| `Obsidian 인증 실패 (401)` | 키를 `Bearer` 단어까지 복사함 → 키 문자열만 다시 입력 (v0.5.1+ 자동 흡수) |
| `로컬 서버에 연결할 수 없습니다` | Whisper 체크가 켜져 있는데 서버 미실행 → 체크 해제하거나 서버 실행 |
| 자막 추출 실패 | 영상에 자막이 없음 → Whisper 모드 사용 |
| 중지 버튼 무반응 | 확장 새로고침으로 끊긴 유령 작업 → v0.6.1+ 자동 정리, 중지 한 번 더 클릭 |

## 비용 관리

- 비용은 Claude 분석에만 발생 (자막 추출·저장·Whisper는 무료)
- 절감 순서: ① 분석 체크 끄기(0원) → ② 모델을 Haiku/Sonnet으로 → ③ 잘못 누르면 즉시 중지
- 자막은 30초 문단으로 압축되어 전송됨 (v0.6.0+, 자동)
