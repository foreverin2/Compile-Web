import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * G3 实现计划的**结构守卫**（Task 9）。
 *
 * ## 为什么要给一份 markdown 写测试
 *
 * 本仓已因"外部保存把文档静默覆盖回旧版"建过一次同款守卫
 * （`tests/docs/gen3-docs-guard.test.ts`，见计划 `:2840` 的记录）：计划文件是
 * **本阶段唯一的派工依据**（附录 A 是"任务 × 文件"速查表），它被回滚 = 派工边界失效，
 * 而四道门禁**全绿**（测试不看文档）。所以"关键章节还在不在"必须是可执行断言。
 *
 * ## 判据形态：**生成式**，不手写 Task 号清单
 *
 * Task 号的比对两边都从文档里**当场派生**：
 *  - `tableTasks` = File Structure 表里"归属任务"列（行尾那一格）出现的 Task 号；
 *  - `headingTasks` = 正文 `## Task N:` 标题里的 Task 号。
 * 手写一份 `[1,2,…,9]` 会在"新增 Task 10 但忘了写进 File Structure 表"时**假绿** ——
 * 本仓已因手写副本栽过两次（见 `tests/ui/source-text.ts:1-12`）。
 * 判据是**包含**（表里合并写的任务，如 Task 4 / 7 同行，不应报红），不是相等。
 *
 * ## 本文件不做什么
 *
 *  - **不**钉住计划的哈希/字数：那会让任何一次合法的计划修订都报红，
 *    而"防止被回滚"需要的是**结构**仍在，不是**字节**不变。
 *  - **不**改计划文件（Task 9 的边界里计划是**只读**）。
 */

const PLAN_PATH = fileURLToPath(new URL('../../docs/2026-09-16-G3-档案格式-实现计划.md', import.meta.url));
const PLAN = readFileSync(PLAN_PATH).subarray(0, 2 * 1024 * 1024).toString('utf8');

/**
 * 必备章节（含两个附录：附录 A 是"任务 × 文件"速查，被派工直接引用）。
 *
 * ⚠️ **必须是"行首标题"判据，不是 `plan.includes(s)`**（变异实测发现的假绿）：
 * Task 9 自己的正文（`:2840`）里逐字列着这一串章节名（"把本计划文件的关键章节
 * （`## Global Constraints` / `## 侦察结论` / … / `## 待用户裁决` / 每个 `## Task N`）钉住"），
 * 以及 Step 2 的示例代码里有一份 `required` 数组 —— 于是 **`includes` 版本被那句引用满足**：
 * 把 `## 待用户裁决` 整节删掉，`plan.includes('## 待用户裁决')` 仍然为真 ⇒ 判据**假绿**。
 * 实测：变异 M5（删该节）在 `includes` 版本下**不掉腿**，改成行首锚定后立刻变红。
 * ⇒ 章节的存在性只能由**行首的二级标题**证明（正文里的引用不算）。
 */
const REQUIRED_SECTIONS = [
  '# G3 档案格式 实现计划',
  '## Global Constraints',
  '## 侦察结论',
  '## File Structure',
  '## 用户验收',
  '## 明确不做',
  '## 待用户裁决',
  '## 附录 A',
  '## 附录 B',
] as const;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 结构判据的**纯函数形态**（正控要喂合成文档，因此不能直接闭包真文件） */
function missingSections(plan: string): string[] {
  return REQUIRED_SECTIONS.filter((s) => !new RegExp(`^${escapeRe(s)}`, 'm').test(plan));
}

/** 正文 `## Task N:` 的 Task 号（去重升序） */
function headingTasks(plan: string): number[] {
  return uniq([...plan.matchAll(/^## Task (\d+):/gm)].map((m) => Number(m[1])));
}

/** File Structure 表"归属任务"列（行尾那一格）里的 Task 号（去重升序） */
function tableTasks(plan: string): number[] {
  return uniq([...plan.matchAll(/\|\s*Task\s+(\d+)(?:[^|]*)\|\s*$/gm)].map((m) => Number(m[1])));
}

function uniq(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/** 每个 `## Task N` 段落（不含标题行） */
function taskSections(plan: string): string[] {
  return plan.split(/\n## Task /).slice(1);
}

/** 每个 Task 段落**必须**有的三段（标签只用于报错可读性） */
const REQUIRED_TASK_PARTS: ReadonlyArray<readonly [string, RegExp | string]> = [
  ['Files', /\*\*Files:\*\*/],
  ['依赖关系', '**依赖关系：**'],
  ['变异实测', /变异实测/],
];

/**
 * 逐段检查每个 Task 的必需要素，返回人可读的缺陷清单（空数组 = 全绿）。
 * 抽成纯函数是为了让正控能喂**合成/挖空的**计划文本（否则"删掉一段就必须红"这条没法自证）。
 */
function taskSectionDefects(plan: string): string[] {
  const out: string[] = [];
  for (const t of taskSections(plan)) {
    const title = t.slice(0, 40).split('\n')[0];
    for (const [label, pattern] of REQUIRED_TASK_PARTS) {
      const ok = typeof pattern === 'string' ? t.includes(pattern) : pattern.test(t);
      if (!ok) out.push(`Task ${title} 缺「${label}」`);
    }
  }
  return out;
}

describe('G3 实现计划的结构守卫（防止被静默覆盖回旧版）', () => {
  it('锚点：计划文件真的读到了（否则下面每条判据都在空串上恒真）', () => {
    expect(PLAN.length, '计划文件读成空串或不存在').toBeGreaterThan(50_000);
    expect(PLAN, '正文里至少要有一个 ## Task N').toContain('## Task 1:');
  });

  it('必备章节齐全', () => {
    const missing = missingSections(PLAN);
    expect(missing, `缺少章节：\n${missing.join('\n')}`).toEqual([]);
  });

  it('判据自证（正控）：删掉任一必备章节都必须被点名（这条腿证明上一腿不是恒真）', () => {
    for (const s of ['## 待用户裁决', '## File Structure', '## 附录 A']) {
      // ⚠️ 必须**全部**替换：Task 9 的正文（`:2840`）里逐字列着这些章节名，
      //    只替换第一次出现会改到那句引用、留下真标题 ⇒ 正控会"假红"（我第一版就这么写错了）
      const gutted = PLAN.split(s).join('## 被删掉了');
      expect(gutted, `正控构造失败：${s} 没被替换掉`).not.toBe(PLAN);
      expect(missingSections(gutted), `删掉「${s}」竟然没被点名`).toContain(s);
    }
    // 反控：**只把章节名留在正文引用里**（行首标题被换掉）也必须被点名 ——
    // 这正是上面那条"必须行首锚定"的理由，钉住它免得将来被改回 `includes`
    const headingOnlyRemoved = PLAN.replace(/^## 待用户裁决.*$/m, '## （换个标题）');
    expect(headingOnlyRemoved, '反控构造失败：标题行没被替换').not.toBe(PLAN);
    expect(headingOnlyRemoved, '反控构造失败：正文里的引用应当仍在').toContain('## 待用户裁决');
    expect(missingSections(headingOnlyRemoved), '只删标题、留下正文引用时判据假绿了（`includes` 回归）').toContain('## 待用户裁决');
    expect(missingSections('## 什么都没有\n'), '反控：空壳文档竟然被当成合格').toEqual([...REQUIRED_SECTIONS]);
  });

  it('每个 Task 都在（生成式：从 File Structure 表里的任务列派生，不手写 Task 号清单）', () => {
    const heads = headingTasks(PLAN);
    const tables = tableTasks(PLAN);
    expect(heads.length, '正文里至少要有一个 ## Task N').toBeGreaterThan(0);
    expect(tables.length, 'File Structure 表的"归属任务"列一条都没派生出来（正则与表形态脱节？）').toBeGreaterThan(0);
    // 允许"File Structure 里合并写的任务"（如 Task 4 / 7 同行）—— 因此判据是**包含**而非相等
    for (const t of heads) {
      expect(tables, `## Task ${t} 在 File Structure 表里没有任何归属行（派工速查表漏了它）`).toContain(t);
    }
    // 正控：合成文档里"表里有 1 但正文有 2" ⇒ 判据必须报红
    const synthOk = '| x | y | Task 1 |\n## Task 1: a\n';
    const synthBad = '| x | y | Task 1 |\n## Task 1: a\n## Task 2: b\n';
    expect(tableTasks(synthOk), '正控：合成表的 Task 号没被派生').toEqual([1]);
    expect(headingTasks(synthBad)).toEqual([1, 2]);
    expect(
      headingTasks(synthBad).filter((t) => !tableTasks(synthBad).includes(t)),
      '正控：合成文档里"正文多了一个 Task"竟然没被点出来',
    ).toEqual([2]);
  });

  it('每个 Task 都有「Files」「依赖关系」「变异实测」三段（不许交白卷）', () => {
    const tasks = taskSections(PLAN);
    expect(tasks.length, '一个 ## Task N 段落都没切出来（切分锚点失效）').toBeGreaterThan(0);
    expect(tasks.length, '## Task 段数与标题数不一致（结构被改坏了）').toBe(headingTasks(PLAN).length);
    expect(taskSectionDefects(PLAN), '有 Task 段落缺必需要素').toEqual([]);
    // 正控（对应变异 #6）：删掉 **Task 7** 的 `**依赖关系：**` 一行 ⇒ 必须点名那一段。
    // ⚠️ 锚点**不能**选 Task 9：Task 9 的正文里有一个代码块逐字写着 `'**依赖关系：**'`
    //    （就是上面那条判据的源码），替换掉真行之后那一处仍在 ⇒ 正控会"假绿"（第一版实测栽在这里）。
    //    换成 Task 7 的依赖关系行（正文里只此一处）。
    const anchor = '**依赖关系：** 依赖 Task 3/5/6';
    expect(PLAN.split(anchor).length - 1, '正控锚点假设失效：Task 7 的依赖关系行不是恰好 1 处').toBe(1);
    const gutted = PLAN.replace(anchor, '**依赖关系（被删了）：** 依赖 Task 3/5/6');
    expect(gutted, '正控构造失败：Task 7 的依赖关系行没被替换').not.toBe(PLAN);
    expect(taskSectionDefects(gutted).join('\n'), '正控：删掉 Task 7 的"依赖关系"竟然没被点出来').toContain('缺「依赖关系」');
  });

  it('隐私文案的位置被钉住（G3 的诚实性要求：§5.9 与 §8.1 都要有落点）', () => {
    expect(PLAN).toContain('§5.9');
    expect(PLAN).toContain('§8.1');
  });

  it('零依赖约束被逐字写进 Global Constraints', () => {
    expect(PLAN).toContain('零运行时依赖');
    expect(PLAN).toContain('禁止 `npm install`');
  });

  it('附录 A 的「main.ts 行区边界表」还在（Task 4/7/8 三方共用同一文件的唯一协调依据）', () => {
    expect(PLAN, 'main.ts 的行区边界表被删了 ⇒ 后续多方并行改 main.ts 必然互相覆盖').toContain('行区');
    expect(PLAN).toContain('`src/main.ts` 的三方改动边界');
    // ⚠️ 其中"谁都不许动 cb 与 rerender（G4 的收口范围）"这条是**跨阶段契约**，必须留在计划里
    expect(PLAN).toMatch(/`cb`[\s\S]{0,80}`rerender`/);
  });
});
