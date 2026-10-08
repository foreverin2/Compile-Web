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
  readFxSettings,
  readLang,
  readNickName,
  writeFxSettings,
  writeLang,
  writeNickName,
} from '../../src/app/local-store';
import { L1_SETTINGS, createMemoryStore, readJson, type KeyValueStore } from '../../src/app/storage';
import { applyFxSettings, isFxSettingOn, resetFxSettingsForTest } from '../../src/ui/fx-settings';

/** 造一个"存储里已经是这样"的 store（上面的形状守卫腿用它） */
function storeWith(settings: Record<string, unknown>): ReturnType<typeof createLocalStore> {
  const kv = createMemoryStore();
  kv.set(L1_SETTINGS, JSON.stringify(settings));
  const s = createLocalStore({ persistent: kv });
  s.grant();
  return s;
}

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

/**
 * **i18n 层自己的代码位**（转出表的两个文件 `zh.ts` / `en.ts` 除外）。
 *
 * 为什么要它（线上验收 D3 时实测出来的一个**假红**）：`src/i18n/index.ts` 的
 * `saveFailedText()` 里有 `t('settings.lang.save-failed-detail')` 这类调用 —— 那是
 * "原因 → 文案"的唯一映射处，键当然只可能在那里出现一次。若把整个 i18n 层排除在外，
 * 那几条键会被"没有死键"那条腿判成**没人用**（假红），于是要么删掉真正需要的键、要么放宽那条腿。
 * ⇒ 反向那条腿的判据面加上这一层；**两张表文件仍然排除**（键在表里出现不算"有人读"）。
 */
const I18N_CODE = SOURCES.filter(
  (f) => f.rel.startsWith(I18N_PREFIX) && f.rel !== 'src/i18n/zh.ts' && f.rel !== 'src/i18n/en.ts',
);

/** 真树上被 `t()` 静态要过的键（**生成式**） */
function usedKeys(sources: readonly SourceFile[]): string[] {
  return [...new Set(sources.flatMap((f) => staticTKeys(f.code)))].sort();
}

/**
 * 真树上"**有人在用**"的键：`t('键')` 的静态调用 **加上** 代码位里出现的键名字面量
 * （后者覆盖 `src/ui/fx-settings.ts` 那种"键存在表里、由 `t(def.label)` 取"的形态）。
 * 只有"两条路都不沾"的键才算死键。
 *
 * ⚠️ 传进来的 `sources` 决定判据面：**表文件（`zh.ts` / `en.ts`）绝不许进来** ——
 * 键在表里当然出现，那会让这条腿恒绿（下面有一条腿专门钉这个边界）。
 */
function referencedKeys(sources: readonly SourceFile[]): string[] {
  const all = sources.flatMap((f) => [...staticTKeys(f.code), ...keyLiterals(f.code)]);
  return [...new Set(all)].sort();
}

const USED = usedKeys(CONSUMERS);
const REFERENCED = referencedKeys(CONSUMERS);
/** 反向那条腿的判据面：消费者 + i18n 层自己的代码位（不含两张表） */
const SELF_REFERENCED = referencedKeys([...CONSUMERS, ...I18N_CODE]);

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

  it('反向：表里没有"谁也读不到"的死键（每条键都至少被一处代码提到）', () => {
    // 单向判据（只查"缺键"）会让表可以无限长草：抽完一屏之后把屏上的调用删掉、键留着 ——
    // 没人报红，而下一个改文案的人会在两张表之间选错一处。这一条把"键必须有人用"也钉住。
    // ⚠️ 它的代价是真的会挡下"先加键、后接屏"的写法：那就**先接屏再加键**，或者把键先删掉。
    // ⚠️ **判据面比上面那条宽**（`SELF_REFERENCED` 含 `src/i18n/**` 自己），两类形态都算"有人用"：
    //    ① 静态调用 / 键名字面量（`REFERENCED`，扫消费者）；
    //    ② **i18n 层自己的代码位**里的键字面量 —— 例如 `saveFailedText()`（`src/i18n/index.ts`）
    //       里那几条 `t('settings.lang…')`：它是"原因 → 文案"的唯一映射处，键当然只可能在那里
    //       出现一次。第一版把整个 i18n 层排除在外 ⇒ 那几条键被判成死键（假红）。
    //    `src/i18n/zh.ts` / `en.ts` **仍然排除**（它们是表本身，键在那里出现不算"有人读"）。
    const unused = Object.keys(ZH).filter((k) => !SELF_REFERENCED.includes(k)).sort();
    expect(unused, `这些键在两张表里但 src/** 里没有任何地方提到它：${unused.join(', ')}`).toEqual([]);
  });

  it('★ 死键的具体形态：两张表不算"有人读"（判据面不许把表文件混进来）', () => {
    // 这一条钉住上一条的**边界**：`referencedKeys()` 的契约是"传进来的文件里，键是**被读**的"。
    // **两张表文件绝不能传进来** —— 键在表里当然出现，那会让死键判据恒绿（谁都可以往表里加键）。
    // 本文件用"表文件**不在**扫描面里"这条纪律守住它（上面 SELF_REFERENCED 的构造就是证明）：
    const tableFiles = SOURCES.filter((f) => f.rel === 'src/i18n/zh.ts' || f.rel === 'src/i18n/en.ts').map((f) => f.rel);
    expect(tableFiles, '扫描面里找不到两张表 ⇒ 这条边界没有意义').toEqual(['src/i18n/en.ts', 'src/i18n/zh.ts']);
    expect(SELF_REFERENCED.length, '判据面为空').toBeGreaterThan(5);
    // 反向：把表文件混进去会**立刻**把它的键都算成"有人读"（这就是恒绿的形态）
    const polluted = referencedKeys([SOURCES.find((f) => f.rel === 'src/i18n/zh.ts') as SourceFile]);
    expect(polluted.length, '表文件里的键居然不算"有人读"？那这条边界写反了').toBeGreaterThan(5);
    expect(polluted).toContain('settings.title');
    for (const k of polluted) expect(Object.keys(ZH), `污染样本里的 ${k}`).toContain(k);
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
    // 这些是**改动前** `src/ui/home.ts` / `src/ui/fx-settings.ts` 里的原文（P0 的验收判据），
    // 写在这里的是**冻结值**，不是"从实现里抄一遍"。
    //
    // ★ 2026-10-01（用户要求"设置里的选项也要持久化"）：`settings.hint` 这一条**按用户要求改写了**
    //   —— 旧值「改动只在本次会话有效，刷新后回到默认开启。」现在**不成立**（开关真的落盘了）。
    //   这是这一组里**唯一**一条被授权的改动，冻结值同步换成新句子；其余各条一字未动。
    const FROZEN: Readonly<Record<string, string>> = {
      'settings.title': '设置',
      'settings.close': '关闭',
      'settings.aria': '设置',
      'settings.hint': '改动会保存到本机（与昵称同一份存储），下次进入仍然生效；游客模式下只在本次会话有效。',
      'settings.fx.on': '开启',
      'settings.fx.off': '关闭',
      'settings.fx.state': '{desc}（当前：{state}）',
      'settings.fx.metal6.label': '金属6 频闪特效',
      'settings.fx.metal6.desc': '手牌里的金属6 牌面会循环渐现一张图。关掉之后不再显示，其它卡牌的特效不受影响。',
    };
    for (const [k, v] of Object.entries(FROZEN)) {
      expect(ZH[k], `键 ${k} 的中文值与冻结值不一致`).toBe(v);
    }
    // 反向锚点：新口径**必须**说清"保存到本机"，且**不许**再留旧口径那句
    expect(ZH['settings.hint'], '新口径没说"保存到本机"').toContain('保存到本机');
    expect(ZH['settings.hint'], '旧口径"只在本次会话有效"还在（那是改动前的错话）')
      .not.toContain('改动只在本次会话有效');
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
    expect(writeLang(s, 'en').ok).toBe(true);
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

  it('后端写不进去 ⇒ `writeLang` 回 `{ok:false, reason:"write-failed", detail}`（不抛）；调用方据此如实提示', () => {
    const kv = setThrowsFor(L1_SETTINGS);
    const s = createLocalStore({ persistent: kv });
    s.grant();
    // 先用一条"不抛"的腿钉形状（`writeLang` 的失败形态是**返回值**，不是异常）
    expect(() => writeLang(s, 'en'), '写失败时抛了（应回结构化结论）').not.toThrow();
    const out = writeLang(s, 'en');
    expect(out.ok, '写不进去却回了成功').toBe(false);
    if (!out.ok && out.reason === 'write-failed') {
      expect(out.detail, '真因被丢了（D3 的原缺陷）').toContain('写入被拒');
    }
    // 反向：换一个能写的后端就回 ok（证明上面那条不是"恒 false"）
    const good = createLocalStore({ persistent: createMemoryStore() });
    good.grant();
    expect(writeLang(good, 'en').ok).toBe(true);
  });

  it('★ D3：值超上限 ⇒ `reason` 是 `too-large` + **两个数**（不是中文句子）、盘上零写入', () => {
    // 造一份已经超大的设置（外部手改 / 别的程序把同一个键写肿了）：`writeJson` 会在**碰 KV
    // 之前**退回 too-large —— 这正是第一版丢掉的那个原因（它只回布尔，宿主只能猜成"配额已满"）。
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    kv.set(L1_SETTINGS, JSON.stringify({ nick: 'x'.repeat(70000) }));
    const before = kv.get(L1_SETTINGS);
    const out = writeLang(s, 'en');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason, '值超上限被归类成了 write-failed（宿主会显示成"配额已满"，是错的）').toBe('too-large');
    if (out.reason !== 'too-large') return;
    // ★ D3 第二条：纯层给**两个数**，不给拼好的句子（英文界面里出现中文诊断串就是坏的）
    expect(out.bytes, '实际字节数没带出来').toBeGreaterThan(65536);
    expect(out.limit, '上限值没带出来').toBe(65536);
    // 反向：`too-large` 这一档**不许**有 `detail`（有了就说明有人又开始在纯层拼句子）
    expect('detail' in out, 'too-large 带上了 detail（纯层又开始拼文案了？）').toBe(false);
    expect(kv.get(L1_SETTINGS), 'too-large 时居然写了盘').toBe(before);
  });

  it('★ D3：纯层（`src/app/storage.ts`）的代码位里**没有汉字自然语言**（只许原因码与数值）', () => {
    // 这条是分层纪律的机械形态：玩家可见的措辞只许住在 `src/i18n/` 的表里。
    // ⚠️ 判据面是**代码位里的字面量**（注释不算）：注释当然要用中文写清楚。
    const f = SOURCES.find((s) => s.rel === 'src/app/storage.ts');
    expect(f, '扫描面里没有 storage.ts').toBeDefined();
    const lits = [...(f?.code ?? '').matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1]);
    expect(lits.length, 'storage.ts 的代码位里一个字符串都没有 ⇒ 扫描失效').toBeGreaterThan(10);
    const cjk = lits.filter((s) => /[\u3400-\u9fff]/.test(s));
    expect(cjk, `storage.ts 的代码位里出现了中文字符串（玩家文案只许住在 i18n 表里）：${cjk.join(' / ')}`).toEqual([]);
  });

  it('游客模式（deny）⇒ 语言只进内存：本次会话读得回来，刷新即丢，且 persistent 零写入（红线 3）', () => {
    const spy = spyStore();
    const s = createLocalStore({ persistent: spy });
    s.deny();
    expect(writeLang(s, 'en').ok, '游客模式下写内存 KV 应成功（那是"本次会话有效"的既定口径）').toBe(true);
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

/* ============================================================================
 * 7. ★ B（2026-10-01 用户要求）：**特效开关也落本机**
 *
 * 用户原话：「我希望设置里的选项都能够保存为持久化的数据，就和玩家名一样存储至本地，
 * 下次进入时能够随时响应」。这一组钉住存储侧那一半（界面那一半在
 * `tests/i18n/settings-overlay.test.ts`）。
 * ========================================================================== */

describe('★ B：特效开关的存储口径（与昵称/语言同一份设置、同一套门控）', () => {
  it('开关与昵称/语言**同住 `compile-settings` 那一个键**里（不新增存储键）', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    writeNickName(s, '甲');
    writeLang(s, 'en');
    expect(writeFxSettings(s, { 'metal6-strobe': false }).ok).toBe(true);
    expect(s.kv().keys().sort(), '开关注册出了新键（用户口径是"就和玩家名一样存本机"）')
      .toEqual(['compile-consent', L1_SETTINGS].sort());
    expect(readJson<Record<string, unknown>>(kv, L1_SETTINGS, {}))
      .toEqual({ nick: '甲', lang: 'en', fx: { 'metal6-strobe': false } });
  });

  it('读侧：默认（没写过）⇒ 空对象；写进去之后读回来就是那个值', () => {
    const s = createLocalStore({ persistent: createMemoryStore() });
    s.grant();
    expect(readFxSettings(s), '没写过时该回空对象（默认值由 fx-settings 那一层兜）').toEqual({});
    writeFxSettings(s, { 'metal6-strobe': false });
    expect(readFxSettings(s)).toEqual({ 'metal6-strobe': false });
    writeFxSettings(s, { 'metal6-strobe': true });
    expect(readFxSettings(s)).toEqual({ 'metal6-strobe': true });
  });

  it('★ 写是**读-改-写**：改一项不会抹掉别的项（也不会抹掉昵称/语言）', () => {
    const s = createLocalStore({ persistent: createMemoryStore() });
    s.grant();
    writeNickName(s, '甲');
    writeLang(s, 'en');
    writeFxSettings(s, { 'metal6-strobe': false });
    writeFxSettings(s, { 'future-switch': true }); // 将来的第二项
    expect(readFxSettings(s), '后写的把先写的抹掉了（读-改-写没做）').toEqual({
      'metal6-strobe': false, 'future-switch': true,
    });
    expect(readNickName(s)).toBe('甲');
    expect(readLang(s)).toBe('en');
  });

  it('★ 形状守卫**逐字段**：坏值被丢掉，好值保留（不是"整块回空"）', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    kv.set(L1_SETTINGS, JSON.stringify({ fx: { 'metal6-strobe': false, junk: 'yes', n: 1, z: null } }));
    expect(readFxSettings(s), '坏字段没被丢掉 / 好字段被误伤').toEqual({ 'metal6-strobe': false });
    // 反向：整个 `fx` 不是对象（数组 / 字符串 / null）⇒ 回空对象，不抛
    for (const bad of ['[]', '"x"', 'null', '42']) {
      kv.set(L1_SETTINGS, JSON.stringify({ fx: JSON.parse(bad) }));
      expect(() => readFxSettings(s), `fx = ${bad} 把读取炸了`).not.toThrow();
      expect(readFxSettings(s), `fx = ${bad} 没被丢掉`).toEqual({});
    }
    kv.set(L1_SETTINGS, '{oops');
    expect(readFxSettings(s), '整份设置坏掉时该回空对象（默认值由上面那一层兜）').toEqual({});
  });

  it('★ 启动读回：`applyFxSettings` 把存储值灌进内存态，坏值/缺项退回**各项目己的默认**', () => {
    // 这是"下次进入时能够随时响应"那一半：读回之后 `isFxSettingOn` 立刻反映存储值。
    applyFxSettings(readFxSettings(storeWith({ fx: { 'metal6-strobe': false } })));
    expect(isFxSettingOn('metal6-strobe'), '存储里是关，读回之后却是开').toBe(false);
    applyFxSettings(readFxSettings(storeWith({ fx: { 'metal6-strobe': true } })));
    expect(isFxSettingOn('metal6-strobe')).toBe(true);
    // 缺项 / 坏值 / 根本没写 ⇒ 默认开启
    for (const bad of [undefined, {}, { 'metal6-strobe': 'yes' }, 42, null]) {
      applyFxSettings(bad);
      expect(isFxSettingOn('metal6-strobe'), `${JSON.stringify(bad)} 没退回默认开启`).toBe(true);
    }
    resetFxSettingsForTest();
  });

  it('★ 游客模式（deny）⇒ 开关只进内存：本次会话读得回来、刷新即丢、persistent 零写入（红线 3）', () => {
    const spy = spyStore();
    const s = createLocalStore({ persistent: spy });
    s.deny();
    expect(writeFxSettings(s, { 'metal6-strobe': false }).ok, '游客模式下写内存 KV 应成功').toBe(true);
    expect(readFxSettings(s)).toEqual({ 'metal6-strobe': false });
    expect(spy.mutations(), '游客模式下拨开关碰了 persistent（红线 3）').toBe(0);
    const again = createLocalStore({ persistent: spy });
    expect(readFxSettings(again), '游客模式的开关竟然活过了"刷新"').toEqual({});
  });

  it('★ 写失败按**结构化原因**回来（与语言同一套 `WriteResult`），不抛', () => {
    const s = createLocalStore({ persistent: setThrowsFor(L1_SETTINGS) });
    s.grant();
    expect(() => writeFxSettings(s, { 'metal6-strobe': false }), '写失败时抛了').not.toThrow();
    const out = writeFxSettings(s, { 'metal6-strobe': false });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('write-failed');
    // 反向：能写的后端回 ok
    const good = createLocalStore({ persistent: createMemoryStore() });
    good.grant();
    expect(writeFxSettings(good, { 'metal6-strobe': false }).ok).toBe(true);
  });

  it('★ 值超上限 ⇒ `too-large` + 两个数（开关这一路与语言共用同一个结构化结论）', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    kv.set(L1_SETTINGS, JSON.stringify({ nick: 'x'.repeat(70000) }));
    const out = writeFxSettings(s, { 'metal6-strobe': false });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('too-large');
    if (out.reason === 'too-large') expect(out.bytes).toBeGreaterThan(65536);
  });

  it('★「清除本机数据」把开关一起清掉（它在 `L1_SETTINGS` 整键里），清完读回空 ⇒ 默认开启', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    writeFxSettings(s, { 'metal6-strobe': false });
    expect(readFxSettings(s)).toEqual({ 'metal6-strobe': false });
    expect(clearLocalData(s.kv())).toBeGreaterThan(0);
    expect(readFxSettings(s), '清除本机数据之后开关还在').toEqual({});
    applyFxSettings(readFxSettings(s));
    expect(isFxSettingOn('metal6-strobe'), '清除之后没回到默认开启').toBe(true);
    resetFxSettingsForTest();
  });
});

/* ============================================================================
 * 8. ★ 2026-10-02（英文模式真机走查 A）：**占位符不许漏传**（生成式）
 *
 * 走查抓到的缺陷形状：一句话被抽成**多个键**（`…zoom-hint.1` / `.2` / `.3` / `.4`），
 * 而 `{max}` 住在 `.2` 里、参数却只传给了 `.1` ⇒ 屏上留着 `(50%~{max}%…`，
 * **中英文都坏**。既有那几条腿全都抓不到它：键都在表里、值都非空、语言也对。
 *
 * ## 这条腿问的是什么（不是"表里有没有占位符"）
 *
 * `t()` 的契约是"**缺的参数保留占位原文**"（不静默变空串，屏上看得见）—— 那对排查是对的，
 * 但它意味着**漏传参数不会报错、只会把 `{max}` 印在屏上**。所以判据必须落在**调用点**上：
 *
 *   > 对**每一个**含 `{xxx}` 的键（两张表的值合并起来看），
 *   > **每一处**静态调用点（`t('键', …)`）都必须把那个键值里出现的**每一个**占位符
 *   > 作为自己的属性名给出来。
 *
 * ## 覆盖面的三条边界（如实声明）
 *
 *  - 只认**静态第一实参**（`t('a.b', …)`）：动态键另有腿（"不许有动态键"）当场报红；
 *  - 第二实参必须是**对象字面量**：变量 / 展开（`…rest`）**判不了** ⇒ 报红并要求改成字面量
 *    （与"动态键"同一条口径：宁可窄而响，不做静默放行）。当前真树零命中；
 *  - 它不判断传进来的**值**对不对（那是各屏自己的事），只判断"名字给全了没有"。
 *
 * ## 反向验证
 *
 * 把 `src/ui/cardmaker/page.ts` 里 `.2` 那处的 `{ max: … }` 删掉 ⇒ 这条腿当场红
 * （报告里贴了实测）。同理，`coin.result` 在热座那条路上漏 `call` 时它也会红 ——
 * 那正是同一次走查里**同一族**的第二处（`{call}掷出…`）。
 * ========================================================================== */

/** 一处 `t(…)` 调用的**静态**读数（只收第一实参是字面量的那些） */
interface TCallSite {
  /** 第一实参的字面量（键） */
  readonly key: string;
  /** 第二实参原文（没给就是 `null`） */
  readonly arg1: string | null;
  /** 仓库相对路径 + 行号（报错里人读） */
  readonly at: string;
}

/**
 * 一条 `t(…)` 调用的**全部顶层实参**原文。
 *
 * 与 `tArgTexts()` 同源（同一套"括号配平 + 字面量整段跳过"的扫描），区别只是它**不止步于
 * 第一个逗号** —— 占位符那条腿需要第二实参。两份实现放在同一个文件里，改口径时一起改。
 */
function tCallArgsAt(code: string, from: number): { readonly args: string[]; readonly end: number } {
  const args: string[] = [];
  let depth = 0;
  let j = from;
  let buf = '';
  for (; j < code.length; j += 1) {
    const c = code[j];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      buf += c;
      j += 1;
      for (; j < code.length; j += 1) {
        if (code[j] === '\\') { buf += code[j]; j += 1; if (j < code.length) buf += code[j]; continue; }
        buf += code[j];
        if (code[j] === q) break;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth += 1; if (depth > 1) buf += c; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) { args.push(buf.trim()); break; }
      buf += c;
      continue;
    }
    if (c === ',' && depth === 1) { args.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  return { args, end: j };
}

function tCallSites(f: SourceFile): TCallSite[] {
  const out: TCallSite[] = [];
  const code = f.code;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== 't' || code[i + 1] !== '(') continue;
    const prev = i === 0 ? '' : code[i - 1];
    if (/[A-Za-z0-9_$.]/.test(prev)) continue;
    const { args, end } = tCallArgsAt(code, i + 1);
    const m = /^(?:'([^'\\$]*)'|"([^"\\$]*)"|`([^`\\$]*)`)$/.exec(args[0] ?? '');
    if (m === null) continue; // 动态键：由"不许有动态键"那条腿负责
    const line = code.slice(0, i).split('\n').length;
    out.push({
      key: m[1] ?? m[2] ?? m[3],
      arg1: args.length > 1 ? args[1] : null,
      at: `${f.rel}:${line}`,
    });
    i = end; // 跳过这一次调用的实参表（防嵌套 `t()` 被当成两处）
  }
  return out;
}

/**
 * 一个对象字面量的**顶层属性名**（可以当成占位符来源的那些）。
 *
 * 为什么只取**顶层**：`t('k', { x: { max: 1 } })` 里那个嵌套的 `max` **不是**给 `{max}` 用的
 * —— 把它算成"给了"就是这条腿的假绿形态。做法是按**深度 0 的逗号**切段，每段取第一个
 * 深度 0 的 `:` 之前那一截。
 */
function objectParamNames(arg1: string): { readonly names: string[]; readonly spread: boolean; readonly literal: boolean } {
  const src = arg1.trim();
  if (!src.startsWith('{')) return { names: [], spread: false, literal: false };
  const inner = src.slice(1, src.endsWith('}') ? src.length - 1 : src.length);
  const names: string[] = [];
  let spread = false;
  let depth = 0;
  let buf = '';
  const take = (seg: string): void => {
    const s = seg.trim();
    if (s === '') return;
    if (s.startsWith('...')) { spread = true; return; }
    const colon = topLevelColon(s);
    const name = (colon < 0 ? s : s.slice(0, colon)).trim();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.push(name);
  };
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < inner.length) {
        if (inner[i] === '\\') { i += 2; continue; }
        if (inner[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth += 1; buf += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; buf += c; continue; }
    if (c === ',' && depth === 0) { take(buf); buf = ''; continue; }
    buf += c;
  }
  take(buf);
  return { names, spread, literal: true };
}

/** 段里**深度 0** 的第一个 `:` 的下标（`{ a: b ? c : d }` 的那个 `?` 三元不在这里，本仓用不到） */
function topLevelColon(seg: string): number {
  let depth = 0;
  for (let i = 0; i < seg.length; i += 1) {
    const c = seg[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < seg.length) {
        if (seg[i] === '\\') { i += 2; continue; }
        if (seg[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; continue; }
    if (c === ':' && depth === 0) return i;
  }
  return -1;
}

/** 一个值里出现的占位符名（`{max}` ⇒ `max`） */
function placeholderNamesOf(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
}

/** 判据面：消费者 **+ i18n 层自己的代码位**（`saveFailedText()` 那几条键住在 `src/i18n/index.ts`） */
const PLACEHOLDER_SITES = [...CONSUMERS, ...I18N_CODE];

/** 键 → 它在**两张表**的值里出现过的全部占位符（并集：英文表多一个占位符也要被抓到） */
const KEY_PLACEHOLDERS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, Set<string>>();
  for (const table of [ZH, EN]) {
    for (const [k, v] of Object.entries(table)) {
      const ph = placeholderNamesOf(v);
      if (ph.length === 0) continue;
      const set = m.get(k) ?? new Set<string>();
      for (const p of ph) set.add(p);
      m.set(k, set);
    }
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
})();

/**
 * 判据本体：返回"漏了占位符 / 判不了"的那些调用点（人读的字符串）。空数组 = 绿。
 *
 * 抽成函数是为了**正控**能用合成源码喂它（见下面的自证腿）。
 */
function placeholderViolations(sites: readonly TCallSite[]): string[] {
  const out: string[] = [];
  for (const s of sites) {
    const need = KEY_PLACEHOLDERS.get(s.key);
    if (need === undefined) continue;
    if (s.arg1 === null) {
      out.push(`${s.at}：t('${s.key}') 没给第二实参，而值里有占位符 {${need.join('} {')}}`);
      continue;
    }
    const { names, spread, literal } = objectParamNames(s.arg1);
    if (!literal) {
      out.push(`${s.at}：t('${s.key}') 的第二实参不是对象字面量（静态判不了它给了哪些占位符）`);
      continue;
    }
    if (spread) {
      out.push(`${s.at}：t('${s.key}') 的第二实参里有展开（…），静态判不了它给了哪些占位符`);
      continue;
    }
    const lack = need.filter((n) => !names.includes(n));
    if (lack.length > 0) out.push(`${s.at}：t('${s.key}') 没传 {${lack.join('} {')}}`);
  }
  return out;
}

describe('★ 占位符不许漏传（生成式：扫每一个含 {xxx} 的键的每一处静态调用点）', () => {
  it('扫描面自检：真的扫到了调用点与含占位符的键（否则下面每条判据在空集上恒真）', () => {
    const sites = PLACEHOLDER_SITES.flatMap((f) => tCallSites(f));
    expect(sites.length, '一处静态 t() 调用都没扫到 ⇒ 路径/扫描器写错').toBeGreaterThan(200);
    expect(KEY_PLACEHOLDERS.size, '表里一个含占位符的键都没有 ⇒ 这条腿没在防任何东西').toBeGreaterThan(50);
    // 锚点：这次修的那条腿的键必须真的在判据面里（它是缺陷的原始现场）
    expect([...KEY_PLACEHOLDERS.keys()]).toContain('cardmaker.page.logo.zoom-hint.2');
    expect(sites.some((s) => s.key === 'cardmaker.page.logo.zoom-hint.2'),
      '原始现场那个键没有调用点 ⇒ 判据面错了').toBe(true);
  });

  it('每一处调用点都把该键值里的占位符给全了（少一个就报红，逐处点名）', () => {
    const bad = placeholderViolations(PLACEHOLDER_SITES.flatMap((f) => tCallSites(f)));
    expect(
      bad,
      '这些调用点漏传了占位符 —— 屏上会原样印出 `{xxx}`（中英文都坏）：\n' + bad.join('\n'),
    ).toEqual([]);
  });

  it('★ 正控：合成源码里漏一个参数 / 不给参数 / 给展开 ⇒ 都必须被报出来', () => {
    // ① 漏一个（就是走查抓到的那一处：`{min}` 给了、`{max}` 没给）
    const missingOne: TCallSite = { key: 'cardmaker.page.logo.zoom-hint.2', arg1: '{ min: "50" }', at: 'synth.ts:1' };
    expect(placeholderViolations([missingOne]), '漏了一个占位符没被报出来').not.toEqual([]);
    // ② 一个参数都不给
    const none: TCallSite = { key: 'cardmaker.page.logo.zoom-hint.2', arg1: null, at: 'synth.ts:2' };
    expect(placeholderViolations([none])).not.toEqual([]);
    // ③ 展开（静态判不了）
    const spread: TCallSite = { key: 'cardmaker.page.logo.zoom-hint.2', arg1: '{ ...base }', at: 'synth.ts:3' };
    expect(placeholderViolations([spread])).not.toEqual([]);
    // ④ 反向锚点：给全了就是绿的（否则上面三条可能是"恒红"）
    const ok: TCallSite = { key: 'cardmaker.page.logo.zoom-hint.2', arg1: '{ max: "200" }', at: 'synth.ts:4' };
    expect(placeholderViolations([ok]), '给全了还被判红 ⇒ 这条腿恒红，等于没在判').toEqual([]);
  });

  it('★ 判据自证：`objectParamNames()` 只认顶层属性名（嵌套的对象不许冒充）', () => {
    expect(objectParamNames('{ min: f(1, 2), max: "200" }').names.sort()).toEqual(['max', 'min']);
    // 简写形态（`settings.lang.fail.too-large` 那一处就是 `{ bytes, limit }`）
    expect(objectParamNames('{ bytes, limit }').names.sort()).toEqual(['bytes', 'limit']);
    // ★ 嵌套：`{ x: { max: 1 } }` 里的 `max` **不算**给 `{max}` 用
    expect(objectParamNames('{ x: { max: 1 } }').names).toEqual(['x']);
    expect(objectParamNames('{ ...rest, max }').spread, '展开没被认出来').toBe(true);
    expect(objectParamNames('params').literal, '变量实参被当成了对象字面量').toBe(false);
  });
});

/* ============================================================================
 * 9. ★ 2026-10-02（英文模式真机走查 B7）：**英文表里不许出现汉字**
 *
 * 走查抓到的缺陷形状：`en.ts` 的 `'cardmaker.page.credit.license-value'` 写的是 `'MIT 许可'`
 * —— 键在、两表同步、占位符也对、连"值非空"都过，**但英文模式下屏上就是半句中文**。
 * 那一条的成因是"照抄数据常量"（`CREDIT.license` 是纯数据、值必须是中文），照抄时把中文
 * 一起带进了英文表。
 *
 * ## 白名单是**逐条列出 + 逐条给理由**的
 *
 * 出现汉字**必须**登记；反过来，登记了却不再出现汉字也报红（白名单不许长草）。
 * ========================================================================== */

/**
 * 英文表里允许出现汉字的地方 —— 每一条都说清**为什么**。
 *
 * 口径：`en` 值是"英文玩家看到的东西"，出现汉字必须是**有意的**（人名、双语标签、
 * 或引用了不翻译的原文），不能是"漏翻 / 照抄了中文"。
 */
const EN_CJK_ALLOW: Readonly<Record<string, string>> = {
  'settings.lang':
    '语言这一行是**双语标签**（`语言 / Language`）：只会英文的玩家第一次进设置也得认得出'
    + '哪一行管语言。这是语言功能自己的读数，设计如此（`tests/i18n/settings-overlay.test.ts` 钉着）。',
  'home.footer':
    '页脚署名里的 `「我吃吃吃吃」` 是**专有名词**（用户名），中英同款、不翻译。'
    + '走查也把它判成"干净（人名）"。',
  'home.icp.no':
    '★ 2026-10-07（用户要求）：页脚那行**工信部备案号**。它是**法定标识**（域名备案的唯一编号），'
    + '中英界面下必须是同一个编号、不许翻译（翻了就不是备案号了）—— 与上面那条同族（专有名词）。'
    + '同一行里真正需要翻译的是链接文字（`home.icp.link`，中英各一条）。',
  /**
   * ★ 2026-10-06：原来这里还登记着 4 条（`tutorial.T9/T10/T11/T12.observe`），
   * 理由是"它们引用了引擎日志原文，而日志住在红线 `src/core/**`、本轮不抽，所以界面语言是英文时
   * 引用的那一行也必须是中文"。
   *
   * 现在日志有了**显示层**（`src/i18n/engine-log.ts` + `src/ui/log-line.ts`：英文模式下把日志
   * 翻成英文），那 4 条英文文案里的引用也跟着换成了英文（`[middle] speed-1: reason: flipped
   * face up` / `P1 control step: …` / `[before covered] fire-0` / `[end] life-0: resolved by P1` /
   * `rigidity-7 cannot be flipped, skipping`）⇒ **白名单条目按"不许长草"删掉**。
   * 引用与日志措辞的一致性由 `tests/i18n/engine-log.test.ts` 的一条腿钉住（改日志措辞 ⇒ 那里红）。
   */
};

describe('★ 英文表里不许出现汉字（白名单逐条列出并说明理由）', () => {
  it('`en` 的每一个值里都没有汉字，除非在 `EN_CJK_ALLOW` 里逐条登记过', () => {
    const hits = Object.keys(EN)
      .filter((k) => /[\u3400-\u9fff]/.test(EN[k]))
      .sort();
    const unregistered = hits.filter((k) => EN_CJK_ALLOW[k] === undefined);
    expect(
      unregistered,
      '英文表里这些值是中文（英文界面下会直接显示出来）：\n'
      + unregistered.map((k) => `  - ${k}: ${EN[k]}`).join('\n')
      + '\n处置：改成真的英文；确实要留汉字（人名 / 双语标签 / 引用不翻译的原文）就登记进 EN_CJK_ALLOW 并写明理由。',
    ).toEqual([]);
  });

  it('反向：白名单里不许留"已经不含汉字"的陈旧条目（它只准变短）', () => {
    const stale = Object.keys(EN_CJK_ALLOW).filter((k) => !/[\u3400-\u9fff]/.test(EN[k] ?? ''));
    expect(stale, `这些键已经不含汉字了，把它们从白名单里删掉：${stale.join(', ')}`).toEqual([]);
  });

  it('白名单自证：每条都真的在英文表里、且理由非空（不是一张空壳）', () => {
    const keys = Object.keys(EN_CJK_ALLOW);
    expect(keys.length, '白名单是空的 ⇒ 上面那条"逐条登记"没有判据面').toBeGreaterThan(0);
    for (const k of keys) {
      expect(EN[k], `白名单里的 ${k} 不在英文表里（幽灵条目）`).toBeTypeOf('string');
      expect(EN_CJK_ALLOW[k].length, `${k} 的理由写得太短（等于没写）`).toBeGreaterThan(20);
    }
    // 正控：合成一份"英文值里写了中文"的表 ⇒ 判据必须能报出来
    const synth: Readonly<Record<string, string>> = { ...EN, 'synth.zh-in-en': '这条是中文' };
    const hits = Object.keys(synth).filter((k) => /[\u3400-\u9fff]/.test(synth[k])).sort();
    expect(hits, '正控：合成的那条中文没被扫出来').toContain('synth.zh-in-en');
    expect(hits.filter((k) => EN_CJK_ALLOW[k] === undefined), '正控：未登记的汉字没被判红').toContain('synth.zh-in-en');
  });

  it('★ 走查抓到的那一条的现状：`cardmaker.page.credit.license-value` 的英文值是 `MIT License`', () => {
    expect(EN['cardmaker.page.credit.license-value']).toBe('MIT License');
    // 中文值**必须**与数据常量 `CREDIT.license` 逐字相同（`CLEAN_DECLARED` 那条腿钉着）
    expect(ZH['cardmaker.page.credit.license-value']).toBe('MIT 许可');
  });
});
