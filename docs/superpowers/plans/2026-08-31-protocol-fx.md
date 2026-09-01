# Compile《译世界》— 10 套新协议专属特效开发计划（2026-08-31）

> 目标：为 死/灵魂/重力/念能/瘟疫/金属/速度/爱/恨/冷漠 10 套新协议添加用户指定的专属动画特效（一次性附加特效 + 持续型常驻特效）。
> 流程：SDD 子代理驱动（implementer + reviewer 双裁决），每组一个任务。**视觉观感由用户 5173 确认**——实现侧几何推演 + build + 逻辑审查。
> 权威规格：用户逐条描述（本计划转录）；规则状态查询用 `src/core/rules/restrictions.ts` 既有 helper + `lineTopCommandActive`。

## 全局约束（每条派发必须携带）

- 不改 `vite.config.ts` 的 `test.pool`；禁 `npm install/ci`；TS strict 禁 `any`。
- 现有 508 测试不得回归；`npm run build` clean（特效层不进 core，无单测——FX 层评审靠代码审查 + build + 语义核对）。
- **常驻特效必须用暗2 黑烟同款模式**：body 级 fixed 层 + 注册表（Map<key, HTMLElement>），每次渲染只更新位置/显隐（get-or-create、永不移除重建、不重置动画进度）；`resetUiState`（render.ts ~1677 行）清理全部注册表。参考 `smokeOverlays`/`scanOverlays`/`compiledFx` 模式。
- 一次性附加特效：在 `src/ui/effects/index.ts` 的 `initEffects()` 事件分发处按 `payload.triggerProtocol` 叠加（参考 `playFireBurnExtra`/`playLifeFlip` 模式）——**先播附加特效（含基础特效前置部分）→ 基础特效 → 收尾特效**，用 `buildFxCard(node, payload, EXTRA_Z)` 构建浮层卡。
- **card:drawn 事件缺触发源**：`resolve.ts` draw op 的 `gameBus.emit({type:'card:drawn', payload:{player,count}})` 无 triggerProtocol——**需在 resolve.ts 补 `triggerProtocol: pe.sourceDefId.split('-')[0]`**（fromOpponentDeck 分支同）供速度/爱抽牌特效分发（本计划先导改动，各任务实现前先合）。
- man.png：`E:\studyE\compile\compile1\man.png` → 复制到 `public/assets/fx/man.png`（金属6 用）。
- 视觉观感细节（时长/颜色深浅）按用户描述实现；可调参数集中在 styles.css 变量/常量，用户 5173 反馈后微调。

## 执行顺序

先导（card:drawn 触发源）→ FX-1 death+hate → FX-2 gravity+speed → FX-3 psychic+plague → FX-4 love → FX-5 apathy+spirit → FX-6 metal

---

## 先导：card:drawn 事件带 triggerProtocol

`src/core/effects/resolve.ts` draw op 两个 emit（普通 + fromOpponentDeck）payload 加 `triggerProtocol: pe.sourceDefId.split('-')[0]`（与 discard/deleted 一致）。`effects/index.ts` `FxCardPayload` 已含 triggerProtocol（draw 事件 payload 类型在 main.ts 消费处若强类型需同步）。测试：`npx vitest run tests/effects/engine-ext.test.ts` 等确认无回归。

---

## FX-1：死（death）+ 恨（hate）删除附加特效

触发：`card:deleted` 且 `payload.triggerProtocol === 'death'` / `'hate'`（`effects/index.ts` 分发处叠加）。

### death（用户 #1）
时序（总 ~3.5s）：
1. **镰刀渐现**（0~0.3s）：目标卡上方出现死神镰刀（CSS/SVG 组合，`.fx-death-scythe`：长柄 + 弯刃，可旋转斜置）。
2. **镰刀划过**（0.3~0.8s）：镰刀快速从卡上方横/斜划过卡面（translate + rotate 动画）。
3. **深紫边框光**（与镰刀出现同时起）：被删卡边框周围深紫色光芒（`.fx-death-glow` 外发光，随卡删除延续到第 5 步）。
4. **基础删除特效**（划过完成后，~0.8s 起）：调用 `playShatter`（原卡牌播放破碎）。
5. **收尾**：镰刀渐隐；原位置渐现**黑色骷髅头**（`.fx-death-skull`：头骨 + 下排牙齿上下动动画，CSS 牙齿分隔），2 秒后渐隐；边框深紫光保持 2 秒后消失。

### hate（用户 #9）
时序（总 ~3.5s）：
1. **血红手指/手掌渐现**（0~0.5s）：目标卡周围渐现 5 根血红色手指与手掌（`.fx-hate-hand`：5 个手指元素围成手型，CSS 血色渐变）。
2. **手指收缩抓住卡**（0.5~1.5s）：5 指从四周向卡中心收缩（scale/translate，1.5s 完成）。
3. **血红边框光**（同时起）：被删卡边框血红色光芒（`.fx-hate-glow`）。
4. **基础删除特效**（抓住后 ~1.5s 起）：playShatter（手指手掌期间一直存在）。
5. **收尾**：手指手掌渐隐；原位置渐现**一滩血**（`.fx-hate-blood`：不规则血色斑块），2 秒后渐隐；边框血红光保持 2 秒后消失。

---

## FX-2：重力（gravity）+ 速度（speed）位移附加特效

### gravity（用户 #3）
触发：`card:deck-played`（反面打出牌堆顶，含 player=opp 的对手牌库）与 `card:shifted` 且 triggerProtocol==='gravity'。
时序（总 ~2.5s）：
1. **牌库区边框品红光**（打牌堆顶时）：牌库区（`.deck[data-player]`）边框亮品红光芒（`.fx-gravity-deckglow`，body 级定位到牌库 rect）。
2. **终点黑洞渐现**（0~0.3s）：终点（堆叠末尾 / 平移目标位）渐现深紫黑**黑洞**（`.fx-gravity-hole`：圆形 + 中间一条横线，旋转可斜）。
3. **射线**（0.3~1.8s，1.5s）：黑洞向牌库堆（起点）射出一条**由粗变细、过中间后由细变粗**的线（`.fx-gravity-beam`：CSS 渐变宽度动画——可用 transform scaleX 分段或 clip-path 模拟）。
4. **基础特效**（1.8s 起）：playDeckPlay / playShift。
5. **收尾**：卡到终点后黑洞渐隐；**整张牌边框品红光保持到终点后 1 秒熄灭**（浮层卡边框）。

### speed（用户 #7）
触发：`card:shifted` 与 `card:drawn` 且 triggerProtocol==='speed'（drawn 需先导）。
时序（总 ~2s）：
1. **卡框灰白发光**：目标卡边框灰白色发光（`.fx-speed-glow`）。
2. **飓风渐现**：卡中心渐现飓风（`.fx-speed-tornado`：螺旋柱状，CSS 旋转 + 锥形）。
3. **飓风移动**（1.5s）：以卡位置为起点向位移终点移动（平移：终点=堆叠末尾；抽牌：终点=该玩家手牌末尾 handEndPos）。
4. **基础特效**：playShift / 抽牌基础动画。
5. **收尾**：到达后飓风渐隐，卡框恢复正常。

---

## FX-3：念能（psychic）+ 瘟疫（plague）

### psychic 弃牌（用户 #4a）
触发：`card:discarded` 且 triggerProtocol==='psychic'。
时序：
1. 基础弃牌（playCut）**前**：卡周围渐现 **20+ 紫粉色粒子**（`.fx-psychic-particle`，环形散布，随机相位）环绕 1 秒。
2. 1 秒后所有粒子**同时向卡中心平移**（汇聚）。
3. 触发基础弃牌特效（playCut）。

### psychic-1 持续（用户 #4b）
常驻型（暗2 模式）：`opponentMustPlayFaceDown(s, player)` 生效期间（psychic-1 正面上场），对方（该玩家）**三条链路**不断出现小型紫粉粒子微微闪烁后消失。
实现：render.ts 新注册表 `psychicParticles` + `syncPsychicParticles(s)`——对 `opponentMustPlayFaceDown(s, p)` 为真的玩家 p，遍历其 3 条线（`.stack-slot[data-player][data-line]`），每条线维护 1 个 body 级粒子层（多个粒子元素 CSS 闪烁循环，stagger），get-or-create + 位置同步；条件不满足移除。

### plague 弃牌（用户 #5a）
触发：`card:discarded` 且 triggerProtocol==='plague'。
时序（总 ~2s）：
1. 卡框**深绿光芒** + 周围渐现**深绿浓雾**渐渐覆盖卡（`.fx-plague-mist` 覆盖层，1.5s）。
2. 触发基础弃牌（playCut）。
3. 结束后浓雾渐渐消散。

### plague-0 持续（用户 #5b）
常驻型（暗2 模式）：`lineBlocksOpponent(s, line, player)` 为真（plague-0 正面未覆盖在对手该线）时，对方该链路出现深绿浓雾渐现渐消循环。
实现：注册表 `plagueMists`（key=line）+ sync——条件满足 get-or-create 定位到 `.stack-slot`（该线双方占位区域），浓雾层 CSS 渐现渐消循环；不满足移除。

---

## FX-4：爱（love）

触发：`card:drawn`（含 refresh 抽牌——drawCards 统一路径）与 `card:given` 与 `card:revealed` 且 triggerProtocol==='love'。

### 抽牌（用户 #8a）
1. 牌堆区边框粉红光芒（`.fx-love-deckglow`，body 级定位牌库 rect）。
2. 基础抽牌动画；抽出的卡边框粉红光芒 + **卡背爱心粉红图案**（`.fx-love-heart`：爱心形状，快速跳动 pulse，2 秒后消失）——类似光揭示幽灵的"翅膀"但为爱心。
3. 持续时间 2 秒后消失。

### 给牌 / 收牌（用户 #8b）
1. 所选手牌边框粉红光芒 + 卡背爱心（跳动）。
2. **交换基础特效**（= 平移类：起点=该手牌 rect，终点=对方手牌末尾 handEndPos；用 buildFxCard + translate，参考 playHandPlay）——`card:given` 事件 payload 含 `to`（resolve.ts give op 已带）。
3. 卡牌到达后边框 + 爱心持续 2 秒后消失。（对方给你时同款——事件方向由 payload 推断。）

### 揭示（用户 #8c）
`card:revealed`（love-4 揭示自己手牌 → Case A 幽灵）：落地幽灵（`.reveal-ghost`）边框粉红光芒 + 中间爱心跳动，**持续时间 = 幽灵存在期间**（幽灵过期移除时特效随之消失——在 renderHand 的 reveal-ghost 上挂类；或 body 级层按 revealedGhosts 同步）。

---

## FX-5：冷漠（apathy）+ 灵魂（spirit）

### apathy 翻转（用户 #10a）
触发：`card:flipped` 且 triggerProtocol==='apathy'。
时序（总 ~2s）：
1. 卡边框亮灰光芒（`.fx-apathy-glow`）。
2. **双边浓重灰雾**从卡较短两边渐现并覆盖卡（向中心移动，`.fx-apathy-mist` 两侧层）。
3. 基础翻转特效（playFlip；灰雾期间一直在）。
4. 翻后浓雾消散；边框灰光保持 1 秒后消失。

### apathy-0 持续（用户 #10b）
常驻型：valueModifier 生效（该线有正面 apathy-0）时，对应链路灰色浓雾渐现渐消循环（注册表 `apathyMists`，同 plague-0 模式）。

### apathy-2 持续（用户 #10c）
`lineMiddleCommandsNullified(s, line)` 为真时：该列**双方链路上所有卡牌**牌面被灰色滤镜覆盖（黑白二色）。
实现：render.ts 渲染场上卡时，若该线 lineMiddleCommandsNullified → 卡元素加 `.apathy-filter`（CSS `filter: grayscale(1)`，静态无动画 → 重渲染无重置问题）；**双击放大查看器（zoom）克隆不受影响**——zoom 克隆时移除该 filter 类（render.ts zoom 实现处处理）。

### spirit-0 被动（用户 #2a）
1. **手牌区框光芒**（持续型）：`shouldSkipCacheCheck(s, player)` 为真（spirit-0 正面未覆盖）期间，该玩家手牌区外框亮紫/紫粉交替光芒（`.fx-spirit-handglow`，注册表定位 `.hand[data-player]`）。
2. **check-cache 锁链**（一次性，步骤触发）：当 `s.step === 'check-cache'` 且 `shouldSkipCacheCheck(s, player)` 时播放——以上下手牌区边框为起点，朝手牌区中央延伸 **20 条亮紫锁链**（`.fx-spirit-chain`：CSS 倾斜线 + 锁链节，用 SVG/渐变模拟），**起点终点随机且互不重叠、基本倾斜**；检查通过（步骤离开 check-cache）后锁链持续 1 秒缩回消散，边框恢复不发光。
   实现：render.ts 跟踪 `prevStep`，检测进入 check-cache → 触发锁链（body 级一次性层，随机生成 20 条线段）；离开 → 缩回消散动画。

### spirit-1 持续（用户 #2b）
`canPlayFaceUpAnywhere(s, player)` 为真（spirit-1 正面上场）期间：该玩家**所有手牌边框**亮紫/紫粉交替光芒 + **四角加厚紫色护边**（`.fx-spirit-handcard`）。
实现：常驻注册表 `spirit1Cards`（key=手牌 uid）——body 级层定位到每张手牌卡 rect（get-or-create + 同步），边框光芒 + 4 个角护边元素；手牌卡离开手牌区（弃/打/回）后该 uid 层移除（sync 时只保留当前手牌 uid）。

---

## FX-6：金属（metal）

### metal-0 持续（用户 #6a）
valueModifier 生效（该线有正面 metal-0）时：**对方能量槽框外层一圈金属光泽边框**（`.fx-metal-energyglow`，注册表定位 `.energy[data-player=对方]`，金属光泽渐变边框循环）。

### metal-1 中间（用户 #6b）
`card:played` 且 triggerProtocol==='metal'（metal-1 打出）时：对手三条链路边框外层一圈金属光泽边框（一次性：出现 → 3 秒渐隐，`.fx-metal-lineglow` 注册表短时层，定时移除）。

### metal-2 持续（用户 #6c）
`lineBlocksOpponentFaceDown(s, line, player)` 为真时：对手对应链路铺**金属光泽铁板** + **斜长方形光芒从左到右扫过**（`.fx-metal-plate`：铁板渐变 + `.fx-metal-sweep` 斜光条 translateX 循环）。
实现：注册表 `metalPlates`（key=line）定位到对手该线 `.stack-slot`。

### metal-6 手牌（用户 #6d）
该玩家手牌含 metal-6 时：该卡每 2 秒牌面渐现 `man.png`（`public/assets/fx/man.png`）又渐隐（`.fx-metal-man` 覆盖图 + 2s 循环动画）。
实现：渲染手牌时对 metal-6 卡挂覆盖层（body 级注册表 key=uid，定位到手牌卡 rect；或直接在卡 DOM 上挂类——若手牌卡重渲染重建会重置动画，故用注册表层）。man.png 复制到 public/assets/fx/。

---

## 收尾

- 全量 `npm test` + `npm run build` clean。
- 更新 `docs/handoff-2026-08-31.md`（特效章节）与全局记忆、SDD 台账。
- 提交全部；**推送等用户明确指示**。用户 5173 确认观感后按需微调（各特效参数集中在 styles.css）。
