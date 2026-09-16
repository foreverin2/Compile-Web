import { describe, it, expect } from 'vitest';
import {
  MATCH_FILE_FORMAT,
  MATCH_FILE_VERSION,
  canonicalMatchFile,
  matchFileFingerprint,
  matchFileToCreateOptions,
  normalizeAction,
  parseMatchFile,
  setupFromState,
  stringifyMatchFile,
  type MatchFile,
} from '../../src/app/match-file';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { createGame } from '../../src/core/state/create';
import { stateFingerprint } from '../../src/core/fingerprint';

function sample(): MatchFile {
  return {
    format: 'compile-match',
    version: MATCH_FILE_VERSION,
    cardDataHash: CARD_DATA_HASH,
    seed: 'g3-test-seed',
    setup: {
      draftMode: 'normal',
      draftStarter: 0,
      firstToPlay: 1,
      draftPool: ['water', 'fire', 'light'],
      draftPicks: ['water', 'light', 'fire', 'water', 'light', 'fire'],
      bannedProtocols: [],
    },
    players: [{ nick: '甲' }, { nick: '乙' }],
    actions: [],
    createdAt: '2026-09-16T00:00:00.000Z',
  };
}

describe('MatchFile v1：序列化与往返', () => {
  it('stringify → parse 往返后，除 createdAt 外逐字段相同', () => {
    const f = sample();
    const r = parseMatchFile(stringifyMatchFile(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.format).toBe('compile-match');
    expect(r.file.version).toBe(1);
    expect(r.file.seed).toBe('g3-test-seed');
    expect(r.file.setup.draftPicks).toEqual(f.setup.draftPicks);
    expect(r.file.setup.bannedProtocols).toEqual([]);
    expect(r.file.players).toEqual([{ nick: '甲' }, { nick: '乙' }]);
  });

  it('指纹不看 createdAt（同一局导出两次指纹必须相同）', () => {
    const a = sample();
    const b: MatchFile = { ...sample(), createdAt: '2030-01-01T00:00:00.000Z' };
    expect(matchFileFingerprint(a)).toBe(matchFileFingerprint(b));
  });

  it('指纹对 actions 的任何一步不同敏感', () => {
    const a = sample();
    const b: MatchFile = { ...sample(), actions: [{ seq: 0, player: 1, kind: 'advance', via: 'user' }] };
    expect(matchFileFingerprint(a)).not.toBe(matchFileFingerprint(b));
  });

  it('canonicalMatchFile 幂等（规范化的规范化 = 规范化）', () => {
    const f = sample();
    expect(canonicalMatchFile(canonicalMatchFile(f))).toEqual(canonicalMatchFile(f));
  });

  it('canonical + stringify 不吃掉 result 与 clock（导出一次不能再丢数据）', () => {
    const f: MatchFile = {
      ...sample(),
      setup: { ...sample().setup, clock: { decisionSec: 60, draftSec: 30, maxSkips: 2 } },
      result: { winner: 1, reason: '对手协议全部编译' },
    };
    const back = parseMatchFile(stringifyMatchFile(f), { currentHash: CARD_DATA_HASH });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.file.setup.clock).toEqual({ decisionSec: 60, draftSec: 30, maxSkips: 2 });
    expect(back.file.result).toEqual({ winner: 1, reason: '对手协议全部编译' });
    // 指纹必须对 result 敏感：同一串操作、不同结局是两个不同的档案
    const noResult: MatchFile = { ...f, result: undefined };
    expect(matchFileFingerprint(f)).not.toBe(matchFileFingerprint(noResult));
  });

  it('stringify 是稳定序列化：同一局的两次导出字节相同', () => {
    const f = sample();
    expect(stringifyMatchFile(f)).toBe(stringifyMatchFile(canonicalMatchFile(f)));
  });
});

describe('MatchFile v1：版本与形状校验', () => {
  it('非 JSON → not-json', () => {
    const r = parseMatchFile('{oops', { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('not-json');
  });

  it('format 不对 → not-a-match-file', () => {
    const r = parseMatchFile(JSON.stringify({ format: 'other', version: 1 }), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('not-a-match-file');
  });

  it('顶层不是对象（JSON 合法）→ not-a-match-file，不抛', () => {
    for (const text of ['[]', '"text"', 'null', '42']) {
      const r = parseMatchFile(text, { currentHash: CARD_DATA_HASH });
      expect(r.ok, `输入 ${text} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('not-a-match-file');
    }
  });

  it('version 比当前新 → too-new，且**不尝试**加载（§3.3）', () => {
    const f = { ...sample(), version: 999 };
    const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('too-new');
    expect(r.error.message).toContain('更新版本');
  });

  it('version 不是整数 / 小于 1 → bad-version-type（v1 是首版，没有更早的版本）', () => {
    for (const v of ['1', 0, -1, 1.5, null, undefined] as unknown[]) {
      const r = parseMatchFile(JSON.stringify({ ...sample(), version: v }), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `version=${String(v)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, `version=${String(v)}`).toBe('bad-version-type');
    }
  });

  it('迁移链与版本号同步：手写的 v1 档案必须被当前版本直接读入（升版号必须同时补 MIGRATIONS）', () => {
    // 这条腿是**唯一**能抓"把 MATCH_FILE_VERSION 从 1 改成 2 而忘了写迁移"的判据：
    // 其它用 `MATCH_FILE_VERSION` 拼输入、又用 `MATCH_FILE_VERSION + 1` 拼未来的测试，
    // 会跟着版本号一起漂移，从而对这次升版完全不敏感（变异实测 M4 证实过）。
    const v1 = JSON.stringify({
      format: 'compile-match',
      version: 1,
      cardDataHash: CARD_DATA_HASH,
      seed: 'g3-v1-literal',
      setup: {
        draftMode: 'normal',
        draftStarter: 0,
        firstToPlay: 1,
        draftPool: ['water'],
        draftPicks: ['water'],
        bannedProtocols: [],
      },
      players: [{ nick: '甲' }, { nick: '乙' }],
      actions: [],
      createdAt: '2026-09-16T00:00:00.000Z',
    });
    const r = parseMatchFile(v1, { currentHash: CARD_DATA_HASH });
    expect(
      r.ok,
      `v1 档案读不进来：当前 MATCH_FILE_VERSION=${MATCH_FILE_VERSION}，但 MIGRATIONS 没有 v1→v2 的步骤`,
    ).toBe(true);
    if (!r.ok) {
      // 明确区分"缺迁移"（升版号没补表）与其它失败形态
      expect(r.error.message).not.toContain('缺少 v1');
      return;
    }
    expect(r.file.version).toBe(MATCH_FILE_VERSION);
    expect(r.file.seed).toBe('g3-v1-literal');
  });

  it('cardDataHash 不匹配 → 仍然 ok，但带一条警告（§3.3 第 3 条：警告并允许"仍要打开"）', () => {
    const r = parseMatchFile(JSON.stringify(sample()), { currentHash: 'deadbeefdeadbeef' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join('|')).toContain('卡牌数据');
    // 反向：匹配时**不许**有这条警告（否则警告变成噪音，用户会忽略真的警告）
    const ok = parseMatchFile(JSON.stringify(sample()), { currentHash: CARD_DATA_HASH });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.warnings.join('|')).not.toContain('卡牌数据');
  });

  it('缺 seed / setup / players / actions 中任一项 → bad-shape', () => {
    for (const drop of ['seed', 'setup', 'players', 'actions'] as const) {
      const o = sample() as unknown as Record<string, unknown>;
      delete o[drop];
      const r = parseMatchFile(JSON.stringify(o), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `缺 ${drop} 时应报错`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('bad-shape');
    }
  });

  it('setup / players 内部字段类型错 → bad-shape（逐个字段，生成式遍历）', () => {
    const bad: Record<string, unknown>[] = [
      { draftMode: 'chaos' },
      { draftStarter: 2 },
      { firstToPlay: -1 },
      { draftPool: 'water' },
      { draftPool: [1, 2] },
      { draftPicks: {} },
      { bannedProtocols: [null] },
      { clock: { decisionSec: '60', draftSec: 30, maxSkips: 2 } },
      { clock: 7 },
    ];
    for (const patch of bad) {
      const f = sample() as unknown as Record<string, unknown>;
      f.setup = { ...sample().setup, ...patch };
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `setup 补丁 ${JSON.stringify(patch)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, JSON.stringify(patch)).toBe('bad-shape');
    }
    for (const players of [[{ nick: '甲' }], [{ nick: 0 }, { nick: '乙' }], 'ab', []] as unknown[]) {
      const f = sample() as unknown as Record<string, unknown>;
      f.players = players;
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `players=${JSON.stringify(players)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('bad-shape');
    }
  });

  it('单条 action 的 args 形状不对 → bad-action（不是静默吞掉）', () => {
    const f: MatchFile = { ...sample(), actions: [{ seq: 0, player: 0, kind: 'compile', args: {} }] };
    const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('bad-action');
  });

  it('单条 action 的基础字段错 → bad-action（座位 / seq / kind 三类，生成式遍历）', () => {
    const badActions: unknown[] = [
      { seq: -1, player: 0, kind: 'advance' },
      { seq: 0.5, player: 0, kind: 'advance' },
      { seq: 0, player: 2, kind: 'advance' },
      { seq: 0, player: 0, kind: 'teleport' },
      { seq: 0, player: 0 },
      'advance',
      null,
    ];
    for (const a of badActions) {
      const f = sample() as unknown as Record<string, unknown>;
      f.actions = [a];
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `action=${JSON.stringify(a)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, JSON.stringify(a)).toBe('bad-action');
    }
  });

  it('缺 args 的带参 kind → bad-action（生成式：遍历五种带参 kind）', () => {
    const needArgs: [string, Record<string, unknown>][] = [
      ['play', { cardUid: 'c1', faceUp: true }],
      ['compile', { line: 1 }],
      ['effect-choice', { promptId: 'p1', choice: [] }],
      ['resolve-trigger', { cardUid: 'c1' }],
      ['rearrange-protocols', { target: 0, a: 0, b: 1 }],
    ];
    for (const [kind] of needArgs) {
      const f = sample() as unknown as Record<string, unknown>;
      f.actions = [{ seq: 0, player: 0, kind }];
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `kind=${kind} 缺 args 应报错`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, `kind=${kind}`).toBe('bad-action');
    }
    // 反向：带全 args 的同样五种 kind 必须**过**（否则上面那条只是"什么都被拒"）
    for (const [kind, args] of needArgs) {
      const f = sample() as unknown as Record<string, unknown>;
      f.actions = [{ seq: 0, player: 0, kind, args }];
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `kind=${kind} 带全 args 应通过`).toBe(true);
    }
  });

  it('refresh/advance/clear-cache 带 args → bad-action（生成式：遍历三种无参 kind）', () => {
    for (const kind of ['refresh', 'advance', 'clear-cache'] as const) {
      const f: MatchFile = { ...sample(), actions: [{ seq: 0, player: 0, kind, args: { line: 0 } }] };
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `kind=${kind} 带 args 应报错`).toBe(false);
    }
  });

  it('actions 不是数组 → bad-shape', () => {
    const f = sample() as unknown as Record<string, unknown>;
    f.actions = { 0: 'advance' };
    const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('bad-shape');
  });

  it('错误消息带定位信息（第 N 条操作），不吞掉上下文', () => {
    const f: MatchFile = {
      ...sample(),
      actions: [
        { seq: 0, player: 0, kind: 'advance' },
        { seq: 1, player: 1, kind: 'compile', args: {} },
      ],
    };
    const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('第 1 条');
  });
});

describe('MatchFile v1：via 与引擎状态分离', () => {
  it('normalizeAction 保留 via，但绝不把它塞进 args', () => {
    const a = normalizeAction({ seq: 3, player: 1, kind: 'refresh', via: 'timeout' });
    expect(a.via).toBe('timeout');
    expect(a.args).toBeUndefined();
  });

  it('未知 via 值被丢弃（不写进档案）', () => {
    const a = normalizeAction({ seq: 0, player: 0, kind: 'refresh', via: 'hacker' as never });
    expect(a.via).toBeUndefined();
  });

  it('normalizeAction 把 args 原样透传（重放靠它，不许改写）', () => {
    const a = normalizeAction({
      seq: 7,
      player: 1,
      kind: 'rearrange-protocols',
      args: { target: 0, a: 2, b: 0 },
      via: 'user',
    });
    expect(a.args).toEqual({ target: 0, a: 2, b: 0 });
    expect(a.seq).toBe(7);
    expect(a.player).toBe(1);
    expect(a.kind).toBe('rearrange-protocols');
  });

  it('通过 JSON 往返的档案不因 normalizeAction 丢 args / 丢 via', () => {
    const f: MatchFile = {
      ...sample(),
      actions: [
        { seq: 0, player: 0, kind: 'play', args: { cardUid: 'c7', faceUp: false, line: 2 }, via: 'ai' },
        { seq: 1, player: 1, kind: 'advance', via: 'timeout' },
      ],
    };
    const r = parseMatchFile(stringifyMatchFile(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.actions).toEqual(f.actions);
  });
});

describe('MatchFile → createGame 的开局映射', () => {
  it('五个确定性输入一个不少地映射过去（§2.5）', () => {
    const f = sample();
    const o = matchFileToCreateOptions(f);
    expect(o.seed).toBe('g3-test-seed');
    expect(o.draftStarter).toBe(0);
    expect(o.firstToPlay).toBe(1);
    expect(o.draftMode).toBe('normal');
    expect(o.draftPool?.map((p) => p.defId)).toEqual(['water', 'fire', 'light']);
  });

  it('映射出的 draftPool 是真实 ProtocolDef（不是字符串）', () => {
    const s = createGame(matchFileToCreateOptions(sample()));
    expect(s.draftPool.map((p) => p.defId)).toEqual(['water', 'fire', 'light']);
    expect(s.rng.seed).toBe('g3-test-seed');
    expect(stateFingerprint(s)).toBe(stateFingerprint(createGame(matchFileToCreateOptions(sample()))));
  });

  it('往返后的档案映射出的开局，与原始档案映射出的开局指纹一致', () => {
    const f = sample();
    const back = parseMatchFile(stringifyMatchFile(f), { currentHash: CARD_DATA_HASH });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(stateFingerprint(createGame(matchFileToCreateOptions(back.file)))).toBe(
      stateFingerprint(createGame(matchFileToCreateOptions(f))),
    );
  });

  it('未知 defId → 抛错并把 defId 写进消息（不静默丢弃，否则重放会悄悄错位）', () => {
    const f = sample();
    f.setup.draftPool = ['water', 'no-such-protocol'];
    expect(() => matchFileToCreateOptions(f)).toThrow(/no-such-protocol/);
  });

  it('setupFromState 从 GameState 抽取时，顺序快照逐项照录', () => {
    const s = createGame({ seed: 'x', draftStarter: 1, firstToPlay: 0, draftMode: 'ban' });
    s.draftPicks = [{ defId: 'a' } as never, { defId: 'b' } as never];
    s.bannedProtocols = ['c', 'd'];
    const setup = setupFromState(s);
    expect(setup.draftStarter).toBe(1);
    expect(setup.firstToPlay).toBe(0);
    expect(setup.draftMode).toBe('ban');
    expect(setup.draftPicks).toEqual(['a', 'b']);
    expect(setup.bannedProtocols).toEqual(['c', 'd']);
  });

  it('setupFromState 是纯拷贝：改返回值不污染 GameState 数组', () => {
    const s = createGame({ seed: 'x' });
    s.draftPool = [{ defId: 'water' } as never];
    s.draftPicks = [{ defId: 'water' } as never];
    s.bannedProtocols = ['fire'];
    const setup = setupFromState(s);
    setup.draftPool.push('污染');
    setup.draftPicks.push('污染');
    setup.bannedProtocols.push('污染');
    expect(s.bannedProtocols).toEqual(['fire']);
    expect(s.draftPicks.map((p) => p.defId)).toEqual(['water']);
    expect(s.draftPool.map((p) => p.defId)).toEqual(['water']);
  });
});

describe('MatchFile v1：常量与导出面', () => {
  it('格式串与版本号是设计稿 §3.1 钉死的值', () => {
    expect(MATCH_FILE_FORMAT).toBe('compile-match');
    expect(MATCH_FILE_VERSION).toBe(1);
    const f = sample();
    const c = canonicalMatchFile(f);
    expect(c.format).toBe(MATCH_FILE_FORMAT);
    expect(c.version).toBe(MATCH_FILE_VERSION);
  });

  it('canonicalMatchFile 不接受被篡改的 format/version（规范化即校正到当前格式）', () => {
    const bad = sample() as unknown as Record<string, unknown>;
    bad.format = 'other';
    bad.version = 9;
    const c = canonicalMatchFile(bad as unknown as MatchFile);
    expect(c.format).toBe(MATCH_FILE_FORMAT);
    expect(c.version).toBe(MATCH_FILE_VERSION);
  });

  it('canonicalMatchFile 深拷贝 setup 数组（改规范化结果不污染原档案）', () => {
    const f = sample();
    const c = canonicalMatchFile(f);
    c.setup.draftPool.push('污染');
    c.setup.draftPicks.push('污染');
    c.setup.bannedProtocols.push('污染');
    c.players[0].nick = '污染';
    expect(f.setup.draftPool).toEqual(['water', 'fire', 'light']);
    expect(f.setup.draftPicks).toHaveLength(6);
    expect(f.setup.bannedProtocols).toEqual([]);
    expect(f.players[0].nick).toBe('甲');
  });
});
