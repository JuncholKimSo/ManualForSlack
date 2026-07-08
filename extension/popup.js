// 팝업: 활성 탭의 YouTube 영상을 확인하고 파이프라인을 실행한다.

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

// 백그라운드가 보내는 진행 상태 표시
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "status") setStatus(message.status);
});

async function run() {
  const found = await getActiveYouTubeTab();
  if (!found) {
    setStatus("YouTube 영상 페이지에서 실행하세요.", "error");
    return;
  }

  const button = $("run");
  button.disabled = true;

  try {
    const { languages } = await chrome.storage.local.get({ languages: "ko,en" });

    setStatus("자막 추출 중...");
    const extracted = await chrome.tabs.sendMessage(found.tab.id, {
      type: "extractTranscript",
      videoId: found.videoId,
      languages: languages.split(",").map((s) => s.trim()).filter(Boolean),
    });
    if (!extracted?.ok) throw new Error(extracted?.error || "자막 추출 실패");

    const payload = { ...extracted.result, doAnalysis: $("do-analysis").checked };
    setStatus(`자막 ${payload.segments.length}개 구간 추출 완료. 처리 중...`);

    const processed = await chrome.runtime.sendMessage({ type: "processVideo", payload });
    if (!processed?.ok) throw new Error(processed?.error || "처리 실패");

    const { savedTo, analyzed } = processed.result;
    setStatus(
      `✅ 저장 완료: ${savedTo}${analyzed ? "\n(Claude 분석 포함)" : ""}`,
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

  const found = await getActiveYouTubeTab();
  if (found) {
    $("video-title").textContent = `🎬 ${found.tab.title?.replace(/ - YouTube$/, "") || found.videoId}`;
  } else {
    $("video-title").textContent = "YouTube 영상 페이지가 아닙니다.";
    $("run").disabled = true;
  }
}

init();
