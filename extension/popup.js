// 팝업: 단계 선택형 실행 UI.
//   ① 추출(자막/Whisper) → ② 자막 교정(선택) → ③ Claude 분석(선택)
// 각 단계는 백그라운드가 수행하며 같은 노트를 갱신한다.
// 팝업/창을 닫아도 진행되고, 다시 열면 상태가 복원된다.

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

// ---------- 진행 표시 ----------

let currentJob = null;
let currentPipeline = null;
let running = false;

function fmtEta(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 90) return `약 ${Math.round(s / 60)}분`;
  if (s >= 60) return `약 1분 ${s - 60}초`;
  return `약 ${s}초`;
}

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

// ---------- 상태 렌더링 ----------

function renderButtons() {
  const hasPipeline = Boolean(currentPipeline);
  $("run-extract").disabled = running;
  $("run-whisper").disabled = running;
  $("run-polish").disabled = running || !hasPipeline;
  $("run-analyze").disabled = running || !hasPipeline;
  $("stop").style.display = running ? "block" : "none";
}

function renderPipeline() {
  const el = $("pipeline-state");
  if (!currentPipeline) {
    el.textContent = "";
    return;
  }
  const p = currentPipeline;
  const mark = (done) => (done ? "✅" : "▫️");
  el.textContent =
    `📄 ${p.title}\n` +
    `${mark(true)} 추출 (${p.segments.length}문단, ${p.source})  ` +
    `${mark(p.polished)} 교정  ${mark(Boolean(p.analysis))} 분석`;
}

function renderJob(job) {
  currentJob = job;
  if (!job) return;
  running = job.state === "running";
  renderButtons();

  const label = job.stepLabel ? `[${job.stepLabel}] ` : "";
  if (job.state === "running") {
    showProgress(true);
    updateProgressUI();
    setStatus(`⏳ ${label}${job.detail}\n(팝업이나 창을 닫아도 백그라운드에서 계속 진행됩니다)`);
  } else if (job.state === "done") {
    showProgress(true);
    $("progress-bar").style.width = "100%";
    $("progress-label").textContent = "100%";
    setStatus(`✅ ${label}완료 — 저장됨: ${job.result?.savedTo || ""}`, "success");
  } else if (job.state === "cancelled") {
    showProgress(false);
    setStatus("⏹ 작업을 중지했습니다.");
  } else if (job.state === "error") {
    showProgress(false);
    setStatus(`❌ ${job.error}`, "error");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lastJob) renderJob(changes.lastJob.newValue);
  if (changes.pipeline) {
    currentPipeline = changes.pipeline.newValue;
    renderPipeline();
    renderButtons();
  }
});

// ---------- 실행 ----------

async function startStep(step) {
  let payload = {};
  if (step === "extract" || step === "whisper") {
    const found = await getActiveYouTubeTab();
    if (!found) {
      setStatus("YouTube 영상 페이지에서 실행하세요.", "error");
      return;
    }
    payload = { tabId: found.tab.id, videoId: found.videoId };
  }

  chrome.runtime.sendMessage({ type: "runStep", step, payload }).catch(() => {});
  running = true;
  renderButtons();
  showProgress(true);
  setStatus("⏳ 시작 중...\n(팝업이나 창을 닫아도 백그라운드에서 계속 진행됩니다)");
}

async function init() {
  $("run-extract").addEventListener("click", () => startStep("extract"));
  $("run-whisper").addEventListener("click", () => startStep("whisper"));
  $("run-polish").addEventListener("click", () => startStep("polish"));
  $("run-analyze").addEventListener("click", () => startStep("analyze"));
  $("stop").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "cancelPipeline" }).catch(() => {});
    setStatus("⏹ 중지 요청 중...");
  });
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const { lastJob, pipeline } = await chrome.storage.local.get({
    lastJob: null,
    pipeline: null,
  });
  currentPipeline = pipeline;
  renderPipeline();

  const found = await getActiveYouTubeTab();
  if (found) {
    $("video-title").textContent = `🎬 ${found.tab.title?.replace(/ - YouTube$/, "") || found.videoId}`;
  } else {
    $("video-title").textContent = "YouTube 영상 페이지가 아닙니다.";
  }

  // 진행 중이거나 최근 작업 상태 복원
  if (lastJob && (lastJob.state === "running" || Date.now() - lastJob.updatedAt < 300_000)) {
    renderJob(lastJob);
  } else {
    renderButtons();
  }
}

init();
