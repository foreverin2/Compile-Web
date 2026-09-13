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
    const bad = FILES.filter((f) => /\bMath\s*\.\s*random\s*\(/.test(read(f))).map(rel);
    expect(bad, `以下 core 文件调用了 Math.random（会破坏联机确定性）：${bad.join(', ')}`).toEqual([]);
  });

  it('不得出现时钟调用（仅 trace.ts 豁免 Date.now）', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      // 一律只匹配"调用"形式：注释里提到 Date.now 不构成违规
      if (rel(f) !== 'trace.ts' && /\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(/.test(src)) bad.push(rel(f));
      if (/\bperformance\s*\.\s*now\s*\(/.test(src)) bad.push(rel(f));
    }
    expect(bad, `以下 core 文件使用了时钟（诊断请走 trace.ts）：${bad.join(', ')}`).toEqual([]);
  });

  it('不得自行取随机（种子由平台层提供）', () => {
    const bad = FILES.filter((f) => /getRandomValues\s*\(|randomUUID\s*\(/.test(read(f))).map(rel);
    expect(bad, `以下 core 文件自行取随机（应由 src/ui/match-seed.ts 提供种子）：${bad.join(', ')}`).toEqual([]);
  });

  it('不得引用 UI 层或 DOM（core 保持 DOM-free）', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      if (/from\s+['"][^'"]*\/ui\//.test(src)) bad.push(rel(f));
      // 只匹配真实成员调用，避免命中注释（如 render 相关说明里的字面量）
      if (/\bdocument\s*\.\s*\w+\s*\(|\bwindow\s*\.\s*\w+\s*\(/.test(src)) bad.push(rel(f));
    }
    expect(bad, `以下 core 文件引用了 UI/DOM：${bad.join(', ')}`).toEqual([]);
  });
});
