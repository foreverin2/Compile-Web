/**
 * 卡牌「删去」特效挂载模块（Gemini 生成，转换为 TS 后由 src 静态导入）
 * 使用方式:
 *   import { mountShatter } from './delete-shatter';
 *   mountShatter(cardCloneNode);
 * 动画时长: ≤ 1.2s 自然结束；宿主约 1.2s 后直接从 DOM 移除卡牌克隆节点。
 */

// 预设 10 个不规则三角/多边形 clip-path（按百分比裁切，自适应任意卡牌比例）
const PIECE_POLYGONS = [
  // 顶部 3 块
  'polygon(0% 0%, 35% 0%, 25% 30%, 0% 25%)',
  'polygon(35% 0%, 75% 0%, 60% 35%, 25% 30%)',
  'polygon(75% 0%, 100% 0%, 100% 30%, 60% 35%)',
  // 中部 4 块
  'polygon(0% 25%, 25% 30%, 30% 65%, 0% 55%)',
  'polygon(25% 30%, 60% 35%, 50% 70%, 30% 65%)',
  'polygon(60% 35%, 100% 30%, 100% 65%, 50% 70%)',
  'polygon(30% 45%, 70% 45%, 65% 75%, 25% 70%)',
  // 底部 3 块
  'polygon(0% 55%, 30% 65%, 35% 100%, 0% 100%)',
  'polygon(30% 65%, 50% 70%, 70% 100%, 35% 100%)',
  'polygon(50% 70%, 100% 65%, 100% 100%, 70% 100%)',
];

/**
 * 在克隆卡牌节点上挂载碎片动画
 * @param node 宿主克隆的卡牌 DOM 节点
 */
export function mountShatter(node: HTMLElement): void {
  if (!node || !(node instanceof HTMLElement)) {
    return;
  }

  // 1. 获取卡面背景图片或默认背景样式
  const imgElement = node.querySelector('img');
  let bgStyle = '';
  if (imgElement && imgElement.src) {
    bgStyle = `url("${imgElement.src}")`;
  } else {
    const computed = window.getComputedStyle(node);
    bgStyle =
      computed.backgroundImage !== 'none' ? computed.backgroundImage : computed.backgroundColor || '#11192e';
  }

  // 2. 创建特效覆盖层
  const overlay = document.createElement('div');
  overlay.className = 'shatter-overlay';

  // 3. 注入闪光层
  const flash = document.createElement('div');
  flash.className = 'shatter-flash';
  overlay.appendChild(flash);

  // 4. 生成 10 块多边形碎片（按放射方向飞散）
  const pieceCount = PIECE_POLYGONS.length;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement('div');
    piece.className = 'shatter-piece';
    piece.style.clipPath = PIECE_POLYGONS[i];
    piece.style.setProperty('-webkit-clip-path', PIECE_POLYGONS[i]);

    if (bgStyle.startsWith('url(')) {
      piece.style.backgroundImage = bgStyle;
    } else {
      piece.style.background = bgStyle;
    }

    // 计算放射角度与随机位移
    const angle = (i / pieceCount) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
    const distance = 90 + Math.random() * 110; // 飞散距离 90px ~ 200px
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    const rot = (Math.random() - 0.5) * 160; // 旋转角度 -80deg ~ +80deg
    const scale = 0.4 + Math.random() * 0.3; // 终点缩小比例

    piece.style.setProperty('--tx', `${tx.toFixed(1)}px`);
    piece.style.setProperty('--ty', `${ty.toFixed(1)}px`);
    piece.style.setProperty('--rot', `${rot.toFixed(1)}deg`);
    piece.style.setProperty('--scale', scale.toFixed(2));
    piece.style.animationDelay = `${(Math.random() * 0.08).toFixed(3)}s`;

    overlay.appendChild(piece);
  }

  // 5. 生成 16 个伴随光点粒子
  const sparkCount = 16;
  for (let j = 0; j < sparkCount; j++) {
    const spark = document.createElement('div');
    spark.className = 'shatter-spark';

    const pAngle = Math.random() * Math.PI * 2;
    const pDistance = 120 + Math.random() * 130;
    const stx = Math.cos(pAngle) * pDistance;
    const sty = Math.sin(pAngle) * pDistance;

    spark.style.setProperty('--stx', `${stx.toFixed(1)}px`);
    spark.style.setProperty('--sty', `${sty.toFixed(1)}px`);
    spark.style.animationDelay = `${(Math.random() * 0.12).toFixed(3)}s`;

    overlay.appendChild(spark);
  }

  // 6. 挂载并激活宿主动画类
  node.classList.add('card-shattering');
  node.appendChild(overlay);
}
