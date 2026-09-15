import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderProtocol, syncCompiledFxLayers } from '../../src/ui/render';
import { renderNetBoard, verifyPageHooks } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import type { CardOrient } from '../../src/ui/fx-orient';
import { stripComments } from './source-text';
import {
  classListOf, descendants, drainRaf, installStubDom, isClass, makeStubEl,
  setStubRect, type StubNode,
} from './net-dom-stub';
/**
 * G2 修正 **R8-4**：**所有协议的特效跟随 ∓90° 旋转**（用户第 4 条反馈：「我还发现所有协议的
 * 特效都并没有和我之前要求的那样跟随我之前定的要求旋转过来」）。
 *
 * ## 这个文件守的是什么
 *
 * 协议 FX 的"跟着协议横躺"由**一条链**实现，链上任何一环断了，画面上都只表现为
 * "协议特效没转过来"（不报错、不抛异常）：
 *
 *   ① `render-net.ts` 的 `renderSide` 把**按座位**的标记交给 `renderProtocolCell`（第 6 实参）；
 *   ② `render.ts` 的 `renderProtocol` 把它写在 **`.protocol-holder`** 上（`data-fx-rot`）；
 *   ③ `positionCompiledFxLayer` / `playProtocolFlip` / `playRearrangeProtocolsFx` 用
 *      `fxRotDegOf`（**只读标记、不回退**）读出 ∓90°，把它变成层的 `transform`／浮层盒的旋转／
 *      幽灵内部图的朝向。
 *
 * 对应三条腿：
 *  - **行为腿（首选）**：用 `tests/ui/net-dom-stub.ts` **真跑 `renderNetBoard`**，逐协议格断言
 *    "holder 有按侧的标记，且与协议图的 `.net-rot-*` **同向**"（②③ 的输入面）；
 *    再**真跑** `positionCompiledFxLayer`（经 `renderProtocol` + `syncCompiledFxLayers`）断言
 *    "层的内联 transform 真的是 `rotate(∓90deg)`／热座形态是空串"（③ 的输出面）。
 *  - **源码腿**：`positionCompiledFxLayer` 与 `playProtocolFlip` 必须读**同一个助手**
 *    （不是各自手搓角度）；重排幽灵必须按标记归一、且**保留**热座的回退判据。
 *  - **纯函数腿**在 `tests/ui/fx-orient.test.ts`（`fxRotDegOf`，含"不回退"那条承重判据）。
 *
 * ## G2 修正 R8-4b：net 页的**每帧**同步（本文件末尾那组）
 *
 * R8-4 只解决了"角度"；本页**根本没有**每帧同步已编译层（热座那句在 `renderBoard` 里）⇒
 * 编译之后任何移动协议位置的重渲染都会让环/角光停在旧坐标上。末尾那组行为腿真跑 `renderNetBoard`
 * （含已编译协议）断言：层被**真的定位**、`transform` **严格**按侧、且**重渲染后遍历条数不增长**
 * （`compiledFxCells` 每帧复位）。
 *
 * ## 诚实边界（不许读成"几何/观感已验证"）
 *
 * 桩只维护 `class`/`dataset`/树结构，**不模拟布局**（`getBoundingClientRect` 返回测试喂的
 * 常量矩形），所以这里证明的是"标记在、值按侧、角度真的被写进内联样式"，
 * **证明不了**"1940 上看起来真的重合了"（协议 holder 100×140 旋转后视觉 140×100 与层盒的关系、
 * 层的 `transform-origin` 是否浏览器默认 50% 50%）—— 那两条是人眼项，写在实现报告里。
 */

const uiRoot = new URL('../../src/ui/', import.meta.url);
const readUi = (rel: string): string =>
  stripComments(readFileSync(fileURLToPath(new URL(rel, uiRoot))).subarray(0, 8 * 1024 * 1024).toString('utf8'));

/** 桩 `document.body`（`installStubDom()` 之后才存在）。 */
const stubBody = (): StubNode => (globalThis as unknown as { document: { body: StubNode } }).document.body;

/** 在 `node` 的子树（含自身）里找第一个带某类名的节点。 */
const firstWith = (node: StubNode, cls: string): StubNode | undefined =>
  descendants(node).find((n) => isClass(n, cls));

/* ============================================================================
 * 行为腿 A：真跑 `renderNetBoard` —— 标记的**产出**与**按侧**
 * ========================================================================== */

/**
 * 真跑一帧远程页，返回元素树（与 `render-net.test.ts` 的 `renderNetTree` 同源同参，
 * 但**不**复制它的断言面：这里只关心协议 holder 的标记）。
 *
 * ⚠️ 调用方负责 `installStubDom()` / `restore()` / `await drainRaf()`。
 */
function renderNetTree(viewSeat: 0 | 1): StubNode {
  const s = createGame({ seed: 'r8-4-protocol-fx-rot', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat, verifyHooks: false });
  return root;
}

describe('G2 修正 R8-4 · 行为腿：协议 holder 的特效朝向标记（真跑 renderNetBoard）', () => {
  it('每个 .protocol-cell 的 .protocol-holder 都带按侧的 data-fx-rot，且与协议图的 .net-rot-* 同向（两座位都跑）', async () => {
    const restore = installStubDom();
    try {
      for (const viewSeat of [0, 1] as const) {
        const root = renderNetTree(viewSeat);
        const cells = descendants(root).filter((n) => isClass(n, 'protocol-cell'));
        expect(cells.length, `viewSeat=${viewSeat}：协议格数量（3 线 × 双方）`).toBe(6);
        for (const cell of cells) {
          const player = cell.dataset.player;
          const isSelf = player === String(viewSeat);
          const who = `viewSeat=${viewSeat} 的 P${player}（${isSelf ? '自己' : '对手'}）`;
          const holder = firstWith(cell, 'protocol-holder');
          const img = firstWith(cell, 'protocol-img');
          expect(holder, `${who}：协议格里没有 .protocol-holder`).toBeTruthy();
          expect(img, `${who}：协议格里没有 .protocol-img`).toBeTruthy();
          const want = isSelf ? 'ccw' : 'cw';
          // ① 标记必须在（缺了 ⇒ fxRotDegOf 得 0 ⇒ 协议 FX 永远竖版错位 90°，且**不报错**）
          expect(holder?.dataset.fxRot,
            `${who}：holder 缺 data-fx-rot（协议特效读不到角度 ⇒ 层不旋转）`).toBe(want);
          // ② 同源：标记与协议图的**视觉**类必须同向（两处都由 isSelfSeat 派生 ⇒ 不可能脱钩）
          expect(isClass(img as StubNode, `net-rot-${want}`),
            `${who}：holder 的标记（${want}）与协议图的 ∓90° 类不同向 ⇒ 特效会与协议差 90°/180°`).toBe(true);
          // ③ 反向红线：协议图**不得**产出热座专属的 ±90° 类（那会被 orientOf 当卡面朝向读）
          const hotseatClasses = classListOf(img as StubNode).filter((c) => c === 'rot-cw' || c === 'rot-ccw');
          expect(hotseatClasses, `${who}：协议图产出了热座专属的 ±90° 类 ${hotseatClasses.join('/')}`).toEqual([]);
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('运行时自查（verifyPageHooks · 约束 10）：真跑的树上不报约束 10；摘掉一个标记后必须报出来', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    setFxViewSeat(null);
    const restore = installStubDom();
    try {
      const root = renderNetTree(0);
      const wrap = descendants(root).find((n) => isClass(n, 'net-board'));
      expect(wrap, '真跑的远程页里找不到 .net-board（自查的 scope）').toBeTruthy();
      const warnedText = (): string => warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      // ① 阳性：真跑的树上，**约束 10 不得出现在失败清单里**（这一条把"标记真的挂在 holder 上"
      //    从源码代理提升成运行期证据 —— 它与上面那条 DOM 断言互为独立的两条腿）。
      //    ⚠️ 这里**不能**要求整份自查 ✓：桩的 `queryAllIn` 有意**不支持逗号选择器组**
      //    （`NET_PAGE_HOOKS` 里 `.trash-pile.p1/.p2` 这条探测在桩上恒得 0 条 ⇒ 自查必然有
      //    别的失败项）。所以判据落在 console.warn 的**完整失败清单**上（note 只显示 fatal[0]）：
      //    并要求清单里**确实有**那条已知的桩边界失败 —— 否则"不含约束 10"会因为"清单根本没生成"
      //    而变成空断言。
      const note = verifyPageHooks(wrap as unknown as HTMLElement, 0);
      const warned = warnedText();
      expect(warned, 'warn 清单里没有那条已知的桩边界失败（逗号选择器组）—— 说明失败清单本身没生成，'
        + '"不含约束 10"就成了空断言').toContain('.trash-pile.p1/.p2');
      expect(warned, `真跑的远程页上报了约束 10（协议 holder 的标记链断了）；note=${note}`).not.toContain('约束 10');
      // ② 反面（同一棵真跑的树）：摘掉一个 holder 的标记 ⇒ 约束 10 必须报出来
      //    （没有这一条，"判据恒真"也能让上面变绿）
      warn.mockClear();
      const holders = descendants(wrap as StubNode).filter((n) => isClass(n, 'protocol-holder'));
      expect(holders.length, '真跑的远程页里协议 holder 数量').toBe(6);
      delete holders[0].dataset.fxRot;
      verifyPageHooks(wrap as unknown as HTMLElement, 0);
      expect(warnedText(), '摘掉协议 holder 的 data-fx-rot 后约束 10 没报 —— 运行时那条链没有牙齿')
        .toContain('约束 10');
    } finally {
      await drainRaf();
      restore();
      warn.mockRestore();
      info.mockRestore();
      setFxViewSeat(null);
    }
  });
});

/* ============================================================================
 * 行为腿 B：真跑 `positionCompiledFxLayer`（经 renderProtocol + syncCompiledFxLayers）
 * ========================================================================== */

/** 造一个已编译协议盒（并把 holder 标成"已入 DOM"，否则 `positionCompiledFxLayer` 直接返回）。 */
function renderCompiledProto(defId: string, orient: CardOrient, fxRot?: 'cw' | 'ccw'): StubNode {
  const box = renderProtocol({ defId, compiled: true }, 0, orient, '', fxRot) as unknown as StubNode;
  const holder = firstWith(box, 'protocol-holder');
  if (!holder) throw new Error('renderProtocol 没产出 .protocol-holder');
  // ⚠️ 桩**不**实现 `isConnected`（那是布局态；加进共用桩会改变其它用例走到的分支）。
  //    本用例只需要"这一个 holder 被当成已挂载"，故**按用例注入**，不动共用桩。
  Object.defineProperty(holder, 'isConnected', { value: true, configurable: true });
  return box;
}

/** 该 defId 的 body 级持久 FX 层（`buildCompiledFx` 挂到 document.body 的那一个）。 */
function compiledLayerOf(defId: string): StubNode | undefined {
  return descendants(stubBody())
    .find((n) => isClass(n, 'compiled-fx') && isClass(n, `compiled-fx-${defId}`));
}

describe('G2 修正 R8-4 · 行为腿：已编译持久 FX 层的内联 transform 跟着 holder 的标记', () => {
  it('标记 ccw ⇒ rotate(-90deg)；标记 cw ⇒ rotate(90deg)；无标记（热座）⇒ 空串', async () => {
    const restore = installStubDom();
    try {
      const cases: Array<{ defId: string; orient: CardOrient; marker?: 'cw' | 'ccw'; want: string }> = [
        { defId: 'r84-none', orient: 0, want: '' },                                  // 热座形态
        { defId: 'r84-self', orient: 0, marker: 'ccw', want: 'rotate(-90deg)' },     // 远程页自己
        { defId: 'r84-foe', orient: 180, marker: 'cw', want: 'rotate(90deg)' },      // 远程页对手
      ];
      for (const c of cases) {
        renderCompiledProto(c.defId, c.orient, c.marker);
        setStubRect({ left: 10, top: 20, width: 100, height: 140 });
        syncCompiledFxLayers();
        const layer = compiledLayerOf(c.defId);
        expect(layer, `${c.defId}：body 级 .compiled-fx-<defId> 层不存在`).toBeTruthy();
        // `?? ''`：桩上"没写过"就是 undefined；而**热座那一条要的正是"没写/写了空串"**
        expect(String((layer as StubNode).style.transform ?? ''),
          `${c.defId}：层的内联 transform 不对（协议特效没跟着协议转 / 热座被凭空转了）`).toBe(c.want);
        // 反空集合：这三条里必须有一条**非空**（否则上面的判据会被"全是空串"满足）
        if (c.want !== '') expect(String((layer as StubNode).style.transform)).not.toBe('');
      }
    } finally {
      setStubRect(null);
      await drainRaf();
      restore();
    }
  });

  it('冷漠克隆面互斥：层已转 ±90 时**不得**再同步 rot-180（否则 270°）；热座形态仍同步 rot-180', async () => {
    const restore = installStubDom();
    try {
      const faceOf = (defId: string): StubNode | undefined => {
        const layer = compiledLayerOf(defId);
        return layer ? firstWith(layer, 'compiled-apathy-face') : undefined;
      };
      // ① 热座形态：无标记 + 协议图带 .rot-180（P2 协议）⇒ 克隆面**照旧**同步 180°（改动前行为）
      renderCompiledProto('apathy', 180, undefined);
      setStubRect({ left: 0, top: 0, width: 100, height: 140 });
      syncCompiledFxLayers();
      expect(faceOf('apathy'), '冷漠已编译层里没有 .compiled-apathy-face（判据对象缺失）').toBeTruthy();
      expect(isClass(faceOf('apathy') as StubNode, 'rot-180'),
        '热座形态下克隆面没有跟随协议图的 .rot-180（改动前的行为被破坏）').toBe(true);
      // ② 远程页形态：**同一个 defId** 的 holder 带 'cw' 标记，而协议图仍带 .rot-180
      //    （CSS 里 .net-* 权重更高 ⇒ 视觉只有 +90°）⇒ 层已替协议转了 +90，克隆面**必须**摘掉 180°
      renderCompiledProto('apathy', 180, 'cw');
      syncCompiledFxLayers();
      expect(isClass(faceOf('apathy') as StubNode, 'rot-180'),
        '层已转 +90° 时克隆面还带着 180°（合成 270°，故障重影方向错）—— 互斥判据失效').toBe(false);
      expect(String((compiledLayerOf('apathy') as StubNode).style.transform),
        '远程页形态下层的内联 transform 不是 rotate(90deg)').toBe('rotate(90deg)');
    } finally {
      setStubRect(null);
      await drainRaf();
      restore();
    }
  });

  it('热座零变化（行为）：不传 fxRot ⇒ holder 上**连属性键都不多一个**；传了才写', async () => {
    const restore = installStubDom();
    try {
      const hotseat = renderProtocol({ defId: 'r84-hotseat', compiled: false }, 0) as unknown as StubNode;
      const hotseatHolder = firstWith(hotseat, 'protocol-holder') as StubNode;
      // 在真实 DOM 里 `dataset.fxRot = undefined` 会把属性写成字符串 "undefined"（DOM 被污染），
      // 桩上则表现为"多了一个键"—— 两种形态都算"热座页 DOM 多了东西"，所以两条都断言。
      expect(Object.keys(hotseatHolder.dataset), '热座形态下 holder 上出现了 fxRot 键（守卫失效）')
        .not.toContain('fxRot');
      expect(hotseatHolder.dataset.fxRot, '热座形态下 holder 的标记应为"不存在"').toBeUndefined();

      const netSelf = renderProtocol({ defId: 'r84-net', compiled: false }, 0, 0, 'net-rot-ccw', 'ccw') as unknown as StubNode;
      expect((firstWith(netSelf, 'protocol-holder') as StubNode).dataset.fxRot, '远程页自己侧的标记').toBe('ccw');
      const netFoe = renderProtocol({ defId: 'r84-net', compiled: false }, 1, 180, 'net-rot-cw', 'cw') as unknown as StubNode;
      expect((firstWith(netFoe, 'protocol-holder') as StubNode).dataset.fxRot, '远程页对手侧的标记').toBe('cw');
    } finally {
      await drainRaf();
      restore();
    }
  });
});

/* ============================================================================
 * 源码腿：三处几何跟随都必须走同一个助手，且热座回退判据仍在
 * ========================================================================== */

describe('G2 修正 R8-4 · 源码腿（三处几何跟随的读侧与写法）', () => {
  it('render.ts：positionCompiledFxLayer 读 fxRotDegOf(holder) 并把结果写进内联 transform（空串 = 不旋转）', () => {
    const src = readUi('render.ts');
    expect(src, 'positionCompiledFxLayer 未读 holder 的标记（层不会跟着协议转）')
      .toContain('const deg = fxRotDegOf(holder);');
    expect(src, '层的 transform 不是由那个角度写出来的（角度算了却没用 / 写成别的形态）')
      .toContain("fx.style.transform = deg === 0 ? '' : `rotate(${deg}deg)`;");
    // 角度只能来自那一个助手：render.ts 里 `fxRotDegOf(` 恰好一处（不得再手搓一份角度）
    expect((src.match(/fxRotDegOf\(/g) ?? []).length,
      'render.ts 里 fxRotDegOf 的调用点不是恰好一处（角度被手搓了第二份？）').toBe(1);
    // 反向：本文件不得用会**回退**卡面朝向的 fxOrientOf（热座 P2 协议图自己带 .rot-180）
    expect(src, 'render.ts 用了 fxOrientOf 读协议标记 —— 缺标记时会回退成 180°，热座层会被转坏')
      .not.toMatch(/\bfxOrientOf\b/);
  });

  it('effects/index.ts：翻面浮层与重排幽灵都读 fxRotDegOf（同一助手），且热座回退判据仍在', () => {
    const src = readUi('effects/index.ts');
    // ① 翻面浮层：角度来自 holder 的标记，且 0° 时**不写** transform（热座 cssText 逐字不变）
    expect(src, 'playProtocolFlip 未读协议 holder 的标记（翻面浮层仍竖版、rotateY 轴仍错）')
      .toContain("const deg = fxRotDegOf(node.querySelector<HTMLElement>('.protocol-holder'));");
    expect(src, '翻面浮层的旋转没有走"0° ⇒ 空串"的分支（热座页 cssText 会多一段 transform）')
      .toContain("const rotateDecl = deg === 0 ? '' : `transform:rotate(${deg}deg);`;");
    expect(src, "翻面浮层的 cssText 未拼接 rotateDecl（角度算了却没用）")
      .toMatch(/pointer-events:none;perspective:700px;`\s*\+\s*rotateDecl;/);
    // ② 重排幽灵：按 holder 标记**归一**（远程页幽灵内部的图 ∓90°），热座判据原样保留
    expect(src, '重排幽灵未按 holder 的标记归一（远程页幽灵仍是竖版图、被 cover 裁掉）')
      .toContain("const degA = fxRotDegOf(cellA.querySelector<HTMLElement>('.protocol-holder'));");
    expect(src, '重排幽灵的 degB 未取（两张协议的朝向可能不同）')
      .toContain("const degB = fxRotDegOf(cellB.querySelector<HTMLElement>('.protocol-holder'));");
    expect(src, '热座回退判据被删/被改（无标记时必须保持 `payload.player === 1 → 180°`）')
      .toContain('const rot180 = degA === 0 && degB === 0 && payload.player === 1;');
    expect(src, 'buildProtocolGhost 未接收 deg（幽灵内部的图无法按 ∓90° 出图）')
      .toMatch(/function buildProtocolGhost\(src: string, rect: DOMRect, rot180: boolean, deg: 0 \| 90 \| -90 = 0\)/);
    // ③ "同一个助手"腿：本文件里 fxRotDegOf 至少两处（翻面 + 重排），且**不**新增手搓角度
    expect((src.match(/fxRotDegOf\(/g) ?? []).length,
      'effects/index.ts 里 fxRotDegOf 的调用点少于两处（翻面浮层 / 重排幽灵）').toBeGreaterThanOrEqual(2);
    expect(src, 'effects/index.ts 里出现了裸角度字面量 rotate(90deg)/rotate(-90deg) 手搓（应走 fxRotDegOf）')
      .not.toMatch(/rotate\((?:-?90)deg\)/);
  });

  it('render-net.ts：协议 holder 的标记与协议图的 .net-rot-* 由同一个 isSelfSeat 派生（调用点形态）', () => {
    const src = readUi('render-net.ts');
    // ⚠️ 判据只对**那一次调用**做匹配（从 `const protoNode = renderProtocolCell(` 到最近的 `);`），
    // 失败信息才不会把整份源码打出来。**不能**用 `src.indexOf('renderProtocolCell(')`：
    // 登记表 `NET_PAGE_HOOKS` 里也有这个字面量（在真实调用之前），那会截到表体上去。
    const at = src.indexOf('const protoNode = renderProtocolCell(');
    const call = at < 0 ? '' : src.slice(at, src.indexOf(');', at) + 2).replace(/\s+/g, ' ');
    expect(call, '在 render-net.ts 里找不到 `const protoNode = renderProtocolCell(…)` 的调用（结构被改？）').not.toBe('');
    // 第 5 实参（协议图的类）与第 6 实参（holder 的标记）必须成对出现、同源
    expect(call, 'renderProtocolCell 的两个朝向实参没有成对写出（两处可能脱钩）').toMatch(
      /^const protoNode = renderProtocolCell\( s, player, line, isSelfSeat \? 0 : 180, isSelfSeat \? 'net-rot-ccw' : 'net-rot-cw', isSelfSeat \? 'ccw' : 'cw', \);$/);
    expect(call, 'renderProtocolCell 的标记实参不是按座位的两个值（写死一端 ⇒ 有一侧特效必错）')
      .toMatch(/isSelfSeat \? 'ccw' : 'cw'/);
    // ⚠️ 本页**不产出**热座专属的 ±90° 类（红线 2）：只允许 `.net-rot-*`
    expect(src, 'render-net.ts 产出了热座专属的 ±90° 类').not.toMatch(/['"]rot-(cw|ccw)['"]/);
  });
});

/* ============================================================================
 * 行为腿 C（G2 修正 **R8-4b**）：net 页**每帧**同步已编译持久 FX 层
 * ========================================================================== */

/**
 * 给桩上**新建**的节点装两件东西（**只在用例内注入，不改共用桩的语义**）：
 *  ① `isConnected` —— **如实**按 `parentElement` 链走到 `document.body` 判定（桩本身不模拟"挂载态"）。
 *     为什么必须如实：它是 `positionCompiledFxLayer` 的入口守卫的输入；恒 `true` 会让"已 detach 的
 *     陈旧 holder"也被当成已挂载 —— 那样本用例证明的就不是真实行为。
 *  ② 计数器：**协议 holder** 每次被读 `isConnected` 就 +1。
 *     为什么这是"每帧同步了谁"的**忠实**观察点：`syncCompiledFxLayers` 对表里**每一条**记录都会先读
 *     `holder.isConnected`（detached 的**随即早退**，但仍读了一次）⇒ 计数 = 本帧遍历的记录条数。
 *     桩量不到布局，只能量这个；它恰好能把"表是否随帧累积"（复位缺失）与"有没有跑同步"都暴露出来。
 */
function instrumentStub(meter: { traversed: number }): void {
  const doc = (globalThis as unknown as {
    document: { body: StubNode } & Record<string, unknown>;
  }).document;
  const body = doc.body;
  const connectedNow = (n: StubNode): boolean => {
    let cur: StubNode | null = n;
    while (cur) {
      if (cur === body) return true;
      cur = cur.parentElement;
    }
    return false;
  };
  for (const key of ['createElement', 'createElementNS'] as const) {
    const orig = doc[key] as (...a: string[]) => StubNode;
    doc[key] = (...args: string[]): StubNode => {
      const n = orig(...args);
      Object.defineProperty(n, 'isConnected', {
        configurable: true,
        get: () => {
          if (classListOf(n).includes('protocol-holder')) meter.traversed += 1;
          return connectedNow(n);
        },
      });
      return n;
    };
  }
}

describe('G2 修正 R8-4b · 行为腿：net 页每帧同步已编译持久 FX 层', () => {
  /** 双方各 3 个**已编译**协议，defId 互不相同（`compiledFx` 以 defId 为键 ⇒ 双方不得共用）。 */
  const IDS: [string[], string[]] = [
    ['fire-0', 'ice-0', 'light-0'],
    ['fire-1', 'ice-1', 'light-1'],
  ];

  it('层被真的定位（left/top/width/height）+ transform 恰好按侧 ∓90°；重渲染后遍历条数不增长（每帧同步 + 每帧复位）', async () => {
    const restore = installStubDom();
    try {
      const meter = { traversed: 0 };
      instrumentStub(meter);
      setStubRect({ left: 10, top: 20, width: 100, height: 140 });
      const s = createGame({ seed: 'r8-4b-net-sync', draftStarter: 0, firstToPlay: 1 });
      for (const p of [0, 1] as const) {
        s.players[p].protocols = IDS[p].map((defId) => ({ defId, compiled: true })) as never;
      }
      (s as { phase: string }).phase = 'turn';
      const root = makeStubEl('div');
      // 真实 app 里 root 是文档里的 `#app` ⇒ 桩上也要真的挂进 body，否则"已挂载"恒假、
      // 同步会被 `!holder.isConnected` 全部早退（那就不是被测行为了）。
      (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
      const noop = (): void => { /* noop */ };
      const cb = {
        onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop,
        onDraftUnpick: noop, onDraftBan: noop, onWinReset: noop,
      } as never;
      const layerStyleOf = (defId: string): Record<string, unknown> => {
        const layer = descendants((globalThis as unknown as { document: { body: StubNode } }).document.body)
          .find((n) => isClass(n, 'compiled-fx') && isClass(n, `compiled-fx-${defId}`));
        expect(layer, `${defId}：body 级 .compiled-fx-<defId> 层不存在（buildCompiledFx 没跑？）`).toBeTruthy();
        return (layer as StubNode).style;
      };
      // 一次同步应遍历的条数 = 3 线 × 双方（6 个协议格都登记了 holder）
      const PER_FRAME = 6;
      for (const viewSeat of [0, 1] as const) {
        for (const pass of [1, 2]) {
          meter.traversed = 0;
          renderNetBoard(root as unknown as HTMLElement, s, cb, { viewSeat, verifyHooks: false });
          expect(meter.traversed,
            `viewSeat=${viewSeat} 第 ${pass} 次渲染：本帧遍历的协议 holder 条数应为 ${PER_FRAME}，`
            + `实际 ${meter.traversed}`
            + (meter.traversed === 0
              ? '（= 0 ⇒ 本页根本没同步已编译层 —— 层会停在旧坐标上飘走）'
              : `（> ${PER_FRAME} ⇒ compiledFxCells 没有每帧复位、表在累积）`)).toBe(PER_FRAME);
          for (const p of [0, 1] as const) {
            const want = p === viewSeat ? 'rotate(-90deg)' : 'rotate(90deg)';
            for (const defId of IDS[p]) {
              const st = layerStyleOf(defId);
              // ① **被真的定位过**：四个内联几何值都写上了（值来自 `setStubRect` 的常量矩形）
              expect([st.left, st.top, st.width, st.height],
                `${defId}：层没有被定位（left/top/width/height 内联值）—— 环/角光会飘在旧坐标上`)
                .toEqual(['10px', '20px', '100px', '140px']);
              // ② **角度严格按侧**（R8-4 的 ∓90°，与 holder 标记同源）
              expect(String(st.transform), `${defId}：transform 不是 ${want}（协议特效没跟着协议转）`)
                .toBe(want);
            }
          }
        }
      }
    } finally {
      setStubRect(null);
      await drainRaf();
      restore();
    }
  });

  it('约束 10 的严格版在**已编译协议**的真跑树上不假红（这一条覆盖条件断言的已编译分支）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    setFxViewSeat(null);
    const restore = installStubDom();
    try {
      const meter = { traversed: 0 };
      instrumentStub(meter);
      setStubRect({ left: 10, top: 20, width: 100, height: 140 });
      const s = createGame({ seed: 'r8-4b-verify', draftStarter: 0, firstToPlay: 1 });
      for (const p of [0, 1] as const) {
        s.players[p].protocols = IDS[p].map((defId) => ({ defId, compiled: true })) as never;
      }
      (s as { phase: string }).phase = 'turn';
      const root = makeStubEl('div');
      (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
      const noop = (): void => { /* noop */ };
      renderNetBoard(root as unknown as HTMLElement, s, {
        onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop,
        onDraftUnpick: noop, onDraftBan: noop, onWinReset: noop,
      } as never, { viewSeat: 0, verifyHooks: true });
      const warned = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      // ⚠️ 桩的 `queryAllIn` 不支持逗号选择器组 ⇒ 整份自查不可能 ✓（已知桩边界）。
      //    这里钉的是"**严格版约束 10** 在真的有已编译协议时不假红"：层已被本帧同步写过
      //    （left/top/... + transform 都写了），所以"空串 ⇒ 未同步"这条判据不会触发。
      expect(warned, 'warn 清单没生成（那"不含约束 10"就是空断言）').toContain('.trash-pile.p1/.p2');
      expect(warned, `严格版约束 10 在已编译协议的真跑树上假红了：${warned}`).not.toContain('约束 10');
    } finally {
      setStubRect(null);
      await drainRaf();
      restore();
      warn.mockRestore();
      info.mockRestore();
      setFxViewSeat(null);
    }
  });
});
