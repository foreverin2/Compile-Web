/**
 * ★ 2026-09-30（用户要求）：**热座对局下方的日志默认隐藏，页面右上角一个显示/隐藏的开关**。
 *
 * ## 为什么还是注入式
 *
 * `.log` 是 `render.ts` 每帧重建的（`el('div','log')`，红线文件不改），所以这里：
 *  - 用一个 `MutationObserver` 盯 `#app`：每次换完 DOM，把所有 `.log` 按当前偏好设成
 *    `display:none`（默认）或恢复；
 *  - 右上角那个按钮同样注入到 `document.body`（行内样式），只在**热座对局画面**上出现 ——
 *    判据直接复用 `hotseat-exit.ts` 的那一份（"现在是不是热座对局画面"只该有一个出处）。
 *
 * 偏好**只在内存里**（用户口径是"默认隐藏"，那就不该为了它往磁盘上写东西）。
 */
import { t } from '../i18n';
import { exitButtonFlagsOf, shouldShowExitButton, type ExitButtonFlags } from './hotseat-exit';

export const LOG_TOGGLE_CLASS = 'log-toggle-btn';

/**
 * ★ 2026-10-02（i18n 逐屏抽取）：两个按钮文案搬进 `src/i18n/`（键 `log-toggle.show` /
 * `log-toggle.hide`），中文值**逐字等于改动前**的 `显示日志` / `隐藏日志`。
 *
 * ⚠️ 它们在**画按钮时**取（`paint()` 里现调 `t()`），不是模块加载时算一次：
 * 语言切换之后宿主会重画，而这两个标签必须跟着新语言走。
 */

let hidden = true; // ★ 用户口径：默认隐藏
let installed = false;

/** 日志现在是不是藏着的 */
export function isLogHidden(): boolean {
  return hidden;
}

/** 这一刻该不该显示那个开关（复用"热座对局画面"的判据） */
export function shouldShowLogToggle(flags: ExitButtonFlags): boolean {
  return shouldShowExitButton(flags);
}

/**
 * 把当前偏好落到 `.log` 上（参数可注入：单测喂一个假 root 就够，不必造 DOM）。
 * 偏好 = 隐藏 ⇒ 行内 `display:none`；偏好 = 显示 ⇒ 清掉行内值（回落到样式表的缺省）。
 */
export function applyLogHidden(
  root: { querySelectorAll(sel: string): ArrayLike<{ style: { display: string } }> } = document,
  wantHidden: boolean = hidden,
): void {
  const logs = root.querySelectorAll('.log');
  for (let i = 0; i < logs.length; i += 1) {
    logs[i].style.display = wantHidden ? 'none' : '';
  }
}

/** 装一次（幂等）。 */
export function installLogToggle(): void {
  if (installed) return;
  installed = true;

  const btn = document.createElement('button');
  btn.className = `btn ${LOG_TOGGLE_CLASS}`;
  btn.type = 'button';
  btn.style.position = 'fixed';
  btn.style.right = '12px';
  btn.style.top = '10px';
  btn.style.zIndex = '9000';
  btn.style.display = 'none';
  document.body.appendChild(btn);

  /** 文案**现调** `t()`：语言换掉之后下一次 `paint()` 就是新语言（见 `LABEL_*` 的注释） */
  const paint = (): void => { btn.textContent = hidden ? t('log-toggle.show') : t('log-toggle.hide'); };
  const sync = (): void => {
    applyLogHidden();
    btn.style.display = shouldShowLogToggle(exitButtonFlagsOf()) ? '' : 'none';
  };

  btn.addEventListener('click', () => {
    hidden = !hidden;
    paint();
    applyLogHidden();
  });

  const app = document.getElementById('app') ?? document.body;
  new MutationObserver(sync).observe(app, { childList: true, subtree: true });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  paint();
  sync();
}
