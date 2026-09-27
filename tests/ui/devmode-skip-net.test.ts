/**
 * G6 T45 判据 3 / 判据 4（node 层）：开发者指令 `/skip` 与"联机对局里不许改状态"。
 *
 * 用户 2026-09-27 ⑥：行动步那个"跳过"收进开发者模式的新指令 `/skip`；
 * 用户 2026-09-27 ⑧：联机对局里用指令改状态会让两端不同步 ⇒ 会改状态的指令一律拒绝。
 *
 * ⚠️ **本文件内 `it` 有顺序依赖**：解锁标记（`passwordUnlocked`）是 devmode 的模块级会话状态，
 * 只能从"未解锁"变成"已解锁"、不会自己回去 ⇒ "未解锁时 /skip 不可用"那一条**必须排在**
 * "解锁后可用"那一条**前面**（vitest 默认按声明顺序串行跑同一个文件，不做并发）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame, getDraftPool, performDraftPick } from '../../src/core/state/create';
import { executeAction, getLegalActions } from '../../src/core/game';
import { hash64, stableStringify, stateFingerprint } from '../../src/core/fingerprint';
import {
  NET_STATE_REFUSAL,
  isDevUnlocked,
  runCommand,
  tryUnlockDevMode,
  type DevModeHost,
} from '../../src/ui/devmode';
import type { GameState } from '../../src/core/models/types';
import { functionBody, stripComments } from './source-text';

/** 读源码（判据用；与 `tests/ui/devmode-seat.test.ts` 同一手法） */
const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${name}`, import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8');

/**
 * **不带 log 的状态指纹**：`state.log` 是**本机 UI 日志**，非联机下每条开发者指令都会往它
 * 里写回执 ⇒ 整份状态指纹必然变。而判据要问的是"**牌局状态**动没动"，所以这里把 log 清成
 * 空再算（与 `stateFingerprint` 同一份序列化 `stableStringify`，只换掉 log 这一格）。
 * 联机下另有更硬的读法：`log()` 在联机里**一个字节都不写 state.log**（见 devmode 的 `log`），
 * 于是那边可以直接用**整份** `stateFingerprint` 比。
 */
function boardFingerprint(s: GameState): string {
  return hash64(stableStringify({ ...s, log: [] as string[] }));
}

/** 打完草稿、推进行动步（手牌 5 张 ⇒ 能出牌 ⇒ 普通 advance 会被守卫拒） */
function atActionStep(): GameState {
  const s = createGame({ seed: 'g6t45-devmode-skip' });
  while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
  // start / check-control / check-compile 三步都不经过行动步 ⇒ 普通 advance 一定合法
  while (s.step !== 'action') executeAction(s, s.turnPlayer, 'advance');
  return s;
}

function makeHost(state: GameState, net = false): { host: DevModeHost; renders: () => number } {
  let renders = 0;
  return {
    host: {
      getState: () => state,
      render: () => { renders += 1; },
      isNetMatch: () => net,
    },
    renders: () => renders,
  };
}

describe('G6 T45 · 开发者指令 `/skip`（行动步那个"跳过"的显式旁路）', () => {
  it('未解锁时 `/skip` 不可用：不推进、只在屏上写一句为什么', () => {
    expect(isDevUnlocked(), '本用例必须跑在解锁之前（见文件头顺序说明）').toBe(false);
    const s = atActionStep();
    const { host, renders } = makeHost(s);
    const before = boardFingerprint(s);
    runCommand(host, '/skip');
    expect(boardFingerprint(s), '未解锁时 /skip 不许改动牌局状态').toBe(before);
    expect(s.step).toBe('action');
    expect(s.log.join(' '), '未解锁时没有留下说明').toContain('/skip 未执行');
    expect(renders(), '未解锁时不该重渲染').toBe(0);
  });

  it('解锁后 `/skip` 让该玩家推进一格（贴回执 + 前后 step 读数）', () => {
    expect(tryUnlockDevMode('不是密码'), '错误密码不该解锁').toBe(false);
    expect(tryUnlockDevMode('上上下下左右左右BABA'), '正确密码应解锁').toBe(true);
    expect(isDevUnlocked()).toBe(true);

    const s = atActionStep();
    const { host, renders } = makeHost(s);
    // 前置：能出牌 ⇒ 普通 advance 会被引擎拒，只有 /skip 能过
    expect(getLegalActions(s, 0).some((a) => a.kind === 'advance')).toBe(false);
    const beforeStep = s.step;
    runCommand(host, '/skip');
    expect(s.step, `/skip 应把 ${beforeStep} 推进一步`).toBe('check-cache');
    expect(s.log.join(' '), '/skip 没有留下回执')
      .toContain('/skip 已推进：P1 action → P1 check-cache');
    expect(renders(), '/skip 成功后应重渲染一次').toBe(1);
  });

  it('`/skip` 也吃四条老守卫（例：check-compile 有可编译线时推不动）', () => {
    const s = createGame({ seed: 'g6t45-skip-guards' });
    while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    s.players[0].stacks[0] = Array.from({ length: 10 }, (_, i) => ({
      uid: `m${i}`, defId: 'metal-1', owner: 0 as const, faceUp: true,
      zone: 'field' as const, line: 0 as const, pos: i,
    }));
    const { host } = makeHost(s);
    runCommand(host, '/skip');
    expect(s.step, '必编译时 /skip 也不许过（与旧 advance 同一条守卫）').toBe('check-compile');
    expect(s.log.join(' ')).toContain('compile is mandatory at check-compile');
  });
});

describe('G6 T45 ⑧ · 联机对局里会改状态的开发者指令一律拒绝', () => {
  it('联机中 `get` / `clean` / `Compile` / `/skip` 全被拒，屏上有人话说明，整份状态指纹逐字不变', () => {
    const s = atActionStep();
    const { host, renders } = makeHost(s, true);
    const before = stateFingerprint(s); // 联机下连 state.log 都不许动 ⇒ 用**整份**指纹
    const handBefore = s.players[0].hand.length;
    const logBefore = s.log.length;
    for (const cmd of ['get light-2', 'clean', 'Compile life', '/skip', 'skip']) {
      const notice = runCommand(host, cmd);
      expect(notice, `${cmd} 没有在屏上给出拒绝说明`).toBe(NET_STATE_REFUSAL);
    }
    expect(stateFingerprint(s), '被拒的指令必须一个字节都不改（两端才不会分叉）').toBe(before);
    expect(s.log.length, '联机下连 state.log 都不许动（它是跨端规范串的一格）').toBe(logBefore);
    expect(s.players[0].hand.length).toBe(handBefore);
    expect(s.step).toBe('action');
    expect(renders(), '被拒时不该重渲染').toBe(0);
  });

  it('只读/视角类（`视角`）在联机中保持可用 —— 它不动牌局状态，只换本机视角', () => {
    const s = atActionStep();
    let seat: 0 | 1 = 0;
    const host: DevModeHost = {
      getState: () => s,
      render: () => { /* noop */ },
      isNetMatch: () => true,
      netSeat: { get: () => seat, set: (next) => { seat = next; } },
    };
    const before = stateFingerprint(s);
    runCommand(host, '视角');
    expect(seat, '联机中 `视角` 必须仍然能用（预览/验收要靠它）').toBe(1);
    expect(stateFingerprint(s), '`视角` 不该碰牌局状态（含 state.log）').toBe(before);
    expect(s.log.join(' ')).not.toContain(NET_STATE_REFUSAL);
  });

  it('非联机（热座页 / 单视角预览）时不拦：`get` 照旧加牌', () => {
    const s = atActionStep();
    const { host } = makeHost(s, false);
    const before = s.players[0].hand.length;
    runCommand(host, 'get light-2');
    expect(s.players[0].hand.length, '非联机时 get 应照常工作').toBe(before + 1);
    expect(s.log.join(' ')).not.toContain(NET_STATE_REFUSAL);
  });

  /**
   * ⚠️ **这是一条源码腿（grep）**：它只证明"接线在源码里"，**证明不了用户在屏上看得见**
   * ——DOM 装配、`document.body` 上的浮层、真键盘事件都不在这一条里。
   * "用户看得见"那一半的读数是真机跑出来的（真 Chrome + 真 `initDevMode`）：
   * `.superpowers/g6-T45/rowgate-cdp.mjs` 会读那个 `.dev-console-hint` 节点的 `textContent`
   * （联机三格读到的就是 `NET_STATE_REFUSAL` 那句话；非联机敲 `/skip` 读到
   * `/skip 已推进：P1 action → P1 check-cache`）。
   * 留着这条源码腿的理由：真机探针不在 `npx vitest run` 里跑，删掉这句会让常规门禁失去唯一的提醒。
   */
  it('源码腿（只证接线，不证用户看得见）：指令页那行状态区接住了 `runCommand` 的返回值', () => {
    const src = stripComments(read('ui/devmode.ts'));
    // 为什么必须有这条：联机下拒绝那句**不能**进 state.log（见 `log` 的注释），
    // 而 state.log 才是日志面板的数据源 ⇒ 屏上只剩 `notice` 这一行。
    // 少了 `notice.textContent = runCommand(...)` 这句，用户敲完指令**什么也看不到**
    // （指令被静默吃掉），而"两端指纹相等"那几条判据**照样全绿**。
    expect(src, '指令页没有把 runCommand 的返回值画到屏上 —— 联机下拒绝是静默的')
      .toMatch(/notice\.textContent = runCommand\(host, input\.value\)/);
    expect(src, '`notice` 没有挂进面板 —— 建了节点但用户看不到')
      .toMatch(/panel\.appendChild\(notice\)/);
  });

  /**
   * 2026-09-27 评审逮到的真洞：指令页里除了回车，还有**两条检索行的点击**直接调
   * `addCardToCurrentPlayer` / `forceCompileProtocol`，**绕过 `runCommand` 那道闸门**
   * ⇒ 联机里鼠标一点就把本机 `state` 改了（评审真机读数：手牌 5→6、规范串 9139→9232）。
   *
   * 现在两层都焊死，这里各钉一条（同样是源码腿：真机行为读数在 `rowgate-cdp.mjs`）：
   *  - 调用点：两条 `row.addEventListener('click')` 都必须走 `runCommand`；
   *  - 本体：`addCardToCurrentPlayer` / `forceCompileProtocol` 自己也要带闸门 ——
   *    万一将来又有人直接调它们（或者把上面那条改回去），闸门仍在改状态那一层拦着。
   */
  it('源码腿：两条检索行的点击都走 `runCommand`（不再直接调改状态的函数）', () => {
    const src = stripComments(read('ui/devmode.ts'));
    expect(src, '卡片检索行又绕过 `runCommand` 直接加牌了（联机下鼠标一点就改状态）')
      .toContain('notice.textContent = runCommand(host, `get ${def.defId}`)');
    expect(src, '协议检索行又绕过 `runCommand` 直接强制编译了（联机下鼠标一点就改状态）')
      .toContain('notice.textContent = runCommand(host, `compile ${proto.defId}`)');
  });

  it('源码腿：两个"改状态"函数本体各带一道闸门（闸门长在改状态那一层）', () => {
    const src = stripComments(read('ui/devmode.ts'));
    expect(functionBody(src, 'addCardToCurrentPlayer'), '加牌函数本体没有闸门 —— 谁直接调它都绕得过去')
      .toContain('netGateBlocks(host');
    expect(functionBody(src, 'forceCompileProtocol'), '强制编译函数本体没有闸门 —— 谁直接调它都绕得过去')
      .toContain('netGateBlocks(host');
    // 闸门必须在 `nextUid(state)` **之前**：那个调用本身就把 uid 计数器推了一格（也是改状态）
    const body = functionBody(src, 'addCardToCurrentPlayer');
    expect(body.indexOf('netGateBlocks(host'), '闸门排在了 nextUid 之后 —— 加牌被拒了但 uid 计数器已经动了')
      .toBeLessThan(body.indexOf('nextUid(state)'));
  });
});
