/* ==========================================================
   工具箱 — 定时播放（直播式同步版）
   ------------------------------------------------------------
   - 支持两种场次模式（config.json）：
     · 音频+图片：{ audio, scenes:[{t,img}] }  ← 推荐，秒开、可精准同步
     · 视频：     { videos:[...] }（多段连播，兼容保留）
   - 直播式同步：任何人任意时刻打开，进度 = 当前时间 - 开播时间，
     与所有人一致；播放中每 15 秒校准一次防漂移
   - 配置优先读线上 config.json，失败用内置默认
   ========================================================== */
"use strict";

/* ---------- 内置默认计划（兜底） ---------- */
const DEFAULT_SCHEDULE = [
  {
    id: "am", name: "早课 · 视频1", time: "05:30",
    videos: ["test-media/am-1.mp4", "test-media/am-2.mp4"],
    partDurations: [1883.36, 1854.8],
    durationSec: 3738.13,
  },
  {
    id: "pm", name: "晚课 · 视频2", time: "20:00",
    videos: ["test-media/pm-1.mp4", "test-media/pm-2.mp4", "test-media/pm-3.mp4"],
    partDurations: [2450.05, 2475.0, 2427.8],
    durationSec: 7352.85,
  },
];
const DEFAULT_GRACE_MIN = 15; /* 兜底：无时长信息时的最短进场窗口 */
const SESSION_TAIL_SEC = 120; /* 结束后的缓冲窗口 */

let SCHEDULE = DEFAULT_SCHEDULE;
let GRACE_MIN = DEFAULT_GRACE_MIN;

/* ---------- 元素 ---------- */
const video = document.getElementById("video");
const audioEl = document.getElementById("audio");
const playerWrap = document.getElementById("player-wrap");
const sceneA = document.getElementById("scene-a");
const sceneB = document.getElementById("scene-b");
const clockEl = document.getElementById("clock");
const dateEl = document.getElementById("date-line");
const countdownEl = document.getElementById("countdown");
const playerState = document.getElementById("player-state");
const sbLabel = document.getElementById("sb-label");
const sbName = document.getElementById("sb-name");
const sbTime = document.getElementById("sb-time");
const sbCountdown = document.getElementById("sb-countdown");
const slotsEl = document.getElementById("slots");
const unmuteBtn = document.getElementById("unmute-btn");
const wakeHint = document.getElementById("wake-hint");
const vbPlay = document.getElementById("vb-play");
const vbPause = document.getElementById("vb-pause");
const vbFill = document.getElementById("vb-fill");
const vbTime = document.getElementById("vb-time");
const bufferingEl = document.getElementById("buffering");

/* ---------- 状态 ---------- */
let media = video;                 // 当前承载播放的元素
let playing = false;               // 本页面正在播一场
let liveMode = false;              // 本场是否为直播同步模式
let sessionStartMs = 0;            // 本场的墙钟开播时刻
let currentSlot = null;
let wakeLock = null;
let queue = [];                    // 视频模式分段列表
let queueIndex = 0;
const prefetched = new Set();
let currentScene = "";             // 当前显示的场景图
let frontScene = sceneA;           // 交叉淡入的前层图

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
function markPlayed(slot) { try { localStorage.setItem(playedKey(slot), "1"); } catch { /* 忽略 */ } }
function sessionDurationSec(slot) {
  if (typeof slot.durationSec === "number" && slot.durationSec > 0) return slot.durationSec;
  if (isFinite(media.duration) && media.duration > 0) return media.duration;
  return GRACE_MIN * 60;
}

/* ---------- 直播窗口：返回正在进行的场次与已播秒数 ---------- */
function liveSession() {
  const now = Date.now();
  for (const slot of SCHEDULE) {
    const start = slotDate(slot).getTime();
    const dur = (slot.durationSec || 0) * 1000 || Infinity;
    const end = start + dur + SESSION_TAIL_SEC * 1000;
    if (now >= start && now <= end) {
      return { slot, start, elapsed: (now - start) / 1000 };
    }
  }
  return null;
}

/* ---------- 定时检查（直播式：进场即对齐进度） ---------- */
function checkSchedule() {
  if (playing) return;
  const live = liveSession();
  if (!live) return;
  const dur = live.slot.durationSec || Infinity;
  if (live.elapsed < dur && !isPlayed(live.slot)) {
    startPlay(live.slot, { live: true, seek: live.elapsed });
  }
}

/* ---------- 场景图片切换（双图交叉淡入） ---------- */
function setScene(imgPath) {
  if (!imgPath || imgPath === currentScene) return;
  currentScene = imgPath;
  const back = frontScene === sceneA ? sceneB : sceneA;
  const url = new URL(imgPath, location.href).href;
  const apply = () => {
    back.src = url;
    back.classList.add("show");
    frontScene.classList.remove("show");
    frontScene = back;
  };
  if (back.complete && back.src === url) { apply(); return; }
  const probe = new Image();
  probe.onload = apply;
  probe.onerror = () => { /* 图片缺失则保持上一张 */ };
  probe.src = url;
}
function syncSceneToTime(t) {
  if (!currentSlot || !currentSlot.scenes) return;
  let hit = currentSlot.scenes[0];
  for (const s of currentSlot.scenes) {
    if (s.t <= t) hit = s; else break;
  }
  setScene(hit.img);
}
function preloadScenes(slot) {
  if (!slot.scenes) return;
  slot.scenes.forEach((s) => { const i = new Image(); i.src = new URL(s.img, location.href).href; });
}

/* ---------- 开始一场 ---------- */
async function startPlay(slot, opts = {}) {
  playing = true;
  currentSlot = slot;
  liveMode = !!opts.live;
  sessionStartMs = opts.live ? slotDate(slot).getTime() : Date.now();
  if (!opts.test) markPlayed(slot);
  setSlotState(slot, "播放中");
  playerState.classList.add("playing");
  playerWrap.classList.add("playing");
  queue = [];
  queueIndex = 0;

  if (slot.audio) {
    /* —— 音频+图片模式（支持精准同步进场） —— */
    playerWrap.classList.add("audio-mode");
    media = audioEl;
    video.pause();
    audioEl.src = slot.audio;
    audioEl.muted = video.muted;
    preloadScenes(slot);
    const seekTo = () => {
      if (opts.seek > 0 && isFinite(audioEl.duration)) {
        audioEl.currentTime = Math.min(opts.seek, Math.max(0, audioEl.duration - 1));
      }
      audioEl.removeEventListener("loadedmetadata", seekTo);
    };
    audioEl.addEventListener("loadedmetadata", seekTo);
    syncSceneToTime(opts.seek || 0);
    await tryPlay(audioEl, opts.seek || 0, seekTo);
  } else {
    /* —— 视频模式（分段连播 + 精准同步进场） —— */
    playerWrap.classList.remove("audio-mode");
    media = video;
    audioEl.pause();
    queue = slot.videos.slice();
    let partIdx = 0;
    let offset = opts.seek || 0;
    if (slot.partDurations) {
      let acc = 0;
      for (let i = 0; i < slot.partDurations.length; i++) {
        if (offset < acc + slot.partDurations[i]) { partIdx = i; offset -= acc; break; }
        acc += slot.partDurations[i];
        partIdx = i + 1;
      }
      if (partIdx >= queue.length) { finishSession(); return; } /* 进场时本场已播完 */
    }
    queueIndex = partIdx;
    await playCurrentPart(offset);
  }
}

async function tryPlay(el, seek, seekFn) {
  try {
    await el.play();
  } catch {
    /* 浏览器拦截有声自动播放 → 静音播 + 开声音按钮 */
    el.muted = true;
    try { await el.play(); } catch { showToast("无法自动播放，请刷新页面重试", "error", 5000); }
  }
}

async function playCurrentPart(startAt = 0) {
  playerState.textContent = queue.length > 1 ? `播放中 ${queueIndex + 1}/${queue.length}` : "播放中";
  video.src = queue[queueIndex];
  if (startAt > 0) {
    video.addEventListener("loadedmetadata", () => { video.currentTime = startAt; }, { once: true });
  }
  await tryPlay(video);
}

/* ---------- 直播同步校准（防缓冲造成的漂移；视频模式可跨段校正） ---------- */
setInterval(() => {
  if (!playing || !liveMode || media.paused) return;
  const target = (Date.now() - sessionStartMs) / 1000;
  if (!currentSlot) return;
  if (currentSlot.audio) {
    if (isFinite(media.duration) && target < media.duration && Math.abs(media.currentTime - target) > 2.5) {
      media.currentTime = target;
    }
  } else if (currentSlot.partDurations && queue.length) {
    /* 换算目标时间所在分段与段内偏移 */
    let acc = 0, idx = 0, offset = target;
    for (let i = 0; i < currentSlot.partDurations.length; i++) {
      if (target < acc + currentSlot.partDurations[i]) { idx = i; offset = target - acc; break; }
      acc += currentSlot.partDurations[i];
      idx = i + 1;
      offset = 0;
    }
    if (idx >= queue.length) { finishSession(); return; } /* 直播时刻已过本场结尾 */
    if (idx !== queueIndex) {
      queueIndex = idx;
      playCurrentPart(offset);
    } else if (isFinite(video.duration) && Math.abs(video.currentTime - offset) > 2.5) {
      video.currentTime = offset;
    }
  }
}, 15000);

/* ---------- 共用媒体事件（video 与 audio 都挂载） ---------- */
function onMediaEvent(el) {
  el.addEventListener("play", () => { if (media === el) updateVbarIcon(true); });
  el.addEventListener("pause", () => { if (media === el) updateVbarIcon(false); });
  el.addEventListener("timeupdate", () => {
    if (media !== el || !isFinite(el.duration) || !el.duration) return;
    vbFill.style.width = `${(el.currentTime / el.duration) * 100}%`;
    vbTime.textContent = `${fmtShort(el.currentTime)} / ${fmtShort(el.duration)}`;
    if (currentSlot && currentSlot.audio && media === el) syncSceneToTime(el.currentTime);
    if (playing && media === el && queue.length > 1 && queueIndex < queue.length - 1) {
      const nextUrl = new URL(queue[queueIndex + 1], location.href).href;
      if (el.currentTime > el.duration * 0.6 && !prefetched.has(nextUrl)) {
        prefetched.add(nextUrl);
        fetch(nextUrl).catch(() => prefetched.delete(nextUrl));
      }
    }
  });
  el.addEventListener("loadedmetadata", () => {
    if (media === el) vbTime.textContent = `0:00 / ${fmtShort(el.duration)}`;
  });
  el.addEventListener("ended", () => {
    if (media !== el || !playing) return;
    if (!currentSlot.audio && queueIndex < queue.length - 1) {
      queueIndex += 1;
      playCurrentPart();
      return;
    }
    finishSession();
  });
  el.addEventListener("volumechange", () => { if (media === el) updateMuteBadge(); });
  el.addEventListener("waiting", () => { if (media === el) setBuffering(true); });
  el.addEventListener("stalled", () => { if (media === el) setBuffering(true); });
  el.addEventListener("playing", () => { if (media === el) setBuffering(false); });
  el.addEventListener("canplay", () => { if (media === el) setBuffering(false); });
}
onMediaEvent(video);
onMediaEvent(audioEl);

function finishSession() {
  playing = false;
  liveMode = false;
  currentSlot = null;
  currentScene = "";
  media.pause();
  try { media.currentTime = 0; } catch { /* 忽略 */ }
  media.muted = false;
  unmuteBtn.hidden = true;
  playerWrap.classList.remove("playing", "audio-mode");
  sceneA.classList.remove("show");
  sceneB.classList.remove("show");
  playerState.classList.remove("playing");
  playerState.textContent = "待机";
  showToast("本场播放已结束", "ok");
  updateUI();
}

/* 禁止手动控制入口 */
video.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- 播放器外观栏 ---------- */
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

function setBuffering(on) {
  if (playing) bufferingEl.hidden = !on;
  else bufferingEl.hidden = true;
}

/* ---------- 静音徽标 ---------- */
let unmuteTimer = null;
function updateMuteBadge() {
  clearTimeout(unmuteTimer);
  if (media.muted) {
    unmuteBtn.hidden = false;
    unmuteBtn.classList.add("muted");
    unmuteBtn.innerHTML = '<span class="mute-ic">🔇</span>开声音';
  } else if (playing) {
    unmuteBtn.hidden = false;
    unmuteBtn.classList.remove("muted");
    unmuteBtn.innerHTML = '<span class="mute-ic">🔊</span>有声';
    unmuteTimer = setTimeout(() => { unmuteBtn.hidden = true; }, 3000);
  } else {
    unmuteBtn.hidden = true;
    unmuteBtn.classList.remove("muted");
  }
}
unmuteBtn.addEventListener("click", () => { media.muted = false; });

/* ---------- 点击页面任意位置：开声音 / 预授权 ---------- */
let primed = false;
document.addEventListener("click", async () => {
  if (playing && media.muted) {
    media.muted = false;
    return;
  }
  if (!playing && !primed && media.src) {
    primed = true;
    try {
      await media.play();
      media.pause();
      try { media.currentTime = 0; } catch { /* 忽略 */ }
      showToast("已就绪：到点将自动有声播放", "ok", 2000);
    } catch { /* 忽略 */ }
  }
});

/* ---------- 屏幕常亮 ---------- */
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
  if (document.visibilityState === "visible" && !wakeLock) requestWakeLock();
});

/* ---------- 场次列表（动态渲染） ---------- */
function renderSlots() {
  slotsEl.innerHTML = "";
  for (const slot of SCHEDULE) {
    const row = document.createElement("div");
    row.className = "slot";
    row.dataset.id = slot.id;
    const time = document.createElement("span");
    time.className = "slot-time";
    time.textContent = slot.time;
    const name = document.createElement("span");
    name.className = "slot-name";
    name.textContent = slot.name;
    const state = document.createElement("span");
    state.className = "slot-state";
    state.textContent = "待播放";
    row.append(time, name, state);
    slotsEl.appendChild(row);
  }
}
function setSlotState(slot, text) {
  const row = slotsEl.querySelector(`.slot[data-id="${slot.id}"]`);
  if (row) row.querySelector(".slot-state").textContent = text;
}

/* ---------- 界面刷新 ---------- */
function nextSlotInfo() {
  const now = new Date();
  const t = now.getTime();
  let best = null;
  for (const slot of SCHEDULE) {
    if (isPlayed(slot) && !(playing && currentSlot === slot)) continue;
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

  const live = liveSession();
  for (const slot of SCHEDULE) {
    if (playing && currentSlot === slot) { setSlotState(slot, "播放中"); continue; }
    const start = slotDate(slot).getTime();
    if (live && live.slot === slot) { setSlotState(slot, "可加入同步播放"); continue; }
    if (isPlayed(slot)) { setSlotState(slot, "已播放"); continue; }
    setSlotState(slot, now.getTime() < start ? "待播放" : "已结束");
  }

  const next = nextSlotInfo();
  const isTomorrow = next.date.toDateString() !== now.toDateString();
  const ms = slotDate(next.slot, next.date).getTime() - now.getTime();
  countdownEl.textContent = (isTomorrow ? `明天 ${next.slot.time} ` : `下一场 ${next.slot.time} `)
    + `${next.slot.name}，还有 ${formatSpan(ms)}`;

  /* 待机层与预载 */
  if (!playing) {
    sbLabel.textContent = isTomorrow ? "明天将播放" : "下一场将播放";
    sbName.textContent = next.slot.name;
    sbTime.textContent = next.slot.time;
    sbCountdown.textContent = `距自动播放还有 ${formatSpan(ms)}`;
    if (next.slot.audio) {
      const url = new URL(next.slot.audio, location.href).href;
      if (audioEl.src !== url) audioEl.src = next.slot.audio;
    } else if (next.slot.videos && next.slot.videos.length) {
      const url = new URL(next.slot.videos[0], location.href).href;
      if (video.src !== url) video.src = next.slot.videos[0];
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

/* ---------- 刷新按钮 ---------- */
document.getElementById("refresh-btn").addEventListener("click", () => location.reload());

/* ---------- 横屏全屏（真全屏优先，不支持自动伪全屏） ---------- */
const fsBtn = document.getElementById("fs-btn");
const fsOpen = document.getElementById("fs-open");
const fsClose = document.getElementById("fs-close");
const fsExitBtn = document.getElementById("fs-exit");
let fakeFs = false;

function fsActive() { return !!document.fullscreenElement || fakeFs; }
function updateFsUI() {
  const on = fsActive();
  fsOpen.style.display = on ? "none" : "";
  fsClose.style.display = on ? "" : "none";
  fsExitBtn.hidden = !on;
}
async function exitFullscreenMode() {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { /* 忽略 */ }
  }
  fakeFs = false;
  document.body.classList.remove("fs-fake");
  updateFsUI();
}
async function toggleFullscreen() {
  if (fsActive()) { exitFullscreenMode(); return; }
  if (playerWrap.requestFullscreen) {
    try {
      await playerWrap.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(() => {});
      }
      return;
    } catch { /* 退回伪全屏 */ }
  }
  fakeFs = true;
  document.body.classList.add("fs-fake");
  updateFsUI();
}
fsBtn.addEventListener("click", toggleFullscreen);
fsExitBtn.addEventListener("click", exitFullscreenMode);
document.addEventListener("fullscreenchange", updateFsUI);

/* ---------- 启动 ---------- */
function initApp() {
  renderSlots();
  requestWakeLock();
  tick();
  setInterval(tick, 1000);
  /* 测试播放：?play=am|pm 从头播放预览（非同步模式） */
  const want = new URLSearchParams(location.search).get("play");
  if (want) {
    const slot = SCHEDULE.find((s) => s.id === want);
    if (slot) {
      showToast(`测试播放：${slot.name}`, "info", 2000);
      startPlay(slot, { test: true });
    } else {
      showToast(`没有找到场次 "${want}"（可用：${SCHEDULE.map((s) => s.id).join(" / ")}）`, "error", 4000);
    }
  }
}

fetch(new Request("config.json", { cache: "no-store" }))
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
  .then((cfg) => {
    if (cfg && Array.isArray(cfg.schedule) && cfg.schedule.length) {
      SCHEDULE = cfg.schedule;
      GRACE_MIN = typeof cfg.graceMin === "number" && cfg.graceMin > 0 ? cfg.graceMin : DEFAULT_GRACE_MIN;
    }
  })
  .catch(() => { /* 离线或缺失：使用默认 */ })
  .finally(initApp);

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

/* ---------- Service Worker（PWA 离线 + 版本自愈） ---------- */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
  let swReloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!swReloaded && navigator.serviceWorker.controller) {
      swReloaded = true;
      location.reload();
    }
  });
}
