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
  startGame(): void; // 开始游戏 → 掷硬币屏
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

/** 清空根容器（各屏互斥） */
function clearRoot(root: HTMLElement): void {
  root.textContent = '';
  root.classList.remove('draft-exit', 'board-enter', 'no-anim');
}

/* =====================================================================
 * 背景大平面：30 套已编译卡面横置（逆时针 90°）排成几排，行间错位叠成斜排大平面；
 * 整面沿对角线巡回（A：斜上左移出 → 右下角续入；B：反向）。
 * 实现：一张 sheet 四份平铺（2×2）形成无缝周期，scroller 由 (0,0) ↔ (-W,-H) 循环平移
 * （CSS var --dw/--dh；.bg-dir-b 反向）。
 * ===================================================================== */
const BG_ROWS = 6;
const BG_ROW_TILES = 22;
const BG_TILE_STEP = 150;
const BG_ROW_STEP = 116;

/** 打乱协议顺序（装饰用） */
function shuffledProtocols(): typeof DEMO_PROTOCOLS {
  const defs = [...DEMO_PROTOCOLS];
  for (let i = defs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [defs[i], defs[j]] = [defs[j], defs[i]];
  }
  return defs;
}

function buildHomeBg(): HTMLElement {
  const sheetW = BG_ROW_TILES * BG_TILE_STEP;
  const sheetH = BG_ROWS * BG_ROW_STEP + 24;
  const defs = shuffledProtocols();
  const rows: string[] = [];
  for (let r = 0; r < BG_ROWS; r++) {
    const shift = r % 2 === 0 ? r * 4 : -(r * 4);
    const tiles: string[] = [];
    for (let i = 0; i < BG_ROW_TILES; i++) {
      const def = defs[(r * 5 + i) % defs.length];
      tiles.push(`<span class="bg-tile"><img alt="" src="${protocolImgSrc(def.defId, true)}"></span>`);
    }
    rows.push(`<div class="bg-row" style="transform:translateX(${shift}px)">${tiles.join('')}</div>`);
  }
  const sheet = `<div class="bg-sheet" style="width:${sheetW}px;height:${sheetH}px">${rows.join('')}</div>`;
  const scroller = el('div', 'bg-scroller');
  scroller.style.width = `${sheetW * 2}px`;
  scroller.style.height = `${sheetH * 2}px`;
  scroller.style.setProperty('--dw', `${-sheetW}px`);
  scroller.style.setProperty('--dh', `${-sheetH}px`);
  const copy = (x: number, y: number): string =>
    `<div class="bg-copy" style="left:${x}px;top:${y}px">${sheet}</div>`;
  scroller.innerHTML = copy(0, 0) + copy(sheetW, 0) + copy(0, sheetH) + copy(sheetW, sheetH);

  const bg = el('div', 'home-bg');
  bg.appendChild(scroller);
  bg.appendChild(el('div', 'home-bg-vignette'));
  return bg;
}

/** 主页面：菜单 + 背景大平面 + 巡回方向切换 + 页脚署名 */
export function renderHome(root: HTMLElement, nav: HomeNav): void {
  clearRoot(root);
  const screen = el('div', 'home-screen');

  const bg = buildHomeBg();
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

  // 背景巡回方向切换（A：斜上左 ⇄ B：斜下右）
  const dirBtn = button('btn home-bg-dir-btn', '背景移动：斜上左', () => {
    bg.classList.toggle('bg-dir-b');
    dirBtn.textContent = bg.classList.contains('bg-dir-b') ? '背景移动：斜下右' : '背景移动：斜上左';
  });
  screen.appendChild(dirBtn);

  screen.appendChild(
    el(
      'footer',
      'home-footer',
      '本桌游由 Compile 原作者创作 · 本网页版由「我吃吃吃吃」作为非官方粉丝开发'
    )
  );

  root.appendChild(screen);
}

/* =====================================================================
 * 掷硬币先手：玩家一选 正/反 → 掷币 → 掷胜者先选协议；后选协议者先出牌。
 * 币面资源：public/assets/coin/coin-1.jpg（素材左半 = 正面）、coin-2.jpg（右半 = 反面）。
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
