/* ==========================================================
   精进群工具箱测试 — 定时视频播放（无操作、全自动）
   ------------------------------------------------------------
   修改播放计划：直接编辑下方 SCHEDULE（时间用 24 小时制）
   video / poster 可以是站内文件路径或 https 链接
   ========================================================== */
"use strict";

/* ---------- 播放计划（可按需修改） ---------- */
const SCHEDULE = [
  { id: "am", name: "早课 · 视频1", time: "05:30", video: "test-media/demo-video.mp4", poster: "test-media/poster-am.jpg" },
  { id: "pm", name: "晚课 · 视频2", time: "20:00", video: "test-media/demo-video.mp4", poster: "test-media/poster-pm.jpg" },
];
/* 开播后的宽限期（分钟）：在此时长内打开页面也会补播 */
const GRACE_MIN = 15;

/* ---------- 元素 ---------- */
const video = document.getElementById("video");
const clockEl = document.getElementById("clock");
const dateEl = document.getElementById("date-line");
const countdownEl = document.getElementById("countdown");
const playerState = document.getElementById("player-state");
const unmuteBtn = document.getElementById("unmute-btn");
const wakeHint = document.getElementById("wake-hint");

/* ---------- 状态 ---------- */
let playing = false;
let wakeLock = null;

/* ---------- 时间工具 ---------- */
function slotDate(slot, day) {
  const [h, m] = slot.time.split(":").map(Number);
  const d = day instanceof Date ? day : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
}
function dayKey(day) {
  const d = day instanceof Date ? day : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function playedKey(slot) { return `jjq_played_${slot.id}_${dayKey()}`; }
function isPlayed(slot) { try { return localStorage.getItem(playedKey(slot)) === "1"; } catch { return false; } }
function markPlayed(slot) { try { localStorage.setItem(playedKey(slot), "1"); } catch { /* 隐私模式下忽略 */ } }

/* ---------- 定时检查 ---------- */
function checkSchedule() {
  if (playing) return;
  const now = Date.now();
  for (const slot of SCHEDULE) {
    const start = slotDate(slot).getTime();
    const end = start + GRACE_MIN * 60 * 1000;
    if (now >= start && now <= end && !isPlayed(slot)) {
      startPlay(slot);
      return;
    }
  }
}

async function startPlay(slot) {
  playing = true;
  markPlayed(slot);
  setSlotState(slot, "播放中");
  playerState.textContent = "播放中";
  playerState.classList.add("playing");
  video.removeAttribute("poster");
  if (video.src !== new URL(slot.video, location.href).href) {
    video.src = slot.video;
  }
  video.currentTime = 0;
  try {
    await video.play(); /* 直接尝试有声播放 */
  } catch {
    /* 浏览器安全策略拦截有声自动播放 → 静音自动播，给出可选的声音开关 */
    video.muted = true;
    unmuteBtn.hidden = false;
    try { await video.play(); } catch { showToast("视频无法自动播放，请刷新页面重试", "error", 5000); }
  }
}

video.addEventListener("ended", () => {
  /* 播放一遍即停 */
  playing = false;
  video.pause();
  video.currentTime = 0;
  video.muted = false;
  unmuteBtn.hidden = true;
  playerState.classList.remove("playing");
  playerState.textContent = "待机";
  showToast("本场播放已结束", "ok");
  updateUI();
});

/* 禁止手动控制入口 */
video.addEventListener("contextmenu", (e) => e.preventDefault());

unmuteBtn.addEventListener("click", () => {
  video.muted = false;
  unmuteBtn.hidden = true;
});

/* ---------- 屏幕常亮（无需点击，加载即申请） ---------- */
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
      wakeHint.textContent = "已开启屏幕常亮";
    } else {
      wakeHint.textContent = "当前浏览器不支持屏幕常亮，建议手动设置设备不休眠";
    }
  } catch {
    wakeHint.textContent = "屏幕常亮开启失败，建议手动设置设备不休眠";
  }
}
requestWakeLock();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !wakeLock) requestWakeLock();
});

/* ---------- 界面刷新 ---------- */
function setSlotState(slot, text) {
  const el = document.getElementById(`slot-${slot.id}`);
  if (el) el.querySelector(".slot-state").textContent = text;
}

function nextSlotInfo() {
  /* 返回 { slot, date }：今天下一个未播场次；都播完则取明天第一场 */
  const now = new Date();
  const t = now.getTime();
  let best = null;
  for (const slot of SCHEDULE) {
    if (isPlayed(slot)) continue;
    const start = slotDate(slot).getTime();
    if (t < start && (!best || start < slotDate(best).getTime())) best = slot;
  }
  if (best) return { slot: best, date: now };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  best = SCHEDULE[0];
  for (const slot of SCHEDULE) {
    if (slotDate(slot, tomorrow) < slotDate(best, tomorrow)) best = slot;
  }
  return { slot: best, date: tomorrow };
}

function updateUI() {
  const now = new Date();
  clockEl.textContent = now.toTimeString().slice(0, 8);
  dateEl.textContent = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()]
    + ` · ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;

  const t = now.getTime();
  for (const slot of SCHEDULE) {
    const start = slotDate(slot).getTime();
    if (isPlayed(slot)) { setSlotState(slot, "已播放"); continue; }
    if (t < start) setSlotState(slot, "待播放");
    else if (t <= start + GRACE_MIN * 60000) setSlotState(slot, playing ? "播放中" : "即将播放");
    else setSlotState(slot, "已错过");
  }

  const next = nextSlotInfo();
  const isTomorrow = next.date !== now && next.date.toDateString() !== now.toDateString();
  const ms = slotDate(next.slot, next.date).getTime() - t;
  countdownEl.textContent = (isTomorrow ? `明天 ${next.slot.time} ` : `下一场 ${next.slot.time} `)
    + `${next.slot.name}，还有 ${formatSpan(ms)}`;

  /* 待机时：播放器显示下一场的封面图，并预载下一场的视频（到点秒开） */
  if (!playing) {
    if (video.poster !== new URL(next.slot.poster, location.href).href) {
      video.poster = next.slot.poster;
    }
    if (video.src !== new URL(next.slot.video, location.href).href) {
      video.src = next.slot.video;
    }
  }
}

function formatSpan(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h} 小时 ${m} 分 ${sec} 秒`;
  if (m > 0) return `${m} 分 ${sec} 秒`;
  return `${sec} 秒`;
}

/* ---------- 主循环 ---------- */
function tick() {
  if (!playing) checkSchedule();
  updateUI();
}
tick();
setInterval(tick, 1000);

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

/* ---------- Service Worker（PWA 离线） ---------- */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
