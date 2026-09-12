import type { Card, GameState, Line, Op, PendingEffect, PlayerId, StepResult } from '../models/types';
import { drawCards, discardFromHand, shuffle } from '../engine/deck';
import { advanceStep } from '../engine/turn';
import { gameBus } from '../events/bus';
import { createCtx, emitCardEvent, findCard, isUncovered, nextEffectId, shouldBlockDraw, cardCommandDisabled, rigidity7Immune } from './context';
import { collectTriggerFor, fireReactive, resolveTrigger } from './triggers';
import { EFFECTS } from './registry';
import { executeCompileBody } from '../rules/compile-body';
import { lineMiddleCommandsNullified, opponentBlocksMiddleCommands } from '../rules/restrictions';
import { rearrangeProtocolSlots } from '../actions/rearrange';
import { pushLog, pushEffectLog, actionCn } from '../log';
import './cards/fire';
import './cards/light';
import './cards/darkness';
import './cards/water';
import './cards/life';
import './cards/death';
import './cards/spirit';
import './cards/gravity';
import './cards/psychic';
import './cards/plague';
import './cards/metal';
import './cards/speed';
import './cards/love';
import './cards/hate';
import './cards/apathy';
import './cards/luck';
import './cards/mirror';
import './cards/peace';
import './cards/chaos';
import './cards/clarity';
import './cards/ice';
import './cards/smoke';
import './cards/fear';
import './cards/corruption';
import './cards/war';
import './cards/courage';
import './cards/time';
import './cards/diversity';
import './cards/assimilation';
import './cards/unity';
// —— 3代 批1（2026-09，嫉妒/暴食/贪婪/色欲/傲慢）——
import './cards/envy';
import './cards/gluttony';
import './cards/greed';
import './cards/lust';
import './cards/pride';
// —— 3代 批2（2026-09，怠惰/愤怒/伏击/支点/压制）——
import './cards/sloth';
import './cards/wrath';
import './cards/ambush';
import './cards/fulcrum';
import './cards/overwhelm';
// —— 3代 批3（2026-09，动量/新星/惰性/刚性/柔性）——
import './cards/momentum';
import './cards/nova';
import './cards/inertia';
import './cards/rigidity';
import './cards/flexibility';

function topEffect(s: GameState): PendingEffect | undefined {
  return s.pendingEffects[s.pendingEffects.length - 1];
}

/** 即时定向触发（批2 after-play/after-return）：查指定玩家某线（缺省=三线）链路【顶卡】faceUp 注册
 *  kind 的效果并 push（仅顶卡——ice-1/corruption-1 底命令无 top，被盖不触发；push 不带 topCommand，
 *  源有效性 = 触发卡自身）。after-play 需同线（打出者对手同线）；after-return 三线皆查。 */
function fireDirectedTop(
  s: GameState,
  kind: 'after-play' | 'after-return',
  pid: PlayerId,
  line?: Line,
): void {
  const stackList: Card[][] = line !== undefined ? [s.players[pid].stacks[line]] : s.players[pid].stacks;
  for (const stack of stackList) {
    const top = stack[stack.length - 1];
    if (!top || !top.faceUp || !isUncovered(s, top)) continue;
    const def = EFFECTS[top.defId]?.triggers?.[kind];
    if (!def) continue;
    // 3代 inertia-1 区域禁底（C7）：after-play/after-return 均为底命令注册（ice-1/envy-3/corruption-1 等）
    if (cardCommandDisabled(s, top, 'bottom')) continue;
    s.pendingEffects.push({
      id: nextEffectId(),
      player: top.owner,
      gen: def.fn(createCtx(s, top.owner, top)),
      sourceUid: top.uid,
      sourceDefId: top.defId,
      prompt: null,
      lastAnswer: null,
    });
  }
}

/** 效果源卡是否仍有效：在场、正面、未被覆盖；否则剩余效果终止（系统效果无源卡，恒有效）。
 *  topCommand（fireReactive 推入的 after-* 顶命令触发）：跳过未覆盖检查——顶命令被盖仍生效 */
function sourceValid(s: GameState, pe: PendingEffect): boolean {
  if (pe.system) return true;
  const card = findCard(s, pe.sourceUid);
  if (!card || card.zone !== 'field' || !card.faceUp) return false;
  if (pe.topCommand) return true;
  return isUncovered(s, card);
}

/** 打出/翻正/揭开触发中指令：入栈（LIFO 由 runStack 统一结算）。
 *  apathy-2 顶「无效化此列所有牌的中部命令」→ 该线中指令直接跳过（查 EFFECTS 之前）
 *  fear-0 顶「在你的回合内，对手无法触发中央效果」（批2）→ 结算人中指令直接跳过
 *  reason：触发原因（打出/翻正/被揭开）——入结构化日志标题（2026-09 日志树）。 */
export function pushMiddle(s: GameState, player: PlayerId, card: Card, reason = ''): void {
  if (opponentBlocksMiddleCommands(s, player)) {
    pushLog(s, `[被禁止] ${card.defId} 的中部指令无法结算（恐惧0 在场，对手回合内禁中央效果）`);
    return;
  }
  if (card.line !== null && lineMiddleCommandsNullified(s, card.line)) {
    pushLog(s, `[被禁止] ${card.defId} 的中部指令无效（冷漠2 此列无效化中部命令）`);
    return;
  }
  const eff = EFFECTS[card.defId]?.middle;
  if (!eff) return;
  const ctx = createCtx(s, player, card);
  s.pendingEffects.push({
    id: nextEffectId(), player,
    gen: eff(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    prompt: null, lastAnswer: null,
  });
  pushEffectLog(s, card.defId, '中部', reason ? `原因：${reason}` : '');
}

export function resolveMiddle(s: GameState, player: PlayerId, card: Card): void {
  pushMiddle(s, player, card);
  runStack(s);
}

/** 应答挂起选择：校验后恢复生成器继续结算 */
export function answerEffect(s: GameState, promptId: string, selected: string[]): void {
  const pe = topEffect(s);
  if (!pe || pe.prompt === null) throw new Error(`no pending choice "${promptId}"`);
  if (pe.id !== promptId) throw new Error(`prompt id mismatch: ${promptId}`);
  const req = pe.prompt;
  if (!req.optional && selected.length < req.min) throw new Error(`requires at least ${req.min} selection(s)`);
  if (selected.length > req.max) throw new Error(`requires at most ${req.max} selection(s)`);
  // 重复选择拦截（沿用旧行为；select max≥2 时防 ['a','a']）
  if (new Set(selected).size !== selected.length) throw new Error(`duplicate selection: ${promptId}`);
  if (req.kind === 'select-line') {
    // 可选 select-line：空应答 = 跳过（如 darkness-1 的可选平移）；否则必须恰选 1 条合法线
    const ok =
      (req.optional && selected.length === 0) ||
      (selected.length === 1 && req.lines?.includes(Number(selected[0].replace('line:', '')) as Line));
    if (!ok) throw new Error('invalid line selection');
  } else if (req.kind === 'select-action') {
    // 逐项校验：每一项都必须属于 req.actions（max>1 时同样拦截非列表项）
    for (const act of selected) {
      if (!req.actions?.includes(act)) throw new Error('invalid action selection');
    }
  } else {
    for (const uid of selected) {
      if (!req.candidates.some((c) => c.uid === uid)) throw new Error(`invalid selection: ${uid}`);
    }
  }
  pe.prompt = null;
  pe.lastAnswer = { selected };
  // 日志树：记录玩家选择（哪张卡/哪条线/哪个动作，或跳过）——树内与当前效果同层缩进
  {
    const who = (req.chooser ?? pe.player) + 1;
    if (selected.length === 0) {
      pushLog(s, `P${who} 选择：跳过`);
    } else if (req.kind === 'select-line') {
      const lines = selected.map((x) => `线 ${Number(x.replace('line:', '')) + 1}`).join('、');
      pushLog(s, `P${who} 选择：${lines}`);
    } else if (req.kind === 'select-action') {
      const acts = selected.map((x) => actionCn(x)).join('、'); // 修改提示词 8：动作日志中文
      pushLog(s, `P${who} 选择：${acts}`);
    } else {
      const names = selected
        .map((uid) => req.candidates?.find((c) => c.uid === uid)?.defId ?? uid)
        .join('、');
      pushLog(s, `P${who} 选择：${names}`);
    }
  }
  runStack(s);
}

/** 效果栈主循环：结算栈顶；栈空时完成挂起的落地/偏转落地/步骤推进 */
export function runStack(s: GameState): void {
  for (;;) {
    while (s.pendingEffects.length > 0) {
      const pe = topEffect(s)!;
      // 幂等保护（2026-09 compile case 补 runStack 后发现）：栈顶已有挂起选择（prompt 非空）
      // → 等待 answerEffect 应答后恢复（answerEffect 会再次 runStack），不重复驱动同一生成器
      // （重复 next({}) 会让 yield 选择表达式收到空答案 → gen 内 selected undefined 崩溃）。
      if (pe.prompt) return;
      if (!sourceValid(s, pe)) {
        s.pendingEffects.pop();
        pushLog(s, `效果终止：${pe.sourceDefId} 被覆盖/翻面/移除`);
        continue;
      }
      const result: StepResult = pe.lastAnswer ?? {};
      const r = pe.gen.next(result);
      if (r.done) {
        // 按 id 移除当前效果而非 pop 栈顶：生成器内部可能 push 了新的效果
        // （如 cacheClearGen 末尾 fireReactive 的 after-clear-cache 触发），此时栈顶 ≠ 当前效果
        const top = s.pendingEffects[s.pendingEffects.length - 1];
        if (top === pe) {
          s.pendingEffects.pop();
        } else {
          const idx = s.pendingEffects.findIndex((e) => e.id === pe.id);
          if (idx !== -1) s.pendingEffects.splice(idx, 1);
        }
        continue;
      }
      const step = r.value;
      if ('kind' in step) {
        // fizzle 规则：选择请求无合法目标时不挂起 —— 记录日志并以空答案恢复生成器，
        // 由生成器内守卫跳过该步骤（必选/可选一致；可选空目标本就会跳过）。
        // 按 kind 判定"无合法目标"：select 看候选卡，select-line 看可选线，select-action 看可执行操作。
        const noTargets =
          step.kind === 'select' ? step.candidates.length === 0
          : step.kind === 'select-line' ? (step.lines?.length ?? 0) === 0
          : (step.actions?.length ?? 0) === 0;
        if (noTargets) {
          pushLog(s, '无合法目标，该步骤跳过');
          pe.lastAnswer = { selected: [] };
          continue;
        }
        pe.prompt = step;
        pe.lastAnswer = null;
        return; // 挂起：等待玩家选择
      }
      executeOp(s, pe, step);
      // 落地/落牌前中断效果结算：由外层循环先完成落地（含"被盖住前"连锁）再恢复生成器，
      // 避免连续 shift/playTopDeck 覆盖单一 pendingShift/pendingPlay 槽位（浮空卡丢失）
      if (s.pendingShift.length > 0 || s.pendingPlay.length > 0) break;
    }
    if (s.pendingPlay.length > 0) { completePlay(s); continue; }
    if (s.pendingShift.length > 0) { completeShift(s); continue; }
    // speed-2「通过编译删除此牌前」触发完成后执行编译本体（先于步骤推进；编译删除不触发文本）
    if (s.pendingCompile) {
      const pc = s.pendingCompile;
      s.pendingCompile = null;
      executeCompileBody(s, pc.player, pc.line);
      continue;
    }
    if (s.pendingStepAdvance) {
      s.pendingStepAdvance = false;
      advanceStep(s);
      continue;
    }
    return;
  }
}

/** op → 中文动作描述（日志树明细行；内部已有详细 log 的 op 返回 '' 避免双行）。
 *  目标卡以 defId 标注（不泄牌库秘密——牌库来源不打牌名）。 */
function describeOp(s: GameState, pe: PendingEffect, op: Op): string {
  const defIdOf = (uid: string): string => findCard(s, uid)?.defId ?? uid;
  switch (op.op) {
    case 'discard':
      return `弃置 ${defIdOf(op.uid)}`;
    case 'discardMany':
      return `弃置 ${op.uids.length} 张牌`;
    case 'delete':
      return `删除 ${defIdOf(op.uid)}`;
    case 'return':
      return `回手 ${defIdOf(op.uid)}`;
    case 'flip':
      return `翻转 ${defIdOf(op.uid)}`;
    case 'shift':
      return `平移 ${defIdOf(op.uid)} → 线 ${op.targetLine + 1}`;
    case 'draw': {
      const who = op.player ?? pe.player;
      return `P${who + 1} 抽 ${op.count} 张牌${op.fromOpponentDeck ? '（对手牌库顶）' : ''}`;
    }
    case 'playTopDeck':
      return `从牌库顶打出（${op.faceUp ? '正面' : '反面'}）→ 线 ${op.line + 1}`;
    case 'playFromHand':
      return `打出 ${defIdOf(op.uid)}（${op.faceUp ? '正面' : '反面'}）→ 线 ${op.line + 1}`;
    case 'reveal':
      return `揭示 ${defIdOf(op.uid)}`;
    case 'give':
      return `将 ${defIdOf(op.uid)} 给予 P${op.to + 1}`;
    case 'takeRandom':
      return `从 P${op.from + 1} 随机取 1 张手牌`;
    case 'discardDeckTop':
      return '弃置牌库顶 1 张';
    case 'drawFromDeck':
      return `从牌库抽 ${defIdOf(op.uid)}`;
    case 'playFromTrash':
      return `从弃牌堆打出 ${defIdOf(op.uid)}（${op.faceUp ? '正面' : '反面'}）→ 线 ${op.line + 1}`;
    case 'deckTopTransfer':
      return `将 P${op.from + 1} 牌库顶牌反面打出到 P${op.toPlayer + 1} 的线 ${op.toLine + 1}`;
    case 'takeFromField':
      return `取走场上 ${defIdOf(op.uid)} 加入手牌`;
    case 'rearrangeProtocols':
    case 'reorderProtocols':
    case 'swapStacks':
    case 'copyMiddle':
    case 'toDeckBottom':
    case 'discardWholeDeck':
      return ''; // 已有详细内部 log
    default:
      return '';
  }
}

/** 操作执行（Task 4 加 flip、Task 5 加 delete/return、Task 6 加 shift） */
export function executeOp(s: GameState, pe: PendingEffect, op: Op): void {
  const desc = describeOp(s, pe, op);
  if (desc !== '') pushLog(s, desc);
  switch (op.op) {
    case 'discard': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot discard ${op.uid}: not in hand`);
      // 按被弃卡 owner 弃（psychic「对手弃牌」需弃对手手牌；普通弃牌 owner=效果属主，行为不变）
      discardFromHand(s, card.owner, op.uid);
      // triggerProtocol/triggerDefId：触发这张弃牌的卡（效果源），FX 层据此叠加协议专属额外特效
      emitCardEvent(s, 'card:discarded', card, {
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // 即时连锁：弃牌者【对手】场上注册了 after-discard 的正面卡触发（plague-1「对手弃牌后：你抽1张」；
      // 含系统缓存弃牌——用户拍板）
      fireReactive(s, 'after-discard', card.owner);
      // 2代 peace-4「在对手回合中你弃牌时：你抽1张」：弃牌者【自身】侧 after-self-discard（回合门控在效果内）
      fireReactive(s, 'after-self-discard', card.owner);
      break;
    }
    case 'draw': {
      const target = op.player ?? pe.player;
      if (op.fromOpponentDeck) {
        // love-1「抽对手牌堆顶的牌」：对手牌库空 → 洗对手弃牌堆重组再抽（用户拍板，与 drawCards 一致）；
        // 两者皆空才抛错（调用方守卫，此处兜底防静默吞牌）
        const opp: PlayerId = target === 0 ? 1 : 0;
        const os = s.players[opp];
        if (os.deck.length === 0 && os.trash.length > 0) {
          os.deck = shuffle(os.trash);
          os.trash = [];
          for (const c of os.deck) c.faceUp = false;
        }
        if (shouldBlockDraw(s, target)) {
          pushLog(s, 'ice-6：禁止抽牌，跳过');
          break;
        }
        const card = os.deck.pop();
        if (!card) throw new Error('opponent deck is empty');
        card.owner = target; // 所有权变更到抽牌者
        card.zone = 'hand';
        card.secret = false; // 手牌 = 已知信息：进手牌即解禁
        card.faceUp = true;
        card.line = null;
        card.pos = null;
        s.players[target].hand.push(card);
        gameBus.emit({ type: 'card:drawn', state: s, payload: { player: target, count: 1, fromOpponentDeck: true, triggerProtocol: pe.sourceDefId.split('-')[0] } });
        fireReactive(s, 'after-draw', target);
        // 2代 mirror-4/war-0 底「当对手抽牌时：…」
        fireReactive(s, 'after-opponent-draw', target);
        break;
      }
      drawCards(s, target, op.count); // drawCards 内部已 fireReactive after-draw
      gameBus.emit({ type: 'card:drawn', state: s, payload: { player: target, count: op.count, triggerProtocol: pe.sourceDefId.split('-')[0] } });
      break;
    }
    case 'flip': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot flip ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot flip ${op.uid}: covered card`);
      // ice-4 底「此牌不可被翻转」（批2；修改提示词 18：效果若触发则【真的】不能被翻转——
      // faceUp 即免疫，含被覆盖，不再要求顶卡）；3代 inertia-1 禁底 → ice-4 底失效可翻（C7）；
      // rigidity-7 底「此牌不能被翻转或平移」同款免疫（C11）
      if (
        rigidity7Immune(s, card) ||
        (card.defId === 'ice-4' && card.faceUp && !cardCommandDisabled(s, card, 'bottom'))
      ) {
        pushLog(s, `${card.defId} 不可被翻转，跳过`);
        break;
      }
      // before-flip 前置触发（metal-6 顶「被盖住或翻转前：先删除这张牌」）：
      // 仅正面卡有文本——背面卡无任何效果 → 反面卡被翻正不触发，直接翻转；
      // 顶命令（TriggerDef.top，如 metal-6）被盖仍触发 → topCommand 跳过 sourceValid 的
      // 未覆盖检查（被盖的正面 metal-6 被 allowCovered 翻转时也要先删自己）。
      // 触发（删除自己）后 flip 不再执行——卡已被移除，翻转无从谈起
      const bf = card.faceUp ? collectTriggerFor(s, card, 'before-flip') : null;
      if (bf) { resolveTrigger(s, bf, { topCommand: bf.top }); break; }
      card.faceUp = !card.faceUp;
      // 翻开即解禁：翻正为正面时清除牌堆来源的 secret 标记（正面 = 公开信息）。
      // 翻回反面不清 secret（只是重新隐藏，信息仍非公开）。
      if (card.faceUp) card.secret = false;
      // triggerProtocol/triggerDefId：触发这次翻面的卡（效果源），FX 层据此叠加
      // 协议专属特效（life → 绿色藤蔓缠绕；water-0 的翻转带 'water' → 无藤蔓）
      emitCardEvent(s, 'card:flipped', card, {
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // FAQ 127：被覆盖卡翻正不触发中指令（始终被视为被覆盖状态）——仅未被覆盖的翻正连锁中指令；
      // G2（2代 luck-1/chaos-0）：noMiddle=true 时翻正也不连锁中指令（「无视中央效果」/静默翻开）
      if (card.faceUp && isUncovered(s, card) && !op.noMiddle) pushMiddle(s, card.owner, card, '翻正');
      break;
    }
    case 'delete': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot delete ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot delete ${op.uid}: covered card`);
      const owner = card.owner;
      const line = card.line!;
      const stack = s.players[owner].stacks[line];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot delete ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从链路中部移除）
      card.zone = 'trash';
      card.faceUp = true;
      card.line = null;
      card.pos = null;
      s.players[owner].trash.push(card);
      // triggerProtocol/triggerDefId：触发这张删去的卡（效果源），FX 层据此叠加协议专属额外特效
      emitCardEvent(s, 'card:deleted', card, {
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // 即时连锁：被删卡【持有者】场上注册了 after-delete 的正面卡触发（hate-3「你的牌被删除后：抽1张」；
      // 编译删除不经此路径 → 不触发——用户拍板「不含编译删除」）
      fireReactive(s, 'after-delete', owner);
      // 3代 greed-0 底「当你删除牌后：抽1张牌」：删除【执行者】自己侧注册 after-own-delete 的顶卡触发
      // （actor=效果属主 pe.player——「你删除」= 执行者删了任意牌即触发；hate-3 的 after-delete 不变）
      fireReactive(s, 'after-own-delete', pe.player);
      if (wasTop) revealAfterRemoval(s, owner, line); // 仅当移除的是顶卡时新顶卡才被"揭开"
      break;
    }
    case 'return': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot return ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot return ${op.uid}: covered card`);
      const owner = card.owner;
      const line = card.line!;
      const stack = s.players[owner].stacks[line];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot return ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从链路中部移除）
      card.zone = 'hand';
      // 回手即解禁：手牌 = 已知信息，牌堆来源的 secret 卡进入持有者手牌后可见正面
      // （控制器规则：secret 只禁场上反面卡的窥视，不禁回手后查看）
      card.secret = false;
      card.line = null;
      card.pos = null;
      s.players[owner].hand.push(card);
      // triggerProtocol/triggerDefId：触发这次回手的卡（效果源），FX 层据此叠加
      // 协议专属特效（water → 蓝色水波环 + 光晕 + 游动轨迹环）
      emitCardEvent(s, 'card:returned', card, {
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      if (wasTop) revealAfterRemoval(s, owner, line); // 仅当移除的是顶卡时新顶卡才被"揭开"
      // 批2 corruption-1 底「当对手的卡牌被召回时：将那张牌正面朝下放回他的牌库」：
      // 被召回卡属主【对手】侧注册 after-return 的顶卡触发；被召回 uid 存临时字段供效果读取
      s.pendingReturnUid = card.uid;
      fireDirectedTop(s, 'after-return', owner === 0 ? 1 : 0);
      break;
    }
    case 'shift': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot shift ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot shift ${op.uid}: covered card`);
      if (op.targetLine === card.line) throw new Error('must shift to a different line');
      // 3代 rigidity-7 底「此牌不能被翻转或平移」（C11）：未被覆盖（faceUp 顶卡）时免疫 → 跳过
      if (rigidity7Immune(s, card)) {
        pushLog(s, 'rigidity-7 不可被平移，跳过');
        break;
      }
      const owner = card.owner;
      const fromLine = card.line!;
      const stack = s.players[owner].stacks[fromLine];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot shift ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从链路中部移除）
      card.zone = 'float';
      card.line = op.targetLine; // 提交目标（落地前不可变卦）
      card.pos = null;
      s.pendingShift.push({ card, beforeCoveredDone: false });
      // triggerProtocol/triggerDefId：触发这次偏转的卡（效果源），FX 层据此为
      // darkness-0/1/4 的偏转播烟桥路线特效（其余偏转源（light-2/light-3）带 'light'）
      emitCardEvent(s, 'card:shifted', card, {
        fromLine,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      if (wasTop) revealAfterRemoval(s, owner, fromLine); // 仅当移除的是顶卡时新顶卡才被"揭开"
      break;
    }
    case 'playTopDeck': {
      // player 缺省 = 效果属主（water-1/life-0/life-3）；gravity-6 指定 player=对手（对手牌库打出）
      const target = op.player ?? pe.player;
      const p = s.players[target];
      // FAQ 142/166：从牌堆顶打出卡牌不强制洗牌（仅抽牌洗弃牌堆）——牌库空则效果不生效。
      // 生成器已按 deckTopAvailable（只查牌库）守卫，此处抛错兜底防静默吞牌
      const card = p.deck.pop();
      if (!card) throw new Error('deck is empty');
      card.zone = 'float';
      card.faceUp = op.faceUp;
      // 牌堆来源的反面打出 = 非公开信息：连持有者都不可窥视（secret），直到某效果
      // 翻正为正面（flip op 清 secret）。牌堆来源的正面打出本就公开，不打标记。
      card.secret = !op.faceUp;
      card.line = op.line;
      card.pos = null;
      s.pendingPlay.push({ card, beforeCoveredDone: false, belowUid: op.belowUid });
      // triggerProtocol = 触发这张打牌堆顶的效果源协议（life-0/life-3/water-1/gravity-0/6），
      // FX 层据此只给 gravity 播黑洞+射线（life/water 打牌堆顶不误播重力特效）
      emitCardEvent(s, 'card:deck-played', card, {
        line: op.line,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'playFromHand': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot play ${op.uid}: not in hand`);
      const hand = s.players[card.owner].hand;
      const idx = hand.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot play ${op.uid}: not in hand`);
      hand.splice(idx, 1); // 从持有者手牌移除
      card.zone = 'float';
      card.faceUp = op.faceUp;
      card.line = op.line;
      card.pos = null;
      // belowUid（3代 rigidity-3「在此牌正下方反面打出1张牌」）：落地时插入该卡下方（该卡保持未覆盖）
      s.pendingPlay.push({ card, beforeCoveredDone: false, belowUid: op.belowUid });
      // playFromHand（手牌打出）与 playTopDeck（牌堆顶打出）区分事件：
      // FX 层据此从手牌卡 rect 起飞（而非牌库 rect）飞入目标线链路末尾
      emitCardEvent(s, 'card:hand-played', card, {
        line: op.line,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'rearrangeProtocols': {
      // 重排协议：交换指定玩家两个协议位（defId 与 compiled 状态随数组元素整体移动；
      // 线链路/卡牌留在原位 —— 与参考实现"协议顺序变更、场上卡不动"语义一致）
      // player 缺省 = 效果属主（water-2/spirit-4）；psychic-2 指定 player=对手。
      // 执行/log/动画事件统一走共享入口 rearrangeProtocolSlots（控制组件重排动作同路径）。
      const target = op.player ?? pe.player;
      rearrangeProtocolSlots(s, target, op.a, op.b);
      // 3代「重排协议」事件（C4 一切重排都算）：重排动作发起者 = pe.player（效果属主）→
      // 触发自身侧 after-self-rearrange（nova-2 底）与双方 after-any-rearrange（momentum-1 底）
      fireReactive(s, 'after-self-rearrange', pe.player);
      fireReactive(s, 'after-any-rearrange', pe.player);
      break;
    }
    case 'give': {
      // 手牌移交：uid 卡从持有者手牌移给 to 玩家（owner 更新；love-1 底/love-3 给牌）
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot give ${op.uid}: not in hand`);
      const from = card.owner;
      const hand = s.players[from].hand;
      const idx = hand.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot give ${op.uid}: not in hand`);
      hand.splice(idx, 1);
      card.owner = op.to;
      s.players[op.to].hand.push(card);
      // triggerProtocol/triggerDefId：触发这次给牌的卡（效果源），FX 层据此叠加协议专属
      // 额外特效（love → 粉红爱心飞行；payload.to = 接收方，uid 对应卡此刻仍在给牌方手牌 DOM）
      emitCardEvent(s, 'card:given', card, {
        to: op.to,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'takeRandom': {
      // 随机取牌：从 from 玩家手牌随机取 1 张给效果属主（owner 更新；love-3 随机拿牌）
      const hand = s.players[op.from].hand;
      if (hand.length === 0) throw new Error('no cards to take'); // 调用方守卫（对手无手牌 → 不触发）
      const idx = Math.floor(Math.random() * hand.length);
      const [card] = hand.splice(idx, 1);
      card.owner = pe.player;
      s.players[pe.player].hand.push(card);
      // triggerProtocol/triggerDefId：与 give op 同款（love-3 随机拿牌 → 粉红爱心飞行；
      // payload.to = 接收方（效果属主），uid 对应卡此刻仍在被拿方手牌 DOM）
      emitCardEvent(s, 'card:given', card, {
        to: pe.player,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'discardMany': {
      // 批量弃牌（FAQ 94：多张弃牌是单次动作——一次性弃完，之后由弃牌触发的效果才生效一次；
      // 与逐个 discard op（每个都触发 after-discard）区分；psychic-0/2、plague-2、hate-1、
      // 系统缓存清理用）。弃的卡必须同属一人（同一弃牌动作），否则抛错
      if (op.uids.length === 0) break;
      let actor: PlayerId | null = null;
      for (const uid of op.uids) {
        const card = findCard(s, uid);
        if (!card || card.zone !== 'hand') throw new Error(`cannot discard ${uid}: not in hand`);
        if (actor === null) actor = card.owner;
        else if (card.owner !== actor) throw new Error('discardMany uids must share one owner');
        discardFromHand(s, card.owner, uid);
        emitCardEvent(s, 'card:discarded', card, {
          triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
          triggerProtocol: pe.sourceDefId.split('-')[0],
        });
      }
      // uids 非空且循环内 actor 必被赋值；显式守卫满足 TS 收窄
      if (actor === null) throw new Error('discardMany requires at least one card');
      fireReactive(s, 'after-discard', actor); // 一次性触发
      fireReactive(s, 'after-self-discard', actor); // 2代 peace-4（自身侧）
      break;
    }
    case 'reveal': {
      // 揭示：把卡牌正面复制为幽灵牌到 shownTo 玩家手牌区末尾（不改变原卡状态）。
      // 两个用例（turn-count 过期，见 types.ts RevealedGhost 注释）：
      // - Case A：揭示【自己】的卡 → shownTo = 对手，expiresAtTurn = 计数 + 2
      //   （第 2 次回合结束转换 = 对手回合结束时清除）。
      // - Case B：揭示【对手】的卡 → shownTo = 发起者（自己），expiresAtTurn = 计数 + 3
      //   （第 3 次回合结束转换 = 发起者下回合结束时清除；不是对手回合结束——旧 bug）。
      // 转换数学：揭示发生在发起者回合（middle/trigger 只在当前回合玩家场上结算）——
      // 发起者本回合结束（+1，不清 +2/+3）→ 对手回合结束（+2，清 Case A）→
      // 发起者下回合结束（+3，清 Case B）。
      const card = findCard(s, op.uid);
      if (!card) throw new Error(`cannot reveal ${op.uid}: not found`);
      const caster = pe.player;
      const ownReveal = card.owner === caster; // Case A：把【我的】卡给对手看
      const shownTo: PlayerId = ownReveal ? (caster === 0 ? 1 : 0) : caster; // 得知信息的一方
      s.revealedGhosts.push({
        id: nextEffectId(),
        defId: card.defId,
        shownTo,
        expiresAtTurn: s.turnCount + (ownReveal ? 2 : 3), // A：对手回合结束；B：发起者下回合结束
        // light 协议触发的揭示 → 落地幽灵带光之辉光（十字星 + 边框辉光；效果协议不随卡牌易主改变）
        lightFx: pe.sourceDefId.split('-')[0] === 'light',
        // love 协议触发的揭示（love-4）→ 落地幽灵粉红边框辉光 + 中间爱心跳动（FX-4）；
        // clarity 协议触发的揭示（透彻1 中）→ 落地幽灵 30% 眼睛 + 圣光（透彻特效，批2）
        fx: pe.sourceDefId.split('-')[0] === 'love' ? 'love' : pe.sourceDefId.split('-')[0] === 'clarity' ? 'clarity' : undefined,
      });
      // triggerProtocol/triggerDefId：触发这次揭示的卡（效果源），FX 层据此给飞行幽灵
      // 叠加协议专属特效（light → 天使翅膀）并决定落地幽灵的辉光
      emitCardEvent(s, 'card:revealed', card, {
        shownTo,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // 修改提示词 25：被揭示的非公开牌 → 解除 secret（场上反面被揭示后持有者双击可翻面查看正面；
      // 防作弊标记清除，信息已公开给被揭示方）
      card.secret = false;
      break;
    }
    case 'discardDeckTop': {
      // G1（2代 批1：luck-2/4、clarity-1 top）：弃牌库顶 1 张；牌库空 → 抛错（调用方 deckTopAvailable
      // 守卫；FAQ 107 从牌库顶弃牌不洗弃牌堆）。进弃牌堆正面公开（清 secret——弃牌堆=公开信息）
      const target = op.player ?? pe.player;
      const p = s.players[target];
      const card = p.deck.pop();
      if (!card) throw new Error('deck is empty');
      card.zone = 'trash';
      card.faceUp = true;
      card.secret = false;
      card.line = null;
      card.pos = null;
      p.trash.push(card);
      emitCardEvent(s, 'card:discarded', card, {
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
        fromDeckTop: true, // 修改提示词 5：牌库顶弃牌——FX 从牌库区起飞（该卡无场上/手牌 DOM 节点）
      });
      fireReactive(s, 'after-discard', target); // 弃牌连锁（弃牌者对手侧 plague-1 类）
      fireReactive(s, 'after-self-discard', target); // 2代 peace-4 类（弃牌者自身侧）
      break;
    }
    case 'swapStacks': {
      // G3（2代 mirror-2）：同玩家两个链路整堆换线；各堆内部顺序不变；无覆盖/落地 → 不触发任何文本/连锁
      if (op.a === op.b) throw new Error('cannot swap a stack with itself');
      const target = op.player ?? pe.player;
      const stacks = s.players[target].stacks;
      const tmp = stacks[op.a];
      stacks[op.a] = stacks[op.b];
      stacks[op.b] = tmp;
      for (let i = 0; i < stacks[op.a].length; i++) stacks[op.a][i].pos = i;
      for (let i = 0; i < stacks[op.b].length; i++) stacks[op.b][i].pos = i;
      for (const c of stacks[op.a]) c.line = op.a;
      for (const c of stacks[op.b]) c.line = op.b;
      pushLog(s, `P${target + 1} 交换链路位置 ${op.a + 1} 与 ${op.b + 1}`);
      gameBus.emit({ type: 'stacks:swapped', state: s, payload: { player: target, a: op.a, b: op.b } });
      break;
    }
    case 'copyMiddle': {
      // G4（2代 mirror-1）：执行目标卡 defId 的 middle EffectGen；ctx.card = 被复制卡（「此牌/此列」
      // 按它解析），效果 player = 发起者（复制者，文本「你」），源有效性跟踪发起效果源卡（sourceUid 不换）
      const card = findCard(s, op.uid);
      if (!card) throw new Error(`cannot copy ${op.uid}: not found`);
      const eff = EFFECTS[card.defId]?.middle;
      if (!eff) {
        pushLog(s, `复制中央效果：${card.defId} 无中指令，无效果`);
        break;
      }
      s.pendingEffects.push({
        id: nextEffectId(),
        player: pe.player,
        gen: eff(createCtx(s, pe.player, card)),
        sourceUid: pe.sourceUid,
        sourceDefId: pe.sourceDefId,
        prompt: null,
        lastAnswer: null,
      });
      // mirror-1 复制 FX：被复制卡（op.uid）→ 复制者源卡（pe.sourceUid）虚影飞行。
      // 引擎在 push 后发出（复制效果随后结算），FX 层据此在源卡位置播放幽灵浮现 →
      // 飘向复制者 → 融合闪光（不阻塞结算：动画与复制效果并行，视觉"先特效后效果"）。
      gameBus.emit({
        type: 'card:copied',
        state: s,
        payload: {
          uid: card.uid,
          defId: card.defId,
          copiedToUid: pe.sourceUid,
          triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
          triggerProtocol: pe.sourceDefId.split('-')[0],
        },
      });
      break;
    }
    case 'reorderProtocols': {
      // G7（2代 chaos-1）：按 order 重排目标玩家协议。约定：新位置 i 放原 order[i] 位置的协议
      // （order 是 0..2 的排列，如 [2,0,1] = 原第 3 位 → 新第 1 位）。终态≠初态（FAQ 60）执行层兜底
      const target = op.player ?? pe.player;
      const protos = s.players[target].protocols;
      const seen = new Set<number>();
      for (const v of op.order) {
        if (!Number.isInteger(v) || v < 0 || v > 2 || seen.has(v)) {
          throw new Error(`invalid order: ${JSON.stringify(op.order)}`);
        }
        seen.add(v);
      }
      if (seen.size !== 3) throw new Error(`invalid order: ${JSON.stringify(op.order)}`);
      const same = op.order.every((v, i) => v === i);
      if (same) throw new Error('reorder must change protocol order (FAQ: 终态≠初态)');
      const copy = protos.map((x) => ({ ...x }));
      for (let i = 0; i < 3; i++) protos[i] = copy[op.order[i]];
      pushLog(s, `P${target + 1} 重排协议 → ${op.order.map((x) => x + 1).join('')}`);
      gameBus.emit({ type: 'protocols:rearranged', state: s, payload: { player: target, order: [...op.order] } });
      // 3代「重排协议」事件（C4）：reorder 也算重排（momentum-1 底/新星2 底触发）
      fireReactive(s, 'after-self-rearrange', pe.player);
      fireReactive(s, 'after-any-rearrange', pe.player);
      break;
    }
    case 'drawFromDeck': {
      // G8b（2代 clarity-2/3）：从牌库任意位抽 1 张入手（揭示语境已展示牌库供选择）；剩余保持顺序
      // 2026-09-12 稳健性（用户问「联合4 会不会像时间协议那样卡住」）：多次 drawFromDeck 之间
      // 可能被 after-draw 连锁抽走/洗走目标卡 → 此前直接 throw 会把整局卡死；
      // 现改为记录日志并跳过该次抽取（该卡已不在牌库 = 无牌可抽，句意上等于无事发生）。
      const target = op.player ?? pe.player;
      if (shouldBlockDraw(s, target)) {
        pushLog(s, 'ice-6：禁止抽牌，跳过');
        break;
      }
      const p = s.players[target];
      const idx = p.deck.findIndex((c) => c.uid === op.uid);
      if (idx === -1) {
        pushLog(s, `从牌库抽取失败：${op.uid} 已不在牌库，跳过`);
        break;
      }
      const [card] = p.deck.splice(idx, 1);
      card.zone = 'hand';
      card.faceUp = true;
      card.secret = false;
      card.line = null;
      card.pos = null;
      p.hand.push(card);
      emitCardEvent(s, 'card:drawn', card, {
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      fireReactive(s, 'after-draw', target);
      fireReactive(s, 'after-opponent-draw', target);
      break;
    }
    case 'playFromTrash': {
      // 批3 time-0/3：从弃牌堆打出（uid 须在效果属主 trash）→ 落地流程（completePlay 处理
      // before-covered/落地/中指令连锁）。trash 卡公开 → 反面打出不打 secret（曾公开信息）
      // 2026-09-12 稳健性：玩家选牌后若经过连锁结算该卡已离开弃牌堆（被洗库/被取走），
      // 不再抛错中断整局——记录日志并跳过该句（同 drawFromDeck 处理）。
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'trash' || card.owner !== pe.player) {
        pushLog(s, `从弃牌堆打出失败：${op.uid} 已不在弃牌堆，跳过`);
        break;
      }
      const p = s.players[pe.player];
      const idx = p.trash.findIndex((c) => c.uid === op.uid);
      if (idx === -1) {
        pushLog(s, `从弃牌堆打出失败：${op.uid} 已不在弃牌堆，跳过`);
        break;
      }
      p.trash.splice(idx, 1);
      card.zone = 'float';
      card.faceUp = op.faceUp;
      card.line = op.line;
      card.pos = null;
      s.pendingPlay.push({ card, beforeCoveredDone: false });
      emitCardEvent(s, 'card:deck-played', card, {
        line: op.line,
        fromTrash: true, // 批3 time-0/3：从弃牌堆打出——弃牌堆时钟 FX 依据
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'deckTopTransfer': {
      // 批3 assimilation-2/6：从 from 牌库顶 pop → owner 变 toPlayer → 反面 → 落 toPlayer 的 toLine
      // （走 pendingPlay 落地；覆盖目标顶卡的 before-covered 连锁照常）
      const fromP = s.players[op.from];
      const card = fromP.deck.pop();
      if (!card) throw new Error('deck is empty'); // 调用方 deckTopAvailable 守卫
      card.owner = op.toPlayer;
      card.zone = 'float';
      card.faceUp = false;
      card.secret = true; // 牌库来源的反面打出 = 秘密（连持有者不可窥视，同 playTopDeck）
      card.line = op.toLine;
      card.pos = null;
      s.pendingPlay.push({ card, beforeCoveredDone: false });
      emitCardEvent(s, 'card:deck-played', card, {
        line: op.toLine,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'takeFromField': {
      // 批3 assimilation-0：场卡（正面朝下，含被盖）移除 → 易主效果属主 → 入手（faceUp 公开）
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot take ${op.uid}: not on field`);
      const owner = card.owner;
      const line = card.line!;
      const stack = s.players[owner].stacks[line];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot take ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1);
      card.owner = pe.player;
      card.zone = 'hand';
      card.faceUp = true; // 进手牌 = 已知信息
      card.secret = false;
      card.line = null;
      card.pos = null;
      s.players[pe.player].hand.push(card);
      emitCardEvent(s, 'card:given', card, {
        to: pe.player,
        triggerDefId: pe.sourceDefId,
        triggerUid: pe.sourceUid,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      if (wasTop) revealAfterRemoval(s, owner, line); // 顶卡被取走 → 新顶揭开（faceDown 顶不触发）
      break;
    }
    case 'toDeckBottom': {
      // 3代 sloth-2 底「将手牌中的1张牌放回牌库底端」：手牌移除 → 己方牌库底部（deck[0]）插入；
      // 回牌库 → faceDown 秘密化（R11.4：入牌库一律翻回反面/秘密）
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot place ${op.uid} under deck: not in hand`);
      const owner = card.owner;
      const hand = s.players[owner].hand;
      const idx = hand.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot place ${op.uid} under deck: not in hand`);
      hand.splice(idx, 1);
      card.zone = 'deck';
      card.faceUp = false;
      card.secret = true;
      card.line = null;
      card.pos = null;
      s.players[owner].deck.unshift(card); // 牌库底部 = index 0（drawCards pop 取顶）
      pushLog(s, `P${owner + 1} 将 ${card.defId} 放回牌库底端`);
      break;
    }
    case 'discardWholeDeck': {
      // 3代 inertia-4「弃置你的牌库」（C9 单次批量）：整库一次性移入弃牌堆（公开 faceUp），
      // 按单次弃牌动作触发一次弃牌连锁（FAQ 94 与 discardMany 一致）
      const target = op.player ?? pe.player;
      const p = s.players[target];
      if (p.deck.length === 0) break;
      const cards = p.deck.splice(0);
      for (const c of cards) {
        c.zone = 'trash';
        c.faceUp = true;
        c.secret = false;
        c.line = null;
        c.pos = null;
      }
      p.trash.push(...cards);
      pushLog(s, `P${target + 1} 弃置整个牌库（${cards.length} 张）`);
      fireReactive(s, 'after-discard', target);
      fireReactive(s, 'after-self-discard', target);
      break;
    }
  }
}

/** 落牌（目标顶卡"被盖住前"先结算一次，然后落地 + 中指令；队列 FIFO，每次处理队首）
 *  belowUid（gravity-0）：落地时插入源卡下方——源卡保持原位未被覆盖，新卡垫在其下；
 *  源卡已不在（被删/被移）则回退落顶 */
function completePlay(s: GameState): void {
  const ps = s.pendingPlay[0];
  if (!ps) return;
  const card = ps.card;
  const p = s.players[card.owner];
  const stack = p.stacks[card.line!];
  // belowUid 落点先行解析：插入源卡下方不覆盖顶卡 → 跳过 before-covered 检查；
  // 回退落顶（源卡已不在，确实覆盖顶卡）→ 保留检查
  const belowIdx = ps.belowUid !== undefined ? stack.findIndex((c) => c.uid === ps.belowUid) : -1;
  if ((ps.belowUid === undefined || belowIdx === -1) && stack.length > 0 && !ps.beforeCoveredDone) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) { ps.beforeCoveredDone = true; resolveTrigger(s, t); return; }
  }
  card.zone = 'field';
  if (belowIdx !== -1) {
    stack.splice(belowIdx, 0, card); // 插到源卡下方（该位置 = 源卡之下、其下卡之上）
    for (let i = 0; i < stack.length; i++) stack[i].pos = i; // 重索引整堆 pos
  } else {
    stack.push(card);
    card.pos = stack.length - 1;
  }
  s.pendingPlay.shift();
  emitCardEvent(s, 'card:played', card);
  if (card.faceUp) pushMiddle(s, card.owner, card, '打出');
  // 批2 ice-1 底「对手在此链路出牌后：他要弃置1张牌」：打出者【对手】同线顶卡注册 after-play → 触发。
  // actor（行动打出者）：腐化0 落对方场易主后 card.owner ≠ 打出者——触发侧应看打出者视角
  const actor: PlayerId = ps.actor ?? card.owner;
  fireDirectedTop(s, 'after-play', actor === 0 ? 1 : 0, card.line!);
  // 3代 rigidity-2 底「在你用行动反面打出1张牌后：从你的牌库顶端反面打出1张牌到同一链路」（E10）：
  // 仅玩家【行动】打出（actions/base playCard 标记 fromAction）且反面 → 触发（打出者自己侧）
  if (ps.fromAction && !card.faceUp) {
    s.pendingActionPlayLine = card.line!;
    fireReactive(s, 'after-action-face-down-play', actor);
  }
}

/** 偏转落地（目标顶卡"被盖住前"先结算一次，然后落地；队列 FIFO，每次处理队首） */
function completeShift(s: GameState): void {
  const ps = s.pendingShift[0];
  if (!ps) return;
  const card = ps.card;
  const p = s.players[card.owner];
  const stack = p.stacks[card.line!];
  if (stack.length > 0 && !ps.beforeCoveredDone) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) { ps.beforeCoveredDone = true; resolveTrigger(s, t); return; }
  }
  card.zone = 'field';
  card.pos = stack.length;
  stack.push(card);
  s.pendingShift.shift();
  emitCardEvent(s, 'card:landed', card);
  // 多元0/联合1 中段判定时机（用户澄清 2026-09）：中部指令在【打出 / 反面翻正 / 被偏转移动后
  // 暴露为未被覆盖的正面顶卡】时判定（普通 middle 已覆盖打出与翻正；此处补偏转落地）。
  // 偏转落地后卡成为目标堆顶且 faceUp → 其中段重新评估（多元0 纯翻协议；联合1 完整编译）。
  if (card.faceUp && isUncovered(s, card) && (card.defId === 'diversity-0' || card.defId === 'unity-1')) {
    pushMiddle(s, card.owner, card, '偏转暴露');
  }
}

/** 顶卡移除后：新顶卡正面朝上则触发其中指令（被揭开连锁；编译不经过此函数，符合"编译不触发文本"）。
 *  日志树：移除即记「[揭示] 新顶被揭开」（新顶 faceUp 时；无中段注册也记录——被揭开事件本身），
 *  随后 pushMiddle（reason 被揭开）使其中段标题成为子层。 */
export function revealAfterRemoval(s: GameState, owner: PlayerId, line: Line): void {
  const stack = s.players[owner].stacks[line];
  const top = stack[stack.length - 1];
  if (top && top.faceUp) {
    pushLog(s, `[揭示] ${top.defId} 被揭开（其上卡被移除）`);
    pushMiddle(s, owner, top, '被揭开');
  }
}


