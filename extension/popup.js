// 팝업: 시작 버튼 역할만 한다. 실제 작업은 백그라운드 서비스 워커가 수행하며,
// 진행 상태는 chrome.storage의 lastJob을 구독해 표시한다.
// → 팝업/창을 닫아도 작업은 계속되고, 완료 시 시스템 알림이 뜬다.

const $ = (id) => document.getElementById(id);

function setStatus(text, cls = "") {
  const el = $("status");
  el.textContent = text;
  el.className = cls;
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (host === "youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean); // shorts/, embed/, live/
      if (parts.length >= 2) return parts[1];
    }
  } catch (_) {
    /* URL 파싱 실패 → null */
  }
  return null;
}

async function getActiveYouTubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const videoId = tab?.url ? extractVideoId(tab.url) : null;
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? { tab, videoId } : null;
}

let currentJob = null;

function fmtEta(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 90) return `약 ${Math.round(s / 60)}분`;
  if (s >= 60) return `약 1분 ${s - 60}초`;
  return `약 ${s}초`;
}

/** 단계 기준 %에서 시작해, 단계 예상 시간에 맞춰 상한(cap)까지 서서히 채운다. */
function computePct(job) {
  const base = job.progress ?? 5;
  const cap = job.progressCap ?? Math.min(base + 10, 95);
  const elapsed = (Date.now() - (job.stageStartedAt || job.updatedAt)) / 1000;
  const stageDuration = Math.max(job.etaSeconds || 60, 10);
  return Math.min(cap, base + (elapsed * (cap - base)) / stageDuration);
}

function updateProgressUI() {
  const job = currentJob;
  if (!job || job.state !== "running") return;
  const pct = computePct(job);
  $("progress-bar").style.width = `${pct}%`;

  let etaText = "";
  if (typeof job.etaSeconds === "number") {
    const elapsed = (Date.now() - (job.stageStartedAt || job.updatedAt)) / 1000;
    const remain = job.etaSeconds - elapsed;
    etaText = remain > 3 ? ` · 남은 시간 ${fmtEta(remain)}` : " · 곧 완료됩니다";
  }
  $("progress-label").textContent = `${Math.round(pct)}%${etaText}`;
}
setInterval(updateProgressUI, 500);

function showProgress(visible) {
  $("progress-wrap").style.display = visible ? "block" : "none";
  $("progress-label").style.display = visible ? "block" : "none";
}

function renderJob(job) {
  currentJob = job;
  if (!job) return;
  const suffix = job.title ? `\n🎬 ${job.title}` : "";
  if (job.state === "running") {
    $("run").disabled = true;
    showProgress(true);
    updateProgressUI();
    setStatus(
      `⏳ ${job.detail}${suffix}\n(팝업이나 창을 닫아도 백그라운드에서 계속 진행됩니다)`
    );
  } else if (job.state === "done") {
    $("run").disabled = false;
    showProgress(true);
    $("progress-bar").style.width = "100%";
    $("progress-label").textContent = "100%";
    setStatus(
      `✅ 저장 완료: ${job.result.savedTo}${job.result.analyzed ? "\n(Claude 분석 포함)" : ""}${suffix}`,
      "success"
    );
  } else if (job.state === "error") {
    $("run").disabled = false;
    showProgress(false);
    setStatus(`❌ ${job.error}`, "error");
  }
}

// 백그라운드가 갱신하는 진행 상태를 실시간 반영
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastJob) renderJob(changes.lastJob.newValue);
});

async function run() {
  const found = await getActiveYouTubeTab();
  if (!found) {
    setStatus("YouTube 영상 페이지에서 실행하세요.", "error");
    return;
  }

  const doAnalysis = $("do-analysis").checked;
  const useWhisper = $("use-whisper").checked;
  await chrome.storage.local.set({ useWhisper });

  // 시작 신호만 보낸다 — 이후는 백그라운드가 알아서 진행.
  chrome.runtime
    .sendMessage({
      type: "startPipeline",
      payload: { tabId: found.tab.id, videoId: found.videoId, doAnalysis, useWhisper },
    })
    .catch(() => {});

  $("run").disabled = true;
  showProgress(true);
  setStatus("⏳ 시작 중...\n(팝업이나 창을 닫아도 백그라운드에서 계속 진행됩니다)");
}

async function init() {
  $("run").addEventListener("click", run);
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const { useWhisper, lastJob } = await chrome.storage.local.get({
    useWhisper: false,
    lastJob: null,
  });
  $("use-whisper").checked = useWhisper;

  const found = await getActiveYouTubeTab();
  if (found) {
    $("video-title").textContent = `🎬 ${found.tab.title?.replace(/ - YouTube$/, "") || found.videoId}`;
  } else {
    $("video-title").textContent = "YouTube 영상 페이지가 아닙니다.";
    $("run").disabled = true;
  }

  // 진행 중이거나 최근 완료된 작업 상태를 복원해서 보여준다.
  if (lastJob && (lastJob.state === "running" || Date.now() - lastJob.updatedAt < 120_000)) {
    renderJob(lastJob);
  }
}

init();
