/**
 * 英文文案表（★ 2026-10-01，P0：i18n 基建）。
 *
 * ## 口径
 *
 * 1. **键集与 `zh.ts` 完全一致**（`tests/i18n/tables.test.ts` 的表完整性腿逐键比对）：
 *    这里少一条、多一条、值写成空串都会报红。逐屏抽取（P3）时两张表**同时**加键。
 * 2. **写"说人话的英文"**，不写机翻腔：短句、动词开头、不用被动语态堆叠。
 * 3. **术语按用户 2026-10-01 拍板的对照表**（别自创）：
 *    协议 = Protocol、卡牌 = Card、链路/线 = Line、阈值 = Threshold、控制权 = Control、
 *    编译 = Compile、草稿 = Deck draft、热座 = Hotseat、联机 = Online match、
 *    牌库 = Deck、弃牌堆 = Discard、回手 = Return、偏转 = Shift、翻转 = Flip、
 *    覆盖 = Cover、数值 = Value。
 * 4. **卡牌文本不进这张表**（`src/data/cards*.ts` 的中文是数据，被 `texts:check` 与联机
 *    卡文哈希逐字钉住）；英文卡面走以后 P4 的显示层翻译表（按 `defId` 映射）。
 *
 * ## 现在这一屏的内容
 *
 * P0 只抽「设置小窗」这一屏作第一个真实消费者 —— 下面 `settings.*` 就是它的全部文案。
 * 其余屏的抽取排期与清单见 `docs/2026-10-01-i18n-尚未抽取的屏.md`。
 */

export const EN: Readonly<Record<string, string>> = {
  /* ── Settings dialog (the only screen extracted in P0) ── */
  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.aria': 'Settings',
  // 与中文表同一口径：两个选项名（`中文` / `English`）来自 `src/i18n/lang.ts` 的 `LANGS`，
  // 不进文案表 —— 它们不该跟着当前语言变。
  'settings.lang': '语言 / Language',
  'settings.lang.hint': 'Your language choice is saved on this device and stays after a reload.',
  // Only shown when the write fails (value over the size cap / private mode / quota).
  // ⚠️ There is deliberately **no** detail-less variant: the first version shipped one that no
  // call path could reach (online review D3 flagged it as dead copy).
  'settings.lang.save-failed-detail':
    'The language could not be saved on this device. This session still uses it; '
    + 'a reload goes back to the last saved one.',
  // The system-given message goes on its own line. ⚠️ After D3 it can only be a **system string**
  // (e.g. `QuotaExceededError: ...`): the pure storage layer no longer builds any sentence.
  'settings.lang.save-failed-tech': 'Technical detail: {detail}',
  // Value over the size cap: both numbers are formatted by this layer (the pure layer only
  // returns `bytes` / `limit` as numbers).
  'settings.lang.fail.too-large': '{bytes} bytes > the {limit}-byte limit.',
  'settings.lang.fail.write-rejected': 'local storage refused the write (private mode or quota).',
  'settings.hint': 'Changes are saved on this device (same storage as your nickname) and stay for next time; in guest mode they last for this session only.',
  // Added to the write-failure sentence for a **switch** (same shape as the language one)
  'settings.fx.save-failed-detail': 'The switch could not be saved on this device. It still applies now; next time it goes back to the last saved state.',
  'settings.fx.on': 'on',
  'settings.fx.off': 'off',
  // 就地改写的形态：`{desc} (currently: {state})`
  'settings.fx.state': '{desc} (currently: {state})',
  'settings.fx.metal6.label': 'Metal 6 strobe effect',
  'settings.fx.metal6.desc':
    'The Metal 6 card in your hand fades a picture in on a loop. Turn this off to hide it; '
    + 'other cards keep their effects.',
  /* ── Local data & privacy screen: the **language row only** (D4) ──
   * The rest of that screen is NOT extracted yet; it stays on the
   * `docs/2026-10-01-i18n-尚未抽取的屏.md` list. */
  'local-data.lang.label': 'Interface language',
  'local-data.lang.value': 'Interface language: {lang}',
  'local-data.lang.invalid': ' (the value on this device is not valid, so the default is shown)',
  'local-data.lang.read-failed': 'Interface language: reading local data failed: {detail}',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-01（C）：Home screen and everything reachable from it
   * (main menu, mode select, coin toss, library, rules).
   * The rest of the UI is still Chinese-only — see the manifest doc.
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── Main menu (`renderHome`) ── */
  'home.sub': 'Translated World · unofficial web version',
  'home.start': 'Start game',
  'home.library': 'Browse protocols and their cards',
  'home.tutorial': 'Tutorial',
  // Proper names (the designer, the web port's author) stay as they are; only the frame is translated
  'home.footer': 'Compile the board game, created by MICHAEL YANG · this web version built by 「我吃吃吃吃」 with help from DSH',
  'home.rules': 'Rulebooks for gen 1 / 2 / 3',
  'home.local-data': 'Local data and privacy',
  'home.cardmaker': 'Custom protocols and cards',

  /* ── Mode select (`renderModeSelect`) ── */
  'mode.title': 'Choose a game mode',
  'mode.hotseat.name': 'Hotseat (two players)',
  'mode.hotseat.desc': 'Two players take turns on this device (available now)',
  'mode.online.name': 'Online match (two devices)',
  'mode.online.desc': 'Play against another device: host a room to get an invite code, or paste the code you were sent. Connection settings and the details live in the lobby.',
  'mode.solo.name': 'Single player',
  'mode.solo.desc': 'Play against an AI opponent',
  'mode.trio.name': 'Three players',
  'mode.trio.desc': 'Three players at one table',
  'mode.ban': 'Ban mode',
  'mode.ban.tip': 'Both sides may ban protocols at the start: toss for first pick, then the second player bans 2 → first player picks 1 and bans 1 → second player picks 2 and bans 1 → first player picks 2 and bans 2 → second player picks 1 (6 picked, 6 banned). A banned protocol cannot be picked this match; generation filters still work.',
  'mode.random': 'Random pool mode',
  'mode.random.tip': 'At the start, 12 protocols are drawn at random from the whole pool and only those can be picked this match. Generation filters still work; with ban mode also on, picks and bans follow the ban rules inside those 12.',
  'mode.device-check': 'Device and network check',
  'mode.zoom-hint': 'Tip: playing at about 65% zoom looks best — use your browser zoom (Ctrl + wheel, or Ctrl and +/−).',

  /* ── Coin toss, hotseat path (`renderCoinHotseat`) ── */
  'coin.title': 'Player 1 tosses to decide who goes first',
  'coin.rule': 'Player 1 calls heads or tails, then tosses: if the landed side matches the call, player 1 picks a protocol first; otherwise player 2 does.',
  'coin.second': 'Whichever side picks a protocol second plays a card first.',
  'coin.toss': 'Toss the coin',
  'coin.need-pick': 'Call heads or tails first',
  'coin.begin': 'Begin the match',
  'coin.result': '{call}Landed {face} — player {n} picks a protocol first · player {m} plays a card first',
  'coin.result.call-prefix': '{call} — ',

  /* ── Coin toss, online path (`renderCoinNet`) ── */
  'coin.net.title.caller': 'The joiner calls the coin to decide who goes first (online)',
  'coin.net.title.waiter': 'Waiting for the joiner to call the coin (online)',
  'coin.net.rule.caller': 'The joiner calls heads or tails. If the landed side matches the call, the caller picks a protocol first; otherwise the other side does.',
  'coin.net.rule.waiter': 'The joiner calls heads or tails. Once they have called, both sides see the landed side.',
  'coin.net.pick': 'Call heads or tails.',
  'coin.net.waiting': 'Waiting for the other side to call (the toss continues after they press heads or tails).',
  'coin.net.other-calls': 'The other side calls the coin this match (there is nothing for you to press) — wait for them to press heads or tails.',
  'coin.net.called': 'Player {n} called {face}',
  'coin.net.tossing': '{call} — tossing…',
  'coin.net.await-toss': '{call}, waiting for the toss.',
  'coin.net.landed': 'Landed {face}.',
  'coin.net.already-called': 'You already called {face} — waiting for the other side to reveal it, no need to press again.',

  /* ── Library (`renderLibrary`) ── */
  'library.title': 'Protocol and card library',
  'library.sub': '{n} protocols × 6 command cards (filter by generation · hover to preview, click to zoom)',
  'library.compiled': '{name} · compiled',
  'library.card-caption': '{protocol} — {n}-value command card',
  'library.card-alt': '{protocol} — {n} value',
  'library.count': '{checked} / {all} tag groups ticked · {hit} / {total} cards match',
  'library.count-none': '0 cards right now (all {total} are filtered out)',
  'library.filter': 'Filter by effect tag',
  'library.all': 'All',
  'library.none': 'None',
  'library.empty': 'No cards match the current filters — tick a few effect tags, or turn generations back on.',
  'library.preview-hint': 'Hover a protocol or card on the left\nand it shows up here',

  /* ── Rules (`renderRules`) ── */
  'rules.title': 'Rulebooks',
  'rules.sub': 'Rulebooks and FAQ for gen 1 / 2 / 3 (click to read online)',
  'rules.pdf': 'Original PDF',
  'rules.pages-title': '{title} ({pages} pages)',
  'rules.page-alt': '{title} page {n}',
  'rules.gen1': 'Gen 1 rulebook',
  'rules.gen1.sub': 'Compile MN01 (water / fire / light / dark / life / death…)',
  'rules.gen2': 'Gen 2 rulebook',
  'rules.gen2.sub': 'Compile MN02 (ice / mirror / chaos / fear…)',
  'rules.gen3': 'Gen 3 rulebook',
  'rules.gen3.sub': 'Compile MN03',
  'rules.gen3.solo': 'Gen 3 solo rulebook',
  'rules.gen3.solo.sub': 'Solo rules expansion',
  'rules.faq': 'Detailed FAQ',
  'rules.faq.sub': 'Official FAQ collection',

  /* ── ★ 2026-10-01（P1）: first-run onboarding wizard (three steps) ── */
  'onboarding.title': 'Getting started',
  'onboarding.aria': 'Getting started',
  'onboarding.step': 'Step {n} of {total}',
  'onboarding.lang.label': 'Choose your language',
  'onboarding.lang.hint': 'You can change the language later under Settings on the home screen.',
  'onboarding.nick.label': 'Nickname (optional)',
  'onboarding.nick.placeholder': 'Pick a nickname for yourself',
  'onboarding.tutorial.question': 'Want to learn how to play first?',
  /**
   * Step 2's guidance line (★ 2026-10-02, live-acceptance D2). The first version reused the
   * old consent popup's `CONSENT_DENY_HINT`, which only mentioned "changing this choice" —
   * the user's wording asks for **editing the nickname** and **clearing local data** to be
   * named explicitly. Kept separate from `onboarding.consent.deny-note` (that one must stay
   * a verbatim copy of the pinned consent sentence).
   */
  'onboarding.consent.local-hint':
    'You can change your nickname later under Local data and privacy on the home screen, and clear local data there too.',
  /**
   * Step 3's two outcomes (★ 2026-10-02, live-acceptance D1). Both are honest: the tutorial
   * mode itself is not built yet, so neither branch pretends it already opened.
   */
  'onboarding.after-skip': 'Whenever you want to learn, tap "Tutorial" on the home screen to enter tutorial mode.',
  'onboarding.after-start': 'Tutorial mode is still being built; until then, tap "Tutorial" on the home screen to see the entry.',
  /**
   * Step 2's consent chrome (★ 2026-10-01). The Chinese values are **verbatim** the
   * corresponding `CONSENT_COPY` fields (pinned by `tests/i18n/onboarding.test.ts`);
   * the consent **body paragraphs** still come from `privacy.ts` and stay Chinese —
   * that boundary is documented in the plan doc §7.6 and the manifest's section D.
   */
  'onboarding.consent.title': 'Remember your settings on this device?',
  'onboarding.consent.grant': 'Allow and save on this device',
  'onboarding.consent.deny': 'No thanks, keep this session only',
  // Renamed from `onboarding.consent.hint` on 2026-10-02: it is the old popup's
  // "what happens if you decline" line, not the step-2 guidance (see D2 above).
  'onboarding.consent.deny-note': 'You can change this choice any time under Local data and privacy.',
  'onboarding.consent.privacy': 'Privacy notes',

  /* ── Shared generation labels (library chips + rules titles) ── */
  'gen.1.base': 'Gen 1 base',
  'gen.1.extra': 'Gen 1 extra',
  'gen.2.base': 'Gen 2 base',
  'gen.2.extra': 'Gen 2 extra',
  'gen.3.base': 'Gen 3 base',
  'gen.3.extra': 'Gen 3 extra',
  'gen.hide': 'click to hide',
  'gen.show': 'click to show',
  'gen.count-suffix': '{name} ({n} sets) · {action}',

  /* ── Shared labels ── */
  'common.back-home': '← Back to main page',
  'common.back-mode': '← Back to mode select',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.feedback': 'Feedback',
  'common.changelog': 'Changelog',
  'common.coin.heads': 'Heads',
  'common.coin.tails': 'Tails',

  /* ── "not built yet" toasts on the mode select page ── */
  'toast.tutorial': 'Tutorial: not built yet',
  'toast.solo': 'Single player: in development',
  'toast.trio': 'Three players: in development',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-01（C）：the rest of the "Local data and privacy" screen
   * (P0 had only extracted its language row).
   * ══════════════════════════════════════════════════════════════════════ */
  'local-data.title': 'Local data and privacy',
  'local-data.consent.allowed': 'Current: saving to this device is allowed (your nickname and decks go into your own browser storage)',
  'local-data.consent.denied': 'Current: guest mode (nothing of yours is written this session; a reload or closing the tab loses it)',
  'local-data.consent.ask': 'Current: waiting for you to choose whether to save to this device',
  'local-data.consent.unknown': 'Current: nothing chosen yet (the next start asks first)',
  'local-data.error.unknown': 'Unknown error (the host gave no description)',
  'local-data.error.indescribable': 'The host threw something that cannot be described',
  'local-data.error.no-reason': 'the host gave no reason',
  'local-data.clear-failed': 'Clearing local data failed: {detail}. Some data may still be left; please try again later.',
  'local-data.clear-ok': 'Local data cleared ({n} entries). The next start will ask again whether to save here.',
  'local-data.read-failed': 'Reading local data failed: {detail}',
  'local-data.change-consent': 'Change this choice',
  'local-data.clear': 'Clear local data',
  'local-data.clear-yes': 'Yes, clear it',
  'local-data.clear-note': 'Clearing deletes the nickname and decks saved on this device, and the next start asks again whether to save here.',
  'local-data.nick.label': 'Nickname',
  'local-data.nick.placeholder': 'Pick a nickname for yourself',
  'local-data.nick.save': 'Save nickname',
  'local-data.nick.unset': 'not set',
  'local-data.nick.ok': 'Nickname saved on this device.',
  'local-data.nick.write-failed': 'Saving on this device failed; you can still play normally this session.',
  'local-data.stored': 'Saved on this device: nickname 「{nick}」 · {n} deck(s)',
  'local-data.deck-line': 'Deck 「{name}」: {n} cards · seed {seed}',
  'local-data.deck-empty': 'No decks saved on this device yet.',
  'local-data.cardmaker.label': 'Card maker (custom protocols and cards)',
  'local-data.cardmaker.reading': 'Reading the card maker data on this device…',
  'local-data.cardmaker.clear': 'Clear the card maker data on this device',
  'local-data.cardmaker.read-failed': 'Reading the card maker data on this device failed: {detail}',
  'local-data.cardmaker.clear-failed': 'Clearing the card maker data on this device failed: {detail}',
  'local-data.cardmaker.unreadable':
    'Card maker: cannot read the data on this device (this device may have no usable IndexedDB, or another program holds the database). It lives in its own IndexedDB database, separate from the two keys above.',
  'local-data.cardmaker.empty':
    'Card maker: no deck has been saved on this device yet. It lives in its own IndexedDB database, separate from the two keys above.',
  'local-data.cardmaker.count':
    'Card maker: {n} cards are saved on this device (images for custom backgrounds and the logo included). It lives in its own IndexedDB database, separate from the two keys above.',
  'local-data.cardmaker.clear-empty': 'The card maker data on this device was already empty; there is nothing to clear.',
  'local-data.cardmaker.clear-ok': 'Cleared the decks the card maker saved on this device.',
  'local-data.privacy.title': 'Privacy statement (full)',
  'local-data.archive.title': 'Match archives (export / import)',
  'local-data.archive.blurb': 'An imported archive is checked on the spot (format, version, card-data fingerprint and the shape of every action); once it imports, press “Replay this match” to step through it. An exported archive is the real match from this session (every action included); when this session has no match yet, the export is refused with the reason. Archives live only in memory and in the file you export — the next start cannot find them again, so export them yourself if you want to keep one.',
  'local-data.archive.read-failed': 'Reading the archive failed: {detail}',
  'local-data.archive.import-failed': 'Import failed: {detail}',
  'local-data.replay': 'Replay this match',
  'local-data.back': '← Back to main page',
  'local-data.export.btn': 'Export archive',
  'local-data.import.btn': 'Import archive',
  'local-data.export.refused': 'Archive not exported: {detail}',
  'local-data.export.failed': 'Exporting the archive failed: {detail}',
  'local-data.export.waiting': 'Exporting the archive: {name}',
  'local-data.export.cancelled': 'Export cancelled: the archive was not written anywhere.',
  'local-data.export.unsupported': 'This device cannot save files, so the archive cannot be exported.',
  'local-data.export.ok': 'Archive exported: {name} ({n} actions). Import it on another device and press “Replay this match” to step through the match.',
  'local-data.import.waiting': 'Waiting for you to pick an archive file… (you can cancel in the picker; the other actions below still work)',
  'local-data.import.cancelled': 'Archive pick cancelled: nothing on this screen changed.',
  'local-data.import.unsupported': 'This device cannot import archives.',
  'local-data.import.too-large': 'Archive too large ({size} bytes > the {max}-byte limit): this program will not read it',
  'local-data.import.read-failed': 'Could not read the archive contents: {detail}',
  'local-data.import.ok': 'Archive imported and checked ({n} actions)',
  'local-data.import.no-warnings': ', no warnings',
  'local-data.import.warnings': ', {n} warning(s): {list}',
  'local-data.import.ok-tail': '. Press “Replay this match” to step through the match; this screen does not start replaying on its own.',
};
