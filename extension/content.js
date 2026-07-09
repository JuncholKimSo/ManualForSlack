// YouTube 페이지에서 실행되는 콘텐츠 스크립트.
// 자막 트랙을 찾아 타임스탬프가 포함된 트랜스크립트를 추출한다.
//
// 1차: youtubei/v1/get_transcript (YouTube 웹의 "스크립트 표시" 패널이 쓰는 내부 API)
// 2차: 자막 트랙 timedtext URL (구형 경로 — YouTube가 빈 응답을 줄 수 있어 폴백으로만 사용)

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

/** SPA 내비게이션으로 전역 변수가 오래됐을 수 있어 watch 페이지를 항상 새로 fetch한다. */
async function fetchWatchHtml(videoId) {
  const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: "same-origin",
  });
  return resp.text();
}

function parsePlayerResponse(html) {
  const marker = "ytInitialPlayerResponse = ";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  try {
    return JSON.parse(extractBalancedJson(html, idx + marker.length));
  } catch (_) {
    return null;
  }
}

/** 객체 트리에서 특정 키를 가진 첫 번째 값을 깊이 우선으로 찾는다. */
function findFirstKey(node, key) {
  if (node === null || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) {
    return node[key];
  }
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const found = findFirstKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 1차 경로: YouTube 내부 get_transcript API.
 *  watch 페이지의 ytInitialData에 들어 있는 params를 그대로 사용한다. */
async function fetchViaGetTranscript(html) {
  const paramsMatch = html.match(
    /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/
  );
  if (!paramsMatch) return null; // 트랜스크립트 패널이 없는 영상

  const apiKey = (html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || [])[1];
  const clientVersion =
    (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || [])[1] ||
    "2.20250601.00.00";

  const url =
    "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false" +
    (apiKey ? `&key=${apiKey}` : "");

  const resp = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion } },
      params: paramsMatch[1],
    }),
  });
  if (!resp.ok) throw new Error(`get_transcript 실패 (HTTP ${resp.status})`);

  const data = await resp.json();
  const segList = findFirstKey(data, "transcriptSegmentListRenderer");
  if (!segList?.initialSegments) {
    throw new Error("get_transcript 응답에서 자막 구간을 찾지 못했습니다.");
  }

  const segments = [];
  for (const item of segList.initialSegments) {
    const seg = item.transcriptSegmentRenderer;
    if (!seg) continue; // 섹션 헤더 등은 건너뜀
    const text = (seg.snippet?.runs || [])
      .map((r) => r.text || "")
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (!text) continue;
    const startMs = Number(seg.startMs || 0);
    const endMs = Number(seg.endMs || startMs);
    segments.push({
      start: startMs / 1000,
      duration: Math.max(0, (endMs - startMs) / 1000),
      text,
    });
  }
  return segments.length > 0 ? segments : null;
}

/** 2차 경로(폴백): 자막 트랙 timedtext URL을 json3 포맷으로 요청. */
async function fetchViaTimedtext(tracks, languages) {
  const pick = (pred) => tracks.find(pred);
  let track = null;
  for (const lang of languages) {
    track = pick((t) => t.languageCode === lang && t.kind !== "asr");
    if (track) break;
  }
  if (!track) {
    for (const lang of languages) {
      track = pick((t) => t.languageCode === lang);
      if (track) break;
    }
  }
  track = track || tracks[0];

  const url = track.baseUrl + (track.baseUrl.includes("fmt=") ? "" : "&fmt=json3");
  const resp = await fetch(url, { credentials: "same-origin" });
  if (!resp.ok) throw new Error(`자막 다운로드 실패 (HTTP ${resp.status})`);

  const body = await resp.text();
  if (!body.trim()) {
    throw new Error("YouTube가 빈 자막 응답을 반환했습니다 (토큰 요구 정책).");
  }
  const data = JSON.parse(body);

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
  if (segments.length === 0) throw new Error("자막이 비어 있습니다.");
  return { segments, language: track.languageCode, auto: track.kind === "asr" };
}

async function extractTranscript(videoId, languages) {
  const html = await fetchWatchHtml(videoId);
  const player = parsePlayerResponse(html);
  const title = player?.videoDetails?.title || videoId;
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  // 1차: get_transcript (현재 YouTube에서 가장 안정적인 경로)
  let primaryError = null;
  try {
    const segments = await fetchViaGetTranscript(html);
    if (segments) {
      return {
        videoId,
        title,
        segments,
        language: tracks[0]?.languageCode || "unknown",
        source: "youtube-transcript-panel",
      };
    }
  } catch (e) {
    primaryError = e;
  }

  // 2차: timedtext 폴백
  if (tracks.length > 0) {
    try {
      const { segments, language, auto } = await fetchViaTimedtext(tracks, languages);
      return {
        videoId,
        title,
        segments,
        language,
        source: auto ? "youtube-captions-auto" : "youtube-captions",
      };
    } catch (e) {
      throw new Error(
        `자막 추출에 실패했습니다 (${primaryError?.message || "패널 없음"} / ${e.message}). ` +
          "팝업의 '음성 인식(Whisper) 사용'을 켜고 로컬 서버로 처리해보세요."
      );
    }
  }

  throw new Error(
    "이 영상에는 자막이 없습니다. 팝업의 '음성 인식(Whisper) 사용'을 켜고 " +
      "로컬 서버(yt2obsidian-server)로 처리하세요."
  );
}

// 팝업이 스크립트를 재주입할 수 있으므로 리스너 중복 등록을 막는다.
if (!window.__yt2obsidianLoaded) {
  window.__yt2obsidianLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "extractTranscript") return false;
    extractTranscript(message.videoId, message.languages || ["ko", "en"])
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // 비동기 응답
  });
}
