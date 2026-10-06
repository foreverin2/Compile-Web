import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  descendants,
  installStubDom,
  isClass,
  makeStubEl,
  type StubNode,
} from './net-dom-stub';
import { renderPoolPicker, type PoolPickerNav } from '../../src/ui/pool-picker';
import { DEMO_PROTOCOLS, protocolImgSrc } from '../../src/data/demo';
import { POOL_MIN, buildPool } from '../../src/app/pool-choice';
import { DEFAULT_LANG, ZH, setLang, t } from '../../src/i18n';

/**
 * ★ 2026-10-03（用户要求）：**协议挑选屏**的行为腿（真跑 `renderPoolPicker`，无 jsdom）。
 *
 * ## 这一组证什么（桩能干的事）
 *
 *  - 屏上真的列出**现有全部协议**（数量 + 每张卡的名字/缩略图 src）；
 *  - **三个世代 chip 都真的在过滤**：点掉某一代之后，DOM 里那一代的卡片**节点消失**
 *    （不是加个隐藏类），可见条目数当场变小；再点回来恢复原数；
 *  - **实时计数**与「完成」的可用性：11 套不可点、12 套可点（边界两侧各一条腿）；
 *  - 「取消」走 `nav.back()`、`nav.done` 一次都不调；「完成」交出去的 defId 是**归一过的**
 *    常量顺序（点选顺序反过来也不影响）；
 *  - 选中/未选中在屏上可区分（`.pool-card-on` + `aria-pressed`）。
 *
 * ## 桩的能力边界（如实声明）
 *
 * 桩只记结构，不模拟布局与真实点击语义（`label` 的"点击转发给表单控件"它**不实现**）——
 * 所以"按钮不在 `<label>` 里"这件事由 `tests/ui/mode-pool-choice.test.ts` 的**结构腿**钉，
 * 不在这里假装跑得动。本文件里的"点击"都是 `dispatchEvent` 派发到卡片的子节点上冒泡上来的
 * （桩的 `dispatchEvent` 不含派发节点自己）。
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

/** 桩的"点击"：往目标里挂一个空子节点再派发（冒泡到目标自己） */
function click(target: StubNode): void {
  const clicker = makeStubEl('span');
  target.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
}

interface Run {
  readonly root: StubNode;
  readonly calls: string[];
  readonly doneArgs: string[][];
}

function draw(initialSelected?: readonly string[]): Run {
  const root = makeStubEl('div');
  const calls: string[] = [];
  const doneArgs: string[][] = [];
  const nav: PoolPickerNav = {
    back: () => { calls.push('back'); },
    done: (ids) => { calls.push('done'); doneArgs.push([...ids]); },
    initialSelected,
  };
  renderPoolPicker(root as unknown as HTMLElement, nav);
  return { root, calls, doneArgs };
}

const cards = (root: StubNode): StubNode[] => descendants(root).filter((n) => isClass(n, 'pool-card'));
const chips = (root: StubNode): StubNode[] => descendants(root).filter((n) => isClass(n, 'pool-gen-chip'));
const onCards = (root: StubNode): StubNode[] => cards(root).filter((n) => isClass(n, 'pool-card-on'));
const textOf = (root: StubNode, cls: string): string =>
  descendants(root).filter((n) => isClass(n, cls)).map((n) => n.text).join('');
const disabledOf = (root: StubNode, cls: string): boolean =>
  (descendants(root).find((n) => isClass(n, cls)) as unknown as { disabled?: boolean } | undefined)?.disabled === true;
/** 卡片自己的 defId（渲染时写在 `data-def-id` 上） */
const defIdOf = (card: StubNode): string => card.dataset.defId ?? '';
/**
 * 读一个属性。⚠️ 桩的 `StubNode` 接口**没有**声明 `getAttribute`（它只在索引签名里，
 * 于是测试侧读到的是 `unknown`）—— 这里显式收窄一次，与桩上既有的读法一致。
 */
const attrOf = (n: StubNode, name: string): string | null =>
  (n as unknown as { getAttribute(k: string): string | null }).getAttribute(name);
/** 某一代的 defId 集合（判据面用数据集现算，不手抄） */
const idsOfGen = (g: '1' | '2' | '3'): string[] => {
  const sets = g === '1' ? ['MN01', 'AX01'] : g === '2' ? ['MN02', 'AX02'] : ['MN03', 'AX03'];
  return DEMO_PROTOCOLS.filter((p) => sets.includes(p.set)).map((p) => p.defId);
};

const ALL_IDS = DEMO_PROTOCOLS.map((p) => p.defId);
const TWELVE = ALL_IDS.slice(0, POOL_MIN);

describe('★ 挑选屏：协议清单与世代筛选（行为腿）', () => {
  it('锚点：整屏、三个 chip、全部协议都在（否则下面每条腿在空集上恒真）', () => {
    const { root } = draw();
    expect(descendants(root).filter((n) => isClass(n, 'pool-screen')).length, '没画出 .pool-screen').toBe(1);
    expect(chips(root).map((c) => c.text), '世代 chip 不是 1/2/3 代那三个')
      .toEqual([ZH['pool.gen.1'], ZH['pool.gen.2'], ZH['pool.gen.3']]);
    expect(chips(root).map((c) => c.dataset.gen)).toEqual(['1', '2', '3']);
    expect(cards(root).length, '协议卡数量与现有协议数不一致').toBe(DEMO_PROTOCOLS.length);
    // 每张卡：缩略图 src 正确 + 协议名就是数据集里的名字
    for (const def of DEMO_PROTOCOLS) {
      const card = cards(root).find((c) => defIdOf(c) === def.defId);
      expect(card, `少了协议 ${def.defId} 的卡`).toBeTruthy();
      const img = descendants(card as StubNode).find((n) => isClass(n, 'pool-card-thumb'));
      expect(attrOf(img as StubNode, 'src'), `${def.defId} 的缩略图 src 不对`).toBe(protocolImgSrc(def.defId, false));
      expect(textOf(card as StubNode, 'pool-card-name'), `${def.defId} 的协议名不对`).toBe(def.name);
    }
    // 三个 chip 默认全开
    expect(chips(root).filter((c) => isClass(c, 'pool-gen-chip-on')).length, 'chip 不是默认全开').toBe(3);
  });

  it('三个 chip **每一个都真的在过滤**：点掉某代 ⇒ 那一代的卡从 DOM 里消失，再点回来恢复', () => {
    for (const g of ['1', '2', '3'] as const) {
      const { root } = draw();
      const genIds = new Set(idsOfGen(g));
      expect(genIds.size, `${g} 代的协议数为 0 ⇒ 这条腿测不出东西`).toBeGreaterThan(0);
      const before = cards(root).length;
      const chip = chips(root).find((c) => c.dataset.gen === g) as StubNode;
      click(chip);
      const after = cards(root).length;
      expect(after, `点掉 ${g} 代之后可见条目数没变（chip 是装饰？）`).toBe(before - genIds.size);
      expect(cards(root).some((c) => genIds.has(defIdOf(c))), `点掉 ${g} 代之后那一代的卡还在 DOM 里`).toBe(false);
      expect(isClass(chip, 'pool-gen-chip-on'), `点掉 ${g} 代之后 chip 还亮着`).toBe(false);
      // 再点回来 ⇒ 恢复
      click(chip);
      expect(cards(root).length, `再点一次 ${g} 代没有恢复`).toBe(before);
      expect(isClass(chip, 'pool-gen-chip-on')).toBe(true);
    }
  });

  it('两代同时点掉 ⇒ 两代的卡都不在（不是只有最后点的那个生效）', () => {
    const { root } = draw();
    const g1 = new Set(idsOfGen('1'));
    const g3 = new Set(idsOfGen('3'));
    click(chips(root).find((c) => c.dataset.gen === '1') as StubNode);
    click(chips(root).find((c) => c.dataset.gen === '3') as StubNode);
    const left = cards(root);
    expect(left.length).toBe(DEMO_PROTOCOLS.length - g1.size - g3.size);
    expect(left.some((c) => g1.has(defIdOf(c)) || g3.has(defIdOf(c))), '被点掉的世代还有卡留着').toBe(false);
    // 反向：剩下的都是 2 代
    expect(left.every((c) => idsOfGen('2').includes(defIdOf(c)))).toBe(true);
  });
});

describe('★ 挑选屏：计数 / 完成 / 取消（行为腿）', () => {
  it('初始：计数是「已选 0（至少 12）」、还差 12 套、「完成」不可点', () => {
    const { root } = draw();
    expect(textOf(root, 'pool-count')).toBe(t('pool.count', { n: '0', min: String(POOL_MIN) }));
    expect(textOf(root, 'pool-need')).toBe(t('pool.need', { n: String(POOL_MIN) }));
    expect(disabledOf(root, 'pool-done'), '一套都没选「完成」就可点了').toBe(true);
    expect(onCards(root).length).toBe(0);
  });

  it('「还差 N 套」就写在「完成」按钮**所在那一行**（用户口径：旁边写清还差几个）', () => {
    const { root } = draw();
    const actions = descendants(root).find((n) => isClass(n, 'pool-actions')) as StubNode;
    expect(actions, '没有 .pool-actions 那一行').toBeTruthy();
    const need = descendants(actions).find((n) => isClass(n, 'pool-need')) as StubNode;
    const doneBtn = descendants(actions).find((n) => isClass(n, 'pool-done')) as StubNode;
    expect(need, '「还差几套」那句不在「完成」按钮那一行里').toBeTruthy();
    expect(doneBtn, '「完成」按钮不在 .pool-actions 里').toBeTruthy();
    expect(descendants(actions).indexOf(need)).toBeLessThan(descendants(actions).indexOf(doneBtn));
  });

  it('11 套：仍然不可点（边界下方）；第 12 套一点 ⇒ 可点（边界上方）', () => {
    const { root } = draw();
    const list = cards(root);
    for (let i = 0; i < POOL_MIN - 1; i++) click(list[i]);
    expect(disabledOf(root, 'pool-done'), '11 套时「完成」可点（用户口径是至少 12）').toBe(true);
    expect(textOf(root, 'pool-need'), '还差几套的提示不对').toBe(t('pool.need', { n: '1' }));
    click(list[POOL_MIN - 1]);
    expect(disabledOf(root, 'pool-done'), '12 套时「完成」仍不可点').toBe(false);
    expect(textOf(root, 'pool-need'), '凑够之后还留着"还差"那句').toBe('');
    expect(textOf(root, 'pool-count')).toBe(t('pool.count', { n: '12', min: String(POOL_MIN) }));
  });

  it('再点一次已选的卡 ⇒ 取消选中（计数与可用性跟着退回去）', () => {
    const { root } = draw();
    const list = cards(root);
    for (let i = 0; i < POOL_MIN; i++) click(list[i]);
    expect(disabledOf(root, 'pool-done')).toBe(false);
    click(list[0]);
    expect(onCards(root).length).toBe(POOL_MIN - 1);
    expect(disabledOf(root, 'pool-done'), '取消一套之后「完成」还可以点').toBe(true);
    expect(isClass(list[0], 'pool-card-on')).toBe(false);
    expect(attrOf(list[0], 'aria-pressed'), '取消选中之后 aria-pressed 没跟着变').toBe('false');
  });

  it('选中/未选中在屏上可区分：只有被点的那张有 .pool-card-on 且 aria-pressed=true', () => {
    const { root } = draw();
    const list = cards(root);
    click(list[3]);
    expect(onCards(root).map(defIdOf)).toEqual([defIdOf(list[3])]);
    expect(attrOf(list[3], 'aria-pressed')).toBe('true');
    expect(attrOf(list[4], 'aria-pressed')).toBe('false');
  });

  it('「完成」交出去的是**归一过的常量顺序**（点选顺序反过来也一样）', () => {
    const { root, calls, doneArgs } = draw();
    const list = cards(root);
    for (let i = POOL_MIN - 1; i >= 0; i--) click(list[i]);
    click(descendants(root).find((n) => isClass(n, 'pool-done')) as StubNode);
    expect(calls, '「完成」没有走 nav.done').toEqual(['done']);
    expect(doneArgs.length).toBe(1);
    expect(doneArgs[0], '交出去的 defId 不是常量顺序（两端会算出两份不同的池子）')
      .toEqual(buildPool([...TWELVE].reverse()).map((p) => p.defId));
    expect(doneArgs[0]).toEqual(TWELVE);
  });

  it('「取消并返回」：走 nav.back()，`nav.done` 一次都不调（这次改动丢弃）', () => {
    const { root, calls, doneArgs } = draw([...TWELVE]);
    click(descendants(root).find((n) => isClass(n, 'pool-cancel')) as StubNode);
    expect(calls).toEqual(['back']);
    expect(doneArgs, '「取消」竟然把选择交出去了').toEqual([]);
  });

  it('`initialSelected`：进来就预勾那几套（再打开时看到上次挑的那一份）', () => {
    const { root, doneArgs } = draw([...TWELVE].reverse());
    expect(onCards(root).length, '预勾的套数不对').toBe(POOL_MIN);
    expect(onCards(root).map(defIdOf)).toEqual(TWELVE);
    expect(disabledOf(root, 'pool-done'), '预勾够数时「完成」不可点').toBe(false);
    click(descendants(root).find((n) => isClass(n, 'pool-done')) as StubNode);
    expect(doneArgs[0]).toEqual(TWELVE);
  });

  it('`initialSelected` 里的未知 defId 被忽略（存储被手改过也不会画出一张不存在的卡）', () => {
    const { root } = draw([...TWELVE, 'nope-0', '']);
    expect(onCards(root).length).toBe(POOL_MIN);
    expect(cards(root).some((c) => defIdOf(c) === 'nope-0')).toBe(false);
  });
});

