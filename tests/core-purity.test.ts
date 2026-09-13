import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * G0 守卫：src/core 必须保持纯确定性。
 * 见 docs/2026-09-13-联机与多端-设计稿.md §2.2 / §2.8。
 */

const CORE_DIR = fileURLToPath(new URL('../src/core/', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = walk(CORE_DIR);

function read(file: string): string {
  return readFileSync(file).subarray(0, 4 * 1024 * 1024).toString('utf8');
}

/** 相对路径（报错时好读） */
function rel(file: string): string {
  return file.slice(CORE_DIR.length).replace(/\\/g, '/');
}

describe('src/core 纯确定性守卫（G0）', () => {
  it('扫描到足够的源文件（防路径写错导致空扫描假绿）', () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it('不得出现 Math.random 调用', () => {
    // 只匹配"调用"（后跟左括号）：注释里提到 Math.random 不构成违规
    // （src/core/rng.ts 的文档注释里就写着这条铁律，宽松正则会把它误判为违规）
    // 用 Set 去重：同一文件重复违规只报告一次
    const bad = new Set<string>();
    for (const f of FILES) {
      if (/\bMath\s*\.\s*random\s*\(/.test(read(f))) bad.add(rel(f));
    }
    expect([...bad], `以下 core 文件调用了 Math.random（会破坏联机确定性）：${[...bad].join(', ')}`).toEqual([]);
  });

  it('不得出现时钟调用（仅 trace.ts 豁免 Date.now）', () => {
    // 用 Set 去重：Date.now + performance.now 可能命中同一文件
    const bad = new Set<string>();
    for (const f of FILES) {
      const r = rel(f);
      const src = read(f);
      // 一律只匹配"调用"形式：注释里提到 Date.now 不构成违规
      // trace.ts 的 Date.now 豁免**仅限该文件的诊断用途**（envInfo / 日志时间戳）；
      // 该文件此后新增的时钟调用同样落在豁免内，是刻意为之，不是漏网。
      if (r !== 'trace.ts' && /\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(/.test(src)) bad.add(r);
      if (/\bperformance\s*\.\s*now\s*\(/.test(src)) bad.add(r);
    }
    expect([...bad], `以下 core 文件使用了时钟（诊断请走 trace.ts）：${[...bad].join(', ')}`).toEqual([]);
  });

  it('不得自行取随机（种子由平台层提供）', () => {
    // 同风格去重
    const bad = new Set<string>();
    for (const f of FILES) {
      if (/getRandomValues\s*\(|randomUUID\s*\(/.test(read(f))) bad.add(rel(f));
    }
    expect([...bad], `以下 core 文件自行取随机（应由 src/ui/match-seed.ts 提供种子）：${[...bad].join(', ')}`).toEqual([]);
  });

  it('不得引用 DOM（core 保持 DOM-free；trace.ts 的诊断读取显式豁免）', () => {
    const bad = new Set<string>();
    for (const f of FILES) {
      const r = rel(f);
      const src = read(f);
      if (/from\s+['"][^'"]*\/ui\//.test(src)) bad.add(r);
      // 匹配**成员访问**（含属性读取），不只是调用：trace.ts 的
      // navigator.userAgent / window.innerWidth / document.documentElement 都是属性读取，
      // 旧正则只看调用形式，因此这条断言当时是"因为看不见才通过"。
      // trace.ts 是唯一豁免（诊断用；且都包在 typeof 守卫 + try/catch 内）——
      // 显式豁免，不靠正则侥幸。
      // 补齐「自由全局」（M2）：fetch/localStorage/sessionStorage/indexedDB/
      // XMLHttpRequest/WebSocket/requestAnimationFrame/cancelAnimationFrame 不需要任何前缀
      // 就能用，旧模式（只有 window/document/navigator）对它们完全盲；globalThis.document
      // 则是换个前缀绕开同一个洞。自由全局按「成员访问或调用」两种形态匹配：
      // localStorage.getItem / fetch(...) 命中，注释里提到名字不命中（与上面两条同一口径）。
      if (
        r !== 'trace.ts' &&
        /\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket)\s*(?:\.|\[)|\b(?:fetch|requestAnimationFrame|cancelAnimationFrame)\s*\(|globalThis\s*\.\s*(?:window|document|navigator|fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|requestAnimationFrame|cancelAnimationFrame)\b/.test(
          src,
        )
      ) {
        bad.add(r);
      }
    }
    expect([...bad], `以下 core 文件引用了 UI/DOM：${[...bad].join(', ')}`).toEqual([]);
  });
});
