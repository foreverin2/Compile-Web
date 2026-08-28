import { gameBus, type GameEvent } from '../../core/events/bus';

/** 火焰焚烧动画：克隆目标卡到 body 级浮层（固定定位到原卡位置），挂 fire-burn 粒子，
 *  1.2s 后移除。重渲染会销毁原卡 DOM，浮层独立于渲染树不受影响。 */
function playFireBurn(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.classList.add('card-burning');
  clone.style.position = 'fixed';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.pointerEvents = 'none';
  clone.querySelector('.play-btns')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'fire-burn-overlay';
  const flame = document.createElement('div');
  flame.className = 'fire-burn-flame';
  const sparks = document.createElement('div');
  sparks.className = 'fire-burn-sparks';
  for (let i = 0; i < 5; i++) sparks.appendChild(Object.assign(document.createElement('div'), { className: 'fire-spark' }));
  overlay.appendChild(flame);
  overlay.appendChild(sparks);
  clone.appendChild(overlay);
  document.body.appendChild(clone);
  window.setTimeout(() => clone.remove(), 1200);
}

export function initEffects(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    const payload = e.payload as { uid?: string; protocol?: string } | undefined;
    if (!payload?.uid || payload.protocol !== 'fire') return;
    if (e.type !== 'card:discarded' && e.type !== 'card:deleted') return;
    const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
    if (node) playFireBurn(node);
  });
}
