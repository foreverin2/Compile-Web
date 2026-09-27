import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `tools/parse-ratings.mjs` 重跑时**不会把显示名改回去**（2026-09-28，T43 跟进）。
 *
 * 背景：外部评分源 `Compile45套协议卡组评分与阵容推荐.txt` 里这套协议写「刚性」，
 * 而本仓显示名是「死板」（用户 2026-09-27 定的，卡面原文是「僵化」）。那个一次性脚本
 * 会整份重写 `src/data/protocolRatings.ts` —— 没有改名表的话，重跑一次就把用户的显示名
 * 悄悄改回「刚性」。这里**真跑脚本**（输出写到临时目录，绝不碰 src/），钉住：
 *   ① 生成物里 rigidity 的 name 与正文都是「死板」，全文件不再有「刚性」；
 *   ② 现有文件里的名字对不上、而源名又不在改名表上时，脚本**拒绝覆写**并报错退出。
 *
 * 能假（变异自证，2026-09-28 实测）：删掉 `tools/parse-ratings.mjs` 里那四行
 * `applyDisplayRenames(...)` ⇒ 生成物里是「刚性」，①必红；删掉「拒绝覆写」安全阀 ⇒ ②必红。
 * 外部源 txt 不存在时整组跳过（其他环境没有那份资料）。
 */
const RATINGS_TXT = 'E:\\studyE\\compile\\正版compile\\ai给出的一些开发建议\\Compile45套协议卡组评分与阵容推荐.txt';
const REPO = fileURLToPath(new URL('../..', import.meta.url));

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 跑一次脚本（非 0 退出码走 catch 取回来，不让它打断用例） */
function runParseRatings(outPath: string): RunResult {
  try {
    const stdout = execFileSync('node', ['tools/parse-ratings.mjs', RATINGS_TXT, outPath], {
      cwd: REPO,
      encoding: 'utf8',
    });
    return { status: 0, stdout: String(stdout), stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const hasSource = existsSync(RATINGS_TXT);

describe.skipIf(!hasSource)('tools/parse-ratings.mjs：重跑不把显示名改回去', () => {
  const dir = mkdtempSync(join(tmpdir(), 't43-ratings-'));

  it('生成物里 rigidity = 死板（name 与正文），全文件没有「刚性」「僵化」', () => {
    const outPath = join(dir, 'generated.ts');
    const r = runParseRatings(outPath);
    expect(r.stdout, `脚本应正常退出（stderr: ${r.stderr.slice(0, 400)}）`).toContain('显示名换算');
    expect(r.status, `脚本退出码（stderr: ${r.stderr.slice(0, 400)}）`).toBe(0);

    const out: string = readFileSync(outPath).subarray(0, 1 << 20).toString('utf8');
    const at = out.indexOf("defId: 'rigidity'");
    expect(at, '生成物里应有 rigidity').toBeGreaterThan(0);
    const block = out.slice(at, at + 600);
    expect(block).toContain("name: '死板'");
    expect(block).toContain('死板7');
    expect(block).not.toContain('刚性');
    expect(block).not.toContain('僵化');
    expect(out, '整份生成物里也不该再有源写法「刚性」').not.toContain('刚性');
    // 另外两处历史写法同样换算掉，别的协议名照旧
    expect(out).toContain("name: '暴怒'");
    expect(out).toContain("name: '灵活'");
    expect(out).not.toContain('愤怒');
    expect(out).toContain("name: '流水'");
  });

  it('现有文件里的名字对不上、源名又不在表上 ⇒ 拒绝覆写（exit 1，不写文件）', () => {
    const clashPath = join(dir, 'clash.ts');
    const before = "export const PROTOCOL_RATINGS = [\n  {\n    defId: 'rigidity',\n    name: '死板x',\n  },\n];\n";
    writeFileSync(clashPath, before, 'utf8');
    const r = runParseRatings(clashPath);
    expect(r.status, '安全阀应让脚本非 0 退出').toBe(1);
    expect(r.stderr).toContain('拒绝覆写');
    expect(r.stderr, '报错要指出是哪一套对不上').toContain('rigidity');
    const after: string = readFileSync(clashPath).subarray(0, 1 << 20).toString('utf8');
    expect(after, '拒绝覆写时不许动那个文件').toBe(before);
  });

  /**
   * 评审 P0（2026-09-28）：阀的读法**不许依赖排版**。
   * 反面教材：旧的窄正则只认 `defId: 'x', name: '…'` 这一种写法，生成物一旦被改写成双引号
   * （或键值间多几个空格/换个行），阀就读不到任何名字 ⇒ 静默整份覆写（评审实测 89 B → 40430 B）。
   * 两条腿：双引号排版、以及「冒号后换行 + 缩进」的排版，都必须照样拒绝且文件字节不变。
   */
  it('现有文件是双引号 / 键值跨行排版时，照样拒绝覆写（阀不依赖排版）', () => {
    const cases: Array<readonly [string, string]> = [
      ['clash-double.ts', 'export const PROTOCOL_RATINGS = [\n  {\n    defId: "rigidity",\n    name: "死板x",\n  },\n];\n'],
      ['clash-multiline.ts', 'export const PROTOCOL_RATINGS = [\n  {\n    defId:\n      "rigidity",\n    name:\n      "死板x",\n  },\n];\n'],
    ];
    for (const [file, before] of cases) {
      const p = join(dir, file);
      writeFileSync(p, before, 'utf8');
      const r = runParseRatings(p);
      expect(r.status, `${file}：安全阀应让脚本非 0 退出（stderr: ${r.stderr.slice(0, 200)}）`).toBe(1);
      expect(r.stderr, `${file}：报错要含「拒绝覆写」`).toContain('拒绝覆写');
      expect(r.stderr, `${file}：报错要指出是哪一套对不上`).toContain('rigidity');
      const after: string = readFileSync(p).subarray(0, 1 << 20).toString('utf8');
      expect(after, `${file}：拒绝覆写时不许动那个文件`).toBe(before);
    }
  });

  it('临时目录用完就删（不留临时件）', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});
