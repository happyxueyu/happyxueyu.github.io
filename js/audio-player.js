/* ==========================================================
   AIGC 工具箱 — 音频播放器
   双音频元素设计：
   - audio-local：播放本地文件，接入 Web Audio 实现频谱可视化
   - audio-remote：播放网络链接，直连输出（避免跨域媒体经 Web Audio 被静音）
   ========================================================== */
"use strict";

(function () {
  /* ---------- 元素引用 ---------- */
  const audioLocal = document.getElementById("audio-local");
  const audioRemote = document.getElementById("audio-remote");
  const titleEl = document.getElementById("track-title");
  const subEl = document.getElementById("track-sub");
  const disc = document.getElementById("disc");
  const canvas = document.getElementById("visualizer");
  const progress = document.getElementById("progress");
  const timeCur = document.getElementById("time-cur");
  const timeDur = document.getElementById("time-dur");
  const btnPlay = document.getElementById("btn-play");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnMode = document.getElementById("btn-mode");
  const modeLabel = document.getElementById("mode-label");
  const volume = document.getElementById("volume");
  const volIcon = document.getElementById("vol-icon");
  const speedSel = document.getElementById("speed");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const urlInput = document.getElementById("url-input");
  const btnUrl = document.getElementById("btn-url");
  const playlistEl = document.getElementById("playlist");
  const playlistEmpty = document.getElementById("playlist-empty");
  const btnClear = document.getElementById("btn-clear");

  /* ---------- 状态 ---------- */
  let tracks = [];            // { name, url, isLocal, file?, duration? }
  let currentIndex = -1;
  let activeEl = null;        // 当前使用的音频元素
  let seeking = false;
  let objectUrls = new Set(); // 待回收的 blob 地址

  // 播放模式：all=列表循环 one=单曲循环 seq=顺序播放 shuffle=随机
  const MODES = [
    { key: "all", label: "列表循环", icon: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>' },
    { key: "one", label: "单曲循环", icon: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="12" y="15" font-size="9" fill="currentColor" stroke="none" text-anchor="middle">1</text>' },
    { key: "seq", label: "顺序播放", icon: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>' },
    { key: "shuffle", label: "随机播放", icon: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>' },
  ];
  let modeIndex = 0;

  /* ---------- Web Audio 可视化 ---------- */
  let audioCtx = null;
  let analyser = null;
  let freqData = null;

  function ensureAudioGraph() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      const source = audioCtx.createMediaElementSource(audioLocal);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      console.warn("Web Audio 初始化失败：", e);
    }
  }

  /* ---------- 频谱绘制 ---------- */
  const ctx2d = canvas.getContext("2d");

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  }
  window.addEventListener("resize", resizeCanvas);

  function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    const w = canvas.width, h = canvas.height;
    if (!w) { resizeCanvas(); return; }
    ctx2d.clearRect(0, 0, w, h);

    // 圆角矩形（旧浏览器退化为直角）
    const bar = (x, y, bw, bh) => {
      if (typeof ctx2d.roundRect === "function") {
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, bw, bh, bw / 2);
        ctx2d.fill();
      } else {
        ctx2d.fillRect(x, y, bw, bh);
      }
    };

    const BAR_COUNT = 48;
    const gap = 2 * (window.devicePixelRatio || 1);
    const barW = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
    const playingLocal = activeEl === audioLocal && !audioLocal.paused;

    if (playingLocal && analyser) {
      analyser.getByteFrequencyData(freqData);
      const grad = ctx2d.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "#7c6cff");
      grad.addColorStop(1, "#22d3ee");
      ctx2d.fillStyle = grad;
      for (let i = 0; i < BAR_COUNT; i++) {
        // 对频谱做近似对数采样，低频不至挤在一起
        const idx = Math.floor(Math.pow(i / BAR_COUNT, 1.6) * freqData.length);
        const v = freqData[idx] / 255;
        const barH = Math.max(2 * (window.devicePixelRatio || 1), v * h * 0.92);
        const x = i * (barW + gap);
        bar(x, h - barH, barW, barH);
      }
    } else {
      // 待机状态：底部一排小圆点
      ctx2d.fillStyle = "rgba(154,163,184,0.4)";
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barW + gap);
        ctx2d.beginPath();
        ctx2d.arc(x + barW / 2, h - 3 * (window.devicePixelRatio || 1), barW / 2, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.font = `${12 * (window.devicePixelRatio || 1)}px sans-serif`;
      ctx2d.fillStyle = "rgba(154,163,184,0.75)";
      ctx2d.textAlign = "center";
      const msg = activeEl === audioRemote ? "网络链接不经过频谱分析" : "播放本地音频可查看实时频谱";
      ctx2d.fillText(msg, w / 2, h / 2);
    }
  }
  resizeCanvas();
  drawVisualizer();

  /* ---------- 播放控制 ---------- */
  function currentTrack() { return tracks[currentIndex] || null; }

  function applySettings(el) {
    el.volume = volume.value / 100;
    el.playbackRate = parseFloat(speedSel.value);
    el.muted = volume.value == 0;
  }

  function playTrack(i, autoplay = true) {
    if (i < 0 || i >= tracks.length) return;
    const track = tracks[i];
    currentIndex = i;

    // 切换音频元素（本地文件与同源演示文件走 Web Audio 通路以启用频谱）
    const el = track.isLocal || track.sameOrigin ? audioLocal : audioRemote;
    if (activeEl && activeEl !== el) {
      activeEl.pause();
    }
    activeEl = el;
    if (track.isLocal) ensureAudioGraph();
    applySettings(el);
    el.src = track.url;

    titleEl.textContent = track.name;
    const sourceLabel = track.isLocal ? "本地文件" : track.sameOrigin ? "演示文件" : "网络链接";
    subEl.textContent = sourceLabel + ` · 第 ${i + 1} / ${tracks.length} 首`;
    renderPlaylist();

    if (autoplay) {
      el.play().catch(() => showToast("浏览器阻止了自动播放，请点击播放按钮", "error"));
    }
  }

  function togglePlay() {
    if (!activeEl) {
      if (tracks.length) playTrack(0);
      else showToast("请先添加音频文件或链接", "error");
      return;
    }
    if (activeEl.paused) {
      if (activeEl.src && !activeEl.ended) {
        activeEl.play().catch(() => {});
      } else {
        playTrack(Math.max(0, currentIndex));
      }
    } else {
      activeEl.pause();
    }
  }

  function nextIndex(auto = false) {
    const n = tracks.length;
    if (!n) return -1;
    const mode = MODES[modeIndex].key;
    if (mode === "shuffle" && n > 1) {
      let r;
      do { r = Math.floor(Math.random() * n); } while (r === currentIndex);
      return r;
    }
    const next = currentIndex + 1;
    if (next < n) return next;
    if (mode === "seq" && auto) return -1; // 顺序播放到末尾即停止
    return 0; // 列表循环 / 随机 / 手动点到末尾 → 回到开头
  }

  function playNext() {
    const i = nextIndex(true);
    if (i === -1) { togglePlayIcon(false); return; }
    playTrack(i);
  }
  function playPrev() {
    if (tracks.length) playTrack((currentIndex - 1 + tracks.length) % tracks.length);
  }

  function togglePlayIcon(playing) {
    iconPlay.style.display = playing ? "none" : "";
    iconPause.style.display = playing ? "" : "none";
    disc.classList.toggle("spin", playing);
  }

  /* ---------- 音频元素事件（两个元素共用） ---------- */
  [audioLocal, audioRemote].forEach((el) => {
    el.addEventListener("play", () => { if (el === activeEl) togglePlayIcon(true); });
    el.addEventListener("pause", () => { if (el === activeEl) togglePlayIcon(false); });
    el.addEventListener("loadedmetadata", () => {
      if (el === activeEl) {
        progress.max = el.duration || 0;
        timeDur.textContent = formatTime(el.duration);
        const t = currentTrack();
        if (t && !t.duration) { t.duration = el.duration; renderPlaylist(); }
      }
    });
    el.addEventListener("timeupdate", () => {
      if (el !== activeEl || seeking) return;
      progress.value = el.currentTime || 0;
      paintRange(progress);
      timeCur.textContent = formatTime(el.currentTime);
    });
    el.addEventListener("ended", () => {
      if (el !== activeEl) return;
      const mode = MODES[modeIndex].key;
      if (mode === "one") {
        el.currentTime = 0;
        el.play().catch(() => {});
      } else {
        playNext();
      }
    });
    el.addEventListener("error", () => {
      if (el !== activeEl || !el.src) return;
      showToast("当前音频无法播放（格式不支持或链接失效）", "error");
      togglePlayIcon(false);
    });
  });

  /* ---------- 进度条 ---------- */
  progress.addEventListener("input", () => {
    seeking = true;
    paintRange(progress);
    timeCur.textContent = formatTime(parseFloat(progress.value));
  });
  progress.addEventListener("change", () => {
    if (activeEl && activeEl.duration) activeEl.currentTime = parseFloat(progress.value);
    seeking = false;
  });

  /* ---------- 音量 / 倍速 ---------- */
  volume.addEventListener("input", () => {
    paintRange(volume);
    if (activeEl) {
      activeEl.volume = volume.value / 100;
      activeEl.muted = volume.value == 0;
    }
    volIcon.style.opacity = volume.value == 0 ? 0.4 : 1;
  });
  speedSel.addEventListener("change", () => {
    if (activeEl) activeEl.playbackRate = parseFloat(speedSel.value);
    showToast(`倍速：${speedSel.value}x`, "info", 1200);
  });

  /* ---------- 播放模式 ---------- */
  function renderMode() {
    const m = MODES[modeIndex];
    btnMode.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${m.icon}</svg>`;
    modeLabel.textContent = m.label;
  }
  btnMode.addEventListener("click", () => {
    modeIndex = (modeIndex + 1) % MODES.length;
    renderMode();
    showToast(`播放模式：${MODES[modeIndex].label}`, "info", 1200);
  });
  renderMode();

  /* ---------- 播放列表 ---------- */
  function addTracks(files) {
    const audioFiles = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i.test(f.name));
    const others = files.length - audioFiles.length;
    if (others > 0) showToast(`已跳过 ${others} 个非音频文件`, "info");
    if (!audioFiles.length) return;

    const firstNew = tracks.length;
    audioFiles.forEach((f) => {
      const url = URL.createObjectURL(f);
      objectUrls.add(url);
      tracks.push({ name: nameFromFile(f), url, isLocal: true, file: f });
    });
    renderPlaylist();
    showToast(`已添加 ${audioFiles.length} 个文件`, "ok");
    if (currentIndex === -1 || !activeEl) playTrack(firstNew);
    probeDurations();
  }

  function addUrlTrack(raw) {
    const url = raw.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      showToast("请输入以 http:// 或 https:// 开头的链接", "error");
      return;
    }
    const idx = tracks.length;
    tracks.push({ name: nameFromUrl(url), url, isLocal: false });
    renderPlaylist();
    urlInput.value = "";
    playTrack(idx);
    probeDurations();
  }

  // 异步探测每首时长（仅用于列表展示）
  function probeDurations() {
    tracks.forEach((t) => {
      if (t.duration != null || t.probing) return;
      t.probing = true;
      const probe = document.createElement("audio");
      probe.preload = "metadata";
      const done = () => {
        if (isFinite(probe.duration)) t.duration = probe.duration;
        t.probing = false;
        probe.src = "";
        renderPlaylist();
      };
      probe.addEventListener("loadedmetadata", done, { once: true });
      probe.addEventListener("error", () => { t.probing = false; renderPlaylist(); }, { once: true });
      setTimeout(() => { t.probing = false; }, 6000);
      probe.src = t.url;
    });
  }

  function removeTrack(i, ev) {
    if (ev) ev.stopPropagation();
    const [removed] = tracks.splice(i, 1);
    if (removed && removed.isLocal) {
      URL.revokeObjectURL(removed.url);
      objectUrls.delete(removed.url);
    }
    if (i === currentIndex) {
      activeEl && activeEl.pause();
      if (tracks.length) playTrack(Math.min(i, tracks.length - 1), false);
      else resetPlayer();
    } else if (i < currentIndex) {
      currentIndex--;
      renderPlaylist();
    } else {
      renderPlaylist();
    }
  }

  function resetPlayer() {
    currentIndex = -1;
    if (activeEl) {
      activeEl.pause();
      activeEl.removeAttribute("src");
      activeEl.load();
    }
    activeEl = null;
    titleEl.textContent = "未在播放";
    subEl.textContent = "从右侧添加本地文件或粘贴网络链接开始播放";
    progress.value = 0; progress.max = 100; paintRange(progress);
    timeCur.textContent = "0:00"; timeDur.textContent = "0:00";
    togglePlayIcon(false);
    renderPlaylist();
  }

  function renderPlaylist() {
    playlistEmpty.style.display = tracks.length ? "none" : "";
    playlistEl.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      if (i === currentIndex) li.classList.add("active");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = i === currentIndex && activeEl && !activeEl.paused ? "▶" : i + 1;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = t.name;
      name.title = t.name + (t.isLocal ? "" : t.sameOrigin ? "（演示）" : "（网络链接）");
      const dur = document.createElement("span");
      dur.className = "dur";
      dur.textContent = t.duration ? formatTime(t.duration) : "";
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.title = "移除";
      rm.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      rm.addEventListener("click", (e) => removeTrack(i, e));
      li.append(num, name, dur, rm);
      li.addEventListener("click", () => playTrack(i));
      playlistEl.appendChild(li);
    });
  }

  btnClear.addEventListener("click", () => {
    if (!tracks.length) return;
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.clear();
    tracks = [];
    activeEl && activeEl.pause();
    resetPlayer();
    showToast("播放列表已清空", "ok");
  });

  /* ---------- 来源输入 ---------- */
  setupDropzone(dropzone, {
    onClick: () => fileInput.click(),
    onFiles: addTracks,
  });
  fileInput.addEventListener("change", () => {
    addTracks(Array.from(fileInput.files || []));
    fileInput.value = "";
  });
  btnUrl.addEventListener("click", () => addUrlTrack(urlInput.value));
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addUrlTrack(urlInput.value);
  });
  document.getElementById("btn-demo").addEventListener("click", () => {
    const idx = tracks.length;
    tracks.push({ name: "演示音频 · 试听旋律", url: "../test-media/demo-melody.wav", isLocal: false, sameOrigin: true });
    renderPlaylist();
    playTrack(idx);
    probeDurations();
  });

  /* ---------- 按钮 ---------- */
  btnPlay.addEventListener("click", togglePlay);
  btnNext.addEventListener("click", () => { const i = nextIndex(false); if (i >= 0) playTrack(i); });
  btnPrev.addEventListener("click", () => {
    if (activeEl && activeEl.currentTime > 3) { activeEl.currentTime = 0; return; }
    playPrev();
  });

  /* ---------- 键盘快捷键 ---------- */
  window.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        if (activeEl) activeEl.currentTime = Math.min(activeEl.duration || 0, activeEl.currentTime + 5);
        break;
      case "ArrowLeft":
        if (activeEl) activeEl.currentTime = Math.max(0, activeEl.currentTime - 5);
        break;
      case "ArrowUp": {
        e.preventDefault();
        volume.value = Math.min(100, Number(volume.value) + 5);
        volume.dispatchEvent(new Event("input"));
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        volume.value = Math.max(0, Number(volume.value) - 5);
        volume.dispatchEvent(new Event("input"));
        break;
      }
    }
  });

  preventPageDragOpen();
  paintRange(volume);
})();
