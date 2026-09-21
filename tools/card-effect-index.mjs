/**
 * 卡牌效果索引（**开发工具，不是门禁**）：把卡牌的两面事实各扒一份出来，供
 * `docs/2026-09-21-卡牌效果分类与关键词.md`（分类表）与图鉴筛选（后续任务）引用：
 *
 *   1. **卡面文本**（`src/data/cards*.ts` 的 `top` / `middle` / `bottom` 三个字段）—— 玩家看到的那三行指令；
 *   2. **效果代码**（`src/core/effects/cards/*.ts`）—— 每张卡登记的钩子
 *      （`middle` / `triggers.<kind>`（带 `top: true`? 带 `cond`?）/ `valueModifier`）、
 *      用到的**效果步骤 op**、以及**选择请求**（kind / title / chooser / rearrangeSide）。
 *
 * 用法（仓库根，输出打到 stdout；JSON 是临时产物，惯例放在 `.superpowers/` 下）：
 *   node tools/card-effect-index.mjs > .superpowers/g5-T23/effects-index.json
 *
 * 它只做文本级解析（本仓结构稳定：`registerCardEffects('id', { … })` + `function* name(`、
 * 卡牌数据一行一条），**不做类型检查**；解析不到的引用如实标 `unresolved`，**不猜**。
 * 它跑在 `tools/` 下、不进 `src/`，也不参与 `npm run build` / `texts:check` / 任何 CDP 门。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/core/effects/cards';
const DATA_FILES = ['src/data/cards.ts', 'src/data/cards2.ts', 'src/data/cards3.ts'];

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
    for (const name of all) {
      const body = bodyOfName(src, name);
      if (body === null) { unresolved.push(name); continue; }
      const s = scan(body);
      s.ops.forEach((o) => ops.add(o));
      prompts.push(...s.prompts.map((p) => ({ ...p, from: name })));
      // 「控制权有关」的代码口径：这段效果里读写了控制权 / 走了持控者重排 / 应答权按持控者算
      if (/s\.control|controlRearrangeFlow|ctx\.control|\bholder\b/.test(body)) controlRefs = true;
    }
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

console.log(JSON.stringify({
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
}, null, 2));
