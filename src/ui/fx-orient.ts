/**
 * 卡牌朝向的**单一出处**（G2）。见 docs/2026-09-13-联机与多端-设计稿.md §6。
 *
 * 热座页给场上卡加 rot-cw(+90°) / rot-ccw(−90°)：同一块屏幕前两位玩家各自看得正。
 * 远程页改为**自己正立(0°) / 对手 180° 倒置**（像隔桌对坐）—— 因此新增 180°。
 *
 * ⚠️ **G2 修正 R2 起这里有两套朝向，别混用**（设计说明 §2 的朝向表 / §3.1 的机制）：
 *  - `orientOf` = **卡面**朝向（热座 ±90°；远程页 0°/180°）；
 *  - `fxOrientOf` = **特效**朝向（远程页自己 −90°、对手 +90°，读 `data-fx-rot`；热座无标记 ⇒ 回退 `orientOf`）；
 *  - `fxRotDegOf` = **只读标记**的裸角度（G2 修正 R8-4：**不回退**，读不到即 0°）——
 *    专给"把 body 级 FX 层搬到协议**视觉**盒上"的场合（协议 holder / 翻面浮层）。
 *  远程页自己卡面 0° 而特效 −90°、对手卡面 180° 而特效 +90° —— 拿卡面朝向去建浮层卡，
 *  整类特效（刀光/光束/粒子/边框光/飓风/闪电…）都会差 90°。
 *
 * ⚠️ ±90° 会**交换布局盒宽高**，0°/180° 不会。浮层卡（飞行中的幽灵卡）的几何必须按此区分，
 * 否则出现"尺寸正确但朝向错"或"朝向对但尺寸错"的假正确。
 */

export type CardOrient = 0 | 90 | -90 | 180;

/** 全部朝向类名。清理方（如 playRiseFade 的克隆）必须三个一起摘 —— 只摘 ±90° 会漏掉 180°。 */
export const ORIENT_CLASSES = ['rot-cw', 'rot-ccw', 'rot-180'] as const;

/** 摘掉节点的全部朝向类（安全：classList/remove 缺失即静默返回）。
 *  这是 FX 模块**唯一**允许触碰朝向类名的地方 —— 源码守卫禁止 FX 模块再写字面量。 */
export function stripOrientClasses(node: Element | null | undefined): void {
  const cl = (node as { classList?: { remove(...c: string[]): void } } | null | undefined)?.classList;
  if (!cl || typeof cl.remove !== 'function') return;
  cl.remove(...ORIENT_CLASSES);
}

/** 从节点类名读朝向。180 优先于 ±90（同时带时按 180 算）。 */
export function orientOf(node: Element | null | undefined): CardOrient {
  const cl = (node as { classList?: { contains(c: string): boolean } } | null | undefined)?.classList;
  if (!cl || typeof cl.contains !== 'function') return 0;
  if (cl.contains('rot-180')) return 180;
  if (cl.contains('rot-cw')) return 90;
  if (cl.contains('rot-ccw')) return -90;
  return 0;
}

/* ============================================================================
 * 特效朝向（G2 修正 R2）：**与卡面朝向不是同一套**
 * ========================================================================== */

/**
 * 特效朝向标记的属性名（远程页场上卡；规格 §8.2 钉死的名字）。
 *
 * ⚠️ 只有 `src/ui/render-net.ts` 产出它（`renderStackSlot` 的 `fxRot` 参数 ⇒ `render.ts` 里
 * `node.dataset.fxRot = opts.fxRot`），**热座页不产出**（`opts.fxRot` 缺省 undefined ⇒ 一条属性都不写）。
 * 正是这个"热座 DOM 上没有这条属性"让 `fxOrientOf` 的**回退**成为「热座零变化」的构造性证明。
 */
export const FX_ROT_ATTR = 'data-fx-rot';

/** `data-fx-rot` 的两种取值 → 特效朝向的**裸角度**。规格 §8.2：自己 `ccw`（−90°）、对手 `cw`（+90°）。
 *  ⚠️ 映射的**唯一出处**：`FX_ROT_VALUES`（CardOrient 版）与 `fxRotDegOf` 的返回值都从这里派生，
 *  免得"两处各自写一份 −90/90"将来对不上（R8-4 起有两个消费方读角度）。 */
const FX_ROT_DEGS: Readonly<Record<'cw' | 'ccw', 90 | -90>> = { ccw: -90, cw: 90 };

/** `data-fx-rot` 的两种取值 → 特效朝向（CardOrient 版，供 `fxOrientOf` 用；值同 `FX_ROT_DEGS`）。 */
const FX_ROT_VALUES: Readonly<Record<string, CardOrient>> = FX_ROT_DEGS;

/**
 * 读**特效朝向标记**的原始取值：只有 `'cw' | 'ccw'` 两种合法值；**读不到 / 取值不认识 ⇒ `null`**。
 *
 * ⚠️ 与 `fxOrientOf` 的分工（G2 修正 R-F · Minor M-3）：`fxOrientOf` 读不到标记时会**回退**
 * 卡面朝向（那是"热座零变化"的机制）—— 于是"标记缺失"与"标记本来就是 0°/180°"在它的返回值上
 * **不可区分**。凡是需要**区分**这件事的地方（例如覆盖方向要给出可诊断的信号、而不是静默按
 * 某一侧兜底）必须用本函数：它把"缺失"如实交回 `null`。
 */
export function fxRotMarkerOf(node: Element | null | undefined): 'cw' | 'ccw' | null {
  const raw = (node as { getAttribute?(name: string): string | null } | null | undefined)
    ?.getAttribute?.(FX_ROT_ATTR);
  return raw === 'cw' || raw === 'ccw' ? raw : null;
}

/**
 * 读**特效朝向**：优先 `data-fx-rot`（`"ccw"` → −90°、`"cw"` → +90°），**读不到或值不认识时
 * 回退 `orientOf(node)`**（= 卡面朝向）。
 *
 * 为什么必须有回退（而不是"没有标记就返回 0"）：
 *  - **热座页**（`render.ts`）从不写这条属性 ⇒ 每次调用都走回退 ⇒ 拿到与改动前**逐字相同**的
 *    卡面朝向 ⇒ 浮层卡几何、翻面覆盖层、破碎/切割全部走原分支 ⇒ **热座观感零变化是构造性的**，
 *    不依赖"我记得把每处都改对"。
 *  - 值不认识时（拼错 / 将来第三种取值）同样回退 —— 返回 0 会让热座卡**直立**（远处看不出来、
 *    但整类特效错位），回退至少与改前一致。
 *
 * ⚠️ **不要**把它用在"卡面本身"的读取点上：远程页自己卡面 0° 而特效 −90°（规格 §2 的朝向表），
 * 两者相差 90°。卡面朝向继续走 `orientOf`。
 * ⚠️ **不要**用它来判"标记在不在" —— 那要 `fxRotMarkerOf`（本函数会把缺失回退掉）。
 */
export function fxOrientOf(node: Element | null | undefined): CardOrient {
  const marker = fxRotMarkerOf(node);
  return marker === null ? orientOf(node) : FX_ROT_VALUES[marker];
}

/**
 * **只读特效朝向标记的原始角度**（G2 修正 **R8-4**）：`ccw` → −90、`cw` → +90；
 * **读不到或不认识 ⇒ `0`（不旋转）**。
 *
 * ⚠️ 与 `fxOrientOf` 的唯一区别、也是它存在的理由：**不回退** `orientOf`。
 *
 * **为什么必须"不回退"**（规格 §3.2 给的承重理由是"热座页 P2 协议图自己带 `.rot-180`，
 * 回退会把热座页的 FX 层转 180°"）—— ⚠️ **实现者实测更正**：本函数的读目标是
 * `.protocol-holder`，而 `rot-180` 挂在它的**子节点** `.protocol-img` 上，holder 自己没有朝向类
 * ⇒ **今天**回退 `orientOf(holder)` 也恰好得 0（两条实现当前**行为等价**）。
 * 所以这条要求是**结构性**的，不是当前观感差异，仍然必须遵守：
 *  1. 它把"协议特效朝向"与"卡面朝向"两个概念**钉开** —— 一旦读目标换成协议**图**本身
 *     （`.protocol-img` 上就带 `.rot-180`），或将来有人把朝向类挂到 holder 上，
 *     回退实现会**立刻**把协议 FX 层按 180° 建盒/旋转，而画面上只是"特效方向不对"；
 *  2. `data-fx-rot` **缺失**是 R8-4 的真实缺陷形态（`render-net` 忘传）—— 不回退 ⇒ 得 0（不旋转，
 *     由 `verifyPageHooks` 的约束 10 报红）；回退 ⇒ 静默按卡面朝向猜一个角度。
 *  3. 它是"热座零变化"的**构造性**保证：热座没有标记 ⇒ 恒 0°，与"协议子树上有没有朝向类"无关。
 */
export function fxRotDegOf(node: { getAttribute(name: string): string | null } | null): 0 | 90 | -90 {
  const marker = fxRotMarkerOf(node as unknown as Element | null);
  return marker === null ? 0 : FX_ROT_DEGS[marker];
}

/** 与既有 buildFxCardAt(rect, orient, …) 的参数形状对齐 */
export function orientToCwCcw(o: CardOrient): { cw: boolean; ccw: boolean; flip180: boolean } {
  return { cw: o === 90, ccw: o === -90, flip180: o === 180 };
}

/** `--fx-rot` 用的**裸角度**（`'0deg'|'90deg'|'-90deg'|'180deg'`）。
 *  ⚠️ 与 `cloneTransformOf()`（完整 transform 函数串）**不可混用**，见本文件头部约定注释。 */
export function orientToFxRot(o: CardOrient): string {
  switch (o) {
    case 90: return '90deg';
    case -90: return '-90deg';
    case 180: return '180deg';
    default: return '0deg';
  }
}

/** 该朝向是否交换布局盒宽高 */
export function cloneBoxSwaps(o: CardOrient): boolean {
  return o === 90 || o === -90;
}

/** 浮层卡应施加的 rotate() 值（空字符串 = 不施加）
 *
 * 表示约定：本输出是**完整 transform 函数串**，只用于直接赋 `style.transform`
 * （同 buildProtocolGhost，src/ui/effects/index.ts:2179）。
 * `--fx-rot` 路径要的是**裸角度**（`'90deg'`/`'180deg'`，见 src/ui/effects/index.ts:157-158）；
 * **切勿**把本输出赋给 `--fx-rot` —— 会得到 `rotate(rotate(90deg))`，计算值无效，
 * 整条内联 transform 声明被丢弃（连带组合的 `translate(...)`/`scale(...)`）。
 * `''` 两条路径都安全（移除属性/声明），故 0° 无需特判。
 */
export function cloneTransformOf(o: CardOrient): string {
  switch (o) {
    case 90: return 'rotate(90deg)';
    case -90: return 'rotate(-90deg)';
    case 180: return 'rotate(180deg)';
    default: return '';
  }
}
