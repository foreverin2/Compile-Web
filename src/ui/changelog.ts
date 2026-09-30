/**
 * ★ 2026-09-29（用户要求）：**首页右上角"更新日志"的内容**。
 *
 * ## 铁律（用户 2026-09-29 明确交代）
 *
 * > "我告诉你加什么你就加什么。"
 *
 * ⇒ **这个数组里只放用户点名要加的东西**。不要自己从 git 记录 / 文档 / 提交信息里替他总结，
 * 也不要"顺手补全" —— 之前我自己写了一版 19 条，被用户全部要求撤掉。
 * 现在是**空的**，等用户给条目。
 *
 * ## 用户给的格式（别改）
 *
 *  - **最新的一天在最上面**，越往下越早；
 *  - 一天一块：先日期，然后每条"问题 + 下一行'已修复，解释'"；
 *  - 相邻两天之间是一条横线（由 `changelogElement()` 渲染，不写进数据里）。
 *
 * ## 怎么加（只改这个文件）
 *
 * 在数组最前面加一天，或在某天里加一条 item：
 *
 * ```ts
 * {
 *   date: '2026-09-30',
 *   items: [
 *     { problem: '玩家视角的问题，一句话说清现象', fix: '已修复，改法与解释' },
 *   ],
 * }
 * ```
 * `fix` 必须**以"已修复"开头**（`tests/ui/changelog.test.ts` 会钉这条格式）。
 */
export interface ChangelogItem {
  /** 玩家视角的问题（一句话说清现象） */
  readonly problem: string;
  /** 修法 + 解释，**以"已修复"开头**（渲染与测试都按这个前缀认它） */
  readonly fix: string;
}

export interface ChangelogDay {
  /** `YYYY-MM-DD` */
  readonly date: string;
  readonly items: readonly ChangelogItem[];
}

/** 最新的一天在最上面。**目前为空**：只加用户点名要加的内容（见文件头注）。 */
export const CHANGELOG: readonly ChangelogDay[] = [];

/** 相邻两天之间那条横线（用户给的格式；渲染时插在日期块之间） */
export const CHANGELOG_SEPARATOR = '------------------------------------------';

/** 列表为空时面板上显示的那一句（不是"没有日志"这种冷话，给清楚下一步） */
export const CHANGELOG_EMPTY_NOTE = '还没有写进来的更新记录。给我内容，我按你的格式加。';

/** 最小的建节点工具（本文件自带，不引 `home.ts` 的私有 helper，也不新增样式表） */
function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * **纯文本形态**（与屏上逐字同形）：日期 → 每条"问题 / 已修复，…"，相邻两天之间一条横线。
 * 有了它，"顺序与格式"这件事能在 node 环境里直接机检（不必造 DOM）。空列表 ⇒ 空串。
 */
export function changelogText(days: readonly ChangelogDay[] = CHANGELOG): string {
  return days
    .map((d) => [d.date, ...d.items.flatMap((i) => [i.problem, i.fix])].join('\n'))
    .join(`\n${CHANGELOG_SEPARATOR}\n`);
}

/**
 * 面板本体：`nav.onClose` 由调用方接（首页那个入口用它把面板收起来）。
 * 摆版式只在这里；日期与条目的内容**只来自 `CHANGELOG`**。
 */
export function changelogElement(nav: { readonly onClose: () => void } = { onClose: () => {} }): HTMLElement {
  const panel = el('div', 'changelog-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '更新日志');

  const head = el('div', 'changelog-head');
  head.appendChild(el('div', 'changelog-title', '更新日志'));
  const close = el('button', 'btn changelog-close', '关闭');
  close.setAttribute('type', 'button');
  close.addEventListener('click', () => { nav.onClose(); });
  head.appendChild(close);
  panel.appendChild(head);

  if (CHANGELOG.length === 0) {
    panel.appendChild(el('div', 'changelog-empty', CHANGELOG_EMPTY_NOTE));
    return panel;
  }

  panel.appendChild(el('div', 'changelog-hint', '最新的在最上面，往下翻是更早的。'));
  CHANGELOG.forEach((day, index) => {
    if (index > 0) panel.appendChild(el('div', 'changelog-sep', CHANGELOG_SEPARATOR));
    panel.appendChild(el('div', 'changelog-date', day.date));
    for (const item of day.items) {
      panel.appendChild(el('div', 'changelog-problem', item.problem));
      panel.appendChild(el('div', 'changelog-fix', item.fix));
    }
  });
  return panel;
}
