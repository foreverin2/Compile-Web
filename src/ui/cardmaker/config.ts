/**
 * 卡牌制作器的**几何与常量表**（唯一出处）。
 *
 * 2026-10-01：本模块是**移植**，不是复制粘贴 —— 参考项目
 * COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/config.js`。原文件是 ES 模块 JS，
 * 这里改成 TypeScript 并只保留本项目要用的那一部分（PDF / 分享短链 / 马赛克
 * 分割相关的常量一律不搬，见 `page.ts` 的文件头注里那份"没移植的清单"）。
 *
 * 设计空间：卡框美术与全部文本区都按 744×1039 这个尺寸画的。
 *  - 竖版编译卡 = 744×1039（设计空间即输出空间）；
 *  - 横版协议卡 = 把竖版卡框逆时针转 90° 得到，所以是 1039×744。
 */
export const CARD_W = 744;
export const CARD_H = 1039;

/** 打印输出尺寸：标准扑克牌 63.5×88.9mm，300dpi ≈ 750×1050 */
export const POKER_W = 750;
export const POKER_H = 1050;

/** 横版（协议卡）设计空间：竖版逆时针转 90° */
export const LAND_W = 1039;
export const LAND_H = 744;

/** 背景平移/缩放的上下限（SCALE_MAX 给马赛克分割留了余量，这里一起保留） */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 16;

/** 上/中/下三条文本面板的字体与排版 */
export const PANEL_FONT = 'SupermolotR';
export const PANEL_MAX = 38;
export const PANEL_MIN = 13;
export const LINE_FACTOR = 1.18;

export const TEXT_SHADOW = { color: 'rgba(0,0,0,0.7)', blur: 17, dx: 0, dy: 8 };

/** 文本区（坐标按 744×1039 的卡框量） */
export interface TextZone {
  x: number;
  y: number;
  w: number;
  h: number;
  font: string;
  /** 自动缩放的起始字号 */
  max: number;
  /** 自动缩放的兜底字号 */
  min: number;
  align?: 'left' | 'center';
  padX?: number;
  dx?: number;
  dy?: number;
  shadow?: typeof TEXT_SHADOW;
}

/** 文本区（竖版编译卡） */
export const ZONES = {
  title: { x: 39, y: 31, w: 240, h: 96, font: 'HackedKerX', max: 60, min: 18, align: 'left', padX: 18 },
  value: { x: 292, y: 40, w: 159, h: 175, font: 'HackedKerX', max: 161, min: 28, dy: 10, dx: 0 },
  /** 盖住卡框上那个六边形：pointy "v" = 尖朝上下（竖版卡） */
  hex: { x: 583, y: 36, w: 124, h: 135, pointy: 'v', flatA: 0.26, flatB: 0.85 },
  panels: {
    top: { x: 80, y: 258, w: 580, h: 190 },
    mid: { x: 78, y: 508, w: 570, h: 210 },
    bot: { x: 78, y: 766, w: 585, h: 214 },
  },
} as const satisfies {
  title: TextZone;
  value: TextZone;
  hex: HexBox;
  panels: { top: PanelZone; mid: PanelZone; bot: PanelZone };
};

/** 六边形文本区（比 TextZone 多两个切角比例） */
export interface HexBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "v" = 尖朝上下（竖版卡）· "h" = 尖朝左右（横版卡） */
  pointy: 'v' | 'h';
  /** 平边从哪里开始 / 到哪里结束（相对边长） */
  flatA: number;
  flatB: number;
}

/** 面板文本区（只有位置与尺寸，字号由 `PANEL_MAX`/`PANEL_MIN` 自动缩放） */
export interface PanelZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 横版协议卡的正面文本区 */
export const PROTOCOL_FRONT = {
  topBar: { x: 72, y: 40, w: 700, h: 80, font: 'SupermolotR', max: 36, min: 14, align: 'left', padX: 26 },
  name: { x: 60, y: 256, w: 930, h: 200, font: 'HackedKerX', max: 150, min: 34, shadow: TEXT_SHADOW },
  subtitle: { x: 60, y: 418, w: 930, h: 90, font: 'MotionControl', max: 62, min: 16, shadow: TEXT_SHADOW },
  bottomBar: { x: 60, y: 620, w: 930, h: 72, font: 'SupermolotR', max: 34, min: 14, align: 'center', padX: 22 },
  hex: { x: 856, y: 38, w: 144, h: 140, pointy: 'h', flatA: 0.18, flatB: 0.86 },
} as const;

/** 横版协议卡的背面文本区（名字在底栏较厚的那一段里，左对齐） */
export const PROTOCOL_BACK = {
  name: { x: 78, y: 592, w: 510, h: 128, font: 'HackedKerX', max: 104, min: 24, align: 'left', padX: 30 },
  backLine: { x: 652, y: 626, w: 356, h: 84, font: 'SupermolotR', max: 40, min: 14, align: 'center', padX: 16 },
  hex: { x: 856, y: 38, w: 144, h: 140, pointy: 'h', flatA: 0.18, flatB: 0.86 },
} as const;

/** 15 套预设背景（按名字引用，文件在 `public/assets/cardmaker/card-backgrounds/`） */
export const PRESETS = [
  'Water', 'Love', 'Apathy', 'Spirit', 'Fire', 'Gravity', 'Light', 'Metal',
  'Death', 'Hate', 'Darkness', 'Plague', 'Psychic', 'Speed', 'Life',
] as const;

/**
 * 旧西班牙语预设名 → 现在的英文文件名。
 *
 * 保留它的理由与参考项目一致：老牌组 JSON 里存的是西语名，读回来要能解析到文件。
 */
export const PRESET_MIGRATION: Readonly<Record<string, string>> = {
  Agua: 'Water', Amor: 'Love', Apatia: 'Apathy', Espiritu: 'Spirit', Fuego: 'Fire',
  Gravedad: 'Gravity', Luz: 'Light', Muerte: 'Death', Odio: 'Hate', Oscuridad: 'Darkness',
  Plaga: 'Plague', Psiquico: 'Psychic', Velocidad: 'Speed', Vida: 'Life',
};

/** 素材根目录（相对站点根；Vite 里就是 `public/` 的原样拷贝） */
export const ASSET_BASE = '/assets/cardmaker';

/** 上传图片的落盘上限：长边缩到这么多像素再编码（参考项目用 1:1 全质量，这里换来"牌组 JSON 不爆"） */
export const UPLOAD_MAX_DIM = 2000;
export const UPLOAD_JPEG_QUALITY = 0.88;
/** logo 存成小图（在六边形里显示，320px 足够） */
export const LOGO_MAX_DIM = 320;

/** 牌组 JSON 的版本号（本项目自定义格式；与参考项目的 version 3 不同） */
export const DECK_FORMAT = 'compile-cardmaker-deck';
export const DECK_VERSION = 1;

/** 文件名里不能出现的字符（导出 PNG / JSON 时用） */
export const SAFE_NAME_FALLBACK = 'card';
