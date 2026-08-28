
/**
 * 卡牌「弃牌」对角线切割特效挂载模块
 * 使用方式:
 *   import { mountCut } from '/assets/fx/discard-cut.js';
 *   mountCut(cardCloneNode);
 * 动画时长: ≤ 1.2s 自然结束；宿主约 1.2s 后直接从 DOM 移除卡牌克隆节点。
 */

/**
 * 在克隆卡牌节点上挂载对角线切割特效
 * @param {HTMLElement} node 宿主克隆的卡牌 DOM 节点
 */
export function mountCut(node) {
  if (!node || !(node instanceof HTMLElement)) {
    return;
  }

  // 1. 获取卡面背景图片或默认背景颜色
  const imgElement = node.querySelector('img');
  let bgStyle = '';
  if (imgElement && imgElement.src) {
    bgStyle = `url("${imgElement.src}")`;
  } else {
    const computed = window.getComputedStyle(node);
    bgStyle = computed.backgroundImage !== 'none'
      ? computed.backgroundImage
      : (computed.backgroundColor || '#11192e');
  }

  // 2. 根据节点比例计算对角线倾角 (左上至右下)
  const rect = node.getBoundingClientRect();
  const width = rect.width || 120;
  const height = rect.height || 170;
  const cutAngleDeg = (Math.atan2(height, width) * 180 / Math.PI).toFixed(2);

  // 3. 创建特效覆盖层
  const overlay = document.createElement('div');
  overlay.className = 'cut-overlay';
  overlay.style.setProperty('--cut-angle', `${cutAngleDeg}deg`);

  // 4. 创建两半三角形切片
  const sliceTop = document.createElement('div');
  sliceTop.className = 'cut-slice cut-slice-top';

  const sliceBottom = document.createElement('div');
  sliceBottom.className = 'cut-slice cut-slice-bottom';

  if (bgStyle.startsWith('url(')) {
    sliceTop.style.backgroundImage = bgStyle;
    sliceBottom.style.backgroundImage = bgStyle;
  } else {
    sliceTop.style.background = bgStyle;
    sliceBottom.style.background = bgStyle;
  }

  overlay.appendChild(sliceTop);
  overlay.appendChild(sliceBottom);

  // 5. 注入光刃切割闪光
  const blade = document.createElement('div');
  blade.className = 'cut-laser-blade';
  overlay.appendChild(blade);

  // 6. 沿对角线散布 8 粒微型光点
  const sparkCount = 8;
  for (let i = 0; i < sparkCount; i++) {
    const spark = document.createElement('div');
    spark.className = 'cut-spark';

    // 沿对角线均匀分布起始点 (t: 0.15 ~ 0.85)
    const t = 0.15 + (i / (sparkCount - 1)) * 0.7;
    spark.style.left = `${(t * 100).toFixed(1)}%`;
    spark.style.top = `${(t * 100).toFixed(1)}%`;

    // 垂直于对角线法线向两侧微散
    const normalOffset = (Math.random() - 0.5) * 50;
    const ctx = normalOffset * Math.sin(cutAngleDeg * Math.PI / 180);
    const cty = -normalOffset * Math.cos(cutAngleDeg * Math.PI / 180);

    spark.style.setProperty('--ctx', `${ctx.toFixed(1)}px`);
    spark.style.setProperty('--cty', `${cty.toFixed(1)}px`);
    spark.style.animationDelay = `${(0.04 + Math.random() * 0.08).toFixed(3)}s`;

    overlay.appendChild(spark);
  }

  // 7. 挂载并激活宿主动画类
  node.classList.add('card-cut');
  node.appendChild(overlay);
}
