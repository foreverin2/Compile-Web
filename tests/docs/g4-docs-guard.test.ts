import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * **G4 收口文档的结构守卫**（Task 7）。
 *
 * ## 为什么要给一份 markdown 写测试
 *
 * 与 `tests/docs/g3-docs-guard.test.ts` 同一条理由：本仓已因"外部保存把文档静默覆盖回旧版"建过一次
 * 同款守卫；收口文档是**上下文压缩后接 G5 的人唯一的入口**（它自述"只需要读 §0/§3/§5/§6"），
 * 被回滚 = 交接失效，而四道门禁**全绿**（测试不看文档）。
 *
 * ## 判据形态：**行首锚定**，不是 `plan.includes(s)`
 *
 * G3 的守卫在 §4.4 ⑲ 栽过一次**假绿**：它的"必备章节齐全"腿写成 `required.filter((s) => !plan.includes(s))`，
 * 而**同一份计划自己的正文里逐字列着那一串章节名** ⇒ `includes` 被那句引用满足，把整节删掉**判据仍然绿**。
 * 实测（G3 的变异 M5）在 `includes` 版本下**不掉腿**，改成行首锚定后立刻变红。
 * ⇒ 本文件的章节判据一律 `new RegExp('^' + esc(s), 'm')`（**行首的标题**才算数）。
 *
 * ## ⚠️ 本轮的第二次修正：**自证腿只喂纯函数合成样本**（一审阻断 3）
 *
 * 第一版把"正控/反控"写成**在真实文档上做 `replace` 再断言"构造成功"**：
 *
 * ```ts
 * const broken = DOC.replace('## 3. 已知缺口清单', '## 被删掉了');
 * expect(broken, '正控构造失败：锚点没被替换').not.toBe(DOC);   // ← 一旦 DOC 真被改坏，这里先炸
 * ```
 *
 * ⇒ **诊断错位**：当文档的**章节标题真被删/改**时（正是 D1 变异在做的事），这句"构造失败"先报警，
 * 而**真正该报的"缺哪个章节"被盖掉**；更糟的是那条唯一问"行首锚定 vs `includes`"的反控**根本没执行**
 * （一审实测：D1 的失败信息是"反控构造失败：标题行没被替换"）。
 *
 * ⇒ **修法（本轮）**：所有**自证/正控/反控**一律喂**纯函数的合成样本**（`missingSections('## 别的\n')`），
 * **绝不在真实文档上构造变异**；而"真实文档现在是否合格"由**它自己那一条腿**断言 ——
 * 于是文档真被改坏时报出来的是"**缺章节：…**"。两条路互不干扰，各自给对的诊断。
 *
 * ## 本文件不做什么
 *
 *  - **不**钉文档的哈希/字数（任何一次合法的修订都会报红；"防回滚"要的是**结构**仍在）。
 *  - **不**改文档（Task 7 的边界里文档是本任务的产物、但测试只读它）。
 *  - **不**钉 §2 的门禁数字（那会随树变化；数字的复现命令在文档 §6.1）。
 */

const DOC_PATH = fileURLToPath(new URL('../../docs/2026-09-17-G4-进度与上下文.md', import.meta.url));
const DOC = readFileSync(DOC_PATH).subarray(0, 2 * 1024 * 1024).toString('utf8');
/**
 * 必备章节（**行首的二级标题**才算）。
 *
 * ⚠️ 下面这几串也**逐字出现在本文件的注释、以及文档自身的正文引用里**
 * ⇒ 任何 `includes` 形态的判据都会被那些引用满足。这正是下面那条反控腿（用合成样本）要吃掉的形态。
 */
const REQUIRED_SECTIONS = [
  '# G4（会话层驱动 + 档案重放）进度与上下文 —— **收口文档**',
  '## 0. 一页速览（先读这一节）',
  '## 1. 任务 × 提交哈希 × 一行摘要',
  '## 2. 四道门禁 + 第五道门禁',
  '## 3. 已知缺口清单',
  '## 4. 方法学教训',
  '## 5. 下阶段（G5）的接口面',
  '## 6. 本波的自检',
  '## 7. 用户验收清单',
] as const;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 结构判据的**纯函数形态**。**所有自证腿都只喂合成样本**（见文件头注的"第二次修正"）：
 * 这个函数**不知道**真实文档长什么样 ⇒ 它在被测文档被改坏时**不会**先报"构造失败"。
 */
function missingSections(doc: string): string[] {
  return REQUIRED_SECTIONS.filter((s) => !new RegExp(`^${escapeRe(s)}`, 'm').test(doc));
}

/** `includes` 版（**只用于反控**：证明行首锚定与它真的不同，不是摆设） */
function missingSectionsByIncludes(doc: string): string[] {
  return REQUIRED_SECTIONS.filter((s) => !doc.includes(s));
}

/**
 * 11 条方法学教训的**编号 + 标题**（逐条）。
 *
 * 为什么是"编号 + 标题"而不是只钉标题：标题可能被润色，编号是**引用锚点**
 * （§0、跨批文件 §0、§3 缺口⑤ 都用"第 1/2/11 条"来指路）。两半都钉 ⇒ 引用不会悄悄指向别的教训。
 * ⚠️ **第 11 条在文档里的物理位置在第 4 条之后**（计划原文如此），本判据**不管顺序**（只判存在）。
 */
const LESSONS: ReadonlyArray<readonly [string, string]> = [
  ['第 1 条', '「不能区分世界」的探针不是判别器，只能配对使用'],
  ['第 2 条', '注释里宣称的"实测依据"必须与代码逐字相符'],
  ['第 3 条', '探针自身也会带 bug'],
  ['第 4 条', '「0 个测试看起来是绿的」这一族'],
  ['第 5 条', '边界纪律在"临时"两个字上最容易破'],
  ['第 6 条', '退出码必须避开管道测量'],
  ['第 7 条', '层叠问题只能'],
  ['第 8 条', '取证工具本身会给出'],
  ['第 9 条', '修守卫时，"修洞的动作本身"会静默失效'],
  ['第 10 条', '本机（Node v22 + Windows）的 `fs` 递归操作会硬崩 node'],
  ['第 11 条', '变异镜像会吃 Vite 的陈旧转换缓存'],
];

/** 教训的"编号 + 标题"缺陷清单（**纯函数**，自证腿喂合成样本）
 *  `only` = 只查某一条（合成样本只需满足那一条 —— 否则"合成一个齐全的文档"要求把 11 条都拼进去，
 *  那样正控就退化成"我拼的串我自己能查到"，反而更弱）。 */
function lessonDefects(doc: string, only?: string): string[] {
  const out: string[] = [];
  for (const [num, title] of LESSONS) {
    if (only !== undefined && num !== only) continue;
    if (!doc.includes(`### ${num}：`)) out.push(`${num}（编号缺失）`);
    if (!doc.includes(title)) out.push(`${num}（标题缺失：${title}）`);
  }
  return out;
}

/** 用于合成"合格文档"的**内容片段**（`only` 对应的那一条） */
function lessonSample(num: string): string {
  const hit = LESSONS.find(([n]) => n === num);
  if (!hit) throw new Error(`没有这条教训：${num}`);
  return `### ${hit[0]}：${hit[1]}\n`;
}

/**
 * 已知缺口里"删了就会让下一个人误判"的关键条目 = **条目标签的前缀 + 事实性关键词**。
 *
 * 为什么标签只钉**前缀**：标签会被合法地润色（加括号说明、加行号），逐字钉会制造假红；
 * 而"编号 + 主题"这两半是交接时的引用锚点（§0 用"已知缺口 13 条在 §3"指路）。
 * **事实关键词必须逐字**：那才是"不许只写标题"的牙（例如缺口 ③ 必须出现 `inert`）。
 */
const KEY_GAPS: ReadonlyArray<readonly [string, string]> = [
  ['**① devmode 旁路未', '`DevModeHost`'],
  ['**② 看门狗', '`diagnostic`'],
  ['**③ 第 17 条 (b)', '`inert`'],
  ['**④ 第 19 条的残留洞', '`cb.onAction` 外壳'],
  ['**⑤ "某条腿不红"的结论带保留', '在清缓存后重跑一遍之前不得采信'],
  ['**⑥ 判据 9 的正则形态缺口', '`const f = setTimeout;`'],
  ['**⑦ 节奏模型只模拟抽牌那一路 FX', '`revealFlyBusy` 只由文本腿钉住'],
  ['**⑧ M5', '防御性'],
  ['**⑨ `settling.ts`', '`Test-Path` = False'],
  ['**⑩ 游客模式"零写入"是 harness', '间谍 KV'],
  ['**⑪ 应用内"导入 → 重放这一局"', '第二份装配'],
  ['**⑫ 未开始**', '观战（**G7**）'],
  ['**⑬ 可选小项（已在本轮做掉）**', '说法 A'],
];

/** 缺口条目缺陷清单（**纯函数**，自证腿喂合成样本）。`only` 语义同 `lessonDefects` */
function gapDefects(doc: string, only?: string): string[] {
  const out: string[] = [];
  for (const [label, fact] of KEY_GAPS) {
    if (only !== undefined && label !== only) continue;
    if (!doc.includes(label)) out.push(`${label}（条目标签缺失）`);
    if (!doc.includes(fact)) out.push(`${label}（事实关键词缺失：${fact}）`);
  }
  return out;
}

/** 用于合成"合格文档"的**缺口片段**（`only` 对应的那一条） */
function gapSample(label: string, fact: string): string {
  return `${label}：只读 = 指针级只读。**\n事实：只截获**指针**，**没有 ${fact} 语义**\n`;
}

/**
 * §5 的接口面：G5 必须照抄的名字（少一个，下一个人就会重新发明一份）。
 * ⚠️ **每一个名字都必须在代码里真实存在** —— 这条由下面那条"名字 ↔ 代码"腿机械核对：
 * 第一版把那个**旧稿的错名**钉在这里，而全仓没有那个名字 ⇒ **守卫锁死了一个错误**
 * （真名 = `replayTicker`，见文档 §6.5 第 9 条）。
 *
 * ⚠️ **那个错名在本文件里以 `FORBIDDEN_NAME`（码点拼接）的形式出现，绝不写成整串**：写成整串的话，
 * 它就会**出现在文档/守卫文本里**，于是"那个错名必须零命中"这类断言会**自指假红**；
 * 更实际的是，变异 M7（把文档里的真名换成错名）会**因为守卫文本自己也有那个串而看起来无效**
 * （本轮实测踩过：D2/D3/M7 三条都报过"该红却没红"，根因都是**我在文档/守卫里又写了一遍那个字面量**）。
 * 用码点拼接 ⇒ 它的字节序列在全仓**真的**只可能来自一次笔误。
 */
const FORBIDDEN_NAME = String.fromCharCode(114, 101, 99, 111, 114, 100, 101, 100, 84, 105, 99, 107, 101, 114);
const INTERFACE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['MatchDriver', 'src/app/match-driver.ts'],
  ['acceptsInput', 'src/app/match-driver.ts'],
  ['SubmitResult', 'src/app/match-driver.ts'],
  ['MatchFileRecorder', 'src/app/match-file.ts'],
  ['Ticker', 'src/app/match-driver.ts'],
  // ★ 真名是 `replayTicker`（`src/main.ts:160`）；曾经错写成另一个**以 `recorded` 开头**的同形名字
  //   （全仓零命中；整串见 `FORBIDDEN_NAME`，**刻意不在这里写整串** —— 那会让本文件自己带进那个串）。
  ['replayTicker', 'src/main.ts'],
  ['settling.ts', 'src/app/settling.ts'],
  ['stateAfterDraft', 'src/app/match-replay.ts'],
  ['applyRecordedAction', 'src/app/match-replay.ts'],
  ['createReplayDriver', 'src/app/match-driver.ts'],
  ['SCENARIOS', 'tools/browser-truth-check.mjs'],
];

/** 递归收集某目录下的 `.ts` 源码（用来核对接口名真的存在） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const SRC_ALL = walkTs(fileURLToPath(new URL('../../src/', import.meta.url)))
  .map((p) => readFileSync(p).subarray(0, 2 * 1024 * 1024).toString('utf8')).join('\n');
// ⚠️ `readFileSync(<URL>)` 返回 **Buffer**（传 URL 时没有 `encoding` 重载）⇒ 后面的 `.toString('utf8')`
//    会被 `tsc` 判成 `TS2554: Expected 0 arguments, but got 1`（vitest 不做类型检查 ⇒ 它看不出来）。
//    所以这两处写成 **`Buffer.toString()` 的合法形态**：先取 Buffer，再显式 `.toString('utf8')` 一次。
const MAIN_BUF = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)));
const TOOLS_BUF = readFileSync(fileURLToPath(new URL('../../tools/browser-truth-check.mjs', import.meta.url)));
const MAIN_TS = MAIN_BUF.subarray(0, 8 * 1024 * 1024).toString('utf8');
const TOOLS_CHECK = TOOLS_BUF.subarray(0, 8 * 1024 * 1024).toString('utf8');

describe('G4 收口文档的结构守卫（防止被静默覆盖回旧版 / 防止交接面缺项）', () => {
  it('锚点：文档真的读到了（否则下面每条判据都在空串上恒真）', () => {
    expect(DOC.length, '收口文档读成空串或不存在').toBeGreaterThan(20_000);
    expect(DOC, '正文里至少要有一处缺口编号').toContain('**① devmode 旁路未');
  });

  it('必备章节齐全（**行首锚定**；文档真被改坏时，失败信息必须是"缺章节"）', () => {
    const missing = missingSections(DOC);
    expect(missing, `缺少章节（行首锚定的二级标题）：\n${missing.join('\n')}`).toEqual([]);
  });

  /**
   * **自证腿（正控 + 反控）—— 全部喂合成样本，绝不在真实文档上构造变异**（一审阻断 3 的修法）：
   * 文档真被改坏时，报的是上一条腿的"缺章节"，本腿**不受任何影响**（不会先报"构造失败"）。
   */
  it('判据自证（纯函数 · 正控 + 反控）：行首锚定与 `includes` 的差别被合成样本钉住', () => {
    // 正控 ①：齐全的合成文档 ⇒ 零缺陷。
    //   ⚠️ 合成样本里**必须**有一句**正文引用**（`详见 ## 3. 已知缺口清单`）—— 否则反控的
    //   "正文里的引用仍在"这个前提不成立，反控会变成"在空引用上断言"（第一版就这么写错了）。
    const ok = REQUIRED_SECTIONS.join('\n') + '\n正文：详见 ## 3. 已知缺口清单 与 ## 5. 下阶段（G5）的接口面。\n';
    expect(missingSections(ok), '正控：齐全的合成文档竟然报了缺章节').toEqual([]);
    // 正控 ②：整节删掉（所有出现都换掉）⇒ 必须点名它
    const gutted = ok.split('## 3. 已知缺口清单').join('## 被删掉了');
    expect(gutted, '正控构造失败：合成样本里的章节名没被替换').not.toBe(ok);
    expect(missingSections(gutted), '正控：删掉章节竟然没被点名').toContain('## 3. 已知缺口清单');
    // ★ 反控（**这条才是 G3 §4.4 ⑲ 的解药**）：**只删行首标题、把章节名留在正文引用里**
    //   ⇒ 行首锚定必须仍然点名；而 `includes` 版会**假绿**（被正文引用满足）——两半都断言，才叫钉住。
    const headingOnly = ok.replace(/^## 3\. 已知缺口清单$/m, '## （换个标题）');
    expect(headingOnly, '反控构造失败：合成样本的标题行没被替换').not.toBe(ok);
    expect(headingOnly, '反控构造失败：正文里的引用应当仍在').toContain('## 3. 已知缺口清单');
    expect(
      missingSections(headingOnly),
      '反控：只删标题、留下正文引用时**行首锚定**必须报红',
    ).toContain('## 3. 已知缺口清单');
    expect(
      missingSectionsByIncludes(headingOnly),
      '反控的另一半：`includes` 版在这种形态下**必须**假绿 —— 这正是 G3 §4.4 ⑲ 的成因，把它钉住',
    ).toEqual([]);
    // 空壳文档 ⇒ 全缺
    expect(missingSections('## 什么都没有\n'), '反控：空壳文档竟然被当成合格').toEqual([...REQUIRED_SECTIONS]);
  });

  it('11 条方法学教训的**编号 + 标题**都在（§0 与跨批文件 §0 靠编号指路）', () => {
    // ① **纯净态断言**（这条是承重的：文档真被改坏时，报出来的是"缺哪条教训"）
    const missing = lessonDefects(DOC);
    expect(missing, `方法学教训缺项：\n${missing.join('\n')}`).toEqual([]);
    // ② **自证腿（纯函数合成样本）**：改掉编号锚 ⇒ 点名"编号缺失"；只改标题 ⇒ 点名"标题缺失"。
    //    ⚠️ **一律喂合成样本**：若在真实 DOC 上做 `replace` 再断言"构造成功"，文档真被改坏时
    //    会先报"构造失败"、把"缺哪条"盖掉（一审阻断 3 的形态）。合成样本只用**这一条**做正控，
    //    所以对"我拼的串我自己能查到"的退化免疫（`only` 参数把检查面收到一条）。
    const L11 = LESSONS[10][0];
    const good = lessonSample(L11);
    expect(lessonDefects(good, L11), '正控：合成样本本身应当是合格的').toEqual([]);
    const brokenNum = good.replace(`### ${L11}：`, '### 第十一条：');
    expect(brokenNum, '正控构造失败：合成样本的编号锚没被替换').not.toBe(good);
    expect(lessonDefects(brokenNum, L11).join('\n'), '正控：改掉编号锚竟然没被点名').toContain('（编号缺失）');
    expect(lessonDefects(`### ${L11}：别的标题\n`, L11).join('\n'), '反控：改掉标题竟然没被点名').toContain('（标题缺失');
  });

  it('已知缺口的关键条目都在（**逐条带事实性关键词**，不许只留标题）', () => {
    // ① **纯净态断言**（承重：文档真被改坏时，报出来的是"缺哪个缺口/哪个事实关键词"）
    const missing = gapDefects(DOC);
    expect(missing, `已知缺口缺项：\n${missing.join('\n')}`).toEqual([]);
    // ② **自证腿（纯函数合成样本）**：删掉缺口 ③ 的 `inert` 事实 ⇒ 点名"事实关键词缺失"；
    //    只留标签 ⇒ 同样点名。**不在真实 DOC 上做 replace**（理由同上一条腿）。
    const G3 = KEY_GAPS[2][0];
    const inert = KEY_GAPS[2][1];
    const good = gapSample(G3, inert);
    expect(gapDefects(good, G3), '正控：合成样本本身应当是合格的').toEqual([]);
    const broken = good.replace(`没有 ${inert}`, '没有只读');
    expect(broken, '正控构造失败：合成样本里的事实关键词没被替换').not.toBe(good);
    expect(gapDefects(broken, G3).join('\n'), '正控：删掉事实关键词竟然没被点名').toContain('事实关键词缺失');
    expect(gapDefects(`${G3}\n`, G3).join('\n'), '反控：只留标签竟然没被点名').toContain('事实关键词缺失');
  });

  it('§5 的 G5 接口名都在文档里，且**逐个在代码里真实存在**（守卫不许锁死错名）', () => {
    // ① **文档侧**：每个接口名都要在文档里（变异 M7 把真名换成旧稿的错名时，这里报"文档缺哪个接口名"）
    const missingInDoc = INTERFACE_NAMES.filter(([n]) => !DOC.includes(n)).map(([n]) => n);
    expect(missingInDoc, `§5（及文档其它处）缺接口名：${missingInDoc.join(', ')}`).toEqual([]);
    // ② **反控：那个旧稿错名必须零命中**（它曾经被钉在守卫里 ⇒ 这条腿是"别再钉错名"的保险）。
    //    放到文档侧断言**之后**：这样 M7 的主要诊断是"缺接口名"，这条只是加固。
    expect(
      DOC.split(FORBIDDEN_NAME).length - 1,
      '文档里出现了那个旧稿错名（真名见 §5 的「注入时钟」行）',
    ).toBe(0);
    expect(MAIN_TS.split(FORBIDDEN_NAME).length - 1, 'main.ts 里出现了那个旧稿错名').toBe(0);
    // ★ **名字 ↔ 代码**（本轮新加，因为旧稿把那个错名钉住过 —— 见 `FORBIDDEN_NAME`）：
    //   每个名字必须在它该在的文件里至少出现一次 —— 否则守卫会把一次笔误固化成"契约"。
    const codeHits = (name: string, file: string): number => {
      const hay = file === 'src/main.ts' ? MAIN_TS
        : file === 'tools/browser-truth-check.mjs' ? TOOLS_CHECK
        : SRC_ALL;   // `src/app/**` 与 `src/**` 合起来（含 match-driver / match-replay / match-file）
      return hay.split(name).length - 1;
    };
    const missingInCode: string[] = [];
    for (const [name, file] of INTERFACE_NAMES) {
      if (file === 'src/app/settling.ts') {
        // 这个模块按 D1 **不存在** ⇒ 反向断言：文档必须写明它不存在（§3 缺口 ⑨ 登记的就是这件事）
        expect(DOC, 'settling.ts 那条缺口必须写明它不存在').toContain('`Test-Path` = False');
        continue;
      }
      if (codeHits(name, file) === 0) missingInCode.push(`${name}（${file} 里零命中）`);
    }
    expect(missingInCode, `§5 写了代码里不存在的名字（守卫会锁死错名）：\n${missingInCode.join('\n')}`).toEqual([]);
    // 正控：真名必须真存在（否则上面那套核对会退化成"什么都没查"）
    expect(MAIN_TS.split('replayTicker').length - 1, '正控前提：`replayTicker` 在 main.ts 里必须存在').toBeGreaterThan(0);
  });

  it('§3 与 §4 的**编号连续性**（缺条 = 登记被吞掉，而下一个人只会按编号找）', () => {
    // 缺口 ①..⑬ 逐个存在（编号是交接时的引用锚点）
    const gaps = ['**①', '**②', '**③', '**④', '**⑤', '**⑥', '**⑦', '**⑧', '**⑨', '**⑩', '**⑪', '**⑫', '**⑬'];
    const missing = gaps.filter((g) => !DOC.includes(g));
    expect(missing, `§3 缺这些缺口编号：${missing.join(' ')}`).toEqual([]);
    // 教训编号 第 1..11 条 逐个存在（§4；本章程靠编号被 §0 与跨批文件引用）
    const lessons = Array.from({ length: 11 }, (_, i) => `### 第 ${i + 1} 条：`);
    const missingLessons = lessons.filter((g) => !DOC.includes(g));
    expect(missingLessons, `§4 缺这些教训编号：${missingLessons.join(' ')}`).toEqual([]);
  });

  it('§1 的提交笔数三数自洽（43 = 14 + 29；且 T7 自己的提交必须出现在 §1.1）', () => {
    // 把"笔数"从散文里拉成可核对的形状：三个数都要在文档里，且 T7 的哈希在代码表里
    //（一审阻断 1：旧稿写 42 = 13 + 29，而 42 是**不含 T7 自己那笔**的口径 ⇒ 与 14 行对不上）
    expect(DOC, '§1 必须给出总笔数 43').toContain('G4 相关共 43 笔');
    expect(DOC, '§1.1 的标题必须写明 14 笔').toContain('### 1.1 代码提交（14 笔）');
    expect(DOC, '§1.2 的标题必须写明 29 笔').toContain('### 1.2 docs-only 提交（29 笔');
    expect(DOC, 'T7 自己的提交必须在 §1.1 里（否则 G5 找不到守卫与文档）').toContain('`5e14c9a`');
    // 正控：错的合成样本（13+29）不该满足本腿的三个串
    const synthBad = '共 42 笔\n### 1.1 代码提交（13 笔）\n### 1.2 docs-only 提交（29 笔';
    expect(synthBad.includes('G4 相关共 43 笔'), '正控：错的合成样本不该满足本腿').toBe(false);
    expect(synthBad.includes('### 1.1 代码提交（14 笔）'), '正控：错的合成样本不该满足本腿').toBe(false);
  });
});
