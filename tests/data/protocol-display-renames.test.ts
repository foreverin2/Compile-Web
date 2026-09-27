import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS } from '../../src/data/demo';
import { PROTOCOL_RATINGS } from '../../src/data/protocolRatings';

/**
 * 协议显示名改名表（用户 2026-09-27：「僵化」→「死板」）的两侧一致性。
 *
 * 为什么要这几条：外部卡面/txt 原文仍是「僵化」（不改那个外部文件），本仓显示层用「死板」，
 * 两侧靠 `tools/protocol-display-renames.mjs` 的 `EXPECTED_RENAMES` 对齐（`npm run texts:check`
 * 保持 0 差异）。这张表要是写错了、或者数据侧没跟上，这里必须变红 —— 而不是留一句没人管的注释。
 * 变异自证（2026-09-27 实测）：把 `src/data/cards3.ts` 的 `name: '死板'` 改回 `'僵化'`，
 * 本文件的「显示名」「卡名」「改名表两侧一致」三条一起红。
 * 表里另外两项（愤怒→暴怒、柔性→灵活）是评分源与本仓的历史写法差异，只影响 `tools/parse-ratings.mjs`：
 * 卡面 txt 里从来没有这两种写法，所以不影响 `texts:check`（见 `tools/protocol-display-renames.mjs` 头注）。
 */

/** 从工具源码里取改名表（表在 `tools/protocol-display-renames.mjs`，两个消费方都 import 它） */
function readRenameTable(): Array<readonly [string, string]> {
  const toolPath = fileURLToPath(new URL('../../tools/protocol-display-renames.mjs', import.meta.url));
  // 用 `readFileSync(path).subarray().toString()` 的写法：本仓的 node 类型声明（tests/node-types.d.ts）
  // 只声明了这一种读法（零依赖硬约束，不许为某一处扩声明）。
  const src: string = readFileSync(toolPath).subarray(0, 1 << 20).toString('utf8');
  const block = src.match(/export const EXPECTED_RENAMES = \{([\s\S]*?)\};/);
  expect(block, 'tools/protocol-display-renames.mjs 里应有 `export const EXPECTED_RENAMES = { ... };`').not.toBeNull();
  const body = block?.[1] ?? '';
  const pairs = Array.from(body.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)).map(
    (m) => [m[1], m[2]] as const,
  );
  expect(pairs.length, '改名表非空').toBeGreaterThan(0);
  return pairs;
}

/** 一张卡的显示名（与 home.ts 的 `${proto.name} ${c.value} 分指令卡` 同一个拼法） */
function cardDisplayNames(defIds: string[]): string[] {
  return DEMO_CARD_DEFS.filter((c) => defIds.includes(c.defId)).map((c) => {
    const proto = DEMO_PROTOCOLS.find((p) => p.defId === c.protocol);
    return `${proto?.name ?? c.protocol}${c.value}`;
  });
}

describe('协议显示名改名表（僵化 → 死板）', () => {
  it('表内容：僵化/刚性 → 死板，另有评分源的历史写法 愤怒 → 暴怒、柔性 → 灵活', () => {
    expect(readRenameTable()).toEqual([
      ['僵化', '死板'],
      ['刚性', '死板'],
      ['愤怒', '暴怒'],
      ['柔性', '灵活'],
    ]);
  });

  it('两个消费方都 import 这张表，没有各自的第二份（唯一出处）', () => {
    for (const tool of ['sync-card-texts.mjs', 'parse-ratings.mjs']) {
      const p = fileURLToPath(new URL(`../../tools/${tool}`, import.meta.url));
      const src: string = readFileSync(p).subarray(0, 1 << 20).toString('utf8');
      expect(src, `${tool} 应 import tools/protocol-display-renames.mjs`).toContain("from './protocol-display-renames.mjs'");
      expect(src, `${tool} 不该自带第二份 EXPECTED_RENAMES`).not.toMatch(/const EXPECTED_RENAMES = \{/);
    }
    // 评分脚本必须真的把换算用在 name 与三段正文上（只 import 不调用 = 假修）
    const ratingsSrc: string = readFileSync(
      fileURLToPath(new URL('../../tools/parse-ratings.mjs', import.meta.url)),
    ).subarray(0, 1 << 20).toString('utf8');
    expect(ratingsSrc).toMatch(/e\.name = applyDisplayRenames\(e\.name\)/);
    expect(ratingsSrc).toMatch(/e\.review = applyDisplayRenames\(e\.review\)/);
    expect(ratingsSrc).toMatch(/e\.pairs = e\.pairs\.map\(applyDisplayRenames\)/);
    expect(ratingsSrc).toMatch(/e\.styles = e\.styles\.map\(applyDisplayRenames\)/);
    expect(ratingsSrc, '安全阀：对不上的名字要拒绝覆写').toContain('拒绝覆写');
  });

  it('表两侧一致：显示名在协议表里恰好命中 1 个，原文名一个都不剩', () => {
    for (const [oldName, newName] of readRenameTable()) {
      const hits = DEMO_PROTOCOLS.filter((p) => p.name === newName);
      expect(hits.length, `显示名「${newName}」应恰好命中 1 个协议`).toBe(1);
      const stale = DEMO_PROTOCOLS.filter((p) => p.name === oldName);
      expect(stale.map((p) => p.defId), `原文名「${oldName}」不该再作为协议显示名出现`).toEqual([]);
    }
  });

  it('rigidity 的显示名 = 死板，卡名 = 死板1..7', () => {
    const proto = DEMO_PROTOCOLS.find((p) => p.defId === 'rigidity');
    expect(proto?.name).toBe('死板');
    const defIds = DEMO_CARD_DEFS.filter((c) => c.protocol === 'rigidity').map((c) => c.defId);
    expect(cardDisplayNames(defIds)).toEqual(['死板1', '死板2', '死板3', '死板4', '死板5', '死板7']);
  });

  it('人不看的字段（座右铭/关键词/效果文字）没被改名带走', () => {
    const proto = DEMO_PROTOCOLS.find((p) => p.defId === 'rigidity');
    expect(proto?.loadingText).toBe('坚不可摧');
    expect(proto?.commands).toEqual(['反面打出', '阻止']);
  });

  it('评分表（图鉴/草稿页展示用）里的「僵化」也换成「死板」', () => {
    const rating = PROTOCOL_RATINGS.find((r) => r.defId === 'rigidity');
    expect(rating?.name).toBe('死板');
    const all = JSON.stringify(rating);
    expect(all).not.toContain('僵化');
    expect(all).toContain('死板7');
  });

  it('任何协议的显示名与卡名里都没有「僵化」（全世代）', () => {
    const names = [
      ...DEMO_PROTOCOLS.map((p) => p.name),
      ...cardDisplayNames(DEMO_CARD_DEFS.map((c) => c.defId)),
    ];
    expect(names.filter((n) => n.includes('僵化'))).toEqual([]);
  });
});
