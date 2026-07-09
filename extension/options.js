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

document.getElementById("save").addEventListener("click", save);
load();
