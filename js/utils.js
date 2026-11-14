/* ==========================================================
   AIGC 工具箱 — 公共工具函数
   ========================================================== */
"use strict";

/** 将秒数格式化为 mm:ss 或 h:mm:ss */
function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return "--:--";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 将字节数格式化为可读字符串 */
function formatBytes(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/** 显示 toast 提示（自动消失） */
function showToast(message, type = "info", duration = 2600) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("hide");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);
}

/**
 * 为拖放区域绑定事件。
 * dropzone: 元素本身；onClick: 点击时的回调；onFiles(files): 拿到 File 数组
 */
function setupDropzone(dropzone, { onClick, onFiles }) {
  let dragDepth = 0;
  dropzone.addEventListener("click", onClick);
  dropzone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragover", (e) => e.preventDefault());
  dropzone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) {
      dragDepth = 0;
      dropzone.classList.remove("dragover");
    }
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });
}

/** 阻止页面级的拖放误操作（避免浏览器直接打开文件） */
function preventPageDragOpen() {
  ["dragover", "drop"].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      if (!e.target.closest(".dropzone, .video-stage")) e.preventDefault();
    })
  );
}

/** 从文件名或 URL 提取展示名称 */
function nameFromFile(file) {
  return file.name || "未知文件";
}
function nameFromUrl(url) {
  try {
    const u = new URL(url, location.href);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || u.hostname);
  } catch {
    return url.slice(0, 60);
  }
}

/** 更新 range 滑杆的填充比例（用于 webkit 轨道渐变） */
function paintRange(rangeEl) {
  const min = Number(rangeEl.min) || 0;
  const max = Number(rangeEl.max) || 100;
  const val = Number(rangeEl.value) || 0;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  rangeEl.style.setProperty("--fill", pct + "%");
}

/** 文件是否是音/视频（按 MIME 或扩展名粗略判断） */
function isMediaFile(file) {
  if (file.type && /^(audio|video)\//.test(file.type)) return true;
  return /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|mp4|webm|mkv|mov|avi|m4v|ogv)$/i.test(file.name);
}

/** 注册 Service Worker（PWA：可安装到手机桌面 + 离线访问） */
(function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  // utils.js 位于 js/ 目录，sw.js 始终在站点根目录
  var swUrl = new URL("../sw.js", document.currentScript.src).href;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register(swUrl).catch(function () {
      /* 注册失败不影响站点正常使用 */
    });
  });
})();
