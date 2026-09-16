/* Compile 译世界 · Service Worker（G3 Task 8；设计稿 §8.1 / §8.4 的"网页 / PWA"行）
 *
 * **classic script**（不是 ES module）：兼容性优先，不需要 `type: 'module'` 注册参数。
 * **手写、零依赖**：没有 workbox、没有 vite-plugin-pwa，也没有任何 import。
 *
 * 它做什么：把构建期生成的 `sw-manifest.json`（由 scripts/gen-sw-manifest.mjs 扫描 dist/
 * 产出，版本键 = 全部文件内容的哈希）里的 **app shell**（HTML/JS/CSS/图标 —— 设计稿 §8.1 的
 * 原话）预缓存起来，于是断网也能打开页面。
 *   · 大体积卡图 / 规则 PDF / 音效**不预缓存**（它们由下面的 `fetch` 走网络正常加载）。
 *     理由：`cache.addAll` 是原子的，几百 MiB 的预缓存里任何一个 404 都会拖垮整次 install。
 *   · install 失败**不静默**：广播 `CACHE_INCOMPLETE` 给页面（`src/ui/pwa-update.ts` 把它
 *     变成可观察状态），并让 install 失败 —— 旧 SW 与旧缓存继续生效，绝不换上空的缓存。
 *
 * 它**绝不**做什么（红线 1 的边界，有文本腿守卫）：本文件是纯技术代码，**不出现任何本地存储
 * API 的名字**（`localStorage` / `indexedDB` / `sessionStorage`），也不碰用户数据、不做任何统计上报；
 *   · 不请求任何跨域地址；
 *   · install 时**不**自动跳到激活（见下）—— 新版本要等用户在"有新版本可用"条上点"立即更新"，
 *     否则会在对局进行中把页面换成新代码（§8.4 的"提示 → skipWaiting + reload"里的"提示"）。
 *
 * 已知边界（诚实记录）：
 *   · 首次部署到一个**已经访问过**的用户时，旧 SW 会先接管一次页面（SW 的固有语义，无法消除）；
 *   · 预缓存只有 app shell ⇒ **首次离线时卡图/规则 PDF 打不开**（没被请求过就没进任何缓存）。
 *     预缓存它们代价是 358.8 MiB / 437 文件（评审实测），太贵且 install 失败面太大，故不收；
 *   · **联机对战需要网络**，本 SW 不会、也不该让它离线可玩。
 */

const MANIFEST_URL = new URL('sw-manifest.json', self.location.href).href;
const CACHE_PREFIX = 'compile-';
/**
 * 当前版本号的**构建期占位符**（G3 Task 8 修复轮 2 / 评审 N-2）。
 *
 * 为什么要有它：`vite build` 只是把 `public/sw.js` **原样拷**进 `dist/`，所以只要没人改
 * `sw.js` 的字节，浏览器就**不会重新安装** SW —— 于是"只发内容"（改 HTML/JS/CSS、加文件、
 * 重生成清单）这种**正常发布**永远不触发更新提示，离线也永远停在旧版本（评审 N-2 真 Chrome
 * 三步实测）。`scripts/gen-sw-manifest.mjs` 在写清单之后把清单的 `version` **写进
 * `dist/sw.js` 的本行**（占位符恰好一处；缺席就大声失败）。这样：内容变 ⇒ 清单版本变 ⇒
 * `dist/sw.js` 字节变 ⇒ 浏览器重装 SW ⇒ 预缓存新版本 + 提示条 + activate 清理旧缓存。
 *
 * 这个字面量（连同下面 `CURRENT_VERSION` 的读取点）是 **install / activate 之间的唯一版本来源**：
 * install 用清单版本建缓存并赋值；activate 与它比较，删掉**可证明过时**的完整旧缓存（见 activate 段）。
 * ⚠️ 它在本文件里**恰好出现一次**（就在下面那行）：生成器按"恰好一处"校验，多处会让"版本戳
 * 写不干净"变成静默的半成品。
 */
let CURRENT_VERSION = '__SW_VERSION__';

/** 版本号必须是清单那种 16 位十六进制内容哈希 —— 占位符、null、空串一律不算"可用版本"。 */
function isRealVersion(v) {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

/**
 * 清单里内嵌的版本标记项。**为什么要有它**（评审 S-4）：
 * 版本号此前只活在模块级变量里 —— 若 `activate` 落在**没有跑过 install** 的 SW 实例里
 * （浏览器评估并重启 SW、或任何 install/activate 不在同一实例的路径），`CURRENT_VERSION`
 * 是 null，于是 `'compile-' + null` = `compile-null`，把**所有** `compile-*` 缓存（含本该保留
 * 的那份）都当旧缓存删掉。现在版本号随预缓存一起**落在缓存里**（一个静态标记项，不是用户数据），
 * `activate` 只在**有版本标记**的缓存之间比新旧；`CURRENT_VERSION` 不可用时**一份完整缓存都不删**
 * （保守），而**没有标记**的缓存永远删（它不可能是可用的离线壳）。
 */
const VERSION_MARKER = './sw-version';
const VERSION_MARKER_URL = new URL(VERSION_MARKER, self.location.href).href;

/**
 * 预缓存失败时要告诉页面的消息类型。`src/ui/pwa-update.ts` 里有同名常量（唯一出处），
 * 那边还有一条文本腿断言两边**逐字一致**（sw.js 是 classic script，不能 import 那边）。
 */
const CACHE_INCOMPLETE = 'COMPILE_CACHE_INCOMPLETE';

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

/** 从缓存里读版本号（读不到返回 null）。 */
async function readMarker(cache) {
  const hit = await cache.match(VERSION_MARKER_URL);
  if (!hit) return null;
  const v = (await hit.text()).trim();
  return v.length > 0 ? v : null;
}

/** 把版本号写进缓存（预缓存**全部成功之后**才写，于是"有标记"= 这份缓存是完整的）。 */
async function writeMarker(cache, version) {
  await cache.put(VERSION_MARKER_URL, new Response(String(version), { headers: { 'content-type': 'text/plain' } }));
}

/**
 * 预缓存失败时**不静默**（评审重要 2）：广播给所有页面窗口，`src/ui/pwa-update.ts` 把它
 * 变成状态机里的 `cache-incomplete`（用户/诊断能看到"离线缓存未完成"）。
 * 通知本身失败不影响 SW 的其它职责。
 */
async function notifyCacheIncomplete(reason) {
  try {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) c.postMessage({ type: CACHE_INCOMPLETE, reason });
  } catch (e) {
    // 通知失败不能再抛（否则 waitUntil 被拒，install 又变成静默失败）
  }
}

/**
 * install：只预缓存**app shell**（清单由 scripts/gen-sw-manifest.mjs 生成，已排除大体积卡图/PDF）。
 *
 * ⚠️ 失败**不再静默**（重要 2）：`cache.addAll` 是原子的，437 项 / 358.8 MiB 的年代里
 * 任何一个 404/弱网/配额都会让整次 install 抛错、`waitUntil` 被拒，而**用户和开发者都收不到
 * 任何提示**。现在失败时：① 广播 `CACHE_INCOMPLETE` 给页面（状态机可见）；
 * ② 主动 `throw`，让这次 install 失败、**旧 SW 与旧缓存继续生效**（绝不换上空的/半截的缓存）。
 */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`sw-manifest.json 取不到（HTTP ${res.status}）`);
      const manifest = await res.json();
      // 版本号的**权威来源仍是清单**（构建期占位符只是为了让本文件的字节随内容变化；
      // 两者逐字相同 —— `scripts/gen-sw-manifest.mjs` 用同一个 version 同时写清单与这里）。
      CURRENT_VERSION = manifest.version;
      const cache = await caches.open(CACHE_PREFIX + manifest.version);
      await cache.addAll(manifest.files);
      await writeMarker(cache, manifest.version);
    } catch (e) {
      await notifyCacheIncomplete(e instanceof Error ? e.message : String(e));
      throw e;
    }
    // ⚠️ 这里刻意**不**主动跳过等待：新版本要等用户在更新条上点"立即更新"（见 message 事件）。
  })());
});

/**
 * activate：删掉**可证明过时**的完整旧缓存，然后 claim。
 *
 * ## 判据（修复轮 2 / 评审 N-1 的整改）
 * 「当前是哪个版本」**只认** `CURRENT_VERSION`（构建期占位符注入 + install 时由清单赋值），
 * **绝不**再从 `caches.keys()` 反推。上一版把 "当前版本" 算成 `caches` 里**所有**带标记版本的
 * 集合，于是 `!versions.has(x.version)` 对任何带标记的缓存**恒为假** ⇒ 完整旧缓存**永远删不掉**
 * （真 Chrome 后果：点完"立即更新"再断网，拿到的还是上一版的壳；Cache Storage 每次发布净增
 * 约 1 MiB 永不回收）。这条能力 `0e3fdbe` 是有的，是修复轮弄丢的回归。
 *
 * 三条规则，按优先级：
 *  1. 版本号**可用**（`isRealVersion`：清单那种 16 位十六进制内容哈希）⇒ 保留
 *     `CACHE_PREFIX + CURRENT_VERSION` **恰好那一份**，删掉其余**完整**（有版本标记）缓存。
 *     这满足计划 `:2445`「activate：删掉旧版本缓存」。
 *  2. 版本号不可用（`null`/空/占位符 —— 没被注入、或 activate 落在没跑过 install 的实例里）⇒
 *     **什么完整缓存都不删**（保守：宁可留下旧缓存，也不能把正在用的那份删掉）。这是 S-4 的直接目标。
 *  3. **无版本标记**的缓存（没跑完 install 的"半截"缓存，含 `compile-null` 形态）**总是删** ——
 *     它不可能被 `cache.match` 用作离线内容（没有标记就没有完整的 app shell）。
 *
 * ⚠️ `CACHE_PREFIX + CURRENT_VERSION` 这个**写法**本身是正确的（有第 2 条守卫时它恒不等于
 * `compile-null`）—— 仓内曾有一条 `not.toMatch(/CACHE_PREFIX\s*\+\s*CURRENT_VERSION/)` 的文本
 * 禁止，把这条唯一自然的正确写法也一起禁掉了（评审变异 M-G：行为改对了、文本腿反而变红）。
 * 现在那条禁止已换成下面第 5 组的**行为腿**（真跑 install+activate），不再看写法。
 */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const mine = names.filter((n) => n.startsWith(CACHE_PREFIX));
    const entries = [];
    for (const n of mine) entries.push({ name: n, version: await readMarker(await caches.open(n)) });
    // 注意第 2 条：`CURRENT_VERSION` 不可用（null / 空串 / **没被替换的模板占位符**）时，
    // 一份**完整**缓存都不删 —— 否则就是 S-4 的 compile-null 类事故（把正在用的那份也删了）。
    // 未打戳的模板走的就是这条路：占位符不是 16 位十六进制 ⇒ isRealVersion 为假 ⇒ current = null。
    const current = isRealVersion(CURRENT_VERSION) ? CURRENT_VERSION : null;
    const stale = entries
      .filter((x) => x.version === null || (current !== null && x.name !== CACHE_PREFIX + current))
      .map((x) => x.name);
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
  // ⚠️ 命中不到就**只走网络、绝不写缓存**：这里若 `cache.put(...)` 就等于把玩家请求过的
  // 任何同源响应（可能含用户数据形态的响应）写进 Cache Storage，而 `src/app/privacy.ts`
  // 的 `offlineCacheNote` 向玩家承诺"缓存的不是用户数据"。本文件里**唯一**的缓存写入点是
  // install 段的 `cache.addAll(manifest.files)`（预缓存清单里的静态资产）与它后面的版本标记。
  // `tests/ui/pwa-update.test.ts` 有一条腿按"写法出现的位置"钉住这件事（评审假守卫 M12）。
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    return fetch(req);
  })());
});
