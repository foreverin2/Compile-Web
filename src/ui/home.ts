import type { PlayerId } from '../core/models/types';
// G5 T11-A：硬币落点、胜负规则、面映射的**唯一出处**（联机那条路也算同一件事）
import { coinLanding, draftStarterFor } from '../app/coin';
import type { CoinSide } from '../app/coin';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, protocolImgSrc, cardImgSrc, cardTextParts } from '../data/demo';
import { LIB_TAG_GROUPS, LIB_ALL_TAG_IDS, filterLibrary } from '../app/library-filter';
import { openZoom, buildCardTextEl, buildProtocolRatingPanel, bindClickOrDouble } from './render';
import { changelogElement } from './changelog';
import { FX_SETTINGS, isFxSettingOn } from './fx-settings';
// ★ 2026-10-01（P0，用户拍板"UI 全量双语"）：设置小窗是**第一个真实消费者** —— 它的每一条
// 文案都从 `src/i18n/` 取。中文值与这里原来的字面量逐字一致（既有测试零改动）。
import { LANGS, getLang, saveFailedSwitchText, saveFailedText, setLang, t, type Lang, type WriteFailure } from '../i18n';

/**
 * 主界面/掷硬币/图鉴/规则图纸 —— 非对局屏（main.ts 导航）。
 *
 * - renderHome：真正的主页面（2026-09-03 用户需求）：菜单按钮 + 全部已编译卡面
 *   背景大平面（两向对角巡回动画）+ 页脚署名。45 套（1+2+3代，2026-09-06）。
 * - renderCoin：掷硬币先手机制（玩家一选正/反 → 掷币；掷胜者先选协议，后选协议者
 *   先出牌——main 以 createGame({ draftStarter: 胜者, firstToPlay: 1-胜者 }) 开局）。
 * - renderLibrary：查看全部协议及其所属卡牌（分组行 + 点卡放大；复用 render.openZoom）。
 * - renderRules：查看 1/2/3 代说明书与 FAQ（**2026-09-30 起按页显示图片**，
 *   页图见 `public/assets/rules/pages/`；原版 PDF 留成一个显式按钮）。
 */
export interface HomeNav {
  /** 开始游戏 → 游戏模式选择页（2026-09-03：热坐/单人/三人 + 禁用/随机池开关） */
  startGame(): void;
  openLibrary(): void;
  openRules(): void;
  /** G3：本地数据与隐私（授权状态、清除本机数据、档案导入导出入口） */
  openLocalData(): void;
  /** ★ 2026-09-30（用户要求）：设置（特效开关；现在只有金属6 频闪一项） */
  openSettings(): void;
  /**
   * ★ 2026-10-01（用户要求）：**「反馈」入口**（首页左上角那个按钮）。
   *
   * 用户原话：「首页左上角加一个「反馈」按钮」「点开后有**两种操作**：① 投稿自定义协议
   * ② bug 反馈」。屏与网络都在 `src/ui/feedback-screen.ts`；本文件只负责那个按钮，
   * 动作交给宿主（它才拿得到抓取层）。
   */
  openFeedback(): void;
  /**
   * ★ 2026-10-01（用户要求）：**卡牌制作器**（「自定义协议与卡牌」页面）。
   *
   * 移植自开源项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
   * https://github.com/albrtbc/compiler）。屏与它的全部逻辑在 `src/ui/cardmaker/`；
   * 本文件只放那个入口按钮，打开的动作交给宿主（它才拿得到存储与文件能力）。
   */
  openCardmaker(): void;
  /**
   * ★ 2026-10-02（P2，用户口径）：**「新手教程」入口** —— 真的进教学屏。
   *
   * 到 P1 为止这个按钮只弹一句 `toast.tutorial`（"新手教程：待开发"），那是占位。
   * 现在它进 `src/ui/tutorial-screen.ts` 的教学屏（十四关，T0~T13）；开屏的动作交给宿主
   * （屏要的存储与退出接缝都由宿主注入，本文件只放这一个按钮）。
   *
   * ⚠️ `toast.tutorial` 那个键**保留**（向导与"技能没到"时的兜底话术仍然可能用它）；
   * 首页这个按钮**不再**用它。
   */
  openTutorial(): void;
  /**
   * ★ 2026-10-01（P1）：**进首页时立刻要说的一句话**（选填）。
   *
   * 唯一用途：首启向导第 3 步选「开始教学」的人落到首页时要看到一句提示。
   * ⚠️ 2026-10-02（P2）起那一支**直接进教学屏**（不再落到首页 + 提示），所以现在用它的
   * 只有"教学暂时打不开"那种兜底路径；`src/main.ts` 的 `finishOnboarding` 里写着这段历史。
   *
   * 为什么不是宿主自己 `showToast` 一下：那个 toast 挂在 `document.body` 上，
   * 而 `renderHome` 第一句就是 `clearRoot(root)` 重画 —— 宿主先提示再进首页，
   * 提示会被同一 tick 里的重画闪掉。所以口径是"**交给首页，画完再发**"。
   */
  initialToast?: string;
}

export interface CoinNav {
  backHome(): void;
  /**
   * 本局种子（G0）：硬币结果由它派生，保证双方一致、且可复现。
   *
   * ⚠️ **G5 T11-B 起是可选**：联机那条路（`net` 分支）**读不到也不许读**它 ——
   * 叫面必须早于公开种子（`docs/2026-09-17-…-实现计划.md` D27），屏打开时种子还没到手。
   * 热座那条路缺了它就是**用法错误**，`renderCoin` 会当场抛（见那里的守卫），
   * 不给一个"拿空串当种子"的静默降级。
   */
  seed?: string;
  /** 掷币结束：draftStarter = 掷胜玩家座位（0/1）；firstToPlay 由 main 置 1 - draftStarter */
  beginGame(draftStarter: PlayerId): void;
  /**
   * ★★ **联机分支**（G5 T11-B；D27 的落地）。
   *
   * 有它 = 这块屏是**握手中间那一格**，不是热座那条"玩家一掷硬币"：
   *  - `role === 'caller'`（加入方）：芯片可点，点下即 `choose(side)` —— 那一刻就是
   *    它发出 `commit-face` 的时刻（相位机唯一的入口是 `seed-committed`）；
   *  - `role === 'waiter'`（房主）：芯片**禁用**，屏上是等待文案；
   *  - `landed === null` ⇒ 种子还没到手，**不显示落点**；到手后由 app 回填并重绘。
   *
   * 这个分支**不读 `nav.seed`**（种子在屏打开时还不该有）。
   */
  net?: CoinNetView;
  /**
   * ★ 2026-09-30：**热座那条路的动态偏好**（`prefers-reduced-motion: reduce`）。
   *
   * 热座现在与联机共用同一段抛硬币动画（`playCoinTossAnimation`），而那段函数的第一个入参
   * 就是"要不要演"。联机那侧原本由 `CoinNetView.reducedMotion` 传，热座这侧补上同一个口子 ——
   * 屏自己不读媒体查询（宿主 `main.ts` 的 `reducedMotion()` 是唯一出处）。
   */
  reducedMotion?: boolean;
}

/**
 * 联机硬币屏的**读数**（`CoinNav.net` 的形状）。
 *
 * 它是"这一刻屏上该画什么"的一份快照，由 app（`src/main.ts`）从大厅客户端的相位算出来
 * —— 屏自己不记任何状态、不推进任何流程。
 */
export interface CoinNetView {
  /** 本端是叫面的一方，还是等对方叫面的一方 */
  role: 'caller' | 'waiter';
  /**
   * 这一刻的握手相位（`SessionPhase` 的字符串，或没有链路时的 `'idle'`）。
   *
   * 屏上**不画**它（联机硬币屏没有大厅那条相位行），只挂在 `data-net-phase` 上给排查与
   * 真浏览器门用 —— 没有它，那块屏上"握手走到哪一格"在 CDP 里读不到任何东西。
   *
   * 可选：屏自己不需要它来画任何一格（缺省时属性是空串）。
   */
  phase?: string;
  /** 叫面（只有 `role === 'caller'` 会调它）；点了之后屏上转为等待落点 */
  choose(side: CoinSide): void;
  /** 叫出去的那一面（`null` = 还没叫 ⇒ 两枚芯片都不选中、大币停在正面） */
  chosen: CoinSide | null;
  /** 落点（`null` = 种子还没到手 ⇒ 屏上不出现落点读数） */
  landed: CoinSide | null;
  /**
   * ★★ **先选协议者**（`null` = 胜负依据还没齐 ⇒ 屏上**不定格**）。
   *
   * 它由 app 算好交下来（`draftStarterFor(caller, chosen, seed)`，规则只此一处），
   * **屏上不再自己比较 `landed === chosen`** —— 那一比会把"叫出去的那一面"当成
   * 胜负依据的第二个来源，而两端在"面到手的先后"上不同（房主先有种子、加入方先有自己的面），
   * 于是同一局会在两端定格出**两个相反**的读数（真浏览器门实测，2026-09-19）。
   */
  winner: PlayerId | null;
  /** 叫面者是谁（落点那句"玩家 N 先选协议"的座位口径；`0` = 房主位、`1` = 加入方位） */
  caller: PlayerId;
  /**
   * ★★ **G5 T19 修复轮：这一帧画硬币阶段的哪一格**（由 app 的相位交下来，**不许按落点反推**）。
   *
   * 三个值与屏上的对应（`renderCoinNet` 开头那段说明）：
   *  - `'call'`：**只说**"玩家 N 叫了「某面」"—— 不播动画、不出结论行；
   *  - `'toss'`：开始演抛硬币（`playCoinTossAnimation`）；
   *  - `'settled'`：出**结论行**（`coin-result-text`），并且这一格要在屏上停够（归 app 计时）。
   *
   * ⚠️ 缺省（`undefined`）时按 `'settled'` 处理：那是"重画一帧落定屏"的调用点
   * （`main.ts` 进牌桌之前那次补画）与既有单测的口径。
   */
  coinPhase?: 'call' | 'toss' | 'settled';
  /**
   * `prefers-reduced-motion: reduce` ⇒ **动画那一格不演**（换图照做）。
   *
   * 注意它只影响动画：`'call'` 与 `'settled'` 两格的停留是"把话说完"，与动态偏好无关。
   */
  reducedMotion?: boolean;
}

/**
 * 世代标签的**唯一出处**（键表）。
 *
 * ★ 2026-10-01（C）：值是**文案键**，屏上由 `setLabel()` 取 —— 原来的中文字面量住在
 * `src/i18n/zh.ts` 的 `gen.*` 里（值与它逐字相同）。这里的键写成字面量，缺键扫描腿看得见。
 */
const SET_LABEL_KEY: Record<string, string> = {
  MN01: 'gen.1.base', AX01: 'gen.1.extra', MN02: 'gen.2.base', AX02: 'gen.2.extra',
  MN03: 'gen.3.base', AX03: 'gen.3.extra',
};

/**
 * 世代标签（键表 → 当前语言的文案）。
 *
 * ⚠️ 与 `fxLabelText()` / `ruleTitleText()` 同一条纪律：**键必须在源码里以字面量出现**
 * （下面那个 `switch` 就是落点），否则缺键扫描腿看不到它们。
 */
function setLabel(set: string): string {
  switch (SET_LABEL_KEY[set]) {
    case 'gen.1.base': return t('gen.1.base');
    case 'gen.1.extra': return t('gen.1.extra');
    case 'gen.2.base': return t('gen.2.base');
    case 'gen.2.extra': return t('gen.2.extra');
    case 'gen.3.base': return t('gen.3.base');
    case 'gen.3.extra': return t('gen.3.extra');
    default: return set;
  }
}
void SET_LABEL_KEY; // 图鉴改显示座右铭后不再直接使用（保留作 chip/调试标签源）

/**
 * ★ 2026-09-30（用户要求）：模式页那句"建议 65% 游玩"。
 *
 * ⚠️ **只用浏览器自带的缩放**（Ctrl + 滚轮，或 Ctrl 与 +/−），本程序**不许**自己去改页面缩放：
 * 第一版我顺手实现了"Ctrl + 滚轮改整页缩放"，用户实测**特效层会错位** —— 那些特效的坐标是按
 * 100% 布局算出来的，整页一缩放就对不上；而且用户的原话是"我只是让你加个建议上去就可以了"。
 * ⇒ 那套实现已整份撤掉（删了 `src/ui/page-zoom.ts` 与它的测试，`main.ts` 的 `installPageZoom()` 也没了）。
 *
 * ★ 2026-10-01（C）：文案本身搬进两张表（键 `mode.zoom-hint`），**调用点直接把键写成字面量**
 * —— 原来那个 `PLAY_SIZE_HINT_KEY` 常量会让缺键扫描腿看不见它（"不许有动态键"那条腿当场红）。
 */
function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** 简易 toast（提示条） */
function showToast(msg: string): void {
  const old = document.querySelector('.home-toast');
  if (old) old.remove();
  const t = el('div', 'home-toast', msg);
  document.body.appendChild(t);
  window.setTimeout(() => t.remove(), 2600);
}

/**
 * 清空根容器（各屏互斥）；退出「整屏主页」模式。
 *
 * ## ★ 2026-10-01（真机 A 号缺陷）：**绝对不许去写 DOM 的只读属性**
 *
 * 上一版这里在清空之前先调 `unlinkTree()` —— 它递归地对每个子节点做
 * `(child as …).parentElement = null`。**`parentElement` 在真浏览器里是只读 getter**
 * （`Node.parentElement`），赋值当场抛
 * `Cannot set property parentElement of #<Node> which has only a getter`：
 *
 *  - 用户操作路径"切语言 → 进「自定义协议与卡牌」→ 点返回首页"**每次必炸**；
 *  - 而且它还被写盘失败那条提示捎带出去（`Technical detail: Cannot set property parentElement…`）。
 *
 * 当时它"单测全绿"的原因写在 `tests/ui/net-dom-stub.ts` 里：**桩把 `parentElement` 实现成普通可写字段**。
 * ⇒ 这一轮同时做了两件事：
 *  1. 本文件改成**显式记账**（`detachLiveBg()` 把"这份背景已经摘下来了"记进模块状态），
 *     `unlinkTree()` 整个删掉；
 *  2. 桩把 `parentElement` / `ownerDocument` 改成**真 DOM 语义的只读访问器**（写它当场抛），
 *     于是这类缺陷在单测里就会现形（那一处加固另有一组腿，见 `tests/ui/home-bg-reuse.test.ts`）。
 */
function clearRoot(root: HTMLElement): void {
  // ★ 先把"上一帧那份背景"摘下来记账（本次重画可能还要复用它）——
  //   `parentElement` 只读，所以只能靠**模块状态**记住这件事，不能靠反查父节点。
  detachLiveBg(root);
  root.textContent = '';
  root.classList.remove('draft-exit', 'board-enter', 'no-anim', 'screen-home');
}

/**
 * 把当前挂在 `root` 里的那份 `.home-bg` 摘下来，并记成"已摘下、可复用"。
 *
 * ⚠️ 用 `querySelector` + `remove()`（都是合法的 DOM 操作，不写任何只读属性）；
 * 找不到（不是首页 / 不是这个 root）就**把记账清空** —— 那种情况下没有可复用的背景。
 */
function detachLiveBg(root: HTMLElement): void {
  const bg = liveBgHost;
  if (bg === null || liveBgRoot !== root) {
    liveBgDetached = false;
    return;
  }
  // `remove()` 在"本来就不在文档里"时是 no-op ⇒ 不需要先判 `parentElement`（也不写它）。
  bg.remove();
  liveBgDetached = true;
}

/* =====================================================================
 * 背景大平面（2026-09-03 用户修正版）：
 * - 全部协议分成若干组；卡面横置（原图逆时针 90°，见 .bg-tile）后整组再顺时针
 *   斜转 45°（CSS --bg-tilt 可调），沿一条「左上 → 右下」的斜线排开；
 * - 这些斜线组在平面内上下拼接；相邻组的移动方向相反（一组向左上、相邻组向右下
 *   ——按组索引自动交替，无切换按钮）；
 * - 实现：旋转平面坐标系（rotate(var(--bg-tilt))）内放多条「水平巡回带」，每条带
 *   内容两份平铺并按 ±x 循环平移（平面 +x 方向 = 屏幕 ↘，-x = ↖，平移即沿斜线
 *   上/下移动，两份平铺保证巡回无缝）；平面按视口对角线取边长，旋转后仍铺满。
 * 图源 = public/assets/bg-thumbs/<defId>.jpg 缩略图（避免全尺寸解码峰值）。
 * ===================================================================== */
const BG_TILT_DEG = 45; // 顺时针斜转角度（0=纯横排；45=沿 45° 斜线）
const BG_TILE_W = 138; // 卡横置视觉宽
const BG_GAP_X = 14;
const BG_BAND_H = 99; // 每条斜线带的厚度（= 卡高）
const BG_BAND_GAP = 16; // 相邻斜线带间距
const BG_SPEED_SEC = 90; // 基础巡回周期（秒，可调观感）

/** 背景缩略图 src（已编译面） */
function bgThumbSrc(defId: string): string {
  return `/assets/bg-thumbs/${defId}.jpg`;
}

/** 打乱协议顺序（装饰用） */
function shuffledProtocols(): typeof DEMO_PROTOCOLS {
  const defs = [...DEMO_PROTOCOLS];
  for (let i = defs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [defs[i], defs[j]] = [defs[j], defs[i]];
  }
  return defs;
}

/** 协议分组（装饰用）：三代并池（45 套）→ 5 组等分 */
function bgGroups(): typeof DEMO_PROTOCOLS[] {
  const defs = shuffledProtocols();
  const groups: typeof DEMO_PROTOCOLS[] = [];
  const size = Math.ceil(defs.length / 5);
  for (let i = 0; i < defs.length; i += size) groups.push(defs.slice(i, i + size));
  return groups;
}

/** 重建 .home-bg：旋转平面内的斜线巡回带（进入主页 / 窗口缩放时重建） */
function fillBg(bg: HTMLElement): void {
  const vw = Math.max(1200, window.innerWidth || 1200);
  const vh = Math.max(760, window.innerHeight || 760);
  // 平面边长按视口对角线取足（旋转 45° 后轴对齐外接盒 ≥ 边长×√2，仍铺满视口）
  const side = Math.ceil(Math.hypot(vw, vh) * 1.15) + 140;
  const pitch = BG_BAND_H + BG_BAND_GAP;
  const bandCount = Math.ceil(side / pitch) + 2;
  const contentW = side + 240; // 单份内容长 = 巡回距离
  const tilesPer = Math.ceil(contentW / (BG_TILE_W + BG_GAP_X)) + 2;
  const groups = bgGroups();

  const bands: string[] = [];
  for (let k = 0; k < bandCount; k++) {
    const group = groups[k % groups.length];
    const cells: string[] = [];
    for (let i = 0; i < tilesPer; i++) {
      const def = group[i % group.length];
      cells.push(
        `<span class="bg-tile"><img alt="" decoding="async" src="${bgThumbSrc(def.defId)}"></span>`
      );
    }
    const one = `<div class="bg-band-content">${cells.join('')}</div>`;
    // 相邻组反向自动交替：奇数带向右下（rev），偶数带向左上
    const move = el('div', 'bg-band-move' + (k % 2 === 1 ? ' rev' : ''));
    move.style.width = `${contentW * 2}px`;
    move.style.setProperty('--dx', `${-contentW}px`);
    move.style.animationDuration = `${BG_SPEED_SEC + (k % 4) * 14}s`;
    move.innerHTML = one + one;
    const band = el('div', 'bg-band');
    band.style.top = `${k * pitch}px`;
    band.style.width = `${side}px`;
    band.appendChild(move);
    bands.push(band.outerHTML);
  }

  const plane = el('div', 'bg-plane');
  plane.style.width = `${side}px`;
  plane.style.height = `${side}px`;
  plane.style.setProperty('--bg-tilt', `${BG_TILT_DEG}deg`);
  plane.innerHTML = bands.join('');
  const old = bg.querySelector('.bg-plane');
  if (old) old.remove();
  bg.insertBefore(plane, bg.querySelector('.home-bg-vignette') ?? null);
}

/** 当前挂载中的背景节点（供窗口 resize 重建；离开主页时置空） */
let liveBgHost: HTMLElement | null = null;
/**
 * 上面那一份挂在**哪个根**里（`renderHome` 的 `root`）。
 *
 * ⚠️ 用它而不是 `root.contains(live)`：本仓的 DOM 桩把 `contains` 实现成**恒 false**
 * （见 `tests/ui/net-dom-stub.ts` 的 extra 列表）⇒ 拿它当复用判据会让 D2 的行为腿在桩上
 * 永远走"不复用"那一支（假绿）。记 root 这一枚引用既简单又**能在桩上真跑**。
 */
let liveBgRoot: HTMLElement | null = null;
/**
 * ★ 2026-10-01（真机 A 号缺陷）：「上一帧那份背景**已经被 `clearRoot` 摘下来了**」。
 *
 * 这是**显式记账**，不是从 DOM 反查出来的：上一版靠"子节点的 `parentElement` 是不是 null"
 * 判断能否复用，于是为了"把子节点解绑"去写了一个**只读属性** —— 真浏览器里当场抛异常
 * （见 `clearRoot` 的注释）。现在这条状态只由 `detachLiveBg()` 与 `registerBgResize()` 维护：
 *  - `clearRoot` ⇒ `detachLiveBg()` ⇒ `true`（背景已摘、可复用）；
 *  - `registerBgResize()`（新背景挂上去之后）⇒ `false`（它的父节点就是首页，别重复 remove）。
 */
let liveBgDetached = false;
let bgResizeTimer: number | null = null;

/**
 * 把已经存在的那一份 `.home-bg` 摘下来复用，返回 `null` 表示"没有可复用的"。
 *
 * ★ 2026-10-01（P0 线上验收 **D2**）：**切语言不许重建首页背景**。
 *
 * ## 缺陷现场（真浏览器实测）
 *
 * 切语言那条路原来直接 `showHome()` ⇒ `renderHome` 从 `clearRoot` 开始重画整棵，
 * 于是 `buildHomeBg()` 重新洗牌（`bgGroups()` 里的 `Math.random()`）+ 重建全部斜线带：
 * 608 张 `.bg-plane` 的顺序哈希 `2714029209→1340731705`、band 的 CSS `currentTime` 从 2850
 * 掉回 350（动画**从头开始**）。玩家看到的是"切个语言，背景整片跳了一下"。
 *
 * ## 选了哪种修法，为什么（用户要求两处都说清）
 *
 * 两条路都可行：**(a) 让背景节点跨重画保持同一个 DOM 节点与动画连续性**、
 * **(b) 把洗牌改成固定种子**。这里选 **(a)**，理由按重要性：
 *
 *  1. **(a) 同时解决两件事**：(b) 只让"洗出来的顺序"可复现，动画仍然会被重建
 *     （`fillBg` 造的是新的 `.bg-band-move` 元素 ⇒ 新元素上的 CSS 动画必然从 0 开始），
 *     而验收口径的第二条正是 `currentTime` **不许回退**；
 *  2. **(b) 有产品代价**：固定种子 ⇒ **每次打开首页都是同一张背景**（现在每次加载换一个排列）。
 *     改观感换一个"切语言不跳"的收益，不划算；
 *  3. **(a) 顺带修掉同族缺陷**：任何"离开首页再回来"（进图鉴/规则/本地数据再返回）现在也
 *     不重建背景 —— 那是同一个 `renderHome`。
 *
 * ⚠️ **真浏览器里为什么"同一个 DOM 节点"就等于"动画不回退"**：把节点从 `#app` 摘下来再挂回去，
 * 只要它没被 GC、也没有被重新创建，浏览器会**保留它上面的 CSS 动画状态**（`currentTime` 继续走）。
 * 而 `fillBg` 里那句 `innerHTML`/`insertBefore` 造的是**新元素**，那才是"从 0 开始"的来源。
 *
 * ⚠️ 判据是**三个模块状态**（`liveBgDetached` / `liveBgRoot` / `liveBgHost`），
 * 一个 DOM 属性都不写、也不反查父节点 —— 这就是 A 号缺陷的修法。
 */
function takeReusableBg(root: HTMLElement): HTMLElement | null {
  const live = liveBgHost;
  if (live === null || !liveBgDetached) return null;
  if (liveBgRoot !== root) return null; // 换了根：跨 root 搬背景没有意义，还会把旧根掏空
  liveBgDetached = false; // 它马上要被挂回首页 ⇒ 不再是"已摘"状态
  return live;
}

/**
 * 主页背景容器。
 *
 * ★ D2 起它**优先复用**上一帧那一份（`takeReusableBg`），拿不到才新建。
 * 新建时洗牌照旧（每次加载换一个排列），复用时不洗、不重建 ⇒ 顺序与动画都连续。
 */
function buildHomeBg(root: HTMLElement): HTMLElement {
  const reused = takeReusableBg(root);
  if (reused !== null) return reused;
  const bg = el('div', 'home-bg');
  bg.setAttribute('aria-hidden', 'true');
  fillBg(bg);
  bg.appendChild(el('div', 'home-bg-vignette'));
  return bg;
}

function registerBgResize(root: HTMLElement, bg: HTMLElement): void {
  liveBgHost = bg;
  liveBgRoot = root;
  // ★ A 号缺陷：这份背景**刚刚挂上首页**（调用点紧接着 `screen.appendChild(bg)`）⇒ 记账为"未摘"。
  liveBgDetached = false;
  if (bgResizeTimer !== null) return; // 监听只挂一次
  window.addEventListener('resize', () => {
    if (bgResizeTimer !== null) window.clearTimeout(bgResizeTimer);
    bgResizeTimer = window.setTimeout(() => {
      bgResizeTimer = null;
      if (liveBgHost && liveBgHost.isConnected) fillBg(liveBgHost);
    }, 300);
  });
}

/** 主页面：菜单 + 斜线组背景 + 页脚署名（铺满整屏，无露底） */
export function renderHome(root: HTMLElement, nav: HomeNav): void {
  clearRoot(root);
  root.classList.add('screen-home'); // #app 去内边距 → 主页背景铺满整个可视区
  const screen = el('div', 'home-screen');

  // ★ 2026-10-01（D2 + A）：`clearRoot(root)` 已经把上一帧那份背景摘下来并记了账
  //   （`detachLiveBg`），这里只是把它取回来复用。
  const bg = buildHomeBg(root);
  registerBgResize(root, bg);
  screen.appendChild(bg);

  const menu = el('div', 'home-menu');
  menu.appendChild(el('div', 'home-logo', 'Compile'));
  menu.appendChild(el('div', 'home-sub', t('home.sub')));
  const btns = el('div', 'home-menu-buttons');
  btns.appendChild(button('btn home-btn home-btn-primary', t('home.start'), nav.startGame));
  btns.appendChild(button('btn home-btn', t('home.library'), nav.openLibrary));
  // ★ 2026-10-02（P2）：这一枚从"弹一句待开发"改成**真的进教学模式**（用户口径：
  //   首页点「新手教程」就能进教学屏；十四关（T0~T13），可中断续玩）
  btns.appendChild(button('btn home-btn', t('home.tutorial'), nav.openTutorial));
  btns.appendChild(button('btn home-btn', t('home.rules'), nav.openRules));
  // G3（Task 4）：本地数据与隐私入口 —— 授权状态、清除本机数据、档案导入导出（Task 7 落地屏）
  btns.appendChild(button('btn home-btn', t('home.local-data'), nav.openLocalData));
  // ★ 2026-09-30（用户要求）：设置入口（现在只有金属6 频闪特效一个开关）
  btns.appendChild(button('btn home-btn', t('settings.title'), nav.openSettings));
  /**
   * ★ 2026-10-01（用户要求）：**卡牌制作器入口** —— 「自定义协议与卡牌」。
   *
   * 用户原话：「你要把一个开源卡牌制作器移植进我们的项目，做成一个**新页面**」+
   * 「**新增一个入口按钮**（位置你定，别和已有的打架）」。
   *
   * 位置：菜单按钮列里紧挨着「设置」**上面**（都在主菜单列内，不与左上角「反馈」/
   * 右上角「更新日志」那两个绝对定位的角标打架）。屏本身在 `src/ui/cardmaker/page.ts`，
   * 本文件只负责"谁开"—— 动作走 `nav.openCardmaker`（宿主接缝），与 `openLocalData` 同款。
   */
  btns.appendChild(button('btn home-btn', t('home.cardmaker'), nav.openCardmaker));
  menu.appendChild(btns);
  screen.appendChild(menu);

  screen.appendChild(
    el(
      'footer',
      'home-footer',
      t('home.footer')
    )
  );

  /**
   * ★ 2026-09-29（用户要求）：**右上角"更新日志"入口**。
   *
   * 内容与版式都在 `src/ui/changelog.ts`（那里是唯一出处，本文件只负责"谁来开合"）。
   * 格式按用户给的：日期 → 每条"问题 / 已修复，解释"，相邻两天之间一条横线，最新在最上面。
   */
  const logWrap = el('div', 'changelog-wrap');
  logWrap.appendChild(button('btn changelog-open', t('common.changelog'), () => {
    logWrap.classList.toggle('changelog-open');
  }));
  logWrap.appendChild(changelogElement({ onClose: () => { logWrap.classList.remove('changelog-open'); } }));
  screen.appendChild(logWrap);

  /**
   * ★ 2026-10-01（用户要求）：**左上角「反馈」按钮**。
   *
   * 用户原话：「首页左上角加一个「反馈」按钮」。位置与右上角那个「更新日志」对称
   * （`.changelog-wrap` 是 `top:16px; right:18px`，这里是 `top:16px; left:18px`）。
   *
   * 点开之后是 `src/ui/feedback-screen.ts` 的表单浮层（挂到 `document.body`，
   * 关掉之后首页原样还在，与设置小窗同款）；动作走 `nav.openFeedback`（宿主接缝），
   * 本文件不 import 那一屏 —— 于是"谁开、开哪一层"这件事在 `main.ts` 一处看得全。
   */
  const feedbackWrap = el('div', 'feedback-wrap');
  feedbackWrap.appendChild(button('btn feedback-open', t('common.feedback'), () => { nav.openFeedback(); }));
  screen.appendChild(feedbackWrap);

  root.appendChild(screen);

  /**
   * ★ 2026-10-01（P1）：这一屏**画完之后**再发"进首页时要说的一句话"（`nav.initialToast`）。
   *
   * 落点必须在 `root.appendChild(screen)` 之后：`showToast` 挂的是 `document.body`，
   * 而本函数第一句 `clearRoot(root)` 会把 `#app` 清空重画 —— 画完再发才不会被同一 tick 闪掉。
   * 平时的首页没有这个字段（`undefined`）⇒ 一行也不发。
   */
  if (nav.initialToast !== undefined) showToast(nav.initialToast);
}

/* =====================================================================
 * 游戏模式选择页（2026-09-03）：热坐（双人，可玩）/ 联机对战（两台设备）/ 单人 / 三人（开发中）；
 * 两个默认关闭的开关：禁用模式（开局按规则禁用协议）、随机池模式（随机抽 12 套）；
 * 开关左侧带圆形「?」帮助图标（hover 显示说明）。两种模式下草稿页世代筛选仍可用。
 *
 * 2026-10-01（用户要求）：「单视角预览（仅开发）」那张卡（以及它专属的 `devUnlocked` 形参与
 * `startNetPreview` 接缝）整个删掉 —— 玩家与开发者看到的都是上面那四张。
 * ===================================================================== */
export interface ModeSelectNav {
  backHome(): void;
  /**
   * G5/T41（用户 2026-09-27 第 1 条）：**设备体检** —— 模式选择页最下方那个跳转按钮。
   *
   * 它**不是游戏模式**：宿主不设 `renderMode`、不碰 `state`，只做一次
   * `location.href = './probe.html'`（同源静态页，源文件在 `public/probe.html`）。
   * 为什么走宿主而不是在这里直接写 `location`：本文件的渲染函数要能在无 jsdom 的 DOM 桩上
   * 真跑（`tests/ui/net-preview-wiring.test.ts` 的行为腿），跳转由宿主注入才可观测。
   */
  openDeviceCheck(): void;
  /** 玩家选定「热坐」并携带两个开关状态继续（→ 掷硬币） */
  startHotseat(banEnabled: boolean, randomPoolEnabled: boolean): void;
  /**
   * G5/T8：进入**联机大厅**（建房 / 加入 / 连接设置）—— 真正的联机入口。
   *
   * 大厅是**独立屏**（没有 `state`、不掷硬币、不进草稿页）：宿主把页面模式切成第四值
   * （`renderMode = 'lobby'`）之后直接画大厅。
   *
   * **这个入口（以及它的模式卡）排在原来的「预览」卡位置之前**（计划 §5 T8 的实现顺序约束，
   * D24 补）：`showModeSelect` 的 nav 键顺序与**源码里**的模式卡顺序「热坐 → 联机 → 单人 → 三人」
   * 一致，读代码时不用两头跳。2026-10-01 用户要求把「单视角预览（仅开发）」那个模式整个删掉
   * （入口、启动路径、死代码一起走）之后，nav 键顺序与模式卡顺序**逐项一致**了。
   */
  startNetLobby(): void;
}

/**
 * 游戏模式选择页。
 *
 * 玩家看到的模式卡恒为四张：热坐（双人）/ 联机对战（两台设备）/ 单人模式 / 三人模式
 * （单人、三人当前是「开发中」的占位卡，点了只弹 toast）。
 *
 * ⚠️ **2026-10-01（用户要求）**：这里原先还有第三张卡「单视角预览（仅开发）」，
 * 由第三个形参 `devUnlocked`（宿主的 `isDevUnlocked()`）当闸门。
 * 用户原话：「单视角预览这个模式可以直接删了，没有用，懂我意思吗」⇒ 卡、形参、
 * 宿主那条启动路径（`main.ts` 的 `startNetPreview`）与 devmode 的收回函数一并删除。
 * `renderMode === 'net'` 那条渲染路径**没删** —— 联机对局进牌桌后走的就是它（见 `main.ts`）。
 */
export function renderModeSelect(root: HTMLElement, nav: ModeSelectNav): void {
  clearRoot(root);
  const screen = el('div', 'mode-screen');
  screen.appendChild(el('h1', 'mode-title', t('mode.title')));

  const list = el('div', 'mode-list');
  const mkMode = (label: string, desc: string, enabled: boolean, onClick: () => void): HTMLElement => {
    const card = el('button', 'mode-card' + (enabled ? ' mode-card-on' : ''));
    card.setAttribute('type', 'button');
    const name = el('div', 'mode-card-name', label);
    const sub = el('div', 'mode-card-desc', desc);
    card.appendChild(name);
    card.appendChild(sub);
    card.addEventListener('click', onClick);
    return card;
  };
  list.appendChild(
    mkMode(t('mode.hotseat.name'), t('mode.hotseat.desc'), true, () => {
      nav.startHotseat(banBox.checked, randomBox.checked);
    })
  );
  // G5/T8：**真正的联机入口**（建房 / 加入 / 连接设置）。
  // 它排在原来的「单视角预览」卡位置**之前**（计划 §5 T8 的实现顺序约束，D24）——
  // 见 `ModeSelectNav.startNetLobby` 的说明。
  //
  // ★ **本卡的描述句里一个字的信令/隐私说明都没有**（修复轮改；评审 §4.2 判第一版这里违了
  //   §2 第 6 条）：第一版手写了"两台设备直连（P2P）。默认不向任何服务器发请求…"—— 那是
  //   **第二份**说明。现在只说**这个卡是干什么的**（界面标签），说明一律在大厅里**引用**唯一出处渲染。
  list.appendChild(
    mkMode(
      t('mode.online.name'),
      t('mode.online.desc'),
      true,
      () => {
        nav.startNetLobby();
      }
    )
  );
  list.appendChild(
    mkMode(t('mode.solo.name'), t('mode.solo.desc'), false, () => showToast(t('toast.solo')))
  );
  list.appendChild(
    mkMode(t('mode.trio.name'), t('mode.trio.desc'), false, () => showToast(t('toast.trio')))
  );
  screen.appendChild(list);

  /**
   * ★ 2026-09-30（用户要求，第二轮口径）：**只放一句"建议 65% 游玩"的提示**。
   *
   * 第一版我顺手做了"Ctrl + 滚轮改整页缩放"⇒ 用户实测特效错位，且原话是"我只是让你加个建议
   * 上去就可以了" ⇒ 那套实现整份撤掉（见 `PLAY_SIZE_HINT` 的说明）。这里只渲染这一句，
   * 不挂任何监听器；文案的唯一出处就是上面那个常量。
   */
  screen.appendChild(el('div', 'zoom-hint', t('mode.zoom-hint')));

  // 两个开关（默认关闭）+ 圆形问号帮助
  const toggles = el('div', 'mode-toggles');
  const mkToggle = (label: string, tip: string): { row: HTMLElement; box: HTMLInputElement } => {
    const row = el('label', 'mode-toggle');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'mode-check';
    const help = el('span', 'mode-help', '?');
    help.dataset.tip = tip;
    const text = el('span', 'mode-toggle-label', label);
    // 问号帮助图标在开关左侧（用户要求「模式选择按钮左边添加圆形问号」）
    row.appendChild(help);
    row.appendChild(box);
    row.appendChild(text);
    toggles.appendChild(row);
    return { row, box };
  };
  const banToggle = mkToggle(
    t('mode.ban'),
    t('mode.ban.tip')
  );
  const randomToggle = mkToggle(
    t('mode.random'),
    t('mode.random.tip')
  );
  const banBox = banToggle.box;
  const randomBox = randomToggle.box;
  screen.appendChild(toggles);

  const actions = el('div', 'mode-actions');
  /**
   * ★ 2026-09-29（用户："那就去掉它"）：原来这里还有一个「下一步：掷硬币定先手」按钮，
   * 它调的是与**热座卡**（上面那张 `热座（双人）`，见 `mkMode` 那一处）**同一个** `startHotseat`，
   * 也就是说它是个重复入口；而它排在整页最下面，看着像"对所有模式生效"，玩家会以为联机也走它。
   * ⇒ 去掉这个按钮：开局入口就是那张热座卡（它还带着上面两个开关的当前状态）。
   */
  actions.appendChild(button('btn', t('common.back-home'), nav.backHome));
  /**
   * G5/T41（用户 2026-09-27 第 1 条）：**设备体检** —— 模式选择页最下方的一个跳转按钮。
   *
   * 它与上面那些 `mode-card` 是**两回事**：不是游戏模式，点了不开局，只跳到同源静态页
   * `./probe.html`（源文件 `public/probe.html`，Vite 会把它拷进 `dist/probe.html`）。
   * 放在 `mode-actions` 这一区（与「返回主页面」同一行），因为它是"离开这一页"的动作之一，
   * 不占模式卡的位置；用的是既有 `btn` 类，**不动 styles.css**（红线）。
   */
  actions.appendChild(button('btn mode-probe-btn', t('mode.device-check'), nav.openDeviceCheck));
  screen.appendChild(actions);

  root.appendChild(screen);
}

/* =====================================================================
 * 掷硬币先手：玩家一选 正/反 → 掷币 → 掷胜者先选协议；后选协议者先出牌。
 * 币面资源：public/assets/coin/coin-1.jpg（素材 1344×560 的左半）、coin-2.jpg（右半）。
 * 「左=正面、右=反面」为位置假设 —— 待用户在 5173 目检确认真实正/反归属后可互换。 
 * ===================================================================== */
/**
 * 币面定义。
 *
 * ★ 2026-10-01（C）：**不再自带 `name`** —— 币面名是玩家可见文案，现在由 `coinFaceName()`
 * 从两张表取（`common.coin.heads` / `common.coin.tails`）。原来那个 `name: '正面'` 字段会
 * 绕开 i18n 直接进 `img.alt` 与按钮文案（正是"首页英文、里面还是中文"那一类漏网）。
 */
const COIN_FACES: ReadonlyArray<{ side: 1 | 2; src: string }> = [
  { side: 1, src: '/assets/coin/coin-1.jpg' },
  { side: 2, src: '/assets/coin/coin-2.jpg' },
];

/**
 * 币面名（`COIN_FACES` 的**唯一**取值口 —— 屏上几条文案都从它取，不各写一份 find）。
 *
 * ⚠️ 名字来自 `src/i18n/` 的两张表（键写成字面量，缺键扫描腿盯着）。
 */
function coinFaceName(side: CoinSide): string {
  return side === 1 ? t('common.coin.heads') : t('common.coin.tails');
}

/** 币面图（同上：`COIN_FACES` 的唯一取值口） */
function coinFaceSrc(side: CoinSide): string {
  return COIN_FACES.find((c) => c.side === side)!.src;
}

/**
 * 掷硬币屏。两条互不相同的路，按 `nav.net` 分派：
 *
 *  - **热座**（没有 `nav.net`）：玩家一选面 → 掷币动画 → 掷胜者先选协议（G0 起的既有行为，一字未改）；
 *  - **联机**（有 `nav.net`，G5 T11-B）：D27 把这块屏插在**握手中间** ——
 *    加入方按下「正面/反面」的那一刻就是它发 `commit-face` 的时刻，房主在同一块屏上等它。
 *    种子到手之前**不显示落点**（那正是"叫面早于公开种子"这条结构约束在屏上的样子）。
 *
 * 联机那一支**不读 `nav.seed`**（屏打开时它还不该有值）。
 */
export function renderCoin(root: HTMLElement, nav: CoinNav): void {
  clearRoot(root);
  if (nav.net !== undefined) renderCoinNet(root, nav, nav.net);
  else renderCoinHotseat(root, nav);
}

/**
 * 联机硬币屏上**抛硬币动画**的时长（毫秒）。**有界**，而且是**唯一**的一个数。
 *
 * ## 为什么是这个量级（1.62 秒）
 *
 *  - **下界**：抛硬币的观感要有"上抛 → 空中翻 → 落地回弹"三个阶段，各段至少能被看见
 *    （实测：低于 ~1.2s 时三段挤在一起，看起来只是"闪了一下"——而那正是用户说的
 *    "原来的完全就不是抛硬币"）；
 *  - **上界**：这段时长**每一局都花在进牌桌之前**（进对局的触发点是"动画播完"，
 *    见 `main.ts` 的 `coinSettleDeadline`），而真浏览器门（`tools/browser-truth-lobby-cdp.mjs`）
 *    在"点完芯片"到"两端进草稿"之间等的是 `--wait` 那个每步预算（收尾跑的是 30s）。
 *    1.62s 在这条预算里占比 5% 量级 —— 不是"贴着上限"，也不是"偷偷缩成 0"。
 *
 * 拆解：上抛 0.675s（到顶）+ 下落 0.270s（回到底）+ 回弹 0.075s + 二次下落 0.060s
 * + 落定 0.540s（原地定住给玩家看落点），合计 1620ms。
 */
export const COIN_TOSS_MS = 1_620;

/** 动画里"币面翻到侧面（转 90°）"那一刻在总时长里的比例（角度剖面里写死的 42%）。 */
const COIN_TOSS_APEX_RATIO = 0.42;

/**
 * 抛硬币动画的**角度与高度剖面**（两枚大币共用；`rotations` 由落点决定）。
 *
 * ## 剖面怎么来的（写下来，免得下一个人以为几个数是随手填的）
 *
 *  - **高度**（`translateY`，负值向上）：抛体的匀减速上升 + 匀加速下落。
 *    取"0.675s 到顶、顶点 160px"⇒ 初速 2*160/0.675 = 474px/s、加速度 2*160/0.675² = 702px/s²。
 *    按这两个数逐段取样（每 90ms 一个点），于是后半段**是真抛物线的样子**：
 *    落地那一格的间距明显大于顶点附近的间距（顶点处速度接近 0）。落地后 `-26px → 0px`
 *    是一次回弹（0.075s 到顶、0.06s 落回）。
 *  - **翻转**（`rotateX`）：t ∈ [0, 0.42] 从 0 匀加速到 90°（角加速度 ≈ 2*90/0.42² ≈ 1020 °/s²，
 *    与上抛同步"先慢后快"）；t ∈ [0.42, 0.925] 从 90° 匀减速到终点角度 —— 终点角度由
 *    **落点面**决定：正面 2 整圈 + 90° = 810°、反面 2.5 整圈 = 900°，两者都落在
 *    "该面朝前、且不倾斜"的姿态上（`rotateX(810deg)` 与 `rotateX(90deg)` 的朝向相同）。
 *  - t ∈ [0.925, 1] 角度不动（原地落定）。
 *
 * `easing: 'linear'` 写死：所有加减速都已经在关键帧的角度/位移里，再叠一条缓动只会让抛物线走形。
 *
 * @returns 关键帧：`transform` 里**同时**含 `translate3d`（高度）与 `rotateX`（角度）
 */
function coinTossFrames(rotations: number): Keyframe[] {
  const lunge = 2 * 160 / 0.675; // ≈ 474 px/s
  const gravity = 2 * 160 / (0.675 * 0.675); // ≈ 702 px/s²
  /** t（秒）时的高度：上抛段用匀减速、下落段用同一加速度往回走 */
  const yAt = (t: number): number => {
    const top = 0.675;
    if (t <= top) return -(lunge * t - (gravity * t * t) / 2);
    const d = t - top;
    return -Math.max(0, 160 - (gravity * d * d) / 2);
  };
  const angleAt = (t: number): number => {
    const a = 0.42;
    const b = 0.925;
    if (t <= a) return 90 * (t / a) * (t / a);
    if (t <= b) return 90 + (rotations * 360 - 90) * ((t - a) / (b - a));
    return rotations * 360;
  };
  /** 关键帧的 t 列表：0.42 与 0.925 是两个"折点"，必须各占一帧 */
  const stops = [
    0, 0.09, 0.18, 0.27, 0.36, 0.42, 0.51, 0.6, 0.69, 0.78, 0.87, 0.925,
    0.94, 0.965, 1,
  ];
  return stops.map((t) => {
    // 回弹那两帧单独给高度（抛物线与它无关：那是落地之后的事）
    const y = t <= 0.925 ? yAt(t) : (t <= 0.965 ? -26 : 0);
    // x 漂移：上抛时向右一点点，落地时回到起点附近（不是第二套物理，只是别让它直上直下）
    const x = t <= 0.42 ? 14 * (t / 0.42) : 14 * (1 - (t - 0.42) / 0.583);
    return {
      offset: t,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotateX(${angleAt(t).toFixed(2)}deg)`,
    };
  });
}

/**
 * 从剖面里取**单向成分**（某一枚元素只该收其中一样）。
 *
 * ## 为什么要拆（不拆就是两份位移/两份旋转）
 *
 * 高度与角度是同一条抛物线的两个投影，所以剖面函数**只有一份**（拆成两个函数会立刻出现
 * 两份会漂移的常量）。但同一份剖面不能同时挂到两枚元素上：`stage` 与 `disc` 是父子，
 * 两条动画的位移会叠加（币飞两倍高）、角度也会叠加（转两倍圈）。⇒ 挂之前各取自己那一半。
 */
function onlyTranslate(frame: Keyframe): Keyframe {
  return { offset: frame.offset, transform: `translate3d(${/translate3d\(([^)]*)\)/.exec(String(frame.transform))![1]}, 0)` };
}
function onlyRotate(frame: Keyframe): Keyframe {
  return { offset: frame.offset, transform: `rotateX(${/rotateX\(([-\d.]+)deg\)/.exec(String(frame.transform))![1]}deg)` };
}

/**
 * 播一次抛硬币动画（**只给联机分支**；热座那条路的交替闪现一个字没动）。
 *
 * ## 用 Web Animations API + transform 的理由（本仓的红线决定）
 *
 * `src/ui/styles.css` 是**红线文件**（本任务不许动），所以这里不新增任何 CSS 类与关键帧，
 * 一律走 `el.animate([...], {...})` 的内联 `transform`。位置上：`stage` 被抬起来时同一行的
 * 其它元素**不跟着动**（`transform` 不参与布局；`.coin-stage` 是 flex 项，位移只在绘制层）。
 *
 * ## 角色分工（两枚币面是两张图，不是一张图的两面）
 *
 *  - `stage` 收**竖直上抛 + x 漂移**（高度）；
 *  - `disc` 收**绕 x 轴翻转**（角度），并且 `perspective` 挂在它自己身上 ——
 *    这样旋转有透视，看起来像一枚硬币在翻，而不是一张纸片在压扁。
 */
function playCoinTossAnimation(
  disc: HTMLElement,
  stage: HTMLElement,
  landed: CoinSide,
  reduced: boolean,
): void {
  /**
   * ★ 2026-09-30（用户实测："有时硬币在动画播完后会消失"）：**圈数必须是整圈**。
   *
   * 老值 2.25 / 2.5 圈 ⇒ 终点角度 810° / 900°，即 `rotateX(90°)` / `rotateX(180°)`：
   * 前者是**侧着**（平面图侧对镜头 = 完全看不见！），后者是倒过来。上面那段注释里
   * "810° 与 90° 的朝向相同"这句话本身没错 —— 错在 90° 就是侧面。落点恰是正面那一档时，
   * 硬币就在动画结束后凭空消失（用户截图里结果行是"掷出 正面"，币正好不见了）。
   *
   * 现在统一 2 整圈（720° ≡ 0°）：币面朝前、不倾斜。两面的区别由"42% 那一下换图"承担
   * （那正是它存在的意义），不需要靠终点角度去表达。
   */
  const rotations = 2;
  const frames = coinTossFrames(rotations);
  const img = disc.querySelector('img');
  disc.style.transformOrigin = '50% 50%';
  disc.style.perspective = '700px';
  /**
   * ⚠️ **动画能力缺失 / 动态偏好要求少动时，只跳过动画本身，换图照做**。
   *
   * 三种环境会走到这一格：动态偏好（`prefers-reduced-motion: reduce`）、极老的浏览器
   * （`Element.animate` / `getAnimations` 是 2016 年前后的 API，本仓的浏览器基线远晚于它）、
   * 以及**单测的 DOM 桩**（`tests/ui/net-dom-stub.ts` 只实现元素树与选择器，没有 Web Animations）。
   * 少了这道守卫，宿主那边"落点已经到手"的帧会在这里抛异常 —— 而这一段的失败**不该**
   * 把硬币阶段卡死（它只负责好看）。
   *
   * ⚠️ `getAnimations` 单独查（评审登记：它比 `animate` 晚 48 个版本；只查前者会在那种环境抛）。
   */
  const canAnimate = !reduced
    && typeof disc.animate === 'function' && typeof stage.animate === 'function'
    && typeof disc.getAnimations === 'function' && typeof stage.getAnimations === 'function';
  if (canAnimate) {
    // 先取消上一轮（同一次转变只该有一条动画在跑；重连/重画不会留下第二条）
    disc.getAnimations().forEach((a) => { a.cancel(); });
    stage.getAnimations().forEach((a) => { a.cancel(); });
    const timing: KeyframeAnimationOptions = { duration: COIN_TOSS_MS, easing: 'linear', fill: 'forwards' };
    disc.animate(frames.map(onlyRotate), timing);
    stage.animate(frames.map(onlyTranslate), timing);
  }
  /**
   * ★ **换图的那一刻 = 币面转到侧面那一刻**（总时长的 42%，与剖面里那个折点同一个数）。
   *
   * 此刻币面与视线平行、图看不见 ⇒ 换成 `landed` 那一面是"翻过来之后是这一面"，
   * 而不是"图被换了一下"。停在侧面那一帧不写 `img.src` 会让玩家看到**叫的那一面**
   * 一直翻到落定 —— 那是错的（落点由读数决定，不由动画决定）。
   *
   * ⚠️ **不演动画时立刻换图**（没有"侧面那一刻"可言）：屏上定格到落点那一面是"结论正确"
   * 的一部分，而动画只是观感。
   */
  if (canAnimate) {
    window.setTimeout(() => {
      if (img !== null) img.src = coinFaceSrc(landed);
    }, Math.round(COIN_TOSS_MS * COIN_TOSS_APEX_RATIO));
    /**
     * ★ 2026-09-30（同上那个 bug 的第二道保险）：**播完把动画收掉**。
     *
     * `fill: 'forwards'` 会把最后一帧的 `transform` 一直保留 —— 万一将来又有人把终点角度
     * 改成半圈（90°/180°），币就会停在侧面或倒着的姿态上。收掉动画之后，币回到它自己的
     * 静态姿态（`rotateX(0)`，正面朝前），"停在看不见的角度"这件事从根上不可能再发生。
     * 收尾时机 = 总时长 + 30ms（比最后那一帧晚一点点）。
     */
    window.setTimeout(() => {
      disc.getAnimations().forEach((a) => { a.cancel(); });
      stage.getAnimations().forEach((a) => { a.cancel(); });
    }, COIN_TOSS_MS + 30);
  } else if (img !== null) {
    img.src = coinFaceSrc(landed);
  }
}

/**
 * 联机硬币屏（G5 T11-B）。
 *
 * 复用热座的**视觉件**（同一套 `coin-*` 类、同一张 `coin-face-chip` 芯片、同一份
 * `COIN_FACES`）—— 本仓不在大厅里画第二套正/反按钮（任务书 §2）。差别只有三处：
 *  1. 标题与说明说清"由加入方选面、另一方等"（热座那句「玩家一掷硬币决定先后手」在联机下不成立）；
 *  2. 没有「掷硬币」按钮：落点由种子派生，而种子要等叫面之后才到手；
 *  3. 等待方芯片禁用、且**没有**落点读数。
 *
 * ★★ **G5 T19：这块屏现在真的抛硬币**（用户："原来的完全就不是抛硬币"）。三格按
 * `net.coinPhase` 切开（**由 app 的相位决定，不按落点反推** —— 第一版反过来推，结果
 * `'call'` 那一格就在播动画、"告知停留"从不发生，评审实测的阻断项）：
 *
 *  1. **`'call'`**：芯片选中叫出去的那一面，状态行说"玩家 N 叫了「某面」"，**不播动画**；
 *  2. **`'toss'`**：`playCoinTossAnimation` 演上抛+翻转+回弹，状态行仍只说"谁叫了哪一面"
 *     （**不**提前给结论）；
 *  3. **`'settled'`**：`coin-result-text` 给出落点与先选协议者 —— 到这一步硬币阶段才结束，
 *     `main.ts` 那边还要让这一格停够才进牌桌。
 *
 * ⚠️ 这里**不进牌桌**：进牌桌的触发点在 `src/main.ts`。
 */
function renderCoinNet(root: HTMLElement, nav: CoinNav, net: CoinNetView): void {
  const screen = el('div', 'coin-screen');
  screen.setAttribute('data-coin-net', net.role);
  /**
   * ★ 诊断读数（T11-B）：硬币屏上**没有**大厅那条「会话相位：…」行（`.net-lobby-phase`），
   * 于是 CDP 门在这一屏上读不到"握手走到哪一格"。把相位挂在属性上（不占屏、不改文案、
   * 不参与任何判定），一次 `getAttribute` 就能读到 —— 与 `net-lobby` 的 `data-hello-diag`
   * 同一套做法。
   */
  screen.setAttribute('data-net-phase', net.phase ?? '');
  /**
   * ★★ **G5 T19 修复轮：把"这一帧画哪一格"也挂成属性**（`data-coin-stage`）。
   *
   * 理由与 `data-net-phase` 同一族：真浏览器门在硬币屏上读不到"三段走到哪一格"时，
   * "没有结果行"与"结果行已经过去"分不开。属性不占屏、不参与任何判定。
   */
  screen.setAttribute('data-coin-stage', net.coinPhase ?? '');
  screen.appendChild(button('btn coin-back-btn', t('common.back-mode'), nav.backHome));

  const isCaller = net.role === 'caller';
  /**
   * ★★ **这一帧在哪一格**（缺省 = `'settled'`：那是"重画一帧落定屏"的调用点与既有单测的口径）。
   *
   * ⚠️ **不许从 `landed` 反推**：落点一到手就说明"可以演动画了"，但"什么时候开始演"是
   * **app 的相位**说了算（`'call'` 那一格要先把"谁叫了哪一面"说完）。
   */
  const phase: 'call' | 'toss' | 'settled' = net.coinPhase ?? 'settled';
  const tossing = phase === 'toss';
  const settled = phase === 'settled';
  const reduced = net.reducedMotion === true;
  /**
   * ★ **叫面者是谁**（"谁叫了哪一面"那句话的座位口径）。
   *
   * 它取自 `net.caller` —— 与结论行里那句"玩家 N 先选协议"用的是**同一个数**
   * （`callerSeat()`，两端一致），屏上不自己猜"叫面的总是加入方"。
   */
  const callerSeat = net.caller;
  /** 叫出去的那一面：叫面方读自己的、等待方读对端揭示进来的（`net.chosen` 由 app 给） */
  const chosenFace = net.chosen;
  /** "谁叫了哪一面"整句（读数为空时是 `null` ⇒ 这一格不出现这句话） */
  const callLine: string | null = chosenFace === null
    ? null
    : t('coin.net.called', { n: String(callerSeat + 1), face: coinFaceName(chosenFace) });
  // ★ 标题必须说清"由加入方选面"（热座那句「玩家一掷硬币决定先后手」在联机下不成立）
  screen.appendChild(el('h1', 'coin-title', isCaller ? t('coin.net.title.caller') : t('coin.net.title.waiter')));
  screen.appendChild(
    el(
      'p',
      'coin-rule',
      isCaller ? t('coin.net.rule.caller') : t('coin.net.rule.waiter')
    )
  );
  /**
   * 状态行挂在 `coin-rule-2`（既有类，橙字）—— 联机路不写第二套样式。
   *
   * ★★ **G5 T19：这一行是"告知叫了哪一面"那一格**（用户要求的第一步）。三格各说什么：
   *  - `'call'`：**只说**"玩家 N 叫了「某面」"（不播动画、不说落点）；
   *  - `'toss'`：同一句 + "正在抛硬币…"；
   *  - `'settled'`：落点与先选协议者交给下面的结论行说（这一行只说"掷出 X。"）。
   */
  screen.appendChild(
    el(
      'p',
      'coin-rule coin-rule-2',
      settled && net.landed !== null
        ? t('coin.net.landed', { face: coinFaceName(net.landed) })
        : callLine !== null
          ? (tossing ? t('coin.net.tossing', { call: callLine }) : t('coin.net.await-toss', { call: callLine }))
          : isCaller
            ? t('coin.net.pick')
            : t('coin.net.waiting')
    )
  );

  // 大币展示：联机路不掷币，只按当前读数定格（落点还没到手时先停在叫出去的那一面、再退到正面）
  const stage = el('div', 'coin-stage');
  const disc = el('div', 'coin-disc-big');
  const img = document.createElement('img');
  const shown: CoinSide = net.landed ?? net.chosen ?? 1;
  img.src = coinFaceSrc(shown);
  img.alt = coinFaceName(shown);
  disc.appendChild(img);
  if (settled && net.landed !== null) disc.classList.add('settled');
  stage.appendChild(disc);
  screen.appendChild(stage);
  /**
   * ★★ **抛硬币那一格：动画在这里起**（`phase === 'toss'` 才算）。
   *
   * 起点的币面就是"叫出去的那一面"（上面 `shown` 取的 `net.chosen`）—— 于是玩家看到的是
   * "我把这一面朝上扔出去、翻过来落到另一面"，而不是"图被换了一下"。
   * 换图的那一刻是转到侧面那一下（见 `playCoinTossAnimation`）。
   */
  if (tossing && net.landed !== null) playCoinTossAnimation(disc, stage, net.landed, reduced);

  // 芯片：叫面方点得动，等待方禁用（任务书 §5 的接口：`role === 'waiter'` ⇒ 芯片禁用）
  const pickRow = el('div', 'coin-pick-row');
  const chips = new Map<CoinSide, HTMLButtonElement>();
  /**
   * ★★ **G6/T50（收尾项）：这一次点击**必须留下可读结果**（旧行为是静默 `return`）。
   *
   * 旧处理器只有一句 `if (!isCaller || net.landed !== null) return;` —— 两个条件都不满足时
   * 点下去**屏上什么都不变**（不选中、不说一句话）。真浏览器里"禁用态要等下一次整帧重画才生效"
   * （`main.ts:363` 那段注释自己写了这件事）⇒ 存在"点了没反应、而且看起来还能点"的窗口。
   * 现在：能叫面才叫；叫不了就在 `coin-rule-2` 那一行**说清为什么**（那是屏上原有的状态行，
   * 不新增元素、不改任何判定读的那几行）。
   */
  const statusLine = screen.querySelector('.coin-rule-2');
  const sayWhyNot = (text: string): void => {
    if (statusLine !== null) statusLine.textContent = text;
  };
  /**
   * ★★ **G6/T50（收尾项）：落点已经到手 ⇒ 芯片**置为不可点**（看得见的那一层）。
   *
   * 旧行为是"按钮还亮着、点下去静默 `return`"。落点到手意味着这一格已经进到 `'settled'`
   * （结论行在下面写着"掷出 X。"），置灰之后玩家不会再点第二个；而"`disabled` 要等下一次
   * 整帧重画才生效"的那段窗口由下面 ② 的说明文字兜住。
   */
  const landedAlready = net.landed !== null;
  COIN_FACES.forEach((face) => {
    const chip = el('button', 'coin-face-chip', coinFaceName(face.side)) as HTMLButtonElement;
    chip.type = 'button';
    chip.disabled = !isCaller || landedAlready;
    // 叫出去的那一面在落点之前就选中（玩家点完立刻看得到自己叫了什么）
    if (net.chosen === face.side) chip.classList.add('selected');
    chip.addEventListener('click', () => {
      // ① 不是叫面的一方（等待方）：芯片本来就禁用，这里再兜一层并说明
      if (!isCaller) {
        sayWhyNot(t('coin.net.other-calls'));
        return;
      }
      // ② 落点已经到手 ⇒ 叫面这件事已经发生过，再点不许改（相位机那边也已经走过去了）
      //    ⚠️ 这一格**不动**状态行：它此刻写的是"掷出 X。"（结论行在下面），抹掉它是更坏的不实陈述
      if (net.landed !== null) return;
      /**
       * ③ 同一条链路上**已经叫过一次**（`main.ts` 的 `faceChosen`）⇒ 第二次点击落不到任何地方。
       *
       * 为什么把它说出来（而不是像旧代码那样静默）：一局只认一条 `commit-face`，重复点击的
       * resolve 无处可去；而"第二次点击发生在第一次还没被对端确认的那一段"在真浏览器里是
       * 会发生的（禁用态要等重画）。不说的话，玩家看到的就是"我明明点了，屏上没反应"。
       */
      if (net.chosen !== null) {
        sayWhyNot(t('coin.net.already-called', { face: coinFaceName(net.chosen) }));
        return;
      }
      // 立刻把"我按了哪一面"画出来（下一次整帧重画之前也要看得见）
      for (const [side, other] of chips) other.classList.toggle('selected', side === face.side);
      net.choose(face.side);
    });
    chips.set(face.side, chip);
    pickRow.appendChild(chip);
  });
  screen.appendChild(pickRow);

  /**
   * ★★ **结论行只在 `'settled'` 那一格出现**。
   *
   * 这一句是用户要的顺序里**最后一格**（"然后显示最终的结果，这个硬币阶段就结束了"）。
   * 它出现之后**不许**在同一帧被草稿屏盖掉：`main.ts` 那边给这一格留了
   * `COIN_SETTLED_HOLD_MS`（1200ms）—— 屏这一层只负责画，停留由相位机计时。
   * ⚠️ 它**不许**提前出现：真浏览器门（`tools/browser-truth-lobby-cdp.mjs` ③.5）用
   * `MutationObserver` 抓"`coin-result-text` 第一次出现的那一对读数"，而它抓到的那一条
   * 就是它判"文案里的座位号 == 读数里的 winner + 1"的依据 —— 提前写一句没有座位号的
   * 中间态会当场把那条判据打红。
   */
  if (settled && net.landed !== null && net.winner !== null) {
    const landed: CoinSide = net.landed;
    /**
     * ★ **芯片的高亮跟着"叫出去的那一面"，不跟着落点**（T11-B 真浏览器实测纠正）。
     *
     * 原先这里写的是 `toggle('selected', side === landed)` ⇒ 叫面方的屏上高亮的是**落点**
     * 那一枚 —— 于是屏上看着"叫中了"、结果文案却是"叫错了"。**叫面方自己叫的那一面**
     * 才是这一枚芯片该显示的，而它在上面按 `net.chosen` 已经画好了（落点由下面那句文案说清）。
     */
    /**
     * ★ 胜负规则与热座**同一条**（`draftStarterFor`），由 app 算好交下来。
     *
     * ⚠️ 屏上**不再自己比较** `landed === chosen`：那个比较把"叫出去的那一面"当成胜负依据的
     * 第二个来源，而两端在"面到手的先后"上不同（房主先有种子、加入方先有自己的面）
     * ⇒ 同一局会在两端定格出**两个相反**的读数（真浏览器门实测：房主"玩家 2 先选协议"、
     * 加入方"玩家 1 先选协议"）。`net.winner === null` 就是"依据还没齐、不许定格"。
     */
    const winner: PlayerId = net.winner;
    const result = el('div', 'coin-result');
    result.appendChild(
      el(
        'div',
        'coin-result-text',
        t('coin.result', {
          call: callLine !== null ? t('coin.result.call-prefix', { call: callLine }) : '',
          face: coinFaceName(landed),
          n: String(winner + 1),
          m: String(2 - winner),
        })
      )
    );
    /**
     * ★ **全局座位编号**：`玩家 N` = 座位 `N - 1`（本仓既有约定；`winner` 与 `caller` 都是座位）。
     * 屏上这句话就是"座位号 + 1"，没有第二套编号 —— 两端因此说的是同一件事。
     */
    screen.appendChild(result);
  }

  root.appendChild(screen);
}

/** 热座掷硬币屏（G0 起的既有行为；联机分支只借用它的视觉件，不改这里一个值）。 */
function renderCoinHotseat(root: HTMLElement, nav: CoinNav): void {
  const screen = el('div', 'coin-screen');
  // 返回按钮：左上角（回到游戏模式选择）
  screen.appendChild(button('btn coin-back-btn', t('common.back-mode'), nav.backHome));
  screen.appendChild(el('h1', 'coin-title', t('coin.title'))); // 修改提示词 7：标题文案
  screen.appendChild(
    el(
      'p',
      'coin-rule',
      t('coin.rule')
    )
  );
  screen.appendChild(el('p', 'coin-rule coin-rule-2', t('coin.second')));
  /**
   * ★ 种子是热座那条路的**必填**读数：缺了它是用法错误（联机分支不走这里）。
   * 不给"拿空串当种子"的静默降级 —— 那会让硬币结果变成一条与调用方无关的常量。
   */
  if (nav.seed === undefined) {
    throw new Error('renderCoin：热座这条路必须给 nav.seed（联机那条路要写 nav.net 分支）。');
  }
  const seed = nav.seed;

  let chosen: 1 | 2 | null = null;
  let flipping = false;
  let flipTimer: number | null = null;

  // 大币展示：掷币时在两枚币面间交替闪现，速度渐慢直至停在某一面
  const stage = el('div', 'coin-stage');
  const disc = el('div', 'coin-disc-big');
  const img = document.createElement('img');
  img.src = COIN_FACES[0].src;
  img.alt = coinFaceName(COIN_FACES[0].side);
  disc.appendChild(img);
  stage.appendChild(disc);
  screen.appendChild(stage);

  // 选择正/反面（chip 选择）
  const pickRow = el('div', 'coin-pick-row');
  const pickEls: HTMLElement[] = [];
  COIN_FACES.forEach((face) => {
    const chip = el('button', 'coin-face-chip', coinFaceName(face.side));
    (chip as HTMLButtonElement).type = 'button';
    chip.addEventListener('click', () => {
      if (flipping) return;
      chosen = face.side;
      for (const pe of pickEls) pe.classList.toggle('selected', pe === chip);
      img.src = face.src; // 预演玩家所选的那一面
    });
    pickEls.push(chip);
    pickRow.appendChild(chip);
  });
  screen.appendChild(pickRow);

  const result = el('div', 'coin-result');
  result.style.display = 'none';
  screen.appendChild(result);

  const actions = el('div', 'coin-actions');
  const flipBtn = button('btn coin-flip-btn', t('coin.toss'), () => {
    if (flipping) return;
    if (chosen === null) {
      showToast(t('coin.need-pick'));
      return;
    }
    flipping = true;
    flipBtn.disabled = true;
    for (const pe of pickEls) (pe as HTMLButtonElement).disabled = true;
    // G0：硬币结果由种子派生（原来是 Math.random）—— 动画只是把已确定的结果演出来
    // G5 T11-A：落点式与胜负规则**都搬去 `src/app/coin.ts`**（只搬家、不改值）；
    //   联机那条路要算同一件事，规则不能再长在屏上这一份里。
    const landed: 1 | 2 = coinLanding(seed);
    const winner: PlayerId = draftStarterFor(0, chosen, seed);
    /**
     * ★ 2026-09-30（用户要求）：热座改用**联机那套抛硬币动画**。
     *
     * 老做法是"两枚币面交替闪现、间隔逐次拉长"（那段代码的注释里也写着"热座那条路的交替闪现
     * 一个字没动"）；联机那边 T19 已经换成真·上抛 + 绕 x 轴翻转 + 回弹（`playCoinTossAnimation`）。
     * 现在两边**共用同一个函数、同一个时长** `COIN_TOSS_MS` ⇒ 观感一致，而且这只有一个实现。
     *
     * 收尾与老那条**一字不差**：结果行 + 「开始对局」按钮，落点仍由 `nav.seed` 派生。
     * 动态偏好（`prefers-reduced-motion`）与"没有动画能力"的环境由那个函数自己兜住（换图照做）。
     */
    playCoinTossAnimation(disc, stage, landed, nav.reducedMotion === true);
    flipTimer = window.setTimeout(() => {
      flipping = false;
      disc.classList.add('settled');
      img.src = COIN_FACES.find((c) => c.side === landed)!.src;
      const faceName = coinFaceName(landed);
      result.style.display = '';
      result.textContent = '';
      result.appendChild(
        el(
          'div',
          'coin-result-text',
          // ⚠️ 热座这条路上**没有**"谁叫了哪一面"那一截（叫面是联机才有的步骤）⇒ `call` 传空串。
          //    2026-10-02 实测的占位符回归：这里原来一个参数都没传 `call`，而键的值以 `{call}` 开头
          //    ⇒ 屏上写着 `{call}掷出 正面 —— …`（中英都坏）。空串正是改动前那句的字面形态。
          t('coin.result', { call: '', face: faceName, n: String(winner + 1), m: String(2 - winner) })
        )
      );
      result.appendChild(button('btn coin-begin-btn', t('coin.begin'), () => nav.beginGame(winner)));
    }, COIN_TOSS_MS);
  });
  actions.appendChild(flipBtn);
  screen.appendChild(actions);
  root.appendChild(screen);
}

/* =====================================================================
 * ★ 2026-10-01（用户要求）：**设置改成浮在上面的小窗**（原来是单独一整屏）。
 *
 * 用户原话：「我希望设置页面只需要使用小窗即可，而不是目前这样单独放一个页面出来」。
 * ⇒ 屏上不再有"设置页"这回事：`openSettings` 只是把下面这个遮罩挂到 `document.body`，
 * 关掉之后原来的首页**原样还在**（本函数一不调 `clearRoot`、二不碰 `#app`，所以不存在
 * "进设置页再返回首页"那套重画）。
 *
 * ## 与既有浮层同款
 *
 * `openRulePages()`（`document.body` 级遮罩 + 关闭按钮 + 点遮罩关闭）与 `.changelog-*`
 * （一个 `Element`，谁用谁挂）两种做法在本仓都有。这里取**两者之间**：函数只**造**元素
 * （同 `changelogElement()`，可单测、不依赖某个宿主），**挂到 `document.body`** 由宿主的
 * `openSettings` 接缝做（同 `openRulePages()` 的那种 body 级遮罩）；Esc 与"焦点还给入口按钮"
 * 同样在宿主那一侧接（它们读的是 `document` 级的东西，放这里会让这个构造器不再纯粹）。
 *
 * ## 样式
 *
 * 红线 `styles.css` 一行不动；新版式全部落在 `styles-local.css` 的 `settings-*` 类上
 * （那几个名字在 5 张既有 CSS 里零命中，照 `changelog-*` 那次的做法）。开关控件复用既有的
 * `.mode-toggle` / `.mode-check` / `.mode-toggle-label`，与模式选择页那两个开关同款。
 *
 * ## 功能与 2026-09-30 那版**一字不差**
 *
 * 条目仍只来自 `FX_SETTINGS`，开关仍只写 `src/ui/fx-settings.ts` 的内存态（消费点仍只有
 * `render.ts` 的 `syncMetal6Mans`）；唯一的差别：勾选后不再整屏重画，改成**就地写状态**
 * （`box.checked` 就是刚翻过的值，另外把那一行的说明改成"当前：开启 / 关闭"，玩家能一眼看见）。
 *
 * ## 怎么关（三条，缺一不可）
 *
 * 右上角「关闭」按钮 / 点遮罩空白处 / 按 Esc —— 三条都走 `onClose`，由宿主统一收尾
 * （`main.ts` 的 `openSettings`：移除节点 + 撤掉 keydown 监听 + 焦点还给入口按钮）。
 *
 * ## ★ 2026-10-01（P0）：语言项 —— 本屏是 i18n 的第一个真实消费者
 *
 * 用户拍板"UI 全量双语"（方案 `docs/2026-10-01-新手引导与教学-方案.md` §6.5），P0 只抽这一屏。
 * 两条口径：
 *
 *  1. **中文值与改动前的字面量逐字一致**（值在 `src/i18n/zh.ts`）—— 既有测试逐字钉住
 *     `关闭` / `改动只在本次会话有效…`，P0 不许让它们变红。
 *  2. **切了就立即生效**：`setLang()` 换内存态之后，本屏用 `applyLang()` 把**自己**的每一条
 *     文案就地改写一遍（不重画整屏 —— 那会丢掉玩家正在看的滚动位置与焦点），再调
 *     `nav.onLangChange()` 让宿主落盘并重画它背后的那一屏（`src/main.ts` 的 `rerender()` 接缝）。
 *     ⇒ "立即生效"有两半：小窗自己这一半在这里，宿主那一半在 `main.ts`。
 *
 * 语言值**不由本函数读写存储**：它只拿 `nav.lang`（当前值）与 `nav.onLangChange`（切换动作），
 * 于是本函数仍然可以在无 jsdom 的 node 下用桩真跑（与它原来"只造元素"的纪律一致）。
 * ===================================================================== */
export interface SettingsOverlayNav {
  readonly onClose: () => void;
  /**
   * 当前界面语言。**必填**：缺了它小窗就只能瞎猜默认语言，而"猜错"的形态是
   * 一位英文玩家打开设置看到中文标题 —— 那正是这一步要修的东西。
   */
  readonly lang: Lang;
  /**
   * 用户选了另一种语言。**由宿主负责**：写进本机设置（`src/app/local-store.ts` 的 `writeLang`）
   * + 重画当前屏（`src/main.ts` 的 `rerender()` 接缝）。
   * 本函数在调它**之前**已经把 `setLang()` 的内存态换好、并把自己的文案改写完了。
   *
   * 返回**写盘结论**（三态不许折叠，与「本地数据与隐私」屏那几条同款）：
   *  - `{ ok: true }`：真的落盘了；
   *  - `{ ok: false, reason, detail }`：**写不进去** ⇒ 本屏在小窗里如实写一句
   *    "本次会话生效、刷新回旧语言 + 真因"，绝不假装保存成功。
   *    ★ 2026-10-01（线上验收 D3）：`reason` / `detail` 是**结构化**的（不是一句写死的中文兜底）
   *    ⇒ 提示文案走 `saveFailedText()`（本地化）并原样带上真因（例如字节数）。
   *  - 宿主抛错也当失败处理（本函数兜 `try/catch`，不让切语言把小窗炸掉）。
   */
  readonly onLangChange: (lang: Lang) => LangChangeOutcome;
  /**
   * 用户拨动了某一个**特效开关**（`id` = `FxSettingDef.id`）。
   *
   * ★ 2026-10-01（用户要求"设置里的选项也要持久化"）：与 `onLangChange` **同一套形状与语义**
   * ——宿主负责落盘（`src/app/local-store.ts` 的 `writeFxSettings`，与昵称/语言同一条路）+
   * 需要时重画；本函数在调它**之前**已经把内存态换好（`setFxSetting`）并把说明就地改写了。
   *
   * 返回值同样是 `LangChangeOutcome`（成功 / 没保存上 + 结构化原因）⇒ 失败时的提示复用
   * `saveFailedText()`，**不新造第二套文案**。
   */
  readonly onFxChange: (id: string, on: boolean) => LangChangeOutcome;
}

/**
 * 宿主对小窗那一次"切语言"的回话（**用户可见的两态**：成功 / 没保存上）。
 *
 * ⚠️ 写成**命名类型**（不是就地在签名里写 `{ … }`）：就地在返回类型标注里写字面量会让
 * `tests/ui/source-text.ts` 的 `functionBody` 把它当成函数体起点（那是它写明的已知局限），
 * 而 `settingsOverlayElement` 的判据面正靠 `functionBody` 抽。
 *
 * ★ 2026-10-01（线上验收 D3）：载荷是**结构化的**（`reason` + 可选的数值/系统消息），
 * **不是**拼好的句子。整句由 `saveFailedText()` 按当前语言拼 —— 两种语言下都不夹另一种语言的字。
 */
export type LangChangeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: WriteFailure['reason']; readonly detail?: string }
  | { readonly ok: false; readonly reason: 'too-large'; readonly bytes: number; readonly limit: number };

/** 小窗那一次切换的**成功**回话（唯一一处字面量，宿主与测试都引用它，免得各写各的） */
export const LANG_CHANGE_OK: LangChangeOutcome = { ok: true };

/**
 * 存储层写盘失败的**结构形状**（与 `src/app/storage.ts` 的 `WriteResult` 失败分支同形）。
 *
 * 刻意写成**本地结构类型**（不 import 那一层）：`src/ui/**` 不需要认识存储，
 * 而这里只要那两个变体的字段形状 —— 与"`src/i18n` 不认识存储"同一口径。
 * 漂移在编译期就会报（`applyWriteResult` 的实参就是真的 `WriteResult`）。
 */
type StorageWriteFailure =
  | { readonly ok: false; readonly reason: 'too-large'; readonly bytes: number; readonly limit: number }
  | { readonly ok: false; readonly reason: 'write-failed'; readonly detail: string };

/** 存储层写盘结论的形状（成功 + 两种失败）——只用来给 `applyWriteResult` 的实参定型 */
type StorageWriteResult = { readonly ok: true } | StorageWriteFailure;

/**
 * ★ 2026-10-01（P0 线上验收 D3）：把写盘结论翻成小窗要的那个形状 ——
 * **全局唯一的"结果 → 回话"映射处**。
 *
 * ## 为什么它住在这里（而不是 `src/main.ts`）
 *
 * 第一版把这段逻辑内联在 `main.ts` 的 `applyLangChange` 里，于是"原因/数值有没有被带出去"
 * 这件事**在 node 下没有任何腿碰得到**：`applyLangChange` 要 `#app` 与整棵渲染状态机，而
 * `src/main.ts` 在**模块级**就执行 `document.getElementById('app')!` ⇒ 测试根本 import 不了它。
 * 变异实测：把 `reason` 丢掉、把 `detail` 换成写死一句，整套测试**全绿**。
 * ⇒ 挪到这个能在 node 下真跑的模块里，`tests/i18n/settings-overlay.test.ts` 直接喂真的
 *   `WriteResult` 进去断言。
 *
 * ## 两个来源，各自的形状
 *
 *  - **存储层**（`writeLang` 的返回值）：`ok` / `too-large`（两个**数**）/ `write-failed`
 *    （系统消息）⇒ **原样转交**（载荷已经是结构化的，没有可折叠的东西）；
 *  - **宿主没料到地抛了**：那一路不经过这里，走同文件导出的 `langChangeThrew()`。
 */
export function applyWriteResult(w: StorageWriteResult): LangChangeOutcome {
  return w.ok ? LANG_CHANGE_OK : w;
}

/**
 * 宿主没料到地抛了（`writeLang` 自己抛，例如 `kv.get` 抛）⇒ 那一次切换的回话。
 *
 * 原因归成 `'threw'`（不是 `write-failed`）：两者的**原因句**一样（后端没写成功），
 * 但测试与排查要能分辨"后端拒绝"与"宿主抛了"。`detail` 是异常消息本身（系统串，可能是英文）。
 *
 * 与 `LANG_CHANGE_OK` 一样是**唯一构造点**：`src/main.ts` 的 catch 分支与测试都用它，
 * 免得两边各写一份字面量（那正是 D3 修过的病）。
 */
export function langChangeThrew(message: string): LangChangeOutcome {
  return { ok: false, reason: 'threw', detail: message };
}

export function settingsOverlayElement(nav: SettingsOverlayNav): HTMLElement {
  const overlay = el('div', 'settings-overlay');
  const dialog = el('div', 'settings-panel');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const head = el('div', 'settings-head');
  const title = el('div', 'settings-title', t('settings.title'));
  head.appendChild(title);
  const close = button('btn settings-close', t('settings.close'), () => { nav.onClose(); });
  head.appendChild(close);
  dialog.appendChild(head);

  /**
   * 当前语言（本函数内**唯一**的语言真相）。初值取 `nav.lang`，切换时改写它 ——
   * 不直接读 `getLang()` 是为了让"宿主给小窗的值"与"小窗用的值"是同一个可见的输入，
   * 而不是一个没写在签名里的隐式依赖。
   */
  let lang: Lang = nav.lang;

  /**
   * 特效开关那一项的**说明文案**（未勾选时的原文）。
   *
   * ⚠️ 这里用 `def.id === 'metal6-strobe'` 的三元把**两个键都写成字面量**，而不是
   * `t(def.desc)` 传一个变量：缺键扫描腿（`tests/i18n/tables.test.ts`）按**静态第一实参**
   * 提取键 —— 传变量等于那个键从判据面里消失，"漏翻"就重新变成静默的。
   * 那条腿是 P3 逐屏抽取期间唯一的机械保障，所以这里为它让一步；新增特效项时照这个形状
   * 加一个分支即可（两个键都要进两张表）。
   */
  const fxDescText = (id: string): string =>
    id === 'metal6-strobe' ? t('settings.fx.metal6.desc') : id;

  /** 特效开关那一项的**标题**（同上：键写成字面量） */
  const fxLabelText = (id: string): string =>
    id === 'metal6-strobe' ? t('settings.fx.metal6.label') : id;

  /**
   * 开关那一行的说明文案。
   *
   * ⚠️ `touched` 这一档是**刻意的行为细节**，不是多余的分支：**没动过**的开关只显示说明原文
   * （"（当前：开启）"那句只在玩家真的勾过一次之后才出现）。既有腿逐字钉着这个形态 ——
   * `tests/ui/local-data-screen.test.ts` 第 9 组断言"勾一次之后 = `原说明（当前：关闭）`"，
   * 若渲染期就先把状态缀上去，那句就变成"缀了两遍"。判据没错，所以这里按它来。
   */
  const fxNoteText = (id: string, on: boolean, touched: boolean): string => {
    const label = fxDescText(id);
    if (!touched) return label;
    const state = on ? t('settings.fx.on') : t('settings.fx.off');
    return t('settings.fx.state', { desc: label, state });
  };

  /* ── ① 语言（P0 新增的那一项） ── */
  const langRow = el('div', 'settings-lang-row');
  const langLabel = el('div', 'mode-toggle-label', t('settings.lang'));
  langRow.appendChild(langLabel);
  const langBtns = el('div', 'settings-lang-btns');
  /**
   * 语言按钮的文案取 `LANGS` 的 `label`（`中文` / `English`）—— 那是"语言清单的唯一出处"
   * （`src/i18n/lang.ts`），**刻意不放进文案表**：选项名是给"看不懂当前语言的人"看的，
   * 它不该跟着当前语言变（否则切到英文后中文选项会写成 "Chinese"，中文玩家就找不回来了）。
   */
  const langBtnEls: { readonly id: Lang; readonly btn: HTMLButtonElement }[] = [];
  /**
   * 写盘失败时的**就地提示行**（空 = 不占屏）。
   *
   * 为什么提示在小窗里、而不是跳去别的屏或弹一个 `window.confirm`（那在 DOM 桩下测不了）：
   * 玩家切语言失败时人就在这里，提示必须出现在他正在看的那一屏上。文案是**报告**形态
   * （"失败""本次会话"），不是隐私承诺句 —— 见 `tests/ui/privacy-consumers.test.ts` 的分层判据。
   */
  const langStatus = el('div', 'settings-lang-status');
  langStatus.dataset.role = 'lang-status';
  for (const def of LANGS) {
    const b = button('btn settings-lang-btn', def.label, () => {
      if (def.id === lang) return; // 点当前语言 = 什么都不做（不落盘、不重画）
      lang = def.id;
      // ① 先换内存态（`t()` 从下一句起就是新语言）；② 再就地改写本屏；③ 最后交给宿主落盘 + 重画。
      setLang(def.id);
      langStatus.textContent = ''; // 先清掉上一次失败的提示（这一次还没结论）
      applyLang();
      let out: LangChangeOutcome;
      try {
        out = nav.onLangChange(def.id);
      } catch (e) {
        // 宿主抛错也走"写失败"那一档：原因 `'threw'` + 异常消息（系统串）。
        // 措辞仍由 `saveFailedText()` 按语言给 —— 这里只构造**数据**，不碰文案。
        out = { ok: false, reason: 'threw', detail: e instanceof Error ? e.message : String(e) };
      }
      if (!out.ok) {
        // ⚠️ 不走 `t('…')` 字面量而走 `saveFailedText()`：那一句要按**原因**给措辞并带上真因，
        //    映射只许有一处（`src/i18n/index.ts`）。缺键扫描腿认的是"静态第一实参"，
        //    所以那两个键在 `saveFailedText` 里是以字面量出现的（同一处集中，不是散开）。
        langStatus.textContent = saveFailedText(out);
      }
    });
    b.dataset.lang = def.id;
    langBtnEls.push({ id: def.id, btn: b });
    langBtns.appendChild(b);
  }
  langRow.appendChild(langBtns);
  /**
   * ⚠️ 类名是 `.settings-lang-hint` 而**不是** `.settings-note`：既有那条腿
   * （`tests/ui/local-data-screen.test.ts` 第 9 组）用 `oneClass(overlay, 'settings-note')`
   * 定位"特效开关那一行的说明"并要求**树里唯一** —— 语言这一行再挂一个 `.settings-note`
   * 会把那个唯一性判据打红。判据与它的对象都没错，错的是这里复用了一个已经被"唯一性"钉住的类名；
   * 版式在 `styles-local.css` 里与 `.settings-note` 写成同一套声明。
   */
  const langHint = el('div', 'settings-lang-hint', t('settings.lang.hint'));
  langRow.appendChild(langHint);
  langRow.appendChild(langStatus);
  dialog.appendChild(langRow);

  const list = el('div', 'settings-list');
  /** 特效开关那一行：`note` / `label` 要留着在语言切换时就地改写，所以每行登记一份 */
  const fxRows: {
    readonly def: (typeof FX_SETTINGS)[number];
    readonly note: HTMLElement;
    readonly label: HTMLElement;
    readonly box: HTMLInputElement;
    /** 玩家勾过至少一次吗（见 `fxNoteText` 的说明：没勾过不显示"当前："那句） */
    touched: boolean;
  }[] = [];
  for (const def of FX_SETTINGS) {
    const row = el('label', 'mode-toggle');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'mode-check';
    box.checked = isFxSettingOn(def.id);
    box.dataset.fxSetting = def.id;
    // 开关说明（每行一条）：勾选后就地改写它，把当前状态写在屏上（不重画整屏）
    const entry = {
      def,
      note: el('div', 'settings-note', ''),
      label: el('span', 'mode-toggle-label', fxLabelText(def.id)),
      box,
      touched: false,
    };
    entry.note.textContent = fxNoteText(def.id, box.checked, entry.touched);
    /**
     * ★ 2026-10-01（用户要求"设置里的选项也要持久化"）：**勾了就走宿主落盘**，
     * 与语言那条路完全同构 —— 本函数不碰存储（它只造元素），只在失败时把话写在屏上。
     *
     * 三种情形照旧分开说（与语言那一项同一套 `saveFailedText`）：
     *  - `{ ok: true }`：真落盘了 ⇒ 清掉提示位；
     *  - `{ ok: false, … }`：本次会话仍然生效（内存态已经改了），但刷新会回到上次保存的 ⇒ 如实提示；
     *  - 宿主抛错也当失败（本函数兜 `try/catch`，不让一个开关把小窗炸掉）。
     */
    box.addEventListener('change', () => {
      entry.touched = true;
      entry.note.textContent = fxNoteText(def.id, box.checked, entry.touched);
      langStatus.textContent = ''; // 先清掉上一次的提示（这一次还没结论）
      let out: LangChangeOutcome;
      try {
        out = nav.onFxChange(def.id, box.checked);
      } catch (e) {
        out = langChangeThrew(e instanceof Error ? e.message : String(e));
      }
      if (!out.ok) langStatus.textContent = saveFailedSwitchText(out);
    });
    row.appendChild(box);
    row.appendChild(entry.label);
    list.appendChild(row);
    list.appendChild(entry.note);
    fxRows.push(entry);
  }
  dialog.appendChild(list);
  const hint = el('div', 'settings-hint', t('settings.hint'));
  dialog.appendChild(hint);
  overlay.appendChild(dialog);

  /**
   * 把本屏的**每一条文案**按当前语言重写一遍（就地改写，不重画整屏）。
   *
   * ⚠️ 这里是"新增一条文案就补一行"的地方：漏了哪一条，切语言之后它就停在旧语言上 ——
   * 而屏上其它条目都变了，这种"半张屏"最难被发现。`tests/i18n/settings-overlay.test.ts`
   * 有一条腿在两种语言下各跑一次并逐条比对，漏改的那一条会当场红。
   */
  function applyLang(): void {
    title.textContent = t('settings.title');
    // aria-label 是读屏玩家听到的东西，不是装饰：它也要跟着语言走
    dialog.setAttribute('aria-label', t('settings.aria'));
    close.textContent = t('settings.close');
    langLabel.textContent = t('settings.lang');
    langHint.textContent = t('settings.lang.hint');
    for (const { id, btn } of langBtnEls) {
      // 当前语言那一枚标出来（视觉上由 `.settings-lang-btn.on` 承担，属性是给测试与读屏的）
      const active = id === getLang();
      btn.classList.toggle('on', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
    for (const { def, note, label, box, touched } of fxRows) {
      note.textContent = fxNoteText(def.id, box.checked, touched);
      label.textContent = fxLabelText(def.id);
    }
    hint.textContent = t('settings.hint');
  }
  applyLang();

  // 点遮罩空白处关闭（点小窗内部不关：`e.target` 只会在**遮罩本身**上等于 overlay）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) nav.onClose();
  });
  return overlay;
}

/* =====================================================================
 * 图鉴：查看协议及其所属卡牌。右侧固定大展示框：鼠标悬停协议/卡牌 → 自动展示；
 * 点击仍走 openZoom 放大详情。右下角（右列展示框之后）是按效果分类的筛选面板（G5 T24）。
 * ===================================================================== */
export function renderLibrary(root: HTMLElement, back: () => void): void {
  clearRoot(root);
  const screen = el('div', 'library-screen');
  const head = el('div', 'subpage-head');
  head.appendChild(el('h1', 'subpage-title', t('library.title')));
  head.appendChild(
    el('div', 'subpage-sub', t('library.sub', { n: String(DEMO_PROTOCOLS.length) }))
  );
  head.appendChild(button('btn', t('common.back-home'), back));
  screen.appendChild(head);

  // 按代筛选（2026-09-06 用户需求：同协议选择页的世代 chips）
  const LIB_GROUP_LABELS: ReadonlyArray<readonly [string, string]> = [
    ['MN01', t('gen.1.base')], ['AX01', t('gen.1.extra')], ['MN02', t('gen.2.base')], ['AX02', t('gen.2.extra')],
    ['MN03', t('gen.3.base')], ['AX03', t('gen.3.extra')],
  ];
  const libEnabled = new Set(LIB_GROUP_LABELS.map(([g]) => g));
  const filter = el('div', 'lib-filter');
  const refreshChips = (): void => {
    for (const chip of Array.from(filter.querySelectorAll('button'))) {
      const g = chip.dataset.group!;
      const on = libEnabled.has(g);
      chip.classList.toggle('on', on);
      chip.title = t('gen.count-suffix', {
        name: String(chip.textContent ?? ''),
        n: String(DEMO_PROTOCOLS.filter((p) => p.set === g).length),
        action: on ? t('gen.hide') : t('gen.show'),
      });
    }
  };
  for (const [group, label] of LIB_GROUP_LABELS) {
    const chip = el('button', 'draft-filter-chip on', label);
    chip.setAttribute('type', 'button');
    chip.dataset.group = group;
    chip.addEventListener('click', () => {
      if (libEnabled.has(group)) libEnabled.delete(group);
      else libEnabled.add(group);
      refreshChips();
      refreshList();
    });
    filter.appendChild(chip);
  }

  const layout = el('div', 'library-layout');

  // 右侧大展示框（sticky 跟随滚动）：图 + 中文文本并排（2026-09 卡牌中文效果）
  const preview = el('aside', 'library-preview');
  const pMain = el('div', 'library-preview-main');
  const pImg = document.createElement('img');
  pImg.className = 'library-preview-img';
  pImg.alt = '';
  const pText = el('div', 'library-preview-text');
  pText.style.display = 'none';
  pMain.appendChild(pImg);
  pMain.appendChild(pText);
  const pHint = el('div', 'library-preview-hint', t('library.preview-hint'));
  const pCap = el('div', 'library-preview-cap');
  preview.appendChild(pMain);
  preview.appendChild(pCap);
  preview.appendChild(pHint);
  // —— 图鉴点击固定 / 悬浮查看机制（与草稿页同款）——
  // 单一展示框（图鉴无玩家侧）：hover 即时预览；点击固定（hover 不再覆盖）；
  // 点其它条目切换固定；再点同一固定条目取消固定（回到 hover 自由预览）。
  // key：'proto:<defId>:<0|1>'（协议 loading/compiled）| 'card:<defId>'（指令卡）
  let libPinnedKey: string | null = null;

  const showPreview = (
    src: string,
    caption: string,
    mode: 'portrait' | 'landscape' | 'natural',
    text?: HTMLElement | null,
  ): void => {
    // 协议图：1/2代 竖版存 rotate(-90) 横置展示（landscape）；3代 横向成品直放（natural）；卡牌：竖置
    pImg.className = 'library-preview-img ' + mode;
    pImg.src = src;
    pImg.alt = caption;
    pCap.textContent = caption;
    pImg.style.display = 'block';
    pHint.style.display = 'none';
    pCap.style.display = '';
    pText.textContent = '';
    if (text) {
      pText.appendChild(text);
      pText.style.display = '';
    } else {
      pText.style.display = 'none';
    }
  };
  const clearPreview = (): void => {
    pImg.style.display = 'none';
    pHint.style.display = '';
    pCap.style.display = 'none';
  };
  /** 按 key 渲染条目到展示框（协议 → 图+详情面板；卡牌 → 图+中文文本） */
  const previewEntry = (key: string): void => {
    if (key.startsWith('proto:')) {
      const [, defId, compiledS] = key.split(':');
      const compiled = compiledS === '1';
      const proto = DEMO_PROTOCOLS.find((p) => p.defId === defId);
      if (!proto) return;
      const motto = `${proto.name} · ${proto.loadingText}`;
      showPreview(
        protocolImgSrc(defId, compiled),
        compiled ? t('library.compiled', { name: motto }) : motto,
        'landscape',
        buildProtocolRatingPanel(defId)
      );
      return;
    }
    const defId = key.slice('card:'.length);
    const c = DEMO_CARD_DEFS.find((x) => x.defId === defId);
    if (!c) return;
    const proto = DEMO_PROTOCOLS.find((p) => p.defId === c.protocol);
    showPreview(
      cardImgSrc(c.protocol, c.value),
      t('library.card-caption', { protocol: proto?.name ?? c.protocol, n: String(c.value) }),
      'portrait',
      buildCardTextEl(cardTextParts(c), 'library-preview-text')
    );
  };
  /** hover 即时预览：本框未固定时才生效（固定内容不被打扰） */
  const hoverEntry = (key: string): void => {
    if (libPinnedKey === null) previewEntry(key);
  };
  /**
   * 单击给"看得见的反馈"的那条路的**开关**：触摸能力（任一条成立）
   * **且** 可见视口宽度 <= `TAP_ZOOM_MAX_W`。
   *
   *  - 触摸能力：`(pointer: coarse)` / `(any-pointer: coarse)` / `maxTouchPoints > 0` /
   *    `(hover: none)` —— 与 `phone-landscape.ts:328` 的手机判据同族，但**没有**"短边 <= 500"
   *    那一条（这里判的是"窄屏/触摸"，不是"手机"：触摸平板的展示框同样在折线之下）；
   *  - 宽度用 `window.visualViewport.width`（**不是** `innerWidth`）：手机横屏 844×390 实测
   *    `innerWidth 1516` 而 `visualViewport 844`，用 `innerWidth` 会把它判成宽屏；
   *  - 两条都不成立（= 桌面鼠标 + 宽视口）⇒ 走原路 `togglePin`，与改前逐字相同。
   */
  const TAP_ZOOM_MAX_W = 1100;
  const needsTapZoom = (): boolean => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(any-pointer: coarse)').matches
      || (navigator.maxTouchPoints ?? 0) > 0
      || window.matchMedia('(hover: none)').matches;
    const vv = window.visualViewport;
    const w = vv !== null && vv.width > 0 ? vv.width : window.innerWidth;
    return coarse && w <= TAP_ZOOM_MAX_W;
  };
  /** 键 → "放大浮层"那条路（与双击同一个 thunk）。`buildList()` 每次重画都会重填一次。 */
  const zoomPath = new Map<string, () => void>();
  /** 单击固定：同 key 再点 = 取消固定（回 hover）；点其它 key = 切换固定目标 */
  const togglePin = (key: string): void => {
    /**
     * ★★ G6/T51（用户 2026-09-28 口径的第 ② 条）：**窄屏 / 触摸视口下，单击直接开放大浮层**。
     *
     * 为什么（T48 实测）：产品这条路是 `bindClickOrDouble`（`render.ts:6002`）——单击=把条目
     * 固定到右侧展示框、双击=开 `.zoom-overlay`。可**窄屏（<= 1100px）下展示框是普通流里的
     * 静态盒**、排在整张列表**之后**：844×390 实测单击之后展示框确实被填上了，但它在
     * **折线下方 18938px**（`previewDocTop 19338 / vh 390`，T48 报的 `pxBelowFold 18967`
     * 是同一件事的另一种取法）⇒ 手指点一下屏幕什么都不动，观感就是"点了没反应"。
     * 桌面宽视口（1280×800 实测 `docTop 126`、hover 与单击固定在屏上）⇒ **那一档一个字节都不改**。
     *
     * 「窄」的判据见 `needsTapZoom()`：触摸能力 + **可见**视口宽度 <= 1100px 两条同时成立。
     * 放大浮层与双击走的是**同一个 thunk**（三个入口各在 `zoomPath` 里注册一次，见下面三处
     * `zoomPath.set(...)`）—— 不新造第二条详情路，关掉的方式（点空白 / Esc）也沿用既有那套。
     */
    if (needsTapZoom()) {
      const zoom = zoomPath.get(key);
      if (zoom !== undefined) { zoom(); return; }
    }
    if (libPinnedKey === key) {
      libPinnedKey = null;
      clearPreview();
      return;
    }
    libPinnedKey = key;
    previewEntry(key);
  };
  // 列表占主列，展示框与效果筛选面板占右列（DOM 顺序 = 网格列序：先列表，后右列两块）
  const list = el('div', 'library-list');
  layout.appendChild(list);
  layout.appendChild(preview);

  /* ── 图鉴右下角「按效果分类筛选」面板（G5 T24，用户 2026-09-21 的第 2 点）────────────
   * 位置：`.library-layout` 右列里、展示框**之后**的空白处（DOM 顺序第四个子节点，
   * 网格自动落到第二列下一行；`styles-library-filter.css` 只负责观感与分组排版）。
   *
   * 口径（与 `src/app/library-filter.ts` 一一对应，这里一个字都不重算）：
   *  - 标签来自生成物 `src/data/cardEffectTags.ts`（构建期由效果代码算出，不是文本关键词现算）；
   *  - **默认全部勾选**；点一下切换勾 / 不勾；
   *  - 卡牌命中任一勾中的标签 ⇒ 连同它所属协议显示；一条都不命中 ⇒ 不显示；
   *  - 某协议所有卡都被排除 ⇒ 连它的 `.lib-group` 框一起不建（不是"隐藏样式"）。
   * 另给两个"全选 / 全不选"按钮（任务书 §5 的可选项，做了就写进报告）。
   */
  const libCheckedTags = new Set<string>(LIB_ALL_TAG_IDS);
  const effectPanel = el('div', 'lib-effect-panel');
  effectPanel.appendChild(el('div', 'lib-effect-title', t('library.filter')));
  const effectHint = (): void => {
    const r = filterLibrary(libFilterState());
    effectPanelHint.textContent = r.visibleCards.size === 0 && libEnabled.size === 0
      ? t('library.count-none', { total: String(r.totalCards) })
      : t('library.count', {
        checked: String(libCheckedTags.size),
        all: String(LIB_ALL_TAG_IDS.length),
        hit: String(r.visibleCards.size),
        total: String(r.totalCards),
      });
  };
  const effectPanelHint = el('div', 'lib-effect-hint');
  // 读数行要挂进面板才看得见（它原来只被写 textContent、没入树 ⇒ 面板上没有"已勾 N / 命中 M 张"）
  effectPanel.appendChild(effectPanelHint);
  const effectPanelActions = el('div', 'lib-effect-actions');
  const effectCheckboxes = new Map<string, HTMLInputElement>();
  const refreshEffectPanel = (): void => {
    for (const [id, box] of effectCheckboxes) {
      box.checked = libCheckedTags.has(id);
      box.parentElement?.classList.toggle('lib-effect-tag-on', box.checked);
    }
    effectHint();
  };
  const setAllTags = (onto: boolean): void => {
    libCheckedTags.clear();
    if (onto) for (const id of LIB_ALL_TAG_IDS) libCheckedTags.add(id);
    refreshEffectPanel();
    refreshList();
  };
  effectPanelActions.appendChild(button('lib-effect-btn lib-effect-all', t('library.all'), () => setAllTags(true)));
  effectPanelActions.appendChild(button('lib-effect-btn lib-effect-none', t('library.none'), () => setAllTags(false)));
  effectPanel.appendChild(effectPanelActions);
  for (const { group, tags } of LIB_TAG_GROUPS) {
    const groupBox = el('div', 'lib-effect-group');
    groupBox.appendChild(el('div', 'lib-effect-group-name', group));
    const tagList = el('div', 'lib-effect-tags');
    for (const tag of tags) {
      const row = el('label', 'lib-effect-tag');
      row.dataset.tagId = tag.id; // 测试与排查按标签 id 寻址（不读文案）
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'lib-effect-box';
      box.checked = true; // 默认全部勾选
      row.classList.toggle('lib-effect-tag-on', true);
      box.addEventListener('change', () => {
        // 浏览器会把 checked 翻好再派发 change；以控件读数为准（不自己再 toggle 一次）
        if (box.checked) libCheckedTags.add(tag.id);
        else libCheckedTags.delete(tag.id);
        refreshEffectPanel();
        refreshList();
      });
      row.appendChild(box);
      row.appendChild(el('span', 'lib-effect-label', tag.label));
      effectCheckboxes.set(tag.id, box);
      tagList.appendChild(row);
    }
    groupBox.appendChild(tagList);
    effectPanel.appendChild(groupBox);
  }

  screen.appendChild(filter); // 世代筛选条在 head 之后（先于 layout 挂载，勿用 insertBefore 前置）

  /** 协议封面小图（loading/compiled 通用）：竖版存储 + CSS rotate(-90) 横置（三代同规格） */
  function protoFaceImg(defId: string, compiled: boolean, wrap: HTMLElement): HTMLImageElement {
    const img = document.createElement('img');
    img.className = 'lib-proto-img';
    img.src = protocolImgSrc(defId, compiled);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    wrap.appendChild(img);
    return img;
  }

  /** 这一刻的筛选读数：世代 chips + 效果标签勾选，交给纯层的 `filterLibrary` 算 */
  const libFilterState = () => ({
    protocols: DEMO_PROTOCOLS.map((p) => ({ defId: p.defId, set: p.set })),
    cards: DEMO_CARD_DEFS.map((c) => ({ defId: c.defId, protocol: c.protocol, value: c.value })),
    enabledSets: libEnabled as ReadonlySet<string>,
    checkedTags: libCheckedTags as ReadonlySet<string>,
  });

  const buildList = (): void => {
    const r = filterLibrary(libFilterState());
    list.textContent = '';
    if (r.visibleProtocols.size === 0) {
      list.appendChild(el('div', 'lib-effect-empty', t('library.empty')));
      return;
    }
    for (const proto of DEMO_PROTOCOLS) {
      if (!r.visibleProtocols.has(proto.defId)) continue; // 协议全被排除 ⇒ 这一组连框都不建
      const motto = `${proto.name} · ${proto.loadingText}`; // 座右铭（去「X代 基础/拓展」代号）
      const group = el('div', 'lib-group');
      const headRow = el('div', 'lib-proto');

      // 未编译（loading）封面
      const face = el('div', 'lib-proto-img-wrap');
      protoFaceImg(proto.defId, false, face);
      const faceKey = `proto:${proto.defId}:0`;
      face.addEventListener('mouseenter', () => hoverEntry(faceKey));
      // 窄屏/触摸那条路要用的放大 thunk（与下面双击传的是同一个）—— 见 `needsTapZoom()`
      zoomPath.set(faceKey, () => openZoom(proto.defId, true, true, false));
      bindClickOrDouble(
        face,
        () => togglePin(faceKey),
        () => openZoom(proto.defId, true, true, false),
        false
      );
      headRow.appendChild(face);

      // 已编译封面槽（协议右边，2026-09-06 用户需求）
      const faceC = el('div', 'lib-proto-img-wrap lib-face-compiled');
      protoFaceImg(proto.defId, true, faceC);
      const faceCKey = `proto:${proto.defId}:1`;
      faceC.addEventListener('mouseenter', () => hoverEntry(faceCKey));
      zoomPath.set(faceCKey, () => openZoom(proto.defId, true, true, true));
      bindClickOrDouble(
        faceC,
        () => togglePin(faceCKey),
        () => openZoom(proto.defId, true, true, true),
        false
      );
      headRow.appendChild(faceC);

      const meta = el('div', 'lib-proto-meta');
      meta.appendChild(el('div', 'lib-proto-name', motto));
      meta.appendChild(el('div', 'lib-proto-commands', proto.commands.join(' · ')));
      headRow.appendChild(meta);
      group.appendChild(headRow);

      const row = el('div', 'lib-cards');
      for (const c of DEMO_CARD_DEFS.filter((x) => x.protocol === proto.defId)) {
        if (!r.visibleCards.has(c.defId)) continue; // 这张卡一条都不命中 ⇒ 不画它
        const cell = el('div', 'lib-card');
        const cimg = document.createElement('img');
        cimg.src = cardImgSrc(proto.defId, c.value);
        cimg.alt = t('library.card-alt', { protocol: proto.name, n: String(c.value) });
        cimg.loading = 'lazy';
        cimg.decoding = 'async';
        cimg.title = t('library.card-caption', { protocol: proto.name, n: String(c.value) });
        cell.appendChild(cimg);
        cell.appendChild(el('div', 'lib-card-value', String(c.value)));
        const cardKey = `card:${c.defId}`;
        cell.addEventListener('mouseenter', () => hoverEntry(cardKey));
        zoomPath.set(cardKey, () => openZoom(c.defId, true, false, false));
        bindClickOrDouble(
          cell,
          () => togglePin(cardKey),
          () => openZoom(c.defId, true, false, false),
          false
        );
        row.appendChild(cell);
      }
      group.appendChild(row);
      list.appendChild(group);
    }
  };

  /** 列表重建 + 面板读数刷新（世代 chips 与效果标签两条路都走它） */
  function refreshList(): void {
    buildList();
    refreshEffectPanel();
  }
  refreshList();
  refreshChips();
  // hover 内容保留（移出列表不清空——可移到右侧展示框细读）；更新由 hover 新条目 /
  // 点击固定 / 再点取消固定驱动（与草稿页同款机制）
  screen.appendChild(layout);
  // 效果筛选面板排在右列展示框之后（右下角那块空白；DOM 顺序即网格落位）
  layout.appendChild(effectPanel);
  root.appendChild(screen);
}
/* =====================================================================
 * 规则图纸：1/2/3 代说明书 + FAQ（public/assets/rules PDF；iframe 查看 + 新标签打开）
 * ===================================================================== */
interface RuleDoc {
  file: string;
  title: string;
  desc: string;
  /**
   * ★ 2026-09-30：这本规则书**有几页页图**（`public/assets/rules/pages/<base>/page-NN.jpg`）。
   *
   * 它与 `tests/ui/rules-pages.test.ts` 逐页比对（数量 + 两位零填充的文件名）—— PDF 换了、
   * 页图没重转，会当场变红，不会让玩家看到"少一页"或者"第四页开始是上一本的图"。
   */
  pages: number;
}

/** 页图的目录名 = PDF 文件名去掉 `.pdf`；这条映射只在这里写一次（渲染与测试都照它） */
export function rulePageDir(file: string): string {
  return file.replace(/\.pdf$/, '');
}

/**
 * 规则书清单（顺序即屏上顺序）。
 *
 * ★ 2026-10-01（C）：`title` / `desc` 改成**文案键**（不再直接是中文），屏上由 `t()` 取 ——
 * 与 `FX_SETTINGS` 把中文留在字段里的做法不同，理由：这两条**只在渲染时用**，
 * 而键就在 `renderRules` / `openRulePages` 里以**字面量**出现（缺键扫描腿认的是调用点的字面量）。
 */
export const RULES: readonly RuleDoc[] = [
  { file: 'rule-mn01.pdf', title: 'rules.gen1', desc: 'rules.gen1.sub', pages: 2 },
  { file: 'rule-mn02.pdf', title: 'rules.gen2', desc: 'rules.gen2.sub', pages: 2 },
  { file: 'rule-mn03.pdf', title: 'rules.gen3', desc: 'rules.gen3.sub', pages: 2 },
  { file: 'rule-mn03-solo.pdf', title: 'rules.gen3.solo', desc: 'rules.gen3.solo.sub', pages: 2 },
  { file: 'rule-faq.pdf', title: 'rules.faq', desc: 'rules.faq.sub', pages: 12 },
];

/**
 * 规则书的标题 / 说明（键 → 当前语言的文案）。
 *
 * ⚠️ 与 `fxLabelText()` 同一条纪律：**键必须写成字面量**（不能用 `t(doc.title)` 那种变量），
 * 否则缺键扫描腿就看不到它们（本文件里 `t(...)` 的键都在下面的三元里静态写着）。
 * 新增一本规则书：先往 `RULES` 加一行，再在这个三元里补一个分支（两张表都要有那对键）。
 */
function ruleTitleText(doc: RuleDoc): string {
  switch (doc.title) {
    case 'rules.gen1': return t('rules.gen1');
    case 'rules.gen2': return t('rules.gen2');
    case 'rules.gen3': return t('rules.gen3');
    case 'rules.gen3.solo': return t('rules.gen3.solo');
    case 'rules.faq': return t('rules.faq');
    default: return doc.title;
  }
}

function ruleDescText(doc: RuleDoc): string {
  switch (doc.desc) {
    case 'rules.gen1.sub': return t('rules.gen1.sub');
    case 'rules.gen2.sub': return t('rules.gen2.sub');
    case 'rules.gen3.sub': return t('rules.gen3.sub');
    case 'rules.gen3.solo.sub': return t('rules.gen3.solo.sub');
    case 'rules.faq.sub': return t('rules.faq.sub');
    default: return doc.desc;
  }
}

export function renderRules(root: HTMLElement, back: () => void): void {
  clearRoot(root);
  const screen = el('div', 'rules-screen');
  const head = el('div', 'subpage-head');
  head.appendChild(el('h1', 'subpage-title', t('rules.title')));
  head.appendChild(el('div', 'subpage-sub', t('rules.sub')));
  head.appendChild(button('btn', t('common.back-home'), back));
  screen.appendChild(head);

  const grid = el('div', 'rules-grid');
  for (const doc of RULES) {
    const item = el('div', 'rules-item');
    const cover = document.createElement('img');
    cover.className = 'rules-cover';
    cover.src = `/assets/rules/covers/${doc.file.replace('.pdf', '.jpg')}`;
    cover.alt = ruleTitleText(doc);
    cover.loading = 'lazy';
    const info = el('div', 'rules-info');
    info.appendChild(el('div', 'rules-title', ruleTitleText(doc)));
    info.appendChild(el('div', 'rules-desc', ruleDescText(doc)));
    item.appendChild(cover);
    item.appendChild(info);
    item.addEventListener('click', () => openRulePages(doc));
    grid.appendChild(item);
  }
  screen.appendChild(grid);
  root.appendChild(screen);
}

/**
 * ★ 2026-09-30（用户要求）：点规则书**按页显示图片**，不再内嵌 PDF。
 *
 * 为什么改：内嵌 `<iframe src="*.pdf">` 在别人那台设备上会变成"下载一个 PDF"（用户实测：
 * "别人点击规则书查看后是下PDF"），手机浏览器里更常见——iframe 里的 PDF 直接触发下载，
 * 内容根本看不到。现在按页显示图片（每本已用 `pdftoppm` 转好：150dpi / jpeg，
 * 放在 `public/assets/rules/pages/<base>/page-NN.jpg`），原版 PDF 留成一个显式按钮。
 *
 * 遮罩与顶栏复用既有的 `.pdf-overlay` / `.pdf-bar` / `.pdf-title`（红线 `styles.css` 里的
 * 那三条规则本来就是给这块屏用的），只给页图加两条新类（见 `styles-local.css`）。
 */
function openRulePages(doc: RuleDoc): void {
  const dir = rulePageDir(doc.file);
  const title = ruleTitleText(doc);
  const overlay = el('div', 'pdf-overlay');
  const bar = el('div', 'pdf-bar');
  bar.appendChild(el('div', 'pdf-title', t('rules.pages-title', { title, pages: String(doc.pages) })));
  bar.appendChild(button('btn', t('rules.pdf'), () => window.open(`/assets/rules/${doc.file}`, '_blank')));
  bar.appendChild(button('btn', t('common.close'), () => overlay.remove()));
  overlay.appendChild(bar);

  const body = el('div', 'rules-pages');
  for (let i = 1; i <= doc.pages; i += 1) {
    const img = document.createElement('img');
    img.className = 'rules-page';
    img.src = `/assets/rules/pages/${dir}/page-${String(i).padStart(2, '0')}.jpg`;
    img.alt = t('rules.page-alt', { title, n: String(i) });
    img.loading = i <= 2 ? 'eager' : 'lazy'; // 头两页先到，后面的滚到再拉
    body.appendChild(img);
  }
  overlay.appendChild(body);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
