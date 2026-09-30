import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOG_TOGGLE_CLASS, applyLogHidden, isLogHidden, shouldShowLogToggle } from '../../src/ui/log-toggle';
import type { ExitButtonFlags } from '../../src/ui/hotseat-exit';

/**
 * ★ 2026-09-30（用户要求）：热座日志**默认隐藏** + 右上角显示/隐藏开关。
 * 这条腿钉偏好本身（默认藏、可翻）、落盘到 `.log` 的写法（行内 display）、
 * 以及"开关只在热座对局画面上出现"（判据复用 `hotseat-exit.ts` 那一份）。
 */
const fakeLog = (): { style: { display: string } } => ({ style: { display: '' } });
const fakeRoot = (...els: Array<{ style: { display: string } }>) => ({
  querySelectorAll: (sel: string) => (sel === '.log' ? els : []),
});

describe('日志开关：默认隐藏与落盘写法', () => {
  it('★ 默认就是隐藏（用户口径："改为默认隐藏"）', () => {
    expect(isLogHidden()).toBe(true);
  });

  it('★ 落盘：隐藏 ⇒ 行内 display:none；显示 ⇒ 清掉行内值（回落到样式表）', () => {
    const a = fakeLog(); const b = fakeLog();
    applyLogHidden(fakeRoot(a, b), true);
    expect(a.style.display).toBe('none');
    expect(b.style.display).toBe('none');
    applyLogHidden(fakeRoot(a, b), false);
    expect(a.style.display).toBe('');
    expect(b.style.display).toBe('');
  });

  it('一个 `.log` 都没有时不许抛（首页/大厅/远程页都会走这条）', () => {
    expect(() => applyLogHidden(fakeRoot(), true)).not.toThrow();
  });

  it('开关的显示判据与"热座对局画面"同源（远程页/大厅/回放/无画面都不显示）', () => {
    const base: ExitButtonFlags = { hasGameScreen: true, isNetPage: false, isLobby: false, isReplay: false };
    expect(shouldShowLogToggle(base)).toBe(true);
    expect(shouldShowLogToggle({ ...base, isNetPage: true })).toBe(false);
    expect(shouldShowLogToggle({ ...base, isLobby: true })).toBe(false);
    expect(shouldShowLogToggle({ ...base, isReplay: true })).toBe(false);
    expect(shouldShowLogToggle({ ...base, hasGameScreen: false })).toBe(false);
  });
});

describe('日志开关：注入实现', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/ui/log-toggle.ts', import.meta.url)))
    .subarray(0, 4 * 1024 * 1024)
    .toString('utf8');

  it('★ 右上角行内 fixed 按钮、文案随状态翻、观察者每次换 DOM 重新落偏好', () => {
    expect(LOG_TOGGLE_CLASS).toBe('log-toggle-btn');
    expect(src).toContain("btn.style.position = 'fixed'");
    expect(src).toContain("btn.style.right = '12px'");
    expect(src).toContain("btn.style.top = '10px'");
    expect(src).toContain("hidden ? LABEL_SHOW : LABEL_HIDE");
    expect(src).toContain('new MutationObserver(sync).observe(app, { childList: true, subtree: true })');
    expect(src).toContain('applyLogHidden();');
  });

  it('★ 判据复用 `hotseat-exit.ts` 那一条（"是不是热座对局画面"只有一个出处）', () => {
    expect(src).toContain("from './hotseat-exit'");
    expect(src).toContain('shouldShowExitButton(flags)');
    expect(src, '不该引用任何样式表').not.toContain("import './styles");
  });
});
