/**
 * 制作器的数据模型（牌组 JSON 的形状）。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/model/bg.js` + `app.js` 的 `defaultState()`
 * / `defaultCompile()` / `normalizeState()`。原项目把"牌组级共享属性"与"每张卡自己的
 * 文本"分成两张表（`deckShared` + 卡的 `state`），这里沿用同一套结构 —— 后端的理由与
 * 那边一样：标题/背景/logo 不逐卡复制，去掉重复的 base64 图。
 */

/** 卡的两种形态：竖版编译卡 / 横版双面协议卡 */
export type CardKind = 'compile' | 'protocol';

/** 卡的一面（协议卡有正/背；编译卡只有正面） */
export type CardSide = 'front' | 'back';

/** 背景：不用 / 用预设（按名字引用）/ 用上传的图（base64 内嵌） */
export type BgType = 'none' | 'preset' | 'custom';

/** 背景的平移与缩放（用户拖拽 + 滚轮 + 滑杆改的就是这三个数） */
export interface BgTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface Bg {
  type: BgType;
  /** `type === 'preset'` 时的预设名（`PRESETS` 的成员） */
  name: string | null;
  /** `type === 'custom'` 时的图片（data URL，牌组 JSON 里内嵌成 base64） */
  dataUrl: string | null;
  transform: BgTransform;
}

/** 六边形里的 logo（白色着色；缩放/偏移按"每种卡"各存一份） */
export interface Logo {
  dataUrl: string | null;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** 竖版编译卡独有的四段文字（其余三种文本是"卡自己的"：标题/数值/三面板） */
export interface CompileText {
  top: string;
  subtitle: string;
  bottom: string;
  back: string;
}

/**
 * 一张卡的**自有内容**（不含 deck 级共享的标题/背景/logo）。
 *
 * `bgOwn` / `logoOwn` 只在用户打开"每张卡单独的背景/logo"开关时才写进去；
 * 关着的时候它们不参与渲染、也不落盘（与参考项目 `cardSnapshot()` 的口径一致）。
 */
export interface CardState {
  id: string;
  kind: CardKind;
  /** 协议名（横版卡的主标题；竖版卡的左上角标题） */
  title: string;
  /** 大号中心数字（只对竖版卡有意义） */
  value: string;
  panelTop: string;
  panelMid: string;
  panelBot: string;
  compile: CompileText;
  bgOwn: Bg;
  logoOwn: Logo;
}

/** deck 级共享属性：两种卡各自的背景与 logo，加上"每张卡单独背景"这个开关 */
export interface DeckShared {
  perCardBg: boolean;
  compile: { bg: Bg; logo: Logo };
  protocol: { bg: Bg; logo: Logo };
}

/** 一份牌组（本项目：单牌组） */
export interface Deck {
  title: string;
  shared: DeckShared;
  cards: CardState[];
}

/* ── 工厂函数：每次都返回**新对象**（不许共享引用） ───────────────────────── */

export const defaultTransform = (): BgTransform => ({ scale: 1, offsetX: 0, offsetY: 0 });

export const defaultBg = (): Bg => ({ type: 'none', name: null, dataUrl: null, transform: defaultTransform() });

export const defaultLogo = (): Logo => ({ dataUrl: null, zoom: 1, offsetX: 0, offsetY: 0 });

export const defaultCompileText = (): CompileText => ({
  top: '', subtitle: 'LOADING...', bottom: '', back: 'COMPILED',
});

export const defaultCard = (id: string, kind: CardKind): CardState => ({
  id,
  kind,
  title: '',
  value: '',
  panelTop: '',
  panelMid: '',
  panelBot: '',
  compile: defaultCompileText(),
  bgOwn: defaultBg(),
  logoOwn: defaultLogo(),
});

export const defaultDeck = (): Deck => ({
  title: '',
  shared: {
    perCardBg: false,
    compile: { bg: defaultBg(), logo: defaultLogo() },
    protocol: { bg: defaultBg(), logo: defaultLogo() },
  },
  // 开局给一张竖版卡 + 一张横版协议卡：两种形态在屏上都看得见（用户要编辑的就是这两种）
  cards: [],
});

/** 该形态是不是横版（决定用哪一套渲染器与哪些文本区） */
export const isLandscape = (kind: CardKind): boolean => kind === 'protocol';
