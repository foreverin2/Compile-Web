import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HOTSEAT_EXIT_CLASS,
  exitButtonFlagsOf,
  shouldShowExitButton,
  type ExitButtonFlags,
} from '../../src/ui/hotseat-exit';

/**
 * ★ 2026-09-30（用户要求）：双人热座对局左上角「退出游戏」。
 *
 * 这条腿钉两半：**显示判据**（纯函数，四读数各自的作用）与**注入实现**（不动 render.ts、
 * 行内 fixed 样式、点它调宿主回调、观察者让它在每帧换 DOM 之后重新摆好）。
 */
const flags = (over: Partial<ExitButtonFlags> = {}): ExitButtonFlags => ({
  hasGameScreen: true, isNetPage: false, isLobby: false, isReplay: false, ...over,
});

describe('热座「退出游戏」按钮：显示判据', () => {
  it('对局画面 + 三个都不是 ⇒ 显示', () => {
    expect(shouldShowExitButton(flags())).toBe(true);
  });

  it('★ 远程页 / 大厅 / 回放 / 没有对局画面 ⇒ 一律不显示', () => {
    expect(shouldShowExitButton(flags({ isNetPage: true })), '远程页也冒出热座的退出按钮').toBe(false);
    expect(shouldShowExitButton(flags({ isLobby: true })), '大厅里冒出退出按钮').toBe(false);
    expect(shouldShowExitButton(flags({ isReplay: true })), '回放里冒出退出按钮').toBe(false);
    expect(shouldShowExitButton(flags({ hasGameScreen: false })), '首页/模式页也显示').toBe(false);
  });

  it('从 DOM 读读数：有 .board 且 body 没有 net-page ⇒ 该显示', () => {
    const root = { querySelector: (sel: string) => (sel.includes('.board') ? ({} as Element) : null) };
    const body = { classList: { contains: (c: string) => c !== 'net-page' } };
    expect(exitButtonFlagsOf(root as never, body as never)).toEqual({
      hasGameScreen: true, isNetPage: false, isLobby: false, isReplay: false,
    });
    expect(shouldShowExitButton(exitButtonFlagsOf(root as never, body as never))).toBe(true);
  });
});

describe('热座「退出游戏」按钮：注入实现（不动 render.ts）', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/ui/hotseat-exit.ts', import.meta.url)))
    .subarray(0, 4 * 1024 * 1024)
    .toString('utf8');

  it('★ 行内 fixed 样式 + 挂在 body 上（不新增样式表、不碰红线 styles.css）', () => {
    expect(src).toContain("btn.style.position = 'fixed'");
    expect(src).toContain("btn.style.left = '12px'");
    expect(src).toContain("btn.style.top = '10px'");
    expect(src).toContain('document.body.appendChild(btn)');
    expect(src, '不该引用任何样式表').not.toContain("import './styles");
  });

  it('★ 点击调宿主回调；`#app` 每帧换 DOM 之后靠 MutationObserver 重新摆', () => {
    expect(src).toContain('nav.onExit()');
    expect(src).toContain('new MutationObserver(sync).observe(app, { childList: true, subtree: true })');
    expect(src).toContain("attributeFilter: ['class']");
    expect(HOTSEAT_EXIT_CLASS).toBe('hotseat-exit-btn');
  });

  it('幂等：`installed` 挡住第二次安装（否则会堆出两个按钮）', () => {
    expect(src).toContain('if (installed) return;');
  });
});
