// 트랜스크립트 → Obsidian Markdown 노트 변환 (Python markdown_builder.py와 동일 로직)

export function formatTimestamp(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function timestampLink(videoId, seconds) {
  const label = formatTimestamp(seconds);
  const url = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`;
  return `[${label}](${url})`;
}

/** 자동 자막의 화자 전환 표시(">>")를 제거하고, 전환 지점 정보를 남긴다. */
export function splitSpeakerTurns(segments) {
  const out = [];
  for (const seg of segments) {
    const raw = seg.text.replace(/\n/g, " ");
    const startsWithMarker = /^\s*>>/.test(raw);
    const parts = raw.split(/\s*>>\s*/).filter((p) => p.trim());
    parts.forEach((part, i) => {
      out.push({
        start: seg.start,
        duration: seg.duration,
        text: part.trim(),
        newSpeaker: i > 0 || (i === 0 && startsWithMarker),
      });
    });
  }
  return out;
}

/** 자막 조각을 window(초) 단위 문단으로 묶는다.
 *  화자가 바뀌는 것으로 추정되는 지점(">>")에서는 시간과 무관하게 새 문단. */
export function groupSegments(segments, window = 20.0) {
  const turns = splitSpeakerTurns(segments);
  if (turns.length === 0) return [];

  const grouped = [];
  let currentStart = turns[0].start;
  let currentTexts = [];

  const flush = (nextStart) => {
    if (currentTexts.length === 0) return;
    grouped.push({
      start: currentStart,
      duration: nextStart - currentStart,
      text: currentTexts.join(" "),
    });
    currentTexts = [];
  };

  for (const seg of turns) {
    if (
      currentTexts.length > 0 &&
      (seg.newSpeaker || seg.start - currentStart >= window)
    ) {
      flush(seg.start);
      currentStart = seg.start;
    }
    currentTexts.push(seg.text);
  }

  const last = turns[turns.length - 1];
  flush(last.start + last.duration);
  return grouped;
}

export function sanitizeFilename(title, maxLength = 120) {
  const name = title
    .replace(/[\\/:*?"<>|#^\[\]]/g, "")
    .trim()
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ");
  return name.slice(0, maxLength) || "untitled";
}

export function buildNote({ videoId, title, url, segments, language, source, analysis }) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `title: "${title.replace(/"/g, "'")}"`,
    `url: ${url}`,
    `video_id: ${videoId}`,
    `date: ${today}`,
    `language: ${language}`,
    `transcript_source: ${source}`,
    "tags:",
    "  - youtube",
    "  - transcript",
    "---",
    "",
    `# ${title}`,
    "",
    `> 🎬 원본 영상: ${url}`,
    "",
  ];

  if (analysis) {
    lines.push("## 🤖 Claude 분석", "", analysis.trim(), "", "---", "");
  }

  lines.push("## 📝 트랜스크립트", "");
  for (const seg of groupSegments(segments)) {
    lines.push(`**${timestampLink(videoId, seg.start)}** ${seg.text}`, "");
  }

  return lines.join("\n");
}
