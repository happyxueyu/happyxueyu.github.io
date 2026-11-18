/* ==========================================================
   精进群工具箱测试 — 定时视频播放
   ------------------------------------------------------------
   修改播放计划：直接编辑下方 SCHEDULE（时间用 24 小时制）
   视频可以是站内文件（如 test-media/xxx.mp4）或 https 链接
   ========================================================== */
"use strict";

/* ---------- 播放计划（可按需修改） ---------- */
const SCHEDULE = [
  { id: "am", name: "早课 · 视频1", time: "05:30", video: "test-media/demo-video.mp4" },
  { id: "pm", name: "晚课 · 视频2", time: "20:00", video: "test-media/demo-video.mp4" },
];
/* 开播后的宽限期（分钟）：在此时长内打开页面也会补播 */
const GRACE_MIN = 15;

/* ---------- 元素 ---------- */
const video = document.getElementById("video");
const standby = document.getElementById("standby");
const clockEl = document.getElementById("clock");
const dateEl = document.getElementById("date-line");
const countdownEl = document.getElementById("countdown");
const soundBtn = document.getElementById("sound-btn");
const unmuteBtn = document.getElementById("unmute-btn");
const wakeHint = document.getElementById("wake-hint");

/* ---------- 状态 ---------- */
let playing = false;
let audioUnlocked = false;
let wakeLock = null;

/* 预加载第一段视频（也用于声音解锁） */
video.src = SCHEDULE[0].video;
video.muted = false;

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
  if (video.src !== new URL(slot.video, location.href).href) {
    video.src = slot.video;
  }
  video.currentTime = 0;
  standby.classList.add("hidden");
  try {
    await video.play();
  } catch {
    /* 浏览器阻止了有声自动播放 → 静音播放并给出开启按钮 */
    video.muted = true;
    unmuteBtn.hidden = false;
    try { await video.play(); } catch { showToast("视频无法自动播放，请刷新页面并点击开启声音", "error", 5000); }
  }
}

video.addEventListener("ended", () => {
  /* 播放一遍即停 */
  playing = false;
  video.pause();
  video.currentTime = 0;
  video.muted = false;
  unmuteBtn.hidden = true;
  standby.classList.remove("hidden");
  showToast("本场播放已结束", "ok");
  updateUI();
});

/* 禁止一切手动控制入口 */
video.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- 声音解锁（到点有声自动播放的前提） ---------- */
soundBtn.addEventListener("click", async () => {
  if (playing) return; /* 恰逢定时播放开始时不再干预 */
  try {
    /* 借用户手势在同一元素上播放并立即暂停，解锁后续程序化播放 */
    await video.play();
    video.pause();
    video.currentTime = 0;
    audioUnlocked = true;
    soundBtn.textContent = "✓ 声音已就绪，等待定时播放";
    soundBtn.disabled = true;
    requestWakeLock();
  } catch {
    showToast("浏览器仍限制自动播放，请再点一次", "error");
  }
});

unmuteBtn.addEventListener("click", () => {
  video.muted = false;
  unmuteBtn.hidden = true;
});

/* ---------- 屏幕常亮（防止到点时设备已休眠） ---------- */
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audioUnlocked && !wakeLock) requestWakeLock();
});

/* ---------- 界面刷新 ---------- */
function setSlotState(slot, text) {
  const el = document.getElementById(`slot-${slot.id}`);
  if (el) el.querySelector(".slot-state").textContent = text;
}

function updateUI() {
  const now = new Date();
  clockEl.textContent = now.toTimeString().slice(0, 8);
  dateEl.textContent = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()]
    + ` · ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;

  const t = now.getTime();
  let next = null;      // 下一个未播且未过期的场次
  for (const slot of SCHEDULE) {
    const start = slotDate(slot).getTime();
    if (isPlayed(slot)) { setSlotState(slot, "已播放"); continue; }
    if (t < start) {
      setSlotState(slot, "待播放");
      if (!next || start < slotDate(next).getTime()) next = slot;
    } else if (t <= start + GRACE_MIN * 60000) {
      setSlotState(slot, playing ? "播放中" : "即将播放");
    } else {
      setSlotState(slot, "已错过");
    }
  }
  /* 今天都播完/错过 → 倒计时指向明天第一场 */
  if (!next) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    next = SCHEDULE[0];
    for (const slot of SCHEDULE) {
      if (slotDate(slot, tomorrow) < slotDate(next, tomorrow)) next = slot;
    }
    const ms = slotDate(next, tomorrow).getTime() - t;
    countdownEl.textContent = `明天 ${next.time} ${next.name}，还有 ${formatSpan(ms)}`;
  } else {
    const ms = slotDate(next).getTime() - t;
    countdownEl.textContent = `下一场 ${next.time} ${next.name}，还有 ${formatSpan(ms)}`;
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
