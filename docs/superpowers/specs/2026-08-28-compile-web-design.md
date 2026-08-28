# 《译世界》(Compile) 网页版 — 设计文档

- 日期：2026-08-28
- 状态：已获用户批准（2026-08-28）
- 范围：游戏基础运行框架（阶段 1）

## 1. 项目背景与目标

将官方桌游 **Compile（译世界）**（Jeux Synapses Games，©2024/2025）实现为纯 HTML5 网页游戏。

### 1.1 长期规划（用户确认）
1. **阶段 1（当前）**：游戏基础运行框架——引擎可跑、界面可渲染、热座双人可完整打完一局基础游戏
2. **阶段 2+**：逐个实现 15 套牌组（MN01×12 + AX01×3）及其卡牌特效；**首个试点 = Fire（火）协议**
3. **后期**：打包为安装包（Electron/Tauri），发送给别人本地游玩（热座）
4. **远期**：为游戏添加 AI 智能体辅助用户

### 1.2 已确认的项目决策
| 项目 | 决策 |
|---|---|
| 游戏 | 《译世界》Compile 官方规则（MN01 + MN02 规则书 + Codex FAQ/勘误） |
| 牌组范围 | 15 套 = MN01×12（Spirit/Death/Fire/Gravity/Life/Light/Metal/Plague/Psychic/Speed/Water/Darkness）+ AX01×3（Apathy/Hate/Love） |
| 牌面美术 | 官方 PNG（自用，注意官方版权：不可公开再分发） |
| 特效/场景美术 | **Gemini 生成**（用户复制提示词 → Gemini 产出 → 放回项目指定路径） |
| 卡牌文本数据 | **用户后续提供**（当前模型无法读图/OCR 不可用，不能从 PNG 提取） |
| 技术栈 | Vite + TypeScript |
| 游戏模式 | 热座双人（Hotseat）为主，AI 对手后期加 |
| 打包目标 | 安装包（后期），本地游玩 |
| 全局记忆 | `E:\studyE\Deepseek memory`（跨项目规则知识库） |
| 阶段文档 | 每阶段完成后留 md 文档，供零上下文 agent 续作 |

## 2. 规则要点（实现依据）

官方规则书 EN-COMP-MN01/MN02 + The Compile Codex（FAQ/勘误）。

### 2.1 游戏概述
- 双人 1v1 竞争卡牌游戏；玩家是 rogue AI，竞速编译自己的 3 个协议
- **胜利条件**：第一个将全部 3 个协议卡翻到 "Compiled" 面朝上的玩家获胜

### 2.2 设置（Setup）
1. **草案（Draft）**：年轻者先选 → 轮流 4-2-2-1 轮选（P1 选 1 → P2 选 2 → P1 选 2 → P2 选 1），剩余协议放回盒子
2. 每个玩家将 3 个协议卡 "Loading…" 面朝上放在场中央，从左到右按草案顺序 → 形成 3 条线（line），每条线由双方对应位置的两个协议定义
3. 每个玩家将各自的 18 张命令卡（3 协议 × 每协议 6 张）洗成牌库，旁边设弃牌堆（trash）
4. 每个玩家抽起始手牌 5 张

### 2.3 回合流程（6 步，严格顺序）
1. **Start**：执行己方场上可见的 "Start" 效果
2. **Check Control**（可选规则）：至少在 2 条线总值高于对手 → 获得控制组件
3. **Check Compile**：满足编译条件则**必须编译**，且为本回合唯一行动
4. **Action**：打出 1 张牌 或 刷新手牌；无牌可打时必须刷新
5. **Check Cache**：手牌 >5 时必须弃至 5 张
6. **End**：执行己方场上可见的 "End" 效果

### 2.4 玩家默认操作集（无特效时仅有 3 种）
1. **打出卡牌**：正面朝上 → 只能打入协议匹配的线，结算中间命令；反面朝下 → 可打入任意线，无协议/命令，印刷值固定 2
2. **刷新手牌**：手牌 <5 时抽至 5 张（牌库不足则洗弃牌堆重组牌库）；手牌 ≥5 时不能刷新
3. **编译协议**（强制）：某线总值 **≥10 且 > 对手同线值** 时必须编译该线

> ⚠️ **交互设计关键约束**：`Flip / Shift / Return / Delete / Discard / Reveal` 等操作**不是**默认操作，只通过卡牌效果文本授予。UI 只在当前合法动作集内提供交互入口，其余一律禁用。

### 2.5 编译（Compile）细节
- 编译：删除该线双方所有卡牌（同时删除，"all" 效果，不触发任何卡牌文本）→ 翻转己方该线协议卡为 "Compiled" 面
- 每回合最多编译一条线（满足多条时自选一条）
- **重新编译**已编译的线：同样删除双方卡牌，但不翻协议，改为抽对手牌库顶 1 张牌（所有权变更）
- 编译一旦开始，即使通过卡牌效果使该线总值降至 <10 或 ≤ 对手，编译仍照常结算
- 有控制组件时：编译/刷新前先归还控制组件至中立位，然后可选择重排一名玩家的协议位置（不能换边，线上卡牌不移动）

### 2.6 关键机制
- **覆盖（Covered）**：线内已有卡牌再打出/移入卡牌时，旧卡被覆盖；价值与顶部命令始终可见
- **未覆盖（Uncovered）**：线内堆叠最顶端（离协议最远）的卡牌；默认只有未覆盖卡牌可被操作
- **覆盖卡牌**只能被写明 "covered cards" 或 "all" 的效果影响
- **顶部命令（Top Command）**：持久被动文本，卡牌正面朝上时永不被覆盖（即使被覆盖也生效）
- **中间命令（Middle Command）**：立即生效文本，打出/翻面朝上/被揭露时结算；被覆盖的卡牌中间命令不触发
- **底部命令（Bottom Command）**：辅助被动文本，仅未覆盖时有效
- **文本进入（Text Entering Play）**：活跃文本结算会打断其他文本（后进先出 LIFO）；同时结算时由当前回合玩家决定顺序
- **弃牌/删牌**：进入拥有者弃牌堆，正面朝上（公开信息）
- **重洗**：只有抽牌触发弃牌堆重洗；牌库为空时非抽牌效果不能涉及牌库顶
- **信息**：手牌私有；场上正面卡、弃牌堆内容、手牌/牌库/弃牌堆数量公开
- **所有权**：卡牌更换拥有者后保持新归属直至游戏结束或再次变更
- **协议重排**：只移动协议卡本身，不移动该线上卡牌；重排结果必须与初始不同
- **卡牌效果可打破规则**："The cards are right."

### 2.7 Codex 关键勘误/澄清（实现时须遵守）
- Death 1（勘误）：顶命令应为 "Start: You may draw 1 card. If you do, delete 1 other card. Then, delete this card."
- Fire 0（勘误）：底命令应为 "When this card would be covered: First, draw 1 card. Then, flip 1 other card."
- Metal 1（勘误）：中命令应为 "Draw 2 cards. Your opponent cannot compile on their next turn."
- Spirit 1（勘误）：顶命令应为 "When you play cards face-up, they may be played without matching protocols."
- Life 0（勘误）：顶命令 "End: If this card is covered, delete this card."；无底命令
- Hate 2（勘误）：中命令 "Delete your highest value uncovered card. Delete your opponent's highest value uncovered card."
- 其余完整勘误清单见 Codex 文档（实现对应协议时逐条核对）

## 3. 架构设计（已确认：分层架构）

```
compile-web/
├── src/
│   ├── core/          # 核心引擎层（纯 TS，零 DOM 依赖，可独立测试）
│   │   ├── state/     #   游戏状态机 + 不可变状态
│   │   ├── engine/    #   回合流程驱动（Start→Check→Action→Cache→End）
│   │   ├── rules/     #   规则判定（编译条件、覆盖、目标合法性）
│   │   ├── actions/   #   操作原语（playCard/refresh/compile + 效果动作）
│   │   ├── events/    #   事件总线（状态变更广播）
│   │   └── models/    #   数据模型（Card/Protocol/Player/GameState）
│   ├── data/          # 数据层：卡牌 JSON/TS + 类型 schema + 加载器
│   ├── ui/            # 渲染层（DOM 组件：战场/手牌/牌库/弃牌堆/卡牌组件）
│   └── app/           # 应用装配（热座模式、场景切换）
├── tests/             # 规则引擎单元测试
├── docs/              # 每阶段 md 文档（供零上下文 agent 续作）
└── public/assets/     # 官方 PNG + Gemini 生成资产
```

### 3.1 单向数据流
```
玩家操作 → 校验 → 执行 action（修改核心状态）→ 广播事件 → UI 重渲染
```
核心引擎不依赖 DOM；UI 是状态的投影。这是后期 AI 对手与特效系统的前提。

### 3.2 数据模型草案
```typescript
interface Card {
  id: string;            // 唯一实例 id
  defId: string;         // 卡牌定义 id（如 "fire-1"）
  owner: 0 | 1;
  faceUp: boolean;
  zone: Zone;            // hand | deck | field | trash
  line?: 0 | 1 | 2;      // 场上所在线
}

interface Protocol {     // 协议卡
  defId: string; name: string; set: 'MN01' | 'AX01';
  commands: string[];    // 协议命令关键词
  loadingText: string;
  compiled: boolean;
}

interface GameState {
  phase: 'draft' | 'setup' | 'turn' | 'gameover';
  turn: { player: 0 | 1; step: Step };
  players: [Player, Player];  // hand/deck/trash/protocols/lines
  control: -1 | 0 | 1;        // 控制组件位置
}
```

### 3.3 动作原语分级
```
基础动作（玩家默认）：playCard(faceUp/faceDown)、refresh、compile
效果动作（特效授予）：flip / shift / return / delete / discard / draw / reveal …
```

## 4. 交互与 UI 设计

### 4.1 热座布局
```
┌─────────────────────────────────────────────┐
│  对手区：手牌(背面) / 3条线(协议+堆叠) / 牌库+弃牌堆  │
│  ───────────────────────────────────────────│
│  战场中央：3 条线（每条线 = 双方协议相对）控制组件位置   │
│  ───────────────────────────────────────────│
│  己方区：手牌(正面) / 3条线(协议+堆叠) / 牌库+弃牌堆   │
│  底部操作栏：回合步骤指示 / 操作按钮 / 日志          │
└─────────────────────────────────────────────┘
```

### 4.2 交互规则（关键约束）
- 玩家仅能在**当前合法动作集**内操作：默认 = 打牌（正/反面）、刷新、强制编译
- 效果授予的操作（翻转/移动等）触发时才出现目标选择 UI：点击选择 → 高亮合法目标（默认仅未覆盖卡牌）→ 执行
- 热座切换有明确的"交接提示"

## 5. 特效系统架构（Gemini 协作核心）

```
卡牌数据 defId → 特效注册表（effects registry）
    ├── 基础动画（CSS / Web Animations API，引擎无关）
    ├── 粒子特效（Canvas overlay 或 Lottie，由 Gemini 产出）
    └── 场景氛围（背景、牌桌材质，由 Gemini 产出）
```

- 特效按协议命名空间挂载：`fire:discard`、`fire:delete` 等
- 引擎只发**语义事件**（如 `card:deleted`），特效层订阅后播放对应动画；**引擎不知道特效存在**
- 每套协议有自己的基础使用特效（例：Fire 的弃牌/删牌在基础特效上叠加火焰焚烧动画）
- 保证后期换肤、禁用特效、AI 加速模式只需改特效层

## 6. Gemini 协作工作流（用户已确认）

用户复制提示词 → Gemini 产出（美术/代码）→ 按约定路径放回项目 → 我方接入验证。

### 6.1 「Gemini 生成任务单」内容
- 技术规格（尺寸、格式、命名、目录路径、导入方式）
- 中文视觉描述（风格、氛围、参考）
- 可选的代码需求（特效的 TS/CSS 实现）
- 交付物放置路径约定

### 6.2 交付格式偏好
- 首选：CSS / SVG / Web Animations（轻量、免插件）
- 复杂粒子才用 Lottie JSON

## 7. 测试策略

- 规则引擎单元测试（框架自带测试框架，如 Vitest）：
  - 回合流程 6 步顺序
  - 编译判定（≥10 且 > 对手；=10 可编译；多条线时选一）
  - 覆盖/翻转/揭露机制
  - 弃牌重洗、信息可见性
- 首个协议试点 Fire：跑通"数据 → 引擎 → UI → 特效"全链路

## 8. 阶段文档与全局记忆

- 每阶段完成后：更新 `docs/` 阶段文档（当前状态、下一步、已知问题、零上下文 agent 续作指南）
- 全局记忆同步：规则概要、项目状态写入 `E:\studyE\Deepseek memory`

## 9. 风险与注意

- **版权**：官方素材与规则仅限自用，不可公开再分发
- **卡牌文本**：依赖用户提供（模型无法读图、环境无 OCR）
- **Gemini 资产**：格式兼容性需在接入时验证（尺寸/命名/格式不符时返工）
