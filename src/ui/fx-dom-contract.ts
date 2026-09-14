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
  /** 显式判别子串（覆盖自动推导）；**每一项都必须作为源码文本出现在渲染器里**。
   *  复合选择器（`.cls[attr][attr2]`）必须逐段列出，否则自动推导只取类名，
   *  渲染器只产 `stack-slot` 而丢掉两个归属属性也不报红（见 `.stack-slot` 等条目）。
   *  其中形如 `data-*` 的项接受两种书写：字面量 `data-player`，或产出形式 `dataset.player`
   *  （渲染器用 `node.dataset.player = …` **写**属性，字面量 `data-player` 在 render.ts 里
   *  只出现在**查询选择器**里；只认字面量会把「只写 dataset、从不查询」的正确远程页判红）。
   *  **它证明的只是「这两种书写形式有一个出现在源码文本里」**：渲染器从头到尾只查
   *  `[data-player=…]`、一次都没写该属性，同样算通过；属性是否真的写在节点上、值是否与
   *  状态一致、节点在特效读取那一刻是否存在，源码文本守卫一概证明不了（靠 G2 实机抽查）。
   *  只有「渲染器断言」用它；出处断言（requiredBy 模块）仍用 probeOf(h.hook)。 */
  probe?: readonly string[];
  /** 一句话：这个钩子供什么特效定位用 */
  note?: string;
}

export const FX_DOM_CONTRACT: readonly FxDomHook[] = [
  // ============================ A 结构钩子（远程页必须提供） ============================

  // —— 链路 / 协议几何：3 代飞行、连接件、常驻层的落点 ——
  {
    hook: '.stack-slot[data-player][data-line]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts', 'fx-gen2.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'effects/index.ts'],
    probe: ['stack-slot', 'data-player', 'data-line'],
    note: '链路槽几何：3 代飞行/连接件/常驻层的落点（slotRectOf / lineCenterX），最核心的一条。'
      + 'probe 逐段列出：渲染器只产 stack-slot 而丢掉 data-player/data-line 时，slotRectOf 全线失效，'
      + '自动推导的类名判别子串抓不到这种退化',
  },
  {
    hook: '.protocol-cell[data-player][data-line]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts', 'fx-gen2.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'effects/index.ts'],
    probe: ['protocol-cell', 'data-player', 'data-line'],
    note: '协议格：协议交换/重排、同化编译光柱、色欲封条按 (player,line) 定位（probe 逐段列出，理由同上条）',
  },
  {
    hook: '.protocol-img', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3-swap.ts', 'effects/index.ts'],
    note: '协议卡面图：协议交换幽灵卡取它的 rect 与卡面图（render.ts:116 是 img.className = "protocol-img"，'
      + '故按书写形式是 class 选择器；清单里真正的 element 只有纯标签名 `img`）',
  },
  {
    hook: '.protocol', kind: 'class', category: 'A',
    requiredBy: ['effects/index.ts'],
    // probe 取**带单引号的字面量**（`'protocol'`）而不是裸词 `protocol`：裸词在 render.ts 里命中 68 行，
    // 含 `protocol-cell`（:1843）、`protocol-img`（:116）、`protocol-holder`（:86）、`protocolImgSrc`（:12）——
    // 完全非判别性：远程页把协议盒改名成 `protocol-box`、却仍产 protocol-cell / protocol-img 时会照样报绿，
    // 而这正是本条要防的「编译侧协议翻面静默不播」。带引号的形式在渲染器里**恰好只出现一次**
    // （render.ts:83 `el('div', 'protocol' + …)`），即产出点本身，故能真正区分协议盒与其它 protocol* 钩子。
    probe: ["'protocol'"],
    note: '协议盒：编译翻面动画的锚点 —— effects/index.ts:1780 的复合选择器 '
      + '`.protocol-cell[data-player=…][data-line=…] .protocol` 的第二段，:1783 把它交给 playProtocolFlip。'
      + '**它不是 D 类**：虽然同一条类名也被 render.ts:1761/1762 自己查询，但判 A 只看「渲染器产出 且 '
      + '至少一个 FX 模块真的读它」，两个条件都成立（产出：render.ts:83；读取：effects/index.ts:1780）。'
      + '被 proto 变量接住、外面套着 `if (proto)`，所以丢掉它不会报错，只会让编译侧的协议翻面静默不播',
  },
  {
    hook: '.protocol-holder', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts'],
    note: '协议持卡盒：同化1 编译光柱的汇聚中心（取不到就整体不播，见 fx-gen2.ts:2179 审计注释）',
  },
  {
    hook: '[data-uid]', kind: 'attr', category: 'A',
    requiredBy: ['gen3-util.ts', 'fx-gen2.ts', 'fx-gen3.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'effects/index.ts'],
    note: '按 uid 取卡节点 rect（nodeOf → visibleRectOf / clipInsetRightPct）；手牌与链路卡都要带。'
      + '属性是**写**出来的：`node.dataset.uid = card.uid`（render.ts:60/228/1576）；字面量 `data-uid` 确实出现，'
      + '但 render.ts 里的 12 行（:648/:792/:800/:1030/:1225/:1641/:3869/:4677/:4718/:4792/:4819/:4952）'
      + '**全部是查询或注释**，没有一处是产出点。故渲染器断言接受 `dataset.uid` 这种 camelCase 产出形式，'
      + '免得「只写属性、从不查询」的正确远程页渲染器被误判成缺钩子（见测试里的 datasetFormOf）',
  },
  {
    hook: '.trash-pile[data-player]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts', 'fx-gen2.ts', 'effects/index.ts'],
    probe: ['trash-pile', 'data-player'],
    note: '弃牌堆位置：弃牌/回溯飞行的终点（trashPos）；fx-gen3 另有按 `.trash-pile.p1/.p2` 取的一种写法（见下一条）',
  },
  {
    hook: '.trash-pile.p1/.p2', kind: 'class', category: 'A',
    requiredBy: ['fx-gen3.ts'],
    probe: ['trash-pile p'],
    note: '弃牌堆的 `.pN` 归属类：fx-gen3.ts:1375 读 `.trash-pile.p${p.player + 1}`（灰砂流终点），'
      + '与上一条的 `[data-player]` 是两个独立 conjunct，各自登记免得其中一个被丢还全绿。'
      + 'probe 取**生产者书写形式** `trash-pile p`（render.ts:1498 是 `trash-pile p${player + 1} …`，'
      + '类名以空格分隔，不是复合 `.trash-pile.pN`）。**故意不把 probe 写成裸 `p1`** —— '
      + '裸 `p1` 在 render.ts 里同时命中 :1732 的 hand-shield 归属类构造 '
      + '（`\'hand-shield\' + (player === 1 ? \' p2\' : \' p1\')`）与 :4394 的 draft-preview 构造 '
      + '（`\'draft-preview\' + (player === 0 ? \' p1\' : \' p2\')`），'
      + '于是「pN 类被丢」和「别的节点带 p1」无法区分，等于没查；'
      + '测试里的 probeOf 也据此收紧：类开头的多段钩子取**第一段**类名（`trash-pile`），不再机械取 `p1`',
  },
  {
    hook: '.deck[data-player]', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts', 'effects/index.ts'],
    probe: ['deck', 'data-player'],
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
    probe: ['hand', 'data-player'],
    note: '手牌区（带归属）：3 代按玩家取手牌容器（fx-gen3.ts:875）。**注意**：probe 与上一条 `.hand` 相同，'
      + '故这条的渲染器断言与 `.hand` 完全重合、不提供额外机检力 —— 它只作文档登记（区分「无归属的 .hand」'
      + '与「按玩家取的那一个」两种读法）',
  },
  {
    hook: '.card', kind: 'class', category: 'A',
    requiredBy: ['fx-gen2.ts', 'effects/index.ts', 'fx-gen3.ts'],
    note: '卡节点：卡面克隆、扇形末卡位置、链路末卡位置（多处写作 .card:not(.reveal-ghost)）',
  },
  {
    hook: '.rot-cw', kind: 'class', category: 'A',
    requiredBy: ['fx-orient.ts'],
    note: '场上卡横置态（P1 顺时针，render.ts:227 按 owner 挂）：浮层卡按它重建朝向，漏挂则特效卡立着。'
      + '**G2 Task 2 起**：这三个朝向类名只由 src/ui/fx-orient.ts（朝向单一出处）读取，'
      + 'effects/index.ts 与 fx-gen3.ts 改经 orientOf() 间接消费（不再出现类名字面量）——'
      + '故 requiredBy 跟着代码走，指向 fx-orient.ts',
  },
  {
    hook: '.rot-ccw', kind: 'class', category: 'A',
    requiredBy: ['fx-orient.ts'],
    note: '场上卡横置态（P2 逆时针，render.ts:227 按 owner 挂）：与 .rot-cw 成对读取。'
      + '**G2 Task 2 起** 同样只由 src/ui/fx-orient.ts 读取（见 .rot-cw 条）',
  },
  {
    hook: 'img', kind: 'element', category: 'A',
    requiredBy: ['fx-gen2.ts', 'fx-gen3-swap.ts', 'fx/delete-shatter.ts', 'fx/discard-cut.ts', 'effects/index.ts'],
    note: '卡面图：偏转/破碎/切割/翻面/交换取卡面图的唯一来源（render.ts 造 .card-face-img / .protocol-img）；'
      + '读取点全在渲染器产出的卡节点（或它的克隆）上：effects/index.ts:641/764（playFlip 源卡，缺失则回退 cardFaceSrc）、'
      + 'fx-gen2.ts:967、fx-gen3-swap.ts:120、fx/delete-shatter.ts:36、fx/discard-cut.ts:19。'
      + '**注意**：判别子串 `img` 是退化的（render.ts 里 80 行命中），它只能证明「文档/清单里有 img 这个词」，'
      + '证明不了卡面图真的挂上了 —— 这条靠 G2 的 ≥20 特效实机抽查兜底',
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
 *    「已确认锚点」，其中这三条与「A 类必须被 FX 模块引用」这条机检互相冲突；纠正后控制器给的
 *    锚点表缩到 6 条（那是**锚点表**，不是完整清单）。终审补入 `.protocol` 与 `.trash-pile.p1/.p2`
 *    两个漏项后，完整 A 类共 **19** 条（见 docs/4代-FX DOM 契约.md §3）。
 *    远程页若不提供它们，坏掉的是**拖拽 / 选择模式 / 线选择高亮**，而不是某条点名特效。
 *
 * 2. **（2026-09-13 终审纠正）**「只被 render.ts / diag.ts / home.ts / control-rearrange.ts 引用的
 *    选择器不进 A 类」这句话是**错的**，原文还拿 `.protocol` 当例子 —— 而 `.protocol` 恰恰是 A 类：
 *    产出方是 render.ts:83，读取方是 effects/index.ts:1780 的
 *    `.protocol-cell[data-player=…][data-line=…] .protocol`（复合选择器的第二段，交给 playProtocolFlip）。
 *    判 A 的规则只有两条：**渲染器产出** 且 **至少一个 FX 模块真的读它**；「还有谁也在查它」与判定无关，
 *    同一条类名完全可以既被渲染器自查（render.ts:1761/1762）又被 FX 读（effects/index.ts:1780）。
 *    原文那句话正是 G2 拿去重命名协议盒的许可证，已删除。
 *
 *    真正的「不是 A 类」例子（各自 grep 过，11 个 FX 模块里零引用）：
 *     - `.draft-pool`：render.ts:4074 产出，读取点只有 render.ts:4246；
 *     - `.stack`：render.ts:213 产出，FX 侧只读 `.stack-slot`（裸 `.stack` 只在 gen3-util.ts:4 的注释里出现）。
 *    已被点名的 renderer 自有节点（`.hand-strip` / `.play-btns` / `.lane-row`）登记为 D 类。
 * 2b. **复合选择器必须逐段登记 probe**：自动推导（probeOf）对 `.cls[attr][attr2]` 只取类名，
 *    于是渲染器丢掉 `data-player` / `data-line` 也能过守卫。凡复合 A 钩子都显式给 `probe`，
 *    渲染器断言要求**每一项**都出现。这条对 `.stack-slot[data-player][data-line]` 尤其致命：
 *    它是最核心的几何锚点，少了属性就等于 slotRectOf / lineCenterX 全线失效。
 * 2c. 退化的 probe 是**已知且已披露**的局限：`img`（render.ts 80 行命中）、`card`（158 行）、
 *    `hand`（79 行，且是 D 类 `.hand-strip` 的子串）—— 它们只能证明「这个词在源码里出现过」。
 *    不靠发明新 token 去修，靠 G2 的 ≥20 特效实机抽查兜底。其中 `.hand` 与 `.hand[data-player]`
 *    的 probe 相同，后一条是**纯文档登记**，不提供额外机检力。
 * 2d. **未做的长期机制（G2 建议）**：token 级守卫 —— 把 FX 选择器字面量里的每个 `.class` / `[attr]`
 *    都抽出来，断言「已登记或在白名单里」。它才是「一行一处读取点」这条根因的解法；
 *    多行模板字面量（effects/index.ts:1779-1781）正是让逐行普查漏掉 `.protocol` 的原因。
 * 3. render.ts 里的 23 个 `dataset.*Key`（smokeKey / ice4Key / …）是渲染器给自己的常驻层
 *    记的账，只有 render.ts:1364 读回 chainPlayer 一处，FX 模块从不读 → 不在契约内。
 */
