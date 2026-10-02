/**
 * ★ 2026-10-02（i18n 收官走查的漏网修复）：**3 代控制权族特效的文字**在英文模式下必须是英文。
 *
 * ## 这一条腿守的是什么
 *
 * 收官走查（`docs/2026-10-02-i18n-英文覆盖-定稿.md` §2.8）在英文模式的**热座牌桌**那一帧
 * （J2）实测到两条可见汉字：`控制权判定 · P1`（`.g3ctrl-caption`）与
 * `未满足（领先 0 条，需 2 条）`（`.g3ctrl-result`）。台账原来把 `src/ui/gen3-control.ts`
 * 的 5 条中文字面量登记成"控制组件相关的**标记串**" —— 那是登记与实际不符：
 * 它们**全是玩家可见文案**（判定标题/结果 + 挂在卡上的两个文字标）。
 *
 * 修法：按同一套规矩抽进 `src/i18n/`（键族 `gen3.control.*`，`t()` 字面量键、中英都有、
 * `en` 值零汉字、含 `{xxx}` 的占位符给全、**不在模块顶层调 `t()`**）。`src/ui/gen3-control.ts`
 * 不是红线文件，所以这一处是直接抽，不走 `engine-prompt.ts` 那层显示层映射。
 *
 * ## 那 5 条逐条是什么（"标记串 / 诊断"还是"文案"）
 *
 * | # | 出处 | 原文 | 屏上吗 | 归类 |
 * |---|---|---|---|---|
 * | 1 | `gen3ControlCheckFx` | `控制权判定 · P${player + 1}` | 是（判定标题） | **文案** |
 * | 2 | 同上（`gained` 支） | `获得控制组件` | 是（判定结果） | **文案** |
 * | 3 | 同上（否则支） | `未满足（领先 ${wins} 条，需 2 条）` | 是（判定结果） | **文案** |
 * | 4 | `placeEnvy0` | `借 ${bestV}` | 是（嫉妒0 卡上的文字标） | **文案** |
 * | 5 | `syncWrath0Cull` | `最高档剔除` | 是（暴怒0 中缝上的文字标） | **文案** |
 *
 * 这个文件里**没有**"标记串/诊断"类的中文：类名/`data-*` 取值全是 ASCII，注释里的中文
 * 由 `stripComments()` 剥掉。所以抽完这一族的判据就是"代码位里一个汉字都没有"（腿 ③）。
 *
 * ## 三条腿
 *
 *  1. **en**：真跑三个产出函数（桩 DOM），断言五处文字**逐字等于 `EN[...]` 填完占位符的值**、
 *     且**一个汉字都没有**；
 *  2. **zh**：同一批产出逐字等于**改动前**那一帧的原文（锚点硬写在下面，来源 =
 *     `git show HEAD:src/ui/gen3-control.ts`，**不许跟着产物一起改**）；
 *  3. **源码**：`src/ui/gen3-control.ts` 的代码位里零汉字，且 5 个键都以**字面量**出现在
 *     `t('…')` 里（防"以后有人把某一处改回裸中文"）。
 *
 * ## 诚实边界
 *
 * 桩 DOM 只喂**测试给定的矩形**，证明不了真实布局与观感（同 `net-dom-stub.ts` 的既有口径）。
 * 真机那一帧（英文模式热座牌桌）由 `.superpowers/` 下的 CDP 脚本走；本文件是**机检**腿。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  descendants, installStubDom, isClass, makeStubEl, setStubRectFor, type StubNode,
} from '../ui/net-dom-stub';
import { stripComments } from '../ui/source-text';
import {
  clearGen3Persistent, gen3ControlCheckFx, syncEnvy0Absorb, syncWrath0Cull,
} from '../../src/ui/gen3-control';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { createGame } from '../../src/core/state/create';
import { DEFAULT_LANG, setLang } from '../../src/i18n';
import { EN } from '../../src/i18n/en';
import { ZH } from '../../src/i18n/zh';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';

const controlTs = readFileSync(fileURLToPath(new URL('../../src/ui/gen3-control.ts', import.meta.url)))
  .subarray(0, 4 * 1024 * 1024).toString('utf8');

afterEach(() => {
  setLang(DEFAULT_LANG);
  setFxViewSeat(null);
  clearGen3Persistent();   // 常驻层注册表是模块态：本文件建的层不留到别的用例
});

/* ============================================================================
 * HEAD 锚点：改动前那一帧屏上的原文（逐字，不许跟着产物改）
 *
 * 来源 = `git show HEAD:src/ui/gen3-control.ts` 的
 *   `控制权判定 · P${p.player + 1}`（`:1140`）
 *   `p.gained ? '获得控制组件' : \`未满足（领先 ${p.wins} 条，需 2 条）\``（`:1144`）
 *   `\`借 ${bestV}\``（`:240`）
 *   `el('i', 'g3sync-wrath0-chip', '最高档剔除')`（`:290`）
 * ========================================================================== */

const HEAD_CAPTION_P1 = '控制权判定 · P1';
const HEAD_GAINED = '获得控制组件';
const HEAD_NOT_MET_0 = '未满足（领先 0 条，需 2 条）';
const HEAD_BORROW_3 = '借 3';
const HEAD_WRATH_CULL = '最高档剔除';

const CJK = /[\u3400-\u9fff]/;

/* ============================================================================
 * 夹具
 * ========================================================================== */

const card = (uid: string, defId: string, owner: PlayerId, line: Line): Card =>
  ({ uid, defId, owner, line, faceUp: true, zone: 'field', pos: 0 } as unknown as Card);

/**
 * 一条链路同时喂满三族的局面：
 *  - P0 线 0：`envy-0`（嫉妒0 常驻层）＋ `wrath-0` / `wrath-5`（暴怒0 中缝，最高档 = 5）；
 *  - P1 线 0：`fire-3`（嫉妒0 要"对手有一张分值 > 0 的卡"才会产出 `借 N`）。
 */
function makeState(): GameState {
  const s = createGame({ seed: 'i18n-gen3-control', draftStarter: 0, firstToPlay: 0 });
  s.players[0].stacks[0] = [card('g3-envy0', 'envy-0', 0, 0), card('g3-wrath0', 'wrath-0', 0, 0), card('g3-wrath5', 'wrath-5', 0, 0)];
  s.players[1].stacks[0] = [card('g3-foe3', 'fire-3', 1, 0)];
  return s;
}

/** 往 `document.body` 上放一张"场上卡"桩（`cardNode()` 按 `[data-uid]` 查回来，并且要有矩形）。 */
function domCard(uid: string, left: number, top: number): void {
  const n = makeStubEl('div');
  n.classList.add('card');
  n.dataset.uid = uid;
  setStubRectFor(n, { left, top, width: 60, height: 84 });
  (document.body as unknown as StubNode).appendChild(n);
}

/** body 那一层上某个类名的节点（`layer()` 把浮层挂在 `document.body`）。 */
const nodeOf = (cls: string): StubNode | null =>
  descendants(document.body as unknown as StubNode).find((n) => isClass(n, cls)) ?? null;

/** 某个类名节点的正文；读不到就是 null（**不是空串** —— 空串会让"没有这个节点"与"节点是空的"分不开）。 */
const textOf = (cls: string): string | null => {
  const n = nodeOf(cls);
  return n === null ? null : n.text;
};

/** 把某一层的全部节点摘掉（同一个 frame 里连跑两次判定时要清场）。 */
function removeLayers(cls: string): void {
  for (const n of descendants(document.body as unknown as StubNode)) {
    if (isClass(n, cls)) (n as unknown as { remove(): void }).remove();
  }
}

/* ============================================================================
 * 腿 ① + ②：真跑三个产出函数，英文逐字等于 EN / 中文逐字等于 HEAD 原文
 * ========================================================================== */

describe('★ 收官走查漏网修复：3 代控制权族特效文字的英文帧（真产出函数 + 真文案表）', () => {
  it('英文：判定标题 / 结果 / 嫉妒0 文字标 / 暴怒0 文字标逐字等于 `EN[...]`，且零汉字', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      setLang('en');
      const s = makeState();
      domCard('g3-envy0', 100, 100);
      domCard('g3-foe3', 200, 100);

      // ① C4 判定：未满足（`wins = 0`）与获得（`gained = true`）两支各跑一次
      gen3ControlCheckFx({ player: 0, wins: 0, leading: [], gained: false }, s);
      expect(textOf('g3ctrl-caption'), '没有 g3ctrl-caption（判定标题没产出）').toBe(
        EN['gen3.control.check-caption'].replace('{who}', 'P1'));
      expect(textOf('g3ctrl-result'), '没有 g3ctrl-result（判定结果没产出）').toBe(
        EN['gen3.control.not-met'].replace('{wins}', '0'));
      removeLayers('g3ctrl-check-layer');
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0, 1], gained: true }, s);
      expect(textOf('g3ctrl-result'), '获得那一支的结果句不是英文表的取值').toBe(EN['gen3.control.gained']);

      // ② 嫉妒0：`借 N` 文字标（`placeEnvy0` 里写 `textContent`）
      syncEnvy0Absorb(s);
      expect(textOf('g3sync-envy0-borrow'), '没有 g3sync-envy0-borrow（嫉妒0 文字标没产出）').toBe(
        EN['gen3.control.borrow'].replace('{n}', '3'));

      // ③ 暴怒0：中缝上的文字标
      syncWrath0Cull(s);
      expect(textOf('g3sync-wrath0-chip'), '没有 g3sync-wrath0-chip（暴怒0 文字标没产出）').toBe(
        EN['gen3.control.wrath-cull']);

      // 判据 ②：这五处一个汉字都没有
      const shown = ['g3ctrl-caption', 'g3ctrl-result', 'g3sync-envy0-borrow', 'g3sync-wrath0-chip']
        .map((cls) => `${cls}=${String(textOf(cls))}`);
      for (const cls of ['g3ctrl-caption', 'g3ctrl-result', 'g3sync-envy0-borrow', 'g3sync-wrath0-chip']) {
        expect(CJK.test(textOf(cls) ?? ''), `${cls} 的英文帧里出现了汉字：${shown.join(' / ')}`).toBe(false);
      }
      // 反向锚点：这五条中英**不同值** ⇒ 上面那几条不是在"中英同值"上恒真
      for (const key of ['gen3.control.check-caption', 'gen3.control.gained', 'gen3.control.not-met', 'gen3.control.borrow', 'gen3.control.wrath-cull']) {
        expect(ZH[key], `${key} 的中英值相同 ⇒ 这条腿分辨不出"抽没抽"`).not.toBe(EN[key]);
      }
    } finally {
      restore();
    }
  });

  it('中文：同一批产出逐字等于改动前那一帧的原文（HEAD 锚点，硬写在上面）', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      setLang('zh');
      const s = makeState();
      domCard('g3-envy0', 100, 100);
      domCard('g3-foe3', 200, 100);

      gen3ControlCheckFx({ player: 0, wins: 0, leading: [], gained: false }, s);
      expect(textOf('g3ctrl-caption'), '中文判定标题与改动前逐字不一致').toBe(HEAD_CAPTION_P1);
      expect(textOf('g3ctrl-result'), '中文"未满足"那句与改动前逐字不一致').toBe(HEAD_NOT_MET_0);
      removeLayers('g3ctrl-check-layer');
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0, 1], gained: true }, s);
      expect(textOf('g3ctrl-result'), '中文"获得控制组件"与改动前逐字不一致').toBe(HEAD_GAINED);

      syncEnvy0Absorb(s);
      expect(textOf('g3sync-envy0-borrow'), '中文"借 N"与改动前逐字不一致').toBe(HEAD_BORROW_3);

      syncWrath0Cull(s);
      expect(textOf('g3sync-wrath0-chip'), '中文"最高档剔除"与改动前逐字不一致').toBe(HEAD_WRATH_CULL);

      // 反空集合：这一帧里的确**有**汉字（否则上面那五条在"产出为空"上也绿）
      expect(CJK.test(String(textOf('g3ctrl-caption'))), '中文帧里读不到汉字 ⇒ 判据面错了').toBe(true);
    } finally {
      restore();
    }
  });
});

/* ============================================================================
 * 腿 ③：源码腿（防"以后有人把某一处改回裸中文"）
 * ========================================================================== */

/** 代码位里的中文字符串/模板串字面量（口径与 `tests/i18n/unextracted-manifest.test.ts` 的 `cjkLiterals` 同款）。 */
function cjkLiterals(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let buf = '';
      i += 1;
      while (i < code.length) {
        const ch = code[i];
        if (ch === '\\') { buf += code[i + 1] ?? ''; i += 2; continue; }
        if (ch === quote) { i += 1; break; }
        buf += ch;
        i += 1;
      }
      if (CJK.test(buf)) out.push(buf);
      continue;
    }
    i += 1;
  }
  return [...new Set(out)];
}

describe('★ 收官走查漏网修复：`src/ui/gen3-control.ts` 的源码腿', () => {
  it('代码位里一个中文字面量都没有（注释不算），且 5 个键都以字面量出现在 `t(` 里', () => {
    const code = stripComments(controlTs);
    // 自证：剥注释之后文件仍然很长（否则下面"零汉字"是空文件上的恒真）
    expect(code.length, 'stripComments 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(20000);
    expect(
      cjkLiterals(code),
      `src/ui/gen3-control.ts 的代码位里还有中文字面量（这一族应当全部走 t('gen3.control.*')）：`,
    ).toEqual([]);
    for (const key of ['gen3.control.check-caption', 'gen3.control.gained', 'gen3.control.not-met', 'gen3.control.borrow', 'gen3.control.wrath-cull']) {
      expect(controlTs, `${key} 没有以字面量出现在源码里（键必须是字面量，动态键扫不出来）`)
        .toContain(`t('${key}'`);
      expect(ZH[key], `${key} 不在中文表里`).toBeTypeOf('string');
      expect(EN[key], `${key} 不在英文表里`).toBeTypeOf('string');
    }
    // 反向自证：同一个扫描器**能**扫到中文字面量（否则上面那条"零汉字"没有判据强度）
    expect(cjkLiterals("export const a = '中文';"), '扫描器对中文不敏感 ⇒ 上面那条恒真').toEqual(['中文']);
    // 每个键**恰好一处**调用点（多一处/少一处都说明这一族被改动了）；
    // ⚠️ "不许在模块顶层调 `t()`"另有全局腿（`tests/i18n/module-scope-t.test.ts`），
    //    这里不重复它 —— 那一条扫的是**所有**模块，比在本文件里再判一次强。
    for (const key of ['gen3.control.check-caption', 'gen3.control.gained', 'gen3.control.not-met', 'gen3.control.borrow', 'gen3.control.wrath-cull']) {
      expect(controlTs.split(`t('${key}'`).length - 1, `${key} 的调用点不是恰好一处`).toBe(1);
    }
  });
});
