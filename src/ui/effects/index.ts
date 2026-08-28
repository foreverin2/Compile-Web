import { gameBus, type GameEvent } from '../../core/events/bus';
import { mountShatter } from '../fx/delete-shatter';
import { mountCut } from '../fx/discard-cut';

const FX_REMOVE_MS = 1200;
const BASE_Z = 300; // 基础行为特效层
const EXTRA_Z = 301; // 协议专属额外特效层（叠加在基础特效之上）

/** 事件载荷里的卡牌面信息（emitCardEvent 已含 defId/faceUp/uid） */
interface FxCardPayload {
  uid: string;
  defId: string;
  faceUp: boolean;
  triggerProtocol?: string;
  triggerDefId?: string;
}

/**
 * 在 body 级构建特效浮层卡（固定定位到原卡位置，不随重渲染销毁）。
 * 卡面直接用【当前卡牌面】按 payload 的 defId/faceUp 构建（官方卡面图 / 卡背），
 * 不克隆原卡 DOM——避免原卡的旋转类、覆盖残留、悬停态等陈旧渲染混入特效；
 * 位置/尺寸取自原卡节点 rect（旋转卡的 rect 即其视觉足迹盒）。
 */
function buildFxCard(node: HTMLElement, payload: FxCardPayload, zIndex: number): HTMLElement | null {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const card = document.createElement('div');
  card.className = 'card';
  if (payload.faceUp) {
    const [proto, value] = payload.defId.split('-');
    const img = document.createElement('img');
    img.className = 'card-face-img';
    img.src = `/assets/protocols/${proto}/card-${value}.png`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    card.appendChild(img);
  } else {
    const back = document.createElement('div');
    back.style.position = 'absolute';
    back.style.inset = '0';
    back.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.src = '/assets/Cardback.jpg';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    back.appendChild(img);
    card.appendChild(back);
  }
  card.style.position = 'fixed';
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.margin = '0';
  card.style.padding = '0';
  card.style.border = 'none';
  card.style.background = 'transparent';
  card.style.pointerEvents = 'none';
  card.style.zIndex = String(zIndex);
  document.body.appendChild(card);
  return card;
}

/** Fire 协议专属额外特效：火焰焚烧（fire-burn.css 覆盖层结构见 public/assets/fire/README.md） */
function playFireBurnExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
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

/** 基础行为特效：删去 → 破碎消散（src/ui/fx/delete-shatter.ts 的 mountShatter） */
function playShatter(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  mountShatter(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 基础行为特效：弃牌 → 沿对角线切成两半（src/ui/fx/discard-cut.ts 的 mountCut） */
function playCut(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  mountCut(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/**
 * 特效注册表（分层模型）：
 * - 基础行为特效：弃牌=对切、删去=破碎——目标卡上**总是**播放（与谁触发无关）
 * - 额外协议特效：由**触发弃牌/删去的卡**（triggerProtocol，效果源卡协议）决定是否叠加
 *   （如 fire 协议触发 → 额外火焰焚烧，叠在基础特效之上；与被删/弃的目标卡协议无关）
 * - 卡面直接用【当前卡牌面】（payload 的 defId/faceUp 构建），不克隆原卡 DOM
 */
export function initEffects(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    const payload = e.payload as FxCardPayload | undefined;
    if (!payload?.uid || !payload.defId) return;
    if (e.type !== 'card:discarded' && e.type !== 'card:deleted') return;
    const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
    if (!node) return;
    // 基础行为特效（总是播放）
    if (e.type === 'card:discarded') {
      playCut(node, payload);
    } else {
      playShatter(node, payload);
    }
    // 额外协议特效（触发卡协议驱动，叠加上层）
    if (payload.triggerProtocol === 'fire') {
      playFireBurnExtra(node, payload);
    }
  });
}
