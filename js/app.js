/* ==========================================================
   精进群工具箱测试 — 定时视频播放（无操作、全自动）
   ------------------------------------------------------------
   修改播放计划：直接编辑下方 SCHEDULE（时间用 24 小时制）
   video 可以是站内文件路径或 https 链接
   ========================================================== */
"use strict";

/* ---------- 播放计划（可按需修改） ----------
   videos 是按顺序连续播放的分段列表（分段用于控制单文件体积），
   全部播完视为本场结束 */
const SCHEDULE = [
  { id: "am", name: "早课 · 视频1", time: "05:30", videos: ["test-media/am-1.mp4", "test-media/am-2.mp4"] },
  { id: "pm", name: "晚课 · 视频2", time: "20:00", videos: ["test-media/pm-1.mp4", "test-media/pm-2.mp4", "test-media/pm-3.mp4"] },
];
/* 开播后的宽限期（分钟）：在此时长内打开页面也会补播 */
const GRACE_MIN = 15;

/* ---------- 元素 ---------- */
const video = document.getElementById("video");
const playerWrap = document.getElementById("player-wrap");
const clockEl = document.getElementById("clock");
const dateEl = document.getElementById("date-line");
const countdownEl = document.getElementById("countdown");
const playerState = document.getElementById("player-state");
const sbLabel = document.getElementById("sb-label");
const sbName = document.getElementById("sb-name");
const sbTime = document.getElementById("sb-time");
const sbCountdown = document.getElementById("sb-countdown");
const unmuteBtn = document.getElementById("unmute-btn");
const wakeHint = document.getElementById("wake-hint");
const vbPlay = document.getElementById("vb-play");
const vbPause = document.getElementById("vb-pause");
const vbFill = document.getElementById("vb-fill");
const vbTime = document.getElementById("vb-time");

/* ---------- 状态 ---------- */
let playing = false;
let wakeLock = null;
let queue = [];        // 当前场次的分段播放列表
let queueIndex = 0;    // 正在播放第几段

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
  playerState.classList.add("playing");
  playerWrap.classList.add("playing");
  queue = slot.videos.slice();
  queueIndex = 0;
  await playCurrentPart();
}

async function playCurrentPart() {
  playerState.textContent = queue.length > 1 ? `播放中 ${queueIndex + 1}/${queue.length}` : "播放中";
  video.src = queue[queueIndex];
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
  if (playing && queueIndex < queue.length - 1) {
    /* 还有下一段：无缝接播 */
    queueIndex += 1;
    playCurrentPart();
    return;
  }
  /* 全部段落播完 → 本场结束，一遍即停 */
  playing = false;
  video.pause();
  video.currentTime = 0;
  video.muted = false;
  unmuteBtn.hidden = true;
  playerWrap.classList.remove("playing");
  playerState.classList.remove("playing");
  playerState.textContent = "待机";
  showToast("本场播放已结束", "ok");
  updateUI();
});

/* 禁止手动控制入口 */
video.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- 播放器外观栏（进度条与时间，纯展示） ---------- */
function fmtShort(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  s = Math.floor(s);
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function updateVbarIcon(isPlaying) {
  vbPlay.style.display = isPlaying ? "none" : "";
  vbPause.style.display = isPlaying ? "" : "none";
}
video.addEventListener("play", () => updateVbarIcon(true));
video.addEventListener("pause", () => updateVbarIcon(false));
video.addEventListener("timeupdate", () => {
  if (!isFinite(video.duration) || !video.duration) return;
  vbFill.style.width = `${(video.currentTime / video.duration) * 100}%`;
  vbTime.textContent = `${fmtShort(video.currentTime)} / ${fmtShort(video.duration)}`;
});
video.addEventListener("loadedmetadata", () => {
  vbTime.textContent = `0:00 / ${fmtShort(video.duration)}`;
});

unmuteBtn.addEventListener("click", () => {
  video.muted = false;
  unmuteBtn.hidden = true;
});

/* ---------- 点击页面任意位置：开启声音 / 预授权后续自动播放 ---------- */
let primed = false;
document.addEventListener("click", async () => {
  if (playing && video.muted) {
    video.muted = false;
    unmuteBtn.hidden = true;
    return;
  }
  /* 待机时点一下页面：借这次手势在同一元素上播放并暂停，
     让浏览器记住本站允许自动播放（之后到点即可有声播放） */
  if (!playing && !primed && video.src) {
    primed = true;
    try {
      await video.play();
      video.pause();
      video.currentTime = 0;
      showToast("已就绪：到点将自动有声播放", "ok", 2000);
    } catch { /* 忽略 */ }
  }
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

  /* 待机层（纯色底）显示下一场信息，并预载下一场的首段视频（到点秒开） */
  if (!playing) {
    sbLabel.textContent = isTomorrow ? "明天将播放" : "下一场将播放";
    sbName.textContent = next.slot.name;
    sbTime.textContent = next.slot.time;
    sbCountdown.textContent = `距自动播放还有 ${formatSpan(ms)}`;
    const firstVideo = new URL(next.slot.videos[0], location.href).href;
    if (video.src !== firstVideo) {
      video.src = next.slot.videos[0];
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
