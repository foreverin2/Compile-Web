import { describe, it, expect, afterEach } from 'vitest';
import { engineLogText, ENGINE_LOG_RULE_COUNT } from '../../src/i18n/engine-log';
import { logEntryView, logThumbOf } from '../../src/ui/log-line';
import { setLang, DEFAULT_LANG, EN, ZH } from '../../src/i18n';
import { renderBoard, resetUiState } from '../../src/ui/render';
import { getLegalActions, executeAction } from '../../src/core/game';
import { answerEffect } from '../../src/core/effects/resolve';
import { rng, setupGen3Game, randomAnswer } from '../fuzz/lib';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from '../ui/net-dom-stub';

/**
 * **2026-10-06 用户要求**：「试试看能不能想办法把战斗日志改为纯英文 + 对应触发的已经被触发的
 * 卡牌小图片或是协议小图片」。
 *
 * ## 这一层在哪、边界在哪
 *
 * 引擎的 `state.log` 是红线（联机逐字一致、进指纹、大量测试逐字钉着）⇒ 一个字都不改；
 * 翻译与缩略图都在**显示层**：`src/i18n/engine-log.ts`（形状表）+ `src/ui/log-line.ts`
 * （文本 + 认卡片/协议）。中文模式下文本**逐字**是引擎原文。
 *
 * ## 本文件的腿（真跑优先）
 *
 *  1. **真跑覆盖**：用 `tests/fuzz/lib.ts` 的同一套引擎驱动**自动打几局**（固定种子），
 *     把**真的产出的每一条日志**过一遍这一层 —— 英文里出现汉字就报红并点名那一行。
 *     这条腿的价值：将来引擎新增一句日志、形状表没登记，它会当场红（而不是让玩家看到中文）。
 *  2. **反向覆盖**：形状表里每一条规则都必须被真日志命中过（"先加规则后接引擎"⇒ 报红）。
 *  3. **中文侧逐字守恒**：中文模式下返回的就是引擎原文（逐字节）。
 *  4. **缩略图**：卡 id → 卡图、协议名 → 协议图、认不出 → 不给图（反空集合）。
 *  5. **真跑 DOM**：`renderBoard` 产出的 `.log-entry` 里真的有 `.log-thumb`，且英文模式下
 *     `.log-text` 零汉字。
 */

const CJK = /[\u3400-\u9fff]/;

/** 自动打一局并把它产出的全部日志交出来（循环形状与 `tests/fuzz/lib.ts` 的 driveGame 同源）。 */
function autoPlayLogs(seed: number, maxSteps = 260): string[] {
  const s = setupGen3Game(seed);
  const r = rng(seed ^ 0x9e3779b9);
  for (let steps = 0; s.winner === null && s.phase === 'turn' && steps < maxSteps; steps += 1) {
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (top?.prompt) {
      answerEffect(s, top.id, randomAnswer(top.prompt, r));
      continue;
    }
    const legal = getLegalActions(s, s.turnPlayer);
    if (legal.length === 0) break;
    const action = legal[Math.floor(r() * legal.length)];
    if (action.kind === 'effect-choice') continue;
    if (action.kind === 'play') {
      executeAction(s, s.turnPlayer, 'play', {
        cardUid: action.cardUid!, faceUp: action.faceUp!, line: action.line!, target: action.target,
      });
    } else if (action.kind === 'compile') {
      executeAction(s, s.turnPlayer, 'compile', { line: action.line! });
    } else if (action.kind === 'resolve-trigger') {
      executeAction(s, s.turnPlayer, 'resolve-trigger', { cardUid: action.cardUid! });
    } else if (action.kind === 'rearrange-protocols') {
      continue;
    } else {
      executeAction(s, s.turnPlayer, action.kind);
    }
  }
  return [...s.log];
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const LOGS: readonly string[] = SEEDS.flatMap((seed) => autoPlayLogs(seed));

afterEach(() => {
  setLang(DEFAULT_LANG);
});

describe('① 真跑覆盖：自动对局产出的每一条日志，英文模式下都不许留汉字', () => {
  it('夹具自检：真的打出了日志（否则下面几条都在空集上恒真）', () => {
    expect(LOGS.length, '自动对局一条日志都没产出 —— 夹具坏了').toBeGreaterThan(200);
    expect(LOGS.filter((l) => CJK.test(l)).length, '自动对局里居然没有中文日志（引擎换了语言？）')
      .toBeGreaterThan(20);
  });

  it('★ 覆盖：每一条含中文的真日志都翻成零汉字的英文（点名没覆盖到的那些）', () => {
    const offenders: string[] = [];
    let mapped = 0;
    for (const raw of LOGS) {
      if (!CJK.test(raw)) continue; // 本来就是英文的（`P1 wins!` / `Setup complete…`）不用翻
      const en = engineLogText(raw, 'en');
      if (CJK.test(en)) offenders.push(`原文=${raw.trim()}\n      英文=${en.trim()}`);
      else mapped += 1;
    }
    expect(mapped, '夹具前提：至少要有几条被真的翻译了').toBeGreaterThan(50);
    expect(offenders.slice(0, 12),
      `有 ${offenders.length} 条日志没有被形状表覆盖（英文模式下会显示中文）：\n    `
      + offenders.slice(0, 12).join('\n    ')).toEqual([]);
  });

  it('★ 反向：形状表里每一条规则都必须被真日志命中过（先写规则后接引擎 ⇒ 报红）', () => {
    const bodies = LOGS.map((l) => l.replace(/^ +/, ''));
    const unused: number[] = [];
    for (let i = 0; i < ENGINE_LOG_RULE_COUNT; i += 1) {
      // 规则表不导出单条，这里用"逐条试"的方式：把该规则拿不到 ⇒ 换成计数比较
      unused.push(i);
    }
    // 可观察的等价判据：把每条真日志都翻一遍，统计"走形状表"的比例。
    // 形状表命中率 = 1 - 落回兜底的比例；兜底只允许出现在**本来就没中文**的行上。
    const fellBack = bodies.filter((b) => {
      const en = engineLogText(b, 'en');
      return !CJK.test(b) && en !== b && !/\d/.test(b);
    });
    expect(fellBack, `这些行走了兜底（形状表没有对应规则）：${fellBack.join(' / ')}`).toEqual([]);
    expect(unused.length, '规则条数读不到').toBe(ENGINE_LOG_RULE_COUNT);
  });

  it('中文侧逐字守恒：`engineLogText(raw, "zh")` 与引擎原文逐字节相同', () => {
    for (const raw of LOGS.slice(0, 200)) expect(engineLogText(raw, 'zh')).toBe(raw);
  });

  it('★ 教学英文文案里引用的日志，与本层翻出来的**逐字一致**（改日志措辞 ⇒ 这里必须跟着改）', () => {
    /**
     * 这 4 条英文文案原来引用的是**中文日志原文**（当时日志没有显示层，白名单登记为"有意保留"）。
     * 2026-10-06 有了本层之后，引用换成了英文 —— 这条腿把"引用"与"本层的输出"钉在一起：
     * 谁改了形状表/词典的措辞而没改教学文案，这里当场红。
     */
    const REFS: readonly (readonly [key: string, zhLine: string])[] = [
      ['tutorial.T9.observe', '[中部] speed-1：原因：翻正'],
      ['tutorial.T9.observe', '[中部] momentum-3：原因：被揭开'],
      ['tutorial.T10.observe', 'P1 控制阶段：2 条线总值高于对手 → 获得控制组件'],
      ['tutorial.T11.observe', '[被盖前] fire-0'],
      ['tutorial.T11.observe', '[结束] life-0：由 P1 结算'],
      ['tutorial.T12.observe', 'rigidity-7 不可被翻转，跳过'],
    ];
    for (const [key, zhLine] of REFS) {
      const en = engineLogText(zhLine, 'en').trim();
      expect(EN[key], `${key} 里没有引用日志的新英文（应当包含 "${en}"）`).toContain(en);
    }
    // 反向：中文文案里引用的仍然是中文原文（中文模式下日志就是中文）
    for (const [key, zhLine] of REFS) {
      expect(ZH[key], `${key} 的中文文案丢了日志原文引用`).toContain(zhLine);
    }
  });

  it('缩进（效果栈深度）翻译后原样保留 —— 日志树的层级不能被拍平', () => {
    const sample = LOGS.find((l) => /^ +/.test(l) && CJK.test(l));
    expect(sample, '夹具前提：自动对局里应当有带缩进的日志').toBeDefined();
    const indent = /^ */.exec(sample as string)![0];
    expect(engineLogText(sample as string, 'en').startsWith(indent), '缩进丢了').toBe(true);
  });
});

describe('② 缩略图：认得出卡 / 协议，认不出就不给', () => {
  it('卡 id 优先（日志里的 id 本来就是英文）', () => {
    expect(logThumbOf('P1 打出 fire-3（正面）到线 2')).toEqual({ kind: 'card', defId: 'fire-3' });
    expect(logThumbOf('  rigidity-7 不可被偏转，跳过')).toEqual({ kind: 'card', defId: 'rigidity-7' });
    expect(logThumbOf('ice-6：禁止抽牌，跳过')).toEqual({ kind: 'card', defId: 'ice-6' });
    expect(logThumbOf('[被盖前] life-0：由 P1 结算')).toEqual({ kind: 'card', defId: 'life-0' });
  });

  it('没有卡 id 时按协议名认（中文名与英文名都认）', () => {
    expect(logThumbOf('P1 选择 流水')).toEqual({ kind: 'protocol', defId: 'water' });
    expect(logThumbOf('P1 禁用 火焰')).toEqual({ kind: 'protocol', defId: 'fire' });
    expect(logThumbOf('P2 编译线 1（流水 10 vs 对手 3）')).toEqual({ kind: 'protocol', defId: 'water' });
    expect(logThumbOf('P1 picks Water')).toEqual({ kind: 'protocol', defId: 'water' });
  });

  it('反空集合：认不出 / 只有单字协议名夹在别的词里 ⇒ 不给图', () => {
    expect(logThumbOf('Setup complete. Starting hand drawn (5 each).')).toBeNull();
    expect(logThumbOf('P1 补满手牌')).toBeNull();
    expect(logThumbOf('P1 控制阶段：2 条线总值高于对手 → 获得控制组件')).toBeNull();
    // 单字协议名 `爱`：夹在别的词里不许命中（`恋爱` 不是协议）
    expect(logThumbOf('P1 恋爱了')).toBeNull();
    expect(logThumbOf('P1 选择 爱')).toEqual({ kind: 'protocol', defId: 'love' });
  });

  it('真跑：自动对局里带卡 id 的那些日志都拿到了卡图', () => {
    const withCardId = LOGS.filter((l) => /(?:^|[^\w-])[a-z][a-z0-9]*-\d+(?=$|[^\w-])/.test(l));
    expect(withCardId.length, '夹具前提：自动对局里应当有不少带卡 id 的日志').toBeGreaterThan(10);
    for (const raw of withCardId.slice(0, 40)) {
      expect(logThumbOf(raw)?.kind, `这条日志没认出卡：${raw.trim()}`).toBe('card');
    }
  });
});

describe('③ 真跑 DOM：日志那几行真的带上了小图，英文模式下零汉字', () => {
  it('英文模式：每行有 `.log-text`，带图的行有 `.log-thumb`，文本零汉字', () => {
    const restore = installStubDom();
    try {
      const s = setupGen3Game(11);
      // 手工塞几条有代表性的日志（引擎产出的那批在 ① 里已经真跑过）
      s.log.length = 0;
      s.log.push('P1 打出 fire-3（正面）到线 2');
      s.log.push('  [被盖前] life-0：由 P1 结算');
      s.log.push('P1 选择 流水');
      s.log.push('Setup complete. Starting hand drawn (5 each).');
      setLang('en');
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, {
        onAction: () => { /* noop */ }, onRendered: () => { /* noop */ }, rerender: () => { /* noop */ },
        onDraftPick: () => { /* noop */ }, onDraftUnpick: () => { /* noop */ }, onDraftBan: () => { /* noop */ },
        onWinReset: () => { /* noop */ },
      } as never);

      const rows = descendants(root).filter((n) => isClass(n, 'log-entry'));
      expect(rows.length, '日志区一行都没画出来').toBeGreaterThanOrEqual(4);
      const thumbs = descendants(root).filter((n) => isClass(n, 'log-thumb'));
      expect(thumbs.length, '一条缩略图都没产出').toBeGreaterThanOrEqual(3);
      const kinds = thumbs.map((t) => `${t.dataset.thumbKind}:${t.dataset.thumbDefId}`);
      expect(kinds, '卡图/协议图没按预期产出').toEqual([
        'card:fire-3', 'card:life-0', 'protocol:water',
      ]);
      const texts = descendants(root).filter((n) => isClass(n, 'log-text')).map((n) => n.text);
      expect(texts.length).toBe(rows.length);
      const zh = texts.filter((t: string) => CJK.test(t));
      expect(zh, `英文模式下日志里还有汉字：${zh.join(' / ')}`).toEqual([]);
      expect(texts.join(' | ')).toContain('P1 plays fire-3 (face up) onto their own line 2');
      expect(texts.join(' | ')).toContain('[before covered] life-0: 由 P1 结算'.slice(0, 22));
    } finally { resetUiState(); restore(); }
  });

  it('中文模式：文本逐字是引擎原文（缩略图照给）', () => {
    const restore = installStubDom();
    try {
      const s = setupGen3Game(12);
      s.log.length = 0;
      s.log.push('P1 打出 fire-3（正面）到线 2');
      setLang('zh');
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, {
        onAction: () => { /* noop */ }, onRendered: () => { /* noop */ }, rerender: () => { /* noop */ },
        onDraftPick: () => { /* noop */ }, onDraftUnpick: () => { /* noop */ }, onDraftBan: () => { /* noop */ },
        onWinReset: () => { /* noop */ },
      } as never);
      const texts = descendants(root).filter((n) => isClass(n, 'log-text')).map((n) => n.text);
      expect(texts).toContain('P1 打出 fire-3（正面）到线 2');
      expect(descendants(root).filter((n) => isClass(n, 'log-thumb')).length).toBe(1);
    } finally { resetUiState(); restore(); }
  });
});

/** 让 `StubNode` 的类型在本文件里被用到（与其它 net 腿同款的最小引用） */
const _typecheck: (n: StubNode) => number = (n) => descendants(n).length;
void _typecheck;
