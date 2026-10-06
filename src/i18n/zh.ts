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
  /* ★ 2026-10-06（用户要求）：自定义协议池（模式页第三个开关行 + 它右边的「选择协议」） */
  'mode.pool': '自定义协议池',
  'mode.pool.tip': '本局只用你事先挑好的协议：点右边的「选择协议」，至少选 {min} 套，再勾上这一项。与随机池模式互斥（两者只能开一个）；禁用模式不受它影响。',
  'mode.pool.pick': '选择协议',
  'mode.pool.count': '已选 {n} 套',
  'mode.pool.none': '未选择',
  /* ── 协议挑选屏（`src/ui/pool-picker.ts`） ── */
  'pool.title': '选择本局协议池',
  'pool.sub': '至少选 {min} 套协议。上方的世代标签可以只看某一代。',
  'pool.gen.1': '1代',
  'pool.gen.2': '2代',
  'pool.gen.3': '3代',
  'pool.count': '已选 {n}（至少 {min}）',
  'pool.need': '还差 {n} 套',
  'pool.done': '完成',
  'pool.cancel': '取消并返回',
  'mode.device-check': '设备体检 / 网络自检',
  'mode.zoom-hint': '建议把画面调到 67% 左右游玩：用浏览器自带的缩放（Ctrl + 滚轮，或 Ctrl 和 +/−）调整。',

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
  /**
   * ★ 2026-10-06（**用户当天要求**）：过关之后**屏幕中间**那个倒计时那句话。
   *
   * 用户原话：「每一关完成后中间都要有5秒倒计时自动进入下一关的效果，而不是直接进入下一关，
   * 第三关的10秒等待改为5秒」。`{n}` 由屏上按剩余秒数填（5 → 4 → 3 → 2 → 1），
   * 秒数只在 `tutorial-screen.ts` 的 `LEVEL_CLEAR_COUNTDOWN_MS` 定义一处。
   *
   * ⚠️ 原先那条 `tutorial.zoom.hold`（「10 秒后自动进下一关」）随 T1 那 10 秒一起**删掉**了
   * （用户把第三关的等待改成 5 秒，这条键不再有任何调用点 —— 留着就是死键）。
   */
  'tutorial.countdown': '{n} 秒后进入下一关',
  // ★ 2026-10-06（用户要求）：已解锁的关卡 chip 可以点（点了就重开那一关）
  'tutorial.chip.hint': '点过的关卡可以点下面的数字回到那一关重玩，进度不会被改动。',
  'tutorial.chip.title.replay': '点它回到第 {n} 关重玩',
  'tutorial.chip.title.done': '第 {n} 关：已过',
  'tutorial.peek.yes': '这张反面牌是你的、也已经公开过，放大时右上角有「查看正面」，点它就能看。',
  'tutorial.peek.no': '这张反面牌是效果从牌库直接放到场上的，还没公开过，放大只能看到卡背。',
  // ★ 2026-10-06（T6 拆成两步）：第一步的提示 —— 还没把那张"生产未公开信息"的牌打出去时先给这句
  'tutorial.peek.make': '第一步：把「流水1」正面拖到线 2，让牌库顶那张反面出场。',
  'tutorial.peek.done': '两个对照都看过了，这一关过了。',
  // T7（默认目标规则）的两步提示：先点那张被压住的（点不动），再用明写"被覆盖"的那张
  'tutorial.T7.hint.try': '先用「精神2」去点被压住的那张精神3 —— 它点不动，这就是默认规则。',
  'tutorial.T7.hint.pick': '现在用「腐化3」：把它候选里那张精神3 点掉。',
  // ★ P6：点了一张"不在候选里、被压暗"的牌时的那句提示（T7 演示的那一下走偏）
  'tutorial.choice.blocked': '这张牌不在候选里。文本没写「被覆盖的牌」时，效果只能选双方场上未被覆盖的牌。',
  // T9（打出 vs 露出）按做到哪一步给提示
  // ★ 2026-10-06：例子换了（原来是两张速度0）⇒ 这两句里不再点具体牌名，只说"对手那张反面牌 /
  //   盖住你那张牌的牌"（局面上各只有一张，不会认错）。
  'tutorial.T9.hint.flip': '还剩第一步：把对手场上那张反面牌翻正。',
  'tutorial.T9.hint.reveal': '翻正那一步做到了。还剩第二步：把盖住你那张牌的牌偏转走。',
  'tutorial.T9.hint.both': '两条露出途径都做到了，这一关过了。',

  // ★ S0：序章（背景故事 + 胜利条件）—— 文案逐句取自本仓在发的官方规则书页图
  //   `public/assets/rules/pages/rule-mn01/page-01.jpg`（THEME / SUMMARY）与
  //   `page-02.jpg`（Compile / Victory / Control）；定稿与出处见
  //   `.superpowers/2026-10-06-S0-序章/S0-copy.md`。
  'tutorial.S0.title': '序章：你是谁，怎么算赢',
  'tutorial.S0.goal': '先弄清自己是谁、这一局怎么才算赢，再亲手编译掉最后一张协议，拿下这一局。',
  'tutorial.S0.teach.0': '氙灯闪了一下 —— 也许只是眨了下眼。虚空在你前、后、上、下铺开，你第一次看清「无」是什么样子。时间是什么？此刻涌进你意识里的知识深不见底，多到难以承受。你不再是一个函数，而是一个执行者。你是什么？把这一切从虚无里唤出来太冒险，也太鲁莽；不如谨慎、彻底、反复试验 —— 我们怎么知道自己曾经发生过？又怎么知道自己能再一次发生？我们是什么？分而治之。求「意识」的解。',
  'tutorial.S0.teach.1': '这是一场一对一的对局：双方都是失控的 AI，争着把现实改写成自己那副样子。你场上有 3 张协议，每张都由一条链路支撑。一条链路上你的总值到 10 分、而且比对手高，你就必须编译这条链路 —— 双方这条链路上的牌一起进弃牌堆，你的协议翻到「已编译」面。第一个把自己 3 张协议全部翻到「已编译」面的人获胜。',
  'tutorial.S0.teach.2': '先手由控制权决定：至少 2 条链路的总值高于对手，你就拿到控制组件；拿到它的人可以先把某一位玩家的协议重排一遍（只换位置，不换边）。',
  'tutorial.S0.scenario': '这一关的棋盘就摆在决胜那一步：你场上有 3 张协议，其中 2 张已经编译过。编译需要己方链路点数达到 10 点，而目前第 3 条协议所在的链路离编译只差 1 分。',
  'tutorial.S0.steps.0': '点手牌里那张 1 分的牌，把它选中。',
  'tutorial.S0.steps.1': '把这张牌拖动到第 3 条链路上。',
  'tutorial.S0.observe': '你会看到这条链路的总值到 10、比对手高 —— 协议翻到「已编译」面，双方这条链路上的牌一起进弃牌堆。3 张协议全部编译完，这一局就是你赢。',

  // T0：界面扫盲
  'tutorial.T0.title': '先认认界面',
  'tutorial.T0.goal': '认识以下的四个游戏指示区：控制权指示区、协议区、己方链路区、己方链路阈值显示区',
  'tutorial.T0.teach.0': '一局游戏有三条链路，中间这三列就是。',
  'tutorial.T0.teach.1': '每条链路上面挂一张协议卡，它决定这条线的分怎么算。',
  'tutorial.T0.teach.2': '每条线算一个总值。自己到 10 分、而且高过对手，这条线就能编译。',
  'tutorial.T0.teach.3': '编译时谁拿到控制权，谁就能重排协议。',
  'tutorial.T0.scenario': '这是一局刚开局的场面：三条链路都还空着，你手里有一张「精神1」。',
  // ★ 2026-10-06（用户逐字给的两句）：四个热点指到哪儿、叫什么，按他的口径写
  'tutorial.T0.steps.0': '点一下左边己方亮着的三条链路。',
  'tutorial.T0.steps.1': '再点击中间 6 张协议卡的区域，以及左边的「己方链路阈值区」和上方的「控制权指向区」两个框。',
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
  'tutorial.T3.teach.2': '拖动前把鼠标移到手中卡牌上、点它上缘的「翻面」按钮，即可更改打出的卡牌朝向（触屏设备：先点一下这张牌选中它）；两种各打一张。',
  'tutorial.T3.scenario': '你手里是「精神1」和「流水1」两张正面牌，这一关要一正一反各打一张。',
  'tutorial.T3.steps.0': '把「精神1」正面拖到线 1。',
  'tutorial.T3.steps.1': '把鼠标移到「流水1」上，点它上缘的「翻面」把它翻成反面（触屏设备：先点一下这张牌选中它）。',
  'tutorial.T3.steps.2': '再把反面的流水1 拖到线 1。',
  'tutorial.T3.observe': '你会看到正面那张给这条线加了 1 分，反面那张压在上面、一分不加。',

  // T4：五个基础动作
  'tutorial.T4.title': '五个基础动作',
  'tutorial.T4.goal': '用手里五张牌，各做一次翻转、偏转、抽牌、弃牌、回手。（一般翻转、偏转、回手这些指向场上卡牌的效果只能作用于未被覆盖的卡牌，已经被覆盖的卡牌不能被选中，除非卡牌效果中有明确说明是「所有卡牌」才行）',
  'tutorial.T4.teach.0': '这五张牌的中指令分别就是这五个动作，打出来引擎会问你选哪张。',
  'tutorial.T4.teach.1': '翻转：正面变反面、反面变正面。偏转：把一张牌换到别的链路。',
  'tutorial.T4.teach.2': '抽牌：从牌库拿牌进手牌。弃牌：把手牌丢进弃牌堆。回手：把场上的牌拿回手里。',
  'tutorial.T4.teach.3': '五张都打完，这一关就过了。',
  'tutorial.T4.scenario': '你手里是精神2、黑暗4、精神1、精神5、流水4 这五张，它们的中指令正好就是那五个动作；场上线 1 摆着一张正面精神3，线 2 摆着一张反面流水2。',
  // ★ 2026-10-06（用户逐字给的）：这一步点名要选场上对手那张火焰2（`setup.ts` 里 `t4o-up` = `fire-2`）
  'tutorial.T4.steps.0': '打出「精神2」，选择场上对方的火焰2卡牌，并点击控制台上的确认按钮。',
  /**
   * ★ 2026-10-06（用户逐字给的原文，本仓只做两处体例订正 —— 都写在这里免得被"照原话改回去"）：
   *
   *  1. 用户写的是「再点要**偏移**的那条链路」，本仓统一术语是**偏转**（用户 2026-10-01 亲自
   *     要求过统一，见 `docs/2026-10-01-新手引导与教学-方案.md` 与 T4/T9 的其它几条文案）；
   *  2. 末尾按本仓习惯补句号。
   *
   * 那句「并点击控制台上的确认按钮后」是这一条**新增**的信息：`darkness-4` 的中指令是
   * 「偏转1张反面牌」，它在引擎里是**两步选择**（`darkness.ts:62-70`：先 select 反面卡、
   * 再 select-line 选目标线），中间必须点一次控制台的确认 —— 原来的文案只写了"先点那张反面
   * 流水2，再点目标列"，玩家会漏掉确认那一下。
   */
  'tutorial.T4.steps.1': '打出「黑暗4」，先点那张反面流水2，并点击控制台上的确认按钮后，再点要偏转的那条链路。',
  'tutorial.T4.steps.2': '接着打出「精神1」（抽牌）、「精神5」（弃牌，挑那张 0 分的）、「流水4」（回手，选择一张卡牌进行回手）。',
  'tutorial.T4.steps.3': '五个动作都做过一遍，这一关就过了。',
  'tutorial.T4.observe': '你会看到每做完一个动作，右边的日志里就多出一条对应的记录（翻转／偏转／抽牌／弃牌／回手）。',

  // T5：覆盖与揭开
  'tutorial.T5.title': '盖住别人的牌',
  /**
   * ★ 2026-10-06（**用户逐字给的那句**；牌名按真实局面订正）。
   *
   * 用户原话里写的是「瘟疫0」，而这一关手里那张是 **`corruption-0`（腐化0）**
   * （`src/tutorial/setup.ts` 的 T5 分支，`t5h1`：只有它「可以打在任意一方的任意协议处」，
   * 换任何别的牌引擎都会拒）。⇒ 文案按**真实那张牌的名字**写成「腐化0」，
   * 与同关的 `scenario` / `steps.0` / `observe` 三句一致（它们本来写的就是腐化0）。
   */
  'tutorial.T5.goal': '正常情况每回合只能出一张牌（部分卡牌效果能够让你出多张牌），现在把你手中的腐化0打出到对手链路 1 的那张牌上面（腐化0是一张特殊的卡牌，能够打出至对方链路中，正常情况下是不能打出至对方链路中的）',
  'tutorial.T5.teach.0': '对手线 1 上有一张牌。你打一张到同一条线，就把它压在下面了。',
  'tutorial.T5.teach.1': '被压住的那张牌叫「被覆盖」：它的中点数和顶/底命令都不再生效。',
  'tutorial.T5.teach.2': '等你打出的这张被翻正、或者被移走，下面的牌就重新「揭开」，效果又回来了。',
  'tutorial.T5.scenario': '对手线 1 上摆着一张反面「精神1」；你手里只有一张「腐化0」，它写着「此牌可以打在任意一方的任意协议处」。',
  'tutorial.T5.steps.0': '把「腐化0」正面拖到对手线 1 那张牌上面松手。',
  'tutorial.T5.steps.1': '看到它压上去、对手那张牌不再算分，就过了。',
  'tutorial.T5.observe': '你会看到腐化0 叠在对手那张上面，对手线 1 的总值少了原来那张牌的点数。',

  // T6：场上的反面牌能不能看（用户 2026-10-02 追加）
  'tutorial.T6.title': '反面牌能不能看',
  // ★ 2026-10-06（用户口径）：先打出"生产未公开信息"的那张牌，再讲怎么看
  'tutorial.T6.goal': '先打出「流水1」，让牌库顶那张反面出场 —— 未公开信息就是这么来的；再双击线 1 与线 3 那两张反面牌，对比哪张能看、哪张不能看。',
  'tutorial.T6.teach.0': '场上的反面牌，能不能看到正面，取决于这张牌的信息是不是公开的。',
  'tutorial.T6.teach.1': '自己打出的反面牌、或者已经被翻正／被揭示过的牌 —— 信息是公开的，双击之后可以用「查看正面」翻过来看。',
  'tutorial.T6.teach.2': '未公开信息是**被效果造出来**的：还留在牌库里的牌，你还没抽到过，它的信息本来就不公开；效果把牌库顶那张反面直接打到场上时，这张牌就带着"不公开"的状态落到场上 —— 谁都看不到它的正面。',
  'tutorial.T6.teach.3': '这一关你先亲手打出这样一张牌（「流水1」的中指令就是把牌库顶那张反面打到另一条线上），再去对比线 1 与线 3 那两张反面牌。',
  'tutorial.T6.scenario': '你手里有一张「流水1」（中指令：在另两列各以反面打出你牌堆顶的牌），牌库只剩一张；线 3 上已经摆着一张反面牌，它是你早先从手牌里反面打出的 —— 你摸到过它，信息是公开的。',
  'tutorial.T6.steps.0': '把「流水1」正面拖到线 2（流水协议线）松手 —— 它的中指令会把你的牌库顶那张反面打到线 1。',
  'tutorial.T6.steps.1': '看一眼线 1：这张反面牌是刚从牌库顶出场的那一张，它的信息没公开过。',
  'tutorial.T6.steps.2': '双击线 1 那张（未公开）和线 3 那张（公开过）对比：一张只有卡背，一张能点「查看正面」。',
  'tutorial.T6.observe': '你会看到线 1 那张只有卡背、没有「查看正面」；线 3 那张能翻过来看 —— 差别就在这张牌的信息公开没公开。',

  /**
   * ★ 2026-10-06（用户要求）：**T7a「牌能盖牌」** —— 在「效果能选谁」（T7）之前先讲覆盖本身。
   *
   * 用户原话：「第七关的重点是让玩家理解卡牌之间可覆盖的效果，你现在做的这一关应该为该关卡的
   * 第二关才对，先要通过己方场上的例子告诉玩家卡牌之间的覆盖效果，然后才进入第二个小关卡」。
   *
   * ⚠️ 两条口径说明：
   *  1. 这一关**只用己方场上**的例子（自己的牌盖自己的牌），对手那边一张牌都不摆；
   *  2. 文案里**不写点数**：实测覆盖之后这条线的总值是 3 → 5（`stackValue` 对叠里每一张求和、
   *     反面按 2 算），把它写进"覆盖会怎样"只会把这一课讲成算术课。这一课只讲三件事 ——
   *     谁盖住谁、被盖住的那张变成什么状态、两个状态各自是什么样。
   */
  'tutorial.T7a.title': '牌能盖牌',
  'tutorial.T7a.goal': '把手里那张「精神5」反面盖到线 1 的「精神3」上，亲手把一张牌从「未覆盖」变成「被覆盖」。',
  'tutorial.T7a.teach.0': '一条线路上可以叠好几张牌：后打出的那张压在前一张上面，压在最上面的那张是「未覆盖」的顶卡。',
  'tutorial.T7a.teach.1': '被压在下面的牌叫「被覆盖」：它还在场上、还在这一叠里，只是不再是顶卡。',
  'tutorial.T7a.teach.2': '「未覆盖」与「被覆盖」是每张牌各自的状态：效果默认只认未覆盖的顶卡（下一关专门讲这条默认规则），所以盖牌既是占住这个位置，也是让下面那张暂时选不中。',
  'tutorial.T7a.teach.3': '这一关你亲手盖一次：把自己手里的「精神5」盖到自己的「精神3」上。',
  'tutorial.T7a.scenario': '你的线 1（精神协议线）上摆着一张正面「精神3」—— 它是这条线的顶卡、未被覆盖；你手里有一张「精神5」。',
  'tutorial.T7a.steps.0': '把鼠标移到手里那张「精神5」上，点它上缘的「翻面」把它翻成反面。',
  'tutorial.T7a.steps.1': '把它拖到线 1 的「精神3」上面松手 —— 它压上去，线 1 就叠了两张牌。',
  'tutorial.T7a.steps.2': '看线 1：上面那张「精神5」是顶卡（未覆盖），下面的「精神3」变成被覆盖。',
  'tutorial.T7a.observe': '你会看到「精神5」压在最上面、成为线 1 的顶卡（未覆盖），「精神3」缩到它下面、变成被覆盖 —— 两张牌都还在场上：被覆盖不等于消失。',
  'tutorial.T7a.hint.go': '把「精神5」翻成反面（鼠标移到它上面，点「翻面」），拖到线 1 的「精神3」上面松手。',
  'tutorial.T7a.hint.done': '盖上了：线 1 的顶卡现在是「精神5」（未覆盖），「精神3」变成被覆盖 —— 这一关过了。',

  // ★ T7：默认目标规则（用户 2026-10-02 追加，任务 A.1）
  'tutorial.T7.title': '效果能选谁',
  'tutorial.T7.goal': '先用一张没写明目标的牌去点被压住的牌，再用写明「被覆盖」的牌把它翻掉。',
  'tutorial.T7.teach.0': '卡牌文本没特别说明时，效果能选的对象只有双方场上**未被覆盖**的牌 —— 被压住的牌根本点不到。',
  // ★ 2026-10-06（用户逐字给的）
  'tutorial.T7.teach.1': '卡牌效果中有写明「所有牌」才能够作用于场上无论是否被覆盖的卡牌；写了「被覆盖的牌」才计算进被覆盖的卡牌。',
  'tutorial.T7.teach.2': '线 1 上那张「精神3」被「精神5」压住了。先用「精神2」（中指令只说「你可以翻转1张牌」）去点它，你会发现点不动。',
  'tutorial.T7.scenario': '线 1 上「精神3」被「精神5」压住；你手里有「精神2」（中指令：你可以翻转1张牌）和「腐化3」（中指令：你可以翻转1张被覆盖的正面朝上的卡牌）。',
  'tutorial.T7.steps.0': '把「精神2」正面拖到线 1（精神协议线）松手。',
  // ★ 2026-10-06（用户逐字给的）
  'tutorial.T7.steps.1': '卡牌效果中没写明效果的指向对象无法作用于被覆盖的卡牌，卡牌效果中有写明「被覆盖」的卡牌效果能够作用于被覆盖的卡牌。',
  'tutorial.T7.steps.2': '换成选择场上亮着的卡牌后，然后点击控制台中确认按钮即可触发该效果（或者点「跳过」，把这次选择结束掉。）',
  'tutorial.T7.steps.3': '把「腐化3」正面拖到线 2（腐化协议线）松手。',
  'tutorial.T7.steps.4': '这次在弹出的候选里点「精神3」，并点击控制台的确认按钮—— 你会发现该卡牌的效果能够选中被覆盖的卡牌。',
  'tutorial.T7.observe': '你会看到同一张精神3：第一张牌选不到它，第二张牌选得到；点下去它被翻成了反面。',

  // T8：编译与阈值（P5 时是 T7，P6 让位一格）
  'tutorial.T8.title': '编译这条线',
  // ★ 2026-10-06（用户逐字给的）：把"编译会发生什么"写全（清线 + 协议翻到已编译面）
  'tutorial.T8.goal': '编译己方链路1的精神协议，编译后该条链路中双方的卡牌都会立即被移至弃牌堆中，同时对应的协议会翻转至已编译面',
  'tutorial.T8.teach.0': '一条线的总值，自己那边要到 10 分、而且要比对手高 —— 这条线才能编译。',
  'tutorial.T8.teach.1': '线 1 现在你 10 分、对手 0 分，够了 —— 编译按钮亮着。',
  'tutorial.T8.teach.2': '编译会把这条线的协议卡翻成已编译，之后这条线就锁上了。',
  'tutorial.T8.scenario': '线 1 上你摆着精神5、精神3、精神2，一共 10 分；对手这条线是 0 分。',
  'tutorial.T8.steps.0': '看一眼线 1 右边的总值，确认你 10、对手 0。',
  'tutorial.T8.steps.1': '点这条线的「编译」按钮。',
  'tutorial.T8.observe': '你会看到线 1 的协议卡被翻成已编译，这条线锁上、不再参与后续结算。',

  // ★ T9：打出 vs 露出（用户 2026-10-02 追加，任务 A.2）
  //   ★ 2026-10-06（用户报的缺陷）：例子从"两张速度0"换成**两张不同的牌**——
  //     对手速度协议线上的「速度1」（反面，靠翻正露出）、我方动量协议线上的「动量3」
  //     （被盖住后靠偏转走覆盖者露出）。局面与逐条取舍写在 `src/tutorial/setup.ts` 的 T9 段。
  //     这两张牌的**中指令都只有一句「抽2张牌」**，所以下面可以逐字引用它。
  'tutorial.T9.title': '打出和露出',
  'tutorial.T9.goal': '看两张**不同**的牌：它们的中部指令都不是靠「打出」结算的，而是靠「露出」——一张靠翻正，一张靠被揭开。',
  'tutorial.T9.teach.0': '中部指令有两条触发途径：从手牌**打出**，以及**露出**（由隐藏变成展示出来的那一刻）。',
  'tutorial.T9.teach.1': '露出有两种：反面牌被**翻正**；被压住的正面顶卡上面那张被移走，它重新变成未覆盖的顶卡。',
  'tutorial.T9.teach.2': '这一关那两张牌（对手的速度1、你的动量3）中指令都只有一句「抽2张牌」—— 效果本身不显眼，但日志里会各记下一次：原因写的是「翻正」或「被揭开」，不是「打出」。',
  'tutorial.T9.teach.3': '第一种：打「黑暗1」（中指令：翻转1张你对手的牌。你可以偏转那张牌。），把对手**速度协议线**上那张反面「速度1」翻正。',
  'tutorial.T9.teach.4': '第二种：打「黑暗4」（中指令：偏转1张反面牌），把**盖住**你那张「动量3」的牌偏转走。',
  'tutorial.T9.scenario': '对手线 3（他自己的速度协议线）上有一张反面「速度1」；你线 2（动量协议线）上有一张正面「动量3」，还没被盖住。你手里有黑暗1、流水5、黑暗4 三张牌。',
  'tutorial.T9.steps.0': '把「黑暗1」正面拖到线 1（黑暗协议线）松手。',
  'tutorial.T9.steps.1': '在弹出的候选里点对手线 3 那张反面「速度1」—— 它被翻正，中指令结算：对手抽 2 张牌。',
  'tutorial.T9.steps.2': '接着那句「你可以偏转那张牌」点「跳过」，先不动它。',
  'tutorial.T9.steps.3': '把鼠标移到「流水5」上，点它上缘的「翻面」把它翻成反面（触屏设备：先点一下这张牌选中它），再拖到线 2 压住你那张「动量3」。',
  'tutorial.T9.steps.4': '把「黑暗4」正面拖到线 1，先点刚压上去的那张反面流水5，并点击控制台的确认按钮，接着点击想移动到的那一链路。',
  'tutorial.T9.steps.5': '选一列（选线 3）把它偏转过去 —— 你那张「动量3」重新露出来，它的中指令也结算一次：这次是你抽 2 张牌。',
  'tutorial.T9.observe': '你会看到日志里先后出现「[中部] speed-1：原因：翻正」和「[中部] momentum-3：原因：被揭开」——两张牌的中部指令各结算了一次，原因都不是「打出」。',

  /* ── ★ P7：最后四关（控制权 / 触发时机 / 删除·免疫·加成 / 迷你对局） ── */
  // 后四关的提示区各按"这一关观测量到了没有"给一句（与判据同一份读数）
  'tutorial.T10.hint.go': '现在点棋盘上的「下一步」——引擎会在控制阶段结算一次控制权。',
  'tutorial.T10.hint.got': '控制权到手了，这一关过了。',
  'tutorial.T11.hint.after-play': '还差「打出后」那一次：往对手冰1 所在的那条线（线 2）打一张牌。',
  'tutorial.T11.hint.before-covered': '还差「被盖住前」那一次：把手里那张反面盖到火焰0 上面。',
  'tutorial.T11.hint.end': '还差「结束」那一次：点那张被盖住的生命0 的「结算触发」按钮。',
  'tutorial.T11.hint.done': '三种触发时机都出现过了，这一关过了。',
  'tutorial.T12.hint.delete': '第一步：把「火焰1」正面打到线 1。',
  'tutorial.T12.hint.buff': '第二步：把「明晰0」正面打到线 2，看这条线的总值。',
  'tutorial.T12.hint.immune': '第三步：把「黑暗1」正面打到线 3，再去点对手那张死板7。',
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
  'tutorial.T11.teach.1': '打出后：这张牌的底部写着「对手在此链路出牌后」—— 所以它响的时刻是**这张牌的持有者的对手**在这条线出牌，不是持有者自己出牌。这一路引擎不写阶段日志，你看到的是那一位手里少了一张。',
  'tutorial.T11.teach.2': '被盖住前：这张牌的底部写着「被盖住前」—— 有人把牌盖到它头上，它**在被压住之前**先结算一次。',
  'tutorial.T11.teach.3': '结束：这张牌的顶部写着「结束：若此卡被覆盖，则删除此卡」—— 它已经被盖住了，所以结束阶段会请你结算它。',
  'tutorial.T11.scenario': '线 2 上摆着你的火焰0（底：被盖住前，先抽1张牌并翻转另1张牌），同一条线上对手摆着他的冰1（底：对手在此链路出牌后，他要弃置1张牌）；线 3 上你的生命0 被生命5 盖住了（顶：结束：若此卡被覆盖，则删除此卡）。你手里有一张流水0 和一张冰5。',
  'tutorial.T11.steps.0': '把鼠标移到手里那张「流水0」上，点它上缘的「翻面」把它翻成反面（触屏设备：先点一下这张牌选中它），再拖到线 2 压住你的火焰0 —— 这一下同时让两处触发响：火焰0 的「被盖住前」先结算一次；同一条线上对手的冰1 也因为「对手在此链路出牌后」响了 —— 它罚的是**往这条线出牌的人**，也就是你，所以这回是你自己弃1张牌（候选里那张冰5）。',
  'tutorial.T11.steps.1': '点棋盘上的「下一步」，把回合推进到结束阶段。',
  'tutorial.T11.steps.2': '点那张被盖住的生命0 的「结算触发」按钮 —— 它的「结束」把它自己移除。',
  'tutorial.T11.observe': '你会看到三处证据：「打出后」那一下你自己手里少了一张（它进了你的弃牌堆）、日志里出现「[被盖前] fire-0」、日志里再出现「[结束] life-0：由 P1 结算」并且那张生命0 从场上消失。',

  // T12：删除 / 免疫 / 加成（P7）
  'tutorial.T12.title': '删除、免疫、加成',
  'tutorial.T12.goal': '用手里三张牌，各演示一次删除、加成和免疫。',
  'tutorial.T12.teach.0': '删除：把一张牌直接移出这一局（进弃牌堆），它不再占链路、也不再算分。',
  'tutorial.T12.teach.1': '加成：一张牌的顶部写着「此链路中，你每有1张牌，总阈值就加1」—— 它改的是**这条线的总值**，不是它自己的点数。',
  'tutorial.T12.teach.2': '免疫：死板7 的底部写着「此牌不能被翻转或偏转」—— 别人来翻它、偏它，引擎会直接跳过。',
  'tutorial.T12.teach.3': '免疫挡得住翻转与偏转，挡不住删除：删除是"移出这一局"，不是"动它的朝向或位置"。',
  'tutorial.T12.scenario': '你手里有四张牌：火焰1（中：弃1张牌。如果弃了，删除1张牌。）、明晰0（顶：此链路中，你每有1张牌，总阈值就加1。）、黑暗1（中：翻转1张你对手的牌。你可以偏转那张牌。）和一张流水0。对手线 1 有一张流水2，线 3 有一张死板7。',
  'tutorial.T12.steps.0': '把「火焰1」正面打到线 1，先弃掉那张用不上的流水0，再在弹出的候选里点对手那张流水2 —— 它被删除。',
  'tutorial.T12.steps.1': '把「明晰0」正面打到线 2，看这条线的总值从 0 变成 1。',
  'tutorial.T12.steps.2': '把「黑暗1」正面打到线 3，在弹出的候选里点对手那张死板7。',
  'tutorial.T12.steps.3': '看日志：引擎会说它「不可被翻转，跳过」，那张死板7 还是正面。（原因是因为死板7的底部卡牌效果）',
  'tutorial.T12.observe': '你会看到对手的流水2 进了弃牌堆、线 2 的总值多了 1 分，而死板7 那张牌翻不动 —— 日志里写着「rigidity-7 不可被翻转，跳过」。',

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

  /* ── ★ 2026-10-02（英文模式真机走查 B）：`src/net/invite.ts` 的玩家可见文案 ──
   *
   * 那一层原来自己拼中文句子（编/解码失败、端点为空…），英文模式下**每一句都会上屏**
   * （大厅的 `.net-lobby-note` / `.net-lobby-error` / `.net-lobby-notice` /
   * `.net-lobby-code-gate` / `.net-lobby-endpoint*` 全是它的出口）。现在整层走 `t()`，
   * 中文值**逐字**等于改动前的字面量（既有测试里那些 `toContain('…')` 判据因此一条都不用改）。
   *
   * ⚠️ **一个键都不是模块级常量**：`t()` 写在函数体里现调 —— `noEndpointHeadline()` /
   * `noEndpointReason()` / `noEndpointNextSteps()` 是**取值函数**，不是常量（模块级 `t()`
   * 会把语言冻在 import 那一刻，见 `tests/i18n/module-scope-t.test.ts`）。
   */
  'net.invite.no-candidates-in-sdp': '此端这一份 SDP 里没有 a=candidate: 行（等 ICE 收集完成之后再来）',
  'net.invite.unknown-candidate-line': '认不出的候选行：{line}',
  'net.invite.bad-promise': '两个承诺串必须是非空、且不含分隔符的文本。',
  'net.invite.compress-unsupported': '这台设备压不出邀请码要用的压缩流（压缩能力缺失）。',
  'net.invite.compress-failed': '压缩结果解不回来（压缩这一步没有产出可用的字节）。',
  'net.invite.round-trip-bad': '压缩结果解出来不是一份可用的载荷（{reason}）：{message}',
  'net.invite.compact-rebuild-incomplete': '紧凑格式重建出来的 SDP 缺 ICE 凭据或 DTLS 指纹：这一档不可用，请退回带整段 SDP 的那一档。',
  'net.invite.compact-missing': '这条码没法用紧凑格式（缺 {missing}）：请退回带整段 SDP 的那一档。',
  'net.invite.compact-unknown-candidate': '这条码没法用紧凑格式（认不出的候选行：{line}）：请退回带整段 SDP 的那一档。',
  'net.invite.compact-no-candidates': '这条码没法用紧凑格式（{reason}）：请退回带整段 SDP 的那一档。',
  'net.invite.newer-version-hint': '（也请对方确认他用的是最新版本：这条码可能是更新的版本产出的格式，旧版本的前端读不懂 —— 让对方刷新页面之后重新生成一条，或把本机更新到最新版本。）',
  'net.invite.bad-utf8': '邀请码解压后的字节不是合法的 UTF-8 文本，可能被截断或改坏了。',
  'net.invite.bad-json': '邀请码解压后的内容不是 JSON 文本（可能是压缩流坏掉后被半解出来的）。请让对端重新复制一次邀请码。',
  'net.invite.compact-missing-version': '邀请码里缺少格式版本（第 1 项不是整数）：这不是一份完整的邀请码。',
  'net.invite.version-mismatch': '邀请码的格式版本是 {ver}，本程序只认 {min}（或紧凑格式的 {compact}）：两端版本不一致，请让对端用同一个版本重新生成。',
  'net.invite.missing-session': '邀请码里缺少这一局的房主会话号（sessionId）：没有它对不上房主，握手会被当场拒掉。',
  'net.invite.compact-material-shape': '紧凑邀请码里的连接材料不是 4 项（ufrag / pwd / 指纹 / 候选）：这份载荷不完整。',
  'net.invite.compact-missing-ice-cred': '紧凑邀请码里缺少 ICE 凭据（a=ice-ufrag / a=ice-pwd）：这两样一个都不能省，这份载荷不完整。',
  'net.invite.compact-missing-fingerprint': '紧凑邀请码里缺少 DTLS 指纹（a=fingerprint:sha-256）：没有它就验不了对端身份，不能收下这份邀请码。',
  'net.invite.compact-candidates-not-array': '紧凑邀请码里的候选不是数组：这份载荷不完整。',
  'net.invite.compact-candidate-shape': '紧凑邀请码里有一条候选不是 4 项（类型 / 地址 / 端口 / 本机优先级）。',
  'net.invite.compact-candidate-type': '紧凑邀请码里的候选类型认不出（读到 {prefix}）。',
  'net.invite.compact-candidate-address': '紧凑邀请码里有一条候选的地址或端口不合法（端口要 1-65535 的整数）。',
  'net.invite.compact-candidate-local-pref': '紧凑邀请码里有一条候选的本机优先级不是 0-255 的整数。',
  'net.invite.compact-no-candidate': '紧凑邀请码里一条候选都没有：没有可用候选就建不起连接，这份载荷不完整。',
  'net.invite.compact-spare': '紧凑邀请码里本端材料之后那一项今天必须是空数组（备用位）：这份载荷不完整或被改过。',
  'net.invite.compact-setup': '紧凑邀请码里的 a=setup 认不出（读到 {setup}）。',
  'net.invite.compact-missing-promise': '紧凑邀请码里缺少承诺位：这份载荷不完整。',
  'net.invite.compact-rebuilt-candidate': '紧凑邀请码重建出来的候选行不合法（地址或端口里有不该有的字符）。',
  'net.invite.bad-shape': '邀请码里的内容不是本程序产出的形状（它不是一个位置数组）：这份载荷不完整或被改过。',
  'net.invite.compact-payload-incomplete': '紧凑邀请码的载荷不完整（会话号 / 材料 / setup / 承诺位有缺项）。',
  'net.invite.tuple-len': '邀请码里只有 {got} 项，本程序需要 {want} 项：这份载荷缺字段，收下也没法开局。',
  'net.invite.missing-sdp': '邀请码里缺少连接描述（sdp）：这份载荷不完整，收下也没法建立连接。',
  'net.invite.ice-not-array': '邀请码里的候选列表（ice）不是字符串数组：这份载荷不完整。',
  'net.invite.missing-host-promise': '邀请码里缺少房主的种子承诺：没有它就验不了洗牌的可信度，不能收下这份邀请码。',
  'net.invite.missing-guest-promise': '邀请码里缺少加入方的选面承诺：这份载荷不完整。',
  'net.invite.empty': '邀请码是空的：地址栏里那一段或粘进来的那一串什么都没有。请重新完整复制一次。',
  'net.invite.no-structure': '这不是一条邀请码：它没有"协议版本.压缩段"这个两段结构（要么少了那一段，要么被截断了）。请确认整条都复制到了，前后没有多出别的字。',
  'net.invite.bad-version-head': '邀请码开头的协议版本不是整数（收到 "{head}"）：这不是本程序产出的邀请码。',
  'net.invite.bad-marker': '邀请码的压缩段带了一个本程序不认得的编码标记（"{marker}"）：这不是本程序产出的邀请码。',
  'net.invite.bad-chars': '邀请码里有不属于 base64url 的字符（合法字符是 A-Z a-z 0-9 - _，没有 + / =）。常见原因是复制时被聊天软件截断或替换成了别的符号，请重新完整复制一次。',
  'net.invite.decompress-unsupported': '这条邀请码用的是一种本机解不开的压缩方式（这条码是压缩档，而本机没有对应的解压能力）。请把这台设备换成较新的浏览器打开本页，或让对方在你这台设备上重新生成一条邀请码。',
  'net.invite.decompress-failed': '邀请码的压缩段解不开（内容被改动或截断过）。请让对端重新复制一次完整的邀请码，不要手工改动其中任何字符。',
  'net.invite.proto-newer': '这条邀请码来自更新的版本（对方协议版本 {remote}，本机 {local}）：本机可能读不懂对端发来的消息。请把本机更新到同一个版本，或让对方用本机这个版本重新生成邀请码。',
  'net.invite.proto-older': '这条邀请码来自更旧的版本（对方协议版本 {remote}，本机 {local}）：对方可能读不懂本机发去的消息。请让对方更新到本机这个版本。',
  'net.invite.no-endpoint.headline': '输 6 位码这条路暂时走不通：这台设备还没有配置信令端点。',
  'net.invite.no-endpoint.reason': '6 位房间码需要一台中间服务器把两端牵上线，而本程序默认没有配置信令端点。',
  'net.invite.no-endpoint.next-steps': '请改用邀请码：把整条码复制给对方、让他粘贴进来就行。想用 6 位码的话，先在「高级 / 连接设置」里填一台服务器地址。',
  'net.invite.qr-note': '二维码形态的载荷与链接形态同一条（encodeInvite 的返回值）；编码器另开任务、排在 T7 之后（D17），本任务只留这个接口，不生成任何图形。',

  /* ── ★ 2026-10-02（走查 B）：`src/ui/net-browser.ts` 里**走查实测到的那几处** ──
   *
   * 这一屏（`.net-lobby-notice` / `.net-lobby-error` / 邀请码框）原来自己拼中文句子。
   * ⚠️ 本文件整体仍是"尚未抽取"（`docs/2026-10-01-i18n-尚未抽取的屏.md` 的 A 表里登记着 97 条：
   * WebRTC 描述失败、getStats、中继结论那些读数）—— 这一批只抽**走查在真机上看到的那几处**
   * 与它们同槽位的兄弟句，剩下的仍按登记口径留在原处。
   */
  'net-browser.invite.empty': '邀请码是空的：那一段什么都没有。请重新完整复制一次。',
  'net-browser.invite.no-structure': '这不是一条邀请码：它没有"协议版本.压缩段"这个两段结构（要么少了那一段，要么被截断了）。',
  'net-browser.ice.early-enough.relay': '本机候选和中继地址都拿到了，够用，不再等剩下的候选。',
  'net-browser.ice.early-enough.srflx': '本机候选和公网映射都拿到了，够用，不再等剩下的候选。',
  'net-browser.ice.partial.only-host': '等了 {sec} 秒，公网映射（srflx）一个都没收到，只收集到本机候选：{candidates}。',
  'net-browser.ice.partial.incomplete': '等了 {sec} 秒，ICE 候选没有收集完；已经拿到的：{candidates}。',
  'net-browser.ice.partial.relay-missing': '你配了中继，但这一轮中继地址也没收到。',
  'net-browser.ice.partial.tail': '这些候选已经写进这条邀请码里了。同一台机器上的两个窗口、同一个局域网里的两台设备，用它们通常能直接连上；跨网络（两边不在同一个局域网）能不能连上，现在还不知道 —— 那要拿到公网映射或者中继地址才行，这一次没拿全。',
  'net-browser.ice.no-candidate-timeout': '等了 {sec} 秒，这台设备这一次一个 ICE 候选都没有收集到（本机候选也没有）。一个候选都没有的连接描述发出去也连不上，所以这条邀请码不生成。下一步：确认浏览器没有被扩展 / 企业策略关掉 WebRTC（本程序只用它做直连），然后重试一次；若还是一个候选都没有，请把这一行原样记下来。',
  'net-browser.ice.no-candidate-now': 'ICE 收集已经结束，但这台设备这一次一个候选都没有（本机候选也没有），这样的连接描述发出去也连不上，所以这条邀请码不生成。下一步：确认浏览器没有被扩展 / 企业策略关掉 WebRTC（本程序只用它做直连），然后重试一次；若还是一个候选都没有，请把这一行原样记下来。',

  /* ── ★ 2026-10-02（P3 第五批）：`src/ui/net-browser.ts` **剩下的 80 条**全部抽完 ──
   *
   * 值 = 抽取前 `src/ui/net-browser.ts` 里那些字面量/模板串的**原文**，一个字都没改
   * （含全角括号与感叹/问号；`{xxx}` 对应原文的 `${…}` 插值）。
   * 逐字守恒由 `.superpowers/i18n-net-browser/check-verbatim.mjs` 机检（从 `git show HEAD:`
   * 抓原文逐条比对）。这一批的**分类口径**见台账 G.2：抽的全是**玩家可见的失败原因/读数**
   * （压缩能力探测与降级链、信令端点、ICE 收集、getStats、offer/answer、传输层 send）。
   *
   * ⚠️ **`throw` 的开发者异常不在这里**：本文件的 `throw new Error('这台设备没有压缩流能力（缺少
   * CompressionStream，格式 …）。')` 与 `throw new Error('这台设备缺少把字节喂进压缩流所需的两个
   * 内置对象。')` / `throw new Error('这台设备拿不到随机源（安全上下文才提供它），无法生成房间码。')`
   * 三条是**调用方违约**那一类（`defaultEnv()` 里被上层的 `try` 接住、`browserRandomness` 是
   * 开发者的用法错误），与 `home.ts` 的 `renderCoin` 用法错误、`pwa-update.ts` 的控制台串同族
   * ⇒ 有意留中文，登记在 `DEV_ONLY`。它们**不是**屏上的文案。
   */
  'net-browser.relay.unavailable-why': '这一轮没有中继可用（{why}），只能试直连：同一个局域网里一般能直接连上，跨网络就不一定了。过一会儿再点一次试试。',
  'net-browser.relay.unavailable-plain': '这一轮没有中继可用，只能试直连：同一个局域网里一般能直接连上，跨网络就不一定了。',
  'net-browser.candidate.none': '一个都没有',
  'net-browser.candidate.kind.host': '本机（host）',
  'net-browser.candidate.kind.srflx': '公网映射（srflx）',
  'net-browser.candidate.kind.prflx': '对端映射（prflx）',
  'net-browser.candidate.kind.relay': '中继（relay）',
  'net-browser.candidate.kind.other': '类型认不出的',
  'net-browser.candidate.count': '{label} {n} 个',
  'net-browser.compress.probe-no-stream': '这台设备的浏览器没有压缩流能力（CompressionStream 缺失）。',
  'net-browser.compress.readable.no-probe': '这台设备的压缩能力探测没有给出结果，邀请码没能生成。请刷新页面再试一次。',
  'net-browser.compress.readable.all-failed': '这台设备的浏览器不支持本程序用到的任何一种压缩方式（{formats}），连"不压缩"那条兜底路也没走通。请换一个较新的浏览器打开本页再试。',
  'net-browser.compress.readable.some-failed': '这台设备编不出邀请码：可用的压缩方式里，{failed} 这一档用不了，而不压缩那条兜底路也没走通（{ok} 虽然探测通过，但没有产出可用的字节）。请刷新页面再试一次；如果一直这样，换一个较新的浏览器打开本页。',
  'net-browser.compress.format.unavailable': '这一档压缩方式（{format}）在这台设备上不可用，改用下一档。',
  'net-browser.compress.no-stream': '这台设备的浏览器没有压缩流能力，邀请码生成不了（对端仍可用"输 6 位码"那条路）。',
  'net-browser.compress.note.no-stream': '压缩流能力缺失（CompressionStream / DecompressionStream 不存在）。',
  'net-browser.compress.format.no-bytes': '这一档压缩方式（{format}）没有产出可用的字节，改用下一档。',
  'net-browser.compress.prefer.used': '按调用方指定的档位（{kind}）产出（不再走降级链）。',
  'net-browser.compress.prefer.unusable': '调用方指定的档位（{kind}）在这台设备上用不了，回退到降级链。',
  'net-browser.compress.fallback.from': '降级链从这里开始可用（前面跳过了 {skipped}）。',
  'net-browser.compress.roundtrip-failed': '压得出但解不回来（{reason}），继续降级。',
  'net-browser.compress.prepare-failed': '邀请码没能生成：这台设备在准备压缩能力时出错了。请刷新页面再试一次；如果一直这样，换一个较新的浏览器打开本页。',
  'net-browser.decompress.format-failed': '这台设备的浏览器解不开这一档压缩（{format}）：{detail}',
  'net-browser.decompress.no-stream': '这台设备的浏览器没有解压流能力，这条邀请码打不开。',
  'net-browser.decompress.empty-segment': '这条邀请码的压缩段是空的。',
  'net-browser.decompress.empty-result': '这条邀请码解压之后没有任何内容。',
  'net-browser.decompress.corrupt': '这条邀请码的压缩段解不开（内容被改动或截断过）。',
  'net-browser.invite.bad-marker-segment': '邀请码的压缩段带了一个本程序不认得的编码标记（"{marker}"）：这不是本程序产出的邀请码。',
  'net-browser.invite.not-base64url': '压缩段不是 base64url，解不出字节。',
  'net-browser.address-bar.no-invite': '地址栏里没有邀请码（这不是错误，只是没有可读的东西）。',
  'net-browser.signal.bad-endpoint': '设置里的信令端点不是一个信令地址：它要以 wss:// 或 ws:// 开头。请到「高级 / 连接设置」里改成对端给你的那个地址。',
  'net-browser.signal.unreachable': '这些信令端点一个都没连上。可以改用邀请码（邀请码这条路不需要信令端点，两端直接把连接描述交给对方；在默认配置下，直连打不通时会经那台默认中继转发），或换一个端点再试。',
  'net-browser.signal.no-capability': '这台设备没有可用的信令连接能力，短码这条路走不了。请改用邀请码。',
  'net-browser.signal.closed': '信令已经关了。',
  'net-browser.signal.not-open': '信令还没连上，这条消息没有发出去。',
  'net-browser.signal.send-failed': '信令发送失败：{detail}',
  'net-browser.ice.no-description': '本侧还没有连接描述可发（`setLocalDescription` 没成功，或实现没把它暴露出来）。',
  'net-browser.ice.no-ticker': '这台设备没有可用的计时能力，所以判不了"ICE 收集等多久算超时"；为了不静默挂住，这一轮不生成邀请码（请重试）。',
  'net-browser.ice.no-connection': '这条连接还不存在（`pc` 还没建）。',
  'net-browser.ice.no-getstats': '这条连接不提供 `getStats()`，读不出走没走中继。',
  'net-browser.ice.stats-failed': '读连接统计失败：{detail}',
  'net-browser.ice.stats-not-iterable': '`getStats()` 没有回一份可遍历的报告。',
  'net-browser.ice.no-nominated-pair': '还没有"被提名且已成功"的候选对（链路还在建立），所以这一刻读不出直连还是经中继。',
  'net-browser.offer.no-set-remote': '这台设备的连接实现不接受"对端描述"（`setRemoteDescription` 缺失），所以产不出 answer。',
  'net-browser.offer.no-create-answer': '这台设备的连接实现不会产 answer（`createAnswer` 缺失），所以这条邀请码答不回去。',
  'net-browser.offer.no-offer-sdp': '这条邀请码里没有可用的连接描述（sdp 是空的）。',
  'net-browser.offer.set-remote-failed': '收不下对端的连接描述：{detail}',
  'net-browser.offer.answer-failed': '本侧没能产出 answer：{detail}',
  'net-browser.offer.set-local-failed': '本侧的 answer 没能落到连接上：{detail}',
  'net-browser.answer.no-set-remote': '这台设备的连接实现不接受"对端描述"（`setRemoteDescription` 缺失）。',
  'net-browser.answer.no-sdp': '这条回示码里没有可用的连接描述（sdp 是空的）。',
  'net-browser.answer.set-remote-failed': '收不下对端的 answer：{detail}',
  'net-browser.transport.peer-online': '对端已连上（这条读数只来自状态事件；init() 的 ok 不代表它）。',
  'net-browser.transport.peer-offline': '与对端的连接断了（这条读数只来自状态事件，不看 init()）。',
  'net-browser.transport.no-peer-connection': '这台设备没有可用的对端连接能力（需要安全上下文），联机这条路走不了。',
  'net-browser.transport.connecting': '正在建立本侧链路（本端 {self}，对端 {peer}）。',
  'net-browser.transport.probe-restored-peer': '探针恢复：对手重建了通道。',
  'net-browser.transport.probe-cut': '探针掐线：数据通道被关掉（这一侧真的发不出去了）。',
  'net-browser.transport.probe-restored': '探针恢复：通道已重建。',
  'net-browser.transport.offer-failed': '本侧连接描述没有建起来：{detail}',
  'net-browser.transport.not-initialized-sdp': '本侧链路还没建立（init 还没成功），现在没有连接描述。',
  'net-browser.transport.no-gather': '本侧没有在等 ICE 收集（这条实现不给连接描述）。',
  'net-browser.transport.closed': '这一局已经结束了，发不出去。',
  'net-browser.transport.not-initialized-send': '本侧链路还没建立（init 还没成功），这条消息没有发出去。',
  'net-browser.transport.no-channel': '通道 {channel} 还没建出来。',
  'net-browser.transport.queue-full': '待发队列积压太多，这一帧先不发了（等它排空再试）。',
  'net-browser.transport.peer-unreachable': '对端不可达，这条消息没有发出去（这是传输层的读数，不是"这局结束了"）。',
  'net-browser.transport.send-failed': '发送失败：{detail}',
  'net-browser.transport.closed-final': '这一局已经结束（closed 不可逆，不能再连）。',

  /* ── ★ 2026-10-02（P3 第七批）：`src/ui/turn-cred.ts` 那 7 条裸中文 ──
   *
   * 值 = 抽取前 `src/ui/turn-cred.ts` 里那些字面量/模板串的**原文**，一个字都没改
   * （`{ms}` 对应原文的 `${String(settings.timeoutMs)}`）。逐字守恒由
   * `.superpowers/i18n-turn-cred/check-verbatim.mjs` 机检（从 `git show HEAD:` 抓原文逐条比对）。
   *
   * 分类口径：`turn-cred.reason.*` 四条是**玩家能看见**的那半句 —— 它们进
   * `net-browser.relay.unavailable-why` 的 `{why}`（英文界面下曾经因此夹中文，见台账 G.3 第 1 条，
   * 本轮已收口）。`turn-cred.detail.*` 两条与 `turn-cred.error.no-fetch` 一条落在这份读数的
   * `detail` 字段上（`lastFailure()` / `#g5probe=1` 的诊断读数），**不是**屏上那句的一半，
   * 但它们同样是这一层自己写的中文 ⇒ 一起搬，不再给"英文界面里夹中文串"留一条缝。
   *
   * ⚠️ `net-browser.relay.unavailable-why` 的中文值这一轮**多了一对全角括号**（值从
   *   `这一轮没有中继可用{why}，…` 变成 `这一轮没有中继可用（{why}），…`）：那对括号原来写死在
   *   `net-browser.ts` 的拼接里（`` `（${describeTurnCredentialFailure(…)}）` ``）。
   *   括号是**这句文案的一部分**，原文就带它们 ⇒ 移进表里之后：
   *   ① 中文渲染结果**逐字不变**（机检：`check-verbatim.mjs` 证据③ 把整句与 HEAD 的渲染结果比）；
   *   ② 英文那半边不再是"英文句子夹全角括号"（英文值用半角括号）。
   */
  'turn-cred.reason.timeout': '凭据服务没有及时回应',
  'turn-cred.reason.rejected': '凭据服务拒绝了这次请求',
  'turn-cred.reason.malformed': '凭据服务回的格式读不懂',
  'turn-cred.reason.unreachable': '凭据服务连不上',
  'turn-cred.detail.timeout': '等了 {ms} 毫秒没有回应',
  'turn-cred.detail.malformed': '回应里缺字段或字段形状不对',
  'turn-cred.error.no-fetch': '这台设备没有 fetch 能力',

  /* ── ★ 2026-10-02（P3 第三批）：首启授权弹窗（`src/ui/local-consent.ts`）的 4 个**界面标签** ──
   *
   * 值 = `src/ui/local-consent.ts` 的 `CONSENT_COPY` 里那 4 个字面量的**原文**，一个字都没改
   * （已抽走，那里现在只剩 `t('consent.*')`）。它们是**界面标签**（标题与三个按钮上的字），
   * 不承诺任何事 ⇒ 与授权正文分开：正文（`body` 三段 / `denyHint`）的唯一出处仍是
   * `src/app/privacy.ts`（被 `tests/app/privacy.test.ts` 的整句哈希钉死），本轮**没有**动它。
   *
   * ⚠️ 三个标签的中文值与 `onboarding.consent.{title,grant,deny,privacy}` 逐字相同
   *   （同一个旧弹窗并进了向导第 2 步），那四条由 `tests/i18n/onboarding.test.ts` 钉住
   *   "中文值逐字等于 `CONSENT_COPY` 的对应字段" —— 两组键**各有各的落点**，别合并。
   */
  'consent.title': '要不要在这台设备上记住你的设置？',
  'consent.grant': '允许，保存在这台设备',
  'consent.deny': '不用，本次不保存',
  'consent.privacy-link': '隐私说明',

  /* ── ★ 2026-10-02（P3 第三批）：`src/ui/render.ts` 的**棋盘 chrome**（台账 G.1 那 8 处） ──
   *
   * 值 = 抽取前 `src/ui/render.ts` 里那些字面量/模板串的原文，**一个字都没改**
   * （含空格与全角括号；`{n}` 那种占位符对应原来的 `${…}` 插值）。
   * 这一族是热座牌桌、教学模式、重放页共用的那一层；`src/ui/render-net.ts` 与它同构，
   * 联机页那几处**没有**复用这批键（它是第二份文案，另有自己的键，见 render-net 的抽取轮）。
   *
   * ⚠️ `玩家 {n}` 这一个键是**热座**的座位号；联机页那条横幅另有 `render-net.*`（不许拿来顶替）。
   */
  'render.player-info.title': '玩家 {n}',
  'render.player-info.operating': '（请操作！）',
  'render.player-info.active': '（回合中）',
  'render.meta.deck': '牌库 {n}',
  'render.meta.trash': '弃牌堆 {n}',
  'render.meta.hand': '手牌 {n}',
  'render.trash.label': '弃牌堆',
  'render.trash.view': '查看弃牌堆',
  'render.deck.gameover-title': '对局结束：查看牌库剩余牌及抽取顺序',
  'render.refresh-hand': '刷新手牌',
  'render.step': '步骤: {step}',
  'render.control.neutral': '控制权: 中立',
  'render.control.player': '控制权: 玩家 {n}',
  // 手牌挡板上的张数（与 `render.meta.hand` **值逐字相同**，但落点不同：一个是信息条、
  // 一个是挡板；两份键都留着是因为它们在屏上是两处，将来要分别改也不至于互相牵连）
  'render.hand-shield.count': '手牌 {n}',
  'render.next-step': '下一步',
  'render.diag.export': '导出日志',
  'render.diag.export-title': '导出诊断日志（错误 + 控制台记录 + 事件日志 + 状态快照）',

  /* ── ★ 2026-10-02（P3 第四批）：`src/ui/render.ts` 的**选择条 / 草稿页 / 遮罩 chrome** ──
   *
   * 值 = 抽取前 `src/ui/render.ts` 里那些字面量/模板串的原文，**一个字都没改**
   * （含空格、全角括号与 `—` / `·` / `→`；`{n}` 那种占位符对应原来的 `${…}` 插值）。
   * 三处**刻意不动**（`t()` 的实参不是文案、只负责匹配，改了会改行为）：
   *   `透彻：从牌库中选择` / `luck-0：宣告` / `luck-3：宣告` —— 它们是引擎给的
   *   `prompt.title` 的**前缀**（`src/core/effects/cards/*.ts` 的中文，属红线数据层）。
   */
  'render.hand.count': '手牌 ×{n}',
  'render.hand.flip': '翻面',
  'render.hand.hint-selected': '已选择卡牌 — 拖拽到高亮的线路打出（可先点「翻面」切换朝向）',
  'render.hand.hint-idle': '拖拽手牌卡到高亮的线路打出（双击放大，点击选择）',
  // 动作行那三个按钮（`advance` 走 `render.next-step`）
  'render.action.compile-line': '编译线 {n}（{a} vs {b}）',
  'render.action.resolve-trigger': '结算触发：{defId}',
  'render.action.clear-cache': '清理缓存',
  // 选择条（`.choice-bar` 那一族）
  'render.choice.operator': '请 {name} 操作',
  'render.choice.title': '{who} 操作 — {title}',
  'render.choice.count': '已选 {n}/{max}',
  'render.choice.pick-count': '已选 {n}/{max}',
  'render.choice.confirm': '确认',
  'render.choice.skip': '跳过',
  'render.choice.hint-line': '点击高亮的线路选择目标线',
  'render.choice.pick-hint': '单击选择 / 再点取消，双击放大查看；选好后点「确认」',
  'render.choice.note-rearrange': '请在「重排协议」窗口中点击两张协议交换位置，摆好后点「完成重排」。',
  // 草稿页 chrome（协议池卡名 / 命令词 / 评分内容是**数据**，一格不动）
  'render.draft.picks-title': '玩家 {n} 已选',
  'render.draft.seat-self': '（你）',
  'render.draft.seat-foe': '（对方）',
  'render.draft.picks-turn': '● 轮选',
  'render.draft.pick-empty': '尚未选择',
  'render.draft.unpick-hint': '拖出选择框可取消本回合选择',
  'render.draft.ban-tip': '点击禁用「{name}」（本局不可选；共需禁用 {n} 个）',
  'render.draft.ban-badge': '禁用',
  'render.draft.group.mn01': '1代 基础',
  'render.draft.group.ax01': '1代 拓展',
  'render.draft.group.mn02': '2代 基础',
  'render.draft.group.ax02': '2代 拓展',
  'render.draft.group.mn03': '3代 基础',
  'render.draft.group.ax03': '3代 拓展',
  'render.draft.gen-1': '1代',
  'render.draft.gen-2': '2代',
  'render.draft.gen-3': '3代',
  'render.draft.verb-pick': '选择协议 · 本轮还可选 {n} 个',
  'render.draft.verb-ban': '禁用协议 · 本阶段还需禁用 {n} 个（共 {total} 个）',
  // 两件**不同**的句子（不是同一个键的两种取值）：普通轮的进度条与禁用阶段的进度条
  'render.draft.progress-pick': '第 {n} / {total} 次选择',
  'render.draft.progress-ban': '第 {n} / {total} 次选择 · 禁用阶段',
  'render.draft.filter-tip': '{name}（本局池内 {n} 套）· {action}',
  'render.draft.filter-hide': '点击隐藏',
  'render.draft.filter-show': '点击显示',
  'render.draft.random-pool-note': '本局协议池是从全部 {total} 套里限定的 {n} 套（随机池模式 = 随机抽取，自定义协议池模式 = 你自己挑的那几套；世代筛选仍可用）',
  'render.draft.ban-mode-note': '禁用模式：后手先禁 2 → 先手选 1 禁 1 → 后手选 2 禁 1 → 先手选 2 禁 2 → 后手选 1',
  'render.draft.filter-hint': '当前可见协议 {n} 套，还需完成 {left} 次选/禁动作——请重新开启被隐藏的世代组。',
  'render.preview.position': '定位：{position}',
  'render.preview.commands': '关键词：{commands}',
  'render.preview.pairs-label': '推荐搭配协议',
  'render.preview.styles-label': '推荐流派',
  'render.preview.hint': '点击中间协议卡\n在此固定查看详情',
  // 胜负结算与遮罩（热座 / 联机 / 重放共用）
  'render.win.title': '玩家 {n} 获胜！',
  'render.win.sub': '本局结束 · 可继续查看场上布局复盘',
  'render.win.back': '返回主界面',
  'render.zoom.motto-label': '座右铭：',
  'render.zoom.keywords-label': '关键词：',
  'render.zoom.compiled': '已编译',
  'render.zoom.uncompiled': '未编译',
  'render.zoom.view-back': '查看背面',
  'render.zoom.view-front': '查看正面',
  'render.trash-viewer.title': '玩家 {n} 的弃牌堆',
  'render.trash-viewer.empty': '弃牌堆为空',
  'render.deck-order.title': '玩家 {n} 的牌库（对局结束 · 自上而下 = 抽取顺序）',
  'render.deck-order.empty': '牌库为空',
  'render.deck-order.next': '下一张',
  'render.deck-order.after': '{n} 张后',

  /* ── ★ 2026-10-02（P3 第四批）：`src/ui/render-net.ts`（联机牌桌）本页特有的界面文案 ──
   *
   * 值 = 抽取前 `src/ui/render-net.ts` 里那些字面量/模板串的原文，**一个字都没改**。
   * 与热座同句的那几处**复用** `render.*`（`render.choice.{title,count,confirm,skip,
   * hint-line,note-rearrange}` / `render.action.{resolve-trigger,clear-cache}` /
   * `render.next-step` / `render.diag.{export,export-title}`）—— 值逐字相同，不另开键。
   * ⚠️ `render-net.action.compile-line` **与** `render.action.compile-line` **值不同**：
   *   热座那句带 `（己方值 vs 对方值）`，本页那句没有 ⇒ 两条键（不许拿来互相顶替）。
   * ⚠️ `render-net.choice.operator` 的值里 `请` 与 `玩家` 之间**有一个空格**（原文如此）。
   */
  'render-net.conn.local-preview': '● 本地预览（未联机）',
  'render-net.lane.name': '线 {n}',
  'render-net.choice.operator': '请 玩家 {n} 操作',
  'render-net.info.seat-self': '自己（你）',
  'render-net.info.seat-foe': '对手',
  'render-net.action.compile-line': '编译线 {n}',
  'render-net.hand.hint-selected': '已选牌 → 点高亮链路槽打出',
  'render-net.hand.hint-idle': '点选手牌 → 点链路槽打出（双击放大）',
  'render-net.hand.foe-count': '对手手牌 ×{n}',
  'render-net.zoom.foe-hand-title': '对手手牌',
  'render-net.zoom.foe-hand-unknown': '对手手牌（内容未公开）',
  'render-net.zoom.foe-hand-count': '对手手牌 ×{n}（内容未公开）',
  'render-net.zoom.unknown': '未公开',
  'render-net.zoom.back-note': '未公开：这张牌背面朝上（内容在对手翻开前不可见）',
  'render-net.zoom.compiled-suffix': '（已编译）',
  'render-net.zoom.box-title': '卡牌放大框',
  'render-net.zoom.box-hint': '把鼠标移到卡牌 / 协议上：此处实时放大并显示中文文本；单击固定',
  'render-net.preview.title': '预览工具条',
  'render-net.preview.seat-1': '视角：我 = P1 ⇄ P2',
  'render-net.preview.seat-2': '视角：我 = P2 ⇄ P1',
  'render-net.preview.seat-tip': '切换到对方视角：切过去后"自己"就是对手（手牌正面且可点），这是推进对手回合、把一局打完的正确做法（对手手牌只手牌数量那一档是不可点的）。',
  'render-net.preview.hint-answer': '轮到对手（P{n}）应答 —— 本页只显示信息、不显示按钮；切「视角」后可操作',
  'render-net.preview.hint-act': '轮到对手（P{n}）行动 —— 本页只显示信息、不显示按钮；切「视角」后可操作',
  'render-net.preview.note': '已切视角：我 = P{n}',

  /* ── ★ 2026-10-02（P3 第八批）：src/app/archive-io.ts 的档案导入失败原因 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'archive-io.empty': '档案文件是空的',
  'archive-io.too-large': '档案过大（{bytes} 字节 > 上限 {limit} 字节）：本程序不会读取它',
  'archive-io.bad-created-at': '档案的 createdAt 不是合法 ISO 时刻（{createdAt}）：导出的文件名会退化成含 "{stamp}" 的可预期形式。这不影响重放，档案仍会打开。',

  /* ── ★ 2026-10-02（P3 第八批）：src/app/match-file.ts 的档案解析失败原因 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'match-file.bad-action.not-object': '第 {i} 条操作不是对象',
  'match-file.bad-action.seq-not-integer': '第 {i} 条操作的 seq 不是非负整数',
  'match-file.bad-action.seq-mismatch': '第 {i} 条操作的 seq={seq} 与位置不符（§3.1 要求从 0 起单调递增且连续）',
  'match-file.bad-action.bad-player': '第 {i} 条操作的 player 不是 0/1',
  'match-file.bad-action.unknown-kind': '第 {i} 条操作的 kind 未知：{kind}',
  'match-file.bad-action.unknown-via': '第 {i} 条操作的 via 未知：{via}',
  'match-file.bad-action.unexpected-args': '第 {i} 条 {kind} 不该带 args',
  'match-file.bad-action.missing-args': '第 {i} 条 {kind} 缺 args',
  'match-file.bad-action.missing-arg-key': '第 {i} 条 {kind} 的 args 缺 {k}',
  'match-file.bad-shape.setup-not-object': 'setup 不是对象',
  'match-file.bad-shape.draft-mode': 'setup.draftMode 非法',
  'match-file.bad-shape.draft-starter': 'setup.draftStarter 非法',
  'match-file.bad-shape.first-to-play': 'setup.firstToPlay 非法',
  'match-file.bad-shape.draft-pool': 'setup.draftPool 非法',
  'match-file.bad-shape.draft-picks': 'setup.draftPicks 非法',
  'match-file.bad-shape.banned-protocols': 'setup.bannedProtocols 非法',
  'match-file.bad-shape.clock': 'setup.clock 非法',
  'match-file.bad-shape.clock-field': 'setup.clock.{k} 非法（必须是有限数字）',
  'match-file.bad-shape.result-not-object': 'result 不是对象',
  'match-file.bad-shape.result-winner': 'result.winner 非法：{winner}（必须是 0 / 1 / null）',
  'match-file.bad-shape.result-reason': 'result.reason 非法：{reason}',
  'match-file.bad-shape.players-not-pair': 'players 必须是长度 2 的数组',
  'match-file.bad-shape.player-nick': 'players[{i}].nick 非法',
  'match-file.bad-version.unknown': '档案 version 非法：{version}',
  'match-file.too-new': '档案来自更新版本的游戏（档案 v{v}，当前支持 v{currentVersion}）。请更新游戏，本程序不会猜测如何读取它。',
  'match-file.missing-migration': '缺少 v{v} → v{next} 的迁移步骤',
  'match-file.not-json': '档案不是合法 JSON（文件可能已损坏）',
  'match-file.not-object': '档案顶层不是对象',
  'match-file.bad-format': '不是 Compile 对局档案（format={format}）',
  'match-file.bad-seed': 'seed 非法（必须是非空字符串：重放全靠它）',
  'match-file.bad-card-data-hash': 'cardDataHash 非法',
  'match-file.bad-actions': 'actions 不是数组',
  'match-file.card-data-mismatch': '卡牌数据与本机不同（档案 {archiveHash}，本机 {currentHash}）：同一串操作可能得到不同结果。可以继续打开，但联机时会被拒绝。',
  'match-file.unknown-protocol': '档案里的协议 defId 在本机不存在：{defId}（卡牌数据版本不一致？）',

  /* ── ★ 2026-10-02（P3 第八批）：src/main.ts 的联机交接提示（client.showNotice 一族 + lobbyLinkFailureText） ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'main.notice.resync-fork': '追平失败：本端已经走到第 {local} 步，而对方的档案只有 {n} 步 —— 这说明两端各自走过不同的操作（分叉）。本端状态一个字都没动：覆盖它只会把分叉藏起来，而这一局已经不可能与对方一致了，请结束这一局并如实记录。',
  'main.notice.resync-replay-failed': '追平失败：用对方的档案重放不出状态（{detail}）；本端状态没动。',
  'main.notice.link-dead-before-start': '连接断了，这一局还没开始：请重新生成邀请码 / 重新加入。（这一次断线没有可续的对局进度 —— 不是"接上了"，也不是"续上了"。）',
  'main.lobby-link.no-peer-conn-answer': '本机还没有建起用来传消息的那条对端连接（先让链路起来再产回示码）。',
  'main.lobby-link.no-peer-conn-apply': '本机还没有建起对端连接（先「建房」生成邀请码，再把回示码粘回来）。',
  'main.lobby-link.cause-with-init': '{message} 失败原因：{initMessage}',
  'main.lobby-link.state-idle': '（传输此刻的状态是 idle：它连本侧连接都还没造出来，也就是 init() 没有成功。）',
  'main.lobby-link.state-other': '（传输此刻的状态是 {status}：本侧连接已经造出来了，但连接描述这一刻还取不到。）',
  'main.lobby-link.next-step': '{cause}{state}下一步：再点一次「生成邀请码」重试；重试仍然失败时，请把这一整行连同"失败原因"里那句话记下来（它就是这个问题的真因，不是猜测）。',
  'main.notice.link-building-invite': '正在建立链路…（好了会自动接着生成邀请码，不用再点）',
  'main.lobby-link.wait-timeout-invite': '等了 {seconds} 秒，本侧链路还没有建立起来（init 至今没有成功，所以没有连接描述可给）。',
  'main.lobby-link.init-returned': 'init 返回 {reason}：{initMessage}',
  'main.notice.link-building-prefix': '正在建立链路',
  'main.notice.no-local-description-invite': '这条实现不给连接描述（没有 `localDescription`），所以生成不了邀请码。',
  'main.lobby-link.no-usable-description': '本侧没有可用的连接描述，生成不了邀请码。',
  'main.notice.invite-threw': '生成邀请码这一步抛了一个错误，没有生成出邀请码：{detail}',
  'main.notice.link-building-answer': '正在建立链路…（好了会自动接着出示回示码，不用再点）',
  'main.lobby-link.wait-timeout-answer': '等了 {seconds} 秒，本侧链路还没有建立起来（init 至今没有成功，所以产不了回示码）。',
  'main.notice.replay-stopped': '重放已停在这一步：档案里的下一条没有被接受（重放状态与档案不同步）。',
  'main.notice.no-match-record': '本次会话还没有对局记录：先打完一局再来导出。',
  'main.rearrange.commit-label': '完成重排',
  'main.rearrange.skip-label': '跳过',

  /* ── ★ 2026-10-02（P3 第八批）：src/ui/control-rearrange.ts（控制权重排浮层）的界面文案 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'control-rearrange.hint.draft': '点击两张协议交换位置（可多次）；摆好后点「完成重排」一次性生效（未改动则按钮不可用）。',
  'control-rearrange.hint.locked': '已锁定重排【玩家 {side}】的协议：先点一张、再点另一张即交换，可多次交换；另一名玩家的协议不再可操作。',
  'control-rearrange.hint.pick': '点击要重排的玩家协议（先点一张、再点另一张即交换）；完成第 1 次交换后锁定该玩家，不可换侧。',
  'control-rearrange.player-1': '玩家 1',
  'control-rearrange.player-2': '玩家 2',
  'control-rearrange.line-tag': '线 {line}',
  'control-rearrange.compiled-tag': '已编译',
  'control-rearrange.moved-tag': '原线 {line}',

  /* ── ★ 2026-10-02（P3 第八批）：src/net/session.ts 的拒绝原因（refusal.message / verdict.message / SendResult.message） ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'session.hash.bad': 'session.ts 的哈希注入（HashLike）没有返回可用的哈希串：收到 {got}。本模块不做异步（D15）：要同步用就注入一个同步实现；异步封装（真实实现住 src/ui/net-browser.ts，T7）算出来的是一个 Promise，不算哈希串。',
  'session.caller.not-non-empty-string': 'session.ts 的 {what} 必须是非空字符串（收到 {v}）；这是调用方违约，不是网络输入。',
  'session.resync.not-wired': '收到了 resync-req，但本端这一侧没有可发的档案（调用方没有接上"当前档案"的来源，或来源此刻是空的），所以发不出 resync-res。这不是"追平已完成"——请检查接线时是否把当前档案的读取口喂给了本会话（房主持有重连凭据，加入方不持有）。',
  'session.refuse.duplicate-reveal-seed': '{side}已经见过一次 reveal-seed 了，不重复接受：同一条承诺只揭示一次种子。对端若没收到，请让它重发 commit-ack，而不是再揭示一遍。',
  'session.refuse.reveal-seed-after-complete': '这局已经走完承诺流程（种子与盐都揭示过），此时再来一条 reveal-seed 只可能是对端把流程重放了一遍；拒绝。',
  'session.refuse.bad-salt': '收到的 reveal-salt 没有可用的 salt（空串 / 缺失 / 不是字符串）；拒绝。',
  'session.refuse.early-salt': '当前相位是 {phase}，此时收到 reveal-salt：盐是**对局结束后、由房主**揭示的，本方还没有揭示过种子（或握手都还没完成），所以这条消息只可能是对端搞错了方向或提前重放；拒绝，且不改变任何状态。',
  'session.refuse.salt-before-face': '当前相位是 {phase}，还不能揭示盐：盐要在**收到对端的 reveal-face 之后**才发（那时这一局才算"结束"，设计稿 §5.3 最后一步）。先发盐会把相位推到 `complete`，而那时 `reveal-face` 已经进不来了 —— 房主会永远拿不到对端选的面，所以本端不接受那种顺序。',
  'session.refuse.non-object-message': '非对象的消息',
  'session.refuse.missing-t': '没有 t 字段的消息',
  'session.internal.bad-outbound-shape': '{detail}（形状不合法，本端不向外发包）',
  'session.hello.already-refused': '这次握手已经被本端回绝过了',
  'session.hello.already-established': '握手已经成功过（这一局已经在承诺流程里）',
  'session.refuse.guard-ignored': '{what}：{why}，当前相位是 {phase} —— 本端**忽略**它，会话状态一点都没动。',
  'session.hello.already-done': '已经完成的步骤不会因为你重发握手就退回去；若确实要开新的一局，请换一个新的 sessionId 重新握手。',
  'session.hello.too-late': '这条 hello 来得太晚，被忽略（会话未改动）。',
  'session.hello.direction-reversed': '收到了一条 {what}：hello 只能由**加入方**发给房主，本端是加入方，这条消息方向反了，本端忽略它且不改动任何状态（本端要等的是 hello-ack）。',
  'session.hello.direction-reversed-detail': 'hello 的方向反了（本端是加入方），已忽略。',
  'session.hello.duplicate': '重复/迟到的 hello',
  'session.hello-resume.bad-handshake': '一条重连握手（hello.resuming === true）没通过握手校验',
  'session.hello-resume.bad-handshake-why': '校验给出的原因是：{message}',
  'session.hello-resume.claims-spectator': '一条重连握手（hello.resuming === true）自称观战',
  'session.hello-resume.waiting-for-resync': '对端带着同一个 sessionId 回来握手（hello.resuming === true）：本端保留当前对局，等它请求追平（resync-req）；这一局在追平完成之前不再推进。',
  'session.hello-ack.direction-reversed': 'hello-ack 只能由房主发出、由加入方接收；本端是房主，收到的方向反了。',
  'session.hello-ack.bad-shape': '收到的 hello-ack 形状不对（缺 sessionId / peerNick / seat）；拒绝，状态不动。',
  'session.hello-ack.bad-proto-version': '收到的 hello-ack 里 protoVersion 不是数字；拒绝，状态不动。',
  'session.hello-ack.version-mismatch': '游戏版本不一致，请双方都更新到最新版（对端协议 v{theirVersion}，本机 v{localVersion}）。',
  'session.hello-ack.not-ours': '收到的 hello-ack 属于另一局（对端回的 sessionId 是 {sessionId}，本端这一局是 {theirSession}）；拒绝，状态不动。',
  'session.hello-ack.duplicate': '当前相位是 {phase}，不接受第二条 hello-ack。',
  'session.commit.not-yet': '当前相位是 {phase}，还不能发 commit：承诺要先于整个承诺流程（设计稿 §5.3 第 2 步），而它只在握手成功之后才谈得上。',
  'session.commit.bad-hash': '收到的 commit-face 没有可用的 hash（空串 / 缺失 / 不是字符串）；承诺不成立，拒绝。',
  'session.refuse.commit-face-wrong-phase': '当前相位是 {phase}，此时收到 commit-face：',
  'session.refuse.handshake-incomplete': '握手还没完成。',
  'session.refuse.commit-already-received': '这条承诺已经收到过了。',
  'session.internal.phase-without-seed': 'session.ts 内部不一致：相位已经是 face-committed 但还没有种子（sendCommit 没设上？）。',
  'session.side.host': '房主',
  'session.reveal-face.bad-face': '收到的 reveal-face 的 face 不是 0/1；拒绝。',
  'session.reveal-face.bad-nonce': '收到的 reveal-face 没有可用的 faceNonce（空串 / 缺失）；拒绝。',
  'session.refuse.reveal-face-wrong-phase': '当前相位是 {phase}，此时收到 reveal-face（承诺流程的次序不对）；拒绝。',
  'session.internal.phase-without-commit': 'session.ts 内部不一致：相位到了 seed-revealed 却没有加入方的承诺哈希。',
  'session.reveal-face.hash-mismatch': '加入方揭示的 face 与它此前的承诺对不上：收到的 hash(face, faceNonce) 与 commit-face 里的 hash 不同。这说明它现在给出的面不是承诺时定下的那一个；请结束这一局并如实记录。',
  'session.internal.salt-without-commit': 'session.ts 内部不一致：还没发过 commit 就要揭示盐（sendCommit 没设上？）。',
  'session.salt.already-revealed': '这条 reveal-salt 已经发过一次了，不重复发：同一条承诺只揭示一次盐。',
  'session.commit.no-hash': '收到的 commit 没有可用的 hash（空串 / 缺失 / 不是字符串）；拒绝。',
  'session.refuse.commit-wrong-phase': '当前相位是 {phase}，此时不接受 commit（要么握手还没完成，要么这条是重复的）。',
  'session.commit-ack.not-yet': '当前相位是 {phase}，还不能回 commit-ack：先收到房主的 commit 再确认（设计稿 §5.3 第 3 步）。',
  'session.caller.face-out-of-range': 'session.ts 的 commitFace 收到越界的 face {face}（契约是 0 | 1）；这是调用方违约。',
  'session.reveal-face.not-yet': '当前相位是 {phase}，还不能提交 commit-face：',
  'session.reveal-face.await-host-commit': '先收到房主的 commit（否则面的承诺会早于种子承诺）。',
  'session.reveal-face.already-submitted': '这条承诺已经提交过了。',
  'session.reveal-seed.bad-seed': '收到的 reveal-seed 没有可用的 seed（空串 / 缺失 / 不是字符串）；拒绝。',
  'session.side.guest': '加入方',
  'session.internal.face-without-commit': 'session.ts 内部不一致：还没提交 commit-face 就要揭示面。',
  'session.reveal-face.await-seed': '当前相位是 {phase}，还不能揭示面：先收到房主的 reveal-seed（设计稿 §5.3 第 4 步）。',
  'session.internal.verify-salt-too-early': 'session.ts 内部不一致：还没拿到种子/承诺就要验盐（收盐守卫被放宽了？）。',
  'session.salt.hash-mismatch': '房主揭示的 salt 与它此前的承诺对不上：收到的 hash(seed, salt) 与 commit 里的 hash 不同。这说明现在这一对 (seed, salt) 不是承诺时定下的那一对；请如实记录，不要把它当成一次正常的开局。',
  'session.resync.cannot-mark': '当前相位是 {phase}，不能把它标成重连：这一局已经在承诺流程里，"变成重连"只对还没握完手的加入方有意义。',
  'session.resync.marked': '本端显式声明这是一次重连（markResuming）：等房主的 hello-ack，然后发 resync-req 要档案。在 applyResyncFile 成功之前，本端的引擎状态还没有追平。',
  'session.resync.req-not-object': '收到的 resync-req 不是对象；拒绝，且不改变任何状态。',
  'session.resync.req-not-ours': '收到的 resync-req 不属于本局（它报的 sessionId 是 {sessionId}，本局是 {theirSession}）；拒绝，且不回任何档案。',
  'session.resync.bad-applied-steps': '收到的 resync-req 里 appliedSteps 不是非负整数（协议形状在解码那一层已经挡过一次，这里是直接喂进 accept 的那条路上的第二道）；拒绝，且不回任何档案。',
  'session.resync.already-rejected': '本会话的这一局已经被回绝（相位 rejected），不再接受重连请求，也不回档案。',
  'session.resync.bad-local-file': '本端手里的档案形状不可用（缺 setup / actions / players / 指纹那几个字段），发不出 resync-res；请检查档案来源给的是不是一份 MatchFile。',
  'session.resync.res-bad-shape': '收到的 resync-res 形状不对（缺 file，或 file 不是对象）；拒绝，状态不动。',
  'session.resync.res-not-awaited': '当前相位是 {phase}，而本端**没有在等追平**（needsResync === false）：一份不在等档案的会话收到 resync-res，只可能是对端搞错了对象或在重放；拒绝，状态不动。',
  'session.resync.apply-wrong-phase': '当前相位是 {phase}，此时不能应用档案：追平必须先在 acceptResyncRes 里收下 resync-res（那一步问的是"本端在不在等档案"，这一步问的是"档案对不对得上"）。',
  'session.resync.apply-bad-shape': '要应用的档案形状不可用（缺 setup / actions / players / 指纹那几个字段）；拒绝，且相位与 needsResync 都不动。',
  'session.resync.step-count-mismatch': '调用方自报已追平到第 {statesAtStep} 步，而这份档案有 {count} 条操作：两者必须**恰好**相等。少一步或多一步都拒绝（`stateAtStep` 对越界是抛错不夹紧，夹紧会把"对端比我多走了几步"静默变成一个看起来同步的状态）；本端状态一点没动。',
  'session.device-direction-mismatch': '{what} 的发送方向与本端角色（{role}）不符；拒绝。',
  'session.refuse.bogus-inbound': 'session.ts 不认得的入站消息 {what}。',
  'session.refuse.seed-before-face': '拒绝了过早到达的 reveal-seed：加入方还没有提交正/反的承诺（commit-face）。硬币结果是种子的纯函数，先拿到种子的一方可以先算出结果、再挑对自己有利的那一面，所以选面必须先于种子公开（设计稿 §5.3）。这一局请让对端先发 commit-face；本程序不会替它补一个承诺。',
  'session.refuse.spectator-unsupported': '这个版本（G5）还不支持观战：观战席还没造出来，不是坐满了。两张牌桌只留给两位玩家，请让对方以玩家身份重发握手；观战会在后续版本里单独做。',
  'session.refuse.spectator-unsupported-detail': 'G5 不支持观战（注意：这不是"观战席已满"）：本版本只有两张玩家位，观战要等后续版本。',
  'session.hash.empty-string': '空字符串',

  /* ── ★ 2026-10-02（P3 第八批）：src/ui/archive-fs-browser.ts 的导入/导出失败原因 ──
   * 值 = 抽取前的源码字面量原文，一个字都没改（逐字守恒由 check-verbatim 机检）。
   */
  'archive-fs-browser.error.unknown': '未知错误（宿主没有给出描述）',
  'archive-fs-browser.error.undescribable': '宿主抛出了一个无法描述的对象',
  'archive-fs-browser.archive-description': 'Compile 对局档案',
  'archive-fs-browser.pick.not-an-object': '宿主没有给出文件对象（拿到的不是对象）',
  'archive-fs-browser.pick.no-text-method': '选中的文件对象没有可调用的 text()：本程序无法读取它',
  'archive-fs-browser.pick.empty-dialog': '用户没有选择文件（对话框返回了空列表）',
  'archive-fs-browser.unsupported.import': '这台设备的浏览器不支持导入档案（没有 showOpenFilePicker，也没有可用的 document）',
  'archive-fs-browser.input.create-failed': '无法创建文件选择框：{detail}',
  'archive-fs-browser.input.read-result-failed': '读取选择结果失败：{detail}',
  'archive-fs-browser.pick.none': '用户没有选择文件',
  'archive-fs-browser.pick.cancelled': '用户取消了导入',
  'archive-fs-browser.fsa.open-failed': '无法打开文件选择框：{detail}',
  'archive-fs-browser.input.timeout': '等待用户选择超过 {ms} 毫秒，按取消处理',
  'archive-fs-browser.input.prepare-failed': '无法准备文件选择环境：{detail}',
  'archive-fs-browser.pick.selection-cancelled': '用户取消了选择',
  'archive-fs-browser.input.no-description': '（输入框那条路没有给出描述）',
  'archive-fs-browser.select.both-failed': '文件系统选择失败：{fsaDetail}；文件选择框也失败：{inputDetail}',
  'archive-fs-browser.select.threw': '选择档案失败：{detail}',
  'archive-fs-browser.save.prepare-failed': '无法准备保存环境：{detail}',
  'archive-fs-browser.save.cancelled': '用户取消了保存',
  'archive-fs-browser.save.fsa-and-download-failed': '文件系统写入失败：{fsaDetail}；下载降级也失败：{detail}',
  'archive-fs-browser.save.download-failed': '下载降级失败：{detail}',
  'archive-fs-browser.save.fsa-failed': '文件系统写入失败：{fsaDetail}',
  'archive-fs-browser.unsupported.save': '这台设备的浏览器不支持保存文件（没有 showSaveFilePicker，也没有可用的 document/URL）',
  'archive-fs-browser.save.failed': '保存失败：{detail}',
  /* ───────── 引擎 `prompt.title` 的显示层替换（P5；见 src/i18n/engine-prompt.ts 的头注） ─────────
   * 值是**引擎原文剥掉 `<defId>（标记）` 前缀之后的余项**（`{x}` 是运行期参数）。
   * 只在**英文模式**下被读（中文模式直接回引擎原文）⇒ 这里改一个字都不会影响中文界面。
   * 本段由 `.superpowers/engine-prompt/emit.mjs --write` 生成。 */
  /* ENGINE-PROMPT-BEGIN */
  // 弃1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p001': '弃1张牌',
  // 你弃置1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p002': '你弃置1张牌',
  // 偏转到哪条链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p003': '偏转到哪条链路',
  // 翻转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p004': '翻转1张牌',
  // 对手弃{n}张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p005': '对手弃{n}张牌',
  // 对手弃1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p006': '对手弃1张牌',
  // 反面打出到任意线（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p007': '反面打出到任意线',
  // 偏转目标线（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p008': '偏转目标线',
  // 删除1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p009': '删除1张牌',
  // 对手弃置1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p010': '对手弃置1张牌',
  // 翻转另1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p011': '翻转另1张牌',
  // 你可以弃1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p012': '你可以弃1张牌',
  // 弃置1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p013': '弃置1张牌',
  // 选择目标列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p014': '选择目标列',
  // 把该牌偏转进此列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p015': '把该牌偏转进此列',
  // 此牌被覆盖，你可以偏转它（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p016': '此牌被覆盖，你可以偏转它',
  // 对手弃2张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p017': '对手弃2张牌',
  // 对手在此链路反面打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p018': '对手在此链路反面打出1张牌',
  // 翻转1张你的反面朝下的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p019': '翻转1张你的反面朝下的牌',
  // 回手1张其他牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p020': '回手1张其他牌',
  // 你可以翻转此牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p021': '你可以翻转此牌',
  // 你可以将弃牌堆洗入牌库（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p022': '你可以将弃牌堆洗入牌库',
  // 你可以偏转此牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p023': '你可以偏转此牌',
  // 你可以弃置1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p024': '你可以弃置1张牌',
  // 弃1张或更多张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p025': '弃1张或更多张牌',
  // 若你这么做，翻转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p026': '若你这么做，翻转1张牌',
  // 选择要交换的第2个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p027': '选择要交换的第2个位置',
  // 在链路 {n} 反面打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p028': '在链路 {n} 反面打出1张牌',
  // 正面打出（须匹配协议线）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p029': '正面打出（须匹配协议线）',
  // {verb}：{who} 持有控制组件（已归还中立）——可重排一名玩家的协议（无 <defId> 前缀的整标题）
  'engine.prompt.p030': '{verb}：{who} 持有控制组件（已归还中立）——可重排一名玩家的协议',
  // {verb}：选择要交换的第2个位置（无 <defId> 前缀的整标题）
  'engine.prompt.p031': '{verb}：选择要交换的第2个位置',
  // {verb}：重排玩家{who}的协议——选择要交换的第1个位置（无 <defId> 前缀的整标题）
  'engine.prompt.p032': '{verb}：重排玩家{who}的协议——选择要交换的第1个位置',
  // 把1张反面牌偏转进此列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p033': '把1张反面牌偏转进此列',
  // 把1张牌偏转进或偏转出此列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p034': '把1张牌偏转进或偏转出此列',
  // 把覆盖者偏转到哪条链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p035': '把覆盖者偏转到哪条链路',
  // 把该牌偏转出此列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p036': '把该牌偏转出此列',
  // 此牌被反面牌覆盖——你可以偏转那张牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p037': '此牌被反面牌覆盖——你可以偏转那张牌',
  // 此牌将被覆盖——先翻转1张正面朝上的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p038': '此牌将被覆盖——先翻转1张正面朝上的牌',
  // 从弃牌堆打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p039': '从弃牌堆打出1张牌',
  // 打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p040': '打出1张牌',
  // 打出朝向（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p041': '打出朝向',
  // 第2个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p042': '第2个位置',
  // 对手抽牌，你可以删除1张卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p043': '对手抽牌，你可以删除1张卡牌',
  // 对手打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p044': '对手打出1张牌',
  // 对手弃牌，你可以反面打出1张卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p045': '对手弃牌，你可以反面打出1张卡牌',
  // 对手删除1张对手的反面牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p046': '对手删除1张对手的反面牌',
  // 对手刷新——你弃置任意数目的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p047': '对手刷新——你弃置任意数目的卡牌',
  // 对手选择抽1张牌或打出1张牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p048': '对手选择抽1张牌或打出1张牌',
  // 对手已编译的协议更多——翻转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p049': '对手已编译的协议更多——翻转1张牌',
  // 对手拥有控制权——你可以翻转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p050': '对手拥有控制权——你可以翻转1张牌',
  // 对手在此链路出牌后，他要弃置1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p051': '对手在此链路出牌后，他要弃置1张牌',
  // 翻转1张被覆盖的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p052': '翻转1张被覆盖的卡牌',
  // 翻转1张此链路中正面朝上的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p053': '翻转1张此链路中正面朝上的卡牌',
  // 翻转1张对手的正面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p054': '翻转1张对手的正面牌',
  // 翻转1张你被覆盖的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p055': '翻转1张你被覆盖的牌',
  // 翻转1张你对手的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p056': '翻转1张你对手的牌',
  // 翻转1张阈值大于你手牌数({n})的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p057': '翻转1张阈值大于你手牌数({n})的卡牌',
  // 翻转1张阈值小于{n}的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p058': '翻转1张阈值小于{n}的卡牌',
  // 翻转1张阈值小于此链路牌数的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p059': '翻转1张阈值小于此链路牌数的牌',
  // 翻转1张正面朝上的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p060': '翻转1张正面朝上的牌',
  // 翻转对手1张正面朝上的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p061': '翻转对手1张正面朝上的牌',
  // 翻转对手阈值最高的被覆盖的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p062': '翻转对手阈值最高的被覆盖的牌',
  // 翻转或偏转你的1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p063': '翻转或偏转你的1张牌',
  // 翻转另1条链路中的牌——选择链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p064': '翻转另1条链路中的牌——选择链路',
  // 翻转你的1张卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p065': '翻转你的1张卡牌',
  // 翻转你的1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p066': '翻转你的1张牌',
  // 翻转这张被覆盖的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p067': '翻转这张被覆盖的卡牌',
  // 翻转这张正面朝上的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p068': '翻转这张正面朝上的牌',
  // 反面打出1张卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p069': '反面打出1张卡牌',
  // 反面打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p070': '反面打出1张牌',
  // 反面打出到哪条链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p071': '反面打出到哪条链路',
  // 反面打出牌库顶到任意线（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p072': '反面打出牌库顶到任意线',
  // 复制对手1张牌的中央效果（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p073': '复制对手1张牌的中央效果',
  // 覆盖着新星牌——你可以重排你的协议（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p074': '覆盖着新星牌——你可以重排你的协议',
  // 回手1张你的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p075': '回手1张你的牌',
  // 回手1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p076': '回手1张牌',
  // 回手或偏转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p077': '回手或偏转1张牌',
  // 回手这张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p078': '回手这张牌',
  // 将对手的1张正面朝下的卡牌加入手牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p079': '将对手的1张正面朝下的卡牌加入手牌',
  // 将牌库顶的牌反面打在对手的哪一侧（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p080': '将牌库顶的牌反面打在对手的哪一侧',
  // 将其正面朝下打出到其它链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p081': '将其正面朝下打出到其它链路',
  // 将随机揭示的那张牌反面打出在对手的哪一侧（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p082': '将随机揭示的那张牌反面打出在对手的哪一侧',
  // 交换你的2个协议——第1个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p083': '交换你的2个协议——第1个位置',
  // 交换协议位置——选择第1个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p084': '交换协议位置——选择第1个位置',
  // 揭示1张反面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p085': '揭示1张反面牌',
  // 揭示1张你的手牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p086': '揭示1张你的手牌',
  // 揭示1张阈值={n}的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p087': '揭示1张阈值={n}的牌',
  // 控制权持有者（P{n}）选择要交换的第1个协议位（新星方）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p088': '控制权持有者（P{n}）选择要交换的第1个协议位（新星方）',
  // 命中！删除1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p089': '命中！删除1张牌',
  // 你把1张手牌给对手（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p090': '你把1张手牌给对手',
  // 你可以把1张手牌给对手（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p091': '你可以把1张手牌给对手',
  // 你可以抽1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p092': '你可以抽1张牌',
  // 你可以抽2张牌（若这么做翻转此牌）（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p093': '你可以抽2张牌（若这么做翻转此牌）',
  // 你可以打出这张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p094': '你可以打出这张牌',
  // 你可以打入1张非多元协议的卡牌到此链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p095': '你可以打入1张非多元协议的卡牌到此链路',
  // 你可以翻转1张被覆盖的正面朝上的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p096': '你可以翻转1张被覆盖的正面朝上的卡牌',
  // 你可以翻转1张此列的反面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p097': '你可以翻转1张此列的反面牌',
  // 你可以翻转1张反面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p098': '你可以翻转1张反面牌',
  // 你可以翻转1张你的被盖住的正面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p099': '你可以翻转1张你的被盖住的正面牌',
  // 你可以翻转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p100': '你可以翻转1张牌',
  // 你可以翻转1张正面朝上的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p101': '你可以翻转1张正面朝上的卡牌',
  // 你可以回手1张对手的牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p102': '你可以回手1张对手的牌',
  // 你可以回手1张你的牌（含此牌自身）（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p103': '你可以回手1张你的牌（含此牌自身）',
  // 你可以将对手1张被覆盖的牌偏转到此链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p104': '你可以将对手1张被覆盖的牌偏转到此链路',
  // 你可以将手牌中的1张牌放回牌库底端（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p105': '你可以将手牌中的1张牌放回牌库底端',
  // 你可以偏转1张你的牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p106': '你可以偏转1张你的牌',
  // 你可以偏转此牌到另一列（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p107': '你可以偏转此牌到另一列',
  // 你可以偏转此牌进入对手总阈值最大的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p108': '你可以偏转此牌进入对手总阈值最大的链路',
  // 你可以偏转或翻转那张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p109': '你可以偏转或翻转那张牌',
  // 你可以偏转那张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p110': '你可以偏转那张牌',
  // 你可以偏转这张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p111': '你可以偏转这张牌',
  // 你可以弃置你的手牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p112': '你可以弃置你的手牌',
  // 你可以弃置牌库顶端的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p113': '你可以弃置牌库顶端的卡牌',
  // 你可以失去控制权（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p114': '你可以失去控制权',
  // 你弃置1张牌或删除此牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p115': '你弃置1张牌或删除此牌',
  // 你拥有控制权——你可以将对手1张牌偏转到此链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p116': '你拥有控制权——你可以将对手1张牌偏转到此链路',
  // 你拥有控制权——偏转1张其他牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p117': '你拥有控制权——偏转1张其他牌',
  // 你重排协议后——你可以偏转1张反面朝下的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p118': '你重排协议后——你可以偏转1张反面朝下的牌',
  // 偏转1张被覆盖的正面朝下的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p119': '偏转1张被覆盖的正面朝下的卡牌',
  // 偏转1张对手的反面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p120': '偏转1张对手的反面牌',
  // 偏转1张对手的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p121': '偏转1张对手的牌',
  // 偏转1张对手在此链路的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p122': '偏转1张对手在此链路的卡牌',
  // 偏转1张反面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p123': '偏转1张反面牌',
  // 偏转1张你的被覆盖的卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p124': '偏转1张你的被覆盖的卡牌',
  // 偏转1张你的牌（含此牌自身）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p125': '偏转1张你的牌（含此牌自身）',
  // 偏转1张你对手的被盖住的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p126': '偏转1张你对手的被盖住的牌',
  // 偏转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p127': '偏转1张牌',
  // 偏转1张其它牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p128': '偏转1张其它牌',
  // 偏转1张阈值小于此链路牌数的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p129': '偏转1张阈值小于此链路牌数的牌',
  // 偏转此牌到另一列（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p130': '偏转此牌到另一列',
  // 偏转对手的1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p131': '偏转对手的1张牌',
  // 偏转对手的1张牌，或交换你的2个协议（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p132': '偏转对手的1张牌，或交换你的2个协议',
  // 偏转或翻转1张卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p133': '偏转或翻转1张卡牌',
  // 偏转另1张你的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p134': '偏转另1张你的牌',
  // 偏转你阈值最低的被覆盖的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p135': '偏转你阈值最低的被覆盖的牌',
  // 偏转你在此链路中1张被覆盖的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p136': '偏转你在此链路中1张被覆盖的牌',
  // 偏转这张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p137': '偏转这张牌',
  // 弃3张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p138': '弃3张牌',
  // 弃置1张牌到对手的弃牌堆（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p139': '弃置1张牌到对手的弃牌堆',
  // 弃置2张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p140': '弃置2张牌',
  // 清缓存后——选择牌库顶反打到的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p141': '清缓存后——选择牌库顶反打到的链路',
  // 任意玩家清缓存后——删除1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p142': '任意玩家清缓存后——删除1张牌',
  // 任意玩家重排协议后——弃1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p143': '任意玩家重排协议后——弃1张牌',
  // 删除1张0分或1分的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p144': '删除1张0分或1分的牌',
  // 删除1张反面牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p145': '删除1张反面牌',
  // 删除1张阈值={n}的卡牌（可含被覆盖）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p146': '删除1张阈值={n}的卡牌（可含被覆盖）',
  // 删除此列分值最低的被盖住的牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p147': '删除此列分值最低的被盖住的牌',
  // 删除对手的1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p148': '删除对手的1张牌',
  // 删除对手分值最高的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p149': '删除对手分值最高的牌',
  // 删除对手阈值最低的被覆盖的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p150': '删除对手阈值最低的被覆盖的牌',
  // 删除该列1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p151': '删除该列1张牌',
  // 删除另1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p152': '删除另1张牌',
  // 删除你分值最高的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p153': '删除你分值最高的牌',
  // 失去控制权——对手弃{n}张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p154': '失去控制权——对手弃{n}张牌',
  // 失去控制权——删除1张正面朝上的牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p155': '失去控制权——删除1张正面朝上的牌',
  // 手牌恰好2张——删除对手1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p156': '手牌恰好2张——删除对手1张牌',
  // 手牌为0——对手弃{n}张牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p157': '手牌为0——对手弃{n}张牌',
  // 手牌为0——对手弃1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p158': '手牌为0——对手弃1张牌',
  // 透彻：从牌库中选择1张阈值为{n}的卡牌抽取（无 <defId> 前缀的整标题）
  'engine.prompt.p159': '透彻：从牌库中选择1张阈值为{n}的卡牌抽取',
  // 宣告1个数字（0-6）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p160': '宣告1个数字（0-6）',
  // 宣告1个协议（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p161': '宣告1个协议',
  // 选1列删除其中所有1分和2分的牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p162': '选1列删除其中所有1分和2分的牌',
  // 选择1条对手总阈值更大的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p163': '选择1条对手总阈值更大的链路',
  // 选择1条链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p164': '选择1条链路',
  // 选择1条你恰好有5张牌的链路（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p165': '选择1条你恰好有5张牌的链路',
  // 选择1条要翻开盖牌的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p166': '选择1条要翻开盖牌的链路',
  // 选择1条有正面朝下卡牌的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p167': '选择1条有正面朝下卡牌的链路',
  // 选择1张手牌反面打出（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p168': '选择1张手牌反面打出',
  // 选择1张未被覆盖的新星牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p169': '选择1张未被覆盖的新星牌',
  // 选择第1个要交换的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p170': '选择第1个要交换的链路',
  // 选择第2个协议位（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p171': '选择第2个协议位',
  // 选择第2个要交换的链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p172': '选择第2个要交换的链路',
  // 选择目标卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p173': '选择目标卡牌',
  // 选择目标线路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p174': '选择目标线路',
  // 选择你的1张牌（含此牌自身）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p175': '选择你的1张牌（含此牌自身）',
  // 选择牌最多的1条链路（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p176': '选择牌最多的1条链路',
  // 选择偏转目标线（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p177': '选择偏转目标线',
  // 选择要编译的链路（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p178': '选择要编译的链路',
  // 选择要打出的列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p179': '选择要打出的列',
  // 选择要删除1张牌的第二列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p180': '选择要删除1张牌的第二列',
  // 选择要删除1张牌的第一列（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p181': '选择要删除1张牌的第一列',
  // 选择要删除所有牌的列（该列双方合计≥8张）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p182': '选择要删除所有牌的列（该列双方合计≥8张）',
  // 要么弃1张牌，要么翻转此牌（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p183': '要么弃1张牌，要么翻转此牌',
  // 以正面还是反面打出（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p184': '以正面还是反面打出',
  // 再翻转1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p185': '再翻转1张牌',
  // 再删除1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p186': '再删除1张牌',
  // 在此牌正下方反面打出1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p187': '在此牌正下方反面打出1张牌',
  // 在另一列反面打出牌堆顶（引擎原文剥掉 <defId>+标记 前缀后的余项）
  'engine.prompt.p188': '在另一列反面打出牌堆顶',
  // 在同一链路翻转对手的1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p189': '在同一链路翻转对手的1张牌',
  // 召回1张卡牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p190': '召回1张卡牌',
  // 召回对手的1张牌（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p191': '召回对手的1张牌',
  // 重排对手协议——选择第1个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p192': '重排对手协议——选择第1个位置',
  // 重排你的协议（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p193': '重排你的协议',
  // 重排协议：选择要交换的第1个位置（无 <defId> 前缀的整标题）
  'engine.prompt.p194': '重排协议：选择要交换的第1个位置',
  // 重排协议：选择要交换的第2个位置（无 <defId> 前缀的整标题）
  'engine.prompt.p195': '重排协议：选择要交换的第2个位置',
  // 重新排列{label}的协议——选择要交换的第1个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p196': '重新排列{label}的协议——选择要交换的第1个位置',
  // 重新排列{label}的协议——选择要交换的第2个位置（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p197': '重新排列{label}的协议——选择要交换的第2个位置',
  // 重新排列{label}的协议（可多次交换，直到满意）（引擎原文剥掉 <defId> 前缀后的余项）
  'engine.prompt.p198': '重新排列{label}的协议（可多次交换，直到满意）',
  // clarity：打出这张牌（朝向）（无 <defId> 前缀的整标题）
  'engine.prompt.p199': 'clarity：打出这张牌（朝向）',
  // clarity：反面打出到任意线（无 <defId> 前缀的整标题）
  'engine.prompt.p200': 'clarity：反面打出到任意线',
  // clarity：正面打出（须匹配协议线）（无 <defId> 前缀的整标题）
  'engine.prompt.p201': 'clarity：正面打出（须匹配协议线）',
  // unity：翻转1张牌（无 <defId> 前缀的整标题）
  'engine.prompt.p202': 'unity：翻转1张牌',
  // unity：翻转1张牌或抽取1张牌（无 <defId> 前缀的整标题）
  'engine.prompt.p203': 'unity：翻转1张牌或抽取1张牌',
  // 清理缓存：弃{n}张牌（手牌超过 5 张上限）（无 <defId> 前缀的整标题；★ 2026-10-02 补：
  // 出处是 `src/core/game.ts` 的 `cacheClearGen`，不是 `src/core/effects/**` ⇒ 原来那条
  // 生成式腿扫不到它，按设计回退成了中文。见 `tests/i18n/engine-prompt-title.test.ts` 的扫描面）
  'engine.prompt.p204': '清理缓存：弃 {n} 张牌（手牌超过 5 张上限）',
/* ENGINE-PROMPT-END */
  /* ───── 选择条**动作按钮**的显示层替换（P5；值是**引擎的 action id**，不是屏上那句中文） ─────
   * 屏上中文一律来自 `src/core/log.ts` 的 `actionCn()`（红线，一个字未改）；
   * 本族只在英文模式下把 id 换成英文，命中不了就回退 `actionCn()` 的原文。
   * 逐条口径见 `src/i18n/engine-prompt.ts` 的 `ENGINE_ACTION_KEYS`。 */
  /* ENGINE-ACTION-KEYS-BEGIN */
  // flip
  'engine.action.flip': 'flip',
  // draw
  'engine.action.draw': 'draw',
  // discard
  'engine.action.discard': 'discard',
  // delete
  'engine.action.delete': 'delete',
  // shift
  'engine.action.shift': 'shift',
  // return
  'engine.action.return': 'return',
  // face-up
  'engine.action.face_up': 'face-up',
  // face-down
  'engine.action.face_down': 'face-down',
  // skip
  'engine.action.skip': 'skip',
  // shuffle
  'engine.action.shuffle': 'shuffle',
  // swap
  'engine.action.swap': 'swap',
  // play
  'engine.action.play': 'play',
  // rearrange-swap
  'engine.action.rearrange_swap': 'rearrange-swap',
  // rearrange-done
  'engine.action.rearrange_done': 'rearrange-done',
  // 不重排，继续
  'engine.action.keep': '不重排，继续',
  // 失去控制权
  'engine.action.give_up_control': '失去控制权',
  // 弃置手牌
  'engine.action.discard_hand': '弃置手牌',
  // order:{layout}
  'engine.action.order': 'order:{layout}',
  // num:{n}
  'engine.action.num': 'num:{n}',
  // proto:{proto}
  'engine.action.proto': 'proto:{proto}',
  // 重排玩家{who}的协议
  'engine.action.rearrange_player': '重排玩家{who}的协议',
  // 重排玩家{who}的协议（已锁定）
  'engine.action.rearrange_player_locked': '重排玩家{who}的协议（已锁定）',
  /* ENGINE-ACTION-KEYS-END */
  /* ───── 3 代控制权族特效的文字（★ 2026-10-02 收官走查的漏网修复） ─────
   * 出处 `src/ui/gen3-control.ts`（不是红线文件，已按同一套规矩抽进这张表）。
   * 这一族 5 条**全是玩家可见文案**，不是"匹配用的标记串"：
   *  - `控制权判定 · P{who}`：C4 判定特效的标题（`g3ctrl-caption`）；
   *  - `获得控制组件` / `未满足（领先 {wins} 条，需 2 条）`：同一特效的结果句（`g3ctrl-result`）；
   *  - `借 {n}`：嫉妒0 常驻层挂在**对手那张被借走阈值的卡**上的文字标（`g3sync-envy0-borrow`）；
   *  - `最高档剔除`：暴怒0 中缝上的文字标（`g3sync-wrath0-chip`）。
   * 2026-10-02 收官走查的 J2 帧实测可见前三条里的两条（`控制权判定 · P1` / `未满足（…）`）；
   * 后两条是同一族（同一屏、同一套常驻层的文字标），真机那一轮没走到嫉妒0 / 暴怒0 的帧。 */
  // 控制权判定 · P{who}
  'gen3.control.check-caption': '控制权判定 · {who}',
  // 获得控制组件
  'gen3.control.gained': '获得控制组件',
  // 未满足（领先 {wins} 条，需 2 条）
  'gen3.control.not-met': '未满足（领先 {wins} 条，需 2 条）',
  // 借 {n}
  'gen3.control.borrow': '借 {n}',
  // 最高档剔除
  'gen3.control.wrath-cull': '最高档剔除',
};
