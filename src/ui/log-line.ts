/**
 * ★ 2026-10-06（用户要求）：**战斗日志的显示层**——「纯英文 + 对应触发卡牌/协议的小图片」。
 *
 * ## 两件事
 *
 *  1. **文本**：走 `src/i18n/engine-log.ts` 的形状表（英文模式下换成英文，中文模式逐字原文）；
 *  2. **小图片**：从**原始中文日志**里认出这条说的是哪张卡 / 哪套协议，给渲染层一个可画缩略图的
 *     `{ kind, defId }`：
 *     - **卡**：日志里的卡牌 id 本来就是英文（`fire-3` / `rigidity-7` / `ice-6`）⇒ 第一条
 *       `[a-z]+-\d+` 命中即卡；`P1`、`线 2` 这类不会被误认（没有连字符）。
 *     - **协议**：没有卡 id 时（`P1 选择 流水` / `P1 编译线 2（流水 10 vs 对手 3）` /
 *       `P1 禁用 火焰`）按**协议名**认；名字取事实层的 45 套中文名 + 英文表，
 *       单字名（`爱` / `恨`）要求两侧是分隔符，免得在一句话里误命中。
 *
 * ⚠️ 这一层**只读字符串**（不解游戏状态）：日志是历史，渲染时刻的牌局早已不同。
 * ⚠️ 认不出就返回 `null`（那条日志没有缩略图）—— 不硬猜。
 */

import { getLang } from '../i18n';
import { engineLogText } from '../i18n/engine-log';
import { PROTOCOL_EN } from '../i18n/protocol-en';
import { DEMO_PROTOCOLS } from '../data/demo';

/** 这条日志指向的那张小图（卡 或 协议） */
export interface LogThumb {
  readonly kind: 'card' | 'protocol';
  readonly defId: string;
}

export interface LogEntryView {
  /** 该显示的那一行文本（中文模式 = 引擎原文；英文模式 = 形状表换出来的英文） */
  readonly text: string;
  /** 该行对应的小图；认不出 = `null` */
  readonly thumb: LogThumb | null;
}

/** 第一条卡牌 id（`fire-3` / `rigidity-7` / `diversity-0`…） */
const CARD_ID = /(?:^|[^\w-])([a-z][a-z0-9]*-\d+)(?=$|[^\w-])/;

/** 协议名候选（中文名 + 英文名，长的优先；单字的用分隔符夹住） */
const NAME_KEYS: readonly { readonly key: string; readonly defId: string; readonly single: boolean }[] =
  DEMO_PROTOCOLS.flatMap((p) => {
    const out: { key: string; defId: string; single: boolean }[] = [];
    const zh = p.name;
    if (zh !== '') out.push({ key: zh, defId: p.defId, single: zh.length === 1 });
    const en = PROTOCOL_EN[p.defId]?.name;
    if (en !== undefined && en !== '') out.push({ key: en, defId: p.defId, single: false });
    return out;
  }).sort((a, b) => b.key.length - a.key.length);

const isDelim = (ch: string | undefined): boolean =>
  ch === undefined || /[\s：:（(、「，,。]/.test(ch);

/** 认这条日志说的是哪张卡 / 哪套协议（先卡后协议） */
export function logThumbOf(raw: string): LogThumb | null {
  const card = CARD_ID.exec(raw);
  if (card !== null) return { kind: 'card', defId: card[1] };
  for (const { key, defId, single } of NAME_KEYS) {
    const at = raw.indexOf(key);
    if (at < 0) continue;
    if (!single) return { kind: 'protocol', defId };
    // 单字名（爱 / 恨）：两侧必须是分隔符，免得在别的词里误命中
    if (isDelim(raw[at - 1]) && isDelim(raw[at + key.length])) return { kind: 'protocol', defId };
  }
  return null;
}

/** 一条日志的显示形态（文本 + 缩略图） */
export function logEntryView(raw: string): LogEntryView {
  return { text: engineLogText(raw, getLang()), thumb: logThumbOf(raw) };
}
