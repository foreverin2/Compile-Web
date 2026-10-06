/**
 * 「自定义协议池」的**挑选屏**（2026-10-06，用户要求）。
 *
 * ## 玩家看到的
 *
 *  - 顶上一句标题与一句"至少选几套"的说明；
 *  - 一排**世代筛选**（1代 / 2代 / 3代，默认全开）—— 它**真的过滤**下面那张清单
 *    （点掉某一代 ⇒ 那一代的协议卡**不建节点**，不是靠 CSS 藏起来）；
 *  - 现有全部协议（`DEMO_PROTOCOLS`，**只读**）的卡片网格：缩略图 + 协议名，
 *    选中/未选中在屏上可区分（`.pool-card-on` + `aria-pressed`）；
 *  - 一个**实时计数**「已选 N（至少 12）」；「完成」按钮**旁边**写着"还差 N 套"；
 *  - 「取消并返回」（丢弃这次改动）与「完成」（只有 N ≥ 12 才可点）。
 *
 * ## 它与宿主的接缝
 *
 * 屏自己不碰存储、不碰对局：`nav.back()` / `nav.done(defIds)` 两个动作由宿主接
 * （`src/main.ts` 的 `showPoolPicker`）—— 于是"保存到哪、回到哪一屏"在宿主一处看得全。
 * `nav.done` 交出去的 defId 已经**归一**（`normalizePoolIds`：只留现有协议、去重、
 * 按 `DEMO_PROTOCOLS` 常量顺序）⇒ 热座与联机两端算出来的池子逐项一致。
 *
 * ## 这一层的纪律
 *
 *  - 文案一律 `t('字面量键')`（不许模块级调用 `t()`：那会把语言冻在 import 那一刻）；
 *  - 协议名取 `ProtocolDef.name`（那是**数据**，与规则页/草稿页同一条口径，不进文案表）；
 *  - 只新建元素、只读 DOM，不写任何只读属性（`tests/ui/net-dom-stub.ts` 的桩会当场抛）。
 */
import { DEMO_PROTOCOLS, protocolImgSrc } from '../data/demo';
// ★ 2026-10-06（用户要求）：协议的显示名按语言取（判据只有 protocol-text.ts 一处）
import { protocolName } from './protocol-text';
import { POOL_MIN, normalizePoolIds } from '../app/pool-choice';
import { t } from '../i18n';

/** 世代分组的代号（`ProtocolDef.set` 的六个值 → 三个 chip） */
type GenId = '1' | '2' | '3';

const GEN_SETS: Readonly<Record<GenId, readonly string[]>> = {
  '1': ['MN01', 'AX01'],
  '2': ['MN02', 'AX02'],
  '3': ['MN03', 'AX03'],
};

/** 一个 defId 属于哪一代（认不出来的一律当 1 代 —— 现有数据集里不存在这种值） */
function genOfSet(set: string): GenId {
  for (const g of ['1', '2', '3'] as const) if (GEN_SETS[g].includes(set)) return g;
  return '1';
}

/**
 * chip 文案。
 *
 * ⚠️ 键必须**以字面量出现在源码里**（下面这个 `switch` 就是落点）：缺键扫描腿只认静态字面量，
 * 换成 `t(\`pool.gen.${g}\`)` 会当场报红（见 `tests/i18n/tables.test.ts` 的"不许有动态键"）。
 */
function genLabel(g: GenId): string {
  switch (g) {
    case '1': return t('pool.gen.1');
    case '2': return t('pool.gen.2');
    default: return t('pool.gen.3');
  }
}

export interface PoolPickerNav {
  /** 「取消并返回」：丢弃这次改动，什么都不写 */
  back(): void;
  /** 「完成」：交回挑好的 defId（已归一、已排成常量顺序） */
  done(defIds: string[]): void;
  /** 打开这一屏时已经勾中的那些（缺省 = 一个都没勾） */
  initialSelected?: readonly string[];
}

/** 造一个带类名的元素（与 `src/ui/home.ts` 里那个同名小工具同款；本屏不 import 那一层） */
function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 造一个按钮（同上） */
function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * 画一屏挑选屏。
 *
 * 本函数是**整屏屏**：第一句就把 `root` 清空重建（与 `renderRules` / `renderLocalData` 同款）。
 * `#app` 上那几个"上一屏留下的"类名一并摘掉（它们是 `src/ui/home.ts` 的 `clearRoot` 负责的
 * 那一组；本屏不 import 那一层，所以在这里各摘一次）。
 */
export function renderPoolPicker(root: HTMLElement, nav: PoolPickerNav): void {
  root.textContent = '';
  root.classList.remove('draft-exit', 'board-enter', 'no-anim', 'screen-home');

  /** 已勾中的 defId（**归一**过的起始值；点击过程中先按点击原样记，"完成"时再归一） */
  const selected = new Set<string>(normalizePoolIds(nav.initialSelected ?? []));
  /** 这一刻打开着的世代（默认三个全开） */
  const genOn = new Set<GenId>(['1', '2', '3']);

  const screen = el('div', 'pool-screen');
  screen.appendChild(el('h1', 'pool-title', t('pool.title')));
  screen.appendChild(el('div', 'pool-sub', t('pool.sub', { min: String(POOL_MIN) })));

  const bar = el('div', 'pool-bar');
  const gens = el('div', 'pool-gens');
  bar.appendChild(gens);
  const count = el('span', 'pool-count', '');
  bar.appendChild(count);
  screen.appendChild(bar);

  const grid = el('div', 'pool-grid');
  screen.appendChild(grid);

  const actions = el('div', 'pool-actions');
  /**
   * 「还差 N 套」就写在**「完成」按钮旁边**（用户口径）：
   * 站在按钮前面，一眼看到"为什么现在点不了"。
   */
  const need = el('span', 'pool-need', '');
  actions.appendChild(need);
  actions.appendChild(button('btn pool-cancel', t('pool.cancel'), () => { nav.back(); }));
  const done = button('btn pool-done', t('pool.done'), () => {
    nav.done(normalizePoolIds([...selected]));
  });
  actions.appendChild(done);
  screen.appendChild(actions);

  /**
   * 重画计数 / "还差几套" / 「完成」的可用性。
   *
   * 判据只有一条：`selected.size >= POOL_MIN`。`selected` 里的值来自归一过的起始值或现有协议卡，
   * 所以它不可能含未知 defId（那张卡不存在）。
   */
  const syncBar = (): void => {
    const n = selected.size;
    count.textContent = t('pool.count', { n: String(n), min: String(POOL_MIN) });
    need.textContent = n >= POOL_MIN ? '' : t('pool.need', { n: String(POOL_MIN - n) });
    done.disabled = n < POOL_MIN;
  };

  /**
   * 重画协议网格：**只画这一刻打开的那些世代**。
   *
   * ⚠️ 这就是"chip 真的在过滤"的实现面 —— 被筛掉的协议**不建节点**（不是加个隐藏类），
   * 所以"点掉 2 代之后列表里还剩几张"在 DOM 上可数。
   */
  const syncGrid = (): void => {
    grid.textContent = '';
    for (const def of DEMO_PROTOCOLS) {
      if (!genOn.has(genOfSet(def.set))) continue;
      const card = el('button', 'pool-card');
      card.setAttribute('type', 'button');
      card.dataset.defId = def.defId;
      /**
       * ★ 2026-10-06（用户报的缺陷）：**协议图要横着放**，与「选协议」那一屏同款。
       *
       * 图本身是竖版（`/assets/protocols/<defId>/protocol-loading.*` 实测 750×1050，
       * 1、2、3 代都是），草稿页的做法是给一个 `aspect-ratio: 1.4/1` 的容器、把图
       * `rotate(-90deg)` 且宽高按 1:1.4 反过来撑满（`styles.css` 的 `.draft-card-img-wrap`
       * / `.draft-card-img`）。这里照同一条几何（容器 + 旋转）做，类名用自己的
       * `.pool-card-thumb-wrap` / `.pool-card-thumb`（版式在 `styles-local.css`）。
       */
      const wrap = el('div', 'pool-card-thumb-wrap');
      const img = document.createElement('img');
      img.className = 'pool-card-thumb';
      img.src = protocolImgSrc(def.defId, false);
      img.alt = '';
      wrap.appendChild(img);
      const name = el('span', 'pool-card-name', protocolName(def));
      card.appendChild(wrap);
      card.appendChild(name);
      const paint = (): void => {
        const on = selected.has(def.defId);
        card.classList.toggle('pool-card-on', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      card.addEventListener('click', () => {
        if (selected.has(def.defId)) selected.delete(def.defId);
        else selected.add(def.defId);
        paint();
        syncBar();
      });
      paint();
      grid.appendChild(card);
    }
  };

  for (const g of ['1', '2', '3'] as const) {
    const chip = el('button', 'pool-gen-chip');
    chip.setAttribute('type', 'button');
    chip.dataset.gen = g;
    chip.textContent = genLabel(g);
    const paint = (): void => {
      const on = genOn.has(g);
      chip.classList.toggle('pool-gen-chip-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    chip.addEventListener('click', () => {
      if (genOn.has(g)) genOn.delete(g);
      else genOn.add(g);
      paint();
      syncGrid();
    });
    paint();
    gens.appendChild(chip);
  }

  syncGrid();
  syncBar();
  root.appendChild(screen);
}
