# AIGC 工具箱

一个纯浏览器端运行的媒体工具箱网站：**零依赖、零构建、零上传**。所有功能都在你的浏览器本地完成，媒体文件不会离开你的电脑。

## 内置工具

| 工具 | 功能 |
| --- | --- |
| 🎵 音频播放器 | 本地文件/网络链接、播放列表、四种循环模式、倍速、音量、实时频谱可视化、键盘快捷键 |
| 🎬 视频播放器 | 自定义控制栏、进度拖拽与悬停预览、缓冲显示、倍速、画中画、全屏、视频截图、本地 .vtt 字幕 |
| 📊 媒体信息查看 | 拖入文件即查看时长、分辨率、宽高比、码率、MIME 类型等详细信息 |

## 本地预览

最简单的方式：直接双击 `index.html` 用浏览器打开。

也可以启动一个本地静态服务器（更接近线上环境）：

```bash
# 任选其一，在项目根目录执行
python -m http.server 8000
npx serve .
```

然后访问 <http://127.0.0.1:8000>。

## 发布到网上

### 方式一：GitHub Pages（免费）

1. 注册/登录 [GitHub](https://github.com)，点击右上角 **+** → **New repository**
2. 仓库名随意（如 `aigc-toolbox`），选择 **Public**，点击 **Create repository**
3. 上传文件：在仓库页面点 **uploading an existing file**，把本目录下所有文件拖进去（保留文件夹结构 `css/`、`js/`、`tools/`），提交
   - 或者用命令行：
     ```bash
     git init
     git add .
     git commit -m "AIGC 工具箱"
     git branch -M main
     git remote add origin https://github.com/<你的用户名>/aigc-toolbox.git
     git push -u origin main
     ```
4. 进入仓库 **Settings** → **Pages** → **Branch** 选择 `main` / `root` → **Save**
5. 等待 1~2 分钟，访问 `https://<你的用户名>.github.io/aigc-toolbox/` 即可

### 方式二：Vercel（免费，自动部署）

1. 先把代码推到 GitHub 仓库（同上第 3 步）
2. 登录 [vercel.com](https://vercel.com)（可用 GitHub 账号直接登录）
3. 点击 **Add New Project** → 选择刚创建的仓库 → **Deploy**
4. 一切保持默认（自动识别为静态站点），几十秒后即可获得一个 `xxx.vercel.app` 的网址
5. 之后每次向 GitHub 推送更新，Vercel 会自动重新部署

> Netlify 的流程与 Vercel 几乎一致，任选其一即可。

## 如何新增一个工具

1. 在 `tools/` 下新建 `xxx.html`（可复制任意现有页面作为模板）
2. 在 `js/` 下新建对应脚本并引入
3. 打开 `index.html`，复制一张 `tool-card` 卡片，改图标、标题、简介和链接即可上线

## 素材致谢

- 演示视频：Big Buck Bunny © Blender Foundation | www.blender.org，[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/) 授权
- 演示音频：本站自行合成的短旋律（无版权限制）

## 技术说明

- 纯 HTML/CSS/JavaScript，无任何框架与 CDN 依赖，离线可用
- 本地文件通过 `URL.createObjectURL` 在浏览器内播放，**不会上传到任何服务器**
- 网络链接播放受目标站点的跨域（CORS）策略影响：
  - 绝大多数直链（.mp3 / .mp4 等）可以正常播放
  - 跨域视频的**截图**、跨域音频的**频谱**会被浏览器安全策略禁止，页面中已做提示
- 视频格式受浏览器解码能力限制（Chrome/Edge 推荐 MP4/H.264、WebM；MKV/AVI 等容器多数浏览器不支持）

## 目录结构

```
index.html              首页（工具导航）
css/style.css           全局样式
js/utils.js             公共工具函数
js/audio-player.js      音频播放器逻辑
js/video-player.js      视频播放器逻辑
js/media-info.js        媒体信息查看器逻辑
tools/audio.html        音频播放器页面
tools/video.html        视频播放器页面
tools/media-info.html   媒体信息查看器页面
```
