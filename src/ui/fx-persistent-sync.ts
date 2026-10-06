/**
 * ★★ 2026-10-06（**用户报的缺陷**）：「场上持续特效（冰1 / 死板7 那一族）上下滑动或缩放一下
 * 屏幕之后就消失了，也不再跟着卡牌走」。**常驻 FX 层的滚动/缩放重定位清单——全仓唯一一份**。
 *
 * ## 这些层是什么、原来错在哪
 *
 * 下面 22 条 sync 管的都是 `position: fixed` 的 body 级常驻层：坐标只在同步那一刻按节点实测
 * 矩形算一次，而"层该不该在"由**状态判据**决定（`syncIceFx` 的收尾、`gen3-control.ts` 的
 * `pruneAll` 都是"本帧 active 集合里没有它就移除"）⇒ 喂错局面 = **当场把别人的层删掉**。
 *
 * 同步由**两处**发起，2026-10-06 之前两处喂的局面**不是同一份**：
 *  1. 渲染器每一帧（`render.ts` 的 `renderBoard` 末尾）——喂**这一帧画的那份局面**（对）；
 *  2. `main.ts` 的滚动/缩放 rAF ——原来喂**主循环自己那份 `state`**（错）。
 *
 * 热座 / 远程页 / 重放页上两者是同一个对象，所以一直没暴露；**教学屏画的是它自己那份受控局面**
 * （`tutorial-screen.ts` 的 `buildLevelState`），与主循环那份毫无关系 ⇒ 教学里一滚动，
 * 第 (2) 处就按一份不相干的局面把教学屏的层 `remove()` 了。实测命中：**T12 的死板7 护壁**
 * 与 **T11 的 ice-1 线冻结**（其余 13 关层集合不变）。
 *
 * ## 本模块的形状（为什么是这个形状）
 *
 *  - `syncPersistentFx(s)`：清单 + 顺序**逐字**取自 `render.ts` 的 `renderBoard` 尾部
 *    （`tests/ui/net-preview-wiring.test.ts` 有一条生成式守卫盯着两边一致）；
 *  - **局面由调用方传进来**：主循环传 `boardStateOf(state)`（`./board-scope` 的声明口，
 *    教学屏声明过就用教学那份），教学屏传**它自己那份**。⇒ 这一处不可能再"喂错局面"，
 *    因为它自己没有局面可喂。
 *
 * ⚠️ 为什么独立成模块、而不是住在 `main.ts`：`main.ts` 是**装配层**（模块顶层就
 * `document.getElementById('app')`），UI 模块 import 它会把浏览器专用代码拖进
 * "无 jsdom 的 node 测试"里 —— 实测 `tests/ui/gen3-persistent-scope.test.ts` 与
 * `tests/tutorial/screen.test.ts` 三个套件当场 `ReferenceError: document is not defined`。
 * 所以清单搬到这里（它是 UI 层的知识），`main.ts` 与教学屏都从这里拿。
 */

import type { GameState } from '../core/models/types';
import {
  syncCompiledFxLayers, syncSmokeOverlays, syncScanOverlays, syncPsychicParticles, syncPlagueMists,
  syncApathyMists, syncApathyMosaics, syncSpirit0Glows, syncSpirit1Cards, syncMetal0Glows, syncMetalPlates,
  syncMetal6Mans, syncMetal1LineGlows, syncMirror0BatteryGlows, syncClarity0BatteryGlows, syncIceFx,
  syncSmoke2LineGlows, syncFear0TriGlows, syncWarBlades, syncDiversity3Fx, syncChainLayerPosition,
} from './render';
import { syncGen3Persistent } from './gen3-control';
import { syncFollowers } from './fx-follow';

/**
 * 按 `s`（= **这一屏正在画的那份局面**）把全部常驻 FX 层重定位一遍，并把条件已消失的层收掉。
 *
 * 幂等且廉价（只读 rect + 写坐标），所以可以在每次 scroll/resize 的 rAF 里无脑调。
 * 顺序与 `render.ts` 渲染那一趟**逐字同序**（先 compiledFx 环、再各协议族、再 3 代、
 * 最后 follow 注册表 + 锁链）——顺序在这里是承重的：`syncFollowers()` 依赖各层已就位。
 */
export function syncPersistentFx(s: GameState): void {
  syncCompiledFxLayers();
  syncSmokeOverlays(s);
  syncScanOverlays(s);
  syncPsychicParticles(s);
  syncPlagueMists(s);
  syncApathyMists(s);
  syncApathyMosaics(s);
  syncSpirit0Glows(s);
  syncSpirit1Cards(s);
  syncMetal0Glows(s);
  syncMetalPlates(s);
  syncMetal6Mans(s);
  syncMetal1LineGlows(s);
  syncMirror0BatteryGlows(s);
  syncClarity0BatteryGlows(s);
  syncIceFx(s);
  syncSmoke2LineGlows(s);
  syncFear0TriGlows(s);
  syncWarBlades(s);
  // 2026-09-13（审计补漏）：多元3 卡面框光/能量槽流光的同步此前**只在 renderApp 里调用**
  // → 滚动/缩放（以及胜利后不再渲染）时这两个 body 级 fixed 层会粘在陈旧视口坐标
  // （与用户实测的"特效粘在屏幕上"同一类 bug）。
  syncDiversity3Fx(s);
  syncGen3Persistent(s); // 3代（批次 D）常驻层随滚动/缩放重定位
  syncFollowers(); // 长寿命 FX（>1.5s 的卡框光/落点光）随滚动/缩放跟随
  syncChainLayerPosition();
}
