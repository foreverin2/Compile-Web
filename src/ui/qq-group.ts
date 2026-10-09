/**
 * ★ 2026-10-07（**用户要求**）：首页右上角「玩家群」按钮 + 进群二维码面板。
 *
 * 用户原话：「我希望在首页右上角的更新日志下方再添加上一个按钮，点击后用于展示 qq 群的进群二维码，
 * 就是我给的这个图片」（图片 = 译世界交流群的名片：群号 1124215031 + 二维码 + 「扫一扫二维码，加入群聊」）。
 *
 * ## 形态：与「更新日志」**同一套**
 *
 * 更新日志是"角标按钮 + 右侧整屏抽屉"（`src/ui/changelog.ts` 的 `changelogElement` +
 * `changelog-wrap` / `changelog-open`）⇒ 这里照抄那套几何，只换类名前缀（`qqgroup-*`）与内容：
 * 抽屉里放二维码图 + 一句提示。位置由 `styles-local.css` 的 `.qqgroup-wrap` 定：**同一个右上角、
 * `top` 比更新日志那一枚低**（用户要的是"更新日志下方"）。
 *
 * ## 图片与文案的边界（如实登记）
 *
 *  - 图片本身**只此一份**（用户给的那张，`public/assets/ui/qq-group.jpg`）：图上的字（群名、
 *    「扫一扫二维码，加入群聊」、QQ 标识）**是图的一部分，英文界面下也是中文** —— 那是用户素材，
 *    不重画；`alt` 文本与面板里的提示句走 i18n（中英各一条），所以英文界面下玩家仍能读懂"这是
 *    什么、怎么用"。
 *  - 群号（`1124215031`）写在 i18n 的提示句里，与图片上的号一致。
 *
 * ## 本模块只造元素
 *
 * 不碰存储、不碰 `#app`：开合由宿主（`src/ui/home.ts` 的 `qqWrap.classList.toggle('qqgroup-open')`）
 * 负责，与 `changelogElement` 的 `nav.onClose` 同款。
 */
import { t } from '../i18n';

/** 二维码图片路径（`public/assets/ui/qq-group.jpg`；`tests/ui/qqgroup.test.ts` 有一条腿按它查文件在不在） */
export const QQ_GROUP_IMG_SRC = '/assets/ui/qq-group.jpg';

/** 群号（与图片上印的一致；写在这里是为了让提示句与图片能对得上，改一处两处同步） */
export const QQ_GROUP_NO = '1124215031';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 抽屉本体（`role="dialog"`）。宿主把它塞进 `.qqgroup-wrap`，靠那个 wrapper 的类名开合。 */
export function qqGroupElement(nav: { readonly onClose: () => void } = { onClose: () => { /* 默认空实现 */ } }): HTMLElement {
  const panel = el('div', 'qqgroup-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('qqgroup.title'));

  const head = el('div', 'qqgroup-head');
  head.appendChild(el('div', 'qqgroup-title', t('qqgroup.title')));
  const close = el('button', 'btn qqgroup-close', t('common.close'));
  close.setAttribute('type', 'button');
  close.addEventListener('click', () => { nav.onClose(); });
  head.appendChild(close);
  panel.appendChild(head);

  const img = document.createElement('img');
  img.className = 'qqgroup-img';
  img.src = QQ_GROUP_IMG_SRC;
  // 图片是用户给的素材（识别性是它的本分）：不动比例、不裁切；`alt` 走 i18n 让读屏/英文界面能读
  img.alt = t('qqgroup.alt');
  img.loading = 'lazy';
  img.decoding = 'async';
  panel.appendChild(img);

  panel.appendChild(el('p', 'qqgroup-hint', t('qqgroup.hint', { no: QQ_GROUP_NO })));
  return panel;
}
