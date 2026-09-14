/**
 * FX DOM 契约（G1；见 docs/2026-09-13-联机与多端-设计稿.md §6.3）。
 *
 * 特效层通过选择器/数据属性依赖渲染器产出的 DOM。G2 要重写远程对战页面，
 * 这份清单就是那份「远程页必须提供」的验收基准 —— 少一项就会有整条点名特效静默不播
 * （本项目历史上已发生过多次，见 docs/3代特效-进度与上下文.md §0）。
 *
 * 分类（判定规则见 docs/4代-FX DOM 契约.md）：
 *  A 结构钩子：**渲染器产出 且 FX 真的读它**（两个条件缺一不可）→ 远程页必须提供（契约项）
 *  B 特效自建节点：特效自己 createElement 后取回 → 渲染器无需提供
 *  C 内部注册键：特效挂在元素上的记账 dataset 键 → 渲染器无需提供
 *  D 渲染器自有、FX 不读：渲染器产出但**零个 FX 模块引用** → **不是**契约项，远程页无需为 FX 提供
 *
 * 判定口径：**逐读取点问「这个元素是谁创建的」，不按属性名一刀切**，且 A 类的最后一步
 * 永远是 `git grep` 到**至少一个 FX 模块真的读它**：只看「渲染器产出」会把 FX 根本不读的
 * 节点也塞进契约（G1 首轮就因此把 .hand-strip / .play-btns / .lane-row 误判成契约项——
 * 那份普查把 render.ts 自己的查询也算成了 FX 依赖）。三条都归 D。
 *  - 同理两个 dataset 键分属两类：`[data-uid]` 是 render.ts 写在卡节点上的（A，特效只读）；
 *    而 `[data-band]` 是常驻层写在**自建**网格/条纹/封条上的记账句柄（C，gen3-control.ts:277/407/441/555）。
 *  - 同一条钩子在不同模块可能被读多次，但钩子字符串只登记一次（守卫测试禁止重名）。
 *  - `requiredBy` 只登记 **FX 消费方**；D 类没有 FX 消费方，故为空数组（守卫测试强制这一点）。
 */

export type FxDomHookKind = 'attr' | 'class' | 'element';

export interface FxDomHook {
  /** 稳定选择器（属性选择器不带具体值，如 `.deck[data-player]`） */
  hook: string;
  kind: FxDomHookKind;
  /** A 渲染器产出且 FX 真的读它（契约项）；B 特效自建；C 特效内部注册键；
   *  D 渲染器产出但 FX 不读（**不是**契约项） */
  category: 'A' | 'B' | 'C' | 'D';
  /** FX 消费方模块名（见 tests/ui/fx-dom-contract.test.ts 的 FX_MODULES）；
   *  D 类无 FX 消费方 → 必须是空数组 */
  requiredBy: readonly string[];
  /** 一句话：这个钩子供什么特效定位用 */
  note?: string;
}

export const FX_DOM_CONTRACT: readonly FxDomHook[] = [
  // ============================ A 结构钩子（远程页必须提供） ============================

  // —— 链路 / 协议几何：3 代飞行、连接件、常驻层的落点 ——
  {
    hook: '.stack-slot[data-player][data-line]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts', 'fx-gen2.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'effects/index.ts'],
    note: '链路槽几何：3 代飞行/连接件/常驻层的落点（slotRectOf / lineCenterX），最核心的一条',
  },
  {
    hook: '.protocol-cell[data-player][data-line]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts', 'fx-gen2.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'effects/index.ts'],
    note: '协议格：协议交换/重排、同化编译光柱、色欲封条按 (player,line) 定位',
  },
  {
    hook: '.protocol-img', kind: 'element', category: 'A',
    requiredBy: ['fx-gen3-swap.ts', 'effects/index.ts'],
    note: '协议卡面图：协议交换幽灵卡取它的 rect 与卡面图',
  },
  {
    hook: '.protocol-holder', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts'],
    note: '协议持卡盒：同化1 编译光柱的汇聚中心（取不到就整体不播，见 fx-gen2.ts:2179 审计注释）',
  },
  {
    hook: '[data-uid]', kind: 'attr', category: 'A',
    requiredBy: ['gen3-util.ts', 'fx-gen2.ts', 'fx-gen3.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'effects/index.ts'],
    note: '按 uid 取卡节点 rect（nodeOf → visibleRectOf / clipInsetRightPct）；手牌与链路卡都要带',
  },
  {
    hook: '.trash-pile[data-player]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts', 'fx-gen2.ts', 'effects/index.ts'],
    note: '弃牌堆位置：弃牌/回溯飞行的终点（trashPos）；fx-gen3 另有按 .trash-pile.p1/.p2 取的一种写法',
  },
  {
    hook: '.deck[data-player]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts', 'effects/index.ts'],
    note: '牌库位置：牌库顶打出/洗牌/冰封牌库等特效的起点或终点（deckPos），全库被读约 60 处',
  },
  {
    hook: '.battery', kind: 'class', category: 'A',
    requiredBy: ['gen3-control.ts'],
    note: '能量槽：愤怒0 中缝虚线要跨「两条能量槽之间」而非整行，惰性0 也要能量槽 rect（batteryNode）',
  },

  // —— 手牌区 / 卡节点 ——
  {
    hook: '.hand', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts', 'effects/index.ts', 'fx-gen3.ts'],
    note: '手牌区：抽牌幽灵终点、扇形末卡位置、手牌区 rect（多处用 querySelectorAll(".hand")[player]）',
  },
  {
    hook: '.hand[data-player]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts'],
    note: '手牌区（带归属）：3 代按玩家取手牌容器（fx-gen3.ts:875）',
  },
  {
    hook: '.card', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts', 'effects/index.ts', 'fx-gen3.ts'],
    note: '卡节点：卡面克隆、扇形末卡位置、链路末卡位置（多处写作 .card:not(.reveal-ghost)）',
  },
  {
    hook: '.rot-cw', kind: 'class', category: 'A',
    requiredBy: ['effects/index.ts', 'fx-gen3.ts'],
    note: '场上卡横置态（P1 顺时针，render.ts:227 按 owner 挂）：浮层卡按它重建朝向，漏挂则特效卡立着',
  },
  {
    hook: '.rot-ccw', kind: 'class', category: 'A',
    requiredBy: ['effects/index.ts', 'fx-gen3.ts'],
    note: '场上卡横置态（P2 逆时针，render.ts:227 按 owner 挂）：与 .rot-cw 成对读取',
  },
  {
    hook: 'img', kind: 'element', category: 'A',
    requiredBy: ['fx-gen2.ts', 'fx-gen3-swap.ts', 'fx/delete-shatter.ts', 'fx/discard-cut.ts'],
    note: '卡面图：偏转/破碎/切割/翻面/交换取卡面图的唯一来源（render.ts 造 .card-face-img / .protocol-img）；'
      + '6 个读取点全在渲染器产出的卡节点（或它的克隆）上：effects/index.ts:641/764（playFlip 源卡，缺失则回退 cardFaceSrc）、'
      + 'fx-gen2.ts:967、fx-gen3-swap.ts:120、fx/delete-shatter.ts:36、fx/discard-cut.ts:19',
  },

  // —— 控制组件（gen3-control 定位锚点） ——
  {
    hook: '.control-module', kind: 'class', category: 'A',
    requiredBy: ['gen3-control.ts'],
    note: '控制组件：色欲持有牵引环、控制权判定标题的锚点（取不到则回退视口中心）',
  },
  {
    hook: '.control-slider-img', kind: 'class', category: 'A',
    requiredBy: ['gen3-control.ts'],
    note: '控制组件滑块图：优先于 .control-module 作为量测目标（controlImgRect）',
  },
  {
    hook: '.control-track', kind: 'class', category: 'A',
    requiredBy: ['gen3-control.ts'],
    note: '控制轨道：易主落点按轨道实测矩形算（controlTrackSideX），不能拿视口百分比猜',
  },

  // ============================ B 特效自建节点（渲染器无需提供） ============================
  // 判定依据：特效 createElement 建出后立刻 querySelector 取回，只读自己的产物。
  {
    hook: '.fx-love-heart', kind: 'class', category: 'B',
    requiredBy: ['effects/index.ts'],
    note: '爱意抽牌的粉色爱心：特效自建（buildLoveHeart，effects/index.ts:1560）后挂到源卡/克隆/落点盒上，'
      + ':1659 取回移除；render.ts:1654 在揭示幽灵上另挂一个是渲染器自己的装饰（FX 不读），故仍属 B',
  },
  {
    hook: '.reveal-wings', kind: 'class', category: 'B',
    requiredBy: ['effects/index.ts'],
    note: '揭示幽灵的天使翅膀：effects/index.ts:1702 自建、:1717 取回',
  },
  {
    hook: '.life-flip-vine', kind: 'class', category: 'B',
    requiredBy: ['effects/index.ts'],
    note: '生命翻面藤蔓：特效自建的 fxWrap 内子元素',
  },

  // —— 读取点在 render.ts 的两条「已确认钩子」已按纠正后的规则移出 B 类 ——
  // `.hand-strip` / `.play-btns` 既不是 FX 自建（旧 B 类判定不成立），也不是契约项：
  // 渲染器产出但 0 个 FX 模块引用 → 见下方 D 类。

  // —— 3 代常驻层（gen3-control.ts）自建子元素，每帧取回重定位 ——
  { hook: '.g3sync-envy0-thread', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '嫉妒0 汲取丝：每帧重定位' },
  { hook: '.g3sync-envy0-mark', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '嫉妒0 源卡橙环标记' },
  { hook: '.g3sync-envy0-borrow', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '嫉妒0「借 N」数值标' },
  { hook: '.g3sync-envy0-glow', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '嫉妒0 涡心辉光' },
  { hook: '.g3sync-envy0-ticks', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '嫉妒0 刻度环' },
  { hook: '.g3sync-wrath0-seam', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '愤怒0 中缝虚线（只跨两条能量槽之间）' },
  { hook: '.g3sync-wrath0-chip', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '愤怒0「最高档剔除」文字标' },
  { hook: '.g3sync-sloth0-glow', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '怠惰0 暖灰边框光' },
  { hook: '.g3sync-sloth0-ripple', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '怠惰0 灰红涟漪' },
  { hook: '.g3sync-sloth0-link', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '怠惰0 覆盖者连线（无条件创建，位置每帧算）' },
  { hook: '.g3sync-badge', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '常驻层数值徽标（.envy/.sloth/.lust/.greed 由同一批 appendChild 造）' },
  { hook: '.g3sync-inertia0-field', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '惰性0 链路灰白边框光' },
  { hook: '.g3sync-inertia1-edge', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '惰性1 自身下缘粗灰边' },
  { hook: '.g3sync-rig7-maze', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '刚性7 荧光黄迷宫纹' },
  { hook: '.g3sync-rig7-shield', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '刚性7 护盾纹' },
  { hook: '.g3sync-rig7-anchor', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '刚性7 四角锚钉（querySelectorAll 后逐个摆角）' },
  { hook: '.g3sync-lusthold-ring', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '色欲持有红色牵引环' },
  { hook: '.g3sync-lusthold-chain', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '色欲持有牵引链' },
  { hook: '.g3sync-greed1-stack', kind: 'class', category: 'B', requiredBy: ['gen3-control.ts'], note: '贪婪1 硬币堆（等级 0 不画）' },

  // —— 3 代编译系特效（compiled-gen3.ts）自建子元素，只在计时器里取回移除 ——
  { hook: '.gen3-envy-core', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '嫉妒编译涡心：自建后取回加 flash 类' },
  { hook: '.gen3-envy-spark-wrap', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '嫉妒编译粒子包裹层（burstParticles 产出）' },
  { hook: '.gen3-glut-crumb', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '暴食编译碎屑：querySelectorAll 后逐个加/去 pull 类' },
  { hook: '.gen3-greed-bit-wrap', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '贪婪编译金币碎屑包裹层' },
  { hook: '.gen3-pride-shock', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '傲慢编译冲击环' },
  { hook: '.gen3-pride-spark-wrap', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '傲慢编译粒子包裹层' },
  { hook: '.gen3-sloth-wave', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '怠惰编译波' },
  { hook: '.gen3-wrath-spark-wrap', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '愤怒编译粒子包裹层' },
  { hook: '.gen3-ovw-shock', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '压倒编译冲击环' },
  { hook: '.gen3-ovw-dust-wrap', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '压倒编译尘屑包裹层' },
  { hook: '.gen3-mom-shock', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '动量编译冲击环' },
  { hook: '.gen3-nova-spark-wrap', kind: 'class', category: 'B', requiredBy: ['compiled-gen3.ts'], note: '新星编译粒子包裹层' },

  // ============================ C 内部注册键（渲染器无需提供） ============================
  {
    hook: '[data-band]', kind: 'attr', category: 'C',
    requiredBy: ['gen3-control.ts'],
    note: '记账键：常驻层把「这张卡/这条线」的 id 写在自建网格/条纹/封条上（gen3-control.ts:277/407/441/555），再按值查回重定位',
  },

  // ============================ D 渲染器自有、FX 不读（**不是**契约项） ============================
  // 判定依据：render.ts 产出，但 11 个 FX 模块里 `git grep` 不到任何读取点（故 requiredBy 为空）。
  // 它们的消费方是渲染器自己（选择模式条、拖拽幽灵清理、线选择高亮）：G2 的远程页仍应产出它们
  // 以保证渲染器自身功能，但它们**不占**「FX 依赖」的验收位，远程页无需为 FX 提供。
  {
    hook: '.hand-strip', kind: 'class', category: 'D', requiredBy: [],
    note: '手牌条带容器：render.ts:4651 产出；读取点全在 render.ts:4893/4909（加 .choice-mode）；'
      + 'FX 模块 0 引用 → 不是 FX 契约项（缺了坏的是选择模式，不是某条点名特效）',
  },
  {
    hook: '.play-btns', kind: 'class', category: 'D', requiredBy: [],
    note: '卡面翻面按钮组：render.ts:1625 产出；读取点全在 render.ts:5469/5522（拖拽幽灵剔除它）；'
      + 'FX 模块 0 引用 → 不是 FX 契约项（缺了坏的是拖拽，不是某条点名特效）',
  },
  {
    hook: '.lane-row', kind: 'class', category: 'D', requiredBy: [],
    note: '链路行容器：render.ts:4623 产出；读取点全在 render.ts:1761/4851（协议元素定位、线选择高亮）；'
      + 'FX 模块 0 引用 → 不是 FX 契约项',
  },
];

/** 取某分类的全部钩子 */
export function hooksOfCategory(c: 'A' | 'B' | 'C' | 'D'): FxDomHook[] {
  return FX_DOM_CONTRACT.filter((h) => h.category === c);
}

/**
 * 盘点说明（G1 的结论 + 评审前纠正，供 G2 与人工文档使用）：
 *
 * 1. **纠正**：旧版把 `.hand-strip` / `.play-btns` 记作 B 类（「特效自建」）——那是错的，
 *    它们的读取点**全在 render.ts**（4893/4909、5469/5522），渲染器产出、FX 模块 0 引用，
 *    所以正确归属是 **D 类：渲染器自有、FX 不读，不是契约项**。`.lane-row` 同理（render.ts
 *    产出，读取点 render.ts:1761/4851），也归 D。核对用：
 *    `git grep -n "hand-strip" -- src` / `"play-btns"` / `"lane-row"` 只返回 render.ts 与 styles.css。
 *    历史成因：控制器最初的选择器普查把 render.ts 自己的查询也算成了 FX 依赖，于是给了 7 条
 *    「已确认锚点」，其中这三条与「A 类必须被 FX 模块引用」这条机检互相冲突；纠正后 A 类锚点是 6 条。
 *    远程页若不提供它们，坏掉的是**拖拽 / 选择模式 / 线选择高亮**，而不是某条点名特效。
 *
 * 2. 只有 render.ts / diag.ts / home.ts / control-rearrange.ts 引用的选择器不进 A 类
 *    （如 .protocol、.stack、.draft-pool）：本清单的 A 类只收录 FX 层真的读的钩子；
 *    其中已被点名的 renderer 自有节点登记为 D 类。
 * 3. render.ts 里的 23 个 `dataset.*Key`（smokeKey / ice4Key / …）是渲染器给自己的常驻层
 *    记的账，只有 render.ts:1364 读回 chainPlayer 一处，FX 模块从不读 → 不在契约内。
 */
