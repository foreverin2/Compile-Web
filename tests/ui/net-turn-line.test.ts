/**
 * G5 **T14** 第 2 件事：**联机对局里的"轮到谁"要说人话**（不碰 `src/ui/render.ts`）。
 *
 * ## 为什么需要这一行（缺陷形态）
 *
 * `renderDraft` 的醒目横幅写的是**座位号**（`玩家 ${activePlayer + 1}`，`src/ui/render.ts:4925-4936`），
 * 而联机下玩家在自己那一页永远读到"玩家 1 / 玩家 2"，对不上"我 / 对方"（用户 2026-09-20 的指示）。
 * `render.ts` 是**红线文件**（G5 §2 第 10 条）⇒ 这一行由应用层在渲染之后补画，文案与产 DOM 住
 * `src/ui/net-lobby.ts`（这样才上得了真渲染器腿：`tests/**` import 不了 `src/main.ts`）。
 *
 * ## 三条纪律（本文件钉的）
 *
 *  1. **人话、不夸张**：草稿相与对局相各有两格（轮到我 / 轮到对方），四句**两两不同**；
 *     且**都不出现座位号**（那正是这一行存在的理由），**不许**出现"公平 / 防作弊"那类承诺；
 *  2. **取值同源**：`netTurnText` 的入参就是引擎那两个读数（草稿相 `getCurrentDrafter(s)`、
 *     对局相 `s.turnPlayer`）与"我是谁"（驱动自己的 `seat`）—— 本文件用**真 `GameState`** 喂它，
 *     不是手写一个字符串比对；
 *  3. **宿主那一半是源码腿**：把这一行画到屏上只有 `src/main.ts` 的 `appendTurnLine()` 一处，
 *     而 `main.ts` 在 node 里 import 不了（要真 `document`）⇒ 那一半只能是源码腿，且要**两个相
 *     都点名**（草稿相的 `renderApp(...)` 之后、对局相的 `renderNetBoard(...)` 分支里）。
 *
 * ## 能力边界（诚实写出来）
 *
 * 本文件**不**断言"屏上那一行在真浏览器里长什么样"（字号/位置/有没有被别的层盖住）。
 * 那一条由 `.superpowers/g5-T14/` 的一次性真鼠标场景脚本读 DOM 原文负责；
 * 也不能证明"玩家一定能看懂"（那是人眼项）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  descendants, installStubDom, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';
import { functionBody, stripComments } from './source-text';
import { appendNetTurnLine, netTurnText } from '../../src/ui/net-lobby';
import { createGame, DRAFT_PICK_COUNT, getCurrentDrafter } from '../../src/core/state/create';
import type { PlayerId } from '../../src/core/models/types';

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/* ==================================================================== *
 * 判据 1：四格文案（轮到我 / 轮到对方 × 草稿 / 对局）
 * ==================================================================== */

describe('★★ G5 T14：联机下"轮到谁"的那一行是人话（draft 与 turn 两相）', () => {
  it('草稿相两格：轮到我说"轮到你选协议"、轮到对方说"轮到对方 … 等他选"（第几步用的是引擎的草稿轮次）', () => {
    const s = createGame({ seed: 'g5-t14-turn-line-draft', draftStarter: 1, firstToPlay: 0, draftMode: 'normal' });
    // ★ 入参直接取自**真状态**：第 1 个轮选者是 `getCurrentDrafter(s)`（不是手写的 1）
    const drafter: PlayerId = getCurrentDrafter(s);
    expect(drafter, '反空转：夹具的先选者该是 1（否则下面两格的"我/对方"会都落在同一侧）').toBe(1);
    const steps = `第 1 步，共 ${DRAFT_PICK_COUNT} 步`;

    const mine = netTurnText('draft', s.turnPlayer, 1, drafter, s.draftRound);
    expect(mine, '轮到我的那一格没有说"轮到你选协议"').toContain('轮到你选协议');
    expect(mine, '轮到我的那一格没有报第几步').toContain(steps);
    expect(mine, `轮到我的那一格把"共几步"写错了（该是引擎的 DRAFT_PICK_COUNT=${DRAFT_PICK_COUNT}）`)
      .not.toContain('共 5 步');

    const theirs = netTurnText('draft', s.turnPlayer, 0, drafter, s.draftRound);
    expect(theirs, '轮到对端那一格没有说"轮到对方选协议"').toContain('轮到对方选协议');
    expect(theirs, '轮到对端那一格没有交代"等他选"（玩家不知道要不要等）').toContain('等他选');
    expect(theirs, '轮到对端那一格没有报第几步').toContain(steps);
    expect(theirs === mine, '两格文案一样（那就是把两件不同的事说成一件）').toBe(false);
  });

  it('对局相两格：轮到我说"轮到你出牌或点「下一步」"、轮到对方说"轮到对方 … 等他动"', () => {
    const s = createGame({ seed: 'g5-t14-turn-line-turn', draftStarter: 0, firstToPlay: 1, draftMode: 'normal' });
    const mine = netTurnText('turn', s.turnPlayer, s.turnPlayer, 0, s.draftRound);
    expect(mine, '轮到我的那一格没有说"轮到你出牌"').toContain('轮到你出牌');
    expect(mine, '轮到我的那一格没有提到「下一步」（远程页的通用推进按钮）').toContain('下一步');

    const theirs = netTurnText('turn', s.turnPlayer, (1 - s.turnPlayer) as PlayerId, 0, s.draftRound);
    expect(theirs, '轮到对端那一格没有说"轮到对方出牌"').toContain('轮到对方出牌');
    expect(theirs, '轮到对端那一格没有交代"等他动"').toContain('等他动');
    expect(theirs === mine, '两格文案一样（那就是把两件不同的事说成一件）').toBe(false);

    // 四格两两不同（把任意两格合并就是"读数不同、话却一样"）
    const four = new Set([
      netTurnText('draft', 0, 0, 0, 0), netTurnText('draft', 0, 1, 0, 0),
      netTurnText('turn', 0, 0, 0, 0), netTurnText('turn', 0, 1, 0, 0),
    ]);
    expect(four.size, '四格文案有重复').toBe(4);
  });

  it('文案纪律：一个人话里都不出现座位号，也不出现"公平 / 防作弊"那类承诺', () => {
    const all = [
      netTurnText('draft', 0, 0, 0, 0), netTurnText('draft', 0, 1, 0, 0),
      netTurnText('turn', 0, 0, 0, 0), netTurnText('turn', 0, 1, 0, 0),
    ];
    for (const t of all) {
      expect(t, `「${t}」里出现了座位号（这一行存在的理由正是把座位号翻成人话）`)
        .not.toMatch(/玩家\s*\d/);
      for (const banned of ['公平', '防作弊', '无法作弊', '绝对']) {
        expect(t, `「${t}」里出现了禁用词「${banned}」`).not.toContain(banned);
      }
      expect(t.length, `「${t}」太长（这一行只是一句提示，不超过 40 字）`).toBeLessThanOrEqual(40);
      expect(t, `「${t}」没有说自己是不是轮到我`).toMatch(/轮到你|轮到对方/);
    }
  });

  it('第几步跟着草稿轮次走（不是写死的 1）', () => {
    const a = netTurnText('draft', 0, 0, 0, 0);
    const b = netTurnText('draft', 0, 0, 0, 3);
    expect(a, '第 1 步那一格').toContain(`第 1 步，共 ${DRAFT_PICK_COUNT} 步`);
    expect(b, '第 4 步那一格没跟着 `draftRound` 走').toContain(`第 4 步，共 ${DRAFT_PICK_COUNT} 步`);
  });
});

/* ==================================================================== *
 * 判据 1（真渲染器腿）：`appendNetTurnLine` 真的把那一行画到 root 上
 * ==================================================================== */

describe('★★ G5 T14：那一行真的画到屏上（真 DOM 桩 + 真产出函数）', () => {
  it('`appendNetTurnLine` 往 root 末尾追加一个 `div.net-turn-line`，正文就是 `netTurnText` 那一句', () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    // 屏上先有一块别的东西（模拟"渲染器已经画完一帧"）
    const painted = makeStubEl('div');
    painted.className = 'draft-screen';
    root.appendChild(painted);
    // 这一格要的形态是「**轮到对方**」（draftStarter=0 ⇒ 第 1 步的轮选者是座位 0，而本页是座位 1）
    appendNetTurnLine(root as unknown as HTMLElement, 'draft', 0, 1, 0, 2);

    const hits = queryAllIn(root, 'div.net-turn-line');
    expect(hits.length, `屏上应有恰好一行 .net-turn-line（实际 ${hits.length} 行）`).toBe(1);
    const want = netTurnText('draft', 0, 1, 0, 2);
    expect(hits[0].text, '屏上那一行不是 netTurnText 交出来的那一句').toBe(want);
    expect(want, '反空转：这一格的夹具该是"轮到对方"那一句（否则上面那句可能在比一个空的形态）')
      .toContain('轮到对方');
    // ★ 它是**追加**在帧末（不覆盖渲染器画的东西）
    expect(descendants(root).some((n) => n.cls.includes('draft-screen')),
      '这一行把渲染器画的那一帧盖掉了（它是追加，不是替换）').toBe(true);
    expect(root.children[root.children.length - 1], '那一行不是帧末追加的（它该排在渲染器画的东西之后）')
      .toBe(hits[0]);
  });

  it('对局相那一格也画得出来（同一个产出函数，两相共用）', () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    // 对局相那一格：`draftDrafter` 传 0（它在对局相**不参与判定**，只占位）；
    // `draftRound` 用引擎自己的常量（对局相它恒等于 `DRAFT_PICK_COUNT`）
    appendNetTurnLine(root as unknown as HTMLElement, 'turn', 0, 0, 0, DRAFT_PICK_COUNT);
    const hits = queryAllIn(root, 'div.net-turn-line');
    expect(hits.length, '对局相那一格没画出来').toBe(1);
    expect(hits[0].text, '对局相那句不是"轮到你"那一格').toBe(netTurnText('turn', 0, 0, 0, DRAFT_PICK_COUNT));
    expect(hits[0].text, '对局相那一格没有说"轮到你出牌"').toContain('轮到你出牌');
  });
});

/* ==================================================================== *
 * 判据 2（源码腿，宿主那一半）：两个相都点了名，且读的是同一份读数
 * ==================================================================== */

describe('★★ G5 T14 源码腿：宿主那一半（`src/main.ts`，node 里 import 不了）', () => {
  const MAIN = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
      .subarray(0, 16 * 1024 * 1024).toString('utf8'),
  );

  it('`appendTurnLine()` 读的就是 `selfSeat` 与 `getCurrentDrafter` / `turnPlayer`（不另算一套）', () => {
    const body = functionBody(MAIN, 'appendTurnLine');
    expect(body.length, '`appendTurnLine` 的函数体太短 ⇒ 这条腿假绿').toBeGreaterThan(120);
    expect(body, '没有"不是联机局就不画"的早退（热座/重放页会多出一个节点）').toContain('g === null');
    // 三个读数逐个点名（顺序不钉：参数顺序本来就是可读性选择）
    for (const read of ['state.phase', 'state.turnPlayer', 'g.selfSeat', 'getCurrentDrafter(state)']) {
      expect(body, `appendTurnLine 里没有读「${read}」`).toContain(read);
    }
    expect(body, '它没有把活交给 `src/ui/net-lobby.ts` 的 `appendNetTurnLine`')
      .toContain('appendNetTurnLine(');
  });

  it('两个相都调了它：对局相在 `renderNetBoard` 那个分支里、草稿相在 `renderApp(...)` 之后', () => {
    const rr = functionBody(MAIN, 'rerender');
    // ① 对局相那一支：`renderNetBoard(` 与那一行之间，`appendTurnLine(` 必须出现
    const net = rr.indexOf('renderNetBoard(');
    expect(net, 'rerender 里找不到 renderNetBoard(').toBeGreaterThanOrEqual(0);
    const netBranch = rr.slice(net, rr.indexOf('renderLobbyFrame();', net));
    expect(netBranch.length, '切出来的对局相那一段太短 ⇒ 这条腿假绿').toBeGreaterThan(200);
    expect(netBranch, '对局相那一支没有画"轮到谁"那一行').toContain('appendTurnLine(');
    // ② 草稿相那一支：`renderApp(root, state, cb);` 之后紧跟它
    const app = rr.indexOf('renderApp(root, state, cb);');
    expect(app, 'rerender 里找不到 `renderApp(root, state, cb);`（结构被改了？）').toBeGreaterThanOrEqual(0);
    const afterApp = rr.slice(app, app + 600);
    expect(afterApp, '草稿相（走 renderApp 的那一支）没有画"轮到谁"那一行')
      .toContain('appendTurnLine(');
  });

  it('★ 红线未被碰：`src/ui/render.ts` 那条横幅**一个字都没改**（座位号仍在它手里）', () => {
    const RENDER = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/render.ts', import.meta.url)))
        .subarray(0, 16 * 1024 * 1024).toString('utf8'),
    );
    // 这一行（`玩家 ${activePlayer + 1}`）是"座位号横幅"的唯一产出点：它还在原处
    expect(RENDER, 'render.ts 那条座位号横幅不见了（红线文件被改了？）').toContain('`玩家 ${activePlayer + 1}`');
    // 本轮的产出**不许**出现在 render.ts 里（"不碰 render.ts"这条纪律的机检）
    for (const forbidden of ['netTurnText', 'net-turn-line', '轮到你出牌']) {
      expect(RENDER, `render.ts 里出现了本轮的东西「${forbidden}」（越界改红线文件）`)
        .not.toContain(forbidden);
    }
  });
});
