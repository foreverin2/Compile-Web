/**
 * 「语言」这个值的**纯类型叶子**（★ 2026-10-01，P0）。
 *
 * ## 为什么单独一个文件（这是本仓"依赖方向"的既有口径，不是洁癖）
 *
 * `Lang` / `DEFAULT_LANG` / `LANGS` 这三个东西有两个消费者，且它们在不同的层里：
 *  - `src/app/local-store.ts`：`L1Settings` 的形状与 `readLang()` / `writeLang()`（**纯层**）；
 *  - `src/i18n/index.ts`：`getLang()` / `setLang()` / `t()`（UI 层）。
 *
 * 如果类型写在 `src/i18n/index.ts` 里，`src/app/local-store.ts` 就得 import 它 ——
 * 那会把 UI 层整份（含两张表、含 `?raw` 原文、含 `import.meta.env` 的 dev 分支）
 * 拖进"纯存储层"，而 `tests/app-purity.test.ts` 那套纪律的前提正是
 * **`src/app/**` 不依赖 UI**。反过来把类型写在 `src/app/local-store.ts` 里也不行：
 * 表在那层没有位置。
 *
 * ⇒ 拆出这个**零依赖叶子**：两边都只依赖它，方向是干净的。
 *    它只放"语言有哪几个值、默认哪个、清单长什么样"，**一点行为都不放**
 *    （行为在 `../i18n/index.ts` 与 `src/app/local-store.ts`）。
 */

/**
 * 当前支持的语言（只有这两个；新增语言要同时补 `zh.ts` 同构的一张表与下面这张清单）。
 */
export type Lang = 'zh' | 'en';

/** 默认语言。**中文**：换语言之前的所有行为必须与今天逐字一致 */
export const DEFAULT_LANG: Lang = 'zh';

/**
 * 语言清单的**唯一出处**（设置小窗与宿主都从这里取，不许各写一份）。
 *
 * 标签本身写各自的语言名（`中文` / `English`）：一位只会英文的玩家第一次打开设置时
 * 也得认得出哪个选项是自己要的。
 */
export const LANGS: readonly { readonly id: Lang; readonly label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
];

/** 语言值的形状守卫（存储被外部手改 / 换了版本之后，读到别的值也只当没读过） */
export function isLang(v: unknown): v is Lang {
  return v === 'zh' || v === 'en';
}
