/**
 * ★ 2026-10-02（P2）：教学模块的**类型**（叶子，零依赖）。
 *
 * 单独一个文件是为了让"关卡数据 / 受控局面 / 判定 / 进度 / 屏"五块共用同一套名词，
 * 而不互相 import（`types.ts` 不 import 任何东西 ⇒ 谁都能安全依赖它）。
 */

/** 关卡 id（T0~T3；P5 补 T4~T9 时在这里加） */
export type TutLevelId = 'T0' | 'T1' | 'T2' | 'T3';

/** T0 要点一遍的四个界面区域（链路 / 协议 / 阈值 / 控制权） */
export type TutSpot = 'link' | 'protocol' | 'threshold' | 'control';

/**
 * T3 要集齐的五个基础动作的**状态签名**。
 *
 * ⚠️ 它们不是"玩家点了什么按钮"，而是"**状态真的变了什么**"——由 `judge.ts` 对前后两份
 * 快照做差分算出来。理由：引擎与渲染器都是红线（不许改），本屏只能从**状态**反推发生了什么；
 * 而"状态断言"也正是方案 §5.2 那一列的字面要求（"通过判据（状态断言）"）。
 */
export type TutOp = 'flip' | 'shift' | 'draw' | 'discard' | 'return';

/** 进度（存 `L1_SETTINGS.tutorial`，零新增存储键） */
export interface TutProgress {
  /** 已完成关卡的 id（顺序 = 完成顺序，去重） */
  readonly done: readonly TutLevelId[];
  /** 当前关（下次从它继续） */
  readonly current: TutLevelId;
}
