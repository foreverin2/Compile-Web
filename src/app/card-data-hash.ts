/**
 * 卡牌数据指纹（G3；见 docs/2026-09-13-联机与多端-设计稿.md §3.4）。
 *
 * 用途：防止两台设备卡牌数据版本不同导致**规则分歧** —— 设计稿称它是"联机最容易被忽略、
 * 后果最严重的一类 bug"。联机握手时用它做互斥校验（§3.5 第 3 条，G5 消费）。
 *
 * 为什么**不是**构建期生成的文件：本仓零运行时依赖、且 `vite.config.ts` 只有 `test` 段，
 * 加一个"构建期生成 TS 常量"的步骤要么改构建配置、要么多一个可能失败的构建阶段。
 * 运行期现算一遍（约 90KB 字符串的 FNV-1a）在模块首次求值时一次完成，**零漂移风险**。
 * `CARD_DATA_HASH` 一旦与现算值不符，`tests/app/card-data-hash.test.ts` 第 1 条当场红。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 覆盖面（**包含什么 / 不包含什么**，裁决理由逐条写明）
 *
 * **纳入**（影响规则与结算的"分身"）：
 *   - 卡：`defId / protocol / value / top / middle / bottom`（top/middle/bottom = 效果文本）
 *   - 协议：`defId / commands`（§3.4 的"命令文本"；本计划 Task 2 设计要点 1 明确纳入）
 *
 * **注意：重复条目可见** —— 排序**不去重**，两张完全相同的卡各占一行，条目数因此隐式进指纹；
 *   若哪天把它重构成 Set/Map 去重，"多一张重复卡"就会静默变成不改指纹（测试里有对应行为腿）。
 *
 * **排除**（纯展示/派生数据，纳入只会制造**假不匹配**，白白阻止联机）：
 *   - 协议 `name`（『流水』这类展示名；卡名=卡的身份 `defId`，`defId` 在纳入面内）
 *   - 协议 `loadingText`（读条文案）
 *   - 协议 `set`（`MN01/AX01/MN02…` 世代/分组元数据；只影响取图后缀与图鉴分组，不影响规则）
 *   - `PROTOCOL_RATINGS`（`src/data/protocolRatings.ts:1` 明写"自动生成…勿手改"，草稿页 hover 展示数据）
 *   - 卡图/协议图路径（本仓不存在该字段，取图由 `cardImgSrc/protocolImgSrc` 从 `set+defId` 派生）
 *   - 对象上的**任何未知附加字段**（只读具名字段，不遍历键）
 *
 * **顺序语义（本文件的取舍，测试里有对应的正反两腿）**：
 *   - `cards` / `protocols` **两个数组的顺序无关**：三代并池顺序会随数据文件增删变化，
 *     同一批数据换个拼接顺序不该被判成"卡牌数据不同"。
 *   - 协议 `commands` **内部顺序有关**：它是 §3.4 点名的"命令文本"，本仓当前只有 UI 展示在读它
 *     （`src/ui/render.ts:4588`、`src/ui/home.ts:633`），但没有任何证据表明"换序 = 语义不变"，
 *     故取**失效安全**（fail-closed）方向：换序 ⇒ 指纹变 ⇒ 宁可假不匹配，不可假匹配。
 *
 * **跨平台**：排序一律用**码点序**（`byCodePoint`），**禁止** `localeCompare`/`Intl.Collator`
 *   —— 它们的结果随运行 locale 变化，换台机器就得到另一个指纹，等于给联机埋随机不匹配。
 *
 * **归一化**：`undefined` 与空串在可选字段上等价（`?? ''`）—— 二者都表示"该位无指令"，
 *   抹平差异可以避免"一台设备写 `top: ''`、另一台省略 `top`"这类纯写法差异造成的假不匹配。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { CardDef, ProtocolDef } from '../core/models/types';
import { hash32 } from '../core/rng';
import { DEMO_CARD_DEFS, DEMO_PROTOCOLS } from '../data/demo';

/** 指纹格式版本：纳入面 / 拼串方式一变，这里必须 +1（§3.4 的 `cardDataHash` 是跨设备契约） */
const FORMAT = 'compile-carddata-v1';

/** 字段分隔符 = U+001F（单元分隔符）：卡牌文本里不可能出现，避免字段边界歧义 */
const US = '\u001f';

/** 行分隔符 = U+000A（换行） */
const RS = '\n';

/**
 * 码点序比较器（**不是** `localeCompare`）。
 *
 * `a < b` 走的是 JS 字符串的 UTF-16 码元序，与运行 locale、ICU 数据版本、系统语言全部无关
 * —— 这正是"同一份数据在哪台设备上都算出同一个指纹"的前提。
 */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 卡行：字段顺序固定，缺失的可选文本一律归一成空串 */
function cardLine(c: CardDef): string {
  return ['C', c.defId, c.protocol, String(c.value), c.top ?? '', c.middle ?? '', c.bottom ?? ''].join(US);
}

/** 协议行：字段顺序固定（`commands` 保持原顺序，见文件头"顺序语义"） */
function protocolLine(p: ProtocolDef): string {
  return ['P', p.defId, p.commands.join('/')].join(US);
}

/** FNV-1a 32 位拼两段 → 16 位十六进制（与 `core/fingerprint.ts` 的 `hash64` 同规格） */
function pairHash(text: string): string {
  const a = hash32(text);
  const b = hash32(`${text}#${a}`);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * 卡牌数据指纹。
 *
 * 纯函数：不读模块状态、不写任何东西、**不修改入参**（排序在 `map()` 产生的新数组上做）。
 * 因此 `cardDataHashOf(same, same)` 恒等，且调用方可以安全地传只读数组。
 */
export function cardDataHashOf(cards: readonly CardDef[], protocols: readonly ProtocolDef[]): string {
  // 排序键用**整行**而不是只按 defId：defId 重复（同 defId、内容不同）时也能得到与输入顺序
  // 无关的全序；非重复时等价于"按 defId 排序"（同组行共有 'C'/'P' 前缀）。
  const cardLines = cards.map(cardLine).sort(byCodePoint);
  const protoLines = protocols.map(protocolLine).sort(byCodePoint);
  // 注意：排序**不去重** —— 完全重复的条目各占一行，因此"多塞一张与别处完全相同的卡"同样改变
  // 指纹；任何把它改成 Set/Map 去重的重构都会让这条区分消失（测试里有对应的行为腿）。
  return pairHash([FORMAT, ...protoLines, ...cardLines].join(RS));
}

/** 本机卡牌数据指纹（模块顶层求值一次；ES 模块只求值一次，无需另做缓存） */
export const CARD_DATA_HASH: string = cardDataHashOf(DEMO_CARD_DEFS, DEMO_PROTOCOLS);
