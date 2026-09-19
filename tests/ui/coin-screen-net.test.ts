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
import { descendants, installStubDom, makeStubEl, queryAllIn, type StubNode } from './net-dom-stub';
import { stripComments, functionBody } from './source-text';
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
 * 接线的源码腿：`main.ts` 那三处必须真的在（否则屏永远不出现）
 * ------------------------------------------------------------------ */

describe('G5 T11-B · `main.ts` 的接线形状（文本腿；`main.ts` 不能 import）', () => {
  const MAIN = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
      .subarray(0, 8 * 1024 * 1024).toString('utf8'),
  );

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

  it('★ 结构腿：`main.ts` 里 `createNetDriver` 零命中（接线归 T11-C，本段不许碰）', () => {
    expect(MAIN, 'T11-B 里出现了 createNetDriver（那是 T11-C 的接线）').not.toContain('createNetDriver');
  });
});


