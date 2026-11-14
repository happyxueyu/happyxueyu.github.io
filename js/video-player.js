/* ==========================================================
   AIGC 工具箱 — 视频播放器
   自定义控制栏：进度拖拽/悬停预览、缓冲显示、倍速、
   画中画、全屏、截图（canvas 抓帧）、本地 .vtt 字幕
   ========================================================== */
"use strict";

(function () {
  /* ---------- 元素引用 ---------- */
  const video = document.getElementById("video");
  const stage = document.getElementById("stage");
  const emptyEl = document.getElementById("video-empty");
  const centerPlay = document.getElementById("center-play");
  const controls = document.getElementById("v-controls");
  const progressEl = document.getElementById("v-progress");
  const bufferedEl = document.getElementById("v-buffered");
  const playedEl = document.getElementById("v-played");
  const knobEl = document.getElementById("v-knob");
  const hoverTimeEl = document.getElementById("hover-time");
  const vPlay = document.getElementById("v-play");
  const iconPlay = document.getElementById("v-icon-play");
  const iconPause = document.getElementById("v-icon-pause");
  const vPrev = document.getElementById("v-prev");
  const vNext = document.getElementById("v-next");
  const vCur = document.getElementById("v-cur");
  const vDur = document.getElementById("v-dur");
  const vVolume = document.getElementById("v-volume");
  const vMute = document.getElementById("v-mute");
  const volOn = document.getElementById("v-vol-on");
  const volOff = document.getElementById("v-vol-off");
  const vSpeed = document.getElementById("v-speed");
  const vSubtitle = document.getElementById("v-subtitle");
  const subtitleInput = document.getElementById("subtitle-input");
  const vSnapshot = document.getElementById("v-snapshot");
  const vPip = document.getElementById("v-pip");
  const vFull = document.getElementById("v-full");
  const iconFull = document.getElementById("v-icon-full");
  const iconFullExit = document.getElementById("v-icon-full-exit");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const urlInput = document.getElementById("url-input");
  const btnUrl = document.getElementById("btn-url");
  const playlistEl = document.getElementById("playlist");
  const playlistEmpty = document.getElementById("playlist-empty");
  const btnClear = document.getElementById("btn-clear");

  /* ---------- 状态 ---------- */
  let tracks = [];
  let currentIndex = -1;
  let objectUrls = new Set();
  let hideTimer = null;
  let dragging = false;
  let clickTimer = null;

  /* ---------- 播放控制 ---------- */
  function currentTrack() { return tracks[currentIndex] || null; }

  function playTrack(i, autoplay = true) {
    if (i < 0 || i >= tracks.length) return;
    const track = tracks[i];
    currentIndex = i;
    removeSubtitles();
    video.src = track.url;
    video.load();
    emptyEl.style.display = "none";
    renderPlaylist();
    if (autoplay) video.play().catch(() => {});
  }

  function togglePlay() {
    if (!video.src) {
      if (tracks.length) playTrack(0);
      else fileInput.click();
      return;
    }
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function playNext() {
    if (!tracks.length) return;
    playTrack((currentIndex + 1) % tracks.length);
  }
  function playPrev() {
    if (!tracks.length) return;
    playTrack((currentIndex - 1 + tracks.length) % tracks.length);
  }

  function updatePlayIcon() {
    const playing = !video.paused && !video.ended;
    iconPlay.style.display = playing ? "none" : "";
    iconPause.style.display = playing ? "" : "none";
    centerPlay.classList.toggle("show", !playing && !!video.src);
  }

  /* ---------- 控制栏自动隐藏 ---------- */
  function wake() {
    stage.classList.remove("ctrl-hidden");
    clearTimeout(hideTimer);
    if (!video.paused && video.src) {
      hideTimer = setTimeout(() => {
        if (!video.paused && !dragging) stage.classList.add("ctrl-hidden");
      }, 2600);
    }
  }
  stage.addEventListener("pointermove", wake);
  stage.addEventListener("pointerdown", wake);
  stage.addEventListener("touchstart", wake, { passive: true });
  video.addEventListener("play", wake);
  video.addEventListener("pause", wake);

  /* ---------- 进度条（指针拖拽 + 悬停预览） ---------- */
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }

  function clientXToRatio(clientX) {
    const rect = progressEl.getBoundingClientRect();
    return clamp01((clientX - rect.left) / rect.width);
  }

  function seekTo(clientX) {
    if (!isFinite(video.duration) || !video.duration) return;
    video.currentTime = clientXToRatio(clientX) * video.duration;
  }

  progressEl.addEventListener("pointerdown", (e) => {
    if (!video.src) return;
    dragging = true;
    progressEl.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });
  progressEl.addEventListener("pointermove", (e) => {
    if (!video.src || !isFinite(video.duration)) return;
    const ratio = clientXToRatio(e.clientX);
    // 悬停时间预览
    const rect = progressEl.getBoundingClientRect();
    hoverTimeEl.textContent = formatTime(ratio * video.duration);
    hoverTimeEl.style.left = `${ratio * rect.width}px`;
    if (dragging) seekTo(e.clientX);
  });
  progressEl.addEventListener("pointerup", () => { dragging = false; });
  progressEl.addEventListener("pointercancel", () => { dragging = false; });

  function updateProgressUI() {
    if (!isFinite(video.duration) || !video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    playedEl.style.width = pct + "%";
    knobEl.style.left = pct + "%";
    vCur.textContent = formatTime(video.currentTime);
    // 缓冲进度：取包含当前位置（或最后一个）的区间末端
    let bufEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.5) {
        bufEnd = Math.max(bufEnd, video.buffered.end(i));
      }
    }
    bufferedEl.style.width = Math.min(100, (bufEnd / video.duration) * 100) + "%";
  }
  video.addEventListener("timeupdate", updateProgressUI);
  video.addEventListener("progress", updateProgressUI);
  video.addEventListener("loadedmetadata", () => {
    vDur.textContent = formatTime(video.duration);
    const t = currentTrack();
    if (t && !t.duration) { t.duration = video.duration; renderPlaylist(); }
  });

  /* ---------- 音量 / 静音 / 倍速 ---------- */
  vVolume.addEventListener("input", () => {
    paintRange(vVolume);
    video.volume = vVolume.value / 100;
    video.muted = vVolume.value == 0;
    updateVolIcon();
  });
  function updateVolIcon() {
    const silent = video.muted || video.volume === 0;
    volOn.style.display = silent ? "none" : "";
    volOff.style.display = silent ? "" : "none";
  }
  vMute.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) {
      video.volume = 0.5;
      vVolume.value = 50;
      paintRange(vVolume);
    }
    updateVolIcon();
  });
  vSpeed.addEventListener("change", () => {
    video.playbackRate = parseFloat(vSpeed.value);
    showToast(`倍速：${vSpeed.value}x`, "info", 1200);
  });

  /* ---------- 字幕 ---------- */
  function removeSubtitles() {
    Array.from(video.querySelectorAll("track")).forEach((t) => t.remove());
    vSubtitle.classList.remove("active");
  }
  vSubtitle.addEventListener("click", () => subtitleInput.click());
  subtitleInput.addEventListener("change", () => {
    const file = subtitleInput.files && subtitleInput.files[0];
    if (!file) return;
    if (!/\.vtt$/i.test(file.name)) {
      showToast("仅支持 WebVTT（.vtt）字幕文件", "error");
      return;
    }
    removeSubtitles();
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "自定义字幕";
    track.src = URL.createObjectURL(file);
    track.default = true;
    video.appendChild(track);
    track.addEventListener("load", () => { track.track.mode = "showing"; });
    setTimeout(() => { if (track.track) track.track.mode = "showing"; }, 0);
    vSubtitle.classList.add("active");
    showToast("字幕已加载", "ok");
    subtitleInput.value = "";
  });

  /* ---------- 截图 ---------- */
  function snapshot() {
    if (!video.src || !video.videoWidth) {
      showToast("请先播放一个视频", "error");
      return;
    }
    try {
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        if (!blob) { showToast("截图失败", "error"); return; }
        const a = document.createElement("a");
        const t = currentTrack();
        const base = (t ? t.name.replace(/\.[^.]+$/, "") : "video").slice(0, 40);
        a.href = URL.createObjectURL(blob);
        a.download = `${base}_${Math.floor(video.currentTime)}s.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        showToast("截图已保存", "ok");
      }, "image/png");
    } catch (e) {
      // 跨域视频未经 CORS 允许时，canvas 会被污染而无法导出
      showToast("该视频来自跨域站点且未允许截图，无法保存画面", "error", 3500);
    }
  }
  vSnapshot.addEventListener("click", snapshot);

  /* ---------- 画中画 / 全屏 ---------- */
  vPip.addEventListener("click", async () => {
    if (!document.pictureInPictureEnabled) {
      showToast("当前浏览器不支持画中画", "error");
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      showToast("画中画暂不可用", "error");
    }
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen().catch(() => showToast("无法进入全屏", "error"));
  }
  vFull.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const fs = !!document.fullscreenElement;
    iconFull.style.display = fs ? "none" : "";
    iconFullExit.style.display = fs ? "" : "none";
  });

  /* ---------- 视频事件 ---------- */
  video.addEventListener("play", updatePlayIcon);
  video.addEventListener("pause", updatePlayIcon);
  video.addEventListener("ended", () => {
    updatePlayIcon();
    if (currentIndex < tracks.length - 1) playNext();
  });
  video.addEventListener("error", () => {
    if (!video.src) return;
    showToast("当前视频无法播放（格式不支持或链接失效）", "error");
  });

  /* ---------- 画面点击（区分单击/双击） ---------- */
  function onStageClick(e) {
    if (e.target.closest(".v-controls")) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => togglePlay(), 260);
  }
  function onStageDblClick(e) {
    if (e.target.closest(".v-controls")) return;
    clearTimeout(clickTimer);
    toggleFullscreen();
  }
  video.addEventListener("click", onStageClick);
  video.addEventListener("dblclick", onStageDblClick);
  centerPlay.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });
  emptyEl.addEventListener("click", () => fileInput.click());

  /* ---------- 播放列表 ---------- */
  function addTracks(files) {
    const videoFiles = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|webm|mkv|mov|m4v|ogv)$/i.test(f.name));
    const others = files.length - videoFiles.length;
    if (others > 0) showToast(`已跳过 ${others} 个非视频文件`, "info");
    if (!videoFiles.length) return;

    const wasEmpty = tracks.length === 0;
    videoFiles.forEach((f) => {
      const url = URL.createObjectURL(f);
      objectUrls.add(url);
      tracks.push({ name: nameFromFile(f), url, isLocal: true, file: f });
    });
    renderPlaylist();
    showToast(`已添加 ${videoFiles.length} 个文件`, "ok");
    if (wasEmpty || !video.src) playTrack(tracks.length - videoFiles.length);
  }

  function addUrlTrack(raw) {
    const url = raw.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      showToast("请输入以 http:// 或 https:// 开头的链接", "error");
      return;
    }
    tracks.push({ name: nameFromUrl(url), url, isLocal: false });
    renderPlaylist();
    urlInput.value = "";
    playTrack(tracks.length - 1);
  }

  function removeTrack(i, ev) {
    if (ev) ev.stopPropagation();
    const [removed] = tracks.splice(i, 1);
    if (removed && removed.isLocal) {
      URL.revokeObjectURL(removed.url);
      objectUrls.delete(removed.url);
    }
    if (i === currentIndex) {
      video.pause();
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
    removeSubtitles();
    video.removeAttribute("src");
    video.load();
    emptyEl.style.display = "";
    centerPlay.classList.remove("show");
    playedEl.style.width = "0";
    bufferedEl.style.width = "0";
    knobEl.style.left = "0";
    vCur.textContent = "0:00";
    vDur.textContent = "0:00";
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
      num.textContent = i === currentIndex && !video.paused ? "▶" : i + 1;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = t.name;
      name.title = t.name + (t.isLocal ? "" : "（网络链接）");
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.title = "移除";
      rm.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      rm.addEventListener("click", (e) => removeTrack(i, e));
      li.append(num, name, rm);
      li.addEventListener("click", () => playTrack(i));
      playlistEl.appendChild(li);
    });
  }

  btnClear.addEventListener("click", () => {
    if (!tracks.length) return;
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.clear();
    tracks = [];
    resetPlayer();
    showToast("播放列表已清空", "ok");
  });

  /* ---------- 拖放 ---------- */
  setupDropzone(dropzone, {
    onClick: () => fileInput.click(),
    onFiles: addTracks,
  });
  // 播放器区域本身也接受拖放
  setupDropzone(stage, { onClick: () => {}, onFiles: addTracks });
  fileInput.addEventListener("change", () => {
    addTracks(Array.from(fileInput.files || []));
    fileInput.value = "";
  });
  btnUrl.addEventListener("click", () => addUrlTrack(urlInput.value));
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addUrlTrack(urlInput.value);
  });

  /* ---------- 按钮 ---------- */
  vPlay.addEventListener("click", togglePlay);
  vNext.addEventListener("click", playNext);
  vPrev.addEventListener("click", playPrev);

  /* ---------- 键盘快捷键 ---------- */
  window.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    switch (e.key.toLowerCase()) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "arrowright":
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
        break;
      case "arrowleft":
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      case "arrowup":
        e.preventDefault();
        vVolume.value = Math.min(100, Number(vVolume.value) + 5);
        vVolume.dispatchEvent(new Event("input"));
        break;
      case "arrowdown":
        e.preventDefault();
        vVolume.value = Math.max(0, Number(vVolume.value) - 5);
        vVolume.dispatchEvent(new Event("input"));
        break;
      case "m":
        vMute.click();
        break;
      case "f":
        toggleFullscreen();
        break;
      case "p":
        vPip.click();
        break;
      case "s":
        snapshot();
        break;
    }
  });

  preventPageDragOpen();
  paintRange(vVolume);
})();
