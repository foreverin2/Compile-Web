import { describe, it, expect, afterEach } from 'vitest';
import {
  installStubDom,
  makeStubEl,
  descendants,
  queryAllIn,
  type StubNode,
} from './net-dom-stub';
import { CREDIT, renderCardmaker, type CardmakerNav, type CardmakerStore } from '../../src/ui/cardmaker/page';
import { CARD_H, CARD_W, LAND_H, LAND_W, SCALE_MAX, SCALE_MIN } from '../../src/ui/cardmaker/config';
import { parseDeck, stringifyDeck } from '../../src/ui/cardmaker/serialize';
import { defaultCard, defaultDeck, type Deck } from '../../src/ui/cardmaker/types';

/**
 * 「自定义协议与卡牌」屏的**接线行为腿**（2026-10-01）。
 *
 * ## 用什么跑
 * 本仓既有的手写 DOM 桩（`tests/ui/net-dom-stub.ts`），**不装 jsdom**。它给得出
 * `createElement` / `className` / `dataset` / `textContent` / 事件冒泡，但**没有**：
 * 布局（`getBoundingClientRect` 全 0）、2D 上下文（`getContext()` 返回 `null`）、
 * `document.fonts`。所以这一组能证明的是：
 *  - 屏的结构与交互**接线**（点哪个按钮调哪个回调、输入写回哪份数据、状态码是什么）；
 *  - 数据流（编辑 → 内存里的牌组 → 交给 `nav.store.save` 的**同一份内容**）；
 *  - 每条失败路径的**可辨识结论**（不是一句笼统的"失败"）。
 *
 * 它**不能**证明的：卡面画出来好不好看、导出 PNG 的像素、真浏览器里的拖拽手感 ——
 * 那些是真浏览器门与人眼项（本报告"未验项"一节点名了）。
 *
 * 桩的已知边界（与 `local-data-screen.test.ts` 同一套规避手法）：
 * `dispatchEvent` **只向祖先冒泡、不调用派发节点自己的监听器** ⇒ 点按钮要用
 * `clickRole()` 的"临时挂一个空子节点、在它上面派发、再摘掉"。
 */

/* ---------------- 夹具 ---------------- */

const restores: Array<() => void> = [];

function mountRoot(): StubNode {
  restores.push(installStubDom());
  return makeStubEl('div');
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

function textOf(n: StubNode): string {
  return descendants(n).map((x) => x.text).join('\n');
}

function byRole(root: StubNode, role: string): StubNode[] {
  return queryAllIn(root, `[data-role="${role}"]`);
}

function one(root: StubNode, role: string): StubNode {
  const hits = byRole(root, role);
  expect(hits.length, `屏上应有唯一一个 [data-role="${role}"]，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

function statusCode(root: StubNode): unknown {
  return one(root, 'status').dataset.code;
}

function clickRole(root: StubNode, role: string): string {
  const btn = one(root, role);
  const label = btn.text;
  const clicker = makeStubEl('span');
  btn.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  btn.textContent = label;
  return label;
}

/** 在某个节点上派发一个事件（`offsetX/offsetY/deltaY` 这些字段会被带进监听器） */
function fire(node: StubNode, type: string, ev: Record<string, unknown> = {}): void {
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type, target: clicker, ...ev });
  node.textContent = node.text;
}

const flush = (): Promise<void> => new Promise<void>((r) => { setTimeout(r, 0); });

/**
 * 把屏上的**防抖保存**（`scheduleSave()` 缺省 700ms）也跑完。
 *
 * 为什么必须等它：`saveNow()` 会写状态行（`saved` / `save-failed`）。如果不等，
 * 一条更早的防抖保存会在稍后落地、把这条腿刚断言过的结论覆盖掉 —— 那样的红/绿
 * 取决于计时，而不是取决于行为。所以凡是要断言状态码的写操作，都先 `settle()`。
 */
async function settle(): Promise<void> {
  await new Promise<void>((r) => { setTimeout(r, 780); });
  await flush();
}

function setValue(node: StubNode, v: string): void {
  (node as unknown as { value: string }).value = v;
}
function valueOf(node: StubNode): string {
  return (node as unknown as { value: string }).value;
}

/** 记下每一次 `nav.download` 的调用（导出 PNG / JSON 的判据面） */
interface DownloadCall { filename: string; blob: unknown }

interface Harness {
  nav: CardmakerNav;
  saved: Deck[];
  downloads: DownloadCall[];
  counters: { back: number; uploads: number; reads: number };
  saveResult: { ok: boolean; detail: string };
  persistent: boolean;
  loaded: Deck | null;
  loadError: Error | null;
  setUpload(v: string | null): void;
  setUploadError(e: Error): void;
  setReadText(v: string | null): void;
  setReadTextError(e: Error): void;
}

function harness(opts: {
  loaded?: Deck | null;
  persistent?: boolean;
  save?: { ok: boolean; detail: string };
  loadError?: Error;
} = {}): Harness {
  const saved: Deck[] = [];
  const downloads: DownloadCall[] = [];
  const counters = { back: 0, uploads: 0, reads: 0 };
  const state: Harness = {
    saved,
    downloads,
    counters,
    saveResult: opts.save ?? { ok: true, detail: '' },
    persistent: opts.persistent ?? true,
    loaded: opts.loaded ?? null,
    loadError: opts.loadError ?? null,
    setUpload: (v) => { uploadValue = v; },
    setUploadError: (e) => { uploadError = e; },
    setReadText: (v) => { readTextValue = v; },
    setReadTextError: (e) => { readTextError = e; },
    nav: null as unknown as CardmakerNav,
  };
  let uploadValue: string | null = null;
  let uploadError: Error | null = null;
  let readTextValue: string | null = null;
  let readTextError: Error | null = null;
  const store: CardmakerStore = {
    isPersistent: () => state.persistent,
    load: async () => {
      if (state.loadError !== null) throw state.loadError;
      return state.loaded;
    },
    save: async (deck) => {
      saved.push(deck);
      return state.saveResult;
    },
  };
  state.nav = {
    back: () => { counters.back += 1; },
    store,
    readTextFile: async () => {
      counters.reads += 1;
      if (readTextError !== null) throw readTextError;
      return readTextValue;
    },
    uploadDataUrl: async () => {
      counters.uploads += 1;
      if (uploadError !== null) throw uploadError;
      return uploadValue;
    },
    download: (filename, blob) => { downloads.push({ filename, blob }); },
  };
  return state;
}

function render(h: Harness): StubNode {
  const root = mountRoot();
  renderCardmaker(root as unknown as HTMLElement, h.nav);
  return root;
}

/** 渲染之后把启动链（读本机 → 载素材 → 载字体 → 重画）跑完 */
async function renderSettled(h: Harness): Promise<StubNode> {
  const root = render(h);
  await flush();
  return root;
}

/* ==================================================================== *
 * 1. 渲染与启动
 * ==================================================================== */

describe('渲染与启动', () => {
  it('是整屏屏：重渲染后只剩一份树', () => {
    const h = harness();
    const root = mountRoot();
    renderCardmaker(root as unknown as HTMLElement, h.nav);
    renderCardmaker(root as unknown as HTMLElement, h.nav);
    expect(queryAllIn(root, 'div.cardmaker-screen').length, '重渲染出现两份屏').toBe(1);
  });

  it('本机上没有牌组时开局给两张卡（竖版 + 横版），且横版卡被选中时的类型对得上', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const rows = byRole(root, 'card-row');
    expect(rows.length, '开局应当有两张卡').toBe(2);
    const kinds = rows.map((r) => r.dataset.cardKind).sort();
    expect(kinds).toEqual(['compile', 'protocol']);
  });

  it('本机有牌组时读回来（张数正确、标题回填、状态码是 loaded）', async () => {
    const deck = defaultDeck();
    deck.title = '我的套牌';
    deck.cards = [defaultCard('p', 'protocol'), defaultCard('c', 'compile')];
    const h = harness({ loaded: deck });
    const root = await renderSettled(h);
    expect(statusCode(root)).toBe('loaded');
    expect(byRole(root, 'card-row').length).toBe(2);
    expect(valueOf(one(root, 'deck-title'))).toBe('我的套牌');
  });

  it('读本机失败 ⇒ 如实提示（load-failed）并仍然给出一份可用的空牌组', async () => {
    const h = harness({ loadError: new Error('IndexedDB 被占用') });
    const root = await renderSettled(h);
    expect(statusCode(root)).toBe('load-failed');
    expect(one(root, 'status').text, '没把真因写出来').toContain('IndexedDB 被占用');
    expect(byRole(root, 'card-row').length, '读失败之后屏上没有卡可用').toBeGreaterThan(0);
  });

  it('游客模式（isPersistent = false）时：屏上 data-persistent = no，且状态文案说清"刷新就丢"', async () => {
    const h = harness({ persistent: false });
    const root = await renderSettled(h);
    expect(one(root, 'screen').dataset.persistent).toBe('no');
    expect(one(root, 'status').text).toContain('刷新或关闭页面就会丢');
    // 反向：允许保存时文案与属性都不是这一档
    const h2 = harness({ persistent: true });
    const r2 = await renderSettled(h2);
    expect(one(r2, 'screen').dataset.persistent).toBe('yes');
    expect(one(r2, 'status').text).toContain('自动保存到本机');
  });

  it('「← 返回主页面」调一次 nav.back', async () => {
    const h = harness();
    const root = await renderSettled(h);
    expect(clickRole(root, 'back')).toContain('返回主页面');
    expect(h.counters.back).toBe(1);
  });

  it('canvas 的尺寸等于当前卡的设计空间（竖版 744×1039 / 横版 1039×744）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const canvas = one(root, 'canvas') as unknown as { width: number; height: number };
    // 第一张卡是竖版（startup 里先加 compile）
    expect(canvas.width).toBe(CARD_W);
    expect(canvas.height).toBe(CARD_H);
    // 换成横版卡（点它的「横版协议卡」按钮）
    const protoRow = byRole(root, 'card-row').find((r) => r.dataset.cardKind === 'protocol');
    expect(protoRow, '夹具失败：没有横版卡那一行').toBeTruthy();
    const openBtn = descendants(protoRow as StubNode).find((n) => n.tag === 'button');
    expect(openBtn).toBeTruthy();
    if (openBtn) fire(openBtn, 'click');
    await flush();
    expect(canvas.width, '切换横版卡之后画布宽度没换').toBe(LAND_W);
    expect(canvas.height).toBe(LAND_H);
  });
});

/* ==================================================================== *
 * 2. 编辑：文本写回牌组、并交给存储
 * ==================================================================== */

describe('编辑文本', () => {
  it('在「协议名 / 标题」里打字 ⇒ 写回当前卡，并在防抖之后把**同一份牌组**交给 store.save', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const input = one(root, 'title');
    setValue(input, 'N E O N');
    fire(input, 'input');
    // 打字本身**不**立刻写盘（防抖）
    expect(h.saved, '打字当场就写盘了（防抖没生效）').toHaveLength(0);
    // 防抖窗口过去 ⇒ 写盘，且写进去的就是刚打的那份
    await settle();
    expect(h.saved.length, '防抖之后没有写盘').toBe(1);
    expect(h.saved[0].cards[0].title, '标题没有进到交给存储的那份牌组里').toBe('N E O N');
    expect(statusCode(root)).toBe('saved');
  });

  it('面板文本写回，并把"几段 / 有行内标记"写进面板说明（`**` / `__` 的提示在屏上）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const mid = one(root, 'panel-mid');
    setValue(mid, '一行\n**两行**');
    fire(mid, 'input');
    const note = textOf(one(root, 'panel-note'));
    expect(note, '面板说明没更新段数').toContain('2 段');
    expect(note, '面板说明没说有行内标记').toContain('含行内标记');
    expect(note, '面板说明没教怎么写行内标记').toContain('**粗体**');
    expect(note, '面板说明没教下划线').toContain('__下划线__');
    // 也真的写回牌组（点一次显式保存，免得断言依赖防抖计时）
    clickRole(root, 'save');
    await flush();
    expect(h.saved[h.saved.length - 1].cards[0].panelMid).toBe('一行\n**两行**');
  });

  it('三条面板都空时，屏上明说"不会画面板底衬"（这是参考项目的真实行为）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    expect(textOf(one(root, 'panel-note'))).toContain('不会画面板底衬');
  });

  it('横版协议卡：三段面板与数值输入被**关掉**（填了不生效比填不了更坏）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    // 第一张是竖版：那几个是开着的
    expect((one(root, 'panel-top') as unknown as { disabled?: boolean }).disabled).toBe(false);
    expect((one(root, 'value') as unknown as { disabled?: boolean }).disabled).toBe(false);
    expect((one(root, 'compile-top') as unknown as { disabled?: boolean }).disabled).toBe(true);
    // 切到横版
    const protoRow = byRole(root, 'card-row').find((r) => r.dataset.cardKind === 'protocol');
    const openBtn = descendants(protoRow as StubNode).find((n) => n.tag === 'button');
    if (openBtn) fire(openBtn, 'click');
    expect((one(root, 'panel-top') as unknown as { disabled?: boolean }).disabled, '横版卡的三段面板没关掉').toBe(true);
    expect((one(root, 'value') as unknown as { disabled?: boolean }).disabled, '横版卡的数值没关掉').toBe(true);
    expect((one(root, 'compile-top') as unknown as { disabled?: boolean }).disabled, '横版卡的小字没打开').toBe(false);
    expect(textOf(one(root, 'panel-note'))).toContain('只对竖版编译卡有效');
  });

  it('牌组名改了就写进牌组（导出文件名用它）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const t = one(root, 'deck-title');
    setValue(t, '我的套牌');
    fire(t, 'input');
    await settle();
    const last = h.saved[h.saved.length - 1];
    expect(last, '牌组名改动没有触发保存').toBeTruthy();
    expect(last.title).toBe('我的套牌');
  });

  it('点「保存到本机」⇒ 结论是 saved（并且写的就是当前那份牌组）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'save');
    await flush();
    expect(statusCode(root)).toBe('saved');
    expect(h.saved.length).toBeGreaterThan(0);
  });

  it('写盘失败 ⇒ save-failed + 真因；游客模式 ⇒ saved-memory 并说清会丢', async () => {
    const bad = harness({ save: { ok: false, detail: '配额已满' } });
    const rb = await renderSettled(bad);
    clickRole(rb, 'save');
    await flush();
    expect(statusCode(rb)).toBe('save-failed');
    expect(one(rb, 'status').text, '写盘失败没把真因写出来').toContain('配额已满');

    const mem = harness({ persistent: false });
    const rm = await renderSettled(mem);
    clickRole(rm, 'save');
    await flush();
    expect(statusCode(rm)).toBe('saved-memory');
    expect(one(rm, 'status').text).toContain('游客模式');
  });
});

/* ==================================================================== *
 * 3. 卡的新增 / 删除 / 切换
 * ==================================================================== */

describe('卡的新增 / 删除 / 切换', () => {
  it('「新增竖版编译卡」加一张并切过去；「删除当前卡」把它去掉', async () => {
    const h = harness();
    const root = await renderSettled(h);
    expect(byRole(root, 'card-row').length).toBe(2);
    clickRole(root, 'add-compile');
    expect(byRole(root, 'card-row').length).toBe(3);
    expect(statusCode(root)).toBe('card-added');
    clickRole(root, 'delete-card');
    expect(byRole(root, 'card-row').length).toBe(2);
    expect(statusCode(root)).toBe('card-deleted');
  });

  it('第二张横版协议卡加不进来（整副牌只需要一张），结论是 card-add-refused', async () => {
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'add-protocol');
    expect(statusCode(root)).toBe('card-add-refused');
    expect(byRole(root, 'card-row').length, '居然真的加进去了').toBe(2);
    expect(one(root, 'status').text).toContain('只需要一张');
  });

  it('只剩一张卡时「删除当前卡」是禁用的（不允许把牌组删空）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    // 先加一张，免得"剩一张"这个状态与"开局两张"混在一起（开局两张时删一次就已经到底了）
    clickRole(root, 'add-compile');
    await flush();
    expect(byRole(root, 'card-row').length).toBe(3);
    expect((one(root, 'delete-card') as unknown as { disabled?: boolean }).disabled, '还剩三张时删除按钮就禁用了').toBe(false);
    clickRole(root, 'delete-card'); // 3 → 2（仍然不禁用）
    await flush();
    expect(byRole(root, 'card-row').length).toBe(2);
    expect((one(root, 'delete-card') as unknown as { disabled?: boolean }).disabled, '还剩两张时删除按钮就禁用了').toBe(false);
    clickRole(root, 'delete-card'); // 2 → 1
    await flush();
    expect(byRole(root, 'card-row').length).toBe(1);
    expect((one(root, 'delete-card') as unknown as { disabled?: boolean }).disabled, '只剩一张时删除按钮没禁用').toBe(true);
    clickRole(root, 'delete-card'); // 1 → 0？不该发生
    await flush();
    expect(byRole(root, 'card-row').length, '只剩一张时居然还能删').toBe(1);
  });

  it('点卡清单里的按钮切当前卡（标题输入框跟着换）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const compileInput = one(root, 'title');
    setValue(compileInput, '竖版卡的名字');
    fire(compileInput, 'input');
    expect(valueOf(one(root, 'title'))).toBe('竖版卡的名字');

    const protoRow = byRole(root, 'card-row').find((r) => r.dataset.cardKind === 'protocol');
    const openBtn = descendants(protoRow as StubNode).find((n) => n.tag === 'button');
    if (openBtn) fire(openBtn, 'click');
    expect(valueOf(one(root, 'title')), '切卡之后标题没有换').toBe('');
  });
});

/* ==================================================================== *
 * 4. 背景：预设 / 平移 / 缩放 / 重置
 * ==================================================================== */

describe('背景与平移缩放', () => {
  it('默认"不使用背景"；点一个预设之后模式行变了、缩放滑杆可用', async () => {
    const h = harness();
    const root = await renderSettled(h);
    expect(textOf(one(root, 'bg-mode'))).toContain('不使用背景');
    expect((one(root, 'zoom') as unknown as { disabled?: boolean }).disabled, '没有背景时缩放滑杆应当禁用').toBe(true);

    clickRole(root, 'preset-Fire');
    expect(statusCode(root)).toBe('bg-preset');
    expect(textOf(one(root, 'bg-mode'))).toContain('Fire');
    expect((one(root, 'zoom') as unknown as { disabled?: boolean }).disabled).toBe(false);
    // 预设是**整副牌共用**的那一套（默认模式）：两种卡都换到了
    await flush(); // setBg 走 scheduleSave(0)：让那次写盘落地再读
    const last = h.saved[h.saved.length - 1];
    expect(last.shared.compile.bg.name).toBe('Fire');
    expect(last.shared.protocol.bg.name).toBe('Fire');
  });

  it('15 个预设按钮都在屏上（名字与 PRESETS 一一对应）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const presetButtons = byRole(root, 'presets')[0] ? descendants(byRole(root, 'presets')[0]).filter((n) => n.tag === 'button') : [];
    expect(presetButtons.length).toBe(15);
    expect(presetButtons.map((b) => b.text)).toContain('Water');
    expect(presetButtons.map((b) => b.text)).toContain('Plague');
  });

  it('滚轮在卡面上 ⇒ 以光标为中心放大，滑杆读数跟着变；再点「重置背景」回 100%', async () => {
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'preset-Fire');
    await flush(); // 预设那次写盘（scheduleSave(0)）先落地，后面的读数才有基线
    expect(valueOf(one(root, 'zoom'))).toBe('100');

    const canvas = one(root, 'canvas');
    fire(canvas, 'wheel', { deltaY: -120, offsetX: 100, offsetY: 100 });
    // 1.1 倍 ⇒ 滑杆显示 110%
    expect(valueOf(one(root, 'zoom')), '滚轮没有改缩放').toBe('110');
    expect(textOf(one(root, 'zoom-value'))).toBe('110%');
    await flush();
    const last = h.saved[h.saved.length - 1];
    expect(last.shared.compile.bg.transform.scale).toBeCloseTo(1.1, 6);

    clickRole(root, 'reset-view');
    // 状态码要在**这一刻**读：重置自己也会排一次写盘，写盘落地之后状态行会被
    // 「已保存到本机」覆盖（那是**正确**行为 —— 保存确实发生了）。
    expect(valueOf(one(root, 'zoom'))).toBe('100');
    expect(statusCode(root)).toBe('bg-reset');
    await flush();
    expect(h.saved[h.saved.length - 1].shared.compile.bg.transform).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('拖拽卡面 ⇒ 背景平移量按设计空间像素累加（1 倍时 CSS 像素 == 设计像素）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'preset-Fire');
    await flush();
    const canvas = one(root, 'canvas');
    const savedBeforeDrag = h.saved.length;
    fire(canvas, 'pointerdown', { clientX: 10, clientY: 10, offsetX: 200, offsetY: 300 });
    fire(canvas, 'pointermove', { clientX: 40, clientY: 25, offsetX: 230, offsetY: 315 });
    // 拖拽过程中**不**立刻写盘（排的是 1.2 秒之后那一次）
    await flush();
    expect(h.saved.length, '拖拽过程中就写盘了（防抖没生效）').toBe(savedBeforeDrag);

    fire(canvas, 'pointerup', {}); // 松手 → 立刻排一次写盘
    await flush();
    expect(h.saved.length, '松手之后没有写盘').toBeGreaterThan(savedBeforeDrag);
    const t = h.saved[h.saved.length - 1].shared.compile.bg.transform;
    expect(t.offsetX, '水平拖了 30px').toBe(30);
    expect(t.offsetY, '垂直拖了 15px').toBe(15);
    // 松手之后不再累加（反向：再派发一次 move 不该继续动）
    const savedAfterDrag = h.saved.length;
    fire(canvas, 'pointermove', { clientX: 90, clientY: 90, offsetX: 280, offsetY: 380 });
    await flush();
    expect(h.saved[h.saved.length - 1].shared.compile.bg.transform.offsetX, '松手之后还在跟手').toBe(30);
    expect(h.saved.length, '松手之后又排了一次写盘').toBe(savedAfterDrag);
  });

  it('没有背景时拖拽**不动**（省得白攒一堆平移量）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const canvas = one(root, 'canvas');
    fire(canvas, 'pointerdown', { clientX: 10, clientY: 10, offsetX: 200, offsetY: 300 });
    fire(canvas, 'pointermove', { clientX: 60, clientY: 60, offsetX: 250, offsetY: 350 });
    fire(canvas, 'pointerup', {});
    await flush();
    // 没有背景 ⇒ 一次写盘都不该发生（连"默认值"都不必写）
    expect(h.saved, '没有背景却还是写盘了').toHaveLength(0);
    // 反向：有背景时同样的动作**会**写盘（证明上一条不是"拖拽根本没接线"）
    const h2 = harness();
    const r2 = await renderSettled(h2);
    clickRole(r2, 'preset-Fire');
    await flush();
    const c2 = one(r2, 'canvas');
    fire(c2, 'pointerdown', { clientX: 10, clientY: 10, offsetX: 200, offsetY: 300 });
    fire(c2, 'pointermove', { clientX: 60, clientY: 60, offsetX: 250, offsetY: 350 });
    fire(c2, 'pointerup', {});
    await flush();
    expect(h2.saved[h2.saved.length - 1].shared.compile.bg.transform.offsetX).toBe(50);
  });

  it('缩放滑杆的两端就是 SCALE_MIN / SCALE_MAX（不做无级放大）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const zoom = one(root, 'zoom') as unknown as { min: string; max: string };
    expect(Number(zoom.min)).toBe(Math.round(SCALE_MIN * 100));
    expect(Number(zoom.max)).toBe(Math.round(SCALE_MAX * 100));
  });

  it('打开「每张卡单独的背景」之后，给这张卡换背景**不**影响另一张', async () => {
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'preset-Fire'); // 先给整副牌一套
    await flush();
    const box = one(root, 'per-card-bg');
    (box as unknown as { checked: boolean }).checked = true;
    fire(box, 'change');
    await flush();
    clickRole(root, 'preset-Water'); // 只改当前这张（竖版卡）
    await flush();
    const last = h.saved[h.saved.length - 1];
    expect(last.shared.perCardBg).toBe(true);
    expect(last.cards.find((c) => c.kind === 'compile')?.bgOwn.name).toBe('Water');
    expect(last.shared.protocol.bg.name, '单独模式下另一张卡也被改了').toBe('Fire');
    // 反向锚点：关掉这个开关时**不该**出现 per-card 的取值
    const h2 = harness();
    const r2 = await renderSettled(h2);
    clickRole(r2, 'preset-Fire');
    await flush();
    const last2 = h2.saved[h2.saved.length - 1];
    expect(last2.shared.perCardBg).toBe(false);
  });

  it('「不使用背景」清掉背景，结论是 bg-cleared', async () => {
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'preset-Fire');
    await flush();
    clickRole(root, 'bg-clear');
    // 同上：结论先读，写盘随后落地（setBg 也会 scheduleSave(0)）
    expect(statusCode(root)).toBe('bg-cleared');
    await flush();
    expect(h.saved[h.saved.length - 1].shared.compile.bg.type).toBe('none');
  });
});

/* ==================================================================== *
 * 5. 上传背景 / logo
 * ==================================================================== */

describe('上传背景与 logo', () => {
  it('用户在选择框里取消（宿主回 null）⇒ 一个字节都不改，如实说"已取消"', async () => {
    const h = harness();
    h.setUpload(null);
    const root = await renderSettled(h);
    clickRole(root, 'bg-upload');
    await flush();
    expect(statusCode(root)).toBe('bg-upload-cancelled');
    expect(h.counters.uploads).toBe(1);
    expect(one(root, 'bg-mode').text).toContain('不使用背景');
  });

  it('宿主读图抛错 ⇒ 把真因写出来（bg-upload-failed）', async () => {
    const h = harness();
    h.setUploadError(new Error('文件读不出来'));
    const root = await renderSettled(h);
    clickRole(root, 'bg-upload');
    await flush();
    expect(statusCode(root)).toBe('bg-upload-failed');
    expect(one(root, 'status').text).toContain('文件读不出来');
  });

  it('logo 上传/清除：状态行与结论都可辨识（这条走不到"缩图"那一步时会如实报错，不假成功）', async () => {
    const h = harness();
    h.setUpload(null);
    const root = await renderSettled(h);
    clickRole(root, 'logo-upload');
    await flush();
    expect(statusCode(root)).toBe('logo-upload-cancelled');
    expect(h.counters.uploads).toBe(1);
    clickRole(root, 'logo-clear');
    expect(statusCode(root)).toBe('logo-cleared');
    expect(textOf(one(root, 'logo-state'))).toContain('未上传');
  });
});

/* ==================================================================== *
 * 6. 导出 PNG / 牌组 JSON、导入
 * ==================================================================== */

describe('导出与导入', () => {
  it('「导出当前卡 PNG」在没有 2D 上下文的桩上**如实报不支持**，不假装成功', async () => {
    // 桩的 canvas 没有 getContext ⇒ 这条腿钉的是"降级路径可辨识"。
    // 真浏览器里的像素由人眼/浏览器门负责（见报告的未验项）。
    const h = harness();
    const root = await renderSettled(h);
    clickRole(root, 'export-png');
    await flush();
    expect(statusCode(root)).toBe('export-unsupported');
    expect(h.downloads, '拿不到画布却还是落了盘（假成功）').toHaveLength(0);
    expect(one(root, 'status').text).toContain('2D 画布');
  });

  it('对横版协议卡点「按竖版编译卡导出」⇒ 拒绝并说明（横版没有竖版形态）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const protoRow = byRole(root, 'card-row').find((r) => r.dataset.cardKind === 'protocol');
    const openBtn = descendants(protoRow as StubNode).find((n) => n.tag === 'button');
    if (openBtn) fire(openBtn, 'click');
    clickRole(root, 'export-portrait');
    await flush();
    expect(statusCode(root)).toBe('export-refused');
    expect(one(root, 'status').text).toContain('横版形态');
    expect(h.downloads).toHaveLength(0);
  });

  it('「导出牌组 JSON」⇒ 落盘的文件名以 .cardmaker.json 结尾，内容是能读回来的牌组', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const t = one(root, 'deck-title');
    setValue(t, '我的套牌');
    fire(t, 'input');
    clickRole(root, 'export-json');
    expect(statusCode(root)).toBe('export-json-ok');
    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0].filename).toBe('我的套牌.cardmaker.json');
    // Blob 的文本拿不到（桩里 Blob 是真的 Blob，可以用 text()）⇒ 直接读回并解析
    const text = await (h.downloads[0].blob as Blob).text();
    const parsed = parseDeck(text);
    expect(parsed.ok, '导出的文本连自家的 parseDeck 都读不回来').toBe(true);
    if (parsed.ok) {
      expect(parsed.deck.title).toBe('我的套牌');
      expect(parsed.deck.cards.length).toBe(2);
    }
  });

  it('导入：取消 ⇒ import-cancelled、屏上不变；读文件抛错 ⇒ import-read-failed + 真因', async () => {
    const h = harness();
    h.setReadText(null);
    const root = await renderSettled(h);
    const before = byRole(root, 'card-row').length;
    clickRole(root, 'import-json');
    await flush();
    expect(statusCode(root)).toBe('import-cancelled');
    expect(byRole(root, 'card-row').length).toBe(before);

    h.setReadTextError(new Error('文件被系统锁住'));
    clickRole(root, 'import-json');
    await flush();
    expect(statusCode(root)).toBe('import-read-failed');
    expect(one(root, 'status').text).toContain('文件被系统锁住');
  });

  it('导入坏文件 ⇒ 四类失败各自可辨识，且**不**改动屏上的牌组', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const before = byRole(root, 'card-row').length;

    h.setReadText('{oops');
    clickRole(root, 'import-json');
    await flush();
    expect(statusCode(root)).toBe('import-not-json');
    expect(byRole(root, 'card-row').length, '导入失败却改了屏上的牌组').toBe(before);

    h.setReadText(JSON.stringify({ format: 'other', version: 1, deck: {} }));
    clickRole(root, 'import-json');
    await flush();
    expect(statusCode(root)).toBe('import-not-a-deck');

    h.setReadText(JSON.stringify({ format: 'compile-cardmaker-deck', version: 99, deck: {} }));
    clickRole(root, 'import-json');
    await flush();
    expect(statusCode(root)).toBe('import-bad-version');

    h.setReadText(JSON.stringify({ format: 'compile-cardmaker-deck', version: 1 }));
    clickRole(root, 'import-json');
    await flush();
    expect(statusCode(root)).toBe('import-bad-shape');
  });

  it('导入一份合法牌组 ⇒ 屏上换成新的卡清单、并立刻写一次本机', async () => {
    // 造一份**三张卡**的牌组 JSON（走产出代码自己的导出器，而不是手写 JSON）
    const deck = defaultDeck();
    deck.title = '别人的牌';
    deck.cards = [defaultCard('x1', 'compile'), defaultCard('x2', 'compile'), defaultCard('x3', 'compile')];
    const text = stringifyDeck(deck);
    // 锚点：这份文本确实是合法的（否则下面"导入成功"可能来自别的原因）
    expect(parseDeck(text).ok).toBe(true);

    const h = harness();
    const root = await renderSettled(h);
    expect(byRole(root, 'card-row').length, '前置：开局的卡数应当与 3 不同').toBe(2);
    h.setReadText(text);
    clickRole(root, 'import-json');
    await flush(); // 导入那条路异步等文件（`readTextFile` 是 Promise）
    /**
     * ⚠️ **不断言 `import-ok` 这个中间状态**：导入那条路自己会 `void saveNow()`，
     * 而写盘的成功结论（`saved`）会覆盖状态行 —— 谁先落地取决于计时（真实浏览器里
     * 也可能只看到"已保存到本机"）。判据落在**数据面**：卡清单、牌组名、交给存储的内容。
     * 失败路径（上一组）没有写盘 ⇒ 那些结论码是稳定可读的，照旧逐条断言。
     */
    expect(byRole(root, 'card-row').length).toBe(3);
    expect(valueOf(one(root, 'deck-title'))).toBe('别人的牌');
    expect(h.saved.length, '导入之后没有写本机').toBeGreaterThan(0);
    expect(h.saved[h.saved.length - 1].cards.length).toBe(3);
    await settle();
    void deck;
  });
});

/* ==================================================================== *
 * 7. 署名（用户明确要求：显眼且准确）
 * ==================================================================== */

describe('署名（用户明确要求）', () => {
  it('屏上有那三件事：作者、MIT 许可、仓库链接；且原文提到开源项目名', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const credit = one(root, 'credit');
    const text = textOf(credit);
    expect(text, '署名里没有作者名').toContain(CREDIT.author);
    expect(text, '署名里没有许可名').toContain(CREDIT.license);
    expect(text, '署名里没有开源项目名').toContain(CREDIT.project);
    expect(text, '署名里没有"参考…制作"这个口径').toContain('参考开源项目');
    expect(text, '署名里没有说素材也来自该项目').toContain('素材（卡框/背景/卡背/字体）亦来自该项目');
    // 三个数据属性各自唯一，方便别的腿（与排查）按 role 定位
    expect(one(root, 'credit-author').text).toBe(`作者：${CREDIT.author}`);
    expect(one(root, 'credit-license').text).toBe(`许可：${CREDIT.license}`);
    expect(one(root, 'credit-sentence').text).toBe(CREDIT.sentence);
    // 许可原文的路径也写在屏上（用户照着就能去仓库翻）
    expect(textOf(one(root, 'credit-license-path'))).toContain(CREDIT.licensePath);
    expect(CREDIT.licensePath).toContain('LICENSE-COMPILER-Card-Builder.txt');
  });

  it('仓库链接指向 albrtbc/compiler（href 真的写上了）', async () => {
    const h = harness();
    const root = await renderSettled(h);
    const link = one(root, 'credit-link') as unknown as { href: string; text: string };
    expect(link.href).toBe('https://github.com/albrtbc/compiler');
    expect(link.text).toBe(CREDIT.url);
    // 反向锚点：它**不是**本站自己的地址（否则"指向对了"这件事测不出来）。
    // ⚠️ 不能拿 "compile" 当锚点 —— 仓库名 `compiler` 里就有它。
    expect(link.href).not.toMatch(/github\.com\/(?!albrtbc\/compiler)/);
    expect(link.href, '链接指向了本站而不是作者仓库').not.toContain('127.0.0.1');
    expect(link.href, '链接指向了本站而不是作者仓库').not.toContain('localhost');
  });

  it('署名里的项目名与作者名是**常量**，页面文案不会与许可文件分叉', () => {
    expect(CREDIT.project).toBe('COMPILER · Card Builder');
    expect(CREDIT.author).toBe('Albert Blanco');
    expect(CREDIT.license).toBe('MIT 许可');
    expect(CREDIT.url).toBe('https://github.com/albrtbc/compiler');
    // 这句话本身就是用户要的文案（逐字）
    expect(CREDIT.sentence).toBe(
      '本制作器参考开源项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可）制作，'
      + '素材（卡框/背景/卡背/字体）亦来自该项目。',
    );
  });
});
