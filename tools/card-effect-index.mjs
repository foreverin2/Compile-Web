/**
 * 卡牌效果索引（**开发工具，不是门禁**）：把 `src/core/effects/cards/*.ts` 里**每张卡**登记的钩子
 * （middle / triggers.<kind> / top / bottom / valueModifier）与它们用到的**效果步骤 op** 和
 * **选择请求**（kind / title / chooser / rearrangeSide）扒成一份 JSON，供
 * `docs/2026-09-21-卡牌效果分类与关键词.md` 引用。
 *
 * 用法（仓库根，输出打到 stdout；JSON 是临时产物，惯例放在 `.superpowers/` 下）：
 *   node tools/card-effect-index.mjs > .superpowers/g5-T23/effects-index.json
 *
 * 它只做文本级解析（本仓的卡效文件结构稳定：`registerCardEffects('id', { … })` + `function* name(`），
 * 不做类型检查；解析不到引用时如实标 `unresolved`，**不猜**。它跑在 `tools/` 下、不进 `src/`，
 * 也不参与 `npm run build` / `texts:check` / 任何 CDP 门。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/core/effects/cards';
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort();

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

function scan(text) {
  const ops = new Set();
  for (const m of text.matchAll(OP_RE)) ops.add(m[1]);
  const prompts = [];
  for (const m of text.matchAll(PROMPT_RE)) {
    // 取该 prompt 附近 400 字符作为窗口，读 title / chooser / rearrangeSide
    const win = text.slice(m.index, m.index + 400);
    const title = TITLE_RE.exec(win);
    const chooser = CHOOSER_RE.exec(win);
    prompts.push({
      kind: m[1],
      title: title ? title[1].replace(/^[`']|[`']$/g, '') : null,
      chooser: chooser ? chooser[1] : null,
      rearrangeSide: /rearrangeSide:/.test(win),
    });
  }
  return { ops: [...ops].sort(), prompts };
}

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
    // `triggers: { end: { fn: love1End` 这类也已被上面的 fn 捕获；再兜一层：块里出现的所有标识符里
    // 能在本文件找到同名函数的，也算引用（宁可多算，标 source:'block-scan'）
    const scanned = new Set();
    for (const r of block.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (bodyOfName(src, r[1]) !== null) scanned.add(r[1]);
    }
    const all = new Set([...refs, ...scanned]);
    // 钩子形状：`middle:` / `triggers: { <key>: … }` / `top:` / `bottom:`（后两者是"顶/底命令"标志）
    const hooks = [];
    if (/\bmiddle\s*:/.test(block)) hooks.push('middle');
    const trigM = /triggers\s*:\s*\{/.exec(block);
    const triggerKeys = [];
    if (trigM) {
      const tb = blockAt(block, trigM.index + trigM[0].length - 1);
      for (const k of tb.matchAll(/(?:^|[,{\s])'?([A-Za-z_$][\w$-]*)'?\s*:\s*\{/g)) triggerKeys.push(k[1]);
      hooks.push('triggers');
    }
    if (/\btop\s*:\s*(true|'|\{|function)/.test(block)) hooks.push('top');
    if (/\bbottom\s*:\s*(true|'|\{|function)/.test(block)) hooks.push('bottom');
    if (/\bvalueModifier\s*:/.test(block)) hooks.push('valueModifier');
    // 引擎动作/连锁标记（不是 op，但决定"这张卡会牵出别的动作"）
    const markers = [];
    for (const mk of ['fireRefreshReactives', 'controlRearrangeFlow', 'canRefreshDraw', 'clear-cache', 'refresh', 'compile']) {
      if (block.includes(mk)) markers.push(mk);
    }
    const ops = new Set();
    const prompts = [];
    const unresolved = [];
    for (const name of all) {
      const body = bodyOfName(src, name);
      if (body === null) { unresolved.push(name); continue; }
      const s = scan(body);
      s.ops.forEach((o) => ops.add(o));
      prompts.push(...s.prompts.map((p) => ({ ...p, from: name })));
    }
    cards.push({
      id,
      file: f,
      hooks,
      triggerKeys,
      refs: [...refs].sort(),
      blockScan: [...scanned].sort(),
      unresolved: unresolved.sort(),
      ops: [...ops].sort(),
      markers: [...markers].sort(),
      prompts,
    });
  }
  out.push({ file: f, cards });
}

const byOp = {};
for (const f of out) for (const c of f.cards) for (const o of c.ops) (byOp[o] ??= []).push(c.id);
const byPromptKind = {};
for (const f of out) for (const c of f.cards) for (const p of c.prompts) (byPromptKind[p.kind] ??= []).push(`${c.id}${p.chooser ? `(chooser:${p.chooser})` : ''}`);

console.log(JSON.stringify({
  generatedFrom: DIR,
  files: out.map((f) => f.file),
  cardCount: out.reduce((n, f) => n + f.cards.length, 0),
  byOp: Object.fromEntries(Object.entries(byOp).map(([k, v]) => [k, [...new Set(v)].sort()])),
  byPromptKind: Object.fromEntries(Object.entries(byPromptKind).map(([k, v]) => [k, [...new Set(v)].sort()])),
  cards: out.flatMap((f) => f.cards),
}, null, 2));
