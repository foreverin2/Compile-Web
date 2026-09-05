import { describe, expect, it } from 'vitest';
import { searchProtocols } from '../../src/ui/devmode';

/**
 * searchProtocols：Compile 指令的协议模糊预览（2026-09-03 新增）——
 * 百度式模糊（defId / 协议中文名），空查询返回全部协议（供直接点选）。
 */
describe('searchProtocols', () => {
  it('defId 前缀/子串模糊命中', () => {
    expect(searchProtocols('grav').map((p) => p.defId)).toEqual(['gravity']);
    expect(searchProtocols('lif').map((p) => p.defId)).toEqual(['life']);
    expect(searchProtocols('psych').map((p) => p.defId)).toEqual(['psychic']);
  });

  it('英文单字母命中多个协议（前缀分 > 子串分，同分 defId 自然序；并池含 2/3代）', () => {
    // 前缀：life/light/love/luck/lust；子串（默认 limit 8 内）：assimilation/clarity/flexibility（含 'l'）
    expect(searchProtocols('l').map((p) => p.defId)).toEqual([
      'life', 'light', 'love', 'luck', 'lust',
      'assimilation', 'clarity', 'flexibility',
    ]);
  });

  it('中文协议名命中（如 光 → light）', () => {
    expect(searchProtocols('光').map((p) => p.defId)).toEqual(['light']);
    expect(searchProtocols('死').map((p) => p.defId)).toEqual(['death']);
  });

  it('空查询 → 返回全部协议（供点选；三代并池共 45 套）', () => {
    const all = searchProtocols('', 45);
    expect(all.length).toBe(45);
  });

  it('无匹配 / 纯数字 token → 空', () => {
    expect(searchProtocols('不存在')).toEqual([]);
    expect(searchProtocols('light 2')).toEqual([]); // 协议名无分值数字
  });

  it('limit 截断', () => {
    expect(searchProtocols('', 3).length).toBe(3);
  });
});
