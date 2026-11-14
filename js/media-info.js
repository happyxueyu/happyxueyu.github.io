/* ==========================================================
   AIGC 工具箱 — 媒体信息查看器
   用临时 <video>/<audio> 元素读取元数据，全部在本地完成
   ========================================================== */
"use strict";

(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const infoEmpty = document.getElementById("info-empty");
  const infoGrid = document.getElementById("info-grid");

  let lastUrl = null;

  setupDropzone(dropzone, {
    onClick: () => fileInput.click(),
    onFiles: (files) => { if (files[0]) analyze(files[0]); },
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) analyze(fileInput.files[0]);
    fileInput.value = "";
  });
  preventPageDragOpen();

  function row(key, value) {
    const div = document.createElement("div");
    div.className = "info-item";
    const k = document.createElement("div");
    k.className = "k";
    k.textContent = key;
    const v = document.createElement("div");
    v.className = "v";
    v.textContent = value;
    div.append(k, v);
    return div;
  }

  /** 用媒体元素探测元数据，返回 Promise<meta> */
  function probeMedia(url, isVideo) {
    return new Promise((resolve) => {
      const el = isVideo ? document.createElement("video") : document.createElement("audio");
      el.preload = "metadata";
      el.muted = true;
      const meta = {
        duration: null,
        width: null,
        height: null,
        hasAudio: null,
        ok: false,
      };
      const finish = (ok) => {
        meta.ok = ok;
        resolve(meta);
        el.removeAttribute("src");
        el.load();
      };
      el.addEventListener("loadedmetadata", () => {
        meta.duration = isFinite(el.duration) ? el.duration : null;
        if (isVideo) {
          meta.width = el.videoWidth || null;
          meta.height = el.videoHeight || null;
          // 是否含音轨的通用探测（各浏览器实现不一）
          if (typeof el.webkitAudioDecodedByteCount === "number") {
            meta.hasAudio = el.webkitAudioDecodedByteCount > 0;
          } else if (el.audioTracks) {
            meta.hasAudio = el.audioTracks.length > 0;
          } else if (typeof el.mozHasAudio === "boolean") {
            meta.hasAudio = el.mozHasAudio;
          }
        }
        finish(true);
      });
      el.addEventListener("error", () => finish(false));
      setTimeout(() => finish(false), 7000);
      el.src = url;
    });
  }

  async function analyze(file) {
    if (!isMediaFile(file)) {
      showToast("请选择音频或视频文件", "error");
      return;
    }
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(file);

    // 先展示文件基础信息
    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mkv|mov|m4v|ogv)$/i.test(file.name);
    infoEmpty.style.display = "none";
    infoGrid.style.display = "";
    infoGrid.innerHTML = "";
    infoGrid.append(
      row("文件名", file.name),
      row("文件大小", formatBytes(file.size)),
      row("MIME 类型", file.type || "未知"),
      row("最后修改", new Date(file.lastModified).toLocaleString("zh-CN")),
      row("媒体类型", "解析中…"),
    );

    const meta = await probeMedia(lastUrl, isVideo);
    if (!meta.ok) {
      infoGrid.replaceChild(row("媒体类型", "浏览器无法解码该文件"), infoGrid.lastChild);
      showToast("该文件的媒体信息无法解析（可能编码不受浏览器支持）", "error", 3200);
      return;
    }

    const bitrateKbps = meta.duration ? Math.round((file.size * 8) / meta.duration / 1000) : null;
    infoGrid.replaceChild(row("媒体类型", isVideo ? "视频" : "音频"), infoGrid.lastChild);

    if (meta.duration != null) infoGrid.append(row("时长", formatTime(meta.duration) + `（${meta.duration.toFixed(2)} 秒）`));
    if (isVideo) {
      if (meta.width) infoGrid.append(row("分辨率", `${meta.width} × ${meta.height}`));
      if (meta.width && meta.height) {
        infoGrid.append(row("宽高比", aspectRatio(meta.width, meta.height)));
      }
      if (meta.hasAudio !== null) infoGrid.append(row("音轨", meta.hasAudio ? "包含" : "无"));
    }
    if (bitrateKbps) infoGrid.append(row("整体码率（估算）", bitrates(bitrateKbps)));
    showToast("解析完成", "ok", 1500);
  }

  function bitrates(kbps) {
    return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbps` : `${kbps} Kbps`;
  }

  function aspectRatio(w, h) {
    const g = (a, b) => (b ? g(b, a % b) : a);
    const d = g(w, h) || 1;
    const rw = w / d, rh = h / d;
    // 常见比例用惯用叫法标注
    const ratio = (w / h).toFixed(3);
    const common = {
      "1.778": "16:9（宽屏）",
      "1.333": "4:3（传统）",
      "1.000": "1:1（方形）",
      "0.563": "9:16（竖屏）",
      "2.370": "21:9（超宽）",
      "1.500": "3:2",
      "1.600": "16:10",
    };
    return common[ratio] || `${rw}:${rh}`;
  }
})();
