/**
 * 落盘：`/var/lib/compile-feedback/items/<id>/meta.json` + 附件本体（2026-10-01）。
 *
 * 目录形状（与契约逐字一致）：
 *   items/
 *     <id>/                     id = <毫秒时间戳 base36>-<8 字节随机 hex>
 *       meta.json               { id, kind, title, author, body, createdAt, ip,
 *                                 read, readAt, files: [{ name, size, storedAs }] }
 *       <storedAs>              附件原件（净化后的文件名，重名带 -1 / -2 …）
 *   trash/
 *     <id>-<时间戳>/            软删除的去处：`POST /feedback/delete` 把整个目录移到这儿
 *   rate/                       每 IP 每天的附件额度记账（见 rate-limit.mjs）
 *   tmp/<id>/                   写盘途中的临时目录，提交时搬进 items/
 *
 * `meta.json` 里**存了 `ip`**（契约要求，用于事后追责 / 排查刷屏），
 * 但 `/feedback/item` 回给前端时会把 `ip` 去掉（契约：不要暴露服务器绝对路径与 IP）。
 *
 * 2026-10-01 追加（用户当天口头补的需求）：隐藏页要能"标记已读 / 删除"。
 *  - `read` / `readAt` 两个字段写进 meta.json（老投稿**缺这两个字段时按未读算**，
 *    所以升级不需要回填任何历史数据）；
 *  - 删除是**软删除**：目录整体 move 到 `trash/`，不是 rm。
 *    误删能人工捞回；真要腾空间由人显式清（RUNBOOK 里有命令）。
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { matchStoredName, uniqueNameIn } from './naming.mjs';

/** id 的合法形状（同时是路径安全的第一道闸：不含 `/`、不含 `.`） */
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export function isValidId(id) {
  return ID_RE.test(String(id ?? ''));
}

export class Store {
  /**
   * @param {object} opts
   * @param {string} opts.root 数据目录（缺省 `/var/lib/compile-feedback`）
   * @param {number} opts.maxFileBytes 单个附件上限（超了在写盘前就判 413）
   * @param {(msg:string,extra?:object)=>void} [opts.log]
   */
  constructor({ root, maxFileBytes, log = () => {} }) {
    this.root = root;
    this.itemsDir = join(root, 'items');
    this.rateDir = join(root, 'rate');
    this.tmpDir = join(root, 'tmp');
    this.trashDir = join(root, 'trash');
    this.maxFileBytes = maxFileBytes;
    this.log = log;
    for (const dir of [this.root, this.itemsDir, this.rateDir, this.tmpDir, this.trashDir]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /** 一个投稿的目录（`id` 必须已经过 `isValidId`） */
  dirOf(id) {
    if (!isValidId(id)) throw new Error(`非法 id：${String(id)}`);
    return join(this.itemsDir, id);
  }

  /** 一个投稿的 meta.json 路径 */
  metaPathOf(id) {
    return join(this.dirOf(id), 'meta.json');
  }

  /**
   * 起一份新投稿的临时目录。
   *
   * 为什么先落临时目录：契约说"任何失败返回 `{ok:false,...}`"，
   * 而校验（扩展名 / 大小 / 额度）里有一半只能**边收边判**。
   * 先把附件写进 `tmp/<id>/`，全部校验通过、`meta.json` 也写好了，
   * 再 rename 到 `items/<id>/` —— 于是 `items/` 下**只会出现完整的投稿**，
   * 半途失败的请求不会在后台列表里留一堆空壳。
   */
  begin(id) {
    const dir = join(this.tmpDir, id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  /** 写一个附件（写之前再确认一次大小；`size` 以实际写入的字节数为准） */
  saveAttachment(dir, desiredName, data) {
    const storedAs = uniqueNameIn(dir, desiredName);
    writeFileSync(join(dir, storedAs), data, { mode: 0o600 });
    return { storedAs, size: data.length };
  }

  /**
   * 把临时目录变成正式投稿。
   *
   * `read` / `readAt` 在这里补默认值：新投稿一律未读（`read:false` / `readAt:null`），
   * 免得 meta.json 里缺字段、列表页还要各自判一次 `undefined`。
   */
  commit(id, meta) {
    const from = join(this.tmpDir, id);
    const to = this.dirOf(id);
    const withFlags = {
      ...meta,
      read: meta.read === true,
      readAt: typeof meta.readAt === 'string' ? meta.readAt : null,
    };
    mkdirSync(to, { recursive: true, mode: 0o700 });
    writeFileSync(join(to, 'meta.json'), `${JSON.stringify(withFlags, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    // 逐个文件搬（`rename` 目录要求目标不存在；这里目标刚建好，所以搬文件更稳）
    for (const f of withFlags.files) {
      const src = join(from, f.storedAs);
      const dst = join(to, f.storedAs);
      if (existsSync(src)) renameSyncSafe(src, dst);
    }
    removeDirQuiet(from);
    return to;
  }

  /**
   * 读 meta；读不到 / 坏了返回 null（调用方判 404）。
   *
   * 顺手把 `read` / `readAt` 归一化：老投稿（2026-10-01 之前落的）没有这两个字段，
   * 按"未读"算 —— 于是升级不用回填任何历史数据。
   */
  readMeta(id) {
    if (!isValidId(id)) return null;
    try {
      const text = readFileSync(join(this.dirOf(id), 'meta.json'), 'utf8');
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object') return null;
      if (typeof parsed.read !== 'boolean') parsed.read = false;
      if (typeof parsed.readAt !== 'string') parsed.readAt = null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * 标记已读 / 未读，直接改 `meta.json`（2026-10-01 追加）。
   *
   * 返回 `{ ok:true, read, readAt }`；id 不存在返回 `{ ok:false }`（上层判 404）。
   * `read=true` 记此刻时间；`read=false` 把 `readAt` 清回 null（"标回未读"就该把时间一起撤掉，
   * 否则列表上会出现"未读但有一个已读时间"的矛盾读数）。
   */
  setRead(id, read, nowMs) {
    if (!isValidId(id)) return { ok: false };
    const meta = this.readMeta(id);
    if (meta === null) return { ok: false };
    const flag = read === true;
    meta.read = flag;
    meta.readAt = flag ? new Date(nowMs).toISOString() : null;
    try {
      writeFileSync(this.metaPathOf(id), `${JSON.stringify(meta, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      this.log('meta-write-failed', { id, error: String(e && e.message ? e.message : e) });
      return { ok: false, writeFailed: true };
    }
    return { ok: true, read: meta.read, readAt: meta.readAt };
  }

  /**
   * 软删除：把 `items/<id>/` **整体移动**到 `trash/<id>-<时间戳>/`（2026-10-01 追加）。
   *
   * 为什么不是 `rm`：误删要能人工捞回（RUNBOOK 里有恢复与彻底清空两条命令）。
   * 为什么用 move 而不是 copy-then-delete：同一文件系统内 rename 是原子操作，
   * 不存在"复制了一半"的中间态；真跨设备时退化成"复制 + 删源"。
   *
   * 返回 `{ ok:true, trashedTo }` / `{ ok:false }` / `{ ok:false, moveFailed:true }`。
   */
  moveToTrash(id, nowMs) {
    if (!isValidId(id)) return { ok: false };
    const from = this.dirOf(id);
    if (!existsSync(from)) return { ok: false };

    // 目标名唯一：同一 id 被连删两次时不要撞在一起（第二次是 id 已不在 items 里，正常走 404）
    const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '');
    let to = join(this.trashDir, `${id}-${stamp}`);
    for (let i = 1; existsSync(to) && i < 100; i += 1) to = join(this.trashDir, `${id}-${stamp}-${i}`);

    try {
      mkdirSync(this.trashDir, { recursive: true, mode: 0o700 });
      renameSync(from, to);
    } catch (e) {
      // 跨设备 / 权限问题：退化成"搬内容再删源目录"
      try {
        mkdirSync(to, { recursive: true, mode: 0o700 });
        for (const name of readdirSync(from)) {
          const src = join(from, name);
          const dst = join(to, name);
          if (statSync(src).isDirectory()) return { ok: false, moveFailed: true };
          writeFileSync(dst, readFileSync(src), { mode: 0o600 });
        }
        removeDirQuiet(from);
      } catch (e2) {
        this.log('trash-move-failed', {
          id, error: String(e && e.message ? e.message : e), fallbackError: String(e2 && e2.message ? e2.message : e2),
        });
        return { ok: false, moveFailed: true };
      }
    }
    return { ok: true, trashedTo: to };
  }

  /** trash 里现在有多少份（排错 / 运维看一眼用） */
  trashCount() {
    try {
      return readdirSync(this.trashDir).length;
    } catch {
      return 0;
    }
  }

  /**
   * 列出全部投稿的 meta（**最新的在最前** —— 契约要求）。
   *
   * 排序用 `createdAt` 倒序，`createdAt` 相同（同一毫秒）时用 id 倒序兜底。
   * 只读 `meta.json`，不 stat 每个附件（列表页不需要，省一次 IO）。
   */
  listMetas() {
    let names = [];
    try {
      names = readdirSync(this.itemsDir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      const meta = this.readMeta(name);
      if (meta !== null) out.push(meta);
    }
    out.sort((a, b) => {
      const ta = Date.parse(String(a.createdAt ?? '')) || 0;
      const tb = Date.parse(String(b.createdAt ?? '')) || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id ?? '').localeCompare(String(a.id ?? ''));
    });
    return out;
  }

  /**
   * 按清单里的 `storedAs` 找一个附件的真实路径。
   *
   * ★ 路径穿越防线：`name` 必须**逐字命中**清单，命中之后只用清单里的字符串拼路径。
   * 请求里的 `../../etc/passwd` 在清单里当然不存在 ⇒ 返回 null ⇒ 上层 404。
   */
  resolveAttachment(id, requestedName) {
    const meta = this.readMeta(id);
    if (meta === null || !Array.isArray(meta.files)) return null;
    const hit = matchStoredName(meta.files, requestedName);
    if (hit === null) return null;
    const file = join(this.dirOf(id), hit.storedAs);
    try {
      if (!statSync(file).isFile()) return null;
    } catch {
      return null;
    }
    return { path: file, entry: hit };
  }
}

/** `renameSync` 的薄封装（跨设备 / 目标已存在时 rename 会失败，这时退化成"读出来再写"） */
function renameSyncSafe(src, dst) {
  try {
    renameSync(src, dst);
  } catch {
    try {
      writeFileSync(dst, readFileSync(src), { mode: 0o600 });
    } catch { /* 搬不动就留着临时目录，日志里能看出来 */ }
  }
}

/** 删目录（只有临时目录用得到；失败不抛） */
function removeDirQuiet(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* 忽略 */ }
}
