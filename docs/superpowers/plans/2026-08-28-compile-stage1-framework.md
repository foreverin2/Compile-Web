# Compile 网页版 — 阶段 1 基础框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建《译世界》(Compile) 网页版的基础运行框架：纯 TS 核心引擎（回合流程、编译判定、基础动作）+ DOM 渲染层 + 热座双人可完整打完一局（含草案、胜利判定），用占位演示卡牌数据驱动，为后续 Fire 协议试点铺路。

**Architecture:** 三层分层架构。`src/core/`（纯 TS 引擎，零 DOM 依赖，Vitest 单元测试）：`models`（类型）→ `engine`（牌库/状态/回合流程）→ `rules`（编译判定）→ `actions`（基础动作）→ `events`（事件总线）→ `game`（门面：合法动作查询 + 执行 + 胜负）。`src/data/` 卡牌定义数据。`src/ui/` DOM 渲染组件。`src/app/main.ts` 热座装配。单向数据流：操作 → 校验 → 执行 action → 广播事件 → UI 重渲染。

**Tech Stack:** Vite + TypeScript（strict）、Vitest、原生 DOM（无框架）、CSS。

## Global Constraints

- Node.js ≥ 20（环境实测 v22.22.2）；包管理用 npm（环境实测 10.9.7）
- TypeScript strict 模式开启；`noUncheckedIndexedAccess` 不开启（数组索引不推断 undefined）
- 核心引擎（`src/core/**`）禁止 import 任何 DOM/浏览器 API，保证可独立测试
- 玩家编号类型 `PlayerId = 0 | 1`；线编号 `Line = 0 | 1 | 2`；协议数组下标即线编号
- 编译条件必须为：线总值 **≥ 10 且 > 对手同线值**（=10 可编译）
- 玩家默认操作仅 3 种：打出卡牌（正/反面）、刷新手牌、强制编译；翻面/移动等效果动作本阶段只在引擎层提供原语（供后续卡牌特效调用），UI 不暴露
- 每任务结束必须 `git commit`；提交信息格式 `feat: ...` / `test: ...`
- 阶段文档与全局记忆更新必须包含在最后一个任务内

---

### Task 1: 项目脚手架（Vite + TS + Vitest）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/main.ts`（占位）
- Create: `src/vite-env.d.ts`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 可 `npm run dev` / `npm run build` / `npx vitest run` 的项目骨架；后续任务在其上添加源码

- [ ] **Step 1: 写 package.json 并安装依赖**

创建 `package.json`：

```json
{
  "name": "compile-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

运行（安装最新稳定版，npm 自动解析兼容版本）：

```bash
npm install -D vite typescript vitest
```

预期输出：`added N packages` 无错误。

- [ ] **Step 2: 写配置文件**

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

创建 `vite.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

创建 `index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Compile 译世界</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

创建 `.gitignore`：

```gitignore
node_modules/
dist/
```

创建 `src/vite-env.d.ts`：

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 3: 写失败测试**

创建 `tests/smoke.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs the test harness', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run`
预期：`1 passed`。

运行：`npm run build`
预期：`tsc --noEmit` 无错误，vite 产出 `dist/`。

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html .gitignore src/ tests/
git commit -m "feat: scaffold vite + typescript + vitest project"
```

---

### Task 2: 核心类型与数据模型

**Files:**
- Create: `src/core/models/types.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type PlayerId = 0 | 1`
  - `type Line = 0 | 1 | 2`
  - `type Zone = 'hand' | 'deck' | 'field' | 'trash'`
  - `type Step = 'start' | 'check-control' | 'check-compile' | 'action' | 'check-cache' | 'end'`
  - `type Phase = 'draft' | 'setup' | 'turn' | 'gameover'`
  - `interface CardDef { defId: string; protocol: string; value: number; top?: string; middle?: string; bottom?: string }`
  - `interface ProtocolDef { defId: string; name: string; set: 'MN01' | 'AX01'; commands: string[]; loadingText: string }`
  - `interface Card { uid: string; defId: string; owner: PlayerId; faceUp: boolean; zone: Zone; line: Line | null; pos: number | null }`
  - `interface ProtocolState { defId: string; compiled: boolean }`
  - `interface PlayerState { hand: Card[]; deck: Card[]; trash: Card[]; protocols: ProtocolState[]; stacks: Card[][] }`
  - `interface GameState { phase: Phase; draftRound: number; draftPicks: ProtocolDef[]; turnPlayer: PlayerId; step: Step; compiledThisTurn: boolean; players: [PlayerState, PlayerState]; control: -1 | PlayerId; winner: PlayerId | null; log: string[] }`

- [ ] **Step 1: 写失败测试**

创建 `tests/models/types.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, Card, PlayerId, Line } from '../src/core/models/types';

describe('types', () => {
  it('declares the shape of GameState', () => {
    const s: GameState = null as unknown as GameState;
    expect(typeof s.turnPlayer).toBe('number');
    expect(Array.isArray(s.players)).toBe(true);
  });

  it('PlayerId and Line are narrow numbers', () => {
    const p: PlayerId = 0;
    const l: Line = 2;
    expect(p).toBe(0);
    expect(l).toBe(2);
  });

  it('Card has zone and faceUp', () => {
    const c: Card = null as unknown as Card;
    expect(typeof c.faceUp).toBe('boolean');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/models/types.test.ts`
预期：FAIL —— `Cannot find module '../src/core/models/types'`。

- [ ] **Step 3: 实现类型定义**

创建 `src/core/models/types.ts`：

```typescript
export type PlayerId = 0 | 1;
export type Line = 0 | 1 | 2;
export type Zone = 'hand' | 'deck' | 'field' | 'trash';
export type Step =
  | 'start'
  | 'check-control'
  | 'check-compile'
  | 'action'
  | 'check-cache'
  | 'end';
export type Phase = 'draft' | 'setup' | 'turn' | 'gameover';

/** 卡牌定义：静态数据（来自用户提供的卡牌文本，或占位演示数据） */
export interface CardDef {
  defId: string;
  protocol: string;
  value: number;
  top?: string;
  middle?: string;
  bottom?: string;
}

/** 协议定义：静态数据 */
export interface ProtocolDef {
  defId: string;
  name: string;
  set: 'MN01' | 'AX01';
  commands: string[];
  loadingText: string;
}

/** 卡牌实例：运行时状态 */
export interface Card {
  uid: string;
  defId: string;
  owner: PlayerId;
  faceUp: boolean;
  zone: Zone;
  line: Line | null;
  /** 在堆叠中的位置：0 = 最底层（贴协议），越大越靠上；null = 不在场上堆叠 */
  pos: number | null;
}

/** 协议运行时状态 */
export interface ProtocolState {
  defId: string;
  compiled: boolean;
}

/** 玩家运行时状态 */
export interface PlayerState {
  hand: Card[];
  deck: Card[];
  trash: Card[];
  /** 长度固定 3，下标即线编号 */
  protocols: ProtocolState[];
  /** 每条线的堆叠，长度固定 3；stacks[line] 内 pos 0 为底层 */
  stacks: Card[][];
}

export interface GameState {
  phase: Phase;
  /** 草案轮次：0-5（4-2-2-1 共 6 次选择） */
  draftRound: number;
  /** 已选出的协议（按选择顺序） */
  draftPicks: ProtocolDef[];
  turnPlayer: PlayerId;
  step: Step;
  /** 本回合是否已编译（编译后跳过 action 步骤） */
  compiledThisTurn: boolean;
  players: [PlayerState, PlayerState];
  /** -1 = 控制组件中立位 */
  control: -1 | PlayerId;
  winner: PlayerId | null;
  log: string[];
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/models/types.test.ts`
预期：PASS（2 个测试全过）。

- [ ] **Step 5: 提交**

```bash
git add src/core/models/types.ts tests/models/types.test.ts
git commit -m "feat: core type model (Card/Protocol/Player/GameState)"
```

---

### Task 3: 占位演示数据（协议 + 卡牌定义）

**Files:**
- Create: `src/data/demo.ts`

**Interfaces:**
- Consumes: `CardDef`、`ProtocolDef`（Task 2）
- Produces:
  - `export const DEMO_PROTOCOLS: ProtocolDef[]`（Spirit、Death、Fire 共 3 套，每套 2 面协议卡 + commands/loadingText）
  - `export const DEMO_CARD_DEFS: CardDef[]`（每协议 3 张占位命令卡，值覆盖 0-5 区间演示用）
  - `export function getCardDef(defId: string): CardDef`（查找，找不到抛错）
  - `export function getProtocolDef(defId: string): ProtocolDef`（查找，找不到抛错）

**说明：** 演示数据共 **6 套协议**（4-2-2-1 草案需 6 次选择，池子必须 ≥6）。Spirit/Death 的命令卡文本取自官方规则书 MN01 卡面示例；Fire/Water/Light/Metal 命令卡为占位文本（标注 `// TODO(fire): 用户提供真实文本`），其协议卡 commands/loadingText 为官方原文（如 Fire: DISCARD FOR EFFECT / BURN AT BOTH ENDS）。真实 Fire 卡牌文本在阶段 2 由用户提供后替换。

- [ ] **Step 1: 写失败测试**

创建 `tests/data/demo.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, getCardDef, getProtocolDef } from '../src/data/demo';

describe('demo data', () => {
  it('has 6 demo protocols (draft needs 6 picks)', () => {
    expect(DEMO_PROTOCOLS).toHaveLength(6);
  });

  it('every protocol has 3 command cards', () => {
    for (const p of DEMO_PROTOCOLS) {
      const cards = DEMO_CARD_DEFS.filter((c) => c.protocol === p.defId);
      expect(cards.length).toBe(3);
    }
  });

  it('getCardDef finds by defId', () => {
    expect(getCardDef('fire-1').protocol).toBe('fire');
  });

  it('getProtocolDef finds by defId', () => {
    expect(getProtocolDef('spirit').name).toBe('Spirit');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/data/demo.test.ts`
预期：FAIL —— 找不到 `../src/data/demo`。

- [ ] **Step 3: 实现演示数据**

创建 `src/data/demo.ts`：

```typescript
import type { CardDef, ProtocolDef } from '../core/models/types';

export const DEMO_PROTOCOLS: ProtocolDef[] = [
  {
    defId: 'spirit',
    name: 'Spirit',
    set: 'MN01',
    commands: ['FLIP', 'SHIFT', 'DRAW'],
    loadingText: 'TRUE STRENGTH FROM WITHIN.',
  },
  {
    defId: 'death',
    name: 'Death',
    set: 'MN01',
    commands: ['DELETE', 'DRAW'],
    loadingText: 'NOTHING SHALL SURVIVE.',
  },
  {
    defId: 'fire',
    name: 'Fire',
    set: 'MN01',
    commands: ['DISCARD FOR EFFECT'],
    loadingText: 'BURN AT BOTH ENDS.',
  },
  {
    defId: 'water',
    name: 'Water',
    set: 'MN01',
    commands: ['RETURN', 'DRAW', 'FLIP'],
    loadingText: 'WASH AWAY AND RENEW.',
  },
  {
    defId: 'light',
    name: 'Light',
    set: 'MN01',
    commands: ['DRAW', 'FLIP', 'SHIFT'],
    loadingText: 'BURN AWAY THE DARK.',
  },
  {
    defId: 'metal',
    name: 'Metal',
    set: 'MN01',
    commands: ['PREVENT', 'DRAW', 'FLIP'],
    loadingText: 'HARDENED AGAINST ALL.',
  },
];

export const DEMO_CARD_DEFS: CardDef[] = [
  // Spirit —— 文本取自官方规则书 MN01 卡面示例
  {
    defId: 'spirit-1',
    protocol: 'spirit',
    value: 1,
    top: 'Start: Either discard 1 card or flip this card.',
    middle: 'Draw 2 cards.',
    bottom: 'When you play cards face-up, they may be played without matching protocols.',
  },
  { defId: 'spirit-2', protocol: 'spirit', value: 2, middle: 'Draw 1 card.' },
  { defId: 'spirit-5', protocol: 'spirit', value: 5, middle: 'Draw 3 cards.' },
  // Death —— 文本取自官方规则书 MN01 卡面示例（含 Codex 勘误 Death 1）
  {
    defId: 'death-1',
    protocol: 'death',
    value: 1,
    middle: 'Start: You may draw 1 card. If you do, delete 1 other card, then delete this card.',
  },
  { defId: 'death-2', protocol: 'death', value: 2, middle: 'Delete 1 face-down card.' },
  { defId: 'death-3', protocol: 'death', value: 3, middle: 'Delete 1 card.' },
  // Fire —— 占位文本，真实文本由用户在阶段 2 提供
  // TODO(fire): 用户提供 Fire 0-5 真实卡牌文本后替换以下定义
  { defId: 'fire-0', protocol: 'fire', value: 0, middle: 'Discard 1 card.' },
  { defId: 'fire-1', protocol: 'fire', value: 1, middle: 'Discard 1 card. Draw 1 card.' },
  { defId: 'fire-5', protocol: 'fire', value: 5, middle: 'Discard 2 cards. Draw 3 cards.' },
  // Water —— 占位文本（协议卡文本为官方原文）
  { defId: 'water-0', protocol: 'water', value: 0, middle: 'Return 1 card.' },
  { defId: 'water-2', protocol: 'water', value: 2, middle: 'Draw 1 card.' },
  { defId: 'water-4', protocol: 'water', value: 4, middle: 'Flip 1 card.' },
  // Light —— 占位文本（协议卡文本为官方原文）
  { defId: 'light-1', protocol: 'light', value: 1, middle: 'Draw 1 card.' },
  { defId: 'light-3', protocol: 'light', value: 3, middle: 'Flip 1 card.' },
  { defId: 'light-5', protocol: 'light', value: 5, middle: 'Shift 1 card.' },
  // Metal —— 占位文本（协议卡文本为官方原文）
  { defId: 'metal-1', protocol: 'metal', value: 1, middle: 'Draw 2 cards.' },
  { defId: 'metal-3', protocol: 'metal', value: 3, middle: 'Prevent 1 card.' },
  { defId: 'metal-6', protocol: 'metal', value: 6, middle: 'Flip 1 card.' },
];

const cardIndex = new Map(DEMO_CARD_DEFS.map((c) => [c.defId, c]));
const protocolIndex = new Map(DEMO_PROTOCOLS.map((p) => [p.defId, p]));

export function getCardDef(defId: string): CardDef {
  const def = cardIndex.get(defId);
  if (!def) throw new Error(`unknown card def: ${defId}`);
  return def;
}

export function getProtocolDef(defId: string): ProtocolDef {
  const def = protocolIndex.get(defId);
  if (!def) throw new Error(`unknown protocol def: ${defId}`);
  return def;
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/data/demo.test.ts`
预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/data/demo.ts tests/data/demo.test.ts
git commit -m "feat: demo card/protocol data (6 MN01 protocols, fire placeholder)"
```

---

### Task 4: 牌库与手牌操作（draw / discard / reshuffle / clearCache）

**Files:**
- Create: `src/core/engine/deck.ts`

**Interfaces:**
- Consumes: `GameState`、`PlayerId`、`Card`（Task 2）
- Produces:
  - `export function drawCards(s: GameState, player: PlayerId, count: number): Card[]`（牌库空则洗弃牌堆重组，返回实际抽到的卡；抽到的卡 `zone='hand'`，从 `hand` 数组返回并 push 进 hand）
  - `export function discardFromHand(s: GameState, player: PlayerId, cardUid: string): Card`（手牌 → trash，正面朝上）
  - `export function clearCache(s: GameState, player: PlayerId): Card[]`（手牌 >5 弃至 5，弃最后几张，返回被弃卡）

- [ ] **Step 1: 写失败测试**

创建 `tests/engine/deck.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../src/core/models/types';
import { drawCards, discardFromHand, clearCache } from '../src/core/engine/deck';

function makeState(handSize: number, deckSize: number, trashSize: number): GameState {
  const mk = (n: number, zone: 'hand' | 'deck' | 'trash') =>
    Array.from({ length: n }, (_, i) => ({
      uid: `${zone}-${i}`,
      defId: 'spirit-1',
      owner: 0 as const,
      faceUp: true,
      zone,
      line: null,
      pos: null,
    }));
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    turnPlayer: 0,
    step: 'action',
    compiledThisTurn: false,
    players: [
      { hand: mk(handSize, 'hand'), deck: mk(deckSize, 'deck'), trash: mk(trashSize, 'trash'), protocols: [], stacks: [[], [], []] },
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
  };
}

describe('deck ops', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState(0, 5, 0);
  });

  it('draws from deck into hand', () => {
    const drawn = drawCards(s, 0, 2);
    expect(drawn).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[0].deck).toHaveLength(3);
    expect(drawn.every((c) => c.zone === 'hand')).toBe(true);
  });

  it('reshuffles trash into deck when deck empties during draw', () => {
    s = makeState(0, 2, 3);
    const drawn = drawCards(s, 0, 5);
    expect(drawn).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('discardFromHand moves card face-up to trash', () => {
    s = makeState(2, 0, 0);
    const card = discardFromHand(s, 0, 'hand-0');
    expect(card.zone).toBe('trash');
    expect(card.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].trash).toHaveLength(1);
  });

  it('clearCache discards down to 5', () => {
    s = makeState(7, 0, 0);
    const discarded = clearCache(s, 0);
    expect(discarded).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(5);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/engine/deck.test.ts`
预期：FAIL —— 找不到模块。

- [ ] **Step 3: 实现牌库操作**

创建 `src/core/engine/deck.ts`：

```typescript
import type { Card, GameState, PlayerId } from '../models/types';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从牌库顶抽 count 张；牌库不足则洗弃牌堆重组，再抽满 */
export function drawCards(s: GameState, player: PlayerId, count: number): Card[] {
  const p = s.players[player];
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      if (p.trash.length === 0) break;
      p.deck = shuffle(p.trash);
      p.trash = [];
    }
    const card = p.deck.pop()!;
    card.zone = 'hand';
    card.line = null;
    card.pos = null;
    card.faceUp = true;
    drawn.push(card);
    p.hand.push(card);
  }
  return drawn;
}

/** 手牌 → 弃牌堆（正面朝上） */
export function discardFromHand(s: GameState, player: PlayerId, cardUid: string): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand of player ${player}`);
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'trash';
  card.faceUp = true;
  card.line = null;
  card.pos = null;
  p.trash.push(card);
  return card;
}

/** 清缓存：手牌 >5 时弃至 5 张（弃最后几张），返回被弃卡 */
export function clearCache(s: GameState, player: PlayerId): Card[] {
  const p = s.players[player];
  const excess = p.hand.length - 5;
  if (excess <= 0) return [];
  const discarded: Card[] = [];
  for (let i = 0; i < excess; i++) {
    const card = p.hand.pop()!;
    card.zone = 'trash';
    card.faceUp = true;
    card.line = null;
    card.pos = null;
    p.trash.push(card);
    discarded.push(card);
  }
  return discarded;
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/engine/deck.test.ts`
预期：PASS（4 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src/core/engine/deck.ts tests/engine/deck.test.ts
git commit -m "feat: deck ops (draw/discard/reshuffle/clearCache)"
```

---

### Task 5: 游戏创建与草案引擎（4-2-2-1 轮选）

**Files:**
- Create: `src/core/state/create.ts`
- Create: `src/core/state/draft.ts`

**Interfaces:**
- Consumes: `GameState`、`PlayerId`、`Line`、`CardDef`、`ProtocolDef`（Task 2）；`getCardDef`、`getProtocolDef`（Task 3）
- Produces:
  - `export function createGame(): GameState`（phase='draft'，6 套演示协议池）
  - `export function getDraftPool(s: GameState): ProtocolDef[]`（当前可选协议）
  - `export function getCurrentDrafter(s: GameState): PlayerId`（4-2-2-1：轮到谁）
  - `export function performDraftPick(s: GameState, defId: string): void`（把协议放入当前选者，推进 draftRound；选完自动进入 setup：双方各 3 协议按草案顺序排线，构建 9 张牌库、抽 5 起始手牌）
  - `export function stackValue(p: PlayerState, line: Line): number`（线堆叠总值：未覆盖卡按印刷值，覆盖卡取印刷值——本阶段所有卡正面；面朝下卡值=2，后续任务实现）
  - `export function getLineValue(s: GameState, player: PlayerId, line: Line): number`（委托 stackValue）

**草案轮选规则（官方）：** P1 选 1 → P2 选 2 → P1 选 2 → P2 选 1（共 6 次选择；`draftRound` 0-5）。

- [ ] **Step 1: 写失败测试**

创建 `tests/state/create.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import type { GameState } from '../src/core/models/types';
import { createGame, getDraftPool, getCurrentDrafter, performDraftPick, getLineValue } from '../src/core/state/create';
import { DEMO_PROTOCOLS } from '../src/data/demo';

describe('create & draft', () => {
  it('creates a draft-phase game with the full demo pool', () => {
    const s = createGame();
    expect(s.phase).toBe('draft');
    expect(getDraftPool(s)).toHaveLength(DEMO_PROTOCOLS.length);
    expect(getCurrentDrafter(s)).toBe(0);
  });

  it('follows 4-2-2-1 draft order', () => {
    const s = createGame();
    const order: number[] = [];
    while (s.phase === 'draft') {
      order.push(getCurrentDrafter(s));
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    expect(order).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it('sets up both players with 3 protocols, 9-card decks, 5-card hands', () => {
    const s = createGame();
    while (s.phase === 'draft') {
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    expect(s.phase).toBe('turn');
    for (const p of s.players) {
      expect(p.protocols).toHaveLength(3);
      expect(p.deck).toHaveLength(9);
      expect(p.hand).toHaveLength(5);
    }
  });

  it('line value sums the stack', () => {
    const s = createGame();
    while (s.phase === 'draft') {
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    const p = s.players[0];
    // 手动放两张卡到线 0
    p.stacks[0] = [
      { uid: 'a', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 0 },
      { uid: 'b', defId: 'fire-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 1 },
    ];
    expect(getLineValue(s, 0, 0)).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/state/create.test.ts`
预期：FAIL —— 找不到模块。

- [ ] **Step 3: 实现创建与草案**

创建 `src/core/state/create.ts`：

```typescript
import type { GameState, PlayerId, PlayerState, Line, ProtocolDef, Card } from '../models/types';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, getCardDef } from '../../data/demo';
import { drawCards } from '../engine/deck';

let uidCounter = 0;
export function nextUid(): string {
  uidCounter += 1;
  return `c${uidCounter}`;
}

/** 4-2-2-1 轮选顺序：第 i 次选择轮到谁 */
const DRAFT_ORDER: PlayerId[] = [0, 1, 1, 0, 0, 1];

function emptyPlayer(): PlayerState {
  return { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] };
}

export function createGame(): GameState {
  return {
    phase: 'draft',
    draftRound: 0,
    draftPicks: [],
    turnPlayer: 0,
    step: 'start',
    compiledThisTurn: false,
    players: [emptyPlayer(), emptyPlayer()],
    control: -1,
    winner: null,
    log: [],
  };
}

export function getDraftPool(s: GameState): ProtocolDef[] {
  const picked = new Set(s.draftPicks.map((p) => p.defId));
  return DEMO_PROTOCOLS.filter((p) => !picked.has(p.defId));
}

export function getCurrentDrafter(s: GameState): PlayerId {
  return DRAFT_ORDER[s.draftRound] ?? 1;
}

/** 每人 3 协议按草案顺序排线：选中的协议按选择顺序依次放入 0/1/2 线 */
function assignProtocols(s: GameState, player: PlayerId, picks: ProtocolDef[]): void {
  const p = s.players[player];
  p.protocols = picks.map((def) => ({ defId: def.defId, compiled: false }));
  for (let line = 0; line < 3; line++) {
    const def = picks[line];
    if (!def) break;
    const cards = DEMO_CARD_DEFS.filter((c) => c.protocol === def.defId);
    for (const cardDef of cards) {
      const card: Card = {
        uid: nextUid(),
        defId: cardDef.defId,
        owner: player,
        faceUp: true,
        zone: 'deck',
        line: null,
        pos: null,
      };
      p.deck.push(card);
    }
  }
}

/** 草案选择：defId 必须是当前可选协议 */
export function performDraftPick(s: GameState, defId: string): void {
  if (s.phase !== 'draft') throw new Error('not in draft phase');
  const def = getDraftPool(s).find((p) => p.defId === defId);
  if (!def) throw new Error(`protocol ${defId} not available`);
  const drafter = getCurrentDrafter(s);
  s.draftPicks.push(def);
  s.log.push(`P${drafter + 1} drafts ${def.name}`);
  s.draftRound += 1;
  if (s.draftRound >= DRAFT_ORDER.length) {
    // 分配：P1 的第 1、3、4 次选择；P2 的第 2、5、6 次选择
    const p1Picks = [s.draftPicks[0], s.draftPicks[3], s.draftPicks[4]].filter(Boolean);
    const p2Picks = [s.draftPicks[1], s.draftPicks[2], s.draftPicks[5]].filter(Boolean);
    assignProtocols(s, 0, p1Picks as ProtocolDef[]);
    assignProtocols(s, 1, p2Picks as ProtocolDef[]);
    s.phase = 'turn';
    s.step = 'start';
    drawCards(s, 0, 5);
    drawCards(s, 1, 5);
    s.log.push('Setup complete. Starting hand drawn (5 each).');
  }
}

/** 线堆叠总值：本阶段所有卡面朝上，按印刷值求和；面朝下卡值=2（后续任务实现覆盖机制时保持此规则） */
export function stackValue(p: PlayerState, line: Line): number {
  let total = 0;
  for (const card of p.stacks[line]) {
    if (!card.faceUp) {
      total += 2;
    } else {
      const def = getCardDef(card.defId);
      total += def.value;
    }
  }
  return total;
}

export function getLineValue(s: GameState, player: PlayerId, line: Line): number {
  return stackValue(s.players[player], line);
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/state/create.test.ts`
预期：PASS（4 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src/core/state/create.ts tests/state/create.test.ts
git commit -m "feat: game creation and 4-2-2-1 draft engine"
```

---

### Task 6: 回合流程状态机（6 步）

**Files:**
- Create: `src/core/engine/turn.ts`

**Interfaces:**
- Consumes: `GameState`、`Step`（Task 2）；`getLineValue`（Task 5）；`clearCache`（Task 4）
- Produces:
  - `export const STEP_ORDER: Step[]`
  - `export function advanceStep(s: GameState): void`（推进到下一步；end 后切换回合玩家并重置 `compiledThisTurn`；`compiledThisTurn` 为 true 时跳过 action）
  - `export function currentPlayer(s: GameState): PlayerId`（别名 `s.turnPlayer` 的封装，供 UI 统一使用）

**回合流程（官方）：** start → check-control → check-compile → action → check-cache → end。**Check Compile 若触发编译（本阶段由 game 门面在 check-compile 步骤执行强制编译并置 `compiledThisTurn=true`），则跳过 action 步骤**（编译是唯一行动）。end 后切换至对手，`compiledThisTurn` 重置。

- [ ] **Step 1: 写失败测试**

创建 `tests/engine/turn.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import type { GameState, Step } from '../src/core/models/types';
import { advanceStep, STEP_ORDER } from '../src/core/engine/turn';

function makeState(step: Step): GameState {
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    turnPlayer: 0,
    step,
    compiledThisTurn: false,
    players: [
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
  };
}

describe('turn flow', () => {
  it('advances through all 6 steps in order', () => {
    const s = makeState('start');
    const seen: Step[] = [s.step];
    for (let i = 0; i < 5; i++) {
      advanceStep(s);
      seen.push(s.step);
    }
    expect(seen).toEqual(STEP_ORDER);
  });

  it('switches player after end and resets compiledThisTurn', () => {
    const s = makeState('end');
    s.compiledThisTurn = true;
    advanceStep(s);
    expect(s.turnPlayer).toBe(1);
    expect(s.step).toBe('start');
    expect(s.compiledThisTurn).toBe(false);
  });

  it('skips action when compiledThisTurn is set', () => {
    const s = makeState('check-compile');
    s.compiledThisTurn = true;
    advanceStep(s);
    expect(s.step).toBe('check-cache');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/engine/turn.test.ts`
预期：FAIL —— 找不到模块。

- [ ] **Step 3: 实现回合状态机**

创建 `src/core/engine/turn.ts`：

```typescript
import type { GameState, Step, PlayerId } from '../models/types';

export const STEP_ORDER: Step[] = [
  'start',
  'check-control',
  'check-compile',
  'action',
  'check-cache',
  'end',
];

export function currentPlayer(s: GameState): PlayerId {
  return s.turnPlayer;
}

/** 推进到下一步；end 后换人；compiledThisTurn 时跳过 action */
export function advanceStep(s: GameState): void {
  const idx = STEP_ORDER.indexOf(s.step);
  let next = STEP_ORDER[(idx + 1) % STEP_ORDER.length];
  if (next === 'action' && s.compiledThisTurn) {
    next = 'check-cache';
  }
  s.step = next;
  if (next === 'start') {
    s.turnPlayer = s.turnPlayer === 0 ? 1 : 0;
    s.compiledThisTurn = false;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/engine/turn.test.ts`
预期：PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src/core/engine/turn.ts tests/engine/turn.test.ts
git commit -m "feat: 6-step turn state machine"
```

---

### Task 7: 编译判定（≥10 且 > 对手）

**Files:**
- Create: `src/core/rules/compile.ts`

**Interfaces:**
- Consumes: `GameState`、`PlayerId`、`Line`（Task 2）；`getLineValue`（Task 5）
- Produces:
  - `export function canCompileLine(s: GameState, player: PlayerId, line: Line): boolean`（线值 **≥10 且 > 对手同线值**）
  - `export function getCompilableLines(s: GameState, player: PlayerId): Line[]`（满足条件的线数组）
  - `export function mustCompile(s: GameState, player: PlayerId): boolean`（`getCompilableLines` 非空）
  - `export function executeCompile(s: GameState, player: PlayerId, line: Line): void`（同时删除该线双方全部卡牌入各自 trash，不触发任何文本；翻协议为 compiled；若协议已 compiled 则改为抽对手牌库顶 1 张；置 `compiledThisTurn=true`；检查是否胜利 → 置 `winner` 与 `phase='gameover'`）

**编译细节（官方）：** 删除是 "all" 效果、同时发生、不触发卡牌文本；编译一旦开始，即使线值被降至 <10 或 ≤ 对手，仍照常结算；重新编译已编译线 → 抽对手牌库顶 1 张（所有权变更——本阶段实现为将对手牌库顶卡移入自己手牌，`owner` 改为自己）。

- [ ] **Step 1: 写失败测试**

创建 `tests/rules/compile.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../src/core/models/types';
import { canCompileLine, getCompilableLines, mustCompile, executeCompile } from '../src/core/rules/compile';

function makeState(v0: number, v1: number, line: 0 | 1 | 2 = 0): GameState {
  // 用堆叠里重复放 spirit-1（值1）凑总值
  const mk = (owner: 0 | 1, total: number) =>
    Array.from({ length: total }, (_, i) => ({ uid: `${owner}-${i}`, defId: 'spirit-1', owner, faceUp: true, zone: 'field' as const, line, pos: i }));
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    turnPlayer: 0,
    step: 'check-compile',
    compiledThisTurn: false,
    players: [
      { hand: [], deck: [], trash: [], protocols: [{ defId: 'spirit', compiled: false }, { defId: 'death', compiled: false }, { defId: 'fire', compiled: false }], stacks: [[mk(0, v0)], [], []] },
      { hand: [], deck: [], trash: [], protocols: [{ defId: 'spirit', compiled: false }, { defId: 'death', compiled: false }, { defId: 'fire', compiled: false }], stacks: [[mk(1, v1)], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
  };
}

describe('compile rules', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState(10, 9);
  });

  it('compiles at exactly 10 when strictly greater', () => {
    expect(canCompileLine(s, 0, 0)).toBe(true);
  });

  it('does not compile when equal to opponent', () => {
    s = makeState(10, 10);
    expect(canCompileLine(s, 0, 0)).toBe(false);
  });

  it('does not compile below 10', () => {
    s = makeState(9, 8);
    expect(canCompileLine(s, 0, 0)).toBe(false);
  });

  it('lists compilable lines', () => {
    s = makeState(10, 9);
    const p = s.players[0];
    // 线1也给 11 点
    p.stacks[1] = Array.from({ length: 11 }, (_, i) => ({ uid: `a${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 1 as const, pos: i }));
    expect(getCompilableLines(s, 0)).toEqual([0, 1]);
    expect(mustCompile(s, 0)).toBe(true);
  });

  it('executeCompile deletes both stacks and flips protocol', () => {
    executeCompile(s, 0, 0);
    expect(s.players[0].stacks[0]).toHaveLength(0);
    expect(s.players[1].stacks[0]).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(10);
    expect(s.players[1].trash).toHaveLength(9);
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.compiledThisTurn).toBe(true);
  });

  it('recompile draws opponent top card instead of flipping', () => {
    s.players[0].protocols[0].compiled = true;
    s.players[1].deck = [{ uid: 'd1', defId: 'spirit-1', owner: 1, faceUp: true, zone: 'deck', line: null, pos: null }];
    executeCompile(s, 0, 0);
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].hand[0].owner).toBe(0);
    expect(s.players[1].deck).toHaveLength(0);
  });

  it('declares winner when all 3 protocols compiled', () => {
    s.players[0].protocols.forEach((p) => (p.compiled = true));
    s.players[0].protocols[2].compiled = false;
    executeCompile(s, 0, 2);
    expect(s.winner).toBe(0);
    expect(s.phase).toBe('gameover');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/rules/compile.test.ts`
预期：FAIL —— 找不到模块。

- [ ] **Step 3: 实现编译判定**

创建 `src/core/rules/compile.ts`：

```typescript
import type { GameState, PlayerId, Line } from '../models/types';
import { getLineValue } from '../state/create';

export function canCompileLine(s: GameState, player: PlayerId, line: Line): boolean {
  const own = getLineValue(s, player, line);
  const opp = getLineValue(s, player === 0 ? 1 : 0, line);
  return own >= 10 && own > opp;
}

export function getCompilableLines(s: GameState, player: PlayerId): Line[] {
  const lines: Line[] = [];
  for (const line of [0, 1, 2] as Line[]) {
    if (canCompileLine(s, player, line)) lines.push(line);
  }
  return lines;
}

export function mustCompile(s: GameState, player: PlayerId): boolean {
  return getCompilableLines(s, player).length > 0;
}

/** 编译：同时删除该线双方全部卡牌（"all" 效果，不触发文本），翻协议或抽对手牌库顶 1 张 */
export function executeCompile(s: GameState, player: PlayerId, line: Line): void {
  if (!canCompileLine(s, player, line)) {
    throw new Error(`line ${line} does not meet compile requirements`);
  }
  const p = s.players[player];
  const opp = s.players[player === 0 ? 1 : 0];
  // 同时删除：双方该线堆叠全部入各自 trash
  const ownCards = p.stacks[line].splice(0);
  const oppCards = opp.stacks[line].splice(0);
  for (const card of [...ownCards, ...oppCards]) {
    card.zone = 'trash';
    card.line = null;
    card.pos = null;
    card.faceUp = true;
  }
  p.trash.push(...ownCards);
  opp.trash.push(...oppCards);
  s.log.push(`P${player + 1} compiles line ${line + 1}`);

  const protocol = p.protocols[line];
  if (protocol.compiled) {
    // 重新编译：抽对手牌库顶 1 张，所有权变更
    const card = opp.deck.pop();
    if (card) {
      card.owner = player;
      card.zone = 'hand';
      card.faceUp = true;
      p.hand.push(card);
      s.log.push(`P${player + 1} recompiles and steals a card`);
    }
  } else {
    protocol.compiled = true;
    s.log.push(`Protocol "${protocol.defId}" compiled`);
  }

  s.compiledThisTurn = true;

  // 胜利判定
  if (p.protocols.every((pr) => pr.compiled)) {
    s.winner = player;
    s.phase = 'gameover';
    s.log.push(`P${player + 1} wins!`);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/rules/compile.test.ts`
预期：PASS（6 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src/core/rules/compile.ts tests/rules/compile.test.ts
git commit -m "feat: compile rules (>=10 and greater than opponent)"
```

---

### Task 8: 基础动作（playCard / refresh）

**Files:**
- Create: `src/core/actions/base.ts`

**Interfaces:**
- Consumes: `GameState`、`PlayerId`、`Line`、`Card`（Task 2）；`nextUid`、`getLineValue` 不需要；`drawCards`、`clearCache`（Task 4）；`getCardDef`、`getProtocolDef`（Task 3）；`stackValue`（Task 5）
- Produces:
  - `export function playCard(s: GameState, player: PlayerId, cardUid: string, faceUp: boolean, line: Line): Card`（手牌 → 场上堆叠顶部；faceUp 必须匹配该线协议；faceDown 任意线；置于 `stacks[line]` 末尾，`pos` = 新长度-1；返回打出的卡）
  - `export function refreshHand(s: GameState, player: PlayerId): Card[]`（手牌 <5 时抽至 5；手牌 ≥5 抛错；返回抽到的卡）
  - `export function isPlayableFaceUp(s: GameState, player: PlayerId, cardUid: string, line: Line): boolean`（卡牌协议 defId 与 `players[player].protocols[line].defId` 相等才可正面打入）

- [ ] **Step 1: 写失败测试**

创建 `tests/actions/base.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState, Card } from '../src/core/models/types';
import { playCard, refreshHand, isPlayableFaceUp } from '../src/core/actions/base';

function makeState(): GameState {
  const card = (uid: string, defId: string): Card => ({
    uid, defId, owner: 0, faceUp: true, zone: 'hand', line: null, pos: null,
  });
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    turnPlayer: 0,
    step: 'action',
    compiledThisTurn: false,
    players: [
      {
        hand: [card('h1', 'spirit-1'), card('h2', 'fire-1')],
        deck: [],
        trash: [],
        protocols: [
          { defId: 'spirit', compiled: false },
          { defId: 'death', compiled: false },
          { defId: 'fire', compiled: false },
        ],
        stacks: [[], [], []],
      },
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
  };
}

describe('base actions', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState();
  });

  it('plays face-up only into matching protocol line', () => {
    expect(isPlayableFaceUp(s, 0, 'h1', 0)).toBe(true); // spirit → line 0
    expect(isPlayableFaceUp(s, 0, 'h1', 2)).toBe(false); // spirit → line 2 (fire)
    const card = playCard(s, 0, 'h1', true, 0);
    expect(card.zone).toBe('field');
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].stacks[0][0].pos).toBe(0);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('plays face-down into any line', () => {
    const card = playCard(s, 0, 'h1', false, 2);
    expect(card.zone).toBe('field');
    expect(card.faceUp).toBe(false);
    expect(s.players[0].stacks[2]).toHaveLength(1);
  });

  it('covering a card appends to the top of the stack', () => {
    playCard(s, 0, 'h1', true, 0);
    playCard(s, 0, 'h2', false, 0);
    const stack = s.players[0].stacks[0];
    expect(stack).toHaveLength(2);
    expect(stack[1].pos).toBe(1);
  });

  it('rejects face-up play into wrong line', () => {
    expect(() => playCard(s, 0, 'h1', true, 2)).toThrow();
  });

  it('refresh draws to 5', () => {
    s.players[0].deck = [
      { uid: 'd1', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd2', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd3', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd4', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd5', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
    ];
    const drawn = refreshHand(s, 0);
    expect(drawn).toHaveLength(3);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('rejects refresh at 5 or more cards in hand', () => {
    s.players[0].hand.push({ uid: 'h3', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    s.players[0].hand.push({ uid: 'h4', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    s.players[0].hand.push({ uid: 'h5', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    expect(() => refreshHand(s, 0)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/actions/base.test.ts`
预期：FAIL —— 找不到模块。

- [ ] **Step 3: 实现基础动作**

创建 `src/core/actions/base.ts`：

```typescript
import type { GameState, PlayerId, Line, Card } from '../models/types';
import { drawCards } from '../engine/deck';
import { getCardDef } from '../../data/demo';

/** 卡牌 defId 的协议是否与该线协议匹配（正面打入条件） */
export function isPlayableFaceUp(s: GameState, player: PlayerId, cardUid: string, line: Line): boolean {
  const card = s.players[player].hand.find((c) => c.uid === cardUid);
  if (!card) return false;
  const def = getCardDef(card.defId);
  return def.protocol === s.players[player].protocols[line].defId;
}

/** 打出卡牌：正面须匹配协议线；背面任意线；置于堆叠顶部 */
export function playCard(s: GameState, player: PlayerId, cardUid: string, faceUp: boolean, line: Line): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand`);
  if (faceUp && !isPlayableFaceUp(s, player, cardUid, line)) {
    throw new Error(`cannot play face-up into line ${line}`);
  }
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'field';
  card.faceUp = faceUp;
  card.line = line;
  card.pos = p.stacks[line].length;
  p.stacks[line].push(card);
  s.log.push(`P${player + 1} plays ${card.defId} ${faceUp ? 'face-up' : 'face-down'} to line ${line + 1}`);
  return card;
}

/** 刷新手牌：手牌 <5 时抽至 5；否则抛错 */
export function refreshHand(s: GameState, player: PlayerId): Card[] {
  const p = s.players[player];
  if (p.hand.length >= 5) throw new Error('cannot refresh with 5+ cards in hand');
  return drawCards(s, player, 5 - p.hand.length);
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/actions/base.test.ts`
预期：PASS（6 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src/core/actions/base.ts tests/actions/base.test.ts
git commit -m "feat: base actions (playCard face-up/down, refreshHand)"
```

---

### Task 9: 事件总线与游戏门面（合法动作 / 执行 / 胜负）

**Files:**
- Create: `src/core/events/bus.ts`
- Create: `src/core/game.ts`

**Interfaces:**
- Consumes: `GameState`、`PlayerId`、`Line`（Task 2）；`playCard`、`refreshHand`（Task 8）；`executeCompile`、`mustCompile`、`getCompilableLines`（Task 7）；`advanceStep`（Task 6）；`clearCache`（Task 4）
- Produces:
  - `export type GameEvent = { type: string; state: GameState; payload?: unknown }`
  - `export interface EventBus { subscribe(fn: (e: GameEvent) => void): () => void; emit(e: GameEvent): void }`
  - `export function createBus(): EventBus`
  - `export type ActionKind = 'play' | 'refresh' | 'compile' | 'advance'`
  - `export interface PlayArgs { cardUid: string; faceUp: boolean; line: Line }`
  - `export function getLegalActions(s: GameState, player: PlayerId): { kind: ActionKind; line?: Line; cardUid?: string; faceUp?: boolean }[]`（在 action 步骤返回 play（含每张可打卡、每合法线、正/反面）与 refresh；在 check-compile 步骤若有可编译线返回 compile 每个线）
  - `export function executeAction(s: GameState, player: PlayerId, kind: ActionKind, args?: PlayArgs): void`（分发到对应动作；compile 后调用 advanceStep 推进（跳过 action）；play/refresh 后推进到 check-cache；advance 用于其余步骤推进；**executeAction 结束时始终把当前步骤推进到下一步**，保证 UI 每步一操作）
  - `export function getWinner(s: GameState): PlayerId | null`

**设计说明：** UI 每回合逐步推进——`executeAction` 内部处理"步骤推进"。规则：`advance` 动作用于无玩家输入的步骤（start/check-control/check-cache/end）由 UI 点击"下一步"触发；`play/refresh` 只在 action 步骤可用；`compile` 只在 check-compile 步骤且有合法线时可用。编译后 `compiledThisTurn=true`，下一次 advance 会跳过 action 直达 check-cache。check-cache 步骤执行 `clearCache`（在 advance 中自动处理）。若手牌 ≤5，check-cache 无事发生。

- [ ] **Step 1: 写失败测试**

创建 `tests/events/bus.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { createBus } from '../src/core/events/bus';

describe('event bus', () => {
  it('delivers events to subscribers', () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    bus.emit({ type: 'x', state: null as never });
    expect(seen).toEqual(['x']);
  });

  it('unsubscribes', () => {
    const bus = createBus();
    let count = 0;
    const off = bus.subscribe(() => count++);
    off();
    bus.emit({ type: 'x', state: null as never });
    expect(count).toBe(0);
  });
});
```

创建 `tests/game.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { createGame, getDraftPool, performDraftPick } from '../src/core/state/create';
import { getLegalActions, executeAction } from '../src/core/game';

function draftToTurn(): ReturnType<typeof createGame> {
  const s = createGame();
  while (s.phase === 'draft') {
    performDraftPick(s, getDraftPool(s)[0].defId);
  }
  return s;
}

describe('game facade', () => {
  it('offers compile action in check-compile when forced', () => {
    const s = draftToTurn();
    // 把线 0 堆成 10 点：10 张 spirit-1
    s.players[0].stacks[0] = Array.from({ length: 10 }, (_, i) => ({
      uid: `x${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 0 as const, pos: i,
    }));
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    const legal = getLegalActions(s, 0);
    expect(legal.some((a) => a.kind === 'compile' && a.line === 0)).toBe(true);
  });

  it('plays a card and advances to check-cache', () => {
    const s = draftToTurn();
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    executeAction(s, 0, 'advance'); // check-compile → action
    // 从手牌找一张与某条线协议匹配的卡（正面打入的前提）
    const p = s.players[0];
    let target: { cardUid: string; line: 0 | 1 | 2 } | null = null;
    for (const card of p.hand) {
      const proto = card.defId.split('-')[0];
      const line = p.protocols.findIndex((pr) => pr.defId === proto);
      if (line !== -1) {
        target = { cardUid: card.uid, line: line as 0 | 1 | 2 };
        break;
      }
    }
    expect(target).not.toBeNull();
    executeAction(s, 0, 'play', { cardUid: target!.cardUid, faceUp: true, line: target!.line });
    expect(s.players[0].stacks[target!.line]).toHaveLength(1);
    expect(s.step).toBe('check-cache');
  });

  it('advance through full turn cycle returns to start of next player', () => {
    const s = draftToTurn();
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    executeAction(s, 0, 'advance'); // check-compile → action
    executeAction(s, 0, 'advance'); // action → check-cache
    executeAction(s, 0, 'advance'); // check-cache → end
    executeAction(s, 0, 'advance'); // end → (P1 结束) start(换人)
    expect(s.turnPlayer).toBe(1);
    expect(s.step).toBe('start');
  });

  it('declares a winner when the third protocol compiles', () => {
    const s = draftToTurn();
    // 预置：P1 前两条协议已编译，第三条线堆满 10 点
    s.players[0].protocols[0].compiled = true;
    s.players[0].protocols[1].compiled = true;
    s.players[0].stacks[2] = Array.from({ length: 10 }, (_, i) => ({
      uid: `w${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 2 as const, pos: i,
    }));
    // 推进到 check-compile
    while (s.step !== 'check-compile') {
      executeAction(s, 0, 'advance');
    }
    executeAction(s, 0, 'compile', { line: 2 });
    expect(s.winner).toBe(0);
    expect(s.phase).toBe('gameover');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/events/bus.test.ts tests/game.test.ts`
预期：FAIL —— 找不到模块。

- [ ] **Step 3: 实现事件总线与门面**

创建 `src/core/events/bus.ts`：

```typescript
import type { GameState } from '../models/types';

export interface GameEvent {
  type: string;
  state: GameState;
  payload?: unknown;
}

export interface EventBus {
  subscribe(fn: (e: GameEvent) => void): () => void;
  emit(e: GameEvent): void;
}

export function createBus(): EventBus {
  const subs = new Set<(e: GameEvent) => void>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    emit(e) {
      for (const fn of [...subs]) fn(e);
    },
  };
}
```

创建 `src/core/game.ts`：

```typescript
import type { GameState, PlayerId, Line } from './models/types';
import { advanceStep } from './engine/turn';
import { clearCache } from './engine/deck';
import { playCard, refreshHand } from './actions/base';
import { executeCompile, getCompilableLines } from './rules/compile';

export type ActionKind = 'play' | 'refresh' | 'compile' | 'advance';

export interface PlayArgs {
  cardUid: string;
  faceUp: boolean;
  line: Line;
}

export interface LegalAction {
  kind: ActionKind;
  line?: Line;
  cardUid?: string;
  faceUp?: boolean;
}

export function getLegalActions(s: GameState, player: PlayerId): LegalAction[] {
  if (s.phase !== 'turn' || s.turnPlayer !== player || s.winner !== null) return [];
  const out: LegalAction[] = [];
  if (s.step === 'action') {
    for (const card of s.players[player].hand) {
      // 正面：只能进匹配线；背面：任意线
      for (const line of [0, 1, 2] as Line[]) {
        const def = getCardDefSafe(card.defId);
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
  }
  // 无玩家输入的步骤（start/check-control/check-cache/end）或本步骤无事可做 → 允许推进
  out.push({ kind: 'advance' });
  return out;
}

function getCardDefSafe(defId: string): { protocol: string } {
  // 内联以避免循环依赖：仅取协议字段
  return { protocol: defId.split('-')[0] };
}

export function executeAction(s: GameState, player: PlayerId, kind: ActionKind, args?: PlayArgs): void {
  if (s.phase !== 'turn' || s.winner !== null) throw new Error('game not in turn phase');
  if (s.turnPlayer !== player) throw new Error('not your turn');

  switch (kind) {
    case 'play': {
      if (!args) throw new Error('play requires args');
      playCard(s, player, args.cardUid, args.faceUp, args.line);
      advanceStep(s);
      break;
    }
    case 'refresh': {
      refreshHand(s, player);
      advanceStep(s);
      break;
    }
    case 'compile': {
      if (!args) throw new Error('compile requires args.line');
      executeCompile(s, player, args.line);
      advanceStep(s); // compiledThisTurn=true → 跳过 action
      break;
    }
    case 'advance': {
      if (s.step === 'check-cache') {
        clearCache(s, player);
      }
      advanceStep(s);
      break;
    }
  }
}

export function getWinner(s: GameState): PlayerId | null {
  return s.winner;
}
```

**重要修正说明：** `getCardDefSafe` 用 `defId.split('-')[0]` 取协议名——演示数据的 defId 形如 `spirit-1`，协议名即前缀。若真实卡牌 defId 与协议名不一致（阶段 2 引入真实数据时），此函数应改为从 `src/data/demo.ts` 导入 `getCardDef`。当前保持内联避免循环依赖（demo → create → actions → game → demo）。**阶段 2 若发现协议名 ≠ defId 前缀，替换此处实现为基于 `getCardDef` 的查找即可。**

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/events/bus.test.ts tests/game.test.ts`
预期：PASS（bus 2 个 + game 4 个）。

- [ ] **Step 5: 提交**

```bash
git add src/core/events/bus.ts src/core/game.ts tests/events/bus.test.ts tests/game.test.ts
git commit -m "feat: event bus and game facade (legal actions, execute, winner)"
```

---

### Task 10: UI 渲染层（DOM 组件）

**Files:**
- Create: `src/ui/render.ts`
- Create: `src/ui/styles.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `GameState`、`PlayerId`、`Line`、`Card`（Task 2）；`getCardDef`、`getProtocolDef`（Task 3）；`getLineValue`（Task 5）；`getLegalActions`、`LegalAction`（Task 9）
- Produces:
  - `export interface UiCallbacks { onAction(a: LegalAction): void; onDraftPick(defId: string): void }`
  - `export function renderApp(root: HTMLElement, s: GameState, cb: UiCallbacks): void`（全量重渲染：草案界面或战场界面）
  - `export function renderDraft(root: HTMLElement, s: GameState, cb: UiCallbacks): void`
  - `export function renderBoard(root: HTMLElement, s: GameState, cb: UiCallbacks): void`

**渲染规则：**
- 草案阶段：显示可选协议池（每个协议卡显示 name/commands/loadingText + "选择"按钮，点击调 `cb.onDraftPick(defId)`）与当前选者提示
- 战场阶段：上下两个玩家区（对手区显示手牌背面、己方区显示手牌正面）；每条线显示协议卡（Loading… 或 Compiled）+ 堆叠卡（正面/背面）；牌库/弃牌堆数量；控制组件位置；回合步骤指示器（显示当前 step 与当前玩家）；底部操作区：根据 `getLegalActions(s, turnPlayer)` 渲染按钮（打牌需先选卡：点击手牌选中 → 高亮可打线 → 点击线执行 play；refresh 按钮；compile 按钮；advance 按钮）；游戏日志
- 胜利时显示胜者横幅

**样式：** `styles.css` 提供基础布局（flex 分区、卡牌尺寸、选中高亮、按钮）。本阶段样式简洁（Gemini 场景美化属阶段 2+）。

- [ ] **Step 1: 写失败测试（构建级验证）**

本任务 UI 用 `npm run build`（tsc 类型检查 + vite 构建）作为门禁。先把 `main.ts` 改为完整装配（引用尚不存在的 `./ui/render` 与 `./ui/styles.css`），构建必然失败。

修改 `src/main.ts`（替换 Task 1 的占位内容）：

```typescript
import './ui/styles.css';
import { createGame, performDraftPick } from './core/state/create';
import { executeAction } from './core/game';
import { renderApp, type UiCallbacks } from './ui/render';

const root = document.getElementById('app')!;
const state = createGame();

const cb: UiCallbacks = {
  onDraftPick(defId) {
    performDraftPick(state, defId);
    renderApp(root, state, cb);
  },
  onAction(a) {
    if (state.phase === 'gameover') return;
    executeAction(state, state.turnPlayer, a.kind, a);
    renderApp(root, state, cb);
  },
};

renderApp(root, state, cb);
```

- [ ] **Step 2: 验证构建失败**

运行：`npm run build`
预期：FAIL —— `Cannot find module './ui/render'`（以及 `./ui/styles.css`）。

- [ ] **Step 3: 实现渲染层**

创建 `src/ui/render.ts`：

```typescript
import type { GameState, PlayerId, Line } from '../core/models/types';
import { getCardDef, getProtocolDef } from '../data/demo';
import { getLineValue, getDraftPool } from '../core/state/create';
import { getLegalActions, type LegalAction } from '../core/game';

export interface UiCallbacks {
  onAction(a: LegalAction): void;
  onDraftPick(defId: string): void;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderCardFace(card: { defId: string; faceUp: boolean }): HTMLElement {
  const def = getCardDef(card.defId);
  const box = el('div', 'card');
  box.dataset.defId = card.defId;
  if (!card.faceUp) {
    box.appendChild(el('div', 'card-back', '?'));
    return box;
  }
  box.appendChild(el('div', 'card-value', String(def.value)));
  box.appendChild(el('div', 'card-protocol', def.protocol));
  if (def.top) box.appendChild(el('div', 'card-top', def.top));
  if (def.middle) box.appendChild(el('div', 'card-middle', def.middle));
  if (def.bottom) box.appendChild(el('div', 'card-bottom', def.bottom));
  return box;
}

function renderProtocol(p: { defId: string; compiled: boolean }): HTMLElement {
  const def = getProtocolDef(p.defId);
  const box = el('div', 'protocol' + (p.compiled ? ' compiled' : ''));
  box.appendChild(el('div', 'protocol-name', p.compiled ? `${def.name} ✓` : def.name));
  box.appendChild(el('div', 'protocol-loading', p.compiled ? 'COMPILED' : def.loadingText));
  return box;
}

function renderStackLine(s: GameState, player: PlayerId, line: Line, selected: string | null, onPlay: (line: Line) => void): HTMLElement {
  const zone = el('div', 'line-zone');
  zone.appendChild(renderProtocol(s.players[player].protocols[line]));
  const stack = el('div', 'stack');
  for (const card of s.players[player].stacks[line]) {
    const node = renderCardFace(card);
    node.dataset.uid = card.uid;
    if (selected === card.uid) node.classList.add('selected');
    stack.appendChild(node);
  }
  zone.appendChild(stack);
  zone.appendChild(el('div', 'line-value', `值 ${getLineValue(s, player, line)}`));
  zone.addEventListener('click', () => onPlay(line));
  return zone;
}

function renderPlayerArea(s: GameState, player: PlayerId, opts: { isSelf: boolean; selected: string | null; onSelect: (uid: string) => void; onPlay: (line: Line) => void }): HTMLElement {
  const p = s.players[player];
  const area = el('div', 'player-area' + (player === s.turnPlayer ? ' active' : ''));
  area.appendChild(el('div', 'area-title', `玩家 ${player + 1}${player === s.turnPlayer ? '（回合中）' : ''}`));

  const meta = el('div', 'meta-row');
  meta.appendChild(el('span', 'deck-count', `牌库 ${p.deck.length}`));
  meta.appendChild(el('span', 'trash-count', `弃牌堆 ${p.trash.length}`));
  meta.appendChild(el('span', 'hand-count', `手牌 ${p.hand.length}`));
  area.appendChild(meta);

  const lines = el('div', 'lines');
  for (const line of [0, 1, 2] as Line[]) {
    lines.appendChild(renderStackLine(s, player, line, opts.selected, opts.onPlay));
  }
  area.appendChild(lines);

  const hand = el('div', 'hand');
  for (const card of p.hand) {
    const node = renderCardFace({ defId: card.defId, faceUp: opts.isSelf });
    node.dataset.uid = card.uid;
    if (opts.selected === card.uid) node.classList.add('selected');
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onSelect(card.uid);
    });
    hand.appendChild(node);
  }
  area.appendChild(hand);
  return area;
}

export function renderDraft(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'draft-screen');
  wrap.appendChild(el('h1', 'title', 'Compile 译世界 — 协议草案'));
  wrap.appendChild(el('div', 'draft-hint', `轮到 玩家 ${s.turnPlayer + 1} 选择协议`));
  const pool = el('div', 'draft-pool');
  for (const proto of getDraftPool(s)) {
    const card = el('div', 'protocol-card');
    card.appendChild(el('div', 'protocol-name', proto.name));
    card.appendChild(el('div', 'protocol-commands', proto.commands.join(' · ')));
    card.appendChild(el('div', 'protocol-loading', proto.loadingText));
    const btn = el('button', 'btn', '选择');
    btn.addEventListener('click', () => cb.onDraftPick(proto.defId));
    card.appendChild(btn);
    pool.appendChild(card);
  }
  wrap.appendChild(pool);
  root.appendChild(wrap);
}

export function renderBoard(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'board');
  if (s.phase === 'gameover' && s.winner !== null) {
    wrap.appendChild(el('div', 'winner-banner', `玩家 ${s.winner + 1} 获胜！`));
  }

  const opp = renderPlayerArea(s, s.turnPlayer === 0 ? 1 : 0, { isSelf: false, selected: null, onSelect: () => {}, onPlay: () => {} });
  wrap.appendChild(opp);

  const midline = el('div', 'midline');
  midline.appendChild(el('div', 'step-indicator', `步骤: ${s.step} · 控制组件: ${s.control === -1 ? '中立' : `玩家 ${s.control + 1}`}`));
  wrap.appendChild(midline);

  const self = renderPlayerArea(s, s.turnPlayer, {
    isSelf: true,
    selected: selectedUid,
    onSelect: (uid) => { selectedUid = uid; renderApp(root, s, cb); },
    onPlay: (line) => {
      if (selectedUid) cb.onAction({ kind: 'play', cardUid: selectedUid, faceUp: true, line });
      selectedUid = null;
    },
  });
  wrap.appendChild(self);

  const actionBar = el('div', 'action-bar');
  const legal = getLegalActions(s, s.turnPlayer);
  for (const a of legal) {
    if (a.kind === 'play') continue; // 打牌通过点击手牌+线完成
    const label = a.kind === 'compile' ? `编译线 ${(a.line ?? 0) + 1}` : a.kind === 'refresh' ? '刷新手牌' : '下一步';
    const btn = el('button', 'btn', label);
    btn.addEventListener('click', () => cb.onAction(a));
    actionBar.appendChild(btn);
  }
  // 打牌提示
  if (s.step === 'action') {
    actionBar.appendChild(el('span', 'hint', selectedUid ? '点击一条线放置卡牌（正面）' : '点击手牌选择卡牌'));
  }
  wrap.appendChild(actionBar);

  const log = el('div', 'log');
  for (const entry of s.log.slice(-12)) {
    log.appendChild(el('div', 'log-entry', entry));
  }
  wrap.appendChild(log);

  root.appendChild(wrap);
}

let selectedUid: string | null = null;

export function renderApp(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  if (s.phase === 'draft') {
    renderDraft(root, s, cb);
  } else {
    renderBoard(root, s, cb);
  }
}
```

**实现说明：** 本任务 UI 是"够用"级别：打牌交互 = 点击手牌选中 → 点击目标线（正面打入匹配线；本阶段 UI 只提供正面打入，背面打入按钮在下一步骤 Task 11 补全）。选中状态存在模块级变量 `selectedUid`，重渲染时保持。

创建 `src/ui/styles.css`：

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; }
#app { max-width: 1100px; margin: 0 auto; padding: 12px; }

.board { display: flex; flex-direction: column; gap: 10px; }
.player-area { border: 1px solid #444; border-radius: 8px; padding: 8px; background: #22223a; }
.player-area.active { border-color: #e0a030; }
.area-title { font-weight: bold; margin-bottom: 4px; }
.meta-row { display: flex; gap: 16px; font-size: 13px; color: #aaa; margin-bottom: 6px; }
.lines { display: flex; gap: 12px; }
.line-zone { flex: 1; border: 1px dashed #555; border-radius: 6px; padding: 6px; min-height: 120px; cursor: pointer; }
.line-zone:hover { border-color: #e0a030; }
.protocol { border: 1px solid #888; border-radius: 6px; padding: 6px; margin-bottom: 6px; background: #2a2a44; text-align: center; }
.protocol.compiled { border-color: #4caf50; color: #4caf50; }
.protocol-name { font-weight: bold; }
.protocol-loading { font-size: 11px; color: #aaa; }
.stack { display: flex; flex-wrap: wrap; gap: 4px; min-height: 90px; }
.card { width: 90px; min-height: 126px; border: 1px solid #888; border-radius: 6px; padding: 4px; background: #33335a; font-size: 11px; position: relative; }
.card.selected { border-color: #e0a030; box-shadow: 0 0 8px #e0a030; }
.card-back { display: flex; align-items: center; justify-content: center; height: 110px; background: #2a2a44; border-radius: 4px; font-size: 28px; color: #888; }
.card-value { font-size: 18px; font-weight: bold; }
.card-protocol { font-size: 10px; color: #aaa; margin-bottom: 2px; }
.card-top, .card-middle, .card-bottom { margin-top: 3px; line-height: 1.3; }
.line-value { font-size: 12px; color: #e0a030; margin-top: 4px; text-align: right; }
.hand { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; min-height: 80px; }
.hand .card { cursor: pointer; }
.midline { text-align: center; padding: 6px; border-top: 1px solid #444; border-bottom: 1px solid #444; }
.step-indicator { font-size: 13px; color: #ccc; }
.action-bar { display: flex; gap: 8px; align-items: center; padding: 8px 0; }
.btn { padding: 6px 12px; border-radius: 6px; border: none; background: #e0a030; color: #111; font-weight: bold; cursor: pointer; }
.btn:hover { background: #f0b040; }
.hint { font-size: 12px; color: #aaa; }
.log { border-top: 1px solid #444; margin-top: 8px; padding-top: 6px; font-size: 12px; color: #999; max-height: 120px; overflow-y: auto; }
.winner-banner { font-size: 24px; font-weight: bold; color: #4caf50; text-align: center; padding: 12px; }

.draft-screen { text-align: center; }
.title { margin-bottom: 12px; }
.draft-hint { margin-bottom: 12px; color: #e0a030; }
.draft-pool { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.protocol-card { border: 1px solid #888; border-radius: 8px; padding: 10px; background: #2a2a44; width: 180px; }
.protocol-commands { font-size: 12px; color: #aaa; margin: 6px 0; }
```

- [ ] **Step 4: 验证构建通过**

运行：`npm run build`
预期：`tsc --noEmit` 无错误，vite 产出 `dist/`。

运行：`npx vitest run`
预期：全部既有测试 PASS（无回归）。

- [ ] **Step 5: 提交**

```bash
git add src/ui/render.ts src/ui/styles.css src/main.ts
git commit -m "feat: DOM render layer (draft screen, board, action bar)"
```

---

### Task 11: 热座装配完善（背面打入 / 交接提示 / 刷新按钮）

**Files:**
- Modify: `src/ui/render.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 10 全部产出
- Produces: 可玩的完整热座循环：打牌（正/反面）、刷新、编译、步骤推进、草案、胜负、交接提示

**变更点：**
1. 手牌选中后，操作栏显示「正面打入」「背面打入」两个按钮（带目标线选择：点击线时应用所选朝向）
2. 回合切换时显示"请将设备交给玩家 N"的交接遮罩
3. refresh 按钮在 action 步骤且手牌 <5 时始终可用（getLegalActions 已含）

- [ ] **Step 1: 写失败测试（构建级）**

先改 `render.ts` 增加朝向状态变量 `selectedFaceUp: boolean`，`renderBoard` 中打牌提示与按钮逻辑引用它；`main.ts` 不变。构建先失败（`selectedFaceUp` 未定义）。

- [ ] **Step 2: 验证构建失败**

运行：`npm run build`
预期：FAIL —— `Cannot find name 'selectedFaceUp'`。

- [ ] **Step 3: 实现完善**

修改 `src/ui/render.ts`：

在 `let selectedUid: string | null = null;` 后添加：

```typescript
let selectedFaceUp = true;
```

将 `renderBoard` 中 `self` 的 `onPlay` 改为：

```typescript
onPlay: (line) => {
  if (selectedUid) {
    cb.onAction({ kind: 'play', cardUid: selectedUid, faceUp: selectedFaceUp, line });
    selectedUid = null;
    selectedFaceUp = true;
  }
},
```

将 `renderBoard` 中 action-bar 的打牌提示块替换为：

```typescript
if (s.step === 'action') {
  if (selectedUid) {
    const upBtn = el('button', 'btn', '正面打入');
    upBtn.addEventListener('click', () => { selectedFaceUp = true; renderApp(root, s, cb); });
    const downBtn = el('button', 'btn', '背面打入');
    downBtn.addEventListener('click', () => { selectedFaceUp = false; renderApp(root, s, cb); });
    actionBar.appendChild(upBtn);
    actionBar.appendChild(downBtn);
    actionBar.appendChild(el('span', 'hint', `朝向: ${selectedFaceUp ? '正面' : '背面'} — 点击一条线放置`));
  } else {
    actionBar.appendChild(el('span', 'hint', '点击手牌选择卡牌'));
  }
}
```

在 `renderBoard` 开头（`root.textContent = ''` 之后）添加热座交接提示：

```typescript
if (s.phase === 'turn' && s.step === 'start') {
  const handoff = el('div', 'handoff-banner', `▶ 请将设备交给 玩家 ${s.turnPlayer + 1}，然后点击「下一步」开始`);
  wrap.appendChild(handoff);
}
```

在 `styles.css` 追加：

```css
.handoff-banner { background: #e0a030; color: #111; font-weight: bold; text-align: center; padding: 8px; border-radius: 6px; margin-bottom: 8px; }
```

修改 `src/main.ts`（保持既有逻辑，仅补充：action 回调里对 `advance` 时若 step 为 start 且是交接后首次，无需特殊处理——renderApp 自动显示提示）：

`src/main.ts` 无需改动，交接提示由 `renderBoard` 自动渲染。**若未改动则本步骤不修改 main.ts。**

- [ ] **Step 4: 验证构建通过**

运行：`npm run build`
预期：通过。

运行：`npx vitest run`
预期：全部 PASS。

手动冒烟（可选）：`npm run dev` → 浏览器打开 `http://localhost:5173`，走完草案 → 打牌/刷新/编译 → 一局胜负。

- [ ] **Step 5: 提交**

```bash
git add src/ui/render.ts src/ui/styles.css
git commit -m "feat: hotseat polish (face-down play, handoff banner)"
```

---

### Task 12: 阶段文档与全局记忆收尾

**Files:**
- Create: `docs/stage1-framework.md`
- Modify: `E:\studyE\Deepseek memory\compile-web-project.md`（更新进度与阶段 2 入口）
- Create: `docs/gemini-task-template.md`（Gemini 生成任务单模板，供后续阶段使用）

**Interfaces:**
- Consumes: 全部任务产出
- Produces: 零上下文 agent 可续作的完整阶段文档

- [ ] **Step 1: 写阶段文档**

创建 `docs/stage1-framework.md`，内容包含：
1. 已完成功能清单（引擎/草案/回合/编译/动作/UI/热座）
2. 项目结构树与每文件职责
3. 如何运行（`npm install` / `npm run dev` / `npm run test` / `npm run build`）
4. 已知限制（占位 Fire 数据、无卡牌特效、无 AI、无背面卡值=2 的 UI 显示、无控制组件 UI——引擎已支持 `control` 字段但 UI 未渲染）
5. **阶段 2 入口**：等待用户提供 Fire 0-5 真实卡牌文本 → 替换 `src/data/demo.ts` 中 `fire-*` 占位 → 实现 Fire 卡牌中命令 → 接入特效注册表 → 产出「Gemini 生成任务单」给火焰特效
6. 零上下文 agent 续作清单（下一步做什么、读哪些文件）

创建 `docs/gemini-task-template.md`：

```markdown
# Gemini 生成任务单模板

> 用法：复制本模板，填入任务内容，发送给 Gemini。生成物按「交付路径」放回项目。

## 任务
（一句话说明要生成什么：美术资源 / 动画代码 / 场景）

## 技术规格
- 交付格式：（CSS / SVG / Web Animations / Lottie JSON / PNG / Sprite 等）
- 尺寸/分辨率：
- 文件命名：
- 交付路径：`public/assets/<protocol>/<name>.<ext>`
- 导入方式：（在哪个文件 import/引用）

## 视觉描述
（中文详细描述：风格、氛围、配色、参考意象。例：火焰焚烧特效——粒子从卡牌表面升腾、橙红渐变、边缘焦黑……）

## 约束
- 无需真实美术功底，简洁可用即可
- 无外部依赖/免插件
- 动画时长 ≤ 1.5s，可循环可单次

## 交付物清单
- [ ] 文件1
- [ ] 文件2
```

- [ ] **Step 2: 更新全局记忆**

读取 `E:\studyE\Deepseek memory\compile-web-project.md`，将「当前进度」段更新为：

```markdown
## 5. 当前进度
- [x] 通读官方规则（MN01/MN02/Codex）
- [x] 设计文档已批准并提交：`compile\docs\superpowers\specs\2026-08-28-compile-web-design.md`
- [x] 阶段 1 基础框架完成（引擎/草案/回合/编译/动作/UI/热座）：`compile\docs\stage1-framework.md`
- [ ] 阶段 2：Fire 协议试点（**阻塞：等待用户提供 Fire 0-5 真实卡牌文本**）→ 替换 `src/data/demo.ts` 占位 → 实现命令 → 特效注册表 → Gemini 火焰特效任务单
- [ ] 阶段 3+：其余 14 套牌组逐个实现
- [ ] 后期：打包安装包（Electron/Tauri）
- [ ] 远期：AI 智能体辅助
```

（此文件位于工作区外，写入需工作区外权限。）

- [ ] **Step 3: 全量验证**

运行：`npx vitest run`
预期：全部 PASS。

运行：`npm run build`
预期：通过。

- [ ] **Step 4: 提交**

```bash
git add docs/
git commit -m "docs: stage1 framework handoff, gemini task template"
```

---

## 阶段 2 入口（本计划之外，需用户提供数据后另立计划）

1. **阻塞依赖**：用户提供 Fire 0-5 六张命令卡的真实文本（含数值与三栏命令）
2. 替换 `src/data/demo.ts` 的 `fire-*` 占位定义为真实数据
3. 若 Fire 卡牌涉及翻转/移动等效果动作，引擎层已提供原语（Task 8 的 `playCard` 与后续可扩展的 `flip/shift` 效果动作），需在阶段 2 计划中补充实现
4. 特效注册表：`src/ui/effects/registry.ts`，按 `fire:discard` / `fire:delete` 命名空间挂载 Gemini 产出的动画
5. 产出「Gemini 生成任务单」（用 `docs/gemini-task-template.md`）→ 用户复制给 Gemini → 生成物放回 `public/assets/fire/` → 接入验证

## Self-Review 记录

- **Spec coverage**：设计文档全部章节均有对应任务（架构→Task 1-9；交互→Task 10-11；特效/Gemini 工作流→Task 12 模板 + 阶段 2 入口；测试→各任务；文档→Task 12）
- **占位符扫描**：无 TBD/TODO 作为实现内容（唯一 `TODO(fire)` 是数据占位标注，已明确说明由用户数据替换）
- **类型一致性**：`GameState`/`PlayerId`/`Line`/`Card` 等签名在 Task 2 定义后，Task 4-12 全程使用同一名称；`getLineValue` 在 Task 5 定义、Task 7/10 使用；`getLegalActions`/`LegalAction` 在 Task 9 定义、Task 10/11 使用；`executeAction` 参数签名一致
