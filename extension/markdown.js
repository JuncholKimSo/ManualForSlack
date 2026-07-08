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

/** 자막 조각을 window(초) 단위 문단으로 묶는다. */
export function groupSegments(segments, window = 30.0) {
  if (segments.length === 0) return [];

  const grouped = [];
  let currentStart = segments[0].start;
  let currentTexts = [];

  for (const seg of segments) {
    if (seg.start - currentStart >= window && currentTexts.length > 0) {
      grouped.push({
        start: currentStart,
        duration: seg.start - currentStart,
        text: currentTexts.join(" "),
      });
      currentStart = seg.start;
      currentTexts = [];
    }
    currentTexts.push(seg.text.replace(/\n/g, " ").trim());
  }

  const last = segments[segments.length - 1];
  grouped.push({
    start: currentStart,
    duration: last.start + last.duration - currentStart,
    text: currentTexts.join(" "),
  });
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
