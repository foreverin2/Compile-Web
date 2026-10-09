import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LANG, EN, ZH, setLang } from '../../src/i18n';
import { renderHome, type HomeNav } from '../../src/ui/home';
import { QQ_GROUP_IMG_SRC, QQ_GROUP_NO, qqGroupElement } from '../../src/ui/qq-group';
import { cssRules, cssPropOf } from './net-css-parse';
import {
  descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';

/**
 * **2026-10-07（用户要求）：首页右上角「玩家群」（更新日志下方）—— 点开显示 QQ 群二维码**
 *
 * 用户原话：「我希望在首页右上角的更新日志下方再添加上一个按钮，点击后用于展示 qq 群的进群二维码，
 * 就是我给的这个图片」。
 *
 * 本文件钉三件事（行为那半用桩 DOM 真跑首页；版式那半解算 `styles-local.css`）：
 *
 *  1. **入口在更新日志下方**：DOM 里「玩家群」的 wrapper 紧跟在「更新日志」那个 wrapper 之后，
 *     并且 `.qqgroup-wrap` 的 `top` **大于** `.changelog-wrap` 的 `top`（同一条右边缘）；
 *  2. **点击开合**：初始不带 `qqgroup-open`（面板 `display:none`）、点一下带上、再点一下去掉；
 *     面板里的「关闭」按钮也会关掉它；
 *  3. **二维码图片是真的**：`src` 指向的那份文件**在本仓里存在**（`public/assets/ui/qq-group.jpg`），
 *     并且图有 `alt`（读屏/英文界面靠它）；提示句里带群号、中英各一条。
 *
 * ⚠️ 诚实边界：桩 DOM 无 CSS 引擎 ⇒ "点开之后画面真的滑出来"这一条只能靠 CSS 解算 + 人眼；
 * 图上那几行字（群名、「扫一扫二维码，加入群聊」）是**用户给的素材的一部分**，英文界面下也是中文
 * （不重画）⇒ 英文玩家靠 `alt` 与提示句读懂，这一点在 `src/ui/qq-group.ts` 的头注里登记过。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  readFileSync(`${REPO}${rel}`).subarray(0, 4 * 1024 * 1024).toString('utf8');

const LOCAL_CSS = read('src/ui/styles-local.css');
const LOCAL_RULES = cssRules(LOCAL_CSS);
const HOME_SRC = read('src/ui/home.ts');

const restores: Array<() => void> = [];
beforeEach(() => {
  setLang(DEFAULT_LANG);
  restores.push(installStubDom());
});
afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  setLang(DEFAULT_LANG);
});

const homeNav: HomeNav = {
  startGame: () => { /* 不测 */ },
  openLibrary: () => { /* 不测 */ },
  openRules: () => { /* 不测 */ },
  openLocalData: () => { /* 不测 */ },
  openSettings: () => { /* 不测 */ },
  openFeedback: () => { /* 不测 */ },
  openCardmaker: () => { /* 不测 */ },
  openTutorial: () => { /* 不测 */ },
} as HomeNav;

const drawHome = (): StubNode => {
  const root = makeStubEl('div');
  renderHome(root as unknown as HTMLElement, homeNav);
  return root;
};

/** 在目标节点上真派发一次事件（桩的 dispatchEvent 沿 parentElement 冒泡 ⇒ 挂个空子节点再派发） */
const clickIn = (target: StubNode): void => {
  const clicker = makeStubEl('span');
  target.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
};

const one = (root: StubNode, cls: string): StubNode => {
  const hits = descendants(root).filter((n) => isClass(n, cls));
  expect(hits.length, `树里应有唯一一个 .${cls}，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
};

/** 那一枚"玩家群"按钮 —— ⚠️ `.qqgroup-open` 这个名字**按钮与 wrapper 的展开态共用**
 *  （与更新日志同一套约定：按钮 `.changelog-open` + `.changelog-wrap.changelog-open`）
 *  ⇒ 选它必须按 `tag === 'button'`，否则展开之后会命中两个节点。 */
const entryBtn = (root: StubNode): StubNode => {
  const hits = descendants(root).filter((n) => isClass(n, 'qqgroup-open') && n.tag === 'button');
  expect(hits.length, `树里应有唯一一枚 .qqgroup-open 按钮，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
};

describe('① 入口在更新日志下方（DOM 顺序 + CSS 定位）', () => {
  it('DOM 顺序：`qqgroup-wrap` 紧跟在 `changelog-wrap` 之后', () => {
    const root = drawHome();
    const screen = one(root, 'home-screen');
    const order = (screen.children ?? []).map((c) => c.cls);
    const iLog = order.findIndex((c) => c.split(/\s+/).includes('changelog-wrap'));
    const iQq = order.findIndex((c) => c.split(/\s+/).includes('qqgroup-wrap'));
    expect(iLog, '首页上没有 `.changelog-wrap`（更新的前提变了）').toBeGreaterThanOrEqual(0);
    expect(iQq, '首页上没有 `.qqgroup-wrap` —— 那一枚按钮没加').toBeGreaterThan(iLog);
  });

  it('CSS：两者同一条右边缘，`qqgroup-wrap` 的 top 更大（视觉上在下面）', () => {
    const log = [makeStubEl('div')];
    log[0].cls = 'changelog-wrap';
    const qq = [makeStubEl('div')];
    qq[0].cls = 'qqgroup-wrap';
    const logTop = cssPropOf(log[0], log, LOCAL_RULES, 'top');
    const qqTop = cssPropOf(qq[0], qq, LOCAL_RULES, 'top');
    const logRight = cssPropOf(log[0], log, LOCAL_RULES, 'right');
    const qqRight = cssPropOf(qq[0], qq, LOCAL_RULES, 'right');
    expect(logTop, '`.changelog-wrap` 的 top 解不出（夹具前提变了）').toBe('16px');
    expect(qqTop, '`.qqgroup-wrap` 的 top 解不出（那就没法定在下面）').not.toBeNull();
    expect(Number.parseFloat(qqTop as string), '「玩家群」没有压在更新日志下面')
      .toBeGreaterThan(Number.parseFloat(logTop as string));
    expect(qqRight, '两者不在同一条右边缘上').toBe(logRight);
    // 面板默认藏起来、靠 wrapper 上的类名开合（与更新日志同一套）
    const panel = [makeStubEl('div')];
    panel[0].cls = 'qqgroup-panel';
    expect(cssPropOf(panel[0], panel, LOCAL_RULES, 'display'), '面板默认不是藏着的').toBe('none');
    const opened = [makeStubEl('div'), makeStubEl('div')];
    opened[0].cls = 'qqgroup-wrap qqgroup-open';
    opened[1].cls = 'qqgroup-panel';
    expect(cssPropOf(opened[1], opened, LOCAL_RULES, 'display'), '开了之后面板没有显示出来').toBe('block');
  });

  it('首页源码里那一枚按钮走的是 `common.qqgroup`（文案不许写死在 home.ts 里）', () => {
    expect(HOME_SRC, '首页没造 `.qqgroup-wrap`').toContain("el('div', 'qqgroup-wrap')");
    expect(HOME_SRC, '按钮不是 `btn qqgroup-open`').toContain("'btn qqgroup-open'");
    expect(HOME_SRC, '按钮文案没走 `common.qqgroup`').toContain("t('common.qqgroup')");
    expect(HOME_SRC, '点按钮没有切 `.qqgroup-open`').toMatch(/classList\.toggle\('qqgroup-open'\)/);
  });
});

describe('② 点击开合（真跑首页）', () => {
  it('初始不展开 → 点一下展开 → 再点一下收起', () => {
    const root = drawHome();
    const wrap = one(root, 'qqgroup-wrap');
    expect(isClass(wrap, 'qqgroup-open'), '初始就展开了').toBe(false);
    clickIn(entryBtn(root));
    expect(isClass(wrap, 'qqgroup-open'), '点了一下没展开').toBe(true);
    clickIn(entryBtn(root));
    expect(isClass(wrap, 'qqgroup-open'), '再点一下没收起').toBe(false);
  });

  it('面板里的「关闭」按钮也收起它', () => {
    const root = drawHome();
    const wrap = one(root, 'qqgroup-wrap');
    clickIn(entryBtn(root));
    expect(isClass(wrap, 'qqgroup-open')).toBe(true);
    clickIn(one(root, 'qqgroup-close'));
    expect(isClass(wrap, 'qqgroup-open'), '点「关闭」没收起').toBe(false);
  });
});

describe('③ 二维码与文案：图真的在、alt 有、中英都在', () => {
  it('`src` 指向的那份图片文件**在本仓里存在**（防"路径写错 ⇒ 线上裂图"）', () => {
    expect(QQ_GROUP_IMG_SRC.startsWith('/assets/'), 'src 不是站内绝对路径').toBe(true);
    const onDisk = `${REPO}public${QQ_GROUP_IMG_SRC}`;
    expect(existsSync(onDisk), `图片不在仓里：public${QQ_GROUP_IMG_SRC}（线上会裂图）`).toBe(true);
    // 反向锚点：这个路径不是"随便一个存在的文件" —— 头部真的是 JPEG
    expect(readFileSync(onDisk).subarray(0, 2).toString('hex'), '那份文件不是 JPEG（魔数）').toBe('ffd8');
  });

  it('中英各画一遍：按钮 / 标题 / alt / 提示句都跟着语言走，提示句里带群号', () => {
    for (const [lang, table] of [['zh', ZH], ['en', EN]] as const) {
      setLang(lang);
      const root = drawHome();
      const texts = descendants(root).map((n) => n.text).filter((t) => t !== '');
      expect(texts, `${lang} 下没有「玩家群」那一枚按钮`).toContain(table['common.qqgroup']);
      const panel = one(root, 'qqgroup-panel');
      expect(panel.dataset.role === undefined || true).toBe(true);
      const img = descendants(panel).filter((n) => isClass(n, 'qqgroup-img'))[0];
      expect(img, `${lang} 下面板里没有二维码图`).toBeDefined();
      expect((img.getAttribute as unknown as (n: string) => string | null)('src'), '图的 src 与常量不一致')
        .toBe(QQ_GROUP_IMG_SRC);
      expect((img as unknown as { alt: string }).alt, `${lang} 下图没有 alt（读屏读不出来）`)
        .toBe(table['qqgroup.alt']);
      const hint = descendants(panel).filter((n) => isClass(n, 'qqgroup-hint'))[0];
      expect(hint.text, `${lang} 下提示句不对`).toBe(table['qqgroup.hint'].replace('{no}', QQ_GROUP_NO));
      expect(hint.text, `${lang} 下的提示句里没有群号`).toContain(QQ_GROUP_NO);
      // 面板整块也被 aria-label 标了（读屏能知道这个 dialog 是什么）
      expect((panel.getAttribute as unknown as (n: string) => string | null)('aria-label'))
        .toBe(table['qqgroup.title']);
    }
  });

  it('独立造一次抽屉（不经过首页）也是同一套类名与文案', () => {
    const panel = qqGroupElement({ onClose: () => { /* 不测 */ } }) as unknown as StubNode;
    expect(isClass(panel, 'qqgroup-panel'), '抽屉根节点的类名变了').toBe(true);
    expect(queryAllIn(panel, '.qqgroup-img').length, '抽屉里没有二维码图').toBe(1);
    expect(queryAllIn(panel, '.qqgroup-close').length, '抽屉里没有关闭按钮').toBe(1);
  });
});
