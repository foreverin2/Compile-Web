/**
 * ★ 2026-10-06（用户要求）：「英文模式下还剩中文」的最后一处 —— 草稿页 hover 展示框里的
 * 45 套协议评分（定位 / 点评 / 推荐搭配 / 推荐流派）+ 6 个评分维度名。
 *
 * ## 数据来源（唯一出处，别手抄）
 *
 * 中文源是自动生成的 `src/data/protocolRatings.ts`（来自《45套协议卡组评分与阵容推荐.txt》，
 * 由 `tools/parse-ratings.mjs` 生成）。本文件只做**显示层**的英文查表：
 * 中文模式一律走原来的 `protocolRatings.ts`，这里只被英文模式读取。
 * `defId` 与评分数值不动，只翻文本字段。
 *
 * ## 三条硬要求（与 `protocol-en.ts` / `effect-tags-en.ts` 同套路）
 *
 * 1. 正文里的协议名一律用 `protocol-en.ts` 的官方英文名（流水=Water、明光=Light、死板=Rigid…）。
 * 2. 卡名写法遵循教学文案约定：`<协议名> <分值>`，如 流水1 → `Water 1`、火4 → `Fire 4`。
 * 3. 格式保持不变：`pairs` / `styles` 每套各 3 条、条数不变；`pairs` 为「协议名 —— 理由」，
 *    `styles` 为「流派名：说明」。review 的文本内容与原 JSON 一致（原 txt 换行在导出时已压成空格）。
 */

export const PROTOCOL_RATINGS_EN: Readonly<Record<string, {
  position: string;
  review: string;
  pairs: readonly string[];
  styles: readonly string[];
}>> = {
  water: {
    position: 'All-rounder value engine / Return engine',
    review: 'Water 1 lays one face-down card into each of the other two columns per turn (+2 per column); Water 3 can return an entire column of 2-point cards to hand for reuse, and Water 0 flips flexibly. Every move is generic wording that pairs smoothly with anything; the downside is the lack of a decisive finisher, so you rely on the other two protocols to carry the win. The archetypal "jack-of-all-trades lubricant".',
    pairs: [
      'Time — Trash-cycle: Water\u2019s returns reuse the same cards, and Time\u2019s recovery engine keeps resources from ever running dry;',
      'Light — Draw engine: covers Water\u2019s shortfall in cards; Light 0 flips and draws to cycle resources fast;',
      'Flexible — All-rounder: two utility protocols with fully complementary moves; however you build it, it runs smooth.'
    ],
    styles: [
      'Return-cycle: Water 3 returns an entire column of 2-point cards to play them again and again, chaining covers to grind the opponent down;',
      'Two-lane swarm: Water 1 lays a face-down card in each of the other two columns every turn (+2/+2) to seize control fast;',
      'Utility support: a resource and mobility add-on for the main protocol \u2014 never steals the spotlight, steady sustain.'
    ]
  },
  fire: {
    position: 'Discard tempo / resource conversion',
    review: 'One of the most straightforward protocols: discard for payoff. Fire 4\u2019s "discard N, draw N+1" is the classic sustain; Fire 1\u2019s "deleted only when discarded" forces decisions; Fire 0/3 offer flips. Zero barrier to entry, but with an empty hand every line goes quiet \u2014 vulnerable to discard strategies.',
    pairs: [
      'Plague — Forced discard: twin discard pressure, the opponent\u2019s hand collapses in an avalanche;',
      'Psychic — Hand destruction: discard plus a fully revealed hand instantly blows up the hand advantage;',
      'Gluttony — Clear-cache synergy: Fire\u2019s discards feed Gluttony effects; Fire 4\u2019s draw plus Gluttony 2\u2019s draw form a double engine.'
    ],
    styles: [
      'Discard burst: Fire 4 discards N to draw N+1 and rolls resources; Fire 1 trades a discard for a delete; the more you discard, the stronger it gets;',
      'Aggro tempo: Fire 0/Fire 3 flip and draw to push lanes fast and race to compile;',
      'Resource conversion: treat the hand as currency \u2014 trade one discard for a return/delete/flip, spent carefully.'
    ]
  },
  light: {
    position: 'Draw engine / light manipulation',
    review: 'Light 0 flips a card and draws that many cards from its value \u2014 with your own high-value cards it\u2019s a draw machine; Light 2 reveals and manipulates face-down cards, maxing out information; Light 3 can shift all face-down cards at once. Balanced with no weak spot, ideal as the engine at the heart of any deck.',
    pairs: [
      'Time — Cycle engine: a double-engine deck that gets extra actions every turn once the deck starts turning;',
      'Water — Draw-return: a draw + return perpetual engine with worry-free sustain;',
      'Spirit — High mobility: mobility plus draw \u2014 a reposition-and-draw style.'
    ],
    styles: [
      'Draw-engine: Light 0 flips a card and draws its value in cards \u2014 the more big cards you hold, the more you profit;',
      'Information manipulation: Light 2 reveals and manipulates the opponent\u2019s face-down cards, blending intel with disruption;',
      'Balanced value: a turn engine with no obvious weakness, best as the deck\u2019s core.'
    ]
  },
  darkness: {
    position: 'Face-down specialist / manipulation',
    review: 'Darkness 2 makes every face-down card in your column count as 4 points \u2014 a straight double under the "face-down cards are fixed at 2 points" rule, explosive when paired with face-down-laying protocols like Overwhelm/Life/Smoke; Darkness 1 flips an opponent\u2019s card and shifts it away on the side, blending offense and defense. The catch: its own engine needs others to lay face-downs, so it\u2019s weak on its own.',
    pairs: [
      'Smoke — Face-down layer: every face-down Smoke lays gets valued at 4 by Darkness 2, doubling the payoff;',
      'Overwhelm — Full-line counter: Overwhelm\u2019s swarm feeds Darkness 2 for a double turn;',
      'Life — Three-lane lay: the face-downs Life lays also get Darkness 2\u2019s boost.'
    ],
    styles: [
      'Face-down giant: Darkness 2 counts every face-down in your column as 4 points \u2014 pile a giant column and compile outright;',
      'Manipulation: Darkness 1 flips and shifts opponent cards to dismantle their stack structure;',
      'Counter-control: Darkness 0 draws 3 and shifts cards, setting up while defending.'
    ]
  },
  life: {
    position: 'Board expansion / swarm',
    review: 'Life 0 lays one card into every column that already has cards each turn \u2014 pushing all three lanes at once to seize control fast; Life 3 can still lay more when covered, with first-rate expansion. But Life 0/Life 3 "self-delete before being covered", staking everything on the board \u2014 one wipe cripples you. An all-out gamble of a swarm deck.',
    pairs: [
      'Overwhelm — Double swarm: two swarm protocols pushing all three lanes, control is always yours;',
      'Darkness — Face-down boost: the face-downs Life lays are amplified by Darkness 2;',
      'Speed — Extra-action swarm: extra plays plus full-lane swarm, maximum action economy.'
    ],
    styles: [
      'Three-lane swarm: Life 0 lays a card into every populated column each turn, blooming everywhere;',
      'Endless proliferation: Life 3 lays another column when covered; Life 4 draws when covering \u2014 the more you lay, the more you get;',
      'High-risk aggro: burst early-mid to rush the compile, betting you finish before the opponent clears.'
    ]
  },
  death: {
    position: 'Delete destroyer',
    review: 'The strongest deletion suite in the game: Death 0 deletes one card from each of two columns at once; Death 2 clears every 1/2-point card in a column (even 2-point face-downs can\u2019t escape), directly killing an opponent\u2019s compile line. Simple rules, extreme ceiling, offense and defense in one \u2014 a T0 protocol.',
    pairs: [
      'Fire — Discard-delete: double deletion \u2014 delete on play plus delete via discard;',
      'Wrath — Kill the biggest: Death deletes small cards, Wrath kills big cards \u2014 strike everywhere;',
      'Fear — Lockdown support: shut down the opponent\u2019s counter ability and delete at your leisure.'
    ],
    styles: [
      'Delete-control: Death 0 deletes one from each of two columns, Death 2 clears 1/2-point cards, wrecking the opponent\u2019s compile line outright;',
      'Value suppression: delete the opponent\u2019s high-value cards so every one of your lines comfortably out-values them;',
      'Full disruption: pair with hand destruction so the opponent has neither board nor resources.'
    ]
  },
  spirit: {
    position: 'High-mobility utility',
    review: 'Spirit 3 can shift itself ignoring coverage after drawing; Spirit 0 refreshes and skips the cache phase, roaming the whole board unstoppably; Spirit 1\u2019s "discard or flip yourself" is a classic trade-off. High skill ceiling \u2014 a utility piece for experienced players.',
    pairs: [
      'Flexible — Double mobility: two repositioning protocols, weaving anywhere on the board;',
      'Light — Draw-mobility: draw plus coverage-ignoring shift, run it smoothly;',
      'Time — Cycle-mobility: return cycles plus Spirit\u2019s repositioning keep resources from ever landing idle.'
    ],
    styles: [
      'Hit-and-run: Spirit 3 shifts ignoring coverage after drawing, always dodging the compile line;',
      'Refresh-cycle: Spirit 0 refreshes and skips the cache, a master of turn rhythm;',
      'Utility add-on: grants any deck mobility \u2014 an advanced player\u2019s choice.'
    ]
  },
  gravity: {
    position: 'Single-column snowball / all-in column',
    review: 'Gravity 0 \u2014 "for every 2 cards in this column, lay 1" \u2014 makes a column grow exponentially; Gravity 1/2/4 pull all kinds of cards into the column, and piling to 10 points compiles unstoppably. But everything is staked on one column; one Death/Nova wipe takes it all. One of the most thrilling yet fragile protocols \u2014 a perfect physics flavor.',
    pairs: [
      'Life — Swarm feeds the column: Life\u2019s swarm provides fuel for the Gravity column;',
      'Overwhelm — Full-line swarm: everything laid gets pulled into the Gravity column, the snowball only grows;',
      'Nova — Same-family burst: both excel at stacking big columns, each a backup compile line for the other.'
    ],
    styles: [
      'Single-column snowball: Gravity 0 lays one card per 2 present, a column swelling exponentially into a compile;',
      'High-stakes burst: all-in on one column, deciding the game in a single turn;',
      'Condense-stack: Gravity 1/2/4 pull every kind of card into the column for centralized resource management.'
    ]
  },
  psychic: {
    position: 'Information warfare / hand destruction',
    review: 'Psychic 0 draws 2, discards 2, and reveals the opponent\u2019s whole hand \u2014 three payoffs from one command; Psychic 1\u2019s "opponent can only play face-down" locks down all their face-up plays; Psychic 2 rearranges the opponent\u2019s protocols. Info plus hand pressure in one \u2014 a favorite of value players.',
    pairs: [
      'Plague — Double discard: Psychic\u2019s discard 2 plus Plague\u2019s discard N+1 empties the opponent\u2019s hand;',
      'Fear — Lockdown-discard: locking middle commands plus discarding, offense and defense in one;',
      'Corruption — Full disruption: three disruption protocols stacked, and the opponent has no game to play.'
    ],
    styles: [
      'Hand destruction: Psychic 0 draws 2, discards 2, and reveals the hand \u2014 crushing resource lead;',
      'Information warfare: reveal the hand and rearrange the opponent\u2019s protocols to predict their every move;',
      'Restriction: Psychic 1 forces the opponent to play only face-down, silencing all their face-up plays.'
    ]
  },
  plague: {
    position: 'Forced discard / contagious pressure',
    review: 'Plague 2 \u2014 "you discard N, the opponent discards N+1" \u2014 always makes the opponent lose one more; Plague 3 flips every face-up card on the board into a free-for-all; Plague 0 can even lock the opponent\u2019s play column. The catch: most discard effects drag you in too \u2014 a double-edged pressure tool.',
    pairs: [
      'Psychic — Double-discard pressure: discard chains keep the opponent\u2019s hand permanently short;',
      'Fire — Discard synergy: Plague\u2019s discard plus Fire\u2019s discard-for-payoff \u2014 one discard, two gains;',
      'Fear — Lockdown-discard: lockdown and discard in tandem.'
    ],
    styles: [
      'Contagious discard: Plague 2 makes you discard N and the opponent N+1 \u2014 they always lose one more;',
      'Play-lockdown: Plague 0 bars the opponent from playing into your column;',
      'Flip free-for-all: Plague 3 flips every face-up card on the board \u2014 a massive reshuffle.'
    ]
  },
  metal: {
    position: 'Pure defense / anti-compile',
    review: 'Metal 0 cuts 2 points off the opponent\u2019s line; Metal 1 bars them from compiling next turn; Metal 3 deletes an 8-card column; Metal 6 self-destructs to block a flip \u2014 defense across every axis. But it has almost no offense of its own and wins through its teammates \u2014 the "you can\u2019t win either" spoiler.',
    pairs: [
      'Ice — Ice-armor defense: twin defense protocols, the opponent can\u2019t break through;',
      'Sloth — Grind defense: stall tactics plus defense, grinding the opponent to collapse;',
      'Rigid — Twin fortress towers: two walls side by side, a compile line as solid as iron.'
    ],
    styles: [
      'Turtle defense: Metal 0 cuts 2 points off the opponent\u2019s line; Metal 2 bars counters \u2014 lock them out;',
      'Anti-compile: Metal 1 bars the opponent\u2019s next-turn compile to choke a key turn;',
      'Self-destruct trap: Metal 6 self-deletes before being covered, making the opponent\u2019s flips/deletes whiff.'
    ]
  },
  speed: {
    position: 'Extra-action tempo / action advantage',
    review: 'Speed 0 lets you play one extra card outright; Speed 1 draws plus draws 2 more after clearing the cache; Speed 2 can still shift away before being compiled \u2014 a half-step ahead at every turn. The downside: gradual value growth and no burst point. A support tempo engine.',
    pairs: [
      'Life — Swarm extra-action: extra plays plus full-lane swarm double your turn efficiency;',
      'Light — Draw extra-action: draw plus extra plays, the card advantage snowballs;',
      'Overwhelm — Swarm pressure: action advantage plus numbers advantage.'
    ],
    styles: [
      'Extra-action aggro: Speed 0 plays one extra card every turn, always half a step ahead;',
      'Dodge: Speed 2 shifts away before the compile-delete, keeping your key cards safe;',
      'Tempo control: clear cache, draw, and draw 2 more \u2014 sustain and rhythm in one.'
    ]
  },
  love: {
    position: 'Resource exchange / double-edged',
    review: 'Love 1 steals the top of the opponent\u2019s deck; Love 3 swaps one random card for another \u2014 it looks great on paper. But Love 6 also gifts the opponent 2 draws, and the initiative in the exchange often isn\u2019t yours. Played well it reaps resources; played badly it feeds the enemy \u2014 one of the widest gaps between ceiling and floor.',
    pairs: [
      'Time — Cycle recovery: even stolen cards enter the trash cycle, squeezing full value;',
      'Assimilation — Double steal: two theft suites stacked, emptying the opponent\u2019s deck outright;',
      'Mirror — Mirror exchange: swapping plus copying \u2014 a master of resource games.'
    ],
    styles: [
      'Resource thief: Love 1 draws the top of the opponent\u2019s deck \u2014 one free card;',
      'Exchange game: Love 3 swaps one random opponent card for one of yours, gaining card advantage;',
      'Double-edged gambler: Love 6 gifts the opponent 2 draws \u2014 a high-risk, high-reward play.'
    ]
  },
  hate: {
    position: 'Symmetric destruction / mutual wipe',
    review: 'Hate 1 discards 3 and deletes 2; Hate 2 deletes the highest-value card on both sides \u2014 the thicker your board, the more you profit. Hate 3 draws back after being deleted, giving decent resilience. The problem: symmetric deletion hurts your teammates too, so decide before teaming up whether you accept the "mutual annihilation" cost.',
    pairs: [
      'Death — Double delete: with a thick board, Hate 2 plus Death\u2019s deletes pay off massively;',
      'Life — Thick board first: build a thick board so Hate 2\u2019s mutual max-delete works in your favor;',
      'Gravity — Thick-column trade: with a thick Gravity column, even mutual wipe doesn\u2019t cost you.'
    ],
    styles: [
      'Mutual wipe: Hate 2 deletes the highest card on both sides \u2014 the thicker your board, the better the trade;',
      'Thick-board trade: lay first, delete later, trading your board for the opponent\u2019s resources;',
      'Vengeance: Hate 3 draws after being deleted \u2014 strike back when hit.'
    ]
  },
  apathy: {
    position: 'Face-down specialist',
    review: 'Apathy 0 adds +1 to every face-down card; Apathy 1 flips all face-up cards; Apathy 2 negates middle commands in a column \u2014 an amplifier for face-down strategies. It can\u2019t lay face-downs itself, so it only shines teamed with Overwhelm/Life/Smoke; flying solo it\u2019s mediocre.',
    pairs: [
      'Darkness — Face-down core: Apathy 0 plus Darkness 2\u2019s double boost is the complete face-down build;',
      'Smoke — Face-down layer: Smoke\u2019s lays feed Apathy 0, +1 each;',
      'Overwhelm — Full-line lay: Overwhelm\u2019s swarm plus Apathy\u2019s flip rule.'
    ],
    styles: [
      'Face-down boost: Apathy 0 adds +1 to every face-down \u2014 win on numbers over value;',
      'Flip domination: Apathy 1 flips every face-up in your column, nullifying all the opponent\u2019s face-up plays;',
      'Command negation: Apathy 2 negates middle commands in a column \u2014 rewriting local rules.'
    ]
  },
  luck: {
    position: 'Gambler / random burst',
    review: 'Declare a number, draw, and gamble on the hit \u2014 handing the game to the RNG. Luck 4 \u2014 "discard the top card of the trash to delete a card of the same value" \u2014 is a rare stable delete. Maximum fun, bottom-tier competitive, best for casual games.',
    pairs: [
      'Clarity — Precision search: Luck\u2019s gamble plus Clarity\u2019s tailored search, hedging the variance;',
      'Time — Recovery cycle: even lost gambles go back into the cycle for reuse;',
      'Mirror — Meta adaptation: two cards that live off the matchup, growing stronger against strong foes.'
    ],
    styles: [
      'Gambler burst: declare a number and bet it all \u2014 a hit is one wave of burst;',
      'Stable delete: Luck 4 discards the trash top to delete a same-value card \u2014 a rare steady point;',
      'Party entertainer: maximum variance \u2014 the perfect pick for casual games.'
    ]
  },
  mirror: {
    position: 'Mirror copying / matchup-based',
    review: 'Mirror 1 copies the opponent\u2019s middle effect; Mirror 0 raises its threshold by the opponent\u2019s card count; Mirror 4 draws whenever they draw \u2014 the stronger they are, the stronger you are, with a built-in "if you can\u2019t beat \u2019em, join \u2019em" nature that fits almost any opponent. But when the opponent phones it in, so do you.',
    pairs: [
      'Envy — Double mirror: copying plus stolen threshold, the stronger the opponent the stronger you get;',
      'Time — Cycle mirror: resource cycles plus mirror copying, sustain and counterplay in one;',
      'Water — Value mirror: steady value plus mirror adaptation to the meta.'
    ],
    styles: [
      'Mirror-copy: Mirror 1 copies the opponent\u2019s middle effect \u2014 turn their own play against them;',
      'Meta adaptation: Mirror 0 raises its threshold by the opponent\u2019s card count \u2014 strong against strong;',
      'Sync-draw: Mirror 4 draws whenever the opponent draws, so you\u2019re never behind on card advantage.'
    ]
  },
  peace: {
    position: 'Empty-hand control',
    review: 'Peace 1 empties every hand on the board; Peace 3 easily flips any big card while your hand is empty; Peace 6 punishes whoever holds many cards. A unique idea but heavy self-harm, with a payoff rhythm that\u2019s hard to time \u2014 it\u2019s a system card, weak when slotted in piecemeal.',
    pairs: [
      'Fulcrum — Double empty-hand: Peace\u2019s empty hand plus Fulcrum 0\u2019s hand-count trigger work in perfect sync;',
      'Courage — Empty-hand comeback: empty-hand triggers Courage 0/Courage 3 for adversity bonuses;',
      'Metal — Defense combo: empty hand plus defense, turtling until the opponent gives up.'
    ],
    styles: [
      'Empty-hand: Peace 1 empties every hand, a fresh start;',
      'Empty-hand flip: Peace 3 flips any big card easily on an empty hand;',
      'Hand penalty: Peace 6 punishes those holding many cards, forcing the opponent to clear their hand.'
    ]
  },
  chaos: {
    position: 'Chaos-maker / protocol rearranger',
    review: 'Chaos 1 rearranges both sides\u2019 protocols; Chaos 0 makes both sides draw from each other\u2019s decks at the start; Chaos 3 plays any stack ignoring protocol restrictions \u2014 chaos taken to its extreme. But with so many double-edged effects, you can easily get caught in your own mess. A spectacle-first design showcase.',
    pairs: [
      'Lust — Double control: rearranging plus seizing control \u2014 maximum control-game;',
      'Pride — Rearrange advantage: rearranged protocols plus an advantage snowball;',
      'Momentum — Rearrange-compile: rearranging linked to compiling, finding openings in the chaos.'
    ],
    styles: [
      'Rearrange chaos: Chaos 1 reshuffles both sides\u2019 protocols, dismantling the opponent\u2019s build;',
      'Mutual deck-draw: Chaos 0 makes both sides draw from each other\u2019s decks, stealing resources both ways;',
      'Ignore-restrictions: Chaos 3 plays any stack ignoring protocol limits \u2014 catching the opponent off guard.'
    ]
  },
  clarity: {
    position: 'Precision search',
    review: 'Clarity 2/3 search the deck for a precise 1-point/5-point card and play it; Clarity 0 raises its threshold by your card count \u2014 a stable, controllable "custom-built" engine. A value-oriented playstyle; slow tempo but solid.',
    pairs: [
      'Time — Cycle search: trash cycling plus precision search, your deck never lacks the key card;',
      'Light — Draw-search: double engine, fast to find cards and faster to play them;',
      'Water — Value search: steady value plus tailor-made card finding.'
    ],
    styles: [
      'Precision search: Clarity 2/Clarity 3 custom-search the deck for 1-point/5-point cards, taking exactly what you need;',
      'High-value build: search for a 5-point card and burst \u2014 a decisive blow;',
      'Stable value: zero randomness, a deliberate, step-by-step style.'
    ]
  },
  ice: {
    position: 'Defensive shifting',
    review: 'Ice 1 forces the opponent to discard after playing; Ice 3 can still escape when covered; Ice 4 is immune to flips. Ice 6 \u2014 "can\u2019t draw while holding cards" \u2014 is both a shackle and a signature. Solid defense but lacking offense, and its own sustain chokes itself.',
    pairs: [
      'Metal — Double defense: Ice armor plus the Metal wall, sealing the defensive side;',
      'Sloth — Grind defense: stall tactics plus Ice armor \u2014 the longer it drags, the better for you;',
      'Rigid — Flip-proof: Ice 4 plus Rigid 7, locking your core cards down.'
    ],
    styles: [
      'Ice-armor defense: Ice 1 forces the opponent to discard after playing \u2014 defense into counter;',
      'Shift-and-run: Ice 3 shifts away when covered, protecting your core;',
      'Self-shackle limit: Ice 6\u2019s "no draws with cards in hand" \u2014 extreme hand-count management.'
    ]
  },
  smoke: {
    position: 'Face-down swarm',
    review: 'Smoke 0 lays into every column that holds face-downs; Smoke 2 raises its threshold by the number of face-downs \u2014 a natural teammate for the Darkness/Apathy build. It carries no delete or burst of its own, and a pure swarm is slow; going solo it\u2019s middling.',
    pairs: [
      'Darkness — Face-down boost: the face-downs Smoke lays get Darkness 2\u2019s boost, doubling the payoff;',
      'Apathy — Face-down +1: Smoke\u2019s lays feed Apathy 0, stacking value;',
      'Overwhelm — Double swarm: full-line face-downs, with Smoke 2 adding more value.'
    ],
    styles: [
      'Smoke swarm: Smoke 0 lays into every column with face-downs \u2014 the swarm is the pressure;',
      'Face-down boost: Smoke 2 raises its threshold by the face-down count, trading numbers for value;',
      'Shift defense: Smoke 4 shifts covered face-downs to save cards flexibly.'
    ]
  },
  fear: {
    position: 'Lockdown / heavy discard',
    review: 'Fear 0 locks the opponent\u2019s middle commands on your turn \u2014 and since on-play effects all fire from the middle, that\u2019s half a turn wasted for them; Fear 1 draws 2, makes the opponent discard everything, and lets them draw 1 less \u2014 blowing the hand advantage apart instantly. Lockdown plus resource pressure \u2014 T1 strength.',
    pairs: [
      'Psychic — Lockdown destruction: middle lockdown plus hand destruction, the opponent collapses on both fronts;',
      'Plague — Discard pressure: Fear 1\u2019s full discard plus Plague\u2019s contagious discards empty the hand;',
      'Corruption — Full disruption: three top-tier disruption suites, and the opponent can\u2019t fight back.'
    ],
    styles: [
      'Effect lockdown: Fear 0 locks the opponent\u2019s middle commands on your turn, leaving them spinning their wheels;',
      'Discard crush: Fear 1 draws 2, empties the opponent\u2019s hand, and costs them 1 draw \u2014 blowing up the hand difference;',
      'Defensive counter: Fear 2 recalls opponent cards and Fear 3 shifts \u2014 offense and defense in one.'
    ]
  },
  corruption: {
    position: 'Full-spectrum disruption',
    review: 'Corruption 0 can hit any protocol slot on either side and flips a card for free every turn; Corruption 2 \u2014 "you discard \u2192 the opponent discards" \u2014 chains with draws into a cascade of corrosion; Corruption 1 recalls an opponent\u2019s card to the top of their deck face-down. Supreme flexibility and disruption \u2014 T0.',
    pairs: [
      'Fear — Lockdown disruption: lockdown plus corrosion, the opponent can\u2019t move;',
      'Psychic — Hand destruction: discards plus corrosion chains, resources avalanche;',
      'Wrath — Delete disruption: corruption flips plus Wrath\u2019s big-card kill, striking everywhere.'
    ],
    styles: [
      'Corrosion chain: Corruption 2 makes the opponent discard when you do, chaining with draws;',
      'Any-slot plays: Corruption 0 hits any protocol slot on either side \u2014 free placement;',
      'Flip harassment: Corruption 0 flips a card free every turn plus Corruption 1\u2019s recall \u2014 constant pestering.'
    ]
  },
  war: {
    position: 'Counter / reaction',
    review: 'Delete a card when the opponent draws, make them discard their empty hand when they compile, and freeload when they refresh \u2014 spring-loaded counterplay: the more active the opponent, the stronger you get. But the initiative sits with them, so against a turtling deck you go quiet \u2014 consistency is the real weakness.',
    pairs: [
      'Wrath — Counter-snipe: counters plus big-card deletes make every opponent move a loss;',
      'Fear — Lockdown counter: shut down the opponent\u2019s counters and wait for their mistakes;',
      'Sloth — Grind counter: stall tactics plus spring counters \u2014 the longer it drags, the more you profit.'
    ],
    styles: [
      'Spring counter: delete on their draws, freeload on their refreshes \u2014 the more active, the stronger;',
      'Compile penalty: War 2 makes the opponent discard their hand after compiling \u2014 punishing advancement;',
      'Draw penalty: War 0 deletes a card whenever the opponent draws, strangling their resources.'
    ]
  },
  courage: {
    position: 'Comeback from behind',
    review: 'Draw on an empty hand, draw while behind, delete opponent cards while behind, and even shift yourself into the opponent\u2019s strongest line \u2014 the further behind you are, the fiercer it gets. But when you\u2019re ahead its effects all shrink (Courage 6 even flips itself) \u2014 a fighter\u2019s protocol that\u2019s always staging a comeback.',
    pairs: [
      'Fulcrum — Empty-hand synergy: empty-hand plus adversity double-trigger, popping off from behind;',
      'Peace — Empty-hand comeback: Peace\u2019s hand-clear plus Courage 0\u2019s empty-hand draw;',
      'Wrath — Adversity delete: delete opponent cards while behind \u2014 the comeback trifecta.'
    ],
    styles: [
      'Comeback: draw and delete while behind \u2014 the worse it gets, the fiercer you play;',
      'Empty-hand limit: Courage 0 draws on an empty hand and Courage 3 shifts into the opponent\u2019s strongest line;',
      'Adversity pressure: Courage 2 draws every turn while behind, overtaking the opponent\u2019s resources.'
    ]
  },
  time: {
    position: 'Trash-cycle',
    review: 'Time 0 plays a card straight from the trash and shuffles it back into the deck; Time 1 aggressively dumps the whole deck into the trash; Time 4 draws 2 and discards 2 to filter \u2014 resources cycle forever, and the more you play the more you have. Naturally synced with every protocol\u2019s discard/delete actions, and extremely adaptable.',
    pairs: [
      'Water — Return-cycle: two cycling protocols, resources never run dry;',
      'Light — Draw-cycle: draws plus trash recovery keep the deck turning;',
      'Gluttony — Clear-cache cycle: clearing cache plus cycling, maximizing per-turn payoff.'
    ],
    styles: [
      'Trash-cycle: Time 0 plays from the trash and shuffles back into the deck \u2014 the more you play, the more you have;',
      'Aggressive dump: Time 1 dumps the whole deck into the trash for extreme cycling;',
      'Filtering: Time 4 draws 2 and discards 2, quickly sifting out useless cards.'
    ]
  },
  diversity: {
    position: 'Rainbow / mixed-color condition',
    review: 'Diversity 0 compiles outright once you have 6 different protocols; Diversity 3 gives non-Diversity cards +2, rewarding variety on the board. But Diversity 6 requires at least 3 protocols or it self-deletes, shackling your deck-building. Ceiling depends on the meta; the floor is miserable.',
    pairs: [
      'Chaos — Multi-protocol swarm: any-stack plays plus many protocols on board to feed Diversity 0;',
      'Pride — Multi-line swarm: multi-line value plus Diversity 3\u2019s boost;',
      'Assimilation — Steal to diversify: even stolen off-type cards count toward the protocol spread.'
    ],
    styles: [
      'Rainbow edge: gather cards of 6 different protocols and Diversity 0 compiles outright;',
      'Diversity boost: Diversity 3 adds +2 threshold to non-Diversity cards \u2014 the more variety, the stronger;',
      'Meta check: scales dynamically with the number of protocol types on the board.'
    ]
  },
  assimilation: {
    position: 'Card theft',
    review: 'Assimilation 0 takes an opponent\u2019s face-down card straight into your hand; Assimilation 1 refreshes on discard and steals the deck top; Assimilation 2 plays the opponent\u2019s deck top into your own stack \u2014 the resource thief\u2019s thief. Strong at generating card advantage, but the stolen cards are only as good as the opponent\u2019s deck.',
    pairs: [
      'Love — Double steal: two theft suites stacked, emptying the opponent\u2019s deck outright;',
      'Time — Cycle theft: stolen cards enter the cycle for endless reuse;',
      'Corruption — Disrupt-steal: disruption plus theft, dismantling the opponent on every front.'
    ],
    styles: [
      'Resource thief: Assimilation 0 takes an opponent\u2019s face-down into your hand \u2014 stolen outright;',
      'Deck theft: Assimilation 1 refreshes on discard and steals the opponent\u2019s deck top, the card advantage snowballs;',
      'Exchange: Assimilation 4 makes both sides draw from each other\u2019s decks \u2014 beat the opponent with their own cards.'
    ]
  },
  unity: {
    position: 'Self-contained combo / All-in',
    review: 'Five Unity cards on the board compile and delete a column outright; Unity 4 draws every Unity card from the deck when your hand is empty \u2014 once assembled it erupts catastrophically. But a single Unity card alone is a dead draw, and without the combo it falls apart \u2014 it all comes down to draw order. Thrilling but fragile, and the highest barrier to entry of the lot.',
    pairs: [
      'Momentum — Compile synergy: Unity\u2019s combo-compile plus Momentum\u2019s counter, chaining into a burst;',
      'Greed — Auto-compile: Greed 1\u2019s auto-compile plus Unity 1\u2019s five-card compile \u2014 double insurance;',
      'Nova — Same-family burst: Unity\u2019s board-clear plus Nova\u2019s board-clear, ending the game in one blow.'
    ],
    styles: [
      'Combo burst: five Unity cards on board compile and delete a column \u2014 instant board clear;',
      'Draw-to-combo: Unity 4 draws every Unity card from the deck on an empty hand, assembling fast;',
      'All-in self-contained: a closed build that ignores interaction \u2014 win big or lose everything.'
    ]
  },
  envy: {
    position: 'Mirror growth',
    review: 'Envy 0 directly boosts the value of the opponent\u2019s highest-threshold card \u2014 the fatter they get, the fatter you get; Envy 2 draws a number of cards equal to the opponent\u2019s hand \u2014 a resource engine running at full tilt. "What\u2019s yours is mine" \u2014 theme and mechanic in perfect harmony, tying for the top design score.',
    pairs: [
      'Mirror — Double mirror: copying plus stolen threshold, the stronger the opponent the stronger you get;',
      'Courage — Adversity mirror: drawing from behind plus mirror amplification, popping off in a pinch;',
      'Time — Resource mirror: cycling resources plus mirror growth, snowballing.'
    ],
    styles: [
      'Mirror amplification: Envy 0 boosts the opponent\u2019s highest-threshold card \u2014 the fatter they get, the fatter you get;',
      'Hand-advantage: Envy 2 draws as many as the opponent holds, crushing the resource gap;',
      'Ahead-pressure: stack your own value too \u2014 a two-pronged approach.'
    ]
  },
  gluttony: {
    position: 'Resource devourer / clear-cache',
    review: 'Gluttony 0 plays one card after clearing the cache (a mandatory action, so it\u2019s free value); Gluttony 2 draws as many as you hold; Gluttony 3 deletes a card when covered \u2014 a big appetite with plenty of sustain. But the burst hinges on cache-clear timing, and it starves under pressure.',
    pairs: [
      'Time — Cycle devour: trash cycling plus devouring, an endless appetite;',
      'Fire — Discard synergy: Gluttony\u2019s cache-clear plus Fire\u2019s discard-for-payoff;',
      'Water — Return-devour: returns plus draws close the resource loop.'
    ],
    styles: [
      'Clear-cache: Gluttony 0 plays a card after clearing the cache \u2014 free value onto the board;',
      'Resource devour: Gluttony 2 draws as many as you hold \u2014 the more you play, the bigger the hand;',
      'Cover-delete: Gluttony 3 deletes the covering card when covered \u2014 offense and defense in one.'
    ]
  },
  greed: {
    position: 'Snowball / auto-compile',
    review: 'Greed 1 auto-compiles qualifying lines in the end phase \u2014 one extra compile opportunity over normal, the ultimate snowball. Greed 4 trades discards for flips and Greed 2 discards opponent cards, with very profitable resource conversion. Once the value starts snowballing, nothing stops it.',
    pairs: [
      'Momentum — Compile synergy: Greed 1\u2019s auto-compile plus Momentum 1\u2019s counter, chaining into a snowball;',
      'Pride — Advantage snowball: twin snowballs, the smoother it goes the stronger it gets;',
      'Gravity — Thick-column compile: a thick Gravity column plus Greed 1\u2019s end-phase compile \u2014 double insurance.'
    ],
    styles: [
      'Auto-compile: Greed 1 auto-compiles qualifying lines \u2014 one more chance than everyone else;',
      'Snowball: the more resources, the stronger the effects \u2014 unstoppable once rolling;',
      'Discard-flip: Greed 4 trades hand discards for flips \u2014 resource conversion.'
    ]
  },
  lust: {
    position: 'Control master',
    review: 'Lust 0 grants control, and while you hold it the opponent can\u2019t compile \u2014 control that directly seals the win. Lust 2 steals the opponent\u2019s covered cards; Lust 4 forces the opponent to lose control. The protocol that leans hardest on the control mechanic \u2014 the peak of skill, made for experts.',
    pairs: [
      'Pride — Double control: seize control plus hold-pressure, locking the control down;',
      'Chaos — Rearrange-control: protocol rearranging plus control games;',
      'Fear — Lockdown control: lockdown plus control, paralyzing the opponent twice over.'
    ],
    styles: [
      'Control pressure: Lust 0 grants control and bars the opponent\u2019s compile while held \u2014 locking the win directly;',
      'Steal-shift: Lust 2 shifts the opponent\u2019s covered cards onto your side;',
      'Control game: Lust 4 forces the opponent to lose control, bouncing back and forth.'
    ]
  },
  pride: {
    position: 'Ahead snowball',
    review: 'Pride 2 draws for every line you\u2019re ahead on; Pride 0 refreshes after compiling and can shift an opponent\u2019s card; Pride 6 counters with a flip when control is taken \u2014 winner takes all, the smoother it goes the stronger it gets. But fall behind and every effect goes quiet \u2014 the classic god when ahead, a bug when behind.',
    pairs: [
      'Lust — Double control: control plus advantage, double pressure;',
      'Greed — Snowball-compile: twin snowballs, turning an advantage into a winning position;',
      'Momentum — Compile synergy: Pride 0\u2019s refresh after compiling plus Momentum 1\u2019s counter.'
    ],
    styles: [
      'Ahead snowball: Pride 2 draws for each line you\u2019re ahead on \u2014 the smoother it goes, the stronger it gets;',
      'Compile-refresh: Pride 0 refreshes after compiling, pocketing one extra action;',
      'Control pressure: Pride 4 shifts away opponent cards while holding control, dismantling their defenses.'
    ]
  },
  sloth: {
    position: 'Stall king / sustain',
    review: 'Sloth 1 returns a card and refreshes for a free action; Sloth 0 adds +5 threshold when covered by a Sloth card; Sloth 4 flips first to survive before being covered \u2014 the unkillable cockroach, grandmaster of the stall. The downside: it stalls too well and lacks a quick finisher.',
    pairs: [
      'Metal — Double defense: stall tactics plus defense, grinding the opponent to collapse;',
      'Ice — Ice-armor sustain: Ice armor plus sustain \u2014 the longer it drags, the better for you;',
      'Time — Cycle sustain: resource cycling plus Sloth\u2019s free actions.'
    ],
    styles: [
      'Stall tactics: Sloth 1 returns and refreshes for a free action every turn;',
      'Grind sustain: Sloth 0 adds +5 threshold when covered by a Sloth card \u2014 the unkillable cockroach;',
      'Counter: Sloth 4 flips before being covered, keeping key cards alive.'
    ]
  },
  wrath: {
    position: 'Sniper / big-card hunter',
    review: 'Wrath 0 makes the highest-threshold card in your line not count toward the total \u2014 the opponent\u2019s 5-point monster becomes a dead weight. Wrath 2 flips the column with the most cards; Wrath 1 discards control to delete a card. It goes straight for the opponent\u2019s biggest cards, terrorizing big-card strategies.',
    pairs: [
      'Death — Double delete: Death handles small cards, Wrath kills big cards \u2014 strike everywhere;',
      'War — Counter-snipe: counters plus snipes, every opponent move is a loss;',
      'Courage — Adversity delete: adversity plus big-card kills \u2014 a comeback weapon.'
    ],
    styles: [
      'Sniper: Wrath 0 makes your line\u2019s highest-threshold card not count \u2014 the opponent\u2019s big card becomes scrap;',
      'Flip-frenzy: Wrath 2 flips the column with the most cards into a free-for-all;',
      'Discard-control-delete: Wrath 1 draws and trades control for a delete \u2014 willing to pay for value.'
    ]
  },
  ambush: {
    position: 'Hidden development',
    review: 'Ambush 1 flips all 0/1-point cards and draws for each, turning low-value cards into a draw engine. Ambush 0 draws 3 and flips 1; Ambush 3 flips the opponent\u2019s highest-threshold card. Simple conditions, brisk tempo \u2014 the friendliest disruption suite for new players.',
    pairs: [
      'Clarity — Low-value search: search 0/1-point cards to feed Ambush 1 \u2014 a flip-draw engine;',
      'Light — Draw-flip: draw plus flip synergy, cycling resources;',
      'Water — Value flip: steady value plus hidden development.'
    ],
    styles: [
      'Low-value engine: Ambush 1 flips every 0/1-point card and draws for each, using low-value cards as an engine;',
      'Sneak-flip: Ambush 3 flips the opponent\u2019s highest-threshold card, wrecking their setup;',
      'Light development: friendly rules and brisk tempo \u2014 the go-to for new players.'
    ]
  },
  fulcrum: {
    position: 'Precision hand-count control',
    review: 'At exactly 0 cards in hand, discard 2 of the opponent\u2019s; at exactly 2, delete 1 of theirs; at exactly 4, draw 1 \u2014 hand management as an art form. But "exactly" makes the margin for error razor-thin, and one miscount collapses everything. High ceiling, higher skill floor \u2014 reserved for masters.',
    pairs: [
      'Peace — Double empty-hand: Peace\u2019s hand-clear plus Fulcrum 0\u2019s hand-count trigger \u2014 a perfect fit;',
      'Courage — Empty-hand adversity: empty-hand plus adversity, double trigger;',
      'Mirror — Hand mirror: hand-count control plus mirror copying.'
    ],
    styles: [
      'Empty-hand: at 0 cards, discard 2 of the opponent\u2019s \u2014 seize the first move;',
      'Hand-count control: delete 1 at 2 cards, draw 1 at 4 \u2014 nailing the hand count precisely;',
      'Precision instrument: low margin for error but an extreme ceiling \u2014 for masters only.'
    ]
  },
  overwhelm: {
    position: 'Swarm pressure',
    review: 'Overwhelm 1 counters and lays cards into lines you\u2019re ahead on; Overwhelm 2 counters on every line and flips itself; Overwhelm 3 keeps laying while your hand is big \u2014 drowning the opponent in numbers and a hand at seizing control. Careful: Overwhelm 2 makes the opponent lay too, so don\u2019t feed their value.',
    pairs: [
      'Life — Double swarm: two swarm suites pushing all three lanes, control is always yours;',
      'Darkness — Face-down boost: the face-downs Overwhelm lays get Darkness 2\u2019s boost;',
      'Apathy — Face-down +1: swarm plus Apathy 0, stacking value.'
    ],
    styles: [
      'Full-line swarm: Overwhelm 2 counters every line and flips itself \u2014 the swarm is the pressure;',
      'Numbers pressure: Overwhelm 4 deletes the opponent\u2019s low-value cards when your board is big \u2014 strength in numbers;',
      'Control: push all three lanes to seize control and rearrange protocols with ease.'
    ]
  },
  momentum: {
    position: 'Compile-synergy engine',
    review: 'Momentum 1 plays a counter after any player compiles (you profit off the opponent\u2019s compiles too); Momentum 0 keeps feeding value into already-compiled lines for a re-compile; Momentum 4 rearranges protocols. A core add-on for compile builds, doubling its value with Greed/Pride.',
    pairs: [
      'Greed — Compile synergy: counter on every compile plus Greed\u2019s auto-compile, chaining into a snowball;',
      'Pride — Compile-refresh: compile plus refresh plus Momentum\u2019s counter;',
      'Unity — Combo-compile: Unity\u2019s combo-compile plus Momentum\u2019s free counter.'
    ],
    styles: [
      'Compile synergy: Momentum 1 counters after any player compiles \u2014 even off the opponent\u2019s compile;',
      'Re-compile: Momentum 0 keeps feeding already-compiled lines, prepping a re-compile to steal the opponent\u2019s cards;',
      'Protocol rearrange: Momentum 4 reshuffles protocols for flexible positioning.'
    ]
  },
  nova: {
    position: 'Nuke / one-turn decider',
    review: 'Nova 0 wipes every face-up card in a line that has exactly 5 cards \u2014 a one-shot board-clearing nuke. Nova 3/4 shift and flip based on stack size; Nova 2 can even seize control. Harsh conditions and complex execution, but one success decides the whole game. Design quality tied for the top of the entire set.',
    pairs: [
      'Greed — Thick-column clear: a thick column plus Nova 0\u2019s board-clear \u2014 nuke launch;',
      'Gravity — Thick-column burst: a thick Gravity column makes Nova\u2019s conditions easy to meet;',
      'Life — Swarm conditions: Life\u2019s swarm helps Nova 0 hit "exactly 5 cards".'
    ],
    styles: [
      'Board-clear nuke: Nova 0 deletes every face-up in a line with exactly 5 cards \u2014 one shot clears the board;',
      'Stack manipulation: Nova 3/4 shift and flip by stack size for precision strikes;',
      'Control burst: Nova 2 rearranges or seizes control, setting up before the explosion.'
    ]
  },
  inertia: {
    position: 'Rule-breaker',
    review: 'Inert 0 negates every top command in your line; Inert 1 negates every bottom command; Inert 4 dumps both decks into the trash \u2014 rewriting the game\u2019s rules so the opponent\u2019s standing effects all fail at once. But you too live in a "negated" battlefield, the double edge is obvious, and the rule comprehension cost is high.',
    pairs: [
      'Fear — Lockdown negation: twin lockdowns, the opponent\u2019s standing effects all fail at once;',
      'Metal — Defense negation: defense plus negation, gutting the opponent\u2019s offense and defense;',
      'Apathy — Negate middle: top-plus-middle negation, wiping out every command.'
    ],
    styles: [
      'Command negation: Inert 0 negates every top command in your line, killing the opponent\u2019s standing effects;',
      'Negate passives: Inert 1 negates every bottom command in your line, wiping out passives;',
      'Deck bombing: Inert 4 dumps both decks into the trash \u2014 a mutual-destruction reshuffle.'
    ]
  },
  rigidity: {
    position: 'Heavy fortress',
    review: 'Rigid 7 is a single 7-point card that can\u2019t be flipped or shifted \u2014 one card doing most of a compile line\u2019s work, a steadying anchor. Rigid 1 flips an opponent\u2019s card and lays into their face-down line, balanced on offense and defense. A simple, blunt value monster with outstanding consistency.',
    pairs: [
      'Metal — Double defense: fortress plus the Metal wall, a compile line as solid as iron;',
      'Ice — Flip-proof: Rigid 7 plus Ice 4, locking your core cards down;',
      'Sloth — Sustain fortress: sustain plus standing your ground, steadier the longer it goes.'
    ],
    styles: [
      'Fortress stand: Rigid 7 is a single 7-point, unflippable, unshiftable card that does most of a compile line\u2019s work;',
      'Face-down pressure: Rigid 1 flips an opponent card and lays into their face-down line \u2014 balanced on both fronts;',
      'High-value: crush with raw value for a fast compile \u2014 simple and blunt.'
    ]
  },
  flexibility: {
    position: 'Swiss army knife / utility',
    review: 'Choice, shift, and draw all in one, with return/flip/exchange at its fingertips \u2014 every card is a generic action that patches into any deck. But it\u2019s all small flexibilities with no finisher: a cherry on top, never the rescue in a pinch.',
    pairs: [
      'Spirit — Double mobility: two mobility protocols, weaving anywhere on the board;',
      'Water — Utility duo: twin all-rounders, however you build it, it runs smooth;',
      'Light — Draw-flex: draws plus flexibility, resources and mobility in one.'
    ],
    styles: [
      'Universal patch: choice/shift/draw/return/flip/exchange all covered \u2014 patch wherever it\u2019s thin;',
      'Mobility guerrilla: Flexible 3 shifts opponent cards or swaps your own protocol \u2014 endlessly adaptable;',
      'Beginner-friendly: all generic actions and friendly rules \u2014 the teaching pick.'
    ]
  }
};

/** 六个评分维度名（全局一份，不按协议分；直接画在评分条上） */
export const SCORE_KEYS_EN: Readonly<Record<string, string>> = {
  上手: 'Ease',
  强度: 'Strength',
  适配: 'Synergy',
  设计: 'Design',
  深度: 'Depth',
  稳定: 'Stability',
};
