/**
 * ★ 2026-10-02（P2，用户口径）：**教学屏**（教练浮层 + 真引擎棋盘 + 关卡流程）。
 *
 * 方案：`docs/2026-10-01-新手引导与教学-方案.md` §5.1（形态）、§5.2（关卡表）、§7 的 P2 行。
 *
 * ## 这一屏怎么"再驱动一局"（探路结论的落点，见方案 §7.8）
 *
 * 棋盘**不重画一遍**：本屏直接调 `renderApp(root, state, cb)`（`src/ui/render.ts` 的既有出口），
 * 只是 `state` 与 `cb` 都是**教学自己的**：
 *  - `state` = `buildLevelState(id)`（`createGame()` 之后摆成的受控局面，`src/tutorial/setup.ts`）；
 *  - `cb` = 本文件的 `tutorialCallbacks()`：**拦白名单**（不在本关 `allowKinds` 里的动作不提交，
 *    只给一句走偏提示）、转调 `applyRecordedAction`（全仓唯一的"操作 → 引擎"映射）、
 *    每次动作后判定关卡、必要时进下一关。
 *
 * ⇒ **零红线改动**：`render.ts` / `core/**` 一个字不动，它们只是被**调用**。
 * 代价（如实登记）：`render.ts` 里那些"可点/可拖"的判断是按 `getLegalActions` 算的，
 * 教学**没法阻止玩家去拖一张不该拖的牌** —— 只能在 `cb` 里**拒收**并提示。
 * 所以本关的"只放行"是**事后退回 + 提示**，不是"按钮变灰"。
 *
 * ## 教练浮层
 *
 * 照 `settingsOverlayElement` / `onboarding` 那一套：**`document.body` 级浮层** + 新类名
 * （`.tutorial-*`，落在 `src/ui/styles-local.css`），不进 `#app`、不碰 `styles.css`。
 * T0 的四个热点也是浮层上的元素：它们**盖在真棋盘对应的区域上**（浮层自己算位置），
 * 点了算"看过这个区域"——这样 T0 不用让玩家去点引擎里的东西（T0 本来也没有引擎动作）。
 */
import { createLocalDriver, type MatchDriver } from '../app/match-driver';
import type { LocalStore } from '../app/local-store';
import type { GameState, Line, PlayerId } from '../core/models/types';
import { findCard } from '../core/effects/context';
import { getLineValue } from '../core/state/create';
import { renderApp, resetUiState, setDraftSelfSeat, type UiCallbacks } from './render';
import { TUT_LEVELS, levelAt, levelById, levelIndex, TUT_SPOTS, type TutLevel } from '../tutorial/levels';
import { buildLevelState } from '../tutorial/setup';
import { isLevelComplete, offTrackKeyFor, observedOps, revealSeen, snapshot, type TutSnap } from '../tutorial/judge';
import { advance, readProgress, restart } from '../tutorial/progress';
import type { TutChoiceSeen, TutLevelId, TutOp, TutSpot, TutUiSeen } from '../tutorial/types';
import { TUT_UI_NONE, triggersSeen } from '../tutorial/types';
import { onLangChange, t } from '../i18n';

/** 退出教程（回首页）；由宿主注入 —— 屏自己不认识首页 */
export interface TutorialNav {
  /** 点「退出教程」 */
  exit(): void;
  /** 进度写盘的结果（写失败时屏上如实提示；由宿主按 `applyWriteResult` 同一套口径转文案） */
  saveProgress(progress: { readonly done: readonly TutLevelId[]; readonly current: TutLevelId }): void;
}

/** 屏的返回值：卸载（撤监听 + 摘浮层 + 清 render.ts 的模块态） */
export interface TutorialHandle {
  close(): void;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** T0 热点在浮层上的位置（百分比；`left/top` 是左上角，`w/h` 是宽高） */
const SPOT_BOX: Readonly<Record<TutSpot, { left: string; top: string; w: string; h: string }>> = {
  link: { left: '38%', top: '26%', w: '24%', h: '40%' },
  protocol: { left: '38%', top: '16%', w: '24%', h: '9%' },
  threshold: { left: '63%', top: '26%', w: '12%', h: '12%' },
  control: { left: '63%', top: '40%', w: '12%', h: '12%' },
};

/**
 * 挂载教学屏。
 *
 * @param root 主容器（`#app`；棋盘画在这里）
 * @param store 本机设置（进度读写走它 —— 屏自己只经 `src/tutorial/progress.ts` 那一条口）
 * @param nav 宿主接缝（退出 / 进度落盘）
 */
export function mountTutorial(root: HTMLElement, store: LocalStore, nav: TutorialNav): TutorialHandle {
  /** 本次进入从哪一关开始（进度里那一关；「从头开始」会就地改它并重开本屏） */
  let levelId: TutLevelId = readProgress(store).current;
  /** 当前这局的引擎状态 */
  let state: GameState = buildLevelState(levelId);
  /** 上一份快照（T3 的动作差分用；每关开局与每次动作后更新） */
  let snap: TutSnap = snapshot(state);
  /** T3 到目前为止观测到的动作签名 */
  let opsSeen: TutOp[] = [];
  /** T0 点过的热点 */
  const spotsDone = new Set<TutSpot>();
  /**
   * ★ 2026-10-02（用户追加两课）：**屏上观察到的**事实（详情放大视图那一路）。
   *
   * T1（卡牌详情）与 T6（反面牌可视规则）教的是**界面行为**：引擎状态一模一样，
   * 所以判据只能看"玩家打开了什么"。观察点是 `render.ts` 造的真元素：
   *  - `.zoom-overlay` 出现一次 = 打开过一次详情；
   *  - 里面有 `.zoom-peek-btn` = 这张反面牌**能看**（`render.ts:418` 的 peek 实参为真）；
   *  - 里面没有那个按钮、且大图是卡背（`Cardback`）= 这张反面牌**不能看**。
   */
  let uiSeen: TutUiSeen = TUT_UI_NONE;

  /** 观察到一次"详情被打开"（由下面的 MutationObserver 调用） */
  function noteZoomOpened(): void {
    const btn = document.querySelector('.zoom-peek-btn');
    const img = document.querySelector('.zoom-img');
    const src = img ? String((img as HTMLImageElement).src) : '';
    const hasPeek = btn !== null;
    const showsBack = src.includes('Cardback');
    uiSeen = {
      ...uiSeen,
      detailsOpened: uiSeen.detailsOpened + 1,
      // 有「查看正面」按钮 ⇒ 这张反面牌能看（正面卡本来就没有这个按钮，所以不置）
      peekAvailable: uiSeen.peekAvailable || hasPeek,
      // 没有按钮**且**大图是卡背 ⇒ 这一次就是"不能看的反面牌"那个对照
      peekBlocked: uiSeen.peekBlocked || (!hasPeek && showsBack),
    };
    // 打开详情不算引擎动作，所以这里也要判一次（否则 T1/T6 永远不会过关）
    judgeAndAdvance();
  }

  /**
   * ★ 2026-10-02（P6 任务 A.1）：把当前挂着的 `select` 请求的**候选集合**记一笔。
   *
   * T7（默认目标规则）教的不是"状态变成了什么"，而是"引擎把哪些牌列成了候选"
   * —— 默认档只列双方场上未被覆盖的顶卡（`listCandidates`，`context.ts:64`），
   * 文本明写「被覆盖的牌」时才走 `covered: true` 那一支（`:86`）。
   * 候选集合只存在于 `PendingEffect.prompt` 上（`ChoiceRequest.candidates`），
   * 所以屏在每次动作之后扫一遍挂起的效果，把 `sourceDefId + 候选 uid` 记下来。
   *
   * ⚠️ 去重按"效果源 + 候选集合"两样一起比：同一次选择被扫到两次不会记两条，
   * 而同一个效果源在不同局面下弹出**不同**的候选集合时会各记一条（那正是要分辨的）。
   */
  function recordChoices(): void {
    const seen: TutChoiceSeen[] = [...(uiSeen.choices ?? [])];
    for (const pe of state.pendingEffects) {
      const prompt = pe.prompt;
      if (prompt === null || prompt.kind !== 'select') continue;
      const uids = prompt.candidates.map((c) => c.uid);
      const dup = seen.some((c) => c.source === pe.sourceDefId && c.uids.join(',') === uids.join(','));
      if (!dup) seen.push({ source: pe.sourceDefId, uids });
    }
    uiSeen = { ...uiSeen, choices: seen };
  }

  /**
   * ★ 2026-10-02（P6 任务 A.1）：玩家点了**不在候选里、被压暗**的那张牌。
   *
   * 红线上那一层（`render.ts:5415-5417`）给非候选卡加 `.choice-dim` 且**不绑任何点击**
   * —— 点下去什么都不会发生，所以"试着点被盖住的牌"这一下只有教学屏自己盯得住。
   * 捕获阶段挂在 `document` 上（棋盘在 `#app` 里，不在本屏的浮层里），
   * 命中就记一笔并把提示区换成那句解释。**不改红线**：只是读了一个既有类名。
   */
  function onDocClickCapture(ev: Event): void {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.card.choice-dim') === null) return;
    if (uiSeen.blockedPickTried === true) return;
    uiSeen = { ...uiSeen, blockedPickTried: true };
    renderPanel();
  }
  document.addEventListener('click', onDocClickCapture, true);

  /**
   * 盯着 `document.body` 的新增子节点：`.zoom-overlay` 一出现就记一笔。
   *
   * ⚠️ 用 MutationObserver 而不是给卡牌绑 dblclick：放大查看有**多条入口**
   * （场上卡 `render.ts:417`、手牌 `:1979`、对手手牌 `:1990`、协议卡 `:202`、弃牌堆 `:5820`…），
   * 只盯结果（遮罩出现了）才不会漏。这也是本仓处理 body 级浮层的既有做法。
   */
  const zoomWatcher = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of Array.from(rec.addedNodes)) {
        if (node instanceof HTMLElement && node.classList.contains('zoom-overlay')) { noteZoomOpened(); return; }
      }
    }
  });
  zoomWatcher.observe(document.body, { childList: true });
  /** 讲解逐句进度（数字 = 已看过几句；到 `teachKeys.length` 就不再显示讲解块） */
  let teachAt = 0;
  /** 本关是否已判定通过（通过之后不再重复提示） */
  let cleared = false;

  /* ───────────────────────── 教练浮层 ───────────────────────── */

  const overlay = el('div', 'tutorial-overlay');
  const panel = el('div', 'tutorial-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');

  const head = el('div', 'tutorial-head');
  const title = el('div', 'tutorial-title');
  const step = el('div', 'tutorial-step');
  head.appendChild(title);
  head.appendChild(step);
  const exitBtn = button('btn tutorial-exit', t('tutorial.exit'), () => { nav.exit(); });
  head.appendChild(exitBtn);
  panel.appendChild(head);

  const goalRow = el('div', 'tutorial-goal');
  const goalLabel = el('span', 'tutorial-goal-label');
  const goalText = el('span', 'tutorial-goal-text');
  goalRow.appendChild(goalLabel);
  goalRow.appendChild(goalText);
  panel.appendChild(goalRow);

  const teachBox = el('div', 'tutorial-teach');
  const teachLine = el('p', 'tutorial-teach-line');
  const teachNext = button('btn tutorial-next', t('tutorial.next'), () => {
    teachAt += 1;
    renderPanel();
  });
  teachBox.appendChild(teachLine);
  teachBox.appendChild(teachNext);
  panel.appendChild(teachBox);

  /**
   * ★ 2026-10-02（P6，用户 2026-10-01 追加的硬要求）：**四件套的三段**。
   *
   * 用户原话：「我希望**所有的教程中都要有我举的这种以实战场举例子并引导玩家的教学方式**」
   * ⇒ 每一关都要有 **实战例子 → 引导步骤 → 观察点**，且判据依赖玩家真的动手做过一次。
   * 三段的数据住在 `TutLevel`（`scenario` / `guidedSteps` / `observe`），这里只负责显示；
   * 缺一段的关卡由 `tests/tutorial/levels.test.ts` 的生成式腿当场判红（不是靠自觉）。
   *
   * 为什么放在讲解块**之后**、提示块**之前**：讲解是"为什么"，这三段是"现在做什么"，
   * 玩家的视线从上往下走正好落到第三段末尾的那句提示上。
   */
  const scenarioBox = el('div', 'tutorial-scenario');
  const scenarioLabel = el('div', 'tutorial-section-label');
  const scenarioText = el('p', 'tutorial-scenario-text');
  scenarioBox.appendChild(scenarioLabel);
  scenarioBox.appendChild(scenarioText);
  panel.appendChild(scenarioBox);

  const stepsBox = el('div', 'tutorial-steps');
  const stepsLabel = el('div', 'tutorial-section-label');
  const stepsList = el('ol', 'tutorial-steps-list');
  stepsBox.appendChild(stepsLabel);
  stepsBox.appendChild(stepsList);
  panel.appendChild(stepsBox);

  const observeBox = el('div', 'tutorial-observe');
  const observeLabel = el('div', 'tutorial-section-label');
  const observeText = el('p', 'tutorial-observe-text');
  observeBox.appendChild(observeLabel);
  observeBox.appendChild(observeText);
  panel.appendChild(observeBox);

  const hintBox = el('p', 'tutorial-hint');
  panel.appendChild(hintBox);

  /**
   * 「重开这一关」（★ 2026-10-02，T3 实测发现的必要性）。
   *
   * 为什么必须有它：T3 的**弃牌**那一步候选是**手牌**（引擎给的），玩家完全可能把后面
   * 还要用的教学卡弃掉 ⇒ 这一关就**做不完了**。教学屏不能改引擎（红线）⇒ 不能过滤候选，
   * 所以给一个"重开本关"的出口：点一下就把这一关的局面重建（进度不动）。
   * 同一枚按钮也兜住"走偏到死胡同"的一切形态（例如把唯一的目标牌打没了）。
   */
  const restartLevelBtn = button('btn tutorial-restart-level', t('tutorial.restart-level'), () => {
    openLevel();
  });
  panel.appendChild(restartLevelBtn);

  /**
   * 「从第一关重来」（方案 §5.2："从首页再进教学时从上次那一关继续，并给一个『从头开始』按钮"）。
   *
   * 与上面那枚的区别：这枚**清进度**（`restart(store)`：`done` 清空、当前关回 T0），
   * 上面那枚只重开**当前关**的局面（进度不动）。两枚都需要：前者是"我想重学一遍"，
   * 后者是"这一关我做进死胡同了"。
   */
  const restartAllBtn = button('btn tutorial-restart', t('tutorial.restart'), () => {
    restart(store);
    levelId = 'T0';
    openLevel();
  });
  panel.appendChild(restartAllBtn);

  const progressRow = el('div', 'tutorial-progress');
  panel.appendChild(progressRow);

  /** T0 的四个热点（挂在一个铺满棋盘的层上；只有 T0 显示） */
  const spotLayer = el('div', 'tutorial-spots');
  const spotEls = new Map<TutSpot, HTMLElement>();
  for (const spot of TUT_SPOTS) {
    const box = SPOT_BOX[spot];
    const b = document.createElement('button');
    b.className = 'tutorial-spot';
    b.type = 'button';
    b.dataset.spot = spot;
    b.style.left = box.left;
    b.style.top = box.top;
    b.style.width = box.w;
    b.style.height = box.h;
    b.addEventListener('click', () => {
      spotsDone.add(spot);
      // 点过之后提示区显示**这个区域是什么**（四个区域各一句）
      hintBox.textContent = spotText(spot);
      renderPanel();
      judgeAndAdvance();
    });
    spotEls.set(spot, b);
    spotLayer.appendChild(b);
  }
  overlay.appendChild(spotLayer);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  /** 热点被点之后显示哪一句（四个区域各一句） */
  function spotText(spot: TutSpot): string {
    switch (spot) {
      case 'link': return t('tutorial.spot.link');
      case 'protocol': return t('tutorial.spot.protocol');
      case 'threshold': return t('tutorial.spot.threshold');
      default: return t('tutorial.spot.control');
    }
  }

  /* ───────────────────────── 面板重画 ───────────────────────── */

  /**
   * 按当前关卡 / 语言 / 讲解进度把浮层上的每一条文案写一遍。
   *
   * ⚠️ "新增一条文案就补一行"的地方（与 `settingsOverlayElement` 的 `applyLang` 同款）：
   * 漏了哪一条，切语言之后它就停在旧语言上。
   */
  function renderPanel(): void {
    const level = currentLevel();
    title.textContent = level.title();
    step.textContent = t('tutorial.step', {
      n: String(levelIndex(level.id) + 1),
      total: String(TUT_LEVELS.length),
    });
    exitBtn.textContent = t('tutorial.exit');
    restartLevelBtn.textContent = t('tutorial.restart-level');
    restartAllBtn.textContent = t('tutorial.restart');
    goalLabel.textContent = t('tutorial.goal.label');
    goalText.textContent = level.goal();

    if (teachAt < level.teach.length) {
      teachBox.hidden = false;
      teachLine.textContent = level.teach[teachAt]();
      teachNext.textContent = teachAt === level.teach.length - 1
        ? t('tutorial.skip-teach')
        : t('tutorial.next');
    } else {
      teachBox.hidden = true;
    }

    // ★ P6 四件套的三段：例子 → 步骤 → 观察点（数据全部来自 TutLevel，这里只填字）
    scenarioLabel.textContent = t('tutorial.scenario.label');
    scenarioText.textContent = level.scenario();
    stepsLabel.textContent = t('tutorial.steps.label');
    stepsList.textContent = '';
    for (const stepText of level.guidedSteps) {
      stepsList.appendChild(el('li', 'tutorial-step-item', stepText()));
    }
    observeLabel.textContent = t('tutorial.observe.label');
    observeText.textContent = level.observe();

    // 提示区：按关卡给"下一步做什么"（T0 的四个热点 / T1 双击看卡 / T6 两个对照 / T7 两档候选 /
    // T9 两条露出途径）
    if (level.id === 'T0' && spotsDone.size === 0) {
      hintBox.textContent = t('tutorial.spot.hint');
    }
    if (level.id === 'T1') {
      hintBox.textContent = uiSeen.detailsOpened === 0 ? t('tutorial.zoom.hint') : t('tutorial.zoom.opened');
    }
    if (level.id === 'T6') {
      const lines: string[] = [];
      if (!uiSeen.peekAvailable) lines.push(t('tutorial.peek.yes'));
      if (!uiSeen.peekBlocked) lines.push(t('tutorial.peek.no'));
      hintBox.textContent = lines.length > 0 ? lines.join(' ') : t('tutorial.peek.done');
    }
    if (level.id === 'T7') {
      /**
       * 三档提示，按"玩家已经做到哪一步"给（三档文案各不相同）：
       *  1. 还没试过点那张被压住的 ⇒ 先按引导步骤去点（`tutorial.T7.hint.try`）；
       *  2. 点过了、而这次选择**还没结束** ⇒ 给出那句**走偏解释**（`tutorial.choice.blocked`：
       *     为什么它不在候选里）。这一档正是任务书要的"尝试选被盖住的牌 ⇒ 不在候选里 ⇒ 走偏提示"；
       *  3. 这次选择结束了 ⇒ 换成"现在用明写「被覆盖」的那张"（`tutorial.T7.hint.pick`）。
       */
      const choosing = state.pendingEffects.some((pe) => pe.sourceDefId === 'spirit-2' && pe.prompt !== null);
      hintBox.textContent = uiSeen.blockedPickTried !== true
        ? t('tutorial.T7.hint.try')
        : choosing ? t('tutorial.choice.blocked') : t('tutorial.T7.hint.pick');
    }
    if (level.id === 'T9') {
      // 两条露出途径各有一条读数（`revealSeen()` 读的是日志差分，与判据同一个来源）
      const seen = revealSeen(state);
      hintBox.textContent = seen.flipped && seen.revealed
        ? t('tutorial.T9.hint.both')
        : seen.flipped ? t('tutorial.T9.hint.reveal') : t('tutorial.T9.hint.flip');
    }
    /**
     * ★ 2026-10-02（P7）后四关的提示：按"这一关观测量到了没有"给一句"下一步干什么"。
     *
     * 每一档都读**判据用的同一份读数**（`triggersSeen` / `getLineValue` / 纯状态），
     * 不另算一遍 —— 「提示说做到了、判据不给过」那种漂移就是第二份真相当场的样子。
     */
    if (level.id === 'T10') {
      hintBox.textContent = state.control === 0 ? t('tutorial.T10.hint.got') : t('tutorial.T10.hint.go');
    }
    if (level.id === 'T11') {
      // 三档读数与判据**同一份来源**：被盖前 / 结束 读日志（`triggersSeen`），
      // "打出后"读状态（对手那张 `t11o2` 进了对手弃牌堆 —— 为什么它不能读日志见 judge.ts）
      const seen = triggersSeen(state.log);
      const lines: string[] = [];
      if (!state.players[1].trash.some((c) => c.uid === 't11o2')) lines.push(t('tutorial.T11.hint.after-play'));
      if (seen['before-covered'] < 1) lines.push(t('tutorial.T11.hint.before-covered'));
      if (seen.end < 1) lines.push(t('tutorial.T11.hint.end'));
      hintBox.textContent = lines.length > 0 ? lines.join(' ') : t('tutorial.T11.hint.done');
    }
    if (level.id === 'T12') {
      const lines: string[] = [];
      if (!state.players[1].trash.some((c) => c.uid === 't12o1')) lines.push(t('tutorial.T12.hint.delete'));
      if (getLineValue(state, 0, 1) === 0) lines.push(t('tutorial.T12.hint.buff'));
      const imm = findCard(state, 't12f-rigid');
      if (imm === undefined || imm.faceUp !== true) lines.push(t('tutorial.T12.hint.immune'));
      hintBox.textContent = lines.length > 0 ? lines.join(' ') : t('tutorial.T12.hint.done');
    }
    if (level.id === 'T13') {
      hintBox.textContent = state.winner !== null ? t('tutorial.T13.hint.done') : t('tutorial.T13.hint.compile');
    }
    if (cleared) hintBox.textContent = t('tutorial.cleared');

    // 进度：每一关各一枚 chip，已完成的加 `.on`（关卡数由 TUT_LEVELS 决定，屏上不写死）
    progressRow.textContent = '';
    const progress = readProgress(store);
    for (const l of TUT_LEVELS) {
      const chip = el('span', 'tutorial-chip', l.id);
      chip.dataset.level = l.id;
      if (progress.done.includes(l.id)) chip.classList.add('on');
      if (l.id === level.id) chip.classList.add('now');
      progressRow.appendChild(chip);
    }

    // T0 热点：点过的标成已看
    spotLayer.hidden = level.id !== 'T0';
    for (const [spot, node] of spotEls) {
      node.classList.toggle('on', spotsDone.has(spot));
      // 无障碍名字 = 那个区域的说明（四个区域各一句，不给空标签）
      node.setAttribute('aria-label', spotText(spot));
    }
    panel.setAttribute('aria-label', t('tutorial.aria'));
  }

  function currentLevel(): TutLevel {
    return levelById(levelId);
  }

  /* ───────────────────────── 引擎接线 ───────────────────────── */

  /** 本屏的动作驱动（与热座同一个 `LocalDriver`：`submit` 是全仓唯一的"操作 → 引擎"入口） */
  const driver: MatchDriver = createLocalDriver();

  /**
   * 走偏提示的**取文案口**（键 → 句子）。
   *
   * ⚠️ 写成 switch（每个 t() 的实参都是**字面量**）而不是 t(key)：
   * t() 的实参一旦是变量就是**动态键** —— 缺键扫描器看不见它（等于漏翻的温床），
   * 而 tests/i18n/tables.test.ts 与 tests/tutorial/screen.test.ts 都有腿当场判红。
   * 本仓既有同款写法：home.ts 的 setLabel / coinFaceName / ruleTitleText。
   */
  function offTrackText(key: string): string {
    switch (key) {
      case 'tutorial.off.wrong-kind': return t('tutorial.off.wrong-kind');
      case 'tutorial.off.face-down': return t('tutorial.off.face-down');
      default: return t('tutorial.off.rejected');
    }
  }

  /**
   * 教学自己的 `UiCallbacks`。
   *
   * ⚠️ 这里**只实现**教学用得上的那几个；其余回调留空 —— 它们对应的是草稿/结算/重放那些
   * 教学不走的路径（教学跳过草稿，见 `setup.ts`）。
   */
  function tutorialCallbacks(): UiCallbacks {
    return {
      onRendered() { /* 每帧之后什么都不用做（本屏没有动画驱动） */ },
      onWinReset() { /* 教学里不会出现"胜利重置"那条路 */ },
      rerender() { paint(); },
      onDraftPick() { /* 教学跳过草稿：这条不该被调到（调到了也不动，免得改坏局面） */ },
      onDraftUnpick() { /* 同上 */ },
      onDraftBan() { /* 同上 */ },
      onAction(a) {
        const level = currentLevel();
        const key = allowedBy(level, a);
        if (key !== null) {
          // ★ 走偏：**不提交**（引擎里什么都没发生），只给一句提示
          hintBox.textContent = offTrackText(key);
          return;
        }
        if (state.phase === 'gameover') return;
        const player = state.turnPlayer;
        // ⚠️ 走 `driver.submit`（**不是**直接 `applyRecordedAction`）：它是收口后唯一能触发
        //    状态迁移的入口，`seq` 之类的记账由它自己管（手搓 ActionRecord 会漏字段）。
        let ok = false;
        try {
          if (a.kind === 'play') {
            ok = driver.submit(state, {
              player, kind: 'play',
              args: { cardUid: a.cardUid ?? '', faceUp: a.faceUp ?? true, line: (a.line ?? 0) as Line, target: a.target as PlayerId | undefined },
            }).ok;
          } else if (a.kind === 'effect-choice') {
            const top = state.pendingEffects[state.pendingEffects.length - 1];
            const chooser = top?.prompt?.chooser ?? top?.player ?? player;
            ok = driver.submit(state, {
              player: chooser, kind: 'effect-choice',
              args: { promptId: a.promptId ?? '', choice: a.choice ?? [] },
            }).ok;
          } else if (a.kind === 'compile') {
            ok = driver.submit(state, {
              player, kind: 'compile', args: { line: (a.line ?? 0) as Line },
            }).ok;
          } else if (a.kind === 'resolve-trigger') {
            /**
             * ★ 2026-10-02（P7）T11 的第三种触发（「结束」）走这里：结束阶段棋盘上会给出
             * 「结算触发」按钮（`render.ts` 按 `getLegalActions` 的 `resolve-trigger` 画），
             * 玩家点它就是`resolve-trigger` 这个 kind。
             * `cardUid` 就是那张待结算的卡（红线那边传上来的），原样转给引擎。
             */
            ok = driver.submit(state, {
              player, kind: 'resolve-trigger', args: { cardUid: a.cardUid ?? '' },
            }).ok;
          } else if (a.kind === 'advance') {
            /**
             * ★ 2026-10-02（P7）T10 的"亲自动手"就是这一步：`getLegalActions` 在
             * `check-control` 这一步只出 `advance` ⇒ 玩家点「推进」，引擎在
             * `performAdvance` 里调 `checkControl()`（`src/core/game.ts:293`）—— 与真对局同一条路。
             */
            ok = driver.submit(state, { player, kind: 'advance', args: {} }).ok;
          } else {
            // 别的动作种类（本轮的关卡不会走到）：如实拒绝，不给"看起来发生了"的假象
            hintBox.textContent = t('tutorial.off.wrong-kind');
            return;
          }
        } catch {
          // 引擎抛了（例如效果守卫不满足）：状态可能已半改，给一句如实的提示并重画回真状态
          hintBox.textContent = t('tutorial.off.rejected');
          paint();
          return;
        }
        // 引擎拒了（例如正面牌打到不匹配的线）：状态没变 ⇒ 一句如实的提示，不推进判定
        if (!ok) {
          hintBox.textContent = t('tutorial.off.rejected');
          paint();
          return;
        }
        judgeAndAdvance();
      },
    };
  }

  /**
   * 这个动作**该不该放行**。
   *
   * 返回 `null` = 放行；返回一个 i18n 键 = 拒收并显示那句话。
   * 规则本身在 `src/tutorial/judge.ts`（纯函数，能在 node 下真跑）。
   */
  function allowedBy(level: TutLevel, a: { kind: string; faceUp?: boolean }): string | null {
    if (!level.allowKinds.includes(a.kind)) return offTrackKeyFor(level, a);
    if (level.id === 'T1' && a.kind === 'play' && a.faceUp === false) return offTrackKeyFor(level, a);
    return null;
  }

  /* ───────────────────────── 判定与推进 ───────────────────────── */

  /** 画棋盘（唯一出口：`renderApp` + 本屏的 `cb`） */
  function paint(): void {
    renderApp(root, state, tutorialCallbacks());
  }

  /**
   * 每次动作/点击之后：算一次"过了没有"，过了就记进度并进下一关。
   *
   * ⚠️ 顺序是刻意的：**先判、再落进度、最后才进下一关** —— 落进度失败（写盘被拒）
   * 也要让玩家看得见"这一关过了"，只是下次进来可能还在这一关（如实的降级）。
   *
   * ★ **2026-10-02（P2 实测发现）：引擎会在一次动作之后把回合交给对手**，
   * 而 T3 要玩家**连着做五个动作**。所以在判定之前先"把回合交还玩家"：
   * `turnPlayer = 0` + `step = 'action'` + 清 `compiledThisTurn`。
   * 这是**教学自己的沙盒规则**（不是改引擎：改的是本屏自己那份受控 `state`，
   * 它从头到尾都不属于任何真对局）。代价如实登记在方案 §7.8：
   * 教学里**没有回合交替**，所以 T3 不教"回合是什么"（那是 T9 迷你对局的事）。
   */
  function handBackTurn(): void {
    if (state.phase !== 'turn') return;
    /**
     * ★ 2026-10-02（P7）：**T10 例外**（`level.keepStep`）。
     *
     * 控制权只在 `check-control` 这一步判定（`src/core/game.ts:293` 的 `performAdvance`），
     * 而 T10 的开局就摆在那一步 ⇒ 若还是按下面那条沙盒规则"强制回到 action"，
     * 那一次 `advance` 会被就地抹掉、`checkControl()` 永远跑不到 —— 这一关就死在这一步上了。
     * 所以 T10 声明 `keepStep: true`：**让引擎自己的步真的走一格**（与真对局同一条路）。
     */
    if (currentLevel().keepStep === true) return;
    if (state.turnPlayer !== 0) {
      state.turnPlayer = 0;
      state.step = 'action';
      state.compiledThisTurn = false;
    }
  }

  function judgeAndAdvance(): void {
    handBackTurn();
    const level = currentLevel();
    // T3：把这次动作引起的状态变化折进 `opsSeen`（差分只看"真的变了什么"）
    const next = snapshot(state);
    if (level.ops !== undefined) {
      for (const op of observedOps(snap, next)) if (!opsSeen.includes(op)) opsSeen.push(op);
    }
    snap = next;
    // ★ P6：把当前挂着的选择请求的候选集合记一笔（T7 的判据要它）
    recordChoices();

    const done = isLevelComplete(level, state, { spotsDone: [...spotsDone], opsSeen, ui: uiSeen });
    if (!done) { renderPanel(); paint(); return; }

    cleared = true;
    // T0 用自己那句（四个区域都看过了），其余关卡用通用那句
    hintBox.textContent = level.id === 'T0' ? t('tutorial.spot.done') : t('tutorial.cleared');
    const after = advance(store, level.id);
    nav.saveProgress(after);
    renderPanel();
    paint();
    // 最后一关：停在原地（提示"所有关卡都过了"），不自动跳走
    if (levelIndex(level.id) >= TUT_LEVELS.length - 1) {
      hintBox.textContent = t('tutorial.cleared-all');
      return;
    }
    // 下一关：换局面、重置本关的判定状态
    levelId = levelAt(levelIndex(level.id) + 1);
    openLevel();
  }

  /** 开（或重开）当前 `levelId` 那一关：新局面 + 清判定状态 + 重画 */
  function openLevel(): void {
    state = buildLevelState(levelId);
    snap = snapshot(state);
    opsSeen = [];
    spotsDone.clear();
    uiSeen = TUT_UI_NONE;
    teachAt = 0;
    cleared = false;
    hintBox.textContent = currentLevel().id === 'T0' ? t('tutorial.spot.hint') : '';
    renderPanel();
    paint();
  }

  /** 切语言：**就地**重画浮层（棋盘不动 —— 它上面没有文案，卡面是图片） */
  const offLang = onLangChange(() => { renderPanel(); });

  /* ───────────────────────── 收尾 ───────────────────────── */

  openLevel();

  return {
    close() {
      zoomWatcher.disconnect();
      document.removeEventListener('click', onDocClickCapture, true);
      offLang();
      overlay.remove();
      // render.ts 的模块态与 body 级常驻层由它自己的复位口清（本屏不改 render.ts）
      resetUiState();
      setDraftSelfSeat(null);
    },
  };
}
