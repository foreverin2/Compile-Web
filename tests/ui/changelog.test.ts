import { describe, it, expect } from 'vitest';
import { CHANGELOG, CHANGELOG_SEPARATOR, changelogText } from '../../src/ui/changelog';

/**
 * ★ 2026-09-29（用户要求）：首页右上角「更新日志」。
 *
 * 这条腿钉的是**用户当场给的那份格式**（日期 → 每条"问题 / 已修复，解释"、相邻两天之间一条横线、
 * 最新在最上面）。内容本身会天天变，所以只钉结构与格式，不钉具体句子。
 */
describe('首页「更新日志」：顺序与格式（用户 2026-09-29 给的版式）', () => {
  it('至少三天，每天至少一条，日期形如 YYYY-MM-DD', () => {
    expect(CHANGELOG.length, '更新日志不该是空的').toBeGreaterThanOrEqual(3);
    for (const day of CHANGELOG) {
      expect(day.items.length, `${day.date} 一天里一条都没有`).toBeGreaterThan(0);
      expect(day.date, '日期不是 YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('★ 最新的一天在最上面：日期严格从新到旧', () => {
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      const prev = CHANGELOG[i - 1].date;
      const cur = CHANGELOG[i].date;
      expect(cur < prev, `${prev} 下面应当是更早的一天，实际是 ${cur}`).toBe(true);
    }
  });

  it('★ 每条都是"问题 + 已修复，解释"：fix 以「已修复」开头，problem 不是', () => {
    for (const day of CHANGELOG) {
      for (const item of day.items) {
        expect(item.problem.trim().length, `${day.date} 有一条问题描述是空的`).toBeGreaterThan(0);
        expect(item.fix.startsWith('已修复'), `${day.date} 的这条没有以"已修复"开头：${item.fix.slice(0, 20)}`)
          .toBe(true);
        expect(item.problem.startsWith('已修复'), `${day.date} 的"问题"那行写成了修复说明`).toBe(false);
        expect(item.fix.length, `${day.date} 的这条只写了"已修复"没写解释`).toBeGreaterThan(4);
      }
    }
  });

  it('★ 纯文本形态与用户给的版式逐字同形（日期 → 问题 → 已修复 → 下一条 → 横线 → 下一天）', () => {
    const text = changelogText();
    const lines = text.split('\n');
    expect(lines[0], '第一行必须是最新那天的日期').toBe(CHANGELOG[0].date);
    const newest = CHANGELOG[0];
    expect(lines[1]).toBe(newest.items[0].problem);
    expect(lines[2]).toBe(newest.items[0].fix);
    // 相邻两天之间恰好一条横线
    expect(text.split(CHANGELOG_SEPARATOR).length - 1, '横线条数与"天与天之间的缝"不等')
      .toBe(CHANGELOG.length - 1);
    // 横线出现在前一天的最后一个 fix 之后、后一天的日期之前
    const sepAt = lines.indexOf(CHANGELOG_SEPARATOR);
    expect(sepAt, '找不到横线').toBeGreaterThan(-1);
    expect(lines[sepAt - 1], '横线前面不是上一条的修复说明').toBe(newest.items[newest.items.length - 1].fix);
    expect(lines[sepAt + 1], '横线后面不是下一天的日期').toBe(CHANGELOG[1].date);
  });

  it('横线就是用户写的那一条（渲染与文本形态共用同一个常量）', () => {
    expect(CHANGELOG_SEPARATOR).toBe('------------------------------------------');
    expect(changelogText()).toContain(CHANGELOG_SEPARATOR);
  });
});
