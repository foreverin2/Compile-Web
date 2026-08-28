# 阶段 2 设计文档：效果引擎 + Fire（火）协议试点

- 日期：2026-08-29
- 状态：已获用户批准（2026-08-29）
- 范围：通用卡牌命令结算引擎（含连锁触发）+ Fire 6 张卡真实效果结算 + 特效注册表接入
- 前置：阶段 1 完成（53 测试绿，HEAD=`b404d11`），交接文档 `docs/stage1-framework.md`

## 1. 目标

1. 建立**通用效果引擎**：卡牌中指令（即时效果）、底指令（触发类被动）的解析与结算，支持 LIFO 连锁、玩家选择挂起/恢复、"效果终止"规则、被揭开触发、偏转（转移）浮空流程
2. **Fire 协议试点**：6 张卡全部真实效果可玩、可测
3. **特效注册表**：引擎只发语义事件（`card:discarded`/`card:deleted` 等），UI 侧订阅并按协议命名空间挂特效（`fire:discard`/`fire:delete` → Gemini 火焰素材已就绪 `public/assets/fire/`）

## 2. 核心设计决策（已与用户确认）

### 2.1 效果实现方式：生成器挂起（Generator Suspension）
每张卡的效果写成生成器函数；需要玩家选择时 `yield` 一个**选择请求（ChoiceRequest）**，引擎保存挂起点并暂停；玩家在 UI 选择后通过 `executeAction('effect-choice', {promptId, choice})` 恢复执行。

- 卡牌文本顺序 = 代码顺序，逻辑直观
- 天然支持嵌套连锁（LIFO 效果栈）
- 备选已否决：声明式 DSL（90 张卡文本个性化、中文解析脆弱）、步骤状态机（样板多、连锁难写）

### 2.2 触发唯一性：不需要"玩家选序 UI"
每套 6 张卡在牌组中**各只有一张**（18 张 = 3 协议 × 6 唯一卡），同一事件只有 0 或 1 张卡响应（"你抽牌后"仅 spirit-3、"对手弃牌后"仅 plague-1、"你的牌被删除后"仅 hate-3……触发条件全局唯一）。规则书"多个效果同时触发由当前回合玩家决定顺序"在唯一卡牌下为**空操作**——引擎收集触发逐个结算即可，不做排序 UI。

### 2.3 幽灵状态防护：结算中卡不可被连锁效果选中
**规则**：卡 A 的效果尚未执行完毕时（A 的效果仍在效果栈上），A **不能被连锁效果的目标选择选中**。
- 引擎实现：`ctx.isResolving(uid)` 集合（效果栈上所有源卡）；目标选择候选过滤掉它们
- 例：fire-0 中指令"翻转另1张牌"翻正反面 fire 卡（卡 B）→ B 中指令入栈挂起等选目标 → 候选排除 fire-0（也排除 B 自身）
- "效果终止"检查（源卡被盖/翻面/移除 → 剩余效果立即终止）仍保留作兜底：应对编译清线等非目标性移除

### 2.4 偏转（转移/Shift）浮空流程
转移 = 将卡牌移动到同一名玩家场地的另一条线路。引擎级规范流程：

```
1. 玩家选择要转移的牌 → 先提交目标链路（写入行动参数，落地前不可更改）
2. 拿起牌 → 进入「浮空」状态（zone: 'float'）
   · 不在任何堆叠中：不参与双方数值计算、不可被任何效果选中
   · 正反面状态保留，不触发自身任何效果
3. 结算【源链路露出卡牌的中指令】（被揭开 → 即时效果，走效果栈，可连锁/挂起）
   · 浮空卡自然不在候选目标里（幽灵状态防护）
4. 落地到已提交的目标链路堆叠顶部
   · 若目标堆叠有顶卡：先结算其「被盖住前」底命令（与打出覆盖一致），再放置
```

限制：目标链路 ≠ 源链路；正面卡转移不限协议匹配（协议匹配只约束正面**打出**）。

### 2.5 揭开触发通用化
任何"顶卡被移除"（删除/回手/偏转）→ 露出卡**被揭开** → 其中指令立即结算；**编译除外**（规则明文"不触发任何文本"）。

## 3. 架构与模块

```
src/core/effects/
  types.ts        EffectCtx / ChoiceRequest / PendingEffect / TriggerSpec / 效果栈类型
  resolve.ts      效果栈运行器：LIFO 连锁、挂起/恢复、终止检查、isResolving 集合
  context.ts      操作集：弃牌/删除/回手/翻转/抽牌/偏转（浮空流程）；发语义事件
  triggers.ts     触发收集：被盖住前 / 结束 / 开始 / XX后（连锁）；唯一性下单触发逐个结算
  registry.ts     defId → 效果生成器注册表
  cards/fire.ts   Fire 6 张效果定义
```

### 3.1 类型设计（GameState 变更）

```ts
// Zone 增加 'float'：偏转浮空中的卡（不在任何堆叠，不可被选中，不计数值）
export type Zone = 'hand' | 'deck' | 'field' | 'trash' | 'float';

// GameState 新增
pendingEffects: PendingEffect[];  // 效果栈：长度 0 = 无挂起；>0 时顶部为待应答选择

// 效果栈元素
interface PendingEffect {
  id: string;               // 选择请求 id（executeAction('effect-choice') 用）
  player: PlayerId;         // 谁必须选择（当前行动者）
  gen: Iterator<ChoiceRequest, void, ChoiceAnswer>;  // 挂起的生成器
  prompt: ChoiceRequest;    // 当前待应答的选择请求（含候选列表，供 UI 渲染）
  source: { uid: string; defId: string };  // 效果源卡（终止检查 + isResolving 排除用）
}

interface ChoiceRequest {
  kind: 'select-cards';     // 候选卡列表多选/单选
  title: string;            // UI 提示文案（例："选择要弃置的卡牌"）
  min: number;              // 最少选择数（fire-4: 1）
  max: number;              // 最多选择数（fire-4: 无上限 = 候选数）
  optional: boolean;        // 是否可跳过（fire-3 的"你可以弃1张牌"）
  candidates: ChoiceCard[]; // 渲染候选（含正反面/位置/所属）
}

interface ChoiceCard {
  uid: string; defId: string; faceUp: boolean;
  owner: PlayerId; zone: Zone; line: Line | null; pos: number | null;
  label: string;  // 渲染文本（分值等）
}

type ChoiceAnswer = { selected: string[] };  // 选中的 uid 列表；optional 跳过时 selected = []
```

### 3.2 效果上下文（EffectCtx）

```ts
interface EffectCtx {
  s: GameState;
  player: PlayerId;       // 效果的所有者（打出/触发的玩家）
  card: Card;             // 效果源卡（运行时实例）
  // 操作（全部发语义事件到 bus）
  discard(uid): void;             // 手牌 → 持有者弃牌堆（正面朝上）
  deleteCard(uid): void;          // 场上 → 持有者弃牌堆（正面朝上；触发露出卡揭开）
  returnToHand(uid): void;        // 场上 → 持有者手牌（触发露出卡揭开）
  flip(uid): void;                // 翻面；翻正时若目标有中指令 → 入栈连锁结算
  draw(count): Card[];            // 抽牌（含弃牌堆重组）
  shift(uid, targetLine): void;   // 偏转浮空流程（2.4）
  // 选择助手（yield 的封装）
  askSelect(req: Omit<ChoiceRequest,'candidates'>): ChoiceAnswer;
  // 工具
  isResolving(uid): boolean;      // uid 是否在效果栈上（幽灵状态排除）
  isUncoveredTarget(uid): boolean;// 是否可作为目标（未被覆盖 + 场上 + 非结算中 + 非浮空）
}
```

- 语义事件（bus emit）：`card:discarded`、`card:deleted`、`card:returned`、`card:flipped`、`card:drawn`、`card:shifted`、`card:revealed`（payload 含 uid/defId/protocol/owner/line/pos）；UI 特效注册表订阅后按协议命名空间挂载（Fire → `fire-burn`）

### 3.3 效果栈运行器（resolve.ts）

```
resolveMiddle(s, player, card):  // 打出/翻正/揭开时调用
  把 card 的效果生成器 push 到 pendingEffects，然后 runStack()

runStack(s):
  while pendingEffects 非空:
    top = pendingEffects[last]
    r = top.gen.next(上一次的 ChoiceAnswer)   // 首次 next() 无参数
    if r.done: pendingEffects.pop(); continue
    // r.value 是 ChoiceRequest → 解析候选列表存入 top.prompt，暂停等待玩家
    break

executeAction('effect-choice', {promptId, choice}):
  校验 promptId 与顶部 PendingEffect 匹配、choice 数量在 [min,max] 内
  记录答案 → 重新 runStack()

终止检查（每步后）：
  top.source 的卡不再满足 { zone==='field', faceUp, 仍是其堆叠顶卡（未被覆盖）? }
  则不满足 → 丢弃该 PendingEffect（其剩余效果终止）
  注：中指令"被打断终止"仅对挂起中的效果栈元素生效；逐条按规则"正在生效的效果，
  如果卡牌被覆盖、翻面、移除，该效果立刻终止"
```

LIFO 连锁：结算中的操作（如 `flip` 翻正另一张有中指令的卡、`shift` 露出卡揭开）会 `resolveMiddle` **push 新生成器**，`runStack` 循环继续 → 新效果先结算完（或挂起）后，旧效果才继续。

### 3.4 触发收集（triggers.ts）

```ts
type TriggerKind = 'before-covered' | 'end' | 'start' | 'after' ;
// after = 顶命令"XX后：…"（例：spirit-3 你抽牌后、plague-1 对手弃牌后、hate-3 你的牌被删除后）

collectTriggers(s, kind, event?): Trigger[]  // 遍历双方场上正面朝上的未覆盖卡，匹配底/顶命令文本
resolveTrigger(s, trigger): void             // 把该触发对应的生成器入栈 runStack
```

结算方式区分（重要）：
- **自动入栈（即时/必发）**：中指令（打出/翻正/揭开）、`before-covered`（fire-0 底命令无"可以"，覆盖前必发）
- **点击结算（可选）**：`end`/`start` 步骤触发（fire-3"你可以弃1张牌"）——`main.ts` 暂停自动推进，UI 出按钮，玩家点 `resolve-trigger` 结算或 `advance` 跳过剩余

- `before-covered`：打出/偏转落地覆盖前，被盖顶卡（正面+未覆盖+有该底命令）触发
- `end`：进入 `end` 步骤时，当前回合玩家场上正面未覆盖且有"结束"底命令的卡触发（fire-3）；UI 在 end 步骤暂停自动推进，逐张提供[执行/跳过]（fire-3"你可以"）
- `start`：进入 `start` 步骤时，当前回合玩家场上正面未覆盖且有"开始"顶/底命令的卡触发（Fire 暂无，机制预留）
- `after`：语义事件发生后的连锁（Fire 试点内无 Fire 卡使用，机制 + 测试预留）

### 3.5 接入点（现有代码改动）

| 文件 | 改动 |
|---|---|
| `src/core/actions/base.ts` | `playCard`：先结算被盖顶卡"被盖住前"（自动入栈）→ 落牌 → 正面则 `resolveMiddle`（自动入栈） |
| `src/core/engine/turn.ts` | **只检测不结算**：进入 `end` 时检测待结算"结束"触发、进入 `start` 时检测"开始"触发（供 `getLegalActions`/UI 使用），自动推进由 `main.ts` 暂停 |
| `src/core/game.ts` | 新增行动 `'effect-choice'`（应答挂起选择）与 `'resolve-trigger'`（玩家点按钮结算 end/start 触发，参数 `{cardUid}`）；`getLegalActions`：`pendingEffects` 非空时不提供其他行动；`end` 步骤有待结算触发时提供各触发的 `resolve-trigger` + `advance`（跳过剩余） |
| `src/core/state/create.ts` | `createGame` 初始化 `pendingEffects: []` |
| `src/main.ts` | 自动推进暂停策略（见 §5.4）：`pendingEffects` 非空 / end·start 步骤有待结算触发 → 暂停并提示对应玩家；全部结算完毕才继续；该层无待结算事件则自动结算该层 |
| `src/ui/render.ts` | 选择 UI：候选卡青色呼吸高亮 + 底部确认条；end 步骤触发结算按钮组 |
| `src/ui/effects/`（新） | 订阅语义事件 → Fire 卡挂 `fire-burn` 火焰动画（Gemini 素材 `public/assets/fire/`） |

### 3.6 偏转浮空（context.shift）

```
shift(uid, targetLine):
  校验 targetLine !== card.line
  from = card.line; 从源堆叠移除（记录位置）
  card.zone='float'; card.line=targetLine; card.pos=null
  发 card:shifted 事件（float）
  若源堆叠仍有卡 → 露出新顶卡 → resolveMiddle(露出卡)（被揭开）
  落地：若目标堆叠非空且顶卡有"被盖住前" → resolveTrigger(before-covered)（先结算）
  放置：card.zone='field'; card.pos=stacks[targetLine].length; stacks[targetLine].push(card)
```

> 注意：`shift` 不是玩家默认操作，只由卡牌效果文本授予（Light/Darkness 等）。本轮实现引擎 + 合成 def 单测；UI 入口随首个含转移的协议实现。

## 4. Fire 6 张卡效果矩阵（试点验证）

| 卡 | 文本 | 效果实现 | 验证点 |
|---|---|---|---|
| fire-0 中 | 翻转另1张牌。抽2张牌。 | askSelect(场上未覆盖卡，排除自身/结算中) → flip → draw 2 | 目标排除；翻正连锁 |
| fire-0 底 | 被盖住前：先抽1张牌并翻转另1张牌。 | before-covered 触发：draw 1 → askSelect → flip | 覆盖触发时序 |
| fire-1 中 | 弃1张牌。如果弃了，删除1张牌。 | askSelect(自己手牌) → discard → 若弃了：askSelect(场上未覆盖卡) → deleteCard | 条件式第二步 |
| fire-2 中 | 弃1张牌。如果弃了，回手1张牌。 | 同上，第二步 returnToHand（进持有者手牌） | 回手归属 |
| fire-3 底 | 结束：你可以弃1张牌。如果弃了，翻转1张牌。 | end 触发：optional discard（可跳过）→ 若弃了：askSelect → flip | 结束触发 + 跳过 |
| fire-4 中 | 弃1张或更多张牌。抽弃牌数+1张牌。 | askSelect(自己手牌, min1, max=全部) → discard 全部 → draw n+1 | 多选 |
| fire-5 中 | 弃1张牌。 | askSelect(自己手牌) → discard | 基础 |

> 目标选择范围（规则）：默认场上**任意一侧**未覆盖的卡；弃牌目标：自己手牌。规则"被作用卡持有者决定执行"在 Fire 内不产生冲突（所有选择都是行动者自己的牌），引擎预留接口。

## 5. UI 设计

### 5.1 选择交互
- `pendingEffects` 非空 → 渲染选择模式：候选卡加青色呼吸高亮框，可点击（单选点选即高亮；多选切换）
- 底部确认条：标题（"选择要弃置的卡牌"）+ "已选 n/m" + [确认]（选择数在 [min,max] 内才亮）+ [跳过]（仅 optional）
- 确认后 `executeAction('effect-choice', {promptId, choice: selectedUids})`
- 选择模式期间：其他行动按钮（打牌/刷新/编译/下一步）禁用；`#app.no-anim` 逻辑不变

### 5.2 end 步骤触发结算
- 进入 `end` 且有待结算"结束"触发 → 自动推进暂停，出按钮组：每张触发卡一个按钮（"结算 fire-3 结束效果"）+ [结束回合]
- 点触发按钮 → 效果入栈（内部再走选择交互）；全部结算/跳过 → [结束回合] 可用

### 5.3 特效
- `src/ui/effects/index.ts`：订阅 bus 语义事件；`card:discarded`/`card:deleted` 且 protocol==='fire' → 目标卡添加 `.card-burning` + 挂 `fire-burn` 粒子节点（按 `public/assets/fire/README.md` 结构），1.2s 后移除节点
- 引擎不感知特效（只发语义事件）

### 5.4 自动推进暂停策略（用户确认 2026-08-29）

> **规则**：发现有需要玩家选择的操作 → 取消自动结算，提示**对应的玩家**（选择权归属者，可能是对手）进行操作；直到所有事件结算完毕后才继续；若该层没有检测到需要结算的事件 → 自动结算该层。

实现：
- **暂停条件**（任一满足即取消自动结算）：
  1. `pendingEffects` 非空——有挂起的选择请求；提示 `PendingEffect.player`（可能 ≠ 当前回合玩家，规则"被作用卡持有者决定执行"）
  2. `end`/`start` 步骤存在待结算触发（fire-3 等"你可以"可选触发）——UI 出[结算/跳过]按钮
- **恢复条件**：上述全部清空（所有挂起选择已应答、所有触发已结算或跳过）→ 自动推进恢复
- **无事件层**：start/check-control/check-cache 等无交互事件 → 自动结算该层（现状不变）
- **提示 UI**：选择模式顶部显示"P1 操作 / P2 操作"归属者标签

## 6. 测试策略（TDD）

- 每张 Fire 卡一个测试文件（或按验证点分组）：构造状态 → 打出/触发 → `resolveAllChoices(s, picker)` 自动应答 → 断言状态
- `resolveAllChoices(s, picker)`：循环应答 `pendingEffects` 顶部选择（picker: (prompt) => string[]），直到无挂起 —— 测试确定性驱动
- 引擎专项测试：
  - LIFO 连锁（fire-0 翻正连锁）
  - 幽灵状态排除（结算中卡不在候选）
  - 终止规则（源卡被编译清线 → 挂起效果丢弃）
  - 揭开触发（删除/回手/偏转露出卡中指令；编译除外）
  - 偏转浮空流程（合成 def 驱动：提交目标 → 浮空 → 露出卡结算 → 被盖住前 → 落地）
  - 结束/开始触发、被盖住前时序
- 现有 53 测试保持全绿

## 7. 明确不做（YAGNI）

- 玩家选序 UI（2.2：唯一卡牌下不存在多触发）
- 顶命令常驻效果/限制/数值修正引擎（Fire 无顶命令；留到有顶命令的协议：Darkness/Metal/Plague/Spirit 等）
- 偏转 UI（Light/Darkness 时实现，本轮仅引擎 + 单测）
- 协议重排 UI（控制权配套，独立任务）
- 其余 14 套卡牌效果（后续逐个实现）

## 8. 交付物

- 效果引擎：`src/core/effects/`（types/resolve/context/triggers/registry/cards/fire）
- 游戏接入：game.ts（effect-choice 行动）、actions/base.ts、engine/turn.ts、main.ts
- UI：选择交互 + end 触发结算 + `src/ui/effects/` 火焰特效
- 测试：Fire 6 卡 + 引擎机制，全部通过；原 53 测试不回归
- 交接文档：`docs/stage2-effects-fire.md`
- 全局记忆更新；GitHub 推送（用户本机或会话内完成）
