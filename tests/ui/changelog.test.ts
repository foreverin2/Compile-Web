import { describe, it, expect } from 'vitest';
import {
  CHANGELOG,
  CHANGELOG_EMPTY_NOTE,
  CHANGELOG_SEPARATOR,
  changelogText,
  type ChangelogDay,
} from '../../src/ui/changelog';

/**
 * ★ 2026-09-29（用户要求）：首页右上角「更新日志」。
 *
 * ⚠️ **不要拿真实数据当夹具**：用户交代过"我告诉你加什么你就加什么"，`CHANGELOG` 现在（并且
 * 可能长期）是空的 —— 内容会天天变，钉内容只会天天红。所以：
 *  - **格式腿**喂一份自己的夹具（证明版式机器是对的，且不空转）；
 *  - **真数据腿**只检查"用户真加进来时格式对不对"，空的时候整条跳过（不是假绿：跳过会打印出来）。
 */
const FIXTURE: readonly ChangelogDay[] = [
  {
    date: '2026-10-02',
    items: [
      { problem: '夹具：较新那天的问题一', fix: '已修复，夹具解释一' },
      { problem: '夹具：较新那天的问题二', fix: '已修复，夹具解释二' },
    ],
  },
  {
    date: '2026-10-01',
    items: [{ problem: '夹具：较早那天的问题', fix: '已修复，夹具解释' }],
  },
];

describe('首页「更新日志」：版式机器（用户 2026-09-29 给的格式）', () => {
  it('★ 纯文本形态逐字同形：日期 → 问题 → 已修复 → 横线 → 更早那天', () => {
    expect(changelogText(FIXTURE)).toBe([
      '2026-10-02',
      '夹具：较新那天的问题一',
      '已修复，夹具解释一',
      '夹具：较新那天的问题二',
      '已修复，夹具解释二',
      CHANGELOG_SEPARATOR,
      '2026-10-01',
      '夹具：较早那天的问题',
      '已修复，夹具解释',
    ].join('\n'));
  });

  it('★ 横线条数 = 天数 - 1（相邻两天之间恰好一条，首尾不加）', () => {
    const count = changelogText(FIXTURE).split(CHANGELOG_SEPARATOR).length - 1;
    expect(count).toBe(FIXTURE.length - 1);
    expect(changelogText([FIXTURE[0]])).not.toContain(CHANGELOG_SEPARATOR);
  });

  it('空列表 ⇒ 空串（面板另有那句空态提示，别把空白当成日志）', () => {
    expect(changelogText([])).toBe('');
    expect(CHANGELOG_EMPTY_NOTE.trim().length, '空态那句是空的？').toBeGreaterThan(0);
  });
});

describe('首页「更新日志」：真数据（空的时候跳过，不假绿）', () => {
  it('用户加进来的每一天/每一条都合格式：日期 YYYY-MM-DD、从新到旧、fix 以「已修复」开头', () => {
    if (CHANGELOG.length === 0) {
      console.log('[更新日志] 目前是空的（用户口径：只加他点名要加的内容）⇒ 这条腿本次跳过');
      return;
    }
    for (const day of CHANGELOG) {
      expect(day.items.length, `${day.date} 一天里一条都没有`).toBeGreaterThan(0);
      expect(day.date, '日期不是 YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const item of day.items) {
        expect(item.problem.trim().length, `${day.date} 有一条问题描述是空的`).toBeGreaterThan(0);
        expect(item.fix.startsWith('已修复'), `${day.date} 的这条没以"已修复"开头`).toBe(true);
        expect(item.problem.startsWith('已修复'), `${day.date} 的"问题"那行写成了修复说明`).toBe(false);
      }
    }
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      expect(CHANGELOG[i].date < CHANGELOG[i - 1].date, '日期没有从新到旧').toBe(true);
    }
  });
});
