/* ==========================================================
   AIGC 工具箱 — Service Worker
   策略：静态资源缓存优先；页面导航离线时回退首页；
   访问过的媒体（演示音视频等）运行时缓存，支持离线回看
   ========================================================== */
"use strict";

const CACHE = "aigc-toolbox-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./css/style.css",
  "./js/utils.js",
  "./js/audio-player.js",
  "./js/video-player.js",
  "./js/media-info.js",
  "./tools/audio.html",
  "./tools/video.html",
  "./tools/media-info.html",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 只接管同源请求

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          // 拷贝一份进缓存（含演示音视频，首次访问后即可离线播放）
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => {
        // 离线且未缓存时的兜底
        if (e.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      });
    })
  );
});
