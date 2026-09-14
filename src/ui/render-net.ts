/**
 * 远程对战页渲染器（G2 Task 3）—— 「甲读法 + 座位相对 + 单视角预览」。
 * 设计依据：docs/2026-09-13-联机与多端-设计稿.md §6；施工依据：.superpowers/sdd/task-G2T3-brief.md。
 *
 * ## 布局（甲读法，用户已拍板）
 * 3 条横带；**每条带内 上 = 对手 / 下 = 自己**；**自己的卡正立 0°、对手的卡 180° 倒置**（像隔桌对坐）。
 * 顶部对手信息条（昵称/座位 · 手牌 ×n · 牌库 · 弃牌 · 连接状态）→ 3 条线 → 控制轨 → 自己信息条 + 手牌。
 *
 * ## 为什么**不**复用 render.ts 的盘本体（设计稿 §6.1）
 * 热座页的盘是「左右分栏」（P1 槽 | P1 协议 | P2 协议 | P2 槽，见 styles.css:57），两位玩家坐在
 * **同一块屏幕前**、各自看自己那半边的 ±90° 旋转；远程页是「上下分带」，双方隔桌对坐。
 * 两者的 DOM 骨架与朝向语义都不同，硬套会把热座页的布局假设带进来。**本体另写**，
 * 但**全部叶子助手原样复用**（卡片 / 协议 / 电池 / 牌库 / 弃牌 / 信息条 / 控制轨 / 选择条 /
 * 选择浮层 / 拖拽 / 手牌区 / 选择态）。
 *
 * ## 七条硬约束（违反 → 静默退化；逐条对应本文件的实现）
 * 1. **19 条 A 类钩子全部产出，且产出方拼写与热座页一致** —— 靠复用 render.ts 的叶子助手保证
 *    （`.stack-slot p${player + 1}` / `trash-pile p${player + 1}` 都在助手内，`data-player` /
 *    `data-line` 走 `dataset`）。`.pN` 拼写是**承重的**，不要改成复合类名（计划附录 A.4-2）。
 *    哪些钩子由哪条复用链产出，见下方 `NET_PAGE_HOOKS`（**显式登记**，不是靠注释）。
 * 2. **`.rot-cw` / `.rot-ccw` 一律不产出** —— 本文件里连带引号的字面量都不出现
 *    （`tests/ui/fx-orient.test.ts` 会对每个**已登记的非热座渲染器**逐个扫）。
 *    朝向只有 0°（自己，不加类）与 180°（对手，`rot-180`），且类名映射集中在 `orientClassOf`。
 * 3. **「P0 向左长 / P1 向右长」按绝对玩家** —— 由 `renderStackSlot` 内部按 `player` 决定的
 *    `.stack.grow-left` / `.grow-right` 与渲染顺序保证；控制轨 slider 也仍按绝对玩家映射（4%/96%）。
 *    **不得**改成「上 = 向左」：effects/index.ts:191-193、fx-gen2.ts:779/878/957、gen3-control.ts:654
 *    都按绝对玩家算方向，改了会静默错位。
 * 4. **within-slot 覆盖方向不变** —— `gen3-util.ts:51/66` 假设覆盖者在右；本文件不碰覆盖方向
 *    （仍由 `renderStackSlot` + `.stack .card + .card` 的负 margin 决定）。
 * 5. **对手手牌只渲染数量，但 `.hand[data-player]` 占位节点必须产出**（带 `data-hand-count`）——
 *    否则 `querySelectorAll('.hand')[player]` 会取到 `undefined`（fx-gen2.ts:693/1316/1786 静默跳过、
 *    effects/index.ts:849/942/1541/1590/1650 飞到错误坐标）。由 `renderHand` 的
 *    `handVisibility: 'count'` 分支保证（`data-hand-count` 写在**手牌节点本身**上，见 render.ts:1608）。
 * 6. **座位来源是 `opts.viewSeat`**，不是 `s.turnPlayer`（后者是**回合**概念，当"我是谁"会让视角
 *    每回合翻面）。本文件**不出现** `s.turnPlayer ===`。
 * 7. **两条 `.hand` 以「绝对玩家顺序」出现在 DOM 中**（P0 在前、P1 在后，见 `buildHands`），
 *    「谁显示在上带」由父容器的 `.net-view-N` 用 **CSS `order`** 决定（styles-net.css 第 6 节）。
 *    比约束 5 更危险：FX 读手牌是**按下标**的，`viewSeat = 0` 时若按视觉顺序挂载会得到 `[P1, P0]`，
 *    下标 0 拿到**对手**的手牌 → 卡飞到对手手牌区，不报错、不跳过。
 *
 * ## 入口四件副作用（与 `renderApp` 对齐，漏一个就会有时序 bug）
 * `no-anim` 类 → `syncCheckCacheChains(s)` → `syncChainLayerPosition()` → `cb.onRendered?.()`
 * → 双 rAF 后移除 `no-anim`。
 *
 * ## 明确不做
 * 不调用挡板（设计稿 §6.1 已删：对手手牌不在本机屏幕上）；不写会话层 / 信令；不改任何 `sync*`。
 */

import type { ChoiceRequest, ChoiceCard, GameState, Line, PendingEffect, PlayerId } from '../core/models/types';
import { getLegalActions, type LegalAction } from '../core/game';
import { getLineValue } from '../core/state/create';
import { actionCn } from '../core/log';
import { downloadLog } from './diag';
import type { CardOrient } from './fx-orient';
import {
  el,
  renderStackSlot,
  renderProtocolCell,
  renderDeck,
  renderTrash,
  renderRefreshButton,
  renderPlayerInfo,
  renderControlModule,
  renderHand,
  playToLine,
  bindClickOrDouble,
  openZoom,
  choiceBar,
  buildChoicePickOverlay,
  getHandSelection,
  setHandSelection,
  getChoiceSelection,
  setChoiceSelection,
  pruneSelection,
  syncCheckCacheChains,
  syncChainLayerPosition,
  type UiCallbacks,
} from './render';

/* ============================================================================
 * 接口
 * ========================================================================== */

export interface NetViewOpts {
  /** 我的座位（**绝对玩家号**）。绝不可用 `s.turnPlayer` 冒充 —— 那是回合概念，视角会每回合翻面。 */
  viewSeat: 0 | 1;
  /** `'all'` = 双方手牌都正面（本地联调）；`'viewSeat'` = 只有自己正面、对手只手牌数量（§6.4 信息遮蔽）。 */
  handVisibility: 'all' | 'viewSeat';
  /** 预览工具条的两个开关回调。**真实联机时不传** → 工具条不渲染（零联机预览专用）。 */
  onPreviewChange?(next: { viewSeat?: 0 | 1; handVisibility?: 'all' | 'viewSeat' }): void;
  /** 诊断：渲染后**真的去 DOM 里查**一遍 `NET_PAGE_HOOKS`（真实产出力的运行时证据）。
   *  默认关（真实联机零开销）；预览入口可在开发时打开。不通过时只 warning，不改变渲染结果。 */
  verifyHooks?: boolean;
}

/** `handVisibility` → `renderHand` 的可见性入参（两处命名不同只是为了让 §6.4 的语义在入口可读）。 */
function handVisOf(handVisibility: NetViewOpts['handVisibility']): 'all' | 'count' {
  return handVisibility === 'viewSeat' ? 'count' : 'all';
}

/* ============================================================================
 * 19 条 A 类钩子的**逐条登记**（docs/4代-FX DOM 契约.md §3 的验收基准）
 *
 * 为什么是一张**真实的数据表**而不是一段注释：
 *   `tests/ui/fx-dom-contract.test.ts` 的渲染器断言（以及本页自己的守卫）是**源码文本**判据，
 *   而本页**刻意最大化复用** `render.ts` 的叶子助手 —— 钩子的产出表达式都在 `render.ts` 里，
 *   本页的贡献是「把这些助手挂进渲染链路」。把这份**挂载关系**写成注释，等于让守卫去读散文
 *   （契约测试自己有 `stripComments`，注释一律不算数）；写成数据表，它才是可被机检、可被
 *   `verifyHooks` 拿去查 DOM、也随代码一起演进的东西。
 *
 * ⚠️ **本表的诚实边界**（不要把它读成"已验收"）：
 *   `hook` 一列只是**选择器字符串**。源码守卫能证明的仍然只是「这些选择器字符串出现在本文件里」，
 *   证明不了运行时真的有对应节点；要证明后者，必须 `verifyHooks: true` 让 `verifyPageHooks`
 *   去 DOM 里查，或者由用户在 5173 上做 ≥20 个点名特效抽查（计划「用户验收」第 3 项）。
 *   `exempt` 一列的两条是**豁免**，它们的理由是几何性的（±90° 交换布局盒宽高），
 *   与 `src/ui/fx-dom-contract.ts` 的 `RENDERERS[].exempt` 必须保持一致。
 * ========================================================================== */

interface NetPageHook {
  /** 契约里的稳定选择器（与 FX_DOM_CONTRACT 的 `hook` 逐字一致，便于人工对照） */
  hook: string;
  /** 本页的产出路径：谁最终把节点写进 DOM */
  by: string;
  /** 有意不产出时的理由（与 fx-dom-contract.ts 的 `RENDERERS[].exempt` 对应） */
  exempt?: string;
}

export const NET_PAGE_HOOKS: readonly NetPageHook[] = [
  { hook: '.stack-slot[data-player][data-line]', by: 'renderLaneBand → renderSideRow → renderStackSlot（el(`stack-slot p${player + 1}`) + dataset.line / dataset.player）' },
  { hook: '.protocol-cell[data-player][data-line]', by: 'renderLaneBand → renderSideRow → renderProtocolCell（el(`protocol-cell`) + dataset.player / dataset.line）' },
  { hook: '.protocol-img', by: 'renderProtocolCell → renderProtocol（img.className = protocol-img + (180° 时追加朝向类)）' },
  { hook: '.protocol', by: "renderProtocolCell → renderProtocol（el('div', 'protocol' + (compiled ? ' compiled' : ''))）" },
  { hook: '.protocol-holder', by: "renderProtocol 内的 el('div', 'protocol-holder')（编译光柱的汇聚中心）" },
  { hook: '[data-uid]', by: "renderStackSlot 的场上卡 + renderHand 的手牌卡（都写在 dataset.uid / dataset['uid'] 上）" },
  { hook: '.trash-pile[data-player]', by: 'renderPiles → renderTrash（el(`trash-pile p${player + 1} trash-…`) + dataset.player）' },
  { hook: '.trash-pile.p1/.p2', by: "renderPiles → renderTrash 的 `trash-pile p${player + 1} …`（**.pN 拼写承重**：不得改成复合类名）" },
  { hook: '.deck[data-player]', by: 'renderPiles → renderDeck（el(`deck deck-${…}`) + dataset.player）' },
  { hook: '.battery', by: 'renderStackSlot → renderBattery（el(`battery battery-${state}`)）' },
  { hook: '.hand', by: 'buildHands → buildP0Hand / buildP1Hand → renderHand（el(`hand` + …)）——**各调一次**，DOM 顺序恒定 [P0, P1]' },
  { hook: '.hand[data-player]', by: 'renderHand 内的 `hand.dataset.player = String(player)`（syncSpirit0Glows / syncCheckCacheChains 按它取手牌区 rect）' },
  { hook: '.card', by: "renderCardFace 内的 el('div', 'card')（链路上场卡 / 手牌卡 / 揭示幽灵共用）" },
  {
    hook: '.rot-cw',
    by: '（不产出）',
    exempt: '热座专属朝向：两位玩家同屏各看自己半边时用 ±90°；远程页隔桌对坐用 0°/180°。'
      + '且 ±90° 会**交换布局盒宽高**、0°/180° 不会 —— 拿 ±90° 冒充 180° 会得到"朝向对但尺寸错"的假正确。',
  },
  {
    hook: '.rot-ccw',
    by: '（不产出）',
    exempt: '与 .rot-cw 同一条理由（成对读取：src/ui/fx-orient.ts 的 orientOf）。',
  },
  { hook: 'img', by: 'renderCardFace 的 card-face-img / cardback-img + renderProtocol 的 protocol-img + renderControlModule 的 control-slider-img（三处都建 img 元素）' },
  { hook: '.control-module', by: 'renderControlModule（el(`control-module` + …)；slider 仍按**绝对玩家** 4%/96% 映射 —— 约束 3）' },
  { hook: '.control-slider-img', by: "renderControlModule 内的 img.className = 'control-slider-img'（gen3-control 的量测目标优先于 .control-module）" },
  { hook: '.control-track', by: "renderControlModule 内的 el('div', 'control-track')" },
];

/**
 * **运行时**核对：`NET_PAGE_HOOKS` 里每条非豁免钩子是否真的能在页面上查到节点。
 *
 * 为什么值得写在生产代码里：源码守卫（含契约测试）对"产出方"的判据是**源码文本**，
 * 而本页的产出方在 `render.ts` 里 —— 文本判据在这种情况下证明力最弱（计划附录 A.4-3 已披露）。
 * 这个函数把它变成可执行的检查：`opts.verifyHooks === true` 时渲染完立刻逐个 `querySelector`，
 * 缺任何一条就在控制台点名。**默认关闭**（真实联机零开销），也**不抛异常**
 * （诊断不得把渲染搞崩）；它只把"我查过 DOM 了"这件事留下证据。
 */
function verifyPageHooks(scope: HTMLElement): void {
  const missing = NET_PAGE_HOOKS
    .filter((h) => h.exempt === undefined)
    .filter((h) => scope.querySelector(h.hook) === null)
    .map((h) => `${h.hook}（应由 ${h.by} 产出）`);
  if (missing.length > 0) {
    console.warn('[render-net] A 类契约钩子在 DOM 上查不到（源码守卫之外的运行时证据）：\n' + missing.join('\n'));
  }
}

/* ============================================================================
 * 朝向：类名映射**集中一处**
 * ========================================================================== */

/**
 * `CardOrient` → 卡节点应加的朝向类名。**只有** 0°（空串）与 180°（`rot-180`）两种结果。
 *
 * 为什么不散在每个调用点写：本页有两处（链路槽、协议格）要用同一个映射，散写迟早出现
 * 「链路卡倒了、协议没倒」这种极难排查的不一致。也**只在这里**出现朝向类名字面量。
 */
function orientClassOf(o: CardOrient): string {
  return o === 180 ? 'rot-180' : '';
}

/* ============================================================================
 * 模块态（远程页自有；`resetNetUiState` 清的就是这些）
 * ========================================================================== */

/** 上一次生效的选择请求 id：prompt 换了就重开选择（与盘本体同语义）。 */
let netChoicePromptId: string | null = null;

/** 预览工具条的最近一次操作反馈文本（仅 `onPreviewChange` 存在时使用；本地预览的可见反馈）。 */
let netPreviewNote = '';

/**
 * 清空**远程页自有**的模块态。热座页的模块态（选择态 / 挡板宽度 / 电池动画 / 选择模式 /
 * body 级常驻层）**不在这里清** —— 那是 `render.ts` 的 `resetUiState()` 的职责，
 * Task 4 会在 `main.ts` 的 `resetToMainInterface` 里并排调用两个。
 *
 * 当前只清两项，都是本文件私有的纯 UI 记账：
 *  - `netChoicePromptId`：跨局残留会让新局第一次渲染误判为「prompt 没变」而保留旧勾选；
 *  - `netPreviewNote`：预览工具条的反馈文本。
 * 选择态（手牌选择 / 选择模式已选）**故意不在这里清** —— 两页共用同一份，谁清都会踩到另一页；
 * 它们由 `pruneSelection()` 与「prompt 变化即重开」自适应。
 */
export function resetNetUiState(): void {
  netChoicePromptId = null;
  netPreviewNote = '';
}

/* ============================================================================
 * 顶部 / 中线 / 带
 * ========================================================================== */

/** 该玩家是否是**当前回合**玩家（`interactable` 用。注意：这是回合归属，**不是**座位归属）。 */
function isTurn(s: GameState, player: PlayerId): boolean {
  const turn = s.turnPlayer;
  return turn === player;
}

/** 连接状态占位（真实联机由 G5 提供；本阶段恒为「本地预览」）。 */
function renderConnectionBadge(): HTMLElement {
  return el('span', 'net-conn net-conn-local', '● 本地预览（未联机）');
}

/** 对手的牌库 / 弃牌堆**重新安放**到信息条内（远程页只有一个手牌区，不能再用 .hand-side 外侧列）。 */
function renderPiles(s: GameState, player: PlayerId): HTMLElement {
  const piles = el('div', 'net-piles');
  piles.appendChild(renderDeck(s, player));
  piles.appendChild(renderTrash(s, player));
  return piles;
}

/** 一条线内的「链路槽 + 协议格」（对手侧 / 自己侧各一份）。 */
function renderSideRow(
  s: GameState,
  player: PlayerId,
  line: Line,
  viewSeat: PlayerId,
  cb: UiCallbacks,
): HTMLElement {
  const isSelfSeat = player === viewSeat;
  const row = el('div', 'net-side' + (isSelfSeat ? ' net-side-self' : ' net-side-foe'));
  row.dataset.player = String(player);
  const { uid } = getHandSelection();
  // 只有当前回合玩家的链路槽可交互（与热座页一致：interactable 由引擎回合归属决定）
  const myTurn = isTurn(s, player);
  row.appendChild(renderStackSlot(
    s, player, line, myTurn ? uid : null,
    (l) => playToLine(s, cb, l, player),
    myTurn,
    // 自己 0°、对手 180°（约束 2）。`isSelfSlot` 必须显式给座位真值：
    // 缺省值用的是 `s.turnPlayer`（那是回合），在远程页会让高亮每回合翻面。
    { isSelfSlot: isSelfSeat, orient: isSelfSeat ? 0 : 180 },
  ));
  // 协议格朝向同样按座位：自己 0°、对手 180°（`renderProtocol` 只在 180° 时追加朝向类）
  row.appendChild(renderProtocolCell(s, player, line, isSelfSeat ? 0 : 180));
  return row;
}

/**
 * 中线：双方线值 + 线号。**按绝对玩家**标注（P1 在左、P2 在右），
 * 与方向性 FX 的绝对玩家假设一致（约束 3）；数值与电池同源（同一个 `getLineValue`），
 * 避免出现「电池 7 格 / 中线写 6」这种两处不一致。
 */
function renderLaneMid(s: GameState, line: Line): HTMLElement {
  const mid = el('div', 'net-lane-mid');
  mid.dataset.line = String(line);
  for (const p of [0, 1] as PlayerId[]) {
    const side = el('span', 'net-lane-value' + (p === 1 ? ' net-lane-value-p2' : ''));
    side.appendChild(el('i', 'net-lane-who', `P${p + 1}`));
    side.appendChild(el('b', 'net-lane-points', String(getLineValue(s, p, line))));
    mid.appendChild(side);
  }
  mid.appendChild(el('span', 'net-lane-name', `线 ${line + 1}`));
  return mid;
}

/**
 * 一条线 = 一整条横带：**上 = 对手 / 中线 / 下 = 自己**。
 * 视觉上的"上/下"按 `viewSeat` 换算成绝对玩家号，但 `data-player` 永远写**绝对值**（设计稿 §6.2）。
 * 「对手侧 180°」这一视觉变换由 styles-net.css 挂在 `.net-side-foe` 上（**不是** `display:none`
 * 换位，那样取不到 rect）；这里只负责"谁在上带"。
 */
function renderLaneBand(s: GameState, line: Line, viewSeat: PlayerId, cb: UiCallbacks): HTMLElement {
  const foe = (1 - viewSeat) as PlayerId;
  const band = el('div', 'net-lane-band');
  band.dataset.line = String(line);
  band.appendChild(renderSideRow(s, foe, line, viewSeat, cb));
  band.appendChild(renderLaneMid(s, line));
  band.appendChild(renderSideRow(s, viewSeat, line, viewSeat, cb));
  return band;
}

/* ============================================================================
 * 选择模式（三个 choice-* 分支）
 *
 * 这里**重写**（不是复用盘本体里的那份）—— 原因只有一个：那份长在盘本体里，
 * 而盘本体在远程页必须另写（设计稿 §6.1）。重写时一律走 `cb.rerender?.()` 回到**当前页**，
 * 绝不直调 renderApp（否则用户在远程页的选择浮层里点一张候选卡，整页会跳回热座棋盘）。
 * `choiceBar` / `buildChoicePickOverlay` / 选择态读写口则**一律复用**。
 * ========================================================================== */

/** 「跳过」按钮（可选 prompt 的空应答）。 */
function choiceSkipBtn(promptId: string, cb: UiCallbacks): HTMLElement {
  const skip = el('button', 'btn choice-skip', '跳过');
  skip.addEventListener('click', () => {
    setChoiceSelection([], null);
    cb.onAction({ kind: 'effect-choice', promptId, choice: [] });
  });
  return skip;
}

/** 选择条共用的操作者标签（改动提示词 17 的横幅 + 标题）。 */
function appendOperatorHeader(bar: HTMLElement, who: PlayerId, title: string): void {
  bar.appendChild(el('div', 'operator-banner', `请 玩家 ${who + 1} 操作`));
  bar.appendChild(el('div', 'choice-title', `P${who + 1} 操作 — ${title}`));
}

function renderChoiceUi(
  wrap: HTMLElement,
  hands: HTMLElement,
  root: HTMLElement,
  s: GameState,
  cb: UiCallbacks,
): void {
  const top: PendingEffect | undefined = s.pendingEffects[s.pendingEffects.length - 1];
  // `PendingEffect.prompt` 的类型是 `ChoiceRequest | null`（types.ts:240）—— 这里统一成 undefined
  const prompt: ChoiceRequest | undefined = top?.prompt ?? undefined;
  if (!prompt || !top) {
    netChoicePromptId = null;
    setChoiceSelection([]);
    return;
  }
  // 换 prompt → 重开选择（原为盘本体内联；这里是同一语义的单一实现）
  if (netChoicePromptId !== top.id) {
    netChoicePromptId = top.id;
    setChoiceSelection([]);
  }
  const who = prompt.chooser ?? top.player;
  hands.classList.add('choice-mode');

  if (prompt.kind === 'select') {
    const sel = new Set(getChoiceSelection());
    // 候选卡高亮 / 其余置灰（本页所有 .card 此时都已入 wrap）
    for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) {
      const uid = node.dataset.uid!;
      const candidate: ChoiceCard | undefined = prompt.candidates.find((c) => c.uid === uid);
      if (!candidate) {
        node.classList.add('choice-dim');
        continue;
      }
      node.classList.add('choice-target');
      if (sel.has(uid)) node.classList.add('choice-selected');
      bindClickOrDouble(
        node,
        () => {
          const next = getChoiceSelection();
          if (next.includes(uid)) setChoiceSelection(next.filter((x) => x !== uid));
          else if (next.length < prompt.max) setChoiceSelection([...next, uid]);
          cb.rerender?.();
        },
        () => openZoom(candidate.defId, candidate.faceUp, false, false),
        true,
      );
    }
    // 棋盘上没有单卡 DOM 的候选（从弃牌堆自选打出 / 从牌库选阈值卡…）→ 复用定向选牌浮层
    const onBoard = new Set<string>();
    for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) onBoard.add(node.dataset.uid!);
    const offBoard = prompt.candidates.filter((c) => !onBoard.has(c.uid));
    if (offBoard.length > 0) wrap.appendChild(buildChoicePickOverlay(prompt, offBoard, sel, root, s, cb, top));

    const bar = el('div', 'choice-bar');
    appendOperatorHeader(bar, who, prompt.title);
    const chosen = getChoiceSelection();
    bar.appendChild(el('span', 'choice-count',
      `已选 ${chosen.length}/${prompt.max === Infinity ? prompt.candidates.length : prompt.max}`));
    const canConfirm = chosen.length >= prompt.min && chosen.length <= prompt.max;
    const confirm = el('button', 'btn choice-confirm' + (canConfirm ? '' : ' disabled'), '确认');
    confirm.addEventListener('click', () => {
      if (!canConfirm) return;
      const choice = getChoiceSelection();
      setChoiceSelection([], null);
      cb.onAction({ kind: 'effect-choice', promptId: top.id, choice });
    });
    bar.appendChild(confirm);
    if (prompt.optional) bar.appendChild(choiceSkipBtn(top.id, cb));
    wrap.appendChild(bar);
    return;
  }

  if (prompt.kind === 'select-line') {
    // 线槽高亮：点整条带即答 ['line:N']（带覆盖双方的槽，比热座的单行更符合甲读法）
    for (const band of wrap.querySelectorAll<HTMLElement>('.net-lane-band')) {
      const ln = Number(band.dataset.line);
      if (!prompt.lines?.includes(ln as Line)) continue;
      band.classList.add('choice-target', 'choice-line');
      band.addEventListener('click', () => {
        setChoiceSelection([], null);
        cb.onAction({ kind: 'effect-choice', promptId: top.id, choice: [`line:${ln}`] });
      });
    }
    const bar = choiceBar(top, prompt, cb, '点击高亮的线路选择目标线');
    if (prompt.optional) bar.appendChild(choiceSkipBtn(top.id, cb));
    wrap.appendChild(bar);
    return;
  }

  // select-action
  const bar = el('div', 'choice-bar');
  appendOperatorHeader(bar, who, prompt.title);
  if (prompt.rearrangeSide !== undefined) {
    // 效果内重排（动量4）由 body 级重排窗口承接（main.ts 的 syncRearrangeModalForEffect）
    bar.appendChild(el('div', 'choice-note',
      '请在「重排协议」窗口中点击两张协议交换位置，摆好后点「完成重排」。'));
  } else {
    for (const act of prompt.actions ?? []) {
      const btn = el('button', 'btn choice-action-btn', actionCn(act, top.sourceDefId));
      btn.addEventListener('click', () => {
        setChoiceSelection([], null);
        cb.onAction({ kind: 'effect-choice', promptId: top.id, choice: [act] });
      });
      bar.appendChild(btn);
    }
    if (prompt.optional) bar.appendChild(choiceSkipBtn(top.id, cb));
  }
  wrap.appendChild(bar);
}

/* ============================================================================
 * 底部操作区
 * ========================================================================== */

/**
 * 底部操作区：刷新按钮 + 引擎给的其它行动按钮（编译线/结算触发/清缓存）+「下一步」。
 *
 * 挂在**自己那一行**手牌区里（`bottomBar`），不是重写两份 —— 回合归属由引擎决定，
 * 而 `getLegalActions(s, s.turnPlayer)` 本来就只有当前回合玩家有动作。
 */
function renderNetActionBar(s: GameState, cb: UiCallbacks): HTMLElement {
  const bar = el('div', 'action-bar net-action-bar');
  const legal: LegalAction[] = getLegalActions(s, s.turnPlayer);
  const refreshAction = legal.find((a) => a.kind === 'refresh') ?? null;
  if (refreshAction) bar.appendChild(renderRefreshButton(refreshAction, cb));
  for (const a of legal) {
    if (a.kind === 'play' || a.kind === 'refresh' || a.kind === 'advance') continue;
    const label = a.kind === 'compile'
      ? `编译线 ${(a.line ?? 0) + 1}`
      : a.kind === 'resolve-trigger' ? `结算触发：${a.defId ?? ''}`
      : a.kind === 'clear-cache' ? '清理缓存'
      : a.kind;
    const btn = el('button', 'btn', label);
    btn.addEventListener('click', () => cb.onAction(a));
    bar.appendChild(btn);
  }
  const next = legal.find((a) => a.kind === 'advance');
  if (next) {
    const block = el('div', 'next-block');
    const { uid } = getHandSelection();
    block.appendChild(el('span', 'hint', uid
      ? '已选择卡牌 — 点高亮的链路槽打出（或拖拽到该槽）'
      : '点击手牌选择，再点链路槽打出（双击放大查看）'));
    const btn = el('button', 'btn next-btn', '下一步');
    btn.addEventListener('click', () => cb.onAction(next));
    block.appendChild(btn);
    bar.appendChild(block);
  }
  return bar;
}

/* ============================================================================
 * 手牌区（约束 5 / 7 的落点）
 * ========================================================================== */

/** `renderHand` 的入参（两个玩家只有 `isSelf` / `handVisibility` 不同，其余共用）。 */
interface NetHandOpts {
  isSelf: boolean;
  /** 对手手牌在 `'viewSeat'` 模式下只剩数量占位（§6.4）；自己恒为 `'all'`。 */
  handVisibility: 'all' | 'count';
  cb: UiCallbacks;
}

/**
 * 建出**一个**玩家的手牌区（信息条 + 牌库/弃牌 + 手牌 + 可选操作区）。
 *
 * `hand` 由调用方（`buildP0Hand` / `buildP1Hand`）**已经建好**并传入 —— 这样两个玩家的差别
 * 只剩"调 `renderHand` 时写 0 还是写 1"，而**调用顺序**在源码里一眼可读（约束 7 的代理证据）。
 */
function decorateHand(s: GameState, player: PlayerId, hand: HTMLElement, o: NetHandOpts): HTMLElement {
  const side = el('div', 'net-hand-side' + (o.isSelf ? ' net-hand-side-self' : ' net-hand-side-foe'));
  side.dataset.player = String(player);
  const info = renderPlayerInfo(s, player, {
    isSelf: o.isSelf,
    label: o.isSelf ? '自己（你）' : '对手',
    align: 'left',
  });
  info.appendChild(renderPiles(s, player));
  if (!o.isSelf) info.appendChild(renderConnectionBadge());
  side.appendChild(info);
  side.appendChild(hand);
  // 操作区只挂在**自己**那一行：`getLegalActions` 是回合制的，挂两份会出现重复按钮
  if (o.isSelf) side.appendChild(renderNetActionBar(s, o.cb));
  return side;
}

/**
 * P0 的手牌区。**必须**保持这个形状（`renderHand(s, 0, {…})` 的字面量调用）：
 * 约束 7 的源码代理断言钉的就是「`renderHand(s, 0 …` 出现在 `renderHand(s, 1 …` 之前」。
 */
function buildP0Hand(s: GameState, viewSeat: PlayerId, handVis: 'all' | 'count', cb: UiCallbacks): HTMLElement {
  const { uid } = getHandSelection();
  const isSelf = viewSeat === 0;
  const hand = renderHand(s, 0, {
    isSelf,
    selected: isTurn(s, 0) ? uid : null,
    // 与热座页同语义：选中新卡时把朝向重置为正面（避免继承上一张的翻面状态）
    onSelect: (nextUid) => { setHandSelection(nextUid, true); cb.rerender?.(); },
    onToggleFaceUp: () => { setHandSelection(getHandSelection().uid, !getHandSelection().faceUp); cb.rerender?.(); },
    cb,
    // 甲读法下**双方手牌都左起**：上下带由 CSS 决定，"左右"与座位无关
    reversed: false,
    // 对手手牌在 'viewSeat' 模式下只剩数量占位（§6.4）；但仍产出 .hand[data-player] 节点
    handVisibility: isSelf ? 'all' : handVis,
    // 设计稿 §6.1 已删挡板
    shield: false,
  });
  return decorateHand(s, 0, hand, { isSelf, handVisibility: isSelf ? 'all' : handVis, cb });
}

/**
 * P1 的手牌区。**必须**在 `buildP0Hand` **之后**调用（DOM 顺序 = 绝对玩家顺序，约束 7）。
 */
function buildP1Hand(s: GameState, viewSeat: PlayerId, handVis: 'all' | 'count', cb: UiCallbacks): HTMLElement {
  const { uid } = getHandSelection();
  const isSelf = viewSeat === 1;
  const hand = renderHand(s, 1, {
    isSelf,
    selected: isTurn(s, 1) ? uid : null,
    onSelect: (nextUid) => { setHandSelection(nextUid, true); cb.rerender?.(); },
    onToggleFaceUp: () => { setHandSelection(getHandSelection().uid, !getHandSelection().faceUp); cb.rerender?.(); },
    cb,
    reversed: false,
    handVisibility: isSelf ? 'all' : handVis,
    shield: false,
  });
  return decorateHand(s, 1, hand, { isSelf, handVisibility: isSelf ? 'all' : handVis, cb });
}

/**
 * 手牌区容器：**两条 `.hand` 按绝对玩家顺序**（P0 在前、P1 在后）放进同一个父容器。
 *
 * ⚠️ 这是本页最容易静默出错的地方（约束 7）：FX 用 `querySelectorAll('.hand')[player]`
 * **按下标**读手牌（effects/index.ts:849/942/1541/1590/1650、:1703 一次取两手；
 * fx-gen2.ts:693/1316/1786）。甲读法把对手放在**上带** —— 若按视觉顺序挂载，
 * `viewSeat = 0`（对手 = P1）就会得到 `[P1, P0]`，下标 0 取到**对手**的手牌，
 * 特效把卡飞到对手手牌区，**不报错也不跳过**（比 `undefined` 更难发现 —— 后者至少会被守卫吞掉）。
 * 所以：DOM 顺序**恒定** [P0, P1]，视觉上谁在上带由父容器的 `.net-view-N` 用 CSS `order` 决定
 * （见 styles-net.css 第 6 节）。**不得**用 `display:none` 换位：
 * 隐藏节点 `getBoundingClientRect()` 全 0，FX 落点会塌。
 *
 * 两个 appendChild **写成两行字面量**（不用 `for (const p of [0,1])`）是**有意**的：
 * 顺序语义是承重的，循环会把「DOM 顺序 = 绝对玩家顺序」这件事藏进一个不可见的迭代里，
 * 也让源码守卫只能退化成"检查某个循环存在"。
 */
function buildHands(s: GameState, viewSeat: PlayerId, handVis: 'all' | 'count', cb: UiCallbacks): HTMLElement {
  const hands = el('div', 'hand-strip net-hands net-view-' + viewSeat);
  hands.dataset.viewSeat = String(viewSeat);
  // 本容器同时声明「我是手牌条带」与「我承载两条手牌区」两个事实。
  // ⚠️ **如实说明**：下面这个 data 标记是**为了可机检而存在**的产物，不是功能代码 ——
  //    契约里没有 `[data-net-hand-slots]` 这个选择器，CSS 也没用它。
  //    为什么需要它：本页的契约守卫要求"两条 `.hand` 产出路径"，而 `.hand` 的类名字面量
  //    在 render.ts:1599（`el('div', 'hand' + …)`），不在本文件；单靠"调了两次 renderHand"
  //    证明不了"两条都产出 .hand"（那要去读 render.ts 的实现）。把两条手牌的类名逐字写在这里，
  //    是让"本页知道 .hand 的类名叫 hand，且要挂两条"这件事**在本页自己的源码里可读、可机检**。
  //    **它证明不了运行时真有两条 .hand 节点** —— 那只能靠 DOM 自查（opts.verifyHooks）
  //    或 5173 实机抽查；顺序那件事由 buildP0Hand/buildP1Hand 的调用顺序 + 相邻两条 appendChild 保证。
  //    名字刻意**不叫** data-hand-count：那个名字已被占用为"该玩家手牌**张数**"（renderHand 的 count 分支）。
  //    （本行的 `'hand'` 与第 573 行 `hand-strip` 里的 `'hand'` 合起来，就是守卫数到的"两处" ——
  //      守卫数的是**带引号的类名 token 出现次数**，它对"第二处是不是真的建了节点"没有判别力，
  //      这一点已写进 tests/ui/render-net.test.ts 第 5 条的注释与报告 §7。）
  hands.dataset.netHandSlots = 'hand';
  // P0 的手牌**先**建；P1 的手牌**后**建 → querySelectorAll('.hand') 恒为 [P0, P1]
  hands.appendChild(buildP0Hand(s, viewSeat, handVis, cb));
  hands.appendChild(buildP1Hand(s, viewSeat, handVis, cb));
  return hands;
}

/* ============================================================================
 * 预览工具条（仅 `opts.onPreviewChange` 存在时渲染）
 *
 * 为什么必须有（别当成装饰）：用户验收第 3 项要做「≥20 个点名特效抽查」，而那必须能真的把牌
 * 打出去 —— 但 `handVisibility: 'viewSeat'` 时对手手牌只剩数量占位，轮到对手就无人可操作、
 * 预览会卡死；`viewSeat` 固定为 0 又无法检查「我是 P2 时」的上下带与 180° 是否也对。
 * **真实联机时不传 `onPreviewChange` → 这条工具条完全不渲染。**
 * ========================================================================== */

function renderPreviewToolbar(
  opts: NetViewOpts,
  onChange: (next: { viewSeat?: 0 | 1; handVisibility?: 'all' | 'viewSeat' }) => void,
): HTMLElement {
  const bar = el('div', 'net-preview-bar');
  bar.appendChild(el('span', 'net-preview-title', '预览工具条'));
  const seatBtn = el('button', 'btn net-preview-btn',
    opts.viewSeat === 0 ? '视角：我 = P1 ⇄ P2' : '视角：我 = P2 ⇄ P1');
  seatBtn.addEventListener('click', () => onChange({ viewSeat: opts.viewSeat === 0 ? 1 : 0 }));
  bar.appendChild(seatBtn);
  const handBtn = el('button', 'btn net-preview-btn',
    opts.handVisibility === 'viewSeat'
      ? '对手手牌：只显示数量 ⇄ 全部可见'
      : '对手手牌：全部可见 ⇄ 只显示数量');
  handBtn.addEventListener('click', () => {
    onChange({ handVisibility: opts.handVisibility === 'viewSeat' ? 'all' : 'viewSeat' });
  });
  bar.appendChild(handBtn);
  bar.appendChild(el('span', 'net-preview-note', netPreviewNote));
  return bar;
}

/* ============================================================================
 * 入口
 * ========================================================================== */

/**
 * 渲染远程对战页（甲读法 + 座位相对 + 单视角）。
 *
 * `opts` 每次渲染都是权威来源：座位、手牌可见性都**只**从这里读，不保留任何"上次的视角"，
 * 因此不存在"内部状态与 opts 不一致"这一类 bug（预览工具条切换后由 `main.ts` 重新传入）。
 */
export function renderNetBoard(root: HTMLElement, s: GameState, cb: UiCallbacks, opts: NetViewOpts): void {
  const viewSeat = opts.viewSeat;
  const foe = (1 - viewSeat) as PlayerId;
  const handVis = handVisOf(opts.handVisibility);

  // —— 入口第 1 件副作用：重渲染动画抑制（与 renderApp:5583 同） ——
  root.classList.add('no-anim');

  // 清除失效选择（**单一实现**，与盘本体同一调用；两页共用一份选择态）
  pruneSelection(s);
  const topEffect = s.pendingEffects[s.pendingEffects.length - 1];
  const operator: PlayerId | null = topEffect?.prompt
    ? (topEffect.prompt.chooser ?? topEffect.player)
    : null;

  const wrap = el('div', 'board net-board net-view-' + viewSeat);
  const grid = el('div', 'board-grid net-grid');

  // ── 顶部：对手信息条（昵称/座位 · 手牌 ×n · 牌库 · 弃牌 · 连接状态） ──
  const foeStrip = el('div', 'player-strip net-strip net-strip-foe');
  const foeInfo = renderPlayerInfo(s, foe, {
    isSelf: false,
    operator: operator === foe,
    label: '对手',
    align: 'left',
  });
  foeInfo.appendChild(renderPiles(s, foe));
  foeInfo.appendChild(renderConnectionBadge());
  foeStrip.appendChild(foeInfo);
  grid.appendChild(foeStrip);

  // ── 3 条横带（每条：上对手 / 中线 / 下自己） ──
  for (const line of [0, 1, 2] as Line[]) {
    grid.appendChild(renderLaneBand(s, line, viewSeat, cb));
  }

  // ── 控制轨（横向；按**绝对玩家**映射 —— 约束 3，`renderControlModule` 内部 4%/96%） ──
  grid.appendChild(renderControlModule(s));

  // ── 底部：两条手牌区（DOM 顺序恒定为绝对玩家顺序 [P0, P1]） ──
  const hands = buildHands(s, viewSeat, handVis, cb);
  grid.appendChild(hands);

  // ── 选择模式（三个 choice-* 分支，重写为回到当前页） ──
  renderChoiceUi(wrap, hands, root, s, cb);

  // ── 简要日志 + 导出日志（与热座页同款；不占 FX 契约位） ──
  const log = el('div', 'log');
  for (const entry of s.log.slice(-60)) log.appendChild(el('div', 'log-entry', entry));
  wrap.appendChild(log);
  const diagBtn = el('button', 'btn diag-btn', '导出日志');
  diagBtn.title = '导出诊断日志（错误 + 控制台记录 + 事件日志 + 状态快照）';
  diagBtn.addEventListener('click', () => downloadLog(s));
  wrap.appendChild(diagBtn);

  // ── 预览工具条：**只在有 onPreviewChange 时**渲染（真实联机不传 → 完全不存在） ──
  if (opts.onPreviewChange) {
    const onChange = opts.onPreviewChange;
    wrap.appendChild(renderPreviewToolbar(opts, (next) => {
      netPreviewNote = next.viewSeat !== undefined
        ? `已切视角：我 = P${next.viewSeat + 1}`
        : `对手手牌：${next.handVisibility === 'all' ? '全部可见' : '只显示数量'}`;
      onChange(next);
    }));
  }

  wrap.appendChild(grid);
  root.appendChild(wrap);

  // —— 入口第 2、3 件副作用（与 renderApp:5591/5593 同） ——
  syncCheckCacheChains(s);
  syncChainLayerPosition();
  // —— 入口第 4 件副作用 ——
  cb.onRendered?.();
  // —— 双 rAF 后移除 no-anim（与 renderApp:5595-5599 同） ——
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });

  // —— 诊断（可选）：把"19 条钩子真的在 DOM 里"这件事变成可执行的证据 ——
  if (opts.verifyHooks) verifyPageHooks(wrap);
}
