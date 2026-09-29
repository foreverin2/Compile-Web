import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody, braceBlock } from './source-text';

/**
 * G6/T51（图鉴的手机适配）的**源码守卫**。
 *
 * ## 为什么这一份只钉"结构性事实"
 *
 * T51 改的三条都是**只有真浏览器里才看得见**的东西（门盖住了什么、单击之后详情在不在视口里、
 * 横向溢出多少像素）—— 那些读数由 CDP 夹具 `.superpowers/g6-T51/t51-cdp.mjs` 与它的
 * `run-t51-*.txt` 承担。本文件只把"改动的形状"钉住，让**变异**在源码这一层就能红：
 *
 *  1. **门要有白名单**（①）：`syncGate()` 里除 `need` 之外还必须过 `onBoardScreen()`；
 *     同时 T39 那条"门只在手机+竖屏+没旋转"的逐字断言不许被顺手改写（`const need = …` 原样）。
 *  2. **换屏要重算门**：门挂在 `document.body`、白名单看的是"当前这一屏" ⇒ `#app` 重画之后
 *     必须重算，否则从大厅进牌桌时门永远不会出现。
 *  3. **单击要有窄屏分支**（②）：`renderLibrary` 的三个入口仍各接一次 `bindClickOrDouble`
 *     （`tests/ui/library-effect-filter.test.ts` 那条源码腿钉着这个数），窄屏那条路靠
 *     `zoomPath` + `needsTapZoom()` 实现 —— 三个键各注册一次，少一个就有一条入口在窄屏上
 *     "点了没反应"。
 *  4. **窄屏那两条观感**（④）：世代 chip 的字号地板、横向溢出那条覆盖规则。
 */

// 与 `t39-touch-and-landscape.test.ts` 同款读法（本仓 `tests/node-types.d.ts` 的窄签名）
const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');

const PHONE = stripComments(read('phone-landscape.ts'));
const HOME = stripComments(read('home.ts'));
const LIB_CSS = read('styles-library-filter.css');
/** `renderLibrary` 的函数体（与 `library-effect-filter.test.ts` 同一条锚） */
const LIBRARY_BODY = HOME.slice(
  HOME.indexOf('export function renderLibrary'),
  HOME.indexOf(' * 规则图纸：1/2/3 代说明书'),
);

/** 从 `const NAME = ` 这类**箭头函数声明**处取配平块（`functionBody` 只认 `function NAME(`） */
function arrowBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `找不到锚点 ${anchor}（结构被改动？）`).toBeGreaterThan(-1);
  return braceBlock(src, at);
}

describe('G6/T51 ① · 门只在"牌桌类"页面出现（图鉴/首页/模式选择/大厅/探针页一律不拦）', () => {
  it('`syncGate()` 里除 `need` 之外还要过"这一屏是不是牌桌类"的白名单', () => {
    const body = functionBody(PHONE, 'syncGate');
    // T39 那条腿逐字钉着它 —— 本轮不许改写这一行
    expect(body, 'T39 那条"手机 + 竖屏 + 没旋转"的判据被改写了').toContain('const need = d.isPhone && d.portrait && !d.rotated;');
    expect(body, 'syncGate 里没有牌桌类白名单（变异 M1：门又变成全局的）').toContain('!onBoardScreen()');
    expect(body, '白名单那一支没有摘门').toContain('removeGate();');
  });

  it('白名单判据 = 牌桌根节点 + 草稿屏，且重画中间态沿用上一次判定（不许把门反复摘了又装）', () => {
    expect(PHONE).toContain("const BOARD_SCREEN_SEL = '.board, .net-board, .hand.self, .draft-screen';");
    const body = functionBody(PHONE, 'onBoardScreen');
    expect(body, '白名单函数没查那个选择器').toContain('document.querySelector(BOARD_SCREEN_SEL) !== null');
    expect(body, '非牌桌屏的标记不见了（授权屏/首页/大厅那一族）').toContain('document.querySelector(PLAIN_SCREEN_SEL) !== null');
    expect(body, '两个都没命中时没有沿用上一次的判定（牌桌每帧重画 ⇒ 门会反复摘掉又装上、真输入点不动）')
      .toContain('return boardScreenLatch;');
  });

  it('`#app` 重画之后要重算门（换屏那一刻门必须跟上）', () => {
    expect(PHONE, 'MutationObserver 里没重算门 ⇒ 从大厅进牌桌时门不会出现')
      .toContain('new MutationObserver(() => { syncGate(); scheduleFit(); })');
  });
});

describe('G6/T51 ② · 窄屏/触摸视口单击就给看得见的反馈（桌面一个字节不变）', () => {
  it('窄屏判据写在 `needsTapZoom()` 里：触摸能力 + 可见视口宽度两条同时成立', () => {
    expect(LIBRARY_BODY, 'renderLibrary 里没有窄屏单击分支').toContain('const TAP_ZOOM_MAX_W = 1100;');
    const body = arrowBody(LIBRARY_BODY, 'const needsTapZoom = ');
    expect(body, '没有看触摸能力').toContain("matchMedia('(pointer: coarse)')");
    expect(body, '没有看 hover: none').toContain("matchMedia('(hover: none)')");
    expect(body, '没有看 maxTouchPoints').toContain('navigator.maxTouchPoints');
    // 手机横屏实测 innerWidth 1516 而 visualViewport 844 ⇒ 必须用后者
    expect(body, '宽度判据用了 innerWidth（手机横屏会把它判成宽屏）').toContain('window.visualViewport');
    expect(body, '没有宽度上限的比较').toContain('w <= TAP_ZOOM_MAX_W');
  });

  it('三个入口各注册一次放大路径，`togglePin` 在窄屏上改走它（少一个就有一条入口点了没反应）', () => {
    const sets = LIBRARY_BODY.match(/zoomPath\.set\(/g) ?? [];
    expect(sets.length, '`zoomPath.set(` 的调用点数（协议未编译 / 已编译 / 卡牌 三类各一处）').toBe(3);
    const body = arrowBody(LIBRARY_BODY, 'const togglePin = ');
    expect(body, '窄屏分支不在 togglePin 里').toContain('if (needsTapZoom())');
    expect(body, '窄屏分支取不到放大路径').toContain('zoomPath.get(key)');
    expect(body, '取到放大路径之后没有改走它').toContain('zoom(); return;');
    // 桌面那条路（单击固定）仍在：`togglePin` 的原逻辑没有被顶掉
    expect(body).toContain('if (libPinnedKey === key)');
  });

  it('三个入口仍是 `bindClickOrDouble`（`library-effect-filter` 那条源码腿钉着 3 次）', () => {
    expect((LIBRARY_BODY.match(/bindClickOrDouble\(/g) ?? []).length).toBe(3);
    for (const key of ['faceKey', 'faceCKey', 'cardKey']) {
      expect(LIBRARY_BODY, `${key} 的单击固定接线不在了`).toContain(`() => togglePin(${key})`);
    }
  });
});

describe('G6/T51 ④ · 图鉴窄屏：世代 chip 字号地板 + 横向溢出覆盖', () => {
  it('世代 chip 在图鉴屏上有 >= 10px 的字号地板（原来解出来 9.12px = 0.12 × 76px）', () => {
    // 锚点必须带 ` {`：文件头注释里也提到了这个选择器（不带 ` {` 会切到注释里，判据变成假绿）
    const at = LIB_CSS.indexOf('.library-screen .draft-filter-chip {');
    expect(at, '没有 `.library-screen .draft-filter-chip { … }` 这条字号地板规则').toBeGreaterThan(-1);
    const body = LIB_CSS.slice(at, LIB_CSS.indexOf('}', at));
    expect(body, '字号地板没写 max(10px, …)').toContain('font-size: max(10px,');
  });

  it('窄屏横向溢出那条覆盖写在 <= 1100px 的媒体查询里，且只动图鉴那一族的盒子', () => {
    const at = LIB_CSS.indexOf('/* ===== G6/T51');
    expect(at, '找不到 T51 追加的窄屏覆盖块（结构被改动？）').toBeGreaterThan(-1);
    const block = LIB_CSS.slice(at);
    expect(block, 'T51 的覆盖块没有媒体查询').toContain('@media (max-width: 1100px)');
    expect(block, '没有针对溢出元凶的规则').toContain('.library-screen');
  });
});
