# 阶段 2 文档：效果引擎 + Fire 协议试点（Compile《译世界》网页版）

> 本文件是阶段 2 的完整交接文档，供**零上下文 agent** 直接续作阶段 3。
> 日期：2026-08-29 · 分支：`feature/stage2-effects-fire`（已审查，待控制器合并推送） · HEAD：`d7a8af5` · 测试：85/85 通过 · 构建：通过

---

## 0. 最新状态（2026-08-29 收尾，续作从这里开始）

- **阶段 2 全部完成**：卡牌效果引擎（生成器 + 效果栈 + 6 效果操作 + 触发系统）+ **Fire 协议 6 卡真实效果试点**（fire-0 中/底、fire-1/2/4/5 中、fire-3 底可选结束），全部可结算、可连锁、可挂起选择。
- **测试 85/85 全绿**（21 个测试文件，含 8 个 effects 新目录 + play-effect/game-effect 接入测试），**build 通过**（`tsc --noEmit && vite build`），**工作区干净**。
- 分支 `feature/stage2-effects-fire`（相对 `main` 25 个提交，HEAD `d7a8af5`）；**git 远程推送不在本阶段职责内**——由控制器走合并流程后统一推送。
- **特效已接入（分层模型，用户确认 2026-08-29）**：**基础行为特效**——`card:discarded`=沿对角线切成两半（`public/assets/fx/discard-cut.css/js`）、`card:deleted`=破碎消散（`public/assets/fx/delete-shatter.css/js`），目标卡上**总是播放**（与谁触发无关）；**额外协议特效**——由**触发弃牌/删去的卡**（事件 `triggerProtocol`/`triggerDefId` = 效果源卡）决定是否叠加（fire 触发 → 额外火焰焚烧 `fire-burn.css`，叠在基础特效**之上**，z 301 > 300；与被删/弃目标卡协议无关）。克隆卡到 body 浮层播放，1.2s 后移除。
- **自动推进暂停策略已按用户确认定稿**：「有决策点就停、全部清空才走、没有事件就自动过」（详见 §0.4）。
- 下一步 = **阶段 3：其余 14 套协议逐个实现**（先 Light / Darkness），入口见 §5/§6。

---

## 0.1 效果引擎架构（核心设计）

所有卡牌效果 = **生成器函数**，由**效果栈运行器**驱动执行。引擎层零 DOM、纯 TS（`src/core/effects/*`）。

### 0.1.1 生成器挂起（yield ChoiceRequest / Op）

- 效果类型：`EffectGen = (ctx: EffectCtx) => Generator<EffectStep, void, StepResult>`；`EffectStep = ChoiceRequest | Op`。
- 生成器 `yield` 两种值：
  - `{ kind: 'select', title, min, max, optional, candidates }`（**选择请求**）→ 运行器挂起，等玩家应答；
  - `{ op: 'discard' | 'delete' | 'return' | 'flip' | 'draw' | 'shift', ... }`（**效果操作**）→ 运行器立即执行。
- `ctx` 携带 `s`（状态引用）、`player`（效果归属者/选择权）、`card`（源卡）、`candidates(filter)`（候选查询）。
- 生成器内部以 `yield` 的返回值（`StepResult` = 选择答案或空对象）继续推进：`yield { kind:'select' }` 返回 `{ selected: string[] }`。

### 0.1.2 效果栈 LIFO（pendingEffects）

- `s.pendingEffects: PendingEffect[]`，每个元素 = 一个挂起的生成器（`id/player/gen/sourceUid/sourceDefId/prompt/lastAnswer`）。
- **后进先出**：连锁产生的新效果 `push` 到栈顶，先结算栈顶（与规则书"中命令进厂即结算、LIFO 打断"一致）。
- 入口：`pushMiddle`（只入栈）/ `resolveMiddle`（入栈 + `runStack`）；触发效果 `resolveTrigger` 也只入栈，由调用方跑 `runStack`。
- 主循环 `runStack`：栈非空 → 校验源卡 → `gen.next(lastAnswer ?? {})` → done 则出栈；yield 选择 → 挂起返回；yield Op → `executeOp` 执行后继续。栈空后依次消费 `pendingPlay`（落牌）→ `pendingShift`（偏转落地）→ `pendingStepAdvance`（推进回合步骤）。

### 0.1.3 挂起 / 恢复（answerEffect + executeAction('effect-choice')）

- 挂起时栈顶 `pe.prompt` 非空。UI 渲染选择栏（候选高亮/确认/可选跳过），玩家确认 → `onAction({ kind:'effect-choice', promptId, choice })` → `executeAction('effect-choice')`。
- 校验：`top.player === player`（**选择权归属者可 ≠ turnPlayer**，规则"由被作用卡持有者决定执行"）、promptId 匹配、选择数在 `[min,max]` 内、每个 uid 都在候选里。
- `answerEffect` 存 `lastAnswer`、清 `prompt`、再跑 `runStack` → 生成器以 `ans.selected` 恢复。
- **可选选择允许空应答**（`req.optional && selected.length === 0` → 跳过，不再校验 min）。

### 0.1.4 终止规则（sourceValid）

- 结算前先校验 `sourceValid(pe)`：源卡必须**仍存在于场上、正面、未被覆盖**（`zone==='field' && faceUp && isUncovered`）。
- 不满足 → 弹出该效果，记日志「效果终止：{sourceDefId} 被覆盖/翻面/移除」。这实现规则书"效果源卡中途被覆盖/翻面/移除则剩余效果终止"。

### 0.1.5 幽灵状态防护（listCandidates）

- `listCandidates` 的候选来自**真实状态快照**：`zone:'hand'` 列指定玩家手牌；`zone:'field'` 列双方所有堆叠**顶卡**。
- **排除结算中源卡**（`resolving = pendingEffects[].sourceUid`）：正在结算的效果源卡可能处于浮空/将变更状态，不出现在候选里，避免选到"幽灵目标"。

### 0.1.6 偏转浮空（pendingShift）

- `{ op:'shift', uid, targetLine }`：源卡须在场、未被覆盖、目标线 ≠ 当前线（不同线才合法）。
- 弹出源堆叠顶卡 → 卡置 `zone:'float'`、`line = targetLine`（**提交目标，浮空期间不可变卦**）、`pos=null` → `s.pendingShift = { card, beforeCoveredDone: false }`。
- 露出卡结算：`revealAfterRemoval` 对源线新顶卡（正面）推其中指令。
- **落地时序**（`completeShift`，runStack 栈空时消费）：目标堆叠顶卡正面且有"被盖住前"触发 → **先结算一次**（`beforeCoveredDone` 一次性守卫，防连锁中重复触发）→ 结算完才把浮空卡压入目标堆叠顶（`pos=stack.length`）。落地不触发自身中指令（只有"打出"触发中指令）。

### 0.1.7 揭开触发（revealAfterRemoval，编译除外）

- 顶卡被 delete / return / shift 移走后，`revealAfterRemoval` 把新顶卡（正面）的中指令推入效果栈（LIFO 连锁）。
- **编译不经过此函数**：`executeCompile` 整线删除不触发任何卡牌文本（"编译同时删除"规则，阶段 1 已定）。

### 0.1.8 触发唯一性（免排序 UI）

- `collectTriggers(s, kind)`：收集场上**正面、未覆盖顶卡**中注册了该触发（`before-covered` / `end` / `start`；`after` 机制预留未用）的卡。
- **end/start 只收集当前回合玩家场地侧**（规则"结算你场地侧所有'结束'触发"）；`after` 等其余种类收集双方。
- 同一张卡在一局中唯一（每 defId 至多一张在场）→ **同一触发至多一条**，UI 直接出按钮、**无需排序**。
- `s.resolvedTriggerUids` 记录本 end/start 步骤已结算的触发卡（避免重复），`advanceStep` 进入新 end/start 时清空。

### 0.1.10 无合法目标（fizzle 规则，用户确认 2026-08-29）

- **引擎层**（`runStack`）：任何选择步骤（必选或可选）的 `candidates` 为空时，**不挂起**，记日志「无合法目标，该步骤跳过」并以 `{selected:[]}` 续接生成器——从结构上消除"必选选择无候选 → 永久卡死"（fire-0/1/2 空场首张、fire-5/4 手牌最后一张、fire-0 被盖住前独占场等场景）。
- **生成器契约（阶段 3 必守）**：每个含必选选择步骤的效果生成器，在使用 `ans.selected[0]` 前必须守卫 `if (ans.selected.length === 0) return;`（或等价处理）——fizzle 以空应答续接后，不守卫的生成器会抛错（响亮、可恢复），但契约要求生成器自我防御。fire-0 中指令的守卫只跳过翻转、**抽 2 张仍执行**（两句独立、非条件）；fire-1/2 第二步"如果弃了"条件性 return；fire-4 抽牌数取决于弃牌数，0 弃则整段返回。

### 0.1.9 必选 / 可选事件（optional 显式注册）

- 触发定义 `TriggerDef = { fn, optional }`，**optional 必须显式声明**（如 fire-3 end = 可选，fire-0 before-covered = 必选）。
- end/start 步骤：`getLegalActions` 把每条触发列成 `resolve-trigger` 行动；**有必选触发未清空时不提供 `advance`**（`executeAction('advance')` 也抛错阻止跳过）。
- 可选触发由玩家点按钮结算或直接下一步跳过；挂起中的可选选择由选择栏「跳过」按钮空应答。

---

## 0.2 Fire 6 卡效果清单与验证

效果注册在 `src/core/effects/cards/fire.ts`（`registerCardEffects`），文本与 `src/data/cards.ts` / 权威源 `docs/card-text-source.txt` 一致：

| 卡 | 触发时机 | 实现效果（与卡面文本一致） |
|---|---|---|
| fire-0 | **中指令**（进厂） | 翻转另 1 张牌（必选 1）→ 抽 2 张牌 |
| fire-0 | **底指令** = `before-covered`（被盖住前） | 先抽 1 张牌 → 翻转另 1 张牌（必选 1） |
| fire-1 | 中指令 | **可选**弃 1 张牌（手牌；跳过则不删除）→ 若弃了：删除 1 张牌（场上顶卡必选 1） |
| fire-2 | 中指令 | **可选**弃 1 张牌（手牌；跳过则不回手）→ 若弃了：回手 1 张牌（回持有者手牌） |
| fire-3 | **底指令** = `end` 触发（可选） | 可弃 1 张牌；弃了则翻转 1 张牌 |
| fire-4 | 中指令 | 弃 1 张或更多张牌（min 1 / max 手牌数）→ 抽「弃牌数 + 1」张 |
| fire-5 | 中指令 | 弃 1 张牌 |

**验证**：`tests/effects/fire.test.ts` 9 用例逐卡覆盖（fire-0 中/底两条链路、fire-1 弃后删除 + **可选跳过**、fire-2 回持有者手牌、fire-3 可选跳过与弃后翻转、fire-4 多弃多抽、fire-5 必弃）；`tests/cache.test.ts` 覆盖**检查缓存玩家自选弃牌**（手牌 > 5 时出 `clear-cache` 行动 → 系统效果挂起选择 min=max=超出数 → 弃至 5 张自动推进到 end）；`tests/game-effect.test.ts` / `tests/actions/play-effect.test.ts` 覆盖「打出火卡 → 挂起选择 → 结算 → 自动推进」门面链路；`tests/effects/runner.test.ts` 覆盖栈核心（挂起/恢复/终止/连锁/落牌）。

---

## 0.3 新增模块与 GameState 字段

### 0.3.1 新增模块

```
src/core/effects/
├── registry.ts        # EFFECTS 注册表（defId → {middle?, triggers?}）+ registerCardEffects
├── context.ts         # findCard（全状态含浮空卡）/ isUncovered / listCandidates（幽灵防护）
│                      # createCtx / emitCardEvent（语义事件，payload 含 protocol）/ nextEffectId
├── resolve.ts         # 运行器核心：pushMiddle / resolveMiddle / answerEffect / runStack
│                      # executeOp（6 操作）/ completePlay（落牌）/ completeShift（偏转落地）/ revealAfterRemoval
├── triggers.ts        # collectTriggerFor / resolveTrigger / collectTriggers（end/start 收集）
└── cards/fire.ts      # Fire 6 卡效果注册（import 副作用注册；resolve.ts 顶部 import './cards/fire'）

src/ui/effects/index.ts        # initEffects()：订阅 gameBus，fire 的 discard/delete 播火焰焚烧动画
tests/helpers.ts               # resolveAllChoices（循环应答含连锁新选择）/ pickFirst / draftFireP1 / advanceToStep / makeCard
tests/effects/…                # bus(1)/state(1)/runner(6)/flip(2)/delete(3)/shift(2)/triggers(4)/fire(8)
```

### 0.3.2 GameState 新增字段（`src/core/models/types.ts`）

- `pendingEffects: PendingEffect[]` — 效果栈（长度 0 = 无挂起；>0 时栈顶为待应答选择）
- `pendingPlay: Card | null` — 打出中的卡（浮空，等"被盖住前"结算后落地）
- `pendingShift: { card: Card; beforeCoveredDone: boolean } | null` — 偏转中的卡（浮空，等露出卡结算后落地）
- `resolvedTriggerUids: string[]` — 本 end/start 已结算的触发卡 uid（进入新 end/start 时清空）
- `pendingStepAdvance: boolean` — 打出链式结算完毕后需推进回合步骤（runStack 栈空时消费）
- `Zone` 增加 `'float'`（浮空态：pendingPlay / pendingShift 中的卡）
- 新类型：`Op`（6 效果操作）、`EffectStep`、`StepResult`、`ChoiceRequest` / `ChoiceAnswer` / `ChoiceCard`、`PendingEffect`、`TriggerKind` / `TriggerDef` / `TriggerEntry`、`CandidateFilter` / `EffectCtx` / `EffectGen`、`CardEffects`

> **命名原因**：效果步骤本应叫 `Step`，但 `types.ts` 已占用 `Step`（回合 6 步），故命名 **`EffectStep`**（提交 `f33b481` 计划修正）。

### 0.3.3 接入点（门面与主流程）

- `src/core/game.ts`：`ActionKind` 增加 `effect-choice` / `resolve-trigger`；`executeAction` 窄化重载（play 需 `PlayArgs`、compile 需 `{line}`、effect-choice 需 `{promptId, choice}`、resolve-trigger 需 `{cardUid}`）；**结算挂起/落牌中 `getLegalActions` 返回 []**（无标准行动）；`resolve-trigger` 在 end/start 列出触发按钮、必选未清空禁 advance。
- `src/core/actions/base.ts`：`playCard` 改为**先浮空（pendingPlay）** → 目标顶卡"被盖住前"触发先结算 → 栈空后 `completePlay` 落地 + 正面卡推中指令；`executeAction('play')` 结算完毕后若无挂起则直接 `advanceStep`，否则置 `pendingStepAdvance` 交给 runStack。
- `src/core/events/bus.ts`：导出 `gameBus` 单例（`emit` 事件带 `state` 引用），特效层订阅。
- `src/main.ts`：`initEffects()` 启动特效订阅；`runAutoAdvance` 暂停策略（§0.4）；`onAction` 分发 `effect-choice`（chooser 取 `top.player ?? turnPlayer`，可为对手）。

---

## 0.4 自动推进暂停策略（用户确认：「有决策点就停、全部清空才走，没有事件就自动过」）

`src/main.ts` `runAutoAdvance()`（400ms 单定时器，`scheduleAutoAdvance` 防重入）：

| 情况 | 行为 |
|---|---|
| `phase === 'draft'` / `'gameover'` / 有胜者 | 停止（不自动推进） |
| `step === 'action'` | 停止（轮到玩家行动） |
| `pendingEffects.length > 0` | **暂停**：有挂起选择，等对应玩家应答（chooser 可能是对手） |
| `pendingPlay / pendingShift` 非空 | **暂停**：落牌/偏转进行中（栈结算中） |
| `step === 'end' / 'start'` 且有待结算触发 | **暂停**：显示触发按钮等玩家点击（fire-3 end 可选 → 出按钮，可选跳过） |
| `step === 'check-compile'` 且有可编译线 | **暂停**：编译必须玩家点按钮执行，不自动编译 |
| 其余（start/check-control/check-cache/end 无事件） | 自动 `advance` |

「全部清空才走」：打出一张卡后若连锁产生挂起，必须把所有选择应答完、效果栈清空、落牌完成，`runStack` 才消费 `pendingStepAdvance` 推进回合步骤（测试断言如 `s.step === 'check-cache'` 验证）。

---

## 0.5 下一阶段：其余 14 套协议逐个实现

1. **先 Light / Darkness**（demo 池已有真实文本，最贴近现有机制）：
   - Light：light-0 抽「其分值」张（数值读取）、light-1 end 抽 1、light-2 **揭示** + 平移或翻转（需 `reveal` 效果动作与揭示 UI）、light-5 弃 1；
   - Darkness：darkness-0 抽 3 + 平移对手被盖住牌（**shift 的 UI 目标选择**：选目标线）、darkness-1 翻转对手牌 + 可平移、darkness-2 **顶命令**（本栈反面牌分值 4）+ 可翻转本列反面牌（**数值修正引擎**）。
2. **顶命令 / 限制 / 数值修正引擎**：top 常驻指令（被覆盖也生效）是后续多套（metal-0 减分、psychic-1 只能反面打、plague-0 禁此列打、apathy-2 无效化中部、metal-6 被盖住前删除、spirit-1 任意列打等）的地基——需在 `stackValue` / `getLegalActions` / 覆盖判定处接入。
3. **偏转 UI**：shift 引擎层已完成（§0.1.6），UI 需「选卡 → 高亮合法目标线 → 确认」交互（可复用选择栏模式）。
4. **协议重排 UI**（控制权规则配套）：water-2 / psychic-2 的「重排你的/对手的协议」。
5. **打包**：Electron / Tauri 安装包。
6. 每套协议仍走 TDD：先写 `tests/effects/<protocol>.test.ts` 再实现 `src/core/effects/cards/<protocol>.ts`。

---

## 0.6 环境注意（沙箱红线，违反即测试失败/补丁丢失）

- `vite.config.ts` 固定 `pool: 'threads'`（沙箱禁止子进程派生），**勿改**。
- `node_modules` 里的 **vite 本地补丁**（`optimizeSafeRealPathSync` 跳过 `net use` 探测）在 `npm ci` / `npm install` 后会丢失 → 需重打，否则测试/构建报 EPERM。
- **不要跑 `npm install` / `npm ci`**；如必须安装依赖，加 `--cache node_modules/.npm-cache`（沙箱外默认缓存目录不可写）。
- 测试 `npm test`（= `npx vitest run`）预期 85/85；构建 `npm run build`（`tsc --noEmit && vite build`）。
- **不要 `git push`**：合并与推送由控制器在整分支终审后统一执行。

---

## 0.7 本阶段关键设计修复（供后续阶段避免重蹈）

按提交顺序记录实现过程中的设计修正（含计划文档修订），新协议实现前务必先读对应计划修正：

1. **completePlay 钩子移除**（`b3b91fe` 计划修正）：原设计 runStack 栈空时调 `completePlay` 钩子落牌；实做简化为 `playCard` **先入栈"被盖住前"触发、runStack 栈空后直接落牌**——不设独立钩子，避免钩子时序与生成器恢复纠缠。
2. **completeShift 一次性守卫**（`b3b91fe`）：`beforeCoveredDone` 保证目标顶卡"被盖住前"**只结算一次**（连锁可能改变栈顶）；落牌时机 =「被盖住前 → 结算完 → 落地」。
3. **`'kind' in step` 窄化**（`241ad7e` + `f33b481`）：`EffectStep = ChoiceRequest | Op` 用 `'kind' in step` 判别（选择请求有 `kind`、Op 只有 `op`）；`executeAction` 的 args 同理用 `'line' in args` / `'cardUid' in args && 'faceUp' in args` 收窄重载——**勿用 `'cardUid' in args` 单独判别 play**（会误收 resolve-trigger 的 `{cardUid}`）。
4. **`EffectStep` 命名**（`f33b481`）：types.ts 已占用 `Step`（回合步骤），效果步骤命名 `EffectStep` 避免冲突。
5. **`emit state:s`**（`241ad7e`）：`gameBus.emit` 事件**携带状态引用**（特效层可读完整状态）；测试 fixture 同步适配（牌库种子、事件断言）。
6. **PendingEffect.player 即选择权归属者**（`c456452` 起）：效果的选择权可能属于对手（非 turnPlayer）；`executeAction('effect-choice')` 校验 `top.player === player` 且放行非 turnPlayer；UI 归属者标签用 `topEffect.player`（非 prompt 自身、非 turnPlayer）。
7. **getLegalActions 结算中返回 []**（`e24222a`）：`pendingEffects/pendingPlay/pendingShift` 非空时无标准行动，避免状态冲突。
8. **fire-5 中指令破坏旧 play-effect 断言**（`814d8d2` 计划修正 + `4d9aeaa`）：注册 fire-5 后"打出正面火卡"必有挂起选择，旧断言"打出即 check-cache"失效 → 测试改 `resolveAllChoices` 后断言；同时恢复 playCard 的日志（`P{n+1} plays …`）写入时序。
9. **测试种子复用**（`tests/helpers.ts`）：`resolveAllChoices` 循环应答连锁新产生的选择（answerEffect 内部 runStack 可能再 push）；`makeCard` 造场上/手牌 fixture 时注意 `sourceValid` 终止规则（源卡被删/被盖会让剩余效果静默终止，断言前想清楚栈内容）。

---

## 1. 已完成功能清单

### 1.1 引擎层（`src/core`，纯 TS，零 DOM）

| 功能 | 位置 | 说明 |
|---|---|---|
| 效果类型 | `core/models/types.ts` | `Op`（discard/delete/return/flip/draw/shift）、`EffectStep`/`StepResult`、`ChoiceRequest`/`ChoiceAnswer`/`ChoiceCard`、`PendingEffect`、`TriggerKind`/`TriggerDef`/`TriggerEntry`、`CandidateFilter`/`EffectCtx`/`EffectGen`/`CardEffects`；`Zone` + `'float'` |
| 事件总线单例 | `core/events/bus.ts` | `gameBus`（`subscribe`/`emit`，事件带 `state`）；`emitCardEvent` 发语义事件（`card:discarded/deleted/flipped/returned/shifted/played/landed`，payload 含 protocol） |
| 效果栈运行器 | `core/effects/resolve.ts` | `runStack`（LIFO 结算 + 落牌 + 偏转落地 + 步骤推进）、`pushMiddle`/`resolveMiddle`、`answerEffect`（挂起/恢复、可选空应答）、`executeOp`（6 操作，含翻正连锁/揭开连锁）、`completePlay`/`completeShift`/`revealAfterRemoval`、`sourceValid` 终止规则 |
| 触发系统 | `core/effects/triggers.ts` | `collectTriggerFor`（单卡查）、`resolveTrigger`（入栈）、`collectTriggers`（end/start 收集，跳过已结算 uid） |
| 上下文/候选 | `core/effects/context.ts` | `findCard`（含浮空卡）、`isUncovered`、`listCandidates`（**排除结算中源卡**）、`createCtx`、`emitCardEvent`、`nextEffectId` |
| Fire 效果 | `core/effects/cards/fire.ts` | fire-0 中/底、fire-1/2/4/5 中、fire-3 底可选 end（§0.2） |
| 打出流程改造 | `core/actions/base.ts` | `playCard`：浮空 → 被盖住前触发先结算 → 落地 → 中指令连锁 |
| 门面 | `core/game.ts` | `effect-choice`/`resolve-trigger` 动作 + 窄化重载 + 挂起守卫；end/start 触发按钮；必选触发禁 advance |
| 回合步骤 | `core/engine/turn.ts` | 进入新 end/start 时清空 `resolvedTriggerUids` |

### 1.2 UI 层（`src/ui` + `src/main.ts`）

- **选择模式**（`render.ts`）：挂起选择时候选卡高亮（`.choice-target`/`.choice-selected`/`.choice-dim`，可多选至 `max`）、顶部选择栏显示归属者 + 标题 + 已选计数、「确认」按钮（数量合法才可点）、可选事件额外「跳过」按钮；`.hand-strip.choice-mode` 禁用非候选卡 hover/单击/拖拽（选择模式下禁拖拽打牌）。
- **触发按钮**（`render.ts` + `main.ts`）：end/start 步骤列出 `collectTriggers` 的触发按钮（如 fire-3「结束：你可以弃1张牌…」），点击执行 `resolve-trigger`。
- **火焰焚烧特效**（`ui/effects/index.ts` + `index.html` 引入 `fire-burn.css`）：fire 协议的 `card:discarded` / `card:deleted` → 克隆目标卡到 body 固定浮层（原卡位置/尺寸）+ `fire-burn-overlay`（flame + sparks），1.2s 后移除；重渲染销毁原卡 DOM 不影响浮层。
- **自动推进**：§0.4 暂停策略。

### 1.3 测试（85/85，21 个文件）

- **既有 53 例适配**：`actions/base`(6)、`rules/control`(10)、`game`(6)、`data/cards`(6)、`rules/compile`(7)、`state/create`(5)、`engine/deck`(4)、`engine/turn`(3)、`models/types`(3)、`events/bus`(2)、`smoke`(1)。
- **效果新测试 32 例**：`effects/fire`(8)、`effects/runner`(6)、`effects/triggers`(4)、`effects/delete`(3)、`effects/flip`(2)、`effects/shift`(2)、`effects/bus`(1)、`effects/state`(1)、`actions/play-effect`(2)、`game-effect`(3)。
- 工具：`tests/helpers.ts`（`resolveAllChoices`/`pickFirst`/`draftFireP1`/`advanceToStep`/`makeCard`）。

---

## 2. 项目结构更新（相对阶段 1）

```
src/
├── core/
│   ├── effects/                    # ★ 新增：效果引擎
│   │   ├── registry.ts / context.ts / resolve.ts / triggers.ts
│   │   └── cards/fire.ts           # Fire 6 卡效果注册
│   ├── models/types.ts             # + 效果类型 / Zone 'float' / GameState 5 字段
│   ├── events/bus.ts               # + gameBus 单例
│   ├── actions/base.ts             # playCard 浮空-落地流程改造
│   └── game.ts                     # + effect-choice / resolve-trigger
├── ui/
│   ├── effects/index.ts            # ★ 新增：火焰焚烧特效订阅
│   └── render.ts                   # + 选择模式 / 触发按钮
├── main.ts                         # + initEffects / 暂停策略 / effect-choice 分发
tests/
├── helpers.ts                      # ★ 新增：效果测试工具
└── effects/                        # ★ 新增：8 个效果测试文件
docs/
├── stage2-effects-fire.md          # 本文件（阶段 2 交接）
└── superpowers/plans/2026-08-29-effect-engine-fire.md   # 阶段 2 实施计划（含修正记录）
index.html                          # + fire-burn.css 引入
public/assets/fire/                 # Gemini 火焰素材（fire-burn.css/js/README，阶段 1 已就绪）
```

---

## 3. 如何运行

```bash
npm run test     # = npx vitest run，预期 85/85 通过
npm run build    # = tsc --noEmit && vite build → dist/
npm run dev      # 开发服务器 http://localhost:5173/
npm run preview  # 预览构建产物
```

> ⚠️ 环境红线见 §0.6：勿改 `vite.config.ts` 的 `pool:'threads'`、勿跑 `npm install`/`npm ci`（vite 补丁会丢）。

---

## 4. 已知限制（阶段 2 范围外）

1. **仅 Fire 6 卡有效果**：其余 14 套卡的效果文本仍是"只展示不结算"（`EFFECTS` 注册表只有 fire-*）；顶命令/限制/数值修正引擎未实现。
2. **shift 无 UI**：引擎层 `shift` 操作已实现并有测试，UI 尚无"选目标线"交互（Light/Darkness 阶段补）。
3. **无 `reveal` 效果操作**：light-2 等"揭示"类效果留待阶段 3。
4. **无 AI 对手**：纯热座双人。
5. **协议重排 UI 未实现**（water-2/psychic-2，控制权规则配套）。
6. **特效仅 fire**：火焰焚烧动画只订阅 fire 协议的 discard/delete；其余协议特效后续按命名空间挂载（`fire:discard` 模式可复用）。
7. **`after` 触发机制预留未用**（`TriggerKind` 含 `'after'`），plague-1/hate-3/speed-1 等"XX后"效果待阶段 3 接。
8. **UI 无单元测试**：UI 仍只经 `tsc --noEmit` 类型检查（build 门控）。
9. **背面覆盖语义**：`stackValue` 仍按阶段 1 规则（背面=2）；darkness-2「反面分值 4」等数值修正未接入。

---

## 5. 阶段 3 入口：Light / Darkness 试点

### 5.1 现状澄清

- Light / Darkness 真实中文文本已在 `src/data/cards.ts`（light-0..5、darkness-0..5），demo 草案池也含这两套（`data/demo.ts` DEMO_PROTOCOLS 前 6 套）。
- 效果引擎已具备：discard/delete/return/flip/draw/shift 六操作 + 中指令连锁 + before-covered/end/start 触发 + 挂起选择 + 浮空落地。**Light/Darkness 大多数中指令可直写生成器**（如 light-2 揭示需新增 `reveal` 操作与 UI）。

### 5.2 建议首个小步（TDD）

1. 读阶段 2 计划修正记录（§0.7）与本文件 §0.1 架构约定；
2. 新增 `reveal` 效果操作（`Op` 扩展 + `executeOp` + 测试），然后写 `tests/effects/light.test.ts` 实现 light-1（end 抽1）、light-0（抽分值）、light-2（揭示+平移或翻转）；
3. 顶命令引擎：`CardDef.top` 已存在文本（darkness-2「本栈反面牌分值4」），在 `stackValue` 处接入数值修正 + 测试。

---

## 6. 零上下文 agent 续作清单

### 6.1 下一步做什么

实现**阶段 3：Light / Darkness 协议效果**（§5.2）。每套协议 TDD：先 `tests/effects/<protocol>.test.ts`，再 `src/core/effects/cards/<protocol>.ts` 注册。

### 6.2 必读文件（按顺序）

1. `docs/superpowers/specs/2026-08-28-compile-web-design.md` — 设计文档（效果结算/交互/特效约束）
2. `docs/superpowers/plans/2026-08-29-effect-engine-fire.md` — 阶段 2 实施计划（含每步修正记录，是最新设计意图）
3. `docs/stage2-effects-fire.md` — 本文件（§0.1 架构、§0.7 修复记录必读）
4. `docs/stage1-framework.md` — 阶段 1 交接（基础框架/环境红线）
5. `src/core/effects/resolve.ts` + `src/core/effects/context.ts` + `src/core/effects/triggers.ts` — 引擎核心
6. `src/core/effects/cards/fire.ts` — 效果写法范例（生成器 + candidates + yield）
7. `tests/helpers.ts` + `tests/effects/fire.test.ts` — 测试工具与断言范例

### 6.3 环境红线

- **不要**跑 `npm ci` / `npm install`（vite 补丁丢失）；必须装时 `--cache node_modules/.npm-cache`
- **不要**改 `vite.config.ts` 的 `pool: 'threads'`
- 测试 `npm test` 预期 91/91（实现新协议后增长）；构建 `npm run build`
- **诊断日志**：`src/ui/diag.ts`（initDiag 钩住 console 全量记录 + 捕获未捕获异常/拒绝；顶部「导出日志」按钮 / 出错自动提示可下载 `compile-log-*.txt`，含错误+控制台+事件日志+状态快照）——运行时报错导出给开发者分析
- **不要** `git push`（控制器统一合并推送）

### 6.4 约定

- 代码注释与文档用中文；卡牌文本为中文（游戏 UI 语言）
- 新效果动作走 TDD：先写 `tests/` 用例再实现
- 提交信息风格：`feat: …` / `fix: …` / `docs: …`
- 每个阶段完成后更新本文件与全局记忆 `E:\studyE\Deepseek memory\compile-web-project.md`（工作区外，由控制器更新）
