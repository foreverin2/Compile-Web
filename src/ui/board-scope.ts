/**
 * ★★ 2026-10-06（**用户报的缺陷**）：「玩法里的场上持续特效（冰1 / 死板7 那一族）在
 * 上下滑动或缩放一下屏幕之后就消失了，也不再跟着卡牌走」。**"这一屏的棋盘是哪一份局面"
 * 的声明口（全仓唯一出处）**。
 *
 * ## 它修的是什么（先复现，再修）
 *
 * `src/ui/render.ts` 里那一批**常驻 FX 层**（黑烟 / 能量扫描线 / 念能粒子 / 瘟疫浓雾 /
 * 冷漠灰雾与马赛克 / 灵魂0·1 / 金属0·1·2·6 / 明镜0 / 透彻0 / **寒冰 ice-1·4·6** /
 * 迷雾2 / 恐惧0 / 战争 / 多元3）以及 `gen3-control.ts` 的 3 代常驻层（嫉妒0 / 暴怒0 /
 * 怠惰0 / 惰性0·1 / **死板7** / 色欲 / 贪婪1）全是 body 级 `position: fixed` 层：
 * 坐标只在同步那一刻按节点实测矩形算一次，**层跨重渲染存活、由 sync 函数按状态增删**。
 *
 * 它们的"同步"由**两处**发起，而这两处**喂的局面不是同一份**：
 *  1. 渲染器每一帧（`render.ts` 的 `renderBoard` 末尾）——喂的是**这一帧画的那份局面**；
 *  2. `main.ts` 的滚动/缩放 rAF（`syncPersistentFx`）——原来喂的是**主循环自己那份
 *     `state`**。
 *
 * 热座 / 远程页 / 重放页上 (1)(2) 是**同一个对象**，所以一直没暴露问题。但教学屏
 * （`tutorial-screen.ts`）画的是**它自己那份受控局面**（`buildLevelState()`），与主循环那份
 * `state` 毫无关系 ⇒ 教学里**一滚动**，第 (2) 处就按一份**不相干的局面**把所有常驻层重算：
 *  - 教学屏那些键（`rig7-<uid>`、`ice1-<owner>-<line>` …）在新局面的 active 集合里当然没有
 *    ⇒ prune 分支把它们**当场移除**（就是用户看到的"滑一下特效就没了"）；
 *  - 同一趟还会**凭空建层**：外来局面里恰好生效、而卡牌节点不在这一屏上的键照样被 get-or-create
 *    建出来（子件按签名无条件 append）⇒ 与本局无关的装饰。
 *
 * 逐一量过（`tests/ui/gen3-persistent-scope.test.ts` 与真机 CDP 读数）：教学屏里命中这一族的
 * 是 **T12 的死板7 护壁** 与 **T11 的 ice-1 线冻结**（其余 13 关在滚动那一趟前后层集合不变）。
 *
 * ## 判据 / 契约
 *
 *  - `setBoardState(s)`：**画那一屏的人**声明"这一屏的棋盘 = 这一份局面对象"（身份比较）。
 *    调用点只有教学屏（`openLevel()` 设、`close()` 撤成 `null`）。
 *  - `boardStateOf(s)`：滚动/缩放那一趟拿它换掉自己手里那份局面。**没声明时逐字返回入参**
 *    ⇒ 热座 / 远程页 / 重放 / 起始屏的行为是**改动前的行为**（构造性的零变化）。
 *
 * ## 与 3 代那条声明口的关系
 *
 * `gen3-control.ts` 2026-10-06 先落过一份**同一个东西**的私有实现（`boardState` + 它自己的
 * `setGen3BoardState`），只够得着 `syncGen3Persistent` 一条路 —— `render.ts` 那一族的 prune
 * 写在红线文件里，够不着，所以冰1 当时仍是坏的。现在这一份是**全仓唯一出处**：
 * `gen3-control.ts` 与 `main.ts` 都从这里读，两条路同一个判据，不会各漂一份。
 */

import type { GameState } from '../core/models/types';

let declared: GameState | null = null;

/**
 * 声明"这一屏的棋盘 = 这一份局面"。
 *
 * 传 `null` = **撤销声明**（回"谁都不声明"的状态：滚动/缩放那一趟用主循环自己那份 `state`）。
 * 返回值给测试与排查用（返回设置后的值）。
 *
 * ⚠️ 声明与撤销必须**成对**，且都由画那一屏的人负责：
 * 留着不撤 = 主循环（热座/远程页那一路）所有常驻层同步被替换成"那一份早已下线的局面"。
 */
export function setBoardState(s: GameState | null): GameState | null {
  declared = s;
  return declared;
}

/** 当前声明的棋盘局面（`null` = 没人声明）。**只给测试与排查读**，生产代码用 `boardStateOf`。 */
export function declaredBoardState(): GameState | null {
  return declared;
}

/**
 * **滚动/缩放那一趟该用哪一份局面**：有人声明了这一屏的棋盘就用它，否则用主循环自己那份。
 *
 * 这一句就是本次修法的全部：把"喂错局面"改成"喂这一屏正在画的那份"。热座 / 远程页 /
 * 重放页没人声明 ⇒ 逐字返回入参 ⇒ 那些页面的行为一个字节都没变。
 */
export function boardStateOf(main: GameState): GameState {
  return declared ?? main;
}

/** 这一份局面是不是"本屏正在画的棋盘"（没人声明时恒 `true` —— 与改动前口径一致）。 */
export function isBoardState(s: GameState): boolean {
  return declared === null || s === declared;
}
