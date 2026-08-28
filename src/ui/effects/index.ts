import { gameBus, type GameEvent } from '../../core/events/bus';

const FX_REMOVE_MS = 1200;
const BASE_Z = 300; // 基础行为特效层
const EXTRA_Z = 301; // 协议专属额外特效层（叠加在基础特效之上）

/** 克隆目标卡到 body 级浮层（固定定位到原卡位置，不随重渲染销毁）；尺寸为 0（未布局）返回 null */
function cloneCardToBody(node: HTMLElement, zIndex: number): HTMLElement | null {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.position = 'fixed';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.pointerEvents = 'none';
  clone.style.zIndex = String(zIndex);
  clone.querySelector('.play-btns')?.remove();
  document.body.appendChild(clone);
  return clone;
}

/** Fire 协议专属额外特效：火焰焚烧（fire-burn.css 覆盖层结构见 public/assets/fire/README.md） */
function playFireBurnExtra(node: HTMLElement): void {
  const clone = cloneCardToBody(node, EXTRA_Z);
  if (!clone) return;
  clone.classList.add('card-burning');
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
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 基础行为特效：删去 → 破碎消散（Gemini delete-shatter.js 的 mountShatter） */
async function playShatter(node: HTMLElement): Promise<void> {
  const clone = cloneCardToBody(node, BASE_Z);
  if (!clone) return;
  // @ts-ignore - Gemini FX 模块位于 public/assets/fx/，运行时按根路径动态加载（bundler 解析不覆盖 public）
  const mod = (await import(/* @vite-ignore */ '/assets/fx/delete-shatter.js')) as {
    mountShatter(node: HTMLElement): void;
  };
  mod.mountShatter(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 基础行为特效：弃牌 → 沿对角线切成两半（Gemini discard-cut.js 的 mountCut） */
async function playCut(node: HTMLElement): Promise<void> {
  const clone = cloneCardToBody(node, BASE_Z);
  if (!clone) return;
  // @ts-ignore - 同 playShatter：public 下 Gemini 模块运行时动态加载
  const mod = (await import(/* @vite-ignore */ '/assets/fx/discard-cut.js')) as {
    mountCut(node: HTMLElement): void;
  };
  mod.mountCut(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 预加载 Gemini FX 模块（首次触发动画无等待） */
function preloadFx(): void {
  // @ts-ignore - Gemini FX 模块位于 public/assets/fx/，运行时按根路径动态加载（bundler 解析不覆盖 public）
  void import(/* @vite-ignore */ '/assets/fx/delete-shatter.js');
  // @ts-ignore - 同上
  void import(/* @vite-ignore */ '/assets/fx/discard-cut.js');
}

/**
 * 特效注册表（分层模型）：
 * - 基础行为特效：弃牌=对切、删去=破碎——目标卡上**总是**播放（与谁触发无关）
 * - 额外协议特效：由**触发弃牌/删去的卡**（triggerProtocol，效果源卡协议）决定是否叠加
 *   （如 fire 协议触发 → 额外火焰焚烧，叠在基础特效之上；与被删/弃的目标卡协议无关）
 */
export function initEffects(): () => void {
  preloadFx();
  return gameBus.subscribe((e: GameEvent) => {
    const payload = e.payload as
      | { uid?: string; triggerProtocol?: string; triggerDefId?: string }
      | undefined;
    if (!payload?.uid) return;
    const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
    if (!node) return;
    // 基础行为特效（总是播放）
    if (e.type === 'card:discarded') {
      void playCut(node);
    } else if (e.type === 'card:deleted') {
      void playShatter(node);
    } else {
      return;
    }
    // 额外协议特效（触发卡协议驱动，叠加上层）
    if (payload.triggerProtocol === 'fire') {
      playFireBurnExtra(node);
    }
  });
}
