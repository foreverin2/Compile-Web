import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 设计稿 / 进度文件结构守卫（2026-09-13）。
 *
 * 起因：`docs/3代-特效设计稿-文字版.md` 曾被一次外部保存**静默覆盖回旧版本**
 * （§7 九条决议、§4.16、§8 品质标准、§9 流程全丢），而 tsc/vitest 毫无反应——
 * 直到逐段对比 git 才发现。文档是跨批次的"事实来源"，被覆盖 = 后续批次按错误规格开发。
 *
 * 因此把"设计稿必须包含的关键章节与关键决议"写成断言：一旦再被覆盖，测试立刻报红。
 * 注意：这些断言**不检查文字措辞**，只检查"章节存在 + 关键决议在不在"，避免妨碍正常改稿。
 */

const doc = readFileSync(fileURLToPath(new URL('../../docs/3代-特效设计稿-文字版.md', import.meta.url)))
  .subarray(0, 2 * 1024 * 1024)
  .toString('utf8');
const progress = readFileSync(fileURLToPath(new URL('../../docs/3代特效-进度与上下文.md', import.meta.url)))
  .subarray(0, 2 * 1024 * 1024)
  .toString('utf8');

describe('3代设计稿 / 进度文件结构守卫', () => {
  it('设计稿的关键章节齐全（缺任何一节 = 被覆盖回旧版）', () => {
    const required = [
      '### 0.1 贯穿全稿的总原则',
      '### 1.2 配色表',
      '### 3.1 已编译协议特效的统一规格',
      '### 3.2 已实现索引（批次 A',
      '### 4.0 已实现索引 · 批次 B',
      '### 4.16 （已撤回）',
      '### 5.4 持续效果常驻族',
      '### 5.6 引擎改动清单',
      '## 6. 建议分批',
      '## 7. 决议',
      '## 8. 品质标准',
      '## 9. 批次收尾与上下文压缩流程',
    ];
    const missing = required.filter((s) => !doc.includes(s));
    expect(missing, `设计稿缺少以下章节（疑似被覆盖回旧版）：\n${missing.join('\n')}`).toEqual([]);
  });

  it('设计稿的关键决议仍在（Q2/Q3/Q5/Q6/Q8 与范围红线）', () => {
    // Q6 的"不降级"口径、Q2 配色确认、Q3 六组件、Q8 并行、范围"只做点名触发点"
    for (const needle of ['全部都要完整特效——不做限流、不做降级', '控制权族 6 个组件全做', '并行播放', '只做点名的触发点', '不做"塑料感"简易特效']) {
      expect(doc, `设计稿缺少关键决议文字：${needle}`).toContain(needle);
    }
  });

  it('进度文件的关键区块齐全（下批开工只读它）', () => {
    for (const needle of ['## 1. 批次进度', '## 1b. 批次 A 交付速查', '## 1c. 批次 B 交付速查', '## 2. 协议色与语法速查', '## 6. 约定']) {
      expect(progress, `进度文件缺少：${needle}`).toContain(needle);
    }
    // 批次 A/B 必须标记为已完成（否则下一批会重复劳动）
    expect(progress).toMatch(/\*\*A\*\*[\s\S]{0,200}已完成/);
    expect(progress).toMatch(/\*\*B\*\*[\s\S]{0,200}已完成/);
  });

  it('范围红线写进了约定（防止后续批次"顺手"给所有卡加特效）', () => {
    expect(progress).toContain('范围红线');
    expect(progress).toContain('只给"点名的触发点"加特效');
  });
});
