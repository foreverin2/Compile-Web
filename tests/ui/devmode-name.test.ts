import { describe, it, expect } from 'vitest';
import { resolveCardName } from '../../src/ui/devmode';

/**
 * 隐藏开发者模式：卡牌名解析（纯函数，无 DOM 依赖，可在 vitest(node) 下导入）。
 * 接受的输入形式：trim + 大小写不敏感；`light-2` / `light2` / `光2` / `光-2` / `光 2`
 * 均应解析到同一张牌（协议中文名 + 分值）。
 */
describe('resolveCardName', () => {
  it("resolves 'light-2' to light-2", () => {
    expect(resolveCardName('light-2')?.defId).toBe('light-2');
  });

  it("resolves 'light2' to light-2", () => {
    expect(resolveCardName('light2')?.defId).toBe('light-2');
  });

  it("resolves 'LIGHT-2' to light-2 (case-insensitive)", () => {
    expect(resolveCardName('LIGHT-2')?.defId).toBe('light-2');
  });

  it("resolves '光2' to light-2 (protocol short name + value)", () => {
    expect(resolveCardName('光2')?.defId).toBe('light-2');
  });

  it("resolves '光-2' to light-2", () => {
    expect(resolveCardName('光-2')?.defId).toBe('light-2');
  });

  it("resolves ' 光 2 ' to light-2 (trimmed, spaces removed)", () => {
    expect(resolveCardName(' 光 2 ')?.defId).toBe('light-2');
  });

  it("resolves '暗3' to darkness-3", () => {
    expect(resolveCardName('暗3')?.defId).toBe('darkness-3');
  });

  it("resolves '灵魂0' to spirit-0", () => {
    expect(resolveCardName('灵魂0')?.defId).toBe('spirit-0');
  });

  it("resolves 'water-0' to water-0", () => {
    expect(resolveCardName('water-0')?.defId).toBe('water-0');
  });

  it("returns null for 'light-9' (no such card)", () => {
    expect(resolveCardName('light-9')).toBeNull();
  });

  it("returns null for '不存在'", () => {
    expect(resolveCardName('不存在')).toBeNull();
  });

  it("returns null for ''", () => {
    expect(resolveCardName('')).toBeNull();
  });
});
