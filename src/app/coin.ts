/**
 * 硬币规则与面映射的**单一出处**（G5 T11-A）。
 *
 * ## 它为什么住在 `src/app`
 *
 * 两处都要用同一套规则：热座那条路在屏上（`src/ui/home.ts` 的 `renderCoin`），
 * 联机那条路在握手内部（`src/ui/net-lobby.ts` / 段 B 的 app 回填）。
 * 而 `.superpowers/g5-plan/tasks/T11.md` §4 要的是"硬币落点、胜负规则、面映射收进一处"——
 * 放在两端都能 import 的那一层（`app`）才不会让 `ui` 之间互相依赖。
 *
 * 本模块**纯**：只 import `src/core`，不碰浏览器 API、不取随机、不读时钟。
 *
 * ## 口径（两套编号，别混）
 *
 *  - **屏上**：`CoinSide = 1 | 2`（`home.ts` 的 `COIN_FACES`：1 = 正面、2 = 反面）；
 *  - **会话层**：`face: 0 | 1`（`session.ts:1963` 把面写成 `String(face)` 进哈希）。
 *
 * 这两套之间的换算**只此一处**（`sideFromFace` / `faceFromSide`）。
 */

import type { PlayerId } from '../core/models/types';
import { deriveInt } from '../core/rng';

/**
 * 屏幕上的币面（与 `src/ui/home.ts` 的芯片同口径：1 = 正面、2 = 反面）。
 *
 * 不写成 `'heads' | 'tails'`：屏上已经用 `1 | 2` 了，改一套新名字只会多一层对照表。
 */
export type CoinSide = 1 | 2;

/**
 * 落点：由种子派生出的那一面。
 *
 * ★ 这行式子**逐字**是旧屏上那句（`src/ui/home.ts` 搬迁前的 `:425`）：
 * `deriveInt(seed, 'coin', 2) === 0 ? 1 : 2`。**只搬家、不改值** ——
 * 改一个字符，热座既有局面与 `tests/determinism/openings.test.ts` 的种子就会跟着变。
 */
export function coinLanding(seed: string): CoinSide {
  return deriveInt(seed, 'coin', 2) === 0 ? 1 : 2;
}

/**
 * 叫面者（`caller`）叫 `chosen`、种子派生出的落点是 `coinLanding(seed)` 时的**先选协议者**。
 *
 * 规则（用户 2026-09-03 需求）：叫中 ⇒ 叫面者先选协议；叫错 ⇒ 另一方先选。
 * 出牌方由 `main.ts` 另算：`firstToPlay = 1 - draftStarter`（那条式子不在本模块里）。
 *
 * ★ 为什么"叫中才算"必须真的用 `coinLanding` 比一次：热座那条路今天把这两件事写在同一屏上
 * （`landed === chosen ? 0 : 1`），联机那条路两端各自算一次 —— 只要有一端写成"永远 caller"，
 * 两端就会各自认为自己先选，而屏上看起来都正常。
 */
export function draftStarterFor(caller: PlayerId, chosen: CoinSide, seed: string): PlayerId {
  return coinLanding(seed) === chosen ? caller : ((1 - caller) as PlayerId);
}

/** 会话层的面（`0 | 1`）→ 屏上的面（`1 | 2`） */
export function sideFromFace(face: 0 | 1): CoinSide {
  return face === 0 ? 1 : 2;
}

/** 屏上的面（`1 | 2`）→ 会话层的面（`0 | 1`） */
export function faceFromSide(side: CoinSide): 0 | 1 {
  return side === 1 ? 0 : 1;
}
