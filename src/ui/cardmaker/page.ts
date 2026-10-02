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
 *
 * ★ 2026-10-02（i18n 逐屏抽取）：本屏玩家可见文案搬进 src/i18n/（键 cardmaker.*），中文值逐字等于改动前的字面量。
 */
import { t } from '../../i18n';
import {
  ASSET_BASE,
  CARD_H,
  CARD_W,
  LAND_H,
  LAND_W,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  LOGO_SCALE_STEP,
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
import { clampLogoScale, clampScale, zoomAt } from './geometry';
import {
  getImageFromDataUrl,
  getPresetImage,
  getValueOverlay,
  loadFonts,
  normalizeImage,
  normalizeLogo,
  removeLogoBackground,
  shouldWhitenLogo,
  type DrawableImage,
} from './images';
import { hydrateDeck } from './model';
import { parseDeck, safeFileName, stringifyDeck } from './serialize';
import { toPoker, drawBackground, drawLogoHex } from './draw';
import { drawLine, drawPanelText } from './text';
import { defaultCard, defaultDeck, isLandscape, type Bg, type CardKind, type CardSide, type CardState, type Deck, type Logo } from './types';

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

/**
 * 屏上那句署名里的关键事实（测试直接引用这些常量，不手抄一遍文案）。
 *
 * ⚠️ **这里是纯数据，不许出现 `t()`**（★ 2026-10-02 i18n 抽取时定的）：模块级对象只在
 * 模块被 import 的那一刻求值一次，`t()` 写在这儿会把"那一刻的语言"冻住 —— 之后切语言，
 * 署名那两处就会停在旧语言上。取文案一律在**渲染点**（`creditMeta` / `credit` 那几行）。
 *
 * ⚠️ 这几个中文字面量与 `src/i18n/zh.ts` 里对应键的**值逐字相同**（那份值才是屏上真正的
 * 出处）⇒ 本文件与 `src/ui/fx-settings.ts` 同属"剩下的中文是数据源、不是第二份文案"那一档，
 * 由 `tests/i18n/unextracted-manifest.test.ts` 的 `CLEAN_DECLARED` 逐条自证。
 * `sentence` 写成**一整行**就是为了那条自证能逐字比对（两行拼接的同一个串比不出来）。
 */
export const CREDIT = {
  project: 'COMPILER · Card Builder',
  author: 'Albert Blanco',
  // ⚠️ 取的是**表里的值**（`t('cardmaker.page.credit.license-value')`）而不是就地写中文字面量：
  //    于是"屏上那一份许可名"只有表里一个家，本文件剩下的中文都是**数据源**
  //    （由 `tests/i18n/unextracted-manifest.test.ts` 的 `CLEAN_DECLARED` 逐条自证）。
  license: t('cardmaker.page.credit.license-value'),
  url: 'https://github.com/albrtbc/compiler',
  /** 许可原文在仓库里的路径（页面底部也写上，用户能照着去翻） */
  licensePath: 'public/assets/cardmaker/LICENSE-COMPILER-Card-Builder.txt',
  sentence: '本制作器参考开源项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可）制作，素材（卡框/背景/卡背/字体）亦来自该项目。',
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
  // ⚠️ 这三个形参名**不叫 `t`**（★ 2026-10-02 i18n 抽取时改的）：`t` 现在是本文件 import 的
  // 文案取值函数，用同名局部形参会把它遮住（`panelSummary` 里正要调它取文案）。
  const panels = [top, mid, bot].map((s) => (s || '').replace(/\s+$/g, ''));
  const filled = panels.filter((s) => s.trim() !== '');
  if (filled.length === 0) return t('cardmaker.page.panel.empty-hint');
  const paras = filled.reduce((n, s) => n + s.split('\n').length, 0);
  const marksPhrase = filled.some((s) => s.includes('**') || s.includes('__'))
    ? t('cardmaker.page.panel.marks-phrase')
    : '';
  return t('cardmaker.page.panel.summary', {
    n: String(filled.length),
    paras: String(paras),
    marks: marksPhrase,
    min: String(PANEL_MIN),
    max: String(PANEL_MAX),
  });
}

/**
 * 面板全空的提示（与参考项目一致：没有文字就不画面板底衬）。
 *
 * ⚠️ 这是**纯数据常量**，不是取文案的地方：模块级 `t()` 会把 import 那一刻的语言冻住
 * （理由见 `CREDIT`）。屏上那句由 `t('cardmaker.page.panel.empty-hint')` 在渲染点取。
 */
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
  // 协议卡当前在编哪一面（初值 front；`setFace` 更新它）。写在屏上便于测试/CDP 读。
  screen.dataset.face = 'front';
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
  /**
   * 协议卡现在在编**哪一面**（用户 2026-10-01 要求"协议卡背的设计切换"）。
   *
   * 只在 `mode === 'protocol'` 时有意义；竖版编译卡没有第二个面（它的 `facesOf` 只有一个）。
   * 切换面与切换模式是**两件事**，各自独立：从协议卡背面切到竖版卡、再切回来，仍然停在背面。
   */
  let face: CardSide = 'front';
  // 屏上一开始就标出来（测试与 CDP 都读 `screen.dataset.face`；切面时由 `setFace` 更新）。
  // ⚠️ 这一句必须在 `screen` 建好之后 —— 见下面 `const screen = ...`。

  /* ── ① 顶栏 ── */
  const top = el('div', 'cardmaker-top');
  const backBtn = btnRole('btn', 'back', t('cardmaker.page.back'));
  backBtn.addEventListener('click', () => { nav.back(); });
  top.appendChild(backBtn);
  top.appendChild(el('h1', 'cardmaker-title', t('cardmaker.page.title')));
  const saveBtn = btnRole('btn', 'save', t('cardmaker.page.save'));
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
    protocol: btnRole('btn cardmaker-mode', 'mode-protocol', t('cardmaker.page.mode.protocol')),
    compile: btnRole('btn cardmaker-mode', 'mode-compile', t('cardmaker.page.mode.compile')),
  };
  (modeBtns.protocol as unknown as { setAttribute(n: string, v: string): void }).setAttribute('role', 'tab');
  (modeBtns.compile as unknown as { setAttribute(n: string, v: string): void }).setAttribute('role', 'tab');
  modeBtns.protocol.addEventListener('click', () => { setMode('protocol'); });
  modeBtns.compile.addEventListener('click', () => { setMode('compile'); });
  modeBar.appendChild(modeBtns.protocol);
  modeBar.appendChild(modeBtns.compile);
  modeBar.appendChild(modeHint);
  screen.appendChild(modeBar);

  /**
   * ★★ 2026-10-01（用户要求）：**协议卡的正 / 背切换**。
   *
   * 用户原话：「协议卡自定义选项里没有协议卡背的设计切换按钮，请调整」。
   *
   * 参考项目里协议卡是**双面**的（`renderCompileLandscape` 的 `side` 分支）：
   *  - **正面**：`COMPILE_FRONT` 四条横条 —— topBar → name → subtitle → bottomBar；
   *  - **背面**：`COMPILE_BACK` 两条 —— name（厚底栏左半）+ backLine。
   * 参考项目的编辑器两块画布并排显示（正面 / 背面），本项目是**单预览**，
   * 所以这里用一组次级 tab 来切"在编哪一面"（语义比并排两个小画布清楚：一次只编一面）。
   *
   * 与模式 tab 的层级关系：模式 tab 决定"编哪种卡"，这一组只在**协议卡模式**下出现
   * （`refreshAssets` 里按模式开关 `hidden`）；切面**不丢**编辑内容（内容一直在 `deck` 里，
   * 这里只切"在看哪一面"），导出时按当前面导出（见 `exportCardPng`）。
   */
  const faceBar = elRole('div', 'cardmaker-faces', 'faces');
  (faceBar as HTMLElement & { setAttribute(n: string, v: string): void }).setAttribute('role', 'tablist');
  faceBar.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.face.which')));
  const faceBtns: Record<CardSide, HTMLButtonElement> = {
    front: btnRole('btn cardmaker-mini cardmaker-face', 'face-front', t('cardmaker.page.face.front')),
    back: btnRole('btn cardmaker-mini cardmaker-face', 'face-back', t('cardmaker.page.face.back')),
  };
  (faceBtns.front as unknown as { setAttribute(n: string, v: string): void }).setAttribute('role', 'tab');
  (faceBtns.back as unknown as { setAttribute(n: string, v: string): void }).setAttribute('role', 'tab');
  faceBtns.front.addEventListener('click', () => { setFace('front'); });
  faceBtns.back.addEventListener('click', () => { setFace('back'); });
  faceBar.appendChild(faceBtns.front);
  faceBar.appendChild(faceBtns.back);
  screen.appendChild(faceBar);

  /** 状态区：本屏**唯一**的提示通道（人读 `textContent`，机器读 `data-code`） */
  const status = elRole('div', 'cardmaker-status', 'status');
  status.dataset.code = 'none';
  status.dataset.kind = 'none';
  // 默认文案直接说清"存到哪"，因为两档（允许 / 游客）的后果**不一样**
  status.textContent = nav.store.isPersistent()
    ? t('cardmaker.page.status.persistent')
    : t('cardmaker.page.status.memory');
  screen.appendChild(status);
  const say = (msg: string, code: string, kind: 'info' | 'warn' | 'error'): void => {
    status.textContent = msg;
    status.dataset.code = code;
    status.dataset.kind = kind;
  };

  screen.appendChild(el(
    'p',
    'cardmaker-note',
    t('cardmaker.page.geometry-note', {
      cw: String(CARD_W),
      ch: String(CARD_H),
      lw: String(LAND_W),
      lh: String(LAND_H),
    })
    + t('cardmaker.page.geometry-note.export'),
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
  const previewSize = elRole('div', 'cardmaker-note', 'preview-size', t('cardmaker.page.preview.portrait', { w: String(CARD_W), h: String(CARD_H) }));
  previewSize.dataset.orientation = 'portrait';
  previewWrap.appendChild(previewSize);
  previewWrap.appendChild(el(
    'div',
    'cardmaker-note',
    t('cardmaker.page.canvas-help')
    + t('cardmaker.page.canvas-help.sliders'),
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
  const resetBtn = btnRole('btn cardmaker-mini', 'reset-view', t('cardmaker.page.bg-reset'));
  adjust.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.bg-zoom')));
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
  deckTitle.placeholder = t('cardmaker.page.deck-title.placeholder');
  deckRow.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.deck-title')));
  deckRow.appendChild(deckTitle);
  optionsCol.appendChild(deckRow);

  const cardsHost = elRole('div', 'cardmaker-cards', 'cards');
  optionsCol.appendChild(cardsHost);

  /**
   * ★ 2026-10-01（用户要求"去掉「新增横版协议卡」按钮"）：这一排现在**只剩两枚**。
   *
   * 为什么那枚是多余的（两条都是当时实测的现状）：
   *  1. 整副牌只允许一张协议卡 —— 它唯一能干的事是"在零张时建一张"，而这件事
   *     `setMode('protocol')` 已经做了（`ensureCardOf()`，结论码 `mode-created-card`）；
   *  2. 已经有一张时点它只会得到 `card-add-refused` 警告 ⇒ 它是个**必然失败或必然多余**的按钮。
   * 所以按钮、它的处理函数、`card-add-refused` 结论码一起删掉，**两种模式里都不留**
   * （测试里那条"第二张加不进来"的腿改成"这枚按钮根本不存在"的锚点）。
   */
  const cardActions = el('div', 'cardmaker-actions');
  const addCompile = btnRole('btn', 'add-compile', t('cardmaker.page.card-add'));
  const delCard = btnRole('btn', 'delete-card', t('cardmaker.page.card-delete'));
  cardActions.appendChild(addCompile);
  cardActions.appendChild(delCard);
  optionsCol.appendChild(cardActions);

  /* ── ④ 编辑表单（只编辑**当前卡**，而且**只摆当前模式那套字段**） ──
   *
   * ★★ 2026-10-01（用户要求）：用户原话「如果切换成自定义协议模式，就只显示自定义协议模式
   * 相关的修改选项或者文本框，不要显示卡牌的修改选项或者文本框，自定义卡牌模式同理」。
   *
   * 所以每个字段的**行**（`label.cardmaker-field`，含标签与提示）都登记在
   * `modeFields` 里，切换模式时由 `syncModeFields()` 用 `hidden` 逐行开关 ——
   * **隐藏**（不是"摆着但禁用"）：用户在协议卡模式下**读不到**竖版那三段面板那一套。
   *
   * 归属是按**参考项目的几何**定的（`src/config.js` 的 `ZONES` / `COMPILE_FRONT` /
   * `COMPILE_BACK` 三张分区表），不是"能填就留着"：
   *  - `ZONES{title,value,panels×3,hex}` = **竖版编译卡**那套（`renderCard` 用它）；
   *  - `COMPILE_FRONT{topBar,name,subtitle,bottomBar,hex}` + `COMPILE_BACK{name,backLine,hex}`
   *    = **横版协议卡**那套（`renderCompileLandscape` 用它）。
   *
   * 逐字段的归属（**这里就是判据的唯一出处**）：
   *  | 字段 | 竖版编译卡 | 协议卡 | 依据 |
   *  |---|---|---|---|
   *  | 协议名 / 标题 | 有（`ZONES.title` 左上角） | 有（`COMPILE_FRONT.name` 正中大标题） | 两边都在 |
   *  | 数值 | 有（`ZONES.value` 大号中心数字） | **无** | 协议卡的三张分区表里没有数值位 |
   *  | 上/中/下三面板 | 有（`ZONES.panels`） | **无** | 横版协议卡只有顶栏/标题/副标题/底栏四条横条 |
   *  | 横版左上角小字 | **无** | 有（`COMPILE_FRONT.topBar`） | 同上 |
   *  | 横版副标题 | **无** | 有（`COMPILE_FRONT.subtitle`） | 同上 |
   *  | 横版底部小字 | **无** | 有（`COMPILE_FRONT.bottomBar`） | 同上 |
   *  | 横版背面那行字 | **无** | 有（`COMPILE_BACK.backLine`） | 只有协议卡有两个面 |
   *
   * 两种模式**都用得到**的东西（牌组名 / 背景 / 每卡背景开关 / logo / 导出导入 / 卡清单 /
   * 模式切换 / 状态行 / 署名）**照旧一直显示**，不参与这里的开关。
   */
  const form = elRole('div', 'cardmaker-form', 'form');
  /**
   * 每个字段行的归属：
   *  - `kind`：哪种卡（`null` = 两种模式都显示）；
   *  - `face`：**协议卡**的哪一面（`null` = 两面都显示；`'front'`/`'back'` 只在协议卡模式下有意义）。
   *
   * `face` 这一维是 2026-10-01 用户要"协议卡正/背切换"之后补的：切换面时同样只显示
   * 该面的字段（与"只显示当前模式字段"是同一套口径）。
   */
  const modeFields: Array<{ row: HTMLElement; kind: CardKind | null; face: CardSide | null }> = [];
  const trackRow = (row: HTMLElement, kind: CardKind | null, face: CardSide | null = null): void => {
    modeFields.push({ row, kind, face });
  };
  const field = (role: string, label: string, kind: CardKind | null, face: CardSide | null, hint?: string): HTMLInputElement => {
    const row = el('label', 'cardmaker-field');
    row.appendChild(el('span', 'cardmaker-label', label));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cardmaker-input';
    input.dataset.role = role;
    row.appendChild(input);
    if (hint) row.appendChild(el('span', 'cardmaker-hint', hint));
    form.appendChild(row);
    trackRow(row, kind, face);
    return input;
  };
  const area = (role: string, label: string, kind: CardKind | null, face: CardSide | null, hint?: string): HTMLTextAreaElement => {
    const row = el('label', 'cardmaker-field');
    row.appendChild(el('span', 'cardmaker-label', label));
    const input = document.createElement('textarea');
    input.className = 'cardmaker-textarea';
    input.rows = 3;
    input.dataset.role = role;
    row.appendChild(input);
    if (hint) row.appendChild(el('span', 'cardmaker-hint', hint));
    form.appendChild(row);
    trackRow(row, kind, face);
    return input;
  };

  /**
   * 逐字段归属（**唯一出处**，按参考项目的分区表定；不是"能填就留着"）：
   *
   * | 字段 | 竖版编译卡 | 协议卡正面 | 协议卡背面 | 依据 |
   * |---|---|---|---|---|
   * | 协议名 / 标题 | 有（`ZONES.title` 左上角） | 有（`COMPILE_FRONT.name` 正中大标题） | 有（`COMPILE_BACK.name` 厚底栏左半） | 三处都画 |
   * | 数值 | 有（`ZONES.value`） | **无** | **无** | 协议卡的分区表里没有数值位 |
   * | 上/中/下三面板 | 有（`ZONES.panels`） | **无** | **无** | 横版卡只有四条横条 |
   * | 协议卡左上角小字 | **无** | 有（`COMPILE_FRONT.topBar`） | **无** | 只有正面画 topBar |
   * | 协议卡副标题 | **无** | 有（`COMPILE_FRONT.subtitle`） | **无** | 只有正面画 subtitle |
   * | 协议卡底部小字 | **无** | 有（`COMPILE_FRONT.bottomBar`） | **无** | 只有正面画 bottomBar |
   * | 协议卡背面那行字 | **无** | **无** | 有（`COMPILE_BACK.backLine`） | 只有背面画 backLine |
   */
  const inTitle = field('title', t('cardmaker.page.field.title'), null, null, t('cardmaker.page.field.title.hint'));
  const inValue = field('value', t('cardmaker.page.field.value'), 'compile', null);
  const inTop = area('panel-top', t('cardmaker.page.field.panel-top'), 'compile', null, t('cardmaker.page.field.panel.hint'));
  const inMid = area('panel-mid', t('cardmaker.page.field.panel-mid'), 'compile', null, t('cardmaker.page.field.panel.hint'));
  const inBot = area('panel-bot', t('cardmaker.page.field.panel-bot'), 'compile', null, t('cardmaker.page.field.panel.hint'));
  const inCTop = field('compile-top', t('cardmaker.page.field.compile-top'), 'protocol', 'front');
  const inCSub = field('compile-subtitle', t('cardmaker.page.field.compile-subtitle'), 'protocol', 'front');
  const inCBot = field('compile-bottom', t('cardmaker.page.field.compile-bottom'), 'protocol', 'front');
  const inCBack = field('compile-back', t('cardmaker.page.field.compile-back'), 'protocol', 'back');
  optionsCol.appendChild(form);

  const panelNote = elRole('p', 'cardmaker-note', 'panel-note', t('cardmaker.page.panel.empty-hint'));
  // 面板说明紧贴它描述的那三个输入框（它们是 `form` 里的成员）⇒ 进**同一条 `label`**
  // 会让点击说明也聚焦输入框；这里保持同级块，按顺序紧跟表单。
  // ★ 它是**竖版专用**的说明（讲三段面板的），所以跟着竖版那三个字段一起开关。
  trackRow(panelNote, 'compile', null);
  optionsCol.appendChild(panelNote);

  /* ── ⑤ 背景 ── */
  const bgRow = elRole('div', 'cardmaker-bg', 'bg');
  const bgMode = elRole('span', 'cardmaker-note', 'bg-mode', t('cardmaker.page.bg.none'));
  bgRow.appendChild(bgMode);
  const bgActions = el('div', 'cardmaker-actions');
  const bgUpload = btnRole('btn cardmaker-mini', 'bg-upload', t('cardmaker.page.bg.upload'));
  const bgClear = btnRole('btn cardmaker-mini', 'bg-clear', t('cardmaker.page.bg.none'));
  bgActions.appendChild(bgUpload);
  bgActions.appendChild(bgClear);
  bgRow.appendChild(bgActions);
  const presetHost = elRole('div', 'cardmaker-presets', 'presets');
  for (const name of PRESETS) {
    const presetBtn = btnRole('btn cardmaker-thumb', `preset-${name}`, name);
    presetBtn.addEventListener('click', () => {
      setBg({ type: 'preset', name, dataUrl: null, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
      say(t('cardmaker.page.bg.preset-ok', { name }), 'bg-preset', 'info');
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
  perCardRow.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.per-card-bg')));
  optionsCol.appendChild(perCardRow);

  /* ── ⑥ logo ── */
  const logoRow = elRole('div', 'cardmaker-row', 'logo');
  const logoState = elRole('span', 'cardmaker-note', 'logo-state', t('cardmaker.page.logo.none'));
  const logoUpload = btnRole('btn cardmaker-mini', 'logo-upload', t('cardmaker.page.logo.upload'));
  const logoClear = btnRole('btn cardmaker-mini', 'logo-clear', t('cardmaker.page.logo.clear'));
  // 行首这句只描述位置，**不再写"白色着色"**：勾与不勾是两种画法，那句话在"原图直上"下是错的
  logoRow.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.logo.label')));
  logoRow.appendChild(logoState);
  logoRow.appendChild(logoUpload);
  logoRow.appendChild(logoClear);
  /**
   * ★ 2026-10-01（用户要求"改死语义"）：**「去掉 logo 背景（推荐）」开关**（默认开）。
   *
   * 两种状态**各自是完整的处理方式**，不是"开/关某个修饰"：
   *  - **勾选（默认）** = 抠掉与四边相连的背景 → 再染成白色（卡面 logo 是白色的）；
   *  - **不勾选** = **原图直上**：不抠背景、不染白、不做任何处理，原图的颜色与背景原样进卡面。
   *
   * 文案把这两条写清楚（用户上一轮的困惑正是"没说清不勾选会怎样"），并且**如实**交代
   * 勾选时的两种结局：抠成了才染白；抠图因可疑而放弃时**不染白**（放原图，见 `shouldWhitenLogo`）。
   */
  const logoCutRow = el('label', 'cardmaker-toggle');
  const logoCutBox = document.createElement('input');
  logoCutBox.type = 'checkbox';
  logoCutBox.className = 'cardmaker-check';
  logoCutBox.dataset.role = 'logo-cutout';
  logoCutBox.checked = true;
  logoCutRow.appendChild(logoCutBox);
  logoCutRow.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.logo.cutout')));
  logoCutRow.appendChild(el(
    'span',
    'cardmaker-hint',
    t('cardmaker.page.logo.cutout.hint.1')
    + t('cardmaker.page.logo.cutout.hint.2')
    + t('cardmaker.page.logo.cutout.hint.3')
    + t('cardmaker.page.logo.cutout.hint.4'),
  ));
  optionsCol.appendChild(logoRow);

  /**
   * ★ 2026-10-01（用户要求）：**标志自己的缩放条** —— 与背景那条**互相独立**。
   *
   * 用户原话：「给标志也加上独立的一条放大缩小缩放条」。所以：
   *  - 上下限与步进来自 `config.ts` 的 `LOGO_SCALE_MIN/MAX/STEP`（50%~200%、步进 5%），
   *    与背景的 25%~1600% 是**两条独立的区间**（`clampLogoScale()` vs `clampScale()`）；
   *  - 写回的地方是 **`logoOf(card)` 指的那个对象**（见 `setLogoZoom()`）——
   *    logo 的作用域是什么，缩放的作用域就是什么（默认"每种卡型一个、整副共用"；
   *    打开「每张卡单独的背景」之后变成每卡一份）；
   *  - 锚点在绘制层（`drawLogoHex()` 里以六边形中心对齐），滑杆只改一个倍数。
   *
   * 做法照抄背景那条：标签 + `input[type=range]` + 百分比读数 + 重置按钮，
   * 类名沿用既有的 `.cardmaker-row` / `.cardmaker-range` / `.cardmaker-mini`（不新增 CSS）。
   */
  const logoZoomRow = elRole('div', 'cardmaker-row', 'logo-zoom-row');
  const logoZoom = document.createElement('input');
  logoZoom.type = 'range';
  logoZoom.className = 'cardmaker-range';
  logoZoom.dataset.role = 'logo-zoom';
  logoZoom.min = String(Math.round(LOGO_SCALE_MIN * 100));
  logoZoom.max = String(Math.round(LOGO_SCALE_MAX * 100));
  // ⚠️ `step` 是**百分比读数上的步进**（5 ⇒ 100 → 105 → 110…），不是 0.05 那个倍数
  logoZoom.step = String(LOGO_SCALE_STEP);
  (logoZoom as unknown as { setAttribute(n: string, v: string): void }).setAttribute('aria-label', t('cardmaker.page.logo.zoom'));
  const logoZoomValue = elRole('span', 'cardmaker-note', 'logo-zoom-value', '100%');
  const logoZoomReset = btnRole('btn cardmaker-mini', 'logo-zoom-reset', t('cardmaker.page.logo.zoom-reset'));
  logoZoomRow.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.logo.zoom')));
  logoZoomRow.appendChild(logoZoom);
  logoZoomRow.appendChild(logoZoomValue);
  logoZoomRow.appendChild(logoZoomReset);
  logoZoomRow.appendChild(el(
    'span',
    'cardmaker-hint',
    t('cardmaker.page.logo.zoom-hint.1', { min: String(Math.round(LOGO_SCALE_MIN * 100)), max: String(Math.round(LOGO_SCALE_MAX * 100)) })
    + t('cardmaker.page.logo.zoom-hint.2')
    + t('cardmaker.page.logo.zoom-hint.3')
    + t('cardmaker.page.logo.zoom-hint.4'),
  ));
  optionsCol.appendChild(logoZoomRow);

  optionsCol.appendChild(logoCutRow);

  /* ── ⑦ 导出 / 导入（按用途分两组） ──
   *
   * ★ 2026-10-01（用户："图中的这四个按钮我感觉没啥用呀，是不是重复了"）：
   *
   *  - **删掉了「按竖版编译卡导出」**：它是**真正的残留废按钮** —— 模式 tab 已经能把当前卡
   *    切成竖版/横版，而它只对竖版卡有意义（协议卡模式下永远是置灰摆设）。
   *    它的禁用态分支、`export-refused` 结论码与对应测试一并删掉（测试改成"这个按钮不存在"）。
   *  - 留下的一行**按用途分两组**（不是四个并列的按钮）：
   *      · **导出图片**：当前卡 PNG（尺寸跟着当前模式：竖版 750×1050 / 横版 1050×750）；
   *      · **牌组存档**：导出 / 导入 JSON（换设备、备份用 —— 与"导出一张图"是两回事）。
   *    文案统一成"导出…"的动宾式，不再出现"当前卡 PNG"这种半截指代。
   */
  const ioRow = elRole('div', 'cardmaker-actions', 'io');
  const imgGroup = elRole('div', 'cardmaker-group', 'io-image');
  imgGroup.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.io.image')));
  // 初始文案就直接是**竖版**那一套（`refreshAll()` 之后由 `syncModeFields` 按模式/面重写；
  // 首帧也不许出现"当前卡"这种半截指代 —— 用户上一轮的困惑原话就是"这四个按钮重复了"）
  const exportPng = btnRole('btn', 'export-png', t('cardmaker.page.export-png.portrait'));
  imgGroup.appendChild(exportPng);
  const deckGroup = elRole('div', 'cardmaker-group', 'io-deck');
  deckGroup.appendChild(el('span', 'cardmaker-note', t('cardmaker.page.io.deck')));
  const exportJson = btnRole('btn cardmaker-mini', 'export-json', t('cardmaker.page.export-json'));
  const importJson = btnRole('btn cardmaker-mini', 'import-json', t('cardmaker.page.import-json'));
  deckGroup.appendChild(exportJson);
  deckGroup.appendChild(importJson);
  ioRow.appendChild(imgGroup);
  ioRow.appendChild(deckGroup);
  optionsCol.appendChild(ioRow);

  /* ── ⑧ 署名（用户明确要求：显眼且准确） ── */
  const credit = elRole('footer', 'cardmaker-credit', 'credit');
  credit.appendChild(elRole('p', 'cardmaker-credit-line', 'credit-sentence', t('cardmaker.page.credit.sentence')));
  const creditMeta = el('div', 'cardmaker-credit-meta');
  creditMeta.appendChild(elRole('span', 'cardmaker-credit-item', 'credit-author', t('cardmaker.page.credit.author', { author: CREDIT.author })));
  creditMeta.appendChild(elRole('span', 'cardmaker-credit-item', 'credit-license', t('cardmaker.page.credit.license-label', { license: CREDIT.license })));
  const creditLink = elRole('a', 'cardmaker-credit-link', 'credit-link', CREDIT.url) as HTMLAnchorElement;
  creditLink.href = CREDIT.url;
  creditLink.target = '_blank';
  creditLink.rel = 'noreferrer';
  creditMeta.appendChild(creditLink);
  credit.appendChild(creditMeta);
  credit.appendChild(elRole('p', 'cardmaker-note', 'credit-license-path', t('cardmaker.page.credit.license-path', { path: CREDIT.licensePath })));
  screen.appendChild(credit);

  root.appendChild(screen);

  /* ── 素材（懒加载一次） ── */
  const assets: {
    frame: HTMLImageElement | null;
    panels: Record<'top' | 'mid' | 'bot', HTMLImageElement | null>;
    /**
     * ★ 协议卡的两张帧：**已经是横版 1039×744 的成品帧**（加载时由 `rotateAsset90ccw`
     * 从竖版素材 `protocol-front/back.png` 转出来的）。绘制层直接按横版空间整张画。
     */
    protocolFront: HTMLCanvasElement | null;
    protocolBack: HTMLCanvasElement | null;
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
   * 把一张**竖版**素材（744×1039）逆时针转 90° 成横版（1039×744）。
   *
   * ## ★★ 2026-10-01（用户报"协议卡默认版图做错了"的根因修法）
   *
   * `card-frame/protocol-front.png` / `protocol-back.png` **本身是竖版的 744×1039**
   * （实测：像素统计里内容纵向占 99.3%，且自然尺寸就是 744×1039）—— 素材目录里
   * **没有**第二套横版美术，横版卡框就是把竖版那两张转 90° 得到的。
   * 参考项目在**加载时**就转好（`app.js:3035-3036` 的 `rotate90ccw(cFront)`），
   * 再按 1039×744 画（`drawImage(frame, 0, 0, LAND_W, LAND_H)`）。
   *
   * 我们第一版**漏了这一步**：把竖版帧直接 `drawImage(frame, 0, 0, 1039, 744)`
   * ⇒ cover 式缩放成 744×744 贴中间，两侧各留 147.5px 黑边 —— 用户截图里那个
   * "黑底 + 两侧白色怪形状"的矩形就是这个（见 `.superpowers/cardmaker/frame-wrong.png`
   * 与 `frame-right.png` 两张对照截图）。
   *
   * 为什么在**加载时**转（而不是每次绘制转一次）：参考项目也是这么做的，而且它把
   * "转了 90° 的帧"这件事变成一个**成品素材**，绘制路径里就只剩一条
   * `drawImage(landFrame, 0, 0, LAND_W, LAND_H)`，没有"这里要不要转"的分支可写错。
   * 代价是每张帧多一块 1039×744 的离屏画布（两张，约 6MB 显存），可忽略。
   *
   * 拿不到 2D 上下文时回 `null`（绘制层当"这一层没有"，不抛）。
   */
  function rotateAsset90ccw(img: HTMLImageElement): HTMLCanvasElement | null {
    const out = dom.createCanvas();
    out.width = img.naturalHeight || LAND_W;
    out.height = img.naturalWidth || LAND_H;
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
    ctx.drawImage(img, 0, 0);
    return out;
  }

  /**
   * 六张素材：竖版卡框 `frame.png` + 三条面板 + 横版协议卡的正/背卡框。
   *
   * ⚠️ **素材目录里那 12 张 PNG 全是竖版 744×1039**（实测逐张确认过），所以
   * `protocol-front/back` 两张**必须**先在加载时转成横版（`rotateAsset90ccw`）——
   * 见那个函数上面那一大段（那是本轮用户报的版图缺陷的根因）。
   * 竖版的 `frame.png` / `panel_*.png` **不需要转**（竖版编译卡就画在 744×1039 里）。
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
    // ★ 两张协议卡帧：竖版素材 → 转成横版成品帧（参考项目的 `rotate90ccw` 同一件事）
    assets.protocolFront = pf === null ? null : rotateAsset90ccw(pf);
    assets.protocolBack = pb === null ? null : rotateAsset90ccw(pb);
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
  /**
   * 一张卡有哪几个面。**横版协议卡是双面**（参考项目 `renderCompileLandscape` 的 side 分支），
   * 竖版编译卡只有一个面 —— 这是"正/背切换只在协议卡模式下出现"的唯一依据。
   */
  function facesOf(card: CardState): CardSide[] {
    return isLandscape(card.kind) ? ['front', 'back'] : ['front'];
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
          ? t('cardmaker.page.mode.created.protocol')
          : t('cardmaker.page.mode.created.compile'),
        'mode-created-card',
        'info',
      );
    } else {
      say(
        next === 'protocol' ? t('cardmaker.page.mode.switched.protocol') : t('cardmaker.page.mode.switched.compile'),
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

  /**
   * 换协议卡的**面**（正/背）。用户 2026-10-01 要求的那个"背面设计切换按钮"。
   *
   * 三件事：改 `face` → `screen.dataset.face` → `refreshAll()`（预览画面、字段按面显隐、
   * 导出按钮文案都跟着走）。**不丢**编辑内容：两面各自的字段都一直存在 `deck` 里。
   */
  function setFace(next: CardSide): void {
    if (face === next) return;
    face = next;
    screen.dataset.face = face;
    refreshAll();
    // ★ 2026-10-01（用户要求改短，逐字就是这两句，别自创第三种说法）
    say(next === 'back' ? t('cardmaker.page.face.switched.back') : t('cardmaker.page.face.switched.front'), 'face-switched', 'info');
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
      if (!res.ok) say(t('cardmaker.page.save-failed', { detail: res.detail }), 'save-failed', 'error');
      else if (!nav.store.isPersistent()) say(t('cardmaker.page.saved-memory'), 'saved-memory', 'warn');
      else say(t('cardmaker.page.saved'), 'saved', 'info');
    } catch (e) {
      // 契约上 `save()` 不抛；这层兜的是宿主假件 / 将来实现
      say(t('cardmaker.page.save-failed', { detail: String(e) }), 'save-threw', 'error');
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
    /**
     * 清单行前缀那个名字：**实时**取当前牌组名（所以 `deckTitle` 的 input 处理器里也调了
     * `refreshCards()` —— 改完牌组名清单当场就变）。空名时用与导出文件名**同源的缺省名**
     * `deck`（见 `exportJson` 里的 `safeFileName(deck.title, 'deck')`），
     * 免得出现一个只有空格的前缀。
     */
    const deckLabel = deck.title.trim() === '' ? 'deck' : deck.title.trim();
    for (let i = 0; i < list.length; i += 1) {
      const card = list[i];
      const row = elRole('div', 'cardmaker-card-row', 'card-row');
      row.dataset.cardId = card.id;
      row.dataset.cardKind = card.kind;
      if (card.id === currentId) row.classList.add('cardmaker-card-on');
      /**
       * ★ 2026-10-01（用户要求）：行的正名改成**三段** —— 牌组名 + 这一种的称呼 + 序号。
       *
       *  - 「序号」= 这一张在**当前模式清单里的次序**（1 起）⇒ 用户说的"第 X 张"与屏幕对得上；
       *  - 两种称呼逐字按用户给的：协议卡那行是「协议卡」，竖版那行是「协议所属卡牌」
       *    （用户原话：「横版协议卡」⇒ 牌组名 + 协议卡 + 序号；「竖版编译卡」⇒
       *    牌组名 + 协议所属卡牌 + 序号）。
       */
      const kindName = card.kind === 'protocol' ? t('cardmaker.page.card.kind.protocol') : t('cardmaker.page.card.kind.compile');
      const seq = i + 1;
      const open = btnRole('btn cardmaker-mini', `card-open-${card.id}`, `${deckLabel} ${kindName} ${seq}`);
      open.addEventListener('click', () => {
        currentId = card.id;
        lastSeenId[card.kind] = card.id;
        refreshAll();
      });
      row.appendChild(open);
      const label = card.title.trim() === '' ? t('cardmaker.page.card.untitled') : card.title.trim();
      /**
       * ★ 2026-10-01（用户要求）：**协议卡那行不许出现"数值"字样**。
       *
       * 协议卡的分区表（`PROTOCOL_FRONT` / `PROTOCOL_BACK`）里根本没有数值位，它在
       * 数据模型上也不带 `value`（`hydrateCard()` 会把它清空、`packCard()` 连键都剔掉）——
       * 老文案那句「· 数值 —」既没有信息量，又在暗示一个不存在的功能。
       * 竖版编译卡照旧带上它（大号中心数字是它专属的字段）。
       */
      const note = card.kind === 'protocol'
        ? label
        : t('cardmaker.page.card.note', { label, value: card.value.trim() === '' ? t('cardmaker.page.card.value-empty') : card.value.trim() });
      row.appendChild(el('span', 'cardmaker-note', note));
      cardsHost.appendChild(row);
    }
    if (list.length === 0) {
      // 防御分支：两种模式在 `ensureCardOf()` / 「删除当前卡」的规则下都到不了"零张"
      // （只剩一张时删除是禁用的），所以这里**不再指某个具体按钮**（协议那枚已经删了）。
      cardsHost.appendChild(el('div', 'cardmaker-note', t('cardmaker.page.card.none')));
    }
    // 只剩一张时不许删（不允许把这一种卡删空）—— 与第一版同一条规则，只是按**模式**判
    delCard.disabled = current() === null || cardsOf(mode).length <= 1;
  }

  /**
   * ★ 2026-10-01（用户要求）：按**当前模式 + 当前面**逐行开关字段 —— 不该看的字段**隐藏**。
   *
   * ## ⚠️⚠️ 2026-10-01 修复：`hidden` 属性在本屏**曾经完全不生效**
   *
   * 用户反馈"协议选项里还能看到数值与三段面板"。真浏览器实测（`.superpowers/cardmaker/probe-struct.mjs`）：
   * 行的 `hidden === true` **确实写上了**，但 `getComputedStyle(row).display === 'flex'`、
   * 行高仍然 54/122 ⇒ **照样可见**。
   *
   * 根因：`styles-local.css` 给 `.cardmaker-field { display: flex }`，而浏览器 UA 样式表里的
   * `[hidden] { display: none }` 属于**作者样式之外**的规则 ⇒ 作者样式优先，`[hidden]` 被压掉。
   * 这与本仓既有的同族先例一模一样（`styles.css:1825`：「display:flex 会覆盖 hidden 属性，
   * 需显式声明 [hidden] 恢复隐藏」，那里的 `.dev-results` 当年就栽在这上面）。
   *
   * 修法三件一起上，缺任何一件都可能再犯：
   *  1. `hidden` 属性（语义化、桩上可断言、读屏认它）；
   *  2. `styles-local.css` 的 `.cardmaker-field[hidden] { display: none }`（类+属性，特异性够）；
   *  3. 行内 `style.display` 兜底（有人把第 2 条删了也不会再出这个 bug）。
   *
   * 为什么用 `hidden` 而不是"不产出节点"：输入框与它们的监听器是**只建一次**的
   * （`onText` / `onCompile` 在启动时就挂好了），反复销毁重建会让监听器与 DOM 引用对不上
   * （本仓栽过这种"两份真相"的跟头）。
   *
   * ⚠️ 与它配套的是 `formFromCard()` **不再**去设 `disabled` —— 第一版是"两套字段都摆着 +
   * 另一套灰掉 + 一句说明"，用户明确不要那个形态。所以这里的 `hidden` 是**唯一**的
   * 可见性开关，`disabled` 那几条分支已经删掉（不留永不出现的死代码/死提示）。
   */
  function syncModeFields(): void {
    for (const f of modeFields) {
      // 归属：`kind` 是哪种卡（null = 两种都用），`face` 是协议卡的哪一面（null = 两面都用）
      const hide = (f.kind !== null && f.kind !== mode)
        || (f.face !== null && !(mode === 'protocol' && f.face === face));
      f.row.hidden = hide;
      f.row.style.display = hide ? 'none' : '';
    }
  }

  /**
   * 表单 ← 当前卡（只在切换卡 / 导入 / 换模式 / 换面之后回填；打字时不回填，免得把光标顶跑）。
   *
   * 只回填**当前模式 + 当前面**那几个字段的值，其余不碰：它们仍旧反映它们那张卡/那个面
   * （切回去时 `syncModeFields` 放行、这一函数再回填一次，内容照旧）。
   */
  function formFromCard(card: CardState | null): void {
    syncModeFields();
    if (mode === 'protocol') {
      inTitle.value = card ? card.title : '';
      if (face === 'front') {
        inCTop.value = card ? card.compile.top : '';
        inCSub.value = card ? card.compile.subtitle : '';
        inCBot.value = card ? card.compile.bottom : '';
      } else {
        inCBack.value = card ? card.compile.back : '';
      }
      return;
    }
    inTitle.value = card ? card.title : '';
    inValue.value = card ? card.value : '';
    inTop.value = card ? card.panelTop : '';
    inMid.value = card ? card.panelMid : '';
    inBot.value = card ? card.panelBot : '';
    panelNote.textContent = panelSummary(inTop.value, inMid.value, inBot.value);
  }

  /** 背景 / logo 那一块 ← 当前卡；顺带同步模式按钮 / 正背按钮的选中态与导出按钮的文案 */
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
      ? t('cardmaker.page.mode-hint.protocol', { n: String(count) })
      : t('cardmaker.page.mode-hint.compile', { n: String(count) });

    /* ★ 正/背那一组只在**协议卡模式**下出现（竖版编译卡没有第二个面） */
    const proto = mode === 'protocol';
    faceBar.hidden = !proto;
    faceBar.style.display = proto ? '' : 'none';
    for (const side of ['front', 'back'] as const) {
      const on = proto && face === side;
      faceBtns[side].dataset.active = on ? 'yes' : 'no';
      (faceBtns[side] as unknown as { setAttribute(n: string, v: string): void })
        .setAttribute('aria-selected', on ? 'true' : 'false');
      faceBtns[side].classList.toggle('cardmaker-face-on', on);
    }

    /* 唯一那个图片导出按钮的文案跟着模式/面走（"当前卡"这种半截指代不许出现） */
    exportPng.textContent = proto
      ? (face === 'back' ? t('cardmaker.page.export-png.protocol-back') : t('cardmaker.page.export-png.protocol-front'))
      : t('cardmaker.page.export-png.portrait');
    exportPng.disabled = card === null;

    if (card === null) {
      bgMode.textContent = t('cardmaker.page.bg.no-card');
      logoState.textContent = t('cardmaker.page.logo.none');
      zoomInput.value = '100';
      zoomLabel.textContent = '100%';
      zoomInput.disabled = true;
      resetBtn.disabled = true;
      logoZoom.value = '100';
      logoZoomValue.textContent = '100%';
      logoZoom.disabled = true;
      logoZoomReset.disabled = true;
      return;
    }
    const bg = bgOf(card);
    bgMode.textContent = bg.type === 'none'
      ? t('cardmaker.page.bg.none')
      : bg.type === 'preset'
        ? t('cardmaker.page.bg.preset', { name: bg.name ?? t('cardmaker.page.bg.name-lost') })
        : t('cardmaker.page.bg.custom');
    const pct = Math.round(clampScale(bg.transform.scale) * 100);
    zoomInput.value = String(pct);
    zoomLabel.textContent = `${pct}%`;
    zoomInput.disabled = bg.type === 'none';
    resetBtn.disabled = bg.type === 'none';
    /**
     * logo 状态行必须**如实**：染白与原图直上是两种不同的画法，不能都写成"白色着色"
     * （用户正是因为这句话与实际卡面不符才报的缺陷）。
     */
    const lg = logoOf(card);
    logoState.textContent = !lg.dataUrl
      ? t('cardmaker.page.logo.none')
      : lg.whiten === false
        ? t('cardmaker.page.logo.set-raw')
        : t('cardmaker.page.logo.set-cut');
    /**
     * 开关回显**当前 logo 实际用的处理方式**：切卡/读存档之后，勾选框必须与卡面上的那个 logo
     * 一致 —— 否则用户看到"勾着去背景"，卡上却是一张原图，又一次"界面在说假话"。
     * `whiten` 缺省（老存档）视为 `true`，与 `drawLogoHex` 的判据一致。
     */
    logoCutBox.checked = lg.dataUrl === null ? true : lg.whiten !== false;
    /**
     * ★ 2026-10-01（用户要求）：标志缩放条的读数回显 —— 读的是**绘制层实际会用的那个值**
     * （`clampLogoScale`，与老存档缺字段时回 100% 同一套规则），而不是 JSON 里那个原始数字：
     * 手改过的牌组 JSON 里写着 `zoom: 9` 时，滑杆与卡面必须说同一件事（都是 200%）。
     * 没有 logo 时这条滑杆禁用（与背景那条"没背景就把滑杆禁掉"同一个做法）。
     */
    const lgPct = Math.round(clampLogoScale(lg.zoom) * 100);
    logoZoom.value = String(lgPct);
    logoZoomValue.textContent = `${lgPct}%`;
    logoZoom.disabled = lg.dataUrl === null;
    logoZoomReset.disabled = lg.dataUrl === null;
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

  /**
   * 预览：把当前卡**当前面**画进屏上那张 canvas；顺带把"预览的是哪一张、哪一面、多大"写在它下面。
   *
   * ★ 2026-10-01：协议卡加正/背切换之后，这里按 `face` 画面（`paint` 的 `side` 分支）；
   * 竖版编译卡只有正面，`face` 对它没有意义（`facesOf` 只返回 `front`）。
   */
  async function refreshPreview(): Promise<void> {
    const card = current();
    const seq = ++renderSeq;
    if (card === null) {
      previewSize.textContent = t('cardmaker.page.preview.none');
      return;
    }
    const land = isLandscape(card.kind);
    const side: CardSide = facesOf(card).includes(face) ? face : 'front';
    const w = land ? LAND_W : CARD_W;
    const h = land ? LAND_H : CARD_H;
    // 读数跟着卡走：模式切换之后这里会换成另一套尺寸（测试与 CDP 都读它）
    previewSize.textContent = land
      ? (side === 'back'
        ? t('cardmaker.page.preview.landscape-back', { w: String(LAND_W), h: String(LAND_H) })
        : t('cardmaker.page.preview.landscape-front', { w: String(LAND_W), h: String(LAND_H) }))
      : t('cardmaker.page.preview.portrait', { w: String(CARD_W), h: String(CARD_H) });
    previewSize.dataset.orientation = land ? 'landscape' : 'portrait';
    previewSize.dataset.face = side;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = getCtx(canvas);
    if (!ctx) return; // 没有 2D 上下文（单测桩）：屏上结构照常，只是看不到卡
    const ok = await paint(ctx, card, side, 1, w, h);
    if (seq !== renderSeq) return; // 已经有更新的帧在路上，丢掉这一帧
    if (!ok) say(t('cardmaker.page.preview-failed'), 'preview-failed', 'error');
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
    say(t('cardmaker.page.bg.cleared'), 'bg-cleared', 'info');
  });

  bgUpload.addEventListener('click', () => {
    void (async () => {
      const card = current();
      if (card === null) return;
      say(t('cardmaker.page.bg.waiting'), 'bg-waiting', 'info');
      let dataUrl: string | null;
      try {
        dataUrl = await nav.uploadDataUrl('bg');
      } catch (e) {
        say(t('cardmaker.page.bg.read-failed', { detail: String(e) }), 'bg-upload-failed', 'error');
        return;
      }
      if (dataUrl === null) { say(t('cardmaker.page.bg.cancelled'), 'bg-upload-cancelled', 'info'); return; }
      let small: string;
      try {
        // 缩到 2000px 再内嵌：牌组 JSON 要装得下（取舍见 images.ts 的说明）
        small = await normalizeImage(dataUrl);
      } catch (e) {
        say(t('cardmaker.page.bg.normalize-failed', { detail: String(e) }), 'bg-normalize-failed', 'error');
        return;
      }
      setBg({ type: 'custom', name: null, dataUrl: small, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
      say(t('cardmaker.page.bg.uploaded'), 'bg-uploaded', 'info');
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
    say(t('cardmaker.page.bg.reset-ok'), 'bg-reset', 'info');
  });

  /* ── logo ── */

  logoUpload.addEventListener('click', () => {
    void (async () => {
      const card = current();
      if (card === null) return;
      say(t('cardmaker.page.logo.waiting'), 'logo-waiting', 'info');
      let dataUrl: string | null;
      try {
        dataUrl = await nav.uploadDataUrl('logo');
      } catch (e) {
        say(t('cardmaker.page.logo.read-failed', { detail: String(e) }), 'logo-upload-failed', 'error');
        return;
      }
      if (dataUrl === null) { say(t('cardmaker.page.logo.cancelled'), 'logo-upload-cancelled', 'info'); return; }
      /**
       * ★ 2026-10-01（用户要求把语义改死）：
       *  - **未勾选** ⇒ **原图直上**：不抠背景、不上白、不做任何处理
       *    （`whiten: false` ⇒ 绘制层直接 `drawImage` 原图，颜色与背景原样进卡面）；
       *  - **勾选**（默认）⇒ 抠背景 + 上白（`whiten: true`），并把抠的结果**如实**报出来
       *    （抠了多少 / 因可疑而没抠 ⇒ 这时**不染白**，直接放原图原色）。
       *
       * ⚠️ "抠不成就不染白"是 `shouldWhitenLogo()` 定的规则，不是这里随手写的：抠图因可疑
       * 放弃时返回的是一张**不透明方图**，再染白就正好回到用户报的"一片白色小卡片"。
       */
      const cutEnabled = logoCutBox.checked;
      let small: string;
      let note: string;
      let cutRejected = false;
      try {
        if (cutEnabled) {
          // 先抠背景（只留形状），再缩到 320px —— 顺序不能反
          // （先缩图会把背景与形状混色，边缘判断不准）。
          const cut = await removeLogoBackground(dataUrl);
          cutRejected = cut.rejected;
          small = await normalizeLogo(cut.dataUrl);
          note = cut.rejected
            ? t('cardmaker.page.logo.cut.rejected', { pct: String(Math.round(cut.removedRatio * 100)) })
              + t('cardmaker.page.logo.cut.rejected.2')
              + t('cardmaker.page.logo.cut.rejected.3')
            : cut.removedRatio > 0
              ? t('cardmaker.page.logo.cut.done', { pct: String(Math.round(cut.removedRatio * 100)) })
              : t('cardmaker.page.logo.cut.none');
        } else {
          // 原图直上：只做一次尺寸压缩（为了存得下），颜色与背景一个像素都不动
          small = await normalizeLogo(dataUrl);
          note = t('cardmaker.page.logo.cut.off');
        }
      } catch (e) {
        say(t('cardmaker.page.logo.normalize-failed', { detail: String(e) }), 'logo-normalize-failed', 'error');
        return;
      }
      /**
       * 写回的地方分两种，**与参考项目的作用域逐条对齐**（那边 `app.js:56-80` 写得很清楚：
       * 「the logo IMAGE is deck-wide (both kinds) … but its zoom/offset stay PER KIND」）：
       *
       *  - 每卡模式（「每张卡单独的背景」打开）：这张卡自己那份，缩放/偏移都归这张卡；
       *  - 默认模式：**图片**（`dataUrl` + `whiten`，它们描述的是"这张图被怎么处理过"）写到
       *    **两种卡型**上 —— 与参考项目的 `setLogoImage()` 一字不差；而**各自的缩放/偏移保留**
       *    （参考项目的原话是 "preserving each kind's own zoom/offset"，横版与竖版卡尺寸/版式
       *    不同，缩放本来就该各调各的）。所以我们**不**把 `zoom/offset` 一起抄过去。
       */
      const whiten = shouldWhitenLogo(cutEnabled, cutRejected);
      if (deck.shared.perCardBg) {
        card.logoOwn = { ...card.logoOwn, dataUrl: small, whiten };
      } else {
        deck.shared.compile = {
          ...deck.shared.compile,
          logo: { ...deck.shared.compile.logo, dataUrl: small, whiten },
        };
        deck.shared.protocol = {
          ...deck.shared.protocol,
          logo: { ...deck.shared.protocol.logo, dataUrl: small, whiten },
        };
      }
      refreshAssets();
      void refreshPreview();
      scheduleSave(0);
      say(t('cardmaker.page.logo.uploaded', { note }), 'logo-uploaded', 'info');
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
    say(t('cardmaker.page.logo.cleared'), 'logo-cleared', 'info');
  });

  /**
   * ★ 2026-10-01（用户要求）：把标志缩放写回**与 logo 同一个作用域**。
   *
   * 这里刻意**只写 `logoOf(card)` 指的那个对象**，不另发明一套存法：
   *  - `deck.shared.perCardBg === false`（默认）⇒ 那个对象是
   *    `deck.shared[当前卡型].logo` ⇒ **缩放跟着卡型整副共用**（与参考项目的 logo 作用域一致）；
   *  - `perCardBg === true` ⇒ 那个对象是 `card.logoOwn` ⇒ **每张卡各记一个**。
   *
   * 与画布上的拖动（`pointermove` 里改 `logo.offsetX/offsetY`）是同一个写法：就地改那个对象。
   * 之所以**不能**照抄上传那一支（它把 logo 同时写进 compile 与 protocol 两种卡型），是因为
   * 缩放要跟着"logo 现在到底在哪"，而两种卡型的 logo 完全可能已经不一样（例如单独清除过
   * 一侧）—— 那时候把缩放同时写两边，就会出现"卡面上的 logo 没变、另一侧的却变了"。
   */
  function setLogoZoom(zoom: number): void {
    const card = current();
    if (card === null) return;
    logoOf(card).zoom = clampLogoScale(zoom);
  }

  logoZoom.addEventListener('input', () => {
    const card = current();
    if (card === null || !logoOf(card).dataUrl) return;
    setLogoZoom(Number(logoZoom.value) / 100);
    const lgPct = Math.round(clampLogoScale(logoOf(card).zoom) * 100);
    logoZoomValue.textContent = `${lgPct}%`;
    void refreshPreview();
    scheduleSave();
  });

  logoZoomReset.addEventListener('click', () => {
    const card = current();
    if (card === null) return;
    setLogoZoom(1);
    refreshAssets();
    void refreshPreview();
    scheduleSave(0);
    say(t('cardmaker.page.logo.zoom-reset-ok'), 'logo-zoom-reset', 'info');
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
    // ★ 2026-10-01（用户要求）：清单行前缀带**实时**牌组名 ⇒ 改名字要当场重画清单
    //   （不重画的话，用户改完名字清单还挂着旧名 —— 那正是"界面在说假话"）
    refreshCards();
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
    say(t('cardmaker.page.card.added'), 'card-added', 'info');
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
    say(t('cardmaker.page.card.deleted'), 'card-deleted', 'info');
  });

  /* ── 导出 PNG ── */

  /**
   * 把一张卡渲染到**离屏**画布（不碰屏上那张预览）。
   *
   * ## 两个空间，别混（这是本屏最容易搞错的一处）
   *
   *  - **横版空间 1039×744**：横版协议卡的成品空间；**也是竖版编译卡的"绘制"空间**
   *    —— 竖版卡的三条面板/数值/标题的坐标全是按横版空间量的，卡框在素材目录里是
   *    竖版那张 `frame.png`（横版那张 `protocol-front.png` 是它转出来的、加载时已转好）。
   *  - **竖版空间 744×1039**：竖版编译卡的成品空间。
   *
   * ⚠️ 这里**不能**按 `land` 取尺寸：竖版编译卡在"画"的时候用的是横版空间。
   * 第一版写成 `land ? LAND : CARD` 并"画完再转" ⇒ 画的是 744×1039 的画布（竖版坐标被当成
   * 横版用），转出来是一张**空白卡**（浏览器自查抓到的：导出那条路没人验过像素）。
   *
   * ⚠️ 2026-10-01：**`portrait` 参数与 `rotateToPortrait` 已删除**。它们服务的是那个
   * "按竖版编译卡导出"的独立按钮（把横版空间画的卡转成竖版成品）；按钮删掉之后，
   * 竖版编译卡本来就直接画在成品空间里（`w === CARD_W`），那条转 90° 的路**没有任何调用点**
   * —— 留着就是死代码。现在按卡自己的形态取空间，画完**不转**。
   */
  async function renderOffscreen(card: CardState, side: 'front' | 'back'): Promise<HTMLCanvasElement | null> {
    const drawLand = isLandscape(card.kind);
    const w = drawLand ? LAND_W : CARD_W;
    const h = drawLand ? LAND_H : CARD_H;
    const master = dom.createCanvas();
    master.width = w;
    master.height = h;
    const mctx = getCtx(master);
    if (!mctx) return null;
    await paint(mctx, card, side, 1, w, h);
    return master;
  }

  /**
   * 导出**当前卡片的当前面**为 PNG：协议卡的双面靠上方的「正面 / 背面」切换决定 ——
   * **导出的就是预览里正在看的那一面**（所见即所得）。文件名里带上 `-front` / `-back`
   * 后缀，省得两面同名互相覆盖；想两面都要就切一次面再导一次（每次一个文件，行为可预期）。
   *
   * ⚠️ 2026-10-01：**不再有 `portrait` 参数** —— 那个"按竖版编译卡导出"的独立按钮已删
   * （模式 tab 已经能把当前卡切成竖版/横版，它只是个置灰摆设）。当前模式决定成品尺寸：
   * 竖版编译卡 ⇒ 750×1050；协议卡 ⇒ 1050×750。所以这里也不再需要"协议卡按竖版导出"的
   * 拒绝分支与 `export-refused` 结论码。
   */
  async function exportCardPng(): Promise<void> {
    const card = current();
    if (card === null) return;
    const side: CardSide = facesOf(card).includes(face) ? face : 'front';
    const sideSuffix = facesOf(card).length > 1 ? `-${side}` : '';
    say(t('cardmaker.page.export.waiting'), 'export-waiting', 'info');
    try {
      const master = await renderOffscreen(card, side);
      if (master === null) { say(t('cardmaker.page.export.no-2d'), 'export-unsupported', 'error'); return; }
      const out = toPoker(master);
      const name = `${safeFileName(deck.title === '' ? card.title : deck.title, 'card')}-${card.id.slice(0, 6)}${sideSuffix}.png`;
      await downloadCanvas(out, name, card);
    } catch (e) {
      say(t('cardmaker.page.export.failed', { detail: String(e) }), 'export-failed', 'error');
    }
  }

  /** canvas → PNG Blob → 交给宿主落盘（`toBlob` 拿不到时退化成 data URL 转 Blob） */
  function downloadCanvas(cnv: HTMLCanvasElement, name: string, card: CardState): Promise<void> {
    return new Promise((resolve) => {
      const finish = (blob: Blob): void => {
        nav.download(name, blob);
        say(
          t('cardmaker.page.export.ok', { name, w: String(cnv.width), h: String(cnv.height) })
          + t('cardmaker.page.export.ok.kind', { kind: card.kind === 'protocol' ? t('cardmaker.page.card.kind.landscape') : t('cardmaker.page.card.kind.portrait') }),
          'export-ok',
          'info',
        );
        resolve();
      };
      try {
        if (typeof cnv.toBlob === 'function') {
          cnv.toBlob((blob) => {
            if (blob) { finish(blob); return; }
            say(t('cardmaker.page.export.canvas-failed'), 'export-failed', 'error');
            resolve();
          }, 'image/png');
          return;
        }
      } catch {
        /* 落到 data URL 那条路 */
      }
      try {
        const url = typeof cnv.toDataURL === 'function' ? cnv.toDataURL('image/png') : '';
        if (url === '') { say(t('cardmaker.page.export.unsupported'), 'export-unsupported', 'error'); resolve(); return; }
        finish(dataUrlToBlob(url));
      } catch (e) {
        say(t('cardmaker.page.export.failed', { detail: String(e) }), 'export-failed', 'error');
        resolve();
      }
    });
  }

  exportPng.addEventListener('click', () => { void exportCardPng(); });

  /* ── 导出 / 导入牌组 JSON ── */

  exportJson.addEventListener('click', () => {
    try {
      const text = stringifyDeck(deck);
      const name = `${safeFileName(deck.title, 'deck')}.cardmaker.json`;
      nav.download(name, new Blob([text], { type: 'application/json' }));
      say(t('cardmaker.page.export-json.ok', { name }), 'export-json-ok', 'info');
    } catch (e) {
      say(t('cardmaker.page.export-json.failed', { detail: String(e) }), 'export-json-failed', 'error');
    }
  });

  importJson.addEventListener('click', () => {
    void (async () => {
      say(t('cardmaker.page.import.waiting'), 'import-waiting', 'info');
      let text: string | null;
      try {
        text = await nav.readTextFile('.json,application/json');
      } catch (e) {
        say(t('cardmaker.page.import.read-failed', { detail: String(e) }), 'import-read-failed', 'error');
        return;
      }
      if (text === null) { say(t('cardmaker.page.import.cancelled'), 'import-cancelled', 'info'); return; }
      const parsed = parseDeck(text);
      if (!parsed.ok) {
        // 四类失败各自可辨识：选错文件 / 文件坏了 / 版本不认识 / 形状不对
        say(t('cardmaker.page.import.failed', { detail: parsed.message }), `import-${parsed.code}`, 'error');
        return;
      }
      deck = parsed.deck;
      currentId = deck.cards[0]?.id ?? '';
      deckTitle.value = deck.title;
      refreshAll();
      void saveNow();
      say(t('cardmaker.page.import.ok', { n: String(deck.cards.length) }), 'import-ok', 'info');
    })();
  });

  /* ── 启动：读本机 → 载素材与字体 → 画第一帧 ── */

  void (async () => {
    try {
      const saved = await nav.store.load();
      if (saved !== null) {
        deck = hydrateDeck(saved);
        say(t('cardmaker.page.loaded', { n: String(deck.cards.length) }), 'loaded', 'info');
      }
    } catch (e) {
      say(t('cardmaker.page.load-failed', { detail: String(e) }), 'load-failed', 'error');
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

/* ── 与本屏注入的 `dom` 配套的薄封装 ──────────────────────────────── */

/*
 * ⚠️ 2026-10-01：这里原本还有一个导出的 `rotateToPortrait(master, dom)`
 * （横版母版 → 竖版卡 744×1039）。它只服务"按竖版编译卡导出"那个按钮，
 * 而那个按钮是**残留废按钮**（模式 tab 已经能把当前卡切成竖版/横版），已随本轮删除。
 * 竖版编译卡的成品导出现在直接画在 744×1039 里（见 `renderOffscreen`），不需要再转。
 * 帧素材那侧的旋转是另一回事（`rotateAsset90ccw`，仍在使用）。
 */

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
