/**
 * G5 T11-B 守卫：**联机硬币屏**（`renderCoin` 的 `nav.net` 分支）。
 *
 * ## 它守的是什么
 *
 * D27 把硬币屏插在握手中间之后，这块屏必须同时满足两件事（任务书 §5 的接口）：
 *
 *  - **叫面方**（加入方）：芯片可点，点下即 `choose(side)`；
 *  - **等待方**（房主）：芯片**禁用**、屏上有等待文案，且**落点没到手时不显示落点**。
 *
 * 第二条是判据 4 的屏面那一半（另一半在真浏览器里：`tools/browser-truth-lobby-cdp.mjs`）。
 *
 * ## 能力边界
 *
 * 这里用手写 DOM 桩（`tests/ui/net-dom-stub.ts`，没有 jsdom）真跑 `renderCoin` ——
 * 能证明的是**元素树与文案**（哪些类在、按钮禁没禁、文本里有什么），
 * 证明不了布局与观感，也证明不了"玩家真的点了"（那要真浏览器）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, stubAnimsOf, type StubNode } from './net-dom-stub';
import { stripComments, functionBody, objectBody } from './source-text';
import { renderCoin, type CoinNetView } from '../../src/ui/home';
import type { CoinSide } from '../../src/app/coin';

let restoreDom: (() => void) | null = null;

function mountRoot(): StubNode {
  restoreDom = installStubDom();
  return makeStubEl('div');
}

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/** 屏上的全部文本（按 DOM 顺序拼） */
function textOf(root: StubNode): string {
  return descendants(root).map((n) => n.text).join('\n');
}

/** 在某个节点上**真派发一次点击**（照 `net-lobby.test.ts` 的桩做法） */
function fireClick(node: StubNode): void {
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
}

/** 画一帧联机硬币屏，返回 root 与"记下了哪些点击" */
function renderNet(view: CoinNetView, rootIn?: StubNode): { root: StubNode; picked: CoinSide[] } {
  const root = rootIn ?? mountRoot();
  const picked: CoinSide[] = [];
  renderCoin(root as unknown as HTMLElement, {
    backHome: () => { /* 返回不在本文件的面内 */ },
    beginGame: () => { /* 进牌桌归 T11-C */ },
    net: { ...view, choose: (side) => { picked.push(side); view.choose(side); } },
  });
  return { root, picked };
}

describe('G5 T11-B · 联机硬币屏（`renderCoin` 的 `nav.net` 分支）', () => {
  it('★ 等待方（房主）：芯片禁用 + 等待文案；落点没到手时**屏上没有落点**', () => {
    const { root, picked } = renderNet({ role: 'waiter', choose: () => {}, chosen: null, landed: null, winner: null, caller: 1 });
    const chips = queryAllIn(root, 'button.coin-face-chip');
    expect(chips.length, `码面芯片不是两枚（实际 ${chips.length} 枚）`).toBe(2);
    for (const chip of chips) {
      expect((chip as unknown as { disabled?: boolean }).disabled, `等待方的芯片「${chip.text}」没被禁用`).toBe(true);
    }
    // 点了也没反应（禁用是"看得见"的那一层；"点了不生效"是行为那一层）
    fireClick(chips[0]);
    expect(picked, '等待方点芯片竟然叫了面').toEqual([]);
    const text = textOf(root);
    expect(text, '等待文案里没有"等对方"这类可读说明').toMatch(/等对方/);
    // 判据 4 的关键那一半：落点没到手 ⇒ 屏上**没有**落点读数
    expect(queryAllIn(root, '.coin-result-text').length, '等待方的屏上出现了落点读数（落点提前回填了）').toBe(0);
    // 大币也还是"没落地"那一态（`settled` 只在落点到手之后加）
    const disc = queryAllIn(root, '.coin-disc-big');
    expect(disc.length, '屏上没有大币').toBe(1);
    expect(disc[0].classList.contains('settled'), '落点还没到手，大币却已经是"定格"态').toBe(false);
  });

  it('★ 叫面方（加入方）：芯片可点，点下即 `choose(side)`；落点还没到手时也没有落点读数', () => {
    const { root, picked } = renderNet({ role: 'caller', choose: () => {}, chosen: null, landed: null, winner: null, caller: 1 });
    const chips = queryAllIn(root, 'button.coin-face-chip');
    expect(chips.length, '叫面方的芯片不是两枚').toBe(2);
    for (const chip of chips) {
      expect(Boolean((chip as unknown as { disabled?: boolean }).disabled), `叫面方的芯片「${chip.text}」被禁用了`).toBe(false);
    }
    expect(queryAllIn(root, '.coin-result-text').length, '叫面方还没点就出现了落点读数').toBe(0);
    // 点第一枚（正面，屏上口径 1）
    fireClick(chips[0]);
    expect(picked, '点芯片没有把面交给宿主').toEqual([1]);
    // 点第二枚（反面 2）
    fireClick(chips[1]);
    expect(picked, '第二次点击没有把面交给宿主').toEqual([1, 2]);
  });

  it('★ 叫面方：叫完（`chosen` 有值、`landed` 还是 null）时落点仍然不出现，但选中的芯片看得出来', () => {
    const { root } = renderNet({ role: 'caller', choose: () => {}, chosen: 2, landed: null, winner: null, caller: 1 });
    const chips = queryAllIn(root, 'button.coin-face-chip');
    const selected = chips.filter((c) => c.classList.contains('selected'));
    expect(selected.length, '没有一枚芯片是选中态').toBe(1);
    expect(selected[0].text, '选中的不是叫出去的那一面（反面）').toBe('反面');
    expect(queryAllIn(root, '.coin-result-text').length, '还没落地就出现了落点读数').toBe(0);
  });

  it('★ 落点到手（两端同款）：屏上出现落点与先选协议者，且没有"掷硬币"按钮', () => {
    // 叫面者座位是 1（加入方）、落点 2 与它叫的一致 ⇒ 加入方先选协议（"玩家 2 先选协议"）
    const { root } = renderNet({ role: 'caller', choose: () => {}, chosen: 2, landed: 2, winner: 1, caller: 1 });
    const hit = queryAllIn(root, '.coin-result-text');
    expect(hit.length, '落点到手之后屏上没有落点读数').toBe(1);
    expect(hit[0].text, '落点文案不是那一面').toContain('掷出 反面');
    expect(hit[0].text, '落点文案里的先选协议者不对').toContain('玩家 2 先选协议');
    // ⚠️ **进牌桌归 T11-C**：这块屏上不许出现热座那个「掷硬币」/「开始对局」按钮
    expect(queryAllIn(root, 'button.coin-flip-btn').length, '联机硬币屏上出现了热座的「掷硬币」按钮').toBe(0);
    expect(textOf(root), '联机硬币屏上出现了「开始对局」按钮').not.toContain('开始对局');
    // 叫错的那一半：落点 1、叫的是 2 ⇒ 房主座位（0）先选 ⇒ 玩家 1
    const miss = renderNet({ role: 'caller', choose: () => {}, chosen: 2, landed: 1, winner: 0, caller: 1 });
    expect(queryAllIn(miss.root, '.coin-result-text')[0].text, '叫错时先选协议者不是另一方').toContain('玩家 1 先选协议');
  });

  it('★ 胜负依据没齐（`winner === null`）⇒ 屏上**不定格**，哪怕落点已经到手', () => {
    // 房主侧的真实形状：种子在它手里（落点算得出），而"加入方叫的那一面"还没揭示
    // ⇒ app 交下来的 `winner` 是 null ⇒ 屏上不许出现任何落点/胜负读数
    const { root } = renderNet({ role: 'waiter', choose: () => {}, chosen: null, landed: 1, winner: null, caller: 1 });
    expect(queryAllIn(root, '.coin-result-text').length, '胜负依据没齐就定格了（两端会定格出两个相反读数）').toBe(0);
    expect(textOf(root), '屏上出现了"先选协议"这句胜负文案').not.toContain('先选协议');
    // 反空转：把 `winner` 填上，同一份落点就必须定格（否则上面那条在"永远不定格"上恒真）
    const ok = renderNet({ role: 'waiter', choose: () => {}, chosen: null, landed: 1, winner: 0, caller: 0 });
    expect(queryAllIn(ok.root, '.coin-result-text').length, '胜负依据齐了却仍不定格').toBe(1);
  });

  it('★ 文案腿：联机硬币屏的可见文案不含"公平 / 防作弊 / 无法作弊"（D3），也不含热座那句', () => {
    for (const role of ['caller', 'waiter'] as const) {
      for (const landed of [null, 1, 2] as const) {
        const { root } = renderNet({ role, choose: () => {}, chosen: landed ?? null, landed, winner: null, caller: 1 });
        const text = textOf(root);
        for (const banned of ['公平', '防作弊', '无法作弊']) {
          expect(text.includes(banned), `联机硬币屏（${role} / landed=${String(landed)}）出现了「${banned}」`).toBe(false);
        }
        expect(text, '联机硬币屏上出现了热座那句「玩家一掷硬币决定先后手」（联机下不成立）')
          .not.toContain('玩家一掷硬币决定先后手');
        // 联机标题必须说清"由加入方选面"
        expect(text, `联机硬币屏（${role}）的标题没有说清"由加入方选面"`).toContain('加入方');
      }
    }
  });

  it('★ 反正控：热座那条路（没有 `nav.net`）仍是原来的屏 —— 标题与「掷硬币」按钮都在', () => {
    const root = mountRoot();
    renderCoin(root as unknown as HTMLElement, {
      backHome: () => {},
      seed: 'seed-hotseat',
      beginGame: () => {},
    });
    const text = textOf(root);
    expect(text, '热座硬币屏的标题被改掉了').toContain('玩家一掷硬币决定先后手');
    expect(queryAllIn(root, 'button.coin-flip-btn').length, '热座硬币屏上没有了「掷硬币」按钮').toBe(1);
    expect(queryAllIn(root, '.coin-result-text').length, '热座硬币屏还没掷就出现了落点').toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * ★★ G5 T19 修复轮：**三格由相位决定**（行为腿；本轮评审的阻断项）
 *
 * ## 为什么这三条是行为腿，而不是"读源码符号"
 *
 * 第一版把"这一刻该不该播动画"写成 `tossing = landed !== null && !settled` —— 从**落点**反推
 * 相位 ⇒ `'call'`（告知"谁叫了哪一面"）那一格在屏上**已经在播动画**，用户要的"先告知"那一格
 * 实际不存在（评审实测）。
 *
 * 这一族判据要问的是"**哪一枚元素被起了动画**"，所以桩里补了 `animate`/`getAnimations` 的
 * 记录实现（`tests/ui/net-dom-stub.ts` 的 `stubAnimsOf`）—— 没有它，产出代码里那句
 * `typeof disc.animate === 'function'` 守卫恒假，这三条**全是空腿**。
 * ------------------------------------------------------------------ */

describe('G5 T19 · 硬币屏三格（`net.coinPhase` 决定画什么）', () => {
  /** 这一帧里被起过动画的元素（按元素树顺序） */
  function animated(root: StubNode): { disc: number; stage: number } {
    const disc = descendants(root).filter((n) => isClass(n, 'coin-disc-big'));
    const stage = descendants(root).filter((n) => isClass(n, 'coin-stage'));
    return {
      disc: disc.reduce((n, el) => n + stubAnimsOf(el).length, 0),
      stage: stage.reduce((n, el) => n + stubAnimsOf(el).length, 0),
    };
  }

  it("★ `'call'` 格：只说「谁叫了哪一面」，**一条动画都不起**", () => {
    const { root } = renderNet({
      role: 'caller', choose: () => {}, chosen: 2, landed: 2, winner: 1, caller: 1, coinPhase: 'call',
    });
    const text = textOf(root);
    expect(text, "`'call'` 格没有说清谁叫了哪一面").toContain('玩家 2 叫了「反面」');
    expect(text, "`'call'` 格就已经说「正在抛硬币」了").not.toContain('正在抛硬币');
    // ★ 本轮的核心：这一格**不许**播动画（第一版在这里就播了）
    expect(animated(root), "`'call'` 格起了动画（告知那一格被动画盖掉了）").toEqual({ disc: 0, stage: 0 });
    // 也不许提前给结论
    expect(queryAllIn(root, '.coin-result-text').length, "`'call'` 格出现了结论行（结果提前了）").toBe(0);
  });

  it("★ `'toss'` 格：起两条动画（`disc` 转 + `stage` 抛），仍然只说「谁叫了哪一面」", () => {
    const { root } = renderNet({
      role: 'caller', choose: () => {}, chosen: 2, landed: 1, winner: 0, caller: 1, coinPhase: 'toss',
    });
    expect(animated(root), "`'toss'` 格没有起动画（或起的条数不对）").toEqual({ disc: 1, stage: 1 });
    const text = textOf(root);
    expect(text, "`'toss'` 格没有说清谁叫了哪一面").toContain('玩家 2 叫了「反面」');
    expect(text, "`'toss'` 格没有那句「正在抛硬币」").toContain('正在抛硬币');
    expect(queryAllIn(root, '.coin-result-text').length, "`'toss'` 格就把结论给出了（动画还没演完）").toBe(0);
  });

  it("★ `'settled'` 格：出结论行、**不再起动画**；`prefers-reduced-motion` 下动画那一格也不起", () => {
    const { root } = renderNet({
      role: 'caller', choose: () => {}, chosen: 2, landed: 2, winner: 1, caller: 1, coinPhase: 'settled',
    });
    expect(animated(root), "`'settled'` 格又起了一次动画（每格只该演一次）").toEqual({ disc: 0, stage: 0 });
    const hit = queryAllIn(root, '.coin-result-text');
    expect(hit.length, "`'settled'` 格没有结论行").toBe(1);
    expect(hit[0].text, '结论行里的先选协议者不对').toContain('玩家 2 先选协议');
    // 动态偏好：动画那一格也不许起动画（换图照做 —— 结论仍要正确）
    const reduced = renderNet({
      role: 'caller', choose: () => {}, chosen: 2, landed: 1, winner: 0, caller: 1,
      coinPhase: 'toss', reducedMotion: true,
    });
    expect(animated(reduced.root), '`prefers-reduced-motion` 下仍然起了动画').toEqual({ disc: 0, stage: 0 });
    expect(textOf(reduced.root), '动态偏好下没有那句「正在抛硬币」（告知那一半丢了）').toContain('正在抛硬币');
  });

  it('★ 屏上把"这一刻在哪一格"挂成 `data-coin-stage`（门禁/排查读它）', () => {
    for (const phase of ['call', 'toss', 'settled'] as const) {
      const { root } = renderNet({
        role: 'waiter', choose: () => {}, chosen: 1, landed: 1, winner: 1, caller: 1, coinPhase: phase,
      });
      const screens = queryAllIn(root, '.coin-screen');
      expect(screens.length, '屏上没有 `.coin-screen`').toBe(1);
      expect((screens[0].getAttribute as (n: string) => unknown)('data-coin-stage'),
        `\`${phase}\` 格没有挂到 data-coin-stage`).toBe(phase);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 接线的源码腿：`main.ts` 那三处必须真的在（否则屏永远不出现）
 * ------------------------------------------------------------------ */

describe('G5 T11-B · `main.ts` 的接线形状（文本腿；`main.ts` 不能 import）', () => {
  const MAIN = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
      .subarray(0, 8 * 1024 * 1024).toString('utf8'),
  );

  /** 某个 token 的全部出现（1-based 行号 + 该行）——失败信息里指名道姓 */
  function occurrences(src: string, token: string): string[] {
    const out: string[] = [];
    src.split('\n').forEach((line, i) => {
      if (line.includes(token)) out.push(`src/main.ts:${i + 1}: ${line.trim()}`);
    });
    return out;
  }

  it('★ `renderLobbyFrame` 先问"该不该画硬币屏"，再画大厅；且硬币屏只画一次', () => {
    const body = functionBody(MAIN, 'renderLobbyFrame');
    expect(body.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    const iCoin = body.indexOf('lobbyCoinView()');
    const iLobby = body.indexOf('renderNetLobby(');
    const iRender = body.indexOf('renderCoin(');
    expect(iCoin, 'renderLobbyFrame 里没有问 lobbyCoinView()（硬币屏永远不出现）').toBeGreaterThanOrEqual(0);
    expect(iRender, 'renderLobbyFrame 里没有调 renderCoin（硬币屏画不出来）').toBeGreaterThanOrEqual(0);
    expect(iLobby, '找不到 renderNetLobby 那一句').toBeGreaterThanOrEqual(0);
    // 顺序：判定 ⇒ 画硬币屏 ⇒ （没有硬币屏时才）画大厅
    expect(iCoin, '硬币屏的判定排在 renderNetLobby 之后（大厅会先画上去）').toBeLessThan(iLobby);
    expect(iRender, 'renderCoin 排在 renderNetLobby 之后').toBeLessThan(iLobby);
    // 只在读数**变了**的时候重画（一次性布尔闩会让屏冻在第一次那一帧上：实测症状是
    // 落点已经算出来、相位也走到 complete 了，屏上却永远停在"等对方叫面"）
    expect(body, '没有"读数变了才重画"的闸（lobbyCoinShown 指纹）').toContain('lobbyCoinShown');
    expect(body, 'lobbyCoinShown 不是读数指纹（`sig`）').toContain('sig');
    // 联机那一支**不许**给种子（D27）
    const coinCall = body.slice(iRender, body.indexOf('});', iRender));
    expect(coinCall, 'renderCoin 的联机分支里给了 seed（D27：种子在屏打开时还不该有）').not.toMatch(/\bseed\s*:/);
  });

  it('★ `chooseFace` 注进了大厅客户端，且硬币屏的 `choose` 真的接到那个 resolve 上', () => {
    const start = functionBody(MAIN, 'startLobby');
    expect(start, 'startLobby 里没有注入 chooseFace（大厅永远问不到面）').toContain('chooseFace:');
    expect(start, 'chooseFace 没有把 resolve 存起来（屏上那一次点击没地方落）').toContain('chooseFaceResolve');
    /**
     * ★ 读数的算法住在 `net-lobby.ts` 的 `lobbyCoinViewOf()`（修复轮搬的；那里能在 node 里
     * 用真客户端跑，行为腿见 `tests/ui/net-lobby-coin-consensus.test.ts`）。
     * `main.ts` 这一层只剩"把点击接到 Promise + 叫完驱动一次"。
     */
    const view = functionBody(MAIN, 'lobbyCoinView');
    expect(view.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(120);
    expect(view, 'lobbyCoinView 没有调 lobbyCoinViewOf（读数算法没接上）').toContain('lobbyCoinViewOf');
    expect(view, 'lobbyCoinView 没有把点击接到 chooseFaceResolve 上').toContain('chooseFaceResolve');
    // 叫完面必须驱动一次（面是异步到的、而驱动循环是同步的）
    expect(view, 'lobbyCoinView 里没有 onChosen 的驱动（叫完面握手会停住）').toContain('onChosen');
    expect(view, 'onChosen 里没有 drive()').toContain('drive()');
  });

  it('★ **读数算法**（`net-lobby.ts` 的 `lobbyCoinViewOf`）四条纪律在源码里都在', () => {
    const code = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    const view = functionBody(code, 'lobbyCoinViewOf');
    expect(view.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    // 没有"要面"的能力 ⇒ 屏上不出现硬币屏（任务书 §5 的接口要求）
    expect(view, 'lobbyCoinViewOf 没有问 canChooseFace（没有该能力时也会画硬币屏）').toContain('canChooseFace');
    // 两端的角色由会话层那一侧定（不是屏自己猜）
    expect(view, 'lobbyCoinViewOf 没有按角色分叫面方 / 等待方').toMatch(/role === 'host'/);
    expect(view, 'lobbyCoinViewOf 没有用会话层读到的"叫面者座位"当 caller').toContain('callerSeat');
    // ★ 先选协议者由**规则那一份**（`draftStarterFor`）算，且"对端叫的面"读的是 `peerChosenSide`
    expect(view, 'lobbyCoinViewOf 没有用 draftStarterFor 算先选协议者').toContain('draftStarterFor');
    expect(view, 'lobbyCoinViewOf 里房主那一侧的"叫出去的面"不是 peerChosenSide（会退化成"拿落点比落点"）')
      .toContain('peerChosenSide');
    expect(view, 'lobbyCoinViewOf 没有把"胜负依据齐没齐"挡在落点前面（两端会各自定格一次错读数）')
      .toContain('winnerReady');
  });

  it('★ 复位：`resetToMainInterface` 把硬币屏那三个模块态也清掉（否则下一局带上一局的读数）', () => {
    const body = functionBody(MAIN, 'resetToMainInterface');
    expect(body, 'resetToMainInterface 没有清 chooseFaceResolve').toContain('chooseFaceResolve = null;');
    expect(body, 'resetToMainInterface 没有把 lobbyCoinShown 复位').toContain('lobbyCoinShown = null;');
    expect(body, 'resetToMainInterface 没有把 faceChosen 复位（下一局第一次叫面会被吞掉）').toContain('faceChosen = false;');
  });

  it('★ 结构腿：`main.ts` 里 `createNetDriver(` 恰 1 处，且第一条 `arm(` 排在 `rerender()` 之前', () => {
    /**
     * ★★ T11-C 把 T11-B 的那条"零命中"腿换成了**计数 + 顺序**腿 —— 任务书 §6 判据 2 的
     * 原文是"`createNetDriver(` 在 `src/main.ts` 恰好 1 处"。零命中那条在 T11-B 是对的
     * （接线归 T11-C），本段接线落地之后它必然红：**红一次就说明它当时真的在数**。
     */
    const hits = occurrences(MAIN, 'createNetDriver(');
    expect(hits.length, `main.ts 里 createNetDriver( 出现 ${hits.length} 处（应为恰好 1 处）：\n${hits.join('\n')}`)
      .toBe(1);
    const body = functionBody(MAIN, 'enterNetGame');
    expect(body.length, '抽到空片段（enterNetGame 被改名了？）⇒ 本判据假绿').toBeGreaterThan(200);
    expect(body, 'enterNetGame 里没有 createNetDriver(').toContain('createNetDriver(');
    // ★ 顺序：`arm(state)` 必须排在 `rerender()` 之前（否则第一帧会被当成"宿主从没递过状态"）
    const iArm = body.indexOf('.arm(state)');
    const iRender = body.indexOf('rerender()');
    expect(iArm, 'enterNetGame 里没有 arm(state)（对端帧会烂在队列里）').toBeGreaterThanOrEqual(0);
    expect(iRender, 'enterNetGame 里没有 rerender()（进不了草稿屏）').toBeGreaterThanOrEqual(0);
    expect(iArm, 'arm(state) 排在 rerender() 之后（第一帧会被当成"宿主从没递过状态"）').toBeLessThan(iRender);
    // 不许出现**第二处** `createBrowserTransport`：传输必须复用握手那一条
    const transports = occurrences(MAIN, 'createBrowserTransport(');
    expect(transports.length, `main.ts 里 createBrowserTransport( 出现 ${transports.length} 处（只许 1 处：握手那一条）:\n${transports.join('\n')}`)
      .toBe(1);
  });

  it('★ 接线腿（值那一半）：`enterNetGame()` 用的是握手交出来的那一组数，四样逐字可查', () => {
    /**
     * ## 为什么这几条必须是**文本腿**（说清能力边界，别高估）
     *
     * node 腿（`tests/ui/net-lobby-handoff.test.ts`）能真跑 `handoff()` 与 `createGame`，
     * 但它**读不到 `main.ts`**（应用入口，node 里 import 不了）⇒ 它其实是在**测试自己复刻的
     * 那几行**。镜像实测（2026-09-19，见报告 §变异）：
     *  - M1（把喂给 `createGame` 的 `draftStarter` 取反）⇒ node 腿 **16/16 全绿**；
     *  - M2（去掉 `createNetDriver` 接线、换成本地驱动）⇒ node 腿 **16/16 全绿**；
     *  - M4（删掉 `arm(state)`）⇒ node 腿 **16/16 全绿**。
     *
     * 三条都只在**真浏览器门**上红（`tools/browser-truth-lobby-cdp.mjs` ③.6/③.7/③.8：
     * 两端指纹不再相等 / 帧烂在队列里）。而浏览器门要起两个 Chrome、跑一分钟 ——
     * 这一组文本腿把同一件事在**毫秒级**再钉一遍：它问的是"`enterNetGame` 里那四样
     * 到底写的是什么值"，而不是"某一行文本在不在"。
     */
    const body = functionBody(MAIN, 'enterNetGame');
    expect(body.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    // 句内空格规范化（源码里换行/缩进会变，值不会）
    const flat = body.replace(/\s+/g, ' ');
    // ① 种子与先选者：都来自 `handoff()`，且 `draftStarter` **原样**喂给 `createGame`
    expect(body, '没有从 client.handoff() 取那一组数').toContain('client.handoff()');
    expect(flat, 'createGame 没有用握手交出来的 seed（`seed,` 简写不见了？）').toContain('seed, draftStarter,');
    expect(flat, 'draftStarter 不是原样喂进去的（取反/换值 ⇒ 两端会开出两局不同的棋）')
      .not.toMatch(/draftStarter:\s*\(?1 - /);
    // ② firstToPlay 逐字是 1 - draftStarter（任务书 §3 第 7 条：只搬家、不改值）
    expect(flat, "firstToPlay 不是 `(1 - draftStarter) as PlayerId`").toContain('firstToPlay: (1 - draftStarter) as PlayerId,');
    // ③ 驱动与座位：传输必须是握手那一条、座位必须是 `hand.seat`
    /**
     * ★ **G5 T13-B 同步了这一条**（值一个字没改，多的只是 `recorder` 那一个入参）：
     * D8 的重连凭据是"主机内存里的当前 `MatchFile`"，而档案的唯一载体是驱动的记录器
     * （`createNetDriver` 的 `recorder` 选项）⇒ 这一句多了第三个字段。
     * 判据要钉的两件事仍是"传输是握手那一条、座位是 `hand.seat`"，所以这里按**前缀**匹配。
     */
    expect(flat, 'createNetDriver 用的不是握手那条传输/本端座位')
      .toContain('createNetDriver({ transport: hand.transport, seat: hand.seat,');
    expect(flat, 'createNetDriver 没有把重连凭据的记录器挂上（D8：档案只能从这里来）')
      .toContain('createNetDriver({ transport: hand.transport, seat: hand.seat, recorder });');
    expect(body, '记录器不是 `createMatchFileRecorder()` 造的（那就成了第二份档案载体）')
      .toContain('createMatchFileRecorder()');
    // ④ 递状态：`arm(state)` 逐字在，且排在 `rerender()` 之前
    expect(body, '没有 arm(state)（对端帧会烂在队列里）').toContain('netDriver.arm(state);');
    // ⑤ 草稿设置两端逐字一致：常量模式 + 不传池（协议里没有传设置的消息）
    expect(flat, 'draftMode 不是常量 normal（两端会不一致）').toContain("draftMode: 'normal',");
    /**
     * ★★ **G5 T21 同步了这一条**（用户真机反馈 1：联机草稿只给了 12 套协议）。
     *
     * 原判据断言联机这一条里有 `draftPool: randomPoolFromSeed(seed, 12),`。T21 把它改成
     * **不传池**（`createGame` 落回全量默认池 `create.ts:77`，与热座默认一致）⇒ 这一格从
     * "值等于某个随机池"换成"**显式不传**"：那一个字面量在 `enterNetGame` 里必须不在，
     * 否则联机的池又被限成 12 套（这正是本轮修掉的那个缺陷）。两端一致这条判据没变 ——
     * 全量池是常量，比"同种子派生的池"更不依赖本地读数。
     */
    expect(flat, 'enterNetGame 又给联机传了 12 套随机池（本轮修掉的缺陷回来了）')
      .not.toContain('randomPoolFromSeed(');
    expect(flat, 'enterNetGame 没有显式不传 draftPool（两端会各自落回不同的默认？）')
      .toContain('draftPool: undefined,');
  });

  /**
   * ★★ **G5 T21 缺陷 2：视角座位 = 本端座位**（用户真机反馈：两端看到的是同一个视角）。
   *
   * ## 这条腿能证什么、不能证什么（先写清边界）
   *
   * 它读**源码文本**：`enterNetGame()` 里有没有"把 `netViewSeat` 赋成本端座位"这一句。
   * 证不了"真浏览器里渲染器真的按它画"（那要真浏览器 —— 本轮的边界里没有加门的判定；
   * `__g5Match.diag().netViewSeat` 是给真浏览器门/排查用的只读读数，不是本文件的门）。
   *
   * ## 反空转（写死 0 必须红）
   *
   * 断言取的是 `=` 右边**那一个词**（`/netViewSeat\s*=\s*([^;]+);/`）并要求它逐字是 `hand.seat`。
   * 把这一句改成 `netViewSeat = 0;`（这正是缺陷原来的形态：初值 0 一路带进对局）⇒ 右边是 `0`
   * ⇒ 本条**红**。取 `1` 同理。也就是说"座位被写死"这件事在这条腿上是可分辨的。
   *
   * ## 为什么必须在**重连分支之前**
   *
   * 两条路（新开一局 / 重连换驱动）都要赋到。赋在 `if (existing !== null) { … return; }` 里面
   * ⇒ 新开一局那条路漏；赋在那个 `if` 之后（本实现在 `createNetDriver(...)` 之后、`if` 之前）
   * ⇒ 两条路都经过。所以这里连"赋值点排在重连分支的 `return` 之前"一起钉住。
   */
  it('★★ G5 T21 · 视角座位：`enterNetGame()` 把 netViewSeat 设成本端座位（写死 0 必红）', () => {
    const body = functionBody(MAIN, 'enterNetGame');
    expect(body.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    const m = /netViewSeat\s*=\s*([^;]+);/.exec(body);
    expect(m, 'enterNetGame 里没有给 netViewSeat 赋值的句子（视角永远停在模块初值 0）').not.toBeNull();
    const rhs = (m![1] ?? '').replace(/\s+/g, ' ').trim();
    expect(rhs, `netViewSeat 赋的不是本端座位（实际右边是 \`${rhs}\`）—— 写死座位号会让两端看同一个视角`)
      .toBe('hand.seat');
    // 同一个 `hand.seat` 也是喂给驱动的那一个数（同源，不是第二套座位）
    expect(body, '驱动拿到的座位与视角那个数不同源')
      .toContain('createNetDriver({ transport: hand.transport, seat: hand.seat,');
    // 赋值点必须在**重连分支的提前 return 之前**（否则"重连换驱动"那条路赋不到）
    const iSeat = body.indexOf('netViewSeat = hand.seat;');
    const iReconnect = body.indexOf('if (existing !== null) {');
    expect(iReconnect, '找不到重连那一支（判据要按它定位）').toBeGreaterThanOrEqual(0);
    expect(iSeat, 'netViewSeat 的赋值排在重连分支之后 ⇒ 重连那条路赋不到').toBeLessThan(iReconnect);
    // 只读读数：`diag()` 里要看得到渲染器真正吃到的那一个数（真浏览器门/排查用）
    const diag = objectBody(MAIN, 'diag: () => {');
    expect(diag, 'diag() 读不到视图座位（真浏览器里 "netSeat === selfSeat" 这条无从判起）')
      .toContain('netViewSeat,');
  });
});


