# Compile Web — 《译世界》网页版

将官方桌游 **Compile（译世界）**（Jeux Synapses Games Inc.，©2024/2025）实现为纯 HTML5 网页游戏。热座双人本地游玩，纯前端零后端。

> ⚠️ 本项目为个人学习/自用项目。官方规则与卡牌文本受版权保护（Jeux Synapses Games Inc.），请勿公开分发或商用。

## 当前进度：阶段 1 — 基础框架 ✅

- 🎮 核心引擎（纯 TypeScript，零 DOM 依赖，可独立测试）
  - 1-2-2-1 协议草案（P1:1 → P2:2 → P1:2 → P2:1）
  - 6 步回合流程：Start → Check Control → Check Compile → Action → Check Cache → End
  - 编译判定：线值 **≥10 且 > 对手** 必须编译
  - 基础动作：打牌（正面须匹配协议线 / 背面任意线值=2）、刷新手牌、强制编译
- 📊 真实卡牌数据：15 套协议 × 6 张 = 90 张中文文本（含 Codex 勘误）
- 🖥️ DOM 界面：草案屏、战场（3 线堆叠）、操作栏、热座交接提示、胜负横幅
- ✅ 41 个单元测试全绿

## 运行方式

```bash
npm install        # 首次安装依赖
npm run dev        # 开发服务器（Vite）
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 预览构建产物
npm run test       # 运行测试（Vitest）
```

## 项目结构

```
src/
├── core/          # 核心引擎（纯 TS，零 DOM）
│   ├── models/    #   数据模型（Card/Protocol/Player/GameState）
│   ├── engine/    #   牌库操作、回合状态机
│   ├── rules/     #   编译判定
│   ├── actions/   #   基础动作（打牌/刷新）
│   ├── events/    #   事件总线
│   └── game.ts    #   门面：合法动作查询/执行/胜负
├── data/          # 卡牌数据（cards.ts 90 张真实文本 + demo.ts 草案池）
├── ui/            # DOM 渲染层（render.ts + styles.css）
└── main.ts        # 应用装配
tests/             # Vitest 单元测试（41 个）
docs/              # 设计文档、实施计划、阶段交接文档、Gemini 任务单模板
```

## 路线图

- [x] 阶段 1：游戏基础运行框架（引擎/UI/热座流程）
- [ ] 阶段 2：Fire（火）协议试点 — 卡牌效果引擎 + 特效注册表 + Gemini 火焰特效
- [ ] 阶段 3+：其余 14 套牌组逐个实现（卡牌效果解析 + 专属特效）
- [ ] 后期：打包为安装包（Electron/Tauri），本地双人游玩
- [ ] 远期：AI 智能体辅助

## 协作说明

- 卡牌效果/场景/交互动画美术由 **Gemini** 生成：见 `docs/gemini-task-template.md`（生成任务单模板）
- 阶段交接文档：`docs/stage1-framework.md`（零上下文 agent 续作指南）
