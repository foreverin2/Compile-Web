# 4 代 · FX DOM 契约（G1）

> 作用：G2 重写远程对战页面时，**这份文件就是"远程页必须提供什么"的验收基准**。
> 机读版在同名模块 `src/ui/fx-dom-contract.ts`；两者由 `tests/ui/fx-dom-contract.test.ts` 强制一致。
> 依据：`docs/2026-09-13-联机与多端-设计稿.md` §6.3。

当前结论（HEAD，G2 修正 R3 方向按座位后）：**A=21 / B=34 / C=1 / D=3**，共 59 条钩子。其中只有 A 类是契约项。

> **G2 修正 R3（本次变更 · 方向从"按绝对玩家左右"改成"按座位上下"）**：
> 规格依据 `docs/2026-09-14-G2修正-竖向布局与朝向分离-设计说明.md` §3.2 / §8.1 / §8.2（含用户补充裁决：
> **控制轨改成竖向，自己端在下、对手端在上**）。
>
> 1. **A 类钩子清单与条数不变（21 条）**：R3 只改**方向判断**与**布局**，不改任何钩子的拼写或产出方。
>    控制轨的竖向版本仍由 `render.ts` 的 `renderControlModule` 产出（多传 `{ axis: 'y', holder }`），
>    竖向规则写在 `styles-net.css` 第 9 节，`styles.css` **一行未改**。
> 2. **方向模型的单一出处是新的小模块 `src/ui/fx-seat.ts`**（不占 A 类钩子）：
>    `setFxViewSeat(seat | null)`（`null` = 热座 ⇒ 走原左右逻辑；唯一调用点是 `render-net.ts` 渲染时设一次）、
>    `fxOuterFor` / `fxStackEndPoint` / `fxHandEndPoint`（落点）、`vVisibleStripRect` / `vClipInsetPct` /
>    `vClipInsetCss`（**覆盖条带**的竖向变体）、`fxTrackEndFor` / `fxTrackEndPos`（**控制轨端归属**）。
> 3. **命名（规格 §8.2 要求 R3 定名并记录）**：
>    - `FxOuter`：`'start'` = 屏幕**小坐标端**（上 / 左）、`'end'` = 大坐标端（下 / 右）。**它是屏幕方向，不是座位号** —— `fxOuterFor` 在远程页把"自己（向下长）"映射成 `'end'`、"对手（向上长）"映射成 `'start'`（**与座位号恰好相反**，这是"上下对调"类 bug 的唯一入口，故单列说明）。
>    - 覆盖条带（`gen3-util.ts`）：**热座仍走"覆盖者在**右**"**（`visibleRectOf` / `clipInsetRightPct` 里 `coveredOuterOf(...) === null` 的分支，代码逐字未改）；**远程页走"覆盖者在**下**（自己侧 / `'end'`）或**上**（对手侧 / `'start'`）"**，由 `coveredOuterOf` 读**覆盖卡自己的** `data-fx-rot` 判定（`ccw` ⇒ `'end'`、`cw` ⇒ `'start'`）。
>    - 覆盖条带永远是**整卡宽**的**横带**（热座是整卡高的**竖条**）。
> 4. **运行时证据**：`verifyPageHooks` 新增**断言 4**（约束 9，方向座位与逐卡朝向）与**断言 5**（控制轨端归属），
>    两者都只做**标记/类名/契约链**层面的检查（无 jsdom ⇒ 量不到几何，见 §6.1 的能力边界）。

> **G2 修正 R2 补入（本次变更）**：A 类新增 **`[data-fx-rot]`**（**特效朝向标记**）。
> 规格依据 `docs/2026-09-14-G2修正-竖向布局与朝向分离-设计说明.md` §2 / §3.1 / §8.2。
> 它是"**特效朝向 ≠ 卡面朝向**"这条规则的**唯一运行时载体**：远程页自己卡面 0° 而特效 −90°、
> 对手卡面 180° 而特效 +90°，FX 层的浮层卡/破碎/切割/翻面**全部**按它构建（`fx-orient.ts` 的
> `fxOrientOf`）。热座页**有意不产出**它 —— 于是 `fxOrientOf` 回退 `orientOf`，
> 「热座零变化」是**构造性**的（`RENDERERS` 里给 `render.ts` 一条 `exempt`，见 §3.2）。
> ⚠️ 读不到标记**不会报错**，只会让远程页的整类特效退回卡面朝向、静默差 90° ——
> 所以除了源码守卫，`verifyPageHooks` 另加**运行时**逐卡断言（约束 8，见 §6.1）。

> **G2 Task 4 补入（历史）**：A 类新增 **`.rot-180`**（远程页对手侧的 180° 倒置态）。
> 它不是"多登记一条"，而是把 Task 3 的硬约束 2 从**源码守卫**提升为**契约项 + 运行时自查**：
> `.rot-180` 与 ±90° 的几何不同（`cloneBoxSwaps(180) === false`，**不交换布局盒宽高**），
> 拿 ±90° 冒充会得到"朝向对但尺寸错"的假正确 —— 详见 §3 末行与 §3.2。

> **终审补漏（2026-09-13）**：A 类原为 17 条，补入两条被"每行一处读取点"的普查漏掉的钩子 ——
> `.protocol`（复合选择器第二段，effects/index.ts:1780）与 `.trash-pile.p1/.p2`（fx-gen3.ts:1375 的
> `.pN` 归属类）。两条都能让 G2 悄悄打断一整条点名特效而不触发任何断言，详见 §3 对应行。

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
- **旧版的错误口径（保留在此仅为警示，切勿再引用）**：「只被 `render.ts` / `diag.ts` / `home.ts` /
  `control-rearrange.ts` 引用的选择器（如 `.protocol` / `.stack` / `.draft-pool`）不进 A 类。」
  这句话是错的，已于终审删除 —— 它举的 `.protocol` **恰恰是 A 类**。判 A 只有两个条件：
  **渲染器产出** 且 **至少一个 FX 模块真的读它**；「还有谁也在查它」与判定无关，
  同一条类名完全可以既被渲染器自查（`render.ts:1761/1762`）又被 FX 读（`effects/index.ts:1780`）。
  这句话原本就是 G2 拿去重命名协议盒的许可证，删掉。
  真正的非契约例子（各自 grep 过，11 个 FX 模块零引用）：`.draft-pool`（`render.ts:4074` 产出、
  `:4246` 自读）、`.stack`（`render.ts:213` 产出；FX 侧只读 `.stack-slot`，裸 `.stack` 仅出现在
  `gen3-util.ts:4` 的注释里）。已被点名的渲染器自有节点（`.hand-strip` / `.play-btns` / `.lane-row`）归 D 类。

---

## 3. A 类：结构钩子（**远程页必须提供**）

共 **21** 条。按重要性排序；**钩子字符串必须与机读清单逐字一致**（守卫测试按 `doc.includes(hook)` 逐条核对），改写措辞或换写法即报红。

> **超集规则（G2 Task 4）**：本节列的是**两个渲染器合起来**必须覆盖的 A 类钩子全集，**不是**"每个渲染器要产出的清单"。
> 某个渲染器可以用 `RENDERERS[].exempt` **有意不提供**其中某几条（必须在 §3.2 写明理由），
> 但被豁免的钩子必须**至少还有一个渲染器提供它** —— 守卫里有专门断言（`exempt` 项必须是真实 A 类钩子，
> 且不得被**所有**渲染器同时豁免）。

**复合钩子逐段机检**：凡形如 `.cls[attr]` / `.cls[attr][attr2]` 的条目在机读清单里带 `probe` 数组，
渲染器断言要求 **`probe` 里每一项都出现**（不是只看类名）。否则渲染器只产 `stack-slot` 而丢掉
`data-player` / `data-line`，守卫照样全绿，而 `slotRectOf` / `lineCenterX` 已经全线失效。

| # | 钩子 | 出处模块（FX 消费方） | 用途 |
|---|---|---|---|
| 1 | `.stack-slot[data-player][data-line]` | `fx-gen3.ts`、`fx-gen2.ts`、`fx-gen3-swap.ts`、`gen3-control.ts`、`effects/index.ts` | **链路槽几何：3 代飞行 / 连接件 / 常驻层的落点**（`slotRectOf` / `lineCenterX`），最核心的一条。`probe` 逐段：`stack-slot p`（**相邻两个类 token**，G2 Task 3F2 收紧）+ `data-player` + `data-line` |
| 2 | `.protocol-cell[data-player][data-line]` | `fx-gen3.ts`、`fx-gen2.ts`、`fx-gen3-swap.ts`、`gen3-control.ts`、`effects/index.ts` | 协议格：协议交换 / 重排、同化编译光柱、色欲封条按 `(player,line)` 定位。`probe` 逐段：`protocol-cell` + `data-player` + `data-line` |
| 3 | `[data-uid]` | `gen3-util.ts`、`fx-gen2.ts`、`fx-gen3.ts`、`fx-gen3-swap.ts`、`gen3-control.ts`、`effects/index.ts` | 按 uid 取卡节点 rect（`nodeOf` → `visibleRectOf` / `clipInsetRightPct`）；**手牌与链路卡都要带**。属性是用 `node.dataset.uid = …` **写**出来的（`render.ts:60/228/1576`）；字面量 `data-uid` 确实出现，但 `render.ts` 里的 12 行（`:648/:792/:800/:1030/:1225/:1641/:3869/:4677/:4718/:4792/:4819/:4952`）**全部是查询或注释**，没有一处是产出点 —— 故渲染器断言对 `data-*` 项额外接受 `dataset.uid` 这种 camelCase 产出形式 |
| 4 | `img` | `fx-gen2.ts`、`fx-gen3-swap.ts`、`fx/delete-shatter.ts`、`fx/discard-cut.ts`、`effects/index.ts` | 卡面图：偏转 / 破碎 / 切割 / 翻面 / 交换取卡面图的唯一来源（`render.ts` 造 `.card-face-img` / `.protocol-img`）。读取点全在渲染器产出的卡节点（或它的克隆）上：`effects/index.ts:641/764`、`fx-gen2.ts:967`、`fx-gen3-swap.ts:120`、`fx/delete-shatter.ts:36`、`fx/discard-cut.ts:19` |
| 5 | `.deck[data-player]` | `fx-gen2.ts`、`effects/index.ts` | 牌库位置：牌库顶打出 / 洗牌 / 冰封牌库等特效的起点或终点（`deckPos`），全库被读约 60 处。`probe` 逐段：`deck deck-`（**相邻两个类 token**，G2 Task 3F2 收紧 —— 裸 `deck` 会被 `deck-count` / `deck-stack` / `deck-back` 这些更长同类名满足）+ `data-player` |
| 6 | `.trash-pile[data-player]` | `fx-gen3.ts`、`fx-gen2.ts`、`effects/index.ts` | 弃牌堆位置：弃牌 / 回溯飞行的终点（`trashPos`）。`probe` 逐段：`trash-pile` + `data-player` |
| 7 | `.trash-pile.p1/.p2` | `fx-gen3.ts` | 弃牌堆的 **`.pN` 归属类**：`fx-gen3.ts:1375` 读 `` `.trash-pile.p${p.player + 1}` ``（灰砂流自牌库流向本家弃牌堆，取不到就退化成向右下漂）。与上一条的 `[data-player]` 是**两个独立 conjunct**，各自登记，免得其中一个被丢还全绿。`probe` 取**生产者书写形式** `trash-pile p`（`render.ts:1498` 是 `` `trash-pile p${player + 1} …` ``，类名以空格分隔，**不是**复合 `.trash-pile.pN`）；**故意不用裸 `p1` 当 probe**：裸 `p1` 在 `render.ts` 里同时命中 `:1732` 的 hand-shield 归属类构造（`'hand-shield' + (player === 1 ? ' p2' : ' p1')`）与 `:4394` 的 draft-preview 构造（`'draft-preview' + (player === 0 ? ' p1' : ' p2')`），等于没查 |
| 8 | `.hand` | `fx-gen2.ts`、`effects/index.ts`、`fx-gen3.ts` | 手牌区：抽牌幽灵终点、扇形末卡位置、手牌区 rect（多处用 `querySelectorAll(".hand")[player]`）。`probe` 取**带引号的产出形式** `'hand'`（G2 Task 3F2 收紧：裸 `hand` 被 `.hand-strip` 与本文件里一堆 `hand-*` 类名满足） |
| 9 | `.card` | `fx-gen2.ts`、`effects/index.ts`、`fx-gen3.ts` | 卡节点：卡面克隆、扇形末卡位置、链路末卡位置（多处写作 `.card:not(.reveal-ghost)`）。`probe` 取**带引号的产出形式** `'card'`（G2 Task 3F2 收紧：裸 `card` 被 `card-face-img` / `cardback-img` / `card-text-*` 与查询 `'.card[data-uid]'` 满足） |
| 10 | `.control-track` | `gen3-control.ts` | 控制轨道：易主落点按轨道**实测矩形**算（`controlTrackPoint` → `fx-seat.ts` 的 `fxTrackEndPos`），不能拿视口百分比猜。`probe` 取**带引号的产出形式** `'control-track'`（G2 Task 3F2：裸 `control-track` 被同函数内的 `control-track-label left/right` 满足 —— 复评变异 R2 实测改名后守卫仍绿）。**⚠️ G2 修正 R3：远程页的轨道改成竖向**（用户裁决"自己端在下、对手端在上"）—— **产出方拼写未改**（仍由 `render.ts` 的 `renderControlModule` 产出，只是多传 `{ axis: 'y', holder }`），竖向规则在 `styles-net.css` 第 9 节，`styles.css` 一行未改 |
| 11 | `.control-module` | `gen3-control.ts` | 控制组件：色欲持有牵引环、控制权判定标题的锚点（取不到则回退视口中心） |
| 12 | `.control-slider-img` | `gen3-control.ts` | 控制组件滑块图：优先于 `.control-module` 作为量测目标（`controlImgRect`） |
| 13 | `.battery` | `gen3-control.ts` | 能量槽：愤怒0 中缝虚线要跨「两条能量槽之间」而非整行；惰性0 也要能量槽 rect（`batteryNode`）。`probe` 取 `battery battery-`（**相邻两个类 token**，G2 Task 3F2 收紧：裸 `battery` 被 `battery-shell` / `battery-cells` / `battery-cell` / `battery-overflow` 满足） |
| 14 | `.protocol-img` | `fx-gen3-swap.ts`、`effects/index.ts` | 协议卡面图：协议交换幽灵卡取它的 rect 与卡面图（`render.ts:130` 是 `img.className = 'protocol-img' + …`，故按书写形式是 class 选择器；清单里真正的 element 只有纯标签名 `img`）。`probe` 取**带引号的产出形式** `'protocol-img'`（G2 Task 3F2 收紧：裸 `protocol-img` 被 `render.ts:1469` 的查询 `querySelector('img.protocol-img')` 满足） |
| 15 | `.protocol` | `effects/index.ts` | **协议盒：编译翻面动画的锚点** —— `effects/index.ts:1780` 的复合选择器 `` `.protocol-cell[data-player=…][data-line=…] .protocol` `` 的第二段，`:1783` 交给 `playProtocolFlip`。它**不是** D 类：产出是 `render.ts:83`，读取是 `effects/index.ts:1780`，A 的两个条件都成立（同一条类名也被 `render.ts:1761/1762` 自查，与判定无关）。读到的结果被 `if (proto)` 套住，所以**丢掉它不会报错，只会让编译侧的协议翻面静默不播**。机检的 `probe` 取**带引号的产出形式** `'protocol'`：裸词 `protocol` 在 `render.ts` 里命中 68 行（含 `protocol-cell` / `protocol-img` / `protocol-holder` / `protocolImgSrc`），完全非判别性 —— 远程页把协议盒改名 `protocol-box` 却仍产 `protocol-cell` / `protocol-img` 时会照样报绿；带引号的形式在渲染器里**恰好只出现一次**（`render.ts:83` 的 `el('div', 'protocol' + …)`），即产出点本身 |
| 16 | `.protocol-holder` | `fx-gen2.ts` | 协议持卡盒：同化1 编译光柱的汇聚中心（**取不到就整体不播**，见 `fx-gen2.ts:2179` 审计注释） |
| 17 | `.hand[data-player]` | `fx-gen3.ts` | 手牌区（带归属）：3 代按玩家取手牌容器（`fx-gen3.ts:875`）。`probe` 与 `.hand` 相同（`'hand'` + `data-player`），**故这条不提供额外机检力，只是文档登记** |
| 18 | `.rot-cw` | `fx-orient.ts` | 场上卡横置态（P1 顺时针，`render.ts:227` 按 owner 挂）：浮层卡按它重建朝向，**漏挂则特效卡立着**。**G2 Task 2 起**：朝向类名只由 `src/ui/fx-orient.ts`（朝向单一出处）读取 —— `effects/index.ts` / `fx-gen3.ts` 改经 `orientOf()` 间接消费，源码里不再出现类名字面量；`requiredBy` 跟着代码走，否则出处机检（`tests/ui/fx-dom-contract.test.ts:190`）会红 |
| 19 | `.rot-ccw` | `fx-orient.ts` | 场上卡横置态（P2 逆时针，`render.ts:227` 按 owner 挂）：与 `.rot-cw` 成对读取。**G2 Task 2 起**同样只由 `src/ui/fx-orient.ts` 读取（见上一条） |
| 20 | `.rot-180` | `fx-orient.ts` | **场上卡 180° 倒置态（远程页对手一侧；`render-net.ts` 按座位挂）**。产出点两处：`render.ts:254`（`orient === 180 → node.classList.add('rot-180')`，由 `render-net.ts` 的 `orient: isSelfSeat ? 0 : 180` 驱动）与 `render.ts:130`（`.protocol-img.rot-180`）。**⚠️ 2026-09-14（G2 修正 R1）后 `render.ts:130` 那个产出点只归热座页** —— 远程页在"三个纵向的列"重做中改用 `.net-rot-ccw`（自己）/ `.net-rot-cw`（对手）承担**协议图**的 ∓90°（规格 §8.2），故远程页的 `.rot-180` 只出现在**场上卡**上。**与 ±90° 的区别（这是本条的登记理由）**：180° **不交换布局盒宽高**、只绕中心转 180°（`cloneBoxSwaps(180) === false`，见 `src/ui/fx-orient.ts:51` 与 `tests/ui/fx-orient.test.ts` 的"足迹公式"一节）—— 所以它**不能**复用 ±90° 的浮层卡建盒路径：拿 ±90° 冒充 180° 会得到"朝向对但尺寸错"的假正确，反之亦然。小注：热座页那个产出点（`render.ts:130`）的节点是 `.protocol-img`，**不是 FX 节点**（FX 侧的协议图走 `img` 钩子 + 克隆），故本钩子在热座页对 FX 实际不可达 —— 它是**远程页专属**的契约项 |
| — | `[data-fx-rot]` | `fx-orient.ts` | **特效朝向标记（G2 修正 R2）**：远程页场上卡带 `data-fx-rot="ccw"`（自己 −90°）/ `"cw"`（对手 +90°），由 `renderStackSlot` 的 `fxRot` 参数逐卡写入（值来自 `render-net.ts` 的 `fxRot: isSelfSeat ? 'ccw' : 'cw'`，**写入点**在 `render.ts` 的 `node.dataset.fxRot = opts.fxRot`，被 `if (opts?.fxRot !== undefined)` 守卫）。**它决定浮层卡根元素的朝向与装饰层继承的 ∓90°** —— `fx-orient.ts` 的 `fxOrientOf` 优先读它、读不到回退 `orientOf`（卡面朝向）。**它与卡面朝向是两套**（自己卡面 0° 而特效 −90°），故 `.rot-180` 管卡面、本钩子管特效，二者不可互替。**热座页有意不产出**（`RENDERERS` 给 `render.ts` 一条 `exempt`，见 §3.2），于是 `fxOrientOf` 每次回退 ⇒ 热座零变化是构造性的。⚠️ **读不到标记不会报错**：远程页若漏产，整类特效静默退回卡面朝向、差 90° —— 故另有运行时逐卡断言（约束 8）与 `verifyPageHooks` 的断言 3 |
| — | `.net-rot-ccw` / `.net-rot-cw` | （尚无人读） | **不是契约项，本节只是登记**：远程页**协议图**的 ∓90° 视觉类（自己 `.net-rot-ccw` = −90°、对手 `.net-rot-cw` = +90°，规格 §8.2 第 3 行）。规则在 `src/ui/styles-net.css`，由 `render-net.ts` 经 `renderProtocol` 的**通用** `extraClass` 参数传入（**不写进 `render.ts`**）。它**故意不叫** `.rot-cw`/`.rot-ccw`：那两个的语义是"**卡牌**横置"且 `fx-orient.ts` 的 `orientOf` 会把它们当作**卡面**朝向读，协议图借用同名类会让 FX 把协议误判成横置的卡。R1（布局重做）只产出它，**读侧与契约登记**在后续任务（特效朝向分离 / 方向按座位）里落地 |

### 3.2 按渲染器区分要求（G2 Task 4）

`RENDERERS`（`src/ui/fx-dom-contract.ts:61`）是"谁必须满足本契约"的**唯一出处**，每个注册项形如
`{ file: string; exempt?: readonly string[] }`。**`exempt` = 该渲染器有意不提供的 A 类钩子**（逐条、按 hook 字符串精确匹配）。

**当前登记：**

```ts
export const RENDERERS: readonly FxRenderer[] = [
  { file: 'render.ts',     exempt: ['[data-fx-rot]'] },         // 热座页：有意不产出特效朝向标记
  { file: 'render-net.ts', exempt: ['.rot-cw', '.rot-ccw'] },   // 远程页：有意不产出 ±90°
];
```

**`render.ts`（热座页）为什么有意不产出 `[data-fx-rot]`（G2 修正 R2）：**

1. **它是远程页专属的"特效朝向"载体**。热座页自己一侧的卡**就是** ±90°（`render.ts:227` 按 `card.owner` 挂），
   特效朝向与卡面朝向**同一套** ⇒ 不需要第二个标记。
2. **产出它会让"热座零变化"不再是构造性的**：`fxOrientOf` 一旦在热座上读到标记，就不再回退 `orientOf`
   —— 而回退分支正是"热座浮层卡几何走原分支"的全部依据（`fx-orient.ts` 的 `fxOrientOf` 注释）。
3. **写入点仍在 `render.ts`，但被守卫住**：`node.dataset.fxRot = opts.fxRot` 外面套着
   `if (opts?.fxRot !== undefined)`，热座调用点不传 `fxRot` ⇒ **DOM 上一个字节都不多**。
   `exempt` 表达的是"这个渲染器**有意**不提供这条钩子"，与"产出表达式写在哪个文件"无关。

**注意义务守恒**：`[data-fx-rot]` 只被 `render.ts` 豁免，`render-net.ts` **必须**提供它
（`renderStackSlot(` 调用链 + `fxRot` 实参）—— 契约测试有专门断言禁止"某条钩子被所有渲染器同时豁免"。

**`render-net.ts` 为什么有意不产出 `.rot-cw` / `.rot-ccw`（三条理由，缺一条都不足以豁免）：**

1. **语义**：±90° 是"两位玩家坐在**同一块屏幕**前、各自看自己那半边"的**热座专属**方案（`render.ts:227` 按 `card.owner` 挂）。
   远程页的两人隔桌对坐，正确朝向是「自己正立 0° / 对手倒置 180°」。
2. **几何**：±90° 会**交换布局盒宽高**（100×60 → 60×100），0°/180° **不会**（`cloneBoxSwaps`）。
   浮层卡（飞行幽灵卡）按"未旋转布局盒 + 绕中心 transform"建盒，两者**不可互相替代** ——
   这正是派 Task 1 补 180°、Task 2 建朝向单一出处的原因。
3. **契约面**：豁免是**逐文件名**的（`exempt` 挂在具体注册项上），不是"名字像渲染器就算"。
   并且 `exempt` 的每一项都必须是**真实的 A 类钩子**（守卫断言），拼错键会静默扩大豁免面。

**为什么登记豁免，而不是把钩子从 A 类里删掉：**

删钩子会同时删掉**热座页**的验收位（`render.ts` 仍在产出 ±90°，且 `fx-orient.ts` 真的在读它）——
那就成了一条"因为远程页不产，所以谁也不验收"的契约洞。`exempt` 表达的是**逐渲染器的要求差异**，
契约项本身（以及它的产出方/读取方证据）完整保留。守卫侧因此有两条对称断言：

- 「A 类钩子必须被当前渲染器提供」按 `r.exempt` 跳过（Task 2F2 接好通路）；
- **`exempt` 的每一项都必须是真实的 A 类钩子**，且不得被**所有**渲染器同时豁免（Task 4 新增，
  来自 Task 2 终审延后清单 N-5）。

**`.rot-180` 对两个渲染器都成立、因此不需要豁免**：`render-net.ts` 是它的主要产出方（对手侧），
`render.ts` 也有产出点（`render.ts:130` 的 `.protocol-img`）。这是"超集规则"的直接例子：
A 类清单是两个渲染器的**并集**要求。

**`[data-fx-rot]` 反过来：只有远程页提供、热座豁免**（理由见上）—— 这才是 `exempt` 机制要表达的
"**某条钩子只属于某个渲染器**"（G2 修正 §8.3 的那条裁决）。两个方向都有实例之后，"豁免"就不再是
"±90° 的特例"，而是一条通用机制。

### 3.1 最高风险的一条

**`.stack-slot[data-player][data-line]` 排在第一位，也是远程页最容易做错、代价最大的一条。**

3 代飞行、连接件、常驻层落点、控制权牵引的几何几乎全部锚在它上面（`slotRectOf` / `lineCenterX`）。它必须同时满足：

- **是 class `.stack-slot`**（不能换成别的类名或标签选择器）；
- **同时带 `data-player` 与 `data-line` 两个属性**，且值与状态里的 `(player, line)` 对应；
- **每条链路、每个玩家都有独立节点**，`querySelectorAll` 返回的集合顺序/数量要能按属性筛出唯一目标。

改错这一条不是"某个特效偏一点"，而是**整个 3 代特效族 + 常驻层一起失去落点**。G2 请把这条当第一优先级的验收项。

**注意**：它的机检就是 `probe: ['stack-slot p', 'data-player', 'data-line']` —— 只产 `stack-slot` 而丢掉两个
`dataset` 属性会**直接报红**（这正是终审加 `probe` 的原因：旧的自动推导只看类名，
`el('div','stack-slot')` 不带任何属性也能过守卫）。G2 Task 3F2 把第一段从裸 `stack-slot` 收紧成
`stack-slot p`（**相邻两个类 token**，与 `.trash-pile.p1/.p2` 的 `'trash-pile p'` 同源）：裸词会被
`syncSmokeOverlays` 的**查询**（`.stack-slot[data-player=…]`）满足，于是把产出点的类名改掉时守卫
仍然全绿（变异 A06 实测）。⚠️ 3F2 的**第一版**曾用"类名 + 尾空格"（`'stack-slot '`），实测对
`deck` / `battery` 无效（同名局部变量满足它），已统一弃用 —— 见下方"踩过的坑（勿重蹈）"。

其余高风险项：`img`（卡面图唯一来源，6 个读取点跨 4 个模块）、`[data-uid]`（手牌与链路卡都必须带，缺了则 `nodeOf` 全线失效）、`.protocol-holder`（取不到就整体不播）、`.protocol`（取不到则编译翻面静默不播）。

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

**具体做法（四步，无歧义）：**

1. G2 写完远程页渲染器（`src/ui/render-net.ts`）。
2. **该渲染器已经登记进 `src/ui/fx-dom-contract.ts` 的 `RENDERERS`**（G2 Task 3 登记 `render-net.ts`、
   Task 4 补上 `exempt` 语义与豁免断言）—— **G2 阶段这一步无需再做**：

   ```ts
   export const RENDERERS: readonly FxRenderer[] = [
     { file: 'render.ts',     exempt: ['[data-fx-rot]'] },
     { file: 'render-net.ts', exempt: ['.rot-cw', '.rot-ccw'] },
   ];
   ```

   > **认哪个文件**：`RENDERERS` 的**唯一出处**是 `src/ui/fx-dom-contract.ts`（Task 2F2 起从测试文件移出），
   > `tests/ui/fx-dom-contract.test.ts` 与 `tests/ui/fx-orient.test.ts` 都 `import` 它，**不得**再建本地副本，
   > **不得**再写 `as readonly string[]`（那在运行期恒为 false，且绕过类型检查）。
   >
   > **忘登记会被抓**：`RENDERERS` 是 opt-in 的，忘了登记就等于所有断言继续只验旧渲染器还报绿 ——
   > 比没有守卫更糟，因为它读起来像"已验收过"。为此有专门的**反向发现**断言：
   > 它 `readdirSync` 扫 `src/ui/` 下所有 `/^render.*\.ts$/` 的文件，凡不在 `RENDERERS` 里就报红
   > （`以下渲染器未登记进 RENDERERS：…`）。新增渲染器文件后即使一句话都不改测试，也会立刻红。
3. **跑 `npx vitest run tests/ui/fx-dom-contract.test.ts` 即得结论**（无需改任何测试文件或文档）。
   同一份结论也由 `npx vitest run tests/ui` 与 `npx vitest run` 覆盖。
4. 抽查 ≥20 个点名特效的**实机播放**（见下方"建议补充"）——**这一步不是可选项**，且 5173 上的预览页
   会把运行时自查结果直接显示在工具条上（见 6.1）。

### 6.1 源码守卫之外：预览页的**运行时自查**（G2 Task 4 接线后可见）

**为什么还需要它**：下面那条「A 类钩子必须被当前渲染器提供」的判据**全程是源码文本**。它对
`render-net.ts` 这种"复用 `render.ts` 叶子助手"的渲染器证明力最弱 —— 它只能证明"本页调用了产出
这些钩子的助手"（`tests/ui/fx-dom-contract.test.ts` 的 `ASSISTANT_CALLS`），证明不了钩子真的挂到了
节点上、属性值真的等于状态、节点在特效读取那一刻存在。G2 Task 3 的 4 个 Critical 正是在**五道门全绿**
的情况下潜伏的。

**做法**：预览入口（模式选择页的「单视角预览（本地）」卡）以 `verifyHooks: true` 调 `renderNetBoard`，
渲染完立刻**真的去 DOM 里查**一遍 `NET_PAGE_HOOKS`（`src/ui/render-net.ts` 的 `verifyPageHooks`），
把结果写进页内工具条的 `.net-verify-note` —— 于是在 5173 上**肉眼可见**：

- `自查 ✓ A 类钩子齐 / 手牌顺序 [P0,P1] / 对手卡与协议 180°`；
- `自查 ✓（N 条状态相关钩子当前为空）`（空局面合法）；
- `自查 ✗ N 项：<第一条>` —— 那 N 条在运行时真的取不到（**这是最有价值的一行**）。

它同时覆盖两条**源码守卫永远证不了**的断言：① 两条 `.hand` 的 DOM 顺序恒为 `[P0, P1]`（FX 按**下标**
读手牌，反了会把卡飞到对手手牌区且不报错）；② 对手侧场上卡与协议**各自**带 `.rot-180`（行级
`rotate(180deg)` 会与卡自身的倒置叠加成 0°，导致对手的卡其实正立）。结构钩子还做**数量**核对
（`3 线 × 2 侧 = 6` 等，期望值从源码结构推导）。

**断言 3（G2 修正 R2 · 约束 8）**：`[data-fx-rot]` **逐卡**挂在两侧的每一张场上卡上，且**取值按座位**
（自己 `'ccw'`、对手 `'cw'`）。为什么必须放在运行时：`fxOrientOf` 的**回退**机制意味着
"远程页忘了产出标记"**不会有任何报错** —— 它只会静默把卡面朝向当成特效朝向（自己差 90°、
对手差 90°，且对手的 180° 卡面会被当成 180° 特效朝向）。契约里 `[data-fx-rot]` 是 `stateDependent`
的存在性检查，查不出这件事；只有"逐卡计数 + 逐卡读值"能。

**断言 4（G2 修正 R3 · 约束 9，本次新增）**：**方向性**在两个座位下都成立。做三件事：

1. `fxViewSeat()` 必须**等于**渲染期写进去的那个值（`renderNetBoard` 把 `applyFxViewSeat(opts.viewSeat)`
   的返回值交给 `verifyPageHooks(wrap, seatApplied)`）。删掉那次调用 / 改成 `setFxViewSeat(null)` /
   参数传错 ⇒ 远程页会退回热座的左右语义（落点、覆盖条带全按左右算）而**不报任何错**。
2. 两侧每张场上卡各自带 `[data-fx-rot]` 且取值按侧（自己 `ccw` / 对手 `cw`）——
   这正是**覆盖方向**（`gen3-util.ts` 的 `coveredOuterOf`）与**落点轴**（`fx-seat.ts` 的 `fxOuterFor`）
   的共同输入：标记在、值对，方向判据的输入就是对的。
3. `.net-board.net-view-N` 与 `.net-hands` 的 `data-view-seat` 必须与 FX 座位**同值** ——
   防"布局按 A 座位、方向按 B 座位"这种静默错配（页面看着正常、特效全反）。

⚠️ **能力边界（别把 ✓ 读成"几何已验证"）**：无 jsdom ⇒ 量不到 `getBoundingClientRect()`。
这条断言只做**标记/类名层面的存在性 + 逐卡朝向 + 契约链**，**证明不了**
"卡真的向下/向上排开""覆盖条带真的在上/下" —— 那只能人眼看（R3 报告 §8）。

**断言 5（G2 修正 R3 · 控制轨）**：控制轨的**端归属**判据在 `fx-seat.ts` 的纯函数 `fxTrackEndFor`
（`null` ⇒ 横向 4%/96%；座位 ⇒ 竖向：自己端 96% = **下**、对手端 4% = **上**），
由 `tests/ui/fx-seat.test.ts` 逐格断言（含"上下对调"的变异）；`styles-net.css` 第 9 节提供竖向布局。
A 类钩子的**产出方拼写未改**（仍是 `render.ts` 的 `renderControlModule`）。

⚠️ **真实联机时不传 `onPreviewChange` → 工具条完全不渲染**，自查行随之消失（联机零开销）。

其中「**A 类钩子必须被当前渲染器提供**」这条断言会遍历 `RENDERERS` 里的每个渲染器，对每条 A 钩子取其**判别子串**并逐个断言渲染器源码里出现：

- 钩子带显式 `probe`（所有复合钩子，如 `.stack-slot[data-player][data-line]`，以及靠裸词无法判别的
  `.protocol` / `.card` / `.hand` / `.control-track` / `.protocol-img` / `.deck[data-player]` / `.battery`）
  → **`probe` 里每一项都必须出现**（`stack-slot p` + `data-player` + `data-line`）；
  - **两种收紧形式**（G2 Task 3F2 的 R2 同类风险审计，逐条都由变异实测驱动）：
    ① **带引号的产出形式**（`"'protocol'"` / `"'card'"` / `"'hand'"` / `"'control-track'"` / `"'protocol-img'"`）
    —— 生产点写成 `el('div', 'X')` 或 `'X' + …`，该形式在渲染器里恰好只出现一次；
    ② **相邻两个类 token**（`'stack-slot p'` / `'deck deck-'` / `'battery battery-'`，与 `.trash-pile.p1/.p2`
    的 `'trash-pile p'` 同源）—— 生产点是模板串，且**后面必然紧跟一个承重修饰类**
    （`.pN` / `.deck-N` / `.battery-state`）。这样既排除 `deck-count` 这类更长同类名与 `[...]` 查询写法，
    也不绑定引号/模板的具体写法。
    ⚠️ **踩过的坑（勿重蹈）**：先试过"类名 + 尾空格"（`'deck '` / `'battery '`），**实测无效** ——
    同名**局部变量**（`const deck = …` / `const battery = …`）后面也是空格，变异后照样绿（A02/A03 复跑红）。
    只有 `'stack-slot '` 侥幸成立（没有同名局部变量）；现在统一改成形式 ②。
  - ⚠️ 收紧**只做变异证明会假绿的那些**（A01–A06、A10）。`img` 是**故意不收紧**的：它是标签名钩子，
    任何"更严"的写法（`createElement('img')` / `"'img'"`）都会拒绝合法等价写法（`new Image()`、
    双引号、`createElement( 'img' )`），而它今天已被 `.protocol-img` / `.control-slider-img` 两条
    产出形式**部分兜住**；这一条的兜底仍是实机抽查；
- 否则退回自动推导 `probeOf(hook)`（`img` → `img`；`[data-uid]` → `data-uid`）；
- **probe 里形如 `data-*` 的项**（不论钩子 `kind` 是 `attr` 还是 `class`）额外接受
  `dataset.<camelCase>` 产出形式：`data-uid` ⇄ `dataset.uid`、`data-player` ⇄ `dataset.player`、
  `data-line` ⇄ `dataset.line`。理由是渲染器**写**属性用的是 `node.dataset.uid = …`：字面量
  `data-uid`（12 行）在 `render.ts` 里全是查询/注释，而字面量 `data-player` / `data-line` 也**只出现在
  查询选择器**里（`:293` 等），真正写它们的是 `dataset.line` / `dataset.player`（`slot.dataset.*`，`:210/211`）。
  只认字面量会
  两头都错：把「只写 dataset、从不查询」的**正确**远程页判成缺钩子（假红），而任何一处查询又能让
  「根本不写属性」的渲染器蒙混过关（假绿）。映射按 token 精确进行（`dataset.other` 不能满足
  `data-uid`），且要求其后不是标识符字符（`dataset.uidCounter` 不算 `dataset.uid`）。

失败时打印 `render-net.ts 未提供 <钩子>（判别子串 <a> + <b>…）`。

**结论口径（终审收紧 + G2 Task 4 补充）**：这条断言绿只等于 —— **每个钩子的判别子串都出现在了渲染器源码里**
（`render-net.ts` 走"助手调用链"判据，见 `ASSISTANT_CALLS`），且**除 `RENDERERS[].exempt` 明示豁免的项外**没有缺口。
它**不等于**"契约已满足"：源码文本守卫既证明不了运行时的属性**值**（`data-player` 是不是真的等于
状态里的 `player`），也证明不了节点在特效读取的那一刻真的存在、真的挂在正确的祖先上。
红 = 报告里列出的钩子就是远程页缺的，补齐后重跑即可；**绿之后仍必须做实机抽查**（下一条）+
**看一眼预览页工具条上的自查行**（§6.1）。

**建议补充（机检之外，强制）**：G2 完成后抽查 **≥20 个点名特效**在远程页实际页面上的播放（含三代已编译特效、
控制权牵引、弧轨三态）——源码守卫只能证明"选择器字符串在渲染器源码里出现"，不能证明运行时真的挂在了
正确的节点上、且在正确的时机存在。这条与 §6.6 的验收标准一致，**是绿之后的必要步骤，不是可选项**。

**已知局限（只披露，不修）**：即使带上 `probe`，断言的仍只是"这些 token 在**渲染器源码里
出现过**"，证明不了语义。三处必须记住：

1. **写 vs 查分不开**：`render.ts` 自己也在查询 `data-player` / `data-line`（如 `:293`），所以
   "生产者**真的写**了这个属性"仍不是文本守卫能证明的（`data-*` 项之所以额外接受
   `dataset.<camelCase>`，就是因为"写"和"查"在源码里长得不一样；但这条备选是**双向**妥协 ——
   它同时放行"只查不写"和"只写不查"两种渲染器，换来的只是不再假红，**换不来**"属性确实被写出去了"）。
2. **`img` 是退化的、且故意不收紧**（G2 Task 3F2 审计结论）：实测命中 `render.ts` 80 行；任何更严的
   写法都会拒绝合法等价写法（`new Image()` / 双引号 / 带空格的实参），代价大于收益。它部分由
   `.protocol-img`、`.control-slider-img` 两条已收紧的产出形式兜住，最终兜底是实机抽查。
3. **`.hand` 与 `.hand[data-player]` 的 `probe` 完全相同**，**后一条不提供任何额外机检力，
   只是文档登记**（登记的意义在于把"无归属的 `.hand`"与"按玩家取的那一个"两种读法都记下来）。
4. **G2 Task 3F2 已收紧 7 条**（`'stack-slot p'` / `'deck deck-'` / `'battery battery-'` / `'card'` /
   `'hand'` / `'protocol-img'` / `'control-track'`）：都由"把产出点类名改掉、守卫是否仍绿"的**变异实测**驱动
   （旧 probe 分别被查询、`deck-count`/`battery-cell` 这类更长同类名、`control-track-label` 满足）。
   收紧后 7 条对照变异全部变红；`card`/`hand` 的命中行数（158/79）因此**不再**是问题 —— 现在查的是
   带引号的产出形态本身。
   代价（如实说明）：这些形式**绑定产出写法**（`'card ' + x` / `` `card${x}` `` / `` `deck${x}` `` 这类
   等价重构会假红）。这是有意的取舍：**假红是响亮的**，而"类名被改掉却全绿"是静默的。

**建议 G2 补的长期机制（本次**未**实现，属新机制而非修复）**：**token 级守卫** —— 把 FX 选择器字面量里
的每个 `.class` / `[attr]` token 都抽出来，断言"已登记进本契约，或在白名单里（特效自建 / 渲染器自有）"。
这才是"根因"（普查按**一行一处读取点**登记，复合选择器会丢掉尾段）的彻底解法。本次不做，是因为它是
一套新机制，不是本轮修复项；且要注意**多行模板字面量**正是逐行普查的天敌 ——
`effects/index.ts:1779-1781` 的选择器跨三行，`.protocol` 这一段因此整段漏登记。

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
| A 结构钩子（远程页必须提供；`render.ts` 豁免 `[data-fx-rot]`、`render-net.ts` 豁免 `.rot-cw` / `.rot-ccw`） | 21 | `hooksOfCategory('A')` |
| B 特效自建节点 | 34 | `hooksOfCategory('B')` |
| C 内部注册键 | 1 | `hooksOfCategory('C')` |
| D 渲染器自有、FX 不读 | 3 | `hooksOfCategory('D')` |
| **合计** | **59** | `FX_DOM_CONTRACT.length` |

本文档的 A 类清单是契约的**权威人读版**；如与机读清单冲突，以 `src/ui/fx-dom-contract.ts` 为准，并应立刻修正本文档（否则守卫报红）。
