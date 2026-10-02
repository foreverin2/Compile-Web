/**
 * ★ 2026-10-02（P2，用户口径）：**教学模式的关卡数据**（T0~T3）。
 *
 * 方案：`docs/2026-10-01-新手引导与教学-方案.md` §5.1（形态：真实引擎 + 脚本化关卡 + 教练浮层）、
 * §5.2 那张关卡表、§7 的 P2 行。用户 2026-10-01 拍板"先做 T0~T3，验收后再补 T4~T9"。
 *
 * ## 这一层是什么 / 不是什么
 *
 * **是**：关卡数据的**唯一出处**（每关教什么、要玩家做什么、判定什么、走偏说什么）。
 * **不是**：不碰 DOM（屏在 `src/ui/tutorial-screen.ts`）、不碰存储（进度在 `progress.ts`）、
 * 不碰引擎（受控局面的布置在 `setup.ts`，判定在 `judge.ts`）。
 *
 * ## 文案为什么是**函数**而不是"键字符串"
 *
 * 第一版把文案写成 `titleKey: 'tutorial.T0.title'`，由屏去 `t(level.titleKey)` —— 那样
 * `t()` 的实参是**动态的**，会被 `tests/i18n/tables.test.ts` 的"不许有动态键"腿与
 * `tests/tutorial/screen.test.ts` 的同类腿当场判红（缺键扫描器看不见这类调用 ⇒ 等于漏翻的温床）。
 * ⇒ 改成**取值函数**：`title: () => t('tutorial.T0.title')`，
 * **每一个 `t()` 的实参都是字面量**（扫描器看得见、死键腿也看得见），而"按关卡取文案"这件事照样成立。
 */
import { t } from '../i18n';
import type { TutLevelId, TutSpot, TutOp } from './types';

/**
 * 关卡定义。
 *
 * ⚠️ `teach` 是**逐句显示**的讲解（方案 §5.2 的"讲解文案（数组，逐句显示）"），
 * 不是一段长文：教练浮层一次显示一句、玩家点"继续"往下走。
 */
export interface TutLevel {
  readonly id: TutLevelId;
  /** 关卡标题（教练浮层顶部） */
  readonly title: () => string;
  /** 本关目标一句话（永远显示在浮层里，玩家随时能看） */
  readonly goal: () => string;
  /** 逐句讲解 */
  readonly teach: readonly (() => string)[];
  /**
   * T0 专用：要点一遍的**四个区域**（链路 / 协议 / 阈值 / 控制权）。
   *
   * ⚠️ 方案 §5.2 那一行写的是"依次点高亮的**三个**区域"，但它自己列的概念是**四个**
   * （链路 / 协议 / 阈值 / 控制权）⇒ 这一轮按**四个**做（用户口径优先），
   * 并在方案 §7.8 里把这条差异写清楚（不是偷偷改了方案）。
   */
  readonly spots?: readonly TutSpot[];
  /**
   * T1~T3：**只放行**的动作种类（`UiCallbacks.onAction` 的拦截白名单）。
   *
   * ⚠️ 这是"只放行"的落点：引擎（`core/**`）与渲染器（`render.ts`）都是红线、不许改，
   * 所以本屏**自己**持有 `cb`：不在白名单里的动作**不提交**、只给一句走偏提示
   * —— 见 `judge.ts` 的 `offTrackKeyFor`。代价写在方案 §7.8。
   */
  readonly allowKinds: readonly string[];
  /** T3 专用：本关要集齐的五个动作签名（顺序无所谓） */
  readonly ops?: readonly TutOp[];
}

/** 四关。**顺序就是玩的顺序**（"当前关"按这个数组的序号推） */
export const TUT_LEVELS: readonly TutLevel[] = [
  {
    id: 'T0',
    title: () => t('tutorial.T0.title'),
    goal: () => t('tutorial.T0.goal'),
    teach: [
      () => t('tutorial.T0.teach.0'),
      () => t('tutorial.T0.teach.1'),
      () => t('tutorial.T0.teach.2'),
      () => t('tutorial.T0.teach.3'),
    ],
    spots: ['link', 'protocol', 'threshold', 'control'],
    // T0 只认"点高亮区域"，一个引擎动作都不放行（这一关不看牌，只看界面）
    allowKinds: [],
  },
  {
    id: 'T1',
    title: () => t('tutorial.T1.title'),
    goal: () => t('tutorial.T1.goal'),
    teach: [
      () => t('tutorial.T1.teach.0'),
      () => t('tutorial.T1.teach.1'),
      () => t('tutorial.T1.teach.2'),
    ],
    // 只放行"打出手牌"：编译与应答选择在这一关用不到
    allowKinds: ['play'],
  },
  {
    id: 'T2',
    title: () => t('tutorial.T2.title'),
    goal: () => t('tutorial.T2.goal'),
    teach: [
      () => t('tutorial.T2.teach.0'),
      () => t('tutorial.T2.teach.1'),
      () => t('tutorial.T2.teach.2'),
    ],
    // 正反两面都要打：仍然只有"打出手牌"
    allowKinds: ['play'],
  },
  {
    id: 'T3',
    title: () => t('tutorial.T3.title'),
    goal: () => t('tutorial.T3.goal'),
    teach: [
      () => t('tutorial.T3.teach.0'),
      () => t('tutorial.T3.teach.1'),
      () => t('tutorial.T3.teach.2'),
      () => t('tutorial.T3.teach.3'),
    ],
    // 打出手牌 + 应答选择浮层（五个动作全靠"打出教学卡 → 引擎弹出选择"这条真链路）
    allowKinds: ['play', 'effect-choice'],
    ops: ['flip', 'shift', 'draw', 'discard', 'return'],
  },
];

/** 按 id 取关卡（找不到当场抛：调用方给的是 `TutLevelId`，找不到就是代码写错了） */
export function levelById(id: TutLevelId): TutLevel {
  const found = TUT_LEVELS.find((l) => l.id === id);
  if (found === undefined) throw new Error(`unknown tutorial level: ${id}`);
  return found;
}

/** 关卡序号（0 起）——进度里存的是它 */
export function levelIndex(id: TutLevelId): number {
  const i = TUT_LEVELS.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`unknown tutorial level: ${id}`);
  return i;
}

/** 序号 → 关卡 id（越界钳到两端：通关之后再进教学停在最后一关，而不是崩） */
export function levelAt(index: number): TutLevelId {
  const i = Math.max(0, Math.min(TUT_LEVELS.length - 1, Math.trunc(index)));
  return TUT_LEVELS[i].id;
}

/** 四个热点的稳定顺序（T0 的判据"四个都点过"按它算，免得受点击顺序影响） */
export const TUT_SPOTS: readonly TutSpot[] = ['link', 'protocol', 'threshold', 'control'];
