// YouTube 페이지에서 실행되는 콘텐츠 스크립트.
// 자막 트랙 목록을 찾아 타임스탬프가 포함된 트랜스크립트를 추출한다.
// (같은 도메인이므로 watch 페이지와 자막(timedtext) API를 직접 fetch할 수 있다)

/** 중괄호 짝을 맞춰 HTML에 인라인된 JSON 객체를 잘라낸다. */
function extractBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("페이지에서 플레이어 데이터(JSON)를 파싱하지 못했습니다.");
}

/** watch 페이지 HTML에서 ytInitialPlayerResponse를 가져온다.
 *  SPA 내비게이션으로 페이지의 전역 변수가 오래됐을 수 있어 항상 새로 fetch한다. */
async function fetchPlayerResponse(videoId) {
  const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: "same-origin",
  });
  const html = await resp.text();
  const marker = "ytInitialPlayerResponse = ";
  const idx = html.indexOf(marker);
  if (idx === -1) {
    throw new Error("영상 페이지에서 플레이어 데이터를 찾지 못했습니다.");
  }
  return JSON.parse(extractBalancedJson(html, idx + marker.length));
}

/** 언어 우선순위에 따라 자막 트랙을 고른다. 수동 자막 > 자동 생성(asr) 순. */
function pickCaptionTrack(tracks, languages) {
  for (const lang of languages) {
    const manual = tracks.find((t) => t.languageCode === lang && t.kind !== "asr");
    if (manual) return manual;
  }
  for (const lang of languages) {
    const any = tracks.find((t) => t.languageCode === lang);
    if (any) return any;
  }
  return tracks[0];
}

/** 자막 트랙을 json3 포맷으로 받아 {start, duration, text} 배열로 변환한다. */
async function fetchSegments(track) {
  const url = track.baseUrl + (track.baseUrl.includes("fmt=") ? "" : "&fmt=json3");
  const resp = await fetch(url, { credentials: "same-origin" });
  if (!resp.ok) throw new Error(`자막 다운로드 실패 (HTTP ${resp.status})`);
  const data = await resp.json();

  const segments = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 || "")
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (!text) continue;
    segments.push({
      start: (ev.tStartMs || 0) / 1000,
      duration: (ev.dDurationMs || 0) / 1000,
      text,
    });
  }
  return segments;
}

async function extractTranscript(videoId, languages) {
  const player = await fetchPlayerResponse(videoId);
  const title = player?.videoDetails?.title || videoId;
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (tracks.length === 0) {
    throw new Error(
      "이 영상에는 자막이 없습니다. 자막 없는 영상은 CLI의 Whisper 음성 인식을 사용하세요."
    );
  }

  const track = pickCaptionTrack(tracks, languages);
  const segments = await fetchSegments(track);
  if (segments.length === 0) throw new Error("자막이 비어 있습니다.");

  return {
    videoId,
    title,
    segments,
    language: track.languageCode,
    source: track.kind === "asr" ? "youtube-captions-auto" : "youtube-captions",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "extractTranscript") return false;
  extractTranscript(message.videoId, message.languages || ["ko", "en"])
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // 비동기 응답
});
