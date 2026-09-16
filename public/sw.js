/* Compile 译世界 · Service Worker（G3 Task 8；设计稿 §8.1 / §8.4 的"网页 / PWA"行）
 *
 * **classic script**（不是 ES module）：兼容性优先，不需要 `type: 'module'` 注册参数。
 * **手写、零依赖**：没有 workbox、没有 vite-plugin-pwa，也没有任何 import。
 *
 * 它做什么：把构建期生成的 `sw-manifest.json`（由 scripts/gen-sw-manifest.mjs 扫描 dist/
 * 产出，版本键 = 全部文件内容的哈希）里的**程序文件**预缓存起来，于是断网也能打开页面。
 *
 * 它**绝不**做什么（红线 1 的边界，有文本腿守卫）：本文件是纯技术代码，**不出现任何本地存储
 * API 的名字**，也不碰用户数据、不做任何统计上报；
 *   · 不请求任何跨域地址；
 *   · install 时**不**自动跳到激活（见下）—— 新版本要等用户在"有新版本可用"条上点"立即更新"，
 *     否则会在对局进行中把页面换成新代码（§8.4 的"提示 → skipWaiting + reload"里的"提示"）。
 *
 * 已知边界（诚实记录）：
 *   · 首次部署到一个**已经访问过**的用户时，旧 SW 会先接管一次页面（SW 的固有语义，无法消除）；
 *   · 只缓存 app shell 与 public/ 资产 —— **联机对战需要网络**，本 SW 不会、也不该让它离线可玩。
 */

const MANIFEST_URL = new URL('sw-manifest.json', self.location.href).href;
const CACHE_PREFIX = 'compile-';

/** 当前版本号（由清单带进来）。activate 清理旧缓存时要和它比较。 */
let CURRENT_VERSION = null;

/**
 * 只处理**同源 GET**：跨域请求一律放行走网络（不缓存、不拦截）。
 * 返回 false 表示"这个请求不归我管"。
 */
function isHandled(req) {
  // 只处理 GET（HEAD/POST 等一律放行走网络）
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false; // 跨域一律放行，不缓存、不拦截
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`sw-manifest.json 取不到（HTTP ${res.status}）`);
    const manifest = await res.json();
    CURRENT_VERSION = manifest.version;
    const cache = await caches.open(CACHE_PREFIX + manifest.version);
    await cache.addAll(manifest.files);
    // ⚠️ 这里刻意**不**主动跳过等待：新版本要等用户在更新条上点"立即更新"（见 message 事件）。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_PREFIX + CURRENT_VERSION);
    await Promise.all(stale.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* 一键更新的另一半：页面里的 src/ui/pwa-update.ts 发这条消息，我们才接管。 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!isHandled(req)) return;

  // 导航请求：网络优先（保证拿到最新 HTML），断网回退预缓存的 shell。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // 静态资源：缓存优先，未命中再走网络（同源 GET）。
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    return fetch(req);
  })());
});
