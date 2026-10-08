/**
 * ★ 2026-10-07（用户要求）：首启向导第 2 步那三段**授权正文**的英文显示层。
 *
 * 用户报的缺陷（原话）：「你看，这两个地方有中文没有处理完」（截图 1 = 向导第 2 步那三段正文、
 * 截图 2 = 第 3 步两个按钮）。
 *
 * ## 为什么是"显示层"而不是把中文那份翻掉
 *
 * 中文唯一出处是 `src/app/privacy.ts`（`CONSENT_ALLOW_NOTE` / `PRIVACY_COPY.noServerStorage[0]` /
 * `CONSENT_DENY_NOTE`）：那份是**隐私承诺句的唯一家**，被 `tests/app/privacy.test.ts` 的整句哈希
 * （`COPY_PINS`）与"绝对化措辞"扫描钉着，还有"不许在别处新写一句承诺"的枚举面腿 ⇒ **一个字都不动**。
 * 这里与 `src/i18n/engine-log.ts` / `protocol-en.ts` / `effect-tags-en.ts` 同一套做法：
 * 只在**英文模式**下按位的英文句顶上去，中文模式逐字仍是 `privacy.ts` 的原句。
 *
 * ## 契约
 *
 *  - 三句**逐位对应**中文那三句（顺序不许换：第一句 = 允许之后会存什么、第二句 = 没有后端服务器、
 *    第三句 = 不允许也能玩 + 关掉即全丢）；
 *  - 只做 1:1 的英文转写，**不新增也不减少**任何承诺（多写一句 = 新造承诺，那正是隐私那一族
 *    反复栽过的形态）；
 *  - 调用方（`src/main.ts` 的 `consentBodyLines()`）在**英文模式**取这一份；条数对不上或为空时
 *    由它回退中文（宁可中文，不在屏上留空洞）。
 */

/** 首启向导第 2 步那三段正文的英文（顺序 = `consentBodyLines()` 里中文那三句） */
export const CONSENT_BODY_EN: readonly string[] = [
  'Once you allow it, your nickname, game settings and decks are saved in your own browser '
  + '(you can clear them at any time).',
  'This game has no backend server at all: your nickname, decks and match data are never uploaded, '
  + 'and never stored on anyone else\'s machine.',
  'You can still play everything without allowing it: for this session all the data lives in memory only, '
  + 'and a refresh or closing the page throws it all away.',
];
