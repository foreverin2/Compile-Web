export function playFireBurnEffect(cardElement, onComplete) {
  // 1. 添加焚烧特效 DOM 节点
  const overlay = document.createElement('div');
  overlay.className = 'fire-burn-overlay';
  overlay.innerHTML = `
    <div class="fire-burn-flame"></div>
    <div class="fire-burn-sparks">
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
    </div>
  `;
  cardElement.appendChild(overlay);
  cardElement.classList.add('card-burning');

  // 2. 1.2s 动画结束后回调
  setTimeout(() => {
    if (onComplete) onComplete();
    cardElement.remove();
  }, 1200);
}