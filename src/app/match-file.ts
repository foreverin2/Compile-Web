/**
 * 档案格式 MatchFile（G3；见 docs/2026-09-13-联机与多端-设计稿.md §3，全节）。
 *
 * 一份数据，五处复用（§3.2）：存档 / 录像 / 断线重连凭据 / 联机传输内容 / 观战中途加入。
 * 因此这里**只有纯数据与纯函数**：无 DOM、无存储、无网络 —— 联机与浏览器能力都不该渗进来。
 *
 * 与设计稿 §3.1 的**唯一差异**：`setup` 多了 `draftPicks` / `bannedProtocols` 两个**顺序快照**。
 * 理由见 setup 字段的注释（缺它 ban 模式无法完整重放）。
 */
import type { CreateGameOptions } from '../core/state/create';
import type { ActionKind } from '../core/game';
import type { PlayerId } from '../core/models/types';
import { hash64, stableStringify } from '../core/fingerprint';
import { getProtocolDef } from '../data/demo';

export const MATCH_FILE_FORMAT = 'compile-match';
export const MATCH_FILE_VERSION = 1;

/** §3.1：`via` 是**档案层元数据，不进引擎状态**（§3.1 注释、§14.2） */
export interface ActionRecord {
  /** 单调递增，从 0 开始 */
  seq: number;
  /** 执行者座位 */
  player: PlayerId;
  kind: ActionKind;
  /** 随 kind 收窄 */
  args?: unknown;
  /** user = 玩家操作；timeout = 决策窗口超时自动合成；ai = 本地 AI 产生 */
  via?: 'user' | 'timeout' | 'ai';
}

export interface MatchClock {
  decisionSec: number;
  draftSec: number;
  /** 免罚跳过额度，默认 2（§14.3） */
  maxSkips: number;
}

export interface MatchFileSetup {
  draftMode: 'normal' | 'ban';
  draftStarter: PlayerId;
  firstToPlay: PlayerId;
  /** 开局可选协议池（defId 列表） */
  draftPool: string[];
  /**
   * **顺序快照**（相对 §3.1 的补齐）：草稿实际选出的协议，按选择顺序。
   * `draftPool` 是集合、`draftPicks` 是序列 —— 少了序列，ban 模式（选/禁交错）无法重放。
   */
  draftPicks: string[];
  /** **顺序快照**：被禁用的协议 defId，按禁用顺序（§3.1 的 setup 未含此字段） */
  bannedProtocols: string[];
  /** 回合计时配置（§14.5）；缺省 = 不启用计时。**G6 才用**，G3 只透传 */
  clock?: MatchClock;
}

export interface MatchFile {
  format: typeof MATCH_FILE_FORMAT;
  version: typeof MATCH_FILE_VERSION;
  /** 卡牌数据指纹（§3.4） */
  cardDataHash: string;
  seed: string;
  setup: MatchFileSetup;
  players: [{ nick: string }, { nick: string }];
  actions: ActionRecord[];
  result?: { winner: PlayerId | null; reason: string };
  /** 仅展示用，**不进指纹**（§3.1） */
  createdAt: string;
}

/** 档案指纹里 `createdAt` 的占位：算指纹前把它替换成这个常量 */
const CREATED_AT_OMITTED = '';

/* ------------------------------------------------------------------ *
 * 校验错误
 * ------------------------------------------------------------------ */

export type MatchFileErrorCode =
  | 'not-json'
  | 'not-a-match-file'
  | 'bad-version-type'
  | 'too-new'
  | 'bad-shape'
  | 'bad-action'
  | 'hash-mismatch-unknown';

export interface MatchFileParseError {
  code: MatchFileErrorCode;
  message: string;
}

/* ------------------------------------------------------------------ *
 * 规范化
 * ------------------------------------------------------------------ */

const VIA_VALUES: readonly ActionRecord['via'][] = ['user', 'timeout', 'ai'];

/**
 * 单条操作规范化 + 深拷贝：写进档案的形态只有一种，且**不持有调用方的引用**。
 * - `via` 只保留三个已知值（未知值丢弃，而不是原样写进档案）；
 * - `args` 为 undefined 时**删掉该键**（与 JSON.stringify 语义一致，也让指纹稳定）；
 * - `args` 的内容（number/string/boolean/数组/对象）原样透传 —— 重放靠它，改写等于篡改档案。
 *
 * 为什么必须深拷贝而不是 `slice()`/浅拷贝：`actions()` 的调用方（UI 列表、G4 的 driver、
 * 联机发送方）拿到的是**快照语义**；浅拷贝会让 `snap[0].kind = …` 直接改掉记录器内部
 * 那条记录 → 档案被静默篡改，而"为什么重放不出来"将无法调试。
 * 用 JSON 往返而不是 `structuredClone`：本模块要求 node/浏览器同构纯跑，且 `args`
 * 本就来自 `JSON.parse`（JSON 往返是恒等变换，无信息损失）。
 */
export function normalizeAction(a: ActionRecord): ActionRecord {
  const out: ActionRecord = { seq: a.seq, player: a.player, kind: a.kind };
  if (a.args !== undefined) out.args = JSON.parse(JSON.stringify(a.args)) as unknown;
  if (a.via !== undefined && VIA_VALUES.includes(a.via)) out.via = a.via;
  return out;
}

/** 档案规范化：actions 逐条规范化（顺序不动 —— **顺序就是语义**） */
export function canonicalMatchFile(f: MatchFile): MatchFile {
  const out: MatchFile = {
    format: MATCH_FILE_FORMAT,
    version: MATCH_FILE_VERSION,
    cardDataHash: f.cardDataHash,
    seed: f.seed,
    setup: {
      draftMode: f.setup.draftMode,
      draftStarter: f.setup.draftStarter,
      firstToPlay: f.setup.firstToPlay,
      draftPool: [...f.setup.draftPool],
      draftPicks: [...f.setup.draftPicks],
      bannedProtocols: [...f.setup.bannedProtocols],
      ...(f.setup.clock ? { clock: { ...f.setup.clock } } : {}),
    },
    players: [{ nick: f.players[0].nick }, { nick: f.players[1].nick }],
    actions: f.actions.map(normalizeAction),
    ...(f.result ? { result: { winner: f.result.winner, reason: f.result.reason } } : {}),
    createdAt: f.createdAt,
  };
  return out;
}

/** 落盘/传输用：规范形态 → JSON（键序固定，同一份数据字节相同） */
export function stringifyMatchFile(f: MatchFile): string {
  return JSON.stringify(canonicalMatchFile(f));
}

/** 档案指纹：不含 createdAt（同一局导出两次必须同指纹） */
export function matchFileFingerprint(f: MatchFile): string {
  const c = canonicalMatchFile(f);
  return hash64(stableStringify({ ...c, createdAt: CREATED_AT_OMITTED }));
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

const KINDS: readonly ActionKind[] = [
  'play',
  'refresh',
  'compile',
  'advance',
  'effect-choice',
  'resolve-trigger',
  'clear-cache',
  'rearrange-protocols',
];

/** 该 kind 的 args 必须含有的键；空数组 = 必须**不带** args */
const ARGS_REQUIRED: Record<ActionKind, readonly string[]> = {
  play: ['cardUid', 'faceUp'],
  compile: ['line'],
  'effect-choice': ['promptId', 'choice'],
  'resolve-trigger': ['cardUid'],
  'rearrange-protocols': ['target', 'a', 'b'],
  refresh: [],
  advance: [],
  'clear-cache': [],
};

function isPlayerId(v: unknown): v is PlayerId {
  return v === 0 || v === 1;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function checkAction(a: unknown, i: number): MatchFileParseError | null {
  if (!isObj(a)) return { code: 'bad-action', message: `第 ${i} 条操作不是对象` };
  if (typeof a.seq !== 'number' || !Number.isInteger(a.seq) || a.seq < 0) {
    return { code: 'bad-action', message: `第 ${i} 条操作的 seq 不是非负整数` };
  }
  if (!isPlayerId(a.player)) return { code: 'bad-action', message: `第 ${i} 条操作的 player 不是 0/1` };
  if (typeof a.kind !== 'string' || !KINDS.includes(a.kind as ActionKind)) {
    return { code: 'bad-action', message: `第 ${i} 条操作的 kind 未知：${String(a.kind)}` };
  }
  if (a.via !== undefined && !VIA_VALUES.includes(a.via as ActionRecord['via'])) {
    return { code: 'bad-action', message: `第 ${i} 条操作的 via 未知：${String(a.via)}` };
  }
  const need = ARGS_REQUIRED[a.kind as ActionKind];
  const args = a.args;
  if (need.length === 0) {
    if (args !== undefined) return { code: 'bad-action', message: `第 ${i} 条 ${a.kind} 不该带 args` };
    return null;
  }
  if (!isObj(args)) return { code: 'bad-action', message: `第 ${i} 条 ${a.kind} 缺 args` };
  for (const k of need) {
    if (args[k] === undefined) return { code: 'bad-action', message: `第 ${i} 条 ${a.kind} 的 args 缺 ${k}` };
  }
  return null;
}

function checkSetup(v: unknown): MatchFileParseError | null {
  if (!isObj(v)) return { code: 'bad-shape', message: 'setup 不是对象' };
  if (v.draftMode !== 'normal' && v.draftMode !== 'ban') return { code: 'bad-shape', message: 'setup.draftMode 非法' };
  if (!isPlayerId(v.draftStarter)) return { code: 'bad-shape', message: 'setup.draftStarter 非法' };
  if (!isPlayerId(v.firstToPlay)) return { code: 'bad-shape', message: 'setup.firstToPlay 非法' };
  if (!isStrArray(v.draftPool)) return { code: 'bad-shape', message: 'setup.draftPool 非法' };
  if (!isStrArray(v.draftPicks)) return { code: 'bad-shape', message: 'setup.draftPicks 非法' };
  if (!isStrArray(v.bannedProtocols)) return { code: 'bad-shape', message: 'setup.bannedProtocols 非法' };
  if (v.clock !== undefined) {
    if (!isObj(v.clock)) return { code: 'bad-shape', message: 'setup.clock 非法' };
    for (const k of ['decisionSec', 'draftSec', 'maxSkips'] as const) {
      if (typeof v.clock[k] !== 'number') return { code: 'bad-shape', message: `setup.clock.${k} 非法` };
    }
  }
  return null;
}

function checkPlayers(v: unknown): MatchFileParseError | null {
  if (!Array.isArray(v) || v.length !== 2) return { code: 'bad-shape', message: 'players 必须是长度 2 的数组' };
  for (let i = 0; i < 2; i += 1) {
    const p = v[i];
    if (!isObj(p) || typeof p.nick !== 'string') return { code: 'bad-shape', message: `players[${i}].nick 非法` };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 版本迁移链（§3.3）
 * ------------------------------------------------------------------ */

/**
 * 迁移链：`MIGRATIONS[n]` 把 v(n) 升到 v(n+1)。**v1 是首版，故为空表。**
 *
 * 行为腿（见 tests/app/match-recorder.test.ts）：当 `MATCH_FILE_VERSION` 增长而本表没有对应项时，
 * `parseMatchFile` 必须**报 too-new 而不是静默吞掉**。这条腿的作用是：
 * 谁把版本号从 1 改成 2 而忘了写迁移，测试当场红。
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * 迁移结果用**判别式联合**（而不是 `'error' in x`）：
 * `Record<string, unknown>` 与 `{ error: … }` 的 `in` 收窄会让 TS 把 error 收成 unknown。
 */
type MigrateResult =
  | { kind: 'ok'; raw: Record<string, unknown> }
  | { kind: 'error'; error: MatchFileParseError };

function migrate(raw: Record<string, unknown>): MigrateResult {
  let v = raw.version as number;
  if (!Number.isInteger(v) || v < 1) {
    return { kind: 'error', error: { code: 'bad-version-type', message: `档案 version 非法：${String(raw.version)}` } };
  }
  if (v > MATCH_FILE_VERSION) {
    return {
      kind: 'error',
      error: {
        code: 'too-new',
        message: `档案来自更新版本的游戏（档案 v${v}，当前支持 v${MATCH_FILE_VERSION}）。请更新游戏，本程序不会猜测如何读取它。`,
      },
    };
  }
  let cur = raw;
  while (v < MATCH_FILE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) {
      // 到不了（v < 当前且无迁移项 = 版本表与迁移链不同步）
      return { kind: 'error', error: { code: 'too-new', message: `缺少 v${v} → v${v + 1} 的迁移步骤` } };
    }
    cur = step(cur);
    v += 1;
  }
  return { kind: 'ok', raw: cur };
}

/* ------------------------------------------------------------------ *
 * 解析入口
 * ------------------------------------------------------------------ */

export type MatchFileParseResult =
  | { ok: true; file: MatchFile; warnings: string[] }
  | { ok: false; error: MatchFileParseError };

/**
 * 解析一份档案。
 * - `opts.currentHash` = 本机 `CARD_DATA_HASH`；不同则**仍成功**但带一条警告（§3.3 第 3 条：
 *   "警告并允许仍要打开"，联机时的**拒绝**在 G5 的握手里做）。
 *
 * 失败一律返回 `{ ok: false, error }`（**不抛**）：调用方（UI）要能区分失败形态并给不同文案。
 */
export function parseMatchFile(text: string, opts: { currentHash: string }): MatchFileParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'not-json', message: '档案不是合法 JSON（文件可能已损坏）' } };
  }
  if (!isObj(raw)) return { ok: false, error: { code: 'not-a-match-file', message: '档案顶层不是对象' } };
  if (raw.format !== MATCH_FILE_FORMAT) {
    return {
      ok: false,
      error: { code: 'not-a-match-file', message: `不是 Compile 对局档案（format=${String(raw.format)}）` },
    };
  }
  const migrated = migrate(raw);
  if (migrated.kind === 'error') return { ok: false, error: migrated.error };
  const m = migrated.raw;

  if (typeof m.seed !== 'string' || m.seed.length === 0) {
    return { ok: false, error: { code: 'bad-shape', message: 'seed 非法（必须是非空字符串：重放全靠它）' } };
  }
  if (typeof m.cardDataHash !== 'string') {
    return { ok: false, error: { code: 'bad-shape', message: 'cardDataHash 非法' } };
  }
  const setupErr = checkSetup(m.setup);
  if (setupErr) return { ok: false, error: setupErr };
  const playersErr = checkPlayers(m.players);
  if (playersErr) return { ok: false, error: playersErr };
  if (!Array.isArray(m.actions)) return { ok: false, error: { code: 'bad-shape', message: 'actions 不是数组' } };
  for (let i = 0; i < m.actions.length; i += 1) {
    const err = checkAction(m.actions[i], i);
    if (err) return { ok: false, error: err };
  }

  const warnings: string[] = [];
  if (m.cardDataHash !== opts.currentHash) {
    warnings.push(
      `卡牌数据与本机不同（档案 ${m.cardDataHash}，本机 ${opts.currentHash}）：同一串操作可能得到不同结果。可以继续打开，但联机时会被拒绝。`,
    );
  }

  const file = canonicalMatchFile(m as unknown as MatchFile);
  return { ok: true, file, warnings };
}

/* ------------------------------------------------------------------ *
 * 档案 → 开局
 * ------------------------------------------------------------------ */

/**
 * 把档案的 setup 映射成 `createGame` 的入参。
 *
 * **这是 G4 的 `ReplayDriver` 的唯一开局入口**（本阶段不实现重放）：
 * 五个确定性输入（seed / draftStarter / firstToPlay / draftMode / draftPool）一个不少 —— §2.5。
 * 未知 defId **抛错**而不是跳过：静默跳过会让重放从第一步就与档案错位。
 */
export function matchFileToCreateOptions(f: MatchFile): CreateGameOptions {
  const draftPool = f.setup.draftPool.map((defId) => {
    try {
      return getProtocolDef(defId);
    } catch {
      throw new Error(`档案里的协议 defId 在本机不存在：${defId}（卡牌数据版本不一致？）`);
    }
  });
  return {
    seed: f.seed,
    draftStarter: f.setup.draftStarter,
    firstToPlay: f.setup.firstToPlay,
    draftMode: f.setup.draftMode,
    draftPool,
  };
}

/** 从 `GameState` 抽取 setup（顺序快照逐项照录；返回纯拷贝，不回指原数组） */
export function setupFromState(s: {
  draftMode: 'normal' | 'ban';
  draftStarter: PlayerId;
  firstToPlay: PlayerId;
  draftPool: { defId: string }[];
  draftPicks: { defId: string }[];
  bannedProtocols: string[];
}): MatchFileSetup {
  return {
    draftMode: s.draftMode,
    draftStarter: s.draftStarter,
    firstToPlay: s.firstToPlay,
    draftPool: s.draftPool.map((p) => p.defId),
    draftPicks: s.draftPicks.map((p) => p.defId),
    bannedProtocols: [...s.bannedProtocols],
  };
}

/* ------------------------------------------------------------------ *
 * 记录器（内存；G4 接进 driver 后即成为"联机传输内容/重连凭据"）
 * ------------------------------------------------------------------ */

export interface MatchFileMeta {
  seed: string;
  setup: MatchFileSetup;
  players: [{ nick: string }, { nick: string }];
  cardDataHash: string;
  createdAt: string;
  result?: { winner: PlayerId | null; reason: string };
}

export interface MatchFileRecorder {
  /** 下一个可用 seq（**只读**：不推进） */
  nextSeq(): number;
  /** 记录一条"正经产生"的操作（玩家点出来的 / 会话层合成的） */
  record(a: Omit<ActionRecord, 'seq'>): void;
  /**
   * 记录一条**旁路**操作（诊断/开发者模式）。它**不进 actions** —— 进了会让重放出来的
   * 对局与真实对局不同（`main.ts` 有直呼 `executeAction` 的旁路：devmode 加牌、效果内重排
   * 提交等）。但**必须留痕**（`noted()`），否则"档案为什么复现不出来"会变成无法调试的问题。
   */
  note(a: Omit<ActionRecord, 'seq'>): void;
  noted(): readonly ActionRecord[];
  actions(): readonly ActionRecord[];
  clear(): void;
  toMatchFile(meta: MatchFileMeta): MatchFile;
}

/** 内存记录器（**零浏览器 API**：游客模式下这就是唯一的档案载体） */
export function createMatchFileRecorder(): MatchFileRecorder {
  const list: ActionRecord[] = [];
  const notes: ActionRecord[] = [];
  return {
    nextSeq: () => list.length,
    record(a) {
      list.push(normalizeAction({ ...a, seq: list.length }));
    },
    note(a) {
      notes.push(normalizeAction({ ...a, seq: notes.length }));
    },
    noted: () => notes.map(normalizeAction),
    actions: () => list.map(normalizeAction),
    clear() {
      list.length = 0;
      notes.length = 0;
    },
    toMatchFile(meta) {
      return canonicalMatchFile({
        format: MATCH_FILE_FORMAT,
        version: MATCH_FILE_VERSION,
        cardDataHash: meta.cardDataHash,
        seed: meta.seed,
        setup: meta.setup,
        players: meta.players,
        actions: list.slice(),
        ...(meta.result ? { result: meta.result } : {}),
        createdAt: meta.createdAt,
      });
    },
  };
}
