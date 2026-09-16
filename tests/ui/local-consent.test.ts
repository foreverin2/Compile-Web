import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  installStubDom,
  makeStubEl,
  descendants,
  queryAllIn,
  isClass,
  type StubNode,
} from './net-dom-stub';
import { CONSENT_COPY, nextConsentStep, renderLocalConsent, type ConsentCopy } from '../../src/ui/local-consent';
import { PRIVACY_COPY, privacyLines } from '../../src/app/privacy';
import { createLocalStore, type ConsentState } from '../../src/app/local-store';
import { stripComments, functionBody } from './source-text';

/**
 * G3 Task 4 守卫：首次进入的**授权弹窗**（红线 3 的机检形态）。
 *
 * ## 本文件证明什么 / 不能证明什么（**不要读成"运行时已验证"**）
 *  **能**：
 *   1. `nextConsentStep` 的每一条转移（纯 reducer，真跑一次拿返回值）；
 *   2. `renderLocalConsent` 在**真 DOM 桩**上渲染出的元素树、三个按钮各自的回调被调到哪一个
 *      （`dispatchEvent` 真派发 + 真调用产出代码注册的监听器，不是"读源码找字符串"）；
 *   3. `CONSENT_COPY` 的隐私声明行与 `src/app/privacy.ts` 的 `PRIVACY_COPY` **同源**
 *      （**生成式**遍历 `PRIVACY_COPY.noServerStorage`，不在本文件里手写第二份文案）；
 *   4. `src/ui/local-consent.ts` 里**没有**任何存储写入（文本腿，见第 4 组的"为什么非文本不可"）。
 *  **不能**：真实浏览器里的观感（整屏屏好不好看）、真实 `localStorage` 到底写没写
 *  （那需要无头浏览器，计划 Task 4 Step 8；本文件只证明**本文件这一层**零写入）。
 *
 * ⚠️ 桩用**现成的** `tests/ui/net-dom-stub.ts`（`installStubDom()` 往全局装 `document`）。
 *   计划 Step 1 骨架里的 `makeStubRoot()` / 两个 `throw new Error(...)` 是**有意的占位提醒**；
 *   真实导出里**没有** `makeStubRoot`，所以这里用 `installStubDom()` + `makeStubEl('div')`。
 *   本文件**不**复制第二份桩（本仓已因"两份拷贝漂移"栽过，见 `net-dom-stub.ts:4-7`）。
 */

/* ---------------- 小助手：只用 net-dom-stub 的**已有**导出（不复制桩） ---------------- */

/** 装桩 DOM 的还原函数（`afterEach` 里调；避免 `document` 漏到别的用例）。 */
let restoreDom: (() => void) | null = null;

/** 装一个最小 `document`，并造一个**未挂到 document.body 上**的渲染根（弹窗的路由根）。 */
function mountRoot(): StubNode {
  restoreDom = installStubDom();
  return makeStubEl('div');
}

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/** 渲染根的纯文本（按 DOM 顺序拼接全部节点的文本）——判"文案有没有出现在弹窗里"。 */
function textOf(root: StubNode): string {
  return descendants(root).map((n) => n.text).join('\n');
}

/** 按类名找唯一的那个 `<button>`；找不到就**响亮**报错（而不是让后续断言在 undefined 上假绿）。 */
function buttonOf(root: StubNode, cls: string): StubNode {
  const hits = queryAllIn(root, `button.${cls}`);
  expect(hits.map((n) => n.text), `弹窗里应有唯一一个 <button class="${cls}">`).toHaveLength(1);
  return hits[0];
}

/**
 * 在弹窗里**真派发一次点击**（行为腿的关键动作），并返回真正的点击落点。
 *
 * ⚠️ **桩的能力边界（本项目实测，不是猜的）**：`net-dom-stub.ts` 的 `dispatchEvent`
 * 只把事件沿 `parentElement` 往**祖先**冒泡，**不调用"派发节点自己"的监听器**
 * （实测：把 `click` 派发到按钮自身时，按钮的监听器一次都不被调到，而父节点的会被调到）。
 * 所以直接在 `<button>` 上派发**不会**触发它自己的 click 监听器 —— 那会让本文件的
 * "点了拒绝调 onDeny"变成假红，或更糟：有人为了变绿把判据降级成"读源码找字符串"。
 *
 * 做法：给按钮**临时挂一个空的桩子节点**（`<span>`，无文本、无类名），在**它**上面派发
 * —— 冒泡路径必然**经过**那个按钮，于是被调用的是产出代码真正注册在按钮上的那个监听器
 * （不是测试重新实现一套事件语义）。派发完**立刻摘掉**这个临时子节点，
 * 以免它污染后续的 `descendants` 遍历（`textContent = ''` 会解除父子指针）。
 *
 * 返回落点与**冒泡路径上被经过的那个按钮**（后者在清理临时子节点后会失去 `parentElement`，
 * 所以必须在派发的那一刻捕获），供调用方断言"点到的是我以为的那个按钮"（防"点错按钮"假绿）。
 */
function clickIn(root: StubNode, cls: string): { target: StubNode; button: StubNode; label: string } {
  const btn = buttonOf(root, cls);
  const label = btn.text; // 清理会把 textContent 清空，所以先记下来
  const clicker = makeStubEl('span');
  btn.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  btn.textContent = ''; // 摘掉临时子节点：它只用于让冒泡路径经过按钮
  return { target: clicker, button: btn, label };
}

/** 把 nav 的三条回调记成调用序列（判"点了哪个按钮"用**调用记录**，不读源码）。 */
function recorder(): { calls: string[]; nav: { onGrant(): void; onDeny(): void; openPrivacy(): void } } {
  const calls: string[] = [];
  return {
    calls,
    nav: {
      onGrant: () => calls.push('grant'),
      onDeny: () => calls.push('deny'),
      openPrivacy: () => calls.push('privacy'),
    },
  };
}

const noopNav = { onGrant: () => {}, onDeny: () => {}, openPrivacy: () => {} };

/**
 * 文案字段 → 该字段落点的**选择器**（**生成式**：Task 4 明写的"每个文案字段必须有落点"
 * 由这张表 + `CONSENT_COPY` 的键派生出判据，而不是在测试里手写一遍文案清单）。
 */
const COPY_SELECTOR: Record<keyof ConsentCopy, string> = {
  title: 'h1.consent-title',
  body: 'div.consent-body',
  grant: 'button.consent-grant',
  deny: 'button.consent-deny',
  denyHint: 'p.consent-hint',
  privacyLink: 'button.consent-privacy',
};

/* ---------------- 1. 纯 reducer：真跑一次拿返回值 ---------------- */

describe('授权状态机的纯 reducer', () => {
  it('unknown → show → ask；ask → deny → denied；denied → reset → unknown', () => {
    expect(nextConsentStep('unknown', 'show')).toBe('ask');
    expect(nextConsentStep('ask', 'deny')).toBe('denied');
    expect(nextConsentStep('denied', 'reset')).toBe('unknown');
  });

  it('grant 从任何非 allowed 状态都到 allowed；重复 grant 幂等', () => {
    expect(nextConsentStep('unknown', 'grant')).toBe('allowed');
    expect(nextConsentStep('ask', 'grant')).toBe('allowed');
    expect(nextConsentStep('allowed', 'grant')).toBe('allowed');
    expect(nextConsentStep('denied', 'grant')).toBe('allowed'); // 游客模式改主意 ⇒ 允许
  });

  it('show 不会把 allowed 打回 ask（用户改主意前不该重弹）', () => {
    expect(nextConsentStep('allowed', 'show')).toBe('allowed');
    expect(nextConsentStep('denied', 'show')).toBe('denied');
  });

  it('ask 是幂等的：弹窗已显示时再来一次 show 仍是 ask（不被打回 unknown）', () => {
    expect(nextConsentStep('ask', 'show')).toBe('ask');
    expect(nextConsentStep('unknown', 'show')).toBe('ask');
  });

  it('reset 从任何状态都回 unknown（"清除本机数据"后重新问）', () => {
    for (const s of ['unknown', 'ask', 'allowed', 'denied'] as const) {
      expect(nextConsentStep(s, 'reset'), `reset 从 ${s} 出发没回到 unknown`).toBe('unknown');
    }
  });
});

/* ---------------- 2. 渲染 + 真派发点击（行为腿） ---------------- */

describe('授权弹窗渲染（DOM 桩真跑一次）', () => {
  it('渲染出两个按钮：允许 / 拒绝（文案逐字来自 CONSENT_COPY）', () => {
    const root = mountRoot();
    renderLocalConsent(root as unknown as HTMLElement, noopNav);
    const grant = buttonOf(root, 'consent-grant');
    const deny = buttonOf(root, 'consent-deny');
    expect(grant.text).toBe(CONSENT_COPY.grant);
    expect(deny.text).toBe(CONSENT_COPY.deny);
    expect(grant.text).not.toBe(deny.text);
  });

  it('点「拒绝」会调 onDeny 且**不**调 onGrant；点「允许」反之（两向都断言）', () => {
    const root = mountRoot();
    const { calls, nav } = recorder();
    renderLocalConsent(root as unknown as HTMLElement, nav);
    const deny = buttonOf(root, 'consent-deny');

    // 点之前：一条回调都不许被调到（挂载 ≠ 触发）
    expect(calls, '渲染时就调了回调：' + calls.join(',')).toEqual([]);

    // 拒绝 → 只 deny
    const hitDeny = clickIn(root, 'consent-deny');
    expect(hitDeny.button).toBe(deny);
    expect(hitDeny.label, '点到的是"拒绝"按钮（文案逐字）').toBe(CONSENT_COPY.deny);
    expect(calls, '点拒绝必须只调 onDeny（调了 onGrant 就是把用户的选择反过来）').toEqual(['deny']);

    // 允许 → 只 grant
    calls.length = 0;
    const grant = buttonOf(root, 'consent-grant');
    const hitGrant = clickIn(root, 'consent-grant');
    expect(hitGrant.button, '事件的冒泡路径没经过"允许"按钮').toBe(grant);
    expect(hitGrant.label, '点到的是"允许"按钮（文案逐字）').toBe(CONSENT_COPY.grant);
    expect(calls, '点允许必须只调 onGrant').toEqual(['grant']);
  });

  it('点「隐私说明」调 openPrivacy（且**不**顺手调 grant/deny）', () => {
    const root = mountRoot();
    const { calls, nav } = recorder();
    renderLocalConsent(root as unknown as HTMLElement, nav);
    clickIn(root, 'consent-privacy');
    expect(calls).toEqual(['privacy']);
  });

  it('渲染是**整屏屏**：重复渲染只有一份树（root.textContent = \'\' 先清空）', () => {
    const root = mountRoot();
    renderLocalConsent(root as unknown as HTMLElement, noopNav);
    const first = queryAllIn(root, 'div.consent-screen').length;
    renderLocalConsent(root as unknown as HTMLElement, noopNav);
    expect(first, '第一次渲染就没画出 .consent-screen，后面的判据会恒真').toBe(1);
    expect(queryAllIn(root, 'div.consent-screen').length, '重渲染后出现两份弹窗（不是整屏屏）').toBe(1);
    expect(buttonOf(root, 'consent-grant').text).toBe(CONSENT_COPY.grant);
  });

  it('每个文案字段都有落点（生成式：字段清单来自 CONSENT_COPY，不手写）', () => {
    const root = mountRoot();
    renderLocalConsent(root as unknown as HTMLElement, noopNav);
    const keys = Object.keys(COPY_SELECTOR) as (keyof ConsentCopy)[];
    // 生成式反向：`ConsentCopy` 的每个键都必须在这张表里（漏一个 ⇒ 报红，而不是静默不查）
    expect(keys.slice().sort()).toEqual((Object.keys(CONSENT_COPY) as (keyof ConsentCopy)[]).slice().sort());
    for (const key of keys) {
      const hits = queryAllIn(root, COPY_SELECTOR[key]);
      expect(hits.length, `弹窗缺少 ${COPY_SELECTOR[key]}（CONSENT_COPY.${key} 没有落点）`).toBe(1);
      const node = hits[0];
      if (Array.isArray(CONSENT_COPY[key])) {
        // body 是逐行渲染的：每一行都得真的在树里
        for (const line of CONSENT_COPY.body) {
          expect(descendants(node).map((n) => n.text), `body 的这一行没渲染：${line}`).toContain(line);
        }
      } else {
        expect(node.text, `CONSENT_COPY.${key} 的文案没被渲染`).toBe(CONSENT_COPY[key]);
      }
    }
    // 三个按钮都在（样式表按这些类名写；少了就是没样式的一坨）
    for (const cls of ['consent-grant', 'consent-deny', 'consent-privacy']) {
      expect(descendants(root).filter((n) => isClass(n, cls)).length, `缺少 .${cls}`).toBe(1);
    }
  });
});

/* ---------------- 3. 文案同源（**生成式**，不手写第二份） ---------------- */

describe('文案与 src/app/privacy.ts 同源（Task 9 的"两处文案不得分叉"前置）', () => {
  /** 弹窗必须**逐字**承载的隐私声明行（由 `PRIVACY_COPY` 派生，本文件不写一遍文案）。 */
  const requiredPrivacyLines = [PRIVACY_COPY.noServerStorage[0]];

  it('弹窗里必须出现隐私声明行（逐条由 PRIVACY_COPY 派生，不手写文案）', () => {
    const root = mountRoot();
    renderLocalConsent(root as unknown as HTMLElement, noopNav);
    const text = textOf(root);
    expect(PRIVACY_COPY.noServerStorage.length, 'noServerStorage 为空 ⇒ 本判据恒真').toBeGreaterThan(0);
    expect(requiredPrivacyLines.length, '必须承载的隐私行清单为空 ⇒ 本判据恒真').toBeGreaterThan(0);
    for (const line of requiredPrivacyLines) {
      expect(line, '清单里出现了空串，判据会恒真').not.toBe('');
      expect(text, `弹窗里缺少隐私声明行：${line}`).toContain(line);
      expect(CONSENT_COPY.body, `CONSENT_COPY.body 未逐字引用：${line}`).toContain(line);
      // 逐字出现**且只出现一次**（手写一份近似措辞会让它出现两次，或让它对不上）
      expect(CONSENT_COPY.body.filter((l) => l === line)).toHaveLength(1);
    }
    // 正文每一行都必须真的渲染出来（不许有"定义了但没渲染"的行）
    for (const line of CONSENT_COPY.body) {
      expect(text, `CONSENT_COPY.body 的行没被渲染出来：${line}`).toContain(line);
    }
    expect(text, '拒绝的后果没写清（denyHint 没渲染）').toContain(CONSENT_COPY.denyHint);
    expect(text, '拒绝的后果没写清"刷新或关闭即全部丢失"').toMatch(/刷新或关闭/);
  });

  it('隐私声明行必须是**引用**而不是手写（判别力锚点）', () => {
    // 若 CONSENT_COPY.body 的那一行被改成本地手写串，它就与 PRIVACY_COPY.noServerStorage[0]
    // 不再逐字相等 ⇒ 上一条报红。这里把"逐字相等"这件事本身钉住（防止某天有人把
    // `toContain(精确串)` 放宽成 `toMatch(/没有后端/)` —— 那会让"同源"变成假守卫）。
    expect(CONSENT_COPY.body).toContain(PRIVACY_COPY.noServerStorage[0]);
    expect(CONSENT_COPY.body.filter((l) => l === PRIVACY_COPY.noServerStorage[0])).toHaveLength(1);
    // 反向：本判据不是恒真 —— 构造一个"微改一个字"的串，它必须**不**在 body 里
    const tampered = PRIVACY_COPY.noServerStorage[0].replace('不会', '绝不');
    expect(tampered).not.toBe(PRIVACY_COPY.noServerStorage[0]); // 变异本身生效
    expect(CONSENT_COPY.body, '微改一个字的手写串居然被接受 ⇒ "同源"是假守卫').not.toContain(tampered);
  });

  it('文案基调是中性陈述（不是"警告"也不是"推销"）：正文句子里没有感叹号', () => {
    for (const line of [...CONSENT_COPY.body, CONSENT_COPY.denyHint]) {
      expect(line, `文案带了感叹号，偏离用户裁决 #6 的中性基调：${line}`).not.toContain('！');
      expect(line).not.toContain('!');
    }
  });
});

/* ---------------- 4. 源码腿：弹窗本身不得自带存储写入 ---------------- */

/**
 * **为什么这里非文本腿不可**：`src/ui/local-consent.ts` 的"零写入"是一条**否定的存在性**断言
 * （"这个模块里不存在 localStorage/indexedDB 的写入调用"）。行为腿只能证明"被跑到的那几条
 * 路径"没写；而"某条没被跑到的分支里藏了一句 `localStorage.setItem`"恰恰是红线 3 最危险的
 * 形态（它只在真实浏览器里发作）。所以要扫**整个模块的代码位**（先 `stripComments`：
 * 文件头注里点名写清"不许出现 localStorage"是纪律要求，不该把注释本身变成假红；
 * 也防止注释**满足**判据）。
 */
describe('源码腿：授权弹窗不得自带存储写入', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/ui/local-consent.ts', import.meta.url)))
    .subarray(0, 512 * 1024).toString('utf8');
  const code = stripComments(src);

  it('localStorage / indexedDB / sessionStorage 零命中（写入只能走 app 层的 LocalStore）', () => {
    // 用"调用形态"而非字面命中：注释里可以提这些名字
    expect(code).not.toMatch(/\blocalStorage\s*\./);
    expect(code).not.toMatch(/\bindexedDB\s*\./);
    expect(code).not.toMatch(/\bsessionStorage\s*\./);
    // 反向钉住"扫描本身有效"：本模块必然出现它**该有**的东西（否则上面三条是因为扫了空串而假绿）
    expect(code).toContain('renderLocalConsent');
  });

  it('本模块不 import 任何存储层（只允许 import 类型与文案常量）', () => {
    const imports = [...code.matchAll(/^\s*import[^;]*;/gm)].map((m) => m[0]);
    expect(imports.length, '一个 import 都没有？扫描失效了').toBeGreaterThan(0);
    for (const stmt of imports) {
      expect(
        /from\s+'\.\.\/app\/(privacy|local-store)'/.test(stmt),
        `local-consent.ts 出现了不该有的 import：${stmt.trim()}`,
      ).toBe(true);
    }
  });
});

/* ---------------- 5. 接线腿：main.ts 的启动序列在授权前零写入 ---------------- */

/**
 * **为什么这里非文本腿不可**：这条判的是 `src/main.ts` 里**一个调用点**周围的代码形态 ——
 * "模块级 `openL1Store()` 那一行在授权弹窗之前执行，而它周围不许出现任何存储写入调用"。
 * `main.ts` 是应用入口（一 import 就跑起整个游戏、要真 DOM），行为腿在这里既跑不动、
 * 也证明不了"没被走到的那条分支里没有 set"；而被判的**主体**恰恰是一行**源码**。
 * 判据取自协调者插话（Task 3 修复轮的最终语义）：`openL1Store()` = **只读**探测
 * （访问 localStorage + getItem；不发生任何 set/remove），写探针搬到用户点「允许」那一刻
 * 的 `createLocalStore.grant()` 内。
 */
describe('接线腿：main.ts 在授权弹窗前不写盘（文本腿，见上面的理由）', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8');
  const DECL = 'const localStore = createLocalStore({ persistent: openL1Store() });';
  const at = src.indexOf(DECL);
  /** 该行的**文档注释块 + 声明行**（注释块由声明行向前回溯到最近的 `/**`）。 */
  const region = at < 0 ? '' : src.slice(src.lastIndexOf('/**', at), at + DECL.length);

  it('锚点存在（否则后面每条判据都会在空串上恒真）', () => {
    expect(at, 'main.ts 里找不到模块级 localStore 声明（锚点假设失效）').toBeGreaterThan(-1);
    expect(region, '取到的是空区域 ⇒ 后面的判据全是假绿').toContain('openL1Store');
  });

  it('该段代码里没有 setItem / removeItem / 任何存储写入形态', () => {
    const code = stripComments(region);
    expect(code, '该段的代码位里不该出现 localStorage 对象').not.toMatch(/\blocalStorage\b/);
    for (const t of ['setItem', 'removeItem']) {
      expect(code, `授权弹窗之前的探测里出现了 ${t}（那就是先写盘再问 = 违反红线 3）`).not.toContain(t);
    }
    expect(code, '该段出现了就地写存储的形态').not.toMatch(/\.(set|remove|delete)\s*\(/);
    // 反向：本段必须**仍然**是"取 L1 后端"那一句（防"把整段删掉"式假绿）
    expect(code).toContain('openL1Store()');
  });

  it('这段注释不许出现"探测/只读却不写盘"式的自我安慰（协调者插话 #1 的形态）', () => {
    // 判据的来历：原注释写「只是探测……不写任何用户数据」，而当时 `pickNamedStore` 真的
    // `setItem('__l1_probe__','1')` ⇒ 注释在为红线违规做自我安慰。
    // 这里把那个**具体措辞形态**钉死（不是泛泛禁止"写"字：注释里必须能说明"不许 set/remove"）。
    const falseClaim = /(探测|探针|probe|只读)[^。；\n]{0,20}(不写|零写入|没有写入|没有任何写入|不落盘)|(不写任何|零写入)[^。；\n]{0,12}(数据|磁盘|存储)/;
    expect(region, '注释里又出现了"探测却不写盘"式的自我安慰').not.toMatch(falseClaim);
    // 反向：注释必须**明说**这条纪律（否则上面那条可以被"删光注释"满足）
    expect(region, '注释必须明说这里不许出现 set/remove').toMatch(/set\s*\/\s*remove|不许出现任何/);
  });
});

/* ---------------- 6. 落点腿：main.ts 的 `consentStep()` 把 reducer 结果落回 LocalStore ---------------- */

/**
 * **为什么这里也只能是文本腿**（理由已由阶段一评审认可）：被判的对象是 `src/main.ts` 里
 * `consentStep()` 的**四个分支各自落到哪个方法**。`main.ts` 是应用入口 —— `import` 它会在
 * 模块求值期真的建 `#app` 根、跑 `createGame()` / `initPwaUpdate()` 一整条启动序列，
 * node（无 jsdom）下当场抛错；即便造出真 DOM，被跑到的那几条路径也只能证明"我跑过的那条"落点对，
 * 证明不了"四个分支的对应关系"—— 而那正是判据的主体，它就是源码形态。
 *
 * ⚠️ 本组补的是**阶段一评审的核心发现 M8**：上一轮那条 main.ts 接线腿只覆盖 `:611` 之后的
 * 13 行窗口 ⇒ 注入到 `consentStep` 里**不红**（评审实测：把 `:619` 的 allowed 分支改成
 * `localStore.ask()`，整份 18 项**全绿**）。
 *
 * 判别力来自两处**派生**（都不是手写清单）：
 *  - 期望的「状态 → 落点方法」映射从**真 `createLocalStore` 的行为**导出
 *    （依次调 ask/grant/deny/reset，看 `consent()` 实际变成什么）；
 *  - `consentStep` 的函数体用共用助手 `functionBody` + `stripComments` 从 main.ts 抽出
 *    （不另写第二份词法扫描）。
 * 本组自带**正控 + 反控**（合成函数体），证明判据既不是恒真、也不是恒假。
 */
describe('落点腿：main.ts 的 consentStep（reducer 结果 → LocalStore 的四个分支）', () => {
  /** 去注释后的 main.ts（`functionBody` 要求先剥注释：本仓函数头注里有花括号样式字符） */
  const mainCode = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
      .subarray(0, 1024 * 1024).toString('utf8'),
  );
  /** `consentStep` 的**函数体**（含函数头） */
  const body = functionBody(mainCode, 'consentStep');

  /** `LocalStore` 的四个落点方法（这是**接口清单**：TS 会在编译期检查它们确实是 LocalStore 的键）。 */
  const METHOD_ORDER = ['ask', 'grant', 'deny', 'reset'] as const;

  /** 状态 → 落点方法：**从真 store 的行为派生**（依次调一个方法，看 `consent()` 变成什么）。 */
  const reached: ConsentState[] = [];
  const methodFor: Partial<Record<ConsentState, string>> = {};
  {
    const store = createLocalStore({ persistent: null });
    for (const m of METHOD_ORDER) {
      store.reset();
      store[m]();
      const s = store.consent();
      methodFor[s] = m;
      reached.push(s);
    }
  }

  /**
   * 落点违规清单（空数组 = 四个分支都对）。
   *
   * 判据形状（**生成式**，不比对任何手写分支文本）：
   *  1. 第一次 `localStore` 调用必须是 `consent()`（状态从 store 读，不是常量）；
   *  2. `nextConsentStep(...)` 必须拿到 `action`；
   *  3. `localStore.<m>()` 的**集合**必须恰好是那四个方法（多一个/少一个/重复都报）；
   *  4. 每个被 `guard` 认领的状态，其分支必须落到**该状态对应**的方法；
   *  5. 恰有 1 个状态没被 guard 认领，它必须由最后的 `else` 认领、且落到该状态对应的方法。
   * 变量名（`next`）也从源码派生 ⇒ 改名不会让判据静默失效。
   */
  function wiringViolations(text: string): string[] {
    const bad: string[] = [];
    if (text.trim() === '') return ['抽到的函数体是空串（判据会假绿）'];
    const vm = /const\s+([A-Za-z_$][\w$]*)\s*=\s*nextConsentStep\s*\(/.exec(text);
    if (vm === null) return ['函数体里没有 `const <变量> = nextConsentStep(...)`（reducer 不再被调用？）'];
    const v = vm[1];
    if (!/nextConsentStep\s*\([^;]*\baction\b[^;]*\)/.test(text)) bad.push('nextConsentStep(...) 没拿到 action');
    if (!/localStore\s*\.\s*consent\s*\(\s*\)/.test(text)) bad.push('当前状态不是从 localStore.consent() 读的');

    const calls = [...text.matchAll(/localStore\s*\.\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/g)].map((m) => m[1]);
    if (calls[0] !== 'consent') bad.push(`第一次 localStore 调用不是 consent()：${calls.join(' → ')}`);
    const dispatched = calls.slice(1).slice().sort();
    const wantAll = METHOD_ORDER.slice().sort();
    if (dispatched.length !== wantAll.length || dispatched.some((x, i) => x !== wantAll[i])) {
      bad.push(`落点调用的集合 ≠ 那四个方法（多/少/重复）：${calls.join(' → ')}`);
    }

    const pairRe = new RegExp(
      `(?:if|else\\s+if)\\s*\\(\\s*${v}\\s*===\\s*'([A-Za-z]+)'\\s*\\)\\s*localStore\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(\\s*\\)`,
      'g',
    );
    const pairs = [...text.matchAll(pairRe)].map((m) => [m[1], m[2]] as [string, string]);
    const pairStates = pairs.map((p) => p[0]);
    if (new Set(pairStates).size !== pairStates.length) bad.push(`有重复的 guard 分支：${pairStates.join(', ')}`);
    for (const [s, m] of pairs) {
      if (!(reached as string[]).includes(s)) {
        bad.push(`guard 比较了一个不是 ConsentState 的值：'${s}'`);
        continue;
      }
      const want = methodFor[s as ConsentState];
      if (want !== m) bad.push(`next === '${s}' 落到了 localStore.${m}()，应为 localStore.${String(want)}()`);
    }
    const unclaimed = reached.filter((s) => !pairStates.includes(s));
    if (unclaimed.length !== 1) {
      bad.push(`guard 认领了 [${pairStates.join(', ') || '（无）'}]；应由 else 兜底的状态应恰有 1 个，实际 ${unclaimed.length} 个`);
    }
    const em = /else\s+localStore\s*\.\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(text);
    if (em === null) bad.push('没有 `else localStore.X()` 兜底分支');
    else if (unclaimed.length === 1 && em[1] !== methodFor[unclaimed[0]]) {
      bad.push(`else 分支落到了 localStore.${em[1]}()，应为 localStore.${String(methodFor[unclaimed[0]])}()`);
    }
    return bad;
  }

  it('判据锚点：函数体抽到了、四个方法到达四个不同状态（否则下面的断言会在空/漏项上假绿）', () => {
    expect(mainCode.length, 'main.ts 读成空串 ⇒ 后面全是假绿').toBeGreaterThan(1000);
    expect(body.length, 'functionBody 抽到空串 ⇒ 本组判据全是假绿').toBeGreaterThan(80);
    expect(body, '抽到的不是 consentStep（结构被改动？）').toContain('function consentStep(');
    expect(
      reached.slice().sort(),
      '`LocalStore` 的四个方法没有到达四个**不同**状态 ⇒ 派生出来的映射不可用',
    ).toEqual(['allowed', 'ask', 'denied', 'unknown']);
    // 契约自证：派生结果与 `LocalStore` 自己的状态语义一致（这一行**不是**我在测试里重写了一遍逻辑 ——
    // 上面的循环才是；这里只是把派生结果钉下来，派生一旦失效就会红）
    expect(methodFor['ask']).toBe('ask');
    expect(methodFor['allowed']).toBe('grant');
    expect(methodFor['denied']).toBe('deny');
    expect(methodFor['unknown']).toBe('reset');
  });

  it('consentStep 的四个分支落点都对（ask→ask / allowed→grant / denied→deny / else→reset）', () => {
    expect(wiringViolations(body), 'main.ts 的 consentStep 落点与 LocalStore 的状态语义不一致').toEqual([]);
  });

  it('判据自证（正控 + 反控）：同一判据在**合成**函数体上能分辨对错', () => {
    const v = 'nx';
    const mk = (states: ConsentState[], override: Partial<Record<ConsentState, string>>): string =>
      'function consentStep(action: A): void {\n'
      + `  const ${v} = nextConsentStep(localStore.consent(), action);\n`
      + states
        .map((s, i) => `  ${i === 0 ? 'if' : 'else if'} (${v} === '${s}') localStore.${override[s] ?? methodFor[s]}();`)
        .join('\n')
      + `\n  else localStore.${override['unknown'] ?? methodFor['unknown']}();\n}`;
    // else 该管哪个状态也从**真源码**派生（= else 调的那个方法所到达的状态），不手写 'unknown'
    const elseMethod = /else\s+localStore\s*\.\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(body)?.[1];
    const elseState = reached.find((s) => methodFor[s] === elseMethod);
    expect(elseState, `从 main.ts 派生不出 else 分支该管哪个状态（else 调的是 localStore.${String(elseMethod)}）`).toBeDefined();
    const guards = reached.filter((s) => s !== elseState);
    const ok = mk(guards, {});
    expect(wiringViolations(ok), '正控：合成一份**正确**落点的函数体，判据却说它错（判据恒假）').toEqual([]);
    const cases: Array<[string, string]> = [
      ['allowed 分支 → localStore.ask()', mk(guards, { allowed: 'ask' })],
      ['denied 分支 → localStore.grant()', mk(guards, { denied: 'grant' })],
      ['删掉 ask 分支', mk(guards.filter((s) => s !== 'ask'), {})],
      ['else 分支 → localStore.grant()', mk(guards, { unknown: 'grant' })],
    ];
    for (const [label, bad] of cases) {
      expect(bad, `反控「${label}」的合成样本与正控逐字相同 ⇒ 变异没生效`).not.toBe(ok);
      expect(wiringViolations(bad).length, `反控「${label}」：判据没命中（判据恒真）`).toBeGreaterThan(0);
    }
  });
});

/* ---------------- 7. 文案腿：CONSENT_COPY 不许出现"无条件全称"的写入承诺 ---------------- */

/**
 * **为什么这条是文本腿**：判据的对象**就是文案字符串本身**（"这句话是不是一个不可能成立的
 * 绝对承诺"只能对字符串做形态判定）。行为腿（渲染出来再读一遍）只会把同一批字符串换个地方
 * 比对一次，判别力完全一样而链路更长。字符串集合用**生成式遍历**（不手写字段清单）。
 *
 * 这条腿补的是**阶段一评审的"同类空洞"**：`requiredPrivacyLines` 只含
 * `PRIVACY_COPY.noServerStorage[0]` **一句**，而 `CONSENT_COPY.body[0]` / `body[2]` 是**自写串**
 * —— 把它们改成「在你允许之前，磁盘上不会有任何写入」这类不实绝对句时，全仓无腿能拦，
 * 而那正是玩家在授权弹窗上最先读到的两句话。
 *
 * **判据的形态**（不是清单：换一个字、换一种说法仍会被抓住）：
 *  ① 「不会有任何写入 / 不会写入磁盘 / 零写入 / 不落盘 / 不留痕迹」这类**无宾语**的写入否定；
 *  ② 提到介质（`磁盘 / 硬盘 / 本机 / 这台设备`）的句子里同时出现"不会/没有/零"与写动作；
 *  除非**同一句**里把承诺**范围化**到用户数据（`你的数据 / 用户数据 / 你的昵称 / …`）——
 *  那正是 `src/app/privacy.ts` 在评审 B-1 之后的口径（"不会写入任何**你的数据**"）。
 *
 * ⚠️ 所以本判据**不禁止提到磁盘**（把"磁盘"整个词禁掉是**错的方向**，见下一条反证腿）：
 *  只有"同句无范围限定 + 有写入否定"才命中。`保存` 也**不在**绝对名单里 ——
 *  否则按钮上的「不用，本次不保存」（说的是本次选择，不是磁盘承诺）会被误判。
 */
describe('文案腿：CONSENT_COPY 里不许有"无条件全称"的写入承诺', () => {
  /** 无条件否定词（**不含**裸"不"：裸"不"要靠 ① 的"紧邻写动作"形态才成立） */
  const NEG = '不会|不再|绝不|没有任何|没有|不会有|零';
  /** 写入/留痕动作（"写到介质上"这一类；不含"保存"——见头注） */
  const WRITE = '写入|写进|写到|写盘|落盘|留下?痕迹';
  /** 范围限定词：出现了它，这句话就只是在承诺"你的数据" */
  const SCOPE = '你的数据|用户数据|你的昵称|你的卡组|你的设置|你的档案|程序文件|页面|脚本|样式|图标|本次';
  /** 介质/载体（只在"同句有否定 + 有写动作 + 无范围限定"时才算绝对句） */
  const MEDIUM = '磁盘|硬盘|本机|本地磁盘|这台设备|这台机器';

  /**
   * 判据：返回命中的片段（空数组 = 这条串没有绝对句）。
   * **按句切分**（。！？；换行）：范围限定不跨句生效 —— 否则"下一句里提到你的数据"
   * 会把上一句的绝对承诺洗白。
   */
  function absoluteWordingHits(text: string): string[] {
    const hits: string[] = [];
    for (const sentence of text.split(/[。！？；\n]/)) {
      const s = sentence.trim();
      if (s === '') continue;
      // 已范围化 ⇒ 不是绝对句（范围词必须**紧跟**在否定+写动作之后，不允许"隔着半句话"）
      const scoped = new RegExp(
        `(?:${NEG})\\s*(?:再)?\\s*(?:${WRITE}|保存|上传|存)?\\s*(?:任何|一点|丝毫)?\\s*(?:的)?\\s*(?:${SCOPE})`,
      ).test(s);
      if (scoped) continue;
      const negWrite = new RegExp(`(?:${NEG}|不)\\s*(?:任何|一点|丝毫)?\\s*(?:${WRITE})`).exec(s);
      if (negWrite) { hits.push(negWrite[0]); continue; }
      if (new RegExp(`(?:${MEDIUM})`).test(s)
        && new RegExp(`(?:${NEG})[^。]{0,12}(?:${WRITE}|保存|存到|留存|记录)`).test(s)) {
        hits.push(s);
      }
    }
    return hits;
  }

  /** 生成式拍平：任意层级的对象/数组里的**全部**字符串（不手写字段清单）。 */
  function allStrings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
    else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) allStrings(v, out);
    return out;
  }
  const COPY_STRINGS = allStrings(CONSENT_COPY);

  it('判据锚点：CONSENT_COPY 的全部字符串都被遍历到（含正文每一行与每个字段）', () => {
    expect(COPY_STRINGS.length, '一条字符串都没遍历到 ⇒ 后面的判据恒真').toBeGreaterThan(5);
    for (const line of CONSENT_COPY.body) {
      expect(COPY_STRINGS, `body 的这一行没进遍历：${line}`).toContain(line);
    }
    for (const k of Object.keys(CONSENT_COPY) as (keyof ConsentCopy)[]) {
      const v: unknown = CONSENT_COPY[k];
      if (typeof v === 'string') expect(COPY_STRINGS, `字段 ${k} 没进遍历`).toContain(v);
    }
  });

  it('每一条字符串都不是无条件全称的写入承诺（含 body[0] / body[2] 两条**自写**串）', () => {
    const offenders = COPY_STRINGS.filter((s) => absoluteWordingHits(s).length > 0);
    expect(offenders, 'CONSENT_COPY 里出现了绝对措辞（玩家最先读到的两句话尤其危险）').toEqual([]);
    // 反向自证：本腿存在的**理由**是"正文里有同源腿覆盖不到的自写串" —— 若没有，本腿只是重复了同源腿
    const selfWritten = CONSENT_COPY.body.filter((l) => !privacyLines().includes(l));
    expect(selfWritten.length, '正文里没有自写串 ⇒ 本判据失去了存在的理由').toBeGreaterThan(0);
    for (const l of selfWritten) expect(COPY_STRINGS, `自写串没进遍历：${l}`).toContain(l);
  });

  it('正控：判据不是恒真 —— 绝对措辞样本必须命中（含评审点名的全部形态）', () => {
    const samples = [
      '在你允许之前，磁盘上不会有任何写入。',
      '在你允许之前，不会写入磁盘。',
      '在你允许之前，本机零写入。',
      '你的数据不会落盘。',
      '在你允许之前不留痕迹。',
      '在你允许之前，本机没有任何写入。',
      '在你允许之前，硬盘上不会有任何写入。',
      '在你允许之前，不会有任何东西写到这台设备的磁盘上。',
    ];
    for (const s of samples) {
      expect(absoluteWordingHits(s), `绝对措辞样本没被命中（判据恒假）：${s}`).not.toEqual([]);
    }
    // 反向：判据对**正常**句子返回空（否则它是个"见谁咬谁"的假判据）
    for (const s of ['允许后，昵称与卡组会保存在你自己的浏览器里。', '不允许也能正常游玩全部内容。', CONSENT_COPY.deny]) {
      expect(absoluteWordingHits(s), `正常句子被误判为绝对措辞：${s}`).toEqual([]);
    }
  });

  it('反证：提到"磁盘"但**范围化**的句子 0 命中（本判据不禁止提到磁盘）', () => {
    const scoped = [
      '在你选择「允许」之前，不会写入任何你的数据；磁盘上只会有程序文件的离线缓存。',
      PRIVACY_COPY.localOnly[0],
    ];
    for (const s of scoped) {
      expect(s.includes('磁盘') || s.includes('你的数据'), `样本没覆盖到被判的形态：${s}`).toBe(true);
      expect(absoluteWordingHits(s), `范围化的诚实句子被误判为绝对措辞：${s}`).toEqual([]);
    }
  });
});

/* ---------------- 8. 行为腿：「隐私说明」按钮就地展开**完整**隐私说明（不是死胡同） ---------------- */

/**
 * 阶段一评审的第三条：`src/main.ts:635` 的 `openPrivacy` 是空函数 ⇒ 弹窗上的「隐私说明」
 * 按钮**可见、可点、点了没有任何反应**（死胡同）。本任务的处置是：让按钮**真的有用** ——
 * 在 `renderLocalConsent` 里**就地展开**完整隐私说明（唯一出处 = `privacy.ts` 的
 * `privacyLines()`，一条都不手写），`openPrivacy` 回调照旧触发（宿主接缝，Task 7 换整屏时用它）。
 *
 * 这条腿是**行为腿**：在真 DOM 桩上点那个按钮，然后逐条比对屏上出现的内容与 `privacyLines()`
 * 的**当前返回值**（生成式，不手写文案）。两向都断言（点开 / 收起），并先证明"点之前是空的"
 * —— 否则"展开"与"内容一直都在、只是藏着"在桩上不可区分，判据会恒真。
 */
describe('行为腿：「隐私说明」按钮展开完整隐私说明（唯一出处 = privacyLines()）', () => {
  const LINES = privacyLines();

  it('锚点：隐私说明非空，且正文里有它**没**承载的行（否则"展开"没有可观察的效果）', () => {
    expect(LINES.length, 'privacyLines() 为空 ⇒ 后面的判据全在空数组上恒真').toBeGreaterThan(3);
    const notInBody = LINES.filter((l) => !CONSENT_COPY.body.includes(l));
    expect(
      notInBody.length,
      '隐私说明的每一行都已经在弹窗正文里 ⇒ "展开"没有可观察的效果，本腿会退化成恒真',
    ).toBeGreaterThan(0);
  });

  it('点「隐私说明」：屏上出现**完整**隐私说明的每一条（逐条由 privacyLines() 派生）；再点收起', () => {
    const root = mountRoot();
    const { calls, nav } = recorder();
    renderLocalConsent(root as unknown as HTMLElement, nav);

    /** 展开容器（唯一性也断言：多一个容器就意味着有内容落在别处） */
    const panel = (): StubNode => {
      const hits = queryAllIn(root, 'div.consent-privacy-full');
      expect(hits.length, '弹窗里应有唯一一个 div.consent-privacy-full 容器').toBe(1);
      return hits[0];
    };
    /**
     * 按钮的 `aria-expanded`。**为什么要这层强转**：共用桩 `net-dom-stub.ts` 的 `StubNode`
     * 接口里没有声明 `getAttribute`（只在索引签名 `[k: string]: unknown` 里），直接调用
     * 会得到 `unknown`（tsc: TS2571）。纪律要求不许改共用桩（3 个消费方），所以在这里局部收窄。
     */
    const ariaExpanded = (): unknown =>
      (buttonOf(root, 'consent-privacy').getAttribute as (n?: string) => unknown)('aria-expanded');

    /** 展开容器里**当前**渲染出的行（顺序 = DOM 顺序） */
    const shown = (): string[] => descendants(panel()).filter((n) => n.tag === 'p').map((n) => n.text);

    // ── 点之前：展开区**是空的**（不是"内容早就渲染好、只是藏着"）
    expect(shown(), '还没点就看到隐私说明了 ⇒ 本判据分不清"展开"与"一直都在"').toEqual([]);
    const outsideBody = LINES.filter((l) => !CONSENT_COPY.body.includes(l));
    for (const l of outsideBody) {
      expect(textOf(root), `还没点，正文之外的隐私行就已经在屏上：${l}`).not.toContain(l);
    }

    // ── 点一次：**每一条**都在，且顺序与 privacyLines() 逐字一致
    const btn = buttonOf(root, 'consent-privacy');
    const hit = clickIn(root, 'consent-privacy');
    expect(hit.button, '事件的冒泡路径没经过「隐私说明」按钮').toBe(btn);
    expect(hit.label, '点到的是「隐私说明」（文案逐字来自 CONSENT_COPY.privacyLink）').toBe(CONSENT_COPY.privacyLink);
    expect(calls, '点「隐私说明」不该顺手调 grant/deny').toEqual(['privacy']);
    expect(shown(), '展开后屏上的不是**完整**隐私说明（条数或顺序与 privacyLines() 不一致）').toEqual(LINES);
    for (const l of LINES) expect(textOf(root), `展开后屏上缺少隐私行：${l}`).toContain(l);
    expect(ariaExpanded(), '展开后 aria-expanded 不是 true').toBe('true');

    // ── 再点一次：收回去（两向都断言：防"一次性死胡同"换成"只会开不会关"的另一种死胡同）
    clickIn(root, 'consent-privacy');
    expect(shown(), '再点一次没有收起').toEqual([]);
    expect(calls, '收起时也该通知宿主（同一个按钮，行为一致）').toEqual(['privacy', 'privacy']);
    expect(ariaExpanded()).toBe('false');
    for (const l of outsideBody) expect(textOf(root), `收起后隐私行仍在屏上：${l}`).not.toContain(l);
  });
});
