import type { PlayerId } from '../core/models/types';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, protocolImgSrc, cardImgSrc } from '../data/demo';
import { openZoom } from './render';

/**
 * 主界面/掷硬币/图鉴/规则图纸 —— 非对局屏（main.ts 导航）。
 *
 * - renderHome：真正的主页面（2026-09-03 用户需求）：菜单按钮 + 30 套已编译卡面
 *   背景大平面（两向对角巡回动画）+ 页脚署名。
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
}

export interface CoinNav {
  backHome(): void;
  /** 掷币结束：draftStarter = 掷胜玩家座位（0/1）；firstToPlay 由 main 置 1 - draftStarter */
  beginGame(draftStarter: PlayerId): void;
}

const SET_LABEL: Record<string, string> = {
  MN01: '1代 基础', AX01: '1代 拓展', MN02: '2代 基础', AX02: '2代 拓展',
};

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

/** 协议分组（装饰用）：30 套 → 5 组 × 6 套 */
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
    row.appendChild(box);
    row.appendChild(text);
    row.appendChild(help);
    toggles.appendChild(row);
    return { row, box };
  };
  const banToggle = mkToggle(
    '禁用模式',
    '开局可禁用部分协议：先掷硬币定先手，后手先禁 2 → 先手选 1 禁 1 → 后手选 2 禁 1 → 先手选 2 禁 2 → 后手选 1（选 6 禁 6）。被禁协议本局不可选，世代筛选仍可用。'
  );
  const randomToggle = mkToggle(
    '随机池模式',
    '开局随机从全部协议中抽取 12 套作为本局可选池（不再全 30 套可选）。世代筛选仍可用；若同时开启禁用模式，则在 12 套内按禁用模式规则选/禁。'
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

export function renderCoin(root: HTMLElement, nav: CoinNav): void {
  clearRoot(root);
  const screen = el('div', 'coin-screen');
  screen.appendChild(el('h1', 'coin-title', '掷硬币决定先手'));
  screen.appendChild(
    el(
      'p',
      'coin-rule',
      '玩家一先选择硬币正/反面，再掷硬币：掷出的面与玩家一的选择一致 → 玩家一先选协议；否则玩家二先选协议。'
    )
  );
  screen.appendChild(el('p', 'coin-rule coin-rule-2', '后选择协议的一方在对局中先出牌。'));

  let chosen: 1 | 2 | null = null;
  let flipping = false;

  const stage = el('div', 'coin-stage');
  const faceEls: HTMLElement[] = [];
  COIN_FACES.forEach((face) => {
    const f = el('div', 'coin-face', face.name);
    f.dataset.side = String(face.side);
    const coin = el('div', 'coin-disc');
    const img = document.createElement('img');
    img.src = face.src;
    img.alt = face.name;
    coin.appendChild(img);
    f.prepend(coin);
    f.addEventListener('click', () => {
      if (flipping) return;
      chosen = face.side;
      for (const fe of faceEls) fe.classList.toggle('selected', fe === f);
    });
    faceEls.push(f);
    stage.appendChild(f);
  });
  screen.appendChild(stage);

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
    stage.classList.add('flipping');
    const landed: 1 | 2 = Math.random() < 0.5 ? 1 : 2;
    const winner: PlayerId = landed === chosen ? 0 : 1;
    window.setTimeout(() => {
      stage.classList.remove('flipping');
      flipping = false;
      for (const fe of faceEls) {
        const side = Number(fe.dataset.side) as 1 | 2;
        fe.classList.toggle('won', side === landed);
        fe.classList.toggle('lost', side !== landed);
      }
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
    }, 1500);
  });
  actions.appendChild(flipBtn);
  actions.appendChild(button('btn', '返回主页面', nav.backHome));
  screen.appendChild(actions);
  root.appendChild(screen);
}

/* =====================================================================
 * 图鉴：查看协议及其所属卡牌（分组行 + 点卡放大；点协议图放大协议卡）
 * ===================================================================== */
export function renderLibrary(root: HTMLElement, back: () => void): void {
  clearRoot(root);
  const screen = el('div', 'library-screen');
  const head = el('div', 'subpage-head');
  head.appendChild(el('h1', 'subpage-title', '协议与卡牌图鉴'));
  head.appendChild(
    el('div', 'subpage-sub', `${DEMO_PROTOCOLS.length} 套协议 × 6 张指令卡（点击卡牌 / 协议图可放大查看）`)
  );
  head.appendChild(button('btn', '← 返回主页面', back));
  screen.appendChild(head);

  const list = el('div', 'library-list');
  for (const proto of DEMO_PROTOCOLS) {
    const group = el('div', 'lib-group');
    const headRow = el('div', 'lib-proto');
    const face = el('div', 'lib-proto-img-wrap');
    const img = document.createElement('img');
    img.src = protocolImgSrc(proto.defId, false);
    img.alt = proto.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.title = `查看协议「${proto.name}」放大图`;
    face.appendChild(img);
    face.addEventListener('click', () => openZoom(proto.defId, true, true, false));
    headRow.appendChild(face);
    const meta = el('div', 'lib-proto-meta');
    meta.appendChild(el('div', 'lib-proto-name', `${proto.name} · ${SET_LABEL[proto.set] ?? proto.set}`));
    meta.appendChild(el('div', 'lib-proto-commands', proto.commands.join(' · ')));
    headRow.appendChild(meta);
    group.appendChild(headRow);

    const row = el('div', 'lib-cards');
    for (const c of DEMO_CARD_DEFS.filter((x) => x.protocol === proto.defId)) {
      const cell = el('div', 'lib-card');
      const cimg = document.createElement('img');
      cimg.src = cardImgSrc(proto.defId, c.value);
      cimg.alt = `${proto.name} ${c.value} 分`;
      cimg.loading = 'lazy';
      cimg.decoding = 'async';
      cimg.title = `${proto.name} ${c.value} 分指令卡`;
      cell.appendChild(cimg);
      cell.appendChild(el('div', 'lib-card-value', String(c.value)));
      cell.addEventListener('click', () => openZoom(c.defId, true, false, false));
      row.appendChild(cell);
    }
    group.appendChild(row);
    list.appendChild(group);
  }
  screen.appendChild(list);
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
