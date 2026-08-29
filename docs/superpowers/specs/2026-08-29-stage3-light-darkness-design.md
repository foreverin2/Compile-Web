# 阶段 3 设计文档：Light / Darkness 协议试点

- 日期：2026-08-29
- 状态：设计稿（待用户批准）
- 范围：Light（3a）+ Darkness（3b）协议真实效果 + 配套新引擎/UI 能力
- 前置：阶段 2 完成（103 测试绿，HEAD=`ab714f0`）；交接文档 `docs/stage2-effects-fire.md`（§0.1 架构 / §4.9 特效分层 / §5.2 首步）

## 1. 目标

1. **Light 6 卡真实效果**（3a）
2. **Darkness 6 卡真实效果**（3b）
3. 新增能力：**选线/选操作选择类型**（shift 目标线 UI）、**顶命令数值修正引擎**、**覆盖卡目标**、**牌堆顶打出 op + 抽牌特效**、**reveal-hand 与幽灵牌显示上限处理**
4. 每套协议**专属额外特效**挂载（按 `triggerProtocol` 命名空间，参考 fire 火焰焚烧）
5. 已编译协议特效（`compiled-fx-<defId>`）为 light/darkness 加基础版

## 2. 新增引擎/UI 能力

### 2.1 选择类型扩展（选线 / 选操作）

`ChoiceRequest.kind` 扩展：

```ts
interface ChoiceRequest {
  kind: 'select' | 'select-line' | 'select-action';
  title: string;
  min: number;
  max: number;
  optional: boolean;
  candidates: ChoiceCard[];  // kind='select' 用
  lines?: Line[];            // kind='select-line' 用：可选目标线（排除源线等）
  actions?: string[];        // kind='select-action' 用：操作标签数组
}
```

- **应答格式不变**：`ChoiceAnswer { selected: string[] }`；select-line 用 `'line:1'`、select-action 用 `'action:flip'` 编码，生成器解码
- **UI**：选择模式按 kind 分支——
  - `select-line`：三条线槽青色高亮，点击选线（点协议/链路行）；确认条复用
  - `select-action`：确认条上方出操作按钮组（翻转/平移/跳过…），点按钮即选
- **校验**：`answerEffect` 对 select-line 校验 `selected[0] ∈ lines`、select-action 校验 `selected[0] ∈ actions`
- 用途：light-2（翻或平移）、light-3（平移目标线）、darkness-1/3/4（目标线）、后续协议的线级目标

### 2.2 顶命令数值修正引擎（valueModifier）

`CardEffects` 增加 `valueModifier`：

```ts
/** 顶命令数值修正：stackValue 计算该线总值时应用
 *  例：darkness-2 此栈反面牌分值=4；metal-0 对手此列总分-2；apathy-0 每张反面牌+1 */
valueModifier?: (s: GameState, owner: PlayerId, line: Line, stack: Card[], total: number, card: Card) => number;
```

- `stackValue(s, player, line)`：先按现状累加（正面=印刷值、反面=2），再遍历该线**双方**堆叠中注册了 `valueModifier` 的顶命令卡，逐个应用（返回新 total）
- 顺序：own 堆叠先、对手堆叠后（后续协议需要时再定优先级）
- 本轮实现：darkness-2（`total += 反面卡数 × (4−2)`）；metal-0/apathy-0 留待对应协议（机制就绪）
- 注意：`getLineValue`（控制权/编译判定用）自动受益

### 2.3 覆盖卡目标（coveredAllowed）

- `CandidateFilter` 增加 `covered?: boolean`（默认 false）：true 时 `listCandidates` 列出该侧堆叠**全部**卡（含被覆盖），不再只列顶卡
- 效果操作（shift/delete/return/flip）增加 `allowCovered?: boolean`：true 时跳过 `isUncovered` 校验（文本授权覆盖卡目标才用）
- **无覆盖卡防死锁（用户强调）**：沿用既有 **fizzle 规则**（runStack 对候选为空的 select 自动跳过并记日志）——darkness-0"平移对手被盖住的牌"在对手无覆盖卡时候选为空 → 该步骤自动跳过，不会死循环。回归测试覆盖此场景
- 用途：darkness-0（平移对手被盖住的牌）、apathy-4（翻转己方被盖住的正面牌）、hate-4（被盖住前删被盖住的最低分值牌）

### 2.4 牌堆顶打出 op（playTopDeck）+ 抽牌基础特效

```ts
{ op: 'playTopDeck'; line: Line; faceUp: boolean }  // 从效果拥有者牌堆顶取牌
```

- 语义：与"打出"一致——目标顶卡"被盖住前"先结算 → 落地（`pendingPlay` 浮空机制复用）；`faceUp=false` 时落地后不结算中指令
- 从牌堆顶弹出（非抽入手牌），`card.zone` 直接 field（经 pendingPlay 浮空）
- 触发语义事件：`card:deck-played`（payload：player/line/faceUp/defId/uid）→ **基础特效**：一张卡背幽灵卡从**牌库区**丝滑飞入目标链路堆叠末尾（复用抽牌幽灵样式，终点用 `stackEndPos`），随后重渲染显示真实落卡
- 用途：darkness-3（另一列反面打出）、后续 water-1/life-1/life-3/gravity-0/gravity-6 等

### 2.5 reveal-hand 与幽灵牌显示上限

- light-4"对手揭示其手牌"：循环 `reveal` op（幽灵牌机制已就绪）——每张手牌产生一个幽灵牌
- **显示上限处理（用户强调）**：手牌区最多显示 10 张真卡 + N 徽标；幽灵牌追加在末尾可能溢出。方案：
  - 手牌真卡显示数 < 10：幽灵牌照旧在**手牌末尾**渲染（现状）
  - 真卡显示数 ≥ 10（达上限）：幽灵牌改在**手牌上方独立揭示条**（`.reveal-strip`）紧凑渲染，条内最多显示 6 张 + `+N` 徽标
- 幽灵牌始终：不参与任何事件/手牌计数（现有 `.reveal-ghost` 语义不变）；抽牌/回手定位查询已排除

## 3. Light 6 卡效果矩阵（3a）

| 卡 | 效果 | 需要的能力 |
|---|---|---|
| light-0 | 翻转1张牌。抽其分值张牌。 | select（场上顶卡）→ flip → draw（分值=候选 label） |
| light-1 | 结束：抽1张牌。 | triggers.end（**必选**，无"可以"） |
| light-2 | 抽2张牌。揭示1张反面牌。你可以平移或翻转那张牌。 | draw → reveal（反面卡）→ **select-action**（翻转/平移/跳过；选择权=被揭示卡持有者，`PendingEffect.player` 已是效果属主=揭示者？规则"被作用卡持有者决定"→ chooser 应为被揭示卡的 owner） |
| light-3 | 平移此列所有反面牌到另一列。 | **select-line**（排除源线）→ 逐个 shift（该列全部反面卡，含被覆盖？文本"此列所有反面牌"含被覆盖） |
| light-4 | 对手揭示其手牌。 | 循环 reveal 对手手牌（**reveal-hand**） |
| light-5 | 弃1张牌。 | select（手牌必选）→ discard |

> light-2 的 chooser：按规则"由被作用卡持有者决定该效果如何执行"，翻转/平移的选择权归**被揭示卡的持有者**（可能是对手）——`executeAction('effect-choice')` 已支持非回合玩家应答 ✓

## 4. Darkness 6 卡效果矩阵（3b）

| 卡 | 效果 | 需要的能力 |
|---|---|---|
| darkness-0 | 抽3张牌。平移1张你对手的被盖住的牌。 | draw → **select（coveredAllowed，仅对手侧被盖住）** → shift(allowCovered)；无覆盖卡自动 fizzle |
| darkness-1 | 翻转1张你对手的牌。你可以平移那张牌。 | select（对手顶卡）→ flip → **select-line**（可选平移） |
| darkness-2 | 顶：此栈反面牌分值=4。中：你可以翻转1张此列的反面牌。 | **valueModifier** + select（本列反面卡，可选翻转） |
| darkness-3 | 在另一列反面打出你牌堆顶的牌。 | **playTopDeck**（faceUp=false）+ **select-line** |
| darkness-4 | 平移1张反面牌。 | select（场上任一侧反面顶卡）→ **select-line** → shift |
| darkness-5 | 弃1张牌。 | select → discard |

## 5. 协议专属额外特效

- light/darkness 的 `card:discarded/deleted`（由它们触发）按 `triggerProtocol` 挂载额外特效（参考 fire 火焰焚烧；Gemini 生成 → `src/ui/fx/` TS 模块 + `public/assets/fx/` CSS）
- 已编译特效：`.compiled-fx-light`（如柔光脉冲边框）、`.compiled-fx-darkness`（如暗紫光晕）——纯 CSS，机制已就绪
- 基础行为特效（对切/破碎/翻面/回手/偏转/编译清牌/幽灵）全协议自动生效，无需改动

## 6. 测试策略（TDD）

- 每能力独立测试：select-line/select-action 校验、valueModifier（darkness-2 堆叠值）、coveredAllowed + fizzle 回归（无覆盖卡不死锁）、playTopDeck（含被盖住前触发）、reveal-hand（幽灵数量 + 对手回合清除）
- 每协议效果矩阵测试（`tests/effects/light.test.ts` / `darkness.test.ts`）
- 既有 103 测试不回归

## 7. 明确不做（YAGNI）

- 其余 12 套协议效果（机制就绪后逐个按此流程开发）
- 协议重排 UI（water-2/psychic-2，独立任务）
- AI 对手 / 打包
- `after` 触发（plague-1/hate-3 等，机制预留）

## 8. 交付物

- 引擎：select-line/select-action、valueModifier、coveredAllowed、playTopDeck op、reveal-hand
- UI：选线/选操作模式、牌堆顶打出特效、揭示条（显示上限）
- Light/Darkness 12 卡效果 + 专属额外特效（Gemini 提示词按需）
- 测试全绿、build 通过、交接文档更新、推送（用户指示时）
