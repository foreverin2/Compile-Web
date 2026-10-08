/**
 * ★ 2026-10-01（P1，用户口径）：**新玩家首启向导**（三步，全双语，只出现一次）。
 *
 * 方案：`docs/2026-10-01-新手引导与教学-方案.md` 的 §7 P1 行与 §1（"一个首启向导 +
 * 一个教学模式，两者只共享存储与文案"）。用户给的流程（逐字）：
 *
 * ```
 * 第 1 步 选择语言 ──► 选完显示一句提示：之后可在「首页 → 设置」更改
 * 第 2 步 同意保存到本地 + 给自己取个名字 ──► 提示：之后可在「首页 → 本地数据与隐私」更改/清除
 * 第 3 步 是否开始教学模式 ──► 若「开始教学」⇒ 进教学模式（**本轮到不了**：只留入口占位）
 *                          └─ 若「我玩过，直接跳过」⇒ 提示：随时可以在首页点「新手教程」再次进入
 * ```
 *
 * ⚠️ 第 3 步那两句提示**不在本文件里**：屏只把 `startTutorial` 交给宿主，文案由
 * `src/main.ts` 的 `finishOnboarding` 按选择发（键 `onboarding.after-skip` /
 * `onboarding.after-start`，走首页的"画完之后再发"接缝）。
 * ★ 2026-10-02 线上真机验收 **D1** 的修法就在这里：第一版把提示发给了「开始教学」那一支
 * （与上面这段用户口径反了），而且"以后还能再进教学模式"那句话从来没被写出来过。
 *
 * ## 形态（照 `settingsOverlayElement` / `feedback-screen` 那套）
 *
 * 一个**挂到 `document.body` 上的整屏遮罩**（`.onboarding-overlay`），版式全部落在
 * `src/ui/styles-local.css` 的 `onboarding-*` 新类名上：**`styles.css` / `render.ts` 一行不动**。
 *
 * ⚠️ 遮罩**占满整屏**（不是"浮在首页上的小窗"）：向导期间玩家不该点到背后的首页 ——
 * 判据是 `tests/i18n/onboarding.test.ts` 的一条"向导占屏时不误触首页"腿
 * （遮罩存在时首页按钮**一个都点不到**，因为遮罩把它整个盖住了；真浏览器里 `pointer-events`
 * 由 `styles-local.css` 的定位+尺寸保证）。
 *
 * ## 授权门控的顺序（**这是 P1 最容易做错的一处**）
 *
 * 第 1 步选语言时**还没同意保存** ⇒ 那一刻语言**只能进内存**（`setLang`，游客态）；
 * 第 2 步的界面照样要用**刚选的语言**显示（所以 `setLang` 必须在第 1 步就调）。
 * 等到第 2 步用户点了「允许」之后，宿主才**把第 1 步选的语言一起落盘**（见 `nav.onFinish`
 * 的 `lang` 字段与 `src/main.ts` 的 `finishOnboarding()`）—— 否则"选英文 → 同意保存 → 刷新回中文"。
 *
 * ## "只出现一次"的边界（**如实写清，别假装**）
 *
 *  - 标记 = `L1_SETTINGS.onboardingSeen`（**不新增存储键**，与昵称/语言/开关同一份存储）；
 *  - **同意保存**之后：写在磁盘上 ⇒ 下次启动不再出现；「清除本机数据」把它一起清掉 ⇒ **再出现一次**；
 *  - **游客模式**（第 2 步点了「不用，本次不保存」）：标记只进内存 ⇒ **刷新之后向导会再出现**。
 *    这不是缺陷，是分层的必然（没同意保存 ⇒ 本机不记得任何东西）。屏上第 3 步的提示因此**不写**
 *    "以后不会再问"，只写用户要求的那句"随时可以在首页点「新手教程」再次进入"。
 *
 * ## 本文件不碰存储，也**不 import** `local-consent.ts` / `privacy.ts`
 *
 * 与 `local-consent.ts` 同一条纪律：**只建元素 + 挂回调**，一切读写都经 `nav` 由宿主做。
 * 于是它能在无 jsdom 的 node 下用 DOM 桩真跑（`tests/i18n/onboarding.test.ts`）。
 *
 * ⚠️ 授权那一组的**界面文字**走 `t('onboarding.consent.*')`（见 `ONBOARDING_LABELS` 的头注），
 * 正文三段由宿主通过 `privacyLinesOf` 注入 ⇒ 本文件对那两个模块**零依赖**，
 * 依赖方向是干净的（`src/ui/onboarding.ts` → `src/i18n/`）。
 */
import { LANGS, getLang, setLang, t, type Lang } from '../i18n';

/**
 * 界面标签（本文件里**唯一**允许出现中文字面量的地方，而且只有下面两条）。
 *
 * ## ★ 2026-10-01（P1 的第二次修法）：授权那一组**不再引用** `CONSENT_COPY`
 *
 * 第一版这里是 `consentTitle: CONSENT_COPY.title, …`（五个字段全引用旧弹窗那一份）。
 * **真机实测抓到了它的后果**：第 1 步选了 `English` ⇒ 第 2 步的**标题与两个按钮仍是中文**
 * （只有"不用之后"那条提示是英文），半张屏两种语言 —— 正是用户抱怨的那一类观感。
 *
 * 根因是**两个要求打架**：① 用户要求"UI 全量双语"；② `CONSENT_COPY` 那一组（以及它的上游
 * `src/app/privacy.ts`）是**整句哈希钉住**的，翻译它属于"隐私措辞"那一轮的事，不在 P1 的范围里。
 *
 * 修法（这一轮采纳的那一条）：**界面文字**走 `t('onboarding.consent.*')`（中英都有，
 * 中文值**逐字等于** `CONSENT_COPY` 的对应字段，由 `tests/i18n/onboarding.test.ts` 钉住不许漂），
 * **正文三段仍然引用** `privacyLines()` 的原句 —— "隐私承诺句只有一个家"那条纪律不破。
 * 代价如实登记：英文界面下第 2 步的那段**正文**仍是中文（见方案 §7.6 与清单文档 D 节）。
 *
 * 于是本文件代码位里的中文字面量**恰好两条**（`startTutorial` / `skipTutorial`）——
 * 它们不承诺任何事（只是第 3 步两个按钮上的字），仍未进 `src/i18n/`（P2 会把教学模式整屏一起抽），
 * 所以本文件照实登记在 `docs/2026-10-01-i18n-尚未抽取的屏.md` 里。
 *
 * ★ 2026-10-02（P3 第三批）：**这两条也进表了**（键 `onboarding.tutorial.start` /
 * `onboarding.tutorial.skip`，中文值逐字等于用户原话）⇒ 本文件代码位里**零中文**，
 * 已按"清单只准变短"的规矩从待办表里删掉。
 * 形态：`ONBOARDING_LABELS` 那个导出对象改成**现调 `t()` 的函数** `onboardingLabels()` ——
 * 对象字面量在模块加载那一刻就把语言钉死了，而这两个按钮必须跟着第 1 步选的语言走。
 */
export function onboardingLabels(): { readonly startTutorial: string; readonly skipTutorial: string } {
  return {
    startTutorial: t('onboarding.tutorial.start'),
    skipTutorial: t('onboarding.tutorial.skip'),
  };
}

/**
 * 第 2 步那几条**授权界面文字**的取值口（`t()` 的键以字面量写在这里 —— 缺键扫描腿要看得见）。
 *
 * ⚠️ 写成函数而不是常量：文案要跟着语言走，而语言在向导运行期会变（第 1 步就能变）。
 *
 * 五个 `which` 的落点（**别弄混**，D1/D2 的教训就在这里）：
 *  - `title` / `grant` / `deny` / `privacy`：授权那一组（中文值逐字等于 `CONSENT_COPY`）；
 *  - `deny-note`：**旧弹窗那句**"不用之后的后果 + 出路"（与 `CONSENT_COPY.denyHint` 逐字一致）；
 *  - `local-hint`：第 2 步的**指引**（"以后能改昵称、能清本机数据"）—— 2026-10-02 D2 新增，
 *    它与 `deny-note` 是**两句不同的话**，合并过一次是缺陷，别再合并。
 */
function consentText(which: 'title' | 'grant' | 'deny' | 'deny-note' | 'local-hint' | 'privacy'): string {
  switch (which) {
    case 'title': return t('onboarding.consent.title');
    case 'grant': return t('onboarding.consent.grant');
    case 'deny': return t('onboarding.consent.deny');
    case 'deny-note': return t('onboarding.consent.deny-note');
    case 'local-hint': return t('onboarding.consent.local-hint');
    default: return t('onboarding.consent.privacy');
  }
}

/** 三步的序号（屏上写"第 N 步 / 共 3 步"） */
export const ONBOARDING_STEPS = 3;

/**
 * 向导走完时的结论（宿主据此落盘 + 决定去哪一屏）。
 *
 * 刻意写成**命名类型**（不就地写字面量）：就地写会让 `tests/ui/source-text.ts` 的
 * `functionBody` 把返回类型里的 `{` 当函数体起点（那是它写明的已知局限）。
 */
export interface OnboardingOutcome {
  /**
   * 第 1 步选的语言。**宿主必须把它一起落盘**（在第 2 步同意保存之后）——
   * 否则"选英文 → 同意保存 → 刷新回中文"。见文件头注"授权门控的顺序"。
   */
  readonly lang: Lang;
  /** 第 2 步的选择（`'allowed'` = 可以落盘；`'denied'` = 游客模式，本机零写入） */
  readonly consent: 'allowed' | 'denied';
  /** 第 2 步填的昵称（**可留空**：留空就用既有缺省显示名） */
  readonly nick: string;
  /** 第 3 步选了「开始教学」吗（`true` 时宿主应当进教学模式；本轮到不了，只留接缝） */
  readonly startTutorial: boolean;
}

export interface OnboardingNav {
  /** 第 1 步选完语言（已经 `setLang` 过内存态）：宿主**不要**在这里落盘（还没同意保存） */
  onLangPicked?(lang: Lang): void;
  /**
   * 第 2 步点「允许」：此后才允许落盘（`main.ts` 的 `consentStep('grant')`）。
   *
   * ⚠️ 与本文件无关的一处既有口径：`grant()` 会顺手把"已允许"标记写到磁盘上（那是
   * `src/app/local-store.ts` 的设计：下次启动不再重问）。**向导中途关掉标签页**的人下次
   * 会直接进首页 + 首页说明，不会再看到向导 —— 这条**如实登记**在这里，不假装没有。
   */
  onGrant(): void;
  /** 第 2 步点「不用，本次不保存」：本次会话走游客模式，**零写入** */
  onDeny(): void;
  /** 走完三步（宿主：落盘标记 + 落盘语言/昵称 + 去首页或教学模式） */
  onFinish(outcome: OnboardingOutcome): void;
  /**
   * 点「隐私说明」的**宿主接缝**（与旧授权弹窗同款）。
   *
   * ⚠️ 它**不是**死胡同：完整隐私说明就地在向导里展开（唯一出处 `privacyLines()`）。
   */
  openPrivacy?(): void;
  /** 第 3 步「开始教学」：教学模式**本轮到不了**，宿主给一个"待开发"提示即可 */
  startTutorial?(outcome: OnboardingOutcome): void;
}

/* ── 与 `home.ts` / `local-data.ts` 同形的局部助手（不 import 那边的私有函数） ── */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * 完整隐私说明的就地展开（**唯一出处** = `privacyLines()`，与旧授权弹窗同一套口径）。
 *
 * 与 `local-consent.ts` 的 `renderPrivacyDetail` 逐字同形 —— 刻意不 import 那个私有函数
 * （它是私有的；为它改可见性会动到已经冻结的 `local-consent.ts`）。
 */
function renderPrivacyDetail(host: HTMLElement, expanded: boolean, lines: readonly string[]): void {
  host.textContent = '';
  if (!expanded) return;
  for (const line of lines) host.appendChild(el('p', 'onboarding-privacy-line', line));
}

/**
 * 造出首启向导的遮罩元素（**纯构造器**：不碰存储、不碰 `#app`、不挂到 body）。
 *
 * 挂到 `document.body` 与收尾（移除节点）由宿主做（`src/main.ts` 的 `showOnboarding()`），
 * 与 `settingsOverlayElement` 的分工**逐字同款**。
 *
 * @param nav 宿主能力（三个回调 + 两个可选接缝）
 * @param privacyLinesOf 完整隐私说明的**取值函数**（缺省由宿主注入；屏自己不 import `privacy.ts`
 *   也能跑，测试因此可以喂合成行）
 */
export function onboardingOverlayElement(
  nav: OnboardingNav,
  privacyLinesOf: () => readonly string[] = () => [],
): HTMLElement {
  const overlay = el('div', 'onboarding-overlay');
  const panel = el('div', 'onboarding-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  /* ── 头部：标题 + "第 N 步 / 共 3 步" ── */
  const head = el('div', 'onboarding-head');
  const title = el('div', 'onboarding-title');
  const progress = el('div', 'onboarding-progress');
  head.appendChild(title);
  head.appendChild(progress);
  panel.appendChild(head);

  /* ── 主体：每一步一个 `section`，同一时刻只显示一个 ── */
  const body = el('div', 'onboarding-body');
  panel.appendChild(body);

  /** 当前第几步（1 起）。**本函数内唯一的流程真相** */
  let step = 1;
  /** 第 1 步选的语言（初值 = 进来时那一个；第 2/3 步的界面都跟它走） */
  let lang: Lang = getLang();
  /** 第 2 步的结论（点了「允许」还是「不用」） */
  let consent: 'allowed' | 'denied' | null = null;

  /* ── 第 1 步：选择语言 ── */
  const step1 = el('section', 'onboarding-step');
  step1.dataset.step = '1';
  const s1Label = el('div', 'onboarding-label');
  const s1Btns = el('div', 'onboarding-lang-btns');
  /**
   * 语言按钮的文案取 `LANGS` 的 `label`（`中文` / `English`）—— 与设置小窗**同一个口径**：
   * 选项名**不跟着当前语言变**（一位只会英文的玩家第一次进来也得认得出哪个是自己要的）。
   */
  const langButtons: { readonly id: Lang; readonly btn: HTMLButtonElement }[] = [];
  for (const def of LANGS) {
    const b = button('btn onboarding-lang-btn', def.label, () => {
      lang = def.id;
      // ★ 第 1 步**只改内存态**（还没同意保存）：`setLang` 不认识存储，落盘是第 2 步之后的事。
      setLang(def.id);
      nav.onLangPicked?.(def.id);
      // 就地重画整份文案（含后面的两步 —— 它们要用刚选的语言显示），再前进到第 2 步
      render();
      goStep(2);
    });
    b.dataset.lang = def.id;
    langButtons.push({ id: def.id, btn: b });
    s1Btns.appendChild(b);
  }
  const s1Hint = el('p', 'onboarding-hint');
  step1.appendChild(s1Label);
  step1.appendChild(s1Btns);
  step1.appendChild(s1Hint);

  /* ── 第 2 步：同意保存 + 取名字（旧授权弹窗并进来的那一步） ──
   *
   * ⚠️ 标题 / 允许 / 不用 / 提示 / 隐私说明这几条走 `t()`（见 `consentText` 的头注）：
   * 它们是**界面文字**，必须跟着第 1 步选的语言变（真机实测抓到过"英文界面下第 2 步仍是中文"）。
   * 正文三段（`s2Body`）仍引用 `privacyLines()` 的原句 —— 那是**隐私承诺**，只有一个家。 */
  const step2 = el('section', 'onboarding-step');
  step2.dataset.step = '2';
  const s2ConsentTitle = el('h2', 'onboarding-consent-title', consentText('title'));
  const s2Body = el('div', 'onboarding-consent-body');
  for (const line of privacyLinesOf()) s2Body.appendChild(el('p', 'onboarding-consent-line', line));
  /**
   * ★ 2026-10-02（线上真机验收 **D2**）：第 2 步的**指引**与"不用之后的后果"是**两句不同的话**。
   *
   * 第一版只有一条 `onboarding-hint`，内容用的是旧授权弹窗那句 `CONSENT_DENY_HINT`
   * （"你随时可以…改变这个选择"）⇒ 用户口径要的两件事（**改昵称**、**清除本机数据**）都没说到。
   * 现在分成两条，各有自己的 `data-role` 与位置：
   *  - `s2LocalHint`（`data-role='local-hint'`，紧跟昵称那一行）：用户口径那句"以后能改昵称 / 能清数据"；
   *  - `s2DenyNote`（`data-role='deny-note'`，靠近两个按钮）：旧弹窗那句如实保留
   *    （与 `CONSENT_COPY.denyHint` 逐字一致，有腿钉住）。
   */
  const s2LocalHint = el('p', 'onboarding-hint', consentText('local-hint'));
  s2LocalHint.dataset.role = 'local-hint';
  const s2DenyNote = el('p', 'onboarding-hint', consentText('deny-note'));
  s2DenyNote.dataset.role = 'deny-note';

  const s2Nick = el('div', 'onboarding-nick');
  const s2NickLabel = el('span', 'onboarding-label');
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'onboarding-nick-input';
  nickInput.dataset.role = 'nick-input';
  s2Nick.appendChild(s2NickLabel);
  s2Nick.appendChild(nickInput);
  // 指引紧跟在昵称那一行后面（它说的正是"这个昵称以后在哪改"）
  s2Nick.appendChild(s2LocalHint);

  const s2Actions = el('div', 'onboarding-actions');
  const grantBtn = button('btn onboarding-grant', consentText('grant'), () => {
    if (consent !== null) return; // 只认第一次点（重复点击不该改结论）
    consent = 'allowed';
    nav.onGrant();
    applyConsentLook();
    goStep(3);
  });
  const denyBtn = button('btn onboarding-deny', consentText('deny'), () => {
    if (consent !== null) return;
    consent = 'denied';
    nav.onDeny();
    applyConsentLook();
    goStep(3);
  });
  s2Actions.appendChild(grantBtn);
  s2Actions.appendChild(denyBtn);

  // 完整隐私说明（就地展开，唯一出处由宿主注入）
  const privacyDetail = el('div', 'onboarding-privacy-full');
  const privacyLink = button('btn-link onboarding-privacy', consentText('privacy'), () => { /* 见下 */ });
  privacyLink.setAttribute('aria-expanded', 'false');
  let privacyExpanded = false;
  privacyLink.addEventListener('click', () => {
    privacyExpanded = !privacyExpanded;
    privacyLink.setAttribute('aria-expanded', privacyExpanded ? 'true' : 'false');
    // ★ 取**当前**语言的原句（第 1 步可能刚切过语言）：`privacyLinesOf()` 每次现取，
    //   不缓存 —— 宿主注入的那个函数读的是 `privacy.ts`（与语言无关的冻结中文），
    //   但"现取"这条口径让将来把它改成按语言取时不必改这里。
    renderPrivacyDetail(privacyDetail, privacyExpanded, privacyLinesOf());
    nav.openPrivacy?.();
  });

  step2.appendChild(s2ConsentTitle);
  step2.appendChild(s2Body);
  step2.appendChild(s2Nick);       // 昵称那一行里紧跟着"以后能改昵称 / 能清数据"的指引
  step2.appendChild(s2DenyNote);   // 旧弹窗那句"不用之后"的后果 + 出路（逐字保留）
  step2.appendChild(s2Actions);
  step2.appendChild(privacyLink);
  step2.appendChild(privacyDetail);

  /* ── 第 3 步：是否开始教学 ── */
  const step3 = el('section', 'onboarding-step');
  step3.dataset.step = '3';
  const s3Question = el('h2', 'onboarding-question');
  const s3Actions = el('div', 'onboarding-actions');
  /** 走完第三步（无论选哪个）：把结论交给宿主 */
  const finish = (startTutorial: boolean): void => {
    const outcome: OnboardingOutcome = {
      lang,
      consent: consent ?? 'denied', // 理论上到不了这里（第 3 步必须先过第 2 步）；兜成游客态更安全
      // ⚠️ `String(...)` 不是多余的：真实 DOM 的 `<input>.value` 恒是字符串，但**桩上**没写过
      //    就是 `undefined` ⇒ 不兜会让 `finishOnboarding` 的 `outcome.nick.trim()` 当场抛
      //    （本仓"桩与真 DOM 的差异"栽过好几次，这里按"读到的可能是 undefined"写）。
      nick: typeof nickInput.value === 'string' ? nickInput.value : '',
      startTutorial,
    };
    if (startTutorial) nav.startTutorial?.(outcome);
    nav.onFinish(outcome);
  };
  const startBtn = button('btn onboarding-start-tutorial', onboardingLabels().startTutorial, () => finish(true));
  const skipBtn = button('btn onboarding-skip-tutorial', onboardingLabels().skipTutorial, () => finish(false));
  s3Actions.appendChild(startBtn);
  s3Actions.appendChild(skipBtn);
  /**
   * ★ 2026-10-07（用户要求，选的是"什么都不自动改，只把 67% 提示说清楚"这一档）：
   * 新玩家在大厅页之前**不一定**见过模式页那句"建议 67% 游玩"，而教学正是画面最满的一屏 ⇒
   * 把**同一句**（键 `mode.zoom-hint`，中英两表都有，一个字都没新写）摆到第 3 步按钮下面。
   *
   * ⚠️ 本程序**不许**自己去改页面缩放（理由与那次教训写在 `src/ui/home.ts:208-218`：
   * 整页缩放会让按 100% 布局算坐标的特效层错位，那套实现当时被整份撤掉了）⇒ 这里只提示、
   * 一个 zoom 相关的东西都不碰，特效与玩家自己的浏览器缩放都不受影响。
   */
  const s3ZoomHint = el('p', 'onboarding-hint onboarding-zoom-hint');
  s3ZoomHint.dataset.role = 'zoom-hint';
  step3.appendChild(s3Question);
  step3.appendChild(s3Actions);
  step3.appendChild(s3ZoomHint);

  body.appendChild(step1);
  body.appendChild(step2);
  body.appendChild(step3);

  overlay.appendChild(panel);

  /* ─────────────────────────── 渲染与流程 ─────────────────────────── */

  /** 第 2 步的"已经点了哪一个"的视觉/属性标记（两个按钮各自标出来，供测试与读屏） */
  function applyConsentLook(): void {
    if (consent === 'allowed') grantBtn.setAttribute('data-picked', '1');
    if (consent === 'denied') denyBtn.setAttribute('data-picked', '1');
  }

  /** 只显示第 `n` 步（`hidden` 而不是"渲染了但不挂"：本屏一次建好、只切换可见性） */
  function goStep(n: number): void {
    step = n;
    step1.hidden = n !== 1;
    step2.hidden = n !== 2;
    step3.hidden = n !== 3;
    render();
  }

  /**
   * 按当前语言 + 当前步把**每一条文案**写一遍。
   *
   * ⚠️ 这里是"新增一条文案就补一行"的地方（与 `settingsOverlayElement` 的 `applyLang` 同款）：
   * 漏了哪一条，切语言之后它就停在旧语言上，而屏上其它条目都变了 —— 这种"半张屏"最难发现。
   * `tests/i18n/onboarding.test.ts` 在两种语言下各画一次并逐条比对。
   */
  function render(): void {
    title.textContent = t('onboarding.title');
    progress.textContent = t('onboarding.step', { n: String(step), total: String(ONBOARDING_STEPS) });
    panel.setAttribute('aria-label', t('onboarding.aria'));

    s1Label.textContent = t('onboarding.lang.label');
    s1Hint.textContent = t('onboarding.lang.hint');

    s2NickLabel.textContent = t('onboarding.nick.label');
    nickInput.placeholder = t('onboarding.nick.placeholder');

    // ★ 授权那一组（P1 第二次修法）：**每一条**界面文字都要跟着语言重写 ——
    //   第一版它们引用 `CONSENT_COPY`（整份中文），真机实测"第 1 步选 English → 第 2 步仍是中文"。
    //
    // ★ 2026-10-07（**用户报的缺陷**）：正文三段原来只在建屏那一刻填一次（那时语言还是默认中文），
    //   于是"第 1 步选 English"之后这一段停在中文（用户截图 1）。宿主的 `privacyLinesOf()`
    //   现在**按语言取**（中文仍是 `privacy.ts` 那三句，英文取 `src/i18n/consent-en.ts`），
    //   这里每次重画时清空重填 —— 与同屏其它条目同一条纪律。
    s2Body.textContent = '';
    for (const line of privacyLinesOf()) s2Body.appendChild(el('p', 'onboarding-consent-line', line));
    s2ConsentTitle.textContent = consentText('title');
    s2LocalHint.textContent = consentText('local-hint');
    s2DenyNote.textContent = consentText('deny-note');
    grantBtn.textContent = consentText('grant');
    denyBtn.textContent = consentText('deny');
    privacyLink.textContent = consentText('privacy');

    s3Question.textContent = t('onboarding.tutorial.question');
    /**
     * ★ 2026-10-07（**用户报的缺陷**）：第 3 步那两个按钮**原来是在建屏那一刻写死文案的**
     * （`button(..., onboardingLabels().startTutorial, ...)`）⇒ 建屏时语言还是默认的中文，
     * 于是"第 1 步选 English"之后，整屏都变了、**只有这两个按钮停在中文**（用户截图 2 就是它们）。
     * 修法：与同屏其它条目一样，在 `render()` 里按当前语言重写 —— 键本来就存在
     * （`onboarding.tutorial.start` / `.skip`，中英都有），缺的只是这一次重写。
     */
    startBtn.textContent = t('onboarding.tutorial.start');
    skipBtn.textContent = t('onboarding.tutorial.skip');
    // ★ 2026-10-07：第 3 步的"建议 67%"提示（与上面两条同一条纪律：跟着语言重写）
    s3ZoomHint.textContent = t('mode.zoom-hint');

    for (const { id, btn } of langButtons) {
      // 当前语言那一枚标出来（视觉上是 `.onboarding-lang-btn.on`，属性给测试与读屏）
      const active = id === getLang();
      btn.classList.toggle('on', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
  }

  goStep(1);
  return overlay;
}
