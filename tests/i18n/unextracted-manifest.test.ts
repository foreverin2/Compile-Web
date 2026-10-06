import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments, functionBody } from '../ui/source-text';
import { ZH } from '../../src/i18n/zh';

/**
 * ★ 2026-10-01（P0）：「**尚未抽取的屏**」清单的机械形态。
 *
 * 用户的 P0 交付里要一条"还没做 i18n 的屏/文件"清单（方案 §6.5 第 3 条），并且明确
 * **"清单只能变短，不能变长"**。一份手写的 markdown 清单挡不住任何东西 ——
 * 新加一个屏、忘了登记，没人会知道。所以清单是**机检**的：
 *
 *  1. 扫 `src/**\/*.ts` 的**代码位**（剥注释）里的**中文字符串字面量**；
 *  2. **每一个含中文的 `src/**` 文件都必须登记**（新屏没登记 ⇒ 报红）；
 *  3. 清单里每一行指的文件**真的存在**（幽灵行 ⇒ 报红）；
 *  4. **已经判为"干净"的文件不许再有裸中文字面量**（抽干净了才算划掉 —— 否则"划掉"
 *     只是一次自我声明）。
 *
 * ## ★ 2026-10-02（P3 第八批）：扫描面从 `src/ui/**` 扩到 `src/**`（本文件的主要改动）
 *
 * ## 为什么（上一轮的★新发现）
 *
 * 旧版头注写着"玩家可见的 UI 文案都在 `src/ui/**` 里"，于是
 * `src/main.ts` / `src/net/**` / `src/app/**` **一条腿都没有**：实测那三处有 **318 条**
 * 中文（14 个文件），其中三族**玩家真的会看到**却没有任何机检面盯着
 * （`src/main.ts` 的联机交接提示、`src/net/session.ts` 的拒绝原因、
 * `src/app/match-file.ts` + `archive-io.ts` 的档案导入失败原因）。
 * 见 `docs/2026-10-01-i18n-尚未抽取的屏.md` G.4 第 2 条与
 * `docs/2026-10-01-i18n-英文覆盖收口.md` §二 C 节。
 *
 * ## 扩面之后的四个登记桶（缺一个就报红 —— 这是"新中文没登记会被抓住"的判据面）
 *
 * | 桶 | 语义 | 判据强度 |
 * |---|---|---|
 * | 清单 `[ ]` 行（markdown） | **还没抽**（待办） | 逐文件 |
 * | `CLEAN_DECLARED` | 已抽干净、剩下的中文是**数据源**（值必须逐条等于 `zh.ts` 的值） | 逐字面量 |
 * | `DEV_ONLY` | **有意留中文**的开发者串（`throw` / 控制台 / 自查读数） | **逐字面量**（多一条新的就回到"必须登记"） |
 * | `RETAINED_DIRS` / `RETAINED_FILES` | **有意保留中文**的目录 / 文件（数据、引擎、冻结文本…） | **计数上限 + 理由** |
 *
 * `RETAINED_*` 为什么用"计数上限"而不是"逐条列出那几十上百条字符串"：
 * `src/data/**` 有 879 条、`src/core/**` 有 514 条（`texts:check` 与联机卡文哈希钉住的数据
 * 文案），逐条抄进测试文件只会制造第二份真相。代价（**如实声明**）：在那些文件里**替换**一条
 * 中文不会被抓住（新增一条会：计数涨了）。白名单的方向仍然**只准变短** ——
 * 见第 ⑤ 条腿（计数不许涨、清空了的文件条目必须删掉）。
 *
 * ## 已知边界（如实声明）
 *
 *  - 只认**字面量**：`'甲' + '乙'` 拼出来的句子、或从数据里读来的中文都不算
 *    （扫描器按引号切，两个片段各算一条）；
 *  - 只认**含汉字**的字符串/模板串：`'水'` 这种单字也算（故意从严 —— 它是文案就该进表）；
 *  - 它**不**判断中文是不是玩家可见（类名、`data-*` 的取值、TS 的**类型字面量**、徽标的缩写
 *    都会算进去）。代价是清单里的计数偏大；方向是**假红**（逼一次人工登记），不是静默放行。
 *  - 它**不**区分"注释里的中文"（`stripComments` 已剥）。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_REL = 'docs/2026-10-01-i18n-尚未抽取的屏.md';

/** 递归收集 `.ts`（不含 `.d.ts`） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * 扫描面：`src/**` **减去 `src/i18n/**`**。
 *
 * 为什么减掉 `src/i18n/**`：两张表自己当然"含中文"（那是它们的**内容**），
 * 它们不是"待抽取的屏"。这一条与 `tests/i18n/module-scope-t.test.ts` 的
 * `I18N_PREFIX` 是同一条口径。
 */
const I18N_PREFIX = 'src/i18n/';

/**
 * 代码位里的**中文字符串/模板串字面量**（去重）。
 *
 * 口径与 `tests/ui/privacy-consumers.test.ts` 的字面量扫描器**同族**（那份是它自己的第三份
 * 实现，本仓有先例）：先 `stripComments`，再按引号切。这里只需要"有没有汉字"，
 * 不需要区分单双引号，所以实现更短。
 */
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
      if (/[\u3400-\u9fff]/.test(buf)) out.push(buf);
      continue;
    }
    i += 1;
  }
  return [...new Set(out)];
}

interface SrcFile {
  readonly rel: string;
  readonly literals: readonly string[];
}

/**
 * 真树上"含裸中文的 `src/**`（除 `src/i18n/**`）文件 → 去重后的中文字面量"。
 *
 * **导出的理由**：清单文档（`docs/2026-10-01-i18n-尚未抽取的屏.md`）里那张表的计数必须与
 * 这条腿**用同一个扫描器**数出来 —— 否则"计数"就是第二份真相（手抄一遍，必然会漂）。
 * 这份导出让那份表可以被机械地重数一遍（报告里的数字就是这么来的），
 * 也让人可以在 node 里一行命令打印当前全量。
 */
export function scanSrcLiterals(): readonly SrcFile[] {
  return SRC_FILES;
}

const SRC_FILES: readonly SrcFile[] = walkTs(join(REPO, 'src'))
  .sort()
  .map((abs) => ({
    rel: abs.slice(REPO.length).split('\\').join('/'),
    literals: cjkLiterals(stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8'))),
  }))
  .filter((f) => !f.rel.startsWith(I18N_PREFIX));

/**
 * 清单里登记的文件：从 markdown 表格里**带 `[ ]` 标记的行**生成式解析。
 *
 * ⚠️ 判据面是"**待办行**"，不是"文档里出现过的每个 `src/**.ts` 路径"：
 * 这份文档里还会在**散文与已完成记录**里提到文件名（例如 D4 那段"P0 只抽了 `src/ui/home.ts`
 * 的小窗"、C 轮那段"已抽取的两屏"），那些路径**不是登记行**，拿它们当"幽灵行/该删的行"都是假红。
 * 清单的语义本来就是"`[ ]` = 还没抽"，所以这里只收 `[ ]` 行。
 *
 * ★ 2026-10-02（P3 第八批）：路径口径从 `src/ui/…` 放开到 `src/…` —— 扩面之后
 * `src/main.ts` / `src/net/session.ts` / `src/app/*.ts` 这些也要能被登记（在那之前
 * 它们连"登记"这个动作都做不到）。
 */
const MANIFEST_TEXT = readFileSync(join(REPO, MANIFEST_REL)).subarray(0, 1024 * 1024).toString('utf8');
const MANIFEST_FILES: readonly string[] = [
  ...new Set(
    [...MANIFEST_TEXT.matchAll(/^\s*\|\s*\[ \]\s*\|\s*`(src\/[^`]+\.ts)`/gm)]
      .map((m) => m[1])
      // 文档里会出现 `src/ui/**\/*.ts` 这种**扫描面**的写法（不是一份具体文件）⇒ 它不是幽灵行
      .filter((p) => !p.includes('*')),
  ),
].sort();

/**
 * ★ 2026-10-02（P3 第八批）：**有意保留中文**的**目录**（登记理由 + 实测条数上限）。
 *
 * `max` 是**本轮实测**的去重中文字面量计数（同一个扫描器数的）。判据是"实际 ≤ max"：
 *  - 在那些目录里**新增**一条中文 ⇒ 计数涨过上限 ⇒ 报红；
 *  - 抽走几条 ⇒ 计数下降，照样绿（**白名单只准变短**）。
 *
 * 为什么这两个目录整目录保留（不是漏翻）：
 *  - `src/data/**`：卡面/协议/效果标记的**文案是数据**，被 `npm run texts:check`
 *    与联机卡文哈希逐字钉住；英文卡面走 P4 的**显示层翻译表**（按 `defId` 映射，渲染时替换）。
 *    见 `docs/2026-10-01-i18n-英文覆盖收口.md` A1 与那份清单 D 节。
 *  - `src/core/**`：引擎日志、效果标题（`prompt.title`）、trace 文本；它们进日志与联机协议，
 *    翻译要同时改**对端一致性口径**（红线文件，另一轮授权）。同上 A2/A3。
 */
const RETAINED_DIRS: readonly { readonly dir: string; readonly max: number; readonly why: string }[] = [
  {
    dir: 'src/data/',
    max: 879,
    why: '卡面/协议/效果标记文本是**数据**，被 npm run texts:check 与联机卡文哈希逐字钉住；英文卡面走 P4 显示层翻译表（按 defId 映射），数据一个字不动',
  },
  {
    dir: 'src/core/',
    max: 514,
    why: '引擎日志 / 效果标题（prompt.title）/ trace 文本；它们进日志与联机协议，翻译要同时改对端一致性口径（红线，另一轮授权）',
  },
];

/**
 * ★ 2026-10-02（P3 第八批）：**有意保留中文**的**具体文件**（同样"计数上限 + 理由"，只准变短）。
 *
 * 逐条登记的判据是"这个文件的中文**整体**属于哪一类有意保留"，不是"这个文件一律放行"：
 * 计数涨了（= 多出新的中文字面量）立刻报红，条目里那个文件掉到 0 条也要报红（该删条目了）。
 *
 * ⚠️ 与 `DEV_ONLY` 的分工：`DEV_ONLY` 是"**逐条**列出那几条字符串"（更强，用于只有几条的
 * 开发者串）；这里用于"整份文件都是同一类有意保留文本"的情形（逐条抄会制造第二份真相）。
 */
const RETAINED_FILES: Readonly<Record<string, { readonly max: number; readonly why: string }>> = {
  'src/app/privacy.ts': {
    max: 25,
    why: '隐私正文三段 + 首启向导第 3 步两个按钮：唯一出处，整句被 tests/app/privacy.test.ts 的 COPY_PINS 哈希钉死（任务红线：冻结）',
  },
  'src/app/match-replay.ts': {
    max: 18,
    why: '重放守卫的诊断串（`#g5probe=1` / 控制台读数），不是屏上文案',
  },
  'src/app/match-driver.ts': {
    max: 5,
    why: '重放看门狗的诊断串（进日志/自查读数，不是屏上文案）',
  },
  'src/net/protocol.ts': {
    max: 33,
    why: '线协议解码失败原因（开发者读数；进控制台与自查，不是屏上文案）',
  },
  'src/net/net-driver.ts': {
    max: 21,
    why: '联机驱动的诊断读数（进日志/自查，不是屏上文案）',
  },
  'src/net/fake-transport.ts': {
    max: 17,
    why: '测试用假件（fake transport）的诊断串，不进生产包',
  },
  'src/net/transport.ts': {
    max: 1,
    why: '传输层类型文件里的一条诊断说明串（不是屏上文案）',
  },
  'src/net/invite.ts': {
    max: 4,
    why: '调用方违约异常（throw）：玩家可见的邀请码文案已走 `net.*` 键（见 tests/net/invite.test.ts），剩下的是接线错误',
  },
  'src/tutorial/judge.ts': {
    max: 4,
    why: '引擎日志串（与 src/core/** 同族：教学里**引用**它，翻译要改引擎口径）',
  },
  'src/tutorial/types.ts': {
    max: 2,
    why: '教学类型文件里的两条标记串（引擎口径，同 src/core/**）',
  },
};

/**
 * 判为"**已经抽干净**"的例外 —— 必须同时满足下面两条，缺一条就报红：
 *
 *  1. 它的文件路径在清单里被**显式标注**为"干净/特例"（本文件用 `CLEAN_DECLARED` 写死，
 *     并在清单 D 节里说明理由）；
 *  2. 它剩下的中文字面量**逐条**都能在 `zh.ts` 的**值**里找到（= 它只是那份文案的
 *     数据源/文档字段，不是散落的第二份中文）。
 *
 * `src/ui/fx-settings.ts` 是这一档的第一个：P0 把它的 label/desc 降级成**文档字段**，
 * 值必须与中文表逐字相同（`tests/i18n/settings-overlay.test.ts` 另有一条腿三方对齐）。
 *
 * ★ 2026-10-02（P3 第二批）：`src/ui/cardmaker/page.ts` 也进了这一档。
 * 它剩下的**三条**中文字面量（`CREDIT.license` / `CREDIT.sentence` / `PANEL_EMPTY_HINT`）
 * 是**有意留成纯数据的常量**：一旦在模块作用域写 `t()`，语言就被冻在 import 那一刻
 * （那是个真 bug，本轮实测抓到过）。屏上那三处都走渲染点的 `t('cardmaker.page.…')`
 * ⇒ 这三条与表里的值逐字相同，**不是**第二份中文。
 * 上面那条腿同样适用于它：将来 page.ts 里多出**任何**一条新的中文字面量 ⇒ 立刻报红。
 */
const CLEAN_DECLARED: readonly string[] = ['src/ui/fx-settings.ts', 'src/ui/cardmaker/page.ts'];

/**
 * ★ 2026-10-01（C）：**已经抽干净、但代码位里还剩"非玩家可见"字符串**的文件。
 *
 * 逐条**列出那些字符串**（不是"这个文件一律放行"）：清单①的判据面只扣掉这里点名的那几条，
 * 将来同一文件里多出**任何**一条新的中文字面量 ⇒ 立刻回到"必须登记"的判据面里。
 *
 * 现在只有一条，来自 `src/ui/home.ts`：`renderCoin` 的**用法错误**（热座那条路没给 `nav.seed`
 * 时抛的异常消息）—— 它进的是开发者控制台，不是玩家可见文案，所以不进文案表。
 */
const DEV_ONLY: Readonly<Record<string, readonly string[]>> = {
  'src/ui/home.ts': ['renderCoin：热座这条路必须给 nav.seed（联机那条路要写 nav.net 分支）。'],
  /**
   * ★ 2026-10-02（P3 第二批）：`src/ui/pwa-update.ts` 的**唯一**残留。
   *
   * `onCacheIncomplete` 的默认实现往**开发者控制台**报一句 `[PWA] 离线预缓存未完成：…` ——
   * 它不是屏上的文案（`PwaEnv.onCacheIncomplete` 的注释写着它是"install 失败不静默"的出口），
   * 所以不进文案表。条目、文件（`pwa-update.ts`）与理由并排列在这里：
   * 同一文件里**再出现任何新的中文字面量**都会立刻回到"必须登记"的判据面里。
   * 这一档与 `home.ts` 那条同族（P0 的 `renderCoin` 用法错误）。
   */
  'src/ui/pwa-update.ts': ['[PWA] 离线预缓存未完成：${reason}'],
  /**
   * ★ 2026-10-02（P3 第五批）：`src/ui/net-browser.ts` 抽完 80 条之后剩的**三条**。
   *
   * 它们全是 `throw new Error(...)`，即**调用方违约**那一类**开发者异常**，不是玩家可见文案：
   *  1. `defaultEnv().compressionStream.run()` 里"这台设备没有压缩流能力（缺少 CompressionStream…）"
   *     —— 缺省实现**故意不吞**构造/运行异常（见那里的注释），它由 `probeCompressionFormat` /
   *     `compressBytesWithFormat` / `decompressBytes` 各自的 `try` 接住并翻成人话；
   *  2. 同一处的"这台设备缺少把字节喂进压缩流所需的两个内置对象。"（同上）；
   *  3. `browserRandomness()` 的"这台设备拿不到随机源（安全上下文才提供它），无法生成房间码。"
   *     —— 没有随机源就**抛错**是刻意的（不许悄悄退化成一个可预测的码），
   *     而"宿主没给 crypto"是接线错误、不是屏上的状态。
   *
   * 与 `home.ts` 的 `renderCoin` 用法错误、`pwa-update.ts` 的控制台串同族 ⇒ 有意留中文。
   * 同一文件里**再出现任何新的中文字面量**都会立刻回到"必须登记"的判据面里。
   */
  'src/ui/net-browser.ts': [
    '这台设备没有压缩流能力（缺少 CompressionStream，格式 ${read.format}）。',
    '这台设备缺少把字节喂进压缩流所需的两个内置对象。',
    '这台设备拿不到随机源（安全上下文才提供它），无法生成房间码。',
  ],
  /**
   * ★ 2026-10-02（P3 第八批）：`src/main.ts` 抽完联机交接提示那一族之后剩下的**21 条**。
   *
   * 它们**不是** `.net-lobby-notice` 那一族玩家可见的提示（那一族已经走
   * `main.notice.*` / `main.lobby-link.*` 键，且下面第 ① 条腿盯的就是"剩下的只有这里列的这些"）。
   * 剩下的分三类：
   *  - **`#g5probe=1` 探针读数**（`${text.slice(0, 400)}…（共 … 字）` / `(没配)` / `这一条没产出来`）；
   *  - **调用方违约异常**（`:2008` 宿主没给 `crypto` 就抛；与 `net-browser.ts` 那三条同族）；
   *  - **游戏内日志 / 控制台串**（`trace('动作' | '步骤', …)`、`[行动结算异常]`、`[重放] …`）
   *    与**写进档案的数据字段** `result.reason`（`:4240`：跟着语言走会让同一份档案在不同语言下
   *    指纹不同 ⇒ 有意留中文）。
   *
   * 逐条列出（不是"这个文件一律放行"）：同一文件里**再出现任何新的中文字面量** ⇒ 立刻报红。
   * ⚠️ 带 `${…}` 的是**模板串原文**（扫描器按原文比对，不是渲染结果）。
   */
  'src/main.ts': [
    '${text.slice(0, 400)}…（共 ${text.length} 字）',
    '(没配)',
    '这一条没产出来',
    '这台设备拿不到随机源（安全上下文才提供它），联机会话开不起来。',
    '对局结束：胜负由引擎判定',
    '动作',
    'P${player + 1} 行动 kind=${a.kind} args=${JSON.stringify(a)} | 前：${stateDigest(state)}',
    'P${player + 1} 持有控制组件：编译线 ${line + 1} 前可重排一名玩家的协议（组件已归还中立）',
    '完成，编译线 ${line + 1}',
    'P${player + 1} 持有控制组件：补满手牌前可重排一名玩家的协议（组件已归还中立）',
    '完成，补满手牌',
    '[行动结算异常]',
    '行动结算异常：${err instanceof Error ? err.message : String(err)}',
    '错误',
    '行动结算异常 kind=${a.kind}：${err instanceof Error ? ',
    '状态',
    '异常后状态：${stateDigest(state)}',
    'P${player + 1} 行动结束 kind=${a.kind} | 后：${stateDigest(state)}',
    '[重放] 这份档案不能重放：',
    '步骤',
    '阶段变化：${lastPhase} → ${state.phase} | ${stateDigest(state)}',
  ],
  /**
   * ★ 2026-10-03：`src/tutorial/setup.ts` 的**唯一**一条中文残留。
   *
   * `opponentProtocols()` 里那句 `throw new Error('DEMO_PROTOCOLS 里凑不出三套与玩家不重名的协议')`
   * —— 它是**调用方/数据违约**那一类开发者异常（数据集中凑不出三套不重名的协议才会走到），
   * 不是玩家可见文案：玩家永远看不到它，屏上也不会出现它。
   * 与 `net-browser.ts` / `main.ts` 的 `throw` 那几条同族 ⇒ 有意留中文，逐字登记。
   * 同一文件里**再出现任何新的中文字面量**都会立刻回到"必须登记"的判据面里。
   */
  'src/tutorial/setup.ts': ['DEMO_PROTOCOLS 里凑不出三套与玩家不重名的协议'],
};

describe('★ 尚未抽取的屏：清单只能变短，不能变长（扫描面 = src/**）', () => {
  it('锚点：扫描器真的在工作（既扫得到中文，也不把注释算进去）', () => {
    const withChinese = SRC_FILES.filter((f) => f.literals.length > 0).map((f) => f.rel);
    // ★ 2026-10-02（P3 第八批）：扫描面从 src/ui/** 扩到 src/**（减去 src/i18n/**）
    //   ⇒ 文件总数从几十涨到几百。下界跟着实测数走，判据的意图（"真的读到了树"）没变。
    expect(SRC_FILES.length, 'src 下一个 .ts 都没读到 ⇒ 路径写错').toBeGreaterThan(150);
    expect(withChinese.length, '含中文的 src 文件太少 ⇒ 扫描器失效').toBeGreaterThan(40);
    // 反向锚点：i18n 那一层确实被排除在外（两张表自己"含中文"是内容，不是待抽的屏）
    expect(SRC_FILES.some((f) => f.rel === 'src/i18n/zh.ts'), 'i18n 层没有被排除').toBe(false);
    // 扫描面确实扩到了非 ui 的目录（否则下面那些白名单是空判据）
    expect(SRC_FILES.some((f) => f.rel === 'src/main.ts'), 'src/main.ts 不在扫描面里').toBe(true);
    expect(SRC_FILES.some((f) => f.rel.startsWith('src/net/')), 'src/net/** 不在扫描面里').toBe(true);
    expect(SRC_FILES.some((f) => f.rel.startsWith('src/app/')), 'src/app/** 不在扫描面里').toBe(true);
    // ★ 这一屏抽完之后**不许**再出现在"含中文"的名单里（否则"抽干净了"是自我声明）
    expect(withChinese, 'local-consent.ts 的代码位里又出现中文字面量了').not.toContain('src/ui/local-consent.ts');
    // 抽过的那一屏必须**不再**出现裸中文：设置小窗原来是"造元素时直接写中文字面量"，
    // P0 之后它的每一条都从表里取 ⇒ 这里断言"构造器体内不再有中文字面量"。
    const homeSrc = readFileSync(join(REPO, 'src', 'ui', 'home.ts')).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const overlayBody = functionBody(stripComments(homeSrc), 'settingsOverlayElement');
    expect(overlayBody.length, 'functionBody 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(400);
    expect(
      cjkLiterals(overlayBody),
      `设置小窗的构造器里还有裸中文字面量：${cjkLiterals(overlayBody).join(' / ')}`
      + '（它的每一条文案都应该从 `src/i18n/` 取）',
    ).toEqual([]);
    // ★ 2026-10-01（C）：首页那一屏也抽完了 ⇒ 这条锚点从"home.ts 还有 90 多条中文"
    //   升级成**更强**的判据：`home.ts` 的代码位里不该再剩玩家可见的中文字面量。
    //   ⚠️ 白名单只有一条：`renderCoin` 的**用法错误**（开发者看的异常消息，不是玩家可见文案）。
    const home = SRC_FILES.find((f) => f.rel === 'src/ui/home.ts');
    const strays = (home?.literals ?? []).filter((s) => !s.includes('nav.seed'));
    expect(
      strays,
      `home.ts 的代码位里还有中文字面量（首页那一屏应当已经抽干净）：${strays.join(' / ')}`,
    ).toEqual([]);
    // 反向自证：扫描器对这个文件不是恒空 —— 它仍然扫得到那条开发者异常消息
    expect(home?.literals, '扫描器对 home.ts 已经什么都扫不到了 ⇒ 上面那条"抽干净了"是废话')
      .toContain('renderCoin：热座这条路必须给 nav.seed（联机那条路要写 nav.net 分支）。');
    // 反控：注释里的中文不算（`stripComments` 生效）
    expect(cjkLiterals(stripComments('// 这是注释里的中文\nexport const a = 1;'))).toEqual([]);
    expect(cjkLiterals("export const a = '中文';")).toEqual(['中文']);
  });

  it('清单解析自检：真的解析到了那些行（否则下面两条判据在空集合上恒真）', () => {
    expect(MANIFEST_FILES.length, '清单里一个 src 路径都没解析到').toBeGreaterThan(10);
    // ★ 2026-10-02（P3 第二批）：`net-lobby.ts` 抽完 ⇒ 锚点换成**还在待办表里**的两屏
    //   （红线屏 `render.ts` / `render-net.ts`）。前一版的锚点就是 `net-lobby.ts`，
    //   它抽干净之后按"清单只准变短"的规矩从表里删掉了。
    expect(MANIFEST_FILES).toContain('src/ui/render.ts');
    expect(MANIFEST_FILES).toContain('src/ui/render-net.ts');
    // ★ 2026-10-01（C）：`home.ts` / `local-data.ts` 抽完 ⇒ **已经不在**待办行里（清单只准变短）
    expect(MANIFEST_FILES, '抽完的屏还挂在待办行里').not.toContain('src/ui/home.ts');
    expect(MANIFEST_FILES, '抽完的屏还挂在待办行里').not.toContain('src/ui/local-data.ts');
    // ★ 2026-10-02（P3 第二批）：这一批抽完的屏同样不许留在待办行里
    expect(MANIFEST_FILES, '抽完的屏还挂在待办行里').not.toContain('src/ui/net-lobby.ts');
    expect(MANIFEST_FILES, '抽完的屏还挂在待办行里').not.toContain('src/ui/cardmaker/page.ts');
    expect(MANIFEST_FILES, '抽完的屏还挂在待办行里').not.toContain('src/ui/feedback-screen.ts');
    expect(MANIFEST_FILES, '抽完的屏还挂在待办行里').not.toContain('src/ui/onboarding.ts');
    // ★ 2026-10-02（P3 第八批）：本轮抽完的三族同样不许留在待办行里（清单只准变短）
    expect(MANIFEST_FILES, '抽完的文件还挂在待办行里').not.toContain('src/main.ts');
    expect(MANIFEST_FILES, '抽完的文件还挂在待办行里').not.toContain('src/net/session.ts');
    expect(MANIFEST_FILES, '抽完的文件还挂在待办行里').not.toContain('src/app/match-file.ts');
    expect(MANIFEST_FILES, '抽完的文件还挂在待办行里').not.toContain('src/app/archive-io.ts');
    // 反向锚点：那两屏在**文档正文**里仍然被提到（"已完成"记录），所以这个空不是"文档塌了"
    expect(MANIFEST_TEXT, '文档里连"已抽取的两屏"那段都没有了').toContain('已抽取');
  });

  it('① 每一个含中文的 `src/**` 文件都登记过（新屏/新文件没登记 ⇒ 报红）', () => {
    // ★ 2026-10-01（C）：判据面扣掉"**已经抽干净、只剩开发者字符串**"的白名单 ——
    //   见 `DEV_ONLY` 的说明（那是"非玩家可见"的例外，逐条列着，不是"这类文件一律放行"）。
    // ★ 2026-10-02（P3 第八批）：再扣掉"有意保留中文"的目录/文件白名单（`RETAINED_*`）。
    const retained = (rel: string): boolean =>
      RETAINED_DIRS.some((d) => rel.startsWith(d.dir)) || Object.prototype.hasOwnProperty.call(RETAINED_FILES, rel);
    const missing = SRC_FILES
      .filter((f) => f.literals.some((s) => !DEV_ONLY[f.rel]?.includes(s)))
      .map((f) => f.rel)
      .filter((rel) => !MANIFEST_FILES.includes(rel) && !CLEAN_DECLARED.includes(rel) && !retained(rel));
    expect(
      missing,
      '以下文件里有裸中文字面量，但**没有**登记进 `' + MANIFEST_REL + '`：\n'
      + missing.map((m) => `  - ${m}`).join('\n')
      + '\n处置：要么把该处抽进 `src/i18n/`（抽完把它的行划掉），要么先把它登记进清单；'
      + '若属于"有意保留中文"（数据/引擎/开发者串/冻结文本），登记进本文件的 `RETAINED_*` / `DEV_ONLY` 并写清理由。',
    ).toEqual([]);
  });

  it('② 清单里不许有幽灵行（表里指的文件必须真的存在）', () => {
    const known = new Set(SRC_FILES.map((f) => f.rel));
    const ghosts = MANIFEST_FILES.filter((rel) => !known.has(rel));
    expect(ghosts, `清单里这些行指向不存在的文件：${ghosts.join(', ')}`).toEqual([]);
  });

  it('③ 清单里**不含中文**的文件不许被登记成"待抽"（划掉之后要把那一行也拿走）', () => {
    // 反向：一个已经抽干净的文件若还留在清单里，那"清单只能变短"就没有判据面 ——
    // 谁都可以把抽完的屏留在表里假装还没做。这里要求：表里的文件要么还有中文，
    // 要么在 `CLEAN_DECLARED` 里（那种文件在 D 节里说明理由）。
    const wrong = SRC_FILES
      .filter((f) => f.literals.length === 0 && MANIFEST_FILES.includes(f.rel) && !CLEAN_DECLARED.includes(f.rel))
      .map((f) => f.rel);
    // ⚠️ 这一条**当前允许**"已划掉但没删行"的中间态：清单里用 `[x]` 标注的行是"已抽取但保留
    //    记录"。所以它只对"代码位里一个中文都没有"的文件报红 —— 那种文件留在 A/B 表里
    //    说明那一行忘了划、也忘了删。
    expect(
      wrong,
      `这些文件已经没有裸中文了，却还登记在清单里：${wrong.join(', ')}。`
      + '抽完就该把那一行连同计数一起删掉（清单只准变短）。',
    ).toEqual([]);
  });

  it('④ "干净"例外必须自证：它的中文字面量逐条都来自 `zh.ts` 的值', () => {
    const zhValues = new Set(Object.values(ZH));
    for (const rel of CLEAN_DECLARED) {
      const f = SRC_FILES.find((x) => x.rel === rel);
      expect(f, `CLEAN_DECLARED 里的 ${rel} 不在扫描面里（幽灵例外）`).toBeDefined();
      expect(f?.literals.length, `${rel} 被判为"干净"却一个中文都没有 ⇒ 这条例外该删了`)
        .toBeGreaterThan(0);
      const strays = (f?.literals ?? []).filter((s) => !zhValues.has(s));
      expect(
        strays,
        `${rel} 被判为"干净"，但这些中文字面量不在 \`zh.ts\` 的值里（= 散落的第二份文案）：`
        + `${strays.join(' / ')}`,
      ).toEqual([]);
    }
  });

  it('⑤ ★ 有意保留的白名单**只准变短**（计数不许涨；清空/消失的条目必须删掉）', () => {
    // 目录级：实际条数 ≤ 登记上限。新增一条中文 ⇒ 涨过上限 ⇒ 报红。
    for (const d of RETAINED_DIRS) {
      expect(d.why.length, `RETAINED_DIRS 里的 ${d.dir} 没写理由`).toBeGreaterThan(10);
      const files = SRC_FILES.filter((f) => f.rel.startsWith(d.dir));
      expect(files.length, `RETAINED_DIRS 里的 ${d.dir} 一个文件都没扫到 ⇒ 路径写错`).toBeGreaterThan(0);
      const n = files.reduce((acc, f) => acc + f.literals.length, 0);
      expect(
        n,
        `${d.dir} 的去重中文字面量从登记的 ${d.max} 涨到 ${n} —— 白名单只准变短：`
        + '要么把新增的那几条抽进 `src/i18n/`，要么（确属有意保留时）单独登记它并写清理由。'
        + `登记理由：${d.why}`,
      ).toBeLessThanOrEqual(d.max);
    }
    // 文件级：同上，另外"掉到 0 条"的条目必须删掉（它已经不再是有意保留的中文文件了）。
    for (const [rel, entry] of Object.entries(RETAINED_FILES)) {
      expect(entry.why.length, `RETAINED_FILES 里的 ${rel} 没写理由`).toBeGreaterThan(10);
      const f = SRC_FILES.find((x) => x.rel === rel);
      expect(f, `RETAINED_FILES 里的 ${rel} 不在扫描面里（幽灵例外）`).toBeDefined();
      expect(
        f?.literals.length ?? 0,
        `${rel} 的去重中文字面量从登记的 ${entry.max} 涨到 ${f?.literals.length} —— 白名单只准变短`
        + `（新增的中文要么抽进 src/i18n/，要么逐条登记）。登记理由：${entry.why}`,
      ).toBeLessThanOrEqual(entry.max);
      expect(
        f?.literals.length ?? 0,
        `${rel} 已经没有中文字面量了 ⇒ 这条例外该删掉（白名单只准变短，别留一条自我声明）`,
      ).toBeGreaterThan(0);
    }
    // 一件事只登记一次：不在清单待办行里、也不在 DEV_ONLY / CLEAN_DECLARED 里的文件才用 RETAINED_*
    const dup = Object.keys(RETAINED_FILES).filter((rel) => MANIFEST_FILES.includes(rel));
    expect(dup, `这些文件同时在"待抽清单"与"有意保留白名单"里（一件事登记了两遍）：${dup.join(', ')}`)
      .toEqual([]);
  });

  it('清单文件本身存在且说明了口径（不是一张光秃秃的表）', () => {
    expect(MANIFEST_TEXT.length, '清单文件是空的').toBeGreaterThan(1000);
    for (const anchor of ['只准变短', 'src/data/cards', '显示层翻译表']) {
      expect(MANIFEST_TEXT, `清单里没有说明「${anchor}」这一条口径`).toContain(anchor);
    }
    // ★ 2026-10-02（P3 第八批）：扩面之后的那三族与新的白名单口径必须在台账里写清
    for (const anchor of ['src/main.ts', 'src/net/session.ts', 'src/app/match-file.ts', '有意保留']) {
      expect(MANIFEST_TEXT, `台账里没有说明「${anchor}」这一条`).toContain(anchor);
    }
  });
});
