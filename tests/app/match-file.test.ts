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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../ui/source-text';

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

  it('stringify 对**键序不同但内容等价**的 args 产出相同字节（联机传输要比字节）', () => {
    // 评审实测的瑕疵：`JSON.stringify` 保留 args 的键序 ⇒ 等价对象得到不同字节却同指纹。
    // 档案的"联机传输内容/断线重连凭据"两个用途（§3.2）会直接比字节，故必须稳定序列化。
    const a: MatchFile = {
      ...sample(),
      actions: [{ seq: 0, player: 0, kind: 'play', args: { cardUid: 'c1', faceUp: true, line: 2 }, via: 'user' }],
    };
    const b: MatchFile = {
      ...sample(),
      actions: [{ seq: 0, player: 0, kind: 'play', args: { line: 2, faceUp: true, cardUid: 'c1' }, via: 'user' }],
    };
    expect(stringifyMatchFile(a)).toBe(stringifyMatchFile(b));
    expect(matchFileFingerprint(a)).toBe(matchFileFingerprint(b));
    // 稳定序列化仍必须是**合法 JSON**（否则 G4/G5 的 JSON.parse 通路会当场炸）
    const parsed = JSON.parse(stringifyMatchFile(a)) as Record<string, unknown>;
    expect(parsed.format).toBe('compile-match');
    expect((parsed.actions as { args: Record<string, unknown> }[])[0].args).toEqual({
      cardUid: 'c1',
      faceUp: true,
      line: 2,
    });
    // 反向：内容真的不同时字节必须不同（否则"相同字节"只是"什么都没序列化"）
    const c: MatchFile = {
      ...sample(),
      actions: [{ seq: 0, player: 0, kind: 'play', args: { cardUid: 'c2', faceUp: true, line: 2 }, via: 'user' }],
    };
    expect(stringifyMatchFile(a)).not.toBe(stringifyMatchFile(c));
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
      // **类型错**（不是数值越界）：数字座位字段收到字符串。宽松的 `==` 或 `Number(v)` 式校验
      // 会把它们放行，而 `'1' !== 1` 在引擎里会让 `s.players['1']` 变成 undefined。
      { draftStarter: '1' },
      { firstToPlay: '0' },
      { draftPool: 'water' },
      { draftPool: [1, 2] },
      { draftPicks: {} },
      { bannedProtocols: [null] },
      // clock：每项必须是**数字**。⚠️ 这里只喂 JSON 通路**造得出来**的坏值
      // （`null` / 字符串 / 布尔 / 数组 / 缺字段）—— JSON 里不存在 NaN/Infinity，
      // 硬造一条 NaN 腿会变成新的假守卫（见 `match-file.ts` 的 `isClockSeconds` 注释）。
      { clock: { decisionSec: '60', draftSec: 30, maxSkips: 2 } },
      { clock: { decisionSec: 60, draftSec: '30', maxSkips: 2 } },
      { clock: { decisionSec: 60, draftSec: 30, maxSkips: null } },
      { clock: { decisionSec: null, draftSec: 30, maxSkips: 2 } },
      { clock: { decisionSec: 60, draftSec: true, maxSkips: 2 } },
      { clock: { decisionSec: 60, draftSec: 30, maxSkips: [] } },
      { clock: { decisionSec: 60, draftSec: 30 } },
      { clock: 7 },
      { clock: '60' },
      { clock: null },
      { clock: true },
      { clock: [] },
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

  it('clock 的三项时长各自必须是非 null 数字，且消息点名是哪个字段（判据仍有牙齿）', () => {
    // 阶段二复审：`Number.isFinite` 在 JSON 通路上是**死判据**（JSON 造不出 NaN/Infinity），
    // 已降级为 `typeof === 'number'`。这条腿的作用是证明"降级后判据仍有牙齿"：
    // 它只喂**可达值**，并对每个字段逐个构造 —— 去掉类型检查任何一处都会当场红。
    for (const k of ['decisionSec', 'draftSec', 'maxSkips'] as const) {
      for (const bad of [null, '60', true, [], {}] as unknown[]) {
        const f = sample() as unknown as Record<string, unknown>;
        f.setup = { ...sample().setup, clock: { decisionSec: 60, draftSec: 30, maxSkips: 2, [k]: bad } };
        const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
        expect(r.ok, `clock.${k}=${JSON.stringify(bad)} 应被拒`).toBe(false);
        if (r.ok) continue;
        expect(r.error.code, `clock.${k}`).toBe('bad-shape');
        expect(r.error.message, `clock.${k} 的消息应点名字段`).toContain(`clock.${k}`);
      }
    }
    // 反向：三个字段都是数字时必须过，且**原样读回**（不是被规范化掉）
    const f = sample() as unknown as Record<string, unknown>;
    f.setup = { ...sample().setup, clock: { decisionSec: 60, draftSec: 30, maxSkips: 2 } };
    const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.setup.clock).toEqual({ decisionSec: 60, draftSec: 30, maxSkips: 2 });
    // JSON 通路的边界事实（写下来免得后人再造 NaN 腿）：`JSON.stringify(Infinity)` 产出 `null`，
    // 而 `JSON.parse('1e999')` 产出 `Infinity` —— **两个方向不对称**，后者由上面那条腿覆盖。
    expect(JSON.stringify({ x: Number.POSITIVE_INFINITY })).toBe('{"x":null}');
    expect(JSON.parse('1e999')).toBe(Infinity);
  });

  it('clock 的 1e999 / -1e999（真实 JSON 字面量）必须被拒：有限性判据不是死判据', () => {
    // 阶段二复审认为 `Number.isFinite` 是死判据（"JSON 造不出 NaN/Infinity"）——**该前提不成立**：
    // `JSON.parse('1e999')` 返回 `Infinity`（`typeof 'number'`、`Number.isFinite` false），
    // `-1e999` 返回 `-Infinity`。故一份**被手工改过的档案文本**能把非有限值送进校验函数，
    // `typeof v === 'number'` 会放行它。这条腿走的就是那条真实路径：把 `1e999` 作为
    // JSON **数字字面量**嵌进档案文本（不能用 `JSON.stringify` 拼，它会把 `Infinity` 写成 `null`）。
    const { clock } = { clock: { decisionSec: 60, draftSec: 30, maxSkips: 2 } };
    const good = JSON.stringify({ ...sample(), setup: { ...sample().setup, clock } });
    expect(JSON.parse('1e999')).toBe(Infinity);
    expect(JSON.parse('-1e999')).toBe(-Infinity);
    for (const [label, literal, expected] of [
      ['1e999', '1e999', Infinity],
      ['-1e999', '-1e999', -Infinity],
    ] as const) {
      for (const k of ['decisionSec', 'draftSec', 'maxSkips'] as const) {
        // 从**同一个对象**的序列化里取"原值文本"，避免手写数字对不上（`draftSec` 是 30 不是 60）
        const doc = good.replace(`"${k}":${clock[k]}`, `"${k}":${literal}`);
        // 反空转：拼接必须真的把那一段替换掉了，否则测的是原档案
        expect(doc, `${k} 的补丁没生效`).not.toBe(good);
        // 反空转：到达校验函数的值必须真的是非有限数（证明这条腿打的是有限性，不是别的）
        const reached = (JSON.parse(doc) as { setup: { clock: Record<string, number> } }).setup.clock[k];
        expect(Number.isFinite(reached), `${k} 到达值应是 ±Infinity（不是有限数）`).toBe(false);
        expect(reached).toEqual(expected);
        const r = parseMatchFile(doc, { currentHash: CARD_DATA_HASH });
        expect(r.ok, `clock.${k}=${label} 应被拒`).toBe(false);
        if (r.ok) continue;
        expect(r.error.code, `clock.${k}=${label}`).toBe('bad-shape');
        expect(r.error.message, `clock.${k}=${label}`).toContain(`clock.${k}`);
      }
    }
  });

  it('座位字段的类型错 → bad-shape，且消息点名是哪个字段（生成式：setup 两个 + players）', () => {
    // 变异 L：`isPlayerId` 若放宽成还接受字符串 '0'/'1'/'2'，这条腿与上面那条必须变红。
    const cases: [string, (f: Record<string, unknown>) => void][] = [
      ['setup.draftStarter', (f) => { (f.setup as Record<string, unknown>).draftStarter = '1'; }],
      ['setup.draftStarter', (f) => { (f.setup as Record<string, unknown>).draftStarter = '2'; }],
      ['setup.firstToPlay', (f) => { (f.setup as Record<string, unknown>).firstToPlay = '0'; }],
      ['setup.firstToPlay', (f) => { (f.setup as Record<string, unknown>).firstToPlay = true; }],
      ['setup.draftStarter', (f) => { (f.setup as Record<string, unknown>).draftStarter = null; }],
    ];
    for (const [field, patch] of cases) {
      const f = sample() as unknown as Record<string, unknown>;
      patch(f);
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `${field} 类型错应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, field).toBe('bad-shape');
      expect(r.error.message, `${field} 的消息应点名字段`).toContain(field);
    }
    // 对局记录里的 player 同样不许是字符串/布尔（`'1'` 是数字 1 的"近敌"，最容易被漏）
    for (const player of ['0', '1', '2', true, false, null] as unknown[]) {
      const f: MatchFile = { ...sample(), actions: [{ seq: 0, player: player as never, kind: 'advance' }] };
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `player=${JSON.stringify(player)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, `player=${JSON.stringify(player)}`).toBe('bad-action');
    }
    // 反向：0 / 1 必须过（否则上面全是"什么都被拒"）
    for (const player of [0, 1] as const) {
      const f: MatchFile = { ...sample(), actions: [{ seq: 0, player, kind: 'advance' }] };
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `player=${player} 应通过`).toBe(true);
    }
  });

  it('result 是可选字段，但给了就必须形状正确（winner 0/1/null，reason 字符串）', () => {
    const badResults: unknown[] = [
      { winner: 7, reason: 'x' },
      { winner: '1', reason: 'x' },
      { winner: true, reason: 'x' },
      { winner: undefined, reason: 'x' },
      { winner: 0, reason: 42 },
      { winner: 0 },
      { winner: 0, reason: null },
      '甲赢了',
      42,
    ];
    for (const result of badResults) {
      const f = sample() as unknown as Record<string, unknown>;
      f.result = result;
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `result=${JSON.stringify(result)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, JSON.stringify(result)).toBe('bad-shape');
    }
    // 反向：三种合法形态必须过 —— winner:null（流局）与 winner:0 都不是"缺字段"
    for (const result of [{ winner: null, reason: '流局' }, { winner: 0, reason: 'win' }, { winner: 1, reason: '' }]) {
      const f = sample() as unknown as Record<string, unknown>;
      f.result = result;
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `result=${JSON.stringify(result)} 应通过`).toBe(true);
      if (!r.ok) continue;
      expect(r.file.result).toEqual(result);
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

  it('seq 必须从 0 起连续单调（§3.1）：重复 seq / 回退 seq / 跳号都必须被拒', () => {
    const seqCases: [string, unknown[]][] = [
      ['两条都是 seq=5（重复且不从 0 起）', [{ seq: 5, player: 0, kind: 'advance' }, { seq: 5, player: 0, kind: 'advance' }]],
      ['回退 [0,1,0]', [
        { seq: 0, player: 0, kind: 'advance' },
        { seq: 1, player: 1, kind: 'advance' },
        { seq: 0, player: 0, kind: 'advance' },
      ]],
      ['连续重复 [0,0]', [{ seq: 0, player: 0, kind: 'advance' }, { seq: 0, player: 1, kind: 'advance' }]],
      ['跳号 [0,2]', [{ seq: 0, player: 0, kind: 'advance' }, { seq: 2, player: 1, kind: 'advance' }]],
      ['不从 0 起 [1,2]', [{ seq: 1, player: 0, kind: 'advance' }, { seq: 2, player: 1, kind: 'advance' }]],
      ['首条就是 3', [{ seq: 3, player: 0, kind: 'advance' }]],
    ];
    for (const [label, actions] of seqCases) {
      const f = sample() as unknown as Record<string, unknown>;
      f.actions = actions;
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `${label} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, label).toBe('bad-action');
      expect(r.error.message, label).toContain('seq');
    }
    // 反向：0..n-1 连续（记录器唯一会产出的形态）必须过
    const good = [0, 1, 2, 3].map((seq) => ({ seq, player: (seq % 2) as number, kind: 'advance' }));
    const f = sample() as unknown as Record<string, unknown>;
    f.actions = good;
    const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(r.ok, '连续 seq 必须通过').toBe(true);
    if (!r.ok) return;
    expect(r.file.actions.map((a) => a.seq)).toEqual([0, 1, 2, 3]);
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

  it('档案文本里的未知 via → parseMatchFile 必须 bad-action（校验路径不静默接受）', () => {
    // 这条腿与上面那条**不是**一回事：上面只证明 normalizeAction 在生产路径丢弃未知值，
    // 而档案是**外来输入**（对手发来的重连凭据 / 用户导入的文件）—— 它必须被拒，
    // 否则"读不懂的元数据"会被原样带进 G4 的重放链。
    for (const via of ['hacker', '', 'USER', 0, null] as unknown[]) {
      const f: MatchFile = { ...sample(), actions: [{ seq: 0, player: 0, kind: 'refresh', via: via as never }] };
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `via=${JSON.stringify(via)} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, `via=${JSON.stringify(via)}`).toBe('bad-action');
      expect(r.error.message).toContain('via');
    }
    // 反向：三个合法值都必须过（否则上面那条只是"什么 via 都被拒"）
    for (const via of ['user', 'timeout', 'ai'] as const) {
      const f: MatchFile = { ...sample(), actions: [{ seq: 0, player: 0, kind: 'refresh', via }] };
      const r = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
      expect(r.ok, `via=${via} 应通过`).toBe(true);
    }
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

  it('MatchFileErrorCode 里不留零调用的码（hash-mismatch-unknown 已删，G5 需要时随腿加回）', () => {
    // 文本腿：本仓纪律是"零调用的声明要删"。指纹不匹配是**警告**（§3.3 第 3 条），
    // 没有任何输入会走到"未知指纹"这个失败态，故 union 里不该留着它当空壳入口。
    // ⚠️ node 类型声明的**现行规则**（G3 Task 8 修复轮改的口径）：只加**有真实消费者**的最小声明
    // （`tests/node-types.d.ts` 现有的那批声明逐条必需 —— 阶段二复审逐条删掉都让 `tsc` 变红），
    // 并在该文件头部写明**唯一消费方**。早先"不许为这里扩 node 类型声明"的一刀切禁令**已收回**：
    // 它的依据不成立（`.d.ts` 影响不了 `scripts/*.mjs` 的运行时，而 `scripts/` 根本不进 `tsc`）。
    const src = readFileSync(fileURLToPath(new URL('../../src/app/match-file.ts', import.meta.url)))
      .subarray(0, 256 * 1024)
      .toString('utf8');
    // 文本腿按**值**查、且先 `stripComments`：实现里有一段专门解释"为什么删掉它"的注释，
    // 裸 `not.toContain` 会被那段注释假红（本轮实测踩到）。复用 `tests/ui/source-text.ts:29 stripComments`
    // —— 与仓内既有文本腿同一套判据（注释被替换成等长空白，字符串内容原样保留）。
    const code = stripComments(src);
    const codesOf = (text: string): string[] => {
      const decl = text.slice(text.indexOf('MatchFileErrorCode'));
      const body = decl.slice(decl.indexOf('=') + 1, decl.indexOf(';'));
      return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    };
    const codes = codesOf(code);
    // 反空转：解析出的码必须就是那 6 个已知码（否则下面的 `not.toContain` 只是"没解析到"）
    expect(codes.sort()).toEqual([
      'bad-action',
      'bad-shape',
      'bad-version-type',
      'not-a-match-file',
      'not-json',
      'too-new',
    ]);
    // 行为腿：这 6 个码必须**都真的可达**（防止"删了一个、又留了一个死码"）
    const seen: string[] = [];
    const push = (r: ReturnType<typeof parseMatchFile>): void => {
      if (!r.ok) seen.push(r.error.code);
    };
    push(parseMatchFile('{oops', { currentHash: CARD_DATA_HASH }));
    push(parseMatchFile('42', { currentHash: CARD_DATA_HASH }));
    push(parseMatchFile(JSON.stringify({ ...sample(), version: 999 }), { currentHash: CARD_DATA_HASH }));
    push(parseMatchFile(JSON.stringify({ ...sample(), version: 'x' }), { currentHash: CARD_DATA_HASH }));
    const noSeed = sample() as unknown as Record<string, unknown>;
    delete noSeed.seed;
    push(parseMatchFile(JSON.stringify(noSeed), { currentHash: CARD_DATA_HASH }));
    const badAct = sample() as unknown as Record<string, unknown>;
    badAct.actions = [{ seq: 0, player: 0, kind: 'compile', args: {} }];
    push(parseMatchFile(JSON.stringify(badAct), { currentHash: CARD_DATA_HASH }));
    expect([...new Set(seen)].sort()).toEqual([
      'bad-action',
      'bad-shape',
      'bad-version-type',
      'not-a-match-file',
      'not-json',
      'too-new',
    ]);
  });
});
