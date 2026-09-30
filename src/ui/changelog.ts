/**
 * ★ 2026-09-29（用户要求）：**更新日志**（首页右上角那个入口的内容）。
 *
 * 约定（用户给的格式，别改）：
 *  - **最新的一天在最上面**，越往下越早；
 *  - 一天一块：先日期，然后每条"问题 + 下一行'已修复，解释'"；
 *  - 相邻两天之间是一条横线（渲染时画，不写进数据里）。
 *
 * 维护方式：**只改这个文件** —— 在数组最前面加一天 / 在某一天里加一条 item 就行，
 * 界面会自动跟着走（`renderChangelog()` 只负责摆版式）。
 */
export interface ChangelogItem {
  /** 玩家视角的问题（一句话说清现象） */
  readonly problem: string;
  /** 修法 + 解释，**以"已修复，"开头**（渲染与测试都按这个前缀认它） */
  readonly fix: string;
}

export interface ChangelogDay {
  /** `YYYY-MM-DD` */
  readonly date: string;
  readonly items: readonly ChangelogItem[];
}

/** 最新的一天在最上面。 */
export const CHANGELOG: readonly ChangelogDay[] = [
  {
    date: '2026-09-29',
    items: [
      {
        problem: '服务器被人从 SSH 爆破登进来（凌晨 5:18 用密码进了 admin，装了挖矿程序）。',
        fix: '已修复，换了系统盘整台重建（公网 IP 不变），改成只认密钥、22 端口只放行你家那一个 IP；'
          + '顺手把中继服务器从"写死的长期密码"改成每次开局现签一张 10 分钟有效的短期凭据。',
      },
      {
        problem: '界面上有些"自说自话"的句子，读起来像开发笔记：'
          + '"6 位房间码要经一个信令服务…"、"这一轮没有中继可用（凭据服务连不上）…"、'
          + '生成邀请码下面那段讲二维码接口的说明。',
        fix: '已修复，全改成玩家看得懂的话；那两段开发口吻的说明直接不再显示。',
      },
      {
        problem: '模式选择页最下面那个"下一步：掷硬币定先手"按钮，看不出它属于哪个模式，其实是重复入口。',
        fix: '已修复，删掉这个按钮 —— 点上面那张"热坐（双人）"卡片就是开局（它会读下面两个开关的状态）。',
      },
      {
        problem: '模式选择页三个按钮大小不一，两个开关的勾选框只有一个空白小方块，和整体风格不搭。',
        fix: '已修复，三个按钮改成等大；两个开关重做成卡片式（勾上是青色对勾、整行亮起来）。',
      },
      {
        problem: '联机对战那一页背景一片纯黑，跟别的页面不是一个风格。',
        fix: '已修复，那一屏原来铺了一层不透明底色把场景图整个盖住了，改成只压一层淡色。',
      },
      {
        problem: '选过一次"建房 / 加入"之后，退回模式页再进联机，会直接进上一次那个模式，没法重选。',
        fix: '已修复，离开大厅时把大厅状态丢掉，再进来重新问一次"建房还是加入"。',
      },
      {
        problem: '设备体检页有两个"返回首页"，而且点返回弹出来的是授权弹窗、不是首页。',
        fix: '已修复，删掉重复的那个；返回按钮改成"回到游戏"；并且**把"允许"这个选择记住了** —— '
          + '以后刷新页面、来回跳转都不会再问一次授权。',
      },
      {
        problem: '桌面窗口下打热座，场上卡牌大小全错、鼠标滚轮也滚不动。',
        fix: '已修复，那是平板用的"自动缩放 + 拖动查看"误在桌面触发；加了"只有触摸设备才启用"的判据，'
          + '桌面恢复原样、滚轮正常（联机页的卡牌与特效大小一个字节没动）。',
      },
      {
        problem: '首页副标题与页脚署名不好听。',
        fix: '已修复，改成"译世界 · 非官方网页版"与"本网页由「我吃吃吃吃」使用 DSH 辅助开发"。',
      },
    ],
  },
  {
    date: '2026-09-28',
    items: [
      {
        problem: '选协议那几个屏看不出这一局是直连还是走中继。',
        fix: '已修复，加了一行"当前连接：直连 / 经中继"，真实读数，不是猜的。',
      },
      {
        problem: '热座在手机横屏/平板上显示不全、"查看弃牌堆"够不到、1280×800 下手牌越界。',
        fix: '已修复，按真机测量重排了缩放与钉角，够不到的元素改成钉在屏幕角上。',
      },
      {
        problem: '邀请码和回示码太长，发出去容易被聊天工具截断。',
        fix: '已修复，换成紧凑载荷，码短了一截。',
      },
      {
        problem: '图鉴在手机上被"请把手机横过来"的提示条盖住，几百个可点控件都点不到，连返回键都点不了。',
        fix: '已修复，提示条只留在牌桌类页面；图鉴竖屏的横向溢出也一起修了。',
      },
      {
        problem: '中继凭据是写死在前端里的长期密码，谁都能拿去用我们的中继刷流量。',
        fix: '已修复，改成"开局时向服务器现签一张 10 分钟有效的短期凭据"，前端里不再有长期密码。',
      },
    ],
  },
  {
    date: '2026-09-27',
    items: [
      {
        problem: '跨网络的两台设备连不上（两边都不在同一张网里时，直连打不通）。',
        fix: '已修复，接了一台中继服务器：能直连时走直连，直连打不通时自动经它转发。',
      },
      {
        problem: '手机上远程/热座页显示不全、够不到按钮、横过来没反应、进牌桌黑屏。',
        fix: '已修复，做了一套手机横屏适配（旋转档 + 自动缩放 + 空白处拖动查看其余部分）。',
      },
      {
        problem: '协议显示名"僵化"读起来别扭。',
        fix: '已修复，改名为"死板"（规则图上那张牌也是这么叫的）。',
      },
      {
        problem: '行动回合能随手跳过；联机对局里还能用指令直接改状态。',
        fix: '已修复，行动方必须真的做一个动作才能过；联机下禁止用指令改状态。',
      },
      {
        problem: '"死板"这块协议板的画面渲染不对。',
        fix: '已修复，按规则图重画了板面。',
      },
    ],
  },
];

/** 相邻两天之间那条横线（用户给的格式；渲染时插在日期块之间） */
export const CHANGELOG_SEPARATOR = '------------------------------------------';

/** 最小的建节点工具（本文件自带，不引 `home.ts` 的私有 helper，也不新增样式表） */
function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * **纯文本形态**（与屏上逐字同形）：日期 → 每条"问题 / 已修复，…"，相邻两天之间一条横线。
 * 有了它，"顺序与格式"这件事能在 node 环境里直接机检（不必造 DOM）。
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

