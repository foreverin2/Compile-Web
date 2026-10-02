/**
 * 制作器的**宿主侧**实现（浏览器能力）：素材预旋转、文件选择、落盘。
 *
 * 为什么单独一个文件而不是塞进 `src/main.ts`：那一份已经 5400 行，而且这几条都是"能独立
 * 读、能独立改"的小事；`main.ts` 只留接线（`showCardmaker` 一个函数）。
 *
 * 本文件是唯一碰浏览器 API（`Image` / `FileReader` / `URL` / `input[type=file]`）的地方 ——
 * `page.ts` 通过 `CardmakerNav` 收下这几个能力，于是它能在无 jsdom 的 DOM 桩上真跑。
 *
 * ★ 2026-10-02（i18n 逐屏抽取）：本文件里唯一一句玩家可见的文案（读文件失败）
 * 搬进 `src/i18n/`（键 `cardmaker.host.*`），中文值**逐字等于改动前**的字面量。
 */
import { t } from '../../i18n';
import type { CardmakerStore, CardmakerNav } from './page';
import { createCardmakerStore, clearCardmakerDeck, readCardmakerDeckInfo, type IdbLike } from './store-idb';
import type { LocalStore } from '../../app/local-store';

/* ── ① 存储：接上本仓的授权状态机 ─────────────────────────────────────── */

/** 全局 IndexedDB 工厂（没有就返回 null ⇒ 存储退化成内存） */
function browserIdbFactory(): IdbLike | null {
  const f = (globalThis as { indexedDB?: IdbLike }).indexedDB;
  return f ?? null;
}

/**
 * 造制作器存储：**持久层的开关由 `localStore` 说了算**（授权状态机只有一份真相）。
 * 游客模式 / 没有 IndexedDB ⇒ 退化成内存，屏上如实提示"刷新就丢"。
 */
export function createCardmakerBrowserStore(localStore: LocalStore): CardmakerStore {
  return createCardmakerStore({ localStore, factory: browserIdbFactory() });
}

/** 「本地数据与隐私」屏用：清掉本机保存的制作器牌组 */
export function clearCardmakerBrowserDeck(): Promise<{ ok: boolean; detail: string }> {
  return clearCardmakerDeck(browserIdbFactory());
}

/** 「本地数据与隐私」屏用：读本机保存的制作器牌组概览 */
export function readCardmakerBrowserDeckInfo(): Promise<{ cards: number } | null> {
  return readCardmakerDeckInfo(browserIdbFactory());
}

/* ── ② 文件：选图 / 读文本 / 落盘 ─────────────────────────────────────── */

/**
 * 造一个隐藏的 `<input type=file>`，`change` 之后解出结果并把自己摘掉。
 *
 * ⚠️ 回调形参名**不叫 `t`**（★ 2026-10-02 i18n 抽取时改的）：本文件现在 import 了
 * `t`（文案取值函数），用同名局部变量会把它遮住 —— 那种遮蔽在"这一处只是忘了用 t()"
 * 与"这一处取不到文案"之间看不出区别，所以直接换个名字。
 */
function pickFileOnce(accept: string, run: (file: File) => Promise<string | null>): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let input: HTMLInputElement;
    try {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      // 用户在系统选择框里按了取消：大多数浏览器**不触发 change**；这条是给"清空选择"那一档
      if (file === null) { settle(null); return; }
      void run(file).then(settle, (e: unknown) => {
        if (settled) return;
        settled = true;
        input.remove();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** 读成 data URL（`FileReader` 是浏览器自带的，零依赖） */
function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { resolve(typeof r.result === 'string' ? r.result : null); };
    r.onerror = () => { reject(r.error ?? new Error(t('cardmaker.host.read-failed'))); };
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { resolve(typeof r.result === 'string' ? r.result : null); };
    r.onerror = () => { reject(r.error ?? new Error(t('cardmaker.host.read-failed'))); };
    r.readAsText(file);
  });
}

/** `CardmakerNav.uploadDataUrl`：让用户挑一张图并读成 data URL（取消 → null） */
export function pickCardmakerImage(): Promise<string | null> {
  return pickFileOnce('image/*', readAsDataUrl);
}

/** `CardmakerNav.readTextFile`：让用户挑一个文件并读成文本（取消 → null） */
export function pickCardmakerText(accept: string): Promise<string | null> {
  return pickFileOnce(accept, readAsText);
}

/**
 * `CardmakerNav.download`：把 Blob 落盘。
 *
 * 与全仓既有做法一致（`<a download>` + `URL.createObjectURL`），**不引任何依赖**。
 * `setTimeout` 之后回收 object URL：立刻 `revokeObjectURL` 在个别浏览器里会把下载掐断。
 */
export function downloadCardmakerBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}

/** 把这几条浏览器能力打包成 `page.ts` 要的那份 nav 接缝（`back` 与 `store` 由宿主自己补） */
export function cardmakerBrowserIO(): Pick<CardmakerNav, 'readTextFile' | 'uploadDataUrl' | 'download'> {
  return {
    readTextFile: pickCardmakerText,
    uploadDataUrl: pickCardmakerImage,
    download: downloadCardmakerBlob,
  };
}
