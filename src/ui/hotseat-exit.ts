/**
 * ★ 2026-09-30（用户要求）：**双人热座对局里，左上角一个「退出游戏」按钮**。
 *
 * 点它 = 退出当前对局并回到游戏选择页（宿主给的 `onExit` 里做那两件事）。
 *
 * ## 做法：注入式，不动 `render.ts`（红线）
 *
 * 与 T46 的 `net-conn-line.ts` 同款：自己往 `document.body` 放一个 `position: fixed` 的按钮
 * （行内样式，不新增样式表、不碰 `styles.css`），并**自己判断该不该显示**。判据来自 DOM 上的
 * 页面标记（不去问宿主，也就不需要改每帧都在变的渲染代码）：
 *
 *  - **在牌桌上**：`#app` 里有 `.board`（**游玩页**）。★ 2026-09-30（用户口径）：
 *    硬币屏（`.coin-screen`）与选协议屏（`.draft-screen`）**都不算** —— 那两个屏上不显示这两个按钮；
 *  - **不是远程页**：`body` 上没有 `.net-page`（那条标记只由 `render-net.ts` 加/清，
 *    热座渲染路径从不写它 —— 见 `render-net.ts` 里 `NET_PAGE_CLASS` 的注释）；
 *  - **不是大厅**（`.net-lobby-screen`）/ **不是回放**（`[class*="replay"]`）。
 *
 * ## 为什么用 MutationObserver
 *
 * `#app` 每帧都会被整棵换掉（`clearRoot` + 重新 append），所以按钮必须**在每次换完之后重新摆**。
 * 观察 `#app` 的子树与 `body` 的 class 就够了；宿主那边只在启动时给一个回调。
 */
import { t } from '../i18n';

export const HOTSEAT_EXIT_CLASS = 'hotseat-exit-btn';

export interface ExitButtonFlags {
  /** 此刻在牌桌（游玩页）上 —— 硬币屏 / 选协议屏都不算（用户 2026-09-30 口径） */
  readonly hasGameScreen: boolean;
  readonly isNetPage: boolean;
  readonly isLobby: boolean;
  readonly isReplay: boolean;
}

/** 这一刻该不该显示"退出游戏"（纯函数，便于单测） */
export function shouldShowExitButton(f: ExitButtonFlags): boolean {
  return f.hasGameScreen && !f.isNetPage && !f.isLobby && !f.isReplay;
}

/** 从 DOM 读那四个读数（参数可注入，便于单测） */
export function exitButtonFlagsOf(
  root: Pick<ParentNode, 'querySelector'> = document,
  body: Pick<HTMLElement, 'classList'> = document.body,
): ExitButtonFlags {
  return {
    // ★ 只看 `.board`（游玩页）；`.coin-screen` / `.draft-screen` 不算（用户 2026-09-30 口径）
    hasGameScreen: root.querySelector('.board') !== null,
    isNetPage: body.classList.contains('net-page'),
    isLobby: root.querySelector('.net-lobby-screen') !== null,
    isReplay: root.querySelector('[class*="replay"]') !== null,
  };
}

/**
 * ★ 2026-10-02（i18n 逐屏抽取）：按钮文案搬进 `src/i18n/`（键 `hotseat-exit.label`），
 * 中文值**逐字等于改动前**的 `← 退出游戏`。在装按钮那一刻取一次 —— 这个按钮只在启动时装一次
 * （`installed` 幂等），换语言时的重画不会重装它，所以文案跟着"装它的那一刻"的语言走。
 */
let installed = false;

/**
 * 装一次（幂等）。`nav.onExit` 由宿主给（`main.ts` 里是"丢开这一局 + 回模式选择"）。
 */
export function installHotseatExit(nav: { readonly onExit: () => void }): void {
  if (installed) return;
  installed = true;

  const btn = document.createElement('button');
  btn.className = `btn ${HOTSEAT_EXIT_CLASS}`;
  btn.type = 'button';
  btn.textContent = t('hotseat-exit.label');
  // 行内样式：左上角固定浮层（不新增样式表、不碰 styles.css 红线）
  btn.style.position = 'fixed';
  btn.style.left = '12px';
  btn.style.top = '10px';
  btn.style.zIndex = '9000';
  btn.style.display = 'none';
  btn.addEventListener('click', () => { nav.onExit(); });
  document.body.appendChild(btn);

  const sync = (): void => {
    btn.style.display = shouldShowExitButton(exitButtonFlagsOf()) ? '' : 'none';
  };
  const app = document.getElementById('app') ?? document.body;
  new MutationObserver(sync).observe(app, { childList: true, subtree: true });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
}
