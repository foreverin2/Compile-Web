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
};
