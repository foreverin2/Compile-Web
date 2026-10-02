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
};
