/* ==========================================================
   精进群工具箱 — 后台管理页
   用 GitHub 细粒度令牌直接更新仓库中的 config.json，
   Pages 重建后全体访客生效。令牌只保存在本浏览器。
   ========================================================== */
"use strict";

const REPO = "happyxueyu/happyxueyu.github.io";
const TOKEN_KEY = "jjq_admin_token";

const tokenInput = document.getElementById("token-input");
const btnToken = document.getElementById("btn-token");
const tokenStatus = document.getElementById("token-status");
const editor = document.getElementById("editor");
const editorLoading = document.getElementById("editor-loading");
const sessionList = document.getElementById("session-list");
const graceInput = document.getElementById("grace-input");
const btnAdd = document.getElementById("btn-add");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

let token = localStorage.getItem(TOKEN_KEY) || "";
let tokenOK = false;
let editing = [];   // 正在编辑的场次

/* ---------- GitHub API ---------- */
async function api(path, opts = {}) {
  const r = await fetch("https://api.github.com" + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).message || ("HTTP " + r.status);
    throw new Error(msg);
  }
  return r.json();
}

function b64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/* ---------- 令牌验证 ---------- */
async function validateToken(showToastOnFail = false) {
  tokenOK = false;
  if (!token) return false;
  try {
    const repo = await api("/repos/" + REPO);
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error("令牌没有本仓库的写入权限，请按帮助步骤重新创建");
    }
    tokenOK = true;
    tokenStatus.textContent = "✓ 令牌有效（可写入仓库）";
    tokenStatus.className = "small ok-text";
    return true;
  } catch (e) {
    tokenStatus.textContent = "✗ " + e.message;
    tokenStatus.className = "small err-text";
    if (showToastOnFail) showToast("令牌验证失败：" + e.message, "error", 4000);
    return false;
  }
}

btnToken.addEventListener("click", async () => {
  token = tokenInput.value.trim();
  if (!token) { showToast("请先粘贴令牌", "error"); return; }
  localStorage.setItem(TOKEN_KEY, token);
  const ok = await validateToken(true);
  if (ok) {
    showToast("令牌验证成功", "ok");
    await loadConfig();
  }
});

/* ---------- 配置加载与编辑 ---------- */
async function loadConfig() {
  editorLoading.hidden = false;
  editor.hidden = true;
  btnSave.disabled = true;
  try {
    const r = await fetch("config.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const cfg = await r.json();
    graceInput.value = cfg.graceMin || 15;
    editing = (cfg.schedule || []).map((s, i) => ({
      id: s.id || ("s" + Date.now() + "_" + i),
      name: s.name || "",
      time: s.time || "08:00",
      videos: (s.videos || []).join("\n"),
    }));
    editorLoading.hidden = true;
    editor.hidden = false;
    btnSave.disabled = false;
    renderEditor();
  } catch {
    editorLoading.textContent = "配置加载失败，请刷新页面重试（网络原因）";
  }
}

function renderEditor() {
  sessionList.innerHTML = "";
  editing.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "session-row";

    const head = document.createElement("div");
    head.className = "session-head";
    const time = document.createElement("input");
    time.type = "time";
    time.value = s.time;
    time.addEventListener("change", () => { s.time = time.value || "08:00"; });
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "场次名称，如：早课 · 视频1";
    name.value = s.name;
    name.addEventListener("input", () => { s.name = name.value; });
    const del = document.createElement("button");
    del.className = "btn btn-danger";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      editing.splice(i, 1);
      renderEditor();
    });
    head.append(time, name, del);

    const vids = document.createElement("textarea");
    vids.rows = 3;
    vids.placeholder = "视频地址，每行一个（站内路径如 test-media/am-1.mp4，或 https 直链）\n多行将按顺序连续播放";
    vids.value = s.videos;
    vids.addEventListener("input", () => { s.videos = vids.value; });

    row.append(head, vids);
    sessionList.appendChild(row);
  });
}

btnAdd.addEventListener("click", () => {
  editing.push({ id: "s" + Date.now(), name: "新场次", time: "12:00", videos: "" });
  renderEditor();
});

/* ---------- 保存 ---------- */
btnSave.addEventListener("click", async () => {
  if (!tokenOK) { showToast("请先验证令牌", "error"); return; }
  const schedule = editing
    .filter((s) => s.videos.trim())
    .map((s) => ({
      id: s.id,
      name: s.name.trim() || "未命名场次",
      time: /^\d{1,2}:\d{2}$/.test(s.time) ? s.time : "08:00",
      videos: s.videos.split(/\n+/).map((v) => v.trim()).filter(Boolean),
    }));
  if (!schedule.length) { showToast("至少要有一场，且填了视频地址", "error"); return; }
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  const cfg = { graceMin: Math.max(1, Number(graceInput.value) || 15), schedule };
  const content = JSON.stringify(cfg, null, 2) + "\n";

  btnSave.disabled = true;
  saveStatus.textContent = "保存中…";
  try {
    const cur = await api(`/repos/${REPO}/contents/config.json`);
    await api(`/repos/${REPO}/contents/config.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "后台更新播放计划：" + schedule.map((s) => s.time + " " + s.name).join("；"),
        content: b64(content),
        sha: cur.sha,
      }),
    });
    saveStatus.textContent = "✓ 已保存，约 1~2 分钟后生效";
    showToast("保存成功，等待 Pages 重建生效", "ok", 4000);
  } catch (e) {
    saveStatus.textContent = "✗ 保存失败：" + e.message;
    showToast("保存失败：" + e.message, "error", 5000);
  } finally {
    btnSave.disabled = false;
  }
});

/* ---------- 启动 ---------- */
if (token) {
  tokenInput.value = token.slice(0, 4) + "…" + token.slice(-4);
  (async () => {
    if (await validateToken(false)) await loadConfig();
  })();
}

/* ---------- Toast ---------- */
function showToast(message, type = "info", duration = 2600) {
  let container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("hide");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);
}
