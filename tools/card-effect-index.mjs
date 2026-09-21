/**
 * 卡牌效果索引（**开发工具，不是门禁**）：把卡牌的两面事实各扒一份出来，供
 * `docs/2026-09-21-卡牌效果分类与关键词.md`（分类表）与图鉴筛选（G5/T24）引用：
 *
 *   1. **卡面文本**（`src/data/cards*.ts` 的 `top` / `middle` / `bottom` 三个字段）—— 玩家看到的那三行指令；
 *   2. **效果代码**（`src/core/effects/cards/*.ts`）—— 每张卡登记的钩子
 *      （`middle` / `triggers.<kind>`（带 `top: true`? 带 `cond`?）/ `valueModifier`）、
 *      用到的**效果步骤 op**、以及**选择请求**（kind / title / chooser / rearrangeSide）。
 *
 * 用法（仓库根，输出打到 stdout；JSON 是临时产物，惯例放在 `.superpowers/` 下）：
 *   node tools/card-effect-index.mjs > .superpowers/g5-T23/effects-index.json
 *   node tools/card-effect-index.mjs --write-tags   # 写 `src/data/cardEffectTags.ts`（G5/T24）
 *
 * 它只做文本级解析（本仓结构稳定：`registerCardEffects('id', { … })` + `function* name(`、
 * 卡牌数据一行一条），**不做类型检查**；解析不到的引用如实标 `unresolved`，**不猜**。
 * 它跑在 `tools/` 下、不进 `src/`，也不参与 `npm run build` / `texts:check` / 任何 CDP 门。
 *
 * ── G5/T24：本文件从"一段脚本"升级成**可导入的纯模块** ───────────────────────────
 *
 * 升级只做两件事，**解析逻辑一个字符都不改**（判据 1 是"生成物与生成器逐字一致"，
 * 它同时依赖"解析与原版同源"，所以旧行为有基线 JSON 对照）：
 *  1. 把原来那段顶层解析代码搬进 `buildIndex()`，并导出 `TAG_DEFS` / `tagsOfCard()` /
 *     `renderTagsModule()`；
 *  2. 直接执行时行为与升级前**逐字一致**（同一个 `JSON.stringify(buildIndex(), null, 2)` 打 stdout）；
 *     新增 `--write-tags`：**只在带这个开关时**写 `src/data/cardEffectTags.ts`。
 *
 * 标签**来自效果代码的事实**（op / trigger / chooser / 选择请求标题），不是页面里按文本关键词现算 ——
 * 后者会把"弃牌堆"算成"弃牌"，也读不出 trigger 与 chooser。卡面文本只在两处参与：
 * `dir-*` 三个指令位置标签与 `ctl-related` 的"文本含控制权"那一半（分类文档 §5 明写这两个口径）。
 * 已知偏差写在 `docs/2026-09-21-卡牌效果分类与关键词.md` §8 与 §9。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = 'src/core/effects/cards';
const DATA_FILES = ['src/data/cards.ts', 'src/data/cards2.ts', 'src/data/cards3.ts'];
const TAGS_FILE = 'src/data/cardEffectTags.ts';

/* ------------------------------------------------------------------ *
 * 1. 卡面文本（一行一条）
 * ------------------------------------------------------------------ */

/** defId -> { protocol, value, top, middle, bottom }（字段缺失记 null） */
function readCardTexts() {
  const map = {};
  for (const f of DATA_FILES) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const idm = /defId:\s*'([a-z]+-[0-9]+)'/.exec(line);
      if (!idm) continue;
      const grab = (k) => {
        const m = new RegExp(`\\b${k}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(line);
        return m ? m[1] : null;
      };
      map[idm[1]] = {
        protocol: (/protocol:\s*'([^']+)'/.exec(line) ?? [])[1] ?? null,
        value: Number((/value:\s*(\d+)/.exec(line) ?? [])[1] ?? -1),
        top: grab('top'),
        middle: grab('middle'),
        bottom: grab('bottom'),
      };
    }
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * 2. 效果代码
 * ------------------------------------------------------------------ */

/** 从 `open` 位置（指向 `{`）起做花括号配平，返回块内文本（不含最外层花括号）。 */
function blockAt(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

/** 找一个具名生成器/函数的函数体（花括号配平）。 */
function bodyOfName(src, name) {
  const re = new RegExp(`function\\*?\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open < 0) return null;
  return blockAt(src, open);
}

const PROMPT_RE = /kind:\s*'(select|select-line|select-action)'/g;
const OP_RE = /op:\s*'([A-Za-z]+)'/g;
const TITLE_RE = /title:\s*(`[^`]*`|'[^']*')/;
const CHOOSER_RE = /chooser:\s*([A-Za-z0-9_.]+)/;
const ACTIONS_RE = /actions:\s*\[([^\]]*)\]/;

/**
 * 递归展开的**深度上限**（防环、也防"助手 A 调 B、B 调 A"这类互相递归）。
 *
 * 6 是量出来的：本仓最深的"登记体 → 助手 → 助手"链是 `chaos-1`（`chaos1Main` → `chaos1Session`，
 * 2 层）；留到 6 是为了以后有人在中间再插一层时不用同时改工具。
 */
const SCAN_DEPTH_LIMIT = 6;

/**
 * **传递闭包：从登记的钩子体出发，沿 `yield* <name>(` 一路展开**（2026-09-22，G5 T25）。
 *
 * ## 它修的是什么（协调者探针已定位，见 `.superpowers/g5-T25/probe-ops-closure.mjs`）
 *
 * 改之前只扫"登记块里**直接**引用到的函数体"（`:151` 那个 `all` 集合）。而本仓的助手写法是
 * 卡效主体 `yield* helper(ctx, …)`：真正产出 `op` 的那几行住在**助手**里 ⇒ 助手体从不被扫到
 * ⇒ 那张卡的 `ops` 少一条、标签跟着少一类。全仓因此只漏两张：
 *
 *  - `chaos-1` 漏 `rearrangeProtocols`（重排写在助手 `chaos1Session`，`chaos.ts:72-103`）⇒
 *    它是"会重排协议的卡"，却**没有** `op-rearrange` 标签（T25 用户要"把重排协议的卡放到一起"时才暴露）；
 *  - `unity-0` 漏 `draw` 与 `flip`。
 *
 * ## 为什么是"跟 `yield*`"而不是"加一条关键词特判"
 *
 * 特判（"文件里出现 `x` 就算"）会把**别人**的重排算到这张卡头上，而且下次换个助手名字就再漏一次。
 * 跟调用边是结构性的：只要 `yield*` 这条语法还在，链路就自动跟上。
 *
 * ## 边界（诚实声明）
 *
 * 只跟 `yield* <标识符>(`（本仓写助手一律是这个形状）。**不跟**：`yield { op: … }` 之外的
 * 动态调用、`EFFECTS[...]` 之类的间接引用、跨文件调用（每个卡效文件的助手都写在同文件里）。
 * 今天真实树里这三类都零命中；以后若出现，表现为"某张卡少一条 op"，与这条修法之前同形。
 */
function collectWithHelpers(src, seeds) {
  /**
   * `names` = 扫体的顺序（**与改前逐字一致**：先按"登记块里出现过的标识符"的发现顺序放
   * 命中的函数，再补闭包新展开到的）。为什么不排序：`prompts` 数组会进索引 JSON（也会进
   * "解析行为不许漂移"的基线对照），排序会把十几张卡的 `prompts` 顺序跟着改掉，
   * 把真正的差异淹在纯顺序 diff 里（T25 实测：排序版有差异的卡 37 张、保序版 26 张，
   * 而其中"真的多了 ops"的只有 `chaos-1` 与 `unity-0` 两张）。
   */
  const names = new Set();
  const depths = new Map();
  const scanAt = new Map();
  const queue = [...seeds].map((name) => ({ name, depth: 0 }));
  const seen = new Set();
  while (queue.length > 0) {
    const { name, depth } = queue.shift();
    if (seen.has(name) || depth > SCAN_DEPTH_LIMIT) continue;
    seen.add(name);
    const body = bodyOfName(src, name);
    if (body === null) continue;          // 撞到 `true` 这类字面量：不是函数，跳过（与改前一致）
    names.add(name);
    depths.set(name, depth);
    scanAt.set(name, body);
    const first = body.indexOf('yield*');
    if (first < 0) continue;              // 没有 `yield*` ⇒ 省掉逐行正则（绝大多数函数体）
    for (const m of body.matchAll(/yield\s*\*\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!seen.has(m[1])) queue.push({ name: m[1], depth: depth + 1 });
    }
  }
  return { names: [...names], depths, scanAt };
}

function scan(text) {
  const ops = new Set();
  for (const m of text.matchAll(OP_RE)) ops.add(m[1]);
  const prompts = [];
  for (const m of text.matchAll(PROMPT_RE)) {
    // 取该 prompt 附近 400 字符作为窗口，读 title / chooser / rearrangeSide / actions
    const win = text.slice(m.index, m.index + 400);
    const title = TITLE_RE.exec(win);
    const chooser = CHOOSER_RE.exec(win);
    const actions = ACTIONS_RE.exec(win);
    prompts.push({
      kind: m[1],
      title: title ? title[1].replace(/^[`']|[`']$/g, '') : null,
      chooser: chooser ? chooser[1] : null,
      rearrangeSide: /rearrangeSide:/.test(win),
      actions: actions ? actions[1].replace(/\s+/g, ' ').trim() : null,
    });
  }
  return { ops: [...ops].sort(), prompts };
}

/**
 * 把 `src/` 的两面事实扒成一份索引（**行为与升级前那段顶层解析逐字同源**）。
 *
 * 返回的就是原来 `console.log` 的那个对象的**逐字同形**复制 —— 于是
 * `JSON.stringify(buildIndex(), null, 2)` 与升级前的 stdout 逐字一致（基线对照见 T24 报告）。
 */
export function buildIndex() {
  const texts = readCardTexts();
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort();
  const out = [];

  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8');
    const cards = [];
    const regRe = /registerCardEffects\(\s*'([^']+)'\s*,\s*\{/g;
    for (const m of src.matchAll(regRe)) {
      const id = m[1];
      const open = src.indexOf('{', m.index + m[0].length - 1);
      const block = blockAt(src, open);
      // 收集这一块引用的函数名（middle: foo / fn: bar / 顶层函数名）
      const refs = new Set();
      for (const r of block.matchAll(/(?:^|[,{\s])(?:middle|top|bottom|end|fn|middleFn)\s*:\s*([A-Za-z_$][\w$]*)/g)) {
        refs.add(r[1]);
      }
      // 兜一层：块里出现的所有标识符里能在本文件找到同名函数的，也算引用（宁可多算）
      const scanned = new Set();
      for (const r of block.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
        if (bodyOfName(src, r[1]) !== null) scanned.add(r[1]);
      }
      const all = new Set([...refs, ...scanned]);
      // ★ 2026-09-22（G5 T25）：**再沿 `yield*` 展开传递闭包** —— 只扫"登记块里直接引用的函数"
      //   会漏掉助手体里产出的 op（`chaos-1` 的 `rearrangeProtocols` 就写在 `chaos1Session` 里）。
      //   展开到的函数名一并记进 `refs`（它是"从这张卡的块出发、按本文件函数名可达的标识符"），
      //   于是生成物里**看得见**这条链路（`chaos-1` 的 `refs` 会多出 `chaos1Session`）。
      const closure = collectWithHelpers(src, all);
      for (const name of closure.names) refs.add(name);
      // 钩子形状
      const hooks = [];
      if (/\bmiddle\s*:/.test(block)) hooks.push('middle');
      const trigM = /triggers\s*:\s*\{/.exec(block);
      const triggers = [];
      if (trigM) {
        const tb = blockAt(block, trigM.index + trigM[0].length - 1);
        for (const km of tb.matchAll(/(?:^|[,{\s])'?([A-Za-z_$][\w$-]*)'?\s*:\s*\{/g)) {
          const inner = blockAt(tb, km.index + km[0].length - 1);
          triggers.push({
            kind: km[1],
            top: /\btop\s*:\s*true/.test(inner),
            cond: /\bcond\s*:/.test(inner),
          });
        }
        hooks.push('triggers');
      }
      if (/\bvalueModifier\s*:/.test(block)) hooks.push('valueModifier');
      // 引擎动作/连锁标记（不是 op，但决定"这张卡会牵出别的动作"）
      const markers = [];
      for (const mk of ['fireRefreshReactives', 'controlRearrangeFlow', 'canRefreshDraw']) {
        if (block.includes(mk)) markers.push(mk);
      }
      const ops = new Set();
      const prompts = [];
      const unresolved = [];
      let controlRefs = false;
      for (const name of closure.names) {
        // 体已在闭包那一步取好（`scanAt`）—— 不再 `bodyOfName` 第二遍，免得两份读数分叉
        const body = closure.scanAt.get(name);
        const s = scan(body);
        s.ops.forEach((o) => ops.add(o));
        prompts.push(...s.prompts.map((p) => ({ ...p, from: name })));
        // 「控制权有关」的代码口径：这段效果里读写了控制权 / 走了持控者重排 / 应答权按持控者算
        if (/s\.control|controlRearrangeFlow|ctx\.control|\bholder\b/.test(body)) controlRefs = true;
      }
      // 登记块里引用了、但本文件找不到同名函数的标识符（如 `true`）：与改前同形地留在 unresolved
      for (const name of all) if (bodyOfName(src, name) === null) unresolved.push(name);
      const t = texts[id] ?? null;
      cards.push({
        id,
        file: f,
        protocol: t?.protocol ?? id.split('-')[0],
        value: t?.value ?? Number(id.split('-')[1]),
        text: t,
        directives: { top: !!t?.top, middle: !!t?.middle, bottom: !!t?.bottom },
        hooks,
        triggers,
        refs: [...refs].sort(),
        unresolved: unresolved.sort(),
        ops: [...ops].sort(),
        markers: [...markers].sort(),
        controlRefs,
        prompts,
      });
    }
    out.push({ file: f, cards });
  }

  const cards = out.flatMap((f) => f.cards);
  const ids = (list) => [...new Set(list)].sort();

  const group = (keyOf) => {
    const g = {};
    for (const c of cards) for (const k of keyOf(c)) (g[k] ??= []).push(c.id);
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, ids(v)]));
  };

  const triggerIndex = {};
  for (const c of cards) {
    for (const tr of c.triggers) {
      (triggerIndex[tr.kind] ??= []).push({ id: c.id, top: tr.top, cond: tr.cond });
    }
  }

  return {
    generatedFrom: { effects: DIR, data: DATA_FILES },
    cardCount: cards.length,
    dataCardCount: Object.keys(texts).length,
    directiveCounts: {
      top: cards.filter((c) => c.directives.top).length,
      middle: cards.filter((c) => c.directives.middle).length,
      bottom: cards.filter((c) => c.directives.bottom).length,
    },
    byDirective: group((c) => [
      ...(c.directives.top ? ['top'] : []),
      ...(c.directives.middle ? ['middle'] : []),
      ...(c.directives.bottom ? ['bottom'] : []),
    ]),
    byOp: group((c) => c.ops),
    byPromptKind: group((c) => c.prompts.map((p) => p.kind)),
    byChooser: group((c) => c.prompts.filter((p) => p.chooser).map((p) => `chooser:${p.chooser}`)),
    crossSideChooser: ids(cards.filter((c) => c.prompts.some((p) => ['foe', 'opp', 'holder'].includes(p.chooser))).map((c) => c.id)),
    rearrangeSideCards: ids(cards.filter((c) => c.prompts.some((p) => p.rearrangeSide)).map((c) => c.id)),
    declareCards: ids(cards.filter((c) => c.prompts.some((p) => (p.title ?? '').includes('宣告'))).map((c) => c.id)),
    valueModifierCards: ids(cards.filter((c) => c.hooks.includes('valueModifier')).map((c) => c.id)),
    noPromptCards: ids(cards.filter((c) => c.prompts.length === 0).map((c) => c.id)),
    triggerIndex,
    topFlagTriggerCards: ids(cards.filter((c) => c.triggers.some((t) => t.top)).map((c) => c.id)),
    controlRelatedCards: ids(cards.filter((c) => c.controlRefs).map((c) => c.id)),
    controlTextCards: ids(cards.filter((c) => /控制权/.test([c.text?.top, c.text?.middle, c.text?.bottom].filter(Boolean).join(' '))).map((c) => c.id)),
    passiveCards: Object.keys(texts).filter((id) => !cards.some((c) => c.id === id)).sort(),
    unconditionalTriggerCards: ids(cards.filter((c) => c.triggers.length > 0 && c.triggers.every((t) => !t.cond)).map((c) => c.id)),
    conditionalTriggerCards: ids(cards.filter((c) => c.triggers.some((t) => t.cond)).map((c) => c.id)),
    cards,
    /**
     * ★ **G5/T24 新增的那一个键**：`readCardTexts()` 的原始读数（defId -> 卡面三行文本）。
     *
     * 为什么必须进索引（而不是让 `tagsOfCard` 自己再去读一遍文件）：那 4 张**只有文本、没有代码钩子**
     * 的持续型卡不在 `cards` 里，而它们照样要拿到 `dir-*` 与 `misc-restrict` 两个文本口径的标签
     * —— 没有这份读数，`tagsOfCard(index, 'chaos-3')` 只能返回空数组（覆盖率判据会红）。
     *
     * ⚠️ **它不影响"与升级前同源"这条判据**：解析逻辑一字未改，这里只是把原来算完就丢掉的
     * `texts` 交出来；把本键删掉之后，`JSON.stringify(buildIndex(), null, 2)` 与升级前的 stdout
     * **逐字节相同**（T24 报告里贴的就是这条对照）。
     */
    cardTexts: texts,
  };
}

/* ------------------------------------------------------------------ *
 * 3. 标签目录（G5/T24 任务书 §1 那张表，**照抄，别自己发明 id / 文案**）
 * ------------------------------------------------------------------ */

/**
 * 31 个标签（**以 `TAG_DEFS` 为准**：数它有多少条就是多少条，别抄别处的数字 —— 任务书初稿写"28"是数错了），
 * 顺序 = 任务书 §1 表序 = 界面分组顺序。
 *
 * `group` 只是**界面分组**，不是判定口径；`id` / `label` 是产物里逐字写下的那两个字段
 * （生成物 `src/data/cardEffectTags.ts` 的内容就是这张表的转写）。
 */
export const TAG_DEFS = [
  { id: 'dir-top', label: '顶部指令', group: '指令位置' },
  { id: 'dir-middle', label: '中部指令', group: '指令位置' },
  { id: 'dir-bottom', label: '底部指令', group: '指令位置' },
  { id: 'trig-play', label: '打出结算', group: '触发时机' },
  { id: 'trig-start', label: '回合开始', group: '触发时机' },
  { id: 'trig-end', label: '回合结束', group: '触发时机' },
  { id: 'trig-before-covered', label: '被盖住前', group: '触发时机' },
  { id: 'trig-before-flip', label: '被翻转前', group: '触发时机' },
  { id: 'trig-before-compile', label: '被编译删除前', group: '触发时机' },
  { id: 'trig-chain', label: '连锁反应', group: '触发时机' },
  { id: 'trig-control-gain', label: '对手获得控制权后', group: '触发时机' },
  { id: 'trig-hidden-top', label: '顶命令（被盖仍生效）', group: '触发时机' },
  { id: 'trig-conditional', label: '条件触发', group: '触发时机' },
  { id: 'op-discard', label: '弃牌', group: '效果动作' },
  { id: 'op-delete', label: '删除', group: '效果动作' },
  { id: 'op-flip', label: '翻转', group: '效果动作' },
  { id: 'op-shift', label: '偏转', group: '效果动作' },
  { id: 'op-reveal', label: '揭示', group: '效果动作' },
  { id: 'op-return', label: '回手', group: '效果动作' },
  { id: 'op-draw', label: '抽牌', group: '效果动作' },
  { id: 'op-transfer', label: '牌张转移（给 / 拿 / 库顶转移 / 回库底）', group: '效果动作' },
  { id: 'op-play', label: '打出（牌库顶 / 手牌 / 弃牌堆）', group: '效果动作' },
  { id: 'op-rearrange', label: '重排协议', group: '效果动作' },
  { id: 'op-swap', label: '换堆叠', group: '效果动作' },
  { id: 'op-copy', label: '复制中指令', group: '效果动作' },
  { id: 'op-value', label: '数值修正', group: '效果动作' },
  { id: 'ctl-related', label: '控制权相关', group: '控制权' },
  { id: 'misc-declare', label: '宣告（幸运）', group: '其它' },
  { id: 'misc-opp-choice', label: '对手来选', group: '其它' },
  { id: 'misc-restrict', label: '限制 / 无效化', group: '其它' },
];

/** 每个标签的"判定来源"（**只用于注释与自查**，字段名照抄任务书 §1 第三列）。 */
const TAG_SOURCE = {
  'dir-top': '卡面 top 非空',
  'dir-middle': '卡面 middle 非空',
  'dir-bottom': '卡面 bottom 非空',
  'trig-play': '该卡登记了 middle',
  'trig-start': "triggers.start",
  'trig-end': "triggers.end",
  'trig-before-covered': "triggers['before-covered']",
  'trig-before-flip': "triggers['before-flip']",
  'trig-before-compile': "triggers['before-compile']",
  'trig-chain': "任一 triggers['after-*']",
  'trig-control-gain': "triggers['after-opponent-gain-control']",
  'trig-hidden-top': '任一 trigger 带 top: true',
  'trig-conditional': '任一 trigger 带 cond',
  'op-discard': 'discard / discardMany / discardDeckTop / discardWholeDeck',
  'op-delete': 'delete',
  'op-flip': 'flip',
  'op-shift': 'shift',
  'op-reveal': 'reveal',
  'op-return': 'return',
  'op-draw': 'draw / drawFromDeck',
  'op-transfer': 'give / takeRandom / takeFromField / deckTopTransfer / toDeckBottom',
  'op-play': 'playTopDeck / playFromHand / playFromTrash',
  'op-rearrange': 'rearrangeProtocols / reorderProtocols',
  'op-swap': 'swapStacks',
  'op-copy': 'copyMiddle',
  'op-value': 'valueModifier',
  'ctl-related': 's.control / controlRearrangeFlow / holder，或卡面文本含"控制权"',
  'misc-declare': '选择请求标题含"宣告"',
  'misc-opp-choice': 'chooser: foe / opp / holder',
  'misc-restrict': 'chaos-3 / ice-4 / ice-6 / metal-2 ＋ apathy-2 / fear-0 / rigidity-7',
};

/** 每个标签的判定集合（op 名一族的并集） */
const OP_TAGS = {
  'op-discard': ['discard', 'discardMany', 'discardDeckTop', 'discardWholeDeck'],
  'op-delete': ['delete'],
  'op-flip': ['flip'],
  'op-shift': ['shift'],
  'op-reveal': ['reveal'],
  'op-return': ['return'],
  'op-draw': ['draw', 'drawFromDeck'],
  'op-transfer': ['give', 'takeRandom', 'takeFromField', 'deckTopTransfer', 'toDeckBottom'],
  'op-play': ['playTopDeck', 'playFromHand', 'playFromTrash'],
  'op-rearrange': ['rearrangeProtocols', 'reorderProtocols'],
  'op-swap': ['swapStacks'],
  'op-copy': ['copyMiddle'],
};

/** 无代码钩子、靠文本口径兜住的"限制 / 无效化"清单（分类文档 §7 最后一行那 7 张） */
const RESTRICT_CARDS = new Set([
  'chaos-3', 'ice-4', 'ice-6', 'metal-2', 'apathy-2', 'fear-0', 'rigidity-7',
]);

/** 这张卡有没有用到 `ops` 里任意一个 op */
const hasAnyOp = (card, ops) => card.ops.some((o) => ops.includes(o));
/** 这张卡有没有登记某一种 trigger */
const hasTrigger = (card, kind) => card.triggers.some((t) => t.kind === kind);

/**
 * 一张卡的标签数组（纯函数，**不读文件、不看时钟、不写全局**）。
 *
 * 判据来源见 `TAG_SOURCE`；返回顺序 = `TAG_DEFS` 顺序（产物里最稳的写法）。
 */
export function tagsOfCard(index, defId) {
  const card = (index?.cards ?? []).find((c) => c.id === defId);
  /** 卡面读数：有代码钩子的卡从 `card.text` 取，4 张只有文本的持续型卡从 `index.cardTexts` 取 */
  const t = card?.text ?? index?.cardTexts?.[defId] ?? null;
  /** 4 张持续型卡没有任何钩子/op/trigger/prompt —— 它们的标签只能来自文本口径 */
  const empty = {
    directives: { top: !!t?.top, middle: !!t?.middle, bottom: !!t?.bottom },
    triggers: [], ops: [], hooks: [], prompts: [], controlRefs: false,
  };
  const c = card ?? empty;
  const prompts = c.prompts ?? [];
  const texts = [t?.top, t?.middle, t?.bottom].filter(Boolean).join(' ');
  const hit = (id) => {
    switch (id) {
      case 'dir-top': return c.directives.top;
      case 'dir-middle': return c.directives.middle;
      case 'dir-bottom': return c.directives.bottom;
      case 'trig-play': return c.directives.middle;
      case 'trig-start': return hasTrigger(c, 'start');
      case 'trig-end': return hasTrigger(c, 'end');
      case 'trig-before-covered': return hasTrigger(c, 'before-covered');
      case 'trig-before-flip': return hasTrigger(c, 'before-flip');
      case 'trig-before-compile': return hasTrigger(c, 'before-compile');
      case 'trig-chain': return c.triggers.some((x) => x.kind.startsWith('after-'));
      case 'trig-control-gain': return hasTrigger(c, 'after-opponent-gain-control');
      case 'trig-hidden-top': return c.triggers.some((x) => x.top);
      case 'trig-conditional': return c.triggers.some((x) => x.cond);
      case 'ctl-related':
        return c.controlRefs === true || /控制权/.test(texts);
      case 'misc-declare': return prompts.some((p) => (p.title ?? '').includes('宣告'));
      case 'misc-opp-choice': return prompts.some((p) => ['foe', 'opp', 'holder'].includes(p.chooser));
      case 'misc-restrict': return RESTRICT_CARDS.has(defId);
      case 'op-value': return (c.hooks ?? []).includes('valueModifier');
      /**
       * 2026-09-22（G5 T25）：**"会重排协议的卡"这一类要一张不漏**（用户要求把它们放到一起）。
       *
       * 三种产出形态都算：
       *  1. `op: 'rearrangeProtocols'` —— 点选两个协议位交换（`chaos-1` / `nova-0` / `psychic-2` /
       *     `spirit-4` / `water-2` / `fulcrum-3`）；
       *  2. `op: 'reorderProtocols'` —— 一次性回填整条新排列（`momentum-4` / `nova-2`）；
       *  3. 选择请求的 `actions` 里含 `action:order:` —— 走整屏重排窗口那条路（**同一批卡的第二重保险**：
       *     `nova-2` 的重排写在 `nova2Middle` 里、`momentum-4` 的在 `momentum4Middle` 里，`ops` 已经
       *     覆盖，但"窗口承接"这件事只有 `actions` 这一个机器可读的痕迹）。
       */
      case 'op-rearrange':
        return hasAnyOp(c, OP_TAGS['op-rearrange'])
          || prompts.some((p) => /action:order:/.test(p.actions ?? ''));
      default: return OP_TAGS[id] === undefined ? false : hasAnyOp(c, OP_TAGS[id]);
    }
  };
  return TAG_DEFS.filter((def) => hit(def.id)).map((def) => def.id);
}

/* ------------------------------------------------------------------ *
 * 4. 生成物：src/data/cardEffectTags.ts
 * ------------------------------------------------------------------ */

/** TS 单引号字符串字面量（本仓的引号习惯） */
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** JSON 数组，一行一个（270 条卡要一行一条，不然 diff 完全读不了） */
const jsonLines = (arr, indent) => arr.map((x) => `${indent}${JSON.stringify(x)},`).join('\n');

/**
 * 把一份索引渲染成 `src/data/cardEffectTags.ts` 的**完整文本**（纯函数：只吃 `index`）。
 *
 * 形状逐字照任务书 §2.2：
 *  - 第一行是"自动生成：… ——勿手改"（与 `src/data/protocolRatings.ts` 同款抬头）；
 *  - `CARD_EFFECT_TAGS` = **`TAG_DEFS` 的条数**（今天 30；**别在这里抄数字**，改标签时只改 `TAG_DEFS`），
 *    顺序 = `TAG_DEFS` 顺序；
 *  - `CARD_EFFECT_TAGS_BY_CARD` = 每一张**卡面数据里的**卡（270 条，含 4 张无代码钩子的持续型），
 *    键序 = defId 码点序（`[...keys].sort()` 是码点序，不是 locale 序）。
 */
export function renderTagsModule(index) {
  const grouped = new Map();
  for (const g of TAG_DEFS) {
    if (!grouped.has(g.group)) grouped.set(g.group, []);
    grouped.get(g.group).push(g);
  }
  const tagLines = [];
  for (const [group, defs] of grouped) {
    tagLines.push(`  // ${group}`);
    for (const d of defs) {
      tagLines.push(`  { id: ${q(d.id)}, label: ${q(d.label)}, group: ${q(d.group)} }, // ${TAG_SOURCE[d.id]}`);
    }
  }
  /**
   * ⚠️ **键集 = 卡面数据里的全部 defId（270 条），不是"登记了效果代码的那些"（266 条）**。
   *
   * 差的 4 张（`chaos-3` / `ice-4` / `ice-6` / `metal-2`）是**只有文本、没有代码钩子**的持续型限制，
   * 规则层实现（分类文档 §0）。生成物喂的是**图鉴**，而图鉴显示的就是这 270 张卡 ——
   * 少 4 条键，那 4 张卡在筛选里会既不被任何标签命中、也查不到 `undefined` 之外的读数。
   * 它们的标签来自 `index.passiveCards` 与卡面文本（`dir-*` + `misc-restrict`）。
   */
  const ids = [...index.cards.map((c) => c.id), ...(index.passiveCards ?? [])].sort();
  const byCard = ids.map((id) => `  ${q(id)}: [${tagsOfCard(index, id).map(q).join(', ')}],`);
  return [
    '// 自动生成：node tools/card-effect-index.mjs --write-tags ——勿手改',
    `// 图鉴右下角「按效果分类筛选」的标签目录（${TAG_DEFS.length} 类）与每卡标签。`,
    '// 标签来自效果代码的事实（op / trigger / chooser / 选择请求标题），不是按卡面文本现算；',
    '// 口径与已知偏差见 docs/2026-09-21-卡牌效果分类与关键词.md（第二版）§8 / §9。',
    'export interface CardEffectTag { id: string; label: string; group: string }',
    '',
    `/** ${TAG_DEFS.length} 个标签，顺序 = 界面分组顺序（任务书 §1 表序） */`,
    'export const CARD_EFFECT_TAGS: readonly CardEffectTag[] = [',
    ...tagLines,
    '];',
    '',
    `/** defId -> 标签 id 数组（${ids.length} 张卡，码点序） */`,
    'export const CARD_EFFECT_TAGS_BY_CARD: Readonly<Record<string, readonly string[]>> = {',
    ...byCard,
    '};',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * 5. 入口：直接执行才做事（被 import 时**一行副作用都没有**）
 * ------------------------------------------------------------------ */

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const index = buildIndex();
  if (process.argv.includes('--write-tags')) {
    writeFileSync(TAGS_FILE, renderTagsModule(index), 'utf8');
    console.log(`已写入 ${TAGS_FILE}（卡面数据 ${Object.keys(index.cardTexts).length} 张卡 / 标签 ${TAG_DEFS.length} 个）`);
  } else {
    console.log(JSON.stringify(index, null, 2));
  }
}
