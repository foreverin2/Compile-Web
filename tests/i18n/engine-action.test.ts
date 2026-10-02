/**
 * ★ 2026-10-02（P5）：选择条**动作按钮**的显示层本地化（生成式完整性腿 + 回退腿）。
 *
 * ## 被钉住的是什么
 *
 * `.choice-action-btn` 的文字来自 `src/core/log.ts` 的 `actionCn(act, defId)` —— 那是**引擎函数**
 * （红线，一个字未改），英文模式下它照样吐 `翻转` / `弃牌` / `重排玩家1的协议`。显示层的做法是
 * `src/i18n/engine-prompt.ts` 的 `engineActionText(act, lang)`：按**结构化 action id**
 * （`flip` / `face-down` / `num:{n}` / `重排玩家{who}的协议`…）出英文；
 *
 *  - **中文模式恒返回 `''`** ⇒ 调用点是 `engineActionButtonText(act) || actionCn(act, defId)`
 *    ⇒ 中文屏上那半个字都没变（构造上不可能回归）；
 *  - 英文模式**命中不了也返回 `''`** ⇒ 逐字回退 `actionCn()` 的原文（最差退化成今天的样子）。
 *
 * ## 腿（生成式）
 *
 *  ① 覆盖：把 `src/core/**` 里出现的每一个 `action:<id>` 字面量/模板从源码抽出来，逐条喂真函数
 *     —— 英文模式下必须命中（或有理由地登记"它其实不是按钮值"），否则点名文件:行报红；
 *  ② 反向：动作表里每一条都必须有 id 能命中它（先加条目后接引擎 ⇒ 红）；
 *  ③ 中文侧：所有 id 在中文模式下都必须返回 `''`（= 走 `actionCn()` 原文）；
 *  ④ 回退：未知 id 在两个语言下都返回 `''`，不抛（调用点于是拿到引擎原文）；
 *  ⑤ 表自身：键 ↔ 两张表、占位符一一对应、英文值零汉字、没有两个键共用同一个 id 模式。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_ACTION_KEYS, engineActionButtonText, setLang } from '../../src/i18n';
import { EN } from '../../src/i18n/en';
import { ZH } from '../../src/i18n/zh';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CORE = join(REPO, 'src', 'core');

afterEach(() => {
  setLang('zh');
});

/** 剥注释（保留换行，报错要点文件:行） */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      let nl = '';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') nl += '\n';
        i += 1;
      }
      i += 2;
      out += nl;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

interface RawAction {
  readonly rel: string;
  readonly line: number;
  /** 引擎的 action id（已去掉 `action:` 前缀；`${…}` 换成 `\u0000` 标记） */
  readonly id: string;
  /** 模板里的参数表达式（顺序与 `\u0000` 一致） */
  readonly exprs: readonly string[];
}

/**
 * 扫描口径：`src/core/**` 代码位里的 `'action:…'` 与 `` `action:…` `` 字面量（去注释、去重）。
 *
 * ⚠️ 这**不是**"按钮值的全集"的同义词 —— 它还会捞到解析用的前缀（`action:proto:`）。
 * 那一类在下面 `NOT_ACTION_IDS` 里逐条登记理由；新冒出一个"像 id 又不是 id"的串会报红。
 */
function collectRawActions(): RawAction[] {
  const out: RawAction[] = [];
  const seen = new Set<string>();
  for (const abs of walk(CORE)) {
    const rel = abs.slice(REPO.length).split('\\').join('/');
    const code = stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    const re = /(['"`])(action:[^'"`]*)\1/g;
    for (const m of code.matchAll(re)) {
      const raw = m[2];
      const exprs: string[] = [];
      const id = raw.slice('action:'.length).replace(/\$\{([^}]*)\}/g, (_all, e: string) => {
        exprs.push(e.trim());
        return '\u0000';
      });
      const k = `${id}|${exprs.join(',')}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ rel, line: code.slice(0, m.index ?? 0).split('\n').length, id, exprs });
    }
  }
  return out;
}

const NUMERIC_EXPR = /^[A-Za-z_$][\w$.]*(?:\s*[+-]\s*\d+)?$/;

/** 模板参数取样：数值型给 `3`；其它表达式 ⇒ `null`（腿① 单独点名报红） */
function samplesForExpr(expr: string): readonly string[] | null {
  return NUMERIC_EXPR.test(expr) ? ['3'] : null;
}

const RAW_ACTIONS = collectRawActions();
const UNKNOWN_EXPRS = RAW_ACTIONS.flatMap((a) => a.exprs.filter((e) => samplesForExpr(e) === null).map((e) => `${a.rel}:${a.line} 的 \${${e}}`));

interface IdSample {
  readonly id: string;
  readonly rel: string;
  readonly line: number;
}

const ID_SAMPLES: readonly IdSample[] = (() => {
  const seen = new Map<string, IdSample>();
  for (const a of RAW_ACTIONS) {
    let acc = [a.id];
    for (const expr of a.exprs) {
      const values = samplesForExpr(expr) ?? [];
      const next: string[] = [];
      for (const p of acc) for (const v of values) next.push(p.replace('\u0000', v));
      acc = next;
    }
    for (const id of acc) if (!seen.has(id)) seen.set(id, { id, rel: a.rel, line: a.line });
  }
  return [...seen.values()];
})();

/**
 * **不是按钮值**的 `action:…` 串（逐条写理由）。它们是解析前缀 / 文档形态，
 * 永远不会出现在 `prompt.actions` 里，所以没有英文条目 —— 但扫描面必须"看得见"它们。
 */
const NOT_ACTION_IDS: ReadonlyMap<string, string> = new Map<string, string>([
  ['proto:', '`luck.ts:125` 用它把 id 拆回协议名（`.replace(\'action:proto:\', \'\')`），是**解析前缀**不是按钮值；真正的按钮值是 `action:proto:<协议>`（由模板那条覆盖）。'],
]);

/* ══════════════════════ 腿 ══════════════════════ */

describe('★ P5：选择条动作按钮的显示层本地化（生成式）', () => {
  it('扫描面自检：真的从 src/core/** 抽到了 action id（否则下面每条腿都在空集上恒真）', () => {
    expect(ID_SAMPLES.length, '一个 action id 都没抽到').toBeGreaterThan(15);
    expect(ID_SAMPLES.some((s) => s.id === 'flip'), '没抽到 flip').toBe(true);
    expect(ID_SAMPLES.some((s) => s.id.startsWith('num:')), '没抽到 num:*').toBe(true);
    expect(ID_SAMPLES.some((s) => s.id.startsWith('重排玩家')), '没抽到 control-rearrange-flow 那几条中文 id').toBe(true);
  });

  it('参数来源全都认识（冒出一个新参数表达式 ⇒ 报红并点名文件:行）', () => {
    expect(UNKNOWN_EXPRS, `这些 action id 里的运行期参数没有取样口径：\n  ${UNKNOWN_EXPRS.join('\n  ')}`).toEqual([]);
  });

  it('★ 覆盖：每一个引擎 action id 在英文模式下都有英文（点名没命中的 id + 出处；有意保留的逐条登记）', () => {
    setLang('en');
    const uncovered: string[] = [];
    for (const s of ID_SAMPLES) {
      const out = engineActionButtonText(`action:${s.id}`);
      if (out === '') {
        if (!NOT_ACTION_IDS.has(s.id)) uncovered.push(`${s.rel}:${s.line} 「action:${s.id}」`);
        continue;
      }
      if (/[\u3400-\u9fff]/.test(out)) uncovered.push(`${s.rel}:${s.line} 「action:${s.id}」→「${out}」`);
    }
    expect(uncovered, `这些 action id 没有英文条目（英文界面下按钮仍是 actionCn() 的中文）：\n  ${uncovered.join('\n  ')}`).toEqual([]);
  });

  it('★ 反向：动作表里每一条都必须有引擎 id 能命中它（先加条目后接引擎 ⇒ 报红）', () => {
    setLang('en');
    const dead: string[] = [];
    for (const key of ENGINE_ACTION_KEYS) {
      const pattern = ZH[key] ?? '';
      const probe = pattern.replace(/\{layout\}/g, '1,0,2').replace(/\{n\}/g, '3').replace(/\{proto\}/g, 'fire').replace(/\{who\}/g, '1');
      if (engineActionButtonText(`action:${probe}`) === '') dead.push(`${key} 「${pattern}」`);
    }
    expect(dead, `这些键在两张表里，但没有任何 action id 能命中（引擎那边删了，或 id 模式写歪了）：\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('★ 反向：`NOT_ACTION_IDS` 里不许留"其实已经能命中"的陈旧条目（它只准变短）', () => {
    setLang('en');
    const stale = [...NOT_ACTION_IDS.keys()].filter((id) => engineActionButtonText(`action:${id}`) !== '');
    expect(stale, `这些串已经能命中了 ⇒ 从 NOT_ACTION_IDS 里删掉：${stale.join(', ')}`).toEqual([]);
    for (const [id, why] of NOT_ACTION_IDS) expect(why.trim().length, `登记条目「${id}」没有写理由`).toBeGreaterThan(0);
  });

  it('★ 中文侧不动：中文模式下所有 id 都返回 `\'\'`（= 走 `actionCn()` 的原文，构造上不可能回归）', () => {
    setLang('zh');
    const touched = ID_SAMPLES.filter((s) => engineActionButtonText(`action:${s.id}`) !== '');
    expect(touched.map((s) => `action:${s.id}`), '中文模式下动作文字被改写了').toEqual([]);
    // 非空模式串也一样：中文侧一个都不许出英文
    for (const key of ENGINE_ACTION_KEYS) {
      const pattern = ZH[key] ?? '';
      expect(engineActionButtonText(`action:${pattern}`), `中文模式下 ${key} 出了结果`).toBe('');
    }
  });

  it('★ 回退：未知 id 在两个语言下都返回 `\'\'`（调用点于是拿到 `actionCn()` 的原文），不抛', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      for (const id of ['', 'nope', 'num:', '重排玩家1的协议（未知后缀）']) {
        let out = 'x';
        expect(() => {
          out = engineActionButtonText(`action:${id}`);
        }, `喂未知 id「${id}」时抛了`).not.toThrow();
        expect(out, `未知 id「${id}」没有回退（${lang}）`).toBe('');
      }
    }
  });

  it('★ 人的读数锚点：几条最常见的逐字对得上（含中文 id 与带参数的两条）', () => {
    setLang('en');
    expect(engineActionButtonText('action:flip')).toBe('flip');
    expect(engineActionButtonText('action:face-down')).toBe('play face down');
    expect(engineActionButtonText('action:rearrange-swap')).toBe('keep swapping positions');
    expect(engineActionButtonText('action:num:3')).toBe('3');
    expect(engineActionButtonText('action:order:1,0,2')).toBe('layout 1,0,2');
    expect(engineActionButtonText('action:proto:fire')).toBe('fire');
    expect(engineActionButtonText('action:不重排，继续')).toBe('do not rearrange, continue');
    expect(engineActionButtonText('action:重排玩家1的协议')).toBe("rearrange player 1's protocols");
    expect(engineActionButtonText('action:重排玩家2的协议（已锁定）')).toBe("rearrange player 2's protocols (locked)");
    expect(engineActionButtonText('action:失去控制权')).toBe('give up control');
  });

  it('动作表自身：键与两张表逐条对应、占位符一一对应、英文值零汉字、没有两个键共用同一个 id', () => {
    expect(ENGINE_ACTION_KEYS.length, '动作表是空的').toBeGreaterThan(10);
    expect(new Set(ENGINE_ACTION_KEYS).size, '动作表里有重复键').toBe(ENGINE_ACTION_KEYS.length);
    const ph = (s: string): string[] => [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    const bad: string[] = [];
    for (const key of ENGINE_ACTION_KEYS) {
      const zh = ZH[key];
      const en = EN[key];
      if (zh === undefined || en === undefined || zh.trim() === '' || en.trim() === '') {
        bad.push(`${key}：两张表里缺值`);
        continue;
      }
      if (ph(zh).join(',') !== ph(en).join(',')) bad.push(`${key}：占位符不一致 zh(${ph(zh)}) en(${ph(en)})`);
      if (new Set(ph(zh)).size !== ph(zh).length) bad.push(`${key}：同一个 id 模式里有同名占位符`);
      if (/[\u3400-\u9fff]/.test(en)) bad.push(`${key}：英文值里有汉字「${en}」`);
    }
    expect(bad, `动作表自身的问题：\n  ${bad.join('\n  ')}`).toEqual([]);
    const stray = [...Object.keys(ZH), ...Object.keys(EN)].filter((k) => k.startsWith('engine.action.') && !ENGINE_ACTION_KEYS.includes(k));
    expect([...new Set(stray)], '这些 `engine.action.*` 键不在 `ENGINE_ACTION_KEYS` 里（永远读不到）').toEqual([]);
    const bodies = ENGINE_ACTION_KEYS.map((k) => ZH[k]);
    const dupBodies = [...new Set(bodies.filter((b, i) => bodies.indexOf(b) !== i))];
    expect(dupBodies, `这些 id 模式被两个键共用（后一条永远命中不到）：${dupBodies.join(' / ')}`).toEqual([]);
  });
});
