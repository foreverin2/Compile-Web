# Compile《译世界》— 剩余 10 套协议效果开发计划（2026-08-31）

> 目标：为 死/灵魂/重力/念能/瘟疫/金属/速度/爱/恨/冷漠 共 10 套协议 × 6 卡实现真实效果（当前仅 fire/light/darkness/water/life 5 套有效果）。
> 流程：SDD 子代理驱动 —— 每任务独立 implementer（TDD）+ reviewer（spec+quality 双裁决），Approved 后合并 main。**推送等用户明确指示**。
> 参考：`compile-apo/custom_protocols/<协议>_custom_protocol.json`（语义参考，已研读）+ 卡面文本 `src/data/cards.ts` + 规则权威 `rules文本.txt`。
> 用户拍板规则（2026-08-31，本计划生效）：见各 Task 的「拍板」节，全部具有约束力。

## 全局约束（每条派发必须携带）

- 不改 `vite.config.ts` 的 `test.pool`（保持 `'threads'`）；禁 `npm install`/`npm ci`（node_modules 有 vite 补丁）。
- 测试命令 `npm test` 或 `npx vitest run tests/<file>.test.ts`；测试 import：`tests/<子目录>/` 用 `'../../src/...'`，`tests/helpers.ts` 用 `'../src/...'`。
- TypeScript strict，禁 `any`。每任务提交一次（可多 commit）。不推送。
- fizzle 规则：任何选择步骤候选为空 → runStack 以 `{selected:[]}` 续接，生成器守卫 `ans.selected.length === 0` 后自行结束（不得死锁）。
- 生成器续接契约：`const ans = yield {...}`，`ans.selected` 为 string[]；用前守卫空。
- 易主安全：效果逻辑不得假设效果卡协议属于持有者（isPlayableFaceUp 已双线匹配）。
- 现有 260 测试不得回归。
- 视觉/特效不在本计划范围：新协议编译环走通用骨架（`.compiled-ring-<defId>` 无专属分支时用基础环），触发特效仅基础行为特效（已全局存在）。特效观感由用户 5173 确认后另议。

## 执行顺序

Task A1（引擎扩展：op/触发）→ Task A2（被动限制规则）→ Task 1 death → Task 2 spirit → Task 3 gravity → Task 4 psychic → Task 5 plague → Task 6 metal → Task 7 speed → Task 8 love → Task 9 hate → Task 10 apathy

---

## Task A1：效果引擎扩展（Op / 触发点 / 状态字段）

> 依赖：无（现有引擎）。目标文件：`src/core/models/types.ts`、`src/core/state/create.ts`、`src/core/engine/deck.ts`、`src/core/effects/triggers.ts`、`src/core/effects/resolve.ts`、`src/core/rules/compile.ts`（+ 新 `src/core/rules/compile-body.ts`）、`src/core/game.ts`、`tests/`。

### A1.1 类型扩展（types.ts）

- `TriggerKind` 追加：`'before-flip' | 'after-draw' | 'after-discard' | 'after-delete' | 'after-clear-cache' | 'before-compile'`（保留既有 `'after'` 预留不变）。
- `Op` 联合修改/追加：
  - `draw` 变体：`{ op: 'draw'; count: number; player?: PlayerId; fromOpponentDeck?: boolean }`（`player` 缺省 = 效果属主；`fromOpponentDeck` = 从 `player` 的对手牌库抽）。
  - `playTopDeck` 变体：`{ op: 'playTopDeck'; line: Line; faceUp: boolean; player?: PlayerId; belowUid?: string }`（`player` 缺省 = 效果属主；`belowUid` = 落地时插入该卡**下方**）。
  - `rearrangeProtocols` 变体：`{ op: 'rearrangeProtocols'; a: Line; b: Line; player?: PlayerId }`（缺省 = 效果属主）。
  - 新增 `give`：`{ op: 'give'; uid: string; to: PlayerId }`（把持有者手牌中 uid 卡移交 to 玩家，owner 更新）。
  - 新增 `takeRandom`：`{ op: 'takeRandom'; from: PlayerId }`（从 from 玩家手牌随机取 1 张给效果属主，owner 更新；from 手牌空 → 调用方守卫 fizzle，op 执行抛错兜底）。
- `PendingLanding` 追加 `belowUid?: string`。
- `GameState` 追加：
  - `compileBlocked: PlayerId | null`（metal-1：被禁编译的玩家；其回合结束转换时清除）。
  - `pendingCompile: { player: PlayerId; line: Line } | null`（speed-2 编译前触发挂起；效果栈清空后由 runStack 消费执行编译本体）。

### A1.2 状态创建（create.ts）

`createGame()` 初始化 `compileBlocked: null`、`pendingCompile: null`。

### A1.3 即时连锁触发（triggers.ts 新增）

```ts
export type ReactiveKind = 'after-draw' | 'after-discard' | 'after-delete' | 'after-clear-cache';
export function fireReactive(s: GameState, kind: ReactiveKind, actor: PlayerId): void
```

- 语义：收集注册了该 kind 触发的场上正面卡并 push 触发效果（**不 runStack**——由外层 runStack 循环 LIFO 处理；若在非 runStack 上下文调用，调用方负责 runStack）。
- 遍历玩家：`after-discard` 遍历 `actor` 的**对手**（plague-1「对手弃牌后」）；其余遍历 `actor` 自己（「你抽牌后/你的牌被删除后/清理缓存后」）。
- 遍历该玩家**全部三条线堆叠的所有卡**（不只顶卡——after-* 全是顶命令，被覆盖仍生效，规则 90 行），`faceUp` 且 `EFFECTS[defId].triggers?.[kind]` 存在 → `resolveTrigger` push。
- 调用点：
  - `deck.ts drawCards` 末尾（抽完 count 张后）`fireReactive(s, 'after-draw', player)` —— 覆盖 draw op / refreshHand / setup 开局 / love 刷新等所有抽牌路径。
  - `resolve.ts` `discard` op：`discardFromHand` 后 `fireReactive(s, 'after-discard', card.owner)`（含系统缓存弃牌——用户拍板「含清理缓存弃牌」）。
  - `resolve.ts` `delete` op：删除落地后 `fireReactive(s, 'after-delete', owner)`（被删卡持有者）。**编译删除不触发**（用户拍板「不含编译删除」；编译走 compile-body 不经过 delete op）。
  - `game.ts` `cacheClearGen` 末尾 + `executeAction` advance 的 `check-cache` 分支 `clearCache` 后：`fireReactive(s, 'after-clear-cache', player)`。

### A1.4 before-flip（resolve.ts flip op）

`flip` op 开头（zone/uncovered 校验后、改 faceUp 前）：

```ts
const bf = collectTriggerFor(s, card, 'before-flip');
if (bf) { resolveTrigger(s, bf); return; } // 触发（metal-6 删自己）后 flip 不再执行
```

### A1.5 draw op 扩展（resolve.ts）

```ts
case 'draw': {
  const target = op.player ?? pe.player;
  if (op.fromOpponentDeck) {
    const opp: PlayerId = target === 0 ? 1 : 0;
    const os = s.players[opp];
    if (os.deck.length === 0 && os.trash.length > 0) { os.deck = shuffle(os.trash); os.trash = []; for (const c of os.deck) c.faceUp = false; }
    const card = os.deck.pop();
    if (!card) throw new Error('opponent deck is empty'); // 调用方守卫
    card.owner = target; card.zone = 'hand'; card.secret = false; card.faceUp = true; card.line = null; card.pos = null;
    s.players[target].hand.push(card);
    gameBus.emit({ type: 'card:drawn', state: s, payload: { player: target, count: 1, fromOpponentDeck: true } });
    fireReactive(s, 'after-draw', target);
    break;
  }
  drawCards(s, target, op.count); // 内部已 fireReactive after-draw
  gameBus.emit({ type: 'card:drawn', state: s, payload: { player: target, count: op.count } });
  break;
}
```

**拍板（love-1）**：对手牌库空 → 洗对手弃牌堆重组再抽（与 drawCards 一致）。

### A1.6 playTopDeck 扩展（resolve.ts + completePlay）

- op：`const target = op.player ?? pe.player;` 用 target 的牌库（洗牌同理）；`s.pendingPlay.push({ card, beforeCoveredDone: false, belowUid: op.belowUid })`。
- `completePlay`：无 `belowUid` → 原逻辑（push 顶）；有 `belowUid` → 在目标堆叠找该 uid 的 index，`stack.splice(idx, 0, card)`（插到该卡**下方**，该卡保持原位未覆盖），随后 **for 循环重索引整堆 pos = 0..len-1**（`belowUid` 卡已不在（被删/被移）→ 回退落顶）。重力 0 的 before-covered：插卡不盖顶卡 → 不触发。
- **拍板（gravity-0）**：统计口径 = 该线**双方堆叠合计**（含 gravity-0 自己），张数 = `Math.floor(总数 / 2)`，插在源卡（顶卡）**下方**（参考实现 playExecutor.ts:377-429 确认）。

### A1.7 rearrangeProtocols / give / takeRandom（resolve.ts）

- `rearrangeProtocols`：`const protos = s.players[op.player ?? pe.player].protocols;`（事件 payload 同步）。
- `give`：查 uid（须在手牌）→ 从原 owner 手牌移除 → `card.owner = op.to` → 入 to 手牌 → `emitCardEvent(s, 'card:given', card, { to: op.to })`。
- `takeRandom`：`const hand = s.players[op.from].hand;` 空 → throw（调用方守卫）；`idx = Math.floor(Math.random() * hand.length)` → 移除 → `card.owner = pe.player` → 入效果属主手牌 → `emitCardEvent(s, 'card:given', card, { to: pe.player })`。
- **拍板（love-3）**：真随机 `Math.random`；对手手牌空 → take 步骤不触发（fizzle），give 步骤照常执行。

### A1.8 before-compile（speed-2）+ pendingCompile

- 新文件 `src/core/rules/compile-body.ts`：`export function executeCompileBody(s, player, line): void` —— 即原 `executeCompileUnchecked` 的编译本体（删双方该线全部卡 → trash、翻协议或掠夺对手牌库顶、`line:compiled` 事件、胜利判定、`compiledThisTurn = true`）。**编译删除不触发任何文本/连锁**（保持原语义）。
- `src/core/rules/compile.ts`：
  - `executeCompileUnchecked` 重构：先收集该线双方堆叠中 `defId === 'speed-2' && faceUp` 的卡（每张卡唯一，最多双方各 1）；若有 → `s.pendingCompile = { player, line }` + 对每张 `resolveTrigger(s, { cardUid, defId: 'speed-2', kind: 'before-compile', optional: false })`（player = 卡持有者）+ `runStack(s)`（可挂起选线）→ return；无 → `executeCompileBody(s, player, line)`。
  - `executeCompile`（守卫版）不变（校验可编译 → 调 Unchecked）。
- `resolve.ts runStack` 收尾顺序（在 `pendingStepAdvance` 消费**之前**）：

```ts
if (s.pendingCompile) { const pc = s.pendingCompile; s.pendingCompile = null; executeCompileBody(s, pc.player, pc.line); continue; }
```

- `game.ts executeAction` compile 分支改造（仿 play 模式）：

```ts
case 'compile': {
  if (!args || !('line' in args)) throw new Error('compile requires args.line');
  resetControlIfHeld(s, player);
  executeCompile(s, player, args.line); // 内部可能因 speed-2 挂起
  if (s.pendingEffects.length > 0) s.pendingStepAdvance = true;
  else advanceStep(s);
  break;
}
```

- `game.ts executeAction` refresh 分支改造（refreshHand 内 drawCards 可能触发 after-draw 连锁）：

```ts
case 'refresh': {
  resetControlIfHeld(s, player);
  refreshHand(s, player);
  if (s.pendingEffects.length > 0) { s.pendingStepAdvance = true; runStack(s); }
  else advanceStep(s);
  break;
}
```

- 依赖关系（防循环）：`compile.ts → resolve.ts（runStack）、triggers.ts（resolveTrigger）`；`resolve.ts → compile-body.ts`；`compile-body.ts` 只依赖 types/events。无环。

### A1.9 测试要点（tests/effects/engine-ext.test.ts 或就近分布）

- draw player/fromOpponentDeck（love-1 语义：对手牌库空洗对手弃牌堆再抽；抽入卡 owner=target、secret 清除）。
- playTopDeck player（gravity-6 语义：对手牌库打出）+ belowUid（插源卡下方、pos 重索引、多张顺序、belowUid 消失回退顶）。
- give / takeRandom（owner 变更、手牌数、takeRandom 空手 fizzle）。
- rearrangeProtocols player（psychic-2 语义：重排对手协议）。
- before-flip（flip metal-6 → 触发删自己 → flip 不执行）。
- after-draw（draw/refresh/fromOpponentDeck 触发持有者场上 spirit-3 连锁）、after-discard（含缓存弃牌触发、触发者是弃牌者对手）、after-delete（效果删除触发、**编译删除不触发**）、after-clear-cache。
- before-compile（编译含 speed-2 → 先平移再删；挂起选线 → 应答 → 编译本体执行 → 步骤推进；无 speed-2 → 原行为不变）。
- 既有 260 测试全绿；`npm run build` clean。

---

## Task A2：被动限制规则

> 依赖：Task A1。目标文件：新 `src/core/rules/restrictions.ts`、`src/core/actions/base.ts`、`src/core/game.ts`、`src/core/effects/resolve.ts`、`src/core/rules/compile.ts`、`src/core/engine/turn.ts`、`tests/`。

### A2.1 restrictions.ts（新）

```ts
playerHasTopCommand(s, player, defId): boolean            // player 任一线堆叠有正面该卡（含被盖）——顶命令常驻
playerHasActiveBottom(s, player, defId): boolean          // player 任一线堆叠【顶卡】正面该卡——底命令仅未覆盖生效
opponentLineHasTop(s, line, player, defId): boolean       // 对手该线堆叠有正面该卡（含被盖）
opponentLineHasActiveBottom(s, line, player, defId): boolean // 对手该线堆叠【顶卡】正面该卡
canPlayFaceUpAnywhere(s, player)   = playerHasTopCommand(s, player, 'spirit-1')   // 拍板：全局
opponentMustPlayFaceDown(s, player)= playerHasTopCommand(s, opp(player), 'psychic-1') // 拍板：全局
lineBlocksOpponent(s, line, player)= opponentLineHasActiveBottom(s, line, player, 'plague-0') // 底命令
lineBlocksOpponentFaceDown(s, line, player) = opponentLineHasTop(s, line, player, 'metal-2') // 顶命令
shouldSkipCacheCheck(s, player)    = playerHasActiveBottom(s, player, 'spirit-0') // 底命令
lineMiddleCommandsNullified(s, line) = lineTopCommandActive(s, line, 'apathy-2')   // 复用 create.ts 已有 helper；拍板：该线双方全部牌（含被盖）
```

实现用 `isUncovered`（context.ts）判顶卡。

### A2.2 接线

- `base.ts isPlayableFaceUp`：开头 `if (canPlayFaceUpAnywhere(s, player)) return true;`（spirit-1 持有者任意线正面打）。
- `game.ts getLegalActions` action 分支：

```ts
const faceUpBanned = opponentMustPlayFaceDown(s, player);
for (const card of hand) for (const line of LINES) {
  if (lineBlocksOpponent(s, line, player)) continue; // plague-0：此列完全禁打
  if (!faceUpBanned && isPlayableFaceUp(s, player, card.uid, line)) out.push({ kind:'play', cardUid, faceUp:true, line });
  if (!lineBlocksOpponentFaceDown(s, line, player)) out.push({ kind:'play', cardUid, faceUp:false, line });
}
```

- `game.ts` check-cache 分支 / `executeAction` advance 的守卫与执行：`hand > 5 && !shouldSkipCacheCheck(s, player)` 才强制 clear-cache / 执行 clearCache / 拦截 advance（spirit-0 跳过检查缓存阶段）。
- `resolve.ts pushMiddle`：`if (card.line !== null && lineMiddleCommandsNullified(s, card.line)) return;`（apathy-2 无效化该线中指令；**含被盖卡的中指令**——拍板）。
- `compile.ts`：`canCompileLine` / `getCompilableLines` 开头 `if (s.compileBlocked === player) return false / []`（metal-1）。
- `turn.ts advanceStep`：`next === 'start'` 分支（换人后）`if (s.compileBlocked === ending) s.compileBlocked = null;`（对手回合结束清除——"下回合不能编译"）。

### A2.3 测试要点（tests/effects/restrictions.test.ts）

- spirit-1 任意线正面打 / 被盖仍生效（顶命令）；psychic-1 对手全局只能反面打（含被盖生效）；plague-0 底未覆盖才禁该列、被盖后解禁；metal-2 禁该列反面打、正面打不受影响；apathy-2 该线中指令不结算（含被盖卡）、他线正常；spirit-0 跳过 check-cache（手牌>5 可直接 advance）；metal-1 下回合禁编译、再下回合恢复；组合（spirit-1 + psychic-1 冲突时 psychic-1 禁正面优先）。

---

## Task 1：death（死）6 卡

> 依赖：A1（无特殊机制）。新文件 `src/core/effects/cards/death.ts`（模板：`life.ts`）+ `tests/effects/death.test.ts` + helpers 加 `draftDeathP1`。`resolve.ts` 顶部 `import './cards/death';`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| death-0 | 从另两列各删除1张牌。 | 两次 select（`zone:'field'`，候选=被选列的顶卡？不——候选全局 field，但限定另两列）→ 实现：先 select-line（排除当前列）→ 该列双方顶卡中 select 1 → delete；再对另一列重复。两列都做（无牌可删 → 该列 fizzle 跳过）。 |
| death-1 | 顶：开始：你可以抽1张牌。若如此，删除另1张牌，然后删除此牌。 | start 触发（`optional:false`）：select-action `['draw','skip']`（抽/跳过二选一）→ 抽 → 若抽：select 1 张 field 顶卡（**排除自己**）→ delete → delete 自己。抽后源卡仍有效（自己没被删）。 |
| death-2 | 选1列删除其中所有1分和2分的牌。 | select-line（任意列）→ 收集该列**双方堆叠全部卡**中 `cardPointValue(s, card) ∈ {1,2}` 的（含被盖；**拍板：与 water-3 一致按当前分值**）→ 逐个 `delete allowCovered`。空 → fizzle。 |
| death-3 | 删除1张反面牌。 | select field 顶卡中 `!faceUp` 的 1 张 → delete。空 → fizzle。 |
| death-4 | 删除1张0分或1分的牌。 | select field 顶卡中 `faceUp && getCardDef(defId).value <= 1` 的 1 张 → delete。空 → fizzle。 |
| death-5 | 弃1张牌。 | 同 life-5 模板。 |

---

## Task 2：spirit（灵魂）6 卡

> 依赖：A1（after-draw、rearrangeProtocols）+ A2（spirit-1 任意列、spirit-0 跳过缓存）。新文件 `src/core/effects/cards/spirit.ts` + `tests/effects/spirit.test.ts` + helpers `draftSpiritP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| spirit-0 | 中：刷新。抽1张牌。底：跳过检查缓存阶段。 | 中：`need = 5 - hand.length`，`need > 0` → `yield {op:'draw', count:need}`（刷新=抽至5）；再 `yield {op:'draw', count:1}`。底：不注册效果——由 A2 `shouldSkipCacheCheck` 生效（顶卡正面）。 |
| spirit-1 | 顶：你可以在任意列打出牌。中：抽2张牌。底：开始：要么弃1张牌，要么翻转此牌。 | 顶：A2 `canPlayFaceUpAnywhere`。中：`{op:'draw', count:2}`。底：start 触发 select-action `['discard','flip']`（min1 max1 非可选）→ 弃：select 1 手牌 discard；翻：`{op:'flip', uid:ctx.card.uid}`。 |
| spirit-2 | 你可以翻转1张牌。 | 可选 select field 顶卡 1 张 → flip（模板 life-2 反向）。 |
| spirit-3 | 顶：你抽牌后：你可以平移此牌，不论是否被盖住。 | after-draw 触发（`fireReactive` 自动收集，注册 `triggers['after-draw']`）：可选 select-line（排除当前线）→ `{op:'shift', uid:ctx.card.uid, targetLine, allowCovered:true}`。守卫空应答。 |
| spirit-4 | 交换你2个协议卡的位置。 | select-line 选位置 a（3 选 1）→ select-line 选位置 b（≠a）→ `{op:'rearrangeProtocols', a, b}`（缺省 player=属主）。 |
| spirit-5 | 弃1张牌。 | 模板。 |

---

## Task 3：gravity（重力）6 卡

> 依赖：A1（playTopDeck player/belowUid）。新文件 `src/core/effects/cards/gravity.ts` + `tests/effects/gravity.test.ts` + helpers `draftGravityP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| gravity-0 | 此列每有2张牌，就在此牌下方以反面打出你牌堆顶的牌。 | 中指令：`total = 双方该线堆叠长度之和`（**拍板：双方合计含自己**）→ `n = Math.floor(total / 2)` → 循环 `n` 次：`deckTopAvailable` 守卫 → `yield {op:'playTopDeck', line: ctx.card.line, faceUp:false, belowUid: ctx.card.uid}`。牌库空+弃牌堆空 → 剩余 fizzle。 |
| gravity-1 | 抽2张牌。把1张牌平移进或平移出此列。 | `{op:'draw',count:2}` → select field 顶卡 1 张 → 若 `card.line !== 此列`：select-line 只能选此列 → shift；若 `card.line === 此列`：select-line 排除此列 → shift 出去。 |
| gravity-2 | 翻转1张牌。把那张牌平移进此列。 | select field 顶卡 1 张 → flip → findCard 守卫（翻正连锁可能移除它）→ 若 `card.line !== 此列` → select-line 只能选此列 → `{op:'shift', uid, targetLine:此列, allowCovered:true}`（参考 position:any → 被盖也可平移）。 |
| gravity-4 | 把1张反面牌平移进此列。 | select field 顶卡中 `!faceUp` 的 1 张 → 若已在此列 → **无动作跳过**（拍板）→ 否则 shift 进此列。 |
| gravity-5 | 弃1张牌。 | 模板。 |
| gravity-6 | 对手在此列以反面打出其牌堆顶的牌。 | `deckTopAvailable(s, opp)` 守卫 → `yield {op:'playTopDeck', line: ctx.card.line, faceUp:false, player: opp}`。 |

---

## Task 4：psychic（念能）6 卡

> 依赖：A1（draw player、rearrangeProtocols player、reveal 手牌）+ A2（psychic-1 只能反面）。新文件 `src/core/effects/cards/psychic.ts` + `tests/effects/psychic.test.ts` + helpers `draftPsychicP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| psychic-0 | 抽2张牌。对手弃2张牌，然后揭示其手牌。 | `{op:'draw',count:2}` → 对手弃 2：select（`chooser: opp`，候选=对手手牌，min2 max2；手牌不足 → fizzle 跳过）→ 逐个 `{op:'discard', uid}`（discard op 从 pe.player 手牌弃——**注意**：discard op 的 `pe.player` 是效果属主！需按被弃卡 owner 弃：`discardFromHand(s, card.owner, uid)`。**引擎修正**：discard op 应改为从**被弃卡 owner** 手牌弃（`findCard` 得到卡 → 其 owner 手牌），而不是 pe.player。见 A1 增补。→ 揭示：循环对手手牌每张 `{op:'reveal', uid}`（Case B：揭示对手卡 → 幽灵给自己，expiresAtTurn+3）。 |
| psychic-1 | 顶：你的对手只能以反面打出牌。底：开始：翻转此牌。 | 顶：A2 `opponentMustPlayFaceDown`。底：start 触发 `{op:'flip', uid:ctx.card.uid}`（翻正 → 中指令无 → 翻回反面后顶命令失效）。 |
| psychic-2 | 对手弃2张牌。你重排对手的协议。 | 对手弃 2（chooser=opp，同 psychic-0 弃牌部分）→ select-line 选 a → select-line 选 b（≠a）→ `{op:'rearrangeProtocols', a, b, player: opp}`。 |
| psychic-3 | 对手弃1张牌。平移1张对手的牌。 | 对手弃 1（chooser=opp）→ select 对手 field 顶卡 1 张（打出者选目标）→ select-line 任意线（排除当前线——shift op 约束）→ shift。 |
| psychic-4 | 底：结束：你可以回手1张对手的牌。若如此，翻转此牌。 | end 触发：可选 select 对手 field 顶卡 1 张 → return（allowCovered 不需要——默认顶卡）→ 若回手：`{op:'flip', uid:ctx.card.uid}`（翻自己）。 |
| psychic-5 | 弃1张牌。 | 模板。 |

**A1 增补（discard op 归属修正）**：`discard` op 从**被弃卡 owner** 的手牌弃（`findCard(s, op.uid)` → `card.owner`），不再假设 pe.player 持有该卡（psychic-0/2/3「对手弃牌」需要）。`discardFromHand(s, card.owner, op.uid)`；事件 triggerDefId 不变。

---

## Task 5：plague（瘟疫）6 卡

> 依赖：A1（after-discard）+ A2（plague-0 禁打此列）。新文件 `src/core/effects/cards/plague.ts` + `tests/effects/plague.test.ts` + helpers `draftPlagueP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| plague-0 | 中：对手弃1张牌。底：对手无法在此列打出牌。 | 中：对手弃 1（chooser=opp）。底：A2 `lineBlocksOpponent`。 |
| plague-1 | 顶：对手弃牌后：你抽1张牌。中：对手弃1张牌。 | 顶：`triggers['after-discard']`（fireReactive 自动：弃牌者对手场上正面 plague-1 → 抽 1）。中：对手弃 1（chooser=opp）。 |
| plague-2 | 弃1张或更多张牌。对手也弃牌，数量等于你的弃牌数+1。 | select 自己手牌 min1 max=hand.length → 记 N=selected.length → 逐个 discard → 对手弃 N+1：对手手牌不足 N+1 → 弃全部（守卫 fizzle：空 → 跳过）；chooser=opp。 |
| plague-3 | 翻转其他所有未被盖住的正面牌。 | 收集全场双方 field **顶卡**（`zone:'field'` 候选已=顶卡）中 `faceUp && uid !== 自己` → 逐个 flip。空 → fizzle。 |
| plague-4 | 底：结束：对手删除1张对手的反面牌。你可以翻转这张牌。 | end 触发：对手删自己的反面牌：select（`chooser: opp`，候选=对手 field 顶卡中 `!faceUp`）→ delete → 然后「你可以翻转这张牌」= 翻 plague-4 自己：可选（无选择——直接可选 flip 自己；拍板：由持有者决定是否翻，`optional` 语义：生成器内用 select-action `['flip','skip']` 或直接可选 `{op:'flip',uid:自己}`？——**翻转自己无目标选择**：用 select-action optional 让玩家决定翻/不翻）。守卫：对手无反面顶卡 → 整段 fizzle（含翻自己）。 |
| plague-5 | 弃1张牌。 | 模板。 |

---

## Task 6：metal（金属）6 卡

> 依赖：A1（before-flip）+ A2（metal-2 禁反面打、compileBlocked）。新文件 `src/core/effects/cards/metal.ts` + `tests/effects/metal.test.ts` + helpers `draftMetalP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| metal-0 | 顶：对手此列的总分减2。中：翻转1张牌。 | 顶：`valueModifier { target: 'opponent-line', apply: (s, owner, line, total) => total - 2 }`（正面上线即生效，含被盖；对手该线估值时 -2）。中：select field 顶卡 1 → flip。 |
| metal-1 | 抽2张牌。对手下回合不能编译。 | `{op:'draw',count:2}` → `s.compileBlocked = opp(player)`（中指令直接改状态；A2 接线生效）。 |
| metal-2 | 顶：对手不能在此列以反面打出牌。 | A2 `lineBlocksOpponentFaceDown`（顶命令，含被盖）。 |
| metal-3 | 抽1张牌。删除有至少8张牌的另一列里的所有牌。 | `{op:'draw',count:1}` → 找另两列（排除当前列）中**该列双方堆叠合计 ≥ 8** 的列（符合条件 >1 列？select-line 选一；无 → fizzle）→ 该列双方全部卡（含被盖，「所有」）逐个 `delete allowCovered`。 |
| metal-5 | 弃1张牌。 | 模板。 |
| metal-6 | 顶：被盖住或翻转前：先删除这张牌。 | 注册 `triggers['before-covered']` + `triggers['before-flip']` 同一 fn：`yield {op:'delete', uid:ctx.card.uid}`。被盖前：completePlay/completeShift 顶卡检查自动触发（已有机制）；翻转前：A1 before-flip 钩子。 |

---

## Task 7：speed（速度）6 卡

> 依赖：A1（after-clear-cache、before-compile pendingCompile）。新文件 `src/core/effects/cards/speed.ts` + `tests/effects/speed.test.ts` + helpers `draftSpeedP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| speed-0 | 打出1张牌。 | select 自己手牌 1 张 → select-action `['face-up','face-down']` → 若正面：select-line 仅匹配协议线（`isPlayableFaceUp` 逻辑：卡协议 == 己方或对方该线协议）；反面：任意线 → `{op:'playFromHand', uid, line, faceUp}`。守卫：手牌空 fizzle。 |
| speed-1 | 顶：清理缓存后：抽1张牌。中：抽2张牌。 | 顶：`triggers['after-clear-cache']`（fireReactive：清理者自己场上正面 speed-1 → 抽 1）。中：`{op:'draw',count:2}`。 |
| speed-2 | 顶：通过编译删除此牌前：平移此牌，不论是否被盖住。 | `triggers['before-compile']`：select-line（排除当前线）→ `{op:'shift', uid:ctx.card.uid, targetLine, allowCovered:true}`。A1 的 pendingCompile 机制驱动（持有者选线——规则 94「被作用卡持有者决定」）。 |
| speed-3 | 中：平移另1张你的牌。底：结束：你可以平移1张你的牌。若如此，翻转此牌。 | 中：select 自己 field 顶卡（**排除自己**）→ select-line 任意线 → shift。底：end 触发：可选 select 自己 field 顶卡（含自己？「1张你的牌」任意——含自己）→ shift → 若平移：`{op:'flip', uid:ctx.card.uid}`（翻自己）。守卫空应答。 |
| speed-4 | 平移1张对手的反面牌。 | select 对手 field 顶卡中 `!faceUp` 1 张 → select-line 任意线 → shift。空 fizzle。 |
| speed-5 | 弃1张牌。 | 模板。 |

---

## Task 8：love（爱）6 卡

> 依赖：A1（draw player/fromOpponentDeck、give、takeRandom）。新文件 `src/core/effects/cards/love.ts` + `tests/effects/love.test.ts` + helpers `draftLoveP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| love-1 | 中：抽对手牌堆顶的牌。底：结束：你可以把1张手牌给对手。若如此，抽2张牌。 | 中：`{op:'draw', count:1, fromOpponentDeck:true}`（**拍板：对手牌库空洗对手弃牌堆再抽**；对手牌库+弃牌堆皆空 → fizzle）。底：end 触发：可选 select 自己手牌 1 张 → `{op:'give', uid, to: opp}` → 若给了：`{op:'draw', count:2}`。 |
| love-2 | 对手抽1张牌。刷新。 | `{op:'draw', count:1, player: opp}` → `need = 5 - hand.length`，`need>0` → `{op:'draw', count:need}`。 |
| love-3 | 随机拿走1张对手的手牌。你把1张手牌给对手。 | 对手手牌空 → take 步骤 fizzle（**拍板**）；否则 `{op:'takeRandom', from: opp}`（真随机）→ select 自己手牌 1 张（give 照常，**拍板**）→ `{op:'give', uid, to: opp}`。 |
| love-4 | 揭示1张你的手牌。翻转1张牌。 | select 自己手牌 1 张 → `{op:'reveal', uid}`（Case A：己方手牌 → 幽灵给对手）→ select field 顶卡 1 → flip。 |
| love-5 | 弃1张牌。 | 模板。 |
| love-6 | 对手抽2张牌。 | `{op:'draw', count:2, player: opp}`。 |

---

## Task 9：hate（恨）6 卡

> 依赖：A1（after-delete）。新文件 `src/core/effects/cards/hate.ts` + `tests/effects/hate.test.ts` + helpers `draftHateP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| hate-0 | 删除1张牌。 | select field 顶卡（双方任意）1 → delete。空 fizzle。 |
| hate-1 | 弃3张牌。删除1张牌。再删除1张牌。 | 弃 3：select 自己手牌 min=min(3, hand.length) max=3（**拍板：不足 3 弃全部剩余**）→ 逐个 discard → 删 1：select field 顶卡 → delete → 再删 1：select field 顶卡（重新列候选——上一步删后顶卡可能变化）→ delete。每步空 → fizzle 跳过后续（守卫）。 |
| hate-2 | 删除你分值最高的牌。删除对手分值最高的牌。 | 自己：candidates field 顶卡 → `cardPointValue` 最大者集合 → select 1 → delete；空 → fizzle。对手：同（对手候选）。分值口径：`cardPointValue`（正面=牌面、反面=2、暗2线=4）。 |
| hate-3 | 顶：你的牌被删除后：抽1张牌。 | `triggers['after-delete']`（fireReactive：被删卡持有者自己场上正面 hate-3 → 抽 1；**不含编译删除**——拍板）。 |
| hate-4 | 底：被盖住前：先删除此列分值最低的被盖住的牌。 | `triggers['before-covered']`：收集**自己该列堆叠中被盖的卡**（pos < len-1）中 `cardPointValue` 最低者集合 → select 1（并列玩家选；唯一则直接删）→ `delete allowCovered`。无被盖卡 → fizzle。 |
| hate-5 | 弃1张牌。 | 模板。 |

---

## Task 10：apathy（冷漠）6 卡

> 依赖：A1 + A2（apathy-2 无效化中指令）。新文件 `src/core/effects/cards/apathy.ts` + `tests/effects/apathy.test.ts` + helpers `draftApathyP1`。

| 卡 | 文本 | 实现要点 |
|---|---|---|
| apathy-0 | 顶：此列每张反面牌给你此列总分加1。 | `valueModifier { target: 'own-stack', apply: (s, owner, line, total) => total + countFaceDownInLine(s, line) }`——count 该线**双方堆叠全部反面牌**（拍板口径：此列=双方；含被盖）。顶命令正面上线即生效（含被盖）。 |
| apathy-1 | 翻转此列所有其他正面牌。 | 收集**自己该线堆叠全部 faceUp 卡**（含被盖，「所有」，排除自己）→ 逐个 `flip allowCovered`。空 fizzle。（「此列」指 apathy-1 所在列；「其他」排除自己。） |
| apathy-2 | 顶：无效化此列所有牌的中部命令。底：被盖住前：先翻转此牌。 | 顶：A2 `lineMiddleCommandsNullified`（**拍板：该线双方全部牌含被盖**）。底：`triggers['before-covered']`：`{op:'flip', uid:ctx.card.uid}`（翻成**反面** → 顶命令随即失效，落地卡中指令正常结算；apathy-2 无 middle，翻转连锁无害）。 |
| apathy-3 | 翻转1张对手的正面牌。 | select 对手 field 顶卡中 `faceUp` 1 → flip。空 fizzle。 |
| apathy-4 | 你可以翻转1张你的被盖住的正面牌。 | 可选：候选=自己**被盖**（非顶卡）且 faceUp 的卡 → `flip allowCovered`。空 fizzle（可选自动跳过）。 |
| apathy-5 | 弃1张牌。 | 模板。 |

---

## 收尾（全部任务完成后）

- 全量 `npm test`（预期 260 + ~120 新增）+ `npm run build`。
- 更新 `docs/handoff-2026-08-31.md`（新交接文档）与全局记忆 `E:\studyE\Deepseek memory\compile-web-project.md`、SDD 台账 `.superpowers/sdd/progress.md`。
- 提交全部；**推送等用户明确指示**。
