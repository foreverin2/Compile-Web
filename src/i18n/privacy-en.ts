/**
 * ★ 2026-10-07（用户要求）：**完整隐私说明**的英文显示层（`privacyLines()` 那十三段）。
 *
 * 用户原话（选的是"要，现在一并翻"）：「英文模式下「完整隐私说明」仍然是中文 —— 要不要我现在一并翻成
 * 英文？」⇒ 逐句 1:1 转写，**不动中文那份**。
 *
 * ## 中文那一份在哪、为什么一个字都不动
 *
 * 唯一出处是 `src/app/privacy.ts`：`PRIVACY_COPY`（按 `PRIVACY_GROUPS` 顺序由 `privacyLines()` 拍平）
 * + `ONLINE_GATE_MARK`。那份被 `tests/app/privacy.test.ts` 的整句哈希（`COPY_PINS`）、
 * "绝对化措辞"扫描、以及"不许在别处新写一句承诺"的枚举面腿一起钉着 ⇒ 翻译它等于改那份哈希口径
 * （文档里写明要单独裁决）。本轮按既有做法加**显示层**：中文模式逐字仍是 `privacy.ts` 的原句，
 * 只有英文模式换成这一份。同一套先例：`engine-log.ts` / `protocol-en.ts` / `consent-en.ts`。
 *
 * ## 契约（与中文那一份严格对齐）
 *
 *  - **条数、顺序逐位一致**：2（noServerStorage）+ 4（localOnly）+ 2（peerVisible）+
 *    2（offlineCacheNote）+ 3（signalAndRelay）= 13；顺序 = `PRIVACY_GROUPS`；
 *  - **门槛标注**：中文那 6 条带 `ONLINE_GATE_MARK`（「联机功能上线后才适用」），英文这 6 条
 *    逐条带等价的 `PRIVACY_GATE_MARK_EN`（`(applies once online play is live)`）——
 *    漏掉它就是在英文里声称了本阶段玩不到的能力；
 *  - **不新增、不减少任何承诺**：只做 1:1 转写（多写一句 = 新造承诺，那正是隐私这一族反复栽过的形态）。
 *    逐条对应关系由 `tests/i18n/privacy-en-display.test.ts` 的锚点腿钉住。
 */

/** 联机门槛标注的英文（对应中文 `ONLINE_GATE_MARK` = 「（联机功能上线后才适用）」） */
export const PRIVACY_GATE_MARK_EN = '(applies once online play is live)';

/**
 * 十三段英文，顺序 = `privacyLines()`（`PRIVACY_GROUPS` 的声明顺序）。
 *
 * ⚠️ 改这里的任何一句都要同步想一遍中文那一句说的是不是同一件事（反之亦然）；
 * `tests/i18n/privacy-en-display.test.ts` 会钉住条数与顺序，钉不住"意思一样"——
 * 那一条只能靠人读，所以每组都标了它对应中文的哪一组。
 */
export const PRIVACY_LINES_EN: readonly string[] = [
  // ① noServerStorage（2 条）
  'This game has no backend server at all: your nickname, decks and match data are never uploaded, '
  + 'and never stored on anyone else\'s machine.',
  'All rules are resolved on your own device. Even if a server is added later (once online play is live), '
  + 'it only relays data: it never stores your nickname, decks, actions or match data.',

  // ② localOnly（4 条）
  'Your nickname, settings and decks are written into your own browser storage only after you choose '
  + '"Allow" in the consent prompt; before you allow, none of your data is written.',
  'The only thing the browser caches for opening the game offline is the program itself '
  + '(pages, scripts, styles and the install icon). That is not your data, and you can clear it at any time.',
  'You can clear the saved local data in one click at any time under Local data and privacy.',
  'If you choose "No", none of your data is written: for this session the nickname, settings and decks '
  + 'live in memory only, and a refresh or closing the page loses them all.',

  // ③ peerVisible（2 条，都带联机门槛）
  `${PRIVACY_GATE_MARK_EN} Online matches connect two devices directly (P2P): your opponent can see '
  + 'your IP address (a technical necessity of a direct connection), but cannot see your deck files, '
  + 'nor the settings saved on your machine.`,
  `${PRIVACY_GATE_MARK_EN} Your opponent does see your display name: it is exchanged directly over the `
  + 'encrypted channel between the two devices, never through any server, and it is the only thing '
  + 'exchanged — decks, settings and profiles are never sent.',

  // ④ offlineCacheNote（2 条）
  'Once you install the page as an app, the browser pre-caches the program itself '
  + '(pages, scripts, styles and the install icon). After the first successful cache the game opens '
  + 'offline; while that cache is incomplete you still need a connection.',
  'Afterwards, the only things that may enter a runtime cache are assets you have actually visited, '
  + 'such as card images, and that is decided by your browser\'s own cache (it depends on your browser '
  + 'settings): content you have never opened will not load offline the first time. None of that is user '
  + 'data: your nickname, decks, profile and match records are not in the cache.',

  // ⑤ signalAndRelay（3 条，都带联机门槛）
  `${PRIVACY_GATE_MARK_EN} The signaling service sees only the room code, your IP address and the time `
  + 'of connection; it never sees your nickname, decks, actions or match data.',
  `${PRIVACY_GATE_MARK_EN} Online play ships with one relay server by default: when the two ends can `
  + 'connect directly they do, and when a direct connection fails the traffic is relayed. While relaying, '
  + 'the relay can see your IP address, that the two ends are communicating, when, and roughly how much '
  + 'data; but what it forwards are end-to-end encrypted packets: the contents are unreadable and are '
  + 'not stored.',
  `${PRIVACY_GATE_MARK_EN} For online play we first request a relay credential from our server (that `
  + 'request records your IP address and its time), and use it to connect to the relay. The credential '
  + 'is used only for relaying and contains no nickname, decks or match data.',
];

/**
 * 按显示语言取：**中文模式逐字返回传进来的中文**（= `privacyLines()` 的原句）、
 * 英文模式返回上面那一份。条数对不上（数据漂了）时**回退中文** —— 宁可中文，
 * 也不在半屏上少几条承诺。
 *
 * `lang` 由调用方显式传（`getLang()`），与 `engine-log.ts` 的 `engineLogText(raw, lang)` 同款：
 * 纯函数，不读全局态、不碰 DOM。
 */
export function localizedPrivacyLines(zh: readonly string[], lang: 'zh' | 'en'): readonly string[] {
  if (lang !== 'en') return zh;
  return PRIVACY_LINES_EN.length === zh.length ? PRIVACY_LINES_EN : zh;
}
