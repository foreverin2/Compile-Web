/**
 * ★ 2026-10-06（用户要求）：「英文模式下，协议的座右铭要变成它卡面上对应的那句」。
 *
 * ## 数据来源（**唯一出处，别手抄**）
 *
 * 正版素材里的英文协议表：
 * `E:\studyE\compile\正版compile\看起来没什么用的卡牌json数据\compile-main\compile-main\protocols.json`
 * —— 每套协议一条 `{ protocol, top, bottom, set }`，其中：
 *  - `protocol` → 本文件 `name`（卡面上的英文协议名，如 Water / Rigid）；
 *  - `top` → 本文件 `motto`（**卡面顶部那句座右铭**，如 `Wash away and renew`）；
 *  - `bottom` → 本文件 `keywords`（卡面底部那行关键词，如 `Return, Draw, Flip`，按 `', '` 拆开）。
 *
 * 45 套与本仓 `ALL_PROTOCOLS`（`src/data/cards{,2,3}.ts`，各 15 套）**逐条一一对应**
 * （核过：无多、无缺、无重名；三个 defId 与英文名不同形，已在生成脚本里映射：
 * Flexible→`flexibility`、Inert→`inertia`、Rigid→`rigidity`）。
 *
 * ⚠️ 这里是**显示用**的英文串，不进引擎、不改 `src/data/**` 那份中文事实表：
 * 中文模式下一律走原来的 `proto.name` / `proto.loadingText` / `proto.commands`
 * （见 `src/ui/protocol-text.ts` 的三个助手 —— 取哪一份只有那一处判）。
 */
export interface ProtocolEn {
  /** 卡面上的英文协议名（Water / Rigid / …） */
  readonly name: string;
  /** 卡面顶部那句座右铭（Wash away and renew） */
  readonly motto: string;
  /** 卡面底部那行关键词（Return / Draw / Flip） */
  readonly keywords: readonly string[];
}

/** defId → 英文显示串（45 套齐全） */
export const PROTOCOL_EN: Readonly<Record<string, ProtocolEn>> = {
  apathy: { name: 'Apathy', motto: 'Uncaring, unfeeling', keywords: ['Flip Face-Down'] },
  hate: { name: 'Hate', motto: 'Ultimate disdain', keywords: ['Delete theirs and yours'] },
  love: { name: 'Love', motto: 'Giving is the true gift', keywords: ['Draw', 'Gift', 'Exchange'] },
  assimilation: { name: 'Assimilation', motto: 'Complete exchange and understanding', keywords: ['Exchange', 'Play'] },
  diversity: { name: 'Diversity', motto: 'Our differences are our strength', keywords: ['Play', 'Compare', 'Covered'] },
  unity: { name: 'Unity', motto: 'Together we are strong', keywords: ['Cover', 'Flip', 'Compile'] },
  darkness: { name: 'Darkness', motto: 'An absence of light', keywords: ['Draw', 'Shift', 'Manipulate'] },
  death: { name: 'Death', motto: 'Nothing shall survive', keywords: ['Delete', 'Draw'] },
  fire: { name: 'Fire', motto: 'Burn at both ends', keywords: ['Discard for effect'] },
  gravity: { name: 'Gravity', motto: 'Draw ever inward', keywords: ['Shift', 'Flip', 'Draw'] },
  life: { name: 'Life', motto: 'Bring about new growth', keywords: ['Flip', 'Top Deck Play', 'Draw'] },
  light: { name: 'Light', motto: 'Burn away the dark', keywords: ['Draw', 'Flip', 'Shift'] },
  metal: { name: 'Metal', motto: 'Hardened against all', keywords: ['Prevent', 'Draw', 'Flip'] },
  plague: { name: 'Plague', motto: 'Slow death from within', keywords: ['Force Discard', 'Flip'] },
  psychic: { name: 'Psychic', motto: 'Know your foe\'s mind', keywords: ['Draw', 'Manipulate', 'Shift'] },
  speed: { name: 'Speed', motto: 'Quicken with every step', keywords: ['Draw', 'Play', 'Shift'] },
  spirit: { name: 'Spirit', motto: 'True strength from within', keywords: ['Flip', 'Shift', 'Draw'] },
  water: { name: 'Water', motto: 'Wash away and renew', keywords: ['Return', 'Draw', 'Flip'] },
  chaos: { name: 'Chaos', motto: 'Unpredictable Beware', keywords: ['Draw', 'Rearrange', 'Covered'] },
  clarity: { name: 'Clarity', motto: 'I can see my path clearly', keywords: ['Draw', 'Reveal'] },
  corruption: { name: 'Corruption', motto: 'One bad apple spoils the bunch', keywords: ['Flip', 'Discard'] },
  courage: { name: 'Courage', motto: 'A blaze in the face of adversity', keywords: ['Draw', 'Compare'] },
  fear: { name: 'Fear', motto: 'Run away', keywords: ['Shift', 'Discard'] },
  ice: { name: 'Ice', motto: 'Cold, Strong, and Slick', keywords: ['Shift', 'Prevent'] },
  luck: { name: 'Luck', motto: 'Roll the dice', keywords: ['Random', 'Delete', 'Play'] },
  mirror: { name: 'Mirror', motto: 'A Reflection of the truth', keywords: ['Shift', 'Repeat'] },
  peace: { name: 'Peace', motto: 'Respite and solace as long as we can', keywords: ['Mutual Discard', 'Draw'] },
  smoke: { name: 'Smoke', motto: 'A blanket of obfuscation', keywords: ['Face-Down', 'Shift'] },
  time: { name: 'Time', motto: 'Forward to the past', keywords: ['Discard', 'Trash'] },
  war: { name: 'War', motto: 'Raging conflict, but to what end?', keywords: ['React', 'Discard'] },
  ambush: { name: 'Ambush', motto: 'From the shadows', keywords: ['Flip', 'Draw', 'Face-Down'] },
  envy: { name: 'Envy', motto: 'I want what you have', keywords: ['Catch Up', 'Flip'] },
  fulcrum: { name: 'Fulcrum', motto: 'Balanced on a point', keywords: ['Draw', 'Swap', 'Cards In Hand'] },
  gluttony: { name: 'Gluttony', motto: 'More!', keywords: ['Draw', 'Clear Cache', 'Delete'] },
  greed: { name: 'Greed', motto: 'I deserve that', keywords: ['Discard', 'Repeating Effects'] },
  lust: { name: 'Lust', motto: 'Come here', keywords: ['Forced Play', 'Control'] },
  momentum: { name: 'Momentum', motto: 'P = Mass * Velocity', keywords: ['After Compile', 'Draw'] },
  nova: { name: 'Nova', motto: 'Devastating critical mass', keywords: ['Stack Size', 'Shift', 'Rearrange'] },
  overwhelm: { name: 'Overwhelm', motto: 'Everything everywhere all at once', keywords: ['Play Face-Down', 'Win More'] },
  pride: { name: 'Pride', motto: 'Only the best', keywords: ['Stay Ahead', 'Shift', 'Draw'] },
  sloth: { name: 'Sloth', motto: 'Maybe later', keywords: ['Discard', 'Flip'] },
  wrath: { name: 'Wrath', motto: 'Vengeful Anger', keywords: ['Delete', 'Face-Down'] },
  flexibility: { name: 'Flexible', motto: 'Always Fitting', keywords: ['Choice', 'Shift', 'Draw'] },
  inertia: { name: 'Inert', motto: 'Is this thing on?', keywords: ['Negate Face-Up', 'Symmetrical'] },
  rigidity: { name: 'Rigid', motto: 'Stiff and Uncompromising', keywords: ['Play Face-Down', 'Prevent'] },
};
