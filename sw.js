/* ==========================================================
   精进群工具箱测试 — Service Worker
   文档与代码（html/js/css/json）：网络优先 → 缓存兜底（更新即时可见）
   图片与视频等大文件：缓存优先（离线可用、省流量）
   ========================================================== */
"use strict";

const CACHE = "jjq-toolbox-v30";
const PRECACHE = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./css/style.css",
  "./js/app.js",
  "./js/admin.js",
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

/* 文档/代码类：网络优先（保证更新传播），失败回退缓存（离线可用） */
function networkFirst(request) {
  return fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  }).catch(() => caches.match(request).then((hit) => hit || Response.error()));
}

/* 大文件（视频/图片）：缓存优先 */
function cacheFirst(request) {
  return caches.match(request, { ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    return fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    });
  });
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  const isDocLike =
    e.request.mode === "navigate" ||
    /\.(html|js|css|json)$/.test(url.pathname) ||
    url.pathname === "./" || url.pathname === "/";

  if (isDocLike) {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(cacheFirst(e.request).catch(() => {
      if (e.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }));
  }
});
