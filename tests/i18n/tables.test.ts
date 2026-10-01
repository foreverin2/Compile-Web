import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../ui/source-text';
import { EN } from '../../src/i18n/en';
import { ZH } from '../../src/i18n/zh';
import { DEFAULT_LANG, LANGS, isLang } from '../../src/i18n/lang';
import {
  diffTables,
  getLang,
  initI18n,
  missingKeys,
  onLangChange,
  resetMissingKeysForTest,
  setLang,
  t,
} from '../../src/i18n';
// ★ P0：语言值落盘走的是**既有的 L1 设置对象**（与昵称同一份存储、同一套守卫）——
//   下面那一组直接用真的 `createLocalStore` + 内存 KV 真跑一遍。
import {
  createLocalStore,
  clearAllLocalData as clearLocalData,
  readLang,
  readNickName,
  writeLang,
  writeNickName,
} from '../../src/app/local-store';
import { L1_SETTINGS, createMemoryStore, readJson, type KeyValueStore } from '../../src/app/storage';

/**
 * 缺键时的 `console.warn` 是**刻意**的（开发态线索），所以本文件里那些"故意缺键"的用例
 * 不该把警告刷到门禁输出里。`console.warn` 只在 i18n 里出现一次、且只由缺键触发，
 * 因此这里按消息前缀过滤是安全的（不是"把整类输出静音"那种掩盖）。
 */
const REAL_WARN = console.warn.bind(console);
console.warn = (...args: unknown[]): void => {
  if (typeof args[0] === 'string' && args[0].includes('[i18n] 缺文案键')) return;
  REAL_WARN(...args);
};

/**
 * ★ 2026-10-01（P0）：i18n 基建的**两条"以后能验"的腿**。
 *
 * 用户 2026-10-01 拍板"UI 全量双语"（方案 `docs/2026-10-01-新手引导与教学-方案.md` §6.5），
 * 逐屏抽取（P3）会持续几十轮。这两条腿是**唯一能防"漏翻"的机械保障**：
 *
 *  1. **表完整性**：`zh` 与 `en` 的键集合完全一致、值都非空、同一张表里没有重复键；
 *  2. **缺键扫描**（生成式，不是手写清单）：扫 `src/**` 里所有 `t('…')` 调用，
 *     **每个键都必须在两张表里存在**；反向也查一遍 —— 表里没有"谁也读不到"的死键。
 *
 * ## 这一组还钉住什么（P0 的另外两条硬要求）
 *
 *  - **默认中文 + 中文值与现状逐字一致**：既有那几十条逐字钉住中文按钮的测试**零改动**的前提。
 *    做法是拿 `zh` 表里的值反过来与 `tests/` 里的既有断言面比对（见"逐字一致"那一组）——
 *    这一组**不 import 任何 UI 模块**，跑得快，且与屏的实现解耦。
 *  - **缺键回退中文 / 回退可见 / 开发态报一次 / 生产态不炸**。
 *
 * ## 不能证明什么（如实声明）
 *
 *  - 不能证明英文翻得**好**（那是人读的事）；
 *  - 不能证明"屏上真的没有裸中文字面量"—— 那要等 P3 逐屏抽取之后才有意义，
 *    现在的清单在 `docs/2026-10-01-i18n-尚未抽取的屏.md`（只准变短，不准变长）；
 *  - 缺键扫描只认**静态**第一实参（`t('a.b')` / `` t(`a.b`) ``）。变量或模板插值
 *    （`t(\`settings.${x}\`)`）会被下面那条"不许有动态键"的腿当场报红 —— 那是**收紧**方向。
 */

/* ───────────────────── 源码扫描面（生成式：从磁盘派生） ───────────────────── */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(REPO, 'src');

/** 递归收集 `.ts`（不含 `.d.ts`）。跳过 node_modules —— `src` 下本来就没有，防的是将来放进来。 */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules') continue;
      walkTs(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const SRC_FILES = walkTs(SRC).sort();

interface SourceFile {
  /** 仓库相对路径（正斜杠），报错里人读 */
  readonly rel: string;
  /** **剥掉注释之后**的代码位 */
  readonly code: string;
  /** 原始文本（`?raw` 那份自检要用） */
  readonly raw: string;
}

const SOURCES: readonly SourceFile[] = SRC_FILES.map((abs) => {
  // ⚠️ `readFileSync` 的第二实参（`'utf8'`）与 `test/node-types.d.ts` 的窄声明合不来
  //    （那份声明是 `readFileSync(path: string)`，返回一个只有 `subarray` 的 Buffer 形状）
  //    ⇒ 这里按该文件既有的用法走：读 Buffer、再 `toString('utf8')`。
  const raw = readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8');
  return {
    rel: abs.slice(REPO.length).split('\\').join('/'),
    code: stripComments(raw),
    raw,
  };
});

/**
 * `t(…)` 的**第一实参原文**（从 `t(` 起按括号配平扫到这一层的 `,` 或 `)`）。
 *
 * 为什么要按括号配平而不是写一个正则：`t('a.b', pick(1, 2))` 与
 * `t(on ? 'a' : 'b')` 这两种形态用正则都会切错，而"缺键扫描"最怕的就是**静默切错**
 * （切错 = 那个键从判据面里消失 = 漏翻不再报红）。
 */
function tArgTexts(code: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== 't' || code[i + 1] !== '(') continue;
    // 前面必须是"非标识符字符"（否则 `split(` / `.at(` 会被误当 `t(`）
    const prev = i === 0 ? '' : code[i - 1];
    if (/[A-Za-z0-9_$.]/.test(prev)) continue;
    let depth = 0;
    let j = i + 1;
    let buf = '';
    for (; j < code.length; j += 1) {
      const c = code[j];
      // ① 字面量：整段照抄（里面的括号/逗号都不算数）
      if (c === "'" || c === '"' || c === '`') {
        const q = c;
        buf += c;
        j += 1;
        for (; j < code.length; j += 1) {
          if (code[j] === '\\') {
            buf += code[j];
            j += 1;
            if (j < code.length) buf += code[j];
            continue;
          }
          buf += code[j];
          if (code[j] === q) break;
        }
        continue;
      }
      if (c === '(') { depth += 1; if (depth > 1) buf += c; continue; }
      if (c === ')') {
        depth -= 1;
        if (depth === 0) break; // 参数表结束：`)` 本身不进 `buf`
        buf += c;
        continue;
      }
      if (c === ',' && depth === 1) break; // 第一实参结束
      buf += c;
    }
    out.push(buf.trim());
  }
  return out;
}

/** 静态取键的调用（第一实参就是一段静态字面量） */
function staticTKeys(code: string): string[] {
  const out: string[] = [];
  for (const arg of tArgTexts(code)) {
    const m = /^(?:'([^'\\$]*)'|"([^"\\$]*)"|`([^`\\$]*)`)$/.exec(arg);
    if (m !== null) out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/**
 * **动态**第一实参（变量 / 三元 / 拼接 / 模板插值）：这些调用里的键扫不出来 ⇒ 一条都不许有。
 *
 * ⚠️ 这是**收紧**方向的判据，遇到它就是改代码（把键写成字面量），不是放宽这条腿。
 */
function dynamicTCalls(code: string): string[] {
  return tArgTexts(code).filter(
    (arg) => !/^(?:'([^'\\$]*)'|"([^"\\$]*)"|`([^`\\$]*)`)$/.test(arg),
  );
}

/**
 * 代码位里出现的**键名字符串字面量**（`'settings.…'`，含 `src/ui/fx-settings.ts` 那种
 * "把键存在表里、由 `t(def.label)` 取"的形态）。
 *
 * 为什么"合法键字面量"与"`t()` 调用"要分开收（这是本文件里最容易写歪的一处）：
 *  - `t('a.b')` 是**调用**（键一定在表里）；
 *  - `'settings.fx.metal6.label'` 写在 `FX_SETTINGS` 里、再由 `t(def.label)` 取，是**声明**。
 * 两种形态都要算"这个键有人在用"，否则"反向：表里没有死键"那条腿会在真实代码上假红。
 * 但**动态调用**（`t(def.label)`）本身仍然由上面那条腿报红 —— 扫描面宁可窄一点、响一点。
 */
function keyLiterals(code: string): string[] {
  return [...code.matchAll(/['"`]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)].map((m) => m[1]);
}

/**
 * 被扫的文件：**全部 `src/**\/*.ts` 减去 i18n 自己那一层**。
 *
 * 为什么要减：`src/i18n/index.ts` 里也有 `t(` 的**定义与注释**（`t()` 本身、`t('settings…')`
 * 的文档例子），而 `zh.ts` / `en.ts` 里的键是**表**不是调用。把这一层排除在外，
 * 判据面就只剩"消费者真的在要哪些键"—— 那正是漏翻会发生的地方。
 * 排除面写成**目录前缀**（不是逐个文件名）：将来 i18n 多一个文件也不用改这里。
 */
const I18N_PREFIX = 'src/i18n/';
const CONSUMERS = SOURCES.filter((f) => !f.rel.startsWith(I18N_PREFIX));

/** 真树上被 `t()` 静态要过的键（**生成式**） */
function usedKeys(sources: readonly SourceFile[]): string[] {
  return [...new Set(sources.flatMap((f) => staticTKeys(f.code)))].sort();
}

/**
 * 真树上"**有人在用**"的键：`t('键')` 的静态调用 **加上** 代码位里出现的键名字面量
 * （后者覆盖 `src/ui/fx-settings.ts` 那种"键存在表里、由 `t(def.label)` 取"的形态）。
 * 只有"两条路都不沾"的键才算死键。
 */
function referencedKeys(sources: readonly SourceFile[]): string[] {
  const all = sources.flatMap((f) => [...staticTKeys(f.code), ...keyLiterals(f.code)]);
  return [...new Set(all)].sort();
}

const USED = usedKeys(CONSUMERS);
const REFERENCED = referencedKeys(CONSUMERS);

/* ───────────────────────────────── 夹具 ───────────────────────────────── */

beforeEach(() => {
  // 语言是**模块级内存态**（与 `fx-settings` 的金属6 开关同一形态）⇒ 每个用例前后都要复位，
  // 否则一个用例切到 en 会污染同进程里别的用例（vitest 各**文件**独立，同文件内不隔离）。
  setLang(DEFAULT_LANG);
  resetMissingKeysForTest();
});

afterEach(() => {
  setLang(DEFAULT_LANG);
  vi.restoreAllMocks();
});

/* ============================================================================
 * 1. 表完整性（腿①）
 * ========================================================================== */

describe('表完整性：两张表的键集合完全一致、值非空、无重复键', () => {
  it('锚点：两张表都非空（否则下面每条判据都在空集合上恒真）', () => {
    expect(Object.keys(ZH).length, '中文表是空的 ⇒ 判据塌了').toBeGreaterThan(5);
    expect(Object.keys(EN).length, '英文表是空的 ⇒ 判据塌了').toBeGreaterThan(5);
  });

  it('键集合完全一致：`en` 不多一条、`zh` 不漏一条', () => {
    const d = diffTables();
    expect(d.onlyInEn, '英文表里多出来的键（中文玩家会看到 ⟪键名⟫）').toEqual([]);
    expect(d.onlyInZh, '漏翻的键（英文玩家会看到中文或 ⟪键名⟫）').toEqual([]);
  });

  it('值都非空（只由空白组成的值也算空）', () => {
    expect(diffTables().empties, '有值为空/全空白 —— 屏上会变成一片空白').toEqual([]);
  });

  it('同一张表里没有重复键（后写的会静默覆盖先写的 ⇒ 改了却不生效）', () => {
    // ⚠️ 这条在 `zh.ts` / `en.ts` 当前写法下**由 `tsc` 先拦下**
    //    （TS1117：对象字面量里不许有重名属性）。这里保留它是因为：
    //    ① `diffTables` 数的是**源码文本**，能覆盖"键写在两处对象里"这种 tsc 挡不住的形态；
    //    ② 它把"不许重复"这件事的**理由**写在门禁里，而不是只留在类型系统里。
    expect(diffTables().duplicates, '同一张表里同一个键出现了两次').toEqual([]);
  });

  it('`diffTables()` 的判据是活的：两张表真的被读到了（源文本自检）', () => {
    const zhSrc = SOURCES.find((f) => f.rel === 'src/i18n/zh.ts');
    const enSrc = SOURCES.find((f) => f.rel === 'src/i18n/en.ts');
    expect(zhSrc, '扫描面里没有 zh.ts').toBeDefined();
    expect(enSrc, '扫描面里没有 en.ts').toBeDefined();
    // 两个文件的源码文本里键的个数必须与对象一致（证明 `?raw` 拿到的是同一份内容）
    for (const [f, obj] of [[zhSrc, ZH], [enSrc, EN]] as const) {
      const fromText = [...(f?.raw ?? '').matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]);
      expect(new Set(fromText).size, `${f?.rel} 的源码键数与对象键数不一致`).toBe(Object.keys(obj).length);
    }
  });
});

/* ============================================================================
 * 2. 缺键扫描（腿②）
 * ========================================================================== */

describe('缺键扫描（生成式）：`src/**` 里每个 `t(…)` 的键都必须在两张表里', () => {
  it('扫描面自检：真的扫到了消费者与调用点（否则下面每条判据在空集上恒真）', () => {
    expect(SOURCES.length, 'src 下一个 .ts 都没读到 ⇒ 路径写错').toBeGreaterThan(50);
    expect(CONSUMERS.length, '扣除 i18n 那一层之后一个文件都不剩').toBeGreaterThan(50);
    expect(CONSUMERS.some((f) => f.rel === 'src/ui/home.ts'), 'home.ts 不在扫描面里').toBe(true);
    expect(USED.length, '全仓一个 `t()` 调用都没有 ⇒ 这条腿没在防任何东西').toBeGreaterThan(5);
  });

  it('每个被调用的键都在 `zh` 与 `en` 里（少一条就报红，键名逐个点出来）', () => {
    const missingInZh = USED.filter((k) => ZH[k] === undefined);
    const missingInEn = USED.filter((k) => EN[k] === undefined);
    expect(missingInZh, `这些键被 t() 调用但 zh.ts 里没有：${missingInZh.join(', ')}`).toEqual([]);
    expect(missingInEn, `这些键被 t() 调用但 en.ts 里没有：${missingInEn.join(', ')}`).toEqual([]);
  });

  it('反向：表里没有"谁也读不到"的死键（每条键都至少被一个消费者提到）', () => {
    // 单向判据（只查"缺键"）会让表可以无限长草：抽完一屏之后把屏上的调用删掉、键留着 ——
    // 没人报红，而下一个改文案的人会在两张表之间选错一处。这一条把"键必须有人用"也钉住。
    // ⚠️ 它的代价是真的会挡下"先加键、后接屏"的写法：那就**先接屏再加键**，或者把键先删掉。
    // ⚠️ 判据面是 `REFERENCED`（静态调用 **或** 键名字面量）而不是 `USED`：注册表形态
    //    （`FX_SETTINGS` 里存键、由 `t(def.label)` 取）是合法的，但它**必须在某个文件里
    //    以字面量出现**过一次 —— 那条边界正好挡住"键写进表里却谁也没接"。
    const unused = Object.keys(ZH).filter((k) => !REFERENCED.includes(k)).sort();
    expect(unused, `这些键在两张表里但 src/** 里没有任何地方提到它：${unused.join(', ')}`).toEqual([]);
  });

  it('不许有动态键（`t(variable)` / 模板插值）：那类调用扫不出来，等于漏翻的温床', () => {
    const bad = CONSUMERS.flatMap((f) => dynamicTCalls(f.code).map((s) => `${f.rel}：t(${s})`));
    expect(bad, '出现了无法静态提取的 t() 调用').toEqual([]);
  });

  it('判据自证（正控）：合成一份"调了表里没有的键"的源码 ⇒ 必须报红', () => {
    const synth: SourceFile = {
      rel: 'src/ui/synth-i18n.ts',
      code: stripComments('export const A = t(\'settings.title\');\nexport const B = t(\'nope.missing\');\n'),
      raw: '',
    };
    const keys = usedKeys([synth]);
    expect(keys, '正控构造失败：扫描器没扫到那两个键').toEqual(['nope.missing', 'settings.title']);
    expect(keys.filter((k) => ZH[k] === undefined), '表里没有的键没被判为缺键').toEqual(['nope.missing']);
  });

  it('判据自证（反控）：只调存在的键 ⇒ 零缺键；动态键必须被抓出来', () => {
    const okSynth: SourceFile = {
      rel: 'src/ui/synth-i18n.ts',
      code: stripComments("export const A = t('settings.title', { x: 'y' });\nexport const B = t(`settings.close`);\n"),
      raw: '',
    };
    expect(usedKeys([okSynth])).toEqual(['settings.close', 'settings.title']);
    expect(usedKeys([okSynth]).filter((k) => ZH[k] === undefined)).toEqual([]);

    const dynSynth: SourceFile = {
      rel: 'src/ui/synth-i18n.ts',
      code: stripComments('const k = pick();\nexport const A = t(k);\n'),
      raw: '',
    };
    expect(dynamicTCalls(dynSynth.code).length, '变量实参没被抓出来').toBeGreaterThan(0);
  });
});

/* ============================================================================
 * 3. `t()` 的行为：回退链、占位替换、缺键在两种环境下的表现
 * ========================================================================== */

describe('`t()`：当前语言 → 中文 → 可见回退', () => {
  it('默认语言是中文，且中文值与 `zh.ts` 逐字相同', () => {
    expect(DEFAULT_LANG).toBe('zh');
    expect(getLang()).toBe('zh');
    for (const k of Object.keys(ZH)) expect(t(k), `键 ${k} 的取值与表不一致`).toBe(ZH[k]);
  });

  it('切到 en 之后取的是英文值；切回 zh 又是中文（同一个键，两个值）', () => {
    setLang('en');
    expect(t('settings.title')).toBe(EN['settings.title']);
    expect(t('settings.title')).not.toBe(ZH['settings.title']);
    setLang('zh');
    expect(t('settings.title')).toBe(ZH['settings.title']);
  });

  it('占位替换：`{name}` 换成实参；缺的参数保留占位原文（不静默变空串）', () => {
    setLang('zh');
    expect(t('settings.fx.state', { desc: '说明', state: '开启' })).toBe('说明（当前：开启）');
    // 缺 state ⇒ 占位原文留在屏上（比"说明（当前：）"好查）
    expect(t('settings.fx.state', { desc: '说明' })).toBe('说明（当前：{state}）');
    // 值里带 `$&` 之类**不会被当成替换模式**（回调形态的 replace）
    expect(t('settings.fx.state', { desc: '$&x', state: '$1' })).toBe('$&x（当前：$1）');
  });

  it('缺键回退中文：`en` 里没有、`zh` 里有 ⇒ 回中文值（不是 ⟪键名⟫）', () => {
    // 回退链只有两级（当前语言 → 中文）。真树上两张表的键集**必须**完全一致，所以这里
    // 用"把 `en` 表临时换掉一个键"的形态构造**只此一次**的场景：模拟"有人往 zh 加了键、
    // 忘了加 en"的那一刻 —— 那时 `en` 下必须回中文，而不是 ⟪settings.title⟫。
    setLang('en');
    const real = EN['settings.title'];
    // 直接改 `EN` 是不行的（它按契约是只读），所以这里改的是 i18n 内部那张 `TABLES.en` 的
    // **同一个对象引用**：本用例结束前必须还原（否则污染同文件后面的用例）。
    const mutable = EN as unknown as Record<string, string>;
    delete mutable['settings.title'];
    try {
      expect(t('settings.title'), 'en 缺键时没有回退到中文值').toBe(ZH['settings.title']);
      expect(t('settings.title'), '回退成了 ⟪键名⟫（那是"两表都缺"的形态）').not.toContain('⟪');
    } finally {
      mutable['settings.title'] = real;
    }
    // 还原之后又走英文（证明上面那条不是"en 一直是坏的"）
    expect(t('settings.title')).toBe(real);
  });

  it('缺键回退到中文时**不**记进 `missingKeys()`（中文有值就不算缺）', () => {
    resetMissingKeysForTest();
    setLang('en');
    const real = EN['settings.close'];
    const mutable = EN as unknown as Record<string, string>;
    delete mutable['settings.close'];
    try {
      expect(t('settings.close')).toBe(ZH['settings.close']);
      expect(missingKeys(), '有中文兜底却被记成缺键（会让开发态刷无意义的警告）').not.toContain('settings.close');
    } finally {
      mutable['settings.close'] = real;
    }
  });

  it('两个表都没有的键：回值可见（`⟪键名⟫`）、不抛、不空串，并且被记进 `missingKeys()`', () => {
    resetMissingKeysForTest();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => { /* 静音 */ });
    const out = t('nope.nope');
    expect(out, '缺键回出来的东西看不见（空串/undefined）').toBe('⟪nope.nope⟫');
    expect(out.length).toBeGreaterThan(0);
    expect(missingKeys(), '缺键没被记下来').toContain('nope.nope');
    // 开发态（vitest 下 `import.meta.env.DEV === true`）必须报一次
    expect(spy, '开发态没有给出任何可见线索').toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0] ?? '')).toContain('nope.nope');
  });

  it('同一个缺键只报一次（不刷屏），但每条缺键都留在 `missingKeys()` 里', () => {
    resetMissingKeysForTest();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => { /* 静音 */ });
    t('nope.a');
    t('nope.a');
    t('nope.b');
    expect(spy.mock.calls.length, '同一个键被报了两次').toBe(2);
    expect(missingKeys()).toEqual(['nope.a', 'nope.b']);
  });

  it('生产态不炸：把 dev 标记拿掉之后仍然回可见值、不再往控制台报（**这条腿钉的是"不崩"**）', async () => {
    // ⚠️ 做法：`import.meta.env` 在模块里被读一次，没法在每个用例里改。
    //    这里退一步钉住**契约**：`t()` 对未知键的三条承诺（不抛 / 非空 / 记下来）——
    //    `warn` 是否真的被跳过由上面那条实证（开发态确实报），生产态的分支只有一个
    //    `if (!isDev()) return;`，它不做任何别的事（源码上可读、且不抛）。
    resetMissingKeysForTest();
    let out = '';
    expect(() => { out = t('nope.prod'); }, '缺键把整个渲染炸了（生产态白屏）').not.toThrow();
    expect(out).toBe('⟪nope.prod⟫');
    expect(missingKeys()).toContain('nope.prod');
  });

  it('订阅：`setLang` 之后订阅者拿到新语言（且 `getLang()` 已经是新值）', () => {
    const seen: string[] = [];
    const off = onLangChange((l) => { seen.push(`${l}/${getLang()}`); });
    setLang('en');
    setLang('zh');
    setLang('zh'); // 同值 ⇒ 空操作，不该再通知
    off();
    setLang('en');
    expect(seen).toEqual(['en/en', 'zh/zh']);
    // 退订之后不再收到
    expect(seen.length).toBe(2);
  });

  it('订阅者自己抛错不连累别人、也不把 `setLang` 打炸', () => {
    const seen: string[] = [];
    const off1 = onLangChange(() => { throw new Error('订阅者炸了'); });
    const off2 = onLangChange((l) => { seen.push(l); });
    expect(() => setLang('en'), '订阅者的异常把切语言打炸了').not.toThrow();
    expect(getLang()).toBe('en');
    expect(seen, '前一个订阅者抛错之后后面的订阅者没被通知').toEqual(['en']);
    off1(); off2();
  });
});

/* ============================================================================
 * 4. 启动：读一次已存的语言（`initI18n` 的四种输入）
 * ========================================================================== */

describe('`initI18n`：启动时读一次已存语言', () => {
  it('读出合法值 ⇒ 用它；读出坏值/什么都没读出来 ⇒ 用默认中文（不抛）', () => {
    expect(initI18n(() => 'en')).toBe('en');
    expect(getLang()).toBe('en');
    expect(initI18n(() => 'zh')).toBe('zh');
    for (const bad of [undefined, null, 42, '', 'xx', {}, [], true]) {
      expect(initI18n(() => bad), `坏值 ${JSON.stringify(bad)} 没被归一成默认语言`).toBe(DEFAULT_LANG);
      expect(getLang()).toBe(DEFAULT_LANG);
    }
  });

  it('读取本身抛错（存储不可用）⇒ 回默认中文，不抛（缺一个语言偏好不该让游戏打不开）', () => {
    expect(() => initI18n(() => { throw new Error('存储不可用'); })).not.toThrow();
    expect(getLang()).toBe(DEFAULT_LANG);
  });

  it('`initI18n` **只读不写**（它拿到的就是"读一次"这件事本身）', () => {
    let calls = 0;
    initI18n(() => { calls += 1; return 'en'; });
    expect(calls, 'initI18n 调了不止一次读取').toBe(1);
  });

  it('`isLang` / `LANGS`：形状守卫与清单的唯一出处', () => {
    for (const l of LANGS) expect(isLang(l.id), `LANGS 里的 id ${l.id} 过不了 isLang`).toBe(true);
    expect(LANGS.map((l) => l.id)).toEqual(['zh', 'en']);
    for (const bad of ['', 'EN', 'zh-CN', 0, null, undefined]) expect(isLang(bad)).toBe(false);
  });
});

/* ============================================================================
 * 5. ★ P0 的硬要求：中文值与改动前的字面量**逐字一致**
 * ========================================================================== */

describe('★ P0 硬要求：中文值与改动前的字面量逐字一致（既有测试零改动）', () => {
  it('设置小窗那几条：值与 `home.ts` 改动前的字面量逐字相同', () => {
    // 这些是**改动前** `src/ui/home.ts` / `src/ui/fx-settings.ts` 里的原文（P0 的验收判据）。
    // 它们同时出现在既有测试的断言里（`tests/ui/local-data-screen.test.ts` 第 9 组逐字钉住
    // `关闭` 与 `改动只在本次会话有效，刷新后回到默认开启。`）—— 所以这里写的是**冻结值**，
    // 不是"从实现里抄一遍"。
    const FROZEN: Readonly<Record<string, string>> = {
      'settings.title': '设置',
      'settings.close': '关闭',
      'settings.aria': '设置',
      'settings.hint': '改动只在本次会话有效，刷新后回到默认开启。',
      'settings.fx.on': '开启',
      'settings.fx.off': '关闭',
      'settings.fx.state': '{desc}（当前：{state}）',
      'settings.fx.metal6.label': '金属6 频闪特效',
      'settings.fx.metal6.desc': '手牌里的金属6 牌面会循环渐现一张图。关掉之后不再显示，其它卡牌的特效不受影响。',
    };
    for (const [k, v] of Object.entries(FROZEN)) {
      expect(ZH[k], `键 ${k} 的中文值与改动前不一致（P0 不许动既有中文文案）`).toBe(v);
    }
  });

  it('既有测试里逐字钉住的那两句，在 `zh` 表里就是那个形态', () => {
    // 直接把**既有断言面**里的字面量拿出来比对（不 import 那个测试文件，避免它变成夹具）
    const localDataTest = readFileSync(
      fileURLToPath(new URL('../ui/local-data-screen.test.ts', import.meta.url)),
    ).subarray(0, 4 * 1024 * 1024).toString('utf8');
    // 断言面里那句 `toBe('关闭')` 与 `（当前：关闭）` 的后缀
    expect(localDataTest, '既有测试不再钉「关闭」了？那这条腿的前提消失了').toContain("expect(closeBtn.text, '右上角那个按钮的文案不是「关闭」').toBe('关闭')");
    expect(ZH['settings.close']).toBe('关闭');
    expect(t('settings.fx.state', { desc: '说明', state: ZH['settings.fx.off'] })).toBe('说明（当前：关闭）');
    expect(localDataTest).toContain("expect(note.text, '说明没跟着改（\"当前：关闭\"应就地写上去，而不是重画整屏）')");
  });

  it('卡牌文本**不在这张表里**：`zh` / `en` 的值与 `src/data/cards*.ts` 的字段零交集', () => {
    // 用户口径（方案 §6.5 第 2 条）：卡文是**数据**，被 `npm run texts:check` 与联机卡文哈希
    // 逐字钉住。这里用"数据里的长中文句子不许出现在表里"这条可机检的形态钉住它 ——
    // 句子（含中文且长度 > 12）级别的交集，比"有没有 import cards"强得多。
    const dataFiles = SOURCES.filter((f) => /^src\/data\/cards\d*\.ts$/.test(f.rel) || f.rel === 'src/data/demo.ts');
    expect(dataFiles.length, '没扫到任何卡文数据文件 ⇒ 这条腿是空的').toBeGreaterThan(1);
    const zhValues = new Set(Object.values(ZH));
    const enValues = new Set(Object.values(EN));
    const hits: string[] = [];
    for (const f of dataFiles) {
      for (const m of f.raw.matchAll(/'([^'\\]{12,})'/g)) {
        const s = m[1];
        if (!/[\u3400-\u9fff]/.test(s)) continue;
        if (zhValues.has(s) || enValues.has(s)) hits.push(`${f.rel}：「${s}」`);
      }
    }
    expect(hits, '卡牌文本出现在了 i18n 文案表里（卡文是数据，不许进表）').toEqual([]);
  });
});

/* ============================================================================
 * 6. ★ P0：语言的存储口径（与昵称**同一份存储、同一套守卫**）
 * ========================================================================== */

/** 记账假 KV（红线 3 的"零写入"判据：set + remove 次数） */
interface SpyStore extends KeyValueStore {
  readonly writes: string[][];
  readonly removals: string[];
  mutations(): number;
}
function spyStore(): SpyStore {
  const m = createMemoryStore();
  const writes: string[][] = [];
  const removals: string[] = [];
  return {
    get: (k) => m.get(k),
    set: (k, v) => { writes.push([k, v]); m.set(k, v); },
    remove: (k) => { removals.push(k); m.remove(k); },
    keys: () => m.keys(),
    writes,
    removals,
    mutations: () => writes.length + removals.length,
  };
}
/** 只有一个键的 `set` 会抛的假 KV（模拟配额满 / 隐私模式） */
function setThrowsFor(key: string): KeyValueStore {
  const m = createMemoryStore();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { if (k === key) throw new Error(`写入被拒（${k}）`); m.set(k, v); },
    remove: (k) => { m.remove(k); },
    keys: () => m.keys(),
  };
}

describe('★ P0：语言的存储口径（L1 设置对象里的一个字段，不是一个新键）', () => {
  it('语言与昵称**同住 `compile-settings` 那一个键**里（不新增存储键）', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(writeNickName(s, '甲')).toBe(true);
    expect(writeLang(s, 'en')).toBe(true);
    // 存储里**恰好**两个键：授权的标记（`grant()` 写的）+ 设置那一个。语言没有自己的键。
    expect(s.kv().keys().sort(), '语言写出了一个新键（用户口径是"塞进既有 L1 设置对象"）')
      .toEqual(['compile-consent', L1_SETTINGS].sort());
    expect(readJson<Record<string, unknown>>(kv, L1_SETTINGS, {}), '两个字段必须同时留在同一份设置里')
      .toEqual({ nick: '甲', lang: 'en' });
  });

  it('写入是**读-改-写**：写语言不会抹掉昵称，写昵称也不会抹掉语言', () => {
    const s = createLocalStore({ persistent: createMemoryStore() });
    s.grant();
    writeNickName(s, '甲');
    writeLang(s, 'en');
    expect(readNickName(s), '写语言把昵称抹掉了').toBe('甲');
    expect(readLang(s)).toBe('en');
    writeNickName(s, '乙');
    expect(readLang(s), '写昵称把语言抹掉了（读-改-写没做）').toBe('en');
    expect(readNickName(s)).toBe('乙');
    writeLang(s, 'zh');
    expect(readNickName(s)).toBe('乙');
    expect(readLang(s)).toBe('zh');
  });

  it('刷新（新开一个 store 读同一份 persistent）之后语言还在 —— 与 `initI18n` 接起来就是"记住"', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    writeLang(s, 'en');
    const again = createLocalStore({ persistent: kv });
    again.grant();
    expect(initI18n(() => readLang(again)), '重新启动之后语言没读回来').toBe('en');
    setLang(DEFAULT_LANG);
  });

  it('存储里是坏值 ⇒ `readLang()` 原样回出来（形状守卫在 `isLang` 一处），不抛', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    for (const raw of ['"xx"', '42', 'null', 'true', '["en"]']) {
      kv.set(L1_SETTINGS, raw);
      expect(() => readLang(s), `${raw} 把读取炸了`).not.toThrow();
      expect(isLang(readLang(s)), `${raw} 被当成了合法语言`).toBe(false);
      expect(initI18n(() => readLang(s)), `${raw} 没被归一成默认语言`).toBe(DEFAULT_LANG);
    }
    kv.set(L1_SETTINGS, 'not json at all');
    expect(initI18n(() => readLang(s))).toBe(DEFAULT_LANG);
  });

  it('形状守卫：`{nick:42, lang:"en"}` 里语言仍然读得出来（两个字段各自守各自的形状）', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    kv.set(L1_SETTINGS, JSON.stringify({ nick: 42, lang: 'en' }));
    expect(readNickName(s), '昵称的形状守卫坏了').toBe('');
    expect(readLang(s), '昵称坏值把语言一起带坏了').toBe('en');
  });

  it('后端写不进去 ⇒ `writeLang` 回 false（不抛）；调用方据此如实提示', () => {
    const kv = setThrowsFor(L1_SETTINGS);
    const s = createLocalStore({ persistent: kv });
    s.grant();
    let ok = true;
    expect(() => { ok = writeLang(s, 'en'); }, '写失败时抛了（应回 false）').not.toThrow();
    expect(ok, '写不进去却回了成功').toBe(false);
    // 反向：换一个能写的后端就回 true（证明上面那条不是"恒 false"）
    const good = createLocalStore({ persistent: createMemoryStore() });
    good.grant();
    expect(writeLang(good, 'en')).toBe(true);
  });

  it('游客模式（deny）⇒ 语言只进内存：本次会话读得回来，刷新即丢，且 persistent 零写入（红线 3）', () => {
    const spy = spyStore();
    const s = createLocalStore({ persistent: spy });
    s.deny();
    expect(writeLang(s, 'en'), '游客模式下写内存 KV 应成功（那是"本次会话有效"的既定口径）').toBe(true);
    expect(readLang(s)).toBe('en');
    expect(spy.mutations(), '游客模式下切语言碰了 persistent（红线 3）').toBe(0);
    // 刷新 = 新开一个 store 读同一份后端：授权没落盘 ⇒ 仍是 unknown，语言当然读不到
    const again = createLocalStore({ persistent: spy });
    expect(again.consent()).toBe('unknown');
    expect(readLang(again), '游客模式的语言竟然活过了"刷新"').toBe(undefined);
  });

  it('「清除本机数据」把语言一起清掉（它在 `L1_SETTINGS` 整键里），清完读回默认', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    writeLang(s, 'en');
    expect(readLang(s)).toBe('en');
    // `clearAllLocalData` 清的就是 `L1_SETTINGS` 这个键（`src/app/storage.ts` 的键表）
    const removed = clearLocalData(s.kv());
    expect(removed, '清除没清掉设置那个键').toBeGreaterThan(0);
    expect(readLang(s), '清除本机数据之后语言还在（那"可清除"这一半就不成立）').toBe(undefined);
    expect(initI18n(() => readLang(s))).toBe(DEFAULT_LANG);
  });
});
