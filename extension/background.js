// 백그라운드 서비스 워커: Claude API 호출 + Obsidian 저장을 담당한다.
// MV3는 원격 코드 로드를 금지하고 이 확장은 번들러 없이 배포되므로,
// Anthropic SDK 대신 공식 REST API를 직접 호출한다 (CORS는
// anthropic-dangerous-direct-browser-access 헤더로 공식 지원됨).

import { buildNote, formatTimestamp, sanitizeFilename } from "./markdown.js";

const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `당신은 YouTube 영상 트랜스크립트를 분석해 Obsidian 노트용 Markdown을 작성하는 전문가입니다.

입력으로 [MM:SS] 타임스탬프가 붙은 트랜스크립트를 받습니다.
다음 구조로 한국어 분석을 작성하세요:

### 한 줄 요약
영상 전체를 한 문장으로.

### 핵심 요약
3~5문단으로 영상의 내용을 요약.

### 핵심 포인트
- 중요한 내용을 불릿으로 정리하고, 각 항목 앞에 관련 타임스탬프를 \`[MM:SS]\` 형태로 표기.

### 타임라인
- \`[MM:SS]\` 주제 — 해당 구간에서 다루는 내용 한 줄 설명. 주요 구간 전환마다 하나씩.

### 인사이트 및 액션 아이템
- 시청자가 얻을 수 있는 통찰이나 실행할 만한 항목이 있으면 정리. 없으면 이 섹션은 생략.

타임스탬프는 반드시 입력에 실제로 존재하는 시각만 사용하세요. 내용을 지어내지 마세요.
제목/헤더 외에 불필요한 서두나 맺음말은 쓰지 마세요.`;

const MAX_TRANSCRIPT_CHARS = 350_000;

async function getSettings() {
  const defaults = {
    anthropicApiKey: "",
    model: DEFAULT_MODEL,
    obsidianBaseUrl: "http://127.0.0.1:27123",
    obsidianApiKey: "",
    obsidianFolder: "YouTube",
    languages: "ko,en",
    doAnalysis: true,
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

function renderTranscriptForPrompt(segments) {
  const text = segments
    .filter((s) => s.text.trim())
    .map((s) => `[${formatTimestamp(s.start)}] ${s.text.trim()}`)
    .join("\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(
      `트랜스크립트가 너무 깁니다 (${text.length.toLocaleString()}자). 긴 영상은 CLI로 처리하세요.`
    );
  }
  return text;
}

async function analyzeWithClaude(settings, { videoId, title, segments }) {
  if (!settings.anthropicApiKey) {
    throw new Error("Anthropic API 키가 설정되지 않았습니다. 확장 옵션에서 설정하세요.");
  }

  const userMessage =
    `영상 제목: ${title}\n영상 URL: https://www.youtube.com/watch?v=${videoId}\n\n` +
    `<transcript>\n${renderTranscriptForPrompt(segments)}\n</transcript>`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      detail = err?.error?.message || detail;
    } catch (_) {
      /* 본문이 JSON이 아니면 상태 코드만 표시 */
    }
    throw new Error(`Claude API 오류: ${detail}`);
  }

  const data = await resp.json();
  if (data.stop_reason === "refusal") {
    throw new Error("Claude가 이 콘텐츠의 분석을 거부했습니다.");
  }
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Obsidian Local REST API 플러그인으로 노트를 저장한다. */
async function saveViaRestApi(settings, filename, content) {
  const base = settings.obsidianBaseUrl.replace(/\/+$/, "");
  const folder = settings.obsidianFolder.replace(/^\/+|\/+$/g, "");
  const notePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;
  const encodedPath = notePath.split("/").map(encodeURIComponent).join("/");

  const resp = await fetch(`${base}/vault/${encodedPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${settings.obsidianApiKey}`,
      "Content-Type": "text/markdown",
    },
    body: content,
  });
  if (!resp.ok) {
    throw new Error(`Obsidian REST API 오류 (HTTP ${resp.status})`);
  }
  return notePath;
}

/** REST API를 쓸 수 없을 때: .md 파일로 다운로드 (사용자가 Vault로 옮김). */
async function saveViaDownload(filename, content) {
  const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(content);
  await chrome.downloads.download({
    url,
    filename: `${filename}.md`,
    saveAs: true,
  });
  return `(다운로드) ${filename}.md`;
}

async function processVideo(payload, notify) {
  const settings = await getSettings();
  const { videoId, title, segments, language, source } = payload;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  let analysis = null;
  if (settings.doAnalysis && payload.doAnalysis !== false) {
    notify("Claude 분석 중... (영상 길이에 따라 수십 초 걸릴 수 있습니다)");
    analysis = await analyzeWithClaude(settings, payload);
  }

  notify("노트 생성 및 저장 중...");
  const note = buildNote({ videoId, title, url, segments, language, source, analysis });
  const filename = sanitizeFilename(title);

  let savedTo;
  if (settings.obsidianApiKey) {
    savedTo = await saveViaRestApi(settings, filename, note);
  } else {
    savedTo = await saveViaDownload(filename, note);
  }
  return { savedTo, analyzed: Boolean(analysis) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "processVideo") return false;

  const notify = (status) => {
    chrome.runtime.sendMessage({ type: "status", status }).catch(() => {});
  };

  processVideo(message.payload, notify)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // 비동기 응답
});
