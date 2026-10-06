import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  descendants,
  installStubDom,
  isClass,
  makeStubEl,
  type StubNode,
} from './net-dom-stub';
import { functionBody, objectBody, stripComments } from './source-text';
import { renderModeSelect, type ModeSelectNav } from '../../src/ui/home';
import { renderDraft, resetUiState, type UiCallbacks } from '../../src/ui/render';
import { createGame } from '../../src/core/state/create';
import { DEMO_PROTOCOLS } from '../../src/data/demo';
import {
  POOL_MIN,
  buildPool,
  encodePoolIntoSeed,
  poolDefsOf,
  poolFromSeed,
  type PoolChoice,
} from '../../src/app/pool-choice';
import { createLocalStore, readPoolPreset, writePoolPreset } from '../../src/app/local-store';
import { createMemoryStore } from '../../src/app/storage';
import { DEFAULT_LANG, ZH, setLang, t } from '../../src/i18n';

/**
 * ★ 2026-10-03（用户要求）：**模式选择页第三个开关行「自定义协议池」**的接线与行为。
 *
 * ## 这一组证什么（分四段）
 *
 *  A. **屏上的行为**（真跑 `renderModeSelect`，无 jsdom 的 DOM 桩）：
 *     第三行在、默认不勾、没有合法选择时勾不上、随机池与它**互斥**（两个方向）、
 *     「选择协议」按钮**不在 `<label>` 里**（结构腿：label 的子树里没有那个 button）、
 *     禁用协议与它互不影响；
 *  B. **宿主接线**（源码腿）：热座开局那一支读本机预设；联机那支的池子从**种子**解；
 *     房主的种子在 `startLobby` 那一刻把预设编了进去；
 *  C. **联机一致性的行为腿**：同一粒种子在"房主端"与"加入端"解出**逐项相同**的池子，
 *     而**加入方本机那份不同的预设改变不了它**（用户口径：由开房间的一方决定）；
 *  D. **开局之后**（真跑 `renderDraft`）：本局「选协议」那一屏列出的就是挑的那几套，
 *     底部那条 `.draft-mode-note` 用的是改写后的措辞。
 */

const IDS = DEMO_PROTOCOLS.map((p) => p.defId);
const TWELVE = IDS.slice(0, POOL_MIN);
/** 另一份同样够 12 套、但集合明显不同的选择（联机那条腿用它当"加入方自己挑的"） */
const OTHER_TWELVE = DEMO_PROTOCOLS.slice(6, 6 + POOL_MIN).map((p) => p.defId);

/* ══════════════════ A · 模式选择页（行为腿） ══════════════════ */

let restoreDom: (() => void) | null = null;

beforeEach(() => {
  setLang(DEFAULT_LANG);
  restoreDom = installStubDom();
});

afterEach(() => {
  /**
   * ⚠️ **顺序是硬的**：`resetUiState()` 会读 `document`（清扫特效层），所以它必须在
   * `restore()` **之前**跑（`restore()` 会把全局 `document` 摘掉，之后调它就是
   * `Cannot read properties of undefined`）。
   *
   * 草稿页那几枚世代 chip 的开关是 `render.ts` 的**模块态** ⇒ 每个用例前后都要复位，
   * 否则 D 段里点掉一代会漏给下一个用例（跨用例污染的经典形态）。
   */
  resetUiState();
  restoreDom?.();
  restoreDom = null;
  setLang(DEFAULT_LANG);
});

/** 桩的"点击/变更"：往目标里挂一个空子节点再派发（冒泡到目标自己） */
function fire(target: StubNode, type: string): void {
  const child = makeStubEl('span');
  target.appendChild(child);
  child.dispatchEvent({ type, target: child });
}

interface Ran {
  readonly root: StubNode;
  readonly calls: string[];
  readonly enabledWrites: boolean[];
  readonly boxes: { ban: StubNode; random: StubNode; pool: StubNode };
  readonly pickBtn: StubNode;
  readonly row: StubNode;
  readonly label: StubNode;
}

/** 画一帧模式页；`preset` 是"本机存的那一份"（宿主注入，测试可任意给） */
function run(preset: PoolChoice = { enabled: false, ids: [] }): Ran {
  const root = makeStubEl('div');
  const calls: string[] = [];
  const enabledWrites: boolean[] = [];
  const nav: ModeSelectNav = {
    backHome: () => { calls.push('backHome'); },
    openDeviceCheck: () => { calls.push('openDeviceCheck'); },
    startHotseat: () => { calls.push('startHotseat'); },
    startNetLobby: () => { calls.push('startNetLobby'); },
    openPoolPicker: () => { calls.push('openPoolPicker'); },
    readPoolPreset: () => preset,
    setPoolEnabled: (on) => { calls.push(`setPoolEnabled:${on}`); enabledWrites.push(on); },
  };
  renderModeSelect(root as unknown as HTMLElement, nav);

  const boxes = descendants(root).filter((n) => isClass(n, 'mode-check'));
  const row = descendants(root).find((n) => isClass(n, 'mode-toggle-row')) as StubNode;
  const label = descendants(row).find((n) => isClass(n, 'mode-toggle')) as StubNode;
  const pickBtn = descendants(row).find((n) => n.tag === 'button') as StubNode;
  return { root, calls, enabledWrites, boxes: { ban: boxes[0], random: boxes[1], pool: boxes[2] }, pickBtn, row, label };
}

const checkedOf = (n: StubNode): boolean => (n as unknown as { checked?: boolean }).checked === true;
const disabledOf = (n: StubNode): boolean => (n as unknown as { disabled?: boolean }).disabled === true;
const setChecked = (n: StubNode, v: boolean): void => { (n as unknown as { checked: boolean }).checked = v; };
const textOf = (root: StubNode, cls: string): string =>
  descendants(root).filter((n) => isClass(n, cls)).map((n) => n.text).join('');

describe('A · 第三个开关行「自定义协议池」（真跑 renderModeSelect）', () => {
  it('A1 结构：多了一行、里有一个勾选框与右边一个按钮，且按钮**不在 `<label>` 里**', () => {
    const { root, row, label, pickBtn } = run();
    expect(descendants(root).filter((n) => isClass(n, 'mode-toggle-row')).length, '没有第三个开关行的外层').toBe(1);
    expect(descendants(root).filter((n) => isClass(n, 'mode-check')).length, '开关总数不是 3 个').toBe(3);
    expect(textOf(root, 'mode-toggle-label'), '三行的标题（顺序：禁用 / 随机 / 自定义）')
      .toBe(ZH['mode.ban'] + ZH['mode.random'] + ZH['mode.pool']);
    expect(pickBtn.text, '那一行右边没有「选择协议」按钮').toBe(ZH['mode.pool.pick']);
    // 结构腿：按钮是那一行的**第二个孩子**，而 `<label>` 的子树里没有它
    // （放进 label 里 ⇒ 点按钮会顺带翻转旁边的勾选框）
    expect(row.children.length, '这一行不是"label + 按钮"两个格子').toBe(2);
    expect(row.children[0], '第一个格子不是那个 label').toBe(label);
    expect(row.children[1], '第二个格子不是那个按钮').toBe(pickBtn);
    expect(descendants(label).includes(pickBtn), '按钮被放进了 <label> 里（点它会把勾选框一起翻掉）').toBe(false);
  });

  it('A2 默认（没勾、一套都没挑）：未勾选 + 勾不上 + 显示「未选择」', () => {
    const { root, boxes, row } = run();
    expect(checkedOf(boxes.pool), '默认竟然勾着（用户口径是默认不勾选）').toBe(false);
    expect(disabledOf(boxes.pool), '没有合法选择时勾选框却是可用的').toBe(true);
    expect(isClass(row, 'mode-toggle-row-off'), '勾不上的行没有视觉标记').toBe(true);
    expect(textOf(root, 'mode-pool-count'), '没挑协议时应显示「未选择」').toBe(ZH['mode.pool.none']);
  });

  it('A3 本机已挑够 12 套且勾着：勾选框勾上、可点、显示「已选 12 套」', () => {
    const { root, boxes, row, calls } = run({ enabled: true, ids: TWELVE });
    expect(checkedOf(boxes.pool)).toBe(true);
    expect(disabledOf(boxes.pool)).toBe(false);
    expect(isClass(row, 'mode-toggle-row-off')).toBe(false);
    expect(textOf(root, 'mode-pool-count')).toBe(t('mode.pool.count', { n: '12' }));
    expect(calls, '只画一帧不该写任何东西').toEqual([]);
  });

  it('A4 兜底（用户口径第 6 条）：存着"勾着"但只挑到 11 套 ⇒ 回落成未勾选且勾不上', () => {
    const { root, boxes, row } = run({ enabled: true, ids: TWELVE.slice(0, POOL_MIN - 1) });
    expect(checkedOf(boxes.pool), '不足 12 套却仍然勾着').toBe(false);
    expect(disabledOf(boxes.pool), '不足 12 套却勾得上（那会开局用一个不足数的池子）').toBe(true);
    expect(isClass(row, 'mode-toggle-row-off')).toBe(true);
    expect(textOf(root, 'mode-pool-count'), '已挑的套数还是要如实报出来').toBe(t('mode.pool.count', { n: '11' }));
  });

  it('A5 互斥方向一：勾上随机池 ⇒ 自定义池当场取消 + 落盘写 off', () => {
    const { boxes, calls } = run({ enabled: true, ids: TWELVE });
    expect(checkedOf(boxes.pool)).toBe(true);
    setChecked(boxes.random, true);
    fire(boxes.random, 'change');
    expect(checkedOf(boxes.pool), '随机池勾上之后自定义池还勾着（用户口径：任何时候都不许同时勾）').toBe(false);
    expect(disabledOf(boxes.pool), '随机池开着时自定义池却还能勾').toBe(true);
    expect(calls, '取消自定义池没有落盘（下一次重画会把这一下忘掉）').toEqual(['setPoolEnabled:false']);
  });

  it('A6 互斥方向二：随机池开着时去勾自定义池 ⇒ 勾不上，而且**不写**"勾上"', () => {
    const { boxes, enabledWrites } = run({ enabled: true, ids: TWELVE });
    setChecked(boxes.random, true);
    fire(boxes.random, 'change');
    // 模拟"有人绕过 disabled 直接把 checked 置真再派发 change"
    setChecked(boxes.pool, true);
    fire(boxes.pool, 'change');
    expect(checkedOf(boxes.pool), '随机池开着时自定义池被勾上了').toBe(false);
    expect(disabledOf(boxes.pool)).toBe(true);
    expect(enabledWrites, '把"两个同时勾上"这个状态写进了本机').not.toContain(true);
  });

  it('A7 取消随机池之后自定义池仍然可用（互斥不是单向锁死）', () => {
    const { boxes } = run({ enabled: true, ids: TWELVE });
    setChecked(boxes.random, true);
    fire(boxes.random, 'change');
    expect(disabledOf(boxes.pool)).toBe(true);
    setChecked(boxes.random, false);
    fire(boxes.random, 'change');
    expect(disabledOf(boxes.pool), '随机池取消之后自定义池仍然勾不上').toBe(false);
    expect(checkedOf(boxes.pool), '取消随机池把自定义池也一起丢了（应该只是解锁）').toBe(false);
  });

  it('A8 禁用协议与这两者无关：点它不会动自定义池那一行', () => {
    const { boxes, calls, row } = run({ enabled: true, ids: TWELVE });
    setChecked(boxes.ban, true);
    fire(boxes.ban, 'change');
    expect(checkedOf(boxes.pool), '勾禁用协议把自定义池的勾改了').toBe(true);
    expect(disabledOf(boxes.pool)).toBe(false);
    expect(isClass(row, 'mode-toggle-row-off')).toBe(false);
    expect(calls, '勾禁用协议不该碰自定义池的落盘').toEqual([]);
  });

  it('A9 点右边那个按钮 ⇒ 走 nav.openPoolPicker，且不改勾选框', () => {
    const { boxes, calls, pickBtn } = run({ enabled: true, ids: TWELVE });
    const before = checkedOf(boxes.pool);
    fire(pickBtn, 'click');
    expect(calls, '「选择协议」没有走宿主接缝').toEqual(['openPoolPicker']);
    expect(checkedOf(boxes.pool), '点按钮顺带把勾选框翻了').toBe(before);
  });

  it('A10 玩家自己拨那个勾选框 ⇒ 落盘写当前值', () => {
    const { boxes, calls } = run({ enabled: true, ids: TWELVE });
    setChecked(boxes.pool, false);
    fire(boxes.pool, 'change');
    expect(calls).toEqual(['setPoolEnabled:false']);
    setChecked(boxes.pool, true);
    fire(boxes.pool, 'change');
    expect(calls).toEqual(['setPoolEnabled:false', 'setPoolEnabled:true']);
  });

  it('A11 三个开关的帮助文案都在（第三个是自定义池那一句）', () => {
    const { root } = run();
    const tips = descendants(root).filter((n) => n.tag === 'span' && isClass(n, 'mode-help'))
      .map((n) => n.dataset.tip);
    expect(tips).toEqual([
      ZH['mode.ban.tip'],
      ZH['mode.random.tip'],
      t('mode.pool.tip', { min: String(POOL_MIN) }),
    ]);
  });
});

/* ══════════════════ B · 宿主接线（源码腿） ══════════════════ */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MAIN = stripComments(readFileSync(`${REPO}src/main.ts`).subarray(0, 4 * 1024 * 1024).toString('utf8'));
const flat = (s: string): string => s.replace(/\s+/g, ' ');

describe('B · `main.ts` 的接线（源码腿）', () => {
  it('B1 热座开局：池子读**本机预设**，而随机池那一支保持原样', () => {
    const coin = flat(functionBody(MAIN, 'showCoin'));
    expect(coin, '热座开局没有读本机预设').toContain('poolDefsOf(readPoolPreset(localStore))');
    expect(coin, '热座随机池那一支被改动了（用户口径：保持原样可用）').toContain('randomPoolFromSeed(seed, 12)');
    expect(coin, '热座那一支没有把池子传给 createGame').toContain('draftPool:');
  });

  it('B2 联机那一支：池子**从种子解**，且不读本机预设（加入方覆盖不了房主）', () => {
    const enter = flat(functionBody(MAIN, 'enterNetGame'));
    expect(enter, 'enterNetGame 的 draftPool 不是从握手那粒种子解出来的')
      .toContain('draftPool: poolFromSeed(seed) ?? undefined,');
    expect(enter, 'enterNetGame 读了本机预设 —— 加入方的本地选择会顶掉房主的预设')
      .not.toContain('readPoolPreset');
    expect(enter, 'enterNetGame 又把联机的池子限成 12 套随机池了（G5 T21 修掉的缺陷）')
      .not.toContain('randomPoolFromSeed');
  });

  it('B3 房主那粒种子：在 `startLobby` 里把本机预设**编码进种子**（协议冻结下的唯一通路）', () => {
    const helper = flat(functionBody(MAIN, 'poolEncodedSeed'));
    expect(helper, 'poolEncodedSeed 没有读本机预设').toContain('readPoolPreset(localStore)');
    expect(helper, 'poolEncodedSeed 没有把 defId 编进种子').toContain('encodePoolIntoSeed(seed, preset.ids)');
    expect(helper, '没勾时也该原样返回种子（没编码 ⇒ 对面解出 null ⇒ 全部协议）')
      .toContain('preset.enabled ? encodePoolIntoSeed(seed, preset.ids) : seed;');
    const lobby = flat(functionBody(MAIN, 'startLobby'));
    expect(lobby, '建房时那粒种子没有走 poolEncodedSeed（房主的预设没编进去）')
      .toContain('matchSeed: poolEncodedSeed(newMatchSeed()),');
  });

  it('B4 挑选屏的两个动作都接在宿主上：返回 = 重画模式页（不写）、完成 = 落盘 + 回模式页', () => {
    const picker = flat(functionBody(MAIN, 'showPoolPicker'));
    expect(picker, 'showPoolPicker 没有画挑选屏').toContain('renderPoolPicker(root, {');
    expect(picker, '打开时没有把已挑的那份带进去').toContain('initialSelected: readPoolPreset(localStore).ids');
    expect(picker, '「取消并返回」没有接成"回模式选择页"').toContain('back: showModeSelect');
    expect(picker, '「完成」没有落盘').toContain('writePoolPreset(localStore, { ids: defIds, enabled: true })');
    // 反向：`back` 那一支**不许**写存储（用户口径：取消 = 什么都不改）
    const backBranch = picker.slice(picker.indexOf('back: showModeSelect'), picker.indexOf('done:'));
    expect(backBranch, '「取消并返回」那一支写了存储').not.toContain('writePoolPreset');
    // 模式页那条 nav 上，三个接缝都在
    const mode = flat(functionBody(MAIN, 'showModeSelect'));
    for (const key of ['openPoolPicker:', 'readPoolPreset:', 'setPoolEnabled:']) {
      expect(mode, `showModeSelect 少了 ${key} 这个接缝`).toContain(key);
    }
  });
});

/* ══════════════════ C · 联机：池子来自种子，加入方覆盖不了 ══════════════════ */

/** 造一个"本机存了这么一份预设"的 store（与 main.ts 读的是同一条路） */
function storeWithPreset(choice: PoolChoice): ReturnType<typeof createLocalStore> {
  const s = createLocalStore({ persistent: createMemoryStore() });
  s.grant();
  writePoolPreset(s, choice);
  return s;
}

describe('C · 联机那一支的池子来自 `hand.seed`（行为腿）', () => {
  it('锚点：两份预设够数、且确实不同（否则"谁覆盖谁"这件事测不出来）', () => {
    expect(TWELVE.length).toBe(POOL_MIN);
    expect(OTHER_TWELVE.length).toBe(POOL_MIN);
    expect(new Set(TWELVE)).not.toEqual(new Set(OTHER_TWELVE));
  });

  it('两端解同一粒种子 ⇒ 逐项相同；加入方本机那份不同的预设改变不了它', () => {
    // 房主：本机勾着 + 挑了 TWELVE ⇒ 建房那一刻把这份选择编进种子
    const hostStore = storeWithPreset({ enabled: true, ids: TWELVE });
    const hostSeed = encodePoolIntoSeed('4c1f9a2b', readPoolPreset(hostStore).ids);
    // 加入方：本机勾着 + 挑的是**另一份**（OTHER_TWELVE）
    const guestStore = storeWithPreset({ enabled: true, ids: OTHER_TWELVE });
    const guestLocalPool = poolDefsOf(readPoolPreset(guestStore));

    // 两端各自跑 `enterNetGame` 里那一句（同一个 `hand.seed`）
    const hostEnd = poolFromSeed(hostSeed);
    const guestEnd = poolFromSeed(hostSeed);

    expect(hostEnd, '房主端没解出池子').not.toBeNull();
    expect(guestEnd, '加入端没解出池子').not.toBeNull();
    expect(guestEnd!.map((p) => p.defId), '两端 draftPool 逐项不同 —— 状态指纹会分叉')
      .toEqual(hostEnd!.map((p) => p.defId));
    expect(hostEnd!.map((p) => p.defId), '房主端解出来的不是房主挑的那几套')
      .toEqual(buildPool(TWELVE).map((p) => p.defId));
    // 关键那一半：加入方本机那份确实存在、且确实不一样，但它**没有**影响这一局
    expect(guestLocalPool, '夹具没构造出"加入方本地有另一份选择"').not.toBeNull();
    expect(guestLocalPool!.map((p) => p.defId)).not.toEqual(guestEnd!.map((p) => p.defId));
    expect(guestEnd!.map((p) => p.defId)).not.toEqual(guestLocalPool!.map((p) => p.defId));
  });

  it('房主没勾自定义池 ⇒ 种子里没编码 ⇒ 两端都解出 null（回落成全部协议，与改动前一致）', () => {
    const hostStore = storeWithPreset({ enabled: false, ids: TWELVE });
    const preset = readPoolPreset(hostStore);
    const hostSeed = preset.enabled ? encodePoolIntoSeed('4c1f9a2b', preset.ids) : '4c1f9a2b';
    expect(poolFromSeed(hostSeed), '没勾却解出了池子（联机的默认档被改了）').toBeNull();
    expect(poolFromSeed(hostSeed) ?? DEMO_PROTOCOLS, '没解出池子时应当落回全部协议')
      .toEqual(DEMO_PROTOCOLS);
  });
});

/* ══════════════════ D · 开局之后：草稿页只列挑好的那几套 ══════════════════ */

const noopCb: UiCallbacks = {
  onAction: () => { /* 桩：本腿只看结构 */ },
  onDraftPick: () => { /* 桩 */ },
  onDraftBan: () => { /* 桩 */ },
  onDraftUnpick: () => { /* 桩 */ },
};

/** 真跑一帧草稿页（`draftPool` 就是这一局的池子） */
function draft(twelveIds: readonly string[]): StubNode {
  const root = makeStubEl('div');
  const state = createGame({
    seed: 'pool-draft',
    draftPool: buildPool(twelveIds),
  });
  renderDraft(root as unknown as HTMLElement, state, noopCb);
  return root;
}

describe('D · 开局之后的「选协议」那一屏（真跑 renderDraft）', () => {
  it('D1 池子里**只有**玩家挑的那几套（逐名比对），没有别的协议混进来', () => {
    const root = draft(TWELVE);
    const names = descendants(root).filter((n) => isClass(n, 'draft-card-name')).map((n) => n.text).sort();
    expect(names, '草稿页列出的协议不是玩家挑的那 12 套')
      .toEqual(buildPool(TWELVE).map((p) => p.name).sort());
    expect(names.length, '草稿页的池子大小不对').toBe(POOL_MIN);
    // 反向：另一个集合画出来的是另一份（这条判据不是"恒等于某个常量"）
    const other = descendants(draft(OTHER_TWELVE)).filter((n) => isClass(n, 'draft-card-name')).map((n) => n.text).sort();
    expect(other).not.toEqual(names);
    expect(other).toEqual(buildPool(OTHER_TWELVE).map((p) => p.name).sort());
  });

  it('D2 底部的池子说明用的是**改写后**的措辞（两种模式都成立，占位符照旧）', () => {
    const root = draft(TWELVE);
    const notes = descendants(root).filter((n) => isClass(n, 'draft-mode-note')).map((n) => n.text);
    expect(notes.length, '有没有池子说明这件事应当由"池子小于全量"驱动').toBe(1);
    expect(notes[0], '那条说明不是 `render.draft.random-pool-note` 的新措辞')
      .toBe(t('render.draft.random-pool-note', { total: String(DEMO_PROTOCOLS.length), n: String(POOL_MIN) }));
    // 措辞对两种模式都成立：既提到随机池，也提到自定义池
    expect(notes[0], '文案里没有"随机"那一档').toContain('随机');
    expect(notes[0], '文案里没有"自定义协议池"那一档').toContain('自定义协议池');
  });

  it('D3 全量池那一档：没有那条说明（锚点：它确实是"池子被限小了"才出现的）', () => {
    const root = makeStubEl('div');
    renderDraft(root as unknown as HTMLElement, createGame({ seed: 'pool-draft-all' }), noopCb);
    expect(descendants(root).filter((n) => isClass(n, 'draft-mode-note')).length, '全量池也出现了池子说明')
      .toBe(0);
    expect(descendants(root).filter((n) => isClass(n, 'draft-card-name')).length).toBe(DEMO_PROTOCOLS.length);
  });

  it('D4 自定义池下 1/2/3 代筛选仍然真的在过滤（点掉一代 ⇒ 那一代的卡从池子里消失）', () => {
    const root = draft(TWELVE);
    const before = descendants(root).filter((n) => isClass(n, 'draft-card')).length;
    expect(before).toBe(POOL_MIN);
    // 世代 chip 的选择器住在 render.ts 里，判据面用"chip 文案"定位（1代 基础 那一枚）
    const chip = descendants(root)
      .find((n) => isClass(n, 'draft-filter-chip') && n.text === t('render.draft.group.mn01')) as StubNode;
    expect(chip, '草稿页没有 1 代基础的筛选 chip').toBeTruthy();
    fire(chip, 'click');
    const after = descendants(root).filter((n) => isClass(n, 'draft-card')).length;
    const mn01 = buildPool(TWELVE).filter((p) => p.set === 'MN01').length;
    expect(mn01, '这一局的池子里没有 MN01 ⇒ 这条腿测不出东西').toBeGreaterThan(0);
    expect(after, '点掉 1 代基础之后池子里的卡数没变（筛选没生效）').toBe(before - mn01);
  });
});

/* ══════════════════ E · 引擎级：开局池恰好是挑的那些 ══════════════════ */

describe('E · 开局池（引擎级真跑 `createGame`）', () => {
  it('E1 勾了自定义池 ⇒ `createGame` 出来的 `s.draftPool` 恰好是挑的那些，且顺序确定', () => {
    const preset: PoolChoice = { enabled: true, ids: [...TWELVE].reverse() };
    const pool = poolDefsOf(readPoolPreset(storeWithPreset(preset)));
    expect(pool, '引擎级这一档没有池子可传').not.toBeNull();
    const state = createGame({ seed: 'engine-pool', draftPool: pool ?? undefined });
    expect(state.draftPool.map((p) => p.defId), '开局池不是挑的那 12 套（或顺序不是常量顺序）')
      .toEqual(TWELVE);
    expect(state.draftPool.length).toBe(POOL_MIN);
    // 引擎的可用池派生（草稿页真正列出的那一份）也是这 12 套
    expect(
      state.draftPool.filter((p) => !DEMO_PROTOCOLS.slice(POOL_MIN).some((q) => q.defId === p.defId)).length,
      '开局池里混进了没挑的协议',
    ).toBe(POOL_MIN);
    // 反向：另一份集合开局 ⇒ 另一份池子（这条判据不是"恒等于某个常量"）
    const other = createGame({ seed: 'engine-pool', draftPool: buildPool(OTHER_TWELVE) });
    expect(other.draftPool.map((p) => p.defId)).toEqual(buildPool(OTHER_TWELVE).map((p) => p.defId));
    expect(other.draftPool.map((p) => p.defId)).not.toEqual(TWELVE);
  });

  it('E2 兜底：没勾 / 只挑了 11 套 ⇒ 传下去的是 `undefined` ⇒ 引擎落回**全部协议**', () => {
    for (const bad of [
      { enabled: false, ids: TWELVE },
      { enabled: true, ids: TWELVE.slice(0, POOL_MIN - 1) },
      { enabled: true, ids: [] as string[] },
    ] satisfies PoolChoice[]) {
      expect(poolDefsOf(bad), `这份选择不该给出池子：${JSON.stringify(bad)}`).toBeNull();
      const state = createGame({ seed: 'engine-pool', draftPool: poolDefsOf(bad) ?? undefined });
      expect(state.draftPool.map((p) => p.defId), '没给出池子时没有落回全部协议')
        .toEqual(DEMO_PROTOCOLS.map((p) => p.defId));
    }
  });

  it('E3 挑选屏的「完成」→ 存储 → 模式页重画：勾选框被勾上、显示「已选 12 套」', () => {
    const store = createLocalStore({ persistent: createMemoryStore() });
    store.grant();
    // 玩家在挑选屏上挑完并按「完成」（宿主那句就是这一行）
    expect(writePoolPreset(store, { ids: buildPool(TWELVE).map((p) => p.defId), enabled: true }).ok).toBe(true);
    // 回模式选择页 ⇒ 屏照着存储重画
    const root = makeStubEl('div');
    renderModeSelect(root as unknown as HTMLElement, {
      backHome: () => { /* 不测 */ },
      openDeviceCheck: () => { /* 不测 */ },
      startHotseat: () => { /* 不测 */ },
      startNetLobby: () => { /* 不测 */ },
      openPoolPicker: () => { /* 不测 */ },
      readPoolPreset: () => readPoolPreset(store),
      setPoolEnabled: (on) => { writePoolPreset(store, { ids: readPoolPreset(store).ids, enabled: on }); },
    });
    const boxes = descendants(root).filter((n) => isClass(n, 'mode-check'));
    expect(checkedOf(boxes[2]), '「完成」之后那一行没有被勾上').toBe(true);
    expect(disabledOf(boxes[2]), '「完成」之后那一行仍然勾不上').toBe(false);
    expect(textOf(root, 'mode-pool-count')).toBe(t('mode.pool.count', { n: '12' }));
  });

  it('E4 「取消」那一支不写存储 ⇒ 重画模式页仍显示上一次保存的状态（这次改动丢弃）', () => {
    const store = createLocalStore({ persistent: createMemoryStore() });
    store.grant();
    writePoolPreset(store, { ids: TWELVE, enabled: true });
    const before = readPoolPreset(store);
    // 「取消并返回」= 只重画模式页（`showPoolPicker` 的 back 就是 `showModeSelect` 本身）
    const root = makeStubEl('div');
    renderModeSelect(root as unknown as HTMLElement, {
      backHome: () => { /* 不测 */ },
      openDeviceCheck: () => { /* 不测 */ },
      startHotseat: () => { /* 不测 */ },
      startNetLobby: () => { /* 不测 */ },
      openPoolPicker: () => { /* 不测 */ },
      readPoolPreset: () => readPoolPreset(store),
      setPoolEnabled: () => { /* 不测 */ },
    });
    expect(readPoolPreset(store), '「取消」竟然改了本机存的那份选择').toEqual(before);
    const boxes = descendants(root).filter((n) => isClass(n, 'mode-check'));
    expect(checkedOf(boxes[2])).toBe(true);
    expect(textOf(root, 'mode-pool-count')).toBe(t('mode.pool.count', { n: '12' }));
  });
});

/* 让 `objectBody` 保持被引用（B 段只用了 functionBody；多余的 import 会让 tsc 报未使用） */
void objectBody;
