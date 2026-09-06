// 一次性脚本：解析 Compile45套协议卡组评分与阵容推荐.txt → src/data/protocolRatings.ts
// 用法：node tools/parse-ratings.mjs "E:\studyE\compile\正版compile\Compile45套协议卡组评分与阵容推荐.txt"
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
const txt = readFileSync(src, 'utf8').replace(/\r/g, '').split('\n');

// 引擎 defId ↔ 中文名（改名后）：45 套
const NAME2DEF = {
  流水: 'water', 火焰: 'fire', 明光: 'light', 黑暗: 'darkness', 生命: 'life', 死亡: 'death',
  精神: 'spirit', 重力: 'gravity', 灵能: 'psychic', 瘟疫: 'plague', 金属: 'metal', 速度: 'speed',
  爱: 'love', 恨: 'hate', 冷漠: 'apathy',
  寒冰: 'ice', 明镜: 'mirror', 和平: 'peace', 混乱: 'chaos', 恐惧: 'fear', 透彻: 'clarity',
  腐化: 'corruption', 时间: 'time', 战争: 'war', 勇气: 'courage', 幸运: 'luck', 迷雾: 'smoke',
  同化: 'assimilation', 多元: 'diversity', 联合: 'unity',
  嫉妒: 'envy', 暴食: 'gluttony', 贪婪: 'greed', 色欲: 'lust', 傲慢: 'pride', 怠惰: 'sloth',
  愤怒: 'wrath', 伏击: 'ambush', 支点: 'fulcrum', 压制: 'overwhelm', 动量: 'momentum',
  新星: 'nova', 惰性: 'inertia', 刚性: 'rigidity', 柔性: 'flexibility',
};

const SCORE_KEYS = ['上手', '强度', '适配', '设计', '深度', '稳定'];

/** 解析单个协议块（从标题行开始到下一个标题行/末尾） */
function parseBlock(lines, start) {
  const header = lines[start];
  // 「01 流水——涤旧焕新    【定位：xxx】」
  const m = header.match(/^\s*\d+\s+([^\s—]+)——[^\s【]+/);
  if (!m) return null;
  const name = m[1];
  const posM = header.match(/【定位：([^】]+)】/);
  const entry = { defId: NAME2DEF[name], name, position: posM ? posM[1].trim() : '', scores: {}, review: '', pairs: [], styles: [] };
  let section = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\d+\s+[^\s—]+——/.test(line)) break; // 下一协议标题
    if (line.startsWith('【定位】')) { entry.position = line.replace('【定位】', '').trim(); continue; }
    if (line.startsWith('【评分】')) {
      const s = line.replace('【评分】', '').trim();
      for (const part of s.split('｜')) {
        const kv = part.match(/^(.+?)([\d.]+)$/);
        if (kv && SCORE_KEYS.includes(kv[1])) entry.scores[kv[1]] = Number(kv[2]);
      }
      continue;
    }
    if (line.startsWith('▶')) { entry.review += line.replace(/^▶\s*/, '').replace(/\s+/g, ' '); continue; }
    if (line === '【推荐搭配协议】') { section = 'pairs'; continue; }
    if (line === '【推荐流派】') { section = 'styles'; continue; }
    if (section && /^[①②③④⑤⑥]/.test(line)) {
      const item = line.replace(/^[①②③④⑤⑥]\s*/, '');
      if (section === 'pairs') entry.pairs.push(item);
      else entry.styles.push(item);
    }
  }
  // 压缩内部连续空白（原文折行/多空格）
  entry.review = entry.review.replace(/\s+/g, ' ').trim();
  entry.pairs = entry.pairs.map((p) => p.replace(/\s+/g, ' ').trim());
  entry.styles = entry.styles.map((s) => s.replace(/\s+/g, ' ').trim());
  return entry;
}

const out = [];
for (let i = 0; i < txt.length; i++) {
  if (/^\s*\d+\s+[^\s—]+——/.test(txt[i])) {
    const entry = parseBlock(txt, i);
    if (entry && entry.defId) out.push(entry);
  }
}
if (out.length !== 45) {
  console.error(`expected 45 protocols, got ${out.length}`);
  const missing = Object.values(NAME2DEF).filter((d) => !out.some((e) => e.defId === d));
  console.error('missing:', missing.join(','));
  process.exit(1);
}
console.log(`parsed ${out.length} protocols`);

const lines = [];
lines.push('// 自动生成：node tools/parse-ratings.mjs（源：Compile45套协议卡组评分与阵容推荐.txt）——勿手改');
lines.push('// 草稿页 hover 展示框数据（修改提示词 21）：每套协议的定位/六维评分/点评/推荐搭配协议/推荐流派');
lines.push('export interface ProtocolRating {');
lines.push('  defId: string;');
lines.push('  name: string;');
lines.push('  /** 定位（如「万金油运营/回手引擎」） */');
lines.push('  position: string;');
lines.push('  /** 六维 10 分制：上手/强度/适配/设计/深度/稳定 */');
lines.push('  scores: Record<string, number>;');
lines.push('  /** 点评（▶ 段） */');
lines.push('  review: string;');
lines.push('  /** 推荐搭配协议（①②③…，每项含协议名+理由） */');
lines.push('  pairs: string[];');
lines.push('  /** 推荐流派 */');
lines.push('  styles: string[];');
lines.push('}');
lines.push('');
lines.push('export const PROTOCOL_RATINGS: ProtocolRating[] = [');
for (const e of out) {
  lines.push('  {');
  lines.push(`    defId: '${e.defId}',`);
  lines.push(`    name: '${e.name}',`);
  lines.push(`    position: '${e.position}',`);
  lines.push('    scores: { ' + SCORE_KEYS.map((k) => `${k}: ${e.scores[k] ?? 0}`).join(', ') + ' },');
  lines.push(`    review: '${e.review.replace(/'/g, "\\'")}',`);
  lines.push(`    pairs: [${e.pairs.map((p) => `'${p.replace(/'/g, "\\'")}'`).join(', ')}],`);
  lines.push(`    styles: [${e.styles.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(', ')}],`);
  lines.push('  },');
}
lines.push('];');
lines.push('');
writeFileSync(new URL('../src/data/protocolRatings.ts', import.meta.url), lines.join('\n'), 'utf8');
console.log('written src/data/protocolRatings.ts');
