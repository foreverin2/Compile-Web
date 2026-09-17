/* ============================================================================
 * 运行期浏览器真值探针（被 `tools/browser-truth-check.mjs` 用 headless Chrome 载入）
 *
 * ## 为什么需要它（这一族缺陷静态解算看不见）
 * 本项目有过三次"守卫全绿、页面照错"的缺陷，成因都**只有浏览器知道**：
 *  · **R10-2**：`styles.css:422` 的 `.stack { --card-h: 175px }` 声明在**元素自己身上**，
 *    自定义属性只在该元素自己没有声明时才继承 ⇒ 上提到 `.net-board`/`.net-lane-band`
 *    的旋钮**永远赢不了它**。仓库里的守卫解算的是**声明与权重**，而这里胜负由浏览器级联定。
 *  · **R12**：停靠栏把放牌区挤掉 98px —— 那是 `flex/grid` 真实求解的结果，桩算不出。
 *  · **R17**：`.net-hand-area-foe` 与基类**同权重、被源序吃掉** —— 同族。
 * ⇒ 本探针在真浏览器里 `getComputedStyle` + `getBoundingClientRect`，
 *   把"期望值"与"浏览器真值"逐项并列。**期望值尽量单源**（见下面 `src` 字段的取值规则）。
 *
 * ## 期望值的三种来源（每项都标在 `src` 里，禁止含混）
 *  1. `css:<选择器>#<属性>`：**从同源样式表里读到的声明**，再用一个探针盒把
 *     `var()`/`calc()` **在真实级联环境下求值**（探针盒挂在被测容器子树里 ⇒ 继承同一批变量）。
 *     这是最强的单源：改样式表 ⇒ 期望值跟着变，不可能"两处真相"。
 *  2. `dom:<选择器>`：从**页面自己的元素**推导（例如"能量槽夹在本侧链路与协议之间"、
 *     "协议图的视觉足迹 = holder 盒的交换"、"滑块停位 == fxTrackEndFor 的返回值"）。
 *  3. `baseline:<出处>`：本工具里记着的**历史基线**（来源写在出处里：文件:行 + 为什么是那个数）。
 *     只有当"这条值在当前 CSS 结构下确实没有单源"时才允许用它，且必须在报告里标注。
 *
 * ## 这个探针**不做**判定
 * 它只产出 `{expected, measured, src, tol}`；容差比较与退出码在 Node 侧的
 * `tools/browser-truth-check.mjs` 里做（浏览器负责"真值"，Node 负责"判据"）。
 *
 * ## 三个 headless 陷阱（都实测过，探针里已规避；改这个文件前先读）
 *  1. `--dump-dom` 模式下 **`requestAnimationFrame` 回调不会跑**（不产帧）—— 见
 *     `.superpowers/sdd/_probe-raftest.html` 的实测：同一帧里 `setTimeout` 的写入出现在
 *     dump 里，rAF 的写入没有。而 `renderControlModule` 是"先写上一帧位置、下一帧写目标位
 *     置"（双 rAF）⇒ 不处理就只能读到**上一帧的 50%**（假象）。这里把 rAF 换成
 *     `setTimeout(…, 0)`（与测试侧 `net-control-end.test.ts` 的 `settleRaf` 同一语义）。
 *  2. `.control-slider-img` 有 `transition: top 0.5s ease`，虚拟时钟下过渡**不推进**
 *     （内联 top 已是 78% 而 rect 仍在 50%）。⇒ 安装后把过渡关掉（**只影响动画过程**，
 *     不改变任何目标位置）。
 *  3. 图片是**异步**的，而卡/协议盒的几何由图片固有尺寸决定（图没加载时卡盒只有 ~8px 高）。
 *     ⇒ 渲染后等 `img.decode()`/`complete` + `document.fonts.ready` 再测量，并把
 *     "有几张图没加载成功"写进 `warnings`（`naturalWidth === 0` 一律报警，因为那会让
 *     下半部分测量全部失真）。
 * ========================================================================== */
window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(performance.now()), 0);

import '/src/ui/styles.css';
import '/src/ui/styles-gen3.css';
import '/src/ui/styles-gen3-cards.css';
import '/src/ui/styles-gen3-sync.css';
import '/src/ui/styles-net.css';
/* G4 T6：第 4 个场景（重放页）的控制条样式。**必须在 `styles.css` 之后**——
 * 它里面的 `.replay-shield` 要盖住棋盘、`.replay-bar` 要盖住遮罩（层叠说明见那个文件）。 */
import '/src/ui/styles-replay.css';
import { createGame, draftNextAction, getDraftPool, performDraftBan, performDraftPick } from '/src/core/state/create';
import { renderApp } from '/src/ui/render';
import { renderNetBoard } from '/src/ui/render-net';
import { syncScanOverlays, syncSmokeOverlays, syncCompiledFxLayers } from '/src/ui/render';
import { syncWrath0Cull } from '/src/ui/gen3-control';
import { fxTrackEndFor, FX_TRACK_EDGE_PCT_Y } from '/src/ui/fx-seat';
/* G4 T6：重放场景**必须复用生产函数**（计划 §3.6 的代价那一句）：
 *  · `stateAfterDraft` / `applyRecordedAction` —— T1 的"档案 → 引擎"唯一映射与草稿真重放；
 *  · `createMatchFileRecorder` / `setupFromState` / `CARD_DATA_HASH` —— 档案由**记录器**产出，
 *    不是手写 JSON（手写就等于"真值"验的不是产物）；
 *  · `renderReplayBar` —— T3 的控制条 + 遮罩渲染器。
 * ⚠️ 探针页与 `main.ts` 是**两份装配**（这也是 D6 的代价）；在重放这条路上两份装配
 *    复用的是同一批生产函数，唯一"探针自己写"的是**确定性策略**（下面 `POLICY_*`）。 */
import { applyRecordedAction, stateAfterDraft } from '/src/app/match-replay';
import { createMatchFileRecorder, setupFromState } from '/src/app/match-file';
import { CARD_DATA_HASH } from '/src/app/card-data-hash';
import { renderReplayBar } from '/src/ui/replay-bar';
import { getLegalActions } from '/src/core/game';
import { answerEffect } from '/src/core/effects/resolve';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'net';       // 'hotseat' | 'net' | 'replay'（G4 T6 新增）
const seat = Number(params.get('seat') ?? '0');          // 仅 net 用
/** 仅重放场景用的**变异注入**开关（`inject=`，见 §3 的 M1/M2 变异实测）。
 *  它只在本探针页里生效（内联样式，不改仓库文件、不改共享树），默认 `null` = 生产形态。
 *  用途：证明 T6 的判据**真的会红**（否则那两条判据没有牙）。 */
const inject = params.get('inject');
const out = { scenario, seat, inject: inject ?? null, items: [], warnings: [], notes: [] };

/* ── 通用工具 ─────────────────────────────────────────────────────────── */
const px = (v) => {
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? +n.toFixed(3) : null;
};
const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: px(r.left), top: px(r.top), right: px(r.right), bottom: px(r.bottom), width: px(r.width), height: px(r.height), cx: px(r.left + r.width / 2), cy: px(r.top + r.height / 2) };
};
const layoutBox = (el) => (el ? { width: el.offsetWidth, height: el.offsetHeight } : null);

/** 从同源样式表里读 `选择器 === selectorText 的某一段` 且声明了 `prop` 的规则。
 *  ⚠️ 精确匹配选择器**文本**（压掉空白）—— 不做选择器匹配，故不存在"我重写了一遍级联"这件事：
 *  它只回答"样式表里这条规则怎么写的"，命中的元素由各测量项自己指定。
 *  ⚠️ 返回**全部**命中（调用方决定"必须恰好 1 条否则响亮报错"）—— 静默取第一条就是"两处真相"的温床。 */
function declaredDecls(selector, prop) {
  const hits = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }   // 跨源表读不到（本页全是同源）
    for (const r of Array.from(rules ?? [])) {
      if (!r.selectorText || !r.style) continue;
      const sels = String(r.selectorText).split(',').map((s) => s.replace(/\s+/g, ' ').trim());
      if (!sels.includes(selector)) continue;
      const v = r.style.getPropertyValue(prop);
      if (v) hits.push({ selector, prop, value: String(v).trim(), sheet: sheet.href ?? '(inline)' });
    }
  }
  return hits;
}

/** 把 `var()`/`calc()` 表达式**在真实继承环境下**求值：探针盒挂在 `host` 子树里，
 *  于是 `var(--card-h)` 取的就是 host 自己那条链上的值。
 *  `prop` 支持任何长度属性（width / height / margin-left / min-height…）。 */
function evalLen(prop, expr, host) {
  const box = document.createElement('div');
  box.style.position = 'absolute';
  box.style.left = '-99999px';
  box.style.top = '0';
  box.style.width = '0px';
  box.style.height = '0px';
  box.style.visibility = 'hidden';
  host.appendChild(box);
  try {
    if (prop === 'min-height' || prop === 'max-height') {
      box.style.height = expr;                       // min-height 的"用值"要由 height 撑出来
      return px(getComputedStyle(box).height);
    }
    box.style[prop] = expr;
    const got = getComputedStyle(box)[prop];
    if (prop === 'width' || prop === 'height') return px(got);
    // margin-* / padding-* 等：computed 值本身就是 px（百分比会解成 px）
    return px(got);
  } finally {
    box.remove();
  }
}

/** 单源求值：样式表里必须**恰好一条**该声明，否则**响亮失败**（返回 null 并记 warning）。 */
function singleDecl(selector, prop) {
  const hits = declaredDecls(selector, prop);
  if (hits.length !== 1) {
    out.warnings.push(`单源取值失败：\`${selector} { ${prop} }\` 在样式表里命中 ${hits.length} 条`
      + `（应恰好 1 条）—— 期望值无从单源，本项跳过`);
    return null;
  }
  return hits[0];
}

/**
 * **媒体查询感知**的声明取值（R25 新增，仍是单源）：先找**当前视口命中**的 `@media` 块里有没有这条
 * 声明，有就取它（**源序更靠后 ⇒ 级联上它赢**），没有才退回顶层规则。
 *
 * 为什么必须这样：R25 加了三个窄屏媒体查询，它们会重声明 `.stack { --card-h }`。
 * 若期望值只读顶层（175），那么窄屏档位下"计算值 98"会被判成"旋钮没有到达消费元素"——
 * 那是**期望值不感知媒体查询**的假红，不是 R10-2 那条链断了。
 */
function declForViewport(selector, prop) {
  let top = null;
  let media = null;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules ?? [])) {
      const isMedia = r.media !== undefined && r.conditionText !== undefined;
      const inner = isMedia ? (window.matchMedia(r.conditionText).matches ? Array.from(r.cssRules ?? []) : []) : [r];
      for (const rule of inner) {
        if (!rule.selectorText || !rule.style) continue;
        const sels = String(rule.selectorText).split(',').map((s) => s.replace(/\s+/g, ' ').trim());
        if (!sels.includes(selector)) continue;
        const v = rule.style.getPropertyValue(prop);
        if (!v) continue;
        const hit = {
          selector, prop, value: String(v).trim(),
          sheet: isMedia ? `@media ${r.conditionText}` : (sheet.href ?? '(inline)'),
        };
        if (isMedia) media = hit; else top = hit;   // 源序：媒体块在后 ⇒ 后者赢
      }
    }
  }
  return media ?? top;
}

/** 记一项测量。`expected === null` 表示"期望值取不到"（记 warning，判为失败）。 */
function item(id, what, expected, measured, src, tol = 1) {
  out.items.push({ id, what, expected, measured, src, tol });
}

/* ============================================================================
 * **对照基线模式**（`?baseline=1`，由 `tools/browser-truth-check.mjs --baseline` 打开）
 *
 * 作用：在**同一个浏览器会话**里把"本轮的布局改动"撤掉，量出**改前**的真值 ——
 * 于是任意宽度的"前 / 后"都来自同一把尺子（同一探针、同一合成局、同一窗口），
 * 不需要 `git stash`（工作区里还有别人的改动，动 git 是危险的）。
 *
 * 撤掉什么：**只有本轮 R25 改的那两件事**（由 `src/ui/styles.css` 的注释逐条对应）：
 *  1. `@media (max-width: 1709px / 1610px / 1467px)` 三个窄屏档位块（含档位里的最小宽）；
 *  2. `.protocol-cell` 的无条件兜底 `min-width`（用一条后插入的同权重规则压成 0）。
 * 撤掉的方式是 **CSSOM 操作**（`deleteRule` / `insertRule`），**不改仓库里的任何文件**。
 *
 * ⚠️ 诚实边界：这量的是"**撤掉本轮那两条改动之后**的浏览器真值"，与上一轮**真实代码**下
 * 量到的"改前"值在我核对过的四个宽度（1920/1800/1600/1366）上**逐字相同**（见报告 §2 的注）。
 * 它证明的是"这两条改动各自值多少"，不证明"上一轮代码的每一个字节"。
 * ========================================================================== */
function stripThisRoundsLayout() {
  const stripped = { media: [], minWidth: false };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const r = rules[i];
      if (r.media !== undefined && r.conditionText !== undefined) {
        if (!/max-width:\s*(1709|1610|1467)px/.test(String(r.conditionText))) continue;
        stripped.media.push(String(r.conditionText));
        sheet.deleteRule(i);
        continue;
      }
      // 兜底 min-width：**把这条声明删掉**（而不是插一条 `min-width: 0`）——
      // 删掉之后元素回到"没有显式最小宽"的原始状态（min-content = `.protocol` 的 padding/border = 10px），
      // 与改动前的真实样式**逐字同构**；插 `min-width: 0` 会把退化档的轨道多压 10px（不忠实）。
      if (r.selectorText && String(r.selectorText).replace(/\s+/g, ' ').trim() === '.protocol-cell'
        && r.style.getPropertyValue('min-width')) {
        r.style.removeProperty('min-width');
        stripped.minWidth = true;
      }
    }
  }
  out.baseline = true;
  out.notes.push(`⚠️ **对照基线模式**：已撤掉 ${stripped.media.length} 个窄屏媒体块`
    + `（${stripped.media.join(' / ') || '无'}）+ 兜底 min-width=${stripped.minWidth ? '已删除' : '未找到'}`
    + ' ⇒ 本页所有数字都是**改前**的真值（仅供前/后对照；本模式下**判定结果没有意义**，'
    + '因为期望值描述的是修复后的状态）');
}

/* ── 合成局（热座页 / 远程页共用；defId 全部选**有图**的，见 warnings 的图片自检） ──
 * ⚠️ **协议的 defId 是"协议族名"（`fire`/`ice`/…），不是"协议卡 defId"（`fire-0`）**：
 *    `protocolImgSrc(defId, compiled)` 拼的是 `/assets/protocols/<defId>/protocol-<state>.<ext>`，
 *    而磁盘上的目录就叫 `fire/` `ice/`。第一版探针写成 `fire-0` ⇒ 6 张协议图全部 404、
 *    协议 holder 的盒高塌成 20px（**探针自己的假象**，不是产品缺陷 —— 这条已由
 *    "图片没加载成功"的 warning 抓到，正是那个自检存在的意义）。 */
function makeState() {
  const s = createGame({ seed: 'browser-truth', draftStarter: 0, firstToPlay: 1 });
  const card = (uid, defId, owner, line, pos) => ({ uid, defId, owner, faceUp: true, zone: 'field', line, pos });
  const PROTOS = { 0: ['fire', 'ice', 'light'], 1: ['spirit', 'death', 'water'] };
  for (const p of [0, 1]) {
    s.players[p].protocols = PROTOS[p].map((defId, i) => ({ defId, compiled: p === 0 && i === 1 }));
    s.players[p].hand = ['fire-1', 'fire-2', 'fire-3'].map((d, i) =>
      ({ uid: `h-${p}-${i}`, defId: d, owner: p, faceUp: true, zone: 'hand', line: null, pos: null }));
    // 线 0：1 张（含 darkness-2 顶命令 ⇒ 烟雾罩）；线 1：**恰好 7 张**（跨度项）；线 2：空
    s.players[p].stacks[0] = [card(`s-${p}-0-0`, 'darkness-2', p, 0, 0)];
    s.players[p].stacks[1] = Array.from({ length: 7 }, (_v, i) => card(`s-${p}-1-${i}`, 'fire-3', p, 1, i));
    s.players[p].stacks[2] = [];
  }
  s.phase = 'turn';
  s.control = 0;                                  // P0 持控 ⇒ 远程页滑块应贴"自己端"
  return s;
}

const noop = () => { /* noop */ };
const cb = {
  onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop,
  onDraftUnpick: noop, onDraftBan: noop, onWinReset: noop,
};

/* ============================================================================
 * G4 T6 · 重放场景（`?scenario=replay`）的**归档与重放**
 *
 * 为什么在这里造档案而不是手写一份 JSON（计划 §3.6 的"代价"那一句）：
 * 探针页与 `main.ts` 是**两份装配**；若探针手写假档案、假状态，那这第五道门禁
 * 验的就不是产物。所以这里**只用生产函数**：
 *   `createGame` → 草稿（`performDraftPick`/`performDraftBan`）→ 逐步现场推进，
 *   每一步同时 (a) 用**生产助手** `applyRecordedAction` 真正执行、(b) 用
 *   `createMatchFileRecorder` 照录 —— 与 `tests/app/match-recorder.test.ts` 的
 *   `playAndRecord` 同一条形态（那边是往返腿，这边是浏览器真值的输入）。
 *
 * **唯一"探针自己写"的东西 = 确定性策略**（下面的 `POLICY_*`）：种子派生 + 池大小取模，
 * 不含时钟/随机数（`Math.random` 在这条路径上零调用）。同一份 seed ⇒ 同一份档案。
 *
 * 本文件必须与 `tools/browser-truth-check.mjs` 的注释逐字一致（防两处真相）：
 * `POLICY_SEED` 与 `N` 两条都抄在那边的 `SCENARIOS`/背景注里。
 * ========================================================================== */
const POLICY_SEED = 'g4t6-browser-truth';
/** 重放到第几步（**固定值**，刻意不是"随便走一半"）：见 `REPLAY_AT` 的注。 */
const REPLAY_AT = 24;
/** 确定性索引（FNV-1a 变体 + 取模 —— 与 `tools/browser-truth-check.mjs` 背景注里记的同一份）。 */
function policyHash(t) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const policyIndex = (tag, n) => (n <= 0 ? 0 : policyHash(`${POLICY_SEED}:${tag}`) % n);

/** 循环应答所有挂起选择（与 `tests/helpers.ts` 的 `resolveAllChoices` 同一份语义；
 *  本探针不能 import `tests/**`，故就地重写这 8 行 —— 它不是被测产物，是"怎么走完这局"）。 */
function resolveAll(s) {
  for (let g = 0; g < 500; g += 1) {
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (!top || !top.prompt) return;
    const p = top.prompt;
    const choice = p.optional ? []
      : p.kind === 'select-line' ? [`line:${(p.lines && p.lines[0]) ?? 0}`]
        : p.kind === 'select-action' ? [p.actions?.[0] ?? ''].filter(Boolean)
          : p.candidates.slice(0, 1).map((c) => c.uid);
    answerEffect(s, top.id, choice);
  }
  throw new Error('探针的 resolveAll 不收敛（500 次仍有挂起选择）');
}

/** 造一份**真的对局档案**（ban 模式草稿 + 确定性走子），返回 `{ file, actions, draft }`。 */
function buildReplayArchive() {
  const s = createGame({ seed: POLICY_SEED, draftStarter: 0, firstToPlay: 1, draftMode: 'ban' });
  const rec = createMatchFileRecorder();
  // ── 草稿：`draftNextAction` 派生 kind，按 kind 从池里取（**确定性策略**，不是总取第一个） ──
  let guard = 0;
  while (s.phase === 'draft' && guard++ < 100) {
    const next = draftNextAction(s);
    if (!next) break;
    const avail = getDraftPool(s);
    const defId = avail[policyIndex(`${next.kind}:${s.draftPicks.length}:${s.bannedProtocols.length}`, avail.length)].defId;
    if (next.kind === 'pick') performDraftPick(s, defId); else performDraftBan(s, defId);
  }
  // ── 走子：现场侧走**生产助手**，记录器照录（与测试的 playAndRecord 同形） ──
  for (let step = 0; step < 60; step += 1) {
    if (s.phase !== 'turn' || s.winner !== null) break;
    if (s.pendingEffects.length > 0) {
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      if (!top.prompt) { resolveAll(s); continue; }
      const p = top.prompt;
      const choice = p.optional ? [] : p.candidates.slice(0, 1).map((c) => c.uid);
      // ⚠️ `effect-choice` 的执行者必须是**实际 chooser**（`main.ts:307-314` 的现场判定）
      const chooser = p.chooser ?? top.player;
      const args = { promptId: p.id, choice };
      rec.record({ player: chooser, kind: 'effect-choice', args, via: 'user' });
      applyRecordedAction(s, { seq: rec.nextSeq() - 1, player: chooser, kind: 'effect-choice', args });
      resolveAll(s);
      continue;
    }
    const player = s.turnPlayer;
    const legal = getLegalActions(s, player);
    if (legal.length === 0) break;
    const a = legal[policyIndex(`act:${step}:${player}`, legal.length)];
    const args = {};
    if (a.cardUid !== undefined) args.cardUid = a.cardUid;
    if (a.faceUp !== undefined) args.faceUp = a.faceUp;
    if (a.line !== undefined) args.line = a.line;
    if (a.target !== undefined) args.target = a.target;
    if (a.promptId !== undefined) args.promptId = a.promptId;
    if (a.choice !== undefined) args.choice = a.choice;
    const hasArgs = Object.keys(args).length > 0;
    rec.record({ player, kind: a.kind, ...(hasArgs ? { args } : {}), via: 'user' });
    applyRecordedAction(s, { seq: rec.nextSeq() - 1, player, kind: a.kind, ...(hasArgs ? { args } : {}) });
    resolveAll(s);
  }
  // setup 逐字段显式抄（`setupFromState` 是生产函数；这里不写 `{...s}` 那种宽面透传）
  const setup = setupFromState({
    draftMode: s.draftMode,
    draftStarter: s.draftStarter,
    firstToPlay: s.firstToPlay,
    draftPool: s.draftPool.map((p) => ({ defId: p.defId })),
    draftPicks: s.draftPicks.map((p) => ({ defId: p.defId })),
    bannedProtocols: s.bannedProtocols.slice(),
  });
  const file = rec.toMatchFile({
    seed: POLICY_SEED,
    setup,
    players: [{ nick: '甲' }, { nick: '乙' }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: '2026-09-17T00:00:00.000Z',
  });
  return { file, actions: rec.actions().length, draft: `${setup.draftPicks.length} 选 / ${setup.bannedProtocols.length} 禁` };
}

/** 重放到第 N 步的状态（`stateAfterDraft` 重建草稿，再逐条走生产助手）。 */
function stateAtStep(file, n) {
  const st = stateAfterDraft(file);
  const upto = Math.min(n, file.actions.length);
  for (let i = 0; i < upto; i += 1) {
    applyRecordedAction(st, file.actions[i]);
    resolveAll(st);
  }
  return st;
}

const isReplay = scenario === 'replay';
/** 重放场景的中间态 + 控制条节点句柄（在下面的渲染块里赋值；后面的 I 段读它）。 */
const replay = { archive: null, state: null, bar: null, shield: null };
if (isReplay) {
  const built = buildReplayArchive();
  replay.archive = built;
  replay.state = stateAtStep(built.file, REPLAY_AT);
  out.notes.push(`重放场景：档案由**生产记录器**产出（seed=${POLICY_SEED}，草稿 ${built.draft}），`
    + `共 ${built.actions} 步操作；已重放到第 ${REPLAY_AT} 步（固定值，写死在探针里）。`
    + `第 ${REPLAY_AT} 步的形态：phase=${replay.state.phase} / step=${replay.state.step} /`
    + ` 挂起效果 ${replay.state.pendingEffects.length} 个 / 手牌 ${replay.state.players[0].hand.length}+${replay.state.players[1].hand.length}`
    + ` —— **刻意避开挂起选择**（那样屏上会长出可点的选择条，"不可操作"的判据就分不清是遮罩还是没按钮）。`);
}

const s = makeState();
const root = document.getElementById('app');
const isNet = scenario === 'net';
// ⚠️ **必须在渲染之前**撤掉本轮的布局改动，否则量到的还是"改后"的值
if (params.get('baseline') === '1') stripThisRoundsLayout();
if (isNet) {
  renderNetBoard(root, s, cb, { viewSeat: seat, verifyHooks: false });
} else if (isReplay) {
  // ① 整帧渲染**重放状态**（生产渲染器；与 T4 收口后 `rerender` 末尾那一次是同一个调用形态）
  renderApp(root, replay.state, cb);
  // ② 控制条 + 遮罩：生产里由 T4 的 `refreshReplayBar()` 在 `renderApp` **之后**调；
  //    本任务里没有挂载点之争（计划 T6 第 1 条），探针自己就是那个调用点。
  const nav = { pause: noop, play: noop, next: noop, setRate: noop, exit: noop };
  const nodes = renderReplayBar(root, {
    position: REPLAY_AT,
    total: replay.archive.actions,
    rate: 1,
    paused: true,
    done: false,
  }, nav);
  replay.bar = nodes.bar;
  replay.shield = nodes.shield;
  /* ── 变异注入（`inject=`，**只在本探针页内联**，不改仓库任何文件） ──────────────
   * 两条注入各自证明一条判据有牙（见 §3 的 M1/M2）。默认不带 `inject` ⇒ 生产形态。
   * ⚠️ **只写内联样式，绝不动 `src/ui/styles-replay.css`**（那是 T3 的文件、已提交）。 */
  if (inject === 'bar-off') {
    // M1：把控制条挪出视口。`top` 与 CSS 的 `bottom:18px` 同时生效时 top 赢
    // （绝对/固定定位元素上 `top` 与 `bottom` 同时非 auto ⇒ 高度被拉伸），
    // 故同时把高度钉死，避免"顶部在视口外但底边仍探进来"的含混形态。
    replay.bar.style.top = '-400px';
    replay.bar.style.bottom = 'auto';
    replay.bar.style.height = '44px';
    out.notes.push('⚠️ **变异注入 `bar-off`**（M1）：控制条内联 `top:-400px; bottom:auto; height:44px`'
      + ' ⇒ 期望 `replay.bar.inViewport` 等项**变红**。注入只在本探针页的这次渲染里（内联样式），'
      + '仓库文件与共享树一字未改。');
  } else if (inject === 'shield-beneath') {
    // M2：把遮罩调到棋盘**之下**。
    // ⚠️ **第一版只写 `shield.style.zIndex='0'` 实测不红**（这是"我以为会红但没红"的一次实测，
    //    如实记下来）：`.board` 在热座页是 `position: static`（`styles.css:20` 只写
    //    `display:flex; flex-direction:column`）⇒ 内联 `z-index` 对**非定位**元素**被浏览器忽略**
    //    （`getComputedStyle` 仍会把设进去的数读回来，这正是那个假绿最阴的地方：读属性会说"设上了"）。
    //    而棋盘里的卡堆自带 `position:relative` + **个位数内联 z-index**（`render.ts` 的堆叠序号）
    //    ⇒ 遮罩压到 0 之后仍在卡**之上**，`elementFromPoint` 照旧命中遮罩。
    // ⇒ 真正能把"遮罩与棋盘"的先后翻过来的注入 = `shield z-index:0` **且** 让棋盘成为一个
    //    **定位**元素再抬到 400（`position:relative` 只改定位方式、**不改几何**：它不移位、
    //    不改变布局流，故不存在"靠搬布局把判据弄红"的污染）。注入后读计算值写进 notes 作独立证据。
    replay.shield.style.zIndex = '0';
    const board = document.querySelector('.board');
    if (board) { board.style.position = 'relative'; board.style.zIndex = '400'; }
    out.notes.push('⚠️ **变异注入 `shield-beneath`**（M2）：遮罩内联 `z-index:0`'
      + ` + 棋盘根 \`.board\` 内联 \`position:relative; z-index:400\`（实测计算值：`
      + `shield z=${getComputedStyle(replay.shield).zIndex}/pos=${getComputedStyle(replay.shield).position}`
      + `，board z=${board ? getComputedStyle(board).zIndex : '(没有 .board)'}/pos=${board ? getComputedStyle(board).position : '—'}）`
      + ' ⇒ 期望 `replay.shield.overCenter` / `overCard` / `blocksBoard` 的命中不再是遮罩而**变红**。'
      + '⚠️ **第一版注入（只把遮罩压到 0）实测不红**：`.board` 是 `position:static` ⇒ 内联 z-index 被'
      + '浏览器忽略（而 `getComputedStyle` 照样读回那个数），卡堆又自带个位数 z-index ⇒ 遮罩仍在卡之上，'
      + '那条判据会**假绿**。故注入必须让棋盘成为**定位**元素 —— 只加 `position:relative/z-index`，'
      + '**几何一字未动**（不移位、不改变布局、不改仓库文件）。');
  } else if (inject) {
    out.warnings.push(`未知的 inject=${JSON.stringify(inject)}（本探针只认 bar-off / shield-beneath）—— 本条不注入`);
  }
} else {
  renderApp(root, s, cb);
}

/* 常驻 FX 层：生产里由 app 主循环在渲染之后调用；这里照做，位置才与生产一致。
 * ⚠️⚠️ **必须在"图片与字体就绪"之后再同步**（R25 实测踩到的坑，见文件头注陷阱 3）：
 * 卡面图是异步的，图没加载时链路盒只有 ~8px 高；若先同步（按当时的 rect 定位 fixed 层）、
 * 再等图片（链路一下长高 100+px）⇒ 烟罩/扫描线会**停在旧坐标**上，
 * 表现为 `fx.smoke.top` 差一整段（实测视口 1904 时 Δ=120px）。
 * 生产里这正是"图片晚加载 ⇒ 常驻层滞后"的那个已知形态（由每次渲染/滚动重同步兜住）。 */
const syncNetFx = () => {
  if (!isNet) return;
  syncScanOverlays(s);
  syncSmokeOverlays(s);
  syncCompiledFxLayers();
};
const syncWrath = () => (isNet ? syncWrath0Cull(s) : []);
// 陷阱 2：关掉滑块过渡（只影响动画过程，不改变目标位置）
for (const n of document.querySelectorAll('.control-slider-img')) n.style.transition = 'none';

/* ── 等图片与字体（几何由图片固有尺寸决定） ── */
await Promise.all(Array.from(document.images).map((img) =>
  img.complete ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res; })));
if (document.fonts?.ready) await document.fonts.ready;
syncNetFx();                                             // ← 图就绪之后才定位常驻层
const layerKeys = syncWrath();
// 再等一次宏任务，让双 rAF（已换成 setTimeout）的写入落地
await new Promise((res) => window.setTimeout(res, 60));

const brokenImgs = Array.from(document.images).filter((i) => i.naturalWidth === 0);
if (brokenImgs.length > 0) {
  out.warnings.push(`有 ${brokenImgs.length} 张图没加载成功（naturalWidth=0）：`
    + brokenImgs.slice(0, 6).map((i) => i.getAttribute('src')).join('、')
    + `${brokenImgs.length > 6 ? ' …' : ''} —— 卡的几何由图片固有尺寸决定，这些测量项已失真`);
}
out.viewport = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
out.pageHeight = px(document.documentElement.scrollHeight);

/* ==========================================================================
 * 0. 布局前提：容器**不许横向溢出**（溢出时下面所有绝对测量都在"装不下的布局"里做）
 * ======================================================================== */
for (const [sel, what] of (isNet
  ? [['.net-board', '远程页板根'], ['.net-grid', '放置区（4 条轨道的网格）']]
  : [['.board', '热座板根'], ['.lane-row', '热座的一条线行（grid 4 列）']])) {
  const el = document.querySelector(sel);
  if (!el) { out.warnings.push(`0 段：找不到 ${sel}`); continue; }
  // ① **静态流内容是否装得下**：网格轨道之和 + 间距 ≤ 内容宽。这是"布局真的溢出"的判据
  //    （绝对定位的装饰伸到框外不算 —— 见下面的定位输出与 `.battery { left/right: -120px }`）。
  const cs = getComputedStyle(el);
  if (cs.display.includes('grid')) {
    const tracks = cs.gridTemplateColumns.split(/\s+/).map((v) => Number.parseFloat(v))
      .filter((v) => Number.isFinite(v));
    const gaps = tracks.length > 1 ? (tracks.length - 1) * (Number.parseFloat(cs.columnGap) || 0) : 0;
    const sum = tracks.reduce((a, b) => a + b, 0) + gaps;
    item(`layout.gridFit.${sel.replace(/[^\w]/g, '_')}`, `${what} ${sel} 的**静态内容**不超出容器`
      + `（轨道之和 ${sum.toFixed(1)}px ≤ 内容宽 ${el.clientWidth}px —— 超了就是真的装不下）`,
      0, Math.max(0, +(sum - el.clientWidth).toFixed(1)),
      'dom:gridTemplateColumns 的四条轨道 + columnGap vs clientWidth（真实 grid 求解）', 1);
    out.notes.push(`${sel} 轨道 = ${cs.gridTemplateColumns}（合计 ${sum.toFixed(1)}px / 内容 ${el.clientWidth}px）`);
  }
  // ② **scrollWidth 溢出量**：只说"有东西画在容器外"，**不区分**是不是绝对定位的装饰。
  //    ⚠️ **R25 修正：这一条从"判据"降级为"只报数不判定"**（`noteOnly`）——
  //    实测（带"是谁"的定位输出）证明它在本页**恒为 119/166px，且与放牌区装不装得下无关**：
  //    119 = `.battery { left/right: -120px }` 的外挂（设计如此：能量槽要挂在链路框外侧），
  //    166 = 再加 `.battery-overflow`（点数 >10 时的数字）那一截。
  //    拿它当"布局溢出"的判据是**判据本身写错了**（绝对定位装饰本来就会画到框外，这是设计）。
  //    ⇒ 判据改成两条各管一件事：`layout.gridFit.*`（静态内容/轨道装不装得下）+ `page.hScroll`
  //    （用户真正看得见的那条横向滚动条）。数字仍然打印，供对照与排查。
  const over = Math.max(0, el.scrollWidth - el.clientWidth);
  item(`layout.overflow.${sel.replace(/[^\w]/g, '_')}`, `${what} ${sel} 的 scrollWidth 溢出量`
    + `（含绝对定位装饰；**只报数不判定** —— 判据见 layout.gridFit.* 与 page.hScroll）`,
    0, over, 'dom:scrollWidth vs clientWidth（含 `.battery` 的 -120px 外挂，非"装不下"）', 1);
  out.items[out.items.length - 1].noteOnly = true;
  // ── **溢出定位**：scrollWidth 只说"多了多少"，不说"是谁"。这里把越过容器 padding box 的
  //    **后代**按越界量排序列出（带 position），一眼分清两种完全不同的成因：
  //      · 网格轨道装不下（`position: static` 的格子越界）⇒ 要改列模板 / 缩旋钮；
  //      · 某个**绝对定位**的装饰或侧挂元素伸到外面（`position: absolute`）⇒ 那是设计如此，
  //        不该用"容器不许溢出"这条判据去管它（`.battery { left/right: -120px }` 就是这种）。
  if (over > 1) {
    const box = el.getBoundingClientRect();
    const offenders = [];
    for (const n of el.querySelectorAll('*')) {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const past = Math.max(r.right - box.right, box.left - r.left);
      if (past > 1) {
        offenders.push({
          cls: (String(n.className) || n.tagName).split(/\s+/).slice(0, 2).join('.'),
          past: +past.toFixed(1), pos: getComputedStyle(n).position,
        });
      }
    }
    offenders.sort((a, b) => b.past - a.past);
    out.notes.push(`${sel} 溢出 ${over}px ⇒ 越界最多的 5 个后代：`
      + (offenders.slice(0, 5).map((o) => `${o.cls}(+${o.past}px,${o.pos})`).join(' / ')
        || '（没找到 —— 可能是伪元素/阴影/文字溢出）'));
  }
}
// ③ **整页横向滚动条**（用户真正看得见的那一条）：布局溢出的最终症状。
const de = document.documentElement;
item('page.hScroll', '整页没有横向滚动条（documentElement.scrollWidth ≤ clientWidth）'
  + ' —— 比"某个容器 scrollWidth 大了"更接近用户所见',
  0, Math.max(0, de.scrollWidth - de.clientWidth),
  'dom:documentElement.scrollWidth vs clientWidth', 1);
// 协议列在窄屏会不会被压成 0（本轮要修的那条）：单独记一行人看的数字
if (!isNet) {
  const cell = document.querySelector('.protocol-cell');
  const pimg = document.querySelector('.protocol-img');
  if (cell && pimg) {
    const holder = cell.querySelector('.protocol-holder');
    out.notes.push(`协议列：cell=${cell.offsetWidth}px / holder=${holder ? holder.offsetWidth : '?'}px`
      + ` / img=${pimg.offsetWidth}px`);
  }
  // **7 张卡的横向跨度** = 链路列真实的内容需求（决定"缩一档到多少才装得下"的那个数）。
  // 它与视口无关（只由 `--card-h` 的旋钮链决定），所以这一行在多宽度矩阵里是常量。
  const slot = document.querySelector('.lane-row[data-line="1"] .stack-slot');
  const cards = slot ? [...slot.querySelectorAll('.card')] : [];
  if (cards.length >= 2) {
    const a = cards[0].getBoundingClientRect();
    const b = cards[cards.length - 1].getBoundingClientRect();
    const sc = getComputedStyle(slot);
    out.notes.push(`链路内容需求：${cards.length} 张卡跨度 = ${(b.right - a.left).toFixed(1)}px`
      + ` + .stack-slot 的 padding/border ${sc.paddingLeft}+${sc.paddingRight}+${sc.borderLeftWidth}+${sc.borderRightWidth}`
      + ` = ${((b.right - a.left) + parseFloat(sc.paddingLeft) + parseFloat(sc.paddingRight)
        + parseFloat(sc.borderLeftWidth) + parseFloat(sc.borderRightWidth)).toFixed(1)}px`);
  }
}

/* ==========================================================================
 * A. 几何旋钮链（R10-2 那一族：旋钮必须真的到达消费它的元素）
 * ======================================================================== */
const varHost = isNet
  ? document.querySelector('.net-board')
  : document.querySelector('.stack');                       // 热座：`.stack` 自己声明
const consumer = isNet
  ? document.querySelector('.net-lane-band .stack')
  : document.querySelector('.stack');
if (varHost && consumer) {
  const rootSel = isNet ? '.net-board' : '.stack';
  // ⚠️ 期望值必须**媒体查询感知**：R25 的窄屏档位会重声明 `.stack { --card-h }`；
  //    只读顶层（175）会把窄屏下的 98/83 判成"旋钮没到达消费元素"（假红）。
  const decl = declForViewport(rootSel, '--card-h');
  const declared = decl ? evalLen('width', decl.value, varHost) : null;
  const atConsumer = px(getComputedStyle(consumer).getPropertyValue('--card-h'));
  out.notes.push(`--card-h 的声明处：${rootSel} { --card-h: ${decl ? decl.value : '(取不到)'} }`
    + `（来源 ${decl ? decl.sheet : '?'}）⇒ 解算 ${declared}px；消费元素上读到 ${atConsumer}px`);
  // ⚠️ 这一条就是 **R10-2**：`styles.css:422` 的 `.stack { --card-h: 175px }` 声明在**元素自己
  //    身上**，而自定义属性只在该元素自己没有声明时才继承 ⇒ 上提的旋钮赢不了它。
  //    静态守卫解算的是"声明与权重"，胜负由浏览器级联定 —— 只有这里能看见。
  item('var.cardH.reaches', `--card-h 到达消费元素（${isNet ? '.net-lane-band .stack' : '.stack'}）—— R10-2 那条链`,
    declared, atConsumer, `css:${rootSel}#--card-h（含命中的媒体查询）⇒ 必须赢过 styles.css 的 .stack{--card-h:175px}`, 0.5);
  const wDecl = declForViewport(rootSel, '--card-w');
  const cardW = wDecl ? evalLen('width', wDecl.value, varHost) : null;
  const fromFormula = declared === null ? null : +((declared - 2) * 0.71429 + 2).toFixed(3);
  item('var.cardW.formula', '--card-w == (--card-h − 2) × 0.71429 + 2（卡面 5:7）',
    fromFormula, cardW, 'css:.net-board#--card-w + dom:--card-h', 0.5);
} else {
  out.warnings.push(`A 段：找不到变量宿主或消费元素（${isNet ? '.net-board / .net-lane-band .stack' : '.stack'}）`);
}
if (isNet) {
  const hDecl = declForViewport('.net-board', '--hand-card-h');
  const cardW = evalLen('width', (declForViewport('.net-board', '--card-w') ?? { value: '0px' }).value, varHost);
  const handH = hDecl ? evalLen('width', hDecl.value, varHost) : null;
  const fromW = cardW === null ? null : +((cardW - 8) * 1.4 + 8).toFixed(3);
  item('var.handCardH', '--hand-card-h == (--card-w − 8) × 1.4 + 8',
    fromW, handH, 'css:.net-board#--hand-card-h + dom:--card-w', 0.5);
}

/* ==========================================================================
 * B. 卡几何（布局盒 vs 视觉盒 —— 旋转只有浏览器说得清）
 * ======================================================================== */
const cardW = evalLen('width', (declForViewport(isNet ? '.net-board' : '.stack', '--card-w') ?? { value: '0px' }).value, varHost);
const fieldCards = Array.from(document.querySelectorAll(isNet ? '.net-lane-band .stack .card' : '.stack .card'));
const handCards = Array.from(document.querySelectorAll('.hand .card'));
if (fieldCards.length > 0 && cardW !== null) {
  const c0 = fieldCards[0];
  const lb = layoutBox(c0);
  const rb = rectOf(c0);
  item('card.field.layoutW', '场上卡**布局盒**宽 == --card-w（`.stack` 的 min-width 就是它）',
    cardW, lb.width, `css:${isNet ? '.net-board' : '.stack'}#--card-w`, 1);
  // 热座场上卡带 ±90° ⇒ 视觉盒应当**交换**；远程页只有 0°/180° ⇒ 不交换
  if (isNet) {
    item('card.field.visualNoSwap', '远程页场上卡 0°/180° ⇒ 视觉盒 == 布局盒（不交换）',
      lb.width, rb.width, 'dom:同一张卡的 offsetWidth vs getBoundingClientRect().width', 1);
  } else {
    item('card.field.visualSwap', '热座场上卡 ±90° ⇒ 视觉盒宽 == 布局盒**高**（交换）',
      lb.height, rb.width, 'dom:同一张卡的 offsetHeight vs getBoundingClientRect().width（±90° 的旋转足迹）', 1.5);
  }
} else {
  out.warnings.push('B 段：没有场上卡（或 --card-w 取不到）');
}
if (handCards.length >= 2) {
  const w0 = layoutBox(handCards[0]).width;
  // 手牌卡宽：远程页 = --card-w（单源）；热座 = styles.css 的 `.card{width:130px}`（**基线**）
  item('card.hand.width', isNet ? '远程页手牌卡宽 == --card-w' : '热座手牌卡宽 == 130（styles.css 的 .card 字面量）',
    isNet ? cardW : 130, w0,
    isNet ? 'css:.net-board .card#width' : 'baseline:styles.css:387 `.card { width: 130px }`（R7 定的 110→130；红线文件）', 1);
  const step = +(Math.abs(rectOf(handCards[1]).left - rectOf(handCards[0]).left)).toFixed(3);
  if (isNet) {
    const stepDecl = singleDecl('.net-board .hand .card + .card', 'margin-left');
    const expectStep = stepDecl ? +(cardW - Math.abs(evalLen('margin-left', stepDecl.value, varHost))).toFixed(3) : null;
    item('card.hand.step', '远程页手牌步距 == --card-w − |margin-left|',
      expectStep, step, 'css:.net-board .hand .card + .card#margin-left + dom:--card-w', 1.5);
  } else {
    item('card.hand.step', '热座手牌步距 == 130 − 28',
      102, step, 'baseline:styles.css:879 `.hand .card + .card { margin-left: -28px }` + `.card{width:130px}`', 1);
  }
} else {
  out.warnings.push('B 段：手牌卡不足 2 张（步距项需要两张）');
}

/* ==========================================================================
 * C. 协议 holder 与其**旋转后视觉足迹**
 * ======================================================================== */
const holderSel = isNet ? '.net-lane-band .protocol-holder' : '.protocol-holder';
// ⚠️ **必须挑"可见的那个"**：页面里可以存在 offsetWidth/Height 为 0 的同名节点
//    （`display:none` 的隐藏副本 / 塌陷的空盒）。拿第一个 DOM 序节点测会读出 0×0，
//    而那是"选错了对象"，不是布局缺陷。这里把这件事**写进 notes**（哪个下标、有几个、
//    祖先链长什么样），免得下一个人再花一轮排查。
const allHolders = Array.from(document.querySelectorAll(holderSel));
const visibleHolders = allHolders.filter((h) => h.offsetWidth > 0 && h.offsetHeight > 0);
const holder = visibleHolders[0] ?? allHolders[0] ?? null;
if (allHolders.length === 0) out.warnings.push(`C 段：页面里没有 ${holderSel}`);
else if (visibleHolders.length !== allHolders.length) {
  const chainOf = (n) => { const out = []; for (let p = n; p; p = p.parentElement) out.unshift(`${p.tagName.toLowerCase()}.${String(p.className).split(/\s+/).slice(0, 2).join('.')}`); return out.join(' > '); };
  out.notes.push(`${holderSel}：共 ${allHolders.length} 个，其中 ${visibleHolders.length} 个可见`
    + `（本次测的是第 ${allHolders.indexOf(holder) + 1} 个 = 第一个可见的）。`
    + `第一个节点的尺寸 = ${allHolders[0].offsetWidth}×${allHolders[0].offsetHeight}，`
    + `它的祖先链：${chainOf(allHolders[0])}`);
}
const holderImg = holder?.querySelector('img.protocol-img') ?? null;
if (holder && holderImg && holder.offsetWidth === 0) {
  // **尺寸链诊断**：被测元素是 0×0 时，把从它到 `.board` 的每一层尺寸/display 打出来 ——
  // 这样"是我选错了节点"还是"某一层真的塌了"一眼可辨（省掉一轮人工排查）。
  const chain = [];
  for (let p = holder; p !== null && chain.length < 9; p = p.parentElement) chain.unshift(p);
  out.notes.push('协议 holder 是 0×0，尺寸链自上而下：'
    + chain.map((n) => `${n.tagName.toLowerCase()}.${String(n.className).split(/\s+/).slice(0, 2).join('.')}`
      + `=${n.offsetWidth}×${n.offsetHeight}[${getComputedStyle(n).display}]`).join(' → '));
  out.notes.push(`协议图：naturalWidth=${holderImg.naturalWidth} naturalHeight=${holderImg.naturalHeight}`
    + ` computed width=${getComputedStyle(holderImg).width} max-width=${getComputedStyle(holderImg).maxWidth}`
    + ` src=${holderImg.getAttribute('src')}`);
}
if (holder && holderImg) {
  if (isNet) {
    // 远程页：holder 的宽高由 `--card-h` 的倍数**显式声明** ⇒ 单源可求值
    for (const [prop, key] of [['width', 'W'], ['height', 'H']]) {
      const d = singleDecl(holderSel, prop);
      item(`proto.holder.${key}`, `协议 holder 的 ${prop} == 样式表声明（单源求值）`,
        d ? evalLen(prop, d.value, holder) : null, layoutBox(holder)[prop],
        `css:${holderSel}#${prop}`, 1);
    }
  } else {
    // 热座：`.protocol-holder` **没有**显式尺寸（`position:relative + inline-flex`），
    // 尺寸由**卡面图**撑出 ⇒ 单源是 `.protocol-img { width: 200px; height: auto }`。
    const dw = singleDecl('.protocol-img', 'width');
    const imgW = dw ? evalLen('width', dw.value, holderImg) : null;
    // ⚠️ **期望值必须按"容器给不给得起"截断**（R25 修正）：`.protocol-img` 是
    //    `width: 200px; max-width: 100%` —— 容器只有 177/117px 宽时，浏览器**只能**给
    //    `容器内容宽`（这不是缺陷，是 `max-width: 100%` 的定义）。第一版期望写死 200 ⇒
    //    在视口 1920/1800（协议列本来就被挤窄的宽度）**误报** 5 项红。
    //    现在的期望 = `min(声明宽, 该格的内容盒宽)`；R25 要保证的"不为 0 / 进档后拿到完整宽"
    //    由下面的 `proto.img.nonZero` 与档位腿（tests/ui/hotseat-narrow-fallback.test.ts）分别承担。
    const cell = holder.closest('.protocol-cell');
    const ccs = cell ? getComputedStyle(cell) : null;
    // ⚠️ 协议图的包含块是 `.protocol`（**不是** `.protocol-cell`）⇒ 可用宽还要减掉 `.protocol`
    //    自己的 padding(2×4) 与 border(2×1)。实测：视口 1904 时 cell=177 而 img=167，
    //    差的正是这 10px（第一版只减了 cell 的 padding ⇒ 误报 Δ=10）。
    const protoBox = cell ? cell.querySelector('.protocol') : null;
    const pcs = protoBox ? getComputedStyle(protoBox) : null;
    const cellContent = cell && ccs && pcs
      ? cell.clientWidth - px(ccs.paddingLeft) - px(ccs.paddingRight)
        - px(pcs.paddingLeft) - px(pcs.paddingRight) - px(pcs.borderLeftWidth) - px(pcs.borderRightWidth)
      : null;
    const expectClamped = imgW === null || cellContent === null ? imgW : Math.min(imgW, cellContent);
    item('proto.img.width', '热座协议图宽 == min(声明宽, 协议格内容宽)（单源 + 容器截断）',
      expectClamped, layoutBox(holderImg).width,
      'css:.protocol-img#width + dom:.protocol-cell 的内容盒（`max-width: 100%` 的作用）', 1);
    item('proto.holder.wrapsImg', '热座 holder 的布局盒 == 协议图布局盒（inline-flex 包裹，无显式尺寸）',
      layoutBox(holderImg).width, layoutBox(holder).width,
      'dom:.protocol-holder 的 offsetWidth vs 里面那张 .protocol-img', 1);
  }
  // ── **R25 的核心诉求本身**：协议图**永不为 0**（任何宽度、任何档位）──
  // 用"违反次数"表达（0 = 好）：比"期望一个数"更贴合"永不允许塌成 0"这句话。
  item('proto.img.nonZero', '协议图宽度 > 0 —— 违反次数（0 = 协议在任何宽度下都看得见）',
    0, holderImg.offsetWidth > 0 ? 0 : 1,
    'dom:`.protocol-img` 的 offsetWidth（R25 用户裁决："协议永不允许塌成 0 宽"）', null);
  const hb = layoutBox(holder);
  const ir = rectOf(holderImg);
  const imgCs = getComputedStyle(holderImg);
  const padY = px(imgCs.paddingTop) + px(imgCs.paddingBottom);
  if (isNet) {
    item('proto.img.visualSwap', '远程页协议图带 ∓90°（.net-rot-cw/ccw）⇒ 视觉足迹 == holder 盒**交换**',
      +(hb.height - padY).toFixed(3), ir.width,
      'dom:holder 的 offsetHeight vs `.protocol-img` 的 getBoundingClientRect().width（旋转 ⇒ 宽高互换）', 1.5);
  } else {
    item('proto.img.noSwap', '热座协议图只有 0°/180° ⇒ 视觉足迹 == 自身布局盒',
      layoutBox(holderImg).width, ir.width, 'dom:`.protocol-img` 的 offsetWidth vs getBoundingClientRect().width', 1.5);
  }
  // 旋转类是不是真的在那儿（R8-4 的 DOM 契约，浏览器侧复核一次）
  const rotCls = String(holderImg.className).split(/\s+/).filter((c) => c.startsWith('net-rot-') || c === 'rot-180');
  item('proto.img.rotClass', isNet ? '远程页协议图带 .net-rot-cw/.net-rot-ccw（不是热座的 .rot-cw/.rot-ccw）'
    : '热座协议图不带任何 .net-rot-*',
  isNet, rotCls.some((c) => c.startsWith('net-rot-')),
  'dom:`.protocol-img` 的类名（约束 8/10 的浏览器侧复核）', null);
} else {
  out.warnings.push('C 段：找不到协议 holder 或协议图');
}

/* ==========================================================================
 * D. 链路 7 张跨度（net：`.stack` 的 min-height 预留）
 * ======================================================================== */
if (isNet) {
  const stackSel = '.net-lane-band .stack';
  // ⚠️ 必须按 **(玩家, 线号)** 取，不能按 `.stack` 的文档下标取：文档顺序是
  //    [线0/对手, 线0/自己, 线1/对手, 线1/自己, …] ⇒ 下标 1 是**线 0 的自己侧**（1 张）。
  const st = document.querySelector('.net-lane-band .stack-slot[data-player="0"][data-line="1"] .stack');
  const d = singleDecl(stackSel, 'min-height');
  const expectMin = d ? evalLen('min-height', d.value, st) : null;
  const cardsInStack = st ? st.querySelectorAll('.card').length : 0;
  if (st && cardsInStack === 7) {
    item('lane.span7.min', '装满 7 张时链路高度 ≥ 声明的 min-height（7 张跨度预留）',
      expectMin, layoutBox(st).height, `css:${stackSel}#min-height + dom:--card-h/--card-w`, 2);
  } else {
    out.warnings.push(`D 段：线 1 自己侧的 .stack 里是 ${cardsInStack} 张（跨度项要求恰好 7 张）`);
  }
}

/* ==========================================================================
 * E. 能量槽（R22 语义：**夹在该侧协议与该侧链路之间**）
 * ======================================================================== */
if (isNet) {
  const cols = Array.from(document.querySelectorAll('.net-lane-band'));
  const order = [];
  let containmentFails = 0;
  let widthFails = 0;
  for (const col of cols) {
    const line = col.dataset.line;
    for (const side of ['foe', 'self']) {
      const sideNode = col.querySelector(`.net-side-${side}`);
      if (!sideNode) continue;
      const kids = Array.from(sideNode.children);
      const iSlot = kids.findIndex((n) => n.classList.contains('stack-slot'));
      const iBat = kids.findIndex((n) => n.classList.contains('battery'));
      const iProto = kids.findIndex((n) => n.classList.contains('protocol-cell'));
      order.push(`${line}/${side}=[${iSlot},${iBat},${iProto}]`);
      const slot = kids[iSlot], bat = kids[iBat], proto = kids[iProto];
      if (!slot || !bat || !proto) { containmentFails += 1; continue; }
      const bs = rectOf(slot), bb = rectOf(bat), bp = rectOf(proto);
      const lo = Math.min(bs.top, bp.top), hi = Math.max(bs.bottom, bp.bottom);
      if (!(bb.top >= lo - 0.5 && bb.bottom <= hi + 0.5)) containmentFails += 1;
      // 能量槽宽 == 该侧内容宽（`.battery { width: 100% }`）
      const sideContentW = sideNode.clientWidth
        - px(getComputedStyle(sideNode).paddingLeft) - px(getComputedStyle(sideNode).paddingRight);
      if (Math.abs(bb.width - sideContentW) > 1) widthFails += 1;
    }
  }
  item('battery.order', '每侧的三个直接子节点下标 == [链路槽, 能量槽, 协议格] 或镜像（6 处）',
    cols.length * 2, order.filter((o) => /=\[(0,1,2|2,1,0)\]$/.test(o)).length,
    'dom:.net-side 的子节点顺序（R22：能量槽在链路头部）', null);
  item('battery.between', '能量槽 rect 夹在「本侧链路槽 ∪ 本侧协议格」的纵向区间内（6 处）',
    0, containmentFails, 'dom:同一侧三个子节点的 getBoundingClientRect（R22 的语义判据）', null);
  item('battery.width', '能量槽宽 == 该侧内容宽（.battery{width:100%}）—— 不符个数',
    0, widthFails, 'dom:.net-side 的 clientWidth 减 padding', null);
}

/* ==========================================================================
 * F. 控制轨（滑块停位 + 两端标签，R16/R22）
 * ======================================================================== */
if (isNet) {
  const track = document.querySelector('.control-track');
  const slider = document.querySelector('.control-slider-img');
  if (track && slider) {
    const want = fxTrackEndFor(seat, s.control);
    const tr = track.getBoundingClientRect();
    const sr = slider.getBoundingClientRect();
    const tcs = getComputedStyle(track);
    const borderTop = px(tcs.borderTopWidth) ?? 0;
    const borderBottom = px(tcs.borderBottomWidth) ?? 0;
    const padBoxTop = tr.top + borderTop;
    const padBoxH = tr.height - borderTop - borderBottom;
    const measuredPct = +(((sr.top + sr.height / 2 - padBoxTop) / padBoxH) * 100).toFixed(3);
    item('control.sliderPct', `滑块中心 top% == fxTrackEndFor(${seat}, ${s.control}).pct（轴 ${want.axis}）`,
      +(want.pct * 100).toFixed(3), measuredPct,
      'dom:fxTrackEndFor（页面内 import，与渲染同一份源码）+ 轨道**内边距盒**（CSS 的 top% 就是按它解析的）', 0.5);
  } else {
    out.warnings.push('F 段：找不到 .control-track / .control-slider-img');
  }
  const labels = Array.from(document.querySelectorAll('.control-track-label'));
  const top = labels.find((n) => n.classList.contains('top'));
  const bottom = labels.find((n) => n.classList.contains('bottom'));
  if (top && bottom && track) {
    const tr = track.getBoundingClientRect();
    const tcs = getComputedStyle(track);
    const padBoxL = tr.left + (px(tcs.borderLeftWidth) ?? 0);
    const padBoxW = tr.width - (px(tcs.borderLeftWidth) ?? 0) - (px(tcs.borderRightWidth) ?? 0);
    item('control.label.top', '上端标签 = 对手（1−seat）',
      `玩家 ${2 - seat}`, top.textContent, 'dom:端的语义 = fx-seat 的 FX_TRACK_EDGE_PCT_Y（上端 = 对手端）', null);
    item('control.label.bottom', '下端标签 = 自己（seat）',
      `玩家 ${seat + 1}`, bottom.textContent, 'dom:端的语义（下端 = 自己端）', null);
    item('control.label.center', '两端标签的水平中心 == 轨道内边距盒中心（换轴规则真的命中）',
      px(padBoxL + padBoxW / 2), rectOf(top).cx, 'css:.net-board .control-track-label#left/transform', 1);
    item('control.label.topOffset', '上端标签顶边距轨道内边距盒顶 == 10px（不是 28.5% 那种离散值）',
      10, +(rectOf(top).top - (tr.top + (px(tcs.borderTopWidth) ?? 0))).toFixed(3),
      'css:.net-board .control-track-label.top#top', 1);
    item('control.label.bottomOffset', '下端标签底边距轨道内边距盒底 == 10px',
      10, +((tr.bottom - (px(tcs.borderBottomWidth) ?? 0)) - rectOf(bottom).bottom).toFixed(3),
      'css:.net-board .control-track-label.bottom#bottom', 1);
  } else {
    out.warnings.push('F 段：找不到两个端标签（或 .control-track）');
  }
  out.notes.push(`FX_TRACK_EDGE_PCT_Y=${FX_TRACK_EDGE_PCT_Y}（竖向贴端百分比，22/78 的单一出处）`);
}

/* ==========================================================================
 * G. R21 三块布局（左栏 / 放置区 / 右栏）
 * ======================================================================== */
if (isNet) {
  const board = document.querySelector('.net-board');
  const grid = document.querySelector('.net-grid');
  const leftRail = document.querySelector('.net-left-rail');
  const rightRail = document.querySelector('.net-right-rail');
  const infoPair = document.querySelector('.net-info-pair');
  // ⚠️ 手牌区要用 `.net-hand-area-self`（真实盒子）而不是 `.net-hands` —— 后者是
  //    `display: contents`，浏览器给它的 rect 是**空的**（0×0），拿它比"在上方"会恒真。
  const hands = document.querySelector('.net-hand-area-self') ?? document.querySelector('.net-hands');
  const zoom = document.querySelector('.net-board .net-zoom-box') ?? document.querySelector('.net-zoom-box');
  if (board && grid && leftRail) {
    // ⚠️ **"贴住"的准确含义 = 只剩 `.net-board` 的列间距**（`gap: var(--net-board-gap)`）：
    //    左栏在第 1 列、放置区在第 2 列，`justify-self: end` 只把左栏推到**第 1 列的右缘**，
    //    真正的间隙就是那条 gap（实测 2px）。第一版期望写成"左栏右缘 == 放置区左缘"⇒
    //    稳定报 2px 差异 —— 那不是缺陷，是**期望值没单源**。现在 gap 从页面自己的
    //    `--net-board-gap` 读出来参与期望 ⇒ 改 gap 时期望跟着动，而"justify-self 写错"
//    仍然会被抓到（那会差一整栏）。
    const gapDecl = singleDecl('.net-board', '--net-board-gap');
    const gap = gapDecl ? evalLen('width', gapDecl.value, board) : null;
    out.notes.push(`.net-board 的列间距 --net-board-gap = ${gap}px（左右栏与放置区之间**应该**只剩它）`);
    item('rail.left.rightEdge', '左栏右缘 == 放置区左缘 − 列间距（justify-self: end 的全部含义）',
      gap === null ? null : +(rectOf(grid).left - gap).toFixed(3), rectOf(leftRail).right,
      'dom:.net-grid 的 left − css:.net-board#--net-board-gap', 1);
  }
  if (board && grid && rightRail) {
    const gapDecl = singleDecl('.net-board', '--net-board-gap');
    const gap = gapDecl ? evalLen('width', gapDecl.value, board) : null;
    item('rail.right.leftEdge', '右栏左缘 == 放置区右缘 + 列间距（justify-self: start 的全部含义）',
      gap === null ? null : +(rectOf(grid).right + gap).toFixed(3), rectOf(rightRail).left,
      'dom:.net-grid 的 right + css:.net-board#--net-board-gap', 1);
  }
  if (infoPair && hands) {
    item('rail.infoAboveHands', '两块信息组件（.net-info-pair）在**手牌区上方**（左栏纵向序）',
      true, rectOf(infoPair).bottom <= rectOf(hands).top + 1,
      'dom:.net-left-rail 的子节点顺序 + rect（R21："信息组件在手牌区的上方"）', null);
  }
  if (zoom && rightRail) {
    item('rail.zoomInRight', '放大框在右栏内（左缘 == 右栏左缘）',
      rectOf(rightRail).left, rectOf(zoom).left, 'dom:.net-right-rail 与放大框的 rect', 1.5);
  }
}

/* ==========================================================================
 * H. 常驻 FX 层（锚点 = rect 现算 ⇒ 位置一变它们必须跟着变）
 * ======================================================================== */
if (isNet) {
  const smokes = Array.from(document.querySelectorAll('[data-smoke-key]'));
  if (smokes.length > 0) {
    const n = smokes[0];
    const [p, line] = String(n.dataset.smokeKey).split('-');
    const slot = document.querySelector(`.stack-slot[data-player="${p}"][data-line="${line}"]`);
    if (slot) {
      item('fx.smoke.box', '烟雾罩盒 == 它的 .stack-slot 盒（逐字段）',
        rectOf(slot).width, rectOf(n).width, 'dom:data-smoke-key → .stack-slot 的 rect', 0.5);
      item('fx.smoke.top', '烟雾罩顶 == 槽顶', rectOf(slot).top, rectOf(n).top, 'dom:同一对元素', 0.5);
    }
  } else {
    out.warnings.push('H 段：没有烟雾罩（需要 darkness-2 正面在场 —— 合成局应当造出来）');
  }
  const scans = Array.from(document.querySelectorAll('.scan-overlay'));
  if (scans.length > 0) {
    let boxFail = 0, horizFail = 0;
    for (const n of scans) {
      const [p, line] = String(n.dataset.scanKey).split('-');
      const shell = document.querySelector(`.battery[data-player="${p}"][data-line="${line}"] .battery-shell`);
      if (!shell) { boxFail += 1; continue; }
      const a = rectOf(n), b = rectOf(shell);
      if (Math.abs(a.width - b.width) > 0.5 || Math.abs(a.top - b.top) > 0.5) boxFail += 1;
      if (n.classList.contains('scan-horiz') !== (b.width > b.height)) horizFail += 1;
    }
    item('fx.scan.box', '扫描层盒 == .battery-shell（宽/顶，逐项）—— 不符个数', 0, boxFail,
      'dom:data-scan-key → .battery-shell 的 rect', null);
    item('fx.scan.horiz', '.scan-horiz ⇔ 外壳"宽 > 高"（横置判据）—— 不符个数', 0, horizFail,
      'dom:syncScanOverlays 的同一判据（浏览器侧复核）', null);
  } else {
    out.warnings.push('H 段：没有扫描层（6 个 stable/bulge 能量槽应当各有一个）');
  }
  const layers = Array.from(document.querySelectorAll('.compiled-fx'));
  if (layers.length > 0) {
    const layer = layers[0];
    const defId = Array.from(layer.classList).find((c) => c.startsWith('compiled-fx-'));
    const box = document.querySelector(`.protocol.compiled.${defId}`) ?? document.querySelector('.protocol.compiled');
    const h = box?.querySelector('.protocol-holder') ?? null;
    if (h) {
      const hr = rectOf(h);
      const deg = h.getAttribute('data-fx-rot') === 'ccw' ? -90 : h.getAttribute('data-fx-rot') === 'cw' ? 90 : 0;
      const k = +(hr.width / 200).toFixed(4);            // 200 = COMPILED_FX_BASIS_W（render.ts 的作者基准）
      const m = getComputedStyle(layer).transform;
      const nums = /matrix\(([^)]+)\)/.exec(m)?.[1].split(',').map(Number) ?? null;
      const rad = (deg * Math.PI) / 180;
      const want = [k * Math.cos(rad), k * Math.sin(rad), -k * Math.sin(rad), k * Math.cos(rad)];
      const maxDelta = nums ? Math.max(...want.map((w, i) => Math.abs(w - nums[i]))) : null;
      item('fx.compiled.transform', `已编译持久层 computed transform == rotate(${deg}deg) scale(${k})（矩阵逐项最大偏差）`,
        0, maxDelta === null ? null : +maxDelta.toFixed(4),
        'dom:holder 的 data-fx-rot（fxRotDegOf 的同一输入）+ COMPILED_FX_BASIS_W=200（render.ts）', 0.002);
      // ⚠️ 中心同心必须**逐轴**比（第一版把两个中心拼成一个字符串比较 ⇒ 永远"不相等"，
      //    那是探针自己的判据形态错误，不是产品差异）。
      const lr = rectOf(layer);
      item('fx.compiled.cx', '层盒视觉中心 x == holder 实测中心 x（同心）',
        hr.cx, lr.cx, 'dom:positionCompiledFxLayer 的"居中对齐到 holder 实测中心"', 1);
      item('fx.compiled.cy', '层盒视觉中心 y == holder 实测中心 y（同心）',
        hr.cy, lr.cy, 'dom:positionCompiledFxLayer 的"居中对齐到 holder 实测中心"', 1);
      item('fx.compiled.visualSwap', '层（已转 ∓90°）的视觉盒 == holder 盒交换（与协议视觉盒重合）',
        +(hr.height / 1).toFixed(3), lr.width, 'dom:holder 的 rect 高 vs 层盒的 rect 宽（∓90° ⇒ 互换）', 1.5);
    }
  } else {
    out.warnings.push('H 段：没有 .compiled-fx 层（合成局里 P0 线 1 的协议是 compiled）');
  }
}

/* ── 汇总的"人看的数字"（报告里直接贴，不参与判定） ── */
const brief = (sel) => rectOf(document.querySelector(sel));
out.observed = {
  grid: brief('.net-grid'), leftRail: brief('.net-left-rail'), rightRail: brief('.net-right-rail'),
  infoPair: brief('.net-info-pair'), netHands: brief('.net-hands'),
  zoomBox: brief('.net-board .net-zoom-box') ?? brief('.net-zoom-box'),
  selfHand: brief('.hand[data-player="0"]'), foeHand: brief('.hand[data-player="1"]'),
  track: brief('.control-track'), slider: brief('.control-slider-img'),
  battery00: brief('.battery[data-player="0"][data-line="0"]'),
  protoHolder00: brief('.protocol-cell[data-player="0"][data-line="0"] .protocol-holder'),
  slot00: brief('.stack-slot[data-player="0"][data-line="0"]'),
  stack0: brief('.stack'), fieldCard0: brief(isNet ? '.net-lane-band .stack .card' : '.stack .card'),
  handCard0: brief('.hand .card'),
  board: brief('.board'),
  replayBar: brief('[data-role="replay-bar"]'),
  replayShield: brief('[data-role="replay-shield"]'),
};

/* ==========================================================================
 * I. 重放页（G4 T6，第五道门禁第 4 场景）：控制条 + **遮罩真的挡住棋盘**
 *
 * 为什么这一段的判据是"真解算出来的几何 + 命中测试"而不是读 CSS：
 * T3 的判据 9 只能是**文本腿**（DOM 桩不模拟布局、不做命中测试、没有 stacking context，
 * 见 `styles-replay.css` 末尾那段）。CSS 里写着 `z-index:12500` 不等于**浏览器真的让遮罩在最上面**
 * —— 只有 `elementFromPoint` 能回答"这一点上谁在最上面"。这一段就是那句话的落地：
 * 既钉"遮罩的矩形覆盖棋盘矩形"，也钉"在棋盘中心/卡面上问浏览器 → 命中的是遮罩"。
 *
 * ⚠️ 本段**不读被测页面的 CSS 声明**（那是 T3 那条腿的事），只读几何、文本与命中结果。
 * ======================================================================== */
if (isReplay) {
  const board = document.querySelector('.board');
  const boardRect = rectOf(board);
  const barVp = rectOf(replay.bar);
  const vp = out.viewport;
  // 诊断行：**固定输出**（不管判据红绿都打印），用于"这条判据为什么红"的可复查性。
  // 尤其是板根比视口高这件事（`.board` 会随盘面内容长高）——遮罩 `inset:0` 只覆盖视口，
  // 屏幕外那一段它**物理上盖不住**；把两个 rect 与视口并排打出来，一眼可辨是"覆盖判据写错了"
  // 还是"页面真的有内容在视口外"。
  if (boardRect) {
    const offscreen = {
      below: px(Math.max(0, boardRect.bottom - vp.h)),
      above: px(Math.max(0, 0 - boardRect.top)),
      right: px(Math.max(0, boardRect.right - vp.w)),
      left: px(Math.max(0, 0 - boardRect.left)),
    };
    out.notes.push(`板根 vs 视口：.board 高 ${boardRect.height}px / 视口高 ${vp.h}px ⇒`
      + ` 底部越出视口 ${offscreen.below}px、顶部 ${offscreen.above}px、右侧 ${offscreen.right}px、左侧 ${offscreen.left}px`
      + `（遮罩是 \`position:fixed; inset:0\` ⇒ 它只覆盖**视口**；屏幕外那段任何 fixed 遮罩都盖不住）`);
  }
  /* ── 板根是否存在（后面所有几何判据都挂在它上面） ── */
  if (boardRect) {
    item('replay.board.exists', '热座板根 `.board` 存在且有尺寸（**重放页的主区选择器 = `.board`**，'
      + '即 `render.ts:5098` 的 `el(\'div\',\'board\')`：它装着板网格与两侧手牌区；'
      + '不含底部 `.action-bar` 与 `.replay-bar` 这两个固定层）',
      0, boardRect.width > 0 && boardRect.height > 0 ? 0 : 1,
      'dom:.board 的 getBoundingClientRect（选择器出处 render.ts:5098；styles.css 只给 .board-grid/.board-enter .board 写规则）', null);
  } else {
    out.warnings.push('I 段：重放场景里找不到 `.board`（renderApp 没有画出板根？）');
  }
  item('replay.bar.inViewport', '控制条**真的落在视口内**（四条边都在 [0,视口宽/高] 内，违反边数 = 0）',
    0, barVp ? [barVp.left, barVp.top, barVp.right, barVp.bottom]
      .filter((v, i) => (i < 2 ? v < 0 : v > (i === 2 ? vp.w : vp.h))).length : null,
    'dom:[data-role="replay-bar"] 的 getBoundingClientRect vs window.innerWidth/Height'
    + '（**M1 的牙**：内联 `top:-400px` 注入后这条必红）', null);

  /* ── 控制条与板根的几何：**只报数**（本仓的固定底条模式必然压在棋盘上） ──
   * ⚠️ 为什么这里不是硬判据（T6 评审的改判，理由必须写下来，免得下一个人以为在放宽判据）：
   * 本仓**既有的做法就是"固定底部工具条压在棋盘上"** —— `styles.css:1154` 的
   * `.action-bar { position: fixed; left: 50%; bottom: 18px; z-index: 200 }` 就是热座页的行动条；
   * 而 `.board` 的高度由盘面内容决定（本帧实测 1484px > 视口 1305px）。棋盘占满视口时，
   * **任何**固定底条都必然与板根 rect 相交 ⇒ "不重叠"不是这个屏能承重的不变式。
   * 真正承重的是下面两条：`replay.bar.inViewport`（控制条本身要在视口里）与
   * `replay.bar.aboveShield`（控制条要在**遮罩之上** —— 被自己的遮罩盖住才是真缺陷）。
   * 这一项保留为**只报数 + 基线**：9px 是今天的实测值，将来它突然变成几百 px 时人看得出来。 */
  if (boardRect && barVp) {
    const ovX = +Math.max(0, Math.min(barVp.right, boardRect.right) - Math.max(barVp.left, boardRect.left)).toFixed(3);
    const ovY = +Math.max(0, Math.min(barVp.bottom, boardRect.bottom) - Math.max(barVp.top, boardRect.top)).toFixed(3);
    item('replay.bar.overlapBoardArea', '控制条与板根 rect 的重叠面积（纵向高度 × 横向宽度）'
      + ' —— **只报数不判定**：固定底条模式的必然结果（`.action-bar` 同款），9px 是本帧基线',
      0, +(ovX * ovY).toFixed(3),
      `dom:两个 rect 求交（板根高 ${boardRect.height}px / 视口 ${vp.h}px；`
      + '判据见 replay.bar.inViewport 与 replay.bar.aboveShield，本项只做**基线记录**）', 1);
    out.items[out.items.length - 1].noteOnly = true;
    out.notes.push(`控制条与板根：纵向重叠 ${ovY}px × 横向 ${ovX}px = ${+(ovX * ovY).toFixed(1)}px²`
      + `（控制条 [${barVp.left}, ${barVp.top}, ${barVp.right}, ${barVp.bottom}]，`
      + `板根 [${boardRect.left}, ${boardRect.top}, ${boardRect.right}, ${boardRect.bottom}]）`
      + ' —— 只报数项，理由见该项的"期望来源"');
  } else if (!barVp) {
    out.warnings.push('I 段：找不到 [data-role="replay-bar"]（后面所有控制条判据都会缺项）');
  }

  /* ── 遮罩盖住**视口**（`position:fixed; inset:0` 的语义） ──
   * ⚠️ **不是**"盖住整个棋盘 rect"：`.replay-shield` 是 `position:fixed; inset:0` ⇒ 它的 rect
   * **恒等于视口**，而 `.board` 比视口高（本帧 1484 > 1305）⇒ "遮罩包含整个棋盘 rect"在任何
   * 实现下都不可能成立（除非把棋盘压进视口，那是改产品）。产品本身没有洞：fixed 层随视口固定，
   * 棋盘在视口外的那一段**本来就点不到**（看不见就点不到），玩家滚下去让它可见时它就落进被
   * 遮罩覆盖的视口里。⇒ 这条换成"遮罩 rect == 视口" + 下面那条**可见范围内的逐点命中**。 */
  const shieldRect = rectOf(replay.shield);
  if (shieldRect && boardRect) {
    const eps = 0.5;
    const uncovered = [
      px(0 - shieldRect.left), px(0 - shieldRect.top),
      px(shieldRect.right - vp.w), px(shieldRect.bottom - vp.h),
    ].filter((d) => d < -eps).length;
    item('replay.shield.coversViewport', '遮罩 rect **等于视口**（`inset:0` 的语义：左右上边 ≤ 0、'
      + '右/下边 ≥ 视口宽/高，越界边数 = 0）',
      0, uncovered,
      'dom:[data-role="replay-shield"] 的 getBoundingClientRect vs window.innerWidth/Height'
      + '（**为什么不是"包含整个 .board rect"**：遮罩是 fixed+inset:0，其 rect 恒等于视口，'
      + '而板根会比视口高 ⇒ 那条判据在任何实现下都不可能成立。见本段头注）', null);
    out.notes.push(`重放页几何：视口 ${vp.w}×${vp.h}；.board = `
      + `[${boardRect.left}, ${boardRect.top}, ${boardRect.right}, ${boardRect.bottom}]（高 ${boardRect.height}px）；`
      + `[data-role="replay-shield"] = [${shieldRect.left}, ${shieldRect.top}, ${shieldRect.right}, ${shieldRect.bottom}]；`
      + `[data-role="replay-bar"] = ${barVp ? `[${barVp.left}, ${barVp.top}, ${barVp.right}, ${barVp.bottom}]` : '(没有)'}`);
  } else {
    out.warnings.push('I 段：找不到遮罩或板根 —— 覆盖判据跳过（这本身就是失败）');
  }

  /* ── ★★ 命中测试：问浏览器"这一点上谁在最上面" ──
   * 这是"不可操作"的**真**证据：`elementFromPoint` 返回**实际接收指针事件**的元素
   * （hit test 走渲染树的层叠顺序），而遮罩没有 `pointer-events:none` ⇒ 它会把棋盘上的
   * 卡牌/按钮全部截获。读 CSS 的 `z-index` 只能证明"我们写了这个数"，这条证明"浏览器照办了"。
   *
   * `shieldOk` 的形态照 T6 评审的要求写成 `node === shield || shield.contains(node)`
   * （**"命中遮罩"与"命中遮罩的后代"是两回事**：今天遮罩没有子节点，但这行不许写成脆弱形态），
   * 并额外接受"从命中点向上能找到 data-role=replay-shield 的祖先"这一形态。 */
  const shieldOk = (hit) => !!hit && (hit === replay.shield
    || replay.shield.contains(hit)
    || hit.closest?.('[data-role="replay-shield"]') === replay.shield);
  const hitAt = (x, y) => {
    const hx = Math.round(x); const hy = Math.round(y);
    let hit = null; let err = null;
    try { hit = document.elementFromPoint(hx, hy); } catch (e) { err = String(e); }
    return {
      hx, hy, err, hit, ok: shieldOk(hit),
      got: hit ? `${hit.tagName.toLowerCase()}${hit.dataset?.role ? `[data-role=${hit.dataset.role}]` : ''}.${String(hit.className).split(/\s+/).slice(0, 2).join('.')}` : '(null)',
      insideBoard: !!(hit && board && (hit === board || board.contains(hit))),
    };
  };
  /** 命中链是不是 `el` 或它的后代（与 `hitAt` 配套）。 */
  const hitAtEl = (h, el) => !!(h && h.hit && el && (h.hit === el || el.contains(h.hit)));
  const centerHit = boardRect ? hitAt(boardRect.cx, boardRect.cy) : null;
  item('replay.shield.overCenter', '棋盘**中心**的 elementFromPoint 命中的是**遮罩**（不是卡牌/按钮）',
    true, centerHit ? centerHit.ok : null,
    `dom:document.elementFromPoint(${centerHit ? `${centerHit.hx}, ${centerHit.hy}` : '—'})`
    + ` ⇒ 实测命中 ${centerHit ? centerHit.got : '—'}（**M2 的牙**：把遮罩压到棋盘之下后这条必红）`, null);
  // 第二个点：选**一张真实的卡**（而不是"另一个碰巧也空的位置"）——
  // 空位置命中的可能是 `.lane-row`，那证明不了"遮罩压得住卡"。
  const cardInBoard = board ? board.querySelector('.stack .card, .hand .card') : null;
  const cardRect = rectOf(cardInBoard);
  const cardHit = cardRect ? hitAt(cardRect.cx, cardRect.cy) : null;
  item('replay.shield.overCard', '**卡面中心**的 elementFromPoint 命中的是**遮罩**，且命中的不是那张卡（也不是它的任何后代）',
    true, cardHit ? (cardHit.ok && !(cardInBoard === cardHit.hit || cardInBoard.contains(cardHit.hit))) : null,
    `dom:板内第一张 \`.stack .card | .hand .card\`（${cardInBoard ? cardInBoard.className : '—'}）的中心点做 elementFromPoint`
    + ` ⇒ 实测命中 ${cardHit ? cardHit.got : '—'}（第二个命中点；比"再挑一个空位置"强，因为钉的是**卡被压住**）`, null);

  /* ── ★★ `replay.shield.blocksBoard`：在**可见范围内**沿棋盘点阵逐点问浏览器 ──
   * 形态（T6 评审指定，比"包含整个 rect"更强）：
   *   · 采样点 = 板根 rect ∩ 视口 rect 上的 **3×3 点阵**（四角 + 四边中点 + 中心，共 9 点）；
   *   · 只统计**落在视口内**的点（遮罩是 `inset:0`，屏幕外它管不着 —— 那不是产品缺陷）；
   *   · 每个点：命中的**必须**是遮罩/其后代，**且不能**是板内元素（卡牌/按钮/`.lane-row` 都算板内）；
   *   · 期望是**采样总数**（恒等比较）⇒ "命中数 == 命中数"那种在采样数变小时会变绿的写法被堵掉。 */
  const visL = Math.max(1, boardRect ? boardRect.left : 0);
  const visT = Math.max(1, boardRect ? boardRect.top : 0);
  const visR = Math.min(vp.w - 1, boardRect ? boardRect.right : 0);
  const visB = Math.min(vp.h - 1, boardRect ? boardRect.bottom : 0);
  let sampled = 0; let shieldHits = 0; let boardHits = 0; const hitsLog = [];
  if (boardRect && visR > visL && visB > visT) {
    for (let i = 0; i <= 2; i += 1) {
      for (let j = 0; j <= 2; j += 1) {
        const x = Math.round(visL + ((visR - visL) * i) / 2);
        const y = Math.round(visT + ((visB - visT) * j) / 2);
        const h = hitAt(x, y);
        sampled += 1;
        if (h.ok) shieldHits += 1;
        if (h.insideBoard) boardHits += 1;
        if (h.err) out.warnings.push(`elementFromPoint(${h.hx},${h.hy}) 抛错：${h.err}`);
        hitsLog.push(`(${h.hx},${h.hy})→${h.got}`);
        // 首个采样点：把**命中链**（命中元素 → body）的层叠事实逐层打出来。
        // 为什么值得固定输出：`elementFromPoint` 的胜负由**层叠上下文**决定，
        // 而"我写了 z-index:400 就应该在上面"是个常见误判（祖先可能自己开了新的层叠上下文）。
        // 这一行让"这条判据为什么绿/红"在没有 devtools 的 headless 里也能读。
        if (hitsLog.length === 1 && h.hit) {
          const chain = [];
          for (let n = h.hit; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            chain.push(`${n.tagName.toLowerCase()}${n.dataset?.role ? `[${n.dataset.role}]` : ''}`
              + `.${String(n.className).split(/\s+/).slice(0, 1).join('')}`
              + `(z=${cs.zIndex},pos=${cs.position},pe=${cs.pointerEvents},vis=${cs.visibility},op=${cs.opacity})`);
          }
          out.notes.push(`首个采样点 (${h.hx},${h.hy}) 的命中链（命中元素 → body）：${chain.join(' → ')}`);
        }
      }
    }
  }
  item('replay.shield.blocksBoard', '在**板根 ∩ 视口**的 3×3 点阵（9 点）上逐点 elementFromPoint：'
    + '命中的是**遮罩**（或其后代）的点数 == 采样点数（**没有任何一点命中板内元素**）',
    sampled, shieldHits,
    `dom:9 个点各自 elementFromPoint —— 实测命中 ${hitsLog.join(' / ')}`
    + `；其中命中的是**板内元素**的有 ${boardHits} 点（**必须是 0**）。`
    + '这条是"不可操作"的真证据（**M2 的牙**：把遮罩压到棋盘之下后必红）', null);
  out.notes.push(`遮罩逐点命中：采样 ${sampled} 点（板根∩视口的 3×3 端点点阵），`
    + `命中遮罩 ${shieldHits} 点、命中板内元素 ${boardHits} 点 ⇒ ${hitsLog.join(' / ')}`);

  /* ── 文本形态：进度 / 只读说明 / 控制条自身可点（否则"遮罩之上"没有意义） ── */
  const progEl = replay.bar.querySelector('[data-role="replay-progress"]');
  const progText = progEl ? progEl.textContent : null;
  const total = replay.archive.actions;
  item('replay.progress', `data-role="replay-progress" 的文本**形态** == \`N / M\`（N = 已重放步数、M = 档案总步数）`,
    `${REPLAY_AT} / ${total}`, progText,
    'dom:[data-role="replay-progress"].textContent vs 探针自己的 position/total（两者都由生产函数给出）', null);
  const noteEl = replay.bar.querySelector('[data-role="replay-readonly-note"]');
  const noteText = noteEl ? String(noteEl.textContent).trim() : null;
  item('replay.readonlyNote', 'data-role="replay-readonly-note" **存在且非空**（D3：不可操作必须看得见）',
    true, noteEl ? noteText.length > 0 : null,
    'dom:该节点的存在性 + textContent 非空（T3 的 `READONLY_NOTE` 是唯一出处；这里不重复那句话的字面量）', null);
  /* ── 控制条**自己**在遮罩之上：这才是"玩家点得到退出/单步"的真证据 ──
   * 在控制条中心**以及每个控件中心**逐点问浏览器：命中的必须是控制条或其后代。 */
  const barPoints = [];
  if (barVp) {
    barPoints.push({ what: '控制条中心', x: Math.round(barVp.cx), y: Math.round(barVp.cy) });
    for (const b of Array.from(replay.bar.querySelectorAll('button'))) {
      if (b.offsetWidth === 0 && b.offsetHeight === 0) continue;
      const r = rectOf(b);
      barPoints.push({ what: `按钮「${String(b.textContent).slice(0, 8)}」中心`, x: Math.round(r.cx), y: Math.round(r.cy) });
    }
  }
  let barHitOk = 0;
  const barLog = [];
  for (const p of barPoints) {
    const h = hitAt(p.x, p.y);
    const ok = hitAtEl(h, replay.bar);
    if (ok) barHitOk += 1;
    barLog.push(`${p.what}(${h.hx},${h.hy})→${h.got}${ok ? '' : ' ✗'}`);
  }
  item('replay.bar.aboveShield', '控制条中心**与每一个控件中心**的 elementFromPoint 命中的都是'
    + '**控制条或其后代**（不是遮罩）—— 命中点数 == 探测点数',
    barPoints.length, barPoints.length === 0 ? null : barHitOk,
    'dom:控制条中心 + 全部可见 `<button>` 中心逐点 elementFromPoint（控制条必须在自己的遮罩**之上**，'
    + '否则玩家连"退出重放/单步"都点不动）⇒ ' + barLog.join(' / '), null);
  // 反空转：遮罩必须**真的**有尺寸，否则"覆盖/命中"两条都是在比两个空盒子
  item('replay.shield.hasSize', '遮罩有真实尺寸（宽高都 > 0）—— 反空转：0×0 的遮罩会让上面几条假绿',
    0, rectOf(replay.shield) && rectOf(replay.shield).width > 0 && rectOf(replay.shield).height > 0 ? 0 : 1,
    'dom:遮罩的 getBoundingClientRect 宽高（`position:fixed; inset:0` 在视口里的真解算值）', null);
}

/* ── 多宽度矩阵（人看的表）：每档一行，给报告直接引用 ── */
if (!isNet) {
  const row = document.querySelector('.lane-row');
  const cell = document.querySelector('.protocol-cell');
  const pimg = document.querySelector('.protocol-img');
  const st = document.querySelector('.lane-row[data-line="1"] .stack-slot');
  const cards = st ? [...st.querySelectorAll('.card')] : [];
  const cs = row ? getComputedStyle(row) : null;
  const sc = st ? getComputedStyle(st) : null;
  const span = cards.length >= 2
    ? cards[cards.length - 1].getBoundingClientRect().right - cards[0].getBoundingClientRect().left
    : null;
  const chrome = sc
    ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      .reduce((n, k) => n + (Number.parseFloat(sc[k]) || 0), 0) : null;
  out.matrix = {
    viewportW: window.innerWidth,
    contentW: row ? row.clientWidth : null,
    laneRowScroll: row ? row.scrollWidth : null,
    tracks: cs ? cs.gridTemplateColumns : null,
    cardH: document.querySelector('.stack')
      ? px(getComputedStyle(document.querySelector('.stack')).getPropertyValue('--card-h')) : null,
    protoCell: cell ? cell.offsetWidth : null,
    protoImg: pimg ? pimg.offsetWidth : null,
    protoVisible: pimg ? pimg.offsetWidth > 0 : false,
    span7: span === null ? null : +span.toFixed(1),
    span7Incl: span === null || chrome === null ? null : +(span + chrome).toFixed(1),
    pageHScroll: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
}

document.getElementById('__probe').textContent = JSON.stringify(out);
document.title = 'probe-done';
