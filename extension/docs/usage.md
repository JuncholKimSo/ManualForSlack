---
title: YouTube→Obsidian 사용법
tags:
  - manual
  - youtube2obsidian
---

# YouTube → Obsidian 사용법

YouTube 영상을 타임스탬프 트랜스크립트로 변환하고, Claude로 분석해 이 볼트에 자동 저장하는 도구.

## 단계 선택형 흐름 (v0.8+)

YouTube 영상 페이지에서 확장 아이콘을 누르면 단계별 버튼이 보인다:

1. **① 트랜스크립트 추출 (자막)** — 자막을 20초 문단으로 정리해 노트로 즉시 저장.
   화자가 바뀌는 지점은 자동으로 줄바꿈.
2. **① 음성 인식으로 추출 (Whisper)** — 자막이 없거나 품질이 나쁠 때. 로컬 서버 필요.
3. **② 자막 교정** — Claude가 오인식·문장부호·끊긴 문장을 다듬어 같은 노트를 갱신. (선택)
4. **③ Claude 분석** — 요약/핵심 포인트/타임라인을 노트 상단에 추가. (선택)

순서는 자유: ①만 해도 되고, ①→③, ①→②→③ 모두 가능. 각 단계는 **같은 노트를 갱신**한다.
팝업에 단계 진행 상태(✅/▫️)와 진행률 %·예상 남은 시간이 표시되고, 팝업을 닫아도
백그라운드에서 계속 진행되며 완료 시 시스템 알림이 뜬다. 실행 중 **[■ 작업 중지]** 가능.

모든 처리 내역은 `_처리 로그` 노트에 자동 기록된다.

## Whisper 모드 (자막 없는 영상)

터미널에서 서버를 켠 뒤 ①-Whisper 버튼 사용:

```bash
cd ~/Documents/yt2obsidian
export ANTHROPIC_API_KEY=sk-ant-본인키
export OBSIDIAN_VAULT_PATH="볼트 경로"
python3 -m youtube2obsidian.server
```

- 최초 1회 `python3 -m pip install -e ".[whisper]"` 필요
- 인식 품질을 올리려면 확장 옵션에서 Whisper 모델을 medium 이상으로

## 설정 (확장 아이콘 우클릭 → 옵션)

| 항목 | 설명 |
|---|---|
| Anthropic API 키 | console.anthropic.com에서 발급 |
| 분석 모델 | Sonnet 5 (균형·추천) / Opus 4.8 (최고 품질) / Haiku 4.5 (최저 비용) |
| Local REST API 키 | Obsidian 플러그인 설정에서 복사 — **`Bearer` 단어 없이 키만** |
| Vault 내 저장 폴더 | 기본 `YouTube` |
| 자막 언어 우선순위 | 기본 `ko,en` |
| Whisper 모델 | small(기본) / medium / large-v3 |

## 업데이트 방법

```bash
cd ~/Documents/yt2obsidian
git pull
```

→ `chrome://extensions` 에서 확장 카드의 새로고침(↻) → YouTube 탭 새로고침
→ 이 가이드 문서도 갱신하려면 옵션의 "가이드 문서를 볼트에 설치"를 다시 클릭

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `Receiving end does not exist` | 확장 업데이트 후 기존 탭에 스크립트 없음 → YouTube 탭 새로고침 |
| `Obsidian 인증 실패 (401)` | 키를 `Bearer` 단어까지 복사함 → 키 문자열만 다시 입력 |
| `로컬 서버에 연결할 수 없습니다` | Whisper 버튼을 눌렀는데 서버 미실행 → 서버 실행 또는 자막 버튼 사용 |
| 자막 추출 실패 | 영상에 자막이 없음 → Whisper 모드 사용 |
| 중지 버튼 무반응 | 확장 새로고침으로 끊긴 유령 작업 → 중지 한 번 더 클릭하면 정리됨 |

## 비용 관리

- 비용은 Claude 호출(② 교정, ③ 분석)에만 발생 — ① 추출은 무료
- 절감: 모델을 Sonnet/Haiku로, 필요한 단계만 실행, 잘못 누르면 즉시 중지
- 자막은 20초 문단으로 압축되어 전송됨 (자동)
