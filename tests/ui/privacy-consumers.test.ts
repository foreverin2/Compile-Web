import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from './source-text';
// `privacy.ts` 的**运行期导出面**（生成式枚举面；本文件只引用、不重写其中任何一句）
import * as privacyExports from '../../src/app/privacy';
// 整句哈希：复用仓内既有的 FNV-1a 64 位哈希（`src/core/fingerprint.ts`，底座是 `rng.ts` 的 `hash32`）。
// 零新依赖、纯整数运算 ⇒ 跨进程/跨机器稳定。
import { hash64 } from '../../src/core/fingerprint';

/**
 * G3 Task 9 追加守卫：**「消费方自己写一句隐私承诺」的生成式发现**。
 *
 * ## 为什么需要这一层（Task 5 修复轮 3 自陈的残余风险）
 *
 * 修复轮 3 把授权弹窗的承诺句收归 `src/app/privacy.ts` 唯一出处，并在
 * `tests/ui/local-consent.test.ts` 第 9 组加了"字面量闭集 + 字段分类 + 归口 + `CHROME_PINS`"。
 * 但那一组的**闭集腿只覆盖 `local-consent.ts` 一个文件**（它的字面量扫描器读死那一个路径）。
 * 于是：将来**别的**消费方（例如 `src/ui/local-data.ts`）自己写一句隐私承诺，
 * 仍然只有**部分**覆盖 —— 门禁可能全绿，而玩家读到一句没有任何出处的措辞。
 * 本文件把"消费方"从**手写文件名清单**换成**从磁盘生成式发现**，于是新增消费方也在覆盖内。
 *
 * ## 发现器（生成式，不写文件名清单）
 *
 * 扫 `src/**\/*.ts`，取**代码位**的模块说明符（`from '…'` 与动态 `import('…')`），
 * 把相对说明符**按文件所在目录解析**，命中 `src/app/privacy` 的即为消费方。
 * 判据是**解析后的路径**而不是子串（`src/ui/x.ts` 里的 `'./privacy'` 解析成 `src/ui/privacy`，
 * **不算**消费方 —— 这一条由正控腿钉住）。
 * 现状：`src/ui/local-consent.ts` 与 `src/ui/local-data.ts`（两者都是 `from '../app/privacy'`）。
 *
 * ## 「玩家可见的隐私承诺句」怎么划界（本文件的核心判断，代价写在下面）
 *
 * 三层判据，**互相独立**（任何一层单独被绕过，其余两层仍然报红）：
 *
 * 1. **承诺候选的形态**：代码位里的**字符串/模板串字面量**，满足
 *    ① 含汉字 ② 以 `。` 结尾 ③ 含隐私关键词（写入/保存/存储/磁盘/硬盘/本机/数据/昵称/卡组/痕迹）。
 *    —— 界面**标签**（`'保存昵称'` / `'本地数据与隐私'` / `'← 返回主界面'`）天然没有句号 ⇒
 *    不在候选面里，**不会被误伤**。
 * 2. **候选 − 「状态/错误报告」= 承诺句**。「状态/错误报告」= 含**操作结果 / 操作说明**词表里
 *    任一词（失败 / 不支持 / 无法 / 已取消 / 取消 / 过大 / 已清除 / 已保存 / 已导出 / 已导入 /
 *    还没有 / 正在 / 等待 / 会当场 / 会被删除 / 清除后 / 校验）的句子：它报告的是**本屏刚刚
 *    做/没能做到的那件事**，不是"本程序如何对待你的数据"的总体立场。
 *    例：`'这台设备不支持导入档案。'`（连候选都不是）、`'本机保存失败，本次会话仍可正常游玩。'`
 *    （候选，但是报告）⇒ 必须放行。
 * 3. **绝对句形态**：候选面之外再扫一遍**全部**中文字面量，禁止"磁盘上不会有任何写入 / 不落盘 /
 *    不会留下任何痕迹 / 零磁盘写入"这一族 —— 它们在**任何**实现下都不成立
 *    （阶段一评审 B-1：光加载页面浏览器自己就写 HTTP 缓存，与有没有 SW 无关）。
 *
 * ## 代价与已知残余（**不谎报**）
 *
 *  - 第 2 层的词表是**宽松侧**白名单 ⇒ 失败方向主要是**假红**（一句新写的中性功能说明若不含这些词
 *    会被判成承诺句，逼一次人工归类），**不会**静默放行；
 *  - 但它的反面是**已知残余**：一句**伪装成报告**的承诺（内部含"失败/已保存"等词）能穿过第 2 层。
 *    兜它的是第 3 层（绝对句）与"整句哈希 + 人工复核"；
 *  - 第 1 层的 `。` 形态是**已知洞**（本文件有一条腿**如实钉住**它）：一句不以句号结尾的承诺
 *    （如 `'你的昵称永不上传'`）不在候选面里。不做成"形态黑名单"的原因已经实测过：
 *    黑名单追不上自然语言的措辞空间（复审构造出过穿透反例，见
 *    `docs/3代特效-进度与上下文.md §0` 的教训⑤）⇒ 处置是**钉整句 + 人工归类**，
 *    而不是再加一张词表。
 *  - 因此"承诺句只有一个家"这条纪律在本文件里的**准确表述**是：
 *    *（可达的）承诺候选面被冻结成闭集，任何新增/改写都必须人工归类*，
 *    而**不是**"机器证明了不存在漏网的承诺句"。
 *
 * ## 与 `local-consent.test.ts` 第 9 组的分工（不重复、不冲突）
 *
 * 第 9 组管的是**授权弹窗那一个文件**的**字段级**归口（`ConsentCopy` 的每个键必须被分类为
 * "界面标签"或"必须引用"）；本文件管的是**跨全部消费方**的**句子级**发现。两者独立成立：
 * 把本文件删掉，第 9 组仍然覆盖 `local-consent.ts`；把第 9 组删掉，本文件仍然覆盖两个消费方。
 */

/* ───────────────────────────── 读取与生成式发现 ───────────────────────────── */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PRIVACY_REL = 'src/app/privacy';

interface SourceFile { rel: string; code: string }

function relOf(abs: string): string {
  return abs.slice(REPO_ROOT.length).split('\\').join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function readSources(): SourceFile[] {
  return walk(join(REPO_ROOT, 'src')).sort().map((abs) => ({
    rel: relOf(abs),
    code: stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8')),
  }));
}

/** 代码位里的模块说明符（`from '…'` 与动态 `import('…')` 两种形态；调用方须先剥注释） */
function importSpecsOf(code: string): string[] {
  return [
    ...[...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
}

/**
 * 把**相对**说明符按 `fromRel` 所在目录解析成仓库相对路径（去扩展名）。
 * 手写归一化而不是用 `node:path` 的 `resolve`/`relative`：`tests/node-types.d.ts` 只声明了
 * `join`，而本任务的边界**不许**扩那份声明（G3 收口文档的缺口⑩同族原因）。
 */
function resolveSpec(fromRel: string, spec: string): string {
  const out = fromRel.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** 该文件是否 import 了 `src/app/privacy`（判据是**解析后的路径**，不是子串命中） */
function isPrivacyConsumer(f: SourceFile): boolean {
  return importSpecsOf(f.code).some((s) => s.startsWith('.') && resolveSpec(f.rel, s) === PRIVACY_REL);
}

/** 消费方清单（**生成式**：从磁盘派生，按路径排序） */
function consumersOf(sources: readonly SourceFile[]): string[] {
  return sources.filter(isPrivacyConsumer).map((f) => f.rel).sort();
}

const SOURCES = readSources();
const CONSUMERS = consumersOf(SOURCES);

/* ───────────────────────────── 字面量与文案判据 ───────────────────────────── */

/**
 * 源码里 `'…'` / `"…"` / `` `…` `` 字面量的**内容**（注释须先 `stripComments` 剥掉）。
 *
 * ⚠️ 这是本仓**第三份**字面量扫描器（另两份在 `local-consent.test.ts` 与本文件之外没有共用出口）。
 * 本任务的**文件边界**只允许动 4 个文件，其中不含 `tests/ui/source-text.ts`（共用助手的家）
 * ⇒ 不能把它抽出成共用实现。代价：三份拷贝有漂移风险 —— 由本文件下面的"锚点腿"兜
 * （扫描器必须真的扫到已知标签与已知模板串，且必须扫不到注释里的同名子串）。
 * 模板串**整段**保留（含 `${}` 的原文），因此哈希对"表达式改了"也敏感（刻意的摩擦）。
 */
function stringLiteralsOf(code: string): string[] {
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
      out.push(buf);
      continue;
    }
    i += 1;
  }
  return out;
}

const CJK = /[\u3400-\u9fff]/;

/** 代码位里的**中文**字面量（去重、保持首次出现顺序） */
function cjkLiteralsOf(code: string): string[] {
  return [...new Set(stringLiteralsOf(code))].filter((s) => CJK.test(s));
}

/**
 * 隐私关键词。刻意**只放"数据/落盘"这一族**（写入/保存/存储/磁盘/硬盘/本机/数据/昵称/卡组/痕迹），
 * 不含"档案/设备"这类中性词 —— 否则 `'这台设备不支持导入档案。'` 这类**能力缺失报告**
 * 会全部挤进候选面，把它撑成噪音面（判据噪声大 = 维护者开始无视它 = 实际覆盖下降）。
 */
const PRIVACY_KEYWORDS = ['写入', '保存', '存储', '磁盘', '硬盘', '本机', '数据', '昵称', '卡组', '痕迹'] as const;

/** 承诺**候选**（形态判据；见文件头注第 1 层） */
function isPromiseCandidate(s: string): boolean {
  return CJK.test(s) && s.endsWith('。') && PRIVACY_KEYWORDS.some((k) => s.includes(k));
}

/**
 * 「状态/错误报告 / 操作说明」词表（文件头注第 2 层）。
 * 每一条都对应一个**具体的**操作语义，不是随手加的同义词：
 *  - `失败` / `不支持` / `无法`：能力或操作的结果报告；
 *  - `已取消` / `取消`：用户自己中止（三态里的 `cancelled`，**不许**说成失败）；
 *  - `过大`：大小上限挡下；
 *  - `已清除` / `已保存` / `已导出` / `已导入`：刚刚完成的操作；
 *  - `还没有`：屏上的**数据状态**（列表为空）；
 *  - `正在` / `等待`：进行中的等待态；
 *  - `会当场` / `校验` / `会被删除` / `清除后`：某个按钮点下去**会发生什么**的说明。
 */
const REPORT_MARKERS = [
  '失败', '不支持', '无法', '已取消', '取消', '过大', '已清除', '已保存', '已导出', '已导入',
  '还没有', '正在', '等待', '会当场', '会被删除', '清除后', '校验',
] as const;

function isStatusReport(s: string): boolean {
  return REPORT_MARKERS.some((m) => s.includes(m));
}

/**
 * 绝对句形态（**独立于候选面**：扫全部中文字面量）。
 *
 * 与 `tests/app/privacy.test.ts:939-947` 的 `ABSOLUTE_FORMS` **同源**（那是 `privacy.ts` 侧的腿），
 * 这里补上复验者构造过的穿透形态（"全程零磁盘写入"、"硬盘上不会留下任何痕迹"）。
 * ⚠️ 不写成一个大字面量：否则这条腿的正则/字符串自身会成为"绝对句"的假阳性来源。
 * ⚠️ 逐条**不含**已被批准的**范围化**句式（"不会写入任何**你的**数据"）—— 那是诚实的那种说法。
 */
const ABSOLUTE_FORMS = [
  '磁盘上不会有任何写入',
  '不会有任何写入',
  '不会写入磁盘',
  '不写磁盘',
  '不落盘',
  '不会写入任何数据',
  '不写入任何数据',
  '绝不写入',
  '零磁盘写入',
  '零写入',
  '硬盘上不会留下任何痕迹',
  '不会留下任何痕迹',
] as const;

/** `privacy.ts` **运行期导出面**上的全部面向玩家文案（生成式；不写名字清单） */
const PRIVACY_TEXT = ((): Set<string> => {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string') { if (CJK.test(v)) out.add(v); return; }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v === 'object' && v !== null) Object.values(v).forEach(visit);
  };
  Object.values(privacyExports as unknown as Record<string, unknown>).forEach(visit);
  return out;
})();

/**
 * 已经**人工归类**过的"非报告形态承诺候选"（键 = `hash64(整句)`，值 = 归类的理由）。
 *
 * **当前为空**：真实树上 8 条候选**全部**是状态/错误报告（见下面"划界腿"打印的清单）。
 * 它是第 2 层的**闭集出口**：将来新增一句**非报告形态**的候选，必须先在这里写下理由，
 * 才能让门禁变绿 —— 这就是"逼一次人工复核"的落点（代价见文件头注）。
 */
const CLASSIFIED_NON_REPORT: Readonly<Record<string, string>> = {};

/* ───────────────────────────── 纯判据（可喂合成源码） ───────────────────────────── */

/** 非报告形态的承诺候选（= 必须来自 `privacy.ts` 导出面、或写进 `CLASSIFIED_NON_REPORT`） */
function nonReportCandidates(code: string): string[] {
  return cjkLiteralsOf(code).filter((s) => isPromiseCandidate(s) && !isStatusReport(s));
}

/** 绝对句形态的命中（扫**全部**中文字面量，不受候选面限制） */
function absoluteFormHits(code: string): string[] {
  const hit: string[] = [];
  for (const lit of cjkLiteralsOf(code)) {
    for (const form of ABSOLUTE_FORMS) if (lit.includes(form)) hit.push(`${form} ← 「${lit}」`);
  }
  return hit;
}

/** 直接**抄写** `privacy.ts` 导出面句子的字面量（消费方只许 `import` 引用，不许抄第二份） */
function copiedPrivacySentences(code: string): string[] {
  return cjkLiteralsOf(code).filter((s) => PRIVACY_TEXT.has(s));
}

/* ─────────────── G5/T8 第 4 件义务：「中继结论句」的扫描腿 ─────────────── */

/**
 * 「中继结论句」的两个词（`中继` 必中，另一个二选一）。
 *
 * 出处是 D22 写死的那一句（`src/app/privacy.ts:111`）：
 * 「若你自行配置了中继（TURN），它能看到你的 IP 地址（这是走中继的技术必然），
 * 但转发的是端到端加密后的数据包：**内容不可读，也不存储**。」
 */
const RELAY_TOPIC_WORD = '中继';
const RELAY_CONCLUSION_WORDS = ['内容不可读', '不存储'] as const;

/**
 * ★ **第 4 件义务的落点**（计划 §5 T8；D22 的覆盖洞）：对**全 `src/**`** 扫一遍中文字面量，
 * 同时含 `中继` **且**含 `内容不可读` / `不存储` 之一 ⇒ 报红。
 *
 * ## 为什么必须有它（这个洞的定义）
 *
 * 既有的 `consumerViolations()` **第一行就是 `if (!isPrivacyConsumer(f)) continue;`** ⇒
 * 一个**不 import `privacy.ts`**、却手写一句同样意思的话的新文件，今天没有任何机制会红。
 * T7 阶段一评审量化过：逐字抄会被抓（有反控），**换措辞**之后三条现有机制全不红。
 * 而 T8 恰好要新建一个不 import 它的渲染文件 —— 那正是最容易顺手重写一句的地方。
 * ⇒ 这个函数**故意不看 `isPrivacyConsumer`**：它接收**全部** `SOURCES`。
 *
 * ## 形状（照 `absoluteFormHits` 复用）
 *
 * 遍历 `cjkLiteralsOf(code)` 做 `includes`，命中拼成可读串返回（`形式 ← 「实际文案」`）。
 *
 * ## 能力边界（**写实，别读成"机器证明了不存在中继结论句"**）
 *
 *  - **完全改写的同义句挡不住**：例如"中继转发的是加密包，服务端读不到明文"不含那两个结论词 ⇒ 漏。
 *    也就是说它只能挡住"**用了这两个词**"的那一族；处置仍是"钉整句 + 人工归类"；
 *  - **只认中文字面量**：不认模板串拼接出来的句子（拼接出来的整句不在一个字面量里）、
 *    **不认注释**（调用方须先 `stripComments`，`readSources()` 已经剥过）；
 *  - 它**不**判断那句话对不对，只判断"这里又出现了一句中继结论"。
 */
function relayConclusionHits(code: string): string[] {
  const hit: string[] = [];
  for (const lit of cjkLiteralsOf(code)) {
    if (!lit.includes(RELAY_TOPIC_WORD)) continue;
    for (const word of RELAY_CONCLUSION_WORDS) {
      if (lit.includes(word)) hit.push(`${RELAY_TOPIC_WORD} + ${word} ← 「${lit}」`);
    }
  }
  return hit;
}

/** 真树上这条腿的命中文件（**生成式**：从磁盘派生，按路径排序） */
function relayConclusionFiles(sources: readonly SourceFile[]): string[] {
  return sources.filter((f) => relayConclusionHits(f.code).length > 0).map((f) => f.rel).sort();
}

/**
 * 对一份（可以是**合成**的）源码树跑全部消费方判据，返回人可读的违规清单（空数组 = 全绿）。
 * 传 `sources` 而不是闭包 `SOURCES`：正控要喂合成树，证明判据能分辨
 * "新消费方写了一句手写承诺"与"新消费方只写了合法的错误提示"，而不是恒真/恒假。
 */
function consumerViolations(
  sources: readonly SourceFile[],
  classified: Readonly<Record<string, string>> = CLASSIFIED_NON_REPORT,
): string[] {
  const out: string[] = [];
  for (const f of sources) {
    if (!isPrivacyConsumer(f)) continue;
    for (const cand of nonReportCandidates(f.code)) {
      if (classified[hash64(cand)] !== undefined) continue;
      if (PRIVACY_TEXT.has(cand)) {
        out.push(
          `  ${f.rel}：「${cand}」是 \`src/app/privacy.ts\` 导出面上的句子，但消费方必须**引用**`
          + '（import 常量）而不是抄写第二份 —— 抄写会让"唯一出处"变成口号。',
        );
      } else {
        out.push(
          `  ${f.rel}：「${cand}」既不在 \`privacy.ts\` 的导出面上、也不在 STATUS 报告形态里`
          + ` ⇒ 这是一句**手写的玩家可见隐私承诺句**（实际哈希 ${hash64(cand)}）。`
          + '处置：改成从 `src/app/privacy.ts` 引用；若它其实只是一句功能/状态说明，'
          + '请把它连同理由写进本文件的 `CLASSIFIED_NON_REPORT`。',
        );
      }
    }
    for (const hit of absoluteFormHits(f.code)) {
      out.push(`  ${f.rel}：绝对句形态（B-1 那一族，任何实现下都不成立）：${hit}`);
    }
    for (const copy of copiedPrivacySentences(f.code)) {
      out.push(`  ${f.rel}：逐字抄了 \`privacy.ts\` 导出面上的句子（应改为 import 引用）：「${copy}」`);
    }
  }
  return out;
}

/* ───────────────────────────────── 判据 ───────────────────────────────── */

describe('消费方发现的生成式守卫（谁 import 了 privacy.ts 就必须被覆盖）', () => {
  it('锚点：真的发现到了消费方（否则下面每条判据都在空数组上恒真）', () => {
    expect(SOURCES.length, 'src 下一个 .ts 都没读到 ⇒ 路径写错').toBeGreaterThan(50);
    // 逐条钉住**已知**的两个（这两个是"发现器必须找得到"的正样本；不写它们就可能在
    // "扫描面整体塌掉"时安静地通过）
    expect(CONSUMERS, '发现器没找到 src/ui/local-consent.ts（授权弹窗是第一个消费方）').toContain('src/ui/local-consent.ts');
    expect(CONSUMERS, '发现器没找到 src/ui/local-data.ts（本地数据屏是第二个消费方）').toContain('src/ui/local-data.ts');
    // 上界自证：消费方**不可能**是全仓所有文件（否则判据 = "全仓扫描"，会误伤无关文件）
    expect(CONSUMERS.length, '消费方数量离谱（说明说明符解析把无关文件也算了进来）').toBeLessThan(SOURCES.length / 2);
    // `privacy.ts` 自己的导出面必须非空，否则"承诺句来自导出面"这条判据恒真
    expect(PRIVACY_TEXT.size, 'privacy.ts 的导出面上没有面向玩家文案 ⇒ 判据恒真').toBeGreaterThan(10);
    // 字面量扫描器自证：扫到已知标签 + 已知模板串 + 已知类名管线串
    const one = SOURCES.find((f) => f.rel === 'src/ui/local-data.ts');
    expect(one, '找不到 local-data.ts（锚点失效）').toBeDefined();
    const lits = stringLiteralsOf(one?.code ?? '');
    expect(lits, '扫描器没扫到中文标签').toContain('本地数据与隐私');
    expect(lits.some((l) => l.includes('${')), '扫描器没扫到模板串（模板串里的承诺句会漏）').toBe(true);
    expect(lits, '扫描器连 ASCII 管线串都没扫到（扫描面不完整）').toContain('local-data-screen');
    // 反向：注释里的中文**不许**进字面量面（`stripComments` 生效）
    expect(
      stringLiteralsOf(stripComments('// 注释里的「本地数据与隐私」不算\nexport const a = 1;')),
      '注释里的中文被当成了字面量（判据会假红）',
    ).toEqual([]);
    expect(cjkLiteralsOf(stripComments('// 注释里的中文不算\nexport const a = 1;')), '注释没被剥掉').toEqual([]);
  });

  it('发现器自证（正控 + 反控）：合成样本能分辨"import 了 privacy"与"没 import"', () => {
    const f = (rel: string, code: string): SourceFile => ({ rel, code: stripComments(code) });
    // 正控：四种真实形态
    const positives: SourceFile[] = [
      f('src/ui/synth-a.ts', "import { PRIVACY_COPY } from '../app/privacy';\nexport const a = PRIVACY_COPY;"),
      f('src/ui/synth-b.ts', "import type { PrivacyCopy } from '../app/privacy';\nexport type B = PrivacyCopy;"),
      f('src/app/synth-c.ts', "import { privacyLines } from './privacy';\nexport const c = privacyLines;"),
      f('src/ui/synth-d.ts', "const m = await import('../app/privacy');\nexport const d = m;"),
    ];
    expect(consumersOf(positives), '正控失效：import 了 privacy 的合成文件没被发现').toEqual([
      'src/app/synth-c.ts', 'src/ui/synth-a.ts', 'src/ui/synth-b.ts', 'src/ui/synth-d.ts',
    ]);
    // 反控：四种"不该被发现"的形态
    const negatives: SourceFile[] = [
      // ① import 的是别的模块
      f('src/ui/synth-e.ts', "import { createLocalStore } from '../app/local-store';\nexport const e = createLocalStore;"),
      // ② 只在**注释**里提到 privacy（剥注释后说明符面为空）
      f('src/ui/synth-f.ts', '// 见 ../app/privacy 里的文案\nexport const f = 1;'),
      // ③ **同名但解析到别处**：`src/ui/x.ts` 的 `'./privacy'` = `src/ui/privacy`，不是消费方
      f('src/ui/synth-g.ts', "import { x } from './privacy';\nexport const g = x;"),
      // ④ 名字里含 "privacy" 的**别处模块**
      f('src/ui/synth-h.ts', "import { y } from '../app/privacy-notes';\nexport const h = y;"),
    ];
    expect(consumersOf([...positives, ...negatives]), '反控失效：没 import privacy 的文件被误报').toEqual([
      'src/app/synth-c.ts', 'src/ui/synth-a.ts', 'src/ui/synth-b.ts', 'src/ui/synth-d.ts',
    ]);
  });

  it('划界腿：真实消费方里**没有**任何"非报告形态"的承诺候选（8 条候选全部是状态/错误报告）', () => {
    const found = CONSUMERS.flatMap((rel) => {
      const f = SOURCES.find((s) => s.rel === rel);
      return nonReportCandidates(f?.code ?? '').map((text) => ({ rel, text }));
    });
    // 锚点：候选面本身非空（否则"没有非报告候选"是废话 —— 空集当然没有）
    const candCount = CONSUMERS.flatMap((rel) => {
      const f = SOURCES.find((s) => s.rel === rel);
      return cjkLiteralsOf(f?.code ?? '').filter(isPromiseCandidate);
    }).length;
    expect(candCount, '一条承诺候选都没有 ⇒ 候选面塌了（关键词/句号判据失效？）').toBeGreaterThan(0);
    const listed = found.map((x) => `${x.rel}：${x.text}`);
    expect(
      listed,
      '以下"以句号结尾且含隐私关键词"的中文字面量**不是**状态/错误报告 ⇒ 它们是手写的隐私承诺句：\n'
      + listed.join('\n'),
    ).toEqual([]);
    // 闭集出口必须**恰好**等于当前的非报告候选（多一个 ⇒ 有人改了句子没同步；少一个 ⇒ 有幽灵归类）
    expect(
      Object.keys(CLASSIFIED_NON_REPORT),
      'CLASSIFIED_NON_REPORT 与真实的非报告候选集合不一致（新增/删除了句子却没同步归类表）',
    ).toEqual(found.map((x) => hash64(x.text)));
  });

  it('全部消费方零违规（发现器 + 划界 + 绝对句 + 抄写，四条腿一起跑真实树）', () => {
    expect(consumerViolations(SOURCES), '消费方里有手写的玩家可见隐私承诺句 / 绝对句 / 抄写').toEqual([]);
  });

  it('判据自证（正控 A）：往合成消费方里塞一句绝对承诺 ⇒ 必须报红（对应变异①②）', () => {
    const real = SOURCES.find((s) => s.rel === 'src/ui/local-data.ts');
    expect(real, '找不到 local-data.ts').toBeDefined();
    const INJECTED = '在你允许之前，磁盘上不会有任何写入。';
    // 只加一行**代码位**字面量（不是注释）：`const` 声明
    const mutated = `${real?.code ?? ''}\nexport const BANNED_NOTE = '${INJECTED}';\n`;
    expect(mutated, '正控构造失败：合成源码没有变化').not.toBe(real?.code ?? '');
    const v = consumerViolations([{ rel: 'src/ui/local-data.ts', code: mutated }]);
    expect(v.length, '注入绝对承诺句竟然没被抓到').toBeGreaterThan(0);
    expect(v.join('\n'), '报错必须点出那句**实际文案**').toContain(INJECTED);
    // 这一句同时命中两条独立腿：绝对句形态 + 非报告候选 ⇒ 两条腿都要报（冗余是刻意的）
    expect(absoluteFormHits(mutated).length, '绝对句腿没命中').toBeGreaterThan(0);
    expect(nonReportCandidates(mutated), '非报告候选腿没命中').toContain(INJECTED);
  });

  it('判据自证（正控 B）：新增一个**消费方文件**也会被覆盖（不是只覆盖已知两个）', () => {
    const INJECTED = '在你允许之前，磁盘上不会有任何写入。';
    const synth: SourceFile[] = [
      ...SOURCES,
      {
        rel: 'src/ui/synth-new-consumer.ts',
        code: stripComments(`import { PRIVACY_COPY } from '../app/privacy';\nexport const NOTE = '${INJECTED}';\n`),
      },
    ];
    expect(consumersOf(synth), '新消费方没被发现').toContain('src/ui/synth-new-consumer.ts');
    const v = consumerViolations(synth);
    expect(v.join('\n'), '**新文件**里的手写承诺句没被抓到（生成式发现失效）').toContain('src/ui/synth-new-consumer.ts');
    expect(v.join('\n')).toContain(INJECTED);
  });

  it('判据自证（反控 A）：只加一句**合法的错误提示** ⇒ 必须仍绿（不误伤）', () => {
    const real = SOURCES.find((s) => s.rel === 'src/ui/local-data.ts');
    // 三句都含隐私关键词、都以句号结尾 ⇒ **都是候选**；但都是"报告某次操作的结果"⇒ 必须放行。
    // ⚠️ 句子在源码里拼接构造（不从别处 import）：这是**合成样本**，不该进任何真文件。
    const ERRORS = [
      '读取本机数据失败，请重试。',
      '本机保存失败，本次会话仍可正常游玩。',
      '这台设备不支持保存文件，因此无法导出档案。',
    ];
    for (const e of ERRORS) {
      const mutated = `${real?.code ?? ''}\nexport const NEW_STATUS = '${e}';\n`;
      expect(isPromiseCandidate(e), `反控构造失败：「${e}」不被判为候选（那这条反控就没意义）`).toBe(true);
      expect(isStatusReport(e), `反控失效：「${e}」没被认成状态/错误报告`).toBe(true);
      expect(
        consumerViolations([{ rel: 'src/ui/local-data.ts', code: mutated }]),
        `加一句合法的错误提示竟然被判违规（误伤）：${e}`,
      ).toEqual([]);
    }
    // 反向：同一句话若**不是**报告（把"失败"换成中性的断言）⇒ 必须报红 —— 证明上一条不是恒真
    const asPromise = '本机保存的内容只存在你自己的浏览器里。';
    expect(isStatusReport(asPromise), '反控构造失败：这句不该含报告词').toBe(false);
    const mutated = `${real?.code ?? ''}\nexport const NEW_CLAIM = '${asPromise}';\n`;
    expect(consumerViolations([{ rel: 'src/ui/local-data.ts', code: mutated }]).join('\n'), '中性断言竟然没被抓到').toContain(asPromise);
  });

  it('判据自证（反控 B）：只改注释 / 只加界面标签 ⇒ 必须仍绿（不误伤）', () => {
    const real = SOURCES.find((s) => s.rel === 'src/ui/local-data.ts');
    const base = real?.code ?? '';
    // ① 只加注释（里面写着绝对承诺句）—— 剥注释后必须消失
    const commentOnly = `${base}\n// 审阅备注：这里以前写过「磁盘上不会有任何写入」这种绝对句，已被移除。\n`;
    expect(consumerViolations([{ rel: 'src/ui/local-data.ts', code: commentOnly }]), '注释被当成了违规（假红）').toEqual([]);
    expect(absoluteFormHits(commentOnly), '注释里的绝对句被算成了命中').toEqual([]);
    // ② 只加界面**标签**（无句号 ⇒ 不在候选面里）
    const labeled = `${base}\nexport const LABEL = '本机数据管理';\n`;
    expect(consumerViolations([{ rel: 'src/ui/local-data.ts', code: labeled }]), '新增界面标签被误伤').toEqual([]);
    // ③ 新消费方文件里**只**有标签与合法的错误提示 ⇒ 也必须绿（新文件不是"一出现就红"）
    const synth: SourceFile[] = [
      ...SOURCES,
      {
        rel: 'src/ui/synth-labels-only.ts',
        code: stripComments(
          "import { privacyLines } from '../app/privacy';\n"
          + "export const T = '本机数据';\n"
          + "export const E = '读取本机数据失败，请重试。';\n"
          + 'export const L = privacyLines;\n',
        ),
      },
    ];
    expect(consumerViolations(synth), '只有标签与合法错误提示的新消费方被误伤').toEqual([]);
  });

  it('判据自证（正控 C）：**抄写** privacy.ts 的句子 ⇒ 报"必须引用"而不是"手写承诺"', () => {
    // 从导出面**取一句**（不在本文件里抄写它 —— 否则本文件自己就成了第二处定义）
    const sentence = [...PRIVACY_TEXT].find((s) => s.endsWith('。'));
    expect(sentence, 'privacy.ts 导出面上找不到以句号结尾的句子').toBeDefined();
    const synth: SourceFile[] = [{
      rel: 'src/ui/synth-copy.ts',
      // ⚠️ 必须**真的** import privacy：消费方判据只在 `isPrivacyConsumer` 为真的文件上跑
      //    （第一版漏了这行 import ⇒ 合成文件不是消费方 ⇒ 整条判据在"没跑到"上假绿）
      code: stripComments(
        `import { privacyLines } from '../app/privacy';\nexport const C = ${JSON.stringify(sentence)};\n`,
      ),
    }];
    expect(consumersOf(synth), '合成文件没被认成消费方（缺 import？）').toEqual(['src/ui/synth-copy.ts']);
    const v = consumerViolations(synth);
    expect(v.length, '抄写 privacy.ts 的句子没被抓到').toBeGreaterThan(0);
    expect(v.join('\n'), '报错没有区分"抄写"与"手写新承诺"').toContain('必须**引用**');
    expect(copiedPrivacySentences(synth[0].code), '抄写检测器没命中').toEqual([sentence]);
  });

  it('如实钉住**已知残余**：不以句号结尾的承诺句不在这套形态判据的候选面里', () => {
    // 这不是"已覆盖"，而是**已知洞的固化**（写在这里，免得被读成"机器证明了没有漏网的承诺句"）。
    // 不做成"形态黑名单"的理由：黑名单追不上自然语言的措辞空间（复审构造出过穿透反例）。
    // 兜它的是：`privacy.ts` 侧的导出面钉死 + 本任务的"人工归类"出口 + G3 收口文档的缺口清单。
    const noPeriod = '你的昵称永不上传';
    expect(isPromiseCandidate(noPeriod), '残余洞消失了？那请把这条腿改成更强的判据').toBe(false);
    expect(absoluteFormHits(noPeriod), '它也躲过了绝对句腿（残余比预期更大？）').toEqual([]);
    // 对照：同一句加上句号就进候选面（证明缺的只是"句号"这一条形态约束）
    expect(isPromiseCandidate(`${noPeriod}。`), '加上句号后仍不进候选面（形态判据比预期弱）').toBe(true);
  });

  /* ==================================================================== *
   * G5/T8 · 第 4 件义务：「中继结论句」的扫描腿（D22 的覆盖洞）
   * ==================================================================== */

  it('★ 第 4 件义务锚点：真树上"中继 + 内容不可读/不存储"的命中集合**恰好是** privacy.ts 一个', () => {
    const hits = relayConclusionFiles(SOURCES);
    // 反空转：扫描面本身必须非空（否则"只有一个文件命中"是废话）
    expect(SOURCES.length, 'src 下一个 .ts 都没读到 ⇒ 扫描面塌了').toBeGreaterThan(50);
    // ★ 写死这条锚点：命中为空 ⇒ "扫描面塌了"（假绿）；命中多出别的文件 ⇒ 立刻逼一次人工归类。
    expect(
      hits,
      '中继结论句的命中集合不是恰好 [src/app/privacy.ts]：\n'
      + '  空 ⇒ 扫描面塌了（词表/扫描器失效）；多出文件 ⇒ 有人手写了第二份中继结论，请人工归类',
    ).toEqual(['src/app/privacy.ts']);
    // 逐字钉住"命中的就是那一句"（不是别处的巧合命中）：必须点出 :111 那句的实际正文末尾
    const real = SOURCES.find((f) => f.rel === 'src/app/privacy.ts');
    const hitText = relayConclusionHits(real?.code ?? '').join('\n');
    expect(hitText, '命中的不是 D22 那一句（命中面漂到别的字面量上了）').toContain('内容不可读，也不存储');
    expect(relayConclusionHits(real?.code ?? '').length, '命中条数').toBeGreaterThan(0);
  });

  it('★ 第 4 件义务正控：合成源码里手写一句中继结论 ⇒ 必须报红，且点出实际文案', () => {
    const INJECTED = '中继看不到内容，也不存储。';
    const synth: SourceFile[] = [{
      rel: 'src/ui/synth-lobby.ts',
      code: stripComments(`export const NOTE = '${INJECTED}';`),
    }];
    const hits = relayConclusionHits(synth[0].code);
    expect(hits.length, '合成样本里那句中继结论没被抓到').toBeGreaterThan(0);
    expect(hits.join('\n'), '报错必须点出那句**实际文案**').toContain(INJECTED);
    // 反向自证：把结论词换掉（改写成同义句）⇒ **不报** —— 这条腿只认那两个词（能力边界）
    const REWORDED = '中继转发的是加密包，服务端读不到明文。';
    const reworded: SourceFile[] = [{
      rel: 'src/ui/synth-lobby.ts',
      code: stripComments(`export const NOTE = '${REWORDED}';`),
    }];
    expect(relayConclusionHits(reworded[0].code), '改写后的同义句竟然被抓住了（能力边界写错了？）').toEqual([]);
  });

  it('★ 第 4 件义务反控（**这条腿存在的理由**）：不 import privacy 的合成文件，旧机制不报、新腿报', () => {
    // 同一个合成文件，两条判据各跑一次 —— 必须**两条一起断言**，否则证明不了新腿补的是真洞。
    const INJECTED = '中继看不到内容，也不存储。';
    const synth: SourceFile[] = [{
      rel: 'src/ui/synth-lobby.ts',
      // ⚠️ **故意不 import privacy**：这正是那个洞的形态
      code: stripComments(`export const NOTE = '${INJECTED}';\nexport const X = 1;`),
    }];
    expect(isPrivacyConsumer(synth[0]), '合成文件竟然被认成消费方（那就不是"不 import"了）').toBe(false);
    // ① 旧机制（消费方发现器）：**不报**（它第一行就 continue 掉了）
    expect(consumerViolations(synth), '旧机制对这个不 import privacy 的文件报了 —— 那这个洞就不存在了').toEqual([]);
    // ② 新腿：**报**
    expect(relayConclusionHits(synth[0].code).length, '新腿对不 import privacy 的文件没报 ⇒ 它没补上那个洞').toBeGreaterThan(0);
    // ③ 对照：同一个文件若**真的** import 了 privacy，旧机制也会报（证明①不是"判据坏了"造成的）
    const asConsumer: SourceFile[] = [{
      rel: 'src/ui/synth-lobby.ts',
      code: stripComments(`import { PRIVACY_COPY } from '../app/privacy';\nexport const NOTE = '${INJECTED}';`),
    }];
    expect(isPrivacyConsumer(asConsumer[0]), '加了 import 之后仍不算消费方').toBe(true);
    expect(consumerViolations(asConsumer).length, '消费方版本竟然不报（对照组失效）').toBeGreaterThan(0);
  });

  it('★ 第 4 件义务·能力边界固化为行为：注释里的中继结论不算命中（只认字面量）', () => {
    const withComment = stripComments(
      '// 审阅备注：中继转发的是加密包，内容不可读，也不存储。\nexport const X = 1;',
    );
    expect(relayConclusionHits(withComment), '注释里的中继结论被算成了命中（口径必须剥注释）').toEqual([]);
    // 模板串**整段**保留 ⇒ 拼进一个字面量里的整句会被抓到（能力边界：只认"整句在一个字面量里"）
    const inTemplate = stripComments('export const N = `中继看不到内容，也不存储。`;');
    expect(relayConclusionHits(inTemplate).length, '模板串里的整句漏了').toBeGreaterThan(0);
  });

  /* ==================================================================== *
   * G5/T8 · 判据 1 的 ③：大厅**必须**出现在生成式发现出来的消费方里
   * ==================================================================== */

  it('★ T8 的大厅被生成式发现为消费方（它 import 了 privacy.ts 的导出面）', () => {
    // 真树上的断言（**不写死清单**：它由 `importSpecsOf` 解析后得出）
    expect(CONSUMERS, 'T8 新建的 src/ui/net-lobby.ts 没被发现成消费方（它应该 import 了 ../app/privacy）')
      .toContain('src/ui/net-lobby.ts');
    // 反空转：它必须**真的**在树里（否则上面的 toContain 是在一个不存在的文件上恒假）
    const lobby = SOURCES.find((s) => s.rel === 'src/ui/net-lobby.ts');
    expect(lobby, '扫描面里没有 net-lobby.ts（文件不在 src/ui 下？）').toBeDefined();
    // 判据 1 的 ④：大厅是**运行期**取字符串 ⇒ 代码位里没有那份文案的字面量（抄写腿零命中）
    expect(copiedPrivacySentences(lobby?.code ?? ''), '大厅的代码位里出现了 privacy.ts 导出面的整句（抄写）').toEqual([]);
    // 反向自证：那个扫描器对这个文件不是恒空（它的字面量面确实非空）
    expect(stringLiteralsOf(lobby?.code ?? '').length, '大厅的字面量面是空的 ⇒ 上面那条"零命中"是废话')
      .toBeGreaterThan(10);
  });
});
