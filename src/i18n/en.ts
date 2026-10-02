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
  'onboarding.tutorial.start': 'Start the tutorial',
  'onboarding.tutorial.skip': 'I have played before, skip it',
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

  /* ── ★ 2026-10-02 (P2/P5/P6): tutorial mode (ten levels + coach overlay) ──
   *
   * ★ P6: every level carries the four-piece teaching set (user's hard requirement,
   *   2026-10-01): `.scenario` (a concrete example from the real board), `.steps.N`
   *   (imperative walkthrough), `.observe` ("you will see ..."), plus a hands-on
   *   action the pass check depends on. The mechanical guard lives in
   *   `tests/tutorial/levels.test.ts` (generative legs, so new levels inherit them). */
  'tutorial.aria': 'Tutorial',
  'tutorial.step': 'Level {n} of {total}',
  'tutorial.exit': 'Leave tutorial',
  'tutorial.next': 'Continue',
  'tutorial.skip-teach': 'Start doing it',
  'tutorial.restart': 'Restart from level 1',
  'tutorial.restart-level': 'Restart this level',
  'tutorial.cleared': 'Level cleared.',
  'tutorial.cleared-all': 'All levels cleared. Tap "Restart from level 1" to practise again.',
  'tutorial.spot.hint': 'Tap the glowing boxes — all four of them.',
  'tutorial.spot.link': 'This is a line. Cards you play stack up in this column.',
  'tutorial.spot.protocol': 'This is a protocol card. One sits above each line and decides how that line scores.',
  'tutorial.spot.threshold': 'This is the line total. Reach 10 on your side and lead the opponent, and the line can be compiled.',
  'tutorial.spot.control': 'This is control. Hold it and you get to rearrange protocols when compiling.',
  'tutorial.spot.done': 'All four areas seen — level cleared.',
  'tutorial.goal.label': 'What to do here:',
  // The three section titles of the four-piece set (example → steps → what you will see)
  'tutorial.scenario.label': 'Example board',
  'tutorial.steps.label': 'Do this',
  'tutorial.observe.label': 'You will see',
  'tutorial.zoom.hint': 'Double-click a card to open its details.',
  'tutorial.zoom.opened': 'Seen it. Double-click another one if you like.',
  'tutorial.peek.yes': 'This face-down card is yours and its information is public, so the zoom has a "Show face" button.',
  'tutorial.peek.no': 'This face-down card was put on the field straight from the deck, so it is not public — the zoom only shows the card back.',
  'tutorial.peek.done': 'Both cases seen — level cleared.',
  // T7 (default target rule): try the buried card first, then use the card that says "covered"
  'tutorial.T7.hint.try': 'Start with Spirit 2 and try to pick the buried Spirit 3 — it will not respond. That is the default rule.',
  'tutorial.T7.hint.pick': 'Now use Corruption 3 and pick Spirit 3 from its candidates.',
  // ★ P6: shown when the player taps a card that is dimmed (not a candidate)
  'tutorial.choice.blocked': 'That card is not a candidate. Unless the text says "covered cards", an effect may only pick uncovered cards on either side of the field.',
  // T9 (play vs. uncover): a readout of how far along the two demos are
  'tutorial.T9.hint.flip': 'One step left: flip the opponent\'s face-down Speed 0 face up.',
  'tutorial.T9.hint.reveal': 'Flipping done. One step left: shift away the card covering your Speed 0.',
  'tutorial.T9.hint.both': 'Both ways of uncovering are done — level cleared.',

  'tutorial.T0.title': 'Meet the screen',
  'tutorial.T0.goal': 'Tap all four glowing areas.',
  'tutorial.T0.teach.0': 'A game has three lines; these three columns in the middle are them.',
  'tutorial.T0.teach.1': 'One protocol card sits above each line and decides how that line scores.',
  'tutorial.T0.teach.2': 'Each line has a total. Reach 10 on your side and lead the opponent, and that line can be compiled.',
  'tutorial.T0.teach.3': 'Whoever holds control gets to rearrange protocols while compiling.',
  'tutorial.T0.scenario': 'A freshly started game: all three lines are still empty and you hold one Spirit 1.',
  'tutorial.T0.steps.0': 'Tap the glowing line among the three columns in the middle.',
  'tutorial.T0.steps.1': 'Then tap the protocol card above it, and the "Total" and "Control" boxes on the right.',
  'tutorial.T0.steps.2': 'All four boxes — tapping every one is what clears this level.',
  'tutorial.T0.observe': 'Each box you tap adds a line to the panel explaining what that area does.',

  'tutorial.T1.title': 'Looking at a card',
  'tutorial.T1.goal': 'Double-click any card to open its details.',
  'tutorial.T1.teach.0': 'To find out what a card actually does, double-click it.',
  'tutorial.T1.teach.1': 'A big picture pops up, with the card text on the right: top, middle and bottom commands.',
  'tutorial.T1.teach.2': 'Tap anywhere outside to close it. Works for hand cards, field cards and protocol cards.',
  'tutorial.T1.scenario': 'You hold two cards, and a Spirit 3 sits on line 1 — pick whichever you like.',
  'tutorial.T1.steps.0': 'Double-click the Spirit 3 on the field (or any card in hand).',
  'tutorial.T1.steps.1': 'Tap anywhere outside to close it again.',
  'tutorial.T1.observe': 'A big picture pops up in the middle, with the card text on the right split into three parts.',

  'tutorial.T2.title': 'Play your first card',
  'tutorial.T2.goal': 'Drag a face-up card from your hand onto its own line.',
  'tutorial.T2.teach.0': 'Your hand is at the bottom. Each card shows which protocol it belongs to.',
  'tutorial.T2.teach.1': 'Played face up, a card must go on its own protocol line.',
  'tutorial.T2.teach.2': 'Drag it onto that line and let go — that is your first card played.',
  'tutorial.T2.scenario': 'You hold Spirit 1 and Water 1; line 1 carries the Spirit protocol and line 2 the Water protocol.',
  'tutorial.T2.steps.0': 'Drag Spirit 1 onto line 1 (the Spirit protocol line) and let go.',
  'tutorial.T2.steps.1': 'Once it lands on the line, the level is cleared.',
  'tutorial.T2.observe': 'Spirit 1 stacks onto line 1 and that line\'s total goes from 0 to 1.',

  'tutorial.T3.title': 'Face up or face down',
  'tutorial.T3.goal': 'Play one card face up and one face down.',
  'tutorial.T3.teach.0': 'Face up: only on its own protocol line, and its value counts toward that line.',
  'tutorial.T3.teach.1': 'Face down: any line, value does not count — usually used to cover an opponent card.',
  'tutorial.T3.teach.2': 'Hold the right button (or press R) while dragging to flip the card. Play one of each.',
  'tutorial.T3.scenario': 'You hold Spirit 1 and Water 1, both face up. This level wants one played each way.',
  'tutorial.T3.steps.0': 'Drag Spirit 1 face up onto line 1.',
  'tutorial.T3.steps.1': 'Hold the right button (or press R) on Water 1 to turn it face down.',
  'tutorial.T3.steps.2': 'Drag the face-down Water 1 onto line 1 as well.',
  'tutorial.T3.observe': 'The face-up card adds 1 to the line; the face-down one sits on top and adds nothing.',

  'tutorial.T4.title': 'The five basic moves',
  'tutorial.T4.goal': 'With the five cards in hand, do each move once: flip, shift, draw, discard, return.',
  'tutorial.T4.teach.0': 'Each of these five cards has one of those moves as its middle command; the engine will ask which card to use it on.',
  'tutorial.T4.teach.1': 'Flip turns a card over. Shift moves a card to another line.',
  'tutorial.T4.teach.2': 'Draw takes cards from the deck. Discard drops a hand card. Return takes a field card back to hand.',
  'tutorial.T4.teach.3': 'Play all five and this level is cleared.',
  'tutorial.T4.scenario': 'Your hand is Spirit 2, Darkness 4, Spirit 1, Spirit 5 and Water 4 — their middle commands are exactly those five moves. Line 1 holds a face-up Spirit 3, line 2 a face-down Water 2.',
  'tutorial.T4.steps.0': 'Play Spirit 2 and pick a card from the candidates that pop up.',
  'tutorial.T4.steps.1': 'Play Darkness 4, pick the face-down Water 2, then pick a target line.',
  'tutorial.T4.steps.2': 'Then play Spirit 1 (draw), Spirit 5 (discard — take the 0-value card) and Water 4 (return — take the card on line 1).',
  'tutorial.T4.steps.3': 'All five moves done once, and the level is cleared.',
  'tutorial.T4.observe': 'After each move the log on the right gains one more entry for it (flip / shift / draw / discard / return).',

  'tutorial.T5.title': 'Covering a card',
  'tutorial.T5.goal': 'Play your card on top of the opponent card on line 1.',
  'tutorial.T5.teach.0': 'The opponent has a card on line 1. Play a card on the same line and you bury it.',
  'tutorial.T5.teach.1': 'A buried card is "covered": its middle value and its top/bottom commands stop working.',
  'tutorial.T5.teach.2': 'Once your card is flipped face up or moved away, the card below is uncovered and works again.',
  'tutorial.T5.scenario': 'A face-down Spirit 1 sits on the opponent\'s line 1, and your only card is Corruption 0 — "this card may be played on any protocol of either side".',
  'tutorial.T5.steps.0': 'Drag Corruption 0 face up onto the opponent\'s card on line 1 and let go.',
  'tutorial.T5.steps.1': 'Once it lands on top and that opponent card stops scoring, the level is cleared.',
  'tutorial.T5.observe': 'Corruption 0 stacks on top, and the opponent\'s line 1 total drops by that card\'s value.',

  'tutorial.T6.title': 'Can you look at a face-down card?',
  'tutorial.T6.goal': 'Double-click both face-down cards on line 1 and line 2 and compare.',
  'tutorial.T6.teach.0': 'Whether you can see the face of a face-down field card depends on whether its information is public.',
  'tutorial.T6.teach.1': 'A face-down card you played yourself, or one that has been flipped face up or revealed, is public — the zoom offers a "Show face" button.',
  'tutorial.T6.teach.2': 'A face-down card a card effect summoned straight from the deck is not public — nobody can see its face, the zoom shows the card back only.',
  'tutorial.T6.teach.3': 'Line 1 is yours and public: you can see it. Line 2 came from the deck: you cannot. Double-click both.',
  'tutorial.T6.scenario': 'You have one face-down card on line 1 and one on line 2. Line 1 came from your hand; line 2 was put there straight from the deck by an effect.',
  'tutorial.T6.steps.0': 'Double-click the face-down card on line 1 and look for the "Show face" button.',
  'tutorial.T6.steps.1': 'Double-click the one on line 2 and compare.',
  'tutorial.T6.observe': 'Line 1 can be turned over with "Show face"; line 2 only shows the card back — the difference is whether that card\'s information is public.',

  // ★ T7: the default target rule (user asked for this level on 2026-10-02)
  'tutorial.T7.title': 'Who an effect may pick',
  'tutorial.T7.goal': 'First try a card whose text says nothing about targets, then use one that says "covered".',
  'tutorial.T7.teach.0': 'Unless the card text says otherwise, an effect may only pick **uncovered** cards on either side of the field — a buried card cannot be picked at all.',
  'tutorial.T7.teach.1': 'Only text saying "all cards" opens everything up; text saying "covered cards" is what brings buried cards in.',
  'tutorial.T7.teach.2': 'Spirit 3 on line 1 is buried under Spirit 5. Try picking it with Spirit 2 (middle command: "you may flip 1 card") — it will not respond.',
  'tutorial.T7.scenario': 'Spirit 3 on line 1 is buried under Spirit 5. You hold Spirit 2 ("you may flip 1 card") and Corruption 3 ("you may flip 1 covered face-up card").',
  'tutorial.T7.steps.0': 'Drag Spirit 2 face up onto line 1 (the Spirit protocol line) and let go.',
  'tutorial.T7.steps.1': 'In the choice bar that pops up, tap the buried Spirit 3 — it will not respond, and the panel says why.',
  'tutorial.T7.steps.2': 'Pick a legal candidate instead (or tap "Skip") to finish that choice.',
  'tutorial.T7.steps.3': 'Drag Corruption 3 face up onto line 2 (the Corruption protocol line) and let go.',
  'tutorial.T7.steps.4': 'This time tap Spirit 3 in the candidates — it responds.',
  'tutorial.T7.observe': 'The same Spirit 3: the first card cannot pick it, the second one can; picking it turns the card face down.',

  // T8: compiling and the threshold (was T7 in P5, moved one slot in P6)
  'tutorial.T8.title': 'Compiling a line',
  'tutorial.T8.goal': 'Compile line 1.',
  'tutorial.T8.teach.0': 'A line needs 10 or more on your side and more than the opponent — only then can it be compiled.',
  'tutorial.T8.teach.1': 'On line 1 you have 10 and the opponent has 0, so it is enough — the compile button is available.',
  'tutorial.T8.teach.2': 'Compiling flips that line protocol card to compiled, and the line locks up.',
  'tutorial.T8.scenario': 'Line 1 holds Spirit 5, Spirit 3 and Spirit 2 on your side — 10 points in total — and the opponent has 0 there.',
  'tutorial.T8.steps.0': 'Check the total on the right of line 1: you 10, opponent 0.',
  'tutorial.T8.steps.1': 'Tap the "Compile" button for that line.',
  'tutorial.T8.observe': 'Line 1\'s protocol card flips to compiled, and the line locks up for the rest of the game.',

  // ★ T9: playing vs. uncovering (user asked for this level on 2026-10-02)
  'tutorial.T9.title': 'Playing and uncovering',
  'tutorial.T9.goal': 'Use two copies of Speed 0 to show both ways of uncovering: flipping and shifting.',
  'tutorial.T9.teach.0': 'A middle command fires along two routes: when the card is **played** from hand, and when it is **uncovered** (the moment it goes from hidden to shown).',
  'tutorial.T9.teach.1': 'There are two kinds of uncovering: a face-down card being **flipped face up**, and the card above a buried face-up top card being moved away so it becomes the uncovered top card again.',
  'tutorial.T9.teach.2': 'Both cards here are Speed 0, whose middle command is "play 1 card" — the effect itself is quiet, but the log records that it was resolved again.',
  'tutorial.T9.teach.3': 'First: play Darkness 1 ("flip 1 card of your opponent. You may shift that card.") to flip the opponent\'s face-down Speed 0 face up.',
  'tutorial.T9.teach.4': 'Second: play Darkness 4 ("shift 1 face-down card") to shift away the card **covering** your Speed 0.',
  'tutorial.T9.scenario': 'The opponent has a face-down Speed 0 on line 3; you have a face-up Speed 0 on line 2, not yet covered. Your hand is Darkness 1, Water 5, Darkness 4 and Spirit 3.',
  'tutorial.T9.steps.0': 'Drag Darkness 1 face up onto line 1 (the Darkness protocol line) and let go.',
  'tutorial.T9.steps.1': 'Tap the opponent\'s Speed 0 on line 3 in the candidates — it flips face up.',
  'tutorial.T9.steps.2': 'On the follow-up "you may shift that card", tap "Skip" and leave it where it is.',
  'tutorial.T9.steps.3': 'Hold the right button (or press R) on Water 5 to turn it face down, then drag it onto line 2 to cover your Speed 0.',
  'tutorial.T9.steps.4': 'Drag Darkness 4 face up onto line 1 and tap the Water 5 you just played in the candidates.',
  'tutorial.T9.steps.5': 'Pick a line (line 3) to shift it there — your Speed 0 is uncovered again.',
  'tutorial.T9.observe': 'The log shows "[中部] speed-0：原因：翻正" and then "[中部] speed-0：原因：被揭开" — that card\'s middle command resolved twice.',

  /* ── P7: the last four levels (control / trigger timing / delete-immunity-buff / mini match) ── */
  'tutorial.T10.hint.go': 'Now tap "Next" on the board — the engine resolves control once in the control step.',
  'tutorial.T10.hint.got': 'Control is yours — level cleared.',
  'tutorial.T11.hint.after-play': 'Still missing "after play": have the opponent play a card on the Ice 1 line.',
  'tutorial.T11.hint.before-covered': 'Still missing "before covered": cover Fire 0 with that face-down card in your hand.',
  'tutorial.T11.hint.end': 'Still missing "end": tap "Resolve trigger" on the covered Life 0.',
  'tutorial.T11.hint.done': 'All three trigger timings have shown up — level cleared.',
  'tutorial.T12.hint.delete': 'Step one: play Fire 1 face up onto line 1.',
  'tutorial.T12.hint.buff': 'Step two: play Clarity 0 face up onto line 2 and watch that line\'s total.',
  'tutorial.T12.hint.immune': 'Step three: play Rigidity 1 face up onto line 3, then pick the opponent\'s Rigidity 7.',
  'tutorial.T12.hint.done': 'Delete, buff and immunity all done — level cleared.',
  'tutorial.T13.hint.compile': 'Tap the "Compile" button on line 3 — compiling it ends this game.',
  'tutorial.T13.hint.done': 'The game is over — that is the whole tutorial.',

  // T10: control (P7)
  'tutorial.T10.title': 'Control',
  'tutorial.T10.goal': 'Advance one step and take the control component.',
  'tutorial.T10.teach.0': 'Control (the "control component" on screen) is a contested object: whoever holds it may rearrange both sides\' protocols before compiling or refilling their hand.',
  'tutorial.T10.teach.1': 'There is only one way to take it: **on your own control step**, your total must beat the opponent on at least two lines.',
  'tutorial.T10.teach.2': 'Note it is "two lines, each beating the opponent" — not the sum of totals and not the size of the gap. One line is not enough.',
  'tutorial.T10.teach.3': 'Control is never taken from you just because you fall behind; the moment you compile or refill your hand it returns to neutral first.',
  'tutorial.T10.scenario': 'Your line 1 is 3 to 1 and line 2 is 3 to 0 — you beat the opponent on both. The game is sitting on your control step and the control component is still neutral.',
  'tutorial.T10.steps.0': 'Look at the totals on the right of lines 1 and 2 and confirm you beat the opponent on both.',
  'tutorial.T10.steps.1': 'Tap "Next" on the board to let the engine advance one step — it resolves this control step for you.',
  'tutorial.T10.steps.2': 'Check the control component column on the right and confirm it is yours now.',
  'tutorial.T10.observe': 'The log shows "P1 控制阶段：2 条线总值高于对手 → 获得控制组件", and the control column switches from neutral to yours.',

  // T11: trigger timing (P7)
  'tutorial.T11.title': 'Three trigger timings',
  'tutorial.T11.goal': 'Make "after play", "before covered" and "end" each happen once.',
  'tutorial.T11.teach.0': 'A card\'s text has top, middle and bottom parts, and **when** each part takes effect is a separate question: some need you to play the card, others answer when somebody else touches it.',
  'tutorial.T11.teach.1': 'After play: this card\'s bottom says "after the opponent plays into this line" — so it fires when the **opponent** plays there, not when you do. Note the engine does not write a stage line for this one; what you see is the opponent discarding.',
  'tutorial.T11.teach.2': 'Before covered: this card\'s bottom says "before this card is covered" — when a card lands on top, it resolves once **before** being buried.',
  'tutorial.T11.teach.3': 'End: this card\'s top says "End: if this card is covered, delete it" — it is already covered, so the end step asks you to resolve it.',
  'tutorial.T11.scenario': 'Line 1 holds your Ice 1 (bottom: after the opponent plays into this line, they discard 1 card); line 2 holds your Fire 0 (bottom: before covered, first draw 1 card and flip another card); on line 3 your Life 0 is covered by Life 5 (top: End: if this card is covered, delete it). You hold one Water 0. The opponent holds two cards.',
  'tutorial.T11.steps.0': 'First drag the opponent\'s Ice 4 face up onto line 1 and play it — Ice 1\'s "after play" fires at once and makes them discard a card (tap any candidate).',
  'tutorial.T11.steps.1': 'Hold the right button (or press R) on the Water 0 in your hand to turn it face down, then drag it onto line 2 to cover your Fire 0 — Fire 0 resolves its "before covered" part.',
  'tutorial.T11.steps.2': 'Tap "Next" on the board to advance to the end step.',
  'tutorial.T11.steps.3': 'Tap the "Resolve trigger" button on the covered Life 0 — its "end" part deletes itself.',
  'tutorial.T11.observe': 'Three pieces of evidence: after the "after play" part the opponent is one card shorter (that card is in their discard pile); the log shows "[被盖前] fire-0"; and the log then shows "[结束] life-0：由 P1 结算" while that Life 0 disappears from the field.',

  // T12: delete / immunity / buff (P7)
  'tutorial.T12.title': 'Delete, immunity, buff',
  'tutorial.T12.goal': 'Use the three cards in hand to show delete, buff and immunity once each.',
  'tutorial.T12.teach.0': 'Delete: remove a card from the game (into the discard pile) — it no longer occupies a line or scores.',
  'tutorial.T12.teach.1': 'Buff: a card\'s top says "in this line, your total increases by 1 for each of your cards" — it changes the **line total**, not its own value.',
  'tutorial.T12.teach.2': 'Immunity: Rigidity 7\'s bottom says "this card cannot be flipped or shifted" — when someone tries, the engine simply skips it.',
  'tutorial.T12.teach.3': 'Immunity stops flips and shifts, not deletion: deletion takes the card out of the game rather than changing its facing or position.',
  'tutorial.T12.scenario': 'You hold four cards: Fire 1 (middle: discard 1 card. If you did, delete 1 card.), Clarity 0 (top: in this line, your total increases by 1 for each of your cards), Rigidity 1 (middle: flip 1 face-up card of your opponent), and a spare Water 0. The opponent has a Life 2 on line 1 and a Rigidity 7 on line 3.',
  'tutorial.T12.steps.0': 'Play Fire 1 face up onto line 1, discard the spare Water 0 first, then tap the opponent\'s Life 2 in the candidates — it is deleted.',
  'tutorial.T12.steps.1': 'Play Clarity 0 face up onto line 2 and watch that line\'s total go from 0 to 1.',
  'tutorial.T12.steps.2': 'Play Rigidity 1 face up onto line 3 and tap the opponent\'s Rigidity 7 in the candidates.',
  'tutorial.T12.steps.3': 'Read the log: the engine says it "cannot be flipped, skipping", and Rigidity 7 is still face up.',
  'tutorial.T12.observe': 'The opponent\'s Life 2 goes to the discard pile, line 2 gains 1 point, and Rigidity 7 will not flip — the log says "rigidity-7 不可被翻转，跳过".',

  // T13: mini match (P7)
  'tutorial.T13.title': 'Play a small game',
  'tutorial.T13.goal': 'Compile the last line and finish the game.',
  'tutorial.T13.teach.0': 'This level stops breaking out single actions: three lines, the first two already compiled, and the third has reached 10.',
  'tutorial.T13.teach.1': 'A line can be compiled when your side reaches 10 and beats the opponent — that is what level 8 taught.',
  'tutorial.T13.teach.2': 'This game ends when **all three of your protocols are compiled**. How many the opponent compiled does not affect your win.',
  'tutorial.T13.teach.3': 'Compiling deletes every card on that line (both sides), flips the protocol to compiled, and locks it up.',
  'tutorial.T13.scenario': 'Your lines 1 and 2 are already compiled (line 1 still shows a face-down opponent card); line 3 is the Darkness line where you have Darkness 1, Darkness 4 and Darkness 5 for 10 points, against the opponent\'s 2.',
  'tutorial.T13.steps.0': 'Look at the total on the right of line 3: you 10, opponent 2.',
  'tutorial.T13.steps.1': 'Tap the "Compile" button on line 3.',
  'tutorial.T13.steps.2': 'Once the game ends, the tutorial is complete.',
  'tutorial.T13.observe': 'Line 3\'s cards all go to the discard pile, the protocol flips to compiled, "P1 wins!" appears in the log, and the screen goes to the end-of-game summary.',

  'tutorial.off.wrong-kind': 'That is not part of this level. Follow the line above.',
  'tutorial.off.face-down': 'This level plays face-up cards: do not flip while dragging.',
  'tutorial.off.rejected': 'That card cannot go on that line. A face-up card only goes on its own protocol line.',

  'local-data.tutorial.label': 'Tutorial progress',
  'local-data.tutorial': '{n} of {total} levels cleared. Clearing local data restarts the tutorial from level 1.',
  'local-data.tutorial.none': 'The tutorial has not been started. Clearing local data starts it from level 1.',

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

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-02 (P3, second batch): the small screens that need no red-line file.
   *
   * ⚠️ The **changelog entries themselves are not here** — the user's rule is that
   * their content comes only from him, so the entries stay Chinese. Under `en`
   * the changelog body is still Chinese; that is a declared gap (F section of
   * `docs/2026-10-01-i18n-尚未抽取的屏.md`). Only the panel shell is translated.
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── Changelog panel shell (entries stay Chinese) ── */
  'changelog.aria': 'Changelog',
  'changelog.title': 'Changelog',
  'changelog.close': 'Close',
  'changelog.hint': 'Newest at the top; scroll down for older ones.',
  'changelog.empty': 'No entries written yet. Give me the content and I will add it in your format.',

  /* ── Log toggle on the hotseat board (`log-toggle.ts`) ── */
  'log-toggle.show': 'Show log',
  'log-toggle.hide': 'Hide log',

  /* ── Exit button on the hotseat board (`hotseat-exit.ts`) ── */
  'hotseat-exit.label': '← Exit game',

  /* ── Connection status line on the draft screen (`net-conn-line.ts`) ── */
  'net-conn-line.direct': 'Connection: direct',
  'net-conn-line.relay': 'Connection: via relay',
  'net-conn-line.pending': 'Connection: setting up…',

  /* ── "Turn your device sideways" gate and the pan hint (`phone-landscape.ts`) ── */
  'phone-landscape.gate.title': 'Turn your device sideways',
  'phone-landscape.gate.hint': 'This screen is laid out for landscape. The button below goes straight to landscape; if this device cannot go fullscreen or lock orientation, the page rotates 90 degrees itself.',
  'phone-landscape.gate.button': 'Play in landscape',
  'phone-landscape.pan-hint': 'Drag with one finger on empty space to see the rest of the screen',

  /* ── Fallback line while the draft-to-game video has not drawn (`t44-video-fallback.ts`) ── */
  't44.transition-hint': 'Entering the match…',

  /* ── PWA update bar (`pwa-update.ts`). The precache-failure line goes to the console only ── */
  'pwa.update.text': 'A new version is available',
  'pwa.update.button': 'Update now',

  /* ── Replay control bar (`replay-bar.ts`) ── */
  'replay.pause': 'Pause',
  'replay.play': 'Resume',
  'replay.next': 'Step',
  'replay.exit': 'Exit replay',
  'replay.readonly': 'Read-only while replaying',
  'replay.done': 'Replay finished',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-02 (P3, third batch): the feedback overlay and the hidden page.
   *
   * ⚠️ The server's own Chinese error reason is **not** here: it is the server's
   * reading and the user asked for it to be shown verbatim, so `serverErrorText()`
   * returns it unchanged. Everything below is wording this program writes.
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── The two kinds of feedback ── */
  'feedback.kind.protocol': 'Submit a custom protocol',
  'feedback.kind.bug': 'Bug report',
  'feedback.badge.protocol': 'Protocol',
  'feedback.badge.bug': 'Bug report',
  'feedback.author.protocol': 'Submitted by',
  'feedback.author.bug': 'Reported by',
  'feedback.body.protocol': 'Description of the protocol and cards',
  'feedback.body.bug': 'What exactly went wrong',
  'feedback.body-placeholder.protocol': 'Protocol name, card names, how the effect resolves… the clearer it is, the easier to reproduce and judge.',
  'feedback.body-placeholder.bug': 'Which screen, what you clicked, what you expected and what you actually saw.',

  /* ── The form overlay ── */
  'feedback.aria': 'Feedback',
  'feedback.title': 'Feedback',
  'feedback.close': 'Close',
  'feedback.title-label': 'Short title',
  'feedback.title-placeholder': 'One line on what this feedback is about',
  'feedback.kind-hint.protocol': 'Submitting a custom protocol: spell out the protocol name, the cards and how effects resolve.',
  'feedback.kind-hint.bug': 'Bug report: spell out which screen, what you clicked, and the expected vs actual result.',
  'feedback.author-placeholder.protocol': 'Your name as the submitter (required)',
  'feedback.author-placeholder.bug': 'Your name as the reporter (required)',
  'feedback.files-label': 'Attachments (optional)',
  'feedback.files-hint': 'Common images (pdf/jpg/png…) or common text (txt/markdown…); up to 10MB each, at most {max} at a time.',
  'feedback.files-clear': 'Clear attachments',
  'feedback.files-empty': 'No attachments chosen yet.',
  'feedback.files-remove': 'Remove',
  'feedback.files-picked': '{n} attachment(s) chosen.',
  'feedback.submit': 'Submit',
  'feedback.submitting': 'Submitting…',
  'feedback.submit.ok': 'Submitted',
  'feedback.submit.ok-line': '{ok}. Reference: {id}',

  /* ── Required-field check and attachment pre-check (sentences built in pure functions) ── */
  'feedback.missing.title': 'the title',
  'feedback.missing.author': 'the submitter/reporter name',
  'feedback.missing.body': 'the description',
  'feedback.missing.sep': ', ',
  'feedback.missing.line': 'Still missing: {names}.',
  'feedback.attach.sep': ', ',
  'feedback.attach.too-large': 'Skipped attachments over {size}: {names} (each one must be at most {size}).',
  'feedback.attach.over-count': 'At most {max} attachments at a time; {dropped} extra ones were not added — submit them in a few goes if you need to.',

  /* ── Readings (size / time / top count) ── */
  'feedback.bytes.unknown': 'unknown size',
  'feedback.time.unknown': 'unknown time',
  'feedback.count': '{total} total · {unread} unread',

  /* ── Network and session lines ── */
  'feedback.offline': 'There is no feedback service in this environment (or the network is down): please try again later. It is normal for a local dev environment not to have this service.',
  'feedback.read-fail': 'Read failed: the server did not return what was expected.',
  'feedback.read-fail-http': 'Read failed: the server did not return what was expected. (HTTP {status})',
  'feedback.session-expired': 'Your login expired; please enter the password again.',
  'feedback.password-fail': 'Wrong password',

  /* ── Password box (the layer behind `Ctrl+Shift+O`) ── */
  'feedback.password.aria': 'Password',
  'feedback.password.title': 'Password',
  'feedback.password.placeholder': 'Type the password and press Enter',
  'feedback.password.enter': 'Enter',
  'feedback.password.checking': 'Checking…',
  'feedback.password.need': 'Type the password first.',

  /* ── Hidden page: list ── */
  'feedback.refresh': 'Refresh',
  'feedback.loading': 'Reading…',
  'feedback.list-empty': 'No feedback received yet.',
  'feedback.unread': 'Unread',
  'feedback.read.mark-read': 'Mark as read',
  'feedback.read.mark-unread': 'Mark as unread',
  'feedback.file-count': '{n} attachment(s)',
  'feedback.untitled': '(untitled)',
  'feedback.delete': 'Delete',
  'feedback.delete.confirm': 'Moving it to the bin cannot be undone from this page. Delete it?',
  'feedback.delete.yes': 'Delete it',
  'feedback.delete.no': 'Cancel',
  'feedback.delete.done': 'Deleted “{title}” (moved to the bin).',

  /* ── Hidden page: detail ── */
  'feedback.back-to-list': '← Back to list',
  'feedback.detail.title': 'Feedback detail',
  'feedback.detail.no-selection': 'No feedback entry selected.',
  'feedback.detail.no-files': 'This entry has no attachments.',
  'feedback.detail.files-label': 'Attachments ({n})',
  'feedback.detail.unnamed-file': '(unnamed attachment)',

  /* ── ★ 2026-10-02: the three lines of the runtime-error prompt (`diag.ts`).
   * ⚠️ The exported diagnostic file body is **not** here: it is a reading for
   * developers and is pinned verbatim by `tests/diag.test.ts`. */
  'diag.prompt.title': '⚠ A runtime error occurred. Export a diagnostic log?',
  'diag.prompt.export': 'Export log',
  'diag.prompt.ignore': 'Ignore',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-02 (P3): the card maker (`src/ui/cardmaker/**`).
   * ⚠️ The player's own content (deck title, protocol names, card text, preset
   * background names) is data and is not in this table.
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── Host capabilities (`host.ts`) ── */
  'cardmaker.host.read-failed': 'Reading the file failed',

  /* ── Image decoding / re-encoding (`images.ts`); these are `Error.message` values ── */
  'cardmaker.images.load-failed': 'Loading the image failed: {src}',
  'cardmaker.images.no-canvas-normalize': 'This device cannot give a 2D canvas, so the uploaded image cannot be processed',
  'cardmaker.images.bad-image': 'This image cannot be decoded (unsupported format or a damaged file)',
  'cardmaker.images.no-canvas-logo': 'This device cannot give a 2D canvas, so the logo background cannot be removed',
  'cardmaker.images.bad-logo': 'This logo cannot be decoded (unsupported format or a damaged file)',

  /* ── Deck archive format errors (`serialize.ts`) ── */
  'cardmaker.serialize.not-json': 'This is not a JSON file: {detail}',
  'cardmaker.serialize.not-an-object': 'The top level of the file is not an object (it does not look like a deck exported by this card maker)',
  'cardmaker.serialize.no-format-mark': 'The file has no card-maker format mark (expected format = {expected}, got {actual})',
  'cardmaker.serialize.bad-version': 'Unrecognised deck version (expected {expected}, got {actual})',
  'cardmaker.serialize.no-deck': 'The file has the format mark but no deck content (the deck field)',

  /* ── On-device storage (`store-idb.ts`) ── */
  'cardmaker.store.open-failed': 'Cannot open IndexedDB',
  'cardmaker.store.read-failed': 'Reading from IndexedDB failed',
  'cardmaker.store.write-failed': 'Writing to IndexedDB failed',
  'cardmaker.store.write-aborted': 'Writing to IndexedDB was aborted',
  'cardmaker.store.delete-failed': 'Deleting the IndexedDB record failed',
  'cardmaker.store.memory-only': 'Written to memory only (guest mode, or on-device storage is unavailable)',
  'cardmaker.store.no-idb': 'This device has no usable IndexedDB',

  /* ── ★ 2026-10-02（P3）：卡牌制作器整屏（`src/ui/cardmaker/page.ts`） ── */
  'cardmaker.page.back': '← Back to the main page',
  'cardmaker.page.title': 'Custom protocols and cards',
  'cardmaker.page.save': 'Save on this device',
  'cardmaker.page.mode.protocol': 'Protocol card (landscape · front/back)',
  'cardmaker.page.mode.compile': 'Card (portrait compiled card)',
  'cardmaker.page.face.which': 'This side:',
  'cardmaker.page.face.front': 'Front',
  'cardmaker.page.face.back': 'Back',
  'cardmaker.page.status.persistent': 'Changes are saved on this device (browser storage) automatically and stay after a refresh.',
  'cardmaker.page.status.memory': 'You are in guest mode or on-device storage is unavailable: changes live only in memory and are lost when you refresh or close the page.',
  'cardmaker.page.geometry-note': 'Card faces render with the reference project\'s geometry (portrait design space {cw}×{ch}, landscape {lw}×{lh});',
  'cardmaker.page.geometry-note.export': 'exports use the standard poker card size of 63.5×88.9 mm at 300 dpi.',
  'cardmaker.page.preview.portrait': 'Preview: portrait compiled card · design space {w}×{h}',
  'cardmaker.page.canvas-help': 'Drag on the card to pan the background; scroll to zoom the background around the cursor; drag inside the hexagon to move the logo.',
  'cardmaker.page.canvas-help.sliders': 'The background and the logo each have their own zoom slider (Logo zoom on the left / Background zoom just below here) and they do not affect each other.',
  'cardmaker.page.bg-reset': 'Reset background',
  'cardmaker.page.bg-zoom': 'Background zoom',
  'cardmaker.page.deck-title.placeholder': 'Deck name (used for export file names)',
  'cardmaker.page.deck-title': 'Deck name',
  'cardmaker.page.card-add': 'Add portrait compiled card',
  'cardmaker.page.card-delete': 'Delete current card',
  'cardmaker.page.field.title': 'Protocol name / title',
  'cardmaker.page.field.title.hint': 'On a protocol card it is the large centered title; on a portrait compiled card it is the top-left title',
  'cardmaker.page.field.value': 'Value (large centered number)',
  'cardmaker.page.field.panel-top': 'Top panel',
  'cardmaker.page.field.panel-mid': 'Middle panel',
  'cardmaker.page.field.panel-bot': 'Bottom panel',
  'cardmaker.page.field.panel.hint': 'You can write **bold** and __underline__',
  'cardmaker.page.field.compile-top': 'Protocol card top-left small text (front)',
  'cardmaker.page.field.compile-subtitle': 'Protocol card subtitle (front)',
  'cardmaker.page.field.compile-bottom': 'Protocol card bottom small text (front)',
  'cardmaker.page.field.compile-back': 'Protocol card back line (back)',
  'cardmaker.page.panel.empty-hint': 'All three panels are empty: the card face draws no panel backing (same as the reference project).',
  'cardmaker.page.panel.summary': 'There are {n} panel texts ({paras} paragraphs{marks}) · inline markup: **bold** and __underline__ · font size scales automatically between {min}–{max}px',
  'cardmaker.page.panel.marks-phrase': ', with inline markup',
  'cardmaker.page.bg.none': 'No background',
  'cardmaker.page.bg.upload': 'Upload background image',
  'cardmaker.page.bg.preset-ok': 'Background changed to the preset “{name}”.',
  'cardmaker.page.per-card-bg': 'Per-card background (when off, the whole deck shares one background)',
  'cardmaker.page.logo.none': 'No logo uploaded',
  'cardmaker.page.logo.upload': 'Upload logo',
  'cardmaker.page.logo.clear': 'Clear logo',
  'cardmaker.page.logo.label': 'Hexagon logo',
  'cardmaker.page.logo.cutout': 'Remove the logo background (recommended)',
  'cardmaker.page.logo.cutout.hint.1': 'Checked (default): keep only the shape of the graphic — make the background touching the image\'s four edges transparent, then tint the logo white',
  'cardmaker.page.logo.cutout.hint.2': '(the logo on the card face is white to begin with). When there is nothing to cut (the whole image is almost all background color) it is not forced:',
  'cardmaker.page.logo.cutout.hint.3': 'the original image is used as is, with no tinting. Unchecked: **the original image goes straight on**, with no background removal and no tinting — its colors and background reach the card face unchanged.',
  'cardmaker.page.logo.cutout.hint.4': 'If the image already has a transparent background, this makes no difference. It applies when you upload.',
  'cardmaker.page.logo.zoom': 'Logo zoom',
  'cardmaker.page.logo.zoom-reset': 'Reset logo zoom',
  'cardmaker.page.logo.zoom-hint.1': 'Scale the logo inside the hexagon up or down around its center ({min}%~',
  'cardmaker.page.logo.zoom-hint.2': '{max}%; 100% = exactly fills the hexagon).',
  'cardmaker.page.logo.zoom-hint.3': 'Anything outside the hexagon after zooming is clipped and never spills onto the rest of the card face.',
  'cardmaker.page.logo.zoom-hint.4': 'This and Background zoom on the right do not affect each other; Reset logo zoom only returns the scale to 100% and never touches the position offset you dragged.',
  'cardmaker.page.io.image': 'Export image',
  'cardmaker.page.io.deck': 'Deck archive',
  'cardmaker.page.export-png.portrait': 'Export portrait compiled card as PNG (750×1050)',
  'cardmaker.page.export-png.protocol-front': 'Export protocol card front as PNG (landscape 1050×750)',
  'cardmaker.page.export-png.protocol-back': 'Export protocol card back as PNG (landscape 1050×750)',
  'cardmaker.page.export-json': 'Export deck as JSON',
  'cardmaker.page.import-json': 'Import deck from JSON',
  'cardmaker.page.credit.sentence': 'This maker was built by referencing the open-source project COMPILER · Card Builder (by Albert Blanco, MIT license); its assets (card frames/backgrounds/card backs/fonts) also come from that project.',
  'cardmaker.page.credit.author': 'Author: {author}',
  'cardmaker.page.credit.license-label': 'License: {license}',
  // `CREDIT.license` is plain data (a Chinese constant in `src/ui/cardmaker/page.ts`, unchanged);
  // the *English* screen shows this value. The zh value must stay verbatim equal to that data
  // constant (pinned by `CLEAN_DECLARED` in `tests/i18n/unextracted-manifest.test.ts`), while the
  // en value is real English — 2026-10-02 walkthrough: English mode showed `License: MIT 许可`.
  'cardmaker.page.credit.license-value': 'MIT License',
  'cardmaker.page.credit.license-path': 'The full license text ships with the repository: {path}',
  'cardmaker.page.mode.created.protocol': 'Switched to “Protocol card”: the deck had no landscape protocol card, so one was created by the add-card logic.',
  'cardmaker.page.mode.created.compile': 'Switched to “Card”: the deck had no portrait compiled card, so one was created by the add-card logic.',
  'cardmaker.page.mode.switched.protocol': 'Switched to “Protocol card” (landscape · front/back).',
  'cardmaker.page.mode.switched.compile': 'Switched to “Card” (portrait compiled card).',
  'cardmaker.page.face.switched.back': 'Switched to the protocol card back',
  'cardmaker.page.face.switched.front': 'Switched to the protocol card front',
  'cardmaker.page.save-failed': 'Saving on this device failed: {detail} (you can keep editing this session)',
  'cardmaker.page.saved-memory': 'Changes are kept in memory (guest mode): they are lost when you refresh or close the page.',
  'cardmaker.page.saved': 'Saved on this device.',
  'cardmaker.page.card.kind.protocol': 'Protocol card',
  'cardmaker.page.card.kind.compile': 'Card this protocol belongs to',
  'cardmaker.page.card.untitled': '(Untitled)',
  'cardmaker.page.card.note': '{label} · Value {value}',
  'cardmaker.page.card.value-empty': '—',
  'cardmaker.page.card.none': 'There are no cards in this mode yet.',
  'cardmaker.page.mode-hint.protocol': 'Current mode: Protocol card (landscape · front/back) · only one is allowed per deck, currently {n}',
  'cardmaker.page.mode-hint.compile': 'Current mode: Card (portrait compiled card) · currently {n}',
  'cardmaker.page.bg.no-card': 'No card to edit',
  'cardmaker.page.bg.preset': 'Preset background: {name}',
  'cardmaker.page.bg.name-lost': '(name lost)',
  'cardmaker.page.bg.custom': 'Custom background: uploaded image',
  'cardmaker.page.logo.set-raw': 'Logo: uploaded (original image as is, not tinted)',
  'cardmaker.page.logo.set-cut': 'Logo: uploaded (background removed + tinted white)',
  'cardmaker.page.preview.none': 'No card to preview',
  'cardmaker.page.preview.landscape-front': 'Preview: landscape protocol card front · design space {w}×{h}',
  'cardmaker.page.preview.landscape-back': 'Preview: landscape protocol card back · design space {w}×{h}',
  'cardmaker.page.preview-failed': 'The preview did not render: this card’s background image failed to load (pick another image or click “No background”).',
  'cardmaker.page.bg.cleared': 'Background set to “No background”: the card face now shows only the base color and the frame.',
  'cardmaker.page.bg.waiting': 'Waiting for you to pick an image… (you can cancel in the file dialog)',
  'cardmaker.page.bg.read-failed': 'Reading the image failed: {detail}',
  'cardmaker.page.bg.cancelled': 'Image selection cancelled: nothing on screen changed.',
  'cardmaker.page.bg.normalize-failed': 'This image cannot be processed: {detail}',
  'cardmaker.page.bg.uploaded': 'Background changed to the image you uploaded (automatically scaled to within 2000px so the deck JSON can hold it).',
  'cardmaker.page.bg.reset-ok': 'Background pan and zoom reset.',
  'cardmaker.page.logo.waiting': 'Waiting for you to pick a logo image… (you can cancel in the file dialog)',
  'cardmaker.page.logo.read-failed': 'Reading the logo failed: {detail}',
  'cardmaker.page.logo.cancelled': 'Logo selection cancelled: nothing on screen changed.',
  'cardmaker.page.logo.cut.rejected': 'This image is mostly background (about {pct}%), and removing it would wash away the graphic itself,',
  'cardmaker.page.logo.cut.rejected.2': 'so this time **the background was not removed** and the original image was used (keeping its own colors; tinting would turn it into one solid white block, so it was not tinted either).',
  'cardmaker.page.logo.cut.rejected.3': 'To skip any processing from the start, uncheck the box.',
  'cardmaker.page.logo.cut.done': 'Removed the background touching the four edges (about {pct}% of the pixels) and then tinted it white.',
  'cardmaker.page.logo.cut.none': 'This image has no background to remove (its four corners are already transparent); it was tinted white directly.',
  'cardmaker.page.logo.cut.off': 'As you chose, **the original image goes straight on**: no background removal and no tinting — the card face gets this image’s original colors and background.',
  'cardmaker.page.logo.normalize-failed': 'This logo cannot be processed: {detail}',
  'cardmaker.page.logo.uploaded': 'Logo uploaded: {note}',
  'cardmaker.page.logo.cleared': 'Logo cleared.',
  'cardmaker.page.logo.zoom-reset-ok': 'Logo zoom reset to 100% (the position offset was left untouched).',
  'cardmaker.page.card.added': 'Added a portrait compiled card.',
  'cardmaker.page.card.deleted': 'This card was deleted.',
  'cardmaker.page.export.waiting': 'Rendering… (the export uses the 300 dpi final size, one step larger than the on-screen preview)',
  'cardmaker.page.export.no-2d': 'This device cannot provide a 2D canvas, so PNG export is not possible.',
  'cardmaker.page.export.failed': 'PNG export failed: {detail}',
  'cardmaker.page.export.ok': 'Exported {name} ({w}×{h})',
  'cardmaker.page.export.ok.kind': '— {kind}.',
  'cardmaker.page.card.kind.landscape': 'landscape protocol card',
  'cardmaker.page.card.kind.portrait': 'portrait compiled card',
  'cardmaker.page.export.canvas-failed': 'Canvas export failed (the browser returned no image data).',
  'cardmaker.page.export.unsupported': 'This device does not support PNG export.',
  'cardmaker.page.export-json.ok': 'Exported {name} (custom images are embedded as base64; preset backgrounds are referenced by name).',
  'cardmaker.page.export-json.failed': 'Exporting the deck failed: {detail}',
  'cardmaker.page.import.waiting': 'Waiting for you to pick a deck JSON… (you can cancel in the file dialog)',
  'cardmaker.page.import.read-failed': 'Reading the file failed: {detail}',
  'cardmaker.page.import.cancelled': 'Import cancelled: nothing on screen changed.',
  'cardmaker.page.import.failed': 'Import failed: {detail}',
  'cardmaker.page.import.ok': 'Imported {n} cards.',
  'cardmaker.page.loaded': 'Read back the deck saved on this device ({n} cards).',
  'cardmaker.page.load-failed': 'Reading the deck saved on this device failed: {detail} (continuing with an empty deck for now)',

  /* ── ★ 2026-10-02（P3）：联机大厅整屏（`src/ui/net-lobby.ts`） ── */
  'net-lobby.error.card-data-hash': 'The two sides do not have the same card data (the card fingerprint did not match during the handshake): make sure both devices have the same version of the card data; if one side has updated its card data, the other side has to update too.',
  'net-lobby.error.room-gone': 'Waited {seconds} seconds and still did not reach the other side: the room code may be mistyped, or the host has closed the page (the host closing the page ends this game). Check the room code and try again, or switch to an invite code (it does not need a signaling server).',
  'net-lobby.error.busy': 'The player seats in this room are already full: a G5 game has only two player seats, so there is no free seat to take. Ask the host to check that nobody else joined first, or start another room.',
  'net-lobby.error.spectator': 'This version does not support spectating yet: the spectating seats have not been built at all (**not** that they are full). Ask the other side to handshake again as a player.',
  'net-lobby.error.proto-version-consistent': 'The Protocol version matches this device, so this slot will not be rendered today (it is only produced by protocolVersionCheck when the versions differ)',
  'net-lobby.error.refusal-with-detail': '{base} (reason given by the other side: {detail})',
  'net-lobby.error.boundary': 'What this table pins down is that the five messages differ from one another, have traceable sources, and that a refusal reason maps to the matching slot; whether they can be triggered on a real network is left to T9/manual acceptance.',
  'net-lobby.link.online': 'The other side is online; this game can start.',
  'net-lobby.link.offline-window-live': 'The other side is offline now (the Line dropped). This game is still inside its grace window: if the other side comes back with the same session, this device will catch the game up and play on. Note that reloading the page cannot bring the game back - reloading only throws away the session held here.',
  'net-lobby.link.offline-window-expired': 'The other side has been offline past the grace window, so this game cannot be continued. Reloading the page cannot bring the game back either: the grace window is counted from the last message received from the other side, and reloading also throws away the local state.',
  'net-lobby.link.offline-window-unknown': 'The other side is offline now (the Line dropped). This side cannot tell how much of the grace window is left (no usable clock reading) - this is "cannot be determined", not "still inside the grace window". Reloading the page cannot bring the game back either.',
  'net-lobby.link.resync-handshake': 'The other side is back with the same session and this game is catching up: play can continue only after it fills in the missing steps.',
  'net-lobby.link.resync-queue-overflow': 'This side cannot keep up (the inbound queue overflowed, so it is a long way behind), and a catch-up is needed. Note: on the host side a queue overflow has no automatic way out today (only the joiner can send a catch-up request) - if this side is the host, this game can only be ended by the layer above and cannot advance any further turns.',
  'net-lobby.link.detail-suffix': '{base} ({detail})',
  'net-lobby.turn.draft-mine': 'Your turn to pick a Protocol (step {n} of {total})',
  'net-lobby.turn.draft-peer': 'The other side picks a Protocol now (step {n} of {total}) - waiting for them',
  'net-lobby.turn.play-mine': 'Your turn to play a Card',
  'net-lobby.turn.play-peer': 'The other side plays a Card now',
  'net-lobby.recovery.expired': 'The other side has been offline past the grace window: under the D8 rule this game can no longer catch up, but this local game will not be ended automatically by the program (it simply stops accepting a catch-up). To play on you have to start a new game: generate a new invite code / join again.',
  'net-lobby.recovery.live': 'This game is still inside its grace window: generate a new invite code / join again. Once the other side reconnects with the same session, this device will catch the game up and play on (a catch-up fills in the missing steps) - this is handing over the invite code once more, not the Line reconnecting itself in the background.',
  'net-lobby.recovery.unknown': 'This side cannot tell how much of the grace window is left (no usable clock reading): if the other side comes back with the same session, the game can catch up and play on; coming back after more than 5 minutes is not allowed to catch up and can only be restarted. Generate a new invite code / join again.',
  'net-lobby.relay.partial': 'The relay (TURN) is only partly filled in, so it was not used: the URL, username and credential must all be present, and a relay missing any one of them will refuse the connection on a real network. It takes effect only once all three are filled in.',
  'net-lobby.paste.shape-hint': 'The whole link, the part after {prefix} inside the link, or just the invite code itself - all three work.',
  'net-lobby.invite.link-without-fragment': 'What you pasted is a link, but the link has no part after {prefix}; make sure you copied the whole link (including the piece after the hash sign), or paste just the invite code itself.',
  'net-lobby.answer.link-without-fragment': 'What you pasted is a link, but the link has no part after {prefix}; make sure you copied the whole link (including the piece after the hash sign), or paste just the answer code the other side gave you.',
  'net-lobby.step.tag.done': 'Done',
  'net-lobby.step.tag.current': 'Do this step now',
  'net-lobby.step.tag.waiting': 'With the other side',
  'net-lobby.steps.done-now': 'The handover for this game is finished; from here it goes to the coin screen.',
  'net-lobby.steps.title': 'Handover steps',
  'net-lobby.action.make-invite': 'Generate invite code',
  'net-lobby.step.host.send-invite': 'Send the invite code to the other side',
  'net-lobby.step.host.peer-answers': 'The other side answers (it will produce an answer code)',
  'net-lobby.step.host.paste-answer': 'Paste the answer code back',
  'net-lobby.step.guest.paste-invite': 'Paste the invite code in',
  'net-lobby.step.guest.show-answer': 'Show the answer code',
  'net-lobby.step.guest.send-answer': 'Send the answer code back to the host',
  'net-lobby.step.guest.host-pastes': 'Connected once the host pastes it back',
  'net-lobby.steps.now.host-make-invite': 'Now: tap "Generate invite code".',
  'net-lobby.steps.now.host-paste-answer': 'Now: paste the answer code the other side sent back into the box below.',
  'net-lobby.steps.now.host-send-invite': 'Now: send the invite code to the other side (it produces the answer code only after pasting it in).',
  'net-lobby.steps.now.guest-paste-invite': 'Now: paste the invite code the other side sent into the box below.',
  'net-lobby.steps.now.guest-send-answer': 'Now: send the answer code above back to the host (the Line comes up only after the host pastes it in).',
  'net-lobby.steps.now.guest-show-answer': 'Now: tap "Show the answer code", then send it back to the host.',
  'net-lobby.plain.resyncing': 'This game is catching up: waiting for the other side to fill in the missing steps.',
  'net-lobby.plain.linked': 'Both sides are connected.',
  'net-lobby.plain.peer-absent': 'The other side has not connected yet.',
  'net-lobby.face.ask-failed': 'Failed to get the coin side: {detail}',
  'net-lobby.send.encode-failed': 'This message could not be encoded, so it was not sent.',
  'net-lobby.trace.redrive-failed': 'redrive failed ({type}:{reason})',
  'net-lobby.trace.redrive-sent': 'redrive sent ({type})',
  'net-lobby.trace.resync-req-sent': 'sent resync-req',
  'net-lobby.trace.apply-resync-rejected': 'applyResync rejected ({detail})',
  'net-lobby.trace.apply-resync-ok': 'applyResync ok (phase={phase})',
  'net-lobby.trace.apply-resync-resend-failed': 'applyResync resend failed ({type}:{reason})',
  'net-lobby.trace.accept-rejected': 'accept rejected ({type}:{detail})',
  'net-lobby.resync.host-refused': 'Catch-up failed: this side could not rebuild its state from that file (the reason is on the line shown on screen); this side changed nothing and does not pretend the catch-up happened.',
  'net-lobby.trace.resync-host-refused': 'catch-up failed (host refused)',
  'net-lobby.trace.send-hello-role-rejected': 'sendHello: refused (role={role})',
  'net-lobby.trace.send-hello-done-rejected': 'sendHello: refused (helloDone)',
  'net-lobby.trace.send-hello-queued': 'sendHello: handed down (status={status})',
  'net-lobby.trace.flush-skipped': 'flush: skipped (pending={pending},done={done})',
  'net-lobby.trace.flush-wait-status': 'flush: waiting for status (status={status})',
  'net-lobby.trace.flush-failed': 'flush: failed ({reason})',
  'net-lobby.trace.flush-hook-open': 'flush: hooked on channel open',
  'net-lobby.trace.channel-open': 'channelOpen callback',
  'net-lobby.trace.flush-ok': 'flush: ok',
  'net-lobby.invite.empty': 'The invite code is empty: paste the whole invite code the other side sent.',
  'net-lobby.hello-diag.no-link': '(no Line)',
  'net-lobby.room-code.normalized': 'Room code {code} normalized; channel {channel}.',
  'net-lobby.answer.no-invite': 'The invite code has not been read yet: paste the whole invite code from the other side into the box above, then tap this button once it is read.',
  'net-lobby.answer.invite-unreadable': 'This invite code cannot be read, so no answer code can be produced: {detail}',
  'net-lobby.answer.no-capability': 'This environment has no working answer-code capability (the step that produces the answer code was not injected).',
  'net-lobby.answer.building': 'Building the answer code (waiting for this side\'s ICE gathering)...',
  'net-lobby.answer.empty': 'The answer code is empty: paste the whole answer code the other side sent.',
  'net-lobby.answer.not-an-answer': 'This is not the answer the other side replied with, but looks more like an invite code: make sure you paste the answer code the other side gave you after joining.',
  'net-lobby.answer.applied': 'The other side\'s answer has been applied.',
  'net-lobby.copy.ok': 'Copied the {what}.',
  'net-lobby.copy.denied': 'Could not copy (the browser did not grant clipboard permission); select all and copy manually.',
  'net-lobby.copy.unavailable': 'Could not copy (this page has no clipboard API; common when it is not https or localhost); select all and copy manually.',
  'net-lobby.nav.back': '← Back to mode select',
  'net-lobby.title': 'Online match',
  'net-lobby.entry.host.title': 'I host',
  'net-lobby.entry.host.desc': 'You generate an invite code and send it to the other side.',
  'net-lobby.entry.host.btn': 'Host (generate invite code)',
  'net-lobby.entry.guest.title': 'I join',
  'net-lobby.entry.guest.desc': 'Paste the invite code or the whole invite link the other side sent.',
  'net-lobby.entry.guest.btn': 'Join (paste invite code / enter 6-digit code)',
  'net-lobby.invite.h2': 'Send this invite code to the other side',
  'net-lobby.copy.invite.label': 'Copy invite code',
  'net-lobby.what.invite': 'invite code',
  'net-lobby.copy.link.label': 'Copy link',
  'net-lobby.what.link': 'link',
  'net-lobby.invite.link-summary': 'Link form (you can also send the whole link)',
  'net-lobby.paste.h2': 'Paste the invite code the other side sent',
  'net-lobby.paste.read-ok': 'Read it: this is an invite code, and the next step is to try to reach the other side.',
  'net-lobby.paste.read-none': 'No usable invite code was read.',
  'net-lobby.answer.pending-parsing': 'Parsing the other side\'s invite code... once it is read you can show the answer code (no need to paste again).',
  'net-lobby.answer.pending-connecting': 'The invite code has been read and the other side is being reached... once it connects you can show the answer code.',
  'net-lobby.copy.answer.label': 'Copy answer code',
  'net-lobby.what.answer': 'answer code',
  'net-lobby.room-code.h2': 'Enter the 6-digit room code',
  'net-lobby.room-code.submit': 'Connect with this room code',
  'net-lobby.answer-back.h2': 'After the other side answers: paste the answer code',
  'net-lobby.status.h2': 'Connection status',
  'net-lobby.status.phase': 'Session phase: {phase}',
  'net-lobby.status.local-link-up': 'This side\'s Line is up and waiting for the other side to connect.',
  'net-lobby.status.local-link': 'Local Line: {transport} (this only describes this side, not whether the other side is there)',
  'net-lobby.advanced.toggle': 'Advanced / connection settings',
  'net-lobby.advanced.endpoint.h3': 'Signaling endpoint',
  'net-lobby.advanced.endpoint.configured': 'Signaling endpoint configured: {endpoint}',
  'net-lobby.advanced.relay.h3': 'Relay (TURN)',
  'net-lobby.advanced.relay.hint': 'You normally do not need to touch this: the default relay is enough - when the two sides can go direct they go direct, and when a direct connection fails it forwards through the relay automatically. You only need to fill in the three fields below if you want to switch to your own relay.',
  'net-lobby.advanced.relay.toggle': 'Use my own relay (TURN)',
  'net-lobby.advanced.relay.need-all': 'To change it all three must be present (URL, username, credential); once all three are filled in, yours is what counts.',
  'net-lobby.advanced.turn.username': 'TURN username',
  'net-lobby.advanced.turn.credential': 'TURN credential',
  'net-lobby.invite-length.chars': 'This invite code is {chars} characters; {verdict}',
  'net-lobby.invite-length.within': 'it falls inside the measured range for this tier.',
  'net-lobby.invite-length.outside': 'it falls outside the measured range for this tier (longer or shorter than measured) - it still works, but some chat tools may truncate it, so take care when sending.',
  'net-lobby.proto.not-invite': 'This is not an invite code: it does not have the two-part "protocol version.compressed segment" structure.',
  'net-lobby.proto.bad-head': 'The protocol version part of the invite code is not a positive integer (read {head}).',

  /* ── ★ 2026-10-02（英文模式真机走查 B）：`src/net/invite.ts` 的玩家可见文案 ──
   *
   * 中文值在 `zh.ts` 里逐字等于改动前的字面量；这里是英文。
   *
   * ⚠️ `net.invite.newer-version-hint` 的英文值**以空格开头**、
   * `net.invite.no-endpoint.headline` / `no-endpoint.reason` 的英文值**以空格结尾** ——
   * 这三段是**拼接用的片段**（中文句号后面不空格，英文句号后面必须空一格，
   * 而中文值不许动）。`tests/net/invite.test.ts` 有一条腿钉着"英文拼出来不许
   * 出现 `configured.A 6-digit` 这种粘在一起的形态"。
   */
  'net.invite.no-candidates-in-sdp': 'no a=candidate: line in this side SDP yet (come back after ICE gathering finishes)',
  'net.invite.unknown-candidate-line': 'candidate line not recognised: {line}',
  'net.invite.bad-promise': 'Both promise strings must be non-empty and must not contain separators.',
  'net.invite.compress-unsupported': 'This device cannot produce the compressed stream an invite code needs (compression support is missing).',
  'net.invite.compress-failed': 'The compressed result could not be decompressed again (this compression step produced no usable bytes).',
  'net.invite.round-trip-bad': 'The compressed result did not decode back into a usable payload ({reason}): {message}',
  'net.invite.compact-rebuild-incomplete': 'The SDP rebuilt from the compact form is missing ICE credentials or the DTLS fingerprint: this tier is unusable, fall back to the tier that carries the whole SDP.',
  'net.invite.compact-missing': 'This code cannot use the compact form (missing {missing}): fall back to the tier that carries the whole SDP.',
  'net.invite.compact-unknown-candidate': 'This code cannot use the compact form (candidate line not recognised: {line}): fall back to the tier that carries the whole SDP.',
  'net.invite.compact-no-candidates': 'This code cannot use the compact form ({reason}): fall back to the tier that carries the whole SDP.',
  'net.invite.newer-version-hint': ' (Also ask the other side to confirm they are on the newest version: this code may come from a newer format that an older front end cannot read - have them refresh the page and generate a new one, or update this device to the newest version.)',
  'net.invite.bad-utf8': 'The bytes behind this invite code are not valid UTF-8 text; it may have been truncated or altered.',
  'net.invite.bad-json': 'What came out of this invite code is not JSON text (it may be a broken stream that was half decompressed). Ask the other side to copy the invite code again.',
  'net.invite.compact-missing-version': 'The invite code has no format version (item 1 is not an integer): this is not a complete invite code.',
  'net.invite.version-mismatch': 'This invite code has format version {ver}, while this program only accepts {min} (or {compact} for the compact form): the two sides are on different versions, so ask the other side to generate one with the same version.',
  'net.invite.missing-session': 'The invite code has no host session id (sessionId) for this match: without it the host cannot be matched and the handshake is rejected on the spot.',
  'net.invite.compact-material-shape': 'The connection material in this compact invite code is not 4 items (ufrag / pwd / fingerprint / candidates): the payload is incomplete.',
  'net.invite.compact-missing-ice-cred': 'This compact invite code is missing ICE credentials (a=ice-ufrag / a=ice-pwd): neither can be left out, so the payload is incomplete.',
  'net.invite.compact-missing-fingerprint': 'This compact invite code is missing the DTLS fingerprint (a=fingerprint:sha-256): without it the other side cannot be verified, so this invite code cannot be accepted.',
  'net.invite.compact-candidates-not-array': 'The candidates in this compact invite code are not an array: the payload is incomplete.',
  'net.invite.compact-candidate-shape': 'One candidate in this compact invite code is not 4 items (type / address / port / local preference).',
  'net.invite.compact-candidate-type': 'The candidate type in this compact invite code is not recognised (read {prefix}).',
  'net.invite.compact-candidate-address': 'One candidate in this compact invite code has an illegal address or port (the port must be an integer from 1 to 65535).',
  'net.invite.compact-candidate-local-pref': 'One candidate in this compact invite code has a local preference that is not an integer from 0 to 255.',
  'net.invite.compact-no-candidate': 'This compact invite code has no candidates at all: without a usable candidate no connection can be built, so the payload is incomplete.',
  'net.invite.compact-spare': 'In this compact invite code the item after the local material must be an empty array today (it is a spare slot): the payload is incomplete or was altered.',
  'net.invite.compact-setup': 'The a=setup value in this compact invite code is not recognised (read {setup}).',
  'net.invite.compact-missing-promise': 'This compact invite code is missing the promise slots: the payload is incomplete.',
  'net.invite.compact-rebuilt-candidate': 'A candidate line rebuilt from this compact invite code is illegal (the address or port contains characters that do not belong).',
  'net.invite.bad-shape': 'The contents of this invite code are not the shape this program produces (it is not a positional array): the payload is incomplete or was altered.',
  'net.invite.compact-payload-incomplete': 'The payload of this compact invite code is incomplete (session id / material / setup / promise slots have missing items).',
  'net.invite.tuple-len': 'This invite code has only {got} items while this program needs {want}: the payload is missing fields, so even accepting it could not start a match.',
  'net.invite.missing-sdp': 'The invite code has no connection description (sdp): the payload is incomplete, so even accepting it could not build a connection.',
  'net.invite.ice-not-array': 'The candidate list (ice) in this invite code is not an array of strings: the payload is incomplete.',
  'net.invite.missing-host-promise': 'The invite code has no host seed promise: without it the shuffle cannot be verified, so this invite code cannot be accepted.',
  'net.invite.missing-guest-promise': 'The invite code has no guest side-choice promise: the payload is incomplete.',
  'net.invite.empty': 'The invite code is empty: there is nothing in that part of the address bar or in what you pasted. Please copy the whole thing again.',
  'net.invite.no-structure': 'This is not an invite code: it does not have the two-part "protocol version.compressed segment" structure (either that part is missing or it was cut off). Please make sure you copied the whole thing, with nothing extra before or after it.',
  'net.invite.bad-version-head': 'The protocol version at the start of this invite code is not an integer (read "{head}"): this invite code was not produced by this program.',
  'net.invite.bad-marker': 'The compressed part of this invite code carries an encoding marker this program does not recognise ("{marker}"): this invite code was not produced by this program.',
  'net.invite.bad-chars': 'This invite code contains characters that are not part of base64url (the legal characters are A-Z a-z 0-9 - _; there is no + / =). The usual cause is that a chat app truncated it or replaced a character, so please copy the whole thing again.',
  'net.invite.decompress-unsupported': 'This invite code uses a compression method this device cannot open (the code is a compressed tier and this device lacks the matching decompression support). Open this page in a newer browser on this device, or have the other side generate a new invite code on your device.',
  'net.invite.decompress-failed': 'The compressed part of this invite code cannot be decompressed (its contents were altered or cut off). Ask the other side to copy the whole invite code again, and do not change any character by hand.',
  'net.invite.proto-newer': 'This invite code comes from a newer version (the other side is on protocol version {remote}, this device is on {local}): this device may not understand what the other side sends. Update this device to the same version, or have the other side generate a new invite code with the version this device runs.',
  'net.invite.proto-older': 'This invite code comes from an older version (the other side is on protocol version {remote}, this device is on {local}): the other side may not understand what this device sends. Ask the other side to update to the version this device runs.',
  'net.invite.no-endpoint.headline': 'The 6-digit room code path does not work right now: this device has no signaling endpoint configured. ',
  'net.invite.no-endpoint.reason': 'A 6-digit room code needs a middle server to bring the two sides together, and this program has no signaling endpoint configured by default. ',
  'net.invite.no-endpoint.next-steps': 'Use an invite code instead: copy the whole code to the other side and have them paste it in. To use the 6-digit code, first enter a server address under "Advanced / Connection settings".',
  'net.invite.qr-note': 'The QR form carries the same payload as the link form (the return value of encodeInvite); the encoder is a separate task scheduled after T7 (D17), so this task only leaves the interface in place and draws no graphics.',

  /* ── ★ 2026-10-02（走查 B）：`src/ui/net-browser.ts` 里**走查实测到的那几处** ── */
  'net-browser.invite.empty': 'The invite code is empty: there is nothing in that part. Please copy the whole thing again.',
  'net-browser.invite.no-structure': 'This is not an invite code: it does not have the two-part "protocol version.compressed segment" structure (either that part is missing or it was cut off).',
  'net-browser.ice.early-enough.relay': 'Local candidates and a relay address are in hand - that is enough, so we are not waiting for the rest.',
  'net-browser.ice.early-enough.srflx': 'Local candidates and a public mapping are in hand - that is enough, so we are not waiting for the rest.',
  'net-browser.ice.partial.only-host': 'Waited {sec} seconds and got no public mapping (srflx) at all; only local candidates were gathered: {candidates}.',
  'net-browser.ice.partial.incomplete': 'Waited {sec} seconds and ICE gathering did not finish; what is in hand: {candidates}.',
  'net-browser.ice.partial.relay-missing': 'You configured a relay, but no relay address arrived this round either.',
  'net-browser.ice.partial.tail': 'These candidates have been written into this invite code. Two windows on the same machine, or two devices on the same local network, can usually connect with them; whether it works across networks (the two sides not on the same local network) is not known yet - that needs a public mapping or a relay address, and this round did not get all of them.',
  'net-browser.ice.no-candidate-timeout': 'Waited {sec} seconds and this device gathered no ICE candidate at all this time (not even a local one). A connection description with no candidate cannot connect even if it is sent, so this invite code is not generated. Next step: check that a browser extension or an enterprise policy has not turned WebRTC off (this program only uses it for direct connections), then try again; if there is still no candidate, please copy this line down as it is.',
  'net-browser.ice.no-candidate-now': 'ICE gathering has finished, but this device has no candidate at all this time (not even a local one); such a connection description cannot connect even if it is sent, so this invite code is not generated. Next step: check that a browser extension or an enterprise policy has not turned WebRTC off (this program only uses it for direct connections), then try again; if there is still no candidate, please copy this line down as it is.',

  /* ── ★ 2026-10-02（P3 第三批）：the 4 interface labels of the first-run consent screen ──
   * Same labels as `onboarding.consent.{title,grant,deny,privacy}`; the wording below matches
   * those keys word for word. The consent body (three paragraphs + `denyHint`) still comes from
   * `src/app/privacy.ts` and is pinned by whole-sentence hashes, so it stays Chinese for now. */
  'consent.title': 'Remember your settings on this device?',
  'consent.grant': 'Yes, save them on this device',
  'consent.deny': 'No, not this time',
  'consent.privacy-link': 'Privacy notes',

  /* ── ★ 2026-10-02（P3 第三批）：board chrome of `src/ui/render.ts` ── */
  'render.player-info.title': 'Player {n}',
  // 原文是「（请操作！）」/「（回合中）」两个**后缀**，直接接到标题后面（英文用逗号分隔更好读）
  'render.player-info.operating': ' (your move!)',
  'render.player-info.active': ' (turn)',
  'render.meta.deck': 'Deck {n}',
  'render.meta.trash': 'Discard {n}',
  'render.meta.hand': 'Hand {n}',
  'render.trash.label': 'Discard',
  'render.trash.view': 'View discard pile',
  'render.deck.gameover-title': 'Game over: view the cards left in the deck and the draw order',
  'render.refresh-hand': 'Refresh hand',
  'render.step': 'Step: {step}',
  'render.control.neutral': 'Control: neutral',
  'render.control.player': 'Control: player {n}',
  'render.hand-shield.count': 'Hand {n}',
  'render.next-step': 'Next',
  'render.diag.export': 'Export log',
  'render.diag.export-title': 'Export a diagnostic log (errors + console output + event log + state snapshot)',

  /* ── ★ 2026-10-02 (P3 batch 4): choice bar / draft page / overlay chrome of `src/ui/render.ts` ──
   *
   * `render.choice.title` / `render.draft.filter-tip` / `render.hand.count` keep the same
   * separator characters as the Chinese source (`—` / `·` / `×`); `render.preview.hint`
   * keeps its embedded newline (the panel renders it as two lines).
   * `render.draft.progress-pick` / `...-ban` are two **different** sentences, not variants
   * of one value — they map one-to-one onto the two branches of the original template. */
  'render.hand.count': 'Hand ×{n}',
  'render.hand.flip': 'Flip',
  'render.hand.hint-selected': 'Card selected — drag it onto a highlighted line to play it (hit "Flip" first to change its facing)',
  'render.hand.hint-idle': 'Drag a hand card onto a highlighted line to play it (double-click to zoom, click to select)',
  'render.action.compile-line': 'Compile line {n} ({a} vs {b})',
  'render.action.resolve-trigger': 'Resolve trigger: {defId}',
  'render.action.clear-cache': 'Clear cache',
  'render.choice.operator': '{name}, your choice',
  'render.choice.title': '{who} — {title}',
  'render.choice.count': 'Selected {n}/{max}',
  'render.choice.pick-count': 'Selected {n}/{max}',
  'render.choice.confirm': 'Confirm',
  'render.choice.skip': 'Skip',
  'render.choice.hint-line': 'Click a highlighted line to pick it as the target',
  'render.choice.pick-hint': 'Click to select / click again to deselect, double-click to zoom; then hit "Confirm"',
  'render.choice.note-rearrange': 'In the "Rearrange protocols" window, click two protocols to swap them, then hit "Finish rearrange".',
  'render.draft.picks-title': 'Player {n} picked',
  'render.draft.seat-self': ' (you)',
  'render.draft.seat-foe': ' (opponent)',
  'render.draft.picks-turn': '● picking now',
  'render.draft.pick-empty': 'Not picked yet',
  'render.draft.unpick-hint': 'Drag it out of the pick box to undo this turn\'s pick',
  'render.draft.ban-tip': 'Click to ban "{name}" (unavailable this game; {n} bans in total)',
  'render.draft.ban-badge': 'Banned',
  'render.draft.group.mn01': 'Gen 1 core',
  'render.draft.group.ax01': 'Gen 1 expansion',
  'render.draft.group.mn02': 'Gen 2 core',
  'render.draft.group.ax02': 'Gen 2 expansion',
  'render.draft.group.mn03': 'Gen 3 core',
  'render.draft.group.ax03': 'Gen 3 expansion',
  'render.draft.gen-1': 'Gen 1',
  'render.draft.gen-2': 'Gen 2',
  'render.draft.gen-3': 'Gen 3',
  'render.draft.verb-pick': 'Pick a protocol · {n} left this turn',
  'render.draft.verb-ban': 'Ban a protocol · {n} more to ban this phase ({total} in total)',
  'render.draft.progress-pick': 'Pick {n} / {total}',
  'render.draft.progress-ban': 'Pick {n} / {total} · ban phase',
  'render.draft.filter-tip': '{name} ({n} sets in this game\'s pool) · {action}',
  'render.draft.filter-hide': 'click to hide',
  'render.draft.filter-show': 'click to show',
  'render.draft.random-pool-note': 'Random pool this game: {n} of the {total} protocols were drawn at random (generation filters still work)',
  'render.draft.ban-mode-note': 'Ban mode: second player bans 2 first → first player picks 1, bans 1 → second player picks 2, bans 1 → first player picks 2, bans 2 → second player picks 1',
  'render.draft.filter-hint': 'Only {n} protocols visible, {left} pick/ban actions left — turn some hidden generations back on.',
  'render.preview.position': 'Role: {position}',
  'render.preview.commands': 'Keywords: {commands}',
  'render.preview.pairs-label': 'Good pairings',
  'render.preview.styles-label': 'Recommended styles',
  'render.preview.hint': 'Click a protocol card in the middle\nto pin its details here',
  'render.win.title': 'Player {n} wins!',
  'render.win.sub': 'Game over · you can keep reviewing the board',
  'render.win.back': 'Back to main menu',
  'render.zoom.motto-label': 'Motto: ',
  'render.zoom.keywords-label': 'Keywords: ',
  'render.zoom.compiled': 'Compiled',
  'render.zoom.uncompiled': 'Not compiled',
  'render.zoom.view-back': 'View back',
  'render.zoom.view-front': 'View front',
  'render.trash-viewer.title': "Player {n}'s discard pile",
  'render.trash-viewer.empty': 'Discard pile is empty',
  'render.deck-order.title': "Player {n}'s deck (game over · top to bottom = draw order)",
  'render.deck-order.empty': 'Deck is empty',
  'render.deck-order.next': 'Next',
  'render.deck-order.after': 'in {n} cards',

  /* ── ★ 2026-10-02 (P3 batch 4): page-specific chrome of `src/ui/render-net.ts` ──
   *
   * Same-sentence strings shared with the hot-seat board reuse the `render.*` keys
   * (`render.choice.*` / `render.action.{resolve-trigger,clear-cache}` / `render.next-step` /
   * `render.diag.*`). `render-net.action.compile-line` is a **separate** key on purpose:
   * the hot-seat sibling carries the `(mine vs theirs)` values, this page's does not. */
  'render-net.conn.local-preview': '● Local preview (not connected)',
  'render-net.lane.name': 'Line {n}',
  'render-net.choice.operator': 'Player {n}, your choice',
  'render-net.info.seat-self': 'You',
  'render-net.info.seat-foe': 'Opponent',
  'render-net.action.compile-line': 'Compile line {n}',
  'render-net.hand.hint-selected': 'Card picked → click a highlighted lane slot to play it',
  'render-net.hand.hint-idle': 'Click a hand card → click a lane slot to play it (double-click to zoom)',
  'render-net.hand.foe-count': 'Opponent hand ×{n}',
  'render-net.zoom.foe-hand-title': 'Opponent hand',
  'render-net.zoom.foe-hand-unknown': 'Opponent hand (contents hidden)',
  'render-net.zoom.foe-hand-count': 'Opponent hand ×{n} (contents hidden)',
  'render-net.zoom.unknown': 'Hidden',
  'render-net.zoom.back-note': 'Hidden: this card is face down (its contents stay invisible until the opponent flips it)',
  'render-net.zoom.compiled-suffix': ' (compiled)',
  'render-net.zoom.box-title': 'Card zoom box',
  'render-net.zoom.box-hint': 'Hover a card / protocol: it zooms in here with its Chinese text; click to pin',
  'render-net.preview.title': 'Preview toolbar',
  'render-net.preview.seat-1': 'View: I am P1 ⇄ P2',
  'render-net.preview.seat-2': 'View: I am P2 ⇄ P1',
  'render-net.preview.seat-tip': 'Switch to the opponent\'s view: after switching, "you" are the opponent (hand face up and clickable). This is the right way to push the opponent\'s turn forward and finish a game (the opponent\'s hand-count row is not clickable).',
  'render-net.preview.hint-answer': 'Waiting for the opponent (P{n}) to answer — this page only shows information, no buttons; switch "view" to act',
  'render-net.preview.hint-act': 'It is the opponent\'s turn (P{n}) — this page only shows information, no buttons; switch "view" to act',
  'render-net.preview.note': 'View switched: I am P{n}',

  /* ── 2026-10-02 (P3 batch 5): the remaining 80 player-visible strings of
   * `src/ui/net-browser.ts` (compression probes / fallback chain, signaling endpoint,
   * ICE gathering, getStats, offer/answer, transport send). The developer-only `throw`
   * messages of that file stay Chinese on purpose (registered in the manifest's DEV_ONLY). */
  'net-browser.relay.unavailable-why': 'No relay is available this round ({why}), so only a direct connection can be tried: inside one local network that usually connects directly, across networks it may not. Try again in a moment.',
  'net-browser.relay.unavailable-plain': 'No relay is available this round, so only a direct connection can be tried: inside one local network that usually connects directly, across networks it may not.',
  'net-browser.candidate.none': 'none at all',
  'net-browser.candidate.kind.host': 'local (host)',
  'net-browser.candidate.kind.srflx': 'public mapping (srflx)',
  'net-browser.candidate.kind.prflx': 'peer mapping (prflx)',
  'net-browser.candidate.kind.relay': 'relay',
  'net-browser.candidate.kind.other': 'unrecognized type',
  'net-browser.candidate.count': '{label}: {n}',
  'net-browser.compress.probe-no-stream': 'This device\'s browser has no compression stream support (CompressionStream is missing).',
  'net-browser.compress.readable.no-probe': 'The compression capability probe on this device returned nothing, so the invite code was not generated. Please refresh the page and try again.',
  'net-browser.compress.readable.all-failed': 'This device\'s browser supports none of the compression formats this program uses ({formats}), and the "no compression" fallback did not work either. Please open this page in a newer browser and try again.',
  'net-browser.compress.readable.some-failed': 'This device cannot produce an invite code: among the usable compression formats, {failed} does not work, and the no-compression fallback did not work either ({ok} passed the probe but produced no usable bytes). Please refresh the page and try again; if it keeps happening, open this page in a newer browser.',
  'net-browser.compress.format.unavailable': 'This compression format ({format}) is not available on this device; trying the next one.',
  'net-browser.compress.no-stream': 'This device\'s browser has no compression stream support, so the invite code cannot be generated (the peer can still use the "type the 6-character code" route).',
  'net-browser.compress.note.no-stream': 'Compression stream support is missing (neither CompressionStream nor DecompressionStream exists).',
  'net-browser.compress.format.no-bytes': 'This compression format ({format}) produced no usable bytes; trying the next one.',
  'net-browser.compress.prefer.used': 'Produced with the format the caller asked for ({kind}) (the fallback chain was not used).',
  'net-browser.compress.prefer.unusable': 'The format the caller asked for ({kind}) is not usable on this device; falling back to the fallback chain.',
  'net-browser.compress.fallback.from': 'The fallback chain became usable here (skipped earlier: {skipped}).',
  'net-browser.compress.roundtrip-failed': 'It compresses but does not decompress ({reason}); continuing down the chain.',
  'net-browser.compress.prepare-failed': 'The invite code could not be generated: this device hit an error while preparing its compression capability. Please refresh the page and try again; if it keeps happening, open this page in a newer browser.',
  'net-browser.decompress.format-failed': 'This device\'s browser cannot decompress this format ({format}): {detail}',
  'net-browser.decompress.no-stream': 'This device\'s browser has no decompression stream support, so this invite code cannot be opened.',
  'net-browser.decompress.empty-segment': 'The compressed segment of this invite code is empty.',
  'net-browser.decompress.empty-result': 'This invite code decompressed to nothing.',
  'net-browser.decompress.corrupt': 'The compressed segment of this invite code cannot be decompressed (its contents were altered or truncated).',
  'net-browser.invite.bad-marker-segment': 'The compressed segment of this invite code carries an encoding marker this program does not recognize ("{marker}"): this invite code was not produced by this program.',
  'net-browser.invite.not-base64url': 'The compressed segment is not base64url, so no bytes can be decoded.',
  'net-browser.address-bar.no-invite': 'There is no invite code in the address bar (this is not an error, there is simply nothing readable there).',
  'net-browser.signal.bad-endpoint': 'The signaling endpoint in settings is not a signaling address: it must start with wss:// or ws://. Please change it under "Advanced / connection settings" to the address your peer gave you.',
  'net-browser.signal.unreachable': 'None of these signaling endpoints could be reached. You can switch to an invite code instead (the invite-code route needs no signaling endpoint: the two sides hand their connection descriptions to each other directly; with the default configuration, when a direct connection fails the traffic goes through that default relay), or try another endpoint.',
  'net-browser.signal.no-capability': 'This device has no usable signaling connection capability, so the short-code route is not available. Please use an invite code instead.',
  'net-browser.signal.closed': 'Signaling is already closed.',
  'net-browser.signal.not-open': 'Signaling is not connected yet, so this message was not sent.',
  'net-browser.signal.send-failed': 'Signaling send failed: {detail}',
  'net-browser.ice.no-description': 'This side has no connection description to send yet (`setLocalDescription` did not succeed, or the implementation does not expose it).',
  'net-browser.ice.no-ticker': 'This device has no usable timing capability, so it cannot decide "how long to wait for ICE gathering counts as a timeout"; rather than hang silently, it will not generate an invite code this round (please retry).',
  'net-browser.ice.no-connection': 'This connection does not exist yet (`pc` has not been created).',
  'net-browser.ice.no-getstats': 'This connection does not provide `getStats()`, so it cannot be read whether traffic goes through a relay.',
  'net-browser.ice.stats-failed': 'Reading connection statistics failed: {detail}',
  'net-browser.ice.stats-not-iterable': '`getStats()` did not return an iterable report.',
  'net-browser.ice.no-nominated-pair': 'There is no "nominated and succeeded" candidate pair yet (the link is still being established), so at this moment it cannot be told whether this is direct or relayed.',
  'net-browser.offer.no-set-remote': 'This device\'s connection implementation does not accept a "remote description" (`setRemoteDescription` is missing), so it cannot produce an answer.',
  'net-browser.offer.no-create-answer': 'This device\'s connection implementation cannot produce an answer (`createAnswer` is missing), so this invite code cannot be answered.',
  'net-browser.offer.no-offer-sdp': 'This invite code carries no usable connection description (the sdp is empty).',
  'net-browser.offer.set-remote-failed': 'Could not accept the peer\'s connection description: {detail}',
  'net-browser.offer.answer-failed': 'This side could not produce an answer: {detail}',
  'net-browser.offer.set-local-failed': 'This side\'s answer could not be applied to the connection: {detail}',
  'net-browser.answer.no-set-remote': 'This device\'s connection implementation does not accept a "remote description" (`setRemoteDescription` is missing).',
  'net-browser.answer.no-sdp': 'This answer code carries no usable connection description (the sdp is empty).',
  'net-browser.answer.set-remote-failed': 'Could not accept the peer\'s answer: {detail}',
  'net-browser.transport.peer-online': 'The peer is connected (this reading comes only from state events; init() returning ok does not mean it).',
  'net-browser.transport.peer-offline': 'The connection to the peer dropped (this reading comes only from state events, it does not look at init()).',
  'net-browser.transport.no-peer-connection': 'This device has no usable peer connection capability (a secure context is required), so online play is not available.',
  'net-browser.transport.connecting': 'Establishing this side\'s link (self {self}, peer {peer}).',
  'net-browser.transport.probe-restored-peer': 'Probe recovery: the opponent recreated the channel.',
  'net-browser.transport.probe-cut': 'Probe link cut: the data channels were closed (this side really cannot send anymore).',
  'net-browser.transport.probe-restored': 'Probe recovery: the channels were recreated.',
  'net-browser.transport.offer-failed': 'This side\'s connection description could not be created: {detail}',
  'net-browser.transport.not-initialized-sdp': 'This side\'s link is not established yet (init has not succeeded), so there is no connection description right now.',
  'net-browser.transport.no-gather': 'This side is not waiting for ICE gathering (this implementation does not hand out a connection description).',
  'net-browser.transport.closed': 'This game is already over; nothing can be sent.',
  'net-browser.transport.not-initialized-send': 'This side\'s link is not established yet (init has not succeeded), so this message was not sent.',
  'net-browser.transport.no-channel': 'Channel {channel} has not been created yet.',
  'net-browser.transport.queue-full': 'The outgoing queue is too backed up, so this frame is not being sent (try again once it drains).',
  'net-browser.transport.peer-unreachable': 'The peer is unreachable, so this message was not sent (this is a transport-layer reading, not "the game is over").',
  'net-browser.transport.send-failed': 'Send failed: {detail}',
  'net-browser.transport.closed-final': 'This game is over (closed is irreversible, it cannot be reconnected).',

  /* ── 2026-10-02 (P3 batch 7): the 7 bare-Chinese strings of `src/ui/turn-cred.ts`.
   *
   * `turn-cred.reason.*` is the half a player really sees: it lands in the `{why}` slot of
   * `net-browser.relay.unavailable-why`. Before this batch that slot stayed Chinese under
   * `lang=en` (ledger G.3 item 1) — that gap is now closed: the whole sentence is CJK-free.
   * `turn-cred.detail.*` / `turn-cred.error.no-fetch` ride the `detail` field of the same
   * reading (the `lastFailure()` / `#g5probe=1` diagnostics), not the on-screen sentence;
   * they are moved too so that no Chinese string of this layer can leak into an English UI.
   *
   * ⚠️ The full-width parentheses around the reason used to be hardcoded in `net-browser.ts`;
   * they moved into the zh value of `net-browser.relay.unavailable-why` (the rendered Chinese
   * sentence is byte-identical), so the English side now reads `... this round (reason), so ...`
   * with half-width parentheses. */
  'turn-cred.reason.timeout': 'the credential service did not answer in time',
  'turn-cred.reason.rejected': 'the credential service refused this request',
  'turn-cred.reason.malformed': 'the reply from the credential service could not be read',
  'turn-cred.reason.unreachable': 'the credential service could not be reached',
  'turn-cred.detail.timeout': 'waited {ms} ms with no reply',
  'turn-cred.detail.malformed': 'the reply is missing fields or has the wrong shape',
  'turn-cred.error.no-fetch': 'This device has no fetch capability',

  /* ── ★ 2026-10-02 (P3 batch 8): src/app/archive-io.ts archive import failures ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'archive-io.empty': 'The archive file is empty.',
  'archive-io.too-large': 'The archive is too large ({bytes} bytes > the {limit}-byte limit): this program will not read it.',
  'archive-io.bad-created-at': 'The archive\'s createdAt is not a valid ISO instant ({createdAt}): the exported file name falls back to a predictable form containing "{stamp}". This does not affect replay, and the archive still opens.',

  /* ── ★ 2026-10-02（P3 第八批）：src/app/match-file.ts 的档案解析失败原因 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'match-file.bad-action.not-object': 'Action {i} is not an object.',
  'match-file.bad-action.seq-not-integer': 'Action {i} has a seq that is not a non-negative integer.',
  'match-file.bad-action.seq-mismatch': 'Action {i} has seq={seq}, which does not match its position (section 3.1 requires seq to increase from 0, monotonically and without gaps).',
  'match-file.bad-action.bad-player': 'Action {i} has a player that is not 0/1.',
  'match-file.bad-action.unknown-kind': 'Action {i} has an unknown kind: {kind}',
  'match-file.bad-action.unknown-via': 'Action {i} has an unknown via: {via}',
  'match-file.bad-action.unexpected-args': 'Action {i} ({kind}) must not carry args.',
  'match-file.bad-action.missing-args': 'Action {i} ({kind}) is missing args.',
  'match-file.bad-action.missing-arg-key': 'Action {i} ({kind}) is missing the args key {k}.',
  'match-file.bad-shape.setup-not-object': 'setup is not an object.',
  'match-file.bad-shape.draft-mode': 'setup.draftMode is invalid.',
  'match-file.bad-shape.draft-starter': 'setup.draftStarter is invalid.',
  'match-file.bad-shape.first-to-play': 'setup.firstToPlay is invalid.',
  'match-file.bad-shape.draft-pool': 'setup.draftPool is invalid.',
  'match-file.bad-shape.draft-picks': 'setup.draftPicks is invalid.',
  'match-file.bad-shape.banned-protocols': 'setup.bannedProtocols is invalid.',
  'match-file.bad-shape.clock': 'setup.clock is invalid.',
  'match-file.bad-shape.clock-field': 'setup.clock.{k} is invalid (it must be a finite number).',
  'match-file.bad-shape.result-not-object': 'result is not an object.',
  'match-file.bad-shape.result-winner': 'result.winner is invalid: {winner} (it must be 0 / 1 / null).',
  'match-file.bad-shape.result-reason': 'result.reason is invalid: {reason}',
  'match-file.bad-shape.players-not-pair': 'players must be an array of length 2.',
  'match-file.bad-shape.player-nick': 'players[{i}].nick is invalid.',
  'match-file.bad-version.unknown': 'The archive version is invalid: {version}',
  'match-file.too-new': 'The archive comes from a newer version of the game (archive v{v}, this build supports v{currentVersion}). Please update the game; this program will not guess how to read it.',
  'match-file.missing-migration': 'No migration step from v{v} to v{next}.',
  'match-file.not-json': 'The archive is not valid JSON (the file may be damaged).',
  'match-file.not-object': 'The archive\'s top level is not an object.',
  'match-file.bad-format': 'This is not a Compile match archive (format={format}).',
  'match-file.bad-seed': 'seed is invalid (it must be a non-empty string: replay depends on it).',
  'match-file.bad-card-data-hash': 'cardDataHash is invalid.',
  'match-file.bad-actions': 'actions is not an array.',
  'match-file.card-data-mismatch': 'The card data differs from this machine (archive {archiveHash}, this machine {currentHash}): the same sequence of actions may produce different results. You can still open it, but online play will reject it.',
  'match-file.unknown-protocol': 'A protocol defId in the archive does not exist on this machine: {defId} (card data version mismatch?)',

  /* ── ★ 2026-10-02（P3 第八批）：src/main.ts 的联机交接提示（client.showNotice 一族 + lobbyLinkFailureText） ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'main.notice.resync-fork': 'Catch-up failed: this side has already reached step {local}, but the peer\'s archive only has {n} steps — that means the two sides ran different actions (a fork). Nothing on this side has changed: overwriting it would only hide the fork, and this match can no longer agree with the peer. Please end this match and record it honestly.',
  'main.notice.resync-replay-failed': 'Catch-up failed: replaying the peer\'s archive does not produce a state ({detail}); this side\'s state is unchanged.',
  'main.notice.link-dead-before-start': 'The connection dropped and this match had not started: generate a new invite code / join again. (This drop left no resumable match progress — it is neither "reconnected" nor "resumed".)',
  'main.lobby-link.no-peer-conn-answer': 'This machine has not established the peer connection used to carry messages yet (let the link come up first, then produce the answer code).',
  'main.lobby-link.no-peer-conn-apply': 'This machine has not established the peer connection yet (host a game to generate an invite code first, then paste the answer code back).',
  'main.lobby-link.cause-with-init': '{message} Failure reason: {initMessage}',
  'main.lobby-link.state-idle': '(The transport is idle right now: it has not even created the local connection, which means init() did not succeed.)',
  'main.lobby-link.state-other': '(The transport is {status} right now: the local connection exists, but the connection description is not available yet.)',
  'main.lobby-link.next-step': '{cause}{state}Next step: click "Generate invite code" once more to retry; if it still fails, write down this whole line together with the sentence under "Failure reason" (that sentence is the real cause, not a guess).',
  'main.notice.link-building-invite': 'Building the link… (the invite code is generated automatically once it is up, no need to click again)',
  'main.lobby-link.wait-timeout-invite': 'Waited {seconds} seconds and the local link still is not up (init has not succeeded, so there is no connection description to give).',
  'main.lobby-link.init-returned': 'init returned {reason}: {initMessage}',
  'main.notice.link-building-prefix': 'Building the link',
  'main.notice.no-local-description-invite': 'This implementation does not provide a connection description (there is no `localDescription`), so an invite code cannot be generated.',
  'main.lobby-link.no-usable-description': 'This side has no usable connection description, so an invite code cannot be generated.',
  'main.notice.invite-threw': 'The invite-code step threw an error and no invite code was produced: {detail}',
  'main.notice.link-building-answer': 'Building the link… (the answer code is shown automatically once it is up, no need to click again)',
  'main.lobby-link.wait-timeout-answer': 'Waited {seconds} seconds and the local link still is not up (init has not succeeded, so the answer code cannot be produced).',
  'main.notice.replay-stopped': 'Replay stopped at this step: the archive\'s next entry was not accepted (the replay state and the archive are out of sync).',
  'main.notice.no-match-record': 'This session has no match record yet: finish a match first, then export.',
  'main.rearrange.commit-label': 'Finish rearranging',
  'main.rearrange.skip-label': 'Skip',

  /* ── ★ 2026-10-02（P3 第八批）：src/ui/control-rearrange.ts（控制权重排浮层）的界面文案 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'control-rearrange.hint.draft': 'Click two protocols to swap their positions (you can swap several times); when you are done, click "Finish rearranging" to apply it all at once (the button stays disabled until something changes).',
  'control-rearrange.hint.locked': 'Rearranging is locked to player {side}\'s protocols: click one, then click another to swap them, as many times as you like; the other player\'s protocols can no longer be touched.',
  'control-rearrange.hint.pick': 'Click the protocols of the player you want to rearrange (click one, then click another to swap them); after the first swap that player is locked in and you cannot switch sides.',
  'control-rearrange.player-1': 'Player 1',
  'control-rearrange.player-2': 'Player 2',
  'control-rearrange.line-tag': 'Line {line}',
  'control-rearrange.compiled-tag': 'Compiled',
  'control-rearrange.moved-tag': 'Was line {line}',

  /* ── ★ 2026-10-02（P3 第八批）：src/net/session.ts 的拒绝原因（refusal.message / verdict.message / SendResult.message） ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'session.hash.bad': 'The hash function injected into session.ts (HashLike) did not return a usable hash string: got {got}. This module is not asynchronous (D15): to use it synchronously, inject a synchronous implementation; an asynchronous wrapper (the real one lives in src/ui/net-browser.ts, T7) yields a Promise, which is not a hash string.',
  'session.caller.not-non-empty-string': 'The {what} passed to session.ts must be a non-empty string (got {v}). This is a caller contract violation, not network input.',
  'session.resync.not-wired': 'Received a resync-req, but this side has no archive to send (the caller never wired up a "current archive" source, or that source is empty right now), so no resync-res can be sent. This is not "catch-up already done" — please check the wiring: is the current archive reader fed into this session? (The host holds the reconnect credential; the guest does not.)',
  'session.refuse.duplicate-reveal-seed': '{side} has already seen a reveal-seed, and a second one is not accepted: the same commitment reveals its seed exactly once. If the peer did not receive it, have it resend commit-ack rather than reveal the seed again.',
  'session.refuse.reveal-seed-after-complete': 'This match has already finished the commitment flow (both seed and salt were revealed), so another reveal-seed can only mean the peer replayed the flow. Rejected.',
  'session.refuse.bad-salt': 'The reveal-salt that arrived has no usable salt (empty string / missing / not a string). Rejected.',
  'session.refuse.early-salt': 'The current phase is {phase} and a reveal-salt arrived: the salt is revealed **by the host, after the match ends**, and this side has not revealed its seed yet (or the handshake has not even completed), so this message can only mean the peer got the direction wrong or replayed early. Rejected, and no state is changed.',
  'session.refuse.salt-before-face': 'The current phase is {phase} and the salt cannot be revealed yet: the salt is sent only **after the peer\'s reveal-face arrives** (that is when the match counts as "finished", the last step of design section 5.3). Sending the salt early pushes the phase to `complete`, and at that point `reveal-face` can no longer come in -- the host would never get the face the peer picked -- so this side does not accept that order.',
  'session.refuse.non-object-message': 'The message is not an object.',
  'session.refuse.missing-t': 'The message has no t field.',
  'session.internal.bad-outbound-shape': '{detail} (the shape is invalid, so this side does not send anything out)',
  'session.hello.already-refused': 'This handshake has already been refused by this side.',
  'session.hello.already-established': 'The handshake already succeeded (this match is already in the commitment flow).',
  'session.refuse.guard-ignored': '{what}: {why}, and the current phase is {phase} -- this side **ignores** it and the session state is left completely untouched.',
  'session.hello.already-done': 'Steps that are already done will not roll back just because the handshake was resent; if a new match is really wanted, handshake again with a new sessionId.',
  'session.hello.too-late': 'This hello arrived too late and was ignored (the session is unchanged).',
  'session.hello.direction-reversed': 'Received a {what}: hello may only be sent **by the joiner** to the host, and this side is the joiner, so this message is going the wrong way. This side ignores it and changes no state (what this side is waiting for is the hello-ack).',
  'session.hello.direction-reversed-detail': 'The hello is going the wrong way (this side is the joiner), so it was ignored.',
  'session.hello.duplicate': 'A duplicate or late hello.',
  'session.hello-resume.bad-handshake': 'A reconnect handshake (hello.resuming === true) failed handshake validation.',
  'session.hello-resume.bad-handshake-why': 'The reason validation gave is: {message}',
  'session.hello-resume.claims-spectator': 'A reconnect handshake (hello.resuming === true) claims to be a spectator.',
  'session.hello-resume.waiting-for-resync': 'The peer is back with the same sessionId (hello.resuming === true): this side keeps the current match and waits for it to request catching up (resync-req); the match does not advance until catching up is done.',
  'session.hello-ack.direction-reversed': 'Only the host may send a hello-ack and only the joiner may receive one, but this side is the host, so the direction of the hello-ack that arrived is wrong.',
  'session.hello-ack.bad-shape': 'The hello-ack that arrived has the wrong shape (missing sessionId / peerNick / seat). Rejected, and no state is changed.',
  'session.hello-ack.bad-proto-version': 'The protoVersion in the hello-ack that arrived is not a number. Rejected, and no state is changed.',
  'session.hello-ack.version-mismatch': 'The game versions do not match; please have both sides update to the latest version (peer protocol v{theirVersion}, this machine v{localVersion}).',
  'session.hello-ack.not-ours': 'The hello-ack that arrived belongs to another match (the peer answered with sessionId {sessionId}, while this match is {theirSession}). Rejected, and no state is changed.',
  'session.hello-ack.duplicate': 'The current phase is {phase}, so a second hello-ack is not accepted.',
  'session.commit.not-yet': 'The current phase is {phase} and a commit cannot be sent yet: the commitment comes before the whole commitment flow (step 2 of design section 5.3), and that only makes sense after a successful handshake.',
  'session.commit.bad-hash': 'The commit-face that arrived has no usable hash (empty string / missing / not a string), so the commitment does not hold and it is rejected.',
  'session.refuse.commit-face-wrong-phase': 'The current phase is {phase} and a commit-face arrived at this point:',
  'session.refuse.handshake-incomplete': 'The handshake is not complete yet.',
  'session.refuse.commit-already-received': 'This commitment has already been received.',
  'session.internal.phase-without-seed': 'session.ts is internally inconsistent: the phase is already face-committed but there is no seed yet (did sendCommit fail to set one?).',
  'session.side.host': 'the host',
  'session.reveal-face.bad-face': 'The face of the reveal-face that arrived is not 0/1. Rejected.',
  'session.reveal-face.bad-nonce': 'The reveal-face that arrived has no usable faceNonce (empty string / missing). Rejected.',
  'session.refuse.reveal-face-wrong-phase': 'The current phase is {phase} and a reveal-face arrived at this point (the commitment flow is out of order). Rejected.',
  'session.internal.phase-without-commit': 'session.ts is internally inconsistent: the phase reached seed-revealed but there is no commitment hash from the joiner.',
  'session.reveal-face.hash-mismatch': 'The face the joiner revealed does not match its earlier commitment: the hash(face, faceNonce) that arrived differs from the hash in the commit-face. This means the face it is giving now is not the one fixed at commitment time. Please end this match and record it faithfully.',
  'session.internal.salt-without-commit': 'session.ts is internally inconsistent: the salt is about to be revealed before a commit was ever sent (did sendCommit fail to set one?).',
  'session.salt.already-revealed': 'This reveal-salt has already been sent once and is not sent again: the same commitment reveals its salt exactly once.',
  'session.commit.no-hash': 'The commit that arrived has no usable hash (empty string / missing / not a string). Rejected.',
  'session.refuse.commit-wrong-phase': 'The current phase is {phase}, so a commit is not accepted at this point (either the handshake is not complete yet or this one is a duplicate).',
  'session.commit-ack.not-yet': 'The current phase is {phase} and a commit-ack cannot be sent yet: receive the host\'s commit first, then acknowledge it (step 3 of design section 5.3).',
  'session.caller.face-out-of-range': 'commitFace in session.ts received an out-of-range face {face} (the contract is 0 | 1). This is a caller contract violation.',
  'session.reveal-face.not-yet': 'The current phase is {phase} and a commit-face cannot be submitted yet:',
  'session.reveal-face.await-host-commit': 'Receive the host\'s commit first (otherwise the commitment of the face would come before the commitment of the seed).',
  'session.reveal-face.already-submitted': 'This commitment has already been submitted.',
  'session.reveal-seed.bad-seed': 'The reveal-seed that arrived has no usable seed (empty string / missing / not a string). Rejected.',
  'session.side.guest': 'the guest',
  'session.internal.face-without-commit': 'session.ts is internally inconsistent: the face is about to be revealed before a commit-face was ever submitted.',
  'session.reveal-face.await-seed': 'The current phase is {phase} and the face cannot be revealed yet: receive the host\'s reveal-seed first (step 4 of design section 5.3).',
  'session.internal.verify-salt-too-early': 'session.ts is internally inconsistent: the salt is about to be verified before the seed or the commitment was obtained (was the salt-receive guard loosened?).',
  'session.salt.hash-mismatch': 'The salt the host revealed does not match its earlier commitment: the hash(seed, salt) that arrived differs from the hash in the commit. This means the current (seed, salt) pair is not the one fixed at commitment time; record it faithfully and do not treat it as a normal match start.',
  'session.resync.cannot-mark': 'The current phase is {phase} and this match cannot be marked as a reconnect: it is already in the commitment flow, and "becoming a reconnect" only means something for a joiner that has not finished the handshake.',
  'session.resync.marked': 'This side explicitly declared this handshake a reconnect (markResuming): it now waits for the host\'s hello-ack and then sends a resync-req to ask for the match file. Until applyResyncFile succeeds, this side\'s engine state has not caught up.',
  'session.resync.req-not-object': 'The resync-req that arrived is not an object. Rejected, and no state is changed.',
  'session.resync.req-not-ours': 'The resync-req that arrived does not belong to this match (it reports sessionId {sessionId}, while this match is {theirSession}). Rejected, and no match file is sent back.',
  'session.resync.bad-applied-steps': 'The appliedSteps in the resync-req that arrived is not a non-negative integer (the protocol shape was already checked once at the decoding layer; this is the second check on the path that feeds accept directly). Rejected, and no match file is sent back.',
  'session.resync.already-rejected': 'This match in this session has already been refused (phase rejected); it no longer accepts reconnect requests and sends no match file back.',
  'session.resync.bad-local-file': 'The match file this side holds has an unusable shape (missing setup / actions / players / the fingerprint fields), so a resync-res cannot be sent; check whether the file source is really handing over a MatchFile.',
  'session.resync.res-bad-shape': 'The resync-res that arrived has the wrong shape (missing file, or file is not an object). Rejected, and no state is changed.',
  'session.resync.res-not-awaited': 'The current phase is {phase} and this side **is not waiting to catch up** (needsResync === false): a session that is not waiting for a match file can only have received this resync-res because the peer picked the wrong target or is replaying. Rejected, and no state is changed.',
  'session.resync.apply-wrong-phase': 'The current phase is {phase} and the match file cannot be applied at this point: catching up must first take in the resync-res in acceptResyncRes (that step asks "is this side waiting for a match file", while this step asks "does the match file line up").',
  'session.resync.apply-bad-shape': 'The match file to apply has an unusable shape (missing setup / actions / players / the fingerprint fields). Rejected, and neither the phase nor needsResync is changed.',
  'session.resync.step-count-mismatch': 'The caller reports it has caught up to step {statesAtStep}, while this match file has {count} actions: the two must be **exactly** equal. One step too few or too many is rejected (`stateAtStep` throws on out-of-range instead of clamping, because clamping would silently turn "the peer walked a few steps further than I did" into a state that looks in sync); this side\'s state is left completely untouched.',
  'session.device-direction-mismatch': '{what} was sent in a direction that does not match this side\'s role ({role}); refusing.',
  'session.refuse.bogus-inbound': 'An inbound message {what} that session.ts does not recognise.',
  'session.refuse.seed-before-face': 'Refused a reveal-seed that arrived too early: the guest has not committed to heads/tails (commit-face) yet. The coin result is a pure function of the seed, so whoever gets the seed first can compute the result and then pick the side that favours them; that is why the face must be picked before the seed is public (design doc §5.3). For this match, have the peer send commit-face first; this program will not invent a commitment for it.',
  'session.refuse.spectator-unsupported': 'This version (G5) does not support spectating yet: the spectator seats have not been built, so this is not a full room. The two seats are reserved for two players; ask the peer to send the handshake again as a player. Spectating will be done separately in a later version.',
  'session.refuse.spectator-unsupported-detail': 'G5 does not support spectating (note: this is not "spectator seats are full"): this version has only two player seats, and spectating waits for a later version.',
  'session.hash.empty-string': 'an empty string',

  /* ── ★ 2026-10-02（P3 第八批）：src/ui/archive-fs-browser.ts 的导入/导出失败原因 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'archive-fs-browser.error.unknown': 'Unknown error (the host gave no description).',
  'archive-fs-browser.error.undescribable': 'The host threw an object that cannot be described.',
  'archive-fs-browser.archive-description': 'Compile match archive',
  'archive-fs-browser.pick.not-an-object': 'The host did not give a file object (what arrived is not an object).',
  'archive-fs-browser.pick.no-text-method': 'The chosen file object has no callable text(): this program cannot read it.',
  'archive-fs-browser.pick.empty-dialog': 'The user chose no file (the dialog returned an empty list).',
  'archive-fs-browser.unsupported.import': 'This device\'s browser does not support importing archives (no showOpenFilePicker and no usable document).',
  'archive-fs-browser.input.create-failed': 'Could not create the file chooser: {detail}',
  'archive-fs-browser.input.read-result-failed': 'Reading the selection failed: {detail}',
  'archive-fs-browser.pick.none': 'The user chose no file.',
  'archive-fs-browser.pick.cancelled': 'The user cancelled the import.',
  'archive-fs-browser.fsa.open-failed': 'Could not open the file chooser: {detail}',
  'archive-fs-browser.input.timeout': 'Waited more than {ms} ms for the user to choose; treating it as a cancel.',
  'archive-fs-browser.input.prepare-failed': 'Could not prepare the file-choosing environment: {detail}',
  'archive-fs-browser.pick.selection-cancelled': 'The user cancelled the selection.',
  'archive-fs-browser.input.no-description': '(the input-element path gave no description)',
  'archive-fs-browser.select.both-failed': 'The file-system chooser failed: {fsaDetail}; the file input failed too: {inputDetail}',
  'archive-fs-browser.select.threw': 'Choosing an archive failed: {detail}',
  'archive-fs-browser.save.prepare-failed': 'Could not prepare the saving environment: {detail}',
  'archive-fs-browser.save.cancelled': 'The user cancelled the save.',
  'archive-fs-browser.save.fsa-and-download-failed': 'The file-system write failed: {fsaDetail}; the download fallback failed too: {detail}',
  'archive-fs-browser.save.download-failed': 'The download fallback failed: {detail}',
  'archive-fs-browser.save.fsa-failed': 'The file-system write failed: {fsaDetail}',
  'archive-fs-browser.unsupported.save': 'This device\'s browser does not support saving files (no showSaveFilePicker and no usable document/URL).',
  'archive-fs-browser.save.failed': 'Saving failed: {detail}',
  /* ───────── 引擎 `prompt.title` 的显示层替换（P5；见 src/i18n/engine-prompt.ts 的头注） ─────────
   * 键与 `zh.ts` 逐条对应；注释行是**中文模式下的引擎原文**（= 匹配用的模式串）。 */
  /* ENGINE-PROMPT-BEGIN */
  // 弃1张牌
  'engine.prompt.p001': 'discard 1 card',
  // 你弃置1张牌
  'engine.prompt.p002': 'you discard 1 card',
  // 偏转到哪条链路
  'engine.prompt.p003': 'which line to shift to',
  // 翻转1张牌
  'engine.prompt.p004': 'flip 1 card',
  // 对手弃{n}张牌
  'engine.prompt.p005': 'opponent discards {n} cards',
  // 对手弃1张牌
  'engine.prompt.p006': 'opponent discards 1 card',
  // 反面打出到任意线
  'engine.prompt.p007': 'play face down to any line',
  // 偏转目标线
  'engine.prompt.p008': 'target line to shift to',
  // 删除1张牌
  'engine.prompt.p009': 'delete 1 card',
  // 对手弃置1张牌
  'engine.prompt.p010': 'opponent discards 1 card',
  // 翻转另1张牌
  'engine.prompt.p011': 'flip another card',
  // 你可以弃1张牌
  'engine.prompt.p012': 'you may discard 1 card',
  // 弃置1张牌
  'engine.prompt.p013': 'discard 1 card',
  // 选择目标列
  'engine.prompt.p014': 'choose the target line',
  // 把该牌偏转进此列
  'engine.prompt.p015': 'shift that card into this line',
  // 此牌被覆盖，你可以偏转它
  'engine.prompt.p016': 'this card is covered, you may shift it',
  // 对手弃2张牌
  'engine.prompt.p017': 'opponent discards 2 cards',
  // 对手在此链路反面打出1张牌
  'engine.prompt.p018': 'opponent plays 1 card face down in this line',
  // 翻转1张你的反面朝下的牌
  'engine.prompt.p019': 'flip 1 of your face-down cards',
  // 回手1张其他牌
  'engine.prompt.p020': 'return 1 other card to your hand',
  // 你可以翻转此牌
  'engine.prompt.p021': 'you may flip this card',
  // 你可以将弃牌堆洗入牌库
  'engine.prompt.p022': 'you may shuffle your discard pile into your deck',
  // 你可以偏转此牌
  'engine.prompt.p023': 'you may shift this card',
  // 你可以弃置1张牌
  'engine.prompt.p024': 'you may discard 1 card',
  // 弃1张或更多张牌
  'engine.prompt.p025': 'discard 1 or more cards',
  // 若你这么做，翻转1张牌
  'engine.prompt.p026': 'if you do, flip 1 card',
  // 选择要交换的第2个位置
  'engine.prompt.p027': 'choose the 2nd position to swap',
  // 在链路 {n} 反面打出1张牌
  'engine.prompt.p028': 'play 1 card face down in line {n}',
  // 正面打出（须匹配协议线）
  'engine.prompt.p029': 'play face up (must match the protocol line)',
  // {verb}：{who} 持有控制组件（已归还中立）——可重排一名玩家的协议
  'engine.prompt.p030': '{verb}: {who} holds the control component (returned to neutral) - you may rearrange one player\'s protocols',
  // {verb}：选择要交换的第2个位置
  'engine.prompt.p031': '{verb}: choose the 2nd position to swap',
  // {verb}：重排玩家{who}的协议——选择要交换的第1个位置
  'engine.prompt.p032': '{verb}: rearrange player {who}\'s protocols - choose the 1st position to swap',
  // 把1张反面牌偏转进此列
  'engine.prompt.p033': 'shift 1 face-down card into this line',
  // 把1张牌偏转进或偏转出此列
  'engine.prompt.p034': 'shift 1 card into or out of this line',
  // 把覆盖者偏转到哪条链路
  'engine.prompt.p035': 'which line to shift the covering card to',
  // 把该牌偏转出此列
  'engine.prompt.p036': 'shift that card out of this line',
  // 此牌被反面牌覆盖——你可以偏转那张牌
  'engine.prompt.p037': 'this card is covered by a face-down card - you may shift that card',
  // 此牌将被覆盖——先翻转1张正面朝上的牌
  'engine.prompt.p038': 'this card is about to be covered - first flip 1 face-up card',
  // 从弃牌堆打出1张牌
  'engine.prompt.p039': 'play 1 card from your discard pile',
  // 打出1张牌
  'engine.prompt.p040': 'play 1 card',
  // 打出朝向
  'engine.prompt.p041': 'choose the orientation to play',
  // 第2个位置
  'engine.prompt.p042': 'the 2nd position',
  // 对手抽牌，你可以删除1张卡牌
  'engine.prompt.p043': 'the opponent draws - you may delete 1 card',
  // 对手打出1张牌
  'engine.prompt.p044': 'the opponent plays 1 card',
  // 对手弃牌，你可以反面打出1张卡牌
  'engine.prompt.p045': 'the opponent discards - you may play 1 card face down',
  // 对手删除1张对手的反面牌
  'engine.prompt.p046': 'the opponent deletes 1 of their face-down cards',
  // 对手刷新——你弃置任意数目的卡牌
  'engine.prompt.p047': 'the opponent refreshes - you discard any number of cards',
  // 对手选择抽1张牌或打出1张牌
  'engine.prompt.p048': 'the opponent chooses to draw 1 card or play 1 card',
  // 对手已编译的协议更多——翻转1张牌
  'engine.prompt.p049': 'the opponent has more compiled protocols - flip 1 card',
  // 对手拥有控制权——你可以翻转1张牌
  'engine.prompt.p050': 'the opponent holds control - you may flip 1 card',
  // 对手在此链路出牌后，他要弃置1张牌
  'engine.prompt.p051': 'after the opponent plays in this line, they must discard 1 card',
  // 翻转1张被覆盖的卡牌
  'engine.prompt.p052': 'flip 1 covered card',
  // 翻转1张此链路中正面朝上的卡牌
  'engine.prompt.p053': 'flip 1 face-up card in this line',
  // 翻转1张对手的正面牌
  'engine.prompt.p054': 'flip 1 of the opponent\'s face-up cards',
  // 翻转1张你被覆盖的牌
  'engine.prompt.p055': 'flip 1 of your covered cards',
  // 翻转1张你对手的牌
  'engine.prompt.p056': 'flip 1 of your opponent\'s cards',
  // 翻转1张阈值大于你手牌数({n})的卡牌
  'engine.prompt.p057': 'flip 1 card with threshold greater than your hand size ({n})',
  // 翻转1张阈值小于{n}的卡牌
  'engine.prompt.p058': 'flip 1 card with threshold less than {n}',
  // 翻转1张阈值小于此链路牌数的牌
  'engine.prompt.p059': 'flip 1 card with threshold less than the number of cards in this line',
  // 翻转1张正面朝上的牌
  'engine.prompt.p060': 'flip 1 face-up card',
  // 翻转对手1张正面朝上的牌
  'engine.prompt.p061': 'flip 1 of the opponent\'s face-up cards',
  // 翻转对手阈值最高的被覆盖的牌
  'engine.prompt.p062': 'flip the opponent\'s covered card with the highest threshold',
  // 翻转或偏转你的1张牌
  'engine.prompt.p063': 'flip or shift 1 of your cards',
  // 翻转另1条链路中的牌——选择链路
  'engine.prompt.p064': 'flip a card in another line - choose the line',
  // 翻转你的1张卡牌
  'engine.prompt.p065': 'flip 1 of your cards',
  // 翻转你的1张牌
  'engine.prompt.p066': 'flip 1 of your cards',
  // 翻转这张被覆盖的卡牌
  'engine.prompt.p067': 'flip this covered card',
  // 翻转这张正面朝上的牌
  'engine.prompt.p068': 'flip this face-up card',
  // 反面打出1张卡牌
  'engine.prompt.p069': 'play 1 card face down',
  // 反面打出1张牌
  'engine.prompt.p070': 'play 1 card face down',
  // 反面打出到哪条链路
  'engine.prompt.p071': 'which line to play face down into',
  // 反面打出牌库顶到任意线
  'engine.prompt.p072': 'play the top of your deck face down to any line',
  // 复制对手1张牌的中央效果
  'engine.prompt.p073': 'copy the middle effect of 1 of the opponent\'s cards',
  // 覆盖着新星牌——你可以重排你的协议
  'engine.prompt.p074': 'it is covering a nova card - you may rearrange your protocols',
  // 回手1张你的牌
  'engine.prompt.p075': 'return 1 of your cards to your hand',
  // 回手1张牌
  'engine.prompt.p076': 'return 1 card to your hand',
  // 回手或偏转1张牌
  'engine.prompt.p077': 'return or shift 1 card',
  // 回手这张牌
  'engine.prompt.p078': 'return this card to your hand',
  // 将对手的1张正面朝下的卡牌加入手牌
  'engine.prompt.p079': 'take 1 of the opponent\'s face-down cards into your hand',
  // 将牌库顶的牌反面打在对手的哪一侧
  'engine.prompt.p080': 'which of the opponent\'s sides to play your deck top face down on',
  // 将其正面朝下打出到其它链路
  'engine.prompt.p081': 'play it face down into another line',
  // 将随机揭示的那张牌反面打出在对手的哪一侧
  'engine.prompt.p082': 'which of the opponent\'s sides to play the randomly revealed card face down on',
  // 交换你的2个协议——第1个位置
  'engine.prompt.p083': 'swap 2 of your protocols - the 1st position',
  // 交换协议位置——选择第1个位置
  'engine.prompt.p084': 'swap protocol positions - choose the 1st position',
  // 揭示1张反面牌
  'engine.prompt.p085': 'reveal 1 face-down card',
  // 揭示1张你的手牌
  'engine.prompt.p086': 'reveal 1 card from your hand',
  // 揭示1张阈值={n}的牌
  'engine.prompt.p087': 'reveal 1 card with threshold {n}',
  // 控制权持有者（P{n}）选择要交换的第1个协议位（新星方）
  'engine.prompt.p088': 'the controller (P{n}) chooses the 1st protocol position to swap (nova side)',
  // 命中！删除1张牌
  'engine.prompt.p089': 'hit! delete 1 card',
  // 你把1张手牌给对手
  'engine.prompt.p090': 'you give 1 card from your hand to the opponent',
  // 你可以把1张手牌给对手
  'engine.prompt.p091': 'you may give 1 card from your hand to the opponent',
  // 你可以抽1张牌
  'engine.prompt.p092': 'you may draw 1 card',
  // 你可以抽2张牌（若这么做翻转此牌）
  'engine.prompt.p093': 'you may draw 2 cards (if you do, flip this card)',
  // 你可以打出这张牌
  'engine.prompt.p094': 'you may play this card',
  // 你可以打入1张非多元协议的卡牌到此链路
  'engine.prompt.p095': 'you may play 1 non-diversity card into this line',
  // 你可以翻转1张被覆盖的正面朝上的卡牌
  'engine.prompt.p096': 'you may flip 1 covered face-up card',
  // 你可以翻转1张此列的反面牌
  'engine.prompt.p097': 'you may flip 1 face-down card in this line',
  // 你可以翻转1张反面牌
  'engine.prompt.p098': 'you may flip 1 face-down card',
  // 你可以翻转1张你的被盖住的正面牌
  'engine.prompt.p099': 'you may flip 1 of your covered face-up cards',
  // 你可以翻转1张牌
  'engine.prompt.p100': 'you may flip 1 card',
  // 你可以翻转1张正面朝上的卡牌
  'engine.prompt.p101': 'you may flip 1 face-up card',
  // 你可以回手1张对手的牌
  'engine.prompt.p102': 'you may return 1 of the opponent\'s cards to your hand',
  // 你可以回手1张你的牌（含此牌自身）
  'engine.prompt.p103': 'you may return 1 of your cards to your hand (including this card itself)',
  // 你可以将对手1张被覆盖的牌偏转到此链路
  'engine.prompt.p104': 'you may shift 1 of the opponent\'s covered cards into this line',
  // 你可以将手牌中的1张牌放回牌库底端
  'engine.prompt.p105': 'you may put 1 card from your hand on the bottom of your deck',
  // 你可以偏转1张你的牌
  'engine.prompt.p106': 'you may shift 1 of your cards',
  // 你可以偏转此牌到另一列
  'engine.prompt.p107': 'you may shift this card to another line',
  // 你可以偏转此牌进入对手总阈值最大的链路
  'engine.prompt.p108': 'you may shift this card into the opponent\'s line with the highest total threshold',
  // 你可以偏转或翻转那张牌
  'engine.prompt.p109': 'you may shift or flip that card',
  // 你可以偏转那张牌
  'engine.prompt.p110': 'you may shift that card',
  // 你可以偏转这张牌
  'engine.prompt.p111': 'you may shift this card',
  // 你可以弃置你的手牌
  'engine.prompt.p112': 'you may discard your hand',
  // 你可以弃置牌库顶端的卡牌
  'engine.prompt.p113': 'you may discard the top card of your deck',
  // 你可以失去控制权
  'engine.prompt.p114': 'you may give up control',
  // 你弃置1张牌或删除此牌
  'engine.prompt.p115': 'you discard 1 card or delete this card',
  // 你拥有控制权——你可以将对手1张牌偏转到此链路
  'engine.prompt.p116': 'you hold control - you may shift 1 of the opponent\'s cards into this line',
  // 你拥有控制权——偏转1张其他牌
  'engine.prompt.p117': 'you hold control - shift 1 other card',
  // 你重排协议后——你可以偏转1张反面朝下的牌
  'engine.prompt.p118': 'after you rearrange your protocols - you may shift 1 face-down card',
  // 偏转1张被覆盖的正面朝下的卡牌
  'engine.prompt.p119': 'shift 1 covered face-down card',
  // 偏转1张对手的反面牌
  'engine.prompt.p120': 'shift 1 of the opponent\'s face-down cards',
  // 偏转1张对手的牌
  'engine.prompt.p121': 'shift 1 of the opponent\'s cards',
  // 偏转1张对手在此链路的卡牌
  'engine.prompt.p122': 'shift 1 of the opponent\'s cards in this line',
  // 偏转1张反面牌
  'engine.prompt.p123': 'shift 1 face-down card',
  // 偏转1张你的被覆盖的卡牌
  'engine.prompt.p124': 'shift 1 of your covered cards',
  // 偏转1张你的牌（含此牌自身）
  'engine.prompt.p125': 'shift 1 of your cards (including this card itself)',
  // 偏转1张你对手的被盖住的牌
  'engine.prompt.p126': 'shift 1 of your opponent\'s covered cards',
  // 偏转1张牌
  'engine.prompt.p127': 'shift 1 card',
  // 偏转1张其它牌
  'engine.prompt.p128': 'shift 1 other card',
  // 偏转1张阈值小于此链路牌数的牌
  'engine.prompt.p129': 'shift 1 card with threshold less than the number of cards in this line',
  // 偏转此牌到另一列
  'engine.prompt.p130': 'shift this card to another line',
  // 偏转对手的1张牌
  'engine.prompt.p131': 'shift 1 of the opponent\'s cards',
  // 偏转对手的1张牌，或交换你的2个协议
  'engine.prompt.p132': 'shift 1 of the opponent\'s cards, or swap 2 of your protocols',
  // 偏转或翻转1张卡牌
  'engine.prompt.p133': 'shift or flip 1 card',
  // 偏转另1张你的牌
  'engine.prompt.p134': 'shift another 1 of your cards',
  // 偏转你阈值最低的被覆盖的牌
  'engine.prompt.p135': 'shift your covered card with the lowest threshold',
  // 偏转你在此链路中1张被覆盖的牌
  'engine.prompt.p136': 'shift 1 of your covered cards in this line',
  // 偏转这张牌
  'engine.prompt.p137': 'shift this card',
  // 弃3张牌
  'engine.prompt.p138': 'discard 3 cards',
  // 弃置1张牌到对手的弃牌堆
  'engine.prompt.p139': 'discard 1 card into the opponent\'s discard pile',
  // 弃置2张牌
  'engine.prompt.p140': 'discard 2 cards',
  // 清缓存后——选择牌库顶反打到的链路
  'engine.prompt.p141': 'after clearing the cache - choose the line to play your deck top face down into',
  // 任意玩家清缓存后——删除1张牌
  'engine.prompt.p142': 'after any player clears the cache - delete 1 card',
  // 任意玩家重排协议后——弃1张牌
  'engine.prompt.p143': 'after any player rearranges protocols - discard 1 card',
  // 删除1张0分或1分的牌
  'engine.prompt.p144': 'delete 1 card worth 0 or 1',
  // 删除1张反面牌
  'engine.prompt.p145': 'delete 1 face-down card',
  // 删除1张阈值={n}的卡牌（可含被覆盖）
  'engine.prompt.p146': 'delete 1 card with threshold {n} (covered cards allowed)',
  // 删除此列分值最低的被盖住的牌
  'engine.prompt.p147': 'delete the covered card with the lowest value in this line',
  // 删除对手的1张牌
  'engine.prompt.p148': 'delete 1 of the opponent\'s cards',
  // 删除对手分值最高的牌
  'engine.prompt.p149': 'delete the opponent\'s card with the highest value',
  // 删除对手阈值最低的被覆盖的牌
  'engine.prompt.p150': 'delete the opponent\'s covered card with the lowest threshold',
  // 删除该列1张牌
  'engine.prompt.p151': 'delete 1 card in that line',
  // 删除另1张牌
  'engine.prompt.p152': 'delete another card',
  // 删除你分值最高的牌
  'engine.prompt.p153': 'delete your card with the highest value',
  // 失去控制权——对手弃{n}张牌
  'engine.prompt.p154': 'give up control - the opponent discards {n} cards',
  // 失去控制权——删除1张正面朝上的牌
  'engine.prompt.p155': 'give up control - delete 1 face-up card',
  // 手牌恰好2张——删除对手1张牌
  'engine.prompt.p156': 'exactly 2 cards in hand - delete 1 of the opponent\'s cards',
  // 手牌为0——对手弃{n}张牌
  'engine.prompt.p157': '0 cards in hand - the opponent discards {n} cards',
  // 手牌为0——对手弃1张牌
  'engine.prompt.p158': '0 cards in hand - the opponent discards 1 card',
  // 透彻：从牌库中选择1张阈值为{n}的卡牌抽取
  'engine.prompt.p159': 'Clarity: choose 1 card with threshold {n} from your deck and draw it',
  // 宣告1个数字（0-6）
  'engine.prompt.p160': 'declare a number (0-6)',
  // 宣告1个协议
  'engine.prompt.p161': 'declare a protocol',
  // 选1列删除其中所有1分和2分的牌
  'engine.prompt.p162': 'choose 1 line and delete all cards worth 1 or 2 in it',
  // 选择1条对手总阈值更大的链路
  'engine.prompt.p163': 'choose a line where the opponent\'s total threshold is higher',
  // 选择1条链路
  'engine.prompt.p164': 'choose a line',
  // 选择1条你恰好有5张牌的链路
  'engine.prompt.p165': 'choose a line where you have exactly 5 cards',
  // 选择1条要翻开盖牌的链路
  'engine.prompt.p166': 'choose a line whose covered cards to flip',
  // 选择1条有正面朝下卡牌的链路
  'engine.prompt.p167': 'choose a line with face-down cards',
  // 选择1张手牌反面打出
  'engine.prompt.p168': 'choose 1 card from your hand to play face down',
  // 选择1张未被覆盖的新星牌
  'engine.prompt.p169': 'choose 1 uncovered nova card',
  // 选择第1个要交换的链路
  'engine.prompt.p170': 'choose the 1st line to swap',
  // 选择第2个协议位
  'engine.prompt.p171': 'choose the 2nd protocol position',
  // 选择第2个要交换的链路
  'engine.prompt.p172': 'choose the 2nd line to swap',
  // 选择目标卡牌
  'engine.prompt.p173': 'choose the target card',
  // 选择目标线路
  'engine.prompt.p174': 'choose the target line',
  // 选择你的1张牌（含此牌自身）
  'engine.prompt.p175': 'choose 1 of your cards (including this card itself)',
  // 选择牌最多的1条链路
  'engine.prompt.p176': 'choose the line with the most cards',
  // 选择偏转目标线
  'engine.prompt.p177': 'choose the line to shift to',
  // 选择要编译的链路
  'engine.prompt.p178': 'choose the line to compile',
  // 选择要打出的列
  'engine.prompt.p179': 'choose the line to play into',
  // 选择要删除1张牌的第二列
  'engine.prompt.p180': 'choose the 2nd line to delete a card from',
  // 选择要删除1张牌的第一列
  'engine.prompt.p181': 'choose the 1st line to delete a card from',
  // 选择要删除所有牌的列（该列双方合计≥8张）
  'engine.prompt.p182': 'choose the line to delete all cards from (8 or more cards from both sides combined)',
  // 要么弃1张牌，要么翻转此牌
  'engine.prompt.p183': 'either discard 1 card or flip this card',
  // 以正面还是反面打出
  'engine.prompt.p184': 'play it face up or face down',
  // 再翻转1张牌
  'engine.prompt.p185': 'flip 1 more card',
  // 再删除1张牌
  'engine.prompt.p186': 'delete 1 more card',
  // 在此牌正下方反面打出1张牌
  'engine.prompt.p187': 'play 1 card face down directly below this card',
  // 在另一列反面打出牌堆顶
  'engine.prompt.p188': 'play the top of your deck face down in another line',
  // 在同一链路翻转对手的1张牌
  'engine.prompt.p189': 'flip 1 of the opponent\'s cards in the same line',
  // 召回1张卡牌
  'engine.prompt.p190': 'recall 1 card',
  // 召回对手的1张牌
  'engine.prompt.p191': 'recall 1 of the opponent\'s cards',
  // 重排对手协议——选择第1个位置
  'engine.prompt.p192': 'rearrange the opponent\'s protocols - choose the 1st position',
  // 重排你的协议
  'engine.prompt.p193': 'rearrange your protocols',
  // 重排协议：选择要交换的第1个位置
  'engine.prompt.p194': 'rearrange protocols: choose the 1st position to swap',
  // 重排协议：选择要交换的第2个位置
  'engine.prompt.p195': 'rearrange protocols: choose the 2nd position to swap',
  // 重新排列{label}的协议——选择要交换的第1个位置
  'engine.prompt.p196': 'rearrange {label} protocols - choose the 1st position to swap',
  // 重新排列{label}的协议——选择要交换的第2个位置
  'engine.prompt.p197': 'rearrange {label} protocols - choose the 2nd position to swap',
  // 重新排列{label}的协议（可多次交换，直到满意）
  'engine.prompt.p198': 'rearrange {label} protocols (swap as many times as you like, until you are satisfied)',
  // clarity：打出这张牌（朝向）
  'engine.prompt.p199': 'Clarity: play this card (orientation)',
  // clarity：反面打出到任意线
  'engine.prompt.p200': 'Clarity: play face down to any line',
  // clarity：正面打出（须匹配协议线）
  'engine.prompt.p201': 'Clarity: play face up (must match the protocol line)',
  // unity：翻转1张牌
  'engine.prompt.p202': 'Unity: flip 1 card',
  // unity：翻转1张牌或抽取1张牌
  'engine.prompt.p203': 'Unity: flip 1 card or draw 1 card',
/* ENGINE-PROMPT-END */
  /* ───── 选择条**动作按钮**的显示层替换（P5；键同 `zh.ts`，注释行是引擎的 action id） ───── */
  /* ENGINE-ACTION-KEYS-BEGIN */
  'engine.action.flip': 'flip',
  'engine.action.draw': 'draw',
  'engine.action.discard': 'discard',
  'engine.action.delete': 'delete',
  'engine.action.shift': 'shift',
  'engine.action.return': 'return to hand',
  'engine.action.face_up': 'play face up',
  'engine.action.face_down': 'play face down',
  'engine.action.skip': 'skip',
  'engine.action.shuffle': 'shuffle',
  'engine.action.swap': 'swap',
  'engine.action.play': 'play',
  'engine.action.rearrange_swap': 'keep swapping positions',
  'engine.action.rearrange_done': 'finish this player\'s rearrangement',
  'engine.action.keep': 'do not rearrange, continue',
  'engine.action.give_up_control': 'give up control',
  'engine.action.discard_hand': 'discard your hand',
  'engine.action.order': 'layout {layout}',
  'engine.action.num': '{n}',
  'engine.action.proto': '{proto}',
  'engine.action.rearrange_player': 'rearrange player {who}\'s protocols',
  'engine.action.rearrange_player_locked': 'rearrange player {who}\'s protocols (locked)',
  /* ENGINE-ACTION-KEYS-END */
};
