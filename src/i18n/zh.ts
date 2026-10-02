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
  // 第 3 步（教学入口本轮到不了：宿主给"待开发"提示）
  'onboarding.tutorial.question': '要不要先学着怎么玩？',
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
  'onboarding.consent.hint': '你随时可以在主界面的「本地数据与隐私」里改变这个选择。',
  'onboarding.consent.privacy': '隐私说明',

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
  'toast.tutorial': '新手教程：待开发',
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
};
