// 옵션 페이지: 설정을 chrome.storage.local에 저장/로드한다.

const DEFAULTS = {
  anthropicApiKey: "",
  model: "claude-opus-4-8",
  obsidianBaseUrl: "http://127.0.0.1:27123",
  obsidianApiKey: "",
  obsidianFolder: "YouTube",
  languages: "ko,en",
  doAnalysis: true,
  serverUrl: "http://127.0.0.1:8765",
  whisperModel: "small",
};

const FIELDS = Object.keys(DEFAULTS);

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el.type === "checkbox") el.checked = Boolean(stored[key]);
    else el.value = stored[key] ?? "";
  }
}

async function save() {
  const values = {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    values[key] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  if (!values.model) values.model = DEFAULTS.model;
  if (!values.obsidianBaseUrl) values.obsidianBaseUrl = DEFAULTS.obsidianBaseUrl;
  if (!values.serverUrl) values.serverUrl = DEFAULTS.serverUrl;

  await chrome.storage.local.set(values);
  const saved = document.getElementById("saved");
  saved.textContent = "✓ 저장됨";
  setTimeout(() => (saved.textContent = ""), 2000);
}

async function installDocs() {
  const status = document.getElementById("docs-status");
  status.textContent = "설치 중...";
  status.style.color = "#6b7280";
  // 설치 전에 현재 입력값을 먼저 저장해 최신 키/폴더를 사용하게 한다.
  await save();
  const resp = await chrome.runtime.sendMessage({ type: "installDocs" }).catch(() => null);
  if (resp?.ok) {
    status.textContent = `✓ ${resp.installed.length}개 노트 설치됨`;
    status.style.color = "#059669";
  } else {
    status.textContent = `✗ ${resp?.error || "설치 실패"}`;
    status.style.color = "#dc2626";
  }
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("install-docs").addEventListener("click", installDocs);
load();
