# 阶段 2：效果引擎 + Fire 协议试点 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立通用卡牌命令结算引擎（生成器挂起 + LIFO 连锁 + 触发系统 + 偏转浮空），实现 Fire 协议 6 张卡全部真实效果，并接入火焰特效注册表。

**Architecture:** 引擎核心在 `src/core/effects/`（types / context / resolve / triggers / registry / cards/fire），效果写成生成器函数，需要玩家选择时 `yield` 选择请求，引擎保存挂起点暂停、`executeAction('effect-choice')` 恢复；触发/连锁通过效果栈 LIFO 结算；操作（弃/删/回手/翻/抽/偏转）经 `gameBus` 发语义事件，UI 侧特效层订阅。`GameState` 新增 `pendingEffects/pendingPlay/pendingShift/resolvedTriggerUids/pendingStepAdvance`。

**Tech Stack:** TypeScript 7.0.2 strict、Vitest 4.1.11（pool: 'threads'）、Vite 8.2.2。无新依赖。

## Global Constraints

- **不要修改 `vite.config.ts` 的 `test.pool`**（必须保持 `'threads'`，沙箱无法 spawn 子进程）
- **禁止运行 `npm install` / `npm ci`**（node_modules 里有 vite 补丁，重装后丢失导致 EPERM）
- 测试命令：`npm test`（全量）或 `npx vitest run tests/effects/<file>.test.ts`（定向）
- 测试文件在 `tests/<sub>/` 下的，import 一律 `'../../src/...'`（两层）；`tests/helpers.ts` 用 `'../src/...'`（一层）——**这是本仓库反复出错的点，务必逐字核对**
- TypeScript strict：不引入 `any`；不改动既有 53 个测试的语义（Task 9 允许为火效果适配，见任务说明）
- 每任务结束提交一次，commit message 用 `feat:` / `fix:` / `test:` / `refactor:` 前缀
- 卡牌效果注册采用**显式注册**（`registerCardEffects`），不解析中文文本判定 optional（阅读卡牌文本后人工标注）

---

### Task 1: 效果类型与 GameState 新字段

**Files:**
- Modify: `src/core/models/types.ts`
- Modify: `src/core/state/create.ts`
- Create: `tests/effects/state.test.ts`

**Interfaces:**
- Produces: `Zone` 增加 `'float'`；`TriggerKind`；`ChoiceCard`；`ChoiceRequest`；`ChoiceAnswer`；`Op`；`EffectStep`（注意：既有 `Step` 是回合步骤类型，效果步骤命名为 `EffectStep` 避免冲突）；`StepResult`；`PendingEffect`；`TriggerEntry`；`CandidateFilter`；`EffectCtx`；`EffectGen`；`TriggerDef`；`CardEffects`；`GameState` 新增 5 字段（`pendingEffects` / `pendingPlay: Card | null` / `pendingShift: Card | null` / `resolvedTriggerUids` / `pendingStepAdvance`）。后续所有任务依赖这些名字，不得改名。

- [ ] **Step 1: 写失败测试** `tests/effects/state.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/core/state/create';

describe('effect state fields', () => {
  it('initializes effect engine fields', () => {
    const s = createGame();
    expect(s.pendingEffects).toEqual([]);
    expect(s.pendingPlay).toBeNull();
    expect(s.pendingShift).toBeNull();
    expect(s.resolvedTriggerUids).toEqual([]);
    expect(s.pendingStepAdvance).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/state.test.ts`
Expected: FAIL（`pendingEffects` 不存在，TS 编译错误）

- [ ] **Step 3: 实现类型与字段**

`src/core/models/types.ts` 修改：

```ts
export type Zone = 'hand' | 'deck' | 'field' | 'trash' | 'float';

/** 触发种类：被盖住前 / 结束 / 开始 / XX后（连锁；试点未用 after，机制预留） */
export type TriggerKind = 'before-covered' | 'end' | 'start' | 'after';

/** 选择候选卡（供 UI 渲染） */
export interface ChoiceCard {
  uid: string;
  defId: string;
  faceUp: boolean;
  owner: PlayerId;
  zone: Zone;
  line: Line | null;
  pos: number | null;
  label: string;
}

/** 选择请求（生成器 yield 的值之一） */
export interface ChoiceRequest {
  kind: 'select';
  title: string;
  min: number;
  max: number;
  optional: boolean;
  candidates: ChoiceCard[];
}

export interface ChoiceAnswer {
  selected: string[];
}

/** 效果操作（生成器 yield 的值之一；由运行器执行并触发连锁/语义事件） */
export type Op =
  | { op: 'discard'; uid: string }
  | { op: 'delete'; uid: string }
  | { op: 'return'; uid: string }
  | { op: 'flip'; uid: string }
  | { op: 'draw'; count: number }
  | { op: 'shift'; uid: string; targetLine: Line };

/** 效果步骤：选择请求 或 操作。既有 types.ts 已占用 Step（回合步骤），此处命名 EffectStep */
export type EffectStep = ChoiceRequest | Op;

/** 生成器 next() 的入参：选择答案 或 操作结果（操作无返回值） */
export type StepResult = ChoiceAnswer | Record<string, never>;

/** 效果栈元素：一个挂起的生成器 */
export interface PendingEffect {
  id: string;
  player: PlayerId;
  gen: Generator<EffectStep, void, StepResult>;
  sourceUid: string;
  sourceDefId: string;
  prompt: ChoiceRequest | null;
  lastAnswer: ChoiceAnswer | null;
}

/** 待结算触发条目（getLegalActions 供 UI 出按钮） */
export interface TriggerEntry {
  cardUid: string;
  defId: string;
  kind: TriggerKind;
  optional: boolean;
}

/** 候选过滤：zone 'hand' 需 owner；'field' 列出双方所有堆叠顶卡（排除结算中源卡） */
export interface CandidateFilter {
  zone: 'hand' | 'field';
  owner?: PlayerId;
}

/** 效果上下文：生成器通过 ctx.candidates() 获取候选，ctx 持有状态引用 */
export interface EffectCtx {
  s: GameState;
  player: PlayerId;
  card: Card;
  candidates(filter: CandidateFilter): ChoiceCard[];
}

export type EffectGen = (ctx: EffectCtx) => Generator<EffectStep, void, StepResult>;

export interface TriggerDef {
  fn: EffectGen;
  optional: boolean;
}

export interface CardEffects {
  middle?: EffectGen;
  triggers?: Partial<Record<TriggerKind, TriggerDef>>;
}
```

`GameState` 接口新增字段（`src/core/models/types.ts`）：

```ts
export interface GameState {
  phase: Phase;
  draftRound: number;
  draftPicks: ProtocolDef[];
  turnPlayer: PlayerId;
  step: Step;
  compiledThisTurn: boolean;
  players: [PlayerState, PlayerState];
  control: -1 | PlayerId;
  winner: PlayerId | null;
  log: string[];
  /** 效果栈：长度 0 = 无挂起；>0 时顶部为待应答选择 */
  pendingEffects: PendingEffect[];
  /** 打出中的卡（浮空，等"被盖住前"结算后落地）；null = 无 */
  pendingPlay: Card | null;
  /** 偏转中的卡（浮空，等露出卡结算后落地）；null = 无 */
  pendingShift: Card | null;
  /** 本 end/start 步骤已结算的触发卡 uid（避免重复结算） */
  resolvedTriggerUids: string[];
  /** 打出链式结算完毕后需要推进回合步骤（runStack 栈空时消费） */
  pendingStepAdvance: boolean;
}
```

`src/core/state/create.ts` 的 `createGame` 返回对象追加：

```ts
    pendingEffects: [],
    pendingPlay: null,
    pendingShift: null,
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/state.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/models/types.ts src/core/state/create.ts tests/effects/state.test.ts
git commit -m "feat: effect engine types and GameState fields"
```

---

### Task 2: 事件总线单例

**Files:**
- Modify: `src/core/events/bus.ts`
- Create: `tests/effects/bus.test.ts`

**Interfaces:**
- Consumes: 既有 `createBus()` / `GameEvent`（保持 `GameEvent` 不变：`{ type, state, payload? }`，发射时 state 字段可省略传 `s`）
- Produces: `export const gameBus: EventBus`——所有语义事件（`card:discarded` 等）经它发射，UI 特效层订阅

- [ ] **Step 1: 写失败测试** `tests/effects/bus.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { gameBus } from '../../src/core/events/bus';

describe('gameBus singleton', () => {
  it('delivers emitted events to subscribers and unsubscribes', () => {
    const fn = vi.fn();
    const off = gameBus.subscribe(fn);
    gameBus.emit({ type: 'card:discarded', payload: { uid: 'x' } });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ type: 'card:discarded' }));
    off();
    gameBus.emit({ type: 'card:discarded', payload: { uid: 'y' } });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/bus.test.ts`
Expected: FAIL（`gameBus` 不存在）

- [ ] **Step 3: 实现单例**

`src/core/events/bus.ts` 文件末尾追加：

```ts
/** 全局游戏事件总线单例：引擎发语义事件（card:discarded 等），UI 特效层订阅 */
export const gameBus = createBus();
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/bus.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/events/bus.ts tests/effects/bus.test.ts
git commit -m "feat: gameBus event bus singleton"
```

---

### Task 3: 效果栈运行器核心（context / resolve / registry / triggers 最小版 + discard·draw 操作）

**Files:**
- Create: `src/core/effects/context.ts`
- Create: `src/core/effects/resolve.ts`
- Create: `src/core/effects/registry.ts`
- Create: `src/core/effects/triggers.ts`
- Create: `tests/helpers.ts`
- Create: `tests/effects/runner.test.ts`

**Interfaces:**
- Consumes: Task 1 全部类型；`drawCards`/`discardFromHand`（`src/core/engine/deck`）；`getCardDef`（`src/data/demo`）；`advanceStep`（`src/core/engine/turn`）；`gameBus`
- Produces:
  - `context.ts`: `nextEffectId()`、`findCard(s, uid): Card | undefined`（含浮空卡）、`isUncovered(s, card): boolean`、`listCandidates(s, filter): ChoiceCard[]`、`createCtx(s, player, card): EffectCtx`、`emitCardEvent(s, type, card, extra?)`
  - `resolve.ts`: `pushMiddle(s, player, card)`（仅入栈）、`resolveMiddle(s, player, card)`（入栈 + runStack）、`answerEffect(s, promptId, selected)`、`runStack(s)`、`executeOp(s, pe, op)`（本轮实现 discard/draw，其余 case 抛"not implemented"）
  - `registry.ts`: `EFFECTS: Record<string, CardEffects>`、`registerCardEffects(defId, effects)`
  - `triggers.ts`（最小版）：`collectTriggerFor(s, card, kind): TriggerEntry | null`、`resolveTrigger(s, t)`（入栈）
  - `tests/helpers.ts`: `resolveAllChoices(s, pick)`、`pickFirst(prompt)`、`draftFireP1()`、`advanceToStep(s, player, step)`、`makeCard(defId, owner?, zone?, faceUp?, line?, pos?)`

- [ ] **Step 1: 写失败测试与测试助手** `tests/helpers.ts`

```ts
import type { Card, ChoiceRequest, GameState, Line, PlayerId, Step, Zone } from '../src/core/models/types';
import { createGame, getDraftPool, performDraftPick } from '../src/core/state/create';
import { answerEffect } from '../src/core/effects/resolve';
import { executeAction } from '../src/core/game';

/** 循环应答所有挂起选择（含连锁新产生的），直到效果栈清空 */
export function resolveAllChoices(s: GameState, pick: (prompt: ChoiceRequest) => string[]): void {
  for (;;) {
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (!top || !top.prompt) return;
    answerEffect(s, top.id, pick(top.prompt));
  }
}

/** 默认选择器：可选事件跳过；必选事件取前 max 个候选（fire-4 会全选，测试可接受） */
export function pickFirst(prompt: ChoiceRequest): string[] {
  if (prompt.optional) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

/** 草案：P1 第 1 选 fire（P1 协议线 0 = fire），其余自动选池中第一个非 fire */
export function draftFireP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'fire');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'fire') ?? avail[0]).defId);
  }
  return s;
}

/** 推进到指定步骤（起始手牌下堆叠为空，不会触发强制编译） */
export function advanceToStep(s: GameState, player: PlayerId, step: Step): void {
  while (s.phase === 'turn' && s.step !== step) executeAction(s, player, 'advance');
}

let testUid = 0;
export function makeCard(
  defId: string,
  owner: PlayerId = 0,
  zone: Zone = 'field',
  faceUp = true,
  line: Line | null = null,
  pos = 0,
): Card {
  testUid += 1;
  return { uid: `tc${testUid}`, defId, owner, faceUp, zone, line, pos: zone === 'field' ? pos : null };
}
```

`tests/effects/runner.test.ts`（失败测试）：

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { resolveAllChoices, pickFirst } from '../helpers';

/** 直接构造一个测试生成器入栈（sourceUid='src' 需先放在场上保证 sourceValid） */
function pushTestEffect(s: GameState, gen: Generator<EffectStep, void, StepResult>): void {
  s.pendingEffects.push({
    id: 'e1', player: 0, gen, sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null,
  });
  runStack(s);
}

function base(): GameState {
  const s = createGame();
  s.phase = 'turn';
  s.players[0].stacks[0] = [{
    uid: 'src', defId: 'fire-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 0,
  }];
  s.players[0].hand.push({
    uid: 'h1', defId: 'fire-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null,
  });
  // draw 操作需要牌库有牌（否则抽 0 / 洗回弃牌堆），种子 2 张
  s.players[0].deck = [
    { uid: 'd1', defId: 'fire-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
    { uid: 'd2', defId: 'fire-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
  ];
  return s;
}

const handCandidates = () => [
  { uid: 'h1', defId: 'fire-1', faceUp: true, owner: 0 as const, zone: 'hand' as const, line: null, pos: null, label: '1' },
];

describe('effect stack runner', () => {
  it('suspends on a select step and resumes with the answer', () => {
    const s = base();
    let got: string[] = [];
    function* gen(): Generator<EffectStep, void, StepResult> {
      const a = (yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: handCandidates() }) as { selected: string[] };
      got = a.selected;
      yield { op: 'draw', count: 1 };
    }
    pushTestEffect(s, gen());
    expect(s.pendingEffects).toHaveLength(1);
    expect(s.pendingEffects[0].prompt?.title).toBe('t');
    answerEffect(s, 'e1', ['h1']);
    expect(got).toEqual(['h1']);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(2); // draw 1 已执行
  });

  it('rejects answers outside [min,max] and unknown uids', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: handCandidates() };
    }
    pushTestEffect(s, gen());
    expect(() => answerEffect(s, 'e1', [])).toThrow(/at least 1/);
    expect(() => answerEffect(s, 'e1', ['nope'])).toThrow(/invalid selection/);
    expect(() => answerEffect(s, 'wrong-id', ['h1'])).toThrow(/mismatch/);
  });

  it('terminates a suspended effect whose source card is covered', () => {
    const s = base();
    let drew = false;
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: handCandidates() };
      drew = true;
      yield { op: 'draw', count: 1 };
    }
    pushTestEffect(s, gen());
    expect(s.pendingEffects[0].prompt).not.toBeNull();
    // 挂起期间源卡被覆盖
    s.players[0].stacks[0].push({
      uid: 'cover', defId: 'fire-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 1,
    });
    answerEffect(s, 'e1', ['h1']);
    expect(drew).toBe(false); // 剩余效果终止
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('discard op moves hand card to trash face-up; draw op draws', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'discard', uid: 'h1' };
      yield { op: 'draw', count: 2 };
    }
    pushTestEffect(s, gen());
    // 链结算后：h1 已弃（不在手牌），抽 2 张 → 手牌 2 张
    expect(s.players[0].hand.map((c) => c.uid)).not.toContain('h1');
    expect(s.players[0].trash.map((c) => c.uid)).toEqual(['h1']);
    expect(s.players[0].trash[0].faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('drain branch lands a pendingPlay card when the stack empties', () => {
    const s = base();
    const card = s.players[0].hand[0];
    s.players[0].hand.splice(0, 1);
    card.zone = 'float';
    card.line = 0;
    card.pos = null;
    s.pendingPlay = card;
    s.players[0].stacks[0] = []; // 落地目标线为空（base 的 'src' 只是 sourceValid 用）
    runStack(s);
    expect(s.pendingPlay).toBeNull();
    expect(card.zone).toBe('field');
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]);
  });

  it('resolveAllChoices drains a full chain including nested selects', () => {
    const s = base();
    s.players[0].hand.push({ uid: 'h2', defId: 'fire-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select', title: 'a', min: 1, max: 1, optional: false, candidates: handCandidates() };
      yield { kind: 'select', title: 'b', min: 1, max: 1, optional: false, candidates: handCandidates() };
    }
    pushTestEffect(s, gen());
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/runner.test.ts`
Expected: FAIL（`../src/core/effects/resolve` 等模块不存在，编译错误）

- [ ] **Step 3: 实现核心模块**

`src/core/effects/registry.ts`：

```ts
import type { CardEffects } from '../models/types';

/** 卡牌效果注册表：defId → 中指令/触发效果（Fire 效果在 cards/fire.ts 注册） */
export const EFFECTS: Record<string, CardEffects> = {};

export function registerCardEffects(defId: string, effects: CardEffects): void {
  EFFECTS[defId] = effects;
}
```

`src/core/effects/context.ts`：

```ts
import type { Card, ChoiceCard, EffectCtx, GameState, Line, PlayerId, CandidateFilter } from '../models/types';
import { getCardDef } from '../../data/demo';
import { gameBus } from '../events/bus';

let effectIdCounter = 0;
export function nextEffectId(): string {
  effectIdCounter += 1;
  return `e${effectIdCounter}`;
}

/** 全状态查找卡牌（含浮空中的 pendingPlay/pendingShift 卡） */
export function findCard(s: GameState, uid: string): Card | undefined {
  if (s.pendingPlay?.uid === uid) return s.pendingPlay;
  if (s.pendingShift?.uid === uid) return s.pendingShift;
  for (const p of s.players) {
    for (const zone of ['hand', 'deck', 'trash'] as const) {
      const c = p[zone].find((x) => x.uid === uid);
      if (c) return c;
    }
    for (const line of [0, 1, 2] as Line[]) {
      const c = p.stacks[line].find((x) => x.uid === uid);
      if (c) return c;
    }
  }
  return undefined;
}

/** 是否为其堆叠顶卡（未被覆盖；仅场上卡有意义） */
export function isUncovered(s: GameState, card: Card): boolean {
  if (card.zone !== 'field' || card.line === null) return false;
  const stack = s.players[card.owner].stacks[card.line];
  return stack[stack.length - 1]?.uid === card.uid;
}

function toChoiceCard(c: Card): ChoiceCard {
  const def = getCardDef(c.defId);
  return {
    uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner,
    zone: c.zone, line: c.line, pos: c.pos, label: String(def.value),
  };
}

/** 候选列表：手牌（指定 owner）或场上双方所有堆叠顶卡（排除结算中源卡——幽灵状态防护） */
export function listCandidates(s: GameState, filter: CandidateFilter): ChoiceCard[] {
  const resolving = new Set(s.pendingEffects.map((pe) => pe.sourceUid));
  const out: ChoiceCard[] = [];
  if (filter.zone === 'hand') {
    const p = s.players[filter.owner!];
    for (const c of p.hand) out.push(toChoiceCard(c));
    return out;
  }
  for (const p of s.players) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      if (stack.length === 0) continue;
      const top = stack[stack.length - 1];
      if (resolving.has(top.uid)) continue;
      out.push(toChoiceCard(top));
    }
  }
  return out;
}

export function createCtx(s: GameState, player: PlayerId, card: Card): EffectCtx {
  return { s, player, card, candidates: (filter) => listCandidates(s, filter) };
}

/** 发语义事件（特效层订阅；payload 含 protocol 供协议命名空间分发） */
export function emitCardEvent(
  s: GameState,
  type: string,
  card: Card,
  extra?: Record<string, unknown>,
): void {
  gameBus.emit({
    state: s,
    type,
    payload: {
      uid: card.uid, defId: card.defId, protocol: card.defId.split('-')[0],
      owner: card.owner, faceUp: card.faceUp, zone: card.zone,
      line: card.line, pos: card.pos, ...extra,
    },
  });
}
```

`src/core/effects/triggers.ts`（最小版；Task 7 扩展 collectTriggers）：

```ts
import type { Card, GameState, TriggerEntry, TriggerKind } from '../models/types';
import { EFFECTS } from './registry';
import { createCtx, findCard, nextEffectId } from './context';

/** 单卡触发查找（被盖住前 / 落地检查用）；未注册 → null */
export function collectTriggerFor(s: GameState, card: Card, kind: TriggerKind): TriggerEntry | null {
  const def = EFFECTS[card.defId]?.triggers?.[kind];
  if (!def) return null;
  return { cardUid: card.uid, defId: card.defId, kind, optional: def.optional };
}

/** 触发效果入栈（调用方需 runStack；本函数只 push） */
export function resolveTrigger(s: GameState, t: TriggerEntry): void {
  const card = findCard(s, t.cardUid);
  const def = EFFECTS[t.defId]?.triggers?.[t.kind];
  if (!card || !def) return;
  const ctx = createCtx(s, card.owner, card);
  s.pendingEffects.push({
    id: nextEffectId(), player: card.owner,
    gen: def.fn(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    prompt: null, lastAnswer: null,
  });
}
```

`src/core/effects/resolve.ts`：

```ts
import type { Card, GameState, Line, Op, PendingEffect, PlayerId, StepResult } from '../models/types';
import { drawCards, discardFromHand } from '../engine/deck';
import { advanceStep } from '../engine/turn';
import { gameBus } from '../events/bus';
import { createCtx, emitCardEvent, findCard, isUncovered, nextEffectId } from './context';
import { collectTriggerFor, resolveTrigger } from './triggers';
import { EFFECTS } from './registry';
import './cards/fire'; // 副作用：注册 Fire 效果（Task 9 创建该文件；在此之前为空导入需注释，见 Step 3 注）

function topEffect(s: GameState): PendingEffect | undefined {
  return s.pendingEffects[s.pendingEffects.length - 1];
}

/** 效果源卡是否仍有效：在场、正面、未被覆盖；否则剩余效果终止 */
function sourceValid(s: GameState, pe: PendingEffect): boolean {
  const card = findCard(s, pe.sourceUid);
  return card !== undefined && card.zone === 'field' && card.faceUp && isUncovered(s, card);
}

/** 打出/翻正/揭开触发中指令：入栈（LIFO 由 runStack 统一结算） */
export function pushMiddle(s: GameState, player: PlayerId, card: Card): void {
  const eff = EFFECTS[card.defId]?.middle;
  if (!eff) return;
  const ctx = createCtx(s, player, card);
  s.pendingEffects.push({
    id: nextEffectId(), player,
    gen: eff(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    prompt: null, lastAnswer: null,
  });
}

export function resolveMiddle(s: GameState, player: PlayerId, card: Card): void {
  pushMiddle(s, player, card);
  runStack(s);
}

/** 应答挂起选择：校验后恢复生成器继续结算 */
export function answerEffect(s: GameState, promptId: string, selected: string[]): void {
  const pe = topEffect(s);
  if (!pe || pe.prompt === null) throw new Error(`no pending choice "${promptId}"`);
  if (pe.id !== promptId) throw new Error(`prompt id mismatch: ${promptId}`);
  const req = pe.prompt;
  if (selected.length < req.min) throw new Error(`requires at least ${req.min} selection(s)`);
  if (selected.length > req.max) throw new Error(`requires at most ${req.max} selection(s)`);
  for (const uid of selected) {
    if (!req.candidates.some((c) => c.uid === uid)) throw new Error(`invalid selection: ${uid}`);
  }
  pe.prompt = null;
  pe.lastAnswer = { selected };
  runStack(s);
}

/** 效果栈主循环：结算栈顶；栈空时完成挂起的落地/偏转落地/步骤推进 */
export function runStack(s: GameState): void {
  for (;;) {
    while (s.pendingEffects.length > 0) {
      const pe = topEffect(s)!;
      if (!sourceValid(s, pe)) {
        s.pendingEffects.pop();
        s.log.push(`效果终止：${pe.sourceDefId} 被覆盖/翻面/移除`);
        continue;
      }
      const result: StepResult = pe.lastAnswer ?? {};
      const r = pe.gen.next(result);
      if (r.done) { s.pendingEffects.pop(); continue; }
      const step = r.value;
      // 'kind' in step 窄化（Op 无 kind 属性，strict 下 step.kind 不合法）
      if ('kind' in step) {
        pe.prompt = step;
        pe.lastAnswer = null;
        return; // 挂起：等待玩家选择
      }
      executeOp(s, pe, step);
    }
    if (s.pendingPlay) { completePlay(s); continue; }
    if (s.pendingShift) { completeShift(s); continue; }
    if (s.pendingStepAdvance) {
      s.pendingStepAdvance = false;
      advanceStep(s);
      continue;
    }
    return;
  }
}

/** 操作执行（Task 4 加 flip、Task 5 加 delete/return、Task 6 加 shift） */
export function executeOp(s: GameState, pe: PendingEffect, op: Op): void {
  switch (op.op) {
    case 'discard': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot discard ${op.uid}: not in hand`);
      discardFromHand(s, pe.player, op.uid);
      emitCardEvent(s, 'card:discarded', card);
      break;
    }
    case 'draw': {
      drawCards(s, pe.player, op.count);
      gameBus.emit({ state: s, type: 'card:drawn', payload: { player: pe.player, count: op.count } });
      break;
    }
    default:
      throw new Error(`op not implemented: ${(op as Op).op}`);
  }
}

/** 落牌（"被盖住前"触发先结算，然后落地 + 中指令） */
function completePlay(s: GameState): void {
  const card = s.pendingPlay!;
  const p = s.players[card.owner];
  const stack = p.stacks[card.line!];
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) { resolveTrigger(s, t); return; }
  }
  card.zone = 'field';
  card.pos = stack.length;
  stack.push(card);
  s.pendingPlay = null;
  emitCardEvent(s, 'card:played', card);
  if (card.faceUp) pushMiddle(s, card.owner, card);
}

/** 偏转落地（目标顶卡"被盖住前"先结算，然后落地） */
function completeShift(s: GameState): void {
  const card = s.pendingShift!;
  const p = s.players[card.owner];
  const stack = p.stacks[card.line!];
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) { resolveTrigger(s, t); return; }
  }
  card.zone = 'field';
  card.pos = stack.length;
  stack.push(card);
  s.pendingShift = null;
  emitCardEvent(s, 'card:landed', card);
}
```

> **Step 3 注**：`import './cards/fire'` 引用的文件在本任务尚不存在。为保持本任务可编译，先**不写这一行**，改在 Task 9 添加（resolve.ts 的 `import './cards/fire'` 由 Task 9 补上）；本任务的 EFFECTS 为空注册表，`pushMiddle` 对任何卡都直接返回，行为与预期一致。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/runner.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 全量回归**

Run: `npm test`
Expected: 53 + 新增全绿

- [ ] **Step 6: 提交**

```bash
git add src/core/effects/ tests/effects/runner.test.ts tests/helpers.ts
git commit -m "feat: effect stack runner core (suspend/resume/termination, discard/draw ops)"
```

---

### Task 4: flip 操作 + 翻正 LIFO 连锁

**Files:**
- Modify: `src/core/effects/resolve.ts`（executeOp 加 flip case）
- Create: `tests/effects/flip.test.ts`

**Interfaces:**
- Consumes: `pushMiddle`（翻正时入栈连锁）
- Produces: `executeOp` 支持 `{ op: 'flip', uid }`：校验在场且未覆盖 → 翻转 → 若翻正则 `pushMiddle(s, card.owner, card)`（LIFO：新效果先于触发者剩余步骤结算）

- [ ] **Step 1: 写失败测试** `tests/effects/flip.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';
import { createGame } from '../../src/core/state/create';

// 注册合成卡：翻正后中指令抽 1 张
registerCardEffects('test-flip', {
  middle: function* (): Generator<EffectStep, void, StepResult> {
    yield { op: 'draw', count: 1 };
  },
});

function base(): GameState {
  const s = createGame();
  s.phase = 'turn';
  s.players[0].stacks[0] = [
    makeCard('test-flip', 0, 'field', true, 0, 0),
    makeCard('test-flip', 0, 'field', false, 0, 1),
  ];
  // 效果源卡 'src'（sourceValid 要求在场且未覆盖；放独立线，不影响线 0 的覆盖断言）
  s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-flip', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
  // 中指令 draw 需要牌库有牌
  s.players[0].deck = [makeCard('test-flip', 0, 'deck'), makeCard('test-flip', 0, 'deck')];
  return s;
}

describe('flip op', () => {
  it('flips a face-down card face-up and resolves its middle (LIFO before outer effect)', () => {
    const s = base();
    const order: string[] = [];
    function* outer(): Generator<EffectStep, void, StepResult> {
      yield { op: 'flip', uid: s.players[0].stacks[0][1].uid };
      order.push('outer-after-flip');
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: outer(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    // flip 翻正 → test-flip 中指令入栈 → 先结算（draw 1）→ 外层继续
    expect(order).toEqual(['outer-after-flip']);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].stacks[0][1].faceUp).toBe(true);
  });

  it('rejects flipping a covered card', () => {
    const s = base();
    function* outer(): Generator<EffectStep, void, StepResult> {
      yield { op: 'flip', uid: s.players[0].stacks[0][0].uid }; // 底层被覆盖
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: outer(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    expect(() => runStack(s)).toThrow(/covered/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/flip.test.ts`
Expected: FAIL（flip case 抛 "op not implemented"）

- [ ] **Step 3: 实现 flip case**（`src/core/effects/resolve.ts` 的 executeOp 中，`case 'draw'` 之后插入）

```ts
    case 'flip': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot flip ${op.uid}: not on field`);
      if (!isUncovered(s, card)) throw new Error(`cannot flip ${op.uid}: covered card`);
      card.faceUp = !card.faceUp;
      emitCardEvent(s, 'card:flipped', card);
      if (card.faceUp) pushMiddle(s, card.owner, card); // 翻正 → 中指令连锁（LIFO）
      break;
    }
```

同时删除 `default: throw new Error('op not implemented...')` 分支（此时 switch 已覆盖 discard/draw/flip；delete/return/shift 仍需 default 兜底——保留 default 但仅对 delete/return/shift 生效，改为：

```ts
    case 'delete':
    case 'return':
    case 'shift':
      throw new Error(`op not implemented: ${op.op}`);
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/flip.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/effects/resolve.ts tests/effects/flip.test.ts
git commit -m "feat: flip op with face-up middle LIFO chain"
```

---

### Task 5: delete/return 操作 + 揭开触发

**Files:**
- Modify: `src/core/effects/resolve.ts`（executeOp 加 delete/return case；新增导出 `revealAfterRemoval`）
- Create: `tests/effects/delete.test.ts`

**Interfaces:**
- Produces: `revealAfterRemoval(s, owner, line)`：顶卡被移除后，若新顶卡正面朝上则 `pushMiddle`（被揭开 → 中指令连锁；编译除外——编译走 `executeCompile` 不经过此函数）
- `executeOp` 支持 `{ op: 'delete', uid }`（→ 持有者弃牌堆，正面朝上）与 `{ op: 'return', uid }`（→ 持有者手牌，保持正反面）

- [ ] **Step 1: 写失败测试** `tests/effects/delete.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard } from '../helpers';
import { createGame } from '../../src/core/state/create';

registerCardEffects('test-reveal', {
  middle: function* (): Generator<EffectStep, void, StepResult> {
    yield { op: 'draw', count: 1 };
  },
});

function base(): GameState {
  const s = createGame();
  s.phase = 'turn';
  s.players[0].stacks[0] = [
    makeCard('test-reveal', 0, 'field', true, 0, 0), // 底层：被揭开 → 中指令
    makeCard('fire-1', 0, 'field', true, 0, 1),      // 顶层：被删除
  ];
  // 效果源卡 'src'（sourceValid 要求在场且未覆盖；放独立线）
  s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
  // 露出卡中指令 draw 需要牌库有牌
  s.players[0].deck = [makeCard('test-reveal', 0, 'deck'), makeCard('test-reveal', 0, 'deck')];
  return s;
}

describe('delete/return ops with reveal', () => {
  it('delete removes top card and reveals the card below (middle resolves)', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'delete', uid: s.players[0].stacks[0][1].uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].trash.map((c) => c.defId)).toEqual(['fire-1']);
    expect(s.players[0].hand).toHaveLength(1); // 露出卡中指令 draw 1
  });

  it('return moves top card to owner hand (reveals below)', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'return', uid: s.players[0].stacks[0][1].uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(2); // 回手 1 + 露出卡 draw 1
    expect(s.players[0].stacks[0]).toHaveLength(1);
  });

  it('reveal does not trigger when the card below is face-down', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-reveal', 0, 'field', false, 0, 0), // 反面：不触发
      makeCard('fire-1', 0, 'field', true, 0, 1),
    ];
    // 效果源卡 'src'
    s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'delete', uid: s.players[0].stacks[0][1].uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/delete.test.ts`
Expected: FAIL（delete/return 抛 "op not implemented"）

- [ ] **Step 3: 实现 delete/return + revealAfterRemoval**（`src/core/effects/resolve.ts`）

executeOp 中把 `case 'delete': case 'return': case 'shift':` 的兜底拆开：

```ts
    case 'delete': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot delete ${op.uid}: not on field`);
      if (!isUncovered(s, card)) throw new Error(`cannot delete ${op.uid}: covered card`);
      const owner = card.owner;
      const line = card.line!;
      s.players[owner].stacks[line].pop();
      card.zone = 'trash';
      card.faceUp = true;
      card.line = null;
      card.pos = null;
      s.players[owner].trash.push(card);
      emitCardEvent(s, 'card:deleted', card);
      revealAfterRemoval(s, owner, line);
      break;
    }
    case 'return': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot return ${op.uid}: not on field`);
      if (!isUncovered(s, card)) throw new Error(`cannot return ${op.uid}: covered card`);
      const owner = card.owner;
      const line = card.line!;
      s.players[owner].stacks[line].pop();
      card.zone = 'hand';
      card.line = null;
      card.pos = null;
      s.players[owner].hand.push(card);
      emitCardEvent(s, 'card:returned', card);
      revealAfterRemoval(s, owner, line);
      break;
    }
    case 'shift':
      throw new Error(`op not implemented: shift`);
```

文件末尾新增导出：

```ts
/** 顶卡移除后：新顶卡正面朝上则触发其中指令（被揭开连锁；编译不经过此函数，符合"编译不触发文本"） */
export function revealAfterRemoval(s: GameState, owner: PlayerId, line: Line): void {
  const stack = s.players[owner].stacks[line];
  const top = stack[stack.length - 1];
  if (top && top.faceUp) pushMiddle(s, owner, top);
}
```

（`resolve.ts` 顶部 import 需补 `Line` 类型——已由 Task 3 引入，核对 `import type { ..., Line, ... }` 存在。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/delete.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/effects/resolve.ts tests/effects/delete.test.ts
git commit -m "feat: delete/return ops with reveal-on-uncover chain"
```

---

### Task 6: shift 操作 + 浮空状态机

**Files:**
- Modify: `src/core/effects/resolve.ts`（executeOp 加 shift case）
- Create: `tests/effects/shift.test.ts`

**Interfaces:**
- Produces: `executeOp` 支持 `{ op: 'shift', uid, targetLine }`：校验在场/未覆盖/目标≠源线 → 移出源堆叠 → `zone='float'`、`line=targetLine`（提交目标，落地前不可变卦）、`pos=null`、`s.pendingShift=card` → 发 `card:shifted`（含 fromLine）→ `revealAfterRemoval`（源线露出卡中指令）→ 栈空时 `completeShift` 落地（目标顶卡"被盖住前"先结算）

- [ ] **Step 1: 写失败测试** `tests/effects/shift.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard } from '../helpers';
import { createGame } from '../../src/core/state/create';

registerCardEffects('test-reveal', {
  middle: function* (): Generator<EffectStep, void, StepResult> {
    yield { op: 'draw', count: 1 };
  },
});

describe('shift op (float state machine)', () => {
  it('shifts top card to target line: float -> reveal below -> land on target', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-reveal', 0, 'field', true, 0, 0), // 露出 → 中指令 draw 1
      makeCard('fire-1', 0, 'field', true, 0, 1),      // 被偏转
    ];
    // 效果源卡 'src'（放独立线，不被偏转影响）
    s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
    // 露出卡中指令 draw 需要牌库有牌
    s.players[0].deck = [makeCard('test-reveal', 0, 'deck'), makeCard('test-reveal', 0, 'deck')];
    const shifted = s.players[0].stacks[0][1];
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'shift', uid: shifted.uid, targetLine: 1 };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.pendingShift).toBeNull();
    expect(shifted.zone).toBe('field');
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([shifted.uid]);
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].hand).toHaveLength(1); // 露出卡中指令已结算
  });

  it('rejects shift to the same line and shift of a covered card', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-reveal', 0, 'field', true, 0, 0),
      makeCard('fire-1', 0, 'field', true, 0, 1),
    ];
    // 效果源卡 'src'
    s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
    const covered = s.players[0].stacks[0][0];
    function* gen1(): Generator<EffectStep, void, StepResult> {
      yield { op: 'shift', uid: covered.uid, targetLine: 1 }; // 被覆盖卡不可偏转
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen1(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    expect(() => runStack(s)).toThrow(/covered/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/shift.test.ts`
Expected: FAIL（shift 抛 "op not implemented"）

- [ ] **Step 3: 实现 shift case**（`src/core/effects/resolve.ts` 的 executeOp 中替换 `case 'shift': throw ...`）

```ts
    case 'shift': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot shift ${op.uid}: not on field`);
      if (!isUncovered(s, card)) throw new Error(`cannot shift ${op.uid}: covered card`);
      if (op.targetLine === card.line) throw new Error('must shift to a different line');
      const owner = card.owner;
      const fromLine = card.line!;
      s.players[owner].stacks[fromLine].pop();
      card.zone = 'float';
      card.line = op.targetLine; // 提交目标（落地前不可变卦）
      card.pos = null;
      s.pendingShift = card;
      emitCardEvent(s, 'card:shifted', card, { fromLine });
      revealAfterRemoval(s, owner, fromLine);
      break;
    }
```

（此时 switch 无 default 兜底分支，全部 op 已实现；确认 delete/return 的 `case 'shift': throw` 已被替换。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/shift.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/effects/resolve.ts tests/effects/shift.test.ts
git commit -m "feat: shift op with committed float state machine"
```

---

### Task 7: 触发系统完整化（collectTriggers + end/start 检测）

**Files:**
- Modify: `src/core/effects/triggers.ts`（新增 `collectTriggers(s, kind): TriggerEntry[]`）
- Modify: `src/core/engine/turn.ts`（进入 end/start 时重置 `resolvedTriggerUids`）
- Create: `tests/effects/triggers.test.ts`

**Interfaces:**
- Produces: `collectTriggers(s, kind)`：遍历双方场上正面未覆盖顶卡，取注册表 `triggers[kind]`，跳过 `resolvedTriggerUids`，返回 `TriggerEntry[]`
- `advanceStep`：`next === 'end' || next === 'start'` 时 `s.resolvedTriggerUids = []`

- [ ] **Step 1: 写失败测试** `tests/effects/triggers.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard } from '../helpers';
import { createGame } from '../../src/core/state/create';
import { advanceStep } from '../../src/core/engine/turn';

// 合成结束触发卡：可选（"你可以"），效果抽 1 张
registerCardEffects('test-end', {
  triggers: {
    end: {
      optional: true,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});
// 合成必选开始触发卡
registerCardEffects('test-start', {
  triggers: {
    start: {
      optional: false,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});

describe('trigger collection', () => {
  it('collects end triggers from face-up uncovered top cards, skipping resolved uids', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [makeCard('test-end', 0, 'field', true, 0, 0)];
    s.players[0].stacks[1] = [makeCard('test-end', 0, 'field', true, 1, 0)];
    s.players[1].stacks[0] = [makeCard('test-end', 1, 'field', true, 0, 0)]; // 对手的也算
    s.resolvedTriggerUids = [s.players[0].stacks[1][0].uid];
    const ts = collectTriggers(s, 'end');
    expect(ts).toHaveLength(2);
    expect(ts.map((t) => t.optional)).toEqual([true, true]);
  });

  it('does not collect triggers from face-down or covered cards', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-end', 0, 'field', false, 0, 0), // 反面
      makeCard('test-end', 0, 'field', true, 0, 1),  // 顶层正面
    ];
    const ts = collectTriggers(s, 'end');
    expect(ts).toHaveLength(1);
    expect(ts[0].cardUid).toBe(s.players[0].stacks[0][1].uid);
  });

  it('resolveTrigger runs the trigger effect', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [makeCard('test-end', 0, 'field', true, 0, 0)];
    // 触发效果 draw 需要牌库有牌
    s.players[0].deck = [makeCard('test-end', 0, 'deck'), makeCard('test-end', 0, 'deck')];
    const t = collectTriggers(s, 'end')[0];
    resolveTrigger(s, t);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('advanceStep resets resolvedTriggerUids when entering end/start', () => {
    const s = createGame();
    s.phase = 'turn';
    s.resolvedTriggerUids = ['x'];
    s.step = 'check-cache';
    advanceStep(s); // → end
    expect(s.resolvedTriggerUids).toEqual([]);
    s.resolvedTriggerUids = ['y'];
    advanceStep(s); // → start（换人）
    expect(s.resolvedTriggerUids).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/triggers.test.ts`
Expected: FAIL（`collectTriggers` 不存在；`advanceStep` 未重置）

- [ ] **Step 3: 实现 collectTriggers 与 advanceStep 重置**

`src/core/effects/triggers.ts` 追加：

```ts
/** 收集某类触发：双方场上正面未覆盖顶卡中注册了该触发的卡（跳过已结算 uid） */
export function collectTriggers(s: GameState, kind: TriggerKind): TriggerEntry[] {
  const out: TriggerEntry[] = [];
  const seen = new Set(s.resolvedTriggerUids);
  for (const p of s.players) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      const top = stack[stack.length - 1];
      if (!top || !top.faceUp || seen.has(top.uid)) continue;
      const def = EFFECTS[top.defId]?.triggers?.[kind];
      if (!def) continue;
      out.push({ cardUid: top.uid, defId: top.defId, kind, optional: def.optional });
    }
  }
  return out;
}
```

（`triggers.ts` 顶部 import 补 `Line`。）

`src/core/engine/turn.ts` 的 `advanceStep` 中，`s.step = next;` 之后追加：

```ts
  if (next === 'end' || next === 'start') {
    s.resolvedTriggerUids = [];
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/effects/triggers.test.ts`
Expected: PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test` → 全绿
```bash
git add src/core/effects/triggers.ts src/core/engine/turn.ts tests/effects/triggers.test.ts
git commit -m "feat: trigger collection (end/start) with resolved-uid tracking"
```

---

### Task 8: playCard 集成（pendingPlay + 被盖住前）

**Files:**
- Modify: `src/core/actions/base.ts`（`playCard`）
- Create: `tests/actions/play-effect.test.ts`

**Interfaces:**
- Consumes: `collectTriggerFor` / `resolveTrigger` / `runStack`（`src/core/effects/...`）
- Produces: `playCard(s, player, cardUid, faceUp, line): Card`——移除手牌 → `zone='float'`、`line=line`（提交）、`s.pendingPlay=card` → 目标堆叠顶卡"被盖住前"触发（若有）入栈 → `runStack`（栈空时 `completePlay` 落地 + 中指令；链式挂起则等待）

- [ ] **Step 1: 写失败测试** `tests/actions/play-effect.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { playCard } from '../../src/core/actions/base';
import { makeCard, draftFireP1 } from '../helpers';

// 被盖住前触发：抽 1 张
registerCardEffects('test-bc', {
  triggers: {
    'before-covered': {
      optional: false,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});

describe('playCard with pendingPlay', () => {
  it('plays face-up onto empty line: lands (no before-covered, no middle registered yet)', () => {
    const s = draftFireP1(); // P1 协议线 0 = fire
    const card = makeCard('fire-5', 0, 'hand');
    s.players[0].hand = [card];
    const ret = playCard(s, 0, card.uid, true, 0);
    expect(ret.zone).toBe('field');
    expect(s.pendingPlay).toBeNull();
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('resolves before-covered trigger of the target top card before landing', () => {
    const s = draftFireP1();
    const top = makeCard('test-bc', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [top];
    const played = makeCard('fire-5', 0, 'hand');
    s.players[0].hand = [played];
    playCard(s, 0, played.uid, true, 0);
    expect(s.pendingPlay).toBeNull();
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([top.uid, played.uid]);
    expect(s.players[0].hand).toHaveLength(1); // before-covered 抽了 1 张
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/actions/play-effect.test.ts`
Expected: FAIL（`playCard` 行为未变：直接落牌，无 pendingPlay / 无触发）

- [ ] **Step 3: 实现 playCard**（`src/core/actions/base.ts` 整体替换 `playCard`）

```ts
import { collectTriggerFor, resolveTrigger } from '../effects/triggers';
import { runStack } from '../effects/resolve';

/** 打出卡牌：正面须匹配协议线；背面任意线。先浮空（pendingPlay），目标顶卡"被盖住前"
 *  触发先结算，栈空后 completePlay 落地；正面卡落地后结算中指令（可连锁/挂起）。 */
export function playCard(s: GameState, player: PlayerId, cardUid: string, faceUp: boolean, line: Line): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand`);
  if (faceUp && !isPlayableFaceUp(s, player, cardUid, line)) {
    throw new Error(`cannot play face-up into line ${line}`);
  }
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'float';
  card.faceUp = faceUp;
  card.line = line;
  card.pos = null;
  s.pendingPlay = card;
  const stack = p.stacks[line];
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) resolveTrigger(s, t);
  }
  runStack(s); // 结算 before-covered（若有）→ 栈空时 completePlay 落地 + 中指令
  return card;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/actions/play-effect.test.ts tests/actions/base.test.ts`
Expected: 新测试 PASS + 既有 base 测试 PASS（base 测试打的牌无注册效果，行为等价）

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test` → 全绿
```bash
git add src/core/actions/base.ts tests/actions/play-effect.test.ts
git commit -m "feat: playCard pendingPlay flow with before-covered trigger"
```

---

### Task 9: Fire 6 张效果注册 + 逐卡测试 + 既有测试适配

**Files:**
- Create: `src/core/effects/cards/fire.ts`
- Modify: `src/core/effects/resolve.ts`（补 `import './cards/fire'`）
- Modify: `tests/game.test.ts`（打牌后如有挂起选择则 `resolveAllChoices`）
- Create: `tests/effects/fire.test.ts`

**Interfaces:**
- Produces: `fire.ts` 模块加载即注册 `fire-0..fire-5` 的 `middle`/`triggers`
- fire-0 中：翻转另1张牌（必选，排除自身/结算中）→ 抽2张；底（被盖住前，必发）：抽1 → 翻转另1张
- fire-1 中：弃1（必选）→ 若弃了删除1张（必选）
- fire-2 中：弃1（必选）→ 若弃了回手1张（必选）
- fire-3 底（结束，可选）：可选弃1（可跳过）→ 若弃了翻转1张（必选）
- fire-4 中：弃≥1（必选，min1 max=手牌数）→ 抽 弃牌数+1
- fire-5 中：弃1（必选）

- [ ] **Step 1: 写失败测试** `tests/effects/fire.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftFireP1, advanceToStep } from '../helpers';

function fireLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'fire');
  return idx as Line;
}

describe('fire protocol effects', () => {
  it('fire-5: discard 1 mandatory', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-5', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'fire-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'fire-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: fireLine(s) });
    // 中指令挂起：选择弃哪张
    expect(s.pendingEffects).toHaveLength(1);
    resolveAllChoices(s, (p) => [other.uid]); // 弃 fire-1，fire-5 留在场上
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([target.uid]);
    expect(s.step).toBe('check-cache'); // 链式结算完毕后自动推进
  });

  it('fire-1: discard then delete (conditional second step)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-1', 0, 'hand'), makeCard('fire-2', 0, 'hand')];
    s.players[1].stacks[0] = [makeCard('fire-1', 1, 'field', true, 0, 0)];
    const victim = s.players[1].stacks[0][0];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-1')!;
    const discardTarget = s.players[0].hand.find((c) => c.defId === 'fire-2')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    const prompts: string[] = [];
    resolveAllChoices(s, (p) => {
      prompts.push(p.title);
      return p.candidates.some((c) => c.uid === victim.uid) ? [victim.uid] : [discardTarget.uid];
    });
    expect(prompts).toEqual(['fire-1：弃1张牌', 'fire-1：删除1张牌']);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([discardTarget.uid]); // 弃掉自己的 fire-2
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([victim.uid]); // 删除对手牌
  });

  it('fire-2: discard then return to owner hand', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-2', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    s.players[1].stacks[0] = [makeCard('fire-2', 1, 'field', true, 0, 0)];
    const victim = s.players[1].stacks[0][0];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-2')!;
    const discardTarget = s.players[0].hand.find((c) => c.defId === 'fire-1')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === victim.uid) ? [victim.uid] : [discardTarget.uid]));
    expect(s.players[1].hand.map((c) => c.uid)).toEqual([victim.uid]); // 回持有者手牌
  });

  it('fire-0 middle: flip another card then draw 2', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    const facedown = makeCard('fire-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === facedown.uid) ? [facedown.uid] : pickFirst(p)));
    expect(facedown.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(2); // 抽 2
  });

  it('fire-0 before-covered: draw 1 and flip another card before being covered', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-0', 0, 'field', true, 0, 0)];
    const facedown = makeCard('fire-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const played = makeCard('fire-1', 0, 'hand');
    const discardTarget = makeCard('fire-5', 0, 'hand');
    s.players[0].hand = [played, discardTarget];
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: true, line: fireLine(s) });
    // 链：fire-0 被盖住前（抽1 + 翻转选择）→ 落地 fire-1 → fire-1 中指令（弃1）
    resolveAllChoices(s, (p) => {
      if (p.candidates.some((c) => c.uid === facedown.uid)) return [facedown.uid];
      return [discardTarget.uid];
    });
    expect(facedown.faceUp).toBe(true);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([s.players[0].stacks[0][0].uid, played.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([discardTarget.uid]);
  });

  it('fire-4: discard 1+ cards, draw discarded+1', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [
      makeCard('fire-4', 0, 'hand'),
      makeCard('fire-1', 0, 'hand'),
      makeCard('fire-2', 0, 'hand'),
    ];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-4')!;
    const discards = s.players[0].hand.filter((c) => c !== card);
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    resolveAllChoices(s, (p) => discards.map((c) => c.uid));
    expect(s.players[0].trash).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(3); // 抽 2+1=3
  });

  it('fire-3 end trigger: optional discard; skipping does nothing', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-3', 0, 'field', true, 0, 0)];
    const hand1 = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [hand1];
    advanceToStep(s, 0, 'end');
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === s.players[0].stacks[0][0].uid);
    expect(t).toBeDefined();
    resolveTrigger(s, t!);
    runStack(s);
    resolveAllChoices(s, pickFirst); // 可选 → 跳过
    expect(s.players[0].hand.map((c) => c.uid)).toEqual([hand1.uid]); // 未弃牌
    expect(s.step).toBe('end');
  });

  it('fire-3 end trigger: discard then flip', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-3', 0, 'field', true, 0, 0)];
    const hand1 = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [hand1];
    const facedown = makeCard('fire-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    advanceToStep(s, 0, 'end');
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === s.players[0].stacks[0][0].uid);
    resolveTrigger(s, t!);
    runStack(s);
    // 第一步：可选弃牌（弃 hand1）；第二步：翻转选择（选 facedown）
    resolveAllChoices(s, (p) => {
      if (p.candidates.some((c) => c.uid === facedown.uid)) return [facedown.uid];
      return [hand1.uid];
    });
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([hand1.uid]); // 弃了
    expect(facedown.faceUp).toBe(true); // 翻转
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/fire.test.ts`
Expected: FAIL（`fire-*` 未注册：打出后无挂起、`resolve-trigger` 行动不存在）

- [ ] **Step 3: 实现 Fire 效果** `src/core/effects/cards/fire.ts`

```ts
import type { EffectCtx, EffectGen, EffectStep, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';

function* fire0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const [t] = yield { kind: 'select', title: 'fire-0：翻转另1张牌', min: 1, max: 1, optional: false, candidates: targets };
  yield { op: 'flip', uid: t.uid };
  yield { op: 'draw', count: 2 };
}

function* fire0BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const targets = ctx.candidates({ zone: 'field' });
  const [t] = yield { kind: 'select', title: 'fire-0（被盖住前）：翻转另1张牌', min: 1, max: 1, optional: false, candidates: targets };
  yield { op: 'flip', uid: t.uid };
}

function* fire1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const [d] = yield { kind: 'select', title: 'fire-1：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  yield { op: 'discard', uid: d.uid };
  const targets = ctx.candidates({ zone: 'field' });
  const [t] = yield { kind: 'select', title: 'fire-1：删除1张牌', min: 1, max: 1, optional: false, candidates: targets };
  yield { op: 'delete', uid: t.uid };
}

function* fire2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const [d] = yield { kind: 'select', title: 'fire-2：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  yield { op: 'discard', uid: d.uid };
  const targets = ctx.candidates({ zone: 'field' });
  const [t] = yield { kind: 'select', title: 'fire-2：回手1张牌', min: 1, max: 1, optional: false, candidates: targets };
  yield { op: 'return', uid: t.uid };
}

function* fire3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-3：你可以弃1张牌', min: 1, max: 1, optional: true, candidates: hand };
  if (ans.selected.length === 0) return; // 跳过
  yield { op: 'discard', uid: ans.selected[0] };
  const targets = ctx.candidates({ zone: 'field' });
  const [t] = yield { kind: 'select', title: 'fire-3：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  yield { op: 'flip', uid: t.uid };
}

function* fire4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-4：弃1张或更多张牌', min: 1, max: hand.length, optional: false, candidates: hand };
  for (const uid of ans.selected) yield { op: 'discard', uid };
  yield { op: 'draw', count: ans.selected.length + 1 };
}

function* fire5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const [d] = yield { kind: 'select', title: 'fire-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  yield { op: 'discard', uid: d.uid };
}

registerCardEffects('fire-0', {
  middle: fire0Middle,
  triggers: { 'before-covered': { fn: fire0BeforeCovered, optional: false } },
});
registerCardEffects('fire-1', { middle: fire1 });
registerCardEffects('fire-2', { middle: fire2 });
registerCardEffects('fire-3', { triggers: { end: { fn: fire3End, optional: true } } });
registerCardEffects('fire-4', { middle: fire4 });
registerCardEffects('fire-5', { middle: fire5 });
```

`src/core/effects/resolve.ts` 顶部 import 区补：

```ts
import './cards/fire';
```

- [ ] **Step 4: 适配既有测试** `tests/game.test.ts`

`plays a card and advances to check-cache` 用例中，`executeAction(s, 0, 'play', ...)` 之后追加：

```ts
    // 打出卡可能触发已注册效果（Fire 试点）：链式选择全部自动应答后再断言
    resolveAllChoices(s, pickFirst);
```

（顶部 import 补 `resolveAllChoices, pickFirst` from `./helpers`。）

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/effects/fire.test.ts tests/game.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: 全量回归 + 提交**

Run: `npm test` → 全绿（检查 tests/actions/base.test.ts 是否有打出火卡的用例需要同样适配；如有，追加 resolveAllChoices）
```bash
git add src/core/effects/cards/fire.ts src/core/effects/resolve.ts tests/effects/fire.test.ts tests/game.test.ts
git commit -m "feat: fire protocol 6-card effects"
```

---

### Task 10: game 门面行动（effect-choice / resolve-trigger + 守卫）

**Files:**
- Modify: `src/core/game.ts`
- Create: `tests/game-effect.test.ts`

**Interfaces:**
- Consumes: `answerEffect` / `resolveTrigger` / `runStack` / `collectTriggers`（effects）
- Produces: `ActionKind` 增加 `'effect-choice' | 'resolve-trigger'`；`LegalAction` 增加 `promptId?` / `choice?`；`getLegalActions` 在效果挂起/落牌中返回 `[]`、end/start 出触发按钮（必选未清空则无 advance）；`executeAction` 重载与守卫（effect-choice 允许对手应答）

- [ ] **Step 1: 写失败测试** `tests/game-effect.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getLegalActions, executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftFireP1, advanceToStep } from '../helpers';

describe('game facade effect actions', () => {
  it('blocks standard actions while a choice is pending', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-5', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-5')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: 0 });
    expect(s.pendingEffects.length).toBeGreaterThan(0);
    expect(getLegalActions(s, 0)).toEqual([]);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/pending/i);
    resolveAllChoices(s, pickFirst);
    expect(getLegalActions(s, 0).some((a) => a.kind === 'advance')).toBe(true);
  });

  it('end step offers resolve-trigger for fire-3 and blocks advance while mandatory', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-3', 0, 'field', true, 0, 0)];
    s.players[0].hand = [];
    advanceToStep(s, 0, 'end');
    const legal = getLegalActions(s, 0);
    // fire-3 结束触发是可选（"你可以"）→ advance 允许跳过
    expect(legal.some((a) => a.kind === 'resolve-trigger' && a.cardUid === s.players[0].stacks[0][0].uid)).toBe(true);
    expect(legal.some((a) => a.kind === 'advance')).toBe(true);
    // 结算该触发（内部可选弃牌——手牌空，跳过）
    executeAction(s, 0, 'resolve-trigger', { cardUid: s.players[0].stacks[0][0].uid });
    resolveAllChoices(s, pickFirst);
    // 触发已结算：不再出现，可 advance
    const legal2 = getLegalActions(s, 0);
    expect(legal2.some((a) => a.kind === 'resolve-trigger')).toBe(false);
    expect(legal2.some((a) => a.kind === 'advance')).toBe(true);
  });

  it('effect-choice validates the chooser (owner of affected card)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-5', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-5')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: 0 });
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top).toBeDefined();
    const discardTarget = s.players[0].hand[0]; // 打出后手牌剩 fire-1
    // 非选择权归属者（P2）应答被拒
    expect(() => executeAction(s, 1, 'effect-choice', { promptId: top!.id, choice: [] })).toThrow(/not your choice/);
    // 选择权归属者（P1）应答成功
    executeAction(s, 0, 'effect-choice', { promptId: top!.id, choice: [discardTarget.uid] });
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([discardTarget.uid]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/game-effect.test.ts`
Expected: FAIL（`effect-choice`/`resolve-trigger` 非合法 kind，`getLegalActions` 未拦挂起）

- [ ] **Step 3: 实现 game.ts**

`ActionKind` 与 `LegalAction` 修改：

```ts
export type ActionKind = 'play' | 'refresh' | 'compile' | 'advance' | 'effect-choice' | 'resolve-trigger';

export interface LegalAction {
  kind: ActionKind;
  line?: Line;
  cardUid?: string;
  faceUp?: boolean;
  promptId?: string;
  choice?: string[];
}
```

`getLegalActions` 整体替换：

```ts
export function getLegalActions(s: GameState, player: PlayerId): LegalAction[] {
  if (s.phase !== 'turn' || s.turnPlayer !== player || s.winner !== null) return [];
  // 效果结算挂起 / 落牌（浮空）中：无标准行动（选择经 UI 直接应答）
  if (s.pendingEffects.length > 0 || s.pendingPlay !== null || s.pendingShift !== null) return [];
  const out: LegalAction[] = [];
  if (s.step === 'action') {
    for (const card of s.players[player].hand) {
      for (const line of [0, 1, 2] as Line[]) {
        const def = getCardDef(card.defId);
        if (def.protocol === s.players[player].protocols[line].defId) {
          out.push({ kind: 'play', cardUid: card.uid, faceUp: true, line });
        }
        out.push({ kind: 'play', cardUid: card.uid, faceUp: false, line });
      }
    }
    if (s.players[player].hand.length < 5) {
      out.push({ kind: 'refresh' });
    }
  } else if (s.step === 'check-compile') {
    for (const line of getCompilableLines(s, player)) {
      out.push({ kind: 'compile', line });
    }
  } else if (s.step === 'end' || s.step === 'start') {
    const kind: 'end' | 'start' = s.step;
    const triggers = collectTriggers(s, kind);
    for (const t of triggers) {
      out.push({ kind: 'resolve-trigger', cardUid: t.cardUid });
    }
    // 必选触发未清空时不允许跳过（advance）
    if (!triggers.some((t) => !t.optional)) {
      out.push({ kind: 'advance' });
    }
    return out; // end/start 的 advance 已处理，不走下方通用逻辑
  }
  const mustRefresh = s.step === 'action' && s.players[player].hand.length === 0;
  if (
    !(s.step === 'check-compile' && getCompilableLines(s, player).length > 0) &&
    !mustRefresh
  ) {
    out.push({ kind: 'advance' });
  }
  return out;
}
```

顶部 import 补：`import { collectTriggers, resolveTrigger } from './effects/triggers';`、`import { answerEffect, runStack } from './effects/resolve';`

`executeAction` 重载追加：

```ts
export function executeAction(s: GameState, player: PlayerId, kind: 'effect-choice', args: { promptId: string; choice: string[] }): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'resolve-trigger', args: { cardUid: string }): void;
```

实现体守卫与 case 修改：

```ts
export function executeAction(s: GameState, player: PlayerId, kind: ActionKind, args?: PlayArgs | { line: Line } | { promptId: string; choice: string[] } | { cardUid: string }): void {
  if (s.phase !== 'turn' || s.winner !== null) throw new Error('game not in turn phase');
  if (s.turnPlayer !== player && kind !== 'effect-choice') throw new Error('not your turn');
  // 效果结算挂起 / 落牌中：只允许应答选择
  if (kind !== 'effect-choice') {
    if (s.pendingEffects.length > 0) throw new Error('resolve pending effect choices first');
    if (s.pendingPlay !== null || s.pendingShift !== null) throw new Error('pending play/shift in progress');
  }

  switch (kind) {
    case 'play': {
      if (!args || !('cardUid' in args)) throw new Error('play requires args');
      playCard(s, player, args.cardUid, args.faceUp, args.line);
      if (s.pendingEffects.length === 0 && s.pendingPlay === null) {
        advanceStep(s);
      } else {
        s.pendingStepAdvance = true; // 链式结算完毕后由 runStack 推进
      }
      break;
    }
    case 'refresh': {
      resetControlIfHeld(s, player);
      refreshHand(s, player);
      advanceStep(s);
      break;
    }
    case 'compile': {
      if (!args) throw new Error('compile requires args.line');
      resetControlIfHeld(s, player);
      executeCompile(s, player, args.line);
      advanceStep(s);
      break;
    }
    case 'effect-choice': {
      if (!args || !('promptId' in args)) throw new Error('effect-choice requires args');
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      if (!top || top.player !== player) throw new Error('not your choice');
      answerEffect(s, args.promptId, args.choice);
      break;
    }
    case 'resolve-trigger': {
      if (!args || !('cardUid' in args)) throw new Error('resolve-trigger requires args');
      const kind: 'end' | 'start' | null = s.step === 'end' ? 'end' : s.step === 'start' ? 'start' : null;
      if (!kind) throw new Error('resolve-trigger only at end/start');
      const t = collectTriggers(s, kind).find((x) => x.cardUid === args.cardUid);
      if (!t) throw new Error(`no pending ${kind} trigger for ${args.cardUid}`);
      s.resolvedTriggerUids.push(args.cardUid);
      resolveTrigger(s, t);
      runStack(s);
      break;
    }
    case 'advance': {
      if (s.step === 'check-compile' && getCompilableLines(s, player).length > 0) {
        throw new Error('compile is mandatory at check-compile');
      }
      if (s.step === 'action' && s.players[player].hand.length === 0) {
        throw new Error('must refresh with no cards in hand');
      }
      if (s.step === 'end' || s.step === 'start') {
        const k: 'end' | 'start' = s.step;
        if (collectTriggers(s, k).some((t) => !t.optional)) {
          throw new Error('mandatory trigger must be resolved');
        }
      }
      if (s.step === 'check-cache') {
        clearCache(s, player);
      }
      if (s.step === 'check-control') {
        checkControl(s);
      }
      advanceStep(s);
      break;
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/game-effect.test.ts tests/game.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test` → 全绿
```bash
git add src/core/game.ts tests/game-effect.test.ts
git commit -m "feat: game facade effect-choice/resolve-trigger actions with guards"
```

---

### Task 11: main.ts 自动推进策略与行动分发

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `collectTriggers`；`state.pendingEffects/pendingPlay/pendingShift`
- Produces: `onAction` 分发 `effect-choice`（chooser = `pendingEffects[top].player`，可能 ≠ turnPlayer）与 `resolve-trigger`；`runAutoAdvance` 暂停条件：挂起选择 / 落牌中 / end·start 有待结算触发；恢复条件：全部清空

- [ ] **Step 1: 写失败测试**（main.ts 是 DOM 装配层，无单测——本任务以 build + 手动验证为准；测试步改为编译检查）

Run: `npm run build`
Expected: FAIL（`LegalAction.kind` 联合类型未收窄 `effect-choice`/`resolve-trigger` 分支）

- [ ] **Step 2: 实现 main.ts 修改**

`src/main.ts` 顶部 import 补：

```ts
import { collectTriggers } from './core/effects/triggers';
```

`onAction` 的 if/else 链中，`else if (a.kind === 'compile')` 之后插入：

```ts
    } else if (a.kind === 'effect-choice') {
      // 应答挂起选择：chooser 可能是对手（规则"被作用卡持有者决定执行"）
      const top = state.pendingEffects[state.pendingEffects.length - 1];
      const chooser = top?.player ?? state.turnPlayer;
      executeAction(state, chooser, 'effect-choice', { promptId: a.promptId!, choice: a.choice! });
    } else if (a.kind === 'resolve-trigger') {
      executeAction(state, player, 'resolve-trigger', { cardUid: a.cardUid! });
```

`runAutoAdvance` 开头追加暂停条件（`if (state.step === 'action') return;` 之前）：

```ts
  if (state.pendingEffects.length > 0) return; // 有挂起选择：等对应玩家应答
  if (state.pendingPlay !== null || state.pendingShift !== null) return; // 落牌/偏转进行中
  if (state.step === 'end' || state.step === 'start') {
    if (collectTriggers(state, state.step).length > 0) return; // 有待结算触发：出按钮
  }
```

- [ ] **Step 3: 运行确认通过**

Run: `npm run build`
Expected: PASS（tsc --noEmit + vite build）

- [ ] **Step 4: 提交**

```bash
git add src/main.ts
git commit -m "feat: auto-advance pause policy and effect action dispatch"
```

---

### Task 12: UI 选择模式（候选高亮 + 确认条 + 归属者标签）

**Files:**
- Modify: `src/ui/render.ts`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `state.pendingEffects[top].prompt`（ChoiceRequest）、`LegalAction { kind:'effect-choice', promptId, choice }`
- Produces: 卡牌元素带 `data-uid`；选择模式渲染确认条（标题 + 已选 n/m + [确认] + [跳过·仅可选] + 归属者标签"P1 操作/P2 操作"）；候选卡高亮 `.choice-target`、已选 `.choice-selected`；选择模式下禁用手牌/拖拽/行动按钮

- [ ] **Step 1: 编译检查（无单测，UI 层）**

Run: `npm run build`
Expected: PASS（当前基线）

- [ ] **Step 2: 实现 render.ts 修改**

(a) `renderCardFace` 增加 uid 参数并写 `data-uid`：

```ts
function renderCardFace(card: { defId: string; faceUp: boolean; uid: string }): HTMLElement {
  const box = el('div', 'card');
  box.dataset.uid = card.uid;
  if (card.faceUp) box.dataset.defId = card.defId;
  ...
```
（所有调用点补 `uid: card.uid`：`renderStackSlot`/`renderHand`/`openTrashViewer` 中 `renderCardFace({ defId, faceUp })` 改为 `{ defId, faceUp, uid }`。）

(b) 模块级选择状态（放在 `selectedUid` 声明附近）：

```ts
/** 选择模式状态：当前应答的 promptId 与已选 uid（重渲染保留，选择完成后清空） */
let choicePromptId: string | null = null;
let choiceSelected: string[] = [];
```

(c) `renderBoard` 中，`wrap.appendChild(actionBar)` 之后、`root.appendChild(wrap)` 之前插入选择模式渲染：

```ts
  const topEffect = s.pendingEffects[s.pendingEffects.length - 1];
  if (topEffect?.prompt) {
    const prompt = topEffect.prompt;
    // 同步本地选择状态（重渲染后保留）；prompt 变化时重置
    if (choicePromptId !== topEffect.id) {
      choicePromptId = topEffect.id;
      choiceSelected = [];
    }
    const sel = new Set(choiceSelected);
    // 候选卡高亮（renderBoard 内所有 .card 已渲染）
    for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) {
      const uid = node.dataset.uid!;
      if (prompt.candidates.some((c) => c.uid === uid)) {
        node.classList.add('choice-target');
        if (sel.has(uid)) node.classList.add('choice-selected');
        // 点击切换选择（单击；双击放大仍可用 → 用 bindClickOrDouble 的 single 分支）
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          if (sel.has(uid)) { sel.delete(uid); choiceSelected = choiceSelected.filter((x) => x !== uid); }
          else if (choiceSelected.length < prompt.max) { choiceSelected.push(uid); }
          renderApp(root, s, cb);
        });
      } else {
        node.classList.add('choice-dim');
      }
    }
    const bar = el('div', 'choice-bar');
    bar.appendChild(el('div', 'choice-title', `${prompt.player === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
    const count = el('span', 'choice-count', `已选 ${choiceSelected.length}/${prompt.max === Infinity ? prompt.candidates.length : prompt.max}`);
    bar.appendChild(count);
    const canConfirm = choiceSelected.length >= prompt.min && choiceSelected.length <= prompt.max;
    const confirmBtn = el('button', 'btn choice-confirm' + (canConfirm ? '' : ' disabled'), '确认');
    confirmBtn.addEventListener('click', () => {
      if (!canConfirm) return;
      choicePromptId = null;
      cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: choiceSelected });
    });
    bar.appendChild(confirmBtn);
    if (prompt.optional) {
      const skipBtn = el('button', 'btn choice-skip', '跳过');
      skipBtn.addEventListener('click', () => {
        choicePromptId = null;
        cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [] });
      });
      bar.appendChild(skipBtn);
    }
    wrap.appendChild(bar);
    // 选择模式下隐藏手牌交互：给 hand-strip 加 .choice-mode（CSS 禁用 hover/拖拽）
    grid.querySelector('.hand-strip')?.classList.add('choice-mode');
  } else {
    choicePromptId = null;
    choiceSelected = [];
  }
```

(d) 选择模式时 `actionBar` 不渲染行动按钮（`getLegalActions` 已返回 `[]`，无需改；`renderBoard` 顶部 `legal` 为空自然无按钮）。

(e) `renderApp` 的 `no-anim` 逻辑不变；`bindCardDrag` 的 mousedown 增加选择模式短路：

```ts
  node.addEventListener('mousedown', (e) => {
    if (choicePromptId !== null) return; // 选择模式下禁止拖拽打牌
```

- [ ] **Step 3: 实现 styles.css 追加**

```css
/* 选择模式 */
.choice-target { outline: 3px solid #4ff0ff; outline-offset: 2px; animation: choice-pulse 1s ease-in-out infinite; cursor: pointer; }
.choice-selected { outline-color: #ffe14f; box-shadow: 0 0 18px #ffe14f88; }
.choice-dim { filter: brightness(0.45) saturate(0.4); }
@keyframes choice-pulse { 0%,100% { outline-color: #4ff0ff; } 50% { outline-color: #4ff0ff66; } }
.choice-bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 12px; align-items: center;
  padding: 10px 18px; background: #101830ee; border: 1px solid #4ff0ff66; border-radius: 12px; z-index: 200; }
.choice-title { color: #cfeaff; font-size: 14px; }
.choice-count { color: #ffd76a; font-size: 13px; }
.choice-confirm.disabled { opacity: 0.4; pointer-events: none; }
.hand-strip.choice-mode .card { pointer-events: none; }
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 手动验证（dev server）**

Run: `npm run dev`（后台 job）→ 浏览器打开后：P1 打出 fire-1 → 出现选择条、手牌候选高亮、点选后确认 → 继续出现"删除1张牌"选择（场上卡高亮）→ 完成；打出 fire-4 → 多选 + 确认。验证后 kill dev server。

- [ ] **Step 6: 提交**

```bash
git add src/ui/render.ts src/ui/styles.css
git commit -m "feat: UI choice mode (candidate highlight, confirm/skip bar, chooser label)"
```

---

### Task 13: UI 触发结算按钮 + 火焰特效注册表

**Files:**
- Create: `src/ui/effects/index.ts`
- Modify: `src/ui/render.ts`（end/start 触发按钮）
- Modify: `index.html`（link fire-burn.css）
- Modify: `src/main.ts`（`initEffects()`）

**Interfaces:**
- Consumes: `gameBus`（`card:discarded`/`card:deleted` 事件）；`LegalAction { kind:'resolve-trigger', cardUid }`；`public/assets/fire/fire-burn.css`
- Produces: `initEffects(): () => void`——订阅语义事件，Fire 协议的弃/删在卡牌原位置播放火焰焚烧动画（body 级浮层，1.2s 后移除，不受重渲染影响）；end/start 步骤在 actionBar 渲染每张触发卡的[结算]按钮

- [ ] **Step 1: 检查 Gemini 特效素材**

Run: `Get-Content public/assets/fire/README.md`、`Get-Content public/assets/fire/fire-burn.css`（确认类名 `fire-burn-overlay` / `fire-burn-flame` / `fire-burn-sparks` / `fire-spark` 与动画时长）

- [ ] **Step 2: 实现特效层** `src/ui/effects/index.ts`

```ts
import { gameBus, type GameEvent } from '../../core/events/bus';

/** 火焰焚烧动画：克隆目标卡到 body 级浮层（固定定位到原卡位置），挂 fire-burn 粒子，
 *  1.2s 后移除。重渲染会销毁原卡 DOM，浮层独立于渲染树不受影响。 */
function playFireBurn(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.classList.add('card-burning');
  clone.style.position = 'fixed';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.pointerEvents = 'none';
  clone.querySelector('.play-btns')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'fire-burn-overlay';
  const flame = document.createElement('div');
  flame.className = 'fire-burn-flame';
  const sparks = document.createElement('div');
  sparks.className = 'fire-burn-sparks';
  for (let i = 0; i < 5; i++) sparks.appendChild(Object.assign(document.createElement('div'), { className: 'fire-spark' }));
  overlay.appendChild(flame);
  overlay.appendChild(sparks);
  clone.appendChild(overlay);
  document.body.appendChild(clone);
  window.setTimeout(() => clone.remove(), 1200);
}

export function initEffects(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    const payload = e.payload as { uid?: string; protocol?: string } | undefined;
    if (!payload?.uid || payload.protocol !== 'fire') return;
    if (e.type !== 'card:discarded' && e.type !== 'card:deleted') return;
    const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
    if (node) playFireBurn(node);
  });
}
```

- [ ] **Step 3: 接入 index.html 与 main.ts**

`index.html` 的 `<head>` 追加：

```html
    <link rel="stylesheet" href="/assets/fire/fire-burn.css" />
```

`src/main.ts` 顶部：

```ts
import { initEffects } from './ui/effects';
```

`renderApp(root, state, cb);` 之前：

```ts
initEffects();
```

（initEffects 在模块顶层调用一次即可；返回的 unsubscribe 可忽略。）

- [ ] **Step 4: end/start 触发按钮**（`src/ui/render.ts` 的 renderBoard，actionBar 渲染段）

在 `for (const a of legal)` 循环中，`a.kind === 'compile'` 的 label 分支后补：

```ts
    const label =
      a.kind === 'compile' ? `编译线 ${(a.line ?? 0) + 1}`
      : a.kind === 'resolve-trigger' ? `结算触发效果`
      : a.kind;
```

（`resolve-trigger` 按钮点击即 `cb.onAction(a)`，已有通用处理。）

- [ ] **Step 5: 运行确认通过**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: 手动验证 + 提交**

Run: `npm run dev`（后台 job）→ P1 打出 fire-5 弃牌 → 弃牌卡上播放火焰动画；P1 打出 fire-1 删除对手牌 → 对手卡火焰动画。验证后 kill。
```bash
git add src/ui/effects/index.ts src/ui/render.ts index.html src/main.ts
git commit -m "feat: fire burn FX registry and trigger resolve buttons"
```

---

### Task 14: 交接文档、全局记忆与收尾验证

**Files:**
- Create: `docs/stage2-effects-fire.md`
- Modify: `E:\studyE\Deepseek memory\compile-web-project.md`（阶段 2 完成状态）
- （git 仓库外文件不入库）

- [ ] **Step 1: 全量验证**

Run: `npm test` → 全部 PASS；`npm run build` → PASS；`git status` 干净

- [ ] **Step 2: 写交接文档** `docs/stage2-effects-fire.md`

内容：§0 最新状态（版本、测试数、commit）；§0.1 效果引擎架构（生成器挂起、效果栈、终止规则、幽灵状态防护、偏转浮空、揭开触发、触发唯一性）；§0.2 Fire 6 卡效果清单与验证；§0.3 新增模块与 GameState 字段；§0.4 自动推进暂停策略；§0.5 下一阶段（其余 14 套协议逐个实现，先 Light/Darkness——含偏转 UI；顶命令/限制/数值修正引擎；协议重排 UI）；§0.6 环境注意（vitest threads、vite 补丁）

- [ ] **Step 3: 更新全局记忆** `E:\studyE\Deepseek memory\compile-web-project.md`

追加阶段 2 完成条目（效果引擎 + Fire 试点、测试数、HEAD、特效接入、暂停策略），更新"当前进度"清单

- [ ] **Step 4: 提交并推送**

```bash
git add -A
git commit -m "docs: stage 2 handoff (effect engine + Fire pilot)"
git push origin main
```

---

## Self-Review 结果（计划自审）

- **覆盖检查**：设计文档 §3.1 类型 → Task 1；§3.2 bus → Task 2；§3.3 运行器 → Task 3-6；§3.4 触发 → Task 7；§3.5 接入点（playCard/turn/game/main/render/effects）→ Task 8/7/10/11/12/13；§3.6 偏转 → Task 6；§4 Fire 矩阵 → Task 9；§5.1 选择交互 → Task 12；§5.2 触发按钮 → Task 13；§5.3 特效 → Task 13；§5.4 暂停策略 → Task 11；§6 测试策略 → 各任务；§7 YAGNI → 未建任务 ✓
- **占位符扫描**：无 TBD/TODO；Task 3 的 `import './cards/fire'` 已注明 Task 9 补（含编译期说明）
- **类型一致性**：`PendingEffect.player`（选择权归属者，可≠turnPlayer）贯穿 Task 10-11；`collectTriggers` 签名在 Task 7/10/11 一致；`runStack` 的 drain 分支（pendingPlay/pendingShift/pendingStepAdvance）在 Task 3/8/10 一致
- **既有测试风险**：Task 9 显式适配 `tests/game.test.ts`（打出的火卡触发选择 → resolveAllChoices）；`tests/actions/base.test.ts` 需 Step 6 回归检查
