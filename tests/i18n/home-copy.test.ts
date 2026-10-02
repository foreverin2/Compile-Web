import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody } from '../ui/source-text';
import { installStubDom, makeStubEl, descendants, queryAllIn, type StubNode } from '../ui/net-dom-stub';
import { renderHome, renderModeSelect, renderRules, type HomeNav, type ModeSelectNav } from '../../src/ui/home';
import { DEFAULT_LANG, EN, ZH, setLang } from '../../src/i18n';

/**
 * ★ 2026-10-01（C，用户明确抱怨）：**首页那一屏的 i18n**。
 *
 * 用户原话：「我发现切换成英文后，除了设置里的文本变成英语了，其他所有地方的文本都没有改变，
 * **包括首页的文本**」。
 *
 * ## 这一组证明什么
 *
 *  1. **中文逐字守恒**：`renderHome` / `renderModeSelect` / `renderRules` 画出来的文案，
 *     逐条等于 `zh.ts` 里的值（键 → 值的对应关系由**渲染结果**验证，不是抄一遍源码）；
 *  2. **en 覆盖 + 当场生效**：`setLang('en')` 之后再画一帧 ⇒ 屏上是英文，
 *     而且**中文那几句从屏上消失**（"半张屏"是最常见的缺陷）；
 *  3. **源码纪律**：`home.ts` 里玩家可见的文案**只能来自 `t()`** —— 那条由
 *     `unextracted-manifest` 的"代码位零中文"腿负责；这里另加一条**反向**的：
 *     `t()` 的键必须是**字面量**（缺键扫描腿的地基）。
 *
 * ## 为什么用 DOM 桩而不是源码文本腿
 *
 * 源码文本腿只能证明"某个键出现在某处"，证明不了"屏上画的**就是**表里那句"。
 * 这一组用 `tests/ui/net-dom-stub.ts` 真跑一次渲染，把**树上的文本**与表里的值比对。
 */
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
};

const modeNav: ModeSelectNav = {
  backHome: () => { /* 不测 */ },
  openDeviceCheck: () => { /* 不测 */ },
  startHotseat: () => { /* 不测 */ },
  startNetLobby: () => { /* 不测 */ },
};

/** 树里所有节点的文本（按 DOM 顺序） */
function texts(n: StubNode): string[] {
  return descendants(n).map((x) => x.text).filter((t) => t !== '');
}

/** 画一帧首页并返回它的树 */
function drawHome(): StubNode {
  const root = makeStubEl('div');
  renderHome(root as unknown as HTMLElement, homeNav);
  return root;
}

function drawMode(): StubNode {
  const root = makeStubEl('div');
  renderModeSelect(root as unknown as HTMLElement, modeNav);
  return root;
}

/* ==================================================================== *
 * 1. 中文逐字守恒
 * ==================================================================== */

describe('★ C：首页那一屏的中文与 `zh.ts` 逐字一致', () => {
  it('主页菜单 + 页脚：逐条等于表里的值', () => {
    const shown = texts(drawHome());
    for (const k of ['home.sub', 'home.start', 'home.library', 'home.tutorial',
      'home.rules', 'home.local-data', 'home.cardmaker', 'home.footer',
      'common.changelog', 'common.feedback'] as const) {
      expect(shown, `屏上没有「${k}」那一句（zh 表：${ZH[k]}）`).toContain(ZH[k]);
    }
  });

  it('模式选择页：标题 / 四张卡 / 两个开关与它们的帮助文本 / 缩放提示 / 设备体检', () => {
    const root = drawMode();
    const shown = texts(root);
    for (const k of ['mode.title', 'mode.hotseat.name', 'mode.hotseat.desc',
      'mode.online.name', 'mode.online.desc', 'mode.solo.name', 'mode.solo.desc',
      'mode.trio.name', 'mode.trio.desc', 'mode.ban', 'mode.random',
      'mode.zoom-hint', 'mode.device-check', 'common.back-home'] as const) {
      expect(shown, `屏上没有「${k}」那一句（zh 表：${ZH[k]}）`).toContain(ZH[k]);
    }
    // 两个开关的**帮助文本**挂在 `data-tip` 上（不是 textContent），单独断言
    const tips = descendants(root).filter((n) => n.tag === 'span' && n.cls.includes('mode-help'))
      .map((n) => n.dataset.tip);
    expect(tips, '开关的帮助文本没带 zh 表里的那两句').toEqual([ZH['mode.ban.tip'], ZH['mode.random.tip']]);
  });

  it('规则页：标题 / 副标题 / 五本规则书（标题 + 说明）都来自表', () => {
    const root = makeStubEl('div');
    renderRules(root as unknown as HTMLElement, () => { /* 不测 */ });
    const shown = texts(root);
    for (const k of ['rules.title', 'rules.sub', 'common.back-home',
      'rules.gen1', 'rules.gen1.sub', 'rules.gen2', 'rules.gen2.sub',
      'rules.gen3', 'rules.gen3.sub', 'rules.gen3.solo', 'rules.gen3.solo.sub',
      'rules.faq', 'rules.faq.sub'] as const) {
      expect(shown, `屏上没有「${k}」那一句（zh 表：${ZH[k]}）`).toContain(ZH[k]);
    }
  });
});

/* ==================================================================== *
 * 2. 切到英文 ⇒ 首页当场变英文（用户抱怨的那一件事）
 * ==================================================================== */

describe('★★ C：切到英文之后，首页那一屏**当场**是英文', () => {
  it('主页菜单：英文那几句在屏上，中文那几句**消失**', () => {
    setLang('en');
    const root = drawHome();
    const shown = texts(root);
    for (const k of ['home.start', 'home.library', 'home.tutorial', 'home.rules',
      'home.local-data', 'home.cardmaker', 'common.changelog', 'common.feedback'] as const) {
      expect(shown, `英文界面下屏上没有「${EN[k]}」`).toContain(EN[k]);
    }
    // 反向：中文那几句必须从屏上消失（同一屏两种语言并存 = 半张屏）。
    // ⚠️ 判据面**收在菜单按钮那一块**（`.home-menu-buttons`），不是整棵树：
    //    整棵树里还嵌着**更新日志浮层的内容**（`src/ui/changelog.ts`，它**还没抽 i18n**，
    //    登记在清单 A 节里）⇒ 拿整棵树当判据面会把那一屏的中文算进来（假红）。
    const menuBtns = queryAllIn(root, '.home-btn').map((b) => b.text);
    const zhOnly = ['home.start', 'home.library', 'home.tutorial', 'home.rules',
      'home.local-data', 'home.cardmaker', 'common.changelog', 'common.feedback'] as const;
    const leftovers = zhOnly.filter((k) => EN[k] !== ZH[k] && menuBtns.includes(ZH[k]));
    expect(leftovers.map((k) => ZH[k]), '切到英文之后菜单上还留着中文').toEqual([]);
    // ⚠️ 页脚那一条**故意保留中文专名**（作者署名「我吃吃吃吃」是名字，两种语言都不翻）：
    //    所以它不参与"屏上还留着中文"那条判据 —— 这里如实把它钉住，免得以后有人当缺陷改掉。
    expect(texts(root), '页脚的署名被翻了（那是专名）').toContain(EN['home.footer']);
    expect(EN['home.footer']).toContain('我吃吃吃吃');
    // 菜单那一块里不许有缺键回退的 ⟪键名⟫
    expect(menuBtns.filter((t) => t.includes('⟪')), '首页出现了缺键回退').toEqual([]);
  });

  it('模式选择页：四张卡与两个开关的说明都变英文，并且一个⟪⟫都没有', () => {
    setLang('en');
    const root = drawMode();
    const shown = texts(root);
    for (const k of ['mode.title', 'mode.hotseat.name', 'mode.hotseat.desc',
      'mode.online.name', 'mode.online.desc', 'mode.solo.name', 'mode.trio.name',
      'mode.ban', 'mode.random', 'mode.device-check', 'common.back-home'] as const) {
      expect(shown, `英文界面下没有「${EN[k]}」`).toContain(EN[k]);
    }
    const tips = descendants(root).filter((n) => n.tag === 'span' && n.cls.includes('mode-help'))
      .map((n) => n.dataset.tip);
    expect(tips).toEqual([EN['mode.ban.tip'], EN['mode.random.tip']]);
    expect(shown.filter((t) => t.includes('⟪'))).toEqual([]);
  });

  it('规则页：五本书的标题与说明都变英文', () => {
    setLang('en');
    const root = makeStubEl('div');
    renderRules(root as unknown as HTMLElement, () => { /* 不测 */ });
    const shown = texts(root);
    for (const k of ['rules.title', 'rules.sub', 'rules.gen1', 'rules.gen1.sub',
      'rules.faq', 'rules.faq.sub'] as const) {
      expect(shown, `英文界面下没有「${EN[k]}」`).toContain(EN[k]);
    }
    expect(shown.filter((t) => t.includes('⟪'))).toEqual([]);
  });

  it('中文 ⇄ 英文来回：同一屏两帧，文案跟着表走（不是"只切一次才对"）', () => {
    const zh = texts(drawHome());
    setLang('en');
    const en = texts(drawHome());
    setLang(DEFAULT_LANG);
    const zh2 = texts(drawHome());
    expect(zh, '中文那两帧应当逐条相同').toEqual(zh2);
    expect(zh, '中英两帧不该完全相同').not.toEqual(en);
    expect(zh).toContain(ZH['home.start']);
    expect(en).toContain(EN['home.start']);
  });
});

/* ==================================================================== *
 * 3. 源码纪律：`t()` 的键必须是字面量（缺键扫描腿的地基）
 * ==================================================================== */

describe('★ C：`home.ts` 里 `t()` 的键都是字面量（不许常量间接）', () => {
  const HOME = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)))
      .subarray(0, 4 * 1024 * 1024).toString('utf8'),
  );

  it('`t(` 的第一实参只有字面量这一种形态（常量/变量会让缺键扫描腿看不见）', () => {
    // 与 `tests/i18n/tables.test.ts` 的"不许有动态键"腿同源，但判据面收在**这一个文件**上：
    // 那一轮就栽过（`t(PLAY_SIZE_HINT_KEY)` / `t(def.label)`），这里钉住它不再回来。
    const dynamic: string[] = [];
    for (const m of HOME.matchAll(/\bt\(\s*([^'"`)\s][^,)]*)/g)) dynamic.push(m[1].trim());
    expect(dynamic, `home.ts 里出现了非字面量的 t() 实参：${dynamic.join(' / ')}`).toEqual([]);
  });

  it('世代标签 / 规则书标题的键都是字面量（两个 switch 各自的落点）', () => {
    for (const [fn, keys] of [
      ['setLabel', ['gen.1.base', 'gen.1.extra', 'gen.2.base', 'gen.2.extra', 'gen.3.base', 'gen.3.extra']],
      ['ruleTitleText', ['rules.gen1', 'rules.gen2', 'rules.gen3', 'rules.gen3.solo', 'rules.faq']],
      ['ruleDescText', ['rules.gen1.sub', 'rules.gen2.sub', 'rules.gen3.sub', 'rules.gen3.solo.sub', 'rules.faq.sub']],
    ] as const) {
      const body = functionBody(HOME, fn);
      expect(body.length, `${fn} 抽到空片段`).toBeGreaterThan(60);
      for (const k of keys) {
        expect(body, `${fn} 里没有以字面量形式调用 t('${k}')`).toContain(`t('${k}')`);
      }
    }
  });

  it('设置小窗里的两个取值函数（开关标题 / 说明）也把键写成字面量', () => {
    // ⚠️ 它们是 `settingsOverlayElement` 内部的**局部函数**（不是模块级），所以判据面是那个构造器
    const body = functionBody(HOME, 'settingsOverlayElement');
    expect(body).toContain("t('settings.fx.metal6.label')");
    expect(body).toContain("t('settings.fx.metal6.desc')");
    expect(body).toContain("t('settings.fx.on')");
    expect(body).toContain("t('settings.fx.off')");
    expect(body).toContain("t('settings.fx.state'");
  });
});
