import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import type { ChoiceCard, PlayerId } from '../../src/core/models/types';
import { renderNetBoard, resetNetZoomBox } from '../../src/ui/render-net';
import { setChoiceSelection, setHandSelection } from '../../src/ui/render';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode } from './net-dom-stub';
import { makeCard } from '../helpers';
import { cardTextParts, getCardDef } from '../../src/data/demo';
import { stripComments } from './source-text';

/**
 * **2026-10-06 用户报的缺陷（远程页）**：「双人远程游玩模式中，当有卡牌触发了一些需要选择其他
 * 卡牌来触发的效果时，鼠标悬浮在**变暗的不可选择的卡牌**上时，右边的卡牌详细展示屏不会被触发」。
 *
 * ## 根因（读样式表 + 渲染器即可定位）
 *
 * 1. 右边的放大框靠**板根上的事件委托**填内容：`render-net.ts` 的 `bindNetZoomBox` 监听
 *    `pointerover`，用 `ev.target` 反查卡片（`netZoomContentFor`）。它**没有**任何"候选/非候选"
 *    的判据 —— 谁被指到就显示谁；
 * 2. 但选择模式下样式表把**非候选卡**设成了 `pointer-events: none`
 *    （`styles-net.css` 第 6 节的两条镜像规则）⇒ 指针根本到不了卡上，`ev.target` 变成底下的
 *    链路带 ⇒ `netZoomContentFor` 返回 `null` ⇒ 框不更新。候选卡（`.choice-target`）不在锁里，
 *    所以"只有变暗的那些没反应"。
 *
 * ## 本文件钉什么
 *
 *  - **真跑**：`renderNetBoard` + 桩 DOM，真派发 `pointerover` ——
 *    悬浮**变暗的非候选卡** ⇒ 放大框填上这张卡（`dataset.state === 'card'` + 标题是这张卡）；
 *  - **反空集合**：悬浮链路带（不是卡）⇒ 框不动；悬浮**候选卡** ⇒ 照旧填上（没弄坏原来那条路）；
 *  - **样式/源码腿**：`styles-local.css` 里那条放开指针锁的规则在、`styles-net.css` 的两条锁仍在
 *    （所以这条规则不是多余的）、热座那条锁一行未动，且"放开指针目标"所依赖的三道**行为**闸门
 *    （拖拽 / 手牌单击 / 落牌校验）都还在。
 *
 * ⚠️ **能力边界（必须写在这里）**：桩 DOM **没有 CSS 引擎、也没有命中测试** ⇒ 真派发 `pointerover`
 * 在桩上**不受 `pointer-events` 影响**。所以本文件证的是"事件一旦到达卡上，放大框就会填"
 * （管线），而"事件真能到达卡上"那一半由**样式腿 + 真机读数**（交付说明里的 CDP 检查：
 * `getComputedStyle(card).pointerEvents === 'auto'`）负责。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  readFileSync(`${REPO}${rel}`).subarray(0, 8 * 1024 * 1024).toString('utf8');

type S = ReturnType<typeof createGame>;

afterEach(() => {
  setChoiceSelection([], null);
  setHandSelection(null);
  setFxViewSeat(null);
  resetNetZoomBox();
});

/** 一帧最简对局：草稿已过、轮到 `turnPlayer`、协议给全（与 `net-choice-overlay-seat.test.ts` 同款）。 */
function baseState(turnPlayer: PlayerId): S {
  const s = createGame({ seed: 'net-zoom-hover-choice', draftStarter: 0, firstToPlay: turnPlayer });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = turnPlayer;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  for (const p of [0, 1] as const) {
    s.players[p].hand.push(makeCard('speed-0', p, 'hand', true, null));
    s.players[p].hand.push(makeCard('water-4', p, 'hand', true, null));
  }
  return s;
}

/** 往状态上挂一条 `select` 效果（`gen` 空转 —— 本腿只读 `prompt`，不推演效果）。 */
function withSelect(s: S, chooser: PlayerId, cards: ChoiceCard[]): void {
  s.pendingEffects.push({
    id: 'pe-nzh',
    player: chooser,
    gen: (function* g(): Generator<never, void, never> { /* 本腿不推演 */ })() as never,
    sourceUid: 'src-nzh',
    sourceDefId: 'speed-5',
    prompt: { kind: 'select', title: 'speed-5：弃1张牌', min: 1, max: 1, optional: false, candidates: cards },
    lastAnswer: null,
  });
}

/** 把某一玩家手牌（真 uid）当成候选。 */
function handCandidates(s: S, owner: PlayerId): ChoiceCard[] {
  return s.players[owner].hand.map((c) => ({
    uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'hand' as const, line: null, pos: null, label: c.defId,
  }));
}

function renderFrame(s: S, viewSeat: PlayerId): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat });
  return root;
}

const cardNode = (root: StubNode, uid: string): StubNode | undefined =>
  descendants(root).find((n) => isClass(n, 'card') && n.dataset.uid === uid);

const zoomBox = (root: StubNode): StubNode | undefined => queryAllIn(root, '.net-zoom-box')[0];

/** 真派发 `pointerover`（委托监听挂在板根上 ⇒ 派发节点用那张卡本身、`target` 也指它）。 */
const hover = (node: StubNode): void => { node.dispatchEvent({ type: 'pointerover', target: node }); };

const headText = (box: StubNode): string =>
  descendants(box).find((n) => isClass(n, 'net-zoom-box-head'))?.text ?? '';

describe('★ 2026-10-06：选择挂起时，悬浮"变暗的不可选卡"也要能填右边放大框', () => {
  it('★ 真跑：悬浮 `.choice-dim` 的场上卡 ⇒ 放大框填上这张卡（用户报的那一格）', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        resetNetZoomBox();
        const s = baseState(chooser);
        // 场上放一张**非候选**的正面卡 —— 它就是"变暗不可选"的那一类
        const field = makeCard('speed-3', chooser, 'field', true, 0);
        s.players[chooser].stacks[0] = [field];
        const cands = handCandidates(s, chooser);      // 候选 = 手里那两张 ⇒ 场上这张不是候选
        withSelect(s, chooser, cands);
        const root = renderFrame(s, chooser);

        const node = cardNode(root, field.uid);
        expect(node, `P${chooser + 1} 屏上没有渲染出场上那张卡`).toBeDefined();
        // 夹具前提：它真的被标成"变暗 / 不可选"，而且**不是**候选
        expect(isClass(node!, 'choice-dim'), '夹具前提：这张卡没被 `.choice-dim` 压暗').toBe(true);
        expect(isClass(node!, 'choice-target'), '夹具前提：这张卡被当成了候选').toBe(false);

        const box = zoomBox(root);
        expect(box, '找不到右边的放大框 `.net-zoom-box`').toBeDefined();
        expect(box!.dataset.state, '夹具前提：放大框开局是空态').toBe('empty');

        hover(node!);
        expect(box!.dataset.state,
          '悬浮"变暗的不可选卡"之后放大框还是空态 —— 用户报的那一格（远程页选择模式下看不了详情）')
          .toBe('card');
        expect(headText(box!), '放大框标题不是这张卡的名字')
          .toContain(cardTextParts(getCardDef('speed-3')).title);
      }
    } finally { restore(); }
  });

  it('反空集合：悬浮链路带（不是卡）⇒ 框不动；悬浮**候选卡** ⇒ 照旧填上', () => {
    const restore = installStubDom();
    try {
      const chooser: PlayerId = 0;
      const s = baseState(chooser);
      const field = makeCard('speed-3', chooser, 'field', true, 0);
      s.players[chooser].stacks[0] = [field];
      const cands = handCandidates(s, chooser);
      withSelect(s, chooser, cands);
      const root = renderFrame(s, chooser);
      const box = zoomBox(root);
      expect(box, '找不到放大框').toBeDefined();
      expect(box!.dataset.state).toBe('empty');

      // ① 悬浮一个**不是卡**的东西（链路带）：`netZoomContentFor` 返回 null ⇒ 框必须原样不动
      const band = queryAllIn(root, '.net-lane-band')[0] ?? queryAllIn(root, '.stack-slot')[0];
      expect(band, '夹具失败：找不到链路带 / 链路槽').toBeDefined();
      hover(band!);
      expect(box!.dataset.state, '悬浮链路带也把放大框改了（判据面太宽）').toBe('empty');

      // ② 候选卡（`.choice-target`）照旧能填 —— 本修法不许把原来那条路弄坏
      const candNode = cardNode(root, cands[0].uid);
      expect(candNode, '夹具失败：找不到候选卡节点').toBeDefined();
      expect(isClass(candNode!, 'choice-target'), '夹具前提：这张卡应当是候选').toBe(true);
      hover(candNode!);
      expect(box!.dataset.state, '悬浮候选卡没有填上放大框（既有那条路被弄坏了）').toBe('card');
      expect(headText(box!)).toContain(cardTextParts(getCardDef(cands[0].defId)).title);
    } finally { restore(); }
  });

  it('样式腿：指针锁被 `.net-*` 作用域的 local 规则放开，两条锁与热座那条都还在，三道行为闸门也在', () => {
    const local = read('src/ui/styles-local.css');
    expect(local, 'styles-local.css 里没有放开"选择模式指针锁"的规则（变暗的卡悬浮不到 ⇒ 详情永远不更新）')
      .toContain('.net-board.choice-mode .card:not(.choice-target) { pointer-events: auto; }');
    const net = read('src/ui/styles-net.css');
    expect(net, '`styles-net.css` 里那条锁不见了 ⇒ 先复核本规则还有没有必要')
      .toContain('.net-board.choice-mode .card:not(.choice-target) { pointer-events: none; }');
    expect(net, '第二条镜像锁（`.net-hands.choice-mode …`）不见了')
      .toContain('.net-hands.choice-mode .card:not(.choice-target) { pointer-events: none; }');
    const base = read('src/ui/styles.css');
    expect(base, '热座页那条选择模式锁被改了（本修法只该动 `.net-*` 作用域）')
      .toContain('.hand-strip.choice-mode .card:not(.choice-target) { pointer-events: none; }');

    /**
     * "放开指针目标"的前提：那把锁想防的三件事在**代码里**各自有闸门（样式只负责观感）。
     * 少任何一条，这次放开就会变成"选择模式下能打牌 / 能拖牌"。
     */
    const render = stripComments(read('src/ui/render.ts'));
    const guards = [...render.matchAll(/if \(choicePromptId !== null\) return;/g)].length;
    expect(guards,
      `render.ts 里 \`choicePromptId\` 的早退闸门有 ${guards} 处（拖拽 + 手牌单击各一处；少一处就是那条路被放开了）`)
      .toBe(2);
    expect(render, '`playToLine` 不再校验"这一步合法"（选择挂起时可能真的落牌）')
      .toMatch(/const playable = legal\.some\(/);
    const netSrc = stripComments(read('src/ui/render-net.ts'));
    expect(netSrc, '远程页不再每帧重申"有选择挂起"（`choicePromptId` 会在某些路径上变回 null）')
      .toMatch(/setChoiceSelection\([\s\S]{0,40}top\.id\)/);
  });
});
