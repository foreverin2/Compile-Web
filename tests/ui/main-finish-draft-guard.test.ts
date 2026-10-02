/**
 * ★ 2026-10-02 修复：**排查口 `__g5Match.finishDraft()` 在没有联机局时早退**
 * （`src/main.ts` 的 `finishDraft: () => { … }`）。
 *
 * ## 修的是什么
 *
 * 它是排查/门禁口（只在 `#g5probe=1` 下可达，玩家碰不到）。改之前它只判 `state.phase === 'draft'`，
 * **没有** `netGame === null` 的早退 ⇒ 在硬币闸放行之前调用它，那一刻 `driver` 还是热座的
 * `localDriver`（`acceptsInput` 恒真、`submit` 不看座位也不看轮次），于是它把**本端连续的那一段
 * 草稿在本地走完**（2026-10-02 实测：单次调用 `steps = 6`、同时 `seat = -1`），两端各播一次转场
 * —— 而那一刻 `renderMode` 还是 `'lobby'`、没有牌桌可画。上一轮那次误读
 * （"转场跑完了，但两端 `phase` 退回 `draft`"）就是**在联机局外调了它**造出来的假象
 * （定性见 `.superpowers/2026-10-02-draft-transition-bug/报告.md` §二）。
 *
 * ## ⚠️ 为什么这里只有**源码腿**（诚实披露本文件证明不了什么）
 *
 * `src/main.ts` 是应用入口：一被 import 就 `document.getElementById('app')`、`createGame()`、
 * `initEffects()`… 最后 `showStartScreen()` ⇒ 要真 DOM 与 rAF，而本仓测试环境是 node、**没有 jsdom**
 * （同 `tests/ui/main-driver-wiring.test.ts` / `net-preview-wiring.test.ts` 头注声明的限度）。
 * 探针对象又住在 `exposeMatchProbe()` 里（私有、且要 `window.location.hash`）。
 * ⇒ "调一次 `finishDraft()` 看状态有没有变"这条**行为腿只能去真机上跑**，读数在
 * `.superpowers/2026-10-02-net-conn-badge/run-early*.json`：
 * 修前 `steps` 合计 12（两端 6+6）、`phase → 'turn'`、`transitionPlayed = 1`；
 * 修后 `steps = -1`、`phase` 停在 `'draft'`、`transitionPlayed = 0`、`draftRound` 恒 0。
 *
 * 本文件钉的是**源码形状**：早退必须存在、必须是函数体第一件事、必须如实返回值，而且它挡的是
 * "把动作送进驱动"那一句（`cb.onDraftPick(`）—— 漏掉它 = 上一轮那个假象会原样回来。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { braceBlock, stripComments } from './source-text';

const MAIN = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8'),
);

/** `finishDraft: () => { … }` 那一段（花括号配平；注释已由 `stripComments` 抹成空白）。 */
function finishDraftBody(): string {
  const at = MAIN.indexOf('finishDraft:');
  if (at < 0) throw new Error('main.ts 里找不到 `finishDraft:`（结构被改动？）');
  return braceBlock(MAIN, at);
}

/** 那条早退语句本身（找不到就抛，别让上层断言在空匹配上变成假绿）。 */
function guardOf(body: string): { text: string; index: number } {
  const m = /\bif\s*\(\s*netGame\s*===\s*null\s*\)\s*return\b[^;]*;/.exec(body);
  if (m === null) throw new Error('finishDraft 里没有 `netGame === null` 的早退（在联机局外调它会用热座驱动）');
  return { text: m[0], index: m.index };
}

describe('★ 2026-10-02：`finishDraft()` 的 `netGame === null` 早退', () => {
  it('① 早退存在、如实返回值，且排在 `cb.onDraftPick(` 与那一圈之前', () => {
    const body = finishDraftBody();
    const guard = guardOf(body);
    // 如实返回：`steps: -1`（与紧邻的 `rebootDraft()` 同款 —— "什么都没做"，与"草稿本来就打完了"
    // 的 `0` 分得开），`state` 照常交回这一刻的规范串。
    expect(guard.text, '早退的返回值不是"什么都没做"那一档').toMatch(/steps:\s*-1\b/);
    expect(guard.text, '早退没有把当前状态的规范串交回去').toMatch(/state:\s*stableStringify\(state\)/);
    // 位置：早退必须在"把动作送进驱动"那一句之前，也必须在那一圈之前。
    const pickAt = body.indexOf('cb.onDraftPick(');
    const loopAt = body.indexOf('while (state.phase');
    expect(pickAt, '函数体里找不到 `cb.onDraftPick(`（判据面塌了）').toBeGreaterThanOrEqual(0);
    expect(loopAt, '函数体里找不到 `while (state.phase`（判据面塌了）').toBeGreaterThanOrEqual(0);
    expect(guard.index, '早退排在 `cb.onDraftPick(` 之后 ⇒ 驱动已经被喂过动作了').toBeLessThan(pickAt);
    expect(guard.index, '早退排在那一圈之后 ⇒ 草稿已经走完了').toBeLessThan(loopAt);
  });

  it('② 早退是函数体的**第一件事**（它之前一行代码都没有 ⇒ "什么都不做"是构造性的）', () => {
    const body = finishDraftBody();
    const guard = guardOf(body);
    const open = body.indexOf('{');
    expect(open, '找不到 finishDraft 的函数体起始 `{`').toBeGreaterThan(0);
    // `stripComments` 把注释**内容**换成空白、但保留 `/*` 与 `*/` 两个定界符 ⇒ 这里把定界符也去掉。
    expect(body.slice(open + 1, guard.index).replace(/\/\*|\*\//g, '').trim(),
      '早退之前还有别的语句 ⇒ "netGame === null 时什么都不做"不成立（注释已被抹成空白，'
      + '所以这里非空只可能是真代码）').toBe('');
  });
});
