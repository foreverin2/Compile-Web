# 阶段 3：Light / Darkness 协议试点 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Light（3a）+ Darkness（3b）12 张卡真实效果，配套新能力（选线/选操作选择类型、valueModifier 顶命令数值修正、覆盖卡目标、牌堆顶打出 op + 牌库区联动、reveal-hand），并完成布局调整（手牌上限 15、牌库区、翻面按钮 restyle）。

**Architecture:** 沿用阶段 2 效果引擎（生成器挂起 + 效果栈 + 选择系统 + 事件总线）。新增能力全部在既有骨架上扩展：`ChoiceRequest` 增加 `select-line`/`select-action` 两种 kind；`CardEffects` 增加 `valueModifier`（stackValue 集成）；`CandidateFilter.covered` + op 级 `allowCovered`；新 op `playTopDeck`；牌库区 `.deck` 渲染 + 抽牌特效起点联动。UI 选择模式按 kind 分支（选线高亮 lane、选操作出按钮）。

**Tech Stack:** TypeScript strict、Vitest 4.1.11（pool threads）、Vite 8.2.2。无新依赖。

## Global Constraints

- **不要修改 `vite.config.ts` 的 `test.pool`**（必须保持 `'threads'`）
- **禁止运行 `npm install` / `npm ci`**（node_modules 有 vite 补丁，重装即丢）
- 测试命令：`npm test` 或 `npx vitest run tests/<file>.test.ts`
- 测试文件在 `tests/<sub>/` 下 import `'../../src/...'`（两层）；`tests/helpers.ts` 用 `'../src/...'`
- TypeScript strict，不引入 `any`
- **fizzle 规则**：任何选择步骤候选为空 → runStack 自动跳过（不得死循环）——新效果生成器必须守卫空应答
- 生成器续接契约：`const ans = yield {...}` + `ans.selected`（uid 字符串）；使用前守卫 `ans.selected.length === 0`
- 既有 103 测试不回归
- 每任务提交一次；**不推送**（用户指示时才推送）

---

### Task 1: 选择类型扩展（select-line / select-action）

**Files:**
- Modify: `src/core/models/types.ts`（ChoiceRequest 扩展）
- Modify: `src/core/effects/resolve.ts`（answerEffect 校验按 kind 分支）
- Modify: `src/ui/render.ts`（选择模式 UI 按 kind 分支：lane 行高亮 / 操作按钮组）
- Create: `tests/effects/choice-kind.test.ts`

**Interfaces:**
- Consumes: 既有 `ChoiceRequest` / `answerEffect` / 选择模式渲染
- Produces: `ChoiceRequest.kind: 'select' | 'select-line' | 'select-action'`（`lines?: Line[]` / `actions?: string[]` / `chooser?: PlayerId`）；应答编码：select-line 用 `'line:1'`、select-action 用 `'action:flip'`；`chooser` 供"被作用卡持有者决定"（UI 标签与 executeAction 校验用）
- 选择模式 UI：`select-line` → 三条 lane-row（加 `data-line`）青色高亮，点击即答 `['line:N']`；`select-action` → 确认条上方出操作按钮（点击即答 `['action:X']`），optional 时出「跳过」

- [ ] **Step 1: 写失败测试** `tests/effects/choice-kind.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { createGame } from '../../src/core/state/create';

function base(): ReturnType<typeof createGame> {
  const s = createGame();
  s.phase = 'turn';
  return s;
}
function push(s: ReturnType<typeof createGame>, gen: Generator<EffectStep, void, StepResult>): void {
  s.pendingEffects.push({ id: 'e1', player: 0, gen, sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null });
  runStack(s);
}

describe('choice kinds', () => {
  it('select-line accepts a valid line and rejects others', () => {
    const s = base();
    let got = '';
    function* g(): Generator<EffectStep, void, StepResult> {
      const ans = (yield { kind: 'select-line', title: '选目标线', min: 1, max: 1, optional: false, candidates: [], lines: [1, 2] }) as { selected: string[] };
      got = ans.selected[0];
    }
    push(s, g());
    expect(() => answerEffect(s, 'e1', ['line:0'])).toThrow(/invalid line/);
    answerEffect(s, 'e1', ['line:2']);
    expect(got).toBe('line:2');
  });

  it('select-action accepts a listed action and rejects unknown', () => {
    const s = base();
    let got = '';
    function* g(): Generator<EffectStep, void, StepResult> {
      const ans = (yield { kind: 'select-action', title: '选择操作', min: 1, max: 1, optional: true, candidates: [], actions: ['action:flip', 'action:shift'] }) as { selected: string[] };
      got = ans.selected[0] ?? '(skip)';
    }
    push(s, g());
    expect(() => answerEffect(s, 'e1', ['action:delete'])).toThrow(/invalid action/);
    answerEffect(s, 'e1', []); // optional 跳过
    expect(got).toBe('(skip)');
  });
});
```

- [ ] **Step 2: 运行确认失败** — `npx vitest run tests/effects/choice-kind.test.ts` → FAIL（kind 校验不存在）

- [ ] **Step 3: 实现类型与校验**

`src/core/models/types.ts`：

```ts
export interface ChoiceRequest {
  kind: 'select' | 'select-line' | 'select-action';
  title: string;
  min: number;
  max: number;
  optional: boolean;
  candidates: ChoiceCard[];
  /** select-line：可选目标线（编码 'line:N'） */
  lines?: Line[];
  /** select-action：可执行操作（编码 'action:<name>'） */
  actions?: string[];
  /** 选择权归属者（缺省 = PendingEffect.player；"被作用卡持有者决定"用） */
  chooser?: PlayerId;
}
```

`src/core/effects/resolve.ts` 的 `answerEffect` 校验段替换为按 kind 分支：

```ts
  const req = pe.prompt;
  if (!req.optional && selected.length < req.min) throw new Error(`requires at least ${req.min} selection(s)`);
  if (selected.length > req.max) throw new Error(`requires at most ${req.max} selection(s)`);
  if (req.kind === 'select-line') {
    if (selected.length !== 1 || !req.lines?.includes(Number(selected[0].replace('line:', '')) as Line)) {
      throw new Error('invalid line selection');
    }
  } else if (req.kind === 'select-action') {
    if (selected.length === 1 && !req.actions?.includes(selected[0])) {
      throw new Error('invalid action selection');
    }
  } else {
    for (const uid of selected) {
      if (!req.candidates.some((c) => c.uid === uid)) throw new Error(`invalid selection: ${uid}`);
    }
  }
```

- [ ] **Step 4: UI 选择模式按 kind 分支**（`src/ui/render.ts` 选择模式段）

(a) `renderBoard` 的 lane-row 增加 `row.dataset.line = String(line);`

(b) 选择模式渲染分支（现有 `topEffect.prompt` 处理处）：

```ts
    const prompt = topEffect.prompt;
    if (choicePromptId !== topEffect.id) { choicePromptId = topEffect.id; choiceSelected = []; }
    if (prompt.kind === 'select') {
      // —— 现有 select 逻辑（候选卡高亮 + 确认条）保持不变 ——
    } else if (prompt.kind === 'select-line') {
      // 线槽高亮：点击 lane-row 即答 ['line:N']
      for (const row of wrap.querySelectorAll<HTMLElement>('.lane-row')) {
        const ln = Number(row.dataset.line);
        if (prompt.lines?.includes(ln as Line)) {
          row.classList.add('choice-target', 'choice-line');
          row.addEventListener('click', () => {
            choicePromptId = null;
            cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [`line:${ln}`] });
          });
        }
      }
      wrap.appendChild(choiceBar(topEffect, prompt, cb, '点击高亮的线路选择目标线'));
    } else if (prompt.kind === 'select-action') {
      const bar = el('div', 'choice-bar');
      bar.appendChild(el('div', 'choice-title', `${(prompt.chooser ?? topEffect.player) === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
      for (const act of prompt.actions ?? []) {
        const b = el('button', 'btn choice-action-btn', act.replace('action:', ''));
        b.addEventListener('click', () => { choicePromptId = null; cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [act] }); });
        bar.appendChild(b);
      }
      if (prompt.optional) {
        const skip = el('button', 'btn choice-skip', '跳过');
        skip.addEventListener('click', () => { choicePromptId = null; cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [] }); });
        bar.appendChild(skip);
      }
      wrap.appendChild(bar);
    }
```

(c) 顶部标题标签用 `prompt.chooser ?? topEffect.player`（select 分支的现有标签同步改为该表达式）。

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test`（103 + 2 新）、`npm run build`
```bash
git add src/core/models/types.ts src/core/effects/resolve.ts src/ui/render.ts tests/effects/choice-kind.test.ts
git commit -m "feat: choice kinds select-line/select-action with line highlight and action buttons"
```

---

### Task 2: 手牌上限 15 + 布局加宽 + 翻面按钮 restyle

**Files:**
- Modify: `src/ui/render.ts`（renderHand slice 10→15、+N 徽标阈值、挡板最大宽度）
- Modify: `src/ui/styles.css`（#app 加宽、hand-strip、挡板、`.play-btn` restyle、deck 预留位）

**Interfaces:**
- Consumes: 现有手牌扇形布局 / 挡板 / 刷新按钮
- Produces: 手牌显示上限 15；`#app` max-width 2000px、padding 12px 100px；`.play-btn`（翻面按钮）霓虹化；手牌/挡板/刷新按钮在新宽度下重排

- [ ] **Step 1: 实现**（UI 布局任务，无单测，build 门控）

`render.ts` renderHand：
```ts
const shown = (reversed ? [...byValue].reverse() : byValue).slice(0, 15);
...
if (cards.length > 15) { hand.appendChild(el('div', 'hand-more-badge', `+${cards.length - 15}`)); }
```
挡板最大宽度（shield drag 的 `shieldWidth` 上限，搜 `shieldWidth` 赋值处）：`15 * 102 + 130` ≈ 1660 上限（或按现有常数比例调大）。

`styles.css`：
```css
#app { max-width: 2000px; padding: 12px 100px; }
.hand-strip { grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: start; }
```
翻面按钮 restyle（替换 `.play-btn` 相关规则，青色霓虹风格与 `.choice-bar` 一致）：
```css
.play-btn {
  background: #0e1c2a; color: #4ff0ff; border: 1px solid #4ff0ff88;
  border-radius: 6px; font-size: 12px; padding: 4px 12px; cursor: pointer;
  box-shadow: 0 0 8px rgba(79, 240, 255, 0.35); transition: all 0.15s ease;
}
.play-btn:hover { background: #12303f; box-shadow: 0 0 14px rgba(79, 240, 255, 0.7); }
```
（若现有 `.play-btn` 有 hover/弹出等附加规则，保留结构只换配色；确认 `.no-anim` 抑制列表含 `.play-btn`。）

- [ ] **Step 2: 运行确认** — `npm run build`、`npm test` 全绿

- [ ] **Step 3: 提交**

```bash
git add src/ui/render.ts src/ui/styles.css
git commit -m "feat: hand display limit 15, wider app layout, neon flip button"
```

---

### Task 3: 牌库区（deck area）+ 抽牌特效起点联动

**Files:**
- Modify: `src/ui/render.ts`（renderDeck + hand-strip 接入；`data-deck` 标记）
- Modify: `src/main.ts`（playDrawAnimation 起点 = 牌库区 rect）
- Modify: `src/ui/styles.css`（.deck 层叠样式 + 厚度状态 + 中央计数）
- Modify: `src/ui/effects/index.ts`（deckPos 辅助，供牌堆顶打出特效用——Task 4）

**Interfaces:**
- Produces: `.deck`（每玩家一个）：层叠背面卡（层数 = count===0 ? 0 : clamp(ceil(count/4),1,4)），最顶层中央显示剩余数；`deckPos(player)` 取牌库区 rect（供特效起点）
- 抽牌特效起点：`playDrawAnimation` 的 startX 从手牌外侧改为**牌库区外侧**

- [ ] **Step 1: 实现 renderDeck + 样式**

`render.ts`：
```ts
/** 牌库区：多张背面卡层叠（厚度随剩余数），顶层中央显示剩余张数 */
function renderDeck(s: GameState, player: PlayerId): HTMLElement {
  const count = s.players[player].deck.length;
  const layers = count === 0 ? 0 : Math.min(4, Math.ceil(count / 4));
  const deck = el('div', `deck deck-${count === 0 ? 'empty' : layers}`);
  deck.dataset.player = String(player);
  if (layers > 0) {
    const stack = el('div', 'deck-stack');
    for (let i = 0; i < layers; i++) stack.appendChild(el('div', 'deck-back'));
    deck.appendChild(stack);
    deck.appendChild(el('span', 'deck-count', String(count)));
  } else {
    deck.appendChild(el('span', 'deck-count empty', '0'));
  }
  return deck;
}
```
`hand-strip` 渲染：P1 侧 `[deck][refresh][hand]`、P2 侧 `[hand][refresh][deck]`（deck 在最外、refresh 次之、与 refresh 间距 ≥16px）。

`styles.css`：
```css
.deck { position: relative; width: 92px; height: 132px; align-self: center; margin: 0 18px; }
.deck-stack { position: absolute; inset: 0; }
.deck-back {
  position: absolute; inset: 0; border-radius: 5px;
  background: url('/assets/Cardback.jpg') center / cover no-repeat;
  border: 1px solid #223; box-shadow: 0 2px 6px rgba(0,0,0,0.5);
}
.deck-2 .deck-back:nth-child(2) { transform: translate(2px, -2px); }
.deck-3 .deck-back:nth-child(2) { transform: translate(2px, -2px); }
.deck-3 .deck-back:nth-child(3) { transform: translate(4px, -4px); }
.deck-4 .deck-back:nth-child(2) { transform: translate(2px, -2px); }
.deck-4 .deck-back:nth-child(3) { transform: translate(4px, -4px); }
.deck-4 .deck-back:nth-child(4) { transform: translate(6px, -6px); }
.deck-count {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  background: #0a0e1acc; color: #4ff0ff; border: 1px solid #4ff0ff66;
  border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center;
  justify-content: center; font-weight: bold; font-size: 13px; z-index: 2;
}
.deck-count.empty { color: #666; border-color: #444; }
```

- [ ] **Step 2: 抽牌起点联动**（`main.ts` playDrawAnimation）

`startX` 改为牌库区外侧（与手牌生长方向一致）：

```ts
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  const deckRect = deck ? deck.getBoundingClientRect() : null;
  const fromLeft = player === 0;
  const startX = deckRect ? (fromLeft ? deckRect.left - 90 : deckRect.right + 90)
    : (fromLeft ? rect.left - 90 : rect.right + 90);
```

- [ ] **Step 3: 运行确认 + 提交**

Run: `npm run build`、`npm test`
```bash
git add src/ui/render.ts src/main.ts src/ui/styles.css
git commit -m "feat: deck area with thickness states and count; draw FX starts at deck"
```

---

### Task 4: playTopDeck op + 牌堆顶打出特效

**Files:**
- Modify: `src/core/models/types.ts`（Op 增加 playTopDeck）
- Modify: `src/core/effects/resolve.ts`（executeOp case）
- Modify: `src/ui/effects/index.ts`（card:deck-played → 幽灵卡从牌库区飞入目标链路末尾；deckPos）
- Create: `tests/effects/play-top-deck.test.ts`

**Interfaces:**
- Produces: `{ op: 'playTopDeck'; line: Line; faceUp: boolean }`——从效果拥有者牌堆顶取牌，按"打出"语义浮空落地（目标顶卡"被盖住前"先结算；faceUp=false 不结算中指令）；发 `card:deck-played`（payload: uid/defId/faceUp/owner/line）
- 生成器前置守卫：`ctx.s.players[ctx.player].deck.length === 0` 时跳过（fizzle，不抛错）

- [ ] **Step 1: 写失败测试** `tests/effects/play-top-deck.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1, advanceToStep } from '../helpers';

describe('playTopDeck op', () => {
  it('takes the deck top and lands it face-down in the line', () => {
    const s = draftFireP1();
    const top = s.players[0].deck[s.players[0].deck.length - 1];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'playTopDeck', line: 1, faceUp: false };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(top.zone).toBe('field');
    expect(top.line).toBe(1);
    expect(top.faceUp).toBe(false);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toContain(top.uid);
    expect(s.players[0].deck.length).toBe(17);
  });
});
```

- [ ] **Step 2: 运行确认失败** — RED（op 不存在）

- [ ] **Step 3: 实现**

`types.ts` Op 增加：`| { op: 'playTopDeck'; line: Line; faceUp: boolean }`

`resolve.ts` executeOp case（放在 shift 后）：

```ts
    case 'playTopDeck': {
      const p = s.players[pe.player];
      const card = p.deck.pop();
      if (!card) throw new Error('deck is empty');
      card.zone = 'float';
      card.faceUp = op.faceUp;
      card.line = op.line;
      card.pos = null;
      s.pendingPlay = card;
      const stack = p.stacks[op.line];
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
        if (t) resolveTrigger(s, t);
      }
      emitCardEvent(s, 'card:deck-played', card, { line: op.line });
      break;
    }
```
（`collectTriggerFor`/`resolveTrigger` 已 import。）

`effects/index.ts`：订阅 `card:deck-played` → 幽灵卡从 `deckPos(owner)` 飞入目标链路末尾（复用 playShift 的平移逻辑，起点改为牌库区）：
```ts
case 'card:deck-played': {
  if (payload.owner === undefined || payload.line === null) break;
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${payload.owner}"]`);
  const from = deck ? deck.getBoundingClientRect() : null;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const target = stackEndPos(slot, payload.owner);
  if (!from || !target) break;
  const clone = buildFxCard(node, payload, BASE_Z);  // node 为牌库区？无 data-uid —— 需从 deck rect 构建
  ...
}
```
> 注：`card:deck-played` 无 DOM 卡节点（牌在牌堆顶未渲染为卡）——FX 直接用牌库区 rect 作为起点构建幽灵卡（`buildFxCard` 需要一个 node；改为传入牌库区元素即可，payload 提供 defId/faceUp）。实现时用牌库区元素作为 node 参数。

- [ ] **Step 4: 运行确认通过** — GREEN + 全量

- [ ] **Step 5: 提交**

```bash
git add src/core/models/types.ts src/core/effects/resolve.ts src/ui/effects/index.ts tests/effects/play-top-deck.test.ts
git commit -m "feat: playTopDeck op with deck-to-line fly FX"
```

---

### Task 5: reveal-hand（light-4 用）+ 幽灵牌上限联动

**Files:**
- Modify: `src/ui/render.ts`（reveal 幽灵渲染在 15 张上限下不变；确认 `handEndPos`/抽牌查询已排除 `.reveal-ghost`）
- Create: `tests/effects/reveal-hand.test.ts`

**Interfaces:**
- Consumes: reveal op（已实现）、revealedGhosts 渲染（已实现）
- Produces: 循环 reveal 生成器模式（供 light-4/psychic-0 用）；测试：多张 reveal 生成多个幽灵、对手回合结束全部清除

- [ ] **Step 1: 写失败测试** `tests/effects/reveal-hand.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { draftFireP1 } from '../helpers';

describe('reveal-hand (loop reveal)', () => {
  it('revealing a whole hand creates one ghost per card, cleared at opponent turn end', () => {
    const s = draftFireP1();
    const oppHand = s.players[1].hand.map((c) => c.uid);
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        for (const uid of oppHand) yield { op: 'reveal', uid };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.revealedGhosts).toHaveLength(oppHand.length);
    // 对手回合结束后清除（由 turn.ts 已实现，快速验证）
  });
});
```

- [ ] **Step 2: 运行** — 应直接 PASS（机制已就绪；若 PASS 也保留作为回归）

- [ ] **Step 3: 确认幽灵牌渲染在 15 上限下不溢出**（`renderHand` 幽灵追加在 15 张真卡之后；15 张 + 幽灵的极端情况人工验证；若溢出则把幽灵渲染改为 `display: flex` 换行或缩小——本轮以 15 上限为准，不溢出验证通过即可）

- [ ] **Step 4: 提交**

```bash
git add tests/effects/reveal-hand.test.ts
git commit -m "test: reveal-hand loop creates per-card ghosts"
```

---

### Task 6: Light 6 卡效果（3a 主体）

**Files:**
- Create: `src/core/effects/cards/light.ts`
- Modify: `src/core/effects/resolve.ts`（补 `import './cards/light';`）
- Create: `tests/effects/light.test.ts`

**Interfaces:**
- Consumes: Task 1（select-line/select-action/chooser）、Task 4（playTopDeck）、reveal op
- Produces: `light-0..5` 注册（light-1 = end 触发**必选**；light-2 用 `chooser` 交给被揭示卡持有者）

- [ ] **Step 1: 写失败测试** `tests/effects/light.test.ts`（核心用例）

```ts
import { describe, it, expect } from 'vitest';
import type { Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftLightP1, advanceToStep } from '../helpers';
```

> **helpers 新增** `draftLightP1()`：与 `draftFireP1` 同构，P1 第 1 选 `light`（P1 协议线 0 = light）。加到 `tests/helpers.ts`。

用例（每卡至少一个）：
- light-0：打 light-0 → 翻目标（分值 3 的牌）→ 抽 3
- light-1：场上 light-1 到结束阶段 → **必选**抽 1（无跳过；`resolve-trigger` 后 `resolveAllChoices`）
- light-2：揭示一张反面牌 → `chooser` 为被揭示卡持有者（P2 应答 `action:flip` 或 `action:skip`）
- light-3：本线全部反面牌移到目标线（select-line）
- light-4：对手手牌全部产生幽灵牌（`revealedGhosts` 数量 = 对手手牌数）
- light-5：弃 1

- [ ] **Step 2: 运行确认失败** — RED（light 未注册）

- [ ] **Step 3: 实现** `src/core/effects/cards/light.ts`

```ts
import type { EffectCtx, EffectGen, EffectStep, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';

function* light0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'light-0：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return;
  const picked = targets.find((c) => c.uid === ans.selected[0]);
  yield { op: 'flip', uid: ans.selected[0] };
  if (picked) yield { op: 'draw', count: Number(picked.label) };
}

function* light1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

function* light2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  // 揭示 1 张反面牌（可选目标：场上任意反面顶卡；fizzle 时无候选自动跳过）
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const r = yield { kind: 'select', title: 'light-2：揭示1张反面牌', min: 1, max: 1, optional: false, candidates: facedown };
  if (r.selected.length === 0) return;
  const revealed = facedown.find((c) => c.uid === r.selected[0]);
  yield { op: 'reveal', uid: r.selected[0] };
  // 被揭示卡持有者决定：翻转 / 平移 / 跳过
  const chooser = revealed?.owner ?? ctx.player;
  const act = yield { kind: 'select-action', title: 'light-2：你可以平移或翻转那张牌', min: 1, max: 1, optional: true, candidates: [], actions: ['action:flip', 'action:shift'], chooser };
  if (act.selected.length === 0) return;
  if (act.selected[0] === 'action:flip') yield { op: 'flip', uid: r.selected[0] };
  // action:shift → 平移需选目标线（light-2 平移该牌到任意其他线）
  if (act.selected[0] === 'action:shift') {
    const line = yield { kind: 'select-line', title: 'light-2：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line) as Line[], chooser };
    if (line.selected.length > 0) {
      yield { op: 'shift', uid: r.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line };
    }
  }
}

function* light3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const srcLine = ctx.card.line!;
  const line = yield { kind: 'select-line', title: 'light-3：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== srcLine) as Line[] };
  if (line.selected.length === 0) return;
  const target = Number(line.selected[0].replace('line:', '')) as Line;
  // 反复平移本线最顶的反面牌（含被覆盖的反面牌——先移开其上的牌? 否：allowCovered 直接移）
  // 简化：循环取本线堆叠中"最靠上的反面牌"平移（allowCovered），直到无反面包
  const s = ctx.s;
  const stack = s.players[ctx.player].stacks[srcLine];
  for (;;) {
    const idx = [...stack].reverse().findIndex((c) => !c.faceUp);
    if (idx === -1) break;
    const card = stack[stack.length - 1 - idx];
    yield { op: 'shift', uid: card.uid, targetLine: target, allowCovered: true };
  }
}

function* light4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp = ctx.s.players[ctx.player === 0 ? 1 : 0];
  for (const card of [...opp.hand]) yield { op: 'reveal', uid: card.uid };
}

function* light5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'light-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('light-0', { middle: light0 });
registerCardEffects('light-1', { triggers: { end: { fn: light1End, optional: false } } });
registerCardEffects('light-2', { middle: light2 });
registerCardEffects('light-3', { middle: light3 });
registerCardEffects('light-4', { middle: light4 });
registerCardEffects('light-5', { middle: light5 });
```

`resolve.ts` 补 `import './cards/light';`（与 fire 并列）。

> **依赖说明**：light-3 的 `allowCovered` shift 与 light-2 的 `chooser` 依赖 Task 1 的 `chooser` 字段（Task 1 已含）与 Task 8 的 `allowCovered`（本任务先按"op 已支持可选 allowCovered"实现——**顺序调整**：Task 8 的 `allowCovered` 移到本任务前或一并实现，见 Task 8 注）。

- [ ] **Step 4: 运行确认通过** — GREEN + 全量

- [ ] **Step 5: 提交**

```bash
git add src/core/effects/cards/light.ts src/core/effects/resolve.ts tests/effects/light.test.ts tests/helpers.ts
git commit -m "feat: light protocol 6-card effects"
```

---

### Task 7: valueModifier 顶命令数值修正引擎

**Files:**
- Modify: `src/core/models/types.ts`（CardEffects.valueModifier）
- Modify: `src/core/state/create.ts`（stackValue 应用修正）
- Create: `tests/state/valuemodifier.test.ts`

**Interfaces:**
- Produces: `CardEffects.valueModifier?: { target: 'own-stack' | 'opponent-line'; apply(s, owner, line, total): number }`；`stackValue` 对本线双方堆叠注册的修正卡应用（own-stack 只作用于拥有者总值、opponent-line 只作用于对手总值）

- [ ] **Step 1: 写失败测试** `tests/state/valuemodifier.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { stackValue } from '../../src/core/state/create';
import { registerCardEffects } from '../../src/core/effects/registry';
import { makeCard, draftFireP1 } from '../helpers';

describe('valueModifier engine', () => {
  it('applies own-stack modifier (darkness-2: face-down cards count 4)', () => {
    registerCardEffects('darkness-2', {
      valueModifier: {
        target: 'own-stack',
        apply: (s, owner, line, total) => {
          const stack = s.players[owner].stacks[line];
          const fd = stack.filter((c) => !c.faceUp).length;
          return total + fd * 2; // 反面 2 → 4
        },
      },
    });
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('fire-1', 0, 'field', false, 0, 0), makeCard('fire-5', 0, 'field', true, 0, 1)];
    expect(stackValue(s.players[0], 0)).toBe(4 + 5); // 反面 4 + 正面 5
    delete (registerCardEffects as unknown as Record<string, unknown>).darkness2Fix;
  });
});
```
> 注：此测试直接注册 darkness-2 的修正（正式注册在 Task 9 的 darkness.ts）；测试内注册后需清理，避免污染——用 `EFFECTS` 直接删除或在 Task 9 注册后改测正式注册。实现时可把 darkness-2 的修正注册放本任务（先在 cards/darkness.ts 里只注册 valueModifier，Task 9 补全效果）。

- [ ] **Step 2: 运行确认失败** — RED（valueModifier 不存在）

- [ ] **Step 3: 实现**

`types.ts` CardEffects 增加：

```ts
  /** 顶命令数值修正：stackValue 计算该线总值时应用（target: own-stack 作用于拥有者总值；opponent-line 作用于对手同线总值） */
  valueModifier?: {
    target: 'own-stack' | 'opponent-line';
    apply(s: GameState, owner: PlayerId, line: Line, total: number): number;
  };
```

`create.ts` stackValue（引入 `EFFECTS`）：

```ts
import { EFFECTS } from '../effects/registry';

export function stackValue(s: GameState, player: PlayerId, line: Line): number {
  const p = s.players[player];
  let total = 0;
  for (const card of p.stacks[line]) {
    total += card.faceUp ? getCardDef(card.defId).value : 2;
  }
  const opp = player === 0 ? 1 : 0;
  for (const owner of [player, opp] as PlayerId[]) {
    for (const card of s.players[owner].stacks[line]) {
      const v = EFFECTS[card.defId]?.valueModifier;
      if (!v) continue;
      if (v.target === 'own-stack' && owner === player) total = v.apply(s, owner, line, total);
      if (v.target === 'opponent-line' && owner !== player) total = v.apply(s, owner, line, total);
    }
  }
  return total;
}
```
（`getLineValue` 已包 `stackValue`，控制权/编译判定自动受益。）

- [ ] **Step 4: 运行确认通过** — GREEN + 全量

- [ ] **Step 5: 提交**

```bash
git add src/core/models/types.ts src/core/state/create.ts tests/state/valuemodifier.test.ts
git commit -m "feat: valueModifier engine (own-stack / opponent-line) in stackValue"
```

---

### Task 8: 覆盖卡目标（coveredAllowed）+ fizzle 回归

**Files:**
- Modify: `src/core/models/types.ts`（CandidateFilter.covered；Op 的 shift/delete/return/flip 加可选 `allowCovered`）
- Modify: `src/core/effects/context.ts`（listCandidates covered 分支）
- Modify: `src/core/effects/resolve.ts`（executeOp 按 allowCovered 跳过 isUncovered）
- Create: `tests/effects/covered.test.ts`

**Interfaces:**
- Produces: `CandidateFilter.covered?: boolean`（true 时列出该侧堆叠全部卡含被覆盖，排除结算中源卡）；op 可选 `allowCovered`（true 时跳过 isUncovered 校验）；**fizzle 回归**：无覆盖卡时 select 候选为空自动跳过（不死锁）

- [ ] **Step 1: 写失败测试** `tests/effects/covered.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { listCandidates } from '../../src/core/effects/context';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1 } from '../helpers';

describe('covered targeting', () => {
  it('listCandidates with covered:true includes covered cards', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const all = listCandidates(s, { zone: 'field', covered: true });
    expect(all.some((c) => c.pos === 0)).toBe(true); // 被覆盖的底层也列出
  });

  it('shift with allowCovered moves a covered card (fizzles if none covered)', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const covered = s.players[1].stacks[0][0];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'shift', uid: covered.uid, targetLine: 1, allowCovered: true };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(covered.zone).toBe('field');
    expect(covered.line).toBe(1);
    expect(s.players[1].stacks[0]).toHaveLength(1);
    expect(s.players[1].stacks[1]).toHaveLength(1);
  });

  it('select with covered candidates empty fizzles (no deadlock)', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0)]; // 无被覆盖卡
    let ran = false;
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        const c = yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: listCandidates(s, { zone: 'field', covered: true, owner: 1 }) };
        ran = true;
        void c;
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.pendingEffects).toHaveLength(0);
    expect(ran).toBe(false); // 空候选被 fizzle 跳过，生成器未继续
  });
});
```

- [ ] **Step 2: 运行确认失败** — RED（covered 不存在）

- [ ] **Step 3: 实现**

`types.ts`：
```ts
export interface CandidateFilter { zone: 'hand' | 'field'; owner?: PlayerId; covered?: boolean }
// Op 中 shift/delete/return/flip 增加可选字段：
// | { op: 'shift'; uid: string; targetLine: Line; allowCovered?: boolean }
// | { op: 'delete'; uid: string; allowCovered?: boolean }
// | { op: 'return'; uid: string; allowCovered?: boolean }
// | { op: 'flip'; uid: string; allowCovered?: boolean }
```

`context.ts` listCandidates field 分支：
```ts
  for (const p of s.players) {
    if (filter.owner !== undefined && p !== s.players[filter.owner]) continue;
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      if (stack.length === 0) continue;
      if (filter.covered) {
        for (const c of stack) {
          if (resolving.has(c.uid)) continue;
          out.push(toChoiceCard(c));
        }
      } else {
        const top = stack[stack.length - 1];
        if (resolving.has(top.uid)) continue;
        out.push(toChoiceCard(top));
      }
    }
  }
```

`resolve.ts` executeOp：shift/delete/return/flip 的 `isUncovered` 校验改为 `if (!op.allowCovered && !isUncovered(s, card)) throw ...`（4 处）。

- [ ] **Step 4: 运行确认通过** — GREEN + 全量（fizzle 回归用例通过）

- [ ] **Step 5: 提交**

```bash
git add src/core/models/types.ts src/core/effects/context.ts src/core/effects/resolve.ts tests/effects/covered.test.ts
git commit -m "feat: covered-card targeting (candidates covered, op allowCovered) with fizzle regression"
```

---

### Task 9: Darkness 6 卡效果（3b 主体）

**Files:**
- Create: `src/core/effects/cards/darkness.ts`
- Modify: `src/core/effects/resolve.ts`（补 `import './cards/darkness';`）
- Create: `tests/effects/darkness.test.ts`

**Interfaces:**
- Consumes: Task 1（select-line）、Task 4（playTopDeck）、Task 7（valueModifier）、Task 8（covered/allowCovered）
- Produces: `darkness-0..5` 注册（darkness-2 同时注册 valueModifier 与 middle）

- [ ] **Step 1: 写失败测试** `tests/effects/darkness.test.ts`（核心用例：darkness-0 无覆盖卡 fizzle、darkness-2 数值修正、darkness-3 牌堆顶打出、darkness-4 平移反面卡、darkness-1 翻+可选平移、darkness-5 弃）

- [ ] **Step 2: 运行确认失败** — RED

- [ ] **Step 3: 实现** `src/core/effects/cards/darkness.ts`

```ts
import type { EffectCtx, EffectGen, EffectStep, StepResult, Line } from '../../models/types';
import { registerCardEffects } from '../registry';

function* darkness0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 3 };
  const covered = ctx.candidates({ zone: 'field', owner: ctx.player === 0 ? 1 : 0, covered: true });
  const ans = yield { kind: 'select', title: 'darkness-0：平移1张你对手的被盖住的牌', min: 1, max: 1, optional: false, candidates: covered };
  if (ans.selected.length === 0) return; // 无覆盖卡：fizzle（runStack 已跳过空候选，双保险）
  yield { op: 'shift', uid: ans.selected[0], targetLine: ctx.card.line!, allowCovered: true };
}

function* darkness1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' }).filter((c) => c.owner !== ctx.player);
  const ans = yield { kind: 'select', title: 'darkness-1：翻转1张你对手的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return;
  yield { op: 'flip', uid: ans.selected[0] };
  const line = yield { kind: 'select-line', title: 'darkness-1：你可以平移那张牌', min: 1, max: 1, optional: true, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line) as Line[] };
  if (line.selected.length > 0) {
    yield { op: 'shift', uid: ans.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line };
  }
}

function* darkness2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => c.line === ctx.card.line && !c.faceUp);
  const ans = yield { kind: 'select', title: 'darkness-2：你可以翻转1张此列的反面牌', min: 1, max: 1, optional: true, candidates: facedown };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}
// darkness-2 顶命令数值修正（own-stack：此栈反面牌分值=4）
const darkness2Modifier = {
  target: 'own-stack' as const,
  apply: (s: GameState, owner: PlayerId, line: Line, total: number): number => {
    const stack = s.players[owner].stacks[line];
    const fd = stack.filter((c) => !c.faceUp).length;
    return total + fd * 2;
  },
};

function* darkness3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = yield { kind: 'select-line', title: 'darkness-3：在另一列反面打出', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line) as Line[] };
  if (line.selected.length === 0) return;
  if (ctx.s.players[ctx.player].deck.length === 0) return; // 空牌库：fizzle
  yield { op: 'playTopDeck', line: Number(line.selected[0].replace('line:', '')) as Line, faceUp: false };
}

function* darkness4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'darkness-4：平移1张反面牌', min: 1, max: 1, optional: false, candidates: facedown };
  if (ans.selected.length === 0) return;
  const line = yield { kind: 'select-line', title: 'darkness-4：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== (ctx.s.players[0].stacks.flat().find((c) => c.uid === ans.selected[0])?.line ?? ctx.card.line)) as Line[] };
  if (line.selected.length > 0) {
    yield { op: 'shift', uid: ans.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line };
  }
}

function* darkness5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'darkness-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('darkness-0', { middle: darkness0 });
registerCardEffects('darkness-1', { middle: darkness1 });
registerCardEffects('darkness-2', { middle: darkness2Middle, valueModifier: darkness2Modifier });
registerCardEffects('darkness-3', { middle: darkness3 });
registerCardEffects('darkness-4', { middle: darkness4 });
registerCardEffects('darkness-5', { middle: darkness5 });
```
> 注：`GameState`/`PlayerId` 类型需在文件头 import（`import type { GameState, PlayerId } from '../../models/types'`）。darkness-4 的源线查找较繁琐，可简化为 select-line 的 lines 过滤用 `ctx.card.line`（若被平移卡在别线则目标线包含源线也合法——实现时取舍，测试断言为准）。

- [ ] **Step 4: 运行确认通过** — GREEN + 全量

- [ ] **Step 5: 提交**

```bash
git add src/core/effects/cards/darkness.ts src/core/effects/resolve.ts tests/effects/darkness.test.ts
git commit -m "feat: darkness protocol 6-card effects (incl. valueModifier top command)"
```

---

### Task 10: 协议额外特效 + 已编译特效 + 收尾

**Files:**
- Modify: `src/ui/styles.css`（`.compiled-fx-light` / `.compiled-fx-darkness` 已编译特效；`choice-line` 线高亮样式）
- Modify: `src/ui/effects/index.ts`（light/darkness 的 `triggerProtocol` 额外特效——先 CSS 简易版，Gemini 提示词可选）
- Modify: `docs/stage2-effects-fire.md` / 全局记忆（阶段 3 完成状态）
- 全量验证 + 提交（**不推送**）

**Interfaces:**
- Produces: light/darkness 已编译特效（纯 CSS，参考 fire 岩浆环的 `.compiled-ring` 骨架：`compiled-ring-light`（柔光白青脉冲边框）、`compiled-ring-darkness`（暗紫光晕））；light/darkness 触发弃/删的额外特效（简易 CSS：light=白色柔光、darkness=暗紫粒子）——如需要更精致可另发 Gemini 提示词

- [ ] **Step 1: 已编译特效 CSS**（追加到 styles.css，复用 `.compiled-ring` 骨架）

```css
/* light：已编译 = 柔光白青脉冲边框 */
.compiled-ring-light .compiled-ring-flow { background: conic-gradient(from 0deg, #fff8e1, #b3e5fc, #4ff0ff, #fff8e1); filter: drop-shadow(0 0 6px rgba(180, 240, 255, 0.8)); }
.compiled-ring-light .lava-seg { background: linear-gradient(90deg, #ffffff, #b3e5fc, #4ff0ff); box-shadow: 0 0 6px rgba(180, 240, 255, 0.8); }
.compiled-ring-light .rock-dark { background: #e8f4ff; }
.compiled-ring-light .rock-red { background: #aee6ff; }
/* darkness：已编译 = 暗紫光晕边框 */
.compiled-ring-darkness .compiled-ring-flow { background: conic-gradient(from 0deg, #4a148c, #7b1fa2, #ab47bc, #4a148c); filter: drop-shadow(0 0 6px rgba(171, 71, 188, 0.8)); }
.compiled-ring-darkness .lava-seg { background: linear-gradient(90deg, #ab47bc, #7b1fa2, #4a148c); box-shadow: 0 0 6px rgba(171, 71, 188, 0.7); }
.compiled-ring-darkness .rock-dark { background: #1a0524; }
.compiled-ring-darkness .rock-red { background: #6a1b9a; }
/* 线选择高亮 */
.choice-line { outline: 2px dashed #4ff0ff; outline-offset: -3px; background: rgba(79, 240, 255, 0.05); cursor: pointer; }
```

- [ ] **Step 2: light/darkness 额外特效**（`src/ui/effects/index.ts` 的 extra 分支扩展）

```ts
    if (payload.triggerProtocol === 'fire') {
      playFireBurnExtra(node, payload);
    } else if (payload.triggerProtocol === 'light') {
      playLightExtra(node, payload);   // 简易：白色柔光层
    } else if (payload.triggerProtocol === 'darkness') {
      playDarknessExtra(node, payload); // 简易：暗紫粒子
    }
```
（两个简易特效：在 EXTRA_Z 克隆上挂 `extra-light`/`extra-darkness` 类 + 少量 CSS 动画节点；实现从简，先保证有区分度的视觉。）

- [ ] **Step 3: 全量验证**

Run: `npm test`（全绿）、`npm run build`、`git status` 干净

- [ ] **Step 4: 交接文档与全局记忆**

- `docs/stage2-effects-fire.md` 更新：阶段 3 完成状态（Light/Darkness 12 卡、choice kinds、valueModifier、covered、playTopDeck、牌库区、手牌 15、翻面按钮、已编译特效 light/darkness）
- `E:\studyE\Deepseek memory\compile-web-project.md`：追加阶段 3 条目

- [ ] **Step 5: 提交（不推送）**

```bash
git add -A
git commit -m "docs: stage 3 complete (Light/Darkness pilot)"
```

---

## Self-Review（计划自审）

- **覆盖**：设计文档 §2.1→Task 1；§2.2→Task 7；§2.3→Task 8；§2.4→Task 4；§2.5→Task 2+5；§2.6→Task 3；§2.7→Task 2；§3 Light→Task 6；§4 Darkness→Task 9；§5→Task 10；§6 测试→各任务
- **依赖顺序**：Task 6（Light）需要 Task 1（chooser/select-action）+ Task 8（allowCovered——light-3）+ Task 4（light-3 无 playTopDeck；light-2 用 shift）；**若 Task 8 未完成则 Light 的 light-3 会缺 allowCovered**——实施时按 1→2→3→4→5→**8**→6→7→9→10 执行（把 Task 8 提前到 Task 6 之前）
- **既有测试风险**：`stackValue` 修改后既有 stack 测试（`tests/state/create.test.ts` 等）应不受影响（无 valueModifier 注册时行为不变）；`tests/helpers.ts` 新增 `draftLightP1`
- **潜在坑**：light-3 循环 shift 覆盖卡（allowCovered 移出堆叠中部）与 darkness-4 源线推导——实现时以测试断言为准，必要时简化（如 darkness-4 的 select-line 用 `ctx.card.line` 作为唯一排除线）
