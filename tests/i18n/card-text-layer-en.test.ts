import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  descendants, drainRaf, installStubDom, isClass, makeStubEl, type StubNode,
} from '../ui/net-dom-stub';
import { buildCardTextEl, openZoom } from '../../src/ui/render';
import { fillNetZoomBox, netZoomContentFor, resetNetUiState } from '../../src/ui/render-net';
import { renderLibrary } from '../../src/ui/home';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { cardImgSrc, cardTextParts, getCardDef } from '../../src/data/demo';
import { DEFAULT_LANG, setLang } from '../../src/i18n';

/**
 * ★ P4（2026-10-02）：**英文模式不产出卡牌中文效果文本框** —— 三条腿。
 *
 * ## 这一条腿守的是什么（用户 2026-10-01 的原话）
 *
 * 「英文的卡牌文本不用管，因为**卡牌图片的原文就是英文**，如果设置为了英文，只需要
 * **不显示中文翻译文本框**即可」。⇒ 判据不是"那一层的内容为空"，而是**那一层一个节点
 * 都不产出**（`buildCardTextEl` 在 `en` 下逐字返回 `null`）。
 *
 * ## 那层文本一共只有三个产出口（都走 `render.ts` 的 `buildCardTextEl`）
 *
 * | # | 出口 | 调用点 | 什么时候产出 |
 * |---|---|---|---|
 * | 1 | 放大查看遮罩（双击卡牌/`openZoom`） | `src/ui/render.ts` 的 `openZoom` | 非协议卡且**正面**显示时（peek 翻到背面会联动隐藏） |
 * | 2 | 图鉴右侧展示框 | `src/ui/home.ts` 的 `previewEntry` | 悬浮/点击**指令卡**条目时（协议条目走的是评分详情面板，不是这一层） |
 * | 3 | 联机牌桌放大框 | `src/ui/render-net.ts` 的 `netZoomContentFor` | 悬浮/点击**正面且公开**的场上卡时 |
 *
 * 手牌/场上/协议池的**卡面本身只产出图片**（`renderCardFace` 只有 `img.card-face-img`），
 * 所以那三处不在这条腿的范围内 —— 这也是"只需要藏这一层"的前提。
 *
 * ## 三条腿
 *
 *  1. **en**：三处出口都不产出那层文本（逐字断言"没有那个节点"，不是"内容为空"）；
 *  2. **zh**：三处出口逐字等于**改动前**那一帧的原文（锚点是硬写在下面的那三个字面量，
 *     来源 = `git show HEAD:src/data/demo.ts` 的 `${proto.name} · ${def.value} 分` /
 *     `'顶部' | '中部' | '底部'` + 全角冒号，**不许跟着产物一起改**）；
 *  3. **源码**：判定只有一处（`buildCardTextEl` 里的 `en` 早退），三个出口都还走这个函数
 *     —— 防的是"以后有人新开第四个出口、忘了判语言"。
 */
afterEach(() => {
  setLang(DEFAULT_LANG);
  setFxViewSeat(null);
  resetNetUiState();
});

/* ============================================================================
 * HEAD 锚点：改动前那一帧屏上的原文（逐字，不许跟着产物改）
 * ========================================================================== */

/** `fire-3`：`{ protocol: 'fire', value: 3, bottom: '结束：你可以弃1张牌。如果弃了，翻转1张牌。' }`
 *  ⇒ 只有 `bottom` 一段。协议 `fire` 的中文名 = `火焰`（`src/data/cards.ts`）。 */
const FIRE3_TITLE = '火焰 · 3 分';
const FIRE3_SEG_LABEL = '底部：';
const FIRE3_SEG_TEXT = '结束：你可以弃1张牌。如果弃了，翻转1张牌。';

const parts = () => cardTextParts(getCardDef('fire-3'));

/** 树上某个类的节点（`descendants` 不含文本节点） */
const nodesOf = (root: StubNode, cls: string): StubNode[] =>
  descendants(root).filter((n) => isClass(n, cls));

/** 子树里所有**非空**文本（含 `document.createTextNode` 造出来的文本节点），按 DOM 顺序用 `\n` 连 */
function textOf(n: StubNode): string {
  const parts: string[] = [];
  const walk = (x: StubNode): void => {
    if (x.text !== '') parts.push(x.text);
    for (const c of x.children ?? []) {
      if (Array.isArray((c as StubNode).children)) walk(c as StubNode);
      else {
        const t = String((c as { text?: string }).text ?? '');
        if (t !== '') parts.push(t);
      }
    }
  };
  walk(n);
  return parts.join('\n');
}

/** `.zoom-overlay` 的整棵子树（`openZoom` 挂在 `document.body` 上） */
const zoomOverlay = (): StubNode | null =>
  nodesOf(document.body as unknown as StubNode, 'zoom-overlay')[0] ?? null;

/* ============================================================================
 * 三个出口的夹具
 * ========================================================================== */

/** 放大查看遮罩这一帧（`openZoom` 真跑） */
function openZoomFrame(): StubNode {
  openZoom('fire-3', true, false, false);
  const ov = zoomOverlay();
  expect(ov, '`openZoom` 没有把 `.zoom-overlay` 挂到 document.body 上').toBeTruthy();
  return ov!;
}

/** 图鉴展示框这一帧：画一屏图鉴 → 在**`fire-3` 那张指令卡**上派一次 `mouseenter`（真跑 hover 那条路） */
function libraryPreviewFrame(): { root: StubNode; preview: StubNode } {
  const root = makeStubEl('div');
  renderLibrary(root as unknown as HTMLElement, () => { /* 不测返回 */ });
  // `.lib-card` 自己不带 defId ⇒ 按卡图 src 认那一张（与产出代码写的是同一个 `cardImgSrc`）
  const want = cardImgSrc('fire', '3');
  const cell = nodesOf(root, 'lib-card').find((c) => {
    const img = descendants(c).find((n) => n.tag === 'img');
    return img !== undefined && String((img as unknown as { src?: string }).src ?? '') === want;
  });
  expect(cell, `图鉴列表里找不到 ${want} 那一张 ⇒ 这条腿什么都没验到`).toBeTruthy();
  // 桩的 `dispatchEvent` 从**派发节点的父节点**开始冒泡 ⇒ 派在卡的子节点上，
  // `.lib-card` 自己挂的 `mouseenter` 才会被调到（真实 DOM 里 mouseenter 不冒泡，
  // 这里是桩的语义；监听器的注册点与产出代码一致，见 home.ts 的 `cell.addEventListener`）。
  const child = cell!.children[0];
  expect(child, '`.lib-card` 里没有子节点 ⇒ 派不出 hover').toBeTruthy();
  child.dispatchEvent({ type: 'mouseenter' });
  const preview = nodesOf(root, 'library-preview-text')[0];
  expect(preview, '图鉴展示框那一格 `.library-preview-text` 不在树上（结构被改动？）').toBeTruthy();
  return { root, preview: preview! };
}

/** 联机牌桌放大框这一帧（`netZoomContentFor` + `fillNetZoomBox` 真跑） */
function netZoomBoxForCard(): StubNode {
  const wrap = makeStubEl('div');
  wrap.classList.add('board', 'net-board', 'net-view-0');
  const side = makeStubEl('div');
  side.classList.add('net-side', 'net-side-self');
  wrap.appendChild(side);
  const card = makeStubEl('div');
  card.classList.add('card');
  card.dataset.uid = 'u-fire3';
  const img = makeStubEl('img');
  img.className = 'card-face-img';
  (img as unknown as HTMLImageElement).src = cardImgSrc('fire', '3');
  card.appendChild(img);
  side.appendChild(card);
  const item = netZoomContentFor(card as unknown as HTMLElement, {
    phase: 'turn',
    deps: { isSelfSide: (sd) => sd === 'self' },
  });
  expect(item, '正面场上卡没有解出放大框条目').toBeTruthy();
  const box = makeStubEl('div');
  box.classList.add('net-zoom-box');
  fillNetZoomBox(box as unknown as HTMLElement, item);
  return box;
}

/* ============================================================================
 * ① en：这一层**不产出**
 * ========================================================================== */

describe('★ P4 ① 英文模式：卡牌中文效果文本框不产出', () => {
  it('buildCardTextEl 在 `en` 下逐字返回 `null`（不是"内容为空"）', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      expect(buildCardTextEl(parts(), 'zoom-text')).toBe(null);
      expect(buildCardTextEl(parts(), 'library-preview-text')).toBe(null);
      expect(buildCardTextEl(parts(), 'net-zoom-box-text')).toBe(null);
    } finally {
      restore();
    }
  });

  it('放大查看遮罩：没有 `.zoom-text` / `.card-text-*`；遮罩与卡图照旧', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const ov = openZoomFrame();
      expect(nodesOf(ov, 'zoom-text').length, `en 下产出了 ${nodesOf(ov, 'zoom-text').length} 个 .zoom-text`).toBe(0);
      expect(nodesOf(ov, 'card-text-title').length, 'en 下产出了卡文标题节点').toBe(0);
      expect(nodesOf(ov, 'card-text-seg').length, 'en 下产出了卡文分段节点').toBe(0);
      // 其它内容正常：遮罩本体、卡图、以及"整棵子树的文本里没有那三句"
      expect(nodesOf(ov, 'zoom-img').length, 'en 下放大框里没有卡图了').toBe(1);
      const all = textOf(ov);
      expect(all, 'en 下放大框里还留着中文卡文标题').not.toContain(FIRE3_TITLE);
      expect(all, 'en 下放大框里还留着中文分段标签').not.toContain(FIRE3_SEG_LABEL);
      expect(all, 'en 下放大框里还留着中文卡文正文').not.toContain(FIRE3_SEG_TEXT);
    } finally {
      restore();
    }
  });

  it('图鉴展示框：那层文本一个节点都不产出（图与标题行还在）', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const { preview } = libraryPreviewFrame();
      expect(preview.children.length, `en 下图鉴展示框里产出了 ${preview.children.length} 个子节点`).toBe(0);
      expect(nodesOf(preview, 'card-text-title').length).toBe(0);
      expect(nodesOf(preview, 'card-text-seg').length).toBe(0);
    } finally {
      restore();
    }
  });

  it('联机牌桌放大框：不产出那层文本（卡图与档位还在）', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const box = netZoomBoxForCard();
      expect(box.dataset.state, '档位不是 card').toBe('card');
      expect(nodesOf(box, 'net-zoom-box-text').length, 'en 下产出了那层文本列').toBe(0);
      expect(nodesOf(box, 'card-text-seg').length).toBe(0);
      expect(nodesOf(box, 'net-zoom-box-img').length, 'en 下放大框里没有卡图了').toBe(1);
    } finally {
      restore();
    }
  });
});

/* ============================================================================
 * ② zh：与改动前**逐字**一致
 * ========================================================================== */

describe('★ P4 ② 中文模式：与改动前逐字一致（HEAD 锚点）', () => {
  it('buildCardTextEl 的产出逐字等于 HEAD 锚点', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      const box = buildCardTextEl(parts(), 'zoom-text') as unknown as StubNode | null;
      expect(box, 'zh 下 `buildCardTextEl` 不产出了 —— 中文侧回归').toBeTruthy();
      expect(box!.cls, '根类名变了').toBe('zoom-text');
      const titles = descendants(box!).filter((n) => isClass(n, 'card-text-title')).map((n) => n.text);
      expect(titles, '标题逐字不等于改动前').toEqual([FIRE3_TITLE]);
      const labels = descendants(box!).filter((n) => isClass(n, 'card-text-seg-label')).map((n) => n.text);
      expect(labels, '分段标签逐字不等于改动前（含全角冒号）').toEqual([FIRE3_SEG_LABEL]);
      expect(textOf(box!), '整块文本逐字不等于改动前').toBe(
        `${FIRE3_TITLE}\n${FIRE3_SEG_LABEL}\n${FIRE3_SEG_TEXT}`);
    } finally {
      restore();
    }
  });

  it('放大查看遮罩：`.zoom-text` 照旧产出且逐字等于 HEAD 锚点', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      const ov = openZoomFrame();
      const texts = nodesOf(ov, 'zoom-text');
      expect(texts.length, 'zh 下放大框里没有那层中文文本框了').toBe(1);
      expect(textOf(texts[0]), '放大框那层文本逐字不等于改动前').toBe(
        `${FIRE3_TITLE}\n${FIRE3_SEG_LABEL}\n${FIRE3_SEG_TEXT}`);
    } finally {
      restore();
    }
  });

  it('图鉴展示框：那层文本照旧产出且逐字等于 HEAD 锚点', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      const { preview } = libraryPreviewFrame();
      expect(preview.children.length, 'zh 下图鉴展示框里没有那层文本了').toBe(1);
      expect(textOf(preview), '图鉴那层文本逐字不等于改动前').toBe(
        `${FIRE3_TITLE}\n${FIRE3_SEG_LABEL}\n${FIRE3_SEG_TEXT}`);
    } finally {
      restore();
    }
  });

  it('联机牌桌放大框：那层文本照旧产出（含顶/中/底分段）', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      const box = netZoomBoxForCard();
      const texts = nodesOf(box, 'net-zoom-box-text');
      expect(texts.length, 'zh 下联机放大框里没有那层中文文本了').toBe(1);
      expect(textOf(texts[0]), '联机放大框那层文本逐字不等于改动前').toBe(
        `${FIRE3_TITLE}\n${FIRE3_SEG_LABEL}\n${FIRE3_SEG_TEXT}`);
    } finally {
      restore();
    }
  });
});

/* ============================================================================
 * ③ 源码腿：判定只有一处，三个出口都走它
 * ========================================================================== */

describe('★ P4 ③ 判定只有一处（防第四个出口忘判语言）', () => {
  const src = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(`../../src/ui/${rel}`, import.meta.url)))
      .subarray(0, 4 * 1024 * 1024).toString('utf8');

  it('`buildCardTextEl` 里有 `en` 早退；三个出口仍走这个函数', () => {
    const render = src('render.ts');
    const at = render.indexOf('export function buildCardTextEl(');
    expect(at, '`buildCardTextEl` 不见了（改名/搬家？）').toBeGreaterThan(-1);
    const body = render.slice(at, at + 900);
    expect(body, '`buildCardTextEl` 里没有 `en` 早退 —— P4 的判定被删掉了')
      .toContain("if (getLang() === 'en') return null;");
    // 三个出口（放大查看 / 图鉴 / 联机放大框）都还在调它
    expect(render, '`render.ts` 的放大查看不再走 `buildCardTextEl`')
      .toContain("buildCardTextEl(cardTextParts(getCardDef(defId)), 'zoom-text')");
    expect(src('home.ts'), '`home.ts` 的图鉴展示框不再走 `buildCardTextEl`')
      .toContain("buildCardTextEl(cardTextParts(c), 'library-preview-text')");
    expect(src('render-net.ts'), '`render-net.ts` 的联机放大框不再走 `buildCardTextEl`')
      .toContain("buildCardTextEl(cardTextParts(getCardDef(defId)), 'net-zoom-box-text')");
  });

  it('反向锚点：`zh` 与 `en` 的取值真的不同（判据不在"两语言同值"上恒真）', async () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const en = buildCardTextEl(parts(), 'zoom-text');
      setLang('zh');
      const zh = buildCardTextEl(parts(), 'zoom-text');
      expect(en).toBe(null);
      expect(zh).not.toBe(null);
      expect(zh).not.toBe(en);
    } finally {
      await drainRaf();
      restore();
    }
  });
});
