import type { Card, GameState, Line, Op, PendingEffect, PlayerId, StepResult } from '../models/types';
import { drawCards, discardFromHand, shuffle } from '../engine/deck';
import { advanceStep } from '../engine/turn';
import { gameBus } from '../events/bus';
import { createCtx, emitCardEvent, findCard, isUncovered, nextEffectId } from './context';
import { collectTriggerFor, fireReactive, resolveTrigger } from './triggers';
import { EFFECTS } from './registry';
import { executeCompileBody } from '../rules/compile-body';
import { lineMiddleCommandsNullified } from '../rules/restrictions';
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

function topEffect(s: GameState): PendingEffect | undefined {
  return s.pendingEffects[s.pendingEffects.length - 1];
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
 *  apathy-2 顶「无效化此列所有牌的中部命令」→ 该线中指令直接跳过（查 EFFECTS 之前） */
export function pushMiddle(s: GameState, player: PlayerId, card: Card): void {
  if (card.line !== null && lineMiddleCommandsNullified(s, card.line)) return;
  const eff = EFFECTS[card.defId]?.middle;
  if (!eff) return;
  const ctx = createCtx(s, player, card);
  s.pendingEffects.push({
    id: nextEffectId(), player,
    gen: eff(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    prompt: null, lastAnswer: null,
  });
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
  runStack(s);
}

/** 效果栈主循环：结算栈顶；栈空时完成挂起的落地/偏转落地/步骤推进 */
export function runStack(s: GameState): void {
  for (;;) {
    while (s.pendingEffects.length > 0) {
      const pe = topEffect(s)!;
      if (!sourceValid(s, pe)) {
        s.pendingEffects.pop();
        s.log.push(`效果终止：${pe.sourceDefId} 被覆盖/翻面/移除`);
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
          s.log.push('无合法目标，该步骤跳过');
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

/** 操作执行（Task 4 加 flip、Task 5 加 delete/return、Task 6 加 shift） */
export function executeOp(s: GameState, pe: PendingEffect, op: Op): void {
  switch (op.op) {
    case 'discard': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot discard ${op.uid}: not in hand`);
      // 按被弃卡 owner 弃（psychic「对手弃牌」需弃对手手牌；普通弃牌 owner=效果属主，行为不变）
      discardFromHand(s, card.owner, op.uid);
      // triggerProtocol/triggerDefId：触发这张弃牌的卡（效果源），FX 层据此叠加协议专属额外特效
      emitCardEvent(s, 'card:discarded', card, {
        triggerDefId: pe.sourceDefId,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // 即时连锁：弃牌者【对手】场上注册了 after-discard 的正面卡触发（plague-1「对手弃牌后：你抽1张」；
      // 含系统缓存弃牌——用户拍板）
      fireReactive(s, 'after-discard', card.owner);
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
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // FAQ 127：被覆盖卡翻正不触发中指令（始终被视为被覆盖状态）——仅未被覆盖的翻正连锁中指令
      if (card.faceUp && isUncovered(s, card)) pushMiddle(s, card.owner, card);
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
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从堆叠中部移除）
      card.zone = 'trash';
      card.faceUp = true;
      card.line = null;
      card.pos = null;
      s.players[owner].trash.push(card);
      // triggerProtocol/triggerDefId：触发这张删去的卡（效果源），FX 层据此叠加协议专属额外特效
      emitCardEvent(s, 'card:deleted', card, {
        triggerDefId: pe.sourceDefId,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      // 即时连锁：被删卡【持有者】场上注册了 after-delete 的正面卡触发（hate-3「你的牌被删除后：抽1张」；
      // 编译删除不经此路径 → 不触发——用户拍板「不含编译删除」）
      fireReactive(s, 'after-delete', owner);
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
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从堆叠中部移除）
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
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      if (wasTop) revealAfterRemoval(s, owner, line); // 仅当移除的是顶卡时新顶卡才被"揭开"
      break;
    }
    case 'shift': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot shift ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot shift ${op.uid}: covered card`);
      if (op.targetLine === card.line) throw new Error('must shift to a different line');
      const owner = card.owner;
      const fromLine = card.line!;
      const stack = s.players[owner].stacks[fromLine];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot shift ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从堆叠中部移除）
      card.zone = 'float';
      card.line = op.targetLine; // 提交目标（落地前不可变卦）
      card.pos = null;
      s.pendingShift.push({ card, beforeCoveredDone: false });
      // triggerProtocol/triggerDefId：触发这次偏转的卡（效果源），FX 层据此为
      // darkness-0/1/4 的偏转播烟桥路线特效（其余偏转源（light-2/light-3）带 'light'）
      emitCardEvent(s, 'card:shifted', card, {
        fromLine,
        triggerDefId: pe.sourceDefId,
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
      emitCardEvent(s, 'card:deck-played', card, { line: op.line });
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
      s.pendingPlay.push({ card, beforeCoveredDone: false });
      // playFromHand（手牌打出）与 playTopDeck（牌堆顶打出）区分事件：
      // FX 层据此从手牌卡 rect 起飞（而非牌库 rect）飞入目标线堆叠末尾
      emitCardEvent(s, 'card:hand-played', card, { line: op.line });
      break;
    }
    case 'rearrangeProtocols': {
      // 重排协议：交换指定玩家两个协议位（defId 与 compiled 状态随数组元素整体移动；
      // 线堆叠/卡牌留在原位 —— 与参考实现"协议顺序变更、场上卡不动"语义一致）
      // player 缺省 = 效果属主（water-2/spirit-4）；psychic-2 指定 player=对手
      if (op.a === op.b) throw new Error('cannot swap a protocol position with itself');
      const target = op.player ?? pe.player;
      const protos = s.players[target].protocols;
      const tmp = protos[op.a];
      protos[op.a] = protos[op.b];
      protos[op.b] = tmp;
      s.log.push(`P${target + 1} 重排协议：交换位置 ${op.a + 1} 与 ${op.b + 1}`);
      // FX hook：未来的协议交换动画订阅 protocols:rearranged（含玩家与交换位置）
      gameBus.emit({ type: 'protocols:rearranged', state: s, payload: { player: target, a: op.a, b: op.b } });
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
      emitCardEvent(s, 'card:given', card, { to: op.to });
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
      emitCardEvent(s, 'card:given', card, { to: pe.player });
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
          triggerProtocol: pe.sourceDefId.split('-')[0],
        });
      }
      // uids 非空且循环内 actor 必被赋值；显式守卫满足 TS 收窄
      if (actor === null) throw new Error('discardMany requires at least one card');
      fireReactive(s, 'after-discard', actor); // 一次性触发
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
      });
      // triggerProtocol/triggerDefId：触发这次揭示的卡（效果源），FX 层据此给飞行幽灵
      // 叠加协议专属特效（light → 天使翅膀）并决定落地幽灵的辉光
      emitCardEvent(s, 'card:revealed', card, {
        shownTo,
        triggerDefId: pe.sourceDefId,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
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
  if (card.faceUp) pushMiddle(s, card.owner, card);
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
}

/** 顶卡移除后：新顶卡正面朝上则触发其中指令（被揭开连锁；编译不经过此函数，符合"编译不触发文本"） */
export function revealAfterRemoval(s: GameState, owner: PlayerId, line: Line): void {
  const stack = s.players[owner].stacks[line];
  const top = stack[stack.length - 1];
  if (top && top.faceUp) pushMiddle(s, owner, top);
}
