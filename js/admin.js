/* ==========================================================
   精进群工具箱 — 后台管理页（免密版）
   打开即编辑；保存到仓库需要 GitHub 写凭证，来源（按优先级）：
   1. EMBEDDED_TOKEN_B64（预嵌入，全员免设置）
   2. 本浏览器 localStorage（首次设置时粘贴一次，仅本设备）
   ========================================================== */
"use strict";

const REPO = "happyxueyu/happyxueyu.github.io";
const TOKEN_KEY = "jjq_admin_token";

/* 预嵌入凭证位（base64 的细粒度令牌，留空表示未嵌入） */
const EMBEDDED_TOKEN_B64 = "";

/* ---------- 元素 ---------- */
const tokenCard = document.getElementById("token-card");
const tokenInput = document.getElementById("token-input");
const btnToken = document.getElementById("btn-token");
const tokenStatus = document.getElementById("token-status");
const editorCard = document.getElementById("editor-card");
const sessionList = document.getElementById("session-list");
const graceInput = document.getElementById("grace-input");
const btnAdd = document.getElementById("btn-add");
const saveCard = document.getElementById("save-card");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

let token = "";
let tokenOK = false;
let editing = [];

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

/* ---------- 启动：确定凭证并加载 ---------- */
async function boot() {
  const embedded = EMBEDDED_TOKEN_B64 ? atob(EMBEDDED_TOKEN_B64) : "";
  token = embedded || localStorage.getItem(TOKEN_KEY) || "";
  if (token) {
    tokenCard.hidden = true;
    await validateAndLoad();
  } else {
    tokenCard.hidden = false;
    saveCard.hidden = false;
    btnSave.disabled = true;
    tokenStatus.textContent = "尚未绑定凭证（每台设备只需一次）";
  }
}

async function validateAndLoad() {
  try {
    const repo = await api("/repos/" + REPO);
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error("凭证没有本仓库写入权限，请重新绑定");
    }
    tokenOK = true;
    tokenCard.hidden = true;
  } catch (e) {
    tokenOK = false;
    tokenCard.hidden = false;
    tokenStatus.textContent = "✗ " + e.message;
    tokenStatus.className = "small err-text";
    btnSave.disabled = true;
    return;
  }
  await loadConfig();
}

btnToken.addEventListener("click", async () => {
  token = tokenInput.value.trim();
  if (!token) { showToast("请先粘贴令牌", "error"); return; }
  localStorage.setItem(TOKEN_KEY, token);
  await validateAndLoad();
  if (tokenOK) showToast("绑定成功，以后打开直接编辑", "ok");
});

/* ---------- 配置加载与编辑 ---------- */
async function loadConfig() {
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
    editorCard.hidden = false;
    saveCard.hidden = false;
    btnSave.disabled = false;
    renderEditor();
  } catch {
    showToast("配置加载失败，请刷新重试", "error");
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
  if (!tokenOK) { showToast("凭证不可用，请先绑定", "error"); return; }
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
        content: btoa(unescape(encodeURIComponent(content))),
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

boot();

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
