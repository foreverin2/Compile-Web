import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * **G4 收口文档的结构守卫**（Task 7）。
 *
 * ## 为什么要给一份 markdown 写测试
 *
 * 与 `tests/docs/g3-docs-guard.test.ts` 同一条理由：本仓已因"外部保存把文档静默覆盖回旧版"建过一次
 * 同款守卫；收口文档是**上下文压缩后接 G5 的人唯一的入口**（它自述"只需要读 §0/§3/§5/§6"），
 * 被回滚 = 交接失效，而四道门禁**全绿**（测试不看文档）。
 *
 * ## ⚠️ 判据形态：**行首锚定**，不是 `plan.includes(s)`
 *
 * G3 的守卫在 §4.4 ⑲ 栽过一次**假绿**：它的"必备章节齐全"腿写成 `required.filter((s) => !plan.includes(s))`，
 * 而**同一份计划自己的正文里逐字列着那一串章节名**（"把关键章节 … 钉住"）⇒ `includes` 被那句引用满足，
 * 把整节删掉**判据仍然绿**。实测（G3 的变异 M5）在 `includes` 版本下**不掉腿**，改成行首锚定后立刻变红。
 *
 * ⇒ 本文件的判据一律 `new RegExp('^' + esc(s), 'm')`（**行首的标题**才算数），
 * 并**照 G3 的补救**配一条**反控腿**：把标题行换掉、**只把章节名留在正文引用里**，也必须报红。
 * 本文件自己的正文里就逐字引用着那些章节名（下面是 REQUIRED_SECTIONS 的注释），
 * 所以这条反控**不是形式**：换成 `includes` 它一定立刻失效。
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
 * ⚠️ 这一串下面**逐字出现在本文件的注释里**（以及文档 §0 的"已知缺口 13 条在 §3"这类正文引用里）
 * ⇒ 任何 `includes` 形态的判据都会被这些引用满足。这正是下面那条反控腿要吃掉的形态。
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

/** 结构判据的**纯函数形态**（正控/反控要喂合成文档，因此不能直接闭包真文件） */
function missingSections(doc: string): string[] {
  return REQUIRED_SECTIONS.filter((s) => !new RegExp(`^${escapeRe(s)}`, 'm').test(doc));
}

/**
 * 11 条方法学教训的**编号 + 标题**（逐条，含第 11 条那个插在第 4/5 条之间的特例）。
 *
 * 为什么是"编号 + 标题"而不是只钉标题：标题可能被润色，编号是**引用锚点**
 * （§0 与跨批文件 §0 都用"第 1/2/11 条"来指路）。两半都钉 ⇒ 引用不会悄悄指向别的教训。
 * ⚠️ **第 11 条在文档里的物理位置在第 4 条之后**（计划原文如此），本判据**不管顺序**（只判存在）——
 * 顺序是无意还是有意都可能变，钉顺序只会制造假红。
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

/** §5 的接口面：G5 必须照抄的名字（少一个，下一个人就会重新发明一份） */
const INTERFACE_NAMES = [
  'MatchDriver',
  'acceptsInput',
  'SubmitRefusal',
  "'read-only'",
  'recordedTicker',
  'Ticker',
  'settling.ts',
  'MatchFile',
  'MatchFileRecorder',
  'stateAfterDraft',
  'applyRecordedAction',
  'createReplayDriver',
  'SCENARIOS',
  'browser-truth-probe.js',
];

describe('G4 收口文档的结构守卫（防止被静默覆盖回旧版 / 防止交接面缺项）', () => {
  it('锚点：文档真的读到了（否则下面每条判据都在空串上恒真）', () => {
    expect(DOC.length, '收口文档读成空串或不存在').toBeGreaterThan(20_000);
    expect(DOC, '正文里至少要有一处缺口编号').toContain('**① devmode 旁路未');
  });

  it('必备章节齐全（**行首锚定**，不是 includes）', () => {
    const missing = missingSections(DOC);
    expect(missing, `缺少章节：\n${missing.join('\n')}`).toEqual([]);
  });

  it('判据自证（正控 + 反控）：删章节必被点名；只删标题、留下正文引用也必须被点名', () => {
    // 正控①：整节（含所有出现）替换掉 ⇒ 必须点名
    for (const s of ['## 3. 已知缺口清单', '## 5. 下阶段（G5）的接口面'] as const) {
      const gutted = DOC.split(s).join('## 被删掉了');
      expect(gutted, `正控构造失败：${s} 没被替换掉`).not.toBe(DOC);
      expect(missingSections(gutted), `删掉「${s}」竟然没被点名`).toContain(s);
    }
    // ★ 反控（G3 §4.4 ⑲ 的教训）：**只把标题行换掉、正文里仍然提到那个章节名** ⇒ 行首锚定必须仍然报红。
    //    ⚠️ 反控的构造**不能用** `DOC.replace(s, …)`：那样会把**所有**出现（含 §0 正文里的引用）
    //       一起换掉，于是"正文引用仍在"这一条前提不成立 ⇒ 反控会**假红**（第一版就栽在这里）。
    //       ⇒ 用带 `^…$` 行锚的正则，**只换行首那一行标题**。
    const headingOnlyRemoved = DOC.replace(/^## 3\. 已知缺口清单.*$/m, '## （换个标题）');
    expect(headingOnlyRemoved, '反控构造失败：标题行没被替换').not.toBe(DOC);
    expect(
      DOC.split('## 3. 已知缺口清单').length - 1,
      '反控前提失效：正文里应当还有 ≥2 处提到这个章节名（§0 + §6.3），否则这条反控与 includes 版无从区分',
    ).toBeGreaterThanOrEqual(2);
    expect(headingOnlyRemoved, '反控构造失败：正文里的引用应当仍在').toContain('## 3. 已知缺口清单');
    expect(
      missingSections(headingOnlyRemoved),
      '只删标题、留下正文引用时判据假绿了（`includes` 回归 —— G3 §4.4 ⑲ 的同一形态）',
    ).toContain('## 3. 已知缺口清单');
    expect(missingSections('## 什么都没有\n'), '反控：空壳文档竟然被当成合格').toEqual([...REQUIRED_SECTIONS]);
  });

  it('11 条方法学教训的**编号 + 标题**都在（§0 与跨批文件 §0 靠编号指路）', () => {
    const missing: string[] = [];
    for (const [num, title] of LESSONS) {
      if (!DOC.includes(`### ${num}：`)) missing.push(`${num}（编号缺失）`);
      if (!DOC.includes(title)) missing.push(`${num}（标题缺失：${title}）`);
    }
    expect(missing, `方法学教训缺项：\n${missing.join('\n')}`).toEqual([]);
    // 正控（对应变异 D2）：把第 11 条的**编号锚**改掉 ⇒ 必须点名。
    // ⚠️ 这里**又踩了一次"自指"的坑**（与 G3 §4.4 ⑲ 同族，值得记下来）：
    //    · 第一次写 `broken.includes('### 第 11 条：') === false` ⇒ **假红**，因为本文件的
    //      §6.3 变异表里**逐字写着这个锚点**（正文引用，正确存在）；
    //    · 把表里那句改写成不含整串之后，**仍然剩一处** —— `String.replace(str, …)` 只换第一次，
    //      而文档里有两处带 `### ` 前缀的（真标题 + §6.3 的引用）。
    //    ⇒ 正确形态：**数它出现了几次、断言减少 1**（与缺口 ③ 的 `inert` 正控同一手法）。
    const headingBefore = DOC.split('### 第 11 条：').length - 1;
    const broken = DOC.replace('### 第 11 条：', '### 第十一条：');
    expect(broken, '正控构造失败：第 11 条的编号锚没被替换').not.toBe(DOC);
    expect(broken.split('### 第 11 条：').length - 1, '正控：替换后带该锚的标题必须少一个').toBe(headingBefore - 1);
    expect(broken.includes('### 第十一条：'), '正控：替换后的形态必须在').toBe(true);
  });

  it('已知缺口的关键条目都在（**逐条带事实性关键词**，不许只留标题）', () => {
    const missing: string[] = [];
    for (const [label, fact] of KEY_GAPS) {
      if (!DOC.includes(label)) missing.push(`${label}（条目标签缺失）`);
      if (!DOC.includes(fact)) missing.push(`${label}（事实关键词缺失：${fact}）`);
    }
    expect(missing, `已知缺口缺项：\n${missing.join('\n')}`).toEqual([]);
    // 正控：删掉缺口 ③ 的 `inert` 事实 ⇒ 必须点名（"只留标题"不算登记）
    //   ⚠️ 锚点取**与事实关键词同段**的那一小句（含 `**` 强调符）：`DOC.replace('没有 `inert`…')`
    //   会因为源码里是 `没有 **`inert`**` 而**什么都没换掉** ⇒ 正控假红（第一版实测）。
    //   ⚠️ 断言"`inert` **减少**"而不是"消失"：同一段后面还有一句"给 root 加 `inert` 会连控制条
    //   一起冻结"（那是**不可行性**的证据，不该被这次替换带走）。
    const inertBefore = DOC.split('`inert`').length - 1;
    const broken = DOC.replace('**没有 `inert`/`tabindex` 语义**', '**没有只读语义**');
    expect(broken, '正控构造失败：缺口 ③ 的事实关键词没被替换').not.toBe(DOC);
    expect(broken.split('`inert`').length - 1, '正控：替换后 `inert` 的出现次数必须减少').toBe(inertBefore - 1);
  });

  it('§5 的 G5 接口名都在（少一个，下一个人就会重新发明一份）', () => {
    const missing = INTERFACE_NAMES.filter((n) => !DOC.includes(n));
    expect(missing, `§5 缺接口名：${missing.join(', ')}`).toEqual([]);
    // 正控：删掉 `SubmitRefusal` ⇒ 必须点名
    const broken = DOC.split('`SubmitRefusal`').join('`被删掉了`');
    expect(broken, '正控构造失败：SubmitRefusal 没被替换').not.toBe(DOC);
    expect(INTERFACE_NAMES.filter((n) => !broken.includes(n)), '正控：替换后必须点名 SubmitRefusal').toContain('SubmitRefusal');
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
});
