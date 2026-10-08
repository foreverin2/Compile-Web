import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cssRules, cssPropOf, specificityOf } from './net-css-parse';
import { stripComments } from './source-text';
import { makeStubEl, type StubNode } from './net-dom-stub';

/**
 * **2026-10-07（用户要求）：页脚那行工信部备案的小腿（版式）**
 *
 * 为什么单独一条腿：`.home-footer` 住在 `styles.css`（红线，一行不动）里，并且写着
 * `pointer-events: none`（给署名用的）⇒ 我加的那枚 `<a>` 必须**自己**把指针事件打开，
 * 否则键盘/读屏能到、**鼠标点不动**（"看着能点其实点不动"在本仓栽过好几次）。
 * 行为那半在 `tests/i18n/home-copy.test.ts`（真跑首页、断言 href/target/rel 与两种语言的文案）。
 */
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  readFileSync(`${REPO}${rel}`).subarray(0, 4 * 1024 * 1024).toString('utf8');

const LOCAL_CSS = read('src/ui/styles-local.css');
const BASE_CSS = read('src/ui/styles.css');
const LOCAL_RULES = cssRules(LOCAL_CSS);

/** 造一个带类名的桩节点（解算用） */
const el = (cls: string, ...parents: string[]): StubNode[] => {
  const chain = parents.map((c) => { const n = makeStubEl('a'); n.cls = c; return n; });
  const self = makeStubEl('a');
  self.cls = cls;
  return [...chain, self];
};

describe('页脚备案那行的版式（解算 styles-local.css）', () => {
  it('链接自己把 pointer-events 打开（父级 `.home-footer` 是 none，红线文件里不能改）', () => {
    // 前置锚点：父级那条确实是 none（否则下面那条断言在空集合上跑）
    const footer = el('home-footer');
    expect(cssPropOf(footer[0], footer, cssRules(BASE_CSS), 'pointer-events'),
      '`.home-footer` 不再是 pointer-events: none —— 这条腿的前提变了，请复核注释').toBe('none');
    const link = el('home-icp-link', 'home-icp');
    expect(cssPropOf(link[1], link, LOCAL_RULES, 'pointer-events'),
      '链接没有自己打开指针事件 ⇒ 鼠标点不动（只有键盘能到）').toBe('auto');
    // 备案号那一段也可以选中复制（联系方式类文本的常规要求）
    const no = el('home-icp-no', 'home-icp');
    expect(cssPropOf(no[1], no, LOCAL_RULES, 'user-select')).toBe('text');
  });

  it('那一行是居中的 flex 行（页脚本身 `text-align: center`）', () => {
    const row = el('home-icp');
    expect(cssPropOf(row[0], row, LOCAL_RULES, 'display')).toBe('flex');
    expect(cssPropOf(row[0], row, LOCAL_RULES, 'justify-content')).toBe('center');
    expect(specificityOf('.home-icp'), '选择器权重变了？').toBeGreaterThan(0);
  });

  it('注释里写明了"父级是红线里的 none"这条前提（免得后来者把 pointer-events 删掉）', () => {
    const code = stripComments(LOCAL_CSS);
    expect(code).toContain('.home-icp-link');
    const raw = LOCAL_CSS;
    const at = raw.indexOf('.home-icp-link');
    const head = raw.slice(Math.max(0, at - 900), at);
    expect(head, '那一段没写"父级 pointer-events: none / styles.css 是红线"这条前提')
      .toMatch(/pointer-events:\s*none/);
  });
});
