/**
 * G5 T13-A（协调者 2026-09-20 第 1 条附带条件）：**掐线钩子必须是惰性的**。
 *
 * 钩子（`NetBrowserEnv.probeLinkCut`）只在 `#g5probe=1` 时打开，而它住在**生产文件**
 * `src/ui/net-browser.ts` 里（唯一碰 `RTCPeerConnection` 的那个文件）。这条腿钉三件事：
 *  1. **关着时那段代码一次都不执行**：不挂任何全局函数（`__g5LinkCut` / `__g5LinkRestore`
 *     都不存在）——「一次都不执行」的可数形式就是"它唯一的产物一个都没有"；
 *  2. **关着时行为与没有它时逐字相同**：同一条假连接上跑两遍（一遍不带那个字段、一遍显式
 *     `probeLinkCut: false`），状态序列 / 通道数 / `send` 结果**逐字相等**；
 *  3. **打开时它真的装上**（正控）——否则上面两条在"钩子被整个删掉"时也恒绿；
 *  4. **注入面没有形状变化**：`probeLinkCut` 是**可选**字段，既有调用方一个字都不用改
 *     （本仓库既有 50 条 `net-browser` 腿与所有生产调用方都不传它，它们照旧编译、照旧绿 ——
 *     这一条由 `npx tsc --noEmit` 与那些腿本身佐证，这里再用文本腿把"可选"钉住）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBrowserTransport, type NetBrowserEnv } from '../../src/ui/net-browser';
import { makeFakePc } from './fake-peer-connection';
import { stripComments } from './source-text';

const INIT = { selfId: 'a', peerId: 'b' } as const;

/** 一次"干净"的传输生命周期：init → 状态序列 → 通道数 → 一次 send 的结果 */
async function lifecycle(env: NetBrowserEnv): Promise<{ seen: string[]; status: string; channels: number; send: string }> {
  const { pc, fake } = makeFakePc({});
  (pc as Record<string, unknown>).connectionState = 'new';
  (pc as Record<string, unknown>).iceConnectionState = 'new';
  const t = createBrowserTransport({ ...env, peerConnection: () => pc as never });
  const seen: string[] = [];
  t.onStatus((c) => seen.push(`${c.from}→${c.to}`));
  const r = await t.init(INIT);
  expect(r.ok, '夹具失败：init 没成功').toBe(true);
  fake.finishGathering();
  const s = t.send('act', '{"t":"beat"}');
  return { seen, status: t.status(), channels: t.channels().length, send: s.ok ? 'ok' : s.reason };
}

describe('★★ T13-A 附带条件：`probeLinkCut` 关着时那段代码一次都不执行', () => {
  it('关着（不传 / 显式 false）⇒ 两个全局钩子都不存在，且行为与不传时逐字相同', async () => {
    const g = globalThis as { __g5LinkCut?: unknown; __g5LinkRestore?: unknown };
    delete g.__g5LinkCut;
    delete g.__g5LinkRestore;
    const withoutField = await lifecycle({});
    expect(g.__g5LinkCut, '没传 `probeLinkCut` 却挂上了掐线钩子（那段代码被执行了）').toBeUndefined();
    expect(g.__g5LinkRestore, '没传 `probeLinkCut` 却挂上了恢复钩子').toBeUndefined();

    delete g.__g5LinkCut;
    delete g.__g5LinkRestore;
    const explicitFalse = await lifecycle({ probeLinkCut: false });
    expect(g.__g5LinkCut, '显式 `false` 也挂上了钩子').toBeUndefined();
    expect(explicitFalse, '`probeLinkCut: false` 与"不传"的行为不一致（逐字比较）').toEqual(withoutField);
  });

  it('正控：显式打开时才装上，而且真掐真恢复（否则上面那条在钩子被删掉时恒绿）', async () => {
    const g = globalThis as { __g5LinkCut?: () => string; __g5LinkRestore?: () => string };
    delete g.__g5LinkCut;
    delete g.__g5LinkRestore;
    const { pc } = makeFakePc({});
    (pc as Record<string, unknown>).connectionState = 'new';
    (pc as Record<string, unknown>).iceConnectionState = 'new';
    const t = createBrowserTransport({
      peerConnection: () => pc as never,
      probeLinkCut: true,
    });
    const seen: string[] = [];
    t.onStatus((c) => seen.push(`${c.from}→${c.to}`));
    await t.init(INIT);
    expect(typeof g.__g5LinkCut, '打开了却没装钩子').toBe('function');
    expect(typeof g.__g5LinkRestore, '打开了却没装恢复钩子').toBe('function');
    // ⚠️ 读进局部变量：`delete g.x` 之后 TS 会把那个属性收窄成 `undefined`（`?.()` 变成 never）
    const cut = (globalThis as { __g5LinkCut?: () => string }).__g5LinkCut;
    const restore = (globalThis as { __g5LinkRestore?: () => string }).__g5LinkRestore;
    // 掐：状态如实转 offline；恢复：转回 online（这一侧是出 offer 方 ⇒ 它自己重建通道）
    expect(cut?.()).toBe('cut');
    expect(t.status(), '掐了之后传输还报 online（那就不是"真掐"）').toBe('offline');
    expect(restore?.()).toBe('restore');
    expect(t.status(), '恢复之后传输没转回 online').toBe('online');
    expect(seen, `状态序列不对：${seen.join(', ')}`).toEqual(['idle→connecting', 'connecting→offline', 'offline→online']);
    delete g.__g5LinkCut;
    delete g.__g5LinkRestore;
  });

  it('注入面形状没变：`probeLinkCut` 是**可选**字段（老调用方一个字都不用改）', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-browser.ts', import.meta.url)))
        .subarray(0, 4 * 1024 * 1024).toString('utf8'),
    );
    expect(src, '`probeLinkCut` 不是可选字段（老调用方会编译不过）').toContain('readonly probeLinkCut?: boolean;');
    // 反空转：那个字段确实被读了（不是只声明）
    expect(src, '`probeLinkCut` 声明了却没人读（钩子成了摆设）').toContain('resolved.probeLinkCut === true');
  });
});
