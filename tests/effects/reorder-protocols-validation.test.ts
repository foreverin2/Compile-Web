import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, EffectStep, GameState, Line, PlayerId, StepResult } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { answerEffect, resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { makeCard } from '../helpers';

/**
 * G5 T33：重排窗口提交的那条 `action:order:XYZ` 的**引擎层兜底校验**。
 *
 * 两层校验各自的定点腿：
 *  1) `answerEffect` 的 select-action 分支（src/core/effects/resolve.ts:157-161）：
 *     每一项都必须在 `req.actions` 里，否则抛 `invalid action selection`，且**不动任何状态**；
 *  2) `reorderProtocols` op 执行层（resolve.ts:822-844）：`order` 必须是 0..2 的排列
 *     （重复/越界 ⇒ `invalid order`），且不许是恒等排列（⇒ `reorder must change protocol order`）。
 *
 * 既有覆盖只钉了"合法的一条能过"（tests/effects/gen3-batch3-cards.test.ts:92 的 `action:order:210`）
 * 与纯函数层（tests/ui/rearrange-draft.test.ts）；本文件补的是**拒绝路径**。
 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  return s;
}

function placeSrc(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

/** 协议序列读数（失败信息里带原始 defId 数组；变异版本可能写出空洞，用 <空位> 标出来） */
function protos(s: GameState, p: PlayerId): string[] {
  return s.players[p].protocols.map((x) => x?.defId ?? '<空位>');
}

/** 状态指纹：整局状态的原样序列化（gen 生成器不参与序列化，见下面的投影）。
 *  排除项只有"效果队列自身"——挂起的选择请求还没被应答，`lastAnswer` 仍是 null；
 *  若连它一起比，等于要求 answerEffect 既拒绝又不留痕，反而测不到重点。
 *  队列状态在每条腿里单独断言（prompt 仍在 / 长度不变 / 指纹相等）。 */
function fingerprint(s: GameState): string {
  return JSON.stringify({
    ...s,
    pendingEffects: s.pendingEffects.map((e) => ({
      id: e.id,
      player: e.player,
      sourceUid: e.sourceUid,
      sourceDefId: e.sourceDefId,
      system: e.system ?? false,
      prompt: e.prompt,
      lastAnswer: e.lastAnswer,
    })),
  });
}

/** 手推一条挂起效果：gen 里直接 yield 指定 op（system ⇒ 跳过 sourceValid，专测执行层校验） */
function pushReorder(s: GameState, order: Line[], player: PlayerId = 0): void {
  s.pendingEffects.push({
    id: 'e-reorder',
    player,
    gen: (function* (): Generator<EffectStep, void, StepResult> {
      yield { op: 'reorderProtocols', order };
    })(),
    sourceUid: 'src',
    sourceDefId: 'system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

describe('重排 order 的引擎层校验（G5 T33）', () => {
  it('select-action 层：拒绝不在 req.actions 里的 action:order:999，且 prompt 仍在、状态逐字未变', () => {
    const s = setup();
    const src = placeSrc(s, 'momentum-4', 0, 0); // momentum-4 中段：重排你的协议
    resolveMiddle(s, 0, src);

    // 局面前提：挂起一条 select-action 请求，可动作恰是 5 条合法排列
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top, 'momentum-4 中段没有挂起重排请求').toBeDefined();
    expect(top.prompt, 'momentum-4 中段没有挂起 prompt').not.toBeNull();
    const req: ChoiceRequest = top.prompt!;
    expect(req.kind, `前提不成立：kind=${String(req.kind)}`).toBe('select-action');
    expect(req.rearrangeSide, 'UI 提示 rearrangeSide 丢了（本条腿依赖"窗口提交"这条路）').toBe(0);
    expect(
      req.actions,
      `前提不成立：可动作为 [${String(req.actions?.join(','))}]`,
    ).toEqual(['action:order:021', 'action:order:102', 'action:order:120', 'action:order:201', 'action:order:210']);
    const protosBefore = protos(s, 0);
    const fp = fingerprint(s);

    // 真调用：整屏重排窗口回填的若是一条越界/不存在的串，必须被这一层拦住
    let err: unknown = null;
    try {
      answerEffect(s, top.id, ['action:order:999']);
    } catch (e) {
      err = e;
    }
    const msg = String((err as Error | null)?.message);
    const protosAfter = protos(s, 0);
    const raw = `非法串没被拒（顺序可能被改了）：错误=${msg} 协议=[${protosAfter.join(',')}]`;
    expect(msg, raw).toMatch(/invalid action selection/);

    // 拒绝后：prompt 仍在（效果没被驱动）、状态指纹逐字未变
    expect(s.pendingEffects[s.pendingEffects.length - 1].prompt, '拒绝后 prompt 被清掉了（效果被错误推进）').not.toBeNull();
    expect(s.pendingEffects, '拒绝后效果栈被改了').toHaveLength(1);
    expect(fingerprint(s), `拒绝后状态被改了：协议 前=[${protosBefore.join(',')}] 后=[${protos(s, 0).join(',')}]`).toBe(fp);
  });

  it('reorderProtocols 层：拒绝重复 [0,0,1] 与越界 [0,1,3]，且协议序列未变', () => {
    for (const bad of [[0, 0, 1], [0, 1, 3]] as Line[][]) {
      const s = setup();
      const protosBefore = protos(s, 0);
      pushReorder(s, bad);
      const fp = fingerprint(s);

      let err: unknown = null;
      try {
        runStack(s);
      } catch (e) {
        err = e;
      }
      // 先取原始读数再拼失败信息：变异版本可能把协议位写成 undefined，读 defId 会崩——
      // 若在断言信息里现场读，失败会退化成 TypeError，看不到"到底哪个断言红了"。
      const msg = String((err as Error | null)?.message);
      const protosAfter = protos(s, 0);
      const raw = `order=[${bad.join(',')}] 错误=${msg} 协议=[${protosAfter.join(',')}]`;
      expect(msg, `非法 order 没被拒：${raw}`).toMatch(/invalid order/);
      expect(protosAfter, `非法 order 改了协议序列：${raw}`).toEqual(protosBefore);
      expect(fingerprint(s), `非法 order 改了状态：${raw}`).toBe(fp);
      expect(s.pendingEffects, `非法 order 改了效果栈：${raw}`).toHaveLength(1);
    }
  });

  it('reorderProtocols 层：拒绝恒等排列 [0,1,2]（FAQ 终态≠初态），且协议序列未变', () => {
    const s = setup();
    const protosBefore = protos(s, 0);
    pushReorder(s, [0, 1, 2]);
    const fp = fingerprint(s);

    let err: unknown = null;
    try {
      runStack(s);
    } catch (e) {
      err = e;
    }
    const msg = String((err as Error | null)?.message);
    const protosAfter = protos(s, 0);
    const raw = `order=[0,1,2] 错误=${msg} 协议=[${protosAfter.join(',')}]`;
    expect(msg, `恒等排列没被拒：${raw}`).toMatch(/reorder must change protocol order/);
    expect(protosAfter, `恒等排列改了协议序列：${raw}`).toEqual(protosBefore);
    expect(fingerprint(s), `恒等排列改了状态：${raw}`).toBe(fp);
    expect(s.pendingEffects, `恒等排列改了效果栈：${raw}`).toHaveLength(1);
  });
});
