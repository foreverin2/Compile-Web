/**
 * 「自定义协议池」的**纯逻辑**（2026-10-06，用户要求）。
 *
 * ## 这个文件解决什么
 *
 * 用户要的是"玩家自己挑至少 12 套协议，本局只用这些"。难点不在挑，在**两端一致**：
 *
 *  1. **热座**：池子直接来自本机存的那份选择（`src/app/local-store.ts` 的 `pool` 字段）；
 *  2. **联机**：`src/net/**`（含 `protocol.ts`）**冻结**，握手消息里"房主发给加入方的既有字段"
 *     只有 `seed` 一个。所以房主把自己挑的 defId 列表**编码进它生成的那粒对局种子**
 *     （种子本来就是"两端唯一共享的对局设置来源"），两端都从同一个种子解出同一份池子。
 *
 * ## 三条硬性质（测试逐条钉住）
 *
 *  - **顺序确定**：`buildPool()` 一律按 `DEMO_PROTOCOLS` 的**常量顺序**过滤，不按点击顺序、
 *    不按存储顺序 ⇒ 对同一个 defId 集合，两端算出来的数组**逐项一致**（判据：`toEqual`）；
 *  - **可逆**：`poolIdsFromSeed(encodePoolIntoSeed(seed, ids))` 等于 `ids` 归一之后的那一份；
 *  - **幂等**：编码两次 == 编码一次（第二次先把上一段编码摘掉再写）；
 *    没有编码的种子解出 `null`（`undefined` 那种"半个真相"不在这里出现）。
 *
 * ## 它是纯层
 *
 * `src/app/**` 的生成式守卫（`tests/app-purity.test.ts`）要求这里零浏览器 API、
 * 零 `Math.random` / `Date.now` / `node:*` ⇒ 本文件只 import 数据与类型，能在 node 里裸跑。
 */
import type { ProtocolDef } from '../core/models/types';
import { DEMO_PROTOCOLS } from '../data/demo';

/**
 * 自定义协议池的**最小套数**（全仓唯一定义处）。
 *
 * 屏上那句「至少选 12 套」、挑选屏「完成」按钮的可用判据、以及开局前对存储选择的复核，
 * 三处都读这一个常量 —— 各写一个 12 就是三份真相。
 */
export const POOL_MIN = 12;

/**
 * 种子里那一段"池子编码"的起始标记。
 *
 * 取值理由：种子本身是 `newRandomToken(16)` 的小写 hex（`src/ui/match-seed.ts`），
 * 只含 `[0-9a-f]` ⇒ `#` 与 `,` 都不可能与"天然种子"撞上，于是"有没有编码"这件事
 * 可以用一次 `indexOf` 判死。
 */
const POOL_TAG = '#pool=';

/** 一份池子选择（存进 `L1_SETTINGS.pool` 的形状，也是挑选屏交给宿主的形状） */
export interface PoolChoice {
  /** 勾选框状态；`false` = 本局不启用自定义池（与"勾了但没有合法选择"是两件事） */
  readonly enabled: boolean;
  /** 玩家挑的 defId（**归一前的原样**；未知 id / 重复项由下面几个函数自己消化） */
  readonly ids: readonly string[];
}

/**
 * 归一：只留**现有协议**里的 defId，去重，并排成 `DEMO_PROTOCOLS` 的常量顺序。
 *
 * 为什么顺序要在这里定死（而不是保留玩家的点击顺序）：联机两端**各自**解同一粒种子，
 * 只要顺序依赖任何一边的本地状态（点击顺序、存储遍历顺序），两端 `draftPool` 就可能逐项不同
 * ⇒ 状态指纹分叉。常量顺序是唯一"两边都必然一样"的顺序。
 *
 * 未知 defId **忽略**（存储被外部手改、或下次版本删掉了某个协议时，池子退化成"剩下的那些"，
 * 而不是抛异常让玩家打不开游戏）。
 */
export function normalizePoolIds(defIds: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const id of defIds) if (typeof id === 'string' && id !== '') wanted.add(id);
  return DEMO_PROTOCOLS.filter((p) => wanted.has(p.defId)).map((p) => p.defId);
}

/**
 * defId 列表 → 本局协议池（`ProtocolDef[]`）。
 *
 * 判据面就是 `DEMO_PROTOCOLS` 的常量顺序：先 `filter` 再原样返回**同一个对象引用**
 * （不是复制一份），于是"池里的协议就是数据集里那几套"这件事在两端、在重放里都成立。
 */
export function buildPool(defIds: readonly string[]): ProtocolDef[] {
  const wanted = new Set(normalizePoolIds(defIds));
  return DEMO_PROTOCOLS.filter((p) => wanted.has(p.defId));
}

/** 这份选择够不够开局（归一之后 ≥ `POOL_MIN`） */
export function isPoolUsable(defIds: readonly string[]): boolean {
  return normalizePoolIds(defIds).length >= POOL_MIN;
}

/**
 * 一份**存下来的选择** → 本局协议池；`null` = "这一局不用自定义池"
 * （没勾 / 选择丢了 / 不够 `POOL_MIN` 套 —— 三种情形在开局这件事上是同一个动作：
 * 回落成"全部协议"，也就是 `createGame` 的 `draftPool: undefined`）。
 */
export function poolDefsOf(choice: PoolChoice): ProtocolDef[] | null {
  if (!choice.enabled) return null;
  const ids = normalizePoolIds(choice.ids);
  if (ids.length < POOL_MIN) return null;
  return buildPool(ids);
}

/**
 * 把池子**编码进种子**（`encodePoolIntoSeed` / `poolIdsFromSeed` 是**成对**的）。
 *
 * ## 格式与两条性质
 *
 * `seed + '#pool=' + ids.join(',')`。`ids` 先归一（顺序 = `DEMO_PROTOCOLS` 常量顺序）。
 *
 *  - **幂等**：编码前先把**已有的那一段**摘掉（`split(POOL_TAG)[0]`）⇒ 对同一个入参重复调用，
 *    结果逐字节相同（否则第二次会把两段编码叠起来，解出来是垃圾）；
 *  - **空集不编码**：`ids` 归一后为空 ⇒ 原样返回 `seed`（"没有编码 ⇒ 解出 `null`"这条
 *    单向性质因此成立；空池子本来也不是一局能开的池子）。
 */
export function encodePoolIntoSeed(seed: string, defIds: readonly string[]): string {
  const base = seed.split(POOL_TAG)[0] ?? seed;
  const ids = normalizePoolIds(defIds);
  if (ids.length === 0) return base;
  return base + POOL_TAG + ids.join(',');
}

/**
 * 从种子里解出池子的 defId 列表；**没有编码的种子回 `null`**（不是空数组）。
 *
 * 回 `null` 与"编码里一个 id 都不认识"是分开的两件事吗？不是 —— 两者在本函数里**都**回 `null`：
 * 调用方（`poolFromSeed` / `enterNetGame`）对这两种情形的动作完全一样（回落成全部协议），
 * 所以不为此多造一个返回值。
 */
export function poolIdsFromSeed(seed: string): string[] | null {
  const at = seed.indexOf(POOL_TAG);
  if (at < 0) return null;
  const raw = seed.slice(at + POOL_TAG.length);
  if (raw === '') return null;
  const ids = normalizePoolIds(raw.split(','));
  return ids.length === 0 ? null : ids;
}

/**
 * 从**对局种子**解出本局协议池；`null` = "这粒种子里没有可用的池子编码"
 * （没编码 / 解出来不够 `POOL_MIN` 套）。
 *
 * 联机那一支只用它（`src/main.ts` 的 `enterNetGame`）：两端拿到的是同一粒 `hand.seed`
 * ⇒ 同一个入参、同一个纯函数 ⇒ **逐项相同**的数组。本地那份选择在这条路上一次都不读
 * —— 加入方覆盖不了房主的预设。
 */
export function poolFromSeed(seed: string): ProtocolDef[] | null {
  const ids = poolIdsFromSeed(seed);
  if (ids === null) return null;
  return poolDefsOf({ enabled: true, ids });
}
