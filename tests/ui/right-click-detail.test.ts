import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLevelState } from '../../src/tutorial/setup';
import { getHandSelection, renderBoard, resetUiState, setHandSelection } from '../../src/ui/render';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * **2026-10-06 用户要求**：「将游玩过程中的双击触发展示卡牌详细信息新增一种触发方式，
 * 右键卡牌即可触发展示卡牌详细信息」。
 *
 * ## 这条腿钉什么
 *
 *  - **真跑**：右键（`contextmenu`）手牌 / 协议格 ⇒ `document.body` 上出现 `.zoom-overlay`
 *    （= 那条详情遮罩，`openZoom` 唯一的产物）；
 *  - **反空集合**：右键链路槽（空白格子）⇒ **不**出现遮罩（我们只吃卡那一格的右键，
 *    棋盘空白处的浏览器菜单照旧）；
 *  - **只读性**：右键**不**改选择态、也**不**换朝向 —— 它接的是 `bindClickOrDouble` 的
 *    `double`（详情），不是 `single`（选中/固定展示）那条路。
 *
 * ⚠️ 桩的 `dispatchEvent` **不含派发节点自己**（只沿 `parentElement` 向上）⇒ 每次派发都要挂一个
 * 探针子节点、在探针上派发（与 `tests/tutorial/screen.test.ts` 的 `clickNode` 同款）。
 * ⚠️ 证明不了"浏览器原生右键菜单真的被吃掉了"：桩的 `preventDefault` 是自造字段、读不回来
 * —— 那一半由源码腿钉（`tests/tutorial/screen.test.ts` 断言监听器里有 `e.preventDefault()`），
 * 真机那一半见交付说明里的 CDP 读数。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));

const NOOP_CB = {
  onAction: () => { /* noop */ },
  onRendered: () => { /* noop */ },
  rerender: () => { /* noop */ },
  onDraftPick: () => { /* noop */ },
  onDraftUnpick: () => { /* noop */ },
  onDraftBan: () => { /* noop */ },
  onWinReset: () => { /* noop */ },
} as never;

/** 深拷贝一份 T3 的局面（屏上那份受控局面：手牌 2 张、轮到我、action 步骤） */
function t3State(): ReturnType<typeof buildLevelState> {
  const s = buildLevelState('T3');
  s.turnPlayer = 0;
  s.step = 'action';
  return s;
}

function frame(s: ReturnType<typeof buildLevelState>): StubNode {
  const root = makeStubEl('div');
  renderBoard(root as unknown as HTMLElement, s, NOOP_CB);
  return root;
}

/** 在 node 上派发一个事件（桩的派发路径不含派发节点自己 ⇒ 挂在探针上派发） */
function fire(node: StubNode, type: string): void {
  const probe = makeStubEl('span');
  node.appendChild(probe);
  probe.dispatchEvent({ type, target: probe });
}

/** `.zoom-overlay` 是 `openZoom` 挂在 `document.body` 上的那一层 */
const overlays = (): StubNode[] =>
  descendants(document.body as unknown as StubNode).filter((n) => isClass(n, 'zoom-overlay'));

const inClass = (root: StubNode, cls: string, where?: (n: StubNode) => boolean): StubNode[] =>
  descendants(root).filter((n) => isClass(n, cls) && (where === undefined || where(n)));

afterEach(() => {
  setHandSelection(null, true);
});

describe('★ 右键卡牌 = 打开详情（与双击同一条路）', () => {
  it('★ 真跑：右键手牌 ⇒ 出 `.zoom-overlay`；右键协议格 ⇒ 也出；右键链路槽 ⇒ 不出', () => {
    const restore = installStubDom();
    try {
      const s = t3State();
      setHandSelection(null, true);
      const root = frame(s);

      const hand = inClass(root, 'hand', (n) => n.dataset.player === '0')[0];
      expect(hand, '找不到 P1 的手牌容器').toBeDefined();
      const card = inClass(hand, 'card', (n) => n.dataset.uid !== undefined)[0];
      expect(card, '手牌区没有卡牌节点').toBeDefined();

      // ① 反空锚点：动手之前一个遮罩都没有
      expect(overlays().length, '还没右键就已经有 `.zoom-overlay` 了（判据面错了）').toBe(0);

      // ② 右键手牌 ⇒ 详情遮罩
      fire(card, 'contextmenu');
      expect(overlays().length, '右键手牌没有打开详情遮罩（用户要的新触发方式没生效）').toBe(1);
      // 再右键一次：已经是第二条入口了，不该因此叠出第二层相同的遮罩（openZoom 自己先关旧的）
      fire(card, 'contextmenu');
      expect(overlays().length, '右键两次叠出了两层 `.zoom-overlay`').toBe(1);

      // ③ 协议格也吃右键（协议也是"卡牌"，右键看协议详情）
      resetUiState();
      const root2 = frame(t3State());
      expect(overlays().length, '重置之后遮罩还在（resetUiState 没清干净）').toBe(0);
      const holder = inClass(root2, 'protocol-holder')[0];
      expect(holder, '找不到协议格 `.protocol-holder`').toBeDefined();
      fire(holder, 'contextmenu');
      expect(overlays().length, '右键协议格没有打开详情遮罩').toBe(1);

      // ④ 反空集合：右键链路槽（不是卡）⇒ 一个遮罩都不该出（浏览器菜单在那一格照旧）
      resetUiState();
      const root3 = frame(t3State());
      const slot = inClass(root3, 'stack-slot')[0];
      expect(slot, '找不到链路槽 `.stack-slot`').toBeDefined();
      fire(slot, 'contextmenu');
      expect(overlays().length, '右键空白链路槽也弹出了详情遮罩（吃得太宽）').toBe(0);
    } finally { resetUiState(); restore(); }
  });

  it('★ 真跑：右键是**只读**的 —— 不改选择态、也不在卡上挂 `.selected`（详情 ≠ 选中）', () => {
    const restore = installStubDom();
    try {
      const s = t3State();
      setHandSelection(null, true);
      const root = frame(s);
      const hand = inClass(root, 'hand', (n) => n.dataset.player === '0')[0];
      const card = inClass(hand, 'card', (n) => n.dataset.uid !== undefined)[0];
      const uid = card.dataset.uid;

      fire(card, 'contextmenu');
      expect(overlays().length, '夹具前提：右键确实开了详情').toBe(1);
      expect(getHandSelection(), '右键改了选择态（那说明它接到了 single 那条路上）')
        .toEqual({ uid: null, faceUp: true });
      /**
       * ⚠️ 重画与否这件事这里刻意不判：右键不触发任何重画（`openZoom` 只挂遮罩），
       * 所以 `card` 还是那一帧的节点。只断言"没有被选中"。
       */
      expect(inClass(hand, 'card', (n) => isClass(n, 'selected')).length,
        '右键之后那张卡被标成选中了（详情应当只读）').toBe(0);
      expect(uid, '夹具前提：手牌卡带 data-uid').toBeTruthy();

      // 反向锚点：单击仍旧是"选中"那条路（延迟 320ms，这里先确认它**不**开详情）
      resetUiState();
      const root2 = frame(t3State());
      const card2 = inClass(root2, 'hand', (n) => n.dataset.player === '0')[0];
      const c2 = inClass(card2, 'card', (n) => n.dataset.uid !== undefined)[0];
      fire(c2, 'click');
      expect(overlays().length, '单击就开了详情（双击/右键两条入口的判别被改坏了）').toBe(0);
    } finally { resetUiState(); restore(); }
  });

  it('源码腿：右键只吃卡那一格（没有全局 contextmenu 监听），且各处都走同一个助手', () => {
    const render = stripComments(readFileSync(`${REPO}src/ui/render.ts`).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    // 唯一一处 contextmenu 监听在 `bindRightClickDetail` 里
    const hits = [...render.matchAll(/addEventListener\('contextmenu'/g)];
    expect(hits.length, `render.ts 里 contextmenu 监听有 ${hits.length} 处（只许 1 处：助手内部）`).toBe(1);
    // 三处"原生 dblclick 的卡"（协议格 / 揭示幽灵 / 弃牌堆查看器）都必须配一次右键
    const helperCalls = [...render.matchAll(/bindRightClickDetail\(/g)].length;
    expect(helperCalls, `bindRightClickDetail( 的调用点有 ${helperCalls} 处（助手定义 1 + 三处原生 dblclick + bindClickOrDouble 1 = 5）`)
      .toBe(5);
    // 不许有全局监听（那会把面板/空白处的浏览器菜单也吃掉）
    expect(render, 'render.ts 里出现了 document/window 级的 contextmenu 监听（会吃到棋盘的空白处）')
      .not.toMatch(/(document|window)\.addEventListener\('contextmenu'/);
  });
});
