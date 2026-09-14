# 4 代 · FX DOM 契约（G1）

> 作用：G2 重写远程对战页面时，**这份文件就是"远程页必须提供什么"的验收基准**。
> 机读版在同名模块 `src/ui/fx-dom-contract.ts`；两者由 `tests/ui/fx-dom-contract.test.ts` 强制一致。
> 依据：`docs/2026-09-13-联机与多端-设计稿.md` §6.3。

当前结论（HEAD）：**A=17 / B=34 / C=1 / D=3**，共 55 条钩子。其中只有 A 类是契约项。

---

## 1. 为什么需要它

特效层不持有 DOM 引用，它靠 `document.querySelector` / `querySelectorAll` 用选择器和数据属性**定位渲染器产出的节点**，再取 `getBoundingClientRect()` 算落点。因此：

- 渲染器少产出一个节点、少挂一个类或属性，对应的特效**不会报错**，只会静默跳过或整体不播——本项目历史上已发生多次（见 `docs/3代特效-进度与上下文.md` §0 的"整条点名特效从不播"事故）。这类 bug 在 tsc / vitest 里毫无反应，只有肉眼在页面上才发现。
- G2 会**换一套布局**（上=对手 / 下=自己、控制轨横向、对手手牌只显示数量）。布局一换，选择器就可能对不上。
- 所以必须在动布局之前，把"特效到底靠什么定位"固化成一份**可机检的契约**：G1 产出机读清单 + 人读文档 + 守卫测试，G2 照着实现、跑测试即知是否合规。

**范围**：本契约只回答"FX 层需要远程页提供什么"。渲染器自身的功能需求（拖拽、选择模式、线选择高亮）不在其内，见 §7 D 类。

---

## 2. 分类与判定规则

不按属性名一刀切，而是**逐读取点问「这个元素是谁创建的」**，再看反方向：**FX 层是否真的读它**。

| 类别 | 判定规则 | 远程页是否必须提供 |
|---|---|---|
| **A 结构钩子** | 渲染器产出 **且** 至少 1 个 FX 模块真的读它（两个条件缺一不可） | **必须提供**（契约项） |
| **B 特效自建节点** | FX 层自己 `createElement` 建出、随后自己 `querySelector` 取回（可能在同一帧或计时器里） | 不需要（渲染器给了也无人读） |
| **C 内部注册键** | FX 层挂在**自建**元素上的记账 `dataset.*` 键，再按值查回重定位 | 不需要（读的是 FX 自己的产物） |
| **D 渲染器自有、FX 不读** | 渲染器产出，但 11 个 FX 模块里**零个**引用它（`requiredBy` 为空数组） | **不需要**（**不是**契约项） |

### 2.1 教训：判定 A 的两个条件缺一不可

**"渲染器产出"单独一条不构成 A 类。**

G1 首轮正是把「渲染器产出」当成了充分条件，于是把 `.hand-strip` / `.play-btns` / `.lane-row` 误列进契约。它们的读取点**全在 `render.ts` 自己内部**（4893/4909、5469/5522、1761/4851），FX 模块零引用——远程页根本无需为 FX 提供它们。根因是那次选择器普查把 `render.ts` 自己的查询也算成了 FX 依赖。

因此：**判定 A 的最后一步永远是 `git grep` 到至少一个 FX 模块真的读它**（`FX_MODULES` 共 11 个模块；`gen3-util.ts` 是其中一员，`nodeOf` / `visibleRectOf` / `clipInsetRightPct` 都在它里面，是 `[data-uid]` 的主要消费方）。grep 不到 → 要么重分类，要么不登记。

两条对称的机检规则，防止两个方向都判错：

- A 类必须在 `FX_MODULES` 里 grep 到引用（防止凭空发明契约项）；
- B 类必须由 `requiredBy` 的模块自己 grep 到该类名（防止渲染器自有节点被误标成"特效自建"）；
- D 类必须**被渲染器产出、且 FX 模块完全 grep 不到**（两个条件缺一不可，防止 A 与 D 搞反）。

### 2.2 为什么两个 dataset 键分属两类

易错点在 `dataset` 键：**同为属性选择器，创建者不同则类别不同**。

- `[data-uid]` 是 `render.ts` 写在卡节点上的（渲染器产出），FX 只读 → **A 契约项**。
- `[data-band]` 是常驻层写在**自建**网格/条纹/封条上的记账句柄（`gen3-control.ts:277/407/441/555`）→ **C 内部注册键**。

`render.ts` 里另有 23 个 `dataset.*Key`（`smokeKey` / `ice4Key` / …），是渲染器给自己的常驻层记的账，只有 `render.ts:1364` 读回 `chainPlayer` 一处，FX 模块从不读 → 不在契约内。

其余口径：

- 同一条钩子在不同模块可能被读多次，但**钩子字符串只登记一次**（守卫测试禁止重名）。
- `requiredBy` 只登记 **FX 消费方**；D 类没有 FX 消费方，故为空数组（守卫测试强制这一点）。
- 只被 `render.ts` / `diag.ts` / `home.ts` / `control-rearrange.ts` 引用的选择器（如 `.protocol` / `.stack` / `.draft-pool`）不进 A 类。

---

## 3. A 类：结构钩子（**远程页必须提供**）

共 **17** 条。按重要性排序；**钩子字符串必须与机读清单逐字一致**（守卫测试按 `doc.includes(hook)` 逐条核对），改写措辞或换写法即报红。

| # | 钩子 | 出处模块（FX 消费方） | 用途 |
|---|---|---|---|
| 1 | `.stack-slot[data-player][data-line]` | `fx-gen3.ts`、`fx-gen2.ts`、`fx-gen3-swap.ts`、`gen3-control.ts`、`effects/index.ts` | **链路槽几何：3 代飞行 / 连接件 / 常驻层的落点**（`slotRectOf` / `lineCenterX`），最核心的一条 |
| 2 | `.protocol-cell[data-player][data-line]` | `fx-gen3.ts`、`fx-gen2.ts`、`fx-gen3-swap.ts`、`gen3-control.ts`、`effects/index.ts` | 协议格：协议交换 / 重排、同化编译光柱、色欲封条按 `(player,line)` 定位 |
| 3 | `[data-uid]` | `gen3-util.ts`、`fx-gen2.ts`、`fx-gen3.ts`、`fx-gen3-swap.ts`、`gen3-control.ts`、`effects/index.ts` | 按 uid 取卡节点 rect（`nodeOf` → `visibleRectOf` / `clipInsetRightPct`）；**手牌与链路卡都要带** |
| 4 | `img` | `fx-gen2.ts`、`fx-gen3-swap.ts`、`fx/delete-shatter.ts`、`fx/discard-cut.ts` | 卡面图：偏转 / 破碎 / 切割 / 翻面 / 交换取卡面图的唯一来源（`render.ts` 造 `.card-face-img` / `.protocol-img`）。6 个读取点全在渲染器产出的卡节点（或它的克隆）上 |
| 5 | `.deck[data-player]` | `fx-gen2.ts`、`effects/index.ts` | 牌库位置：牌库顶打出 / 洗牌 / 冰封牌库等特效的起点或终点（`deckPos`），全库被读约 60 处 |
| 6 | `.trash-pile[data-player]` | `fx-gen3.ts`、`fx-gen2.ts`、`effects/index.ts` | 弃牌堆位置：弃牌 / 回溯飞行的终点（`trashPos`）；`fx-gen3` 另有按 `.trash-pile.p1/.p2` 取的一种写法 |
| 7 | `.hand` | `fx-gen2.ts`、`effects/index.ts`、`fx-gen3.ts` | 手牌区：抽牌幽灵终点、扇形末卡位置、手牌区 rect（多处用 `querySelectorAll(".hand")[player]`） |
| 8 | `.card` | `fx-gen2.ts`、`effects/index.ts`、`fx-gen3.ts` | 卡节点：卡面克隆、扇形末卡位置、链路末卡位置（多处写作 `.card:not(.reveal-ghost)`） |
| 9 | `.control-track` | `gen3-control.ts` | 控制轨道：易主落点按轨道**实测矩形**算（`controlTrackSideX`），不能拿视口百分比猜 |
| 10 | `.control-module` | `gen3-control.ts` | 控制组件：色欲持有牵引环、控制权判定标题的锚点（取不到则回退视口中心） |
| 11 | `.control-slider-img` | `gen3-control.ts` | 控制组件滑块图：优先于 `.control-module` 作为量测目标（`controlImgRect`） |
| 12 | `.battery` | `gen3-control.ts` | 能量槽：愤怒0 中缝虚线要跨「两条能量槽之间」而非整行；惰性0 也要能量槽 rect（`batteryNode`） |
| 13 | `.protocol-img` | `fx-gen3-swap.ts`、`effects/index.ts` | 协议卡面图：协议交换幽灵卡取它的 rect 与卡面图（`render.ts:116` 是 `img.className = "protocol-img"`，故按书写形式是 class 选择器；清单里真正的 element 只有纯标签名 `img`） |
| 14 | `.protocol-holder` | `fx-gen2.ts` | 协议持卡盒：同化1 编译光柱的汇聚中心（**取不到就整体不播**，见 `fx-gen2.ts:2179` 审计注释） |
| 15 | `.hand[data-player]` | `fx-gen3.ts` | 手牌区（带归属）：3 代按玩家取手牌容器（`fx-gen3.ts:875`） |
| 16 | `.rot-cw` | `effects/index.ts`、`fx-gen3.ts` | 场上卡横置态（P1 顺时针，`render.ts:227` 按 owner 挂）：浮层卡按它重建朝向，**漏挂则特效卡立着** |
| 17 | `.rot-ccw` | `effects/index.ts`、`fx-gen3.ts` | 场上卡横置态（P2 逆时针，`render.ts:227` 按 owner 挂）：与 `.rot-cw` 成对读取 |

### 3.1 最高风险的一条

**`.stack-slot[data-player][data-line]` 排在第一位，也是远程页最容易做错、代价最大的一条。**

3 代飞行、连接件、常驻层落点、控制权牵引的几何几乎全部锚在它上面（`slotRectOf` / `lineCenterX`）。它必须同时满足：

- **是 class `.stack-slot`**（不能换成别的类名或标签选择器）；
- **同时带 `data-player` 与 `data-line` 两个属性**，且值与状态里的 `(player, line)` 对应；
- **每条链路、每个玩家都有独立节点**，`querySelectorAll` 返回的集合顺序/数量要能按属性筛出唯一目标。

改错这一条不是"某个特效偏一点"，而是**整个 3 代特效族 + 常驻层一起失去落点**。G2 请把这条当第一优先级的验收项。

其余高风险项：`img`（卡面图唯一来源，6 个读取点跨 4 个模块）、`[data-uid]`（手牌与链路卡都必须带，缺了则 `nodeOf` 全线失效）、`.protocol-holder`（取不到就整体不播）。

---

## 4. B 类：特效自建节点（渲染器无需提供）

共 **34** 条。判定依据：**FX 层自己 `createElement` 建出后立刻 `querySelector` 取回**，只读自己的产物。远程页**不需要**产出它们——渲染器若"好心"也建一份，FX 同样不会读。

> 两个曾经的误判：`.hand-strip` / `.play-btns` 既不是 FX 自建（B 不成立），也不是契约项（读取点全在 `render.ts`）→ 正确归属是 D 类，见 §7。

**（1）`effects/index.ts` 自建（3 条）**

| 钩子 | 用途 |
|---|---|
| `.fx-love-heart` | 爱意抽牌的粉色爱心：`buildLoveHeart`（`effects/index.ts:1560`）自建后挂到源卡/克隆/落点盒上，`:1659` 取回移除。`render.ts:1654` 在揭示幽灵上另挂一个是渲染器自己的装饰（FX 不读），故仍属 B |
| `.reveal-wings` | 揭示幽灵的天使翅膀：`effects/index.ts:1702` 自建、`:1717` 取回 |
| `.life-flip-vine` | 生命翻面藤蔓：特效自建的 `fxWrap` 内子元素 |

**（2）3 代常驻层 `gen3-control.ts` 自建（19 条，每帧取回重定位）**

| 钩子 | 用途 |
|---|---|
| `.g3sync-envy0-thread` | 嫉妒0 汲取丝：每帧重定位 |
| `.g3sync-envy0-mark` | 嫉妒0 源卡橙环标记 |
| `.g3sync-envy0-borrow` | 嫉妒0「借 N」数值标 |
| `.g3sync-envy0-glow` | 嫉妒0 涡心辉光 |
| `.g3sync-envy0-ticks` | 嫉妒0 刻度环 |
| `.g3sync-wrath0-seam` | 愤怒0 中缝虚线（只跨两条能量槽之间） |
| `.g3sync-wrath0-chip` | 愤怒0「最高档剔除」文字标 |
| `.g3sync-sloth0-glow` | 怠惰0 暖灰边框光 |
| `.g3sync-sloth0-ripple` | 怠惰0 灰红涟漪 |
| `.g3sync-sloth0-link` | 怠惰0 覆盖者连线（无条件创建，位置每帧算） |
| `.g3sync-badge` | 常驻层数值徽标（`.envy/.sloth/.lust/.greed` 由同一批 `appendChild` 造） |
| `.g3sync-inertia0-field` | 惰性0 链路灰白边框光 |
| `.g3sync-inertia1-edge` | 惰性1 自身下缘粗灰边 |
| `.g3sync-rig7-maze` | 刚性7 荧光黄迷宫纹 |
| `.g3sync-rig7-shield` | 刚性7 护盾纹 |
| `.g3sync-rig7-anchor` | 刚性7 四角锚钉（`querySelectorAll` 后逐个摆角） |
| `.g3sync-lusthold-ring` | 色欲持有红色牵引环 |
| `.g3sync-lusthold-chain` | 色欲持有牵引链 |
| `.g3sync-greed1-stack` | 贪婪1 硬币堆（等级 0 不画） |

**（3）3 代编译系 `compiled-gen3.ts` 自建（12 条，只在计时器里取回移除 / 加类）**

| 钩子 | 用途 |
|---|---|
| `.gen3-envy-core` | 嫉妒编译涡心：自建后取回加 `flash` 类 |
| `.gen3-envy-spark-wrap` | 嫉妒编译粒子包裹层（`burstParticles` 产出） |
| `.gen3-glut-crumb` | 暴食编译碎屑：`querySelectorAll` 后逐个加/去 `pull` 类 |
| `.gen3-greed-bit-wrap` | 贪婪编译金币碎屑包裹层 |
| `.gen3-pride-shock` | 傲慢编译冲击环 |
| `.gen3-pride-spark-wrap` | 傲慢编译粒子包裹层 |
| `.gen3-sloth-wave` | 怠惰编译波 |
| `.gen3-wrath-spark-wrap` | 愤怒编译粒子包裹层 |
| `.gen3-ovw-shock` | 压倒编译冲击环 |
| `.gen3-ovw-dust-wrap` | 压倒编译尘屑包裹层 |
| `.gen3-mom-shock` | 动量编译冲击环 |
| `.gen3-nova-spark-wrap` | 新星编译粒子包裹层 |

---

## 5. C 类：内部注册键（渲染器无需提供）

共 **1** 条。

| 钩子 | 出处模块 | 用途 |
|---|---|---|
| `[data-band]` | `gen3-control.ts` | 记账键：常驻层把「这张卡 / 这条线」的 id 写在**自建**网格/条纹/封条上（`gen3-control.ts:277/407/441/555`），再按值查回重定位 |

与 A 类的 `[data-uid]` 对照理解：属性选择器长得很像，但 `[data-band]` 的读写两端都在 FX 自建元素上，渲染器**无需提供**。

---

## 6. G2 的验收用法

**具体做法（三步，无歧义）：**

1. G2 写完远程页渲染器（例如 `src/ui/render-net.ts`）。
2. 把该文件名加进 `tests/ui/fx-dom-contract.test.ts` 的 `RENDERERS` 数组：

   ```ts
   const RENDERERS = ['render.ts', 'render-net.ts'] as const;
   ```

3. 跑 `npx vitest run tests/ui/fx-dom-contract.test.ts`。

其中「**A 类钩子必须被当前渲染器提供**」这条断言会遍历 `RENDERERS` 里的每个渲染器，用 `probeOf(hook)` 取判别子串（`.stack-slot[data-player][data-line]` → `stack-slot`；`[data-uid]` → `data-uid`；`img` → `img`），逐个断言渲染器源码里出现该子串；失败时打印 `render-net.ts 未提供 <钩子>（判别子串 <probe>）`。

**结论口径**：这条断言绿 = 远程页在**源码层面**满足了 FX DOM 契约；红 = 报告里列出的钩子就是远程页缺的，补齐后重跑即可。这是 G2 判断"远程页是否满足契约"的**唯一机检入口**，不需要人工逐条比对本文档。

**建议补充（机检之外）**：G2 完成后抽查 **≥20 个点名特效**在远程页实际页面上的播放（含三代已编译特效、控制权牵引、弧轨三态）——源码守卫只能证明"选择器字符串在渲染器源码里出现"，不能证明运行时真的挂在了正确的节点上、且在正确的时机存在。这条与 §6.6 的验收标准一致。

**漂移防护**：本文档的 A 类钩子由 `tests/ui/fx-dom-contract.test.ts` 的「契约文档必须逐一登记全部 A 类钩子」断言强制核对（`doc.includes(hook)`，逐字）；改了 `src/ui/fx-dom-contract.ts` 的 A 类钩子却忘记改本文档，测试立刻报红。

---

## 7. D 类：渲染器自有、FX 不读（**不是**契约项）

共 **3** 条。判定依据：`render.ts` 产出，但 11 个 FX 模块里 `git grep` 不到任何读取点（故 `requiredBy` 为空数组）。

**它们的消费方是渲染器自己**（选择模式条、拖拽幽灵清理、线选择高亮）：G2 的远程页**仍应产出它们**以保证渲染器自身功能可用，但它们**不占**「FX 依赖」的验收位，远程页无需为 FX 提供。远程页若漏掉它们，坏掉的是拖拽 / 选择模式 / 线选择高亮，而不是某条点名特效。

| 钩子 | 渲染器出处 | 真实消费方 | 漏掉的后果 |
|---|---|---|---|
| `.hand-strip` | `render.ts:4651` 产出 | `render.ts:4893/4909`（加 `.choice-mode`） | 选择模式失效（**不是**某条点名特效） |
| `.play-btns` | `render.ts:1625` 产出 | `render.ts:5469/5522`（拖拽幽灵剔除它） | 拖拽失效 |
| `.lane-row` | `render.ts:4623` 产出 | `render.ts:1761/4851`（协议元素定位、线选择高亮） | 协议元素定位 / 线选择高亮失效 |

核对用：`git grep -n "hand-strip" -- src`（`play-btns`、`lane-row` 同理）只返回 `render.ts` 与 `styles.css`。

守卫测试对 D 类有专门断言（必须被渲染器产出 **且** FX 模块完全读不到），所以 D 类既不会退化成 B，也不会被误提为 A。

---

## 附：清单总量与机读版对应

| 类别 | 条数 | 机读版 |
|---|---|---|
| A 结构钩子（远程页必须提供） | 17 | `hooksOfCategory('A')` |
| B 特效自建节点 | 34 | `hooksOfCategory('B')` |
| C 内部注册键 | 1 | `hooksOfCategory('C')` |
| D 渲染器自有、FX 不读 | 3 | `hooksOfCategory('D')` |
| **合计** | **55** | `FX_DOM_CONTRACT.length` |

本文档的 A 类清单是契约的**权威人读版**；如与机读清单冲突，以 `src/ui/fx-dom-contract.ts` 为准，并应立刻修正本文档（否则守卫报红）。
