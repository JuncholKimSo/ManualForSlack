// 팝업: 현재 탭 영상의 파이프라인을 보여주고 단계를 실행한다.
// 서로 다른 영상의 작업은 동시에 진행 가능 — 다른 영상 작업은 하단에 요약 표시.

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

// ---------- 상태 ----------

let currentVideoId = null;
let currentTabId = null;
let jobs = {};
let pipelines = {};

const myJob = () => (currentVideoId ? jobs[currentVideoId] : null);
const myPipeline = () => (currentVideoId ? pipelines[currentVideoId] : null);
const isRunning = () => myJob()?.state === "running";

// ---------- 진행 표시 ----------

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
  const job = myJob();
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

// ---------- 렌더링 ----------

function renderButtons() {
  const running = isRunning();
  const onVideo = Boolean(currentVideoId);
  $("run-extract").disabled = !onVideo || running;
  $("run-whisper").disabled = !onVideo || running;
  $("run-polish").disabled = !onVideo || running || !myPipeline();
  $("run-analyze").disabled = !onVideo || running || !myPipeline();
  $("stop").style.display = running ? "block" : "none";
}

function renderPipeline() {
  const el = $("pipeline-state");
  const p = myPipeline();
  if (!p) {
    el.textContent = "";
    return;
  }
  const mark = (done) => (done ? "✅" : "▫️");
  el.textContent =
    `${mark(true)} 추출 (${p.segments.length}문단, ${p.source})  ` +
    `${mark(p.polished)} 교정  ${mark(Boolean(p.analysis))} 분석`;
}

function renderOtherJobs() {
  const el = $("other-jobs");
  const others = Object.values(jobs).filter(
    (j) => j.state === "running" && j.videoId !== currentVideoId
  );
  if (others.length === 0) {
    el.textContent = "";
    return;
  }
  el.textContent = others
    .map((j) => `🔄 ${j.title || j.videoId} — ${j.stepLabel || ""} ${j.detail || ""}`)
    .join("\n");
}

function renderJobStatus() {
  const job = myJob();
  renderButtons();
  renderOtherJobs();

  if (!job) {
    showProgress(false);
    return;
  }
  // 오래된 완료/오류 상태는 팝업을 어지럽히지 않게 5분까지만 보여준다
  if (job.state !== "running" && Date.now() - job.updatedAt > 300_000) {
    showProgress(false);
    setStatus("");
    return;
  }

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
  if (changes.jobs) jobs = changes.jobs.newValue || {};
  if (changes.pipelines) pipelines = changes.pipelines.newValue || {};
  renderPipeline();
  renderJobStatus();
});

// ---------- 실행 ----------

function startStep(step) {
  if (!currentVideoId) {
    setStatus("YouTube 영상 페이지에서 실행하세요.", "error");
    return;
  }
  chrome.runtime
    .sendMessage({
      type: "runStep",
      step,
      payload: { tabId: currentTabId, videoId: currentVideoId },
    })
    .catch(() => {});
  showProgress(true);
  setStatus("⏳ 시작 중...\n(팝업이나 창을 닫아도 백그라운드에서 계속 진행됩니다)");
}

async function init() {
  $("run-extract").addEventListener("click", () => startStep("extract"));
  $("run-whisper").addEventListener("click", () => startStep("whisper"));
  $("run-polish").addEventListener("click", () => startStep("polish"));
  $("run-analyze").addEventListener("click", () => startStep("analyze"));
  $("stop").addEventListener("click", () => {
    chrome.runtime
      .sendMessage({ type: "cancelPipeline", videoId: currentVideoId })
      .catch(() => {});
    setStatus("⏹ 중지 요청 중...");
  });
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const stored = await chrome.storage.local.get({ jobs: {}, pipelines: {} });
  jobs = stored.jobs;
  pipelines = stored.pipelines;

  const found = await getActiveYouTubeTab();
  if (found) {
    currentVideoId = found.videoId;
    currentTabId = found.tab.id;
    $("video-title").textContent = `🎬 ${found.tab.title?.replace(/ - YouTube$/, "") || found.videoId}`;
  } else {
    $("video-title").textContent = "YouTube 영상 페이지가 아닙니다.";
  }

  renderPipeline();
  renderJobStatus();
}

init();
