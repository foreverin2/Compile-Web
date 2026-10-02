import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { descendants, installStubDom, makeStubEl, queryAllIn, type StubNode } from '../ui/net-dom-stub';
import { stripComments } from '../ui/source-text';
import { openL1Store, type StorageLike } from '../../src/ui/local-store-browser';
import {
  createLocalStore,
  readLang,
  readNickName,
  readOnboardingSeen,
  writeLang,
  writeNickName,
  writeOnboardingSeen,
} from '../../src/app/local-store';
import {
  ONBOARDING_LABELS,
  ONBOARDING_STEPS,
  onboardingOverlayElement,
  type OnboardingOutcome,
} from '../../src/ui/onboarding';
import { CONSENT_COPY } from '../../src/ui/local-consent';
import {
  CONSENT_ALLOW_NOTE,
  CONSENT_DENY_HINT,
  CONSENT_DENY_NOTE,
  PRIVACY_COPY,
  privacyLines,
} from '../../src/app/privacy';
import { clearAllLocalData } from '../../src/app/storage';
import { DEFAULT_LANG, EN, getLang, initI18n, resetMissingKeysForTest, setLang, t, ZH } from '../../src/i18n';

/**
 * ★ 2026-10-01（P1，用户口径）：**新玩家首启向导**（三步）的腿。
 *
 * 用户给的流程（逐字，见 `docs/2026-10-01-新手引导与教学-方案.md` §7 的 P1 行）：
 *
 * ```
 * 第 1 步 选择语言 ──► 选完显示一句提示：之后可在「首页 → 设置」更改
 * 第 2 步 同意保存到本地 + 给自己取个名字 ──► 提示：之后可在「首页 → 本地数据与隐私」更改/清除
 * 第 3 步 是否开始教学模式 ──► 若「开始教学」⇒ 进教学模式（本轮到不了，先给入口占位）
 *                          └─ 若「我玩过，直接跳过」⇒ 提示：随时可以在首页点「新手教程」再次进入
 * ```
 *
 * ## 本文件证明什么 / 不证明什么（**如实划边界**）
 *
 * **证明**（在无 jsdom 的 node 下真跑：真 DOM 桩 + 真 `openL1Store` + 真 `createLocalStore`）：
 *  1. 三步的顺序与「同一时刻只显示一步」；
 *  2. 每一步的**逐字文案**（中英各画一遍，两语言下的每一条都断言）；
 *  3. 第 1 步选语言**只进内存**（那一刻盘上零写入），第 2 步点「允许」之后才由宿主写盘
 *     —— 包括**把第 1 步选的语言一起写下去**（不写就会"选英文 → 同意保存 → 刷新回中文"）；
 *  4. "只出现一次"的标记（`L1_SETTINGS.onboardingSeen`）：走完写、第二次启动不再出现、
 *     「清除本机数据」之后**再出现一次**；游客模式下**刷新后会再出现**（如实钉住这条边界）；
 *  5. 第 2 步**把旧授权弹窗并进来了**：允许/不用各自落到授权状态机、且只认第一次点；
 *     就地展开的隐私说明与 `privacy.ts` 的 `privacyLines()` **逐字同源**（不是第二份）。
 *
 * **不证明**：真实浏览器里的观感（遮罩真的盖住首页、`pointer-events` 真的挡住点击）。
 * 那一面由 `src/ui/styles-local.css` 的 `.onboarding-overlay` 版式 + 真浏览器走查兜
 * （本仓没有 jsdom，桩不含布局，见 `tests/ui/net-dom-stub.ts` 的文件头注）。
 *
 * ## 宿主那一侧（`src/main.ts` 的 `showOnboarding` / `finishOnboarding`）
 *
 * 本文件用 `boot()` 造一个**与宿主同口径**的启动帧（手法与 `tests/i18n/lang-persistence-e2e.test.ts`
 * 的 `boot()` 同款：不 import `main.ts`——它有副作用，import 等于把整个游戏跑起来）。
 * 宿主源码那一面另有一条**源码结构腿**（最后一组），钉住"挂到 body + 走完移除 + 第 2 步才落盘语言"。
 */

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  setLang(DEFAULT_LANG);
  resetMissingKeysForTest();
});

/* ───────────────────────────── 夹具 ───────────────────────────── */

/** `StorageLike` 的最小假件（与 `tests/i18n/lang-persistence-e2e.test.ts` 同形） */
interface FakeStorage extends StorageLike {
  snapshot(): Record<string, string>;
}

function fakeStorage(): FakeStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    snapshot: () => Object.fromEntries(m),
  };
}

/** 树里所有节点的文本（按 DOM 顺序，用换行拼起来 —— 断言子串时不会跨节点误命中） */
function textOf(n: StubNode): string {
  return descendants(n).map((x) => x.text).join('\n');
}

/**
 * 在某个节点上真派发一次点击。
 *
 * ⚠️ 与 `lang-persistence-e2e.test.ts` 同款：桩的 `dispatchEvent` **不调用派发节点自己的监听器**
 * （它沿父链冒泡），所以要先造一个子节点、点那个子节点。
 */
function clickIn(target: StubNode): void {
  const clicker = makeStubEl('span');
  target.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
}

/** 树里**唯一**那个匹配选择器的节点（多一个/少一个都当场报，免得断言打在错的节点上） */
function one(root: StubNode, sel: string): StubNode {
  const hits = queryAllIn(root, sel);
  expect(hits.length, `选择器 ${sel} 命中了 ${hits.length} 个节点（应当恰好 1 个）`).toBe(1);
  return hits[0];
}

/** 桩上 `hidden` 只是个普通属性（桩不含布局，`hidden` 的语义由这条读取器统一） */
function hiddenOf(n: StubNode): boolean {
  return (n as unknown as { hidden?: unknown }).hidden === true;
}

/**
 * 读一个非 `data-` 属性（`aria-label` / `aria-expanded` 这类）。
 *
 * ⚠️ 桩的 `getAttribute` **没有**在 `StubNode` 的显式类型里（它在索引签名 `[k: string]: unknown`
 * 里），所以取值要过一道窄化 —— 本仓既有测试（`draft-pick-seat-mark.test.ts`）同款写法。
 */
function attrOf(n: StubNode, name: string): string | null {
  const reader = n as unknown as { getAttribute(x: string): string | null };
  return reader.getAttribute(name);
}

/** 当前显示的那一步的序号（`data-step`），找不到/多于一个都当场报 */
function visibleStep(root: StubNode): string {
  const shown = queryAllIn(root, 'section.onboarding-step').filter((s) => !hiddenOf(s));
  expect(shown.length, `同一时刻显示着 ${shown.length} 步（应当恰好 1 步）`).toBe(1);
  return String(shown[0].dataset.step);
}

/**
 * 第 2 步那三段**授权正文** —— 与 `src/main.ts` 的 `consentBodyLines()` **逐句同口径**
 * （同样三个常量、同样顺序）。本文件不 import `main.ts`（它有副作用），所以在这里照写一遍；
 * "两边不许漂"由第 2 组那条 `consentBodyLines` 源码腿盯着（它从 `main.ts` 里抽出函数体比对符号面）。
 */
function consentBodyLines(): readonly string[] {
  return [CONSENT_ALLOW_NOTE, PRIVACY_COPY.noServerStorage[0], CONSENT_DENY_NOTE];
}

/**
 * 造一个"应用启动一帧"：真 `openL1Store` + 真 `createLocalStore` + 真 `onboardingOverlayElement`。
 *
 * `onFinish` 按 `src/main.ts` 的 `finishOnboarding()` **同一口径**写（落盘语言 → 落盘昵称 →
 * 落盘"已读过"标记 → 返回结论）；`onGrant` / `onDeny` 按 `consentStep()` 的落点写。
 * 这样"第 2 步同意之后语言才落盘"这条链在本文件里是**真跑**的，不是读源码猜的。
 */
interface Booted {
  readonly overlay: StubNode;
  readonly store: ReturnType<typeof createLocalStore>;
  /** 向导交出来的结论（没走完就是 `null`） */
  outcome(): OnboardingOutcome | null;
  /** 第 3 步选「开始教学」时宿主收到的通知次数（教学模式本轮到不了，只留接缝） */
  tutorialStarts(): number;
}

function boot(ls: FakeStorage, startLang: 'zh' | 'en' = DEFAULT_LANG): Booted {
  const store = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
  initI18n(() => readLang(store));
  setLang(startLang);
  let outcome: OnboardingOutcome | null = null;
  let tutorialStarts = 0;
  // 「清除本机数据」的落点：与 `src/ui/local-data.ts` 的清除同一条路（重置整个 L1 设置）
  const overlay = onboardingOverlayElement({
    onLangPicked: () => { /* 宿主在这里**不落盘**（还没同意保存）—— 这套口径由下面的腿钉住 */ },
    onGrant: () => { store.grant(); },
    onDeny: () => { store.deny(); },
    openPrivacy: () => { /* 说明已就地展开（同 local-consent 的换页接缝） */ },
    startTutorial: (o) => { tutorialStarts += 1; void o; },
    onFinish: (o) => {
      // ⚠️ 与 `finishOnboarding()` 逐句同口径（顺序也一样：语言 → 昵称 → 标记）
      writeLang(store, o.lang);
      if (o.nick.trim() !== '') writeNickName(store, o.nick);
      writeOnboardingSeen(store, true);
      outcome = o;
    },
  }, () => consentBodyLines()) as unknown as StubNode;
  return {
    overlay,
    store,
    outcome: () => outcome,
    tutorialStarts: () => tutorialStarts,
  };
}

/** 走完第 1 步（选语言）与第 2 步（点允许或不用 + 可选昵称），停在**第 3 步** */
function walkToStep3(b: Booted, opts: { lang?: 'zh' | 'en'; allow?: boolean; nick?: string } = {}): void {
  clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="' + (opts.lang ?? 'en') + '"]'));
  if (opts.nick !== undefined) {
    const input = one(b.overlay, '[data-role="nick-input"]') as unknown as { value: string };
    input.value = opts.nick;
  }
  clickIn(one(b.overlay, opts.allow === false ? '.onboarding-deny' : '.onboarding-grant'));
  expect(visibleStep(b.overlay), '第 2 步点了之后没有前进到第 3 步').toBe('3');
}

/* ───────────────────────── 1. 三步的顺序与可见性 ───────────────────────── */

describe('向导三步：顺序、可见性、文案逐字（中英各一遍）', () => {
  it('锚点：三步都真的建出来了，且**同一时刻只显示一步**（否则下面每条文案腿都可能空转）', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage());
    const sections = queryAllIn(b.overlay, 'section.onboarding-step');
    expect(sections.length, '向导不是三步（用户口径是三步）').toBe(ONBOARDING_STEPS);
    expect(sections.map((s) => s.dataset.step), '三段的 data-step 不是 1/2/3').toEqual(['1', '2', '3']);
    expect(visibleStep(b.overlay), '起始那一步不是第 1 步').toBe('1');
    // 反向：另外两步真的被藏起来了（不是"都显示着"）
    expect(sections.filter((s) => hiddenOf(s)).length, '起始帧藏起来的步数').toBe(2);
    // 头部：标题 + "第 N 步 / 共 3 步" 都在，且进度跟着步数走
    expect(one(b.overlay, '.onboarding-title').text, '标题不是表里那一条').toBe(t('onboarding.title'));
    expect(one(b.overlay, '.onboarding-progress').text, '第 1 步的进度行不对')
      .toBe(t('onboarding.step', { n: '1', total: '3' }));
    expect(attrOf(one(b.overlay, '.onboarding-panel'), 'aria-label'), '对话框没有 aria-label')
      .toBe(t('onboarding.aria'));
  });

  it('整条路走一遍：第 1 步选语言 → 第 2 步填名字并允许 → 第 3 步跳过（每一步只显示一步）', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage());

    // 第 1 步：两个语言选项，选 en
    expect(queryAllIn(b.overlay, '.onboarding-lang-btn').length, '语言选项不是两个').toBe(2);
    expect(visibleStep(b.overlay)).toBe('1');
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="en"]'));
    expect(getLang(), '第 1 步选完语言内存态没换').toBe('en');
    expect(visibleStep(b.overlay), '选完语言没有前进到第 2 步').toBe('2');
    expect(one(b.overlay, '.onboarding-progress').text, '第 2 步的进度行不对')
      .toBe(t('onboarding.step', { n: '2', total: '3' }));

    // 第 2 步：填名字 + 允许
    (one(b.overlay, '[data-role="nick-input"]') as unknown as { value: string }).value = '小明';
    clickIn(one(b.overlay, '.onboarding-grant'));
    expect(b.store.consent(), '第 2 步点允许之后授权状态机没落到 allowed').toBe('allowed');
    expect(visibleStep(b.overlay), '允许之后没有前进到第 3 步').toBe('3');

    // 第 3 步：跳过
    clickIn(one(b.overlay, '.onboarding-skip-tutorial'));
    const out = b.outcome();
    expect(out, '走完三步没有交出结论').not.toBeNull();
    expect(out?.lang, '结论里的语言不对').toBe('en');
    expect(out?.consent, '结论里的授权不对').toBe('allowed');
    expect(out?.nick, '结论里的昵称不对').toBe('小明');
    expect(out?.startTutorial, '「我玩过，直接跳过」却回成要开始教学').toBe(false);
    expect(b.tutorialStarts(), '跳过教学却通知了教学模式接缝').toBe(0);
  });

  it('第 3 步选「开始教学」⇒ 宿主收到接缝通知，且结论里 startTutorial=true（本轮到不了，只留入口）', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage());
    walkToStep3(b, { allow: true });
    clickIn(one(b.overlay, '.onboarding-start-tutorial'));
    expect(b.outcome()?.startTutorial, '「开始教学」没有回成 true').toBe(true);
    expect(b.tutorialStarts(), '「开始教学」没有通知教学模式接缝（P2 的入口）').toBe(1);
  });

  it('中英各画一遍：**每一条**文案都跟着语言变，且两种语言下都不留另一语言的字', () => {
    restores.push(installStubDom());

    // 中文那一帧（默认语言）
    const cn = boot(fakeStorage(), 'zh');
    expect(one(cn.overlay, '.onboarding-title').text).toBe('首次使用引导');
    expect(one(cn.overlay, '.onboarding-progress').text).toBe('第 1 步 / 共 3 步');
    expect(textOf(one(cn.overlay, 'section.onboarding-step[data-step="1"] .onboarding-label')))
      .toContain(t('onboarding.lang.label'));
    expect(one(cn.overlay, 'section.onboarding-step[data-step="1"] .onboarding-hint').text)
      .toBe(t('onboarding.lang.hint'));
    // 语言选项的标签**不跟着语言变**（只会英文的玩家第一次进来也得认得出）
    expect(descendants(one(cn.overlay, '.onboarding-lang-btns')).map((n) => n.text).filter((s) => s !== ''),
      '语言选项的标签不是 `LANGS` 的原样（中文 / English）').toEqual(['中文', 'English']);

    // 英文那一帧（点 English 之后**同一棵树**当场变英文）
    clickIn(one(cn.overlay, '.onboarding-lang-btn[data-lang="en"]'));
    expect(one(cn.overlay, '.onboarding-title').text, '同一棵树没变成英文标题').toBe('Getting started');
    expect(one(cn.overlay, '.onboarding-progress').text, '英文进度行不对').toBe('Step 2 of 3');
    expect(one(cn.overlay, 'section.onboarding-step[data-step="2"] .onboarding-label').text,
      '英文下第 2 步的昵称标签不对').toBe(t('onboarding.nick.label'));
    expect((one(cn.overlay, '[data-role="nick-input"]') as unknown as { placeholder: string }).placeholder,
      '英文下昵称输入框的占位不对').toBe(t('onboarding.nick.placeholder'));
    clickIn(one(cn.overlay, '.onboarding-grant'));
    expect(one(cn.overlay, '.onboarding-question').text, '英文下第 3 步的问题不对')
      .toBe(t('onboarding.tutorial.question'));
    // ★ P0 的不变量：en 这个键在两表里都有 ⇒ 不许出现 `⟪key⟫` 这种缺键形态
    const enText = textOf(cn.overlay);
    expect(enText, '英文帧里出现了缺键回退形态').not.toContain('⟪');
    // 反向：英文帧里**没有**中文帧那几句（证明"真的换了"而不是两句并存）
    expect(enText, '英文帧里还留着中文标题').not.toContain('首次使用引导');
    expect(enText, '英文帧里还留着中文提示').not.toContain('之后可以在首页的「设置」里更改语言。');
  });

  it('第 2 步的两条提示逐字（用户口径）：语言提示在**设置**、改/清除提示在**本地数据与隐私**', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage(), 'zh');
    // 第 1 步那句：之后可在「首页 → 设置」更改
    expect(one(b.overlay, 'section.onboarding-step[data-step="1"] .onboarding-hint').text,
      '第 1 步的提示不是用户要的那一句').toBe('之后可以在首页的「设置」里更改语言。');
    expect(one(b.overlay, 'section.onboarding-step[data-step="1"] .onboarding-hint').text,
      '第 1 步的提示没指向设置').toContain('设置');
    // 第 2 步那句：之后可在「首页 → 本地数据与隐私」更改/清除
    //   ⚠️ 上一步刚把语言切成 English ⇒ 这里第 2 步是**英文**的，所以断言英文那一句。
    //      （中文那一句的逐字值由下一组的"中文下"那条腿钉住，两条腿各管一种语言。）
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="en"]'));
    const step2 = queryAllIn(b.overlay, 'section.onboarding-step[data-step="2"]')[0];
    expect(one(b.overlay, 'section.onboarding-step[data-step="2"] .onboarding-hint').text,
      '第 2 步的提示不是英文版').toBe(EN['onboarding.consent.hint']);
    expect(textOf(step2), '第 2 步的英文提示没指向「本地数据与隐私」').toContain('Local data and privacy');
    // 反向：中文那一句此刻**不在**屏上（证明"真的换了语言"而不是两句并存）
    expect(textOf(step2), '英文帧里还留着第 2 步的中文提示').not.toContain('本地数据与隐私');
    // 第 3 步那句：随时可以在首页点「新手教程」再次进入
    clickIn(one(b.overlay, '.onboarding-grant'));
    const step3 = queryAllIn(b.overlay, 'section.onboarding-step[data-step="3"]')[0];
    expect(descendants(one(b.overlay, '.onboarding-skip-tutorial')).map((n) => n.text),
      '第 3 步「跳过」按钮不是用户原话').toEqual(['我玩过，直接跳过']);
    expect(descendants(one(b.overlay, '.onboarding-start-tutorial')).map((n) => n.text),
      '第 3 步「开始教学」按钮不是用户原话').toEqual(['开始教学']);
    // 反向锚点：第 3 步那一段**不是空的**（否则上面两条断言是在空集合上跑）
    expect(textOf(step3).trim().length, '第 3 步整段是空的 ⇒ 上面那条断言没意义').toBeGreaterThan(0);
    expect(one(b.overlay, '.onboarding-question').text, '第 3 步没有问句').toBe(t('onboarding.tutorial.question'));
  });
});

/* ───────────── 2. 第 2 步把旧授权弹窗并进来了（不出现两连问） ───────────── */

describe('第 2 步 = 旧授权弹窗并进来的那一步（界面文字双语 + 正文同源，不出现两连问）', () => {
  it('中文下：标题 / 允许 / 不用 / 提示 / 隐私说明**逐字等于** `CONSENT_COPY` 的对应字段', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage(), 'zh');
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="zh"]'));
    /**
     * ★ 2026-10-01（P1 第二次修法）：这五条**界面文字**从"直接引用 `CONSENT_COPY`"改成
     * 走 `t('onboarding.consent.*')`（理由见 `src/ui/onboarding.ts` 的头注：真机实测过
     * "第 1 步选 English ⇒ 第 2 步仍是中文"）。
     *
     * 改法没有放松"授权措辞只有一个家"那条纪律，而是把它**钉得更死**：中文值必须逐字相等，
     * 一个字都不许漂 —— 漂了这条腿当场红（下面四条第 2 组锚点也一样）。
     */
    expect(one(b.overlay, '.onboarding-consent-title').text, '授权标题与旧弹窗那句漂了')
      .toBe(CONSENT_COPY.title);
    expect(descendants(one(b.overlay, '.onboarding-grant')).map((n) => n.text), '「允许」按钮文案漂了')
      .toEqual([CONSENT_COPY.grant]);
    expect(descendants(one(b.overlay, '.onboarding-deny')).map((n) => n.text), '「不用」按钮文案漂了')
      .toEqual([CONSENT_COPY.deny]);
    expect(descendants(one(b.overlay, '.onboarding-privacy')).map((n) => n.text), '「隐私说明」按钮文案漂了')
      .toEqual([CONSENT_COPY.privacyLink]);
    // 中文下「不用之后」的提示：与 `onboarding.consent.hint` 的中文值**逐字等于** `CONSENT_COPY.denyHint`
    //   （★ P1 第二次修法：这一条走表了，所以中文值必须与旧弹窗那句一致 —— 见下面的英文组）
    expect(one(b.overlay, 'section.onboarding-step[data-step="2"] .onboarding-hint').text,
      '「不用」之后的提示漂了').toBe(ZH['onboarding.consent.hint']);
    expect(ZH['onboarding.consent.hint'], '「不用」之后的提示与旧弹窗那句漂了').toBe(CONSENT_COPY.denyHint);
    expect(one(b.overlay, 'section.onboarding-step[data-step="2"] .onboarding-hint').text,
      '「不用」之后的提示没指向本地数据与隐私屏').toContain('本地数据与隐私');
    // 反向锚点：那五句中文真的**不在**本文件的字面量面里（走的是表，不是第二份手写）
    const code = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/onboarding.ts', import.meta.url)))
        .subarray(0, 1024 * 1024).toString('utf8'),
    );
    for (const sentence of [CONSENT_COPY.title, CONSENT_COPY.grant, CONSENT_COPY.deny, CONSENT_COPY.privacyLink]) {
      expect(code, `onboarding.ts 里手写了「${sentence}」（应当走 t('onboarding.consent.*')）`).not.toContain(sentence);
    }
    // 中文帧里的提示也不许是"改/清除"那一句（两句别撞车）
    expect(CONSENT_DENY_HINT, '前置：`CONSENT_DENY_HINT` 与第 1 步那句撞了（本腿就分不清了）')
      .not.toBe(t('onboarding.lang.hint'));
  });

  it('★ 英文下：那五条**全部换成英文**（真机实测过的那种"半张屏"不许再出现）', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage(), 'zh');
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="en"]'));
    const step2 = queryAllIn(b.overlay, 'section.onboarding-step[data-step="2"]')[0];
    const text = textOf(step2);
    // 五个字段逐个断言（不是"整段有英文就行" —— 那样漏一条也看不出来）
    expect(one(b.overlay, '.onboarding-consent-title').text).toBe(t('onboarding.consent.title'));
    expect(one(b.overlay, '.onboarding-grant').text).toBe(t('onboarding.consent.grant'));
    expect(one(b.overlay, '.onboarding-deny').text).toBe(t('onboarding.consent.deny'));
    expect(one(b.overlay, '.onboarding-privacy').text).toBe(t('onboarding.consent.privacy'));
    // 反向：英文下这五条里**不许**再出现那五句中文
    for (const sentence of [CONSENT_COPY.title, CONSENT_COPY.grant, CONSENT_COPY.deny, CONSENT_COPY.privacyLink]) {
      expect(text, `英文界面下第 2 步还留着中文「${sentence}」`).not.toContain(sentence);
    }
    // 反向自证：`t()` 现在给的是英文（当前语言），中文表里那一条**逐字等于** `CONSENT_COPY`
    //   —— 用的是静态表 `ZH`（不是 `t()`，它跟着当前语言走）
    expect(ZH['onboarding.consent.title'], '中文表里那一条与 `CONSENT_COPY.title` 漂了')
      .toBe(CONSENT_COPY.title);
    // ★ 生成式：`onboarding.consent.*` 这一族**每一条**的两语言值都必须真的不同
    //   （否则"翻译"是抄了一遍中文，英文界面上照样是中文 —— 那正是这一轮修的那个 bug 的形态）
    const consentKeys = Object.keys(ZH).filter((k) => k.startsWith('onboarding.consent.'));
    expect(consentKeys.length, '`onboarding.consent.*` 一条都没有 ⇒ 下面那条判据恒真').toBeGreaterThanOrEqual(5);
    const same = consentKeys.filter((k) => EN[k] === ZH[k] || EN[k] === undefined);
    expect(same, `这些键的英文值与中文逐字相同（等于没翻）：${same.join(', ')}`).toEqual([]);
  });

  it('第 2 步的**正文恰好三段**，且逐句等于旧授权弹窗那份 `CONSENT_COPY.body`', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage(), 'zh');
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="zh"]'));
    const lines = queryAllIn(b.overlay, '.onboarding-consent-line').map((p) => p.text);
    // ⚠️ 段数写死 **3**（旧授权弹窗那三段）：多一段 = 把「本地数据与隐私」整屏的全文铺了出来
    //   （第一宿主传的正是 `privacyLines()`，真机实测第 2 步铺出十三段）；少一段 = 承诺少了一条。
    //   两个方向都当场红。
    expect(lines.length, '第 2 步的授权正文不是三段').toBe(3);
    // 逐句等于旧授权弹窗的正文 —— 而那一份自己又被 `local-consent.test.ts` 钉着"必须来自 privacy.ts"
    //   （`body[0]` / `body[2]` 是 `privacy.ts` 的两个 `CONSENT_*_NOTE`、`body[1]` 是
    //   `PRIVACY_COPY.noServerStorage[0]`）：于是"隐私措辞只有一个家"这条链在两份测试之间**接力**。
    expect(lines, '第 2 步的正文与旧授权弹窗那份漂了').toEqual([...CONSENT_COPY.body]);
    // 反向锚点：这三句**不是**随手写的 —— 逐句都能追到那三个（唯一的）常量出处
    const allowed = [CONSENT_ALLOW_NOTE, PRIVACY_COPY.noServerStorage[0], CONSENT_DENY_NOTE];
    for (const l of lines) {
      expect(allowed, `正文里出现了一句追不到出处的话：${l}`).toContain(l);
    }
    // ⚠️ 如实记下**两份不是一回事**：`privacyLines()`（「本地数据与隐私」整屏用的全文）里
    //    **没有**这两条授权专用说明（一条在前、一条在后）—— 所以这里的判据是"等于旧弹窗那份"，
    //    不是"逐句都在全文里"。写清这一点，免得后来者以为少了一句。
    const all = [...privacyLines()];
    expect(all, '前置：全文里居然已经有 `CONSENT_ALLOW_NOTE`（那这条注释就过时了）')
      .not.toContain(CONSENT_ALLOW_NOTE);
    expect(lines.filter((l) => all.includes(l)).length, '三段里一句都追不到全文 ⇒ 这条腿在空转')
      .toBeGreaterThan(0);
  });

  it('宿主注入的那三句与正文一致（`main.ts` 的 `consentBodyLines` 不许换成整份隐私全文）', () => {
    // 生成式读取：从 `main.ts` 里抽出那个函数体，断言它挑的就是那三句
    // （换成 `privacyLines()` 会让真机上第 2 步铺出十几段 —— 真机实测抓到过这个形态）
    const body = bodyOf(MAIN_CODE, 'consentBodyLines');
    expect(body.length, 'functionBody 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(40);
    for (const name of ['CONSENT_ALLOW_NOTE', 'PRIVACY_COPY.noServerStorage[0]', 'CONSENT_DENY_NOTE']) {
      expect(body, `宿主挑正文时漏了 ${name}`).toContain(name);
    }
    expect(body, '宿主把整份隐私全文（privacyLines()）当成了授权正文').not.toMatch(/privacyLines\s*\(/);
    // 反向自证：那三句常量确实是"承诺句"（不是随便一个字符串常量）
    expect(CONSENT_ALLOW_NOTE, 'CONSENT_ALLOW_NOTE 不是以句号收尾的承诺句').toMatch(/。$/);
    expect(CONSENT_DENY_NOTE, 'CONSENT_DENY_NOTE 不是以句号收尾的承诺句').toMatch(/。$/);
    expect(PRIVACY_COPY.noServerStorage[0], 'noServerStorage[0] 不是一句承诺').toMatch(/。$/);
  });

  it('允许 / 不用各自落到授权状态机；**只认第一次点**（重复点击不改结论）', () => {
    restores.push(installStubDom());

    // ① 允许
    const allow = boot(fakeStorage(), 'zh');
    clickIn(one(allow.overlay, '.onboarding-lang-btn[data-lang="zh"]'));
    clickIn(one(allow.overlay, '.onboarding-grant'));
    expect(allow.store.consent(), '点允许之后不是 allowed').toBe('allowed');
    expect(one(allow.overlay, '.onboarding-grant').dataset.picked, '允许按钮没有被标记为已选').toBe('1');
    expect(one(allow.overlay, '.onboarding-deny').dataset.picked, '没点的那个按钮也被标记了').toBeUndefined();
    // 再点一次"不用"：结论不许被改（用户已经表过态了）
    clickIn(one(allow.overlay, '.onboarding-deny'));
    expect(allow.store.consent(), '重复点击把结论改掉了（允许之后又点了不用）').toBe('allowed');
    expect(visibleStep(allow.overlay), '重复点击把步数弄乱了').toBe('3');

    // ② 不用（游客模式）
    const deny = boot(fakeStorage(), 'zh');
    clickIn(one(deny.overlay, '.onboarding-lang-btn[data-lang="zh"]'));
    clickIn(one(deny.overlay, '.onboarding-deny'));
    expect(deny.store.consent(), '点不用之后不是 denied（游客模式）').toBe('denied');
    expect(one(deny.overlay, '.onboarding-deny').dataset.picked, '不用按钮没有被标记为已选').toBe('1');
  });

  it('「隐私说明」就地展开：逐行等于 `privacy.ts` 的 `privacyLines()`（唯一出处）', () => {
    restores.push(installStubDom());
    const b = boot(fakeStorage(), 'zh');
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="zh"]'));
    const detail = one(b.overlay, '.onboarding-privacy-full');
    expect(detail.children.length, '还没点就展开了隐私说明').toBe(0);
    clickIn(one(b.overlay, '.onboarding-privacy'));
    expect(attrOf(one(b.overlay, '.onboarding-privacy'), 'aria-expanded'), 'aria-expanded 没跟上')
      .toBe('true');
    const lines = queryAllIn(b.overlay, '.onboarding-privacy-line').map((p) => p.text);
    // ⚠️ 「隐私说明」按钮展开的是**授权那三段**（与旧弹窗同口径：`CONSENT_COPY.body`），
    //   不是「本地数据与隐私」整屏的十三句。两份都由 `privacy.ts` 那份唯一出处派生，
    //   但**用途不同** ⇒ 这里断言的是三段那一份（写死段数，免得"两件事混成一件"）。
    expect(lines, '展开的说明不是旧弹窗那份三段（授权正文）').toEqual([...CONSENT_COPY.body]);
    expect(lines.length, '展开的说明段数不是 3').toBe(3);
    // 反向锚点：这一份与"第 2 步正文那一段"是**同一份**（同一个注入函数），不是第二份手写文案
    const step2Lines = queryAllIn(b.overlay, '.onboarding-consent-line').map((p) => p.text);
    expect(lines, '展开的那一份与第 2 步正文那一段不是同一份').toEqual(step2Lines);
    // 反向：再点一次收起来
    clickIn(one(b.overlay, '.onboarding-privacy'));
    expect(attrOf(one(b.overlay, '.onboarding-privacy'), 'aria-expanded')).toBe('false');
    expect(queryAllIn(b.overlay, '.onboarding-privacy-line').length, '再点一次没有收起来').toBe(0);
  });
});

/* ───────────── 3. 授权门控的顺序：第 2 步才落盘（含第 1 步选的语言） ───────────── */

describe('授权门控的顺序：同意之前零写入，同意之后**第 1 步选的语言一起落盘**', () => {
  it('第 1 步选语言：内存态立刻变，**盘上一个字节都不写**（红线 3）', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();
    const b = boot(ls, 'zh');
    expect(ls.snapshot(), '启动那一刻盘上就有东西了').toEqual({});
    clickIn(one(b.overlay, '.onboarding-lang-btn[data-lang="en"]'));
    expect(getLang(), '第 1 步选语言没有立刻换内存态（第 2 步就得用新语言显示）').toBe('en');
    expect(ls.snapshot(), '还没同意保存就把语言写盘了（红线 3）').toEqual({});
  });

  it('★★ 第 2 步点「允许」之后，走完向导 ⇒ 盘上**同时**有 `lang:"en"` 与 `onboardingSeen:true`', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();
    const b = boot(ls, 'zh');
    walkToStep3(b, { lang: 'en', allow: true, nick: '小明' });
    clickIn(one(b.overlay, '.onboarding-skip-tutorial'));

    const raw = ls.snapshot()['compile-settings'];
    expect(raw, '走完向导之后设置没落盘').toBeDefined();
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    // ★ 这条是本轮最容易做错的地方：第 1 步选的语言**必须**在这里一起写下去
    expect(parsed.lang, '第 1 步选的英文没有跟着落盘（选英文 → 同意保存 → 刷新回中文）').toBe('en');
    expect(parsed.nick, '昵称没落盘').toBe('小明');
    expect(parsed.onboardingSeen, '"只出现一次"的标记没落盘').toBe(true);
    // 反向：标记真的在**既有的** L1 设置里（没有新增存储键）
    expect(Object.keys(ls.snapshot()).sort(),
      '存储键多了一个（标记应当住在既有的 compile-settings 里）')
      .toEqual(['compile-consent', 'compile-settings']);
    // 读侧与写侧同一套守卫
    expect(readOnboardingSeen(b.store), 'readOnboardingSeen 读不回刚才写的标记').toBe(true);
    expect(readLang(b.store), 'readLang 读不回刚才写的语言').toBe('en');
    expect(readNickName(b.store), 'readNickName 读不回刚才写的昵称').toBe('小明');
  });

  it('★★ 游客模式（第 2 步点「不用」）：语言与标记都只进内存 —— 盘上零写入，刷新后向导**再出现**', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();
    const b = boot(ls, 'zh');
    walkToStep3(b, { lang: 'en', allow: false, nick: '小明' });
    clickIn(one(b.overlay, '.onboarding-skip-tutorial'));

    expect(b.store.consent(), '游客模式的授权状态不对').toBe('denied');
    // 本次会话有效（内存 KV）
    expect(getLang(), '游客模式下本次会话没有用新语言').toBe('en');
    // 但**磁盘上一个字节都不写**（红线 3）—— 这正是"刷新后向导会再出现"的机制
    expect(ls.snapshot(), '游客模式下走完向导竟然写了盘（红线 3）').toEqual({});
    expect(readOnboardingSeen(b.store), '游客模式下标记进了磁盘').toBe(true); // 内存里是 true

    // 刷新：全新 store + 同一份空磁盘 ⇒ 标记读不回来 ⇒ 向导会再出现
    setLang(DEFAULT_LANG);
    const after = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
    initI18n(() => readLang(after));
    expect(readOnboardingSeen(after), '游客模式下标记活过了刷新（那"零写入"就是假的）').toBe(false);
    expect(after.consent(), '游客模式的授权状态活过了刷新').toBe('unknown');
  });

  it('清除本机数据 ⇒ 标记一起被清掉 ⇒ 第二次启动**向导再出现一次**（用户口径）', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();

    // 第一次走完（允许保存）
    const first = boot(ls, 'zh');
    walkToStep3(first, { lang: 'zh', allow: true, nick: '甲' });
    clickIn(one(first.overlay, '.onboarding-skip-tutorial'));
    expect(readOnboardingSeen(first.store), '前置：第一次没写上标记，后面的"再出现"就没意义').toBe(true);

    // 第二次启动：标记在 ⇒ 不再出现（宿主那一侧的判据由最后一组的源码腿钉住）
    const second = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
    initI18n(() => readLang(second));
    expect(readOnboardingSeen(second), '第二次启动标记丢了').toBe(true);

    // 「清除本机数据」：与 `src/ui/local-data.ts` 的 `doClear` **同一条路**
    //   （`clearAllLocalData(store.kv())` 清键 → `store.reset()` 把授权打回 unknown）
    const removed = clearAllLocalData(second.kv());
    second.reset();
    expect(removed, '清除本机数据一个键都没清掉').toBeGreaterThan(0);
    expect(readOnboardingSeen(second), '清除本机数据没有把"已读过向导"一起清掉').toBe(false);
    expect(ls.snapshot()['compile-settings'], '清除之后盘上还留着设置整键').toBeUndefined();
    expect(second.consent(), '清除之后授权状态没回到 unknown（那向导就不会再出现）').toBe('unknown');
  });

  it('宿主那两句写盘调用是**同一条路**：坏值 / 写失败退回"还没走过"或"本次会话有效"，不抛', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();
    const store = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
    store.grant();
    // 坏值（外部手改 / 别的程序写了同一个键）：不许被垃圾值锁死成"已经走过"
    ls.setItem('compile-settings', JSON.stringify({ onboardingSeen: 'yes' }));
    expect(readOnboardingSeen(store), '坏值被当成了"已经走过" ⇒ 向导再也出不来').toBe(false);
    ls.setItem('compile-settings', '{"onboardingSeen":'); // 坏 JSON
    expect(readOnboardingSeen(store), '坏 JSON 时应当退回"还没走过"').toBe(false);
    // 写失败（存储只读）：回结构化结论而不是抛；本次会话仍然记得
    const original = ls.setItem;
    ls.setItem = (k: string, v: string): void => {
      if (k === 'compile-settings') throw new Error('QuotaExceededError: The quota has been exceeded.');
      original(k, v);
    };
    const out = writeOnboardingSeen(store, true);
    expect(out.ok, '写失败却回了成功').toBe(false);
    if (!out.ok) expect(out.reason, '写失败的原因不是 write-failed').toBe('write-failed');
  });
});

/**
 * `src/main.ts` 的**代码位**（剥注释）。
 *
 * ⚠️ 位置：声明在**测试体之前**（而不是第 4 组那里）—— 第 2 组那条"宿主注入的三句"的腿也要用它。
 * 放在后面虽然也能跑（`it` 回调在模块求值完之后才执行），但那会让判据依赖 hoisting 的时机，
 * 读代码的人要绕一圈才明白。这里一次说清。
 */
const MAIN_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8'),
);

/** 某个函数的函数体（从 `function <名>(` 起，用大括号配平切到闭合那一行） */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`function ${name}(`);
  expect(at, `main.ts 里找不到 function ${name}(`).toBeGreaterThan(0);
  let i = code.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return code.slice(start, i + 1);
}

/* ───────────────────────── 1. 三步的顺序与可见性 ───────────────────────── */

/* ───────────── 4. 宿主接线（`src/main.ts`）：源码结构腿 ───────────── */

describe('★ 宿主接线：启动门 → 向导（源码结构腿）', () => {
  it('启动门：**没走过向导** ⇒ 挂向导；走过了才走旧弹窗那条路（不出现两连问）', () => {
    const body = bodyOf(MAIN_CODE, 'showStartScreen');
    // 判据：向导那条分支必须同时看"授权还未知"与"向导还没走过"
    expect(body, '启动门里没有读"向导走过了吗"').toMatch(/readOnboardingSeen\s*\(\s*localStore\s*\)/);
    expect(body, '启动门里没有挂向导').toMatch(/showOnboarding\s*\(\s*\)/);
    expect(body, '启动门里没有旧弹窗那条路（向导中途关标签页的人还要有个地方问）')
      .toMatch(/renderLocalConsent\s*\(\s*root/);
    // 顺序：向导那一支必须**早于**旧弹窗那一支（否则新玩家会先看到旧弹窗）
    expect(
      body.indexOf('showOnboarding()'),
      '向导那一支排在旧弹窗后面 ⇒ 新玩家会先被旧弹窗问一次（正是用户要消掉的"两连问"）',
    ).toBeLessThan(body.indexOf('renderLocalConsent('));
  });

  it('`showOnboarding` 把遮罩挂到 `document.body`，走完时移除（幂等，不留第二层）', () => {
    const body = bodyOf(MAIN_CODE, 'showOnboarding');
    expect(body, '没有真的造向导元素').toMatch(/onboardingOverlayElement\s*\(/);
    expect(body, '没有挂到 document.body').toMatch(/document\.body\.appendChild\s*\(/);
    expect(body, '没有移除遮罩（走完之后首页上面会一直盖着一层）').toMatch(/\.remove\s*\(\s*\)/);
    expect(body, '不是幂等的（连点两次会留下第二层遮罩）')
      .toMatch(/querySelector\s*\(\s*'\.onboarding-overlay'\s*\)/);
    // 授权状态机的那一步必须在（向导第 2 步的允许/不用要落到同一个 reducer 上）
    expect(body, '向导没有把第 2 步接到授权状态机上').toContain("consentStep('grant')");
    expect(body, '向导没有把第 2 步接到授权状态机上').toContain("consentStep('deny')");
  });

  it('`finishOnboarding`：先落语言（**第 1 步选的那个**）与昵称，再落标记，最后去首页', () => {
    const body = bodyOf(MAIN_CODE, 'finishOnboarding');
    expect(body, '没有落盘语言').toMatch(/writeLang\s*\(\s*localStore\s*,\s*outcome\.lang\s*\)/);
    expect(body, '没有落盘昵称').toMatch(/writeNickName\s*\(\s*localStore\s*,\s*outcome\.nick\s*\)/);
    expect(body, '没有落"只出现一次"的标记').toMatch(/writeOnboardingSeen\s*\(\s*localStore\s*,\s*true\s*\)/);
    // 顺序：语言/昵称必须在标记之前（"标记写了、设置还没写"这个中间态最坏）
    expect(body.indexOf('writeLang('), '语言落盘排在标记之后').toBeLessThan(body.indexOf('writeOnboardingSeen('));
    expect(body.indexOf('writeNickName('), '昵称落盘排在标记之后').toBeLessThan(body.indexOf('writeOnboardingSeen('));
    // 昵称留空不许写（别把已有昵称抹成空串）
    expect(body, '昵称没有"留空就不写"的守卫').toMatch(/outcome\.nick\.trim\(\)\s*!==\s*''/);
    // 最后去首页；「开始教学」只给一句"待开发"（教学模式是 P2 的事）
    expect(body, '走完向导没有去首页').toMatch(/showHome\s*\(/);
    expect(body, '「开始教学」没有给出"待开发"的提示').toMatch(/toast\.tutorial/);
  });

  it('首页那条"待发提示"接缝：由首页在**画完之后**发（先提示会被 clearRoot 闪掉）', () => {
    const body = bodyOf(MAIN_CODE, 'showHome');
    expect(body, '首页没有接住向导带过来的那一句提示').toMatch(/initialToast/);
    // `initialToast` 必须交给 `renderHome`（不能再自己 `document.body.appendChild` 一个 toast：
    // 那种写法会在同一个 tick 里被 `clearRoot` 重画闪掉）
    expect(body, '提示没有交给首页的渲染入口').toMatch(/renderHome\s*\(\s*root\s*,\s*\{[\s\S]*?initialToast/);
  });
});

/* ───────────── 5. 版式与宿主契约（源码腿）：遮罩真的占满整屏、类名不打架 ───────────── */

const CSS_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/ui/styles-local.css', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8'),
);

/** 某条 CSS 规则体（`选择器 {` 到配平的 `}`） */
function cssBlock(code: string, selector: string): string {
  const at = code.indexOf(`${selector} {`);
  expect(at, `styles-local.css 里找不到规则 ${selector}`).toBeGreaterThan(0);
  let i = code.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return code.slice(start, i + 1);
}

describe('版式与宿主契约：遮罩占满整屏、类名与既有 CSS 零冲突', () => {
  it('`.onboarding-overlay` 是**整屏遮罩**（fixed + inset:0 + 不透明底 + 高层级）', () => {
    const block = cssBlock(CSS_CODE, '.onboarding-overlay');
    expect(block, '遮罩不是 fixed 定位（那就不叫遮罩了）').toMatch(/position:\s*fixed/);
    expect(block, '遮罩没有铺满整屏（inset 不是 0）').toMatch(/inset:\s*0\b/);
    expect(block, '遮罩没有不透明底色（首页内容会透出来）').toMatch(/background:\s*#0b0b16/);
    const z = /z-index:\s*(\d+)/.exec(block);
    expect(z, '遮罩没有 z-index').not.toBeNull();
    // 必须高过本文件里**所有**其它 z-index（否则某一层浮层会盖在向导上面）
    const others = [...CSS_CODE.matchAll(/z-index:\s*(\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((v) => v !== Number(z?.[1]));
    expect(Number(z?.[1]), '遮罩的 z-index 不是本文件里最高的（会被别的浮层盖住）')
      .toBeGreaterThan(Math.max(...others));
  });

  it('`.onboarding-step[hidden]` 有显式的 display:none（本仓栽过"作者样式压掉 hidden"）', () => {
    // 本仓先例：`.cardmaker-field[hidden] { display: none; }` 与 `styles.css:1825` 的注释 ——
    // 只要某一步的类名上挂了 `display:flex`，`element.hidden = true` 就**完全不生效**，
    // 屏上会同时显示三步。这条腿是"三步互斥"在**真浏览器**里成立的机械保障
    // （单测只能证明 `hidden` 属性被设对了，证明不了它真的藏得住）。
    expect(CSS_CODE, '没有 `.onboarding-step[hidden]` 这条兜底规则 ⇒ 真浏览器里三步可能同时显示')
      .toMatch(/\.onboarding-step\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it('`.onboarding-*` 这一族类名在**其余** CSS 里零命中（不打架）', () => {
    // 生成式发现：`src/ui/*.css` 里除本文件之外的全部（不写文件名清单 —— 新加一份 CSS
    // 也会被覆盖到，那正是"两份定义打架"最可能的来路）
    const dir = fileURLToPath(new URL('../../src/ui/', import.meta.url));
    const others = readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'styles-local.css');
    expect(others.length, '除本文件外一份 CSS 都没读到 ⇒ 扫描面塌了').toBeGreaterThan(5);
    const onboardingClasses = new Set(
      [...CSS_CODE.matchAll(/\.(onboarding-[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    expect(onboardingClasses.size, '本文件的 onboarding 类名少得离谱（正则失效？）').toBeGreaterThan(10);
    for (const f of others) {
      const text = readFileSync(`${dir}${f}`).subarray(0, 4 * 1024 * 1024).toString('utf8');
      const hits = [...onboardingClasses].filter((c) => text.includes(c));
      expect(hits, `${f} 里也定义了这些 onboarding 类名（两份定义会打架）：${hits.join(', ')}`).toEqual([]);
    }
  });

  it('宿主契约：屏只造元素（不碰存储 / 不碰 #app / 自己不去挂 body）', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/ui/onboarding.ts', import.meta.url)))
      .subarray(0, 1024 * 1024).toString('utf8');
    const code = stripComments(src);
    // 与 `local-consent.ts` 同一条纪律：一切读写都经 `nav` 由宿主做
    expect(code, '屏里出现了存储实现（它只许造元素）').not.toMatch(/localStorage|indexedDB|writeJson|writeSettings/);
    expect(code, '屏自己去挂 document.body 了（挂载是宿主的活）').not.toMatch(/document\.body/);
    // ⚠️ 它**引用了** `CONSENT_COPY`（唯一出处那条链），但**没有**直接 import privacy.ts：
    //    隐私说明全文由宿主注入（`privacyLinesOf`），于是这个屏能在 node 下喂合成行真跑。
    expect(code, '屏直接 import 了 privacy.ts（说明全文应当由宿主注入）').not.toMatch(/from '\.\.\/app\/privacy'/);
    expect(code, '屏没有用 `t()` 取文案（那它就不是双语的）').toMatch(/\bt\('onboarding\./);
  });
});

