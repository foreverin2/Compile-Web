/**
 * 「自定义协议与卡牌」屏 —— 卡牌制作器（2026-10-01）。
 *
 * 参考项目：**COMPILER · Card Builder**（作者 **Albert Blanco**，MIT 许可，
 * https://github.com/albrtbc/compiler），素材（卡框/背景/卡背/字体）亦来自该项目。
 * 本文件与同目录的其它模块是**移植**：读懂原实现之后按本仓的 TS + 依赖注入风格重写，
 * 不是把它的 JS 原样抄进来。
 *
 * ## 这一屏能做什么（用户 2026-10-01 拍板的"制作器核心"）
 *  - 编辑**竖版编译卡**（设计空间 744×1039）与**横版双面协议卡**（正/背，1039×744）；
 *  - canvas 实时预览；
 *  - 背景：15 套自带预设 + 上传自己的图；**拖拽平移 + 滚轮缩放 + 滑杆 + 重置**；
 *  - 上/中/下三条文本面板（支持 `**粗**` 与 `__下划线__` 行内标记）、大号数值、
 *    协议名、六边形 logo（可上传，白色着色）；
 *  - **导出 PNG**（单张，打印分辨率 750×1050 / 1050×750）；
 *  - **牌组 JSON 导入 / 导出**（自定图 base64 内嵌 + 预设按名字引用）+ 本地保存。
 *
 * ## 刻意**不做**的（核对了参考项目之后划掉的范围）
 *  打印 PDF、分享短链、马赛克分割、"我的牌组"多牌组库、前脸 glitch 特效、卡缘套装码。
 *
 * ## 两条结构纪律（它们决定了本文件长什么样）
 *  1. **本文件不引用任何浏览器存储 API**：牌组读写全部走 `nav.store`，文件读写走
 *     `nav.readTextFile` / `nav.uploadDataUrl` / `nav.download`。于是它能在**没有 jsdom**
 *     的手写 DOM 桩上真跑（本仓既有的 `tests/ui/net-dom-stub.ts`）—— 这正是它能被
 *     "行为腿"覆盖、而不是只有文本腿的原因。
 *  2. **canvas 拿不到 2D 上下文时不抛**：桩上 `getContext()` 返回 `null`。
 *     绘制路径一律在 `ctx === null` 时跳过（屏上结构与编辑逻辑照常可测）。
 */
import {
  ASSET_BASE,
  CARD_H,
  CARD_W,
  LAND_H,
  LAND_W,
  PANEL_MAX,
  PANEL_MIN,
  PRESETS,
  PROTOCOL_BACK,
  PROTOCOL_FRONT,
  SCALE_MAX,
  SCALE_MIN,
  ZONES,
  type HexBox,
  type PanelZone,
  type TextZone,
} from './config';
import { clampScale, zoomAt } from './geometry';
import {
  getImageFromDataUrl,
  getPresetImage,
  getValueOverlay,
  loadFonts,
  normalizeImage,
  normalizeLogo,
  type DrawableImage,
} from './images';
import { hydrateDeck } from './model';
import { parseDeck, safeFileName, stringifyDeck } from './serialize';
import { toPoker, drawBackground, drawLogoHex } from './draw';
import { drawLine, drawPanelText } from './text';
import { defaultCard, defaultDeck, isLandscape, type Bg, type CardKind, type CardState, type Deck, type Logo } from './types';

/* ── 宿主接缝 ─────────────────────────────────────────────────────────── */

/** 本机保存的结论（`save()` 的一次结果） */
export interface CardmakerSaveResult {
  ok: boolean;
  /** `ok === false` 时的**人话**原因（原样显示在状态行） */
  detail: string;
}

export interface CardmakerStore {
  /** 读回本机保存的牌组；没有就返回 `null` */
  load(): Promise<Deck | null>;
  /** 写盘。**不抛**：失败以 `{ ok: false, detail }` 回来 */
  save(deck: Deck): Promise<CardmakerSaveResult>;
  /**
   * 这份存储当前**写不写得进去**。
   *
   * `false` 的两种情形都要如实告诉用户"本次会话的改动不会保留"：
   *  1. 游客模式（授权弹窗里选了"不允许"）—— 后台退化成内存，刷新即丢；
   *  2. 浏览器存储不可用（隐私模式 / 配额满）。
   */
  isPersistent(): boolean;
}

export interface CardmakerNav {
  /** 回主页面 */
  back(): void;
  store: CardmakerStore;
  /**
   * 让用户挑一个文件并把**文本**读进来（牌组 JSON 导入）。
   * 用户取消 → `null`；读取失败 → reject（本屏如实提示真因）。
   */
  readTextFile(accept: string): Promise<string | null>;
  /**
   * 让用户挑一张图，读成 data URL。用户取消 → `null`。
   * `kind` 让宿主知道这是背景（随后会缩到 2000px）还是 logo（320px PNG）。
   */
  uploadDataUrl(kind: 'bg' | 'logo'): Promise<string | null>;
  /** 落盘一个 Blob（导出 PNG / JSON）。`filename` 已由本屏做过路径安全处理。 */
  download(filename: string, blob: Blob): void;
}

/* ── 本屏用得到的那点 DOM（两个能力，桩上都有） ────────────────────────── */

export interface CardmakerDom {
  createElement(tag: string): HTMLElement;
  /** 造一个 canvas（桩上 `getContext()` 返回 null，绘制路径会跳过） */
  createCanvas(): HTMLCanvasElement;
}

/** 缺省 DOM 工厂：真浏览器里就是 `document` */
export function browserCardmakerDom(): CardmakerDom {
  return {
    createElement: (tag) => document.createElement(tag),
    createCanvas: () => document.createElement('canvas'),
  };
}

/* ── 小助手（与 `local-data.ts` / `home.ts` 同形：各自一份局部助手） ─────── */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buttonOf(cls: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.type = 'button';
  return b;
}

/** 造一个 `data-role` 标注过的元素（屏上每个可操作点都有唯一 role：测试靠它定位） */
function elRole(tag: string, cls: string, role: string, text?: string): HTMLElement {
  const node = el(tag, cls, text);
  node.dataset.role = role;
  return node;
}

function btnRole(cls: string, role: string, label: string): HTMLButtonElement {
  const b = buttonOf(cls, label);
  b.dataset.role = role;
  return b;
}

/** 屏上那句署名里的关键事实（测试直接引用这些常量，不手抄一遍文案） */
export const CREDIT = {
  project: 'COMPILER · Card Builder',
  author: 'Albert Blanco',
  license: 'MIT 许可',
  url: 'https://github.com/albrtbc/compiler',
  /** 许可原文在仓库里的路径（页面底部也写上，用户能照着去翻） */
  licensePath: 'public/assets/cardmaker/LICENSE-COMPILER-Card-Builder.txt',
  sentence:
    '本制作器参考开源项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可）制作，'
    + '素材（卡框/背景/卡背/字体）亦来自该项目。',
} as const;

/** 卡的 id：尽量用浏览器自带的 UUID，老环境回落到"时间戳 + 计数器" */
let idCounter = 0;
function newCardId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  idCounter += 1;
  return `card-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * 三段面板的排版读数（写在面板说明里，让用户知道有几段文字、能不能写行内标记）。
 *
 * ⚠️ 参数是**三段一起**给：屏上只有一条 panel-note，它描述的是"这个卡面上的面板文本"
 * 这件事（而不是某一个输入框）。第一版只读了 `panelTop` ⇒ 只在"上方面板"里打字才会
 * 更新说明，中部/下部打字时说明停在旧文案上（测试当场抓到了这个不一致）。
 */
function panelSummary(top: string, mid: string, bot: string): string {
  const panels = [top, mid, bot].map((t) => (t || '').replace(/\s+$/g, ''));
  const filled = panels.filter((t) => t.trim() !== '');
  if (filled.length === 0) return PANEL_EMPTY_HINT;
  const paras = filled.reduce((n, t) => n + t.split('\n').length, 0);
  const marks = filled.some((t) => t.includes('**') || t.includes('__'));
  return `当前有 ${filled.length} 段面板文本（共 ${paras} 段${marks ? '，含行内标记' : ''}）· `
    + `行内标记写法：**粗体** 与 __下划线__ · 字号自动在 ${PANEL_MIN}–${PANEL_MAX}px 之间缩放`;
}

/** 面板全空的提示（与参考项目一致：没有文字就不画面板底衬） */
export const PANEL_EMPTY_HINT = '三段面板都没有文字：卡面不会画面板底衬（与参考项目一致）。';

/* ── 屏 ─────────────────────────────────────────────────────────────── */

/**
 * 画出制作器整屏。**整屏屏**（进函数先 `root.textContent = ''`），与 `renderRules` /
 * `renderLocalData` 同一做法。
 *
 * @param root 容器（宿主给 `#app`）
 * @param nav  宿主注入的能力（存储 / 文件 / 落盘 + 返回）
 * @param dom  可注入的 DOM 工厂（缺省 `browserCardmakerDom()`）；单测用它喂桩
 */
export function renderCardmaker(root: HTMLElement, nav: CardmakerNav, dom: CardmakerDom = browserCardmakerDom()): void {
  root.textContent = '';

  /* ── 屏状态（只有一个真相：`deck`） ── */
  let deck: Deck = defaultDeck();
  let currentId = '';
  let saving = false;
  /** 预览渲染的序号：上一次还没画完时，后到的结果直接丢掉（免得旧帧盖新帧） */
  let renderSeq = 0;
  /** 从本机读回之前不要保存（否则会用空牌组把本机那份覆盖掉） */
  let hydrated = false;

  const screen = elRole('div', 'cardmaker-screen', 'screen');
  screen.dataset.persistent = nav.store.isPersistent() ? 'yes' : 'no';
  // 当前编辑的是哪一种卡（「协议卡」/「卡牌」两个模式之一）。初值由启动那一段按牌组里的卡定。
  let mode: CardKind = 'compile';
  screen.dataset.mode = mode;
  /**
   * **每个模式各自记住上次在看哪一张卡的 id**（用户 2026-10-01 的要求：
   * "两个模式各自记住上次在看哪一张卡，切换不该丢编辑内容"）。
   *
   * 为什么是"按 id 记"而不是"按索引记"：删卡会让索引整体左移，按索引记会把"你在看第 2 张"
   * 悄悄换成另一张卡。id 是稳定的。
   */
  const lastSeenId: Record<CardKind, string> = { compile: '', protocol: '' };

  /* ── ① 顶栏 ── */
  const top = el('div', 'cardmaker-top');
  const backBtn = btnRole('btn', 'back', '← 返回主页面');
  backBtn.addEventListener('click', () => { nav.back(); });
  top.appendChild(backBtn);
  top.appendChild(el('h1', 'cardmaker-title', '自定义协议与卡牌'));
  const saveBtn = btnRole('btn', 'save', '保存到本机');
  saveBtn.addEventListener('click', () => { void saveNow(); });
  top.appendChild(saveBtn);
  screen.appendChild(top);

  /**
   * ★ 2026-10-01（用户要求）：**显式的双模式切换**（「协议卡」/「卡牌」）。
   *
   * ## 为什么现在才有
   * 用户问"协议卡自定义模式 / 卡牌自定义模式在哪"。**实测核对：这两个词在全仓零命中，
   * 页面上也确实没有这个切换** —— 第一版只有"卡清单里点一张卡"这一条隐式路径
   * （`[data-role^="card-open-"]`）。作为**可见的**入口它不合格：用户找不到，
   * 而且"我现在在编辑哪一种卡"这件事只能从清单里那张卡的文案反推。
   *
   * ## 语义（按用户给的口径）
   *  - 切到「协议卡」⇒ 当前编辑**横版双面协议卡**（整副只许一张那条规则不变）；
   *  - 切到「卡牌」⇒ 当前编辑**竖版编译卡**（整副还没有就按现有加卡逻辑建一张）；
   *  - 两个模式各自记住上次看的那一张（`lastSeenId`），切换**不丢**已编辑内容。
   */
  const modeBar = elRole('div', 'cardmaker-modes', 'modes');
  (modeBar as HTMLElement & { setAttribute(n: string, v: string): void }).setAttribute('role', 'tablist');
  const modeHint = elRole('span', 'cardmaker-note', 'mode-hint', '');
  const modeBtns: Record<CardKind, HTMLButtonElement> = {
    protocol: btnRole('btn cardmaker-mode', 'mode-protocol', '协议卡（横版 · 正/背两面）'),
    compile: btnRole('btn cardmaker-mode', 'mode-compile', '卡牌（竖版编译卡）'),
  };
  (modeBtns.protocol as unknown as { setAttribute(n: string, v: string): void }).setAttribute('role', 'tab');
  (modeBtns.compile as unknown as { setAttribute(n: string, v: string): void }).setAttribute('role', 'tab');
  modeBtns.protocol.addEventListener('click', () => { setMode('protocol'); });
  modeBtns.compile.addEventListener('click', () => { setMode('compile'); });
  modeBar.appendChild(modeBtns.protocol);
  modeBar.appendChild(modeBtns.compile);
  modeBar.appendChild(modeHint);
  screen.appendChild(modeBar);

  /** 状态区：本屏**唯一**的提示通道（人读 `textContent`，机器读 `data-code`） */
  const status = elRole('div', 'cardmaker-status', 'status');
  status.dataset.code = 'none';
  status.dataset.kind = 'none';
  // 默认文案直接说清"存到哪"，因为两档（允许 / 游客）的后果**不一样**
  status.textContent = nav.store.isPersistent()
    ? '改动会自动保存到本机（浏览器存储），刷新后仍在。'
    : '当前是游客模式或本机存储不可用：改动只存在内存里，刷新或关闭页面就会丢。';
  screen.appendChild(status);
  const say = (msg: string, code: string, kind: 'info' | 'warn' | 'error'): void => {
    status.textContent = msg;
    status.dataset.code = code;
    status.dataset.kind = kind;
  };

  screen.appendChild(el(
    'p',
    'cardmaker-note',
    `卡面按参考项目的几何尺寸渲染（竖版设计空间 ${CARD_W}×${CARD_H}，横版 ${LAND_W}×${LAND_H}），`
    + '导出按标准扑克牌 63.5×88.9mm 的 300dpi 成品尺寸。',
  ));

  /* ── ② 两栏：左 = 选项，右 = 预览（常驻） ──
   *
   * 用户 2026-10-01 的原话：「将自定义协议页面内的预览展示框移至右边保持常驻，
   * 其他的选项移到左边」。
   *
   * 结构就是**两个直接子节点**：`[data-role="options"]` 在前、`[data-role="preview"]` 在后。
   * 桌面档由 CSS 定成 `grid-template-columns: minmax(0,1fr) 460px`（左选项 / 右预览），
   * 竖屏窄档回落成单列（预览排在下面，见 `styles-local.css` 的两条 media 规则）。
   * 右栏 `position: sticky; top: 12px` ⇒ 左栏滚很长时预览**不跑掉**。
   */
  const layout = elRole('div', 'cardmaker-layout', 'layout');
  const optionsCol = elRole('div', 'cardmaker-options', 'options');
  const previewCol = elRole('div', 'cardmaker-preview-col', 'preview-col');
  layout.appendChild(optionsCol);
  layout.appendChild(previewCol);
  screen.appendChild(layout);

  const previewWrap = elRole('div', 'cardmaker-preview', 'preview');
  const canvas = dom.createCanvas();
  canvas.className = 'cardmaker-canvas';
  canvas.dataset.role = 'canvas';
  previewWrap.appendChild(canvas);
  /** 预览读数：这一栏画的是哪一张、哪一套设计空间（模式切换之后会变，测试与 CDP 读它） */
  const previewSize = elRole('div', 'cardmaker-note', 'preview-size', `预览：竖版编译卡 · 设计空间 ${CARD_W}×${CARD_H}`);
  previewSize.dataset.orientation = 'portrait';
  previewWrap.appendChild(previewSize);
  previewWrap.appendChild(el(
    'div',
    'cardmaker-note',
    '在卡面上拖动 = 平移背景；滚轮 = 以光标为中心缩放背景；在六边形里拖 = 移动 logo。',
  ));
  previewCol.appendChild(previewWrap);

  const adjust = elRole('div', 'cardmaker-adjust', 'adjust');
  const zoomLabel = elRole('span', 'cardmaker-note', 'zoom-value', '100%');
  const zoomInput = document.createElement('input');
  zoomInput.type = 'range';
  zoomInput.className = 'cardmaker-range';
  zoomInput.dataset.role = 'zoom';
  zoomInput.min = String(Math.round(SCALE_MIN * 100));
  zoomInput.max = String(Math.round(SCALE_MAX * 100));
  zoomInput.step = '1';
  const resetBtn = btnRole('btn cardmaker-mini', 'reset-view', '重置背景');
  adjust.appendChild(el('span', 'cardmaker-note', '背景缩放'));
  adjust.appendChild(zoomInput);
  adjust.appendChild(zoomLabel);
  adjust.appendChild(resetBtn);
  // 缩放滑杆跟着**预览**走（它调的是当前卡背景的平移/缩放）
  previewCol.appendChild(adjust);

  /* ── ③ 牌组名与卡清单（**只列当前模式的那些卡**） ── */
  const deckRow = elRole('div', 'cardmaker-row', 'deck-row');
  const deckTitle = document.createElement('input');
  deckTitle.type = 'text';
  deckTitle.className = 'cardmaker-input';
  deckTitle.dataset.role = 'deck-title';
  deckTitle.placeholder = '牌组名（用于导出文件名）';
  deckRow.appendChild(el('span', 'cardmaker-note', '牌组名'));
  deckRow.appendChild(deckTitle);
  optionsCol.appendChild(deckRow);

  const cardsHost = elRole('div', 'cardmaker-cards', 'cards');
  optionsCol.appendChild(cardsHost);

  const cardActions = el('div', 'cardmaker-actions');
  const addCompile = btnRole('btn', 'add-compile', '新增竖版编译卡');
  const addProtocol = btnRole('btn', 'add-protocol', '新增横版协议卡');
  const delCard = btnRole('btn', 'delete-card', '删除当前卡');
  cardActions.appendChild(addCompile);
  cardActions.appendChild(addProtocol);
  cardActions.appendChild(delCard);
  optionsCol.appendChild(cardActions);

  /* ── ④ 编辑表单（只编辑**当前卡**） ── */
  const form = elRole('div', 'cardmaker-form', 'form');
  const field = (role: string, label: string, hint?: string): HTMLInputElement => {
    const row = el('label', 'cardmaker-field');
    row.appendChild(el('span', 'cardmaker-label', label));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cardmaker-input';
    input.dataset.role = role;
    row.appendChild(input);
    if (hint) row.appendChild(el('span', 'cardmaker-hint', hint));
    form.appendChild(row);
    return input;
  };
  const area = (role: string, label: string, hint?: string): HTMLTextAreaElement => {
    const row = el('label', 'cardmaker-field');
    row.appendChild(el('span', 'cardmaker-label', label));
    const input = document.createElement('textarea');
    input.className = 'cardmaker-textarea';
    input.rows = 3;
    input.dataset.role = role;
    row.appendChild(input);
    if (hint) row.appendChild(el('span', 'cardmaker-hint', hint));
    form.appendChild(row);
    return input;
  };

  const inTitle = field('title', '协议名 / 标题', '横版卡上是正中大标题；竖版卡上是左上角标题');
  const inValue = field('value', '数值（大号中心数字）', '只对竖版编译卡有效');
  const inTop = area('panel-top', '上方面板', '可写 **粗体** 与 __下划线__');
  const inMid = area('panel-mid', '中部面板', '可写 **粗体** 与 __下划线__');
  const inBot = area('panel-bot', '下方面板', '可写 **粗体** 与 __下划线__');
  const inCTop = field('compile-top', '横版卡左上角小字');
  const inCSub = field('compile-subtitle', '横版卡副标题');
  const inCBot = field('compile-bottom', '横版卡底部小字');
  const inCBack = field('compile-back', '横版卡背面那行字');
  optionsCol.appendChild(form);

  const panelNote = elRole('p', 'cardmaker-note', 'panel-note', PANEL_EMPTY_HINT);
  // 面板说明紧贴它描述的那三个输入框（它们是 `form` 里的成员）⇒ 进**同一条 `label`**
  // 会让点击说明也聚焦输入框；这里保持同级块，按顺序紧跟表单。
  optionsCol.appendChild(panelNote);

  /* ── ⑤ 背景 ── */
  const bgRow = elRole('div', 'cardmaker-bg', 'bg');
  const bgMode = elRole('span', 'cardmaker-note', 'bg-mode', '不使用背景');
  bgRow.appendChild(bgMode);
  const bgActions = el('div', 'cardmaker-actions');
  const bgUpload = btnRole('btn cardmaker-mini', 'bg-upload', '上传背景图');
  const bgClear = btnRole('btn cardmaker-mini', 'bg-clear', '不使用背景');
  bgActions.appendChild(bgUpload);
  bgActions.appendChild(bgClear);
  bgRow.appendChild(bgActions);
  const presetHost = elRole('div', 'cardmaker-presets', 'presets');
  for (const name of PRESETS) {
    const presetBtn = btnRole('btn cardmaker-thumb', `preset-${name}`, name);
    presetBtn.addEventListener('click', () => {
      setBg({ type: 'preset', name, dataUrl: null, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
      say(`背景已换成预设「${name}」。`, 'bg-preset', 'info');
    });
    presetHost.appendChild(presetBtn);
  }
  bgRow.appendChild(presetHost);
  optionsCol.appendChild(bgRow);

  /**
   * 「每张卡单独的背景」开关。
   *
   * ⚠️ `data-role` 只挂在**复选框**上（标签不再重复挂一个同名 role）：屏上每个 role
   * 都应当是**唯一**的（测试按 role 定位，重名会让 `one()` 报"实际 2 个"）。
   */
  const perCardRow = el('label', 'cardmaker-toggle');
  const perCardBox = document.createElement('input');
  perCardBox.type = 'checkbox';
  perCardBox.className = 'cardmaker-check';
  perCardBox.dataset.role = 'per-card-bg';
  perCardRow.appendChild(perCardBox);
  perCardRow.appendChild(el('span', 'cardmaker-note', '每张卡单独的背景（关掉时整副牌共用一套背景）'));
  optionsCol.appendChild(perCardRow);

  /* ── ⑥ logo ── */
  const logoRow = elRole('div', 'cardmaker-row', 'logo');
  const logoState = elRole('span', 'cardmaker-note', 'logo-state', '未上传 logo');
  const logoUpload = btnRole('btn cardmaker-mini', 'logo-upload', '上传 logo');
  const logoClear = btnRole('btn cardmaker-mini', 'logo-clear', '清除 logo');
  logoRow.appendChild(el('span', 'cardmaker-note', '六边形 logo（自动白色着色）'));
  logoRow.appendChild(logoState);
  logoRow.appendChild(logoUpload);
  logoRow.appendChild(logoClear);
  optionsCol.appendChild(logoRow);

  /* ── ⑦ 导出 / 导入 ── */
  const ioRow = elRole('div', 'cardmaker-actions', 'io');
  const exportPng = btnRole('btn', 'export-png', '导出当前卡 PNG');
  const exportPortrait = btnRole('btn cardmaker-mini', 'export-portrait', '按竖版编译卡导出');
  const exportJson = btnRole('btn cardmaker-mini', 'export-json', '导出牌组 JSON');
  const importJson = btnRole('btn cardmaker-mini', 'import-json', '导入牌组 JSON');
  ioRow.appendChild(exportPng);
  ioRow.appendChild(exportPortrait);
  ioRow.appendChild(exportJson);
  ioRow.appendChild(importJson);
  optionsCol.appendChild(ioRow);

  /* ── ⑧ 署名（用户明确要求：显眼且准确） ── */
  const credit = elRole('footer', 'cardmaker-credit', 'credit');
  credit.appendChild(elRole('p', 'cardmaker-credit-line', 'credit-sentence', CREDIT.sentence));
  const creditMeta = el('div', 'cardmaker-credit-meta');
  creditMeta.appendChild(elRole('span', 'cardmaker-credit-item', 'credit-author', `作者：${CREDIT.author}`));
  creditMeta.appendChild(elRole('span', 'cardmaker-credit-item', 'credit-license', `许可：${CREDIT.license}`));
  const creditLink = elRole('a', 'cardmaker-credit-link', 'credit-link', CREDIT.url) as HTMLAnchorElement;
  creditLink.href = CREDIT.url;
  creditLink.target = '_blank';
  creditLink.rel = 'noreferrer';
  creditMeta.appendChild(creditLink);
  credit.appendChild(creditMeta);
  credit.appendChild(elRole('p', 'cardmaker-note', 'credit-license-path', `许可原文随仓库提供：${CREDIT.licensePath}`));
  screen.appendChild(credit);

  root.appendChild(screen);

  /* ── 素材（懒加载一次） ── */
  const assets: {
    frame: HTMLImageElement | null;
    panels: Record<'top' | 'mid' | 'bot', HTMLImageElement | null>;
    protocolFront: HTMLImageElement | null;
    protocolBack: HTMLImageElement | null;
  } = { frame: null, panels: { top: null, mid: null, bot: null }, protocolFront: null, protocolBack: null };

  /**
   * 用 `<img>` 加载一张固定 URL 的素材。
   *
   * 为什么不用 `images.ts` 的 `loadImage`（那条走 `createImageBitmap`）：卡框/面板是**同源
   * 固定 URL 的小 PNG**，`<img>` 这条路的"解码延迟"代价可以忽略；而 `loadImage` 那条要先
   * `fetch` 再 `createImageBitmap`，对 6 张小图反而多两次往返。失败一律回 `null`
   * （卡面少一层，不抛）—— 素材缺失不该让整屏打不开。
   */
  function loadAsset(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => { resolve(img); };
        img.onerror = () => { resolve(null); };
        img.src = url;
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * 六张素材：竖版卡框 + 三条面板 + 横版协议卡的正/背卡框。
   *
   * ⚠️ **两张横版卡框用的是素材目录里的 `protocol-front.png` / `protocol-back.png`**
   * （它们本身就画在 1039×744 的横版空间里），**不是**把竖版 `frame.png` 转 90° ——
   * 参考项目也是这么做的（它把这层预旋转的结果单独存成文件）。
   * 导出竖版工作时用的那条逆变换在 `rotateToPortrait()` 里（与这里互逆）。
   */
  async function loadAssets(): Promise<void> {
    const base = `${ASSET_BASE}/card-frame`;
    const [frame, top, mid, bot, pf, pb] = await Promise.all([
      loadAsset(`${base}/frame.png`),
      loadAsset(`${base}/panel_top.png`),
      loadAsset(`${base}/panel_mid.png`),
      loadAsset(`${base}/panel_bot.png`),
      loadAsset(`${base}/protocol-front.png`),
      loadAsset(`${base}/protocol-back.png`),
    ]);
    assets.frame = frame;
    assets.panels.top = top;
    assets.panels.mid = mid;
    assets.panels.bot = bot;
    assets.protocolFront = pf;
    assets.protocolBack = pb;
  }

  /* ── 数据访问：全部经这几个函数，别处不直接挑 `deck.shared` 的字段 ── */

  function sharedOf(kind: CardKind): { bg: Bg; logo: Logo } {
    return kind === 'compile' ? deck.shared.compile : deck.shared.protocol;
  }
  /** 当前卡的背景（"每张卡单独"关着时是 deck 级共享的那一套） */
  function bgOf(card: CardState): Bg {
    return deck.shared.perCardBg ? card.bgOwn : sharedOf(card.kind).bg;
  }
  function logoOf(card: CardState): Logo {
    return deck.shared.perCardBg ? card.logoOwn : sharedOf(card.kind).logo;
  }
  /** 当前模式下的卡（清单只列这些；"当前卡"也只会是其中之一） */
  function cardsOf(kind: CardKind): CardState[] {
    return deck.cards.filter((c) => c.kind === kind);
  }
  function current(): CardState | null {
    return deck.cards.find((c) => c.id === currentId) ?? null;
  }

  /**
   * 换模式（用户 2026-10-01 要求的显式双模式切换）。
   *
   * 三件事，顺序有讲究：
   *  1. 记住"现在这张卡属于哪个模式"（`lastSeenId`）—— 下一句会改 `mode`，之后就认不出来了；
   *  2. 目标模式里**还没有卡**就按现有加卡逻辑建一张（协议卡整副只许一张这条规则照旧）；
   *  3. 切到该模式上次看的那张（`lastSeenId`），没有就取第一张。
   *
   * ⚠️ **已编辑的内容不会丢**：它一直在 `deck` 里，这里只切"在看哪一张"。
   * 切完必须 `refreshAll()` —— 预览尺寸（744×1039 vs 1039×744）、表单禁用态、
   * 卡清单、背景面板**全都**跟着模式走。
   */
  function setMode(next: CardKind): void {
    if (next !== mode) {
      const cur = current();
      if (cur !== null) lastSeenId[cur.kind] = cur.id;
    }
    const created = ensureCardOf(next);
    mode = next;
    screen.dataset.mode = mode;
    const target = cardsOf(next);
    const remembered = lastSeenId[next];
    currentId = (remembered !== '' && target.some((c) => c.id === remembered))
      ? remembered
      : (target[0]?.id ?? '');
    refreshAll();
    if (created) {
      say(
        next === 'protocol'
          ? '已切到「协议卡」：整副牌还没有横版协议卡，按加卡逻辑建了一张。'
          : '已切到「卡牌」：整副牌还没有竖版编译卡，按加卡逻辑建了一张。',
        'mode-created-card',
        'info',
      );
    } else {
      say(
        next === 'protocol' ? '已切到「协议卡」（横版 · 正/背两面）。' : '已切到「卡牌」（竖版编译卡）。',
        'mode-switched',
        'info',
      );
    }
  }

  /** 目标模式里一张卡都没有时建一张；建了返回 true。规则：协议卡整副只许一张。 */
  function ensureCardOf(kind: CardKind): boolean {
    if (cardsOf(kind).length > 0) return false;
    const card = defaultCard(newCardId(), kind);
    deck.cards = kind === 'protocol' ? [card, ...deck.cards] : [...deck.cards, card];
    return true;
  }

  /* ── 保存（防抖：拖拽/打字时不要每帧写盘） ── */
  let saveTimer: number | null = null;
  function scheduleSave(delay = 700): void {
    if (!hydrated) return; // 还没读完本机数据，别用空牌组覆盖它
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveTimer = null; void saveNow(); }, delay);
  }
  async function saveNow(): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      const res = await nav.store.save(deck);
      if (!res.ok) say(`本机保存失败：${res.detail}（本次会话仍可继续编辑）`, 'save-failed', 'error');
      else if (!nav.store.isPersistent()) say('改动已记在内存里（游客模式）：刷新或关闭页面就会丢。', 'saved-memory', 'warn');
      else say('已保存到本机。', 'saved', 'info');
    } catch (e) {
      // 契约上 `save()` 不抛；这层兜的是宿主假件 / 将来实现
      say(`本机保存失败：${String(e)}（本次会话仍可继续编辑）`, 'save-threw', 'error');
    } finally {
      saving = false;
    }
  }

  /* ── 刷新 ───────────────────────────────────────────────────────────── */

  /**
   * 卡清单：只列**当前模式**的那些卡（一行一张，点它切换当前编辑的卡）。
   *
   * 只列当前模式是有意的（用户 2026-10-01 的双模式切换）：这样"我在编辑哪一种卡"由
   * 清单自己说清，而不是从每行的文案反推；另一种卡仍然活在牌组里（导出/保存照旧），
   * 只是不在这条清单上 —— 切过去就能看到。
   */
  function refreshCards(): void {
    cardsHost.textContent = '';
    const list = cardsOf(mode);
    for (const card of list) {
      const row = elRole('div', 'cardmaker-card-row', 'card-row');
      row.dataset.cardId = card.id;
      row.dataset.cardKind = card.kind;
      if (card.id === currentId) row.classList.add('cardmaker-card-on');
      const open = btnRole('btn cardmaker-mini', `card-open-${card.id}`, card.kind === 'protocol' ? '横版协议卡' : '竖版编译卡');
      open.addEventListener('click', () => {
        currentId = card.id;
        lastSeenId[card.kind] = card.id;
        refreshAll();
      });
      row.appendChild(open);
      const label = card.title.trim() === '' ? '（未命名）' : card.title.trim();
      const value = card.value.trim() === '' ? '—' : card.value.trim();
      row.appendChild(el('span', 'cardmaker-note', `${label} · 数值 ${value}`));
      cardsHost.appendChild(row);
    }
    if (list.length === 0) {
      cardsHost.appendChild(el('div', 'cardmaker-note', '这个模式下还没有卡：用下面的按钮加一张。'));
    }
    // 只剩一张时不许删（不允许把这一种卡删空）—— 与第一版同一条规则，只是按**模式**判
    delCard.disabled = current() === null || cardsOf(mode).length <= 1;
  }

  /** 表单 ← 当前卡（只在切换卡 / 导入之后回填；打字时不回填，免得把光标顶跑） */
  function formFromCard(card: CardState | null): void {
    inTitle.value = card ? card.title : '';
    inValue.value = card ? card.value : '';
    inTop.value = card ? card.panelTop : '';
    inMid.value = card ? card.panelMid : '';
    inBot.value = card ? card.panelBot : '';
    inCTop.value = card ? card.compile.top : '';
    inCSub.value = card ? card.compile.subtitle : '';
    inCBot.value = card ? card.compile.bottom : '';
    inCBack.value = card ? card.compile.back : '';
    const land = card !== null && isLandscape(card.kind);
    // 横版协议卡没有"三段面板"与"大号数值"这两样东西 ⇒ 那几个输入框关掉，
    // 免得用户填了却看不到（填了不生效比"填不了"更坏）
    inValue.disabled = land;
    inTop.disabled = land;
    inMid.disabled = land;
    inBot.disabled = land;
    for (const node of [inCTop, inCSub, inCBot, inCBack]) node.disabled = !land;
    panelNote.textContent = land
      ? '横版协议卡：三段面板文本只对竖版编译卡有效，所以这里先关掉（大号数值也一样）。'
      : panelSummary(inTop.value, inMid.value, inBot.value);
  }

  /** 背景 / logo 那一块 ← 当前卡；顺带同步模式按钮的选中态与导出按钮的文案/可用态 */
  function refreshAssets(): void {
    const card = current();
    perCardBox.checked = deck.shared.perCardBg;

    /* 模式按钮的选中态与读数（`aria-selected` + `data-active`，两个方向都要同步） */
    for (const kind of ['protocol', 'compile'] as const) {
      const on = mode === kind;
      modeBtns[kind].dataset.active = on ? 'yes' : 'no';
      (modeBtns[kind] as unknown as { setAttribute(n: string, v: string): void })
        .setAttribute('aria-selected', on ? 'true' : 'false');
      modeBtns[kind].classList.toggle('cardmaker-mode-on', on);
    }
    const count = cardsOf(mode).length;
    modeHint.textContent = mode === 'protocol'
      ? `当前模式：协议卡（横版 · 正/背两面）· 整副牌只允许一张，现有 ${count} 张`
      : `当前模式：卡牌（竖版编译卡）· 现有 ${count} 张`;

    /* 导出按钮的文案/可用态跟着模式走（"当前卡"不许再指代不明） */
    exportPng.textContent = mode === 'protocol' ? '导出当前协议卡 PNG（横版 1050×750）' : '导出当前卡 PNG（竖版 750×1050）';
    exportPng.disabled = card === null;
    // 协议卡只有横版形态 ⇒ 竖版导出它对不上；置灰 + 文案说清，而不是点了才报错
    exportPortrait.disabled = mode === 'protocol' || card === null;
    exportPortrait.textContent = mode === 'protocol'
      ? '按竖版编译卡导出（协议卡只有横版形态，已停用）'
      : '按竖版编译卡导出（当前已是竖版成品空间）';

    if (card === null) {
      bgMode.textContent = '没有可编辑的卡';
      logoState.textContent = '未上传 logo';
      zoomInput.value = '100';
      zoomLabel.textContent = '100%';
      zoomInput.disabled = true;
      resetBtn.disabled = true;
      return;
    }
    const bg = bgOf(card);
    bgMode.textContent = bg.type === 'none'
      ? '不使用背景'
      : bg.type === 'preset'
        ? `预设背景：${bg.name ?? '（名字丢了）'}`
        : '自定背景：已上传的图片';
    const pct = Math.round(clampScale(bg.transform.scale) * 100);
    zoomInput.value = String(pct);
    zoomLabel.textContent = `${pct}%`;
    zoomInput.disabled = bg.type === 'none';
    resetBtn.disabled = bg.type === 'none';
    logoState.textContent = logoOf(card).dataUrl ? 'logo：已上传（白色着色）' : '未上传 logo';
  }

  /** 取 2D 上下文（拿不到就返回 null；调用方一律据此跳过绘制） */
  function getCtx(cnv: HTMLCanvasElement): CanvasRenderingContext2D | null {
    try {
      return cnv.getContext('2d');
    } catch {
      return null;
    }
  }

  /**
   * 把一张卡的一个面画到上下文里。
   *
   * 图层（与参考项目一致，**从底到顶**）：
   *  背景 → 面板底衬 → 数值底图 → 卡框 → 白色文字 → 六边形 logo。
   * 横版卡没有"面板底衬/数值底图"这两层（它的面板是卡框自带的三条横条）。
   *
   * ⚠️ **横版的空间是 1039×744**：所有文本区坐标都按那个空间量的。竖版编译卡导出时走
   * "横版画完再逆时针转 90°"（`exportCardPng(portrait = true)`），所以这里按**空间**分派。
   *
   * @returns 背景图是否成功加载（false ⇒ 卡面只有底色，调用方据此提示）
   */
  async function paint(
    ctx: CanvasRenderingContext2D,
    card: CardState,
    side: 'front' | 'back',
    scale: number,
    w: number,
    h: number,
  ): Promise<boolean> {
    const land = w === LAND_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0); // 设计空间作画；导出时整张超采样
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);

    // 1. 背景（两种卡共用同一套 transform：平移量与倍数在设计空间里是同一个数）
    const bg = bgOf(card);
    let img: DrawableImage | null = null;
    let bgOk = true;
    try {
      if (bg.type === 'preset' && bg.name) img = await getPresetImage(bg.name);
      else if (bg.type === 'custom' && bg.dataUrl) img = await getImageFromDataUrl(bg.dataUrl);
    } catch {
      bgOk = false;
    }
    if (img) drawBackground(ctx, img, bg.transform, w, h);
    else {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, w, h);
    }

    const white = '#ffffff';
    if (land) {
      // 2. 横版：卡框（正/背两张）+ 三套文本区
      const frame = side === 'back' ? assets.protocolBack : assets.protocolFront;
      if (frame) ctx.drawImage(frame, 0, 0, w, h);
      const up = (s: string): string => (s || '').trim().toUpperCase();
      const name = up(card.title);
      if (side === 'back') {
        drawLine(ctx, name, PROTOCOL_BACK.name as unknown as TextZone, white);
        drawLine(ctx, up(card.compile.back), PROTOCOL_BACK.backLine as unknown as TextZone, white);
      } else {
        drawLine(ctx, up(card.compile.top), PROTOCOL_FRONT.topBar as unknown as TextZone, white);
        drawLine(ctx, name, PROTOCOL_FRONT.name as unknown as TextZone, white);
        drawLine(ctx, up(card.compile.subtitle), PROTOCOL_FRONT.subtitle as unknown as TextZone, white);
        drawLine(ctx, up(card.compile.bottom), PROTOCOL_FRONT.bottomBar as unknown as TextZone, white);
      }
    } else {
      // 2. 竖版：面板底衬（**只有该面板有文字时才画**）→ 数值底图 → 卡框 → 文字
      if (card.panelTop.trim() && assets.panels.top) ctx.drawImage(assets.panels.top, 0, 0, w, h);
      if (card.panelMid.trim() && assets.panels.mid) ctx.drawImage(assets.panels.mid, 0, 0, w, h);
      if (card.panelBot.trim() && assets.panels.bot) ctx.drawImage(assets.panels.bot, 0, 0, w, h);
      const valImg = await getValueOverlay(card.value);
      if (valImg) ctx.drawImage(valImg as unknown as CanvasImageSource, 0, 0, w, h);
      if (assets.frame) ctx.drawImage(assets.frame, 0, 0, w, h);
      drawLine(ctx, card.title.trim().toUpperCase(), ZONES.title as unknown as TextZone, white);
      drawLine(ctx, card.value.trim(), ZONES.value as unknown as TextZone, white);
      drawPanelText(ctx, card.panelTop, ZONES.panels.top as unknown as PanelZone, white);
      drawPanelText(ctx, card.panelMid, ZONES.panels.mid as unknown as PanelZone, white);
      drawPanelText(ctx, card.panelBot, ZONES.panels.bot as unknown as PanelZone, white);
    }

    // 3. 六边形 logo（白色，裁剪到六边形）
    const logo = logoOf(card);
    if (logo.dataUrl) {
      try {
        const logoImg = await getImageFromDataUrl(logo.dataUrl);
        if (logoImg) {
          const hb = (land
            ? (side === 'back' ? PROTOCOL_BACK.hex : PROTOCOL_FRONT.hex)
            : ZONES.hex) as unknown as HexBox;
          drawLogoHex(ctx, logoImg, hb, hb.pointy, logo);
        }
      } catch {
        /* logo 解不开就当没有；卡面照常 */
      }
    }
    return bgOk;
  }

  /** 预览：把当前卡正面画进屏上那张 canvas；顺带把"预览的是哪一张、多大"写在它下面 */
  async function refreshPreview(): Promise<void> {
    const card = current();
    const seq = ++renderSeq;
    if (card === null) {
      previewSize.textContent = '当前没有可预览的卡';
      return;
    }
    const land = isLandscape(card.kind);
    const w = land ? LAND_W : CARD_W;
    const h = land ? LAND_H : CARD_H;
    // 读数跟着卡走：模式切换之后这里会换成另一套尺寸（测试与 CDP 都读它）
    previewSize.textContent = land
      ? `预览：横版协议卡 · 设计空间 ${LAND_W}×${LAND_H}`
      : `预览：竖版编译卡 · 设计空间 ${CARD_W}×${CARD_H}`;
    previewSize.dataset.orientation = land ? 'landscape' : 'portrait';
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = getCtx(canvas);
    if (!ctx) return; // 没有 2D 上下文（单测桩）：屏上结构照常，只是看不到卡
    const ok = await paint(ctx, card, 'front', 1, w, h);
    if (seq !== renderSeq) return; // 已经有更新的帧在路上，丢掉这一帧
    if (!ok) say('预览没画出来：这张卡的背景图加载失败（换一张图或点「不使用背景」）。', 'preview-failed', 'error');
  }

  function refreshAll(): void {
    formFromCard(current());
    refreshCards();
    refreshAssets();
    void refreshPreview();
  }

  /* ── 拖拽（背景平移 / logo 移动）与滚轮（光标锚定缩放） ── */

  /**
   * 显示尺寸 → 设计空间的换算比例。
   *
   * ⚠️ **不读 `getBoundingClientRect()`**：本仓的单测 DOM 桩默认返回全 0 矩形
   * （`tests/ui/net-dom-stub.ts` 的能力边界），那样算出来的比例会是 Infinity。所以显示
   * 尺寸由 **CSS** 定（`.cardmaker-canvas { width: 100%; max-width: 420px; height: auto }`），
   * 而事件自带的 `offsetX/offsetY` 本来就是**相对画布**的 CSS 像素 ⇒ 比例 =
   * `canvas.width / clientWidth`。桩上没有布局，`clientWidth` 是 undefined ⇒ 回落到 1。
   */
  function scaleFactor(cnv: HTMLCanvasElement): number {
    const shown = Number((cnv as unknown as { clientWidth?: number }).clientWidth) || cnv.width;
    return shown > 0 ? cnv.width / shown : 1;
  }

  /** 事件坐标 → 设计空间坐标（优先用 `offsetX/offsetY`：它已经是相对画布的） */
  function pointOn(cnv: HTMLCanvasElement, ev: { offsetX?: number; offsetY?: number }): { x: number; y: number } {
    const f = scaleFactor(cnv);
    const x = typeof ev.offsetX === 'number' ? ev.offsetX : 0;
    const y = typeof ev.offsetY === 'number' ? ev.offsetY : 0;
    return { x: x * f, y: y * f };
  }

  /** 一个设计空间坐标是否落在六边形里（拖拽/滚轮判断"用户想动的是 logo 还是背景"） */
  function overLogo(px: number, py: number, card: CardState): boolean {
    if (!logoOf(card).dataUrl) return false;
    const hb = (isLandscape(card.kind) ? PROTOCOL_FRONT.hex : ZONES.hex) as unknown as HexBox;
    return px >= hb.x && px <= hb.x + hb.w && py >= hb.y && py <= hb.y + hb.h;
  }

  let dragging = false;
  let dragTarget: 'bg' | 'logo' = 'bg';
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (ev: Event) => {
    const card = current();
    if (card === null) return;
    const e = ev as PointerEvent;
    const p = pointOn(canvas, e);
    dragTarget = overLogo(p.x, p.y, card) ? 'logo' : 'bg';
    if (dragTarget === 'bg' && bgOf(card).type === 'none') return; // 没有背景可拖
    dragging = true;
    lastX = e.clientX ?? 0;
    lastY = e.clientY ?? 0;
    canvas.classList.add('cardmaker-grabbing');
  });

  canvas.addEventListener('pointermove', (ev: Event) => {
    if (!dragging) return;
    const card = current();
    if (card === null) return;
    const e = ev as PointerEvent;
    const f = scaleFactor(canvas);
    const dx = ((e.clientX ?? 0) - lastX) * f;
    const dy = ((e.clientY ?? 0) - lastY) * f;
    lastX = e.clientX ?? 0;
    lastY = e.clientY ?? 0;
    if (dragTarget === 'logo') {
      const logo = logoOf(card);
      logo.offsetX += dx;
      logo.offsetY += dy;
    } else {
      const bg = bgOf(card);
      bg.transform.offsetX += dx;
      bg.transform.offsetY += dy;
    }
    void refreshPreview();
    scheduleSave(1200); // 拖拽中只排一次靠后的保存
  });

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('cardmaker-grabbing');
    refreshAssets();
    scheduleSave(0);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (ev: Event) => {
    const card = current();
    if (card === null) return;
    const e = ev as WheelEvent;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    const bg = bgOf(card);
    if (bg.type === 'none') return;
    const f = scaleFactor(canvas);
    const p = pointOn(canvas, e);
    const ax = typeof e.offsetX === 'number' ? p.x : canvas.width / 2;
    const ay = typeof e.offsetY === 'number' ? p.y : canvas.height / 2;
    const next = zoomAt(bg.transform, canvas.width, canvas.height, ax, ay, (e.deltaY ?? 0) < 0 ? 1.1 : 1 / 1.1);
    bg.transform.scale = next.scale;
    bg.transform.offsetX = next.offsetX;
    bg.transform.offsetY = next.offsetY;
    void f;
    refreshAssets();
    void refreshPreview();
    scheduleSave();
  }, { passive: false });

  /* ── 背景：换 / 上传 / 清 / 缩放滑杆 / 重置 ── */

  function setBg(bg: Bg): void {
    const card = current();
    if (card === null) return;
    if (deck.shared.perCardBg) {
      card.bgOwn = bg;
    } else {
      // 默认模式 = 整副牌一套背景：两种卡一起换（与参考项目的 `setEditBg` 一致）
      deck.shared.compile = { ...deck.shared.compile, bg };
      deck.shared.protocol = { ...deck.shared.protocol, bg };
    }
    refreshAssets();
    void refreshPreview();
    scheduleSave(0);
  }

  bgClear.addEventListener('click', () => {
    setBg({ type: 'none', name: null, dataUrl: null, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
    say('已把背景设为「不使用」：卡面只剩底色与卡框。', 'bg-cleared', 'info');
  });

  bgUpload.addEventListener('click', () => {
    void (async () => {
      const card = current();
      if (card === null) return;
      say('等待你选择一张图片…（选择框里可以取消）', 'bg-waiting', 'info');
      let dataUrl: string | null;
      try {
        dataUrl = await nav.uploadDataUrl('bg');
      } catch (e) {
        say(`读取图片失败：${String(e)}`, 'bg-upload-failed', 'error');
        return;
      }
      if (dataUrl === null) { say('已取消选择图片：屏上没有任何改动。', 'bg-upload-cancelled', 'info'); return; }
      let small: string;
      try {
        // 缩到 2000px 再内嵌：牌组 JSON 要装得下（取舍见 images.ts 的说明）
        small = await normalizeImage(dataUrl);
      } catch (e) {
        say(`这张图片处理不了：${String(e)}`, 'bg-normalize-failed', 'error');
        return;
      }
      setBg({ type: 'custom', name: null, dataUrl: small, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
      say('背景已换成你上传的图片（已自动缩到 2000px 以内，好让牌组 JSON 装得下）。', 'bg-uploaded', 'info');
    })();
  });

  zoomInput.addEventListener('input', () => {
    const card = current();
    if (card === null) return;
    const bg = bgOf(card);
    bg.transform.scale = clampScale(Number(zoomInput.value) / 100);
    const pct = Math.round(bg.transform.scale * 100);
    zoomLabel.textContent = `${pct}%`;
    void refreshPreview();
    scheduleSave();
  });

  resetBtn.addEventListener('click', () => {
    const card = current();
    if (card === null) return;
    const bg = bgOf(card);
    bg.transform = { scale: 1, offsetX: 0, offsetY: 0 };
    refreshAssets();
    void refreshPreview();
    scheduleSave(0);
    say('背景平移与缩放已重置。', 'bg-reset', 'info');
  });

  /* ── logo ── */

  logoUpload.addEventListener('click', () => {
    void (async () => {
      const card = current();
      if (card === null) return;
      say('等待你选择一张 logo 图片…（选择框里可以取消）', 'logo-waiting', 'info');
      let dataUrl: string | null;
      try {
        dataUrl = await nav.uploadDataUrl('logo');
      } catch (e) {
        say(`读取 logo 失败：${String(e)}`, 'logo-upload-failed', 'error');
        return;
      }
      if (dataUrl === null) { say('已取消选择 logo：屏上没有任何改动。', 'logo-upload-cancelled', 'info'); return; }
      let small: string;
      try {
        small = await normalizeLogo(dataUrl);
      } catch (e) {
        say(`这张 logo 处理不了：${String(e)}`, 'logo-normalize-failed', 'error');
        return;
      }
      // logo **整副牌共用**（与参考项目一致：一张卡上的 logo 就是这套牌的标志）
      const logo: Logo = { ...logoOf(card), dataUrl: small };
      if (deck.shared.perCardBg) {
        card.logoOwn = logo;
      } else {
        deck.shared.compile = { ...deck.shared.compile, logo };
        deck.shared.protocol = { ...deck.shared.protocol, logo };
      }
      refreshAssets();
      void refreshPreview();
      scheduleSave(0);
      say('logo 已上传：卡面上会画成白色并裁剪到六边形。', 'logo-uploaded', 'info');
    })();
  });

  logoClear.addEventListener('click', () => {
    const card = current();
    if (card === null) return;
    if (deck.shared.perCardBg) {
      card.logoOwn = { ...card.logoOwn, dataUrl: null };
    } else {
      deck.shared.compile = { ...deck.shared.compile, logo: { ...deck.shared.compile.logo, dataUrl: null } };
      deck.shared.protocol = { ...deck.shared.protocol, logo: { ...deck.shared.protocol.logo, dataUrl: null } };
    }
    refreshAssets();
    void refreshPreview();
    scheduleSave(0);
    say('logo 已清除。', 'logo-cleared', 'info');
  });

  /* ── 文本编辑（写回当前卡 → 重画预览 → 排一次保存） ── */

  function onText(key: 'title' | 'value' | 'panelTop' | 'panelMid' | 'panelBot', input: HTMLInputElement | HTMLTextAreaElement): void {
    input.addEventListener('input', () => {
      const card = current();
      if (card === null) return;
      card[key] = input.value;
      if (key === 'panelTop' || key === 'panelMid' || key === 'panelBot') {
        panelNote.textContent = panelSummary(card.panelTop, card.panelMid, card.panelBot);
      }
      refreshCards();
      void refreshPreview();
      scheduleSave();
    });
  }
  onText('title', inTitle);
  onText('value', inValue);
  onText('panelTop', inTop);
  onText('panelMid', inMid);
  onText('panelBot', inBot);

  function onCompile(key: 'top' | 'subtitle' | 'bottom' | 'back', input: HTMLInputElement): void {
    input.addEventListener('input', () => {
      const card = current();
      if (card === null) return;
      card.compile[key] = input.value;
      refreshCards();
      void refreshPreview();
      scheduleSave();
    });
  }
  onCompile('top', inCTop);
  onCompile('subtitle', inCSub);
  onCompile('bottom', inCBot);
  onCompile('back', inCBack);

  deckTitle.addEventListener('input', () => {
    deck.title = deckTitle.value;
    scheduleSave();
  });

  perCardBox.addEventListener('change', () => {
    deck.shared.perCardBg = perCardBox.checked;
    refreshAssets();
    void refreshPreview();
    scheduleSave(0);
  });

  /* ── 卡的新增 / 删除（都按**当前模式**那种卡来加，并顺手把模式切过去） ── */

  addCompile.addEventListener('click', () => {
    const card = defaultCard(newCardId(), 'compile');
    deck.cards = [...deck.cards, card];
    mode = 'compile';
    screen.dataset.mode = mode;
    currentId = card.id;
    lastSeenId.compile = card.id;
    refreshAll();
    scheduleSave(0);
    say('已加一张竖版编译卡。', 'card-added', 'info');
  });

  addProtocol.addEventListener('click', () => {
    if (cardsOf('protocol').length > 0) {
      say('横版协议卡整副牌只需要一张：先删掉现有那张再加。', 'card-add-refused', 'warn');
      return;
    }
    const card = defaultCard(newCardId(), 'protocol');
    deck.cards = [card, ...deck.cards];
    mode = 'protocol';
    screen.dataset.mode = mode;
    currentId = card.id;
    lastSeenId.protocol = card.id;
    refreshAll();
    scheduleSave(0);
    say('已加一张横版协议卡。', 'card-added', 'info');
  });

  delCard.addEventListener('click', () => {
    const card = current();
    if (card === null) return;
    // 只按**当前模式**判"还能不能删"：删掉一张竖版卡不该被"另一模式还有卡"挡住，
    // 也不该把当前模式删空（清单与预览都必须始终有东西）
    if (cardsOf(mode).length <= 1) return;
    deck.cards = deck.cards.filter((c) => c.id !== card.id);
    if (lastSeenId[mode] === card.id) lastSeenId[mode] = '';
    currentId = cardsOf(mode)[0]?.id ?? '';
    refreshAll();
    scheduleSave(0);
    say('这张卡已删除。', 'card-deleted', 'info');
  });

  /* ── 导出 PNG ── */

  /**
   * 把一张卡渲染到**离屏**画布（不碰屏上那张预览）。
   *
   * ## 两个空间，别混（这是本屏最容易搞错的一处）
   *
   *  - **横版空间 1039×744**：横版协议卡的成品空间；**也是竖版编译卡的"绘制"空间**
   *    —— 竖版卡的三条面板/数值/标题的坐标全是按横版空间量的，卡框在素材目录里是
   *    竖版那张 `frame.png`，横版那张 `protocol-front.png` 是它转出来的。
   *  - **竖版空间 744×1039**：竖版编译卡的**成品**空间（成品 PNG / 打印用）。
   *
   * 所以"按竖版导出"（`portrait === true`）的做法是：**在横版空间画完**，
   * 再整张逆时针转 90° 拿回 744×1039（`rotateToPortrait`）。反着转回去就能一套排版两处用。
   *
   * ⚠️ 这里**不能**按 `land` 取尺寸：竖版编译卡在"画"的时候用的是横版空间。
   * 第一版写成 `land ? LAND : CARD` 并"画完再转" ⇒ 画的是 744×1039 的画布（竖版坐标被当成
   * 横版用），转出来是一张**空白卡**（浏览器自查抓到的：导出那条路没人验过像素）。
   */
  async function renderOffscreen(card: CardState, side: 'front' | 'back', portrait: boolean): Promise<HTMLCanvasElement | null> {
    // 竖版导出 = 在横版空间画；其余情况按卡自己的形态取空间
    const drawLand = portrait || isLandscape(card.kind);
    const w = drawLand ? LAND_W : CARD_W;
    const h = drawLand ? LAND_H : CARD_H;
    const master = dom.createCanvas();
    master.width = w;
    master.height = h;
    const mctx = getCtx(master);
    if (!mctx) return null;
    await paint(mctx, card, side, 1, w, h);
    // 竖版导出 = 横版空间画完再逆时针转 90°；其余两种（协议卡 / 竖版卡的普通导出）
    // 本来就画在成品空间里，**不转**。
    return portrait ? rotateToPortrait(master, dom) : master;
  }

  async function exportCardPng(portrait: boolean): Promise<void> {
    const card = current();
    if (card === null) return;
    if (portrait && isLandscape(card.kind)) {
      say('横版协议卡只有横版形态：这一张按竖版导出没有意义，已跳过。', 'export-refused', 'warn');
      return;
    }
    say('正在渲染…（导出按 300dpi 的成品尺寸，比屏上预览大一档）', 'export-waiting', 'info');
    try {
      const master = await renderOffscreen(card, 'front', portrait);
      if (master === null) { say('这台设备拿不到 2D 画布，没法导出 PNG。', 'export-unsupported', 'error'); return; }
      const out = toPoker(master);
      const name = `${safeFileName(deck.title === '' ? card.title : deck.title, 'card')}-${card.id.slice(0, 6)}.png`;
      await downloadCanvas(out, name, card);
    } catch (e) {
      say(`导出 PNG 失败：${String(e)}`, 'export-failed', 'error');
    }
  }

  /** canvas → PNG Blob → 交给宿主落盘（`toBlob` 拿不到时退化成 data URL 转 Blob） */
  function downloadCanvas(cnv: HTMLCanvasElement, name: string, card: CardState): Promise<void> {
    return new Promise((resolve) => {
      const finish = (blob: Blob): void => {
        nav.download(name, blob);
        say(
          `已导出 ${name}（${cnv.width}×${cnv.height}）`
          + `—— ${card.kind === 'protocol' ? '横版协议卡' : '竖版编译卡'}。`,
          'export-ok',
          'info',
        );
        resolve();
      };
      try {
        if (typeof cnv.toBlob === 'function') {
          cnv.toBlob((blob) => {
            if (blob) { finish(blob); return; }
            say('画布导出失败（浏览器没有给出图片数据）。', 'export-failed', 'error');
            resolve();
          }, 'image/png');
          return;
        }
      } catch {
        /* 落到 data URL 那条路 */
      }
      try {
        const url = typeof cnv.toDataURL === 'function' ? cnv.toDataURL('image/png') : '';
        if (url === '') { say('这台设备不支持导出 PNG。', 'export-unsupported', 'error'); resolve(); return; }
        finish(dataUrlToBlob(url));
      } catch (e) {
        say(`导出 PNG 失败：${String(e)}`, 'export-failed', 'error');
        resolve();
      }
    });
  }

  exportPng.addEventListener('click', () => { void exportCardPng(false); });
  exportPortrait.addEventListener('click', () => { void exportCardPng(true); });

  /* ── 导出 / 导入牌组 JSON ── */

  exportJson.addEventListener('click', () => {
    try {
      const text = stringifyDeck(deck);
      const name = `${safeFileName(deck.title, 'deck')}.cardmaker.json`;
      nav.download(name, new Blob([text], { type: 'application/json' }));
      say(`已导出 ${name}（自定图以 base64 内嵌，预设背景按名字引用）。`, 'export-json-ok', 'info');
    } catch (e) {
      say(`导出牌组失败：${String(e)}`, 'export-json-failed', 'error');
    }
  });

  importJson.addEventListener('click', () => {
    void (async () => {
      say('等待你选择牌组 JSON…（选择框里可以取消）', 'import-waiting', 'info');
      let text: string | null;
      try {
        text = await nav.readTextFile('.json,application/json');
      } catch (e) {
        say(`读取文件失败：${String(e)}`, 'import-read-failed', 'error');
        return;
      }
      if (text === null) { say('已取消导入：屏上没有任何改动。', 'import-cancelled', 'info'); return; }
      const parsed = parseDeck(text);
      if (!parsed.ok) {
        // 四类失败各自可辨识：选错文件 / 文件坏了 / 版本不认识 / 形状不对
        say(`导入失败：${parsed.message}`, `import-${parsed.code}`, 'error');
        return;
      }
      deck = parsed.deck;
      currentId = deck.cards[0]?.id ?? '';
      deckTitle.value = deck.title;
      refreshAll();
      void saveNow();
      say(`已导入 ${deck.cards.length} 张卡。`, 'import-ok', 'info');
    })();
  });

  /* ── 启动：读本机 → 载素材与字体 → 画第一帧 ── */

  void (async () => {
    try {
      const saved = await nav.store.load();
      if (saved !== null) {
        deck = hydrateDeck(saved);
        say(`已从本机读回保存的牌组（${deck.cards.length} 张卡）。`, 'loaded', 'info');
      }
    } catch (e) {
      say(`读取本机保存的牌组失败：${String(e)}（先用一份空牌组继续）`, 'load-failed', 'error');
    }
    if (deck.cards.length === 0) {
      // 开局给两张卡：两种形态在屏上都看得见（用户要编辑的就是这两种）
      deck.cards = [defaultCard(newCardId(), 'compile'), defaultCard(newCardId(), 'protocol')];
    }
    /**
     * 开局停在哪个模式：**竖版编译卡**那一档（整副牌做卡的主体）。
     * 牌组里恰好只有协议卡时（用户手改过的牌组）就停在协议卡，免得开局先给一张空白卡。
     */
    mode = cardsOf('compile').length > 0 ? 'compile' : 'protocol';
    screen.dataset.mode = mode;
    const startList = cardsOf(mode);
    currentId = startList[0]?.id ?? '';
    lastSeenId[mode] = currentId;
    deckTitle.value = deck.title;
    hydrated = true;
    refreshAll();
    // 素材与字体装好之后**重画一帧**：不重画的话第一帧是 fallback 字体，字宽与设计稿不同
    await loadAssets();
    await loadFonts();
    refreshAll();
  })();
}

/* ── 与本屏注入的 `dom` 配套的两处薄封装 ──────────────────────────────── */

/**
 * 横版母版 → 竖版卡（744×1039，逆时针 90°）。
 *
 * 这里没有直接调 `draw.ts` 的 `rotateToPortrait`：那个函数走全局 `document`，
 * 而本屏允许注入 `dom`（单测靠它喂桩）。两处实现同一件事 —— 所以 `draw.ts` 那份
 * 由**卡框素材的预旋转**使用（`main.ts` 的 `loadCardmakerAssets`），本行由导出的那条路使用。
 */
export function rotateToPortrait(master: HTMLCanvasElement, dom: CardmakerDom): HTMLCanvasElement | null {
  const out = dom.createCanvas();
  out.width = CARD_H;
  out.height = CARD_W;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = out.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(0, out.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(master, 0, 0);
  return out;
}

/** data URL → Blob（只给"没有 `toBlob`"的环境用；`atob` 是浏览器自带的，零依赖） */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
