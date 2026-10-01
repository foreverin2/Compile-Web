import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  installStubDom,
  makeStubEl,
  descendants,
  queryAllIn,
  setStubOwnerDocumentFor,
  setStubParentFor,
  type StubNode,
} from './net-dom-stub';
import { renderHome, type HomeNav } from '../../src/ui/home';

/**
 * ★ 2026-10-01（P0 线上验收 **D2**）：**切语言不许重建首页背景**。
 *
 * ## 缺陷现场（真浏览器实测）
 *
 * `applyLangChange` 在首页那一支直接 `showHome()` ⇒ `renderHome` 从 `clearRoot` 开始重画整棵
 * ⇒ `buildHomeBg()` 重新洗牌（`bgGroups()` 里的 `Math.random()`）+ 重建全部斜线带：
 * 608 张 `.bg-plane` 的顺序哈希 `2714029209→1340731705`、band 的 CSS `currentTime` 从 2850
 * 掉回 350（动画**从头开始**）。玩家看到的是"切个语言，背景整片跳了一下"。
 *
 * ## 选了哪种修法（用户要求两处都说清）
 *
 * **(a) 让背景节点跨重画保持同一个 DOM 节点与动画连续性** —— 没有选 (b) 固定种子。
 * 理由（完整版写在 `src/ui/home.ts` 的 `takeReusableBg` 上）：
 *  1. (b) 只让顺序可复现，**动画仍会被重建**（新元素上的 CSS 动画必然从 0 开始），
 *     而验收口径的第二条正是 `currentTime` 不许回退；
 *  2. (b) 的代价是"每次打开首页都是同一张背景"（现在每次加载换一个排列）—— 改观感换这点收益不划算；
 *  3. (a) 顺带修掉"离开首页再回来"（进图鉴/规则/本地数据再返回）也不重建背景。
 *
 * ## 这一组怎么证明（本仓没有真浏览器，所以判据落在"同一枚节点"上）
 *
 * `renderHome` 重画之后，`.home-bg` 必须是**同一个对象**（`toBe`：不是"内容一样"，
 * 是同一个引用）⇒ 它的子树、它的 CSS 动画状态在真浏览器里都跟着延续。
 * 这是能在 DOM 桩上真跑的等价形态；`currentTime` 那个读数本身要真浏览器，本文件**不**声称验了它。
 */

const restores: Array<() => void> = [];

beforeEach(() => {
  restores.push(installStubDom());
});

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/** 一个什么都不做的 nav（本文件只关心背景节点） */
const nav: HomeNav = {
  startGame: () => { /* 不测 */ },
  openLibrary: () => { /* 不测 */ },
  openRules: () => { /* 不测 */ },
  openLocalData: () => { /* 不测 */ },
  openSettings: () => { /* 不测 */ },
  openFeedback: () => { /* 不测 */ },
  openCardmaker: () => { /* 不测 */ },
};

function one(root: StubNode, cls: string): StubNode {
  const hits = queryAllIn(root, `.${cls}`);
  expect(hits.length, `树里应有唯一一个 .${cls}，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

describe('★ D2：重画首页时复用背景（顺序与动画连续性都靠它）', () => {
  it('连续两次 `renderHome` ⇒ `.home-bg` 是**同一个对象**（没有重建、没有重新洗牌）', () => {
    const root = makeStubEl('div');
    renderHome(root as unknown as HTMLElement, nav);
    const first = one(root, 'home-bg');
    renderHome(root as unknown as HTMLElement, nav);
    const second = one(root, 'home-bg');
    expect(second, '重画首页时背景被重建了（D2 的原缺陷：顺序哈希变、动画 currentTime 回退）')
      .toBe(first);
    // 反向锚点：整棵屏确实**被重画过**（否则"同一个背景"可能只是因为 renderHome 什么都没干）
    expect(one(root, 'home-screen')).toBeDefined();
    expect(queryAllIn(root, 'button').length, '重画之后菜单按钮不见了 ⇒ 上面那条是废话').toBeGreaterThan(3);
  });

  it('背景的子树在重画之后**一个节点都没少**（复用不是"捡回来一个空壳"）', () => {
    const root = makeStubEl('div');
    renderHome(root as unknown as HTMLElement, nav);
    const bg = one(root, 'home-bg');
    const before = descendants(bg).length;
    expect(before, '前置：第一帧的背景子树太小 ⇒ 本判据没覆盖到什么').toBeGreaterThan(2);
    renderHome(root as unknown as HTMLElement, nav);
    const after = descendants(one(root, 'home-bg')).length;
    expect(after, '重画之后背景子树少了节点（被重建/被掏空）').toBe(before);
  });

  it('背景仍然挂在 `#app` 那一棵里（不是被摘下来忘了挂回去）', () => {
    const root = makeStubEl('div');
    renderHome(root as unknown as HTMLElement, nav);
    const bg = one(root, 'home-bg');
    renderHome(root as unknown as HTMLElement, nav);
    expect(one(root, 'home-bg')).toBe(bg);
    expect(bg.parentElement, '背景被摘下来之后没挂回去').not.toBeNull();
    // 它是 `.home-screen` 的孩子（`#app` → `.home-screen` → `.home-bg`）；`one()` 已经保证
    // 它挂在 root 这一棵里，这一条钉的是**层级没变**。
    expect(bg.parentElement, '背景的父节点不是 home-screen').toBe(one(root, 'home-screen'));
  });

  it('换一个根（模拟"整棵屏被换掉"）⇒ 不许把旧根上的背景搬过去', () => {
    // 复用判据是 `.home-bg` 的父节点为空（"我上一帧把它摘下来了"）。换根之后旧背景还挂在旧根上
    // ⇒ 必须**新建**一份（跨 root 搬背景没有意义，还会把旧根掏空）。
    const rootA = makeStubEl('div');
    renderHome(rootA as unknown as HTMLElement, nav);
    const bgA = one(rootA, 'home-bg');
    const rootB = makeStubEl('div');
    renderHome(rootB as unknown as HTMLElement, nav);
    const bgB = one(rootB, 'home-bg');
    expect(bgB, '把旧根上的背景搬到了新根').not.toBe(bgA);
    expect(queryAllIn(rootA, '.home-bg').length, '旧根上的背景被掏空了').toBe(1);
  });

  it('反向验证：把"复用"拆掉（每次新建）⇒ 上面第一条必须红', () => {
    // ⚠️ 这一条**不是**运行时变异（那要改产出代码），而是把"恒等"这条判据的**敏感性**摆出来：
    //    两个**独立**渲染出来的背景绝不可能是同一个对象 —— 所以 `toBe` 抓的确实是"复用"。
    const rootA = makeStubEl('div');
    renderHome(rootA as unknown as HTMLElement, nav);
    const bgA = one(rootA, 'home-bg');
    const rootB = makeStubEl('div');
    renderHome(rootB as unknown as HTMLElement, nav);
    const bgB = one(rootB, 'home-bg');
    expect(bgA, '分别渲染出来的两份背景居然相等 ⇒ 上面的 toBe 判据是恒真的').not.toBe(bgB);
    // 且两次的洗牌顺序**不保证相同**（那是 `Math.random()` 的既有行为，本文件不改它）
    expect(descendants(bgA).length).toBe(descendants(bgB).length);
  });
});

/* ==================================================================== *
 * ★★ 2026-10-01（真机 A 号缺陷）：**桩不许再让人写只读属性**
 *
 * 现场：D2 那一轮的 `clearRoot` 里有一句 `(child as …).parentElement = null`，
 * 真浏览器里 `parentElement` 是只读 getter ⇒ **离开首页必炸**
 * （用户真机报的就是它，而且被写盘失败提示捎带出去）。
 * 它当时"单测全绿"的原因只有一个：**桩把 `parentElement` 当普通可写字段**。
 *
 * 这一组钉住加固本身，免得哪天有人为了"让某个夹具好写"把只读守卫拆掉。
 * ==================================================================== */

describe('★★ A 号缺陷：DOM 桩把只读属性做成真语义（写它当场抛）', () => {
  it('写 `parentElement` ⇒ 抛 TypeError（与浏览器的失败模式同款）', () => {
    const node = makeStubEl('div');
    expect(() => {
      (node as unknown as { parentElement: unknown }).parentElement = null;
    }, '桩允许写 parentElement —— 这正是 A 号缺陷在单测里隐身的原因').toThrow(TypeError);
    expect(() => {
      (node as unknown as { parentElement: unknown }).parentElement = makeStubEl('div');
    }).toThrow(/only a getter/);
  });

  it('写 `ownerDocument` ⇒ 同样抛（同一族只读访问器）', () => {
    const node = makeStubEl('div');
    expect(() => {
      (node as unknown as { ownerDocument: unknown }).ownerDocument = {};
    }, '桩允许写 ownerDocument').toThrow(TypeError);
  });

  it('读侧照旧：`appendChild` / `remove` / `textContent = \'\'` 维护的父子关系一字不变', () => {
    const parent = makeStubEl('div');
    const child = makeStubEl('span');
    parent.appendChild(child);
    expect(child.parentElement, 'appendChild 之后父指针不对').toBe(parent);
    expect(parent.children.length).toBe(1);
    (child as unknown as { remove(): void }).remove();
    expect(child.parentElement, 'remove 之后父指针没清').toBeNull();
    expect(parent.children.length).toBe(0);

    const a = makeStubEl('i');
    const b = makeStubEl('i');
    parent.appendChild(a);
    parent.appendChild(b);
    (parent as unknown as { textContent: string }).textContent = '';
    expect(a.parentElement, 'textContent = "" 没清父指针').toBeNull();
    expect(b.parentElement).toBeNull();
  });

  it('接缝是显式的：`setStubParentFor` / `setStubOwnerDocumentFor` 能给夹具指定父/文档', () => {
    const parent = makeStubEl('div');
    const child = makeStubEl('span');
    setStubParentFor(child, parent);
    expect(child.parentElement).toBe(parent);

    const doc = { createElement: (t: string) => makeStubEl(t) };
    setStubOwnerDocumentFor(parent, doc);
    expect((parent as unknown as { ownerDocument: unknown }).ownerDocument).toBe(doc);
    // 子节点**继承**最近祖先的覆盖（真 DOM 里同一棵树的节点本就同属一个文档）
    expect((child as unknown as { ownerDocument: unknown }).ownerDocument).toBe(doc);
  });

  it('★ 真产出代码在**整条首页重画**里一次都没写过只读属性（写就抛，本用例因此红）', () => {
    // 判据不是"源码里有没有那串字"（那是文本腿），而是**真跑**：`renderHome` 走两帧
    // （含 `clearRoot` → `detachLiveBg` → 复用背景那一整条路），只要有人写只读属性，这里当场抛。
    const root = makeStubEl('div');
    expect(() => {
      renderHome(root as unknown as HTMLElement, nav);
      renderHome(root as unknown as HTMLElement, nav);
    }, '首页重画路径上有人写了 DOM 只读属性（真机 A 号缺陷就是它）').not.toThrow();
    expect(queryAllIn(root, '.home-bg').length, '两帧之后背景不在了').toBe(1);
  });
});
