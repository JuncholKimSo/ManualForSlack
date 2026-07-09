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

function renderJob(job) {
  if (!job) return;
  const suffix = job.title ? `\n🎬 ${job.title}` : "";
  if (job.state === "running") {
    $("run").disabled = true;
    setStatus(
      `⏳ ${job.detail}${suffix}\n(팝업이나 창을 닫아도 백그라운드에서 계속 진행됩니다)`
    );
  } else if (job.state === "done") {
    $("run").disabled = false;
    setStatus(
      `✅ 저장 완료: ${job.result.savedTo}${job.result.analyzed ? "\n(Claude 분석 포함)" : ""}${suffix}`,
      "success"
    );
  } else if (job.state === "error") {
    $("run").disabled = false;
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
