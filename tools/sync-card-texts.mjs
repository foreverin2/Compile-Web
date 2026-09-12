/**
 * 卡牌/协议文本同步检查与生成工具（2026-09-13）
 *
 * 权威来源：`E:\studyE\compile\正版compile\compile{1,2,3}文本.txt`
 *   - 协议头：`协议名——座右铭`
 *   - 关键词：`关键词：甲，乙，丙`
 *   - 卡牌行：`协议名{点数}：顶部/中部/底部`（`空` = 无该指令）
 * 目标：`src/data/cards{1,2,3}.ts` 的 name/loadingText/commands/top/middle/bottom
 *
 * 转写规则（与 data 文件头注释一致）：数量词阿拉伯数字化、句末补句号、`空` 不落字段、
 * 其余文字照录（术语不归一——偏转/平移/链路/堆叠以文本文件为准）。
 *
 * 用法：
 *   node tools/sync-card-texts.mjs          # 只报告差异（不写文件）
 *   node tools/sync-card-texts.mjs --write  # 把差异写回 data 文件（仅动文本字段）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const TXT_DIR = 'E:\\studyE\\compile\\正版compile';
const WRITE = process.argv.includes('--write');

/** 中文数字 → 阿拉伯数字（仅数量语境：一张/两点/三条/1个…） */
const CN_NUM = { 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
const QUANT = '张|点|条|个|次|位|名|份|面|种|枚|颗|组|段';

function normDigits(s) {
  let out = s;
  for (const [cn, ar] of Object.entries(CN_NUM)) {
    out = out.replace(new RegExp(`${cn}(?=(${QUANT}))`, 'g'), ar);
  }
  return out;
}

/** 比较用归一：去空白、去句末句号、中文数字→阿拉伯 */
function norm(s) {
  if (s === undefined) return '';
  return normDigits(String(s)).replace(/\s+/g, '').replace(/。+$/, '');
}

function parseTxt(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const protocols = [];
  const cards = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^(.+?)——(.+)$/);
    if (head) {
      cur = { name: head[1].trim(), motto: head[2].trim(), keywords: [] };
      protocols.push(cur);
      continue;
    }
    const kw = line.match(/^关键词[：:](.*)$/);
    if (kw && cur) {
      cur.keywords = kw[1].split(/[，,、]/).map((x) => x.trim()).filter(Boolean);
      continue;
    }
    const card = line.match(/^(.+?)(\d+)[：:](.*)$/);
    if (card && cur) {
      const segs = card[3].split('/').map((x) => x.trim());
      if (segs.length !== 3) {
        console.warn(`[警告] 段数异常（${segs.length}）：${line}`);
      }
      cards.push({
        protoName: card[1].trim(),
        value: Number(card[2]),
        segs: [segs[0] ?? '空', segs[1] ?? '空', segs[2] ?? '空'],
      });
    }
  }
  return { protocols, cards };
}

/** 从 data TS 文件提取：帧协议元数据 + 卡牌文本字段 */
function parseData(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const protocols = new Map();
  const cards = new Map();
  for (const raw of lines) {
    const line = raw;
    const p = line.match(/\{\s*defId:\s*'([a-z0-9]+)',\s*name:\s*'([^']*)',\s*set:\s*'([A-Z0-9]+)',\s*commands:\s*\[([^\]]*)\],\s*loadingText:\s*'([^']*)'\s*\}/);
    if (p) {
      protocols.set(p[1], {
        defId: p[1],
        name: p[2],
        set: p[3],
        commands: p[4].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean),
        loadingText: p[5],
      });
      continue;
    }
    const c = line.match(/\{\s*defId:\s*'([a-z]+-\d+)',\s*protocol:\s*'([a-z]+)',\s*value:\s*(\d+)(.*)\}\s*,?\s*$/);
    if (c) {
      const rest = c[4];
      const field = (k) => {
        const m = rest.match(new RegExp(`${k}:\\s*'([^']*)'`));
        return m ? m[1] : undefined;
      };
      cards.set(c[1], {
        defId: c[1],
        protocol: c[2],
        value: Number(c[3]),
        top: field('top'),
        middle: field('middle'),
        bottom: field('bottom'),
        line,
        file: path,
      });
    }
  }
  return { protocols, cards };
}

const txtAll = [
  { file: 'compile1文本.txt', data: 'cards.ts' },
  { file: 'compile2文本.txt', data: 'cards2.ts' },
  { file: 'compile3文本.txt', data: 'cards3.ts' },
];

const report = { cardDiffs: [], protoDiffs: [], missing: [], extra: [] };

for (const { file, data } of txtAll) {
  const txt = parseTxt(join(TXT_DIR, file));
  const dat = parseData(join(repo, 'src', 'data', data));
  // 协议名 → defId（用 data 的 name 反查）
  const nameToDefId = new Map();
  for (const [defId, p] of dat.protocols) nameToDefId.set(p.name, defId);

  // 协议元数据对比
  for (const tp of txt.protocols) {
    const defId = nameToDefId.get(tp.name);
    if (!defId) {
      report.missing.push(`[${file}] 文本协议「${tp.name}」在 ${data} 中找不到同名协议`);
      continue;
    }
    const dp = dat.protocols.get(defId);
    if (norm(dp.loadingText) !== norm(tp.motto)) {
      report.protoDiffs.push({ file, defId, field: 'loadingText', from: dp.loadingText, to: tp.motto });
    }
    const kwDiff =
      norm(dp.commands.join('，')) !== norm(tp.keywords.join('，'));
    if (kwDiff) {
      report.protoDiffs.push({
        file,
        defId,
        field: 'commands',
        from: dp.commands.join('，'),
        to: tp.keywords.join('，'),
      });
    }
  }

  // 卡牌文本对比
  for (const tc of txt.cards) {
    const defId = nameToDefId.get(tc.protoName);
    if (!defId) continue; // 协议名映射缺失已在上面报告
    const key = `${defId}-${tc.value}`;
    const dc = dat.cards.get(key);
    if (!dc) {
      report.missing.push(`[${file}] 文本卡牌 ${key} 在 ${data} 中缺少`);
      continue;
    }
    const fields = ['top', 'middle', 'bottom'];
    tc.segs.forEach((seg, i) => {
      const f = fields[i];
      const txtVal = seg === '空' ? undefined : withPeriod(seg);
      const datVal = dc[f];
      if (norm(txtVal) !== norm(datVal)) {
        report.cardDiffs.push({ file, data, defId: key, field: f, from: datVal, to: txtVal });
      }
    });
  }
}

function withPeriod(s) {
  const t = s.trim();
  if (t === '' || t === '空') return undefined;
  // 转写惯例（与 data 文件头注释一致）：数量词阿拉伯数字化、去多余空格、句末补句号
  let out = normDigits(t).replace(/\s+/g, '');
  if (!/[。！？]$/.test(out)) out += '。';
  return out;
}

// ============ 输出 ============
console.log(`卡牌文本差异 ${report.cardDiffs.length} 处；协议元数据差异 ${report.protoDiffs.length} 处`);
console.log('');
if (report.missing.length > 0) {
  console.log('---- 缺失/映射问题 ----');
  for (const m of report.missing) console.log(m);
  console.log('');
}
if (report.protoDiffs.length > 0) {
  console.log('---- 协议元数据差异 ----');
  for (const d of report.protoDiffs) {
    console.log(`[${d.file}] ${d.defId}.${d.field}`);
    console.log(`  现: ${d.from}`);
    console.log(`  新: ${d.to}`);
  }
  console.log('');
}
if (report.cardDiffs.length > 0) {
  console.log('---- 卡牌文本差异 ----');
  for (const d of report.cardDiffs) {
    console.log(`[${d.file}] ${d.defId}.${d.field}${d.to === undefined ? '（文本为「空」→ 应删除该字段）' : ''}`);
    console.log(`  现: ${d.from ?? '（无）'}`);
    console.log(`  新: ${d.to ?? '（无）'}`);
  }
}

if (!WRITE) {
  console.log('\n（未写文件；加 --write 应用）');
  process.exit(report.cardDiffs.length + report.protoDiffs.length > 0 ? 1 : 0);
}

// ============ 写回（仅文本字段） ============
const byFile = new Map();
for (const d of report.cardDiffs) {
  if (!byFile.has(d.data)) byFile.set(d.data, []);
  byFile.get(d.data).push(d);
}
let changed = 0;
for (const [dataFile, diffs] of byFile) {
  const path = join(repo, 'src', 'data', dataFile);
  let lines = readFileSync(path, 'utf8').split('\n');
  for (const d of diffs) {
    const idx = lines.findIndex((l) => l.includes(`defId: '${d.defId}'`));
    if (idx === -1) {
      console.warn(`[警告] 未找到 ${d.defId} 于 ${dataFile}`);
      continue;
    }
    let line = lines[idx];
    const fieldRe = new RegExp(`(, )${d.field}: '[^']*'`);
    if (d.to === undefined) {
      // 文本为「空」→ 删除字段
      line = line.replace(fieldRe, '');
    } else if (fieldRe.test(line)) {
      line = line.replace(fieldRe, `$1${d.field}: '${d.to}'`);
    } else {
      // 新增字段：插到 value: N 之后
      line = line.replace(/(value: \d+)/, `$1, ${d.field}: '${d.to}'`);
    }
    lines[idx] = line;
    changed += 1;
  }
  writeFileSync(path, lines.join('\n'));
}
// 协议元数据
for (const d of report.protoDiffs) {
  const fileMap = { 'cards.ts': 'cards1', 'cards2.ts': 'cards2', 'cards3.ts': 'cards3' };
  void fileMap;
  const path = join(repo, 'src', 'data', txtAll.find((t) => t.file === d.file).data);
  let lines = readFileSync(path, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(`defId: '${d.defId}', name:`));
  if (idx === -1) {
    console.warn(`[警告] 未找到协议 ${d.defId} 于 ${d.file}`);
    continue;
  }
  let line = lines[idx];
  if (d.field === 'loadingText') {
    line = line.replace(/loadingText: '[^']*'/, `loadingText: '${d.to}'`);
  } else {
    const arr = d.to
      .split(/[，,]/)
      .map((x) => `'${x.trim()}'`)
      .join(', ');
    line = line.replace(/commands: \[[^\]]*\]/, `commands: [${arr}]`);
  }
  lines[idx] = line;
  writeFileSync(path, lines.join('\n'));
  changed += 1;
}
console.log(`\n已写回 ${changed} 处文本（仅文本字段）。`);
