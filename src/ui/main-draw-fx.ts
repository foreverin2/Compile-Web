/**
 * 抽牌飞入特效的**唯一出处** —— `card:drawn` 的累加器 + 幽灵卡动画本体。
 *
 * ## 为什么有这个模块（2026-10-06，用户报的缺陷）
 *
 * 用户报：「第六关（= T4）里打出『精神1』的抽牌特效没有了」。诊断（`.superpowers/2026-10-06-spirit1-draw/`）
 * 查明**不是引擎没发事件**：`spirit1Middle` 真的 `draw count:2`，`resolve.ts` 真的 `gameBus.emit({type:'card:drawn'})`。
 * 问题是"消费累加器并播动画"的那段收尾代码**原先整段关在 `src/main.ts` 的 `cb.onAction` 函数体内部**
 * （没有导出、`src/ui` 也没有反向 import `main.ts` 的出口）。教学屏用的是**自己**的一份 `UiCallbacks`
 * （`tutorial-screen.ts` 的 `tutorialCallbacks()`），它的 `onAction` 只做 `driver.submit` + `judgeAndAdvance`
 * ⇒ 累加器里躺着一条、**没人读**，牌是抽到了、飞入动画一次都不播。
 *
 * ⇒ 把这段搬到这里，`main.ts`（热座 / 远程页共用同一个 `cb`）与教学屏两处都调同一份实现。
 * **不许在这里再复制第二份**：幽灵盒尺寸 / 扇形步距（R15-A 那一族）只允许有这一个出处，两份必然漂移。
 *
 * ## 对外接口与调用时机（谁在什么时机调）
 *
 *  - `subscribeDraws()`：**模块加载时**由 `main.ts` 调一次（全局只调一次）；教学屏 `mountTutorial`
 *    进屏时调一次，`close()` 里调它返回的退订函数。多次订阅**不会**重复入队（见函数头注）。
 *  - `drainDraws()`：**一次行动结算完成之后、重渲染之前**调。搬走并清空累加器，返回本次攒下的抽牌请求。
 *    `main.ts` 的 `cb.onAction` 收尾、教学屏 `onAction` 里 `judgeAndAdvance()` 之前，各调一次。
 *  - `resetDraws()`：整局复位（返回主界面 / 进重放页）时清空 —— 与"清 pending 累加器"原语义逐字相同。
 *  - `playDrawSequence(draws, done)`：有抽牌时调，全部幽灵落地后 `done()`。
 *    **`draws` 为空时同步 `done()`**（调用方据此不必自己再判一次空）。
 *  - `playDrawAnimation(player, count, love, fromOpp, done)`：刷新手牌那一条（非效果触发）单独调它。
 *
 * ⚠️ **谁管"动画进行中"这个闩**：`drawAnimBusy` **留在 `main.ts`**（它还同时挡重放的自动推进与
 *  `refresh` 重入，是三个子系统共用的闩，搬走反而更乱）。因此**本模块自己不防并发** ——
 *  调用方要么先看 `drawAnimBusy`（`main.ts`），要么自己保证不会重入（教学屏是同步的单线程动作结算）。
 *
 * ⚠️ 红线：本文件在 `src/ui/` 下，`src/app/**` 那条"纯层不许碰浏览器 API"的守卫
 *（`tests/app-purity.test.ts`）扫的是 `src/app/`，不覆盖这里。本模块按设计就是 DOM 层。
 */
import type { PlayerId } from '../core/models/types';
import { gameBus, type GameEvent } from '../core/events/bus';
import { handCardBox, handFanLead, handFanStep } from './fx-card-size';
import { handOuterFor } from './fx-seat';
import { buildLoveHeart, playSpeedDrawExtra, SPEED_TOTAL_MS } from './effects';

/** 一次效果触发的抽牌请求（`card:drawn` 事件的累加形态）。
 *
 *  - `love`：该次抽牌是否由 love 协议触发（love-1/2/6 及 love 刷新——含对手抽），
 *    播放抽牌飞入动画时给 draw-ghost 卡背挂粉红爱心 + 边框粉红光（FX-4）。
 *  - `speed`：该次抽牌是否由 speed 协议触发（speed-1 顶「清理缓存后抽1张」）——
 *    播放抽牌动画时【先播 speed 专属飓风】（牌库区 → 手牌末尾），基础 draw-ghost 飞入
 *    顺延到专属完成后（FX-R1 时序修复：不再基础先播、专属后播）。
 *  - `fromOpp`：从【对手】牌库抽（同化1/爱1 效果 fromOpponentDeck）——起点 = 对手牌库侧
 *    （修改提示词 31：该抽牌要有基础动画，来源视觉上是对手牌库而非自己牌库）。
 */
export interface DrawReq {
  player: PlayerId;
  count: number;
  love: boolean;
  speed: boolean;
  fromOpp: boolean;
}

/**
 * 效果触发的抽牌累计（`card:drawn` 事件 → 本次行动结算完成后统一播抽牌特效）。
 *
 * ⚠️ **模块级就是"这一局的状态"**：`resetDraws()` 必须与"整局复位"同时被调，
 * 否则上一局攒下的请求会飞进下一局（`main.ts:resetToMainInterface` / `startReplayFile` 两处）。
 */
let pendingDraws: DrawReq[] = [];

/** 抽牌幽灵卡尺寸与扇形步进。**G2 修正 R15-A：改成"按页取值"的函数出口** ——
 *  远程页手牌卡是 100.572 × 137.601（由 `.net-board` 的 `--card-h: 140` 派生，
 *  `styles-net.css:91-97`），比热座小 29%；抽牌幽灵与扇形步进必须跟着它，
 *  否则幽灵比真卡大一圈、抽 2 张以上每张多偏 23.09px（102 vs 78.909）。
 *  ⚠️ 值本身仍是热座的 130 / 178.8 / 102（`fx-card-size.ts` 的出口在热座页**构造性**
 *  返回这三个数：探针选择器都带 `.net-board` 前缀，热座页没有该类 ⇒ 永不命中）。 */
const ghostCardBox = (): { w: number; h: number } => handCardBox();
const handFanSpacing = (): number => handFanStep();

/** 已订阅过的**退订函数**（非 null = 本模块已经订阅着总线）。
 *
 *  ⚠️ **为什么要有它**：`main.ts`（进程级一次）与教学屏（每进一次教程一次）都调 `subscribeDraws()`
 *  —— 而 `gameBus` 是**全仓单例**（`core/events/bus.ts`）。不去重的话，第二次订阅会让同一次抽牌
 *  入队两条（幽灵卡double）。这与 main.ts 原先"订阅只写一次"的**可观测行为逐字相同**。
 *
 *  ⚠️ 教学屏用 `close()` 里的退订函数退订；退订**不清空** `pendingDraws`（那是 `resetDraws()` 的事，
 *  两件事分开：退订 = 这一屏不再听事件，清空 = 这一局攒的都作废）。
 *
 *  ⚠️ **2026-10-06 实测的坑（别再犯）**：`tutorialCallbacks` 的 `driver` 依赖缝里塞过 `{} as never`，
 *  于是 `submit` 不是函数、当场抛错被 `catch` 吞成"动作被拒" ⇒ 两条腿在**空集**上假绿
 *  （`judgeAndAdvance` 0 次、`playDrawSequence` 0 次）。依赖必须喂真出口返回的东西
 *  （`createLocalDriver()`，测试里由 `vi.mock` 换掉）。 */
let unsub: (() => void) | null = null;

/**
 * 订阅 `card:drawn`，把事件累加进本模块的队列。返回退订函数（**重复调用是安全的**：
 * 同一个进程里第二次调用只会把上一次的订阅顶掉，不会叠加）。
 *
 * 调用时机：`main.ts` 模块加载时一次；`tutorial-screen.ts` 的 `mountTutorial` 进屏时一次。
 */
export function subscribeDraws(): () => void {
  if (unsub !== null) unsub();
  unsub = gameBus.subscribe((e: GameEvent) => {
    if (e.type !== 'card:drawn') return;
    const p = e.payload as { player: PlayerId; count: number; triggerProtocol?: string; fromOpponentDeck?: boolean };
    pendingDraws.push({
      player: p.player,
      count: p.count,
      love: p.triggerProtocol === 'love',
      speed: p.triggerProtocol === 'speed',
      fromOpp: p.fromOpponentDeck === true,
    });
  });
  return () => {
    if (unsub === null) return;
    unsub();
    unsub = null;
  };
}

/**
 * 搬走并清空累加器（**照抄 main.ts 原先的 `const effectDraws = pendingDraws; pendingDraws = [];`**：
 * 返回的就是原来那个数组本身，不是拷贝 —— 语义逐字不变）。
 *
 * 调用时机：一次行动结算完成之后、重渲染之前。
 */
export function drainDraws(): DrawReq[] {
  const taken = pendingDraws;
  pendingDraws = [];
  return taken;
}

/** 清空累加器（整局复位：返回主界面 / 进重放页）。与 `drainDraws()` 的区别是**丢弃**而不是交出去。 */
export function resetDraws(): void {
  pendingDraws = [];
}

/**
 * 效果触发的抽牌序列：按玩家合并计数后逐人播放抽牌飞入动画（同一玩家多次抽牌合并为一次，
 * 幽灵卡依次落到手牌末尾；任一抽牌由 love 触发 → 合并结果带 love 标志 → draw-ghost 挂爱心；
 * 任一抽牌由 speed 触发 → 合并结果带 speed 标志 → 【先播 speed 专属飓风】（牌库区 → 手牌
 * 末尾，effects.playSpeedDrawExtra），基础 draw-ghost 飞入顺延到专属完成后（SPEED_TOTAL_MS）
 * ——修复"基础抽牌先播、speed 专属后播"的时序错误）。全部播完调用 done()。
 *
 * ⚠️ **空数组 ⇒ 同步 done()**：教学屏按"`drainDraws()` 为空就同步 `judgeAndAdvance()`"接线，
 * 语义上依赖这一条（不许凭空插一帧等待）。
 */
export function playDrawSequence(draws: DrawReq[], done: () => void): void {
  const merged: DrawReq[] = [];
  for (const d of draws) {
    const found = merged.find((m) => m.player === d.player);
    if (found) {
      found.count += d.count;
      found.love = found.love || d.love;
      found.speed = found.speed || d.speed;
      found.fromOpp = found.fromOpp || d.fromOpp; // 混合来源按从对手抽处理（起点视觉不统一时取对手侧）
    } else {
      merged.push({ ...d });
    }
  }
  const first = merged[0];
  if (!first) {
    done();
    return;
  }
  const next = (): void => {
    const rest = merged.slice(1);
    if (rest.length === 0) done();
    else playDrawSequence(rest, done);
  };
  if (first.speed) {
    // speed 抽牌：先播专属飓风（牌库区 → 手牌末尾，SPEED_TOTAL_MS ≈ 2.26s 完成），
    // 基础 draw-ghost 飞入顺延到专属完成后（DOM 在 renderApp 前始终为旧布局，落点仍正确）
    playSpeedDrawExtra({ player: first.player, count: first.count, triggerProtocol: 'speed' });
    window.setTimeout(() => {
      playDrawAnimation(first.player, first.count, first.love, first.fromOpp, next);
    }, SPEED_TOTAL_MS);
  } else {
    playDrawAnimation(first.player, first.count, first.love, first.fromOpp, next);
  }
}

/**
 * 刷新手牌抽牌飞入动画：drawn 张卡背幽灵卡从牌库区外侧（P1 从牌库左侧、P2 从牌库右侧，
 * 与手牌生长方向一致）依次飞入，每张间隔 120ms。
 * - 起点 = 牌库区 rect 外侧（牌库元素缺失时回退到手牌区外侧，即原行为）
 * - 终点 = 当前手牌末尾（现有末卡之后逐张按扇形步进延伸），而非固定点
 * - 幽灵卡尺寸与正常手牌卡一致（130×178.8，见 .draw-ghost）
 * - love（FX-4）：抽出的卡边框粉红光芒（.fx-love-cardglow）+ 卡背粉红爱心跳动
 *   （.fx-love-heart 子元素，快速 pulse）——随幽灵飞行，落地后随幽灵清理；
 *   牌库区粉红光芒 / 落点爱心由 effects 层 playLoveDrawExtra 独立播放（持续 2s）
 * 全部落地后移除幽灵卡并调用 done()（由调用方触发重渲染）。
 *
 * ⚠️ 这是**全仓唯一**会造 `.draw-ghost` 的地方（`styles.css` 里那条规则命中的就是这个类名）。
 */
export function playDrawAnimation(
  player: PlayerId,
  count: number,
  love: boolean,
  fromOpp: boolean,
  done: () => void,
): void {
  const hands = document.querySelectorAll<HTMLElement>('.hand');
  const hand = hands[player];
  if (!hand) {
    done();
    return;
  }
  const rect = hand.getBoundingClientRect();
  const cy = rect.top + rect.height / 2;
  // 抽牌起点：普通抽 = 自己牌库区外侧；fromOpp（修改提示词 31：从对手牌库抽，同化1/爱1）
  // = 对端牌库区外侧——卡从对手牌库方向飞入自己手牌（来源视觉正确）
  const deckSel = `.deck[data-player="${player}"]`;
  const deck = document.querySelector<HTMLElement>(deckSel);
  const fromDeck = fromOpp
    ? document.querySelector<HTMLElement>(`.deck[data-player="${player === 0 ? 1 : 0}"]`)
    : deck;
  const deckRect = (fromDeck ?? deck) ? (fromDeck ?? deck)!.getBoundingClientRect() : null;
  // G2 修正 R15-A：幽灵盒尺寸与扇形步距改成**按页取值**（远程页 100.572×137.601 / 78.909）。
  // ⚠️ 每帧只取一次（下面所有张共用），避免同一批幽灵量到不同基准（页面正在切页时）。
  const ghostBox = ghostCardBox();
  const fanStep = handFanSpacing();
  // 生长方向：**容器自己的排列方向**，不是绝对玩家号（`handOuterFor` 的判据）。
  // ⚠️ 热座逐字同值：热座 P0 手牌 `reversed:false` ⇒ 'end'（左起右排，与原 `player === 0` 同）；
  //    热座 P1 `reversed:true` ⇒ 'start'（原 `player === 0 ? … : …` 的 else 支同）。
  //    远程页两条手牌**都**是 `reversed:false`（`render-net.ts:1500/1523`）⇒ 两座位都给 'end'，
  //    这正是修 "P1 的幽灵飞到末卡左边而真卡出现在右端" 的那一处（R3 已把落点判据换过，
  //    本函数当时漏改，是同一族里最后一条绝对玩家号判据）。
  const fromLeft = handOuterFor(hand) === 'end';
  const startX = deckRect ? (fromLeft ? deckRect.left - 90 : deckRect.right + 90)
    : (fromLeft ? rect.left - 90 : rect.right + 90);
  // 现有末卡（正排 = 最右 / row-reverse = 最左；排除揭示幽灵牌）；空手牌时回退到手牌区起点
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards[cards.length - 1];
  const lastRect = last ? last.getBoundingClientRect() : null;
  const ghosts: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    let targetX: number;
    // 扇形重叠量（= 步距与卡宽之差；热座 28）—— **单一出处**：`handFanLead()` 由
    // "卡宽 − 步距"推出，这里与下面的空手牌内缩共用它，不再各写一遍减法。
    const overlap = handFanLead();
    if (lastRect) {
      // 扇形步进：新卡中心距 = 卡宽 − 重叠量（热座 130 − 28 = 102；远程页 100.572 × 0.7846 = 78.909）
      // 正排：新卡 1 左缘 = 末卡右缘 − 重叠（中心 = 右缘 + 卡宽/2 − 重叠）；row-reverse 反向镜像
      // ⚠️ 原句写死 `+ 37`（= 130/2 − 28）—— 37 是**热座卡宽**的一半减重叠，必须跟着卡宽走，
      //    否则远程页中心点偏 5.7px（100.572/2 − 21.66 = 28.63 ≠ 37）。
      // 热座：`handFanLead()` = 130 − 102 = 28 ⇒ 130/2 − 28 = 37 —— 与原句**逐位相等**。
      const lead = ghostBox.w / 2 - overlap;
      targetX = fromLeft ? lastRect.right + lead + fanStep * i : lastRect.left - lead - fanStep * i;
    } else {
      // 空手牌：正排落在左 padding 内、row-reverse 落在右 padding 内，逐张按扇形步进向后延伸
      // （热座 `overlap = 28`，与被替换掉的那个字面量 `28` 逐位相等）
      targetX = fromLeft
        ? rect.left + overlap + ghostBox.w / 2 + fanStep * i
        : rect.right - overlap - ghostBox.w / 2 - fanStep * i;
    }
    const ghost = document.createElement('div');
    ghost.className = 'draw-ghost';
    ghost.style.left = `${startX}px`;
    // 幽灵卡 top 用函数出口的 h（与 .draw-ghost 高度同源）：元素未 appendChild 前 offsetHeight 恒为 0
    ghost.style.top = `${cy - ghostBox.h / 2}px`;
    // G2 修正 R15-A：内联宽高**必须**写 —— `styles.css:1740-1741` 的 `.draw-ghost` 写死
    // `130px / 178.8px`（热座值），而本元素挂在 `document.body` 上（**不在 `.net-board` 里**）
    // ⇒ styles-net.css 的 `.net-hands .card` 那条规则**命不中它**，只能在这里内联覆盖。
    ghost.style.width = `${ghostBox.w}px`;
    ghost.style.height = `${ghostBox.h}px`;
    // FX-4 love 抽牌：卡背粉红爱心（跳动）+ 边框粉红光芒（.fx-love-heart 子元素居中于卡背，
    // 与 .draw-ghost 自身的 transform 平移过渡不冲突——动画在子元素上）
    if (love) {
      ghost.classList.add('fx-love-cardglow');
      ghost.appendChild(buildLoveHeart());
    }
    document.body.appendChild(ghost);
    ghosts.push(ghost);
    // 以幽灵卡中心对准落点
    const dx = targetX - (startX + ghostBox.w / 2);
    // 依次起飞：首张 30ms（保证初始位置已被绘制一帧）后每 120ms 起飞下一张
    window.setTimeout(() => {
      ghost.style.transform = `translateX(${dx}px)`;
    }, 30 + i * 120);
  }
  // 最后一张落地（起飞 30ms + 飞行 250ms）后再留 50ms，清理幽灵并重渲染
  const total = 30 + (count - 1) * 120 + 250 + 50;
  window.setTimeout(() => {
    for (const g of ghosts) g.remove();
    done();
  }, total);
}
