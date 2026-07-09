// 백그라운드 서비스 워커: 단계 선택형 파이프라인을 지휘한다.
//   ① 추출 (자막 또는 Whisper) → 노트 저장
//   ② 자막 교정 (선택)        → 같은 노트 갱신
//   ③ Claude 분석 (선택)      → 같은 노트 갱신
// 각 단계는 팝업에서 따로 실행하고, 상태는 chrome.storage에 남아
// 팝업을 닫아도 이어진다. 완료/오류 시 시스템 알림.
//
// MV3는 원격 코드 로드를 금지하고 이 확장은 번들러 없이 배포되므로,
// Anthropic SDK 대신 공식 REST API를 직접 호출한다 (CORS는
// anthropic-dangerous-direct-browser-access 헤더로 공식 지원됨).

import { buildNote, formatTimestamp, groupSegments, sanitizeFilename } from "./markdown.js";

const DEFAULT_MODEL = "claude-opus-4-8";

const ANALYSIS_SYSTEM = `당신은 YouTube 영상 트랜스크립트를 분석해 Obsidian 노트용 Markdown을 작성하는 전문가입니다.

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

function polishSystemPrompt(title) {
  return `당신은 한국어 음성 인식 자막을 다듬는 전문 편집자입니다.
지금 다룰 영상의 제목: "${title}"

[타임스탬프]가 붙은 자막 문단들을 받습니다. 각 문단을 다음 기준으로 교정하세요:
1. 음성 인식 오류 교정 — 문맥과 영상 주제에 비추어 잘못 받아적힌 단어를 올바르게 수정.
   고유명사·전문용어는 영상 제목과 문맥을 근거로 가장 그럴듯한 표기로 통일.
2. 문장부호(마침표·쉼표·물음표)와 띄어쓰기를 표준 맞춤법에 맞게 추가.
3. 끊긴 문장은 자연스럽게 연결하고, 군더더기(어, 음, 같은 말 반복)는 정리.
4. 말의 의미와 정보는 그대로 유지 — 새 내용을 추가하거나 요약하지 말 것.

출력 형식: 각 문단을 "[타임스탬프] 교정된 텍스트" 한 줄로, 입력에 있던 타임스탬프를
그대로 사용해 모두 출력하세요. 문단을 합치거나 나누지 마세요. 다른 말은 쓰지 마세요.`;
}

const MAX_TRANSCRIPT_CHARS = 350_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 진행 중인 단계의 중지 핸들 (한 번에 한 단계만 실행)
let activeRun = null; // { abort: AbortController, serverJob: {base, jobId} | null }

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const e = new Error("사용자가 중지했습니다.");
    e.name = "AbortError";
    throw e;
  }
}

async function getSettings() {
  const defaults = {
    anthropicApiKey: "",
    model: DEFAULT_MODEL,
    obsidianBaseUrl: "http://127.0.0.1:27123",
    obsidianApiKey: "",
    obsidianFolder: "YouTube",
    languages: "ko,en",
    serverUrl: "http://127.0.0.1:8765",
    whisperModel: "small",
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

// ---------- 작업 상태 (팝업 표시용) ----------

async function setJob(patch) {
  const { lastJob } = await chrome.storage.local.get("lastJob");
  const prev = lastJob || {};
  const job = { ...prev, ...patch, updatedAt: Date.now() };
  if (patch.progress !== undefined && patch.progress !== prev.progress) {
    job.stageStartedAt = Date.now();
  }
  await chrome.storage.local.set({ lastJob: job });
  return job;
}

function notifyUser(title, message) {
  chrome.notifications
    .create({ type: "basic", iconUrl: "icon128.png", title, message })
    .catch(() => {});
}

// ---------- 파이프라인 상태 (단계 간 공유) ----------

async function getPipeline() {
  const { pipeline } = await chrome.storage.local.get("pipeline");
  return pipeline || null;
}

async function setPipeline(pipeline) {
  await chrome.storage.local.set({ pipeline });
}

// ---------- 자막 추출 (콘텐츠 스크립트 경유) ----------

async function extractViaContentScript(tabId, videoId, languages) {
  const message = { type: "extractTranscript", videoId, languages };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    // 확장 설치/업데이트 전에 열린 탭에는 스크립트가 없으므로 주입 후 재시도
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

// ---------- Claude 호출 ----------

async function callClaude(settings, system, userText, signal) {
  if (!settings.anthropicApiKey) {
    throw new Error("Anthropic API 키가 설정되지 않았습니다. 확장 옵션에서 설정하세요.");
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
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
      system,
      messages: [{ role: "user", content: userText }],
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
    throw new Error("Claude가 이 콘텐츠의 처리를 거부했습니다.");
  }
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function renderTranscriptForPrompt(segments) {
  const text = segments
    .filter((s) => s.text.trim())
    .map((s) => `[${formatTimestamp(s.start)}] ${s.text.trim()}`)
    .join("\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(
      `트랜스크립트가 너무 깁니다 (${text.length.toLocaleString()}자). 긴 영상은 로컬 서버(CLI)로 처리하세요.`
    );
  }
  return text;
}

/** 자막 교정: 문단 단위로 Claude가 오인식·문장부호·문장 연결을 다듬는다.
 *  긴 영상은 조각으로 나눠 순차 처리. 결과는 타임스탬프로 매칭한다. */
async function polishTranscript(settings, title, segments, signal, onChunk) {
  const lines = segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text.trim()}`);

  // 청크당 약 9,000자 — 응답(교정문)이 max_tokens를 넘지 않게 보수적으로.
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const line of lines) {
    if (currentLen + line.length > 9000 && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length;
  }
  if (current.length > 0) chunks.push(current);

  // 출력 줄을 타임스탬프 기준으로 수집 (줄 순서·개수가 어긋나도 안전)
  const polishedByStamp = new Map();
  const system = polishSystemPrompt(title);
  for (let c = 0; c < chunks.length; c++) {
    onChunk?.(c + 1, chunks.length);
    throwIfAborted(signal);
    const output = await callClaude(settings, system, chunks[c].join("\n"), signal);
    for (const line of output.split("\n")) {
      const m = line.match(/^\s*\[([\d:]+)\]\s*(.+)$/);
      if (m && m[2].trim()) polishedByStamp.set(m[1], m[2].trim());
    }
  }

  // 매칭 실패한 문단은 원문 유지 (내용 유실 방지)
  return segments.map((s) => {
    const cleaned = polishedByStamp.get(formatTimestamp(s.start));
    return cleaned ? { ...s, text: cleaned } : { ...s };
  });
}

async function analyzeTranscript(settings, pipeline, signal) {
  const userMessage =
    `영상 제목: ${pipeline.title}\n영상 URL: ${pipeline.url}\n\n` +
    `<transcript>\n${renderTranscriptForPrompt(pipeline.segments)}\n</transcript>`;
  return callClaude(settings, ANALYSIS_SYSTEM, userMessage, signal);
}

// ---------- Obsidian 저장 ----------

function obsidianAuthKey(settings) {
  // 플러그인 설정 화면의 "Bearer <키>" 표기를 통째로 복사하는 경우 흡수
  return settings.obsidianApiKey.trim().replace(/^bearer\s+/i, "");
}

async function noteExists(settings, notePath) {
  const base = settings.obsidianBaseUrl.replace(/\/+$/, "");
  const encodedPath = notePath.split("/").map(encodeURIComponent).join("/");
  try {
    const resp = await fetch(`${base}/vault/${encodedPath}`, {
      headers: { Authorization: `Bearer ${obsidianAuthKey(settings)}` },
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

async function putNote(settings, notePath, content) {
  const base = settings.obsidianBaseUrl.replace(/\/+$/, "");
  const encodedPath = notePath.split("/").map(encodeURIComponent).join("/");
  const resp = await fetch(`${base}/vault/${encodedPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${obsidianAuthKey(settings)}`,
      "Content-Type": "text/markdown",
    },
    body: content,
  });
  if (!resp.ok) {
    if (resp.status === 401) {
      throw new Error(
        "Obsidian 인증 실패 (401): 확장 옵션의 Local REST API 키가 플러그인의 " +
          "키와 다릅니다. 플러그인 설정에서 키(긴 영숫자 문자열만, 'Bearer' 단어 제외)를 " +
          "다시 복사해 넣으세요."
      );
    }
    throw new Error(`Obsidian REST API 오류 (HTTP ${resp.status})`);
  }
}

async function saveViaDownload(filename, content) {
  const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(content);
  await chrome.downloads.download({ url, filename: `${filename}.md`, saveAs: true });
  return `(다운로드) ${filename}.md`;
}

/** 파이프라인 상태로 노트를 만들어 저장(또는 갱신)하고 경로를 돌려준다. */
async function savePipelineNote(settings, pipeline) {
  const note = buildNote({
    videoId: pipeline.videoId,
    title: pipeline.title,
    url: pipeline.url,
    segments: pipeline.segments,
    language: pipeline.language,
    source: pipeline.source,
    analysis: pipeline.analysis,
  });
  const filename = sanitizeFilename(pipeline.title);

  if (!settings.obsidianApiKey) {
    return saveViaDownload(filename, note);
  }

  let notePath = pipeline.notePath;
  if (!notePath) {
    // 첫 저장: 기존 노트를 덮어쓰지 않도록 빈 경로를 찾는다.
    const folder = settings.obsidianFolder.replace(/^\/+|\/+$/g, "");
    const makePath = (name) => (folder ? `${folder}/${name}.md` : `${name}.md`);
    notePath = makePath(filename);
    for (let n = 2; (await noteExists(settings, notePath)) && n < 20; n++) {
      notePath = makePath(`${filename} (${n})`);
    }
  }
  await putNote(settings, notePath, note);
  pipeline.notePath = notePath;
  return notePath;
}

// ---------- 단계들 ----------

async function stepExtract(settings, { tabId, videoId }, signal) {
  await setJob({ detail: "자막 추출 중...", progress: 10, progressCap: 40, etaSeconds: 8 });
  const languages = settings.languages.split(",").map((s) => s.trim()).filter(Boolean);
  const extracted = await extractViaContentScript(tabId, videoId, languages);
  if (!extracted?.ok) throw new Error(extracted?.error || "자막 추출 실패");
  throwIfAborted(signal);

  const { title, language, source } = extracted.result;
  const segments = groupSegments(extracted.result.segments); // 20초 + 화자 전환 문단
  const pipeline = {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    language,
    source,
    segments,
    analysis: null,
    notePath: null,
    polished: false,
  };

  await setJob({ title, detail: "노트 저장 중...", progress: 70, progressCap: 95, etaSeconds: 4 });
  const savedTo = await savePipelineNote(settings, pipeline);
  await setPipeline(pipeline);
  return { savedTo, title };
}

async function stepWhisper(settings, { videoId }, signal) {
  const base = settings.serverUrl.replace(/\/+$/, "");

  await setJob({ detail: "로컬 서버에 작업 요청 중...", progress: 5, progressCap: 10, etaSeconds: 5 });
  let resp;
  try {
    resp = await fetch(`${base}/jobs`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        use_whisper: true,
        do_analysis: false,
        save: false,
        return_segments: true,
        whisper_model: settings.whisperModel || "small",
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(
      "로컬 서버에 연결할 수 없습니다. 터미널에서 yt2obsidian-server 가 실행 중인지 확인하세요."
    );
  }
  if (!resp.ok) throw new Error(`서버 오류 (HTTP ${resp.status})`);
  const { job_id: jobId } = await resp.json();
  if (activeRun) activeRun.serverJob = { base, jobId };

  let job;
  let lastDetail = null;
  while (true) {
    throwIfAborted(signal);
    await sleep(2000);
    job = await (await fetch(`${base}/jobs/${jobId}`, { signal })).json();
    if (job.status === "done") break;
    if (job.status === "cancelled") {
      const e = new Error("사용자가 중지했습니다.");
      e.name = "AbortError";
      throw e;
    }
    if (job.status === "error") throw new Error(job.error);
    if (job.detail !== lastDetail) {
      lastDetail = job.detail;
      await setJob({
        detail: job.detail || "처리 중...",
        progress: job.progress,
        progressCap: job.progress_cap,
        etaSeconds: job.eta_seconds,
      });
    }
  }

  const result = job.result;
  const segments = groupSegments(result.segments || []);
  if (segments.length === 0) throw new Error("음성 인식 결과가 비어 있습니다.");

  const pipeline = {
    videoId,
    title: result.title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    language: result.language,
    source: result.source,
    segments,
    analysis: null,
    notePath: null,
    polished: false,
  };

  await setJob({ title: result.title, detail: "노트 저장 중...", progress: 92, progressCap: 97, etaSeconds: 4 });
  const savedTo = await savePipelineNote(settings, pipeline);
  await setPipeline(pipeline);
  return { savedTo, title: result.title };
}

async function stepPolish(settings, signal) {
  const pipeline = await getPipeline();
  if (!pipeline) throw new Error("먼저 ① 추출을 실행하세요.");

  const totalChars = pipeline.segments.reduce((n, s) => n + s.text.length, 0);
  const chunkCount = Math.max(1, Math.ceil(totalChars / 9000));
  await setJob({
    title: pipeline.title,
    detail: "자막 교정 중 (Claude)...",
    progress: 8,
    progressCap: 85,
    etaSeconds: chunkCount * 45,
  });

  pipeline.segments = await polishTranscript(
    settings,
    pipeline.title,
    pipeline.segments,
    signal,
    (done, total) => {
      if (total > 1) setJob({ detail: `자막 교정 중 (Claude)... ${done}/${total}` });
    }
  );
  pipeline.polished = true;

  await setJob({ detail: "노트 갱신 중...", progress: 90, progressCap: 96, etaSeconds: 3 });
  const savedTo = await savePipelineNote(settings, pipeline);
  await setPipeline(pipeline);
  return { savedTo, title: pipeline.title };
}

async function stepAnalyze(settings, signal) {
  const pipeline = await getPipeline();
  if (!pipeline) throw new Error("먼저 ① 추출을 실행하세요.");

  const totalChars = pipeline.segments.reduce((n, s) => n + s.text.length, 0);
  await setJob({
    title: pipeline.title,
    detail: "Claude 분석 중...",
    progress: 8,
    progressCap: 85,
    etaSeconds: Math.round(35 + totalChars / 2500),
  });

  pipeline.analysis = await analyzeTranscript(settings, pipeline, signal);

  await setJob({ detail: "노트 갱신 중...", progress: 90, progressCap: 96, etaSeconds: 3 });
  const savedTo = await savePipelineNote(settings, pipeline);
  await setPipeline(pipeline);
  return { savedTo, title: pipeline.title };
}

// ---------- 진입점 ----------

const STEP_LABEL = {
  extract: "① 자막 추출",
  whisper: "① 음성 인식 (Whisper)",
  polish: "② 자막 교정",
  analyze: "③ Claude 분석",
};

async function runStep(step, payload) {
  if (activeRun) return; // 한 번에 한 단계만

  const abort = new AbortController();
  activeRun = { abort, serverJob: null };

  const settings = await getSettings();
  await setJob({
    state: "running",
    step,
    stepLabel: STEP_LABEL[step] || step,
    detail: "시작 중...",
    progress: 3,
    progressCap: 8,
    etaSeconds: step === "whisper" ? 300 : 30,
    result: null,
    error: null,
  });

  try {
    let result;
    if (step === "extract") result = await stepExtract(settings, payload, abort.signal);
    else if (step === "whisper") result = await stepWhisper(settings, payload, abort.signal);
    else if (step === "polish") result = await stepPolish(settings, abort.signal);
    else if (step === "analyze") result = await stepAnalyze(settings, abort.signal);
    else throw new Error(`알 수 없는 단계: ${step}`);

    await setJob({ state: "done", detail: "완료", result, progress: 100, etaSeconds: 0 });
    notifyUser(`${STEP_LABEL[step]} 완료`, `저장됨: ${result.savedTo}`);
  } catch (e) {
    if (e.name === "AbortError" || abort.signal.aborted) {
      await setJob({ state: "cancelled", detail: "중지됨" });
      notifyUser("YouTube → Obsidian", "작업을 중지했습니다.");
    } else {
      await setJob({ state: "error", error: e.message });
      notifyUser(`${STEP_LABEL[step]} 오류`, e.message);
    }
  } finally {
    activeRun = null;
  }
}

async function cancelPipeline() {
  if (!activeRun) {
    // 확장 새로고침/브라우저 재시작으로 실행 주체가 사라진 '유령 작업' 정리
    const { lastJob } = await chrome.storage.local.get("lastJob");
    if (lastJob?.state === "running") {
      await setJob({ state: "cancelled", detail: "중지됨" });
    }
    return;
  }
  const { abort, serverJob } = activeRun;
  abort.abort();
  if (serverJob) {
    fetch(`${serverJob.base}/jobs/${serverJob.jobId}/cancel`, { method: "POST" }).catch(
      () => {}
    );
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "runStep") {
    runStep(message.step, message.payload); // 팝업이 닫혀도 계속 진행
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "cancelPipeline") {
    cancelPipeline();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// 서비스 워커가 새로 시작됐는데 lastJob이 실행 중이면, 이전 실행 주체가
// 사라진 것(확장 새로고침/브라우저 재시작)이므로 상태를 정리한다.
(async () => {
  const { lastJob } = await chrome.storage.local.get("lastJob");
  const staleMs = Date.now() - (lastJob?.updatedAt || 0);
  if (lastJob?.state === "running" && !activeRun && staleMs > 5000) {
    await setJob({
      state: "error",
      error: "확장이 재시작되어 이전 작업이 중단되었습니다. 다시 실행해주세요.",
    });
  }
})();
