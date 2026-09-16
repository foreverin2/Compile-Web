/**
 * 首次进入的**授权弹窗**（G3；见 docs/2026-09-13-联机与多端-设计稿.md §3.6）。
 *
 * 用户需求原文（§0.5 第 5 条）："首次打开询问是否允许本机保存卡组/昵称/设置；服务器不存"。
 * 三条硬要求：
 *  1. **同意之前零写入**（红线 3）—— 本文件**只**渲染与回调，不碰任何存储；
 *     （机检：tests/ui/local-consent.test.ts 的"源码腿"扫整个模块的代码位，
 *      `localStorage` / `indexedDB` / `sessionStorage` 零命中。）
 *  2. 拒绝 = 游客模式：全部功能可用，刷新即丢（文案必须说清后果）；
 *  3. 文案与 `src/app/privacy.ts` **同源**（不得另写一份措辞）—— `CONSENT_COPY` 里那句
 *     隐私声明**逐字**取自 `PRIVACY_COPY.noServerStorage[0]`，Task 9 有"两处不得分叉"的守卫。
 *     屏上「隐私说明」按钮**就地展开**的那份完整说明同样**生成式**取自 `privacyLines()`
 *     （一条都不手写、不截断），见 `renderPrivacyDetail`。
 *  4. 「隐私说明」按钮**不许是死胡同**（阶段一评审：可点但毫无反应）—— 它必须当场展开
 *     完整隐私说明；`tests/ui/local-consent.test.ts` 有一条**行为腿**逐条比对展开内容
 *     与 `privacyLines()`。
 *
 * 形态：**整屏屏**（调用方先 `root.textContent = ''`，本函数自己也清一次），
 * **不是** `position:fixed` 覆盖层 —— 本仓有过 `document.body` 级浮层残留的惨痛历史。
 */
import type { ConsentState } from '../app/local-store';
import { PRIVACY_COPY, privacyLines } from '../app/privacy';

export interface ConsentNav {
  /** 用户点「允许」：此后才允许落盘（`main.ts` 的 `consentStep('grant')`） */
  onGrant(): void;
  /** 用户点「拒绝」：本次会话走游客模式，**零写入** */
  onDeny(): void;
  /**
   * 用户点「隐私说明」。
   *
   * ⚠️ 这个按钮**不是**死胡同：屏上已就地展开完整隐私说明（见 `renderPrivacyDetail`，
   * 唯一出处 = `privacyLines()`），本回调只是给宿主的**接缝** —— Task 7 的
   * 「本地数据与隐私」**整屏**接管时用它换页；在那之前宿主是空实现也不会让按钮失灵。
   */
  openPrivacy(): void;
}

export interface ConsentCopy {
  title: string;
  /** 逐段渲染成 `<p>`（顺序 = 屏幕上的阅读顺序） */
  body: string[];
  grant: string;
  deny: string;
  /** 拒绝的**后果**（必须说清"刷新或关闭即全部丢失"与"随时可改"） */
  denyHint: string;
  privacyLink: string;
}

/**
 * 文案。基调按用户裁决 #6 =**中性陈述 + 明确后果**。
 *
 * ⚠️ `body[1]` 是**引用** `PRIVACY_COPY`，**不是**手写串：两处文案只允许有一个出处
 * （`src/app/privacy.ts`，它同时对齐设计稿 §0.4 红线 1 与 §5.9）。手写第二份措辞
 * 会让"不实陈述"在两处之间悄悄分叉，而门禁全绿。
 */
export const CONSENT_COPY: ConsentCopy = {
  title: '要不要在这台设备上记住你的设置？',
  body: [
    '允许后，昵称、游戏设置与卡组会保存在你自己的浏览器里（可以随时清除）。',
    PRIVACY_COPY.noServerStorage[0],
    '不允许也能正常游玩全部内容：本次游戏的所有数据只存在内存里，刷新或关闭页面就全部丢掉。',
  ],
  grant: '允许，保存在这台设备',
  deny: '不用，本次不保存',
  denyHint: '你随时可以在主界面的「本地数据与隐私」里改变这个选择。',
  privacyLink: '隐私说明',
};

/**
 * 授权状态机的**纯 reducer**（`main.ts` 的 `consentStep()` 只负责把结果落回 `LocalStore`，
 * 规则本身只有这一处）。返回**下一个状态**，不做任何副作用。
 *
 * | 状态 | `show` | `grant` | `deny` | `reset` |
 * |---|---|---|---|---|
 * | `unknown` | `ask` | `allowed` | `denied` | `unknown` |
 * | `ask` | `ask`（幂等） | `allowed` | `denied` | `unknown` |
 * | `allowed` | `allowed`（**不重弹**） | `allowed` | `denied` | `unknown` |
 * | `denied` | `denied`（本次会话不再问，见用户裁决 #5：标记只在内存） | `allowed` | `denied` | `unknown` |
 */
export function nextConsentStep(s: ConsentState, action: 'show' | 'grant' | 'deny' | 'reset'): ConsentState {
  switch (action) {
    case 'show': return s === 'unknown' ? 'ask' : s;
    case 'grant': return 'allowed';
    case 'deny': return 'denied';
    case 'reset': return 'unknown';
  }
}

/**
 * 把**完整**隐私说明逐行渲染进 `host`（`expanded === false` 时清空它）。
 *
 * 唯一出处是 `src/app/privacy.ts` 的 `privacyLines()` —— 本文件**不**写第二份措辞、
 * 也**不**挑几条（"两处文案分叉"是本仓反复栽过的形态，见文件头注第 3 条）。
 * 逐条来自函数当前返回值（生成式），所以 `privacy.ts` 新增/改动一条文案会**自动**出现在屏上。
 *
 * 为什么"默认不渲染"而不是"渲染好再 `display:none`"：后者在无布局引擎的 DOM 桩上
 * 与"已展开"不可区分 ⇒ 行为腿会退化成恒真。空容器 + 点开才填充，让"点之前屏上是空的"
 * 本身成为可断言的事实。
 */
function renderPrivacyDetail(host: HTMLElement, expanded: boolean): void {
  host.textContent = '';
  if (!expanded) return;
  for (const line of privacyLines()) {
    const p = document.createElement('p');
    p.textContent = line;
    host.appendChild(p);
  }
}

/**
 * 画出授权屏（整屏屏）。**本函数不碰任何存储**：它只建元素、挂回调；
 * "允许"之后该写什么由 `nav.onGrant` 的调用方（`main.ts`）决定。
 */
export function renderLocalConsent(root: HTMLElement, nav: ConsentNav): void {
  root.textContent = '';
  const screen = document.createElement('div');
  screen.className = 'consent-screen';

  const h = document.createElement('h1');
  h.className = 'consent-title';
  h.textContent = CONSENT_COPY.title;
  screen.appendChild(h);

  const body = document.createElement('div');
  body.className = 'consent-body';
  for (const line of CONSENT_COPY.body) {
    const p = document.createElement('p');
    p.textContent = line;
    body.appendChild(p);
  }
  screen.appendChild(body);

  const hint = document.createElement('p');
  hint.className = 'consent-hint';
  hint.textContent = CONSENT_COPY.denyHint;
  screen.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'consent-actions';

  const grant = document.createElement('button');
  grant.type = 'button';
  grant.className = 'btn consent-grant';
  grant.textContent = CONSENT_COPY.grant;
  grant.addEventListener('click', () => nav.onGrant());
  actions.appendChild(grant);

  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'btn consent-deny';
  deny.textContent = CONSENT_COPY.deny;
  deny.addEventListener('click', () => nav.onDeny());
  actions.appendChild(deny);

  screen.appendChild(actions);

  // 完整隐私说明的**就地展开**容器：默认空（不占位），点按钮才填充。
  const detail = document.createElement('div');
  detail.className = 'consent-privacy-full';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'btn-link consent-privacy';
  link.textContent = CONSENT_COPY.privacyLink;
  link.setAttribute('aria-expanded', 'false');

  let expanded = false;
  link.addEventListener('click', () => {
    expanded = !expanded;
    link.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    renderPrivacyDetail(detail, expanded);
    // 宿主接缝（Task 7 换到整屏）；**不是**这个按钮的全部作用 —— 内容已就地展开
    nav.openPrivacy();
  });

  screen.appendChild(link);
  screen.appendChild(detail);

  root.appendChild(screen);
}
