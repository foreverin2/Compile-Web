/**
 * ★ 2026-09-29（用户要求）：**首页右上角"更新日志"的内容**。
 *
 * ## 铁律（用户 2026-09-29 明确交代）
 *
 * > "我告诉你加什么你就加什么。"
 *
 * ⇒ **这个数组里只放用户点名要加的东西**。不要自己从 git 记录 / 文档 / 提交信息里替他总结，
 * 也不要"顺手补全"。
 *
 * ## 写法（用户 2026-09-30 明确交代，**以后都照这个来**）
 *
 * > "以开发者的视角说明修复了什么就可以了，不用解释如何修复的。"
 *
 * ⇒ **`fix` 只说"修了什么/加了什么"**，不要写实现细节（不提"平板那套自动缩放""宽视口"这类
 * 内部机制），也不要写"为什么"。一句话收尾即可，短到"已修复。"也行。
 *
 * ## 用户给的格式（别改）
 *
 *  - **最新的一天在最上面**，越往下越早；
 *  - 一天一块：先日期，然后每条"问题 + 下一行'已修复，…'"；
 *  - 同一天里每条之间**隔开一点**（渲染时给每条加分隔，见 `changelogElement`）；
 *  - 相邻两天之间**空三行**（用户 2026-09-30：原来那条长横线改成空三格）。
 *
 * ## 怎么加（只改这个文件）
 *
 * 在数组最前面加一天，或在某天里加一条 item：
 *
 * ```ts
 * {
 *   date: '2026-10-01',
 *   items: [
 *     { problem: '玩家视角的问题，一句话说清现象', fix: '已修复。' },
 *   ],
 * }
 * ```
 * `fix` 必须**以"已修复"开头**（`tests/ui/changelog.test.ts` 会钉这条格式）。
 */
export interface ChangelogItem {
  /** 玩家视角的问题（一句话说清现象） */
  readonly problem: string;
  /** 修了什么 / 加了什么，**以"已修复 / 已新增 / 已更新 / 已改为"等开头**（不解释怎么做的） */
  readonly fix: string;
}

export interface ChangelogDay {
  /** `YYYY-MM-DD` */
  readonly date: string;
  readonly items: readonly ChangelogItem[];
}

/** 最新的一天在最上面。**只加用户点名要加的内容**（见文件头注）。 */
export const CHANGELOG: readonly ChangelogDay[] = [
  // ★ 2026-10-01：用户点名要加的 5 条（按他给的顺序，内容照抄他的说法）
  {
    date: '2026-10-01',
    items: [
      {
        problem: '还有别的卡牌和「生命1」一样，效果无法指向自己。',
        fix: '已修复，这些卡牌现在也能指向自己。',
      },
      {
        problem: '双人热座模式下没有退出游戏和查看日志的入口。',
        fix: '已新增退出游戏与显示日志的按钮。',
      },
      {
        problem: '首页没有设置入口。',
        fix: '已新增设置按钮。',
      },
      {
        problem: '部分卡牌的文本里把位移写成了「平移」。',
        fix: '已改为统一使用「偏转」。',
      },
      {
        problem: '各个页面的按钮样式不统一。',
        fix: '已调整，按钮样式统一。',
      },
    ],
  },
  {
    date: '2026-09-30',
    items: [
      {
        problem: '生命1 在选择效果的界面上无法指向自己。',
        fix: '已修复，现在可以指向自己这张牌。',
      },
      {
        problem: '金属6 反面朝上时也会一直闪，而且没法关掉。',
        fix: '已修复：只在正面时显示；首页新增「设置」，可以关掉这个频闪特效（默认开启，其它卡牌特效不受影响）。',
      },
      {
        problem: '控制权易主时会冒出"色欲"的红色特效，哪怕场上根本没有色欲这张牌。',
        fix: '已修复，改成只有色欲在场时才显示。',
      },
      {
        problem: '双人热座对局下方的日志一直占着地方。',
        fix: '已改为默认隐藏，右上角新增「显示日志」按钮可随时展开。',
      },
      {
        problem: '双人热座对局里没有退出游戏的入口。',
        fix: '已新增左上角「退出游戏」按钮：退出当前对局并回到游戏选择页。',
      },
      {
        problem: '点击规则书查看后会下载 PDF，看不到内容。',
        fix: '已修复，改为按页显示图片。',
      },
      {
        problem: '双人热座模式下抛硬币动画播完后，有时硬币会消失。',
        fix: '已修复。',
      },
      {
        problem: '场上卡牌右上角的角标写着"活跃"。',
        fix: '已更新为"未覆盖"。',
      },
      {
        problem: '某些卡牌特效会粘在屏幕上，页面下滑时不跟着卡片走。',
        fix: '已修复。',
      },
      {
        problem: '双人热座模式没有画面大小的提示。',
        fix: '已新增游玩建议：以 65% 的画面大小游玩，按住 Ctrl 滚动鼠标滚轮可以调整。',
      },
      {
        problem: '双人热座模式的抛硬币动画与联机模式不一致。',
        fix: '已更新为联机模式的抛硬币动画。',
      },
      {
        problem: '热座模式下用鼠标滚轮滚不动页面。',
        fix: '已修复，桌面恢复正常滚动。',
      },
      {
        problem: '热座模式下场上的卡牌被周围的组件挤得特别小。',
        fix: '已修复，卡牌恢复原本大小。',
      },
    ],
  },
];

/**
 * 相邻两天之间**空几行**（用户 2026-09-30：原来那条长横线改成"空三格"）。
 *
 * 屏上由 `.changelog-sep` 那个空占位按"三行正文高度"落地（见样式表），文本形态按这个数拼空行。
 */
export const CHANGELOG_BLANK_LINES = 3;

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
 * **纯文本形态**（与屏上逐字同形）：日期 → 每条"问题 / 已修复，…"，相邻两天之间空三行。
 * 有了它，"顺序与格式"这件事能在 node 环境里直接机检（不必造 DOM）。空列表 ⇒ 空串。
 */
export function changelogText(days: readonly ChangelogDay[] = CHANGELOG): string {
  const gap = '\n'.repeat(CHANGELOG_BLANK_LINES + 1);
  return days
    .map((d) => [d.date, ...d.items.flatMap((i) => [i.problem, i.fix])].join('\n'))
    .join(gap);
}

/**
 * 面板本体：`nav.onClose` 由调用方接（首页那个入口用它把面板收起来）。
 * 摆版式只在这里；日期与条目的内容**只来自 `CHANGELOG`**。
 *
 * 同一天里的每条包一层 `.changelog-item` —— 用户 2026-09-30 要求"每天之中的问题隔开一点"，
 * 分隔（留白 + 一条细线）由样式表按这一层给，改版式不用动内容。
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
    if (index > 0) {
      // ★ 2026-09-30：两天之间是**空三行**（用户口径），所以这里放一个空占位，不写任何字符
      const gap = el('div', 'changelog-sep');
      gap.setAttribute('aria-hidden', 'true');
      panel.appendChild(gap);
    }
    panel.appendChild(el('div', 'changelog-date', day.date));
    for (const item of day.items) {
      const box = el('div', 'changelog-item');
      box.appendChild(el('div', 'changelog-problem', item.problem));
      box.appendChild(el('div', 'changelog-fix', item.fix));
      panel.appendChild(box);
    }
  });
  return panel;
}
