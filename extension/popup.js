// 팝업: 활성 탭의 YouTube 영상을 확인하고 파이프라인을 실행한다.
// - 기본 경로: 브라우저에서 자막 추출 → 백그라운드에서 Claude 분석/저장
// - Whisper 경로: 로컬 서버(yt2obsidian-server)에 작업을 맡기고 진행 상태를 폴링

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 백그라운드가 보내는 진행 상태 표시
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "status") setStatus(message.status);
});

/** 기본 경로: 브라우저 자막 추출 → 백그라운드 처리 */
async function runViaBrowser(found, doAnalysis) {
  const { languages } = await chrome.storage.local.get({ languages: "ko,en" });

  setStatus("자막 추출 중...");
  const extracted = await chrome.tabs.sendMessage(found.tab.id, {
    type: "extractTranscript",
    videoId: found.videoId,
    languages: languages.split(",").map((s) => s.trim()).filter(Boolean),
  });
  if (!extracted?.ok) throw new Error(extracted?.error || "자막 추출 실패");

  const payload = { ...extracted.result, doAnalysis };
  setStatus(`자막 ${payload.segments.length}개 구간 추출 완료. 처리 중...`);

  const processed = await chrome.runtime.sendMessage({ type: "processVideo", payload });
  if (!processed?.ok) throw new Error(processed?.error || "처리 실패");
  return processed.result;
}

/** Whisper 경로: 로컬 서버에 작업을 맡기고 완료까지 폴링 */
async function runViaServer(found, doAnalysis) {
  const { serverUrl } = await chrome.storage.local.get({
    serverUrl: "http://127.0.0.1:8765",
  });
  const base = serverUrl.replace(/\/+$/, "");

  setStatus("로컬 서버에 작업 요청 중...");
  let resp;
  try {
    resp = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${found.videoId}`,
        use_whisper: true,
        do_analysis: doAnalysis,
      }),
    });
  } catch (_) {
    throw new Error(
      "로컬 서버에 연결할 수 없습니다. 터미널에서 yt2obsidian-server 가 실행 중인지 확인하세요."
    );
  }
  if (!resp.ok) throw new Error(`서버 오류 (HTTP ${resp.status})`);
  const { job_id } = await resp.json();

  // 팝업을 닫아도 서버는 계속 처리하고 Vault에 저장한다.
  while (true) {
    await sleep(2000);
    const job = await (await fetch(`${base}/jobs/${job_id}`)).json();
    if (job.status === "done") {
      return { savedTo: job.result.saved_to, analyzed: job.result.analyzed };
    }
    if (job.status === "error") throw new Error(job.error);
    setStatus(`${job.detail || "처리 중..."}\n(팝업을 닫아도 서버에서 계속 처리됩니다)`);
  }
}

async function run() {
  const found = await getActiveYouTubeTab();
  if (!found) {
    setStatus("YouTube 영상 페이지에서 실행하세요.", "error");
    return;
  }

  const button = $("run");
  button.disabled = true;
  const doAnalysis = $("do-analysis").checked;
  const useWhisper = $("use-whisper").checked;
  await chrome.storage.local.set({ useWhisper });

  try {
    const result = useWhisper
      ? await runViaServer(found, doAnalysis)
      : await runViaBrowser(found, doAnalysis);
    setStatus(
      `✅ 저장 완료: ${result.savedTo}${result.analyzed ? "\n(Claude 분석 포함)" : ""}`,
      "success"
    );
  } catch (e) {
    setStatus(`❌ ${e.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function init() {
  $("run").addEventListener("click", run);
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const { useWhisper } = await chrome.storage.local.get({ useWhisper: false });
  $("use-whisper").checked = useWhisper;

  const found = await getActiveYouTubeTab();
  if (found) {
    $("video-title").textContent = `🎬 ${found.tab.title?.replace(/ - YouTube$/, "") || found.videoId}`;
  } else {
    $("video-title").textContent = "YouTube 영상 페이지가 아닙니다.";
    $("run").disabled = true;
  }
}

init();
