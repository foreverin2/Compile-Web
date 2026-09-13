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
});
