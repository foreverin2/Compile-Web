/**
 * **2026-10-01 用户真机反馈（第 2 件）：选协议阶段要一眼看出"我是几号"。**
 *
 * ## 用户原话（照抄）
 *
 * "有玩家反馈：联机后开始选协议阶段没法确认谁是玩家 1/2，你想个办法"。
 *
 * ## 缺陷形态（改之前）
 *
 * `renderPickColumn()` 产出的标题只有一句 `玩家 ${player + 1} 已选` —— 它写的是**协议里的绝对
 * 座位号**。联机两端看到的标题**一模一样**，玩家读不出"哪一列是我"（G5 T14 那条「轮到谁」说人话
 * 解决的是"该谁动"，没解决"我是几号"）。
 *
 * ## 这个文件钉的三半
 *
 *  1. **给了座位**（联机局与单机视角预览）：本机那一列的标题追加 `（你）`、另一列追加 `（对方）`，
 *     两个标记的类名**不同**（`-self` / `-foe`）⇒ "两侧标记不同"这件事有独立判据；
 *  2. **没给座位**（热座：一个人操作两边；单机/重放）：**一个标记节点都不产出**
 *     —— 热座里标"你"是错的（两边都是同一个人在操作），这一条是**成对的**（热座零标记 + 联机有标记），
 *     单看哪一半都可能被"两边都不标"或"两边都乱标"满足；
 *  3. **产出的必经之路**：`renderDraft`（页级入口）把座位转交给 `renderPickColumn`
 *     —— 单测 `renderPickColumn` 只证明"给了就标"，它证不了"联机会把座位给进去"，
 *     所以再加一条**真跑 `renderDraft` + 页级开关**的行为腿（`setDraftSelfSeat`）。
 *
 * ## 诚实边界
 *
 *  - 本文件**不**证明真机上"一眼看得出"（那是观感）；
 *  - 也不证明 `src/main.ts` 真的会调 `setDraftSelfSeat(...)`（那是源码腿，住在
 *    `tests/ui/draft-pick-seat-mark-host.test.ts` 之外——本任务的宿主接线由
 *    `net-turn-line.test.ts` 同族的那条源码腿口径覆盖，见交付报告）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import {
  renderDraft, renderPickColumn, resetUiState, setDraftSelfSeat, type UiCallbacks,
} from '../../src/ui/render';
import { createGame } from '../../src/core/state/create';
import type { PlayerId } from '../../src/core/models/types';

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
  // 页级开关是**模块态**：用例之间必须复位，否则"热座零标记"那条腿会被上一用例的座位污染
  setDraftSelfSeat(null);
});

const noopCb: UiCallbacks = {
  onAction: () => { /* 桩：本腿只看结构 */ },
  onDraftPick: () => { /* 桩 */ },
  onDraftBan: () => { /* 桩 */ },
  onDraftUnpick: () => { /* 桩 */ },
};

/** 后代里带某个类名的全部节点。 */
const withClass = (root: StubNode, cls: string): StubNode[] => {
  const out: StubNode[] = [];
  const walk = (n: StubNode): void => {
    if (isClass(n, cls)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
};

/** 那一列（`.draft-picks.pN`）的标题节点。 */
const titleOf = (col: StubNode): StubNode => {
  const hits = withClass(col, 'draft-picks-title');
  expect(hits.length, `列里应有恰好一个 .draft-picks-title（实际 ${hits.length}）`).toBe(1);
  return hits[0];
};

/** 标题里的标记（两类一起找，读侧只按类名 —— 与产出侧同一个口径）。 */
const marksOf = (title: StubNode): StubNode[] =>
  [...withClass(title, 'draft-picks-seat-self'), ...withClass(title, 'draft-picks-seat-foe')];

/** 只跑一个座位的那一列（不碰 `renderDraft` 的整页），夹具最小。 */
const columnOf = (player: PlayerId, selfSeat?: PlayerId): StubNode => {
  const s = createGame({ seed: 'draft-pick-seat-mark', draftStarter: 0, draftMode: 'normal' });
  return renderPickColumn(s, player, 0, noopCb, selfSeat) as unknown as StubNode;
};

describe('★★ 2026-10-01：联机局两侧列标题标出「你 / 对方」（热座不标）', () => {
  it('联机座位 1：座位 1 那一列是「（你）」、座位 0 那一列是「（对方）」，两侧标记类名不同', () => {
    restoreDom = installStubDom();
    const mine = columnOf(1, 1);
    const foe = columnOf(0, 1);
    const myTitle = titleOf(mine);
    const foeTitle = titleOf(foe);
    // 座位号仍在（这一轮**不**动它，用户要的是"再加一句我/对方"）
    expect(myTitle.text, '本机那一列的标题丢了座位号').toContain('玩家 2 已选');
    expect(foeTitle.text, '对手那一列的标题丢了座位号').toContain('玩家 1 已选');

    const myMarks = marksOf(myTitle);
    const foeMarks = marksOf(foeTitle);
    expect(myMarks.length, `本机那一列应有恰好一个座位标记（实际 ${myMarks.length}）`).toBe(1);
    expect(foeMarks.length, `对手那一列应有恰好一个座位标记（实际 ${foeMarks.length}）`).toBe(1);
    expect(myMarks[0].text, '本机那一列的标记不是「（你）」').toBe('（你）');
    expect(foeMarks[0].text, '对手那一列的标记不是「（对方）」').toBe('（对方）');
    expect(isClass(myMarks[0], 'draft-picks-seat-self'), '本机那一列的标记类名不对').toBe(true);
    expect(isClass(foeMarks[0], 'draft-picks-seat-foe'), '对手那一列的标记类名不对').toBe(true);
    // 两侧标记**必须不同**（这一条把"两边都标成同一句"这种错法单独钉住）
    expect(myMarks[0].cls, '两侧标记类名一样（玩家分不出哪一列是自己）').not.toBe(foeMarks[0].cls);
    expect(myMarks[0].text === foeMarks[0].text, '两侧标记文案一样').toBe(false);
    // 标记是标题的**直接**子节点（不许塞进别处：CSS 的 flex 排布按直接子节点算）
    expect(myMarks[0].parentElement, '标记不是标题的直接子节点').toBe(myTitle);
  });

  it('反空转：换一个联机座位（0）标记跟着换列 —— 不是"座位 1 写死"', () => {
    restoreDom = installStubDom();
    const asSeat0 = titleOf(columnOf(0, 0));
    const asSeat1 = titleOf(columnOf(1, 0));
    expect(marksOf(asSeat0)[0].text, '座位 0 的玩家看自己那一列，标记不是「（你）」').toBe('（你）');
    expect(marksOf(asSeat1)[0].text, '座位 0 的玩家看对手那一列，标记不是「（对方）」').toBe('（对方）');
  });

  it('★★ 热座/单机：**不传座位** ⇒ 一个标记节点都不产出（标题正文与改前逐字相同）', () => {
    restoreDom = installStubDom();
    for (const player of [0, 1] as const) {
      const title = titleOf(columnOf(player));
      expect(title.text, `热座那一列（玩家 ${player + 1}）的标题正文被改了`).toBe(`玩家 ${player + 1} 已选`);
      expect(marksOf(title).length,
        `热座那一列（玩家 ${player + 1}）出现了座位标记 —— 热座是一个人操作两边，标"你"是错的`)
        .toBe(0);
    }
  });

  it('真跑 `renderDraft`（热座缺省）：两列标题都不带标记，且页级开关复位后也不带', () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    renderDraft(root as unknown as HTMLElement, createGame({ seed: 'hotseat-no-mark' }), noopCb);
    const cols = withClass(root, 'draft-picks');
    expect(cols.length, '草案页应有左右两条已选列').toBe(2);
    for (const col of cols) {
      expect(marksOf(titleOf(col)).length, '热座草案页出现了座位标记（页级开关没被当成"没有座位"）').toBe(0);
    }
    // 复位之后仍然是零标记（`resetUiState()` 也把页级座位清掉）
    resetUiState();
    const root2 = makeStubEl('div');
    renderDraft(root2 as unknown as HTMLElement, createGame({ seed: 'hotseat-no-mark-2' }), noopCb);
    for (const col of withClass(root2, 'draft-picks')) {
      expect(marksOf(titleOf(col)).length, '`resetUiState()` 之后热座页仍带标记').toBe(0);
    }
  });

  it('页级开关这条路也通：`setDraftSelfSeat(1)` 之后 `renderDraft` 的两列各带一个正确标记', () => {
    restoreDom = installStubDom();
    setDraftSelfSeat(1);
    const root = makeStubEl('div');
    renderDraft(root as unknown as HTMLElement, createGame({ seed: 'net-mark-via-switch' }), noopCb);
    const cols = withClass(root, 'draft-picks');
    expect(cols.length, '草案页应有左右两条已选列').toBe(2);
    // 列的顺序是 DOM 顺序（p1 在前、p2 在后），按座位号取而不是按位置猜
    const bySeat = new Map<number, StubNode>();
    for (const col of cols) bySeat.set(isClass(col, 'p1') ? 0 : 1, col);
    const seat0 = marksOf(titleOf(bySeat.get(0) as StubNode));
    const seat1 = marksOf(titleOf(bySeat.get(1) as StubNode));
    expect(seat0.length, '座位 0 那一列没有标记').toBe(1);
    expect(seat1.length, '座位 1 那一列没有标记').toBe(1);
    expect(seat1[0].text, '本机（座位 1）那一列的标记不是「（你）」').toBe('（你）');
    expect(seat0[0].text, '对手（座位 0）那一列的标记不是「（对方）」').toBe('（对方）');
  });

  it('标记用**行内**样式（不新增样式表类规则），且不动标题行的字号', () => {
    restoreDom = installStubDom();
    const title = titleOf(columnOf(0, 1));
    const mark = marksOf(title)[0];
    const style = String((mark as unknown as { getAttribute(n: string): string | null }).getAttribute('style') ?? '');
    expect(style, '标记没有行内样式（那一族样式表与 CSS 解算腿一一对应，不该往里加类规则）')
      .toContain('font-size:');
    expect(style, '标记必须显式写 font-weight: normal —— 否则它继承标题的 bold，看起来像加了别的话')
      .toContain('font-weight: normal');
    // 字号是相对值（em）⇒ 标题行自身的字号/行高不受影响（`draft-fit.test.ts` 的预算腿仍成立）
    expect(style, `标记用了绝对字号（实际「${style}」）⇒ 草案页的尺寸预算会跟着变`).toContain('em');
  });
});
