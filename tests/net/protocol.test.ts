import { describe, it, expect } from 'vitest';
import {
  PROTO_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CHANNEL_PREFIX,
  ROOM_CODE_LENGTH,
  decodeMsg,
  encodeMsg,
  normalizeRoomCode,
  roomChannel,
  roomCodeFromBytes,
  roomCodeFromRandom,
  validateHello,
} from '../../src/net/protocol';
import type { HelloContext, HelloMsg, NetMsg } from '../../src/net/protocol';

/**
 * G5 T1 行为腿（计划 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T1 的五条验收判据）。
 *
 * 本文件**不扫源码**（那是 `tests/net/net-purity.test.ts` 的事），只喂输入看输出。
 * 判据 4（定时器零命中）按计划要求是"生成式"的，所以由那份守卫承担，这里只做锚点核对
 * （见最后一条 `it`：它证明"判据 4 住在守卫里、且守卫真的在扫 `src/net`"）。
 *
 * ## 为什么不写"输入 → 期望字符串"的逐字断言
 *
 * 文案（`message`）会随改动优化，而**理由码**（`reason`）是契约。所以这里断言的是
 * （a）`reason` 逐条正确、（b）四句 `message` **互不相同**（判据 3 的原文是"互不相同的可读原因"，
 * 只断言 `reason` 不同会漏掉"四句话写成同一句"这个形态）。
 */

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const LOCAL_HASH = 'hash-A';

/** 每个字段都有值、必然通过四条校验的 `hello`（各条腿从它出发只改一处） */
function hello(over: Partial<HelloMsg> = {}): HelloMsg {
  return {
    t: 'hello',
    role: 'player',
    sessionId: 's-1',
    protoVersion: PROTO_VERSION,
    cardDataHash: LOCAL_HASH,
    seat: 1,
    nick: 'guest',
    ...over,
  };
}

/** 空房间、本机版本与指纹与夹具一致 */
function ctx(over: Partial<HelloContext> = {}): HelloContext {
  return {
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: LOCAL_HASH,
    occupied: { players: [], spectators: [] },
    ...over,
  };
}

/** 一条确定性的伪随机源（线性同余，只为"每次跑一样"；**不是**密码学随机，也不被测模块关心） */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * "不抛"这件事的**可断言形态**：把异常抓成返回值。
 *
 * 为什么不用 `expect(() => { r = f(); }).not.toThrow()`：`r` 是被赋值的变量，
 * 闭包里的 `r!` 不会让 TS 收窄（实测 TS2339：`reason` 不存在于成功分支上）——
 * 那种写法要么加一层 `as`，要么把断言写成"恒真"。这里换成结果对象，两边都干净。
 */
function caught<T>(f: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: f() };
  } catch (error) {
    return { ok: false, error };
  }
}

/* ------------------------------------------------------------------ *
 * 判据 1：校验顺序（D13）
 * ------------------------------------------------------------------ */

describe('判据 1：validateHello 的校验顺序照设计稿 1→4，且顺序靠前的先报', () => {
  it('四条校验各有一条腿（每条只违反一条，回它自己的理由码）', () => {
    // 1. protoVersion
    const r1 = validateHello(hello({ protoVersion: PROTO_VERSION + 1 }), ctx());
    expect(r1.ok, '版本不符必须被拒').toBe(false);
    expect(r1.ok === false && r1.reason).toBe('proto-version');

    // 2. cardDataHash
    const r2 = validateHello(hello({ cardDataHash: 'hash-B' }), ctx());
    expect(r2.ok, '卡牌指纹不符必须被拒').toBe(false);
    expect(r2.ok === false && r2.reason).toBe('card-data-hash');

    // 3. 玩家位已满（观战位空着）
    const r3 = validateHello(hello({ role: 'player' }), ctx({ occupied: { players: [0, 1], spectators: [] } }));
    expect(r3.ok, '玩家位已满必须被拒').toBe(false);
    expect(r3.ok === false && r3.reason).toBe('player-slots-full');

    // 4. 观战位已满（玩家位空着 ⇒ 只能由第 4 条拒）
    const r4 = validateHello(hello({ role: 'spectator' }), ctx({ occupied: { players: [], spectators: [0, 1] } }));
    expect(r4.ok, '观战位已满必须被拒').toBe(false);
    expect(r4.ok === false && r4.reason).toBe('spectator-slots-full');
  });

  it('四条的可读原因**互不相同**（只断言 reason 不同会漏掉"四句话写成同一句"）', () => {
    const msgs = [
      validateHello(hello({ protoVersion: 999 }), ctx()),
      validateHello(hello({ cardDataHash: 'x' }), ctx()),
      validateHello(hello(), ctx({ occupied: { players: [0, 1], spectators: [] } })),
      validateHello(hello({ role: 'spectator' }), ctx({ occupied: { players: [], spectators: [0, 1] } })),
    ].map((r) => (r.ok ? '' : r.message));
    expect(msgs.every((m) => m.length > 0), '有理由没有文案').toBe(true);
    expect(new Set(msgs).size, `四条理由的文案有重复：${JSON.stringify(msgs)}`).toBe(4);
  });

  it('★ 同时违反两条时，回**靠前**那条（四条两两组合全试一遍）', () => {
    // 这是判据 1 的核心腿。顺序 = 版本 → 指纹 → 玩家位 → 观战位。
    // 每一条"更靠前"的违反都配一个"更靠后"的违反，断言回的是前者。
    const fails = {
      'proto-version': { bad: hello({ protoVersion: PROTO_VERSION + 1 }), c: ctx({ occupied: { players: [0, 1], spectators: [0, 1] } }) },
      'card-data-hash': { bad: hello({ cardDataHash: 'hash-B' }), c: ctx({ occupied: { players: [0, 1], spectators: [0, 1] } }) },
      'player-slots-full': { bad: hello({ role: 'player' }), c: ctx({ occupied: { players: [0, 1], spectators: [0, 1] } }) },
    } as const;
    // 版本 vs 指纹/玩家位：回版本
    expect(validateHello(hello({ protoVersion: 999, cardDataHash: 'hash-B' }), ctx())).toMatchObject({
      ok: false,
      reason: 'proto-version',
    });
    expect(validateHello(hello({ protoVersion: 999 }), fails['player-slots-full'].c)).toMatchObject({
      ok: false,
      reason: 'proto-version',
    });
    // 指纹 vs 玩家位：回指纹（这一对最容易写反：位满是"换个房间"能解决的，指纹不是）
    expect(validateHello(hello({ cardDataHash: 'hash-B' }), fails['player-slots-full'].c)).toMatchObject({
      ok: false,
      reason: 'card-data-hash',
    });
    // 指纹 vs 观战位：回指纹
    expect(
      validateHello(hello({ role: 'spectator', cardDataHash: 'hash-B' }), ctx({ occupied: { players: [], spectators: [0, 1] } })),
    ).toMatchObject({ ok: false, reason: 'card-data-hash' });
    // 玩家位 vs 观战位：两个位都满时，`role: 'player'` 回玩家位满
    expect(validateHello(hello({ role: 'player' }), fails['player-slots-full'].c)).toMatchObject({
      ok: false,
      reason: 'player-slots-full',
    });
  });

  it('形状不合格**不伪装**成四条里的任何一条（它排在四条之前，理由见 HelloValidationReason）', () => {
    for (const bad of [null, 42, 'hello', {}, { t: 'bye', reason: 'leave' }, hello({ seat: 7 as never })]) {
      const r = validateHello(bad, ctx({ occupied: { players: [0, 1], spectators: [0, 1] } }));
      expect(r.ok, `垃圾输入被判成合法：${JSON.stringify(bad)}`).toBe(false);
      expect(r.ok === false && r.reason, `垃圾输入伪装成了业务拒绝：${JSON.stringify(bad)}`).toBe('bad-shape');
    }
  });

  it('全部合法时通过，并给出**主机替加入方定的座位**', () => {
    const r = validateHello(hello({ seat: 1 }), ctx({ seat: 1, occupied: { players: [0], spectators: [] } }));
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.seat).toBe(1);
    expect(r.ok === true && r.msg.nick).toBe('guest');
    // 判据 1 的输入是**形状合法**的 hello：这条腿顺手证明夹具本身穿得过四条
    // （否则上面那些"被拒"的腿可能只是因为夹具坏了 —— 那是本仓出现过的一族假绿）
  });

  it('resuming 是可选字段：缺省与显式 false 都通过（重连那支属 T6，这里只管形状）', () => {
    expect(validateHello(hello(), ctx()).ok).toBe(true);
    expect(validateHello(hello({ resuming: false }), ctx()).ok).toBe(true);
    expect(validateHello(hello({ resuming: true }), ctx()).ok).toBe(true);
  });

  it('★ 座位优先级：`ctx.seat` 赢过 `msg.seat`（两个值必须不同，否则优先级不可观测）', () => {
    // 阶段一评审 N-4：原先唯一同时出现两者的用例里 `ctx.seat === msg.seat === 1`，
    // 于是写成 `msg.seat ?? ctx.seat` 也全绿。⇒ 一对负向腿，两个值**不同**。
    const hostAssigns = validateHello(hello({ seat: 0 }), ctx({ seat: 1, occupied: { players: [0], spectators: [] } }));
    expect(hostAssigns.ok, '主机分配座位时应当通过').toBe(true);
    expect(hostAssigns.ok === true && hostAssigns.seat, 'ctx.seat 没有赢过 msg.seat（优先级写反了？）').toBe(1);

    // 反向 1：主机没有分配（缺省）时退回对端自报的值 —— 这条同时证明上一条不是"恒回 1"
    const selfReported = validateHello(hello({ seat: 0 }), ctx({ occupied: { players: [1], spectators: [] } }));
    expect(selfReported.ok).toBe(true);
    expect(selfReported.ok === true && selfReported.seat, 'ctx.seat 缺省时没有退回 msg.seat').toBe(0);

    // 反向 2：对端自报 1、主机不分配 ⇒ 回 1（排除"恒回 0"）
    const selfOne = validateHello(hello({ seat: 1 }), ctx({ occupied: { players: [0], spectators: [] } }));
    expect(selfOne.ok === true && selfOne.seat).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 2：房间码（D12）
 * ------------------------------------------------------------------ */

describe('判据 2：房间码 = 6 位 Crockford Base32 剔除 I/L/O/U', () => {
  it('字符表恰为 "0-9 + A-Z 去掉 I/L/O/U"，共 32 个、互不相同', () => {
    const expected = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => !'ILOU'.includes(c)).join('');
    expect(ROOM_CODE_ALPHABET).toBe(expected); // 逐字相等：顺序变了也是契约变更（码会全变）
    expect(ROOM_CODE_ALPHABET.length).toBe(32);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
    for (const c of 'ILOU') expect(ROOM_CODE_ALPHABET.includes(c), `字符表里还有 ${c}`).toBe(false);
    expect(ROOM_CODE_LENGTH).toBe(6);
  });

  it('输出恒 6 位，且每一位都在字符表内（用一个确定性的伪随机序列跑 200 次）', () => {
    const rnd = seeded(20260917);
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = roomCodeFromRandom(rnd);
      expect(code.length, `第 ${i} 个码不是 6 位：${code}`).toBe(6);
      for (const ch of code) expect(ROOM_CODE_ALPHABET.includes(ch), `码里出现表外字符 ${ch}`).toBe(true);
      codes.add(code);
    }
    // 200 次抽 6 位，撞码概率极低；这条不是随机性检验，只是防"生成器退化成一个常量"。
    expect(codes.size, '200 次生成只得到极少数不同的码（生成器退化了？）').toBeGreaterThan(150);
  });

  it('随机源被逐位消费（32 个等分点各自映射到字符表的一位）', () => {
    // 这条腿把"注入的随机源真的被用了"变成机械事实：喂 i/32 就该拿到第 i 个字符。
    for (let i = 0; i < 32; i += 1) {
      const code = roomCodeFromRandom(() => i / 32);
      expect(code, `i=${i} 的六位应当全是字符表第 ${i} 位`).toBe(ROOM_CODE_ALPHABET[i].repeat(6));
    }
  });

  it('随机源越界时**响亮抛错**（不静默夹紧成偏斜的码）', () => {
    for (const v of [-0.001, 1, 1.5, NaN]) {
      expect(() => roomCodeFromRandom(() => v), `越界值 ${v} 被静默接受了`).toThrow(/越界/);
    }
    // 阶段一评审 N-6：不传随机源时 `randomness()` 抛的是 TypeError，不是那条例外的 Error。
    // 这里只断言"会抛"（形态），不钉具体文案 —— 未定义行为的具体错误类型不是契约。
    expect(() => roomCodeFromRandom(undefined as never), '不传随机源时居然没抛').toThrow();
  });

  it('roomCodeFromBytes：字节不足给失败结果（不抛），足够时也是 6 位且无取模偏斜', () => {
    expect(roomCodeFromBytes(new Uint8Array([1, 2, 3, 4, 5])).ok).toBe(false);
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    const code = roomCodeFromBytes(all);
    expect(code.ok).toBe(true);
    expect(code.ok === true && code.code).toBe(ROOM_CODE_ALPHABET.repeat(8).slice(0, 6));
    // 256 % 32 === 0 ⇒ 每个字符被抽到的次数相等（没有取模偏斜）。这条断言把那个前提钉住。
    expect(256 % ROOM_CODE_ALPHABET.length).toBe(0);
  });

  it('★ normalizeRoomCode 对 I/L/O/U **明确拒绝**，不静默映射成 1/1/0/0', () => {
    // 静默映射的后果是可证的：`K7M2QI` 与 `K7M2Q1` 会指向同一个频道，而玩家以为在另一局。
    for (const ch of 'ILOU') {
      const r = normalizeRoomCode(`K7M2Q${ch}`);
      expect(r.ok, `含 ${ch} 的码被接受了`).toBe(false);
      expect(r.ok === false && r.reason, `含 ${ch} 的码理由码不对`).toBe('ambiguous-char');
      expect(r.ok === false && r.message.includes(ch), `含 ${ch} 的理由没点名那个字符`).toBe(true);
    }
    // 小写同样拒绝（大小写先归一再判，不能靠"小写不认识"绕过）
    for (const ch of 'ilou') {
      expect(normalizeRoomCode(`K7M2Q${ch}`).ok, `含 ${ch} 的码被接受了`).toBe(false);
    }
    // 反向：把混淆字符换成合法字符的码必须**照常通过**（否则可能整条都在报错式假绿）
    expect(normalizeRoomCode('K7M2Q1').ok).toBe(true);
  });

  it('大小写归一，且归一后的结果恒为大写 6 位', () => {
    const r = normalizeRoomCode('k7m2qx');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.code).toBe('K7M2QX');
    // 混合大小写、以及本来就是大写 —— 三种写法归一到同一个码
    const mixed = normalizeRoomCode('K7m2Qx');
    expect(mixed.ok === true ? mixed.code : null).toBe('K7M2QX');
    const upper = normalizeRoomCode('K7M2QX');
    expect(upper.ok === true ? upper.code : null).toBe('K7M2QX');
  });

  it('长度不是 6 位 / 出现表外字符 ⇒ bad-charset（不宽容地"去掉空格再试"）', () => {
    for (const bad of ['K7M2Q', 'K7M2QXX', '', 'K7M2Q-', 'K7 M2Q', 'K7M2Q中', 'K7M2Q!']) {
      const r = normalizeRoomCode(bad);
      expect(r.ok, `非法码 ${JSON.stringify(bad)} 被接受了`).toBe(false);
      expect(r.ok === false && r.reason, `非法码 ${JSON.stringify(bad)} 的理由码不对`).toBe('bad-charset');
    }
  });

  it('roomChannel：合法码拼出 compile-v1/<码>，非法码不拼（不把非法码带进频道名）', () => {
    const r = roomChannel('k7m2qx');
    expect(r.ok).toBe(true);
    expect(r.channel).toBe(`${ROOM_CHANNEL_PREFIX}K7M2QX`);
    const bad = roomChannel('K7M2QI');
    expect(bad.ok).toBe(false);
    expect(bad.channel, '非法码居然拼出了频道名').toBeUndefined();
  });

  it('★ 频道不碰撞：不同输入不许落进同一个频道（判据 2 的**最终**事实，不只是"拒绝"）', () => {
    // 阶段一评审 N-5：上面那条钉的是"拒绝"这个**中间**事实。真正要防的是
    // "两个不同的码指向同一个频道，而玩家以为在另一局"。这里把最终事实写成断言：
    // 把归一化结果（或频道名）当"落点"，任何两个**不同的输入**都不许有同一个落点。
    const landing = (input: string): string | null => {
      const n = normalizeRoomCode(input);
      return n.ok ? n.code : null;
    };
    // 每一对都是"人眼看不清、但确实不同"的输入：易混字符 vs 数字、大小写变体、表外字符
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['K7M2QI', 'K7M2Q1'],
      ['K7M2Q1', 'K7M2QI'],
      ['K7M2QL', 'K7M2Q1'],
      ['K7M2QO', 'K7M2Q0'],
      ['K7M2QU', 'K7M2QV'],
      ['K7M2Q1', 'K7M2Q1 '],
      ['K7M2Q1', 'K7M2Q1-'],
      ['k7m2q1', 'K7M2QN'],
    ];
    for (const [a, b] of pairs) {
      const la = landing(a);
      const lb = landing(b);
      // 合法的那一侧必须真的能落到某个频道（否则"不碰撞"可能是"两个都非法"落空）
      if (la !== null) expect(la, `合法输入 ${a} 没有落点`).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
      // 核心断言：不同输入 ⇒ 不许同落点。**两个都合法**时才算碰撞；有一个非法则本就不该落。
      if (la !== null && lb !== null) {
        expect(la, `${JSON.stringify(a)} 与 ${JSON.stringify(b)} 落进了同一个频道（静默映射）`).not.toBe(lb);
      }
    }
    // 每个易混字符的输入都必须**没有落点**（这正是"不碰撞"的实现方式：拒绝而不是映射）
    for (const ch of 'ILOUilou') {
      expect(landing(`K7M2Q${ch}`), `含 ${ch} 的输入居然有了落点`).toBeNull();
    }
    // 正控：这条判据不是恒真 —— 把两个**真的相同**的输入放进同一个落点，落点必须相等
    expect(landing('K7M2Q1')).toBe(landing('k7m2q1'));
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3：decodeMsg 四种失败互不相同、且都不抛
 * ------------------------------------------------------------------ */

describe('判据 3：decodeMsg 的四种失败各有互不相同的理由，且都不抛', () => {
  it('截断 / 空串 / 非 JSON ⇒ not-json', () => {
    const full = encodeMsg(hello());
    expect(full.ok).toBe(true);
    const text = full.ok === true ? full.text : '';
    const truncated = text.slice(0, Math.max(1, Math.floor(text.length / 2)));
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['截断', truncated],
      ['空串', ''],
      ['纯文本', 'hello there'],
      ['半个 JSON 字面量', '{"t":"hello"'],
      ['未闭合的数组', '[1,2'],
      ['undefined', undefined],
      ['null 之外的非字符串', null],
    ];
    for (const [name, input] of cases) {
      const got = caught(() => decodeMsg(input));
      expect(got.ok, `${name} 抛异常了：${got.ok === false ? String(got.error) : ''}`).toBe(true);
      if (!got.ok) return;
      const r = got.value;
      expect(r.ok, `${name} 被判成合法`).toBe(false);
      expect(r.ok === false && r.reason, `${name} 的理由码不对`).toBe('not-json');
    }
  });

  it('合法 JSON 但顶层不是对象 / 缺 t ⇒ not-an-object', () => {
    for (const input of ['[1,2,3]', '"hello"', '42', '{}', '{"t":7}', '{"t":null}']) {
      const got = caught(() => decodeMsg(input));
      expect(got.ok, `${input} 抛异常了`).toBe(true);
      if (!got.ok) return;
      const r = got.value;
      expect(r.ok, `${input} 被判成合法`).toBe(false);
      expect(r.ok === false && r.reason, `${input} 的理由码不对`).toBe('not-an-object');
    }
  });

  it('★ 未知 t ⇒ unknown-type（含 toString 这类原型键，不许被 __proto__ 链蒙过去）', () => {
    for (const t of ['nope', 'HELLO', 'hello ', 'toString', 'hasOwnProperty', '__proto__', 'constructor', 'valueOf']) {
      const r = decodeMsg(JSON.stringify({ t }));
      expect(r.ok, `t=${t} 被判成合法消息`).toBe(false);
      expect(r.ok === false && r.reason, `t=${t} 的理由码不对`).toBe('unknown-type');
    }
  });

  it('t 认识但 protoVersion 不符 ⇒ proto-version（版本不符与"不认识"不是同一件事）', () => {
    const r = decodeMsg(JSON.stringify(hello({ protoVersion: PROTO_VERSION + 1 })));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('proto-version');
    // 本机版本可以从 opts 注入（生产用常量，测试用来造"对面更新了"的场景）
    const r2 = decodeMsg(JSON.stringify(hello()), { protoVersion: PROTO_VERSION + 1 });
    expect(r2.ok === false && r2.reason).toBe('proto-version');
  });

  it('四种理由码互不相同，四句文案也互不相同、且都非空', () => {
    const results = [
      decodeMsg('{'),
      decodeMsg('[]'),
      decodeMsg('{"t":"nope"}'),
      decodeMsg(JSON.stringify(hello({ protoVersion: 999 }))),
    ];
    const reasons = results.map((r) => (r.ok ? 'ok' : r.reason));
    expect(new Set(reasons).size, `四种失败的理由码有重复：${JSON.stringify(reasons)}`).toBe(4);
    const msgs = results.map((r) => (r.ok ? '' : r.message));
    expect(msgs.every((m) => m.length > 0), '有失败没有文案').toBe(true);
    expect(new Set(msgs).size, `四种失败的文案有重复：${JSON.stringify(msgs)}`).toBe(4);
  });

  it('合法消息往返（encodeMsg → decodeMsg 逐字段相等）', () => {
    const msgs: NetMsg[] = [
      hello(),
      hello({ role: 'spectator', resuming: true }),
      { t: 'hello-ack', protoVersion: PROTO_VERSION, seat: 0, peerNick: 'host', sessionId: 's-1' },
      { t: 'busy', reason: 'player-slots-full', detail: '位满' },
      { t: 'commit', hash: 'deadbeef' },
      { t: 'commit-ack' },
      { t: 'commit-face', hash: 'cafe' },
      { t: 'reveal-seed', seed: '00ff' },
      { t: 'reveal-face', face: 1, faceNonce: 'n-1' },
      { t: 'reveal-salt', salt: 'aabb' },
      { t: 'resync-req', sessionId: 's-1', appliedSteps: 24 },
      { t: 'bye', reason: 'paused' },
      { t: 'forfeit', reason: 'resign' },
    ];
    for (const m of msgs) {
      const e = encodeMsg(m);
      expect(e.ok, `encode 失败：${m.t}`).toBe(true);
      const d = decodeMsg(e.ok === true ? e.text : '');
      expect(d.ok, `decode 失败：${m.t}`).toBe(true);
      expect(d.ok === true && d.msg, `往返不相等：${m.t}`).toEqual(m);
    }
  });

  it('encodeMsg 对"长得不像它自称的那条消息"回 bad-shape（不把半成品发上线）', () => {
    const bads: unknown[] = [
      null,
      'hello',
      {},
      { t: 'nope' },
      { t: 'hello' }, // 缺字段
      { t: 'hello', role: 'player', sessionId: 's', protoVersion: '1', cardDataHash: 'h', seat: 0, nick: 'n' },
      { t: 'act', seq: 0 }, // 缺 action
      { t: 'act', seq: 0, action: { seq: 0, player: 2, kind: 'play' } }, // 座位非法
      { t: 'reveal-face', face: 2, faceNonce: 'n' }, // face 只有 0/1
      { t: 'bye', reason: 'whatever' },
      { t: 'forfeit', reason: 'timeout' }, // 合法（D4：G6 会发它）
    ];
    for (const bad of bads.slice(0, -1)) {
      const e = encodeMsg(bad);
      expect(e.ok, `非法消息被编码出去了：${JSON.stringify(bad)}`).toBe(false);
      expect(e.ok === false && e.reason).toBe('bad-shape');
    }
    // 最后一条是合法的：`forfeit.timeout` 今天没有发送方，但它是 D4 明确保留的取值，
    // 编码层不该拒它（拒它的地方是状态机，不是协议层）。
    expect(encodeMsg(bads[bads.length - 1]).ok).toBe(true);
  });

  it('解码结果可以被 validateHello 直接吃（两层是同一份形状）', () => {
    const e = encodeMsg(hello());
    const d = decodeMsg(e.ok === true ? e.text : '');
    expect(d.ok).toBe(true);
    const v = validateHello(d.ok === true ? d.msg : null, ctx());
    expect(v.ok, 'decode 出来的 hello 过不了 validateHello（两层形状漂移了）').toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 4：定时器零命中（生成式，住在守卫里）
 * ------------------------------------------------------------------ */

describe('判据 4 的锚点：定时器零命中是生成式的（住在 tests/net/net-purity.test.ts）', () => {
  it('本模块的公开面不提供任何"注入定时器"的默认实现（能力一律由调用方给）', async () => {
    // 判据 4 的机械断言在守卫里（它扫 `src/net/**` 的源码）。这里做的是**另一半**：
    // 证明 `protocol.ts` 里没有任何"顺手给个默认定时器/默认随机源"的家伙 ——
    // 那种 API 会让纯层看起来干净，而调用方一用就带进了时钟。
    const mod: Record<string, unknown> = await import('../../src/net/protocol');
    expect(Object.keys(mod).length, 'protocol.ts 的导出面可疑地小').toBeGreaterThan(8);
    const textOf = (f: unknown) => (typeof f === 'function' ? String(f) : '');
    for (const name of ['roomCodeFromRandom', 'roomCodeFromBytes']) {
      expect(textOf(mod[name]), `${name} 里不该出现 setTimeout`).not.toMatch(/setTimeout|setInterval/);
    }
    // 判据 4 的"生成式扫描"住在 `tests/net/net-purity.test.ts`（它扫 `src/net/**` 的源码，
    // 而不是靠这里的逐条断言）。这里**不**去读那个文件的内容：本仓 tsconfig 把 `node:fs`
    // 解析成未解析模块（`npx tsc --traceResolution` 实测 `Skipping module 'node:fs' that looks
    // like an absolute URI`，走宽松类型），`readFileSync` 的返回类型上 `toString('utf8')`
    // 实测报 TS2554 —— 与一份未解析的类型较劲换不来判据强度，不如把话写清楚：
    // 判据 4 的红由守卫独立负责，本文件的职责是行为腿（判据 1/2/3）与变异对应关系。
  });
});

/* ------------------------------------------------------------------ *
 * 变异 M1-M4 的"腿在这里"声明
 * ------------------------------------------------------------------ */

describe('变异要求 M1-M4 的对应腿（变异在隔离镜像里做，见 .superpowers/T1/）', () => {
  it('M1 对调校验顺序 ⇒ 判据 1 的"靠前那条"腿红', () => {
    // 本组不复制实现：这里断言"顺序腿确实依赖顺序"—— 把两条同时违反的输入换一个组合，
    // 期望的理由码就换一条。若实现里顺序被对调，上面判据 1 的那条腿必然红。
    const both = hello({ cardDataHash: 'hash-B' });
    const full = ctx({ occupied: { players: [0, 1], spectators: [] } });
    expect(validateHello(both, full)).toMatchObject({ ok: false, reason: 'card-data-hash' });
    const both2 = hello({ protoVersion: 999, cardDataHash: 'hash-B' });
    expect(validateHello(both2, full)).toMatchObject({ ok: false, reason: 'proto-version' });
  });

  it('M2 把 I/L/O/U 放回字符表 ⇒ 判据 2 的"明确拒绝"腿红', () => {
    // 腿在这里的判据是"含 I 的码必须 reason === 'ambiguous-char'"。字符表一旦含 I，
    // 归一化就会放行 → 那条腿（以及"字符表恰为剔除后的 32 个"那条）当场红。
    expect(ROOM_CODE_ALPHABET.includes('I')).toBe(false);
    expect(normalizeRoomCode('K7M2QI')).toMatchObject({ ok: false, reason: 'ambiguous-char' });
  });

  it('M3 decodeMsg 在未知 t 上抛 ⇒ 判据 3 的"不抛"腿红', () => {
    expect(() => decodeMsg('{"t":"nope"}')).not.toThrow();
  });
});
