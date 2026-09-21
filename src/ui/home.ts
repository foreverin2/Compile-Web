import type { PlayerId } from '../core/models/types';
// G5 T11-A：硬币落点、胜负规则、面映射的**唯一出处**（联机那条路也算同一件事）
import { coinLanding, draftStarterFor } from '../app/coin';
import type { CoinSide } from '../app/coin';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, protocolImgSrc, cardImgSrc, cardTextParts } from '../data/demo';
import { LIB_TAG_GROUPS, LIB_ALL_TAG_IDS, filterLibrary } from '../app/library-filter';
import { openZoom, buildCardTextEl, buildProtocolRatingPanel, bindClickOrDouble } from './render';

/**
 * 主界面/掷硬币/图鉴/规则图纸 —— 非对局屏（main.ts 导航）。
 *
 * - renderHome：真正的主页面（2026-09-03 用户需求）：菜单按钮 + 全部已编译卡面
 *   背景大平面（两向对角巡回动画）+ 页脚署名。45 套（1+2+3代，2026-09-06）。
 * - renderCoin：掷硬币先手机制（玩家一选正/反 → 掷币；掷胜者先选协议，后选协议者
 *   先出牌——main 以 createGame({ draftStarter: 胜者, firstToPlay: 1-胜者 }) 开局）。
 * - renderLibrary：查看全部协议及其所属卡牌（分组行 + 点卡放大；复用 render.openZoom）。
 * - renderRules：查看 1/2/3 代说明书与 FAQ（public/assets/rules PDF + iframe 查看）。
 */
export interface HomeNav {
  /** 开始游戏 → 游戏模式选择页（2026-09-03：热坐/单人/三人 + 禁用/随机池开关） */
  startGame(): void;
  openLibrary(): void;
  openRules(): void;
  /** G3：本地数据与隐私（授权状态、清除本机数据、档案导入导出入口） */
  openLocalData(): void;
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

const SET_LABEL: Record<string, string> = {
  MN01: '1代 基础', AX01: '1代 拓展', MN02: '2代 基础', AX02: '2代 拓展',
  MN03: '3代 基础', AX03: '3代 拓展',
};
void SET_LABEL; // 图鉴改显示座右铭后不再直接使用（保留作 chip/调试标签源）

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

/** 清空根容器（各屏互斥）；解绑主页背景 resize 重建并退出「整屏主页」模式 */
function clearRoot(root: HTMLElement): void {
  liveBgHost = null;
  root.textContent = '';
  root.classList.remove('draft-exit', 'board-enter', 'no-anim', 'screen-home');
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
let bgResizeTimer: number | null = null;

/** 主页背景容器 */
function buildHomeBg(): HTMLElement {
  const bg = el('div', 'home-bg');
  bg.setAttribute('aria-hidden', 'true');
  fillBg(bg);
  bg.appendChild(el('div', 'home-bg-vignette'));
  return bg;
}

function registerBgResize(bg: HTMLElement): void {
  liveBgHost = bg;
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

  const bg = buildHomeBg();
  registerBgResize(bg);
  screen.appendChild(bg);

  const menu = el('div', 'home-menu');
  menu.appendChild(el('div', 'home-logo', 'Compile'));
  menu.appendChild(el('div', 'home-sub', '译世界 · 非官方网页粉丝版'));
  const btns = el('div', 'home-menu-buttons');
  btns.appendChild(button('btn home-btn home-btn-primary', '开始游戏', nav.startGame));
  btns.appendChild(button('btn home-btn', '查看协议及其所属卡牌', nav.openLibrary));
  btns.appendChild(button('btn home-btn', '新手教程', () => showToast('新手教程：待开发')));
  btns.appendChild(button('btn home-btn', '查看一/二/三代规则图纸', nav.openRules));
  // G3（Task 4）：本地数据与隐私入口 —— 授权状态、清除本机数据、档案导入导出（Task 7 落地屏）
  btns.appendChild(button('btn home-btn', '本地数据与隐私', nav.openLocalData));
  menu.appendChild(btns);
  screen.appendChild(menu);

  screen.appendChild(
    el(
      'footer',
      'home-footer',
      'Compile 桌游由原作者 MICHAEL YANG 创作 · 本网页版由「我吃吃吃吃」作为非官方粉丝开发'
    )
  );

  root.appendChild(screen);
}

/* =====================================================================
 * 游戏模式选择页（2026-09-03）：热坐（双人，可玩）/ 单人 / 三人（开发中）；
 * 两个默认关闭的开关：禁用模式（开局按规则禁用协议）、随机池模式（随机抽 12 套）；
 * 开关左侧带圆形「?」帮助图标（hover 显示说明）。两种模式下草稿页世代筛选仍可用。
 * ===================================================================== */
export interface ModeSelectNav {
  backHome(): void;
  /** 玩家选定「热坐」并携带两个开关状态继续（→ 掷硬币） */
  startHotseat(banEnabled: boolean, randomPoolEnabled: boolean): void;
  /**
   * G5/T8：进入**联机大厅**（建房 / 加入 / 连接设置）—— 真正的联机入口。
   *
   * 与 `startNetPreview` 的**唯一区别**：大厅是**独立屏**（没有 `state`、不掷硬币、不进草稿页），
   * 宿主把页面模式切成第四值（`renderMode = 'lobby'`）之后直接画大厅。
   *
   * ⚠️ **这个入口（以及它的模式卡）必须排在 `startNetPreview` 之前**（计划 §5 T8 的实现顺序
   * 约束，D24 补）：`tests/ui/net-preview-wiring.test.ts:210-213` 用
   * `mode.slice(mode.indexOf('startNetPreview:'))` 切出"预览那一段"，再在那一段里断言
   * `renderMode = 'net'` 与 `netViewSeat = viewSeat`。新入口若排在它**之后**，那段切片会被拉长到
   * 含新入口 ⇒ 断言可能被新入口里的字符串满足 —— 它仍然绿，但**测的已经不是原来那件事**（失焦）。
   */
  startNetLobby(): void;
  /**
   * G2 Task 4：进入**远程对战页单视角预览**（本地、零联机）—— G2 视觉验收用。
   *
   * 与 `startHotseat` 的**唯一区别**是宿主会把页面模式切成远程页（`renderMode = 'net'`）；
   * 流程本身完全沿用热座（掷硬币 → 草稿页 → 过渡 → 对战阶段）。
   *
   * `viewSeat` 只给**起始**视角：进预览即 `0`（P1 视角 = 验收第 1 项要看的形态：对手手牌只显示数量）。
   * 切到 P2 视角、把对手手牌改成全部可见，都靠**页内工具条**（`NetViewOpts.onPreviewChange`）——
   * 有意不为这两个开关再加模式卡：模式选择页已经够挤，而工具条只在预览时出现，语义更准。
   */
  startNetPreview(viewSeat: 0 | 1, banEnabled: boolean, randomPoolEnabled: boolean): void;
}

export function renderModeSelect(root: HTMLElement, nav: ModeSelectNav): void {
  clearRoot(root);
  const screen = el('div', 'mode-screen');
  screen.appendChild(el('h1', 'mode-title', '选择游戏模式'));

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
    mkMode('热坐（双人）', '两名玩家轮流在同一设备上对战（当前可用）', true, () => {
      nav.startHotseat(banBox.checked, randomBox.checked);
    })
  );
  // G5/T8：**真正的联机入口**（建房 / 加入 / 连接设置）。
  // 为什么排在预览卡**之前**：计划 §5 T8 的实现顺序约束（D24）—— 见 `ModeSelectNav.startNetLobby`
  // 的说明（`net-preview-wiring.test.ts:210-213` 的 `indexOf` 切片不许被新入口拉长）。
  //
  // ★ **本卡的描述句里一个字的信令/隐私说明都没有**（修复轮改；评审 §4.2 判第一版这里违了
  //   §2 第 6 条）：第一版手写了"两台设备直连（P2P）。默认不向任何服务器发请求…"—— 那是
  //   **第二份**说明。现在只说**这个卡是干什么的**（界面标签），说明一律在大厅里**引用**唯一出处渲染。
  list.appendChild(
    mkMode(
      '联机对战（两台设备）',
      '与另一台设备开一局：建房生成邀请码，或粘贴对方发来的邀请码。'
        + '连接设置与各项说明都在大厅里。',
      true,
      () => {
        nav.startNetLobby();
      }
    )
  );
  // G2 Task 4：远程对战页的**单视角预览**（本地、零联机）。放在热坐卡之后 —— 它是热坐流程的
  // 一个"看布局"变体，视觉上从属于它；热坐卡的文案与行为一行未改。
  list.appendChild(
    mkMode(
      '单视角预览（本地）',
      '远程对战页布局预览：上方是对手、下方是你；你的卡正立、对手的卡倒置。'
        + '仍是本地热座流程，零联机。页内工具条可切换视角与对手手牌可见性。',
      true,
      () => {
        // P1 视角起手：一进预览就是验收第 1 项要看的形态（对手手牌只显示数量）。
        nav.startNetPreview(0, banBox.checked, randomBox.checked);
      }
    )
  );
  list.appendChild(
    mkMode('单人模式', '对战 AI 对手', false, () => showToast('单人模式：开发中'))
  );
  list.appendChild(
    mkMode('三人模式', '三人同台对战', false, () => showToast('三人模式：开发中'))
  );
  screen.appendChild(list);

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
    '禁用模式',
    '开局可禁用部分协议：先掷硬币定先手，后手先禁 2 → 先手选 1 禁 1 → 后手选 2 禁 1 → 先手选 2 禁 2 → 后手选 1（选 6 禁 6）。被禁协议本局不可选，世代筛选仍可用。'
  );
  const randomToggle = mkToggle(
    '随机池模式',
    '开局随机从全部协议中抽取 12 套作为本局可选池（不再全量可选）。世代筛选仍可用；若同时开启禁用模式，则在 12 套内按禁用模式规则选/禁。'
  );
  const banBox = banToggle.box;
  const randomBox = randomToggle.box;
  screen.appendChild(toggles);

  const actions = el('div', 'mode-actions');
  actions.appendChild(button('btn mode-next-btn', '下一步：掷硬币定先手', () => {
    nav.startHotseat(banBox.checked, randomBox.checked);
  }));
  actions.appendChild(button('btn', '返回主页面', nav.backHome));
  screen.appendChild(actions);

  root.appendChild(screen);
}

/* =====================================================================
 * 掷硬币先手：玩家一选 正/反 → 掷币 → 掷胜者先选协议；后选协议者先出牌。
 * 币面资源：public/assets/coin/coin-1.jpg（素材 1344×560 的左半）、coin-2.jpg（右半）。
 * 「左=正面、右=反面」为位置假设 —— 待用户在 5173 目检确认真实正/反归属后可互换。 
 * ===================================================================== */
const COIN_FACES: ReadonlyArray<{ side: 1 | 2; name: string; src: string }> = [
  { side: 1, name: '正面', src: '/assets/coin/coin-1.jpg' },
  { side: 2, name: '反面', src: '/assets/coin/coin-2.jpg' },
];

/** 币面名（`COIN_FACES` 的**唯一**取值口 —— 屏上几条文案都从它取，不各写一份 find） */
function coinFaceName(side: CoinSide): string {
  return COIN_FACES.find((c) => c.side === side)!.name;
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
  const rotations = landed === 1 ? 2.25 : 2.5;
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
  screen.appendChild(button('btn coin-back-btn', '← 返回游戏模式选择', nav.backHome));

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
    : `玩家 ${callerSeat + 1} 叫了「${coinFaceName(chosenFace)}」`;
  // ★ 标题必须说清"由加入方选面"（热座那句「玩家一掷硬币决定先后手」在联机下不成立）
  screen.appendChild(el('h1', 'coin-title', isCaller ? '加入方选硬币面定先后手（联机）' : '等加入方选硬币面（联机）'));
  screen.appendChild(
    el(
      'p',
      'coin-rule',
      isCaller
        ? '由加入方选硬币的正/反面。选中的面与掷出的面一致 → 选中方先选协议；否则另一方先选协议。'
        : '由加入方选硬币的正/反面。对方选完之后，双方都看得到掷出的那一面。'
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
        ? `掷出${coinFaceName(net.landed)}。`
        : callLine !== null
          ? (tossing ? `${callLine} —— 正在抛硬币…` : `${callLine}，等掷硬币。`)
          : isCaller
            ? '请选择硬币的正/反面。'
            : '等对方叫面（对方按下正/反之后，掷硬币才会继续）。'
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
  COIN_FACES.forEach((face) => {
    const chip = el('button', 'coin-face-chip', face.name) as HTMLButtonElement;
    chip.type = 'button';
    chip.disabled = !isCaller;
    // 叫出去的那一面在落点之前就选中（玩家点完立刻看得到自己叫了什么）
    if (net.chosen === face.side) chip.classList.add('selected');
    chip.addEventListener('click', () => {
      // 落点已经到手 ⇒ 叫面这件事已经发生过，再点不许改（相位机那边也已经走过去了）
      if (!isCaller || net.landed !== null) return;
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
        `${callLine !== null ? `${callLine} —— ` : ''}掷出 ${coinFaceName(landed)} —— `
        + `玩家 ${winner + 1} 先选协议 · 玩家 ${2 - winner} 先出牌`
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
  screen.appendChild(button('btn coin-back-btn', '← 返回游戏模式选择', nav.backHome));
  screen.appendChild(el('h1', 'coin-title', '玩家一掷硬币决定先后手')); // 修改提示词 7：标题文案
  screen.appendChild(
    el(
      'p',
      'coin-rule',
      '玩家一先选择硬币正/反面，再掷硬币：掷出的面与玩家一的选择一致 → 玩家一先选协议；否则玩家二先选协议。'
    )
  );
  screen.appendChild(el('p', 'coin-rule coin-rule-2', '后选择协议的一方在对局中先出牌。'));
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
  img.alt = COIN_FACES[0].name;
  disc.appendChild(img);
  stage.appendChild(disc);
  screen.appendChild(stage);

  // 选择正/反面（chip 选择）
  const pickRow = el('div', 'coin-pick-row');
  const pickEls: HTMLElement[] = [];
  COIN_FACES.forEach((face) => {
    const chip = el('button', 'coin-face-chip', face.name);
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
  const flipBtn = button('btn coin-flip-btn', '掷硬币', () => {
    if (flipping) return;
    if (chosen === null) {
      showToast('请先选择 正面 或 反面');
      return;
    }
    flipping = true;
    flipBtn.disabled = true;
    for (const pe of pickEls) (pe as HTMLButtonElement).disabled = true;
    stage.classList.add('flipping');
    // G0：硬币结果由种子派生（原来是 Math.random）—— 动画只是把已确定的结果演出来
    // G5 T11-A：落点式与胜负规则**都搬去 `src/app/coin.ts`**（只搬家、不改值）；
    //   联机那条路要算同一件事，规则不能再长在屏上这一份里。
    const landed: 1 | 2 = coinLanding(seed);
    const winner: PlayerId = draftStarterFor(0, chosen, seed);
    // 交替闪现间隔逐次拉长（模拟硬币逐渐停下），最后停在 landed 面
    const delays = [90, 90, 110, 130, 160, 190, 230, 280, 340, 420, 520];
    let shown: 1 | 2 = chosen === 1 ? 2 : 1; // 首跳先翻到另一面
    let step = 0;
    const tick = (): void => {
      shown = shown === 1 ? 2 : 1;
      img.src = COIN_FACES.find((c) => c.side === shown)!.src;
      disc.classList.remove('flip-tick');
      void disc.offsetWidth; // 重启动画
      disc.classList.add('flip-tick');
      step += 1;
      if (step < delays.length) {
        flipTimer = window.setTimeout(tick, delays[step]);
      } else {
        // 收尾：若最后所示 ≠ landed，再来一跳并最终定格
        const finalize = (): void => {
          stage.classList.remove('flipping');
          flipping = false;
          disc.classList.add('settled');
          img.src = COIN_FACES.find((c) => c.side === landed)!.src;
          const faceName = COIN_FACES.find((c) => c.side === landed)!.name;
          result.style.display = '';
          result.textContent = '';
          result.appendChild(
            el(
              'div',
              'coin-result-text',
              `掷出 ${faceName} —— 玩家 ${winner + 1} 先选协议 · 玩家 ${2 - winner} 先出牌`
            )
          );
          result.appendChild(button('btn coin-begin-btn', '开始对局', () => nav.beginGame(winner)));
        };
        if (shown !== landed) {
          flipTimer = window.setTimeout(() => {
            shown = shown === 1 ? 2 : 1;
            img.src = COIN_FACES.find((c) => c.side === shown)!.src;
            disc.classList.remove('flip-tick');
            void disc.offsetWidth;
            disc.classList.add('flip-tick');
            flipTimer = window.setTimeout(finalize, 650);
          }, 650);
        } else {
          flipTimer = window.setTimeout(finalize, 620);
        }
      }
    };
    flipTimer = window.setTimeout(tick, 120);
  });
  actions.appendChild(flipBtn);
  screen.appendChild(actions);
  root.appendChild(screen);
}

/* =====================================================================
 * 图鉴：查看协议及其所属卡牌。右侧固定大展示框：鼠标悬停协议/卡牌 → 自动展示；
 * 点击仍走 openZoom 放大详情。右下角（右列展示框之后）是按效果分类的筛选面板（G5 T24）。
 * ===================================================================== */
export function renderLibrary(root: HTMLElement, back: () => void): void {
  clearRoot(root);
  const screen = el('div', 'library-screen');
  const head = el('div', 'subpage-head');
  head.appendChild(el('h1', 'subpage-title', '协议与卡牌图鉴'));
  head.appendChild(
    el('div', 'subpage-sub', `${DEMO_PROTOCOLS.length} 套协议 × 6 张指令卡（按代筛选 · 悬停实时预览，点击放大详情）`)
  );
  head.appendChild(button('btn', '← 返回主页面', back));
  screen.appendChild(head);

  // 按代筛选（2026-09-06 用户需求：同协议选择页的世代 chips）
  const LIB_GROUP_LABELS: ReadonlyArray<readonly [string, string]> = [
    ['MN01', '1代 基础'], ['AX01', '1代 拓展'], ['MN02', '2代 基础'], ['AX02', '2代 拓展'],
    ['MN03', '3代 基础'], ['AX03', '3代 拓展'],
  ];
  const libEnabled = new Set(LIB_GROUP_LABELS.map(([g]) => g));
  const filter = el('div', 'lib-filter');
  const refreshChips = (): void => {
    for (const chip of Array.from(filter.querySelectorAll('button'))) {
      const g = chip.dataset.group!;
      const on = libEnabled.has(g);
      chip.classList.toggle('on', on);
      chip.title = `${chip.textContent}（共 ${DEMO_PROTOCOLS.filter((p) => p.set === g).length} 套）· ${on ? '点击隐藏' : '点击显示'}`;
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
  const pHint = el('div', 'library-preview-hint', '把鼠标移到左侧的协议或卡牌上\n此处会实时展示');
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
        compiled ? `${motto} · 已编译` : motto,
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
      `${proto?.name ?? c.protocol} ${c.value} 分指令卡`,
      'portrait',
      buildCardTextEl(cardTextParts(c), 'library-preview-text')
    );
  };
  /** hover 即时预览：本框未固定时才生效（固定内容不被打扰） */
  const hoverEntry = (key: string): void => {
    if (libPinnedKey === null) previewEntry(key);
  };
  /** 单击固定：同 key 再点 = 取消固定（回 hover）；点其它 key = 切换固定目标 */
  const togglePin = (key: string): void => {
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
  effectPanel.appendChild(el('div', 'lib-effect-title', '按效果分类筛选'));
  const effectHint = (): void => {
    const r = filterLibrary(libFilterState());
    effectPanelHint.textContent = r.visibleCards.size === 0 && libEnabled.size === 0
      ? `当前 0 张（${r.totalCards} 张全被排除）`
      : `${libCheckedTags.size} / ${LIB_ALL_TAG_IDS.length} 类已勾选 · 命中 ${r.visibleCards.size} / ${r.totalCards} 张卡`;
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
  effectPanelActions.appendChild(button('lib-effect-btn lib-effect-all', '全选', () => setAllTags(true)));
  effectPanelActions.appendChild(button('lib-effect-btn lib-effect-none', '全不选', () => setAllTags(false)));
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
      list.appendChild(el('div', 'lib-effect-empty', '没有符合当前筛选项的卡牌 —— 勾几个效果分类，或把世代重新打开。'));
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
        cimg.alt = `${proto.name} ${c.value} 分`;
        cimg.loading = 'lazy';
        cimg.decoding = 'async';
        cimg.title = `${proto.name} ${c.value} 分指令卡`;
        cell.appendChild(cimg);
        cell.appendChild(el('div', 'lib-card-value', String(c.value)));
        const cardKey = `card:${c.defId}`;
        cell.addEventListener('mouseenter', () => hoverEntry(cardKey));
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
}

const RULES: RuleDoc[] = [
  { file: 'rule-mn01.pdf', title: '1代说明书', desc: 'Compile MN01（水/火/光/暗/生/死…）' },
  { file: 'rule-mn02.pdf', title: '2代说明书', desc: 'Compile MN02（冰/明镜/混乱/恐惧…）' },
  { file: 'rule-mn03.pdf', title: '3代说明书', desc: 'Compile MN03' },
  { file: 'rule-mn03-solo.pdf', title: '3代单人游玩说明书', desc: '单人规则扩展' },
  { file: 'rule-faq.pdf', title: '游戏详细FAQ说明书', desc: '官方 FAQ 汇总' },
];

export function renderRules(root: HTMLElement, back: () => void): void {
  clearRoot(root);
  const screen = el('div', 'rules-screen');
  const head = el('div', 'subpage-head');
  head.appendChild(el('h1', 'subpage-title', '规则图纸'));
  head.appendChild(el('div', 'subpage-sub', '游戏一/二/三代说明书与 FAQ（点击进入在线阅读）'));
  head.appendChild(button('btn', '← 返回主页面', back));
  screen.appendChild(head);

  const grid = el('div', 'rules-grid');
  for (const doc of RULES) {
    const item = el('div', 'rules-item');
    const cover = document.createElement('img');
    cover.className = 'rules-cover';
    cover.src = `/assets/rules/covers/${doc.file.replace('.pdf', '.jpg')}`;
    cover.alt = doc.title;
    cover.loading = 'lazy';
    const info = el('div', 'rules-info');
    info.appendChild(el('div', 'rules-title', doc.title));
    info.appendChild(el('div', 'rules-desc', doc.desc));
    item.appendChild(cover);
    item.appendChild(info);
    item.addEventListener('click', () => openPdfViewer(doc));
    grid.appendChild(item);
  }
  screen.appendChild(grid);
  root.appendChild(screen);
}

/** PDF 全屏查看遮罩：iframe 内嵌 + 新标签打开 + 关闭 */
function openPdfViewer(doc: RuleDoc): void {
  const url = `/assets/rules/${doc.file}`;
  const overlay = el('div', 'pdf-overlay');
  const bar = el('div', 'pdf-bar');
  bar.appendChild(el('div', 'pdf-title', doc.title));
  bar.appendChild(button('btn', '新标签打开', () => window.open(url, '_blank')));
  bar.appendChild(button('btn', '关闭', () => overlay.remove()));
  overlay.appendChild(bar);
  const frame = document.createElement('iframe');
  frame.className = 'pdf-frame';
  frame.src = url;
  overlay.appendChild(frame);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
