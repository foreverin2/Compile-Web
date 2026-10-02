/**
 * 中文文案表（★ 2026-10-01，P0：i18n 基建的第一步）。
 *
 * ## 这张表的硬口径（不是风格偏好，是门禁逼出来的）
 *
 * 1. **值与现状逐字一致**：`settings.*` 这几条就是 `src/ui/home.ts` 的
 *    `settingsOverlayElement()` 里那些中文字面量的原文，一个字都不许改。
 *    仓库里有几十条测试逐字钉住中文按钮/文案，P0 不许让它们变红
 *    （`tests/ui/local-data-screen.test.ts` 第 9 组就钉着 `关闭` 与 `改动只在本次会话有效…`）。
 *    `tests/i18n/tables.test.ts` 有一条腿把这件事做成机检：把 `zh` 表里这几条值直接塞进
 *    `t()`，与既有屏上出现的字面量逐字节比对。
 * 2. **只放 UI 文案，不放卡牌文本**：`src/data/cards*.ts` 的中文是**数据**，被
 *    `npm run texts:check` 与联机卡文哈希逐字钉住；英文卡面是以后 P4 的"显示层翻译表"
 *    （按 `defId` 映射、只在渲染时替换），**不进这张表**。
 * 3. **键集必须与 `en.ts` 完全一致**：`tests/i18n/tables.test.ts` 的"表完整性腿"逐键比对，
 *    多一条少一条都报红。逐屏抽取（P3）每抽一屏就往两张表里**同时**加键。
 *
 * ## 命名
 *
 * 键名 `屏.元素[.变体]`，全小写点分：`settings.title` / `settings.fx.metal6.desc`。
 * 同一个键在两张表里的位置必须对应 —— 表还是人读的，别为了"少写几行"把两张表的结构写歪。
 *
 * ## 为什么这里是"扁平 Record"而不是嵌套对象
 *
 * `t('settings.title')` 这种点分键在**缺键扫描腿**（扫 `src/**` 的 `t('…')` 调用）里是
 * 可以纯文本提取的：嵌套对象会逼那条腿长出"按点分路径走对象"的第二套实现，而两套实现
 * 一旦漂移，漏翻就重新变成静默的。代价是这里是一张平表，可接受。
 */

export const ZH: Readonly<Record<string, string>> = {
  /* ── 设置小窗（P0 唯一抽取的屏；值必须与改动前的字面量逐字一致） ── */
  'settings.title': '设置',
  'settings.close': '关闭',
  'settings.aria': '设置',
  // 「语言 / Language」：这一行**一个键**就够 —— 两个选项名（`中文` / `English`）来自
  // `src/i18n/lang.ts` 的 `LANGS`（语言清单的唯一出处），**刻意不进文案表**：
  // 选项名是给"看不懂当前语言的人"看的，它不该跟着当前语言变（切到英文后中文选项若写成
  // "Chinese"，中文玩家就找不回来了）。
  'settings.lang': '语言 / Language',
  'settings.lang.hint': '语言会保存到本机，刷新后仍然生效。',
  // 写盘失败时的那一句（玩法不变：本次会话仍然生效，只是刷新会回到上次保存的那种）。
  // ⚠️ **只有一个键**（原来那条不带 detail 的 `settings.lang.save-failed` 已删）：第一版留着它，
  // 但它**没有任何调用链可达** —— 线上验收 D3 判为死文案（"要么删掉、要么让它可达"）。
  // ⚠️ 这句是**状态/错误报告**形态，不是对玩家的隐私承诺 —— 见
  // `tests/ui/privacy-consumers.test.ts` 的两层判据（它只对 import 了 `privacy.ts` 的
  // 消费方生效，而 `home.ts` 不是消费方；这里如实标注口径，免得以后有人误会）。
  'settings.lang.save-failed-detail': '语言没能保存到本机。本次会话仍然用这种语言，刷新后会回到上次保存的那种。',
  // 系统给的技术消息单独一段 —— ⚠️ D3 第二条之后它**只可能是系统语言（英文）**：
  // 纯层（`src/app/storage.ts`）不再拼任何中文句子，这里带出来的就是 `Error.message` 那种原样串。
  'settings.lang.save-failed-tech': '技术细节：{detail}',
  // 值超上限：**两个数**由本层按语言格式化后填进来（纯层只给数值，不给句子）
  'settings.lang.fail.too-large': '{bytes} 字节 > 上限 {limit} 字节。',
  'settings.lang.fail.write-rejected': '本机存储拒绝了写入（隐私模式或配额已满）。',
  // ★ 2026-10-01（P0 线上验收 D4）：「本地数据与隐私」屏的**语言那一行**。
  // `value` 带 `{lang}` 占位（不拼接：缺语言名时好排查）；`invalid` 是"键存在但不是有效值"时
  // 的如实补充。⚠️ 该屏的**其它文案没有抽取**（P0 只抽了设置小窗）—— 它还登记在
  // `docs/2026-10-01-i18n-尚未抽取的屏.md` 里，别把它从清单划掉。
  'local-data.lang.label': '界面语言',
  'local-data.lang.value': '界面语言：{lang}',
  'local-data.lang.invalid': '（本机存的不是一个有效值，按默认语言显示）',
  'local-data.lang.read-failed': '界面语言：读取本机数据失败：{detail}',
  'settings.hint': '改动会保存到本机（与昵称同一份存储），下次进入仍然生效；游客模式下只在本次会话有效。',
  // 开关写盘失败时的补充（与语言那一项共用 `saveFailedText` 的句式，这里只补"开关"这一档的后果）
  'settings.fx.save-failed-detail': '开关没能保存到本机。本次会话仍然生效，下次进入时会回到上次保存的状态。',
  'settings.fx.on': '开启',
  'settings.fx.off': '关闭',
  // 开关说明的就地改写形态：`{desc}（当前：{state}）`
  'settings.fx.state': '{desc}（当前：{state}）',
  'settings.fx.metal6.label': '金属6 频闪特效',
  'settings.fx.metal6.desc': '手牌里的金属6 牌面会循环渐现一张图。关掉之后不再显示，其它卡牌的特效不受影响。',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-01（C，用户明确抱怨）：**首页那一屏**
   *
   * 用户原话：「我发现切换成英文后，除了设置里的文本变成英语了，其他所有地方的文本都没有改变，
   * **包括首页的文本**」。⇒ 这一轮把首页周边全部抽进表：主页菜单与页脚、模式选择页、
   * 掷硬币页、图鉴页、规则页。
   *
   * ⚠️ **值与改动前逐字一致**（`tests/i18n/home-copy.test.ts` 有一条腿逐条比对）。
   * ⚠️ 其余屏（牌桌 / 大厅 / 制作器 / 反馈…）**仍然没有抽**，继续登记在
   * `docs/2026-10-01-i18n-尚未抽取的屏.md` 里。
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── 主页（`renderHome`） ── */
  'home.sub': '译世界 · 非官方网页版',
  'home.start': '开始游戏',
  'home.library': '查看协议及其所属卡牌',
  'home.tutorial': '新手教程',
  'home.rules': '查看一/二/三代规则图纸',
  'home.local-data': '本地数据与隐私',
  'home.cardmaker': '自定义协议与卡牌',
  // 页脚署名：作者名与署名「我吃吃吃吃」是**专名**，两种语言都不翻（只翻框架句）
  'home.footer': 'Compile 桌游由原作者 MICHAEL YANG 创作 · 本网页由「我吃吃吃吃」使用 DSH 辅助开发',

  /* ── 模式选择页（`renderModeSelect`） ── */
  'mode.title': '选择游戏模式',
  'mode.hotseat.name': '热坐（双人）',
  'mode.hotseat.desc': '两名玩家轮流在同一设备上对战（当前可用）',
  'mode.online.name': '联机对战（两台设备）',
  'mode.online.desc': '与另一台设备开一局：建房生成邀请码，或粘贴对方发来的邀请码。连接设置与各项说明都在大厅里。',
  'mode.solo.name': '单人模式',
  'mode.solo.desc': '对战 AI 对手',
  'mode.trio.name': '三人模式',
  'mode.trio.desc': '三人同台对战',
  'mode.ban': '禁用模式',
  'mode.ban.tip': '开局可禁用部分协议：先掷硬币定先手，后手先禁 2 → 先手选 1 禁 1 → 后手选 2 禁 1 → 先手选 2 禁 2 → 后手选 1（选 6 禁 6）。被禁协议本局不可选，世代筛选仍可用。',
  'mode.random': '随机池模式',
  'mode.random.tip': '开局随机从全部协议中抽取 12 套作为本局可选池（不再全量可选）。世代筛选仍可用；若同时开启禁用模式，则在 12 套内按禁用模式规则选/禁。',
  'mode.device-check': '设备体检 / 网络自检',
  'mode.zoom-hint': '建议把画面调到 65% 左右游玩：用浏览器自带的缩放（Ctrl + 滚轮，或 Ctrl 和 +/−）调整。',

  /* ── 掷硬币页（`renderCoin` 的热座那一路） ── */
  'coin.title': '玩家一掷硬币决定先后手',
  'coin.rule': '玩家一先选择硬币正/反面，再掷硬币：掷出的面与玩家一的选择一致 → 玩家一先选协议；否则玩家二先选协议。',
  'coin.second': '后选择协议的一方在对局中先出牌。',
  'coin.toss': '掷硬币',
  'coin.need-pick': '请先选择 正面 或 反面',
  'coin.begin': '开始对局',
  // 掷硬币结果那一句：`掷出 {face} —— 玩家 {n} 先选协议 · 玩家 {m} 先出牌`
  'coin.result': '{call}掷出 {face} —— 玩家 {n} 先选协议 · 玩家 {m} 先出牌',
  // 联机那条路在结论前多一段「玩家 N 叫了「某面」」
  'coin.result.call-prefix': '{call} —— ',

  /* ── 掷硬币页的**联机那一路**（`renderCoinNet`） ── */
  'coin.net.title.caller': '加入方选硬币面定先后手（联机）',
  'coin.net.title.waiter': '等加入方选硬币面（联机）',
  'coin.net.rule.caller': '由加入方选硬币的正/反面。选中的面与掷出的面一致 → 选中方先选协议；否则另一方先选协议。',
  'coin.net.rule.waiter': '由加入方选硬币的正/反面。对方选完之后，双方都看得到掷出的那一面。',
  'coin.net.pick': '请选择硬币的正/反面。',
  'coin.net.waiting': '等对方叫面（对方按下正/反之后，掷硬币才会继续）。',
  'coin.net.other-calls': '这一局由对方叫面（你这一侧没有可点的东西）——等对方按下正/反。',
  // 「玩家 N 叫了「某面」」以及它的三种接续
  'coin.net.called': '玩家 {n} 叫了「{face}」',
  'coin.net.tossing': '{call} —— 正在抛硬币…',
  'coin.net.await-toss': '{call}，等掷硬币。',
  'coin.net.landed': '掷出{face}。',
  'coin.net.already-called': '你已经叫过「{face}」了 —— 正在等对端揭示，不用重复点击。',

  /* ── 图鉴页（`renderLibrary`） ── */
  'library.title': '协议与卡牌图鉴',
  // 副标题：`{n} 套协议 × 6 张指令卡（按代筛选 · 悬停实时预览，点击放大详情）`
  'library.sub': '{n} 套协议 × 6 张指令卡（按代筛选 · 悬停实时预览，点击放大详情）',
  'library.compiled': '{name} · 已编译',
  'library.card-caption': '{protocol} {n} 分指令卡',
  'library.card-alt': '{protocol} {n} 分',
  'library.count': '{checked} / {all} 类已勾选 · 命中 {hit} / {total} 张卡',
  'library.count-none': '当前 0 张（{total} 张全被排除）',
  'library.filter': '按效果分类筛选',
  'library.all': '全选',
  'library.none': '全不选',
  'library.empty': '没有符合当前筛选项的卡牌 —— 勾几个效果分类，或把世代重新打开。',

  /* ── 规则页（`renderRules`） ── */
  'rules.title': '规则图纸',
  'rules.sub': '游戏一/二/三代说明书与 FAQ（点击进入在线阅读）',
  'rules.pdf': '原版 PDF',
  // 规则书浮层顶栏：`{title}（共 {pages} 页）`；页图的 alt：`{title} 第 {n} 页`
  'rules.pages-title': '{title}（共 {pages} 页）',
  'rules.page-alt': '{title} 第 {n} 页',
  'rules.gen1': '1代说明书',
  'rules.gen1.sub': 'Compile MN01（水/火/光/暗/生/死…）',
  'rules.gen2': '2代说明书',
  'rules.gen2.sub': 'Compile MN02（冰/明镜/混乱/恐惧…）',
  'rules.gen3': '3代说明书',
  'rules.gen3.sub': 'Compile MN03',
  'rules.gen3.solo': '3代单人游玩说明书',
  'rules.gen3.solo.sub': '单人规则扩展',
  'rules.faq': '游戏详细FAQ说明书',
  'rules.faq.sub': '官方 FAQ 汇总',

  /* ── ★ 2026-10-01（P1）：**新玩家首启向导**（三步）── */
  'onboarding.title': '首次使用引导',
  'onboarding.aria': '首次使用引导',
  // 第 N 步 / 共 3 步
  'onboarding.step': '第 {n} 步 / 共 {total} 步',
  'onboarding.lang.label': '选择界面语言',
  // 第 1 步之后的那句指引（用户口径：之后可在「首页 → 设置」更改）
  'onboarding.lang.hint': '之后可以在首页的「设置」里更改语言。',
  'onboarding.nick.label': '昵称（可留空）',
  'onboarding.nick.placeholder': '给自己起个昵称',
  // 第 3 步（教学模式是 P2 才做 ⇒ 宿主按选择给一句如实的提示，见 `onboarding.after-*`）
  'onboarding.tutorial.question': '要不要先学着怎么玩？',
  // ★ 2026-10-02（P3 第三批）：第 3 步两个按钮（**用户原话**）。值逐字等于改动前的字面量。
  'onboarding.tutorial.start': '开始教学',
  'onboarding.tutorial.skip': '我玩过，直接跳过',
  /**
   * 第 2 步的那句**指引**（★ 2026-10-02 线上真机验收 **D2** 修法）。
   *
   * 第一版这里直接用的是旧授权弹窗那句 `CONSENT_DENY_HINT`（「你随时可以在主界面的
   * 「本地数据与隐私」里改变这个选择。」）⇒ 真机实测：那句话只说"改变选择"，
   * **没说昵称能改、也没说本机数据能清**，而用户口径是
   * 「提示后续可在首页的本地数据与隐私中进行更改」（方案 §3 另写着"也能清除本机数据"）。
   * 现在这一条把那两件事都点出来，且**逐字点名入口路径**。
   *
   * ⚠️ 与之并存的 `onboarding.consent.deny-note` 是**旧弹窗那句**（"不用之后"的后果 + 出路），
   * 它必须与 `CONSENT_COPY.denyHint` 逐字一致（有腿钉住）；两者**不是**同一句，别合并。
   */
  'onboarding.consent.local-hint': '之后可以在首页的「本地数据与隐私」里修改昵称，也可以在那里清除本机数据。',
  /**
   * 第 3 步「我玩过，直接跳过」那支的结果提示（★ 2026-10-02 D1 定稿 + P2 收尾）。
   *
   * D1 的缺陷是双重的：① `finishOnboarding` 的三元判反了（提示发给了「开始教学」那一支）；
   * ② 用户要的那句"以后还能再进教学模式"**从来没被写出来过**（线上 bundle 里"再次进入"命中 0）。
   *
   * ★ P2 起：**「开始教学」那一支直接进教学屏**了，所以它不再需要一句提示 ⇒
   * `onboarding.after-start`（"教学模式还在开发中…"）**已删除** —— 不是随手删的，
   * 是 `tables.test.ts` 的"死键"腿在 P2 收尾时报出来的（那一轮它确实不再被任何代码引用）。
   * 留下的这一条是跳过那支的提示，措辞照用户口径。
   */
  'onboarding.after-skip': '以后想学的时候，在首页点「新手教程」就能进入教学模式。',
  /**
   * 第 2 步的**授权那一组**（★ 2026-10-01，P1 的第二次修法）。
   *
   * 用户要求"UI 全量双语 + 新玩家只被问一次"，而第一版向导第 2 步直接引用了
   * `CONSENT_COPY`（`src/ui/local-consent.ts`，整份中文）⇒ 真机实测：第 1 步选了 English，
   * 第 2 步的标题与两个按钮**仍是中文**（半张屏两种语言，正是用户抱怨的那一类观感）。
   *
   * ⇒ 授权那一组的**界面文字**改成走这里（中文值**逐字等于** `CONSENT_COPY` 的对应字段，
   * 由 `tests/i18n/onboarding.test.ts` 的一条腿钉住不许漂）；
   * ⚠️ **正文三段仍然引用** `privacy.ts` 的 `privacyLines()` 原句（那种"隐私承诺句只有一个家"
   * 的纪律不许在这里破）⇒ 英文界面下那段正文仍是中文，这是**如实登记的边界**，
   * 不是漏了（见方案 §7.6 与清单文档 D 节）。
   */
  'onboarding.consent.title': '要不要在这台设备上记住你的设置？',
  'onboarding.consent.grant': '允许，保存在这台设备',
  'onboarding.consent.deny': '不用，本次不保存',
  // ⚠️ 键名 2026-10-02 由 `onboarding.consent.hint` 改成 `onboarding.consent.deny-note`：
  //   它承载的是**旧弹窗那句**"不用之后的后果 + 出路"，与上面那条新指引不是同一句，
  //   同名会让后来者以为它们是同一个东西（D2 的教训）。
  'onboarding.consent.deny-note': '你随时可以在主界面的「本地数据与隐私」里改变这个选择。',
  'onboarding.consent.privacy': '隐私说明',

  /* ── ★ 2026-10-02（P2/P5/P6/P7）：**教学模式**（十四关 + 教练浮层） ──
   *
   * 纪律：文案**短、说人话**（仓库口径）；每一句都是玩家在屏上真的会看到的字。
   * 关卡里**不带**"T0/T1"这种代号（那是代码里的 id），玩家看到的是"第 N 关"。
   * ⚠️ 每一句都要与 `src/tutorial/levels.ts` 里的键一一对应（那边一个中文都不写）。
   *
   * ★ P6（用户 2026-10-01 追加的硬要求）：**每一关都是四件套**，四个键一族：
   *   `.scenario`（实战例子，一句话、真卡真局面）/ `.steps.N`（引导步骤，祈使句）/
   *   `.observe`（观察点，"你会看到……"）/ 亲自动手（判据依赖玩家真的做过那一下）。
   *   机械保障在 `tests/tutorial/levels.test.ts`（生成式腿，以后新增关卡自动受约束）。 */
  'tutorial.aria': '新手教程',
  'tutorial.step': '第 {n} 关 / 共 {total} 关',
  'tutorial.exit': '退出教程',
  'tutorial.next': '继续',
  'tutorial.skip-teach': '开始动手',
  'tutorial.restart': '从第一关重来',
  'tutorial.restart-level': '重开这一关',
  'tutorial.cleared': '这一关过了。',
  'tutorial.cleared-all': '所有关卡都过了。想再练一遍就点「从第一关重来」。',
  'tutorial.spot.hint': '点亮着的框，四个都要点一遍。',
  'tutorial.spot.link': '这里是链路：牌打出来就叠在这一列上。',
  'tutorial.spot.protocol': '这里是协议卡：每条链路上面挂一张，它决定这条线的分怎么算。',
  'tutorial.spot.threshold': '这里是这条线的总值：自己到 10 分、而且比对手高，就能编译这条线。',
  'tutorial.spot.control': '这里是控制权：拿到手就能在编译时重排协议。',
  'tutorial.spot.done': '四个区域都看过了，这一关过了。',
  'tutorial.goal.label': '这一关要做的：',
  // 四件套的三段标题（每一关都有这三段；顺序就是 例子 → 步骤 → 观察点）
  'tutorial.scenario.label': '实战例子',
  'tutorial.steps.label': '跟着做',
  'tutorial.observe.label': '你会看到',
  'tutorial.zoom.hint': '双击一张卡就能放大看详情。',
  'tutorial.zoom.opened': '看过了。想再看就再双击一张。',
  'tutorial.peek.yes': '这张反面牌是你的、也已经公开过，放大时右上角有「查看正面」，点它就能看。',
  'tutorial.peek.no': '这张反面牌是效果从牌库直接放到场上的，还没公开过，放大只能看到卡背。',
  'tutorial.peek.done': '两个对照都看过了，这一关过了。',
  // T7（默认目标规则）的两步提示：先点那张被压住的（点不动），再用明写"被覆盖"的那张
  'tutorial.T7.hint.try': '先用「精神2」去点被压住的那张精神3 —— 它点不动，这就是默认规则。',
  'tutorial.T7.hint.pick': '现在用「腐化3」：把它候选里那张精神3 点掉。',
  // ★ P6：点了一张"不在候选里、被压暗"的牌时的那句提示（T7 演示的那一下走偏）
  'tutorial.choice.blocked': '这张牌不在候选里。文本没写「被覆盖的牌」时，效果只能选双方场上未被覆盖的牌。',
  // T9（打出 vs 露出）按做到哪一步给提示
  'tutorial.T9.hint.flip': '还剩第一步：把对手那张反面速度0 翻正。',
  'tutorial.T9.hint.reveal': '翻正那一步做到了。还剩第二步：把盖住你那张速度0 的牌偏转走。',
  'tutorial.T9.hint.both': '两条露出途径都做到了，这一关过了。',

  // T0：界面扫盲
  'tutorial.T0.title': '先认认界面',
  'tutorial.T0.goal': '点一遍四个亮起来的区域。',
  'tutorial.T0.teach.0': '一局游戏有三条链路，中间这三列就是。',
  'tutorial.T0.teach.1': '每条链路上面挂一张协议卡，它决定这条线的分怎么算。',
  'tutorial.T0.teach.2': '每条线算一个总值。自己到 10 分、而且高过对手，这条线就能编译。',
  'tutorial.T0.teach.3': '编译时谁拿到控制权，谁就能重排协议。',
  'tutorial.T0.scenario': '这是一局刚开局的场面：三条链路都还空着，你手里有一张「精神1」。',
  'tutorial.T0.steps.0': '点一下中间那三列里亮着框的链路。',
  'tutorial.T0.steps.1': '再点它上面那张协议卡，以及右边「总值」「控制权」两个框。',
  'tutorial.T0.steps.2': '四个框都要点到，点满才算过。',
  'tutorial.T0.observe': '你会看到每点一个框，浮层里就多一句说明，告诉你那个区域是干什么的。',

  // T1：查看卡牌详情（用户 2026-10-02 追加）
  'tutorial.T1.title': '怎么看一张卡',
  'tutorial.T1.goal': '双击任意一张卡，打开它的详情。',
  'tutorial.T1.teach.0': '想知道一张牌到底干什么，就双击它。',
  'tutorial.T1.teach.1': '双击之后会弹出一个大图，右边写着这张牌的中文效果：顶部、中部、底部三段。',
  'tutorial.T1.teach.2': '再点一下空白处就关掉。手牌、场上的牌、协议卡都可以这样看。',
  'tutorial.T1.scenario': '你手里有两张牌，线 1 上还摆着一张「精神3」—— 随便挑一张看。',
  'tutorial.T1.steps.0': '双击场上那张精神3（或者手里任意一张）。',
  'tutorial.T1.steps.1': '看完点一下空白处关掉。',
  'tutorial.T1.observe': '你会看到屏幕中间弹出一张大图，右边分三段写着这张牌的效果。',

  // T2：打出第一张牌
  'tutorial.T2.title': '打出第一张牌',
  'tutorial.T2.goal': '把手里一张正面牌拖到它自己的那条链路上。',
  'tutorial.T2.teach.0': '手牌在下面。每张牌的左上角写着它属于哪套协议。',
  'tutorial.T2.teach.1': '正面打出时，这张牌必须放在它自己协议的那条链路上。',
  'tutorial.T2.teach.2': '拖到那条链路上松手，就打出第一张牌了。',
  'tutorial.T2.scenario': '你手里有「精神1」和「流水1」；线 1 挂的是精神协议，线 2 挂的是流水协议。',
  'tutorial.T2.steps.0': '把「精神1」正面拖到线 1（挂精神协议那条）松手。',
  'tutorial.T2.steps.1': '看到它落进链路，这一关就过了。',
  'tutorial.T2.observe': '你会看到精神1 叠在线 1 里，这条线的总值从 0 变成 1。',

  // T3：正面与反面
  'tutorial.T3.title': '正面还是反面',
  'tutorial.T3.goal': '打出一张正面、一张反面。',
  'tutorial.T3.teach.0': '正面打出：只能进自己协议那条线，点数算进这条线。',
  'tutorial.T3.teach.1': '反面打出：哪条线都能放，点数不算，通常用来盖住别人的牌。',
  'tutorial.T3.teach.2': '拖动时按住右键（或按 R）可以换朝向，两种各打一张。',
  'tutorial.T3.scenario': '你手里是「精神1」和「流水1」两张正面牌，这一关要一正一反各打一张。',
  'tutorial.T3.steps.0': '把「精神1」正面拖到线 1。',
  'tutorial.T3.steps.1': '把「流水1」按住右键（或按 R）翻成反面。',
  'tutorial.T3.steps.2': '再把反面的流水1 拖到线 1。',
  'tutorial.T3.observe': '你会看到正面那张给这条线加了 1 分，反面那张压在上面、一分不加。',

  // T4：五个基础动作
  'tutorial.T4.title': '五个基础动作',
  'tutorial.T4.goal': '用手里五张牌，各做一次翻转、偏转、抽牌、弃牌、回手。',
  'tutorial.T4.teach.0': '这五张牌的中指令分别就是这五个动作，打出来引擎会问你选哪张。',
  'tutorial.T4.teach.1': '翻转：正面变反面、反面变正面。偏转：把一张牌换到别的链路。',
  'tutorial.T4.teach.2': '抽牌：从牌库拿牌进手牌。弃牌：把手牌丢进弃牌堆。回手：把场上的牌拿回手里。',
  'tutorial.T4.teach.3': '五张都打完，这一关就过了。',
  'tutorial.T4.scenario': '你手里是精神2、黑暗4、精神1、精神5、流水4 这五张，它们的中指令正好就是那五个动作；场上线 1 摆着一张正面精神3，线 2 摆着一张反面流水2。',
  'tutorial.T4.steps.0': '打出「精神2」，在弹出的候选里挑一张场上的牌。',
  'tutorial.T4.steps.1': '打出「黑暗4」，先点那张反面流水2，再点目标列。',
  'tutorial.T4.steps.2': '接着打出「精神1」（抽牌）、「精神5」（弃牌，挑那张 0 分的）、「流水4」（回手，点线 1 那张）。',
  'tutorial.T4.steps.3': '五个动作都做过一遍，这一关就过了。',
  'tutorial.T4.observe': '你会看到每做完一个动作，右边的日志里就多出一条对应的记录（翻转／偏转／抽牌／弃牌／回手）。',

  // T5：覆盖与揭开
  'tutorial.T5.title': '盖住别人的牌',
  'tutorial.T5.goal': '把你手里那张牌打到对手线 1 的那张牌上面。',
  'tutorial.T5.teach.0': '对手线 1 上有一张牌。你打一张到同一条线，就把它压在下面了。',
  'tutorial.T5.teach.1': '被压住的那张牌叫「被覆盖」：它的中点数和顶/底命令都不再生效。',
  'tutorial.T5.teach.2': '等你打出的这张被翻正、或者被移走，下面的牌就重新「揭开」，效果又回来了。',
  'tutorial.T5.scenario': '对手线 1 上摆着一张反面「精神1」；你手里只有一张「腐化0」，它写着「此牌可以打在任意一方的任意协议处」。',
  'tutorial.T5.steps.0': '把「腐化0」正面拖到对手线 1 那张牌上面松手。',
  'tutorial.T5.steps.1': '看到它压上去、对手那张牌不再算分，就过了。',
  'tutorial.T5.observe': '你会看到腐化0 叠在对手那张上面，对手线 1 的总值少了原来那张牌的点数。',

  // T6：场上的反面牌能不能看（用户 2026-10-02 追加）
  'tutorial.T6.title': '反面牌能不能看',
  'tutorial.T6.goal': '分别双击线 1 与线 2 那两张反面牌，对比一下。',
  'tutorial.T6.teach.0': '场上的反面牌，能不能看到正面，取决于这张牌的信息**是不是公开的**。',
  'tutorial.T6.teach.1': '自己打出的反面牌、或者已经被翻正／被揭示过的牌 —— 信息是公开的，双击之后可以用「查看正面」翻过来看。',
  'tutorial.T6.teach.2': '被卡牌效果**从牌库直接召唤到场上的反面牌** —— 信息没公开过，谁都看不到正面，双击只显示卡背。',
  'tutorial.T6.teach.3': '线 1 那张是你的、公开过：能看到正面。线 2 那张是牌库来的：看不到。两张都双击试试。',
  'tutorial.T6.scenario': '你场上线 1 与线 2 各有一张反面牌：线 1 那张是从手牌打出的，线 2 那张是效果从牌库直接放到场上的。',
  'tutorial.T6.steps.0': '双击线 1 那张反面牌，看放大图右上角有没有「查看正面」。',
  'tutorial.T6.steps.1': '再双击线 2 那张，和刚才那张对比。',
  'tutorial.T6.observe': '你会看到线 1 那张能点「查看正面」翻过来，线 2 那张只有卡背 —— 差别就在这张牌的信息公开没公开。',

  // ★ T7：默认目标规则（用户 2026-10-02 追加，任务 A.1）
  'tutorial.T7.title': '效果能选谁',
  'tutorial.T7.goal': '先用一张没写明目标的牌去点被压住的牌，再用写明「被覆盖」的牌把它翻掉。',
  'tutorial.T7.teach.0': '卡牌文本没特别说明时，效果能选的对象只有双方场上**未被覆盖**的牌 —— 被压住的牌根本点不到。',
  'tutorial.T7.teach.1': '文本写了「所有牌」才放行全部；写了「被覆盖的牌」才把被压住的算进来。',
  'tutorial.T7.teach.2': '线 1 上那张「精神3」被「精神5」压住了。先用「精神2」（中指令只说「你可以翻转1张牌」）去点它，你会发现点不动。',
  'tutorial.T7.scenario': '线 1 上「精神3」被「精神5」压住；你手里有「精神2」（中指令：你可以翻转1张牌）和「腐化3」（中指令：你可以翻转1张被覆盖的正面朝上的卡牌）。',
  'tutorial.T7.steps.0': '把「精神2」正面拖到线 1（精神协议线）松手。',
  'tutorial.T7.steps.1': '在弹出的选择条里点被压住的「精神3」—— 它点不动，屏上会给一句提示。',
  'tutorial.T7.steps.2': '换个合法的候选点一下（或者点「跳过」），把这次选择结束掉。',
  'tutorial.T7.steps.3': '把「腐化3」正面拖到线 2（腐化协议线）松手。',
  'tutorial.T7.steps.4': '这次在弹出的候选里点「精神3」—— 它点得动了。',
  'tutorial.T7.observe': '你会看到同一张精神3：第一张牌选不到它，第二张牌选得到；点下去它被翻成了反面。',

  // T8：编译与阈值（P5 时是 T7，P6 让位一格）
  'tutorial.T8.title': '编译这条线',
  'tutorial.T8.goal': '把线 1 编译掉。',
  'tutorial.T8.teach.0': '一条线的总值，自己那边要到 10 分、而且要比对手高 —— 这条线才能编译。',
  'tutorial.T8.teach.1': '线 1 现在你 10 分、对手 0 分，够了 —— 编译按钮亮着。',
  'tutorial.T8.teach.2': '编译会把这条线的协议卡翻成已编译，之后这条线就锁上了。',
  'tutorial.T8.scenario': '线 1 上你摆着精神5、精神3、精神2，一共 10 分；对手这条线是 0 分。',
  'tutorial.T8.steps.0': '看一眼线 1 右边的总值，确认你 10、对手 0。',
  'tutorial.T8.steps.1': '点这条线的「编译」按钮。',
  'tutorial.T8.observe': '你会看到线 1 的协议卡被翻成已编译，这条线锁上、不再参与后续结算。',

  // ★ T9：打出 vs 露出（用户 2026-10-02 追加，任务 A.2）
  'tutorial.T9.title': '打出和露出',
  'tutorial.T9.goal': '用两张速度0，分别演示「翻正露出」和「偏转露出」两条路。',
  'tutorial.T9.teach.0': '中部指令有两条触发途径：从手牌**打出**，以及**露出**（由隐藏变成展示出来的那一刻）。',
  'tutorial.T9.teach.1': '露出有两种：反面牌被**翻正**；被压住的正面顶卡上面那张被移走，它重新变成未覆盖的顶卡。',
  'tutorial.T9.teach.2': '两张都是「速度0」，它的中指令是「打出1张牌」—— 效果本身不显眼，但日志里会记下它又被结算了一次。',
  'tutorial.T9.teach.3': '第一种：打「黑暗1」（中指令：翻转1张你对手的牌。你可以偏转那张牌。），把对手场上那张反面速度0 翻正。',
  'tutorial.T9.teach.4': '第二种：打「黑暗4」（中指令：偏转1张反面牌），把**盖住**你那张速度0 的牌偏转走。',
  'tutorial.T9.scenario': '对手线 3 上有一张反面速度0；你线 2 上有一张正面速度0，还没被盖住。你手里有黑暗1、流水5、黑暗4、精神3 四张牌。',
  'tutorial.T9.steps.0': '把「黑暗1」正面拖到线 1（黑暗协议线）松手。',
  'tutorial.T9.steps.1': '在弹出的候选里点对手线 3 那张速度0 —— 它被翻正。',
  'tutorial.T9.steps.2': '接着那句「你可以偏转那张牌」点「跳过」，先不动它。',
  'tutorial.T9.steps.3': '把「流水5」按住右键（或按 R）翻成反面，拖到线 2，压住你那张速度0。',
  'tutorial.T9.steps.4': '把「黑暗4」正面拖到线 1，在弹出的候选里点刚压上去的那张流水5。',
  'tutorial.T9.steps.5': '选一列（选线 3）把它偏转过去 —— 你那张速度0 重新露出来。',
  'tutorial.T9.observe': '你会看到日志里先后出现「[中部] speed-0：原因：翻正」和「[中部] speed-0：原因：被揭开」——同一张牌的中部指令被结算了两次。',

  /* ── ★ P7：最后四关（控制权 / 触发时机 / 删除·免疫·加成 / 迷你对局） ── */
  // 后四关的提示区各按"这一关观测量到了没有"给一句（与判据同一份读数）
  'tutorial.T10.hint.go': '现在点棋盘上的「下一步」——引擎会在控制阶段结算一次控制权。',
  'tutorial.T10.hint.got': '控制权到手了，这一关过了。',
  'tutorial.T11.hint.after-play': '还差「打出后」那一次：让对手在冰1 那条线上打一张牌。',
  'tutorial.T11.hint.before-covered': '还差「被盖住前」那一次：把手里那张反面盖到火焰0 上面。',
  'tutorial.T11.hint.end': '还差「结束」那一次：点那张被盖住的生命0 的「结算触发」按钮。',
  'tutorial.T11.hint.done': '三种触发时机都出现过了，这一关过了。',
  'tutorial.T12.hint.delete': '第一步：把「火焰1」正面打到线 1。',
  'tutorial.T12.hint.buff': '第二步：把「明晰0」正面打到线 2，看这条线的总值。',
  'tutorial.T12.hint.immune': '第三步：把「死板1」正面打到线 3，再去点对手那张死板7。',
  'tutorial.T12.hint.done': '删除、加成、免疫三样都做到了，这一关过了。',
  'tutorial.T13.hint.compile': '点线 3 的「编译」按钮——把它编译掉，这一局就结束了。',
  'tutorial.T13.hint.done': '这一局打完了，教学到此结束。',

  // T10：控制权（P7）
  'tutorial.T10.title': '控制权',
  'tutorial.T10.goal': '走一步，把控制组件拿到手。',
  'tutorial.T10.teach.0': '控制权（界面上叫「控制组件」）是这一局里的一条争夺线：谁拿着它，谁在编译或补满手牌之前可以先重排双方的协议。',
  'tutorial.T10.teach.1': '拿法只有一条：**轮到你的控制阶段**时，你在至少两条线路上的总值都高过对手，就拿到它。',
  'tutorial.T10.teach.2': '注意是「两条线各自都高过对手」，不是看总分、也不是比差值。高一条不够。',
  'tutorial.T10.teach.3': '控制权不会因为你落后就被自动夺走；你一旦编译或补满手牌，它就先归还中立。',
  'tutorial.T10.scenario': '你的线 1 是 3 比 1、线 2 是 3 比 0 —— 两条线都高过对手。局面正停在你的控制阶段，控制组件还是中立的。',
  'tutorial.T10.steps.0': '看一眼线 1 与线 2 右边的总值，确认两条线你都高过对手。',
  'tutorial.T10.steps.1': '点棋盘上的「下一步」，让引擎走一步 —— 它会替你做这一次控制阶段的判定。',
  'tutorial.T10.steps.2': '看右边控制组件那一栏，确认它归你了。',
  'tutorial.T10.observe': '你会看到日志里出现「P1 控制阶段：2 条线总值高于对手 → 获得控制组件」，控制组件那一栏从中立变成归你。',

  // T11：触发时机（P7）
  'tutorial.T11.title': '三种触发时机',
  'tutorial.T11.goal': '把「打出后」「被盖住前」「结束」三种触发各弄出来一次。',
  'tutorial.T11.teach.0': '一张牌的文本分顶、中、底三段，它们**在什么时刻生效**是另一件事：有的要你主动打出来，有的在别人动它的时候自己响。',
  'tutorial.T11.teach.1': '打出后：这张牌的底部写着「对手在此链路出牌后」—— 所以它响的时刻是**对手**在这条线出牌，不是你自己出牌。这一路引擎不写阶段日志，你看到的是对手手里少了一张。',
  'tutorial.T11.teach.2': '被盖住前：这张牌的底部写着「被盖住前」—— 有人把牌盖到它头上，它**在被压住之前**先结算一次。',
  'tutorial.T11.teach.3': '结束：这张牌的顶部写着「结束：若此卡被覆盖，则移除此卡」—— 它已经被盖住了，所以结束阶段会请你结算它。',
  'tutorial.T11.scenario': '线 1 上摆着你的冰1（底：对手在此链路出牌后，他要弃置1张牌）；线 2 上摆着你的火焰0（底：被盖住前，先抽1张牌并翻转另1张牌）；线 3 上你的生命0 被生命5 盖住了（顶：结束：若此卡被覆盖，则移除此卡）。你手里有一张流水0。对手手里有两张牌。',
  'tutorial.T11.steps.0': '先把对手那张「寒冰4」正面拖到线 1 打出 —— 冰1 的「打出后」立刻响，替他弃掉一张牌（在候选里点一张就行）。',
  'tutorial.T11.steps.1': '把手里那张「流水0」按住右键（或按 R）翻成反面，拖到线 2，压住你的火焰0 —— 火焰0 的「被盖住前」先结算一次。',
  'tutorial.T11.steps.2': '点棋盘上的「下一步」，把回合推进到结束阶段。',
  'tutorial.T11.steps.3': '点那张被盖住的生命0 的「结算触发」按钮 —— 它的「结束」把它自己移除。',
  'tutorial.T11.observe': '你会看到三处证据：「打出后」那一下对手手里少了一张（那张牌进了他的弃牌堆）、日志里出现「[被盖前] fire-0」、日志里再出现「[结束] life-0：由 P1 结算」并且那张生命0 从场上消失。',

  // T12：删除 / 免疫 / 加成（P7）
  'tutorial.T12.title': '删除、免疫、加成',
  'tutorial.T12.goal': '用手里三张牌，各演示一次删除、加成和免疫。',
  'tutorial.T12.teach.0': '删除：把一张牌直接移出这一局（进弃牌堆），它不再占链路、也不再算分。',
  'tutorial.T12.teach.1': '加成：一张牌的顶部写着「此链路中，你每有1张牌，总阈值就加1」—— 它改的是**这条线的总值**，不是它自己的点数。',
  'tutorial.T12.teach.2': '免疫：死板7 的底部写着「此牌不能被翻转或偏转」—— 别人来翻它、偏它，引擎会直接跳过。',
  'tutorial.T12.teach.3': '免疫挡得住翻转与偏转，挡不住删除：删除是"移出这一局"，不是"动它的朝向或位置"。',
  'tutorial.T12.scenario': '你手里有四张牌：火焰1（中：弃1张牌。如果弃了，删除1张牌。）、明晰0（顶：此链路中，你每有1张牌，总阈值就加1。）、死板1（中：翻转对手1张正面朝上的牌。）和一张流水0。对手线 1 有一张生命2，线 3 有一张死板7。',
  'tutorial.T12.steps.0': '把「火焰1」正面打到线 1，先弃掉那张用不上的流水0，再在弹出的候选里点对手那张生命2 —— 它被删除。',
  'tutorial.T12.steps.1': '把「明晰0」正面打到线 2，看这条线的总值从 0 变成 1。',
  'tutorial.T12.steps.2': '把「死板1」正面打到线 3，在弹出的候选里点对手那张死板7。',
  'tutorial.T12.steps.3': '看日志：引擎会说它「不可被翻转，跳过」，那张死板7 还是正面。',
  'tutorial.T12.observe': '你会看到对手的生命2 进了弃牌堆、线 2 的总值多了 1 分，而死板7 那张牌翻不动 —— 日志里写着「rigidity-7 不可被翻转，跳过」。',

  // T13：迷你对局（P7）
  'tutorial.T13.title': '打一小局',
  'tutorial.T13.goal': '把最后一条线编译掉，把这一局打完。',
  'tutorial.T13.teach.0': '这一关不再拆单个动作了：三条线，前面两条你已经编译过，第三条也到了 10 分。',
  'tutorial.T13.teach.1': '一条线要能编译：自己那边到 10 分，而且高过对手 —— 这就是前面 T8 教的那件事。',
  'tutorial.T13.teach.2': '这一局结束的条件是：**你三条线的协议全部变成已编译**。对手编译了几条不影响你的胜负判定。',
  'tutorial.T13.teach.3': '编译会把那条线上的牌全部删掉（双方都删），协议卡翻成已编译，然后锁上。',
  'tutorial.T13.scenario': '你线 1、线 2 的协议已经是已编译（线 1 上还留着对手一张反面牌）；线 3 是黑暗线，你摆着黑暗1、黑暗4、黑暗5 一共 10 分，对手那条线只有 2 分。',
  'tutorial.T13.steps.0': '看一眼线 3 右边的总值，确认你 10 分、对手 2 分。',
  'tutorial.T13.steps.1': '点线 3 的「编译」按钮。',
  'tutorial.T13.steps.2': '看到这一局结束，教学就全部完成了。',
  'tutorial.T13.observe': '你会看到线 3 的牌全部进弃牌堆、协议卡翻成已编译，日志里出现「P1 wins!」，屏幕进入终局结算。',

  // 走偏提示（引擎自己会拒的那种另算：见 tutorial.off.rejected）
  'tutorial.off.wrong-kind': '这一关先不学这个。照着上面那句提示做。',
  'tutorial.off.face-down': '这一关要打的是正面牌：拖的时候别换朝向。',
  'tutorial.off.rejected': '这张牌放不进那条链路。正面牌只能进自己协议那条线。',

  // 「本地数据与隐私」屏：教学进度那一行（方案 §6：新存储必须可见 + 可清除）
  'local-data.tutorial.label': '新手教程进度',
  'local-data.tutorial': '已完成 {n} 关（共 {total} 关）。清掉之后教程从第一关重新开始。',
  'local-data.tutorial.none': '还没开始玩教程。清掉本机数据之后教程从第一关开始。',

  /* ── 共用的世代标签（图鉴筛选 chip 与规则页的标题都用它） ── */
  'gen.1.base': '1代 基础',
  'gen.1.extra': '1代 拓展',
  'gen.2.base': '2代 基础',
  'gen.2.extra': '2代 拓展',
  'gen.3.base': '3代 基础',
  'gen.3.extra': '3代 拓展',
  'gen.hide': '点击隐藏',
  'gen.show': '点击显示',
  // 图鉴筛选项 tooltip 的后半句：`{chip 文案}（共 {n} 套）· {action}`
  'gen.count-suffix': '{name}（共 {n} 套）· {action}',
  // 图鉴右侧展示框的占位提示（原字面量里就是那个换行）
  'library.preview-hint': '把鼠标移到左侧的协议或卡牌上\n此处会实时展示',

  /* ── 共用标签 ── */
  'common.back-home': '← 返回主页面',
  'common.back-mode': '← 返回游戏模式选择',
  'common.close': '关闭',
  'common.cancel': '取消',
  'common.feedback': '反馈',
  'common.changelog': '更新日志',
  'common.coin.heads': '正面',
  'common.coin.tails': '反面',

  /* ── 只在模式选择页弹的"开发中/待开发"提示（原来是写死的 toast） ── */
  'toast.solo': '单人模式：开发中',
  'toast.trio': '三人模式：开发中',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-01（C）：「本地数据与隐私」屏的**其余文案**（P0 只抽了语言那一行）
   *
   * ⚠️ 值与改动前逐字一致（既有 `tests/ui/local-data-screen.test.ts` 与
   * `tests/ui/privacy-consumers.test.ts` 都逐字钉着一部分）。
   * ⚠️ 这一屏从"尚未抽取的屏"清单里**划掉**（它是 C 这一轮抽完的第二屏）。
   * ══════════════════════════════════════════════════════════════════════ */
  'local-data.title': '本地数据与隐私',
  'local-data.consent.allowed': '当前：允许保存到本机（昵称与卡组会写进你自己的浏览器存储）',
  'local-data.consent.denied': '当前：游客模式（本次会话不写入你的数据，刷新或关闭即丢失）',
  'local-data.consent.ask': '当前：正在等你选择是否保存到本机',
  'local-data.consent.unknown': '当前：尚未选择（下次启动会先问你）',
  'local-data.error.unknown': '未知错误（宿主没有给出描述）',
  'local-data.error.indescribable': '宿主抛出了一个无法描述的对象',
  'local-data.error.no-reason': '宿主没有给出原因',
  'local-data.clear-failed': '清除本机数据失败：{detail}。本机数据可能仍有残留，请稍后再试。',
  'local-data.clear-ok': '已清除本机数据（{n} 项）。下次启动会重新询问是否保存到本机。',
  'local-data.read-failed': '读取本机数据失败：{detail}',
  'local-data.change-consent': '改变选择',
  'local-data.clear': '清除本机数据',
  'local-data.clear-yes': '确认清除',
  'local-data.clear-note': '清除后，本机保存的昵称与卡组会被删除，并且下次启动会重新询问是否保存到本机。',
  'local-data.nick.label': '昵称',
  'local-data.nick.placeholder': '给自己起个昵称',
  'local-data.nick.save': '保存昵称',
  'local-data.nick.unset': '未设置',
  'local-data.nick.ok': '昵称已保存到本机。',
  'local-data.nick.write-failed': '本机保存失败，本次会话仍可正常游玩。',
  'local-data.stored': '本机已保存：昵称「{nick}」· 卡组 {n} 组',
  'local-data.deck-line': '卡组「{name}」：{n} 张 · 种子 {seed}',
  'local-data.deck-empty': '本机还没有保存任何卡组。',
  'local-data.cardmaker.label': '卡牌制作器（自定义协议与卡牌）',
  'local-data.cardmaker.reading': '正在读取卡牌制作器的本机数据…',
  'local-data.cardmaker.clear': '清除卡牌制作器的本机数据',
  'local-data.cardmaker.read-failed': '读取卡牌制作器的本机数据失败：{detail}',
  'local-data.cardmaker.clear-failed': '清除卡牌制作器的本机数据失败：{detail}',
  'local-data.cardmaker.unreadable':
    '卡牌制作器：读不到本机的数据（这台设备可能没有可用的 IndexedDB，或库被别的程序占着）。它单独存在一个 IndexedDB 库里，与上面那两个键无关。',
  'local-data.cardmaker.empty':
    '卡牌制作器：本机还没有保存过牌组。它单独存在一个 IndexedDB 库里，与上面那两个键无关。',
  'local-data.cardmaker.count':
    '卡牌制作器：本机保存了 {n} 张卡（含自定背景与 logo 的图片）。它单独存在一个 IndexedDB 库里，与上面那两个键无关。',
  'local-data.cardmaker.clear-empty': '卡牌制作器的本机数据本来就是空的，没有需要清除的东西。',
  'local-data.cardmaker.clear-ok': '已清除卡牌制作器保存在本机的牌组。',
  'local-data.privacy.title': '隐私说明（完整）',
  'local-data.archive.title': '对局档案（导出 / 导入）',
  'local-data.archive.blurb': '导入的档案会当场校验（格式、版本、卡牌数据指纹与每条操作的形状）；导入成功后点「重放这一局」可以逐步重演。导出的档案是本次会话的真实对局（含每一步操作）；本次会话还没有对局时，导出会被拒绝并说明原因。档案只存在内存与你导出的文件里，下次启动无法找回 —— 需要留存时请自己导出。',
  'local-data.archive.read-failed': '读取档案失败：{detail}',
  'local-data.archive.import-failed': '导入失败：{detail}',
  'local-data.replay': '重放这一局',
  'local-data.back': '← 返回主界面',
  'local-data.export.btn': '导出档案',
  'local-data.import.btn': '导入档案',
  'local-data.export.refused': '档案没有导出：{detail}',
  'local-data.export.failed': '导出档案失败：{detail}',
  'local-data.export.waiting': '正在导出档案：{name}',
  'local-data.export.cancelled': '已取消导出：档案没有写到任何地方。',
  'local-data.export.unsupported': '这台设备不支持保存文件，因此无法导出档案。',
  'local-data.export.ok': '档案已导出：{name}（{n} 步操作）。把这份档案在另一台设备上导入，就能点「重放这一局」逐步重演这一局。',
  'local-data.import.waiting': '等待你选择档案文件…（选择框里可以取消；下面其它操作仍然可用）',
  'local-data.import.cancelled': '已取消选择档案：屏上没有任何改动。',
  'local-data.import.unsupported': '这台设备不支持导入档案。',
  'local-data.import.too-large': '档案过大（{size} 字节 > 上限 {max} 字节）：本程序不会读取它',
  'local-data.import.read-failed': '无法读取档案内容：{detail}',
  // 导入成功的报告拆三段（拼装顺序与改动前**逐字对应**）：
  //   `档案已导入并校验通过（{n} 步操作）` + 警告那半句 + `。点「重放这一局」…`
  'local-data.import.ok': '档案已导入并校验通过（{n} 步操作）',
  'local-data.import.no-warnings': '，没有任何警告',
  'local-data.import.warnings': '，有 {n} 条警告：{list}',
  'local-data.import.ok-tail': '。点「重放这一局」可以逐步重演这场对局；本屏不自动开始重放。',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-02（P3 逐屏抽取第二批）：**不需要动红线的那些小屏**
   *
   * 这一批抽的是"注入式浮层 / 独立小控件"那一类：更新日志面板外壳、日志开关、热座退出、
   * 连接状态行、请横屏提示、过渡覆盖层兜底、PWA 更新条、重放控制条。
   *
   * ⚠️ 两条口径：
   *  1. **中文值与改动前逐字一致**（搬家，不是改文案）；
   *  2. **更新日志的条目正文不在这一批里**（用户铁律：内容只按他口述的来）——
   *     它在英文界面下**仍然是中文**，这是登记过的已知缺口，见
   *     `docs/2026-10-01-i18n-尚未抽取的屏.md` 的 F 节。
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── 更新日志面板的**外壳**（条目正文不走这里） ── */
  'changelog.aria': '更新日志',
  'changelog.title': '更新日志',
  'changelog.close': '关闭',
  'changelog.hint': '最新的在最上面，往下翻是更早的。',
  'changelog.empty': '还没有写进来的更新记录。给我内容，我按你的格式加。',

  /* ── 热座对局右上角的日志开关（`log-toggle.ts`） ── */
  'log-toggle.show': '显示日志',
  'log-toggle.hide': '隐藏日志',

  /* ── 热座对局左上角的退出按钮（`hotseat-exit.ts`） ── */
  'hotseat-exit.label': '← 退出游戏',

  /* ── 选协议那一屏底部的连接状态行（`net-conn-line.ts`） ── */
  'net-conn-line.direct': '当前连接：直连',
  'net-conn-line.relay': '当前连接：经中继',
  'net-conn-line.pending': '当前连接：建立中…',

  /* ── 手机竖屏时的"请把设备横过来"门，与旋转档的拖动提示（`phone-landscape.ts`） ── */
  'phone-landscape.gate.title': '请把设备横过来',
  'phone-landscape.gate.hint': '这个界面按横屏排版。点下面的按钮直接横屏；如果这台设备不支持全屏或方向锁，页面会自己转 90 度。',
  'phone-landscape.gate.button': '横屏游玩',
  'phone-landscape.pan-hint': '在空白处单指拖动，查看画面其余部分',

  /* ── 草案 → 游玩那段过渡视频"没出画"时的兜底那句（`t44-video-fallback.ts`） ── */
  't44.transition-hint': '正在进入对局……',

  /* ── PWA 更新条（`pwa-update.ts`）。⚠️ 预缓存失败那条只进控制台，是开发者串，不在这里 ── */
  'pwa.update.text': '有新版本可用',
  'pwa.update.button': '立即更新',

  /* ── 重放控制条（`replay-bar.ts`） ── */
  'replay.pause': '暂停',
  'replay.play': '继续',
  'replay.next': '单步',
  'replay.exit': '退出重放',
  'replay.readonly': '重放中不可操作（只读）',
  'replay.done': '已重放完',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-02（P3 逐屏抽取第三批）：**反馈浮层 + 隐藏页**（`feedback-screen.ts` /
   * `feedback-core.ts`）
   *
   * ⚠️ **服务端返回的中文原因不在这一批里**：它是服务端的读数，用户明确要求"**原样显示**"
   * （`serverErrorText()` 只负责读出来、不改一个字）。这里全是**前端自己写的话**。
   * ⚠️ 中文值与改动前逐字一致（搬家，不是改文案）。
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── 两档操作的名字（原来住在 `feedback-core.ts` 的常量表里） ── */
  'feedback.kind.protocol': '投稿自定义协议',
  'feedback.kind.bug': 'bug 反馈',
  'feedback.badge.protocol': '协议投稿',
  'feedback.badge.bug': 'bug 反馈',
  'feedback.author.protocol': '投稿人',
  'feedback.author.bug': '反馈人',
  'feedback.body.protocol': '协议与卡牌的说明文本',
  'feedback.body.bug': '具体的 bug 现象或反馈意见',
  'feedback.body-placeholder.protocol': '协议名、卡牌名、效果怎么结算……写清楚便于复现与评估。',
  'feedback.body-placeholder.bug': '在哪一屏、点了什么、期望看到什么、实际看到什么。',

  /* ── 表单浮层 ── */
  'feedback.aria': '反馈',
  'feedback.title': '反馈',
  'feedback.close': '关闭',
  'feedback.title-label': '简要标题',
  'feedback.title-placeholder': '一句话说清这次反馈是关于什么的',
  'feedback.kind-hint.protocol': '投稿自定义协议：写清协议名、卡牌与效果结算方式。',
  'feedback.kind-hint.bug': 'bug 反馈：写清在哪一屏、点了什么、期望与实际分别是什么。',
  'feedback.author-placeholder.protocol': '投稿人署名（必填）',
  'feedback.author-placeholder.bug': '反馈人署名（必填）',
  'feedback.files-label': '附件（可选）',
  'feedback.files-hint': '常见图片（pdf/jpg/png…）或常见文本（txt/markdown…）；每份 ≤10MB，一次最多 {max} 份。',
  'feedback.files-clear': '清空附件',
  'feedback.files-empty': '还没有选择附件。',
  'feedback.files-remove': '移除',
  'feedback.files-picked': '已选择 {n} 份附件。',
  'feedback.submit': '提交',
  'feedback.submitting': '正在提交…',
  // 「提交成功」那一句拆两段：`.ok` 是用户原话点名的四个字（测试逐字钉它），`.ok-line` 是整句
  'feedback.submit.ok': '提交成功',
  'feedback.submit.ok-line': '{ok}。编号：{id}',

  /* ── 必填校验与附件预检（纯函数里拼的句子） ── */
  'feedback.missing.title': '标题',
  'feedback.missing.author': '投稿人/反馈人',
  'feedback.missing.body': '说明文本',
  'feedback.missing.sep': '、',
  'feedback.missing.line': '还有必填项没写：{names}。',
  'feedback.attach.sep': '、',
  'feedback.attach.too-large': '已跳过超过 {size} 的附件：{names}（每份不能超过 {size}）。',
  'feedback.attach.over-count': '一次最多带 {max} 份附件，多出来的 {dropped} 份没有加上；需要的话请分几次提交。',

  /* ── 读数（大小 / 时间 / 顶部计数） ── */
  'feedback.bytes.unknown': '未知大小',
  'feedback.time.unknown': '时间未知',
  'feedback.count': '共 {total} 条 · 未读 {unread} 条',

  /* ── 网络/会话那几句（原来住在 `feedback-core.ts` 的导出常量里） ── */
  'feedback.offline': '当前环境没有反馈服务（或网络不通）：请稍后再试，本地开发环境没有这个服务是正常的。',
  'feedback.read-fail': '读取失败：服务端没有返回预期内容。',
  // 带 HTTP 状态码的那一档：原形态是 `{读取失败那句}（HTTP {status}）`
  'feedback.read-fail-http': '读取失败：服务端没有返回预期内容。（HTTP {status}）',
  'feedback.session-expired': '登录已过期，请重新输入口令。',
  'feedback.password-fail': '密码不对',

  /* ── 口令输入框（`Ctrl+Shift+O` 之后那一层） ── */
  'feedback.password.aria': '口令',
  'feedback.password.title': '口令',
  'feedback.password.placeholder': '输入口令后回车',
  'feedback.password.enter': '进入',
  'feedback.password.checking': '正在验证…',
  'feedback.password.need': '请先输入口令。',

  /* ── 隐藏页：列表 ── */
  'feedback.refresh': '刷新',
  'feedback.loading': '正在读取…',
  'feedback.list-empty': '还没有收到任何反馈。',
  'feedback.unread': '未读',
  'feedback.read.mark-read': '标记已读',
  'feedback.read.mark-unread': '标为未读',
  'feedback.file-count': '附件 {n} 份',
  'feedback.untitled': '（无标题）',
  'feedback.delete': '删除',
  'feedback.delete.confirm': '移入回收站后不能在页面上恢复，确定删除？',
  'feedback.delete.yes': '确认删除',
  'feedback.delete.no': '取消',
  'feedback.delete.done': '已删除「{title}」（移入回收站）。',

  /* ── 隐藏页：详情 ── */
  'feedback.back-to-list': '← 返回列表',
  'feedback.detail.title': '反馈详情',
  'feedback.detail.no-selection': '没有选中任何一条反馈。',
  'feedback.detail.no-files': '这一条没有附件。',
  'feedback.detail.files-label': '附件（{n} 份）',
  'feedback.detail.unnamed-file': '（无名附件）',

  /* ── ★ 2026-10-02：诊断出错时那个浮层的三句（`diag.ts`） ──
   * ⚠️ **导出的诊断文件正文不进表**（它是给开发者读的读数、且被 `tests/diag.test.ts` 逐字钉着），
   * 只有屏上这三句走 `t()`。 */
  'diag.prompt.title': '⚠ 发生运行时错误，是否导出诊断日志？',
  'diag.prompt.export': '导出日志',
  'diag.prompt.ignore': '忽略',

  /* ══════════════════════════════════════════════════════════════════════
   * ★ 2026-10-02（P3）：**卡牌制作器**（`src/ui/cardmaker/**`）
   *
   * 中文值与改动前逐字一致；`cardmaker.page.*` 那一大批（整屏的界面文案）与下面这几组
   * 一起进表。⚠️ 卡面上的**用户内容**（牌组名、协议名、卡面文本、预设背景名）是数据，
   * 不进表。
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── 宿主能力（`host.ts`） ── */
  'cardmaker.host.read-failed': '读取文件失败',

  /* ── 图片解码 / 重编码（`images.ts`）：这几句都是 `Error.message`，由 page.ts 写到状态行 ── */
  'cardmaker.images.load-failed': '图片加载失败：{src}',
  'cardmaker.images.no-canvas-normalize': '这台设备拿不到 2D 画布，无法处理上传的图片',
  'cardmaker.images.bad-image': '这张图片解不开（格式不支持或文件损坏）',
  'cardmaker.images.no-canvas-logo': '这台设备拿不到 2D 画布，无法去掉 logo 背景',
  'cardmaker.images.bad-logo': '这张 logo 解不开（格式不支持或文件损坏）',

  /* ── 牌组存档的格式错误（`serialize.ts`） ── */
  'cardmaker.serialize.not-json': '这不是一个 JSON 文件：{detail}',
  'cardmaker.serialize.not-an-object': '文件的顶层不是一个对象（不像是本制作器导出的牌组）',
  'cardmaker.serialize.no-format-mark': '文件里没有本制作器的格式标记（期望 format = {expected}，实际 {actual}）',
  'cardmaker.serialize.bad-version': '牌组版本不认识（期望 {expected}，实际 {actual}）',
  'cardmaker.serialize.no-deck': '文件里有格式标记，但没有牌组内容（deck 字段）',

  /* ── 本机存储（`store-idb.ts`） ── */
  'cardmaker.store.open-failed': '打不开 IndexedDB',
  'cardmaker.store.read-failed': '读取 IndexedDB 失败',
  'cardmaker.store.write-failed': '写入 IndexedDB 失败',
  'cardmaker.store.write-aborted': '写入 IndexedDB 被中止',
  'cardmaker.store.delete-failed': '删除 IndexedDB 记录失败',
  'cardmaker.store.memory-only': '只写进了内存（游客模式或本机存储不可用）',
  'cardmaker.store.no-idb': '这台设备没有可用的 IndexedDB',

  /* ── ★ 2026-10-02（P3）：卡牌制作器整屏（`src/ui/cardmaker/page.ts`） ── */
  'cardmaker.page.back': '← 返回主页面',
  'cardmaker.page.title': '自定义协议与卡牌',
  'cardmaker.page.save': '保存到本机',
  'cardmaker.page.mode.protocol': '协议卡（横版 · 正/背两面）',
  'cardmaker.page.mode.compile': '卡牌（竖版编译卡）',
  'cardmaker.page.face.which': '这一面：',
  'cardmaker.page.face.front': '正面',
  'cardmaker.page.face.back': '背面',
  'cardmaker.page.status.persistent': '改动会自动保存到本机（浏览器存储），刷新后仍在。',
  'cardmaker.page.status.memory': '当前是游客模式或本机存储不可用：改动只存在内存里，刷新或关闭页面就会丢。',
  'cardmaker.page.geometry-note': '卡面按参考项目的几何尺寸渲染（竖版设计空间 {cw}×{ch}，横版 {lw}×{lh}），',
  'cardmaker.page.geometry-note.export': '导出按标准扑克牌 63.5×88.9mm 的 300dpi 成品尺寸。',
  'cardmaker.page.preview.portrait': '预览：竖版编译卡 · 设计空间 {w}×{h}',
  'cardmaker.page.canvas-help': '在卡面上拖动 = 平移背景；滚轮 = 以光标为中心缩放背景；在六边形里拖 = 移动 logo。',
  'cardmaker.page.canvas-help.sliders': '背景与标志各自有一条缩放滑杆（左栏「标志缩放」/ 这里下面那条「背景缩放」），互不影响。',
  'cardmaker.page.bg-reset': '重置背景',
  'cardmaker.page.bg-zoom': '背景缩放',
  'cardmaker.page.deck-title.placeholder': '牌组名（用于导出文件名）',
  'cardmaker.page.deck-title': '牌组名',
  'cardmaker.page.card-add': '新增竖版编译卡',
  'cardmaker.page.card-delete': '删除当前卡',
  'cardmaker.page.field.title': '协议名 / 标题',
  'cardmaker.page.field.title.hint': '协议卡上是正中大标题；竖版编译卡上是左上角标题',
  'cardmaker.page.field.value': '数值（大号中心数字）',
  'cardmaker.page.field.panel-top': '上方面板',
  'cardmaker.page.field.panel-mid': '中部面板',
  'cardmaker.page.field.panel-bot': '下方面板',
  'cardmaker.page.field.panel.hint': '可写 **粗体** 与 __下划线__',
  'cardmaker.page.field.compile-top': '协议卡左上角小字（正面）',
  'cardmaker.page.field.compile-subtitle': '协议卡副标题（正面）',
  'cardmaker.page.field.compile-bottom': '协议卡底部小字（正面）',
  'cardmaker.page.field.compile-back': '协议卡背面那行字（背面）',
  'cardmaker.page.panel.empty-hint': '三段面板都没有文字：卡面不会画面板底衬（与参考项目一致）。',
  'cardmaker.page.panel.summary': '当前有 {n} 段面板文本（共 {paras} 段{marks}）· 行内标记写法：**粗体** 与 __下划线__ · 字号自动在 {min}–{max}px 之间缩放',
  'cardmaker.page.panel.marks-phrase': '，含行内标记',
  'cardmaker.page.bg.none': '不使用背景',
  'cardmaker.page.bg.upload': '上传背景图',
  'cardmaker.page.bg.preset-ok': '背景已换成预设「{name}」。',
  'cardmaker.page.per-card-bg': '每张卡单独的背景（关掉时整副牌共用一套背景）',
  'cardmaker.page.logo.none': '未上传 logo',
  'cardmaker.page.logo.upload': '上传 logo',
  'cardmaker.page.logo.clear': '清除 logo',
  'cardmaker.page.logo.label': '六边形 logo',
  'cardmaker.page.logo.cutout': '去掉 logo 背景（推荐）',
  'cardmaker.page.logo.cutout.hint.1': '勾选（默认）：只保留图形的形状 —— 把与图片四边相连的背景抠成透明，再把 logo 染成白色',
  'cardmaker.page.logo.cutout.hint.2': '（卡面上的 logo 本来就是白色的）。抠不动的时候（整张图几乎都是背景色）不硬抠：',
  'cardmaker.page.logo.cutout.hint.3': '直接放原图、也不染白。不勾选：**原图直上**，不抠背景也不染白，原图的颜色与背景原样进卡面。',
  'cardmaker.page.logo.cutout.hint.4': '图片本身已经是透明背景时，勾不勾选都一样。上传时生效。',
  'cardmaker.page.logo.zoom': '标志缩放',
  'cardmaker.page.logo.zoom-reset': '重置标志缩放',
  'cardmaker.page.logo.zoom-hint.1': '把六边形里的标志按中心放大 / 缩小（{min}%~',
  'cardmaker.page.logo.zoom-hint.2': '{max}%，100% = 正好铺满六边形）。',
  'cardmaker.page.logo.zoom-hint.3': '放大之后超出六边形的部分会被裁掉，不会溢到卡面别处。',
  'cardmaker.page.logo.zoom-hint.4': '这条与右边那条「背景缩放」互不影响；「重置标志缩放」只把倍数拉回 100%，不会动你拖出来的位置偏移。',
  'cardmaker.page.io.image': '导出图片',
  'cardmaker.page.io.deck': '牌组存档',
  'cardmaker.page.export-png.portrait': '导出竖版编译卡 PNG（750×1050）',
  'cardmaker.page.export-png.protocol-front': '导出协议卡正面 PNG（横版 1050×750）',
  'cardmaker.page.export-png.protocol-back': '导出协议卡背面 PNG（横版 1050×750）',
  'cardmaker.page.export-json': '导出牌组 JSON',
  'cardmaker.page.import-json': '导入牌组 JSON',
  'cardmaker.page.credit.sentence': '本制作器参考开源项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可）制作，素材（卡框/背景/卡背/字体）亦来自该项目。',
  'cardmaker.page.credit.author': '作者：{author}',
  'cardmaker.page.credit.license-label': '许可：{license}',
  // `CREDIT.license` 是**纯数据**（模块作用域不许写 `t()`，理由见那个常量）；这一条的值必须
  // 与它**逐字相同** —— 它是"许可名"这个数据显示层的那一份，由 `CLEAN_DECLARED` 那条腿钉着。
  'cardmaker.page.credit.license-value': 'MIT 许可',
  'cardmaker.page.credit.license-path': '许可原文随仓库提供：{path}',
  'cardmaker.page.mode.created.protocol': '已切到「协议卡」：整副牌还没有横版协议卡，按加卡逻辑建了一张。',
  'cardmaker.page.mode.created.compile': '已切到「卡牌」：整副牌还没有竖版编译卡，按加卡逻辑建了一张。',
  'cardmaker.page.mode.switched.protocol': '已切到「协议卡」（横版 · 正/背两面）。',
  'cardmaker.page.mode.switched.compile': '已切到「卡牌」（竖版编译卡）。',
  'cardmaker.page.face.switched.back': '已切到协议背面',
  'cardmaker.page.face.switched.front': '已切到协议正面',
  'cardmaker.page.save-failed': '本机保存失败：{detail}（本次会话仍可继续编辑）',
  'cardmaker.page.saved-memory': '改动已记在内存里（游客模式）：刷新或关闭页面就会丢。',
  'cardmaker.page.saved': '已保存到本机。',
  'cardmaker.page.card.kind.protocol': '协议卡',
  'cardmaker.page.card.kind.compile': '协议所属卡牌',
  'cardmaker.page.card.untitled': '（未命名）',
  'cardmaker.page.card.note': '{label} · 数值 {value}',
  'cardmaker.page.card.value-empty': '—',
  'cardmaker.page.card.none': '这个模式下还没有卡。',
  'cardmaker.page.mode-hint.protocol': '当前模式：协议卡（横版 · 正/背两面）· 整副牌只允许一张，现有 {n} 张',
  'cardmaker.page.mode-hint.compile': '当前模式：卡牌（竖版编译卡）· 现有 {n} 张',
  'cardmaker.page.bg.no-card': '没有可编辑的卡',
  'cardmaker.page.bg.preset': '预设背景：{name}',
  'cardmaker.page.bg.name-lost': '（名字丢了）',
  'cardmaker.page.bg.custom': '自定背景：已上传的图片',
  'cardmaker.page.logo.set-raw': 'logo：已上传（原图直上，未染白）',
  'cardmaker.page.logo.set-cut': 'logo：已上传（已抠背景 + 白色着色）',
  'cardmaker.page.preview.none': '当前没有可预览的卡',
  'cardmaker.page.preview.landscape-front': '预览：横版协议卡正面 · 设计空间 {w}×{h}',
  'cardmaker.page.preview.landscape-back': '预览：横版协议卡背面 · 设计空间 {w}×{h}',
  'cardmaker.page.preview-failed': '预览没画出来：这张卡的背景图加载失败（换一张图或点「不使用背景」）。',
  'cardmaker.page.bg.cleared': '已把背景设为「不使用」：卡面只剩底色与卡框。',
  'cardmaker.page.bg.waiting': '等待你选择一张图片…（选择框里可以取消）',
  'cardmaker.page.bg.read-failed': '读取图片失败：{detail}',
  'cardmaker.page.bg.cancelled': '已取消选择图片：屏上没有任何改动。',
  'cardmaker.page.bg.normalize-failed': '这张图片处理不了：{detail}',
  'cardmaker.page.bg.uploaded': '背景已换成你上传的图片（已自动缩到 2000px 以内，好让牌组 JSON 装得下）。',
  'cardmaker.page.bg.reset-ok': '背景平移与缩放已重置。',
  'cardmaker.page.logo.waiting': '等待你选择一张 logo 图片…（选择框里可以取消）',
  'cardmaker.page.logo.read-failed': '读取 logo 失败：{detail}',
  'cardmaker.page.logo.cancelled': '已取消选择 logo：屏上没有任何改动。',
  'cardmaker.page.logo.cut.rejected': '这张图的背景占得太多（约 {pct}%），抠下去会把图形本身也洗掉，',
  'cardmaker.page.logo.cut.rejected.2': '所以这次**没有抠背景**，直接放原图（保留它自己的颜色；染白会变成一整块白，所以也没染）。',
  'cardmaker.page.logo.cut.rejected.3': '想要一开始就不做任何处理，取消勾选。',
  'cardmaker.page.logo.cut.done': '已把与四边相连的背景抠掉（约 {pct}% 的像素），再染成白色。',
  'cardmaker.page.logo.cut.none': '这张图没有可去掉的背景（四角本来就是透明的），直接染成白色。',
  'cardmaker.page.logo.cut.off': '按你的选择**原图直上**：没有抠背景、没有染白，卡面上就是这张图原来的颜色与背景。',
  'cardmaker.page.logo.normalize-failed': '这张 logo 处理不了：{detail}',
  'cardmaker.page.logo.uploaded': 'logo 已上传：{note}',
  'cardmaker.page.logo.cleared': 'logo 已清除。',
  'cardmaker.page.logo.zoom-reset-ok': '标志缩放已重置为 100%（位置偏移没动）。',
  'cardmaker.page.card.added': '已加一张竖版编译卡。',
  'cardmaker.page.card.deleted': '这张卡已删除。',
  'cardmaker.page.export.waiting': '正在渲染…（导出按 300dpi 的成品尺寸，比屏上预览大一档）',
  'cardmaker.page.export.no-2d': '这台设备拿不到 2D 画布，没法导出 PNG。',
  'cardmaker.page.export.failed': '导出 PNG 失败：{detail}',
  'cardmaker.page.export.ok': '已导出 {name}（{w}×{h}）',
  'cardmaker.page.export.ok.kind': '—— {kind}。',
  'cardmaker.page.card.kind.landscape': '横版协议卡',
  'cardmaker.page.card.kind.portrait': '竖版编译卡',
  'cardmaker.page.export.canvas-failed': '画布导出失败（浏览器没有给出图片数据）。',
  'cardmaker.page.export.unsupported': '这台设备不支持导出 PNG。',
  'cardmaker.page.export-json.ok': '已导出 {name}（自定图以 base64 内嵌，预设背景按名字引用）。',
  'cardmaker.page.export-json.failed': '导出牌组失败：{detail}',
  'cardmaker.page.import.waiting': '等待你选择牌组 JSON…（选择框里可以取消）',
  'cardmaker.page.import.read-failed': '读取文件失败：{detail}',
  'cardmaker.page.import.cancelled': '已取消导入：屏上没有任何改动。',
  'cardmaker.page.import.failed': '导入失败：{detail}',
  'cardmaker.page.import.ok': '已导入 {n} 张卡。',
  'cardmaker.page.loaded': '已从本机读回保存的牌组（{n} 张卡）。',
  'cardmaker.page.load-failed': '读取本机保存的牌组失败：{detail}（先用一份空牌组继续）',

  /* ── ★ 2026-10-02（P3）：联机大厅整屏（`src/ui/net-lobby.ts`） ── */
  'net-lobby.error.card-data-hash': '两端的卡牌数据不是同一份（握手时卡牌指纹对不上）：请确认两台设备装的是同一个版本的卡牌资料，其中一方更新过卡牌资料的话，另一方也要跟着更新。',
  'net-lobby.error.room-gone': '等了 {seconds} 秒也没连上对端：房间码可能打错了，或者房主已经关掉页面（主机关掉页面就是这一局结束）。可以核对房间码重试，或者改用邀请码（它不需要信令服务）。',
  'net-lobby.error.busy': '这个房间的玩家位已经满了：G5 一局只有两个玩家位，没有空位可以进来。请让房主确认没有别人先进来，或者另开一个房间。',
  'net-lobby.error.spectator': '这个版本还不支持观战：观战席还没造出来（**不是**观战席坐满了）。请让对方以玩家身份重新握手。',
  'net-lobby.error.proto-version-consistent': '协议版本与本机一致，所以这一格今天不会被渲染出来（它只在版本不一致时由 protocolVersionCheck 给出）',
  'net-lobby.error.refusal-with-detail': '{base}（对端给的理由：{detail}）',
  'net-lobby.error.boundary': '本表钉的是五条文案互不相同、来源可追、且拒绝理由能连到对应那一格；真网络下能否触发属 T9/人工验收。',
  'net-lobby.link.online': '对端在线，可以开始这一局。',
  'net-lobby.link.offline-window-live': '对端现在不在线（链路断了）。这一局的宽限期还没过：对端若带着同一个会话回来，本地会把这一局追平接着打。注意刷新页面不能让对局回来 —— 刷新只是把手里这份会话丢掉。',
  'net-lobby.link.offline-window-expired': '对端离线已经超过了宽限期，这一局不能再接着打了。刷新页面同样不能让对局回来：宽限期是从最后一次收到对端消息算起的，而刷新还会把本地这份状态一并丢掉。',
  'net-lobby.link.offline-window-unknown': '对端现在不在线（链路断了）。这一侧判不了宽限期还剩多少（没有可用的时钟读数）——这是"无法判定"，不是"还在宽限期内"。刷新页面同样不能让对局回来。',
  'net-lobby.link.resync-handshake': '对端带着同一个会话回来了，正在把这一局追平：等它把缺掉的那几步补齐之后才能继续。',
  'net-lobby.link.resync-queue-overflow': '本地跟不上了（入站队列溢出，落后了一大段操作），需要走一次追平。注意：房主这一侧的队列溢出在今天没有自动出路（只有加入方能发追平请求）——如果房主就是这一侧，这一局只能由上层结束，不能继续推进回合。',
  'net-lobby.link.detail-suffix': '{base}（{detail}）',
  'net-lobby.turn.draft-mine': '轮到你选协议（第 {n} 步，共 {total} 步）',
  'net-lobby.turn.draft-peer': '现在轮到对方选协议（第 {n} 步，共 {total} 步）—— 等他选',
  'net-lobby.turn.play-mine': '轮到你出牌',
  'net-lobby.turn.play-peer': '现在轮到对方出牌',
  'net-lobby.recovery.expired': '对端离线已经超过了宽限期：按 D8 的规则这一局不能再追平了，但本地这份对局不会被程序自动结束（它只是不再接受追平）。要接着打只能重新开一局：请重新生成邀请码 / 重新加入。',
  'net-lobby.recovery.live': '这一局的宽限期还没过：请重新生成邀请码 / 重新加入。对方带着同一个会话接上之后，本地会把这一局追平接着打（追平要把缺掉的那几步补齐）—— 这是重新交接一次邀请码，不是后台自己把链路接回来。',
  'net-lobby.recovery.unknown': '这一侧判不了宽限期还剩多少（没有可用的时钟读数）：对端若带着同一个会话回来，可以追平接着打；超过 5 分钟之后再回来就不允许追平、只能重开。请重新生成邀请码 / 重新加入。',
  'net-lobby.relay.partial': '中继（TURN）只填了一部分，所以这一项没有被用上：URL、用户名、凭据三项必须齐全，缺任何一项的中继在真实网络里都会拒绝连接。补齐之后它才会生效。',
  'net-lobby.paste.shape-hint': '整条链接、链接里 {prefix} 后面那一串、或者只粘邀请码本身，三种都可以。',
  'net-lobby.invite.link-without-fragment': '你粘的是一条链接，但链接里没有 {prefix} 后面那一段；请确认你复制的是整条链接（井号后面那一截也要一起复制），或者只粘邀请码本身。',
  'net-lobby.answer.link-without-fragment': '你粘的是一条链接，但链接里没有 {prefix} 后面那一段；请确认你复制的是整条链接（井号后面那一截也要一起复制），或者只粘对方给你的回示码本身。',
  'net-lobby.step.tag.done': '已完成',
  'net-lobby.step.tag.current': '现在做这一步',
  'net-lobby.step.tag.waiting': '在对方那边',
  'net-lobby.steps.done-now': '这一局的交接已经走完，往下就交给硬币那一屏了。',
  'net-lobby.steps.title': '交接步骤',
  'net-lobby.action.make-invite': '生成邀请码',
  'net-lobby.step.host.send-invite': '把邀请码发给对方',
  'net-lobby.step.host.peer-answers': '对方回示（对方会产出一条回示码）',
  'net-lobby.step.host.paste-answer': '把回示码贴回来',
  'net-lobby.step.guest.paste-invite': '把邀请码贴进来',
  'net-lobby.step.guest.show-answer': '出示回示码',
  'net-lobby.step.guest.send-answer': '把回示码发回给房主',
  'net-lobby.step.guest.host-pastes': '房主贴回来之后接通',
  'net-lobby.steps.now.host-make-invite': '现在：点「生成邀请码」。',
  'net-lobby.steps.now.host-paste-answer': '现在：把对方发回的回示码贴到下面那个框里。',
  'net-lobby.steps.now.host-send-invite': '现在：把邀请码发给对方（对方贴进去之后才会产出回示码）。',
  'net-lobby.steps.now.guest-paste-invite': '现在：把对方发来的邀请码贴到下面那个框里。',
  'net-lobby.steps.now.guest-send-answer': '现在：把上面那条回示码发回给房主（房主贴进去之后链路才会通）。',
  'net-lobby.steps.now.guest-show-answer': '现在：点「出示回示码」，再把它发回给房主。',
  'net-lobby.plain.resyncing': '这一局在追平：等对方把缺掉的那几步补上。',
  'net-lobby.plain.linked': '两边都接上了。',
  'net-lobby.plain.peer-absent': '对端还没接上来。',
  'net-lobby.face.ask-failed': '要面失败：{detail}',
  'net-lobby.send.encode-failed': '这条消息编不出来，没有发出去。',
  'net-lobby.trace.redrive-failed': 'redrive失败({type}:{reason})',
  'net-lobby.trace.redrive-sent': 'redrive发出({type})',
  'net-lobby.trace.resync-req-sent': '发出 resync-req',
  'net-lobby.trace.apply-resync-rejected': 'applyResync拒绝({detail})',
  'net-lobby.trace.apply-resync-ok': 'applyResync成功(phase={phase})',
  'net-lobby.trace.apply-resync-resend-failed': 'applyResync重发失败({type}:{reason})',
  'net-lobby.trace.accept-rejected': 'accept拒绝({type}:{detail})',
  'net-lobby.resync.host-refused': '追平失败：本端没能用这份档案重建状态（原因见屏上那一行提示）；本端状态一个字没动，也不假装已经追平。',
  'net-lobby.trace.resync-host-refused': '追平失败(宿主拒绝)',
  'net-lobby.trace.send-hello-role-rejected': 'sendHello:拒绝(role={role})',
  'net-lobby.trace.send-hello-done-rejected': 'sendHello:拒绝(helloDone)',
  'net-lobby.trace.send-hello-queued': 'sendHello:交下(status={status})',
  'net-lobby.trace.flush-skipped': 'flush:跳过(pending={pending},done={done})',
  'net-lobby.trace.flush-wait-status': 'flush:等状态(status={status})',
  'net-lobby.trace.flush-failed': 'flush:失败({reason})',
  'net-lobby.trace.flush-hook-open': 'flush:挂通道open',
  'net-lobby.trace.channel-open': 'channelOpen回调',
  'net-lobby.trace.flush-ok': 'flush:成功',
  'net-lobby.invite.empty': '邀请码是空的：请把对方发来的整条邀请码完整粘贴进来。',
  'net-lobby.hello-diag.no-link': '（没有链路）',
  'net-lobby.room-code.normalized': '房间码 {code} 已规范化；频道 {channel}。',
  'net-lobby.answer.no-invite': '还没读到邀请码：把对方那条邀请码完整粘进上面的框，读完再点这个按钮。',
  'net-lobby.answer.invite-unreadable': '这条邀请码读不出来，所以产不了回示码：{detail}',
  'net-lobby.answer.no-capability': '这一环境没有可用的回示码能力（没有注入产回示码那一步）。',
  'net-lobby.answer.building': '正在建立回示码（要等本侧 ICE 收集）…',
  'net-lobby.answer.empty': '回示码是空的：请把对方发来的整条回示码完整粘贴进来。',
  'net-lobby.answer.not-an-answer': '这条不是对方回示的答案，而更像一条邀请码：请确认你贴的是对方在加入之后给你的那条回示码。',
  'net-lobby.answer.applied': '已经把对方的答案接上了。',
  'net-lobby.copy.ok': '已复制{what}。',
  'net-lobby.copy.denied': '复制不了（浏览器不给剪贴板权限），请手动全选复制。',
  'net-lobby.copy.unavailable': '复制不了（这个页面没有剪贴板接口；不是 https 或 localhost 时常见），请手动全选复制。',
  'net-lobby.nav.back': '← 返回模式选择',
  'net-lobby.title': '联机对战',
  'net-lobby.entry.host.title': '我建房',
  'net-lobby.entry.host.desc': '由你生成一条邀请码，把码发给对方。',
  'net-lobby.entry.host.btn': '建房（生成邀请码）',
  'net-lobby.entry.guest.title': '我加入',
  'net-lobby.entry.guest.desc': '粘贴对方发来的邀请码或整条邀请链接。',
  'net-lobby.entry.guest.btn': '加入（粘贴邀请码 / 输 6 位码）',
  'net-lobby.invite.h2': '把这条邀请码发给对方',
  'net-lobby.copy.invite.label': '复制邀请码',
  'net-lobby.what.invite': '邀请码',
  'net-lobby.copy.link.label': '复制链接',
  'net-lobby.what.link': '链接',
  'net-lobby.invite.link-summary': '链接形态（也可以把整条链接发过去）',
  'net-lobby.paste.h2': '粘贴对方发来的邀请码',
  'net-lobby.paste.read-ok': '读到了：这是一条邀请码，接下来会尝试接上对端。',
  'net-lobby.paste.read-none': '没读到可用的邀请码。',
  'net-lobby.answer.pending-parsing': '正在解析对方的邀请码…读完就能出示回示码了（不用重复粘贴）。',
  'net-lobby.answer.pending-connecting': '邀请码已经读到了，正在接上对端…接好就能出示回示码了。',
  'net-lobby.copy.answer.label': '复制回示码',
  'net-lobby.what.answer': '回示码',
  'net-lobby.room-code.h2': '输 6 位房间码',
  'net-lobby.room-code.submit': '用这个房间码连接',
  'net-lobby.answer-back.h2': '对方回示之后：粘贴回示码',
  'net-lobby.status.h2': '连接状态',
  'net-lobby.status.phase': '会话相位：{phase}',
  'net-lobby.status.local-link-up': '本侧的链路已经建起来了，在等对端接上。',
  'net-lobby.status.local-link': '本机链路：{transport}（这只表示本侧，不代表对端在）',
  'net-lobby.advanced.toggle': '高级 / 连接设置',
  'net-lobby.advanced.endpoint.h3': '信令端点',
  'net-lobby.advanced.endpoint.configured': '已配置信令端点：{endpoint}',
  'net-lobby.advanced.relay.h3': '中继（TURN）',
  'net-lobby.advanced.relay.hint': '这一块平时不用管：默认那台中继够用 ——两端能直连时走直连，直连打不通时会自动经它转发。只有你想换成自己的中继，才需要填下面这三项。',
  'net-lobby.advanced.relay.toggle': '改用我自己的中继（TURN）',
  'net-lobby.advanced.relay.need-all': '要改就得三项齐全（URL、用户名、凭据）；三项填齐之后以你填的为准。',
  'net-lobby.advanced.turn.username': 'TURN 用户名',
  'net-lobby.advanced.turn.credential': 'TURN 凭据',
  'net-lobby.invite-length.chars': '这条邀请码 {chars} 个字符；{verdict}',
  'net-lobby.invite-length.within': '落在这一档的实测区间内。',
  'net-lobby.invite-length.outside': '不在这一档的实测区间内（比实测的长或短）—— 仍然可用，但可能被某些聊天工具截断，发送时注意。',
  'net-lobby.proto.not-invite': '这不是一条邀请码：它没有"协议版本.压缩段"这个两段结构。',
  'net-lobby.proto.bad-head': '邀请码的协议版本段不是一个正整数（读到 {head}）。',
};
