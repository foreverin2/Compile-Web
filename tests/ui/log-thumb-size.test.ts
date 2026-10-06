import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setLang, DEFAULT_LANG } from '../../src/i18n';
import { renderBoard, resetUiState } from '../../src/ui/render';
import { setupGen3Game } from '../fuzz/lib';
import { cssRules, cssPropOf, cssLenOf, selectorMatches } from './net-css-parse';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';

/**
 * **2026-10-06（用户要求）：日志小图「加大」+ 协议图「横置」**
 *
 * 用户原话：「将日志中的卡牌图片大小加大，另外记得将协议的图片调整成正常的横置」。
 *
 * 两件事各钉一层：
 *
 *  1. **CSS 几何（解算，不是读字符串）**：用共享解析器 `./net-css-parse` 把 `styles-local.css`
 *     里的 `.log-thumb` / `.log-thumb-box .log-thumb` 解出来 ——
 *     卡图 `.log-thumb` 的宽高必须**大于**改动前的 20×26（反空集合：写回原尺寸就红）；
 *     协议那条规则必须命中「容器 1.4:1 + 图宽高按 1:1.4 反向撑满 + `rotate(-90deg)`」这套几何，
 *     且解出来的像素宽高与容器**正好相等**（转 90° 后铺满，不留缝也不裁掉）。
 *  2. **真跑 DOM**：`renderBoard` 产出的行里，**协议**那条缩略图必须**套在 `.log-thumb-box` 里**
 *     （容器横置），而**卡**那条是 `.log-entry` 的**直接子项**（竖版，不套容器）——
 *     两种都仍然带 `data-thumb-kind` / `data-thumb-def-id`（既有腿按这两个属性认图）。
 *
 * ⚠️ 诚实边界：解析器不模拟布局、桩 DOM 没有 CSS 引擎 ⇒ 这里证的是"哪条声明生效、算出来多少像素、
 * 谁套在谁里面"，**不是**观感。视觉上到底好看不好看只能人眼。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LOCAL_CSS = readFileSync(`${REPO}src/ui/styles-local.css`).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(LOCAL_CSS);

/** 造一串桩节点拿来解算：`parents` 按"由外到内"给，最后一个是被解算的元素自己。 */
const stubWith = (tag: string, cls: string): StubNode => {
  const n = makeStubEl(tag);
  n.cls = cls;
  return n;
};
const node = (cls: string, ...parents: string[]): StubNode[] =>
  [...parents.map((c) => stubWith('div', c)), stubWith('img', cls)];

const px = (chain: StubNode[], prop: string): number | null => {
  const raw = cssPropOf(chain[chain.length - 1], chain, RULES, prop);
  return raw === null ? null : cssLenOf(chain, RULES, raw);
};

afterEach(() => { setLang(DEFAULT_LANG); });

describe('① CSS：卡图加大 + 协议图横置（解算生效声明，不看字符串）', () => {
  it('卡图 `.log-thumb` 比改动前的 20×26 大（写回原尺寸这条腿就红）', () => {
    const chain = node('log-thumb');
    const w = px(chain, 'width');
    const h = px(chain, 'height');
    expect(w, '`.log-thumb` 的 width 解不出像素值').not.toBeNull();
    expect(h, '`.log-thumb` 的 height 解不出像素值').not.toBeNull();
    expect(w as number, '卡图宽度没加大（改动前 20）').toBeGreaterThan(20);
    expect(h as number, '卡图高度没加大（改动前 26）').toBeGreaterThan(26);
    // 卡面是 5:7（750×1050）⇒ 宽高比按 1:1.4 写，别写成正方形
    expect((h as number) / (w as number), '卡图宽高比偏离卡面的 1:1.4').toBeCloseTo(1.4, 1);
    expect(cssPropOf(chain[0], chain, RULES, 'object-fit'), '卡图没用 cover 填格').toBe('cover');
  });

  it('协议：`.log-thumb-box .log-thumb` 命中「1.4:1 容器 + 图反向撑满 + rotate(-90deg)」', () => {
    const chain = node('log-thumb', 'log-thumb-box');
    const box = chain[0];
    const img = chain[chain.length - 1];

    // 容器：横置（宽 > 高），比例 1.4:1
    const bw = px(chain.slice(0, 1), 'width');
    const bh = px(chain.slice(0, 1), 'height');
    expect(bw, '`.log-thumb-box` 的 width 解不出').not.toBeNull();
    expect(bh, '`.log-thumb-box` 的 height 解不出').not.toBeNull();
    expect(bw as number, '协议图的容器不是横置的（宽不大于高）').toBeGreaterThan(bh as number);
    expect((bw as number) / (bh as number), '协议容器不是 1.4:1').toBeCloseTo(1.4, 1);

    // 图：转 90°
    const tf = cssPropOf(img, chain, RULES, 'transform');
    expect(tf, '协议图没有旋转（`transform` 没声明）').toContain('rotate(-90deg)');

    // 图按「宽 = 容器宽 / 1.4、高 = 容器高 × 1.4」反向撑满，且解出来的像素正好是容器内容区
    const iw = px(chain, 'width');
    const ih = px(chain, 'height');
    expect(iw, '协议图的 width 解不出像素（百分比没参照 ⇒ 转完会留缝）').not.toBeNull();
    expect(ih, '协议图的 height 解不出像素（百分比没参照 ⇒ 转完会留缝）').not.toBeNull();
    const innerW = (bw as number) - 2;   // 全局 `* { box-sizing: border-box }` + 1px 边框
    const innerH = (bh as number) - 2;
    expect(iw as number, '协议图转前的宽 ≠ 容器内容区的高（转完会裁掉或留缝）').toBeCloseTo(innerH, 1);
    expect(ih as number, '协议图转前的高 ≠ 容器内容区的宽（转完会裁掉或留缝）').toBeCloseTo(innerW, 1);

    // 选择器确实只对"容器里那张图"生效：`.log-thumb` 单写在别处也不会被这条规则配上
    expect(selectorMatches('.log-thumb-box .log-thumb', chain), '选择器解不出这条链').toBe(true);
    const bare = node('log-thumb');
    expect(cssPropOf(bare[0], bare, RULES, 'transform'), '卡图也被套上了旋转').toBeNull();
  });

  it('容器是 flex 居中 + 裁剪（否则转 90° 的图会从格里溢出去压到文本上）', () => {
    const chain = node('log-thumb', 'log-thumb-box');
    const box = chain[0];
    expect(cssPropOf(box, chain.slice(0, 1), RULES, 'display')).toBe('flex');
    expect(cssPropOf(box, chain.slice(0, 1), RULES, 'overflow')).toBe('hidden');
    expect(cssPropOf(box, chain.slice(0, 1), RULES, 'align-items')).toBe('center');
    expect(cssPropOf(box, chain.slice(0, 1), RULES, 'justify-content')).toBe('center');
  });
});

describe('② 真跑 DOM：协议图套进横置容器，卡图不套', () => {
  it('`renderBoard` 产出的行：协议缩略图在 `.log-thumb-box` 里，卡缩略图是行的直接子项', () => {
    const restore = installStubDom();
    try {
      const s = setupGen3Game(21);
      s.log.length = 0;
      s.log.push('P1 打出 fire-3（正面）到线 2');   // 卡图
      s.log.push('P1 选择 流水');                    // 协议图
      setLang('zh');
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, {
        onAction: () => { /* noop */ }, onRendered: () => { /* noop */ }, rerender: () => { /* noop */ },
        onDraftPick: () => { /* noop */ }, onDraftUnpick: () => { /* noop */ }, onDraftBan: () => { /* noop */ },
        onWinReset: () => { /* noop */ },
      } as never);

      const rows = descendants(root).filter((n) => isClass(n, 'log-entry'));
      expect(rows.length, '日志区一行都没画出来').toBeGreaterThanOrEqual(2);
      const thumbs = descendants(root).filter((n) => isClass(n, 'log-thumb'));
      const kinds = thumbs.map((t) => `${t.dataset.thumbKind}:${t.dataset.thumbDefId}`);
      expect(kinds, '卡图/协议图没按预期产出').toEqual(['card:fire-3', 'protocol:water']);

      // 协议那张：父节点是 `.log-thumb-box`，且那个盒子本身是行的直接子项
      const proto = thumbs.find((t) => t.dataset.thumbKind === 'protocol') as StubNode;
      const box = descendants(root).filter((n) => isClass(n, 'log-thumb-box'));
      expect(box.length, '协议图没有横置容器（`.log-thumb-box` 一个都没产出）').toBe(1);
      expect(descendants(box[0]).some((n) => n === proto), '协议图没在那个容器里').toBe(true);
      const protoRow = rows.find((r) => descendants(r).some((n) => n === proto)) as StubNode;
      expect((protoRow.children ?? []).some((c) => c === box[0]), '容器不是日志行的直接子项').toBe(true);

      // 卡那张：**不**套容器（竖版直接当 flex 项）
      const card = thumbs.find((t) => t.dataset.thumbKind === 'card') as StubNode;
      const cardRow = rows.find((r) => descendants(r).some((n) => n === card)) as StubNode;
      expect((cardRow.children ?? []).some((c) => c === card), '卡图被套进了容器（应直接是行的子项）').toBe(true);
      expect(descendants(root).filter((n) => isClass(n, 'log-thumb-box')).length, '多出了容器').toBe(1);

      // 文本仍是引擎原文（这次改动没碰文本层）
      const texts = descendants(root).filter((n) => isClass(n, 'log-text')).map((n) => n.text);
      expect(texts).toContain('P1 打出 fire-3（正面）到线 2');
      expect(texts).toContain('P1 选择 流水');
    } finally { resetUiState(); restore(); }
  });
});
