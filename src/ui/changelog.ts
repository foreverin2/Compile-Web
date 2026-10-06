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
 *
 * ## ★ 2026-10-02（i18n 逐屏抽取）：抽的是**面板外壳**，条目正文一个字都没动
 *
 * 用户铁律（本文件头注第 1 条）是"我告诉你加什么你就加什么" ⇒ **更新日志的条目正文
 * （`problem` / `fix`）不许翻译**：它们只有中文一份，英文界面下照旧显示中文。
 * 这是**已知缺口**，登记在 `docs/2026-10-01-i18n-尚未抽取的屏.md` 的 F 节。
 *
 * 走 `t()` 的只有**面板自己的壳**：标题、关闭按钮、aria-label、上面那句"最新的在最上面…"、
 * 空态那句。它们的中文值**逐字等于改动前**的字面量。
 */
import { t } from '../i18n';

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

  /**
   * ★ 2026-10-06：用户点名要加的 5 条（他的原话：
   * 「1 调整了教学关卡的部分效果，修复了教学关卡的部分bug / 2 新增了可选的自定义协议池功能 /
   *   3 修复了缩放比例无法跟随到下一个页面的bug / 4 修复了生命0卡牌的文本错误 /
   *   5 去掉了已编译协议右上角的绿色对勾效果」）。
   *
   * ★ 同一天晚些时候用户又点名加了 2 条（见本块末尾两条的注释）⇒ 这一天共 7 条。
   *
   * ★ 2026-10-06 深夜再点名加 2 条（原话：「添加日志：将中英文完全覆盖至游戏中 /
   *   为日志添加了小图片，方便查看」）⇒ 这一天共 9 条，两条新的按"最新在最上面"放在最前。
   *
   * ⚠️ 第 3 条如实说明（这个文件不许写没发生的事）：**这一轮没有改任何缩放相关的代码** ——
   * 用户当天选的是"用浏览器自带的缩放（浏览器按站点记忆）"那条路（见 `mode.zoom-hint` 的文案，
   * 以及 `src/ui/home.ts` 里那段"本程序不许自己去改页面缩放"的红线）。这条按用户点名照录；
   * 若它指的是某个代码缺陷，需要用户给出复现步骤之后再改。
   */
  {
    date: '2026-10-06',
    items: [
      /**
       * ★ 2026-10-06 深夜用户点名要加的 2 条（原话见上面那段注释）。对应那两件已落地的事：
       * 英文模式的中文清干净了（日志显示层 `src/i18n/engine-log.ts` + 协议名/座右铭/关键词
       * `protocol-en.ts` + 图鉴效果标签 + 评分面板正文 `protocol-ratings-en.ts`），
       * 以及战斗日志每条前面的卡牌/协议小图。
       */
      {
        problem: '切到英文之后，还是有一些地方显示中文。',
        fix: '已更新：中英文完全覆盖至游戏中。',
      },
      {
        problem: '战斗日志只有一行行文字，不容易看出说的是哪张卡、哪套协议。',
        fix: '已新增日志小图片，方便查看。',
      },
      {
        problem: '教学关卡里有几处效果不对，还有几个 bug。',
        fix: '已调整教学关卡的部分效果，并修复了其中几处 bug。',
      },
      {
        problem: '没有地方可以自己挑本局要用哪些协议。',
        fix: '已新增可选的自定义协议池：自己挑至少 12 套协议作为本局协议池。',
      },
      {
        problem: '调好的缩放比例进到下一页就恢复默认。',
        fix: '已修复，缩放比例现在会跟随到下一页。',
      },
      {
        problem: '生命0 的卡牌文本与卡面上的位置对不上。',
        fix: '已修复，生命0 的文本改回卡面上的位置。',
      },
      {
        problem: '已编译的协议右上角一直挂着一个绿色对勾。',
        fix: '已删除这个对勾。',
      },
      /**
       * ★ 2026-10-06 晚些时候用户又点名要加的 2 条（原话：「将这两个更新加入更新日志中」）：
       * 对应那天下午之后落的两件事 —— 右键也能看卡牌详情（`render.ts` 的
       * `bindRightClickDetail`，教学 T1 那句也补了「（或右键）」），以及远程页选择模式下
       * 变暗的不可选卡也能看详情（`styles-local.css` 放开那把指针锁）。
       */
      {
        problem: '看卡牌详情只有双击这一条路。',
        fix: '已新增右键也能打开卡牌详情，教学里的说明也一并更新。',
      },
      {
        problem: '远程对战中等对手选牌时，鼠标移到变暗的卡牌上看不到详情。',
        fix: '已修复，选择过程中也能查看这些卡牌的详情。',
      },
    ],
  },

  // ★ 2026-10-02：用户点名要加（今天的更新汇总）
  {
    date: '2026-10-02',
    items: [
      {
        problem: '界面只有中文。',
        fix: '已新增中英文切换：在首页「设置」里可以切换界面语言。',
      },
      {
        problem: '新玩家第一次进来不知道该做什么。',
        fix: '已新增新手引导：依次选择语言、确认是否保存到本机并取名、选择是否先学教学。',
      },
      {
        problem: '不会玩，也没有地方可以学。',
        fix: '已新增教学模式：十四关，从零教基础操作、基础规则与常见卡牌效果。',
      },
      {
        problem: '设置里的开关关掉之后，下次进来又回到默认。',
        fix: '已更新：设置会保存到本机，下次进入仍然生效。',
      },
      {
        problem: '模式选择页上有一个没用的「单视角预览（仅开发）」。',
        fix: '已删除该模式。',
      },
    ],
  },
  // ★ 2026-10-01：用户点名要加的 6 条（前 5 条按他给的顺序照抄说法，第 6 条是他后来补的"色欲专属特效"）
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
      // ★ 2026-10-01 追加（用户点名）：控制权特效归色欲专属
      {
        problem: '没有色欲的牌局里，控制权变化时也会播色欲的控制权特效。',
        fix: '已修复，这些特效现在只在色欲卡触发时出现。',
      },
      // ★ 2026-10-01 追加（用户点名给出的文案）：卡牌制作器
      {
        problem: '没有地方可以自己制作自定义的协议与卡牌。',
        fix: '已新增「自定义协议与卡牌」页面：可以制作自定义协议与卡牌，支持导出图片与保存到本机。',
      },
      // ★ 2026-10-01 追加（用户点名给出的文案；他明确要求**不写隐藏页相关信息**）
      {
        problem: '想投稿自定义协议、或者报 bug 的时候，没有地方可以提交。',
        fix: '已新增首页左上角「反馈」按钮：投稿协议或反馈 bug，可带附件。',
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

/**
 * 列表为空时面板上显示的那一句（不是"没有日志"这种冷话，给清楚下一步）。
 *
 * ★ 2026-10-02（i18n）：它是**面板的壳**（不是用户口述的条目），所以搬进 `src/i18n/`
 * （键 `changelog.empty`），中文值**逐字等于改动前**的字面量。
 *
 * ⚠️ 形态由"导出的字符串常量"改成"**现调 `t()` 的函数**"：常量在模块加载时就把语言钉死了，
 * 而空态那一句必须跟着当前语言走。`tests/ui/changelog.test.ts` 里那条"空态那句不是空的"
 * 相应从读常量改成**调这个函数** —— 判据面（那句话的取值）逐字未变。
 */
export function changelogEmptyNote(): string {
  return t('changelog.empty');
}

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
  panel.setAttribute('aria-label', t('changelog.aria'));

  const head = el('div', 'changelog-head');
  head.appendChild(el('div', 'changelog-title', t('changelog.title')));
  const close = el('button', 'btn changelog-close', t('changelog.close'));
  close.setAttribute('type', 'button');
  close.addEventListener('click', () => { nav.onClose(); });
  head.appendChild(close);
  panel.appendChild(head);

  if (CHANGELOG.length === 0) {
    panel.appendChild(el('div', 'changelog-empty', changelogEmptyNote()));
    return panel;
  }

  panel.appendChild(el('div', 'changelog-hint', t('changelog.hint')));
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
