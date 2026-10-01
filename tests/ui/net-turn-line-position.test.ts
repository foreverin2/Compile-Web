/**
 * **2026-10-01 用户真机反馈（第 1 件）：把「轮到谁」那一行挪到「当前连接：…」正上方。**
 *
 * ## 用户原话（照抄，供后来的人对照）
 *
 * "看我图中选中的左下角那行字（就是那句『现在轮到对方选协议（第 1 步，共 5 步）—— 等他选』），
 * 我希望给他挪到『当前连接：直连』的上方，方便查看"。
 *
 * ## 改之前它为什么在左下角（缺陷形态）
 *
 * `appendNetTurnLine()` 从前只写类名、**一个样式都不给** ⇒ 它是流内 `div`，排在渲染器画的那一帧
 * **之后**（整页最末尾）⇒ 落在协议池下方、页面左下角。
 *
 * ## 这个文件钉的三半
 *
 *  1. **产出节点自带行内定位**（与 `.net-conn-line` 的 `LINE_STYLE` **同一族写法**：
 *     `position: fixed` + `left: 50%` + `translateX(-50%)` + `pointer-events: none`）
 *     ⇒ 它不再进文档流、不再被"渲染器画了多长的一页"决定位置；
 *  2. **`bottom` 比连接行大、且两行不叠字**（断言用**算术**：连接行自己的行内 `bottom`/`font-size`/
 *     `line-height`/`padding` 现场解出它自己的高度，本行下沿必须 ≥ 连接行上沿）；
 *     ⚠️ 这就把"连接行哪一天换了字号/内边距"也变成红 —— 两行的间距只有一个真相源（连接行自己的样式）；
 *  3. **不给 `styles.css` 加类规则**（用户授权改那一处，但本任务选了行内样式这条更小的路）：
 *     `styles.css` 里**不许**出现 `.net-turn-line` ⇒ 排掉"两套写法打架"（类规则 + 行内样式），
 *     也排掉那一族 CSS 解算腿被卷进来。
 *
 * ## 诚实边界
 *
 *  - 本文件**不**证明"真机上它看起来在哪"（那是观感，本仓无布局引擎）—— 它只证明
 *    **声明的几何**：两行在算术上不重叠、且它脱离文档流；
 *  - 那一行只在**联机局**出现（`appendTurnLine()` 第一句就是 `netGame === null` 早退）
 *    ⇒ 真浏览器里用手点出一个联机局才能看，本轮没做那次实机验收（见交付报告"未做"那一段）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installStubDom, makeStubEl } from './net-dom-stub';
import { appendNetTurnLine, NET_TURN_LINE_CLASS } from '../../src/ui/net-lobby';
import { NET_CONN_LINE_CLASS, startNetConnLine } from '../../src/ui/net-conn-line';
import { createGame, DRAFT_PICK_COUNT } from '../../src/core/state/create';

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/** 读一个桩节点的行内 `style` 字符串（桩的 `getAttribute` 记了非 `data-` 属性，R19 起）。 */
const styleOf = (n: unknown): string =>
  String((n as { getAttribute(name: string): string | null }).getAttribute('style') ?? '');

/** 从一行行内 CSS 文本里取一条声明的值（`null` = 那一条没写）。 */
const declOf = (style: string, prop: string): string | null => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style);
  return m === null ? null : m[1].trim();
};

/** `12px` → `12`；`0.78em` 这类解不出来就抛（**不许**当成 0 —— 那会让算术静默通过）。 */
const pxOf = (v: string | null, where: string): number => {
  const m = v === null ? null : /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  if (m === null) throw new Error(`${where} 不是 px 字面量（实际 ${JSON.stringify(v)}），几何断言无从算起`);
  return Number.parseFloat(m[1]);
};

/**
 * 一行"当前连接：…"的**几何**（全部从它自己的行内样式解出来，不从本文件另写常数）：
 * 高 = 字号 × 行高 + 上下内边距×2，上沿 = bottom + 高。
 */
function connLineGeom(): { bottom: number; height: number; top: number; style: string } {
  restoreDom = installStubDom();
  const root = makeStubEl('div');
  // 真件（同一个产出函数），只是把计时器与取连接的钩子注入成不跑：
  // 本用例只读样式，不关心 `getStats()` 的读数。
  startNetConnLine({
    root: root as unknown as HTMLElement,
    peerConnection: () => null,
    doc: globalThis.document,
    timer: { setInterval: () => 1, clearInterval: () => { /* 桩：不排时钟 */ } },
  });
  const line = root.children[0];
  expect(line, '起一次 startNetConnLine 之后，屏上没有那一行').toBeTruthy();
  const style = styleOf(line);
  const bottom = pxOf(declOf(style, 'bottom'), `连接行的 bottom（style=「${style}」）`);
  const fontPx = pxOf(declOf(style, 'font-size'), `连接行的 font-size（style=「${style}」）`);
  const lh = Number.parseFloat(declOf(style, 'line-height') ?? '');
  expect(Number.isFinite(lh), `连接行的 line-height 解不出倍数（style=「${style}」）`).toBe(true);
  const pad = declOf(style, 'padding') ?? '';
  const m = /^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px$/.exec(pad.trim());
  expect(m, `连接行的 padding 不是"纵 横"两值形态（实际「${pad}」）⇒ 高度算不出来`).not.toBeNull();
  const padY = Number.parseFloat(m![1]);
  const height = fontPx * lh + padY * 2;
  return { bottom, height, top: bottom + height, style };
}

describe('★★ 2026-10-01：那一行钉在「当前连接：…」正上方（行内 fixed，与连接行同一套做法）', () => {
  it('产出节点自带那一族行内样式（脱离文档流 + 左右居中 + 不抢点击 + 不换行）', () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    // 草稿相那一格（本用例只关心样式，文案由 `net-turn-line.test.ts` 钉）
    appendNetTurnLine(root as unknown as HTMLElement, 'draft', 0, 1, 0, 2);
    const line = root.children[0];
    expect(line, '那一行没有挂到 root 上').toBeTruthy();
    expect(line.cls, '类名不是唯一那一个').toContain(NET_TURN_LINE_CLASS);
    const style = styleOf(line);
    for (const decl of [
      'position: fixed',
      'left: 50%',
      'transform: translateX(-50%)',
      'pointer-events: none',
      'white-space: nowrap',
    ]) {
      expect(style, `那一行的行内样式里没有 \`${decl}\`（不占流 / 居中 / 不抢点击这几条就没了机检）`)
        .toContain(decl);
    }
  });

  it('两行不叠字：本行下沿 ≥ 连接行上沿，且间距不超过一个行高（太远就不算"正上方"）', () => {
    const conn = connLineGeom();
    restoreDom?.();
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    appendNetTurnLine(root as unknown as HTMLElement, 'draft', 0, 0, 0, 0);
    const style = styleOf(root.children[0]);
    const bottom = pxOf(declOf(style, 'bottom'), `那一行的 bottom（style=「${style}」）`);
    // 反空转：两行同字号（`font-size` 必须一致，否则"高度"这套算术比较的不是同一件事）
    expect(declOf(style, 'font-size'), '本行与连接行的字号不一致（两行的行盒高不再可比）')
      .toBe(declOf(conn.style, 'font-size'));
    expect(bottom,
      `本行下沿离视口底 ${bottom}px < 连接行上沿 ${conn.top}px ⇒ 两行叠字（改前它就是流内元素，`
      + `连接行的行内样式：${conn.style}）`).toBeGreaterThanOrEqual(conn.top);
    expect(bottom,
      `本行离连接行 ${bottom - conn.top}px 远（超过一个连接行高 ${conn.height.toFixed(1)}px）`
      + '⇒ 不满足用户要的"上方、方便对照着看"').toBeLessThanOrEqual(conn.top + conn.height);
  });

  it('对局相那一格也是同一份行内样式（两相共用同一个产出函数 ⇒ 不许只有草稿相挪了）', () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    appendNetTurnLine(root as unknown as HTMLElement, 'turn', 0, 0, 0, DRAFT_PICK_COUNT);
    const style = styleOf(root.children[0]);
    expect(style, '对局相那一格的定位不是 fixed（它仍会随页面长度跑到左下角）').toContain('position: fixed');
    expect(declOf(style, 'bottom'), '对局相那一格没有 bottom（位置由文档流决定）').not.toBeNull();
  });

  it('★ 不给 `styles.css` 加类规则：那一行只有行内样式这一个真相源（不留两套写法打架）', () => {
    const css = readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)))
      .subarray(0, 8 * 1024 * 1024).toString('utf8');
    // 反空集合：真的读到了样式表（读成空文件时下面那条会以"没找到"的形式假绿）
    expect(css.length, 'styles.css 读成空文件 ⇒ 这条腿假绿').toBeGreaterThan(10000);
    expect(css, 'styles.css 里出现了 .net-turn-line —— 两套写法（类规则 + 行内样式）会打架，'
      + '而本轮的定位口径是行内样式那一套').not.toContain('.net-turn-line');
    expect(css, '连接行的类名也不该出现在 styles.css 里（它与本行同一套口径）')
      .not.toContain('.' + NET_CONN_LINE_CLASS);
  });
});

/** 反空转：夹具本身能证"连接行确实解出几何"，否则上面那条比较可能是在比两个 0。 */
describe('★★ 2026-10-01：夹具自检（连接行的几何必须真的解出来）', () => {
  it('连接行解出的 bottom / 高度 / 上沿都是正数且与它的字号一致', () => {
    const conn = connLineGeom();
    expect(conn.bottom, '连接行的 bottom 解出来不是正数（夹具坏了）').toBeGreaterThan(0);
    expect(conn.height, '连接行的行盒高解出来不是正数（夹具坏了）').toBeGreaterThan(0);
    expect(conn.top, '连接行的上沿 = bottom + 高').toBeCloseTo(conn.bottom + conn.height, 6);
    expect(createGame({ seed: 'net-turn-line-position' }).phase, '反空转：真状态造得出来')
      .toBe('draft');
  });
});
