# 阶段 1 文档：基础运行框架（Compile《译世界》网页版）

> 本文件是阶段 1 的完整交接文档，供**零上下文 agent** 直接续作阶段 2。
> 日期：2026-08-28 · 分支：`main`（feature/stage1-framework 已合并删除） · HEAD：`7ef688c` · 测试：41/41 通过 · 构建：通过

---

## 0. 最新状态（2026-08-28 收尾，续作从这里开始）

- **阶段 1 全部完成并已合并回 `main`**（合并提交 `011359e`，16 个提交）；feature 分支已删除。
- **已推送 GitHub**：`https://github.com/foreverin2/Compile-Web.git`（origin，远程 main = 本地 `7ef688c`，用户已设为**私有仓库**）。
- 追加提交：`7ef688c` = README.md + .gitattributes（统一 LF，消除 CRLF 警告）。
- 最终全分支审查发现的 4 项 Important 已修复（提交 `81e29aa`）：
  1. 强制编译不可跳过（check-compile 有可编译线时 `getLegalActions` 不再提供 `advance`，`executeAction` advance 抛错）
  2. 草案提示用 `getCurrentDrafter(s)`（原误用 `s.turnPlayer`，草案期间不更新）
  3. 开局洗牌（`shuffle` 从 deck.ts 导出，草案结束后洗牌再抽起手；新增 1 个非确定性测试 → 共 41 个）
  4. `getCardDefSafe` 移除，改用 `getCardDef`（原伪循环依赖注释不成立）
- **环境沙箱注意事项**（重要）：`node_modules` 里的 vite 补丁（optimizeSafeRealPathSync 跳过 net use 探测）**在 `npm ci`/`npm install` 后会丢失**，需重打否则测试/构建报 EPERM；`npm install` 必须加 `--cache node_modules/.npm-cache`；`vite.config.ts` 的 `pool: 'threads'` 勿改。
- **试玩**：`npm run dev` → http://localhost:5173/（热座双人，草案 → 打牌/刷新/编译 → 3 协议全编译获胜）。
- **下一步 = 阶段 2（Fire 协议试点）**：Fire 真实文本已在 `src/data/cards.ts`（fire-0..5，含 Codex 勘误 fire-0 底命令）→ **不阻塞**。待办见下文 §5。

---

## 0.11 改进轮 11（2026-08-28，动画修复 + 抽牌动画，已完成）

HEAD `88315c2`，53 测试全绿：

1. **修复 hover-pop 重渲染重放**（关键 UX bug）：点击卡牌选中触发 renderApp 全量重渲染，鼠标悬停导致 `.popped` transition 重放 → 抽帧卡顿。修复：renderApp 重建前给 `#app` 加 `.no-anim`，双 rAF 后移除；`.no-anim` 只抑制 `transition`（不动 `animation`，保留 draft-pick-in/battery-cell-in 关键帧动画），覆盖所有 hover 过渡元素（手牌/堆叠/草案卡/按钮），控制权滑轨有意排除（其滑动是 JS 驱动）。
2. **抽牌飞入动画**：刷新（刷新手牌）时按抽牌数播放动画——`drawn` 张卡背幽灵卡从手牌区外侧（P1 左侧 / P2 右侧，与手牌生长方向一致）依次飞入，每张间隔 120ms，落地后清理并重渲染显示正面手牌。**审查修复**：幽灵卡垂直居中（offsetHeight 在 appendChild 前读取恒为 0 → 用常量 63px）+ 动画期间防重入（drawAnimBusy 标志）。
3. **弃牌堆重组确认**（无需改动）：引擎 `drawCards`（deck.ts:17-21）每抽一张前检查牌库，为空则 `shuffle(trash)` 重组继续抽——覆盖"抽到一半没牌"和"几回合后再抽"两种情况。

---

## 0.10 改进轮 10（2026-08-28，按钮重排 + 弃牌堆查看，已完成）

HEAD `fd28766`，53 测试全绿：

1. **下一步按钮居中**：操作栏改为「编译线 N」按钮 + 居中区块（灰色提示文本在上、下一步按钮居中在下）；引擎保证编译与下一步不同时出现，下一步恒为水平居中。
2. **刷新手牌移到挡板旁**：P1 按钮在挡板左侧、P2 在挡板右侧（shield 相邻兄弟元素），紧凑半透明青色样式（匹配翻面按钮）；仅当前玩家 + action 步骤 + 手牌<5 时显示。
3. **查看弃牌堆**：双方顶部信息栏各加按钮（P1 最右、P2 最左）；点击打开弃牌堆查看器（全屏遮罩 + 弃牌堆所有正面卡网格、空态、双击放大、Esc/点背景关闭）。

**审查**：Approved，5 Minor（Esc 叠层关闭、快照语义、光标、空操作栏行、瞬态重叠）均不阻塞。

---

## 0.9 改进轮 9（2026-08-28，电池修正 + 草案界面重做，已完成）

HEAD `863a06f`，53 测试全绿：

1. **电池修正**：位置 -74→**-120px**（更远离链路）；放大（壳 90×175 / 格 52×11 / 正极 32×13 / 数值 28px）；**倒过来**（DOM 顺序 value→shell→cap：数值在上、正极凸头在下、正极圆角改朝下）；`#app` padding → 140px 容纳外溢。
2. **草案界面重做**：三栏布局（P1 选择框 | 中间协议池 | P2 选择框）；协议池每行 4 个，显示**真实 Loading 面图片**（6 套演示协议）；**hover 聚焦动效**（上浮+放大+金光，无兄弟推开）+ 下方浮现「选择」按钮；已选协议**变灰禁用 + 已选徽章**；选中后加入对应玩家选择框（按 1-2-2-1 顺序，`DRAFT_PICK_OWNER` 镜像引擎 [0,1,1,0,0,1]，P1 拿 0/3/4、P2 拿 1/2/5）。
3. **额外打磨**（实现者补充）：1-2-2-1 步进追踪（6 圆点）、当前轮选列金色辉光 + ●轮选脉冲、新选协议入场动画、选择框内协议可双击放大查看。

**审查结论**：Approved，6 Minor（触摸屏无 hover 不可选、键盘无焦点可达、DRAFT_PICK_OWNER 与引擎耦合等）均不阻塞。

---

## 0.8 改进轮 8（2026-08-28，电池竖摆 + 挡板完善，已完成）

HEAD `5806b86`，53 测试全绿：

1. **电池竖摆**：电池改为垂直方向（正极在上、10 格竖排、值标签在下方），尺寸放大（壳 64×118px、格 34×7px）；位置在放置区外部贴尾部（P1 槽右缘外、P2 槽左缘外）。
2. **去掉槽文本**：移除「线一/二/三」「空」「值 N」黄色文本——数值由电池下方标签实时显示。
3. **挡板加长**：最大宽度从"手牌区一半"改为**整个手牌区宽度**（能覆盖全部手牌至协议中线）。
4. **挡板起点靠左 + 不透明**：P1 left:-28px / P2 right:-28px（覆盖手牌 padding 从更外开始）；背景改为完全不透明 `#0a0e1a`（完全遮住手牌）。
5. **挡板易触发**：手柄 16→36px 宽（更多抓取区域）。

**待用户视觉确认**：电池竖摆位置/大小、挡板覆盖范围与手感。

---

## 0.7 改进轮 7（2026-08-28，电池/挡板/控制权放大，已完成）

HEAD `70fd026`，53 测试全绿：

1. **链路电池指示器（纯 CSS）**：每条链路外侧端一个电池，10 格实时填充 = 链路点数（clamp 0-10）；4 形态按点数：≤3 stable（方正青色）/ 4-6 bulge（微鼓橙光）/ 7-9 full（膨胀强橙光+裂纹）/ ≥10 burst（爆裂径向辉光+碎片+脉冲）。**用户弃用 Gemini PNG（背景不透明无法填充），改纯 CSS**（`public/assets/battery/` PNG 已 gitignore）。电池 z-index 59（高于堆叠卡、低于 hover 弹出），pointer-events none 不挡交互。
2. **手牌挡板**：双方手牌各一块挡板，P1 左缘固定向右拉、P2 右缘固定向左拉，最大到中线（手牌区宽/2）；**仅当前回合玩家可拖动**（另一方锁定但状态保持）；被挡住的卡不触发 hover/pop/拖拽（z-index 70 遮挡）；挡板宽度>0 时中央显示「手牌 N」。
3. **控制权放大**：控制权那一行（player-strip 中列）minmax 260px→380px，控制卡 44→70px，轨道 60→84px，标签同步放大。

**审查修复**：电池 z-index 5→59（长堆叠卡会盖住"撑爆"状态）；未用 PNG 加 gitignore。

---

## 0.6 改进轮 6（2026-08-28，电池/卡背/拖拽/排序，部分完成）

HEAD `176abf8`，53 测试全绿：

1. **链路电池指示器（素材待生成）**：Gemini 提示词已产出 `docs/gemini-task-battery.md`（4 张 260×140 透明 PNG：stable/bulge/full/burst，对应点数 ≤3/4-6/7-9/10+ 四种外壳形态，内部 10 格空槽由代码 CSS 填充）。**待用户生成素材放入 `public/assets/battery/` 后实现填充逻辑**。
2. **卡背数字移除**：卡背右下角黄色「2」徽章已删除（render + CSS）。
3. **拖拽打牌**：手牌拖动（>8px 阈值进入拖拽）→ 合法链路高亮（青色 glow）→ 松开放置 / 拖回取消；保留单击选中、双击放大、翻面按钮、点击链路回退。实现为手写 mousemove/mouseup 追踪（非原生 DnD），高亮与放置共享 getLegalActions 同一合法性来源，审查 Approved。
4. **手牌按数值排序**：P1 渲染升序（左→右递增）、P2 row-reverse 渲染降序（视觉仍左→右递增）；仅显示顺序变化，引擎 hand 数组不变。

**遗留**：电池填充逻辑等素材；拖拽 release-over-source-card 会触发单击选中（无害，报告已说明）。

---

## 0.5 改进轮 5（2026-08-28，按钮整合 + 卡牌放大查看，已完成）

HEAD `68784c3`，51 测试全绿：

1. **「翻面」单按钮**：正面打出/背面打出合并为单个「翻面」按钮（宽度远小于卡面），**青紫渐变霓虹风格**（取代原黄色）；点击切换 selectedFaceUp 并在手牌区**即时翻转预览**（正↔背），点链路以当前朝向打出。
2. **布局放宽**：`#app` 1200→1400px 并移除 overflow-x:hidden（修复链路"没变长"——原被容器裁剪、以及手牌/链路边缘卡被挡的根因）；`.hand` overflow 改 visible。
3. **卡牌放大查看（双击）**：双击链路卡/手牌卡/协议卡（正反面均可）→ 全屏遮罩中央放大显示；命令卡正置、协议卡横向（原图逆时针旋转90°）；滚轮缩放 1x-6x；点击空白或 ESC 退出；遮罩挂在 document.body 上不受重渲染影响。
   - **关键实现**：`bindClickOrDouble` 单击/双击判别——单击延迟 **320ms 严格大于 300ms 双击窗口**（审查发现原 240ms 会导致慢速双击误触发打牌，已修复）；协议 zoom 用 `rotate(-90deg) scale(n)` 组合变换；`.zoom-protocol` 约束互换（80vh/80vw）防横向卡被裁；对手手牌也可双击（查看卡背）。

---

## 0.4 改进轮 4（2026-08-28，UI 交互 6 项，已完成）

HEAD `dd0e715`，51 测试全绿：

1. **打牌按钮浮动**：正面打入/背面打入按钮移出底部操作栏，改为显示在**选中的手牌上方**（按钮是卡牌的子节点，top:-34px，z-70）；鼠标移到按钮上不会触发卡牌 mouseleave（pop 特效保持）；不遮挡卡面；边缘卡有对齐回退。
2. **P2 手牌右起点**（用户中途纠正：非 P1）：P2 手牌 `flex-direction: row-reverse`（index 0 在最右、向左延伸）；P1 保持左起点。**双侧裁剪修复**：`.hand` 加 padding-left/right 各 28px，两个手牌区首/末卡边缘不再被裁。悬停推开方向对 P2 镜像。**审查修复**：row-reverse 下负 margin-left 不生效（首对卡不重叠）→ `.hand.reversed .card + .card { margin-left:0; margin-right:-28px }`。
3. **卡牌再放大**：手牌 110→130px、链路 `--card-h` 150→175px（重叠公式通用化：margin≈−44.7px，露出 80.85px=46.2%）、协议保持 200px（220 会超宽）。
4. **控制权滑轨位移延长**：clamp 12/88 → **5/95**（偏向更明显），轨道 overflow visible。
5. **链路卡 hover 弹出**：`.stack .card` 加 transition；`translateY(-18px) rotate(±90deg) scale(1.1)` + z-index 60 !important（覆盖内联 zIndex）；translate 在前 = 屏幕空间垂直弹出。
6. **链路长度延长 1.5 倍**：lane 槽 `minmax(240px,1fr)` → `minmax(360px,1fr)`。

**遗留**：打牌按钮视觉上可能叠到第 3 条链路行（top:-34px 固有）；4+ 卡/链路会溢出被 #app overflow-x:hidden 裁剪（极端局可接受）。

---

## 0.3 改进轮 3（2026-08-28，UI 打磨 5 项，已完成）

HEAD `4a73b40`，51 测试全绿：

1. **卡牌放大 ~1.2 倍**：链路 `--card-h` 125→150px（重叠公式通用：`--card-w=(150-2)*0.71429+2≈107.7px`，margin=`0.462*150−107.7≈−38.4px`，仍精确露出 46.2%）；手牌 96→110px；协议 180→200px。
2. **链路延长**：lane-row 槽列 `minmax(240px,1fr)`，每条链路可放约 5 张。
3. **移除回合切换黄条**：handoff banner 渲染与 CSS 全删（自动推进下已无意义）。
4. **控制权滑轨**：control-front.png 在横向轨道上按双方 3 线总值对比连续滑动（`raw=total1/(total0+total1)`，clamp 12–88%，双方 0→50%），双 rAF + transition 平滑过渡；**方向**：P1 占优靠左、P2 占优靠右（审查修正了原反转）；标签 玩家1/玩家2 + 中立刻度；s.control 驱动高亮/灰化。
5. **手牌扇形动效**：单行不换行（overflow-x: clip, overflow-y: visible）；卡牌负 margin 重叠（−28px）；hover 弹出（translateY −24px scale 1.15 z-50，兄弟卡按距 ∓12px/步推开，容器 mouseleave 复位防振荡）；最多显示 10 张 + `+N` 徽章。

**审查修复**（`4a73b40`）：滑轨方向反转（P1 占优靠右→靠左）；手牌正/背高度差（.card-back 148→142.8px）；#app overflow-x: hidden 防极端局横向滚动。

---

## 0.2 改进轮 2（2026-08-28，官方卡面接入 + 用户测量修正，已完成）

**任务 1：官方卡面替换 + Gemini 素材接入 + 控制模块**（HEAD `dcd2c10`，51 测试全绿）：

1. **官方卡面接入**：`tools/extract_card_images.py` 从 TTS 项目提取 6 套协议卡面 → `public/assets/protocols/<defId>/`（`card-0..5.png` 命令卡 + `protocol-loading/compiled.png` 协议卡）。CommandSheet 从上到下/从左到右 = 分值 0→5（OCR 验证）。**注意**：A/B 协议卡**原图即正置**（之前错误 rotate(-90) 已修正）；darkness/death 源图由用户手动调整为 750×1050。
2. **卡面渲染**：`renderCardFace` 用官方 PNG 替换文本卡；协议卡 `renderProtocol(p, player)` — P1 原方向、P2 `.rot-180`（双方协议相对放置）。
3. **链路卡旋转**：场上卡按归属旋转（P1 顺时针 90° `.rot-cw`、P2 逆时针 90° `.rot-ccw`，正反面一致）；手牌不旋转。
4. **横向覆盖 46.2%**：覆盖方向从纵向改为横向。**关键数学**：90° 旋转下 CSS transform 不影响布局盒，`--card-w = (125-2)*0.71429+2 ≈ 89.86px`，`margin-left = 0.462*125 − 89.86 ≈ −32.1px` 恰好露出旋转卡宽 46.2%（57.75px），对称（P1 露右/P2 露左）。已由 headless Chrome 几何验证。
5. **放置顺序**：P1 链路从靠近协议端向右（pos0 贴协议、向左生长）；P2 从靠近协议端向左（pos0 贴协议、向右生长）——双方从中间向两边展开。
6. **行对齐布局**：场地重构为 3 条 lane-row（`P1 槽 | P1 协议 | P2 协议 | P2 槽` 同一水平带），协议放大 130→180px；手牌/牌库/弃牌在顶部/底部条带。
7. **控制模块**：`public/assets/control-front.png` 可视化 `s.control`（中立灰化/持有高亮），步骤指示器不再显示文本版。
8. **控制权引擎规则**（`src/core/rules/control.ts`）：check-control 步骤 ≥2 条线总值高于对手 → 获得控制组件；编译/刷新时持有者重置中立。10 个新测试。
9. **Gemini 素材**：背景 `bg-scene.png`、牌桌 `table-mid.jpg`（按任务单 A/B 生成）已接入 CSS；火焰特效 `public/assets/fire/fire-burn.css/js`（阶段 2 用）。

**后续可做**：协议卡重排（控制组件重置后的调序选项，规则书有但未实现 UI）；效果引擎（阶段 2）。

---

## 0.1 改进轮 1（2026-08-28，用户 6 点反馈，已完成）

用户提出的 6 点改进已全部实现并审查通过（HEAD `0908588`，41 测试全绿，build 绿）：

1. **卡面三栏分区**：`src/ui/render.ts` `renderZone()` — 顶部「常驻」/ 中部「即时」（高亮）/ 底部「辅助」三个带边框+标签的分区；空栏不渲染（如 fire-3 只有底部指令）。
2. **官方卡背**：`public/assets/Cardback.jpg`（从 TTS 项目复制）；背面牌渲染该图 + 金色「2」徽章（规则：背面牌印刷值=2）。
3. **场地布局改版**：三列网格（`styles.css` `1fr 260px 1fr`）— P1 左侧 / 中间公共区 6 协议格（3 行 × 2）/ P2 右侧；活动方（当前回合玩家）手牌可交互、对手手牌显背面；堆叠槽为打牌目标。
4. **自动推进**：`src/main.ts` `runAutoAdvance()` — 非 action 阶段自动推进（400ms 单定时器链）：start/check-control/check-cache/end 自动；check-compile 单线可编译时自动编译、多线时暂停等玩家选；draft/gameover/action 停止。新增 `UiCallbacks.onRendered?()` 钩子。
5. **Gemini 素材提示词**：`docs/gemini-tasks-batch1.md`（任务单 A 背景 / B 牌桌 / C 火焰特效 / D 协议 Loading 面 / E 卡背说明）— 用户复制给 Gemini 生成。
6. **覆盖机制**：`renderCoveredCard()` — 堆叠中被覆盖的卡只显示数值+顶部（常驻）指令，中部/底部遮蔽失效；顶层卡全卡面+「活跃」徽章（zIndex=pos 保证层叠）；背面被覆盖卡显示「背面」。

**已知遗留（下轮可做）**：
- 卡牌**效果文本结算**（点 4 提到的连锁触发）→ 阶段 2 效果引擎
- handoff 横幅在 start 步会被自动推进快速跳过（约 400ms 闪现），提示文案"点击下一步"已过时 → 可暂停 start 或改文案
- 非活动方手牌无点击但曾有 pointer 光标（已修复 `0908588`：限定 `.player-col.self`）
- 对手手牌/场上背面牌的 data-def-id 已隐藏（`0908588`）

---

## 1. 已完成功能清单

### 1.1 引擎层（`src/core`，纯 TypeScript，零 DOM 依赖）

| 功能 | 位置 | 说明 |
|---|---|---|
| 数据模型 | `core/models/types.ts` | `GameState` / `PlayerState` / `Card` / `CardDef` / `ProtocolDef` / `ProtocolState` / `Step` / `Phase` / `Zone` / `Line` / `PlayerId` |
| 草案（Draft） | `core/state/create.ts` | **1-2-2-1 轮选**（`DRAFT_ORDER = [0,1,1,0,0,1]`，共 6 次选择）：P1 拿第 1/4/5 次、P2 拿第 2/3/6 次；草案结束后每人分配 3 协议、18 张牌库（3 协议 × 6 张）、起手 5 张 |
| 回合（6 步） | `core/engine/turn.ts` | 严格顺序 `start → check-control → check-compile → action → check-cache → end`；`advanceStep` 在 `end` 后换人、重置 `compiledThisTurn`；本回合已编译则跳过 `action` 步 |
| 编译规则 | `core/rules/compile.ts` | 编译条件：己方线总值 **≥10 且 > 对手同线值**；`check-compile` 步满足则**必须编译**；`executeCompile` 同时删除该线双方全部卡牌（"all" 效果，**不触发任何卡牌文本**）→ 翻己方协议为 Compiled；**重新编译**已编译线不翻协议，改为抽对手牌库顶 1 张（所有权变更）；编译后本回合跳过 `action`；3 协议全编译 → 获胜（`phase = 'gameover'`） |
| 基础动作 | `core/actions/base.ts` | `playCard`（正面须匹配协议线、背面任意线；置于堆叠顶 = 覆盖；非法抛错）、`refreshHand`（手牌 <5 时抽至 5，≥5 抛错） |
| 牌库/弃牌堆 | `core/engine/deck.ts` | `drawCards`（牌库空时**洗弃牌堆重组**再抽）、`discardFromHand`（正面朝上入弃牌堆）、`clearCache`（手牌 >5 弃至 5） |
| 动作面（门面） | `core/game.ts` | `getLegalActions`（`action` 步：每张手牌 × 3 线 × 正/背面 的 `play` + 手牌 <5 时 `refresh`；`check-compile` 步：可编译线 `compile`；恒有 `advance`）、`executeAction`（重载：`play`/`compile` 需 args，`refresh`/`advance` 无 args）、`getWinner` |
| 事件总线 | `core/events/bus.ts` | `createBus`：`subscribe` / `emit` 最小实现（**阶段 2 特效层将订阅语义事件**） |

### 1.2 数据层（`src/data`）

- **15 套协议、90 张卡定义全部录入**（`data/cards.ts`）：MN01×12（water/fire/light/darkness/life/death/spirit/gravity/psychic/plague/metal/speed）+ AX01×3（love/hate/apathy），每套 6 张。
- 卡牌文本为**中文**（游戏 UI 语言），与权威源 `docs/card-text-source.txt` 逐字一致（Task 3 已独立核对）。
- 演示草案池（`data/demo.ts`）：前 6 套 **water / fire / light / darkness / life / death** 及其卡定义；`DEMO_PROTOCOLS` / `DEMO_CARD_DEFS` 供草案使用；`getCardDef` / `getProtocolDef` 按 defId 查定义（未知 defId 抛错）。

### 1.3 UI 层（`src/ui` + `src/main.ts`）

- **草案界面**：协议池卡片（名称/命令关键词/Loading 文案）+「选择」按钮，提示轮到哪位玩家。
- **战场**：
  - 对手区：手牌（背面）+ 3 线（协议 + 堆叠）+ 牌库/弃牌堆/手牌计数；
  - 中线：步骤指示器（`步骤: xxx · 控制组件: 中立/玩家 N`）；
  - 己方区：手牌（正面，可点选）+ 3 线（点击放置）+ 线值显示（`值 N`，引擎按背面=2 计入）；
  - 操作栏：`编译线 N` / `刷新手牌` / `下一步` 按钮 + 选中卡后的 `正面打入` / `背面打入` 朝向切换；
  - 交互只对**当前合法动作**开放（`getLegalActions` 校验），非法点击一律忽略。
- **热座**：每回合 `start` 步显示交接横幅「▶ 请将设备交给 玩家 N，然后点击「下一步」开始」；获胜横幅「玩家 N 获胜！」；日志（最近 12 条）。
- `main.ts`：装配 `createGame()` + `UiCallbacks`（直接回调模式）→ `renderApp` 在草案/战场间切换。

### 1.4 测试

- **41/41 通过**（`npx vitest run`；`vite.config.ts` 固定 `pool: 'threads'`，`environment: 'node'`，include `tests/**/*.test.ts`）。
- 10 个测试文件，镜像 src 结构：smoke(1) / game(4) / models/types(3) / state/create(5，含开局洗牌非确定性测试) / engine/turn(3) / engine/deck(4) / rules/compile(7) / actions/base(6) / data/cards(6) / events/bus(2)。

---

## 2. 项目结构树与每文件职责

```
compile/
├── index.html                  # Vite 入口 HTML（<div id="app"> 挂载点）
├── package.json                # scripts: dev / build(tsc --noEmit && vite build) / preview / test(vitest run)
├── vite.config.ts              # Vitest 配置：pool:'threads'、environment:'node'、include tests/**/*.test.ts（勿改 pool）
├── tsconfig.json               # TypeScript 配置
├── .gitignore                  # node_modules/ dist/ .superpowers/（dist 为构建产物，不入库）
├── src/
│   ├── main.ts                 # 应用装配：createGame() + UiCallbacks（onDraftPick/onAction）→ renderApp
│   ├── vite-env.d.ts
│   ├── core/                   # 引擎层（纯 TS，零 DOM，可独立测试）
│   │   ├── models/types.ts     #   全部类型定义（GameState/PlayerState/Card/CardDef/ProtocolDef/Step/Phase/Zone/Line…）
│   │   ├── state/create.ts     #   createGame/getDraftPool/getCurrentDrafter/performDraftPick/assignProtocols/stackValue/getLineValue/nextUid
│   │   ├── engine/turn.ts      #   STEP_ORDER + advanceStep（6 步推进、end 后换人、compiledThisTurn 跳过 action）
│   │   ├── engine/deck.ts      #   shuffle/drawCards（含弃牌堆重洗）/discardFromHand/clearCache
│   │   ├── rules/compile.ts    #   canCompileLine/getCompilableLines/mustCompile/executeCompile（含重新编译偷牌、胜利判定）
│   │   ├── actions/base.ts     #   isPlayableFaceUp/playCard/refreshHand（默认动作原语）
│   │   ├── events/bus.ts       #   createBus：subscribe/emit（阶段 2 特效订阅用）
│   │   └── game.ts             #   动作面门面：ActionKind/LegalAction/getLegalActions/executeAction（重载）/getWinner
│   ├── data/                   # 数据层
│   │   ├── cards.ts            #   ALL_PROTOCOLS（15）+ ALL_CARD_DEFS（90），文本来自 docs/card-text-source.txt
│   │   └── demo.ts             #   演示草案池（6 套）+ DEMO_PROTOCOLS/DEMO_CARD_DEFS + getCardDef/getProtocolDef 索引
│   └── ui/                     # 渲染层（DOM）
│       ├── render.ts           #   renderDraft/renderBoard/renderApp；手牌选择状态 + 合法动作派发（getLegalActions 校验）
│       └── styles.css          #   全部样式（草案/战场/卡牌/操作栏/横幅/日志）
├── tests/                      # 40 用例，镜像 src 结构
│   ├── smoke.test.ts           # 测试框架自检
│   ├── game.test.ts            # 动作面集成：编译 offer / play 推进 / 全回合循环换人 / 第三协议编译获胜
│   ├── models/types.test.ts    # 类型形状声明
│   ├── state/create.test.ts    # 草案 1-2-2-1 顺序 / 设置（3 协议、18 牌库、5 手牌）/ 线值求和
│   ├── engine/turn.test.ts     # 6 步顺序 / end 后换人 / 已编译跳过 action
│   ├── engine/deck.test.ts     # 抽牌 / 弃牌堆重洗 / 弃牌入弃牌堆 / 清缓存至 5
│   ├── rules/compile.test.ts   # 编译判定（≥10 且 > 对手）/ 执行 / 重新编译偷牌 / 胜利
│   ├── actions/base.test.ts    # 正面匹配线 / 背面任意线 / 覆盖 / 非法抛错 / 刷新
│   ├── data/cards.test.ts      # 15 协议 90 卡 / Fire 真实文本 / 索引查找
│   └── events/bus.test.ts      # 订阅 / 退订
├── docs/
│   ├── stage1-framework.md     # 本文件（阶段 1 交接文档）
│   ├── gemini-task-template.md # Gemini 生成任务单模板（阶段 2 用）
│   ├── card-text-source.txt    # 权威中文卡牌文本（15 协议，格式 `甲x：A/B/C`）
│   └── superpowers/
│       ├── specs/2026-08-28-compile-web-design.md   # 已批准的设计文档（规则要点/架构/特效/Gemini 工作流/测试策略）
│       └── plans/2026-08-28-compile-stage1-framework.md  # 阶段 1 实施计划（含 Task 12 与阶段 2 入口）
├── public/                     # （尚未创建）官方 PNG + Gemini 生成资产将放这里：public/assets/<protocol>/
└── .superpowers/sdd/           # SDD 任务简报/报告/评审记录（开发过程产物，不入库）
```

> 注：根目录另有 `_rules_raw.txt` / `_rules_mn02_codex_raw.txt` / `_tss_files.txt`：规则原文与 TTS 资产清单草稿，非代码，可忽略。

---

## 3. 如何运行

前置：Node.js + npm。

```bash
# 1. 安装依赖（仅首次）：
#    - 若 node_modules 不存在：npm install --cache node_modules/.npm-cache
#    - 若 node_modules 已存在（推荐）：跳过安装，直接执行第 2 步 npm run dev
npm install --cache node_modules/.npm-cache
```

> ⚠️ **本开发沙箱环境特殊，勿在普通环境照搬**：
> - `node_modules/vite/dist/node/chunks/node.js` 含一个**未提交的本地补丁**（`optimizeSafeRealPathSync` 提前返回，跳过 `net use` 探测）。**任何 `npm ci` / `npm install` 都会抹掉它**，之后首次测试会因 config-load EPERM 失败；重装后需重新打补丁。
> - 如必须安装依赖，请传 `--cache node_modules/.npm-cache`（默认缓存目录在沙箱外不可写）。

```bash
npm run dev        # 2. 开发：Vite dev server（默认 http://localhost:5173）
npm run test       # 3. 测试：= npx vitest run，预期 40/40 通过
npm run build      # 4. 构建：= tsc --noEmit && vite build → dist/
npm run preview    # 5. 预览构建产物
```

> `vite.config.ts` 固定 `pool: 'threads'`（沙箱禁止子进程派生，EPERM），**不要改动**。

---

## 4. 已知限制（阶段 1 范围外 / 未实现）

1. **卡牌特效未实现**：引擎只有 3 种默认动作（play / refresh / compile）+ advance。卡牌的 `top` / `middle` / `bottom` 文本**只展示、不结算**——没有 `flip` / `shift` / `return` / `delete` / `discard` / `reveal` 等效果动作，也没有效果文本解析器。
2. **无 AI 对手**：纯热座双人。
3. **Check Control（可选规则）未实现**：`GameState.control` 字段存在（-1 = 中立），UI 仅在步骤指示器里显示控制组件归属文本；"≥2 线总值领先获得控制组件、编译/刷新前归还中立位、可重排一名玩家的协议位置"的规则逻辑**未实现**。
4. **无 Gemini 资产**：`public/` 目录尚不存在，无任何特效/场景资源。
5. **UI 无单元测试**：UI 只经 `tsc --noEmit`（build 门控）类型检查；40 个测试全部在引擎/数据层。
6. **重新编译偷牌不重洗**：`executeCompile` 直接 `opp.deck.pop()`；对手牌库为空时偷牌为 no-op（不洗对手弃牌堆）。
7. **`refreshHand` 可能返回 <5 张**：当牌库与弃牌堆都耗尽时 `drawCards` 停止，刷新结果不足 5 张（任务 8 评审确认的 Minor）。
8. **背面卡牌值=2 不在 UI 显示**：引擎 `stackValue` 对面朝下卡按 2 计（线值显示正确），但卡牌背面 UI 只渲染 "?"，不显示数值 2。
9. **覆盖/未覆盖语义未实现**：无效果结算，自然没有"默认仅未覆盖卡可操作 / 顶命令永久生效（被覆盖也生效）/ 底命令仅未覆盖时有效"等规则。
10. **事件总线未接入 UI 主流程**：`createBus` 已实现并有测试，但 `main.ts` 当前走直接回调（`UiCallbacks`）；阶段 2 特效层可改为订阅总线。

---

## 5. 阶段 2 入口：Fire 协议试点

### 5.1 现状澄清（重要）

- **Fire 0-5 的真实中文卡牌文本已就位**：`src/data/cards.ts` 的 `fire-0 … fire-5` 与权威源 `docs/card-text-source.txt`（"火——玉石俱焚"段）一致，含 Codex 勘误后的 fire-0 底命令（"被盖住前：先抽1张牌并翻转另1张牌"）；`tests/data/cards.test.ts` 有 `'fire uses real card text'` 用例守护。
- 因此阶段 2 **不再阻塞于"等待用户提供 Fire 卡牌文本"**——剩余工作是把 Fire 文本变成可结算的效果与特效。

### 5.2 阶段 2 工作分解（需另立实施计划）

1. **引擎效果原语**：在 `src/core/actions/` 增加效果动作。按 Fire 需要先实现子集：`discard` / `delete` / `return` / `flip` / `draw`（其余 `shift` / `reveal` / `swap` / `give` 等留到后续协议）。每个效果动作走 TDD（先写 `tests/` 用例）。
2. **效果结算接线**：为 Fire 卡定义声明结构化效果（或解析文本），在打牌（middle 命令）、翻面、被盖住前（bottom 命令，如 fire-0）等时机结算；遵守设计文档约束——编译"同时删除"不触发文本、弃/删牌正面朝上入拥有者弃牌堆等。
3. **特效注册表**：新建 `src/ui/effects/registry.ts`，按协议命名空间挂载动画：`fire:discard`、`fire:delete`（Fire 关键词 = "弃牌触发效果"）。引擎只发**语义事件**（复用 `src/core/events/bus.ts`），特效层订阅后播放对应动画；**引擎不感知特效**。
4. **Gemini 火焰特效任务单**：用 `docs/gemini-task-template.md` 产出"火焰焚烧特效"任务单 → 用户复制给 Gemini → 生成物放回 `public/assets/fire/` → 接入 registry 验证（尺寸/命名/格式不符返工）。
5. **UI 接线**：效果动作需要目标选择 UI（点击选目标 → 高亮合法目标 → 执行；默认仅未覆盖卡可操作）；当前 UI 只提供默认动作的交互入口。
6. **验证**：跑通"数据 → 引擎 → UI → 特效"全链路（设计文档 §7）。

---

## 6. 零上下文 agent 续作清单

### 6.1 下一步做什么

实现**阶段 2：Fire 协议试点**（见 §5.2）。建议首个小步：TDD 实现引擎 `discard` 效果原语 + 测试，然后逐条结算 fire-1（"弃1张牌。如果弃了，删除1张牌。"）等文本。

### 6.2 必读文件（按顺序）

1. `docs/superpowers/specs/2026-08-28-compile-web-design.md` — 设计文档（规则要点 §2、架构 §3、交互 §4、特效系统 §5、Gemini 工作流 §6、测试策略 §7）
2. `docs/stage1-framework.md` — 本文件
3. `docs/gemini-task-template.md` — Gemini 任务单模板（阶段 2 第 4 步用）
4. `docs/card-text-source.txt` — 权威中文卡牌文本（15 协议；Fire 在"火——玉石俱焚"段）
5. `src/core/models/types.ts` + `src/core/game.ts` + `src/core/state/create.ts` — 引擎核心
6. `src/data/cards.ts` + `src/data/demo.ts` — 数据层
7. `tests/data/cards.test.ts` — Fire 真实文本守护用例（参考断言写法）

### 6.3 环境红线（违反即测试失败 / 补丁丢失）

- **不要**跑 `npm ci` / `npm install`（会抹掉 `node_modules` 里 vite 的未提交补丁）；必须装时用 `--cache node_modules/.npm-cache`
- **不要**改 `vite.config.ts` 的 `pool: 'threads'`
- 测试：`npm run test`（= `npx vitest run`），预期 40/40
- 构建：`npm run build`（`tsc --noEmit && vite build`）

### 6.4 约定

- 代码注释与文档用中文；卡牌文本为中文（游戏 UI 语言）
- 新效果动作走 TDD：先写 `tests/` 用例再实现
- 提交信息风格：`feat: …` / `fix: …` / `docs: …`（参考 `git log`）
- 每个阶段完成后更新本文件与全局记忆 `E:\studyE\Deepseek memory\compile-web-project.md`（该文件在工作区外，由控制器更新）
