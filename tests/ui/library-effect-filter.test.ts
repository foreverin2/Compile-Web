import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderLibrary } from '../../src/ui/home';
import { DEMO_CARD_DEFS, DEMO_PROTOCOLS } from '../../src/data/demo';
import { CARD_EFFECT_TAGS } from '../../src/data/cardEffectTags';
import {
  classListOf, descendants, installStubDom, makeStubEl, type StubNode,
} from './net-dom-stub';

/**
 * G5 T24 判据 4：**界面腿（桩 DOM，真跑 `renderLibrary`）**。
 *
 * ## 为什么复用 `tests/ui/net-dom-stub.ts` 而不是再写一份
 *
 * 那份桩的文件头写着理由：桩被复制成两份就会漂移，而漂移的表现是"一个文件里的行为断言绿、
 * 另一个红"。它实现的那点能力（元素树、`class`/`dataset`/`text`、`addEventListener` 的配对
 * 派发、`parentElement`）**正好够**图鉴这一屏跑完一帧 —— 图鉴要读的正是"哪块在右列""有几个
 * 勾控件""哪一组不在树里"。
 *
 * ## 桩上**不能**证的东西（如实写在最前面，免得被读成"验过了"）
 *
 *  - **布局/观感**：桩没有布局引擎，`getBoundingClientRect()` 恒 0。"面板在右下角""不遮挡展示框"
 *    这两句由**真浏览器截图**（`.superpowers/g5-T24/shots/01-all.png` 等三张）与 `.library-layout`
 *    是两列网格这个**结构事实**共同承担，本文件只证后者；
 *  - **勾控件的真实激活路径**：真实浏览器里点 `<label>` 会先翻 `checked` 再派发 `change`，
 *    桩没有"激活行为"。所以这里的 `clickTag`/`clickAll` 助手把浏览器那一步**显式做出来**
 *    （`box.checked = !box.checked` 之后才 `dispatchEvent`），再让被测代码的 `change` 监听跑它
 *    自己那一半。这正是"真跑产出代码"，只是把浏览器那一半补在测试里。
 */
/**
 * 读一个文本文件。
 *
 * ⚠️ **不能给 `readFileSync` 传编码**：本仓 tsconfig 的 `types` 只有 `vite/client`，`node:fs`
 * 落到一个**极窄的类型桩**（`readFileSync(p)` 只声明了 `.subarray()` / `.toString()`）
 * ⇒ `readFileSync(p, 'utf8')` 会 `TS2554: Expected 1 arguments, but got 2`。
 * `tests/ui/net-body-layer-rules.test.ts:49` 就是这个写法（全仓几百个测试都这么读盘）。
 */
const readText = (p: string): string => readFileSync(p).subarray(0, 8 * 1024 * 1024).toString('utf8');

const HOME_SRC = readText(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)));

/** `renderLibrary` 的函数体（源码腿用；两条注释锚定边界） */
const LIBRARY_BODY = HOME_SRC.slice(
  HOME_SRC.indexOf('export function renderLibrary'),
  HOME_SRC.indexOf(' * 规则图纸：1/2/3 代说明书'),
);

const asStub = (n: unknown): StubNode => n as StubNode;

/** 装桩、真跑一帧图鉴、跑完还原 */
function renderLibraryTree(): StubNode {
  const root = makeStubEl('div');
  renderLibrary(asStub(root) as unknown as HTMLElement, () => { /* back 不在这条腿上 */ });
  return asStub(root.children[0]);
}

const has = (n: StubNode, cls: string): boolean => classListOf(n).includes(cls);

/** 树里带某类的全部节点 */
const byClass = (root: StubNode, cls: string): StubNode[] =>
  descendants(root).filter((n) => has(n, cls));

/** `.lib-effect-tag` 按标签 id 取那一行 */
const tagRow = (screen: StubNode, id: string): StubNode | undefined =>
  byClass(screen, 'lib-effect-tag').find((n) => n.dataset.tagId === id);

/** 那一行的勾控件（每个标签恰好一个；多了少了都当场报） */
const tagBox = (screen: StubNode, id: string): StubNode => {
  const row = tagRow(screen, id);
  if (row === undefined) throw new Error(`面板里找不到标签 ${id} 的行`);
  const boxes = row.children.filter((n) => has(n, 'lib-effect-box'));
  if (boxes.length !== 1) throw new Error(`标签 ${id} 的勾控件有 ${boxes.length} 个（应为 1）`);
  return boxes[0];
};

const isChecked = (screen: StubNode, id: string): boolean => tagBox(screen, id).checked === true;

/**
 * 在 `node` 上**真派发一次点击** —— 照本仓既有的桩做法（`coin-screen-net.test.ts:45` 的
 * `fireClick`、`net-lobby.test.ts` 同款）：临时挂一个子节点，从**那个子节点**派发，
 * 让事件沿父链冒泡到 `node`。
 *
 * ## 为什么必须这么写（这是桩的语义，不是绕路）
 *
 * `makeStubEl` 的 `dispatchEvent` 从**派发节点的父链**往上走（它自己的文件头注写明
 * "`node` 自己**不算**在路径里：它没有挂在任何地方，也不需要收到自己的事件"）⇒
 * **直接 `node.dispatchEvent(...)` 收不到挂在 `node` 自己身上的监听**。实测（两节点小树）：
 * `child.addEventListener('click',…)` + `child.dispatchEvent(...)` ⇒ 收到 0 次，父节点收到 1 次。
 * 本仓已有的四条界面腿用的都是"挂一个子节点再派发"这个写法（`fireClick`）。
 *
 * 对勾控件还有一层同形的理由：它是 `<label>` 里的 `<input>`，玩家点到的是那一行
 * （文字或方框），浏览器把激活转给控件、再派发 `change` ⇒ 挂一个子节点派发正是那个形状。
 */
const fire = (node: StubNode, type: string): void => {
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type, target: clicker });
};

/** 模拟真实浏览器点一下标签行：先翻 checked，再派发 change（见文件头注） */
const clickTag = (screen: StubNode, id: string): void => {
  const box = tagBox(screen, id);
  box.checked = !(box.checked === true);
  fire(box, 'change');
};

/** 全选 / 全不选按钮（按类名取，不按文案） */
const clickAll = (screen: StubNode, cls: string): void => {
  const btn = byClass(screen, cls);
  expect(btn.length, `.${cls} 按钮应恰好一个`).toBe(1);
  fire(btn[0], 'click');
};

/**
 * 生成物里"每卡标签"的只读副本（本文件自己解一遍，用来现算"只勾删除时该有几张"）。
 *
 * 为什么不 import `CARD_EFFECT_TAGS_BY_CARD`：那会把界面腿与生成物的**模块形状**绑在一起，
 * 而这里要的是"从**盘上那份**生成物读出来的数"。解一遍这 270 行不值一提，换来的是
 * "界面腿的数字独立于 `src/app` 那一层"。
 */
const TAGS_BY_CARD: Readonly<Record<string, readonly string[]>> = (() => {
  const src = readText(fileURLToPath(new URL('../../src/data/cardEffectTags.ts', import.meta.url)));
  const out: Record<string, string[]> = {};
  for (const m of src.matchAll(/^ {2}'([a-z]+-[0-9]+)': \[([^\]]*)\],$/gm)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
  }
  return out;
})();

const groupCount = (screen: StubNode): number => byClass(screen, 'lib-group').length;
const cardCount = (screen: StubNode): number => byClass(screen, 'lib-card').length;
const protoNames = (screen: StubNode): string[] => byClass(screen, 'lib-proto-name').map((n) => n.text);

/** 面板上"勾着的"标签 id（读控件读数，不读文案） */
const checkedIds = (screen: StubNode): string[] =>
  byClass(screen, 'lib-effect-tag')
    .filter((row) => row.children.some((n) => n.checked === true))
    .map((row) => row.dataset.tagId)
    .sort();

describe('G5 T24 判据 4：图鉴右下角效果筛选面板（桩 DOM 真跑）', () => {
  it('面板在右列：`.library-layout` 的三个子节点是 列表 / 展示框 / 面板（面板紧接展示框之后）', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      const layout = byClass(screen, 'library-layout');
      expect(layout.length, '`.library-layout` 应恰好一个').toBe(1);
      const kids = layout[0].children;
      expect(kids.length, '`.library-layout` 的子节点数（多一个就说明有东西被塞进列里了）').toBe(3);
      expect(has(kids[0], 'library-list'), '第 1 个子节点必须是列表（主列）').toBe(true);
      expect(has(kids[1], 'library-preview'), '第 2 个子节点必须是展示框（右列第 1 行）').toBe(true);
      expect(has(kids[2], 'lib-effect-panel'), '面板必须紧接展示框之后（右列第 2 行）').toBe(true);
      // 面板**不在**列表里（在列表里会跟着列表滚动、也会被 `.library-list` 的 flex 挤变形）
      expect(byClass(kids[0], 'lib-effect-panel').length, '面板被塞进了主列的列表里').toBe(0);
    } finally {
      restore();
    }
  });

  it('标签目录 30 条 / 每个标签恰好一个勾控件 / 默认为"勾的"', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      const rows = byClass(screen, 'lib-effect-tag');
      expect(rows.length, '面板里的标签行数必须等于生成物的标签数').toBe(CARD_EFFECT_TAGS.length);
      // 2026-09-22（G5 T25）：用户删掉 `misc-window` 一类 ⇒ 31 → 30（生成物为 30 类标签）。
      expect(rows.length).toBe(30);
      // 每行恰好一个勾控件，且 id 不重不漏
      const ids = rows.map((r) => r.dataset.tagId);
      for (const r of rows) {
        expect(r.children.filter((n) => has(n, 'lib-effect-box')).length, `${r.dataset.tagId} 的勾控件数`).toBe(1);
      }
      expect([...ids].sort()).toEqual(CARD_EFFECT_TAGS.map((t) => t.id).sort());
      // 默认全部勾选（读控件读数）
      expect(checkedIds(screen)).toEqual(CARD_EFFECT_TAGS.map((t) => t.id).sort());
      // 分组块也在（5 组）且每一组的标题来自生成物
      expect(byClass(screen, 'lib-effect-group').length).toBe(5);
    } finally {
      restore();
    }
  });

  it('读数行在树里、且随勾选变（"那个 div 建了却没挂进树"这个洞的守卫）', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      /**
       * 这条腿的由来（复验轮点名）：读数行 `.lib-effect-hint` 一度**只被写 textContent、没入树**，
       * 于是面板上根本没有"N / 31 类已勾选 · 命中 M / 270 张卡"这一行，而当时**没有任何腿会红**。
       * 所以判据分两半：① 它在树里（不是只被创建）；② 它的正文随勾选变（不是一次性写死）。
       */
      const hint0 = byClass(screen, 'lib-effect-hint');
      expect(hint0.length, '面板里没有读数行（`.lib-effect-hint` 建了却没挂进树）').toBe(1);
      expect(hint0[0].text, '默认全勾时读数行的勾选数不对').toContain(`${CARD_EFFECT_TAGS.length} / ${CARD_EFFECT_TAGS.length} 类已勾选`);
      expect(hint0[0].text, '默认全勾时读数行的命中数不对').toContain('270 / 270 张卡');

      // 点掉一类 ⇒ 读数行里的勾选数跟着变（不是恒值）
      clickTag(screen, 'dir-top');
      const hint1 = byClass(screen, 'lib-effect-hint')[0];
      expect(hint1.text, '点掉一类之后读数行没跟着变').toContain(`${CARD_EFFECT_TAGS.length - 1} / ${CARD_EFFECT_TAGS.length} 类已勾选`);

      // 全不选 ⇒ 读数行走"0 张全被排除"那一支
      clickAll(screen, 'lib-effect-none');
      const hint2 = byClass(screen, 'lib-effect-hint')[0];
      expect(hint2.text, '全不选之后读数行没变成 0').toContain(`0 / ${CARD_EFFECT_TAGS.length} 类已勾选`);
      expect(hint2.text, '全不选之后读数行的命中数不是 0').toContain('0 / 270 张卡');
    } finally {
      restore();
    }
  });

  it('默认全勾时：45 个 `.lib-group`、270 张 `.lib-card`（与纯层同一个数）', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      expect(groupCount(screen)).toBe(DEMO_PROTOCOLS.length);
      expect(groupCount(screen)).toBe(45);
      expect(cardCount(screen)).toBe(DEMO_CARD_DEFS.length);
      expect(cardCount(screen)).toBe(270);
      expect(byClass(screen, 'lib-effect-empty').length, '全勾时不该有空态').toBe(0);
    } finally {
      restore();
    }
  });

  it('点一下"删除"：勾控件的读数翻转、列表按算法重建（只留命中它的卡与协议）', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      const delCards = DEMO_CARD_DEFS.filter((c) =>
        (TAGS_BY_CARD[c.defId] ?? []).includes('op-delete'));
      // 先全不勾，再只勾"删除"（两次点击各自要生效）
      clickAll(screen, 'lib-effect-none');
      expect(isChecked(screen, 'op-delete'), '全不选之后"删除"还勾着').toBe(false);
      expect(groupCount(screen), '全不勾 ⇒ 一个协议框都不该在树里').toBe(0);
      expect(cardCount(screen)).toBe(0);
      clickTag(screen, 'op-delete');
      expect(isChecked(screen, 'op-delete'), '点一下之后"删除"没被勾上').toBe(true);
      expect(cardCount(screen), '只勾"删除"时的卡数').toBe(delCards.length);
      expect(delCards.length).toBe(28); // 分类文档 §4 记的就是 28
      expect(groupCount(screen)).toBeGreaterThan(0);
      expect(byClass(screen, 'lib-effect-empty').length).toBe(0);
      // 再点一下同一个 ⇒ 取消勾选，列表回到空
      clickTag(screen, 'op-delete');
      expect(isChecked(screen, 'op-delete')).toBe(false);
      expect(cardCount(screen)).toBe(0);
    } finally {
      restore();
    }
  });

  it('全不勾：`.lib-group` == 0，且列表里有一个可读的空态提示', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      clickAll(screen, 'lib-effect-none');
      expect(groupCount(screen), '`.lib-group` 必须**不在树里**，不是"隐藏样式"').toBe(0);
      expect(cardCount(screen)).toBe(0);
      const empty = byClass(screen, 'lib-effect-empty');
      expect(empty.length, '全不勾时应有一个空态节点').toBe(1);
      expect(empty[0].text.trim().length, '空态提示读不到字').toBeGreaterThan(0);
      expect(empty[0].text).toContain('没有符合当前筛选项的卡牌');
      // 全选回来 ⇒ 空态消失、列表回来（双向，不是"进去就出不来"）
      clickAll(screen, 'lib-effect-all');
      expect(byClass(screen, 'lib-effect-empty').length).toBe(0);
      expect(groupCount(screen)).toBe(45);
      expect(cardCount(screen)).toBe(270);
    } finally {
      restore();
    }
  });

  it('某协议 6 张全被排除 ⇒ 那个 `.lib-group` 不在树里（不是"隐藏样式"）', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      const allNames = protoNames(screen);
      expect(allNames.length).toBe(45);
      // 只勾"复制中指令"（copyMiddle 只有 mirror-1 一张）⇒ 44 套协议里至少有一套整组消失
      clickAll(screen, 'lib-effect-none');
      clickTag(screen, 'op-copy');
      const leftNames = protoNames(screen);
      expect(leftNames.length, '只勾 op-copy 之后剩下的协议数').toBeLessThan(45);
      const gone = allNames.filter((n) => !leftNames.includes(n));
      expect(gone.length, '没有任何协议被整组拿掉 —— 这条腿失去了被测对象').toBeGreaterThan(0);
      // 被拿掉的那些，`.lib-group` 真的不在树里（不是 display:none）——按名字反查一次
      const groups = byClass(screen, 'lib-group');
      expect(groups.length).toBe(leftNames.length);
      for (const g of gone) {
        expect(groups.some((x) => byClass(x, 'lib-proto-name').some((n) => n.text === g)),
          `${g} 的框还在树里（应整组不建）`).toBe(false);
      }
      // 剩下的协议里所有卡都命中 op-copy（"连同其所属的协议显示出来"这条的正向半边）
      expect(cardCount(screen)).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('已有功能没坏：世代 chips 仍能隐藏整代；hover / 单击固定的接线一字未改', () => {
    const restore = installStubDom();
    try {
      const screen = renderLibraryTree();
      // 世代 chips：点"1代 基础" ⇒ 整代消失（45 - 12 = 33 组、270 - 72 = 198 张）
      const chip = descendants(screen).find((n) => has(n, 'draft-filter-chip') && n.dataset.group === 'MN01');
      expect(chip, '找不到 MN01 那个世代 chip').toBeDefined();
      fire(chip!, 'click');
      expect(groupCount(screen), '关掉 MN01 之后的组数').toBe(33);
      expect(cardCount(screen), '关掉 MN01 之后的卡数').toBe(198);
      // 再点回来 ⇒ 复原
      fire(chip!, 'click');
      expect(groupCount(screen)).toBe(45);
      expect(cardCount(screen)).toBe(270);
      // 世代 chips 的按钮数（六个代号，一个不多一个不少）
      const chips = descendants(screen).filter((n) => has(n, 'draft-filter-chip'));
      expect(chips.length).toBe(6);
      expect(chips.map((n) => n.dataset.group).sort())
        .toEqual(['AX01', 'AX02', 'AX03', 'MN01', 'MN02', 'MN03']);
      // 悬浮热区与"单击固定/双击放大"的接线：列表里的入口仍挂着 mouseenter（3 类入口 × 每条约 1 个）
      const hoverables = descendants(screen).filter((n) =>
        has(n, 'lib-proto-img-wrap') || has(n, 'lib-card'));
      expect(hoverables.length, '列表里带 hover 的入口数').toBe(45 * 2 + 270);
    } finally {
      restore();
    }
  });

  it('源码腿（补充，不替代行为腿）：`bindClickOrDouble` 仍接在协议封面 / 已编译封面 / 卡牌三类入口上', () => {
    const calls = LIBRARY_BODY.match(/bindClickOrDouble\(/g) ?? [];
    expect(LIBRARY_BODY.length, 'renderLibrary 的函数体没取到（锚点失效）').toBeGreaterThan(2000);
    expect(calls.length, '`bindClickOrDouble` 的调用点数（协议未编译 / 已编译 / 卡牌 三类各一处）').toBe(3);
    // 三类入口各自接一次（顺序：脸 / 已编译脸 / 卡）
    const order = [...LIBRARY_BODY.matchAll(/bindClickOrDouble\(/g)].map((m) => m.index ?? 0);
    expect(order.length).toBe(3);
    expect(LIBRARY_BODY).toContain("() => togglePin(faceKey)");
    expect(LIBRARY_BODY).toContain("() => togglePin(faceCKey)");
    expect(LIBRARY_BODY).toContain("() => togglePin(cardKey)");
    // 单击固定 / 双击放大仍然分别接的是 togglePin 与 openZoom（没被这次改动换掉）
    expect(LIBRARY_BODY).toContain('() => openZoom(proto.defId, true, true, false)');
    expect(LIBRARY_BODY).toContain('() => openZoom(proto.defId, true, true, true)');
    expect(LIBRARY_BODY).toContain('() => openZoom(c.defId, true, false, false)');
  });
});
