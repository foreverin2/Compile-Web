import type { CardDef, ProtocolDef } from '../core/models/types';

/**
 * 全部协议定义（15 套）与全部卡牌定义（每套 6 张）。
 *
 * 文本来源：docs/card-text-source.txt（权威），卡牌文本为中文（游戏 UI 语言）。
 * 格式 `甲x：A/B/C`：协议甲中分值为 x 的牌，A=顶部指令、B=中部指令、C=底部指令；"空"= 无该指令。
 */

export const ALL_PROTOCOLS: ProtocolDef[] = [
  // 基础版 12 套（MN01）
  { defId: 'water', name: 'Water', set: 'MN01', commands: ['RETURN', 'DRAW', 'FLIP'], loadingText: 'WASH AWAY AND RENEW.' },
  { defId: 'fire', name: 'Fire', set: 'MN01', commands: ['DISCARD FOR EFFECT'], loadingText: 'BURN AT BOTH ENDS.' },
  { defId: 'light', name: 'Light', set: 'MN01', commands: ['DRAW', 'FLIP', 'SHIFT'], loadingText: 'BURN AWAY THE DARK.' },
  { defId: 'darkness', name: 'Darkness', set: 'MN01', commands: ['DRAW', 'SHIFT', 'MANIPULATE'], loadingText: 'AN ABSENCE OF LIGHT.' },
  { defId: 'life', name: 'Life', set: 'MN01', commands: ['FLIP', 'TOP DECK PLAY', 'DRAW'], loadingText: 'BRING ABOUT NEW GROWTH.' },
  { defId: 'death', name: 'Death', set: 'MN01', commands: ['DELETE', 'DRAW'], loadingText: 'NOTHING SHALL SURVIVE.' },
  { defId: 'spirit', name: 'Spirit', set: 'MN01', commands: ['FLIP', 'SHIFT', 'DRAW'], loadingText: 'TRUE STRENGTH FROM WITHIN.' },
  { defId: 'gravity', name: 'Gravity', set: 'MN01', commands: ['SHIFT', 'FLIP', 'DRAW'], loadingText: 'DRAW EVER INWARD.' },
  { defId: 'psychic', name: 'Psychic', set: 'MN01', commands: ['DRAW', 'MANIPULATE', 'SHIFT'], loadingText: "KNOW YOUR FOE'S MIND." },
  { defId: 'plague', name: 'Plague', set: 'MN01', commands: ['FORCED DISCARD', 'FLIP'], loadingText: 'SLOW DEATH FROM WITHIN.' },
  { defId: 'metal', name: 'Metal', set: 'MN01', commands: ['PREVENT', 'DRAW', 'FLIP'], loadingText: 'HARDENED AGAINST ALL.' },
  { defId: 'speed', name: 'Speed', set: 'MN01', commands: ['DRAW', 'PLAY', 'SHIFT'], loadingText: 'QUICKEN WITH EVERY STEP.' },
  // 拓展包 3 套（AX01）
  { defId: 'love', name: 'Love', set: 'AX01', commands: ['DRAW', 'GIVE', 'SWAP'], loadingText: '施中有得' },
  { defId: 'hate', name: 'Hate', set: 'AX01', commands: ['MUTUAL DELETE'], loadingText: '极尽鄙夷' },
  { defId: 'apathy', name: 'Apathy', set: 'AX01', commands: ['FLIP FACE-DOWN'], loadingText: '不闻不问' },
];

export const ALL_CARD_DEFS: CardDef[] = [
  // 水——涤旧焕新
  { defId: 'water-0', protocol: 'water', value: 0, middle: '翻转另1张牌。翻转此牌。' },
  { defId: 'water-1', protocol: 'water', value: 1, middle: '在另两列各以反面打出你牌堆顶的牌。' },
  { defId: 'water-2', protocol: 'water', value: 2, middle: '抽2张牌。重排你的协议。' },
  { defId: 'water-3', protocol: 'water', value: 3, middle: '回手此列所有2分的牌。' },
  { defId: 'water-4', protocol: 'water', value: 4, middle: '回手1张你的牌。' },
  { defId: 'water-5', protocol: 'water', value: 5, middle: '弃1张牌。' },

  // 火——玉石俱焚
  { defId: 'fire-0', protocol: 'fire', value: 0, middle: '翻转另1张牌。抽2张牌。', bottom: '被盖住前：先抽1张牌并翻转另1张牌。' },
  { defId: 'fire-1', protocol: 'fire', value: 1, middle: '弃1张牌。如果弃了，删除1张牌。' },
  { defId: 'fire-2', protocol: 'fire', value: 2, middle: '弃1张牌。如果弃了，回手1张牌。' },
  { defId: 'fire-3', protocol: 'fire', value: 3, bottom: '结束：你可以弃1张牌。如果弃了，翻转1张牌。' },
  { defId: 'fire-4', protocol: 'fire', value: 4, middle: '弃1张或更多张牌。抽弃牌数+1张牌。' },
  { defId: 'fire-5', protocol: 'fire', value: 5, middle: '弃1张牌。' },

  // 光——灼明驱暗
  { defId: 'light-0', protocol: 'light', value: 0, middle: '翻转1张牌。抽其分值张牌。' },
  { defId: 'light-1', protocol: 'light', value: 1, bottom: '结束：抽1张牌。' },
  { defId: 'light-2', protocol: 'light', value: 2, middle: '抽2张牌。揭示1张反面牌。你可以平移或翻转那张牌。' },
  { defId: 'light-3', protocol: 'light', value: 3, middle: '平移此列所有反面牌到另一列。' },
  { defId: 'light-4', protocol: 'light', value: 4, middle: '对手揭示其手牌。' },
  { defId: 'light-5', protocol: 'light', value: 5, middle: '弃1张牌。' },

  // 暗——黯淡无光
  { defId: 'darkness-0', protocol: 'darkness', value: 0, middle: '抽3张牌。平移1张你对手的被盖住的牌。' },
  { defId: 'darkness-1', protocol: 'darkness', value: 1, middle: '翻转1张你对手的牌。你可以平移那张牌。' },
  { defId: 'darkness-2', protocol: 'darkness', value: 2, top: '所有此栈的反面牌分值为4。', middle: '你可以翻转1张此列的反面牌。' },
  { defId: 'darkness-3', protocol: 'darkness', value: 3, middle: '在另一列反面打出1张牌。' },
  { defId: 'darkness-4', protocol: 'darkness', value: 4, middle: '平移1张反面牌。' },
  { defId: 'darkness-5', protocol: 'darkness', value: 5, middle: '弃1张牌。' },

  // 生——勃勃生机
  { defId: 'life-0', protocol: 'life', value: 0, middle: '在你有牌的每一列以反面打出你牌堆顶的牌。', bottom: '被盖住前：先删除此牌。' },
  { defId: 'life-1', protocol: 'life', value: 1, middle: '翻转1张牌。再翻转1张牌。' },
  { defId: 'life-2', protocol: 'life', value: 2, middle: '抽1张牌。你可以翻转1张反面牌。' },
  { defId: 'life-3', protocol: 'life', value: 3, bottom: '被盖住前：先在另一列以反面打出你牌堆顶的牌。' },
  { defId: 'life-4', protocol: 'life', value: 4, middle: '如果此牌盖住了某张牌，抽1张牌。' },
  { defId: 'life-5', protocol: 'life', value: 5, middle: '弃1张牌。' },

  // 死——万物寂灭
  { defId: 'death-0', protocol: 'death', value: 0, middle: '从另两列各删除1张牌。' },
  { defId: 'death-1', protocol: 'death', value: 1, top: '开始：你可以抽1张牌。若如此，删除另1张牌，然后删除此牌。' },
  { defId: 'death-2', protocol: 'death', value: 2, middle: '选1列删除其中所有1分和2分的牌。' },
  { defId: 'death-3', protocol: 'death', value: 3, middle: '删除1张反面牌。' },
  { defId: 'death-4', protocol: 'death', value: 4, middle: '删除1张0分或1分的牌。' },
  { defId: 'death-5', protocol: 'death', value: 5, middle: '弃1张牌。' },

  // 灵魂——力由心生
  { defId: 'spirit-0', protocol: 'spirit', value: 0, middle: '刷新。抽1张牌。', bottom: '跳过检查缓存阶段。' },
  { defId: 'spirit-1', protocol: 'spirit', value: 1, top: '你可以在任意列打出牌。', middle: '抽2张牌。', bottom: '开始：要么弃1张牌，要么翻转此牌。' },
  { defId: 'spirit-2', protocol: 'spirit', value: 2, middle: '你可以翻转1张牌。' },
  { defId: 'spirit-3', protocol: 'spirit', value: 3, top: '你抽牌后：你可以平移此牌，不论是否被盖住。' },
  { defId: 'spirit-4', protocol: 'spirit', value: 4, middle: '交换你2个协议卡的位置。' },
  { defId: 'spirit-5', protocol: 'spirit', value: 5, middle: '弃1张牌。' },

  // 重力——聚敛坍缩
  { defId: 'gravity-0', protocol: 'gravity', value: 0, middle: '此列每有2张牌，就在此牌下方以反面打出你牌堆顶的牌。' },
  { defId: 'gravity-1', protocol: 'gravity', value: 1, middle: '抽2张牌。把1张牌平移进或平移出此列。' },
  { defId: 'gravity-2', protocol: 'gravity', value: 2, middle: '翻转1张牌。把那张牌平移进此列。' },
  { defId: 'gravity-4', protocol: 'gravity', value: 4, middle: '把1张反面牌平移进此列。' },
  { defId: 'gravity-5', protocol: 'gravity', value: 5, middle: '弃1张牌。' },
  { defId: 'gravity-6', protocol: 'gravity', value: 6, middle: '对手在此列以反面打出其牌堆顶的牌。' },

  // 念能——洞悉敌意
  { defId: 'psychic-0', protocol: 'psychic', value: 0, middle: '抽2张牌。对手弃2张牌，然后揭示其手牌。' },
  { defId: 'psychic-1', protocol: 'psychic', value: 1, top: '你的对手只能以反面打出牌。', bottom: '开始：翻转此牌。' },
  { defId: 'psychic-2', protocol: 'psychic', value: 2, middle: '对手弃2张牌。你重排对手的协议。' },
  { defId: 'psychic-3', protocol: 'psychic', value: 3, middle: '对手弃1张牌。平移1张对手的牌。' },
  { defId: 'psychic-4', protocol: 'psychic', value: 4, bottom: '结束：你可以回手1张对手的牌。若如此，翻转此牌。' },
  { defId: 'psychic-5', protocol: 'psychic', value: 5, middle: '弃1张牌。' },

  // 瘟疫——凋亡衰竭
  { defId: 'plague-0', protocol: 'plague', value: 0, middle: '对手弃1张牌。', bottom: '对手无法在此列打出牌。' },
  { defId: 'plague-1', protocol: 'plague', value: 1, top: '对手弃牌后：你抽1张牌。', middle: '对手弃1张牌。' },
  { defId: 'plague-2', protocol: 'plague', value: 2, middle: '弃1张或更多张牌。对手也弃牌，数量等于你的弃牌数+1。' },
  { defId: 'plague-3', protocol: 'plague', value: 3, middle: '翻转其他所有未被盖住的正面牌。' },
  { defId: 'plague-4', protocol: 'plague', value: 4, bottom: '结束：对手删除1张对手的反面牌。你可以翻转这张牌。' },
  { defId: 'plague-5', protocol: 'plague', value: 5, middle: '弃1张牌。' },

  // 金属——固若金汤
  { defId: 'metal-0', protocol: 'metal', value: 0, top: '对手此列的总分减2。', middle: '翻转1张牌。' },
  { defId: 'metal-1', protocol: 'metal', value: 1, middle: '抽2张牌。对手下回合不能编译。' },
  { defId: 'metal-2', protocol: 'metal', value: 2, top: '对手不能在此列以反面打出牌。' },
  { defId: 'metal-3', protocol: 'metal', value: 3, middle: '抽1张牌。删除有至少8张牌的另一列里的所有牌。' },
  { defId: 'metal-5', protocol: 'metal', value: 5, middle: '弃1张牌。' },
  { defId: 'metal-6', protocol: 'metal', value: 6, top: '被盖住或翻转前：先删除这张牌。' },

  // 速度——愈行愈速
  { defId: 'speed-0', protocol: 'speed', value: 0, middle: '打出1张牌。' },
  { defId: 'speed-1', protocol: 'speed', value: 1, top: '清理缓存后：抽1张牌。', middle: '抽2张牌。' },
  { defId: 'speed-2', protocol: 'speed', value: 2, top: '通过编译删除此牌前：平移此牌，不论是否被盖住。' },
  { defId: 'speed-3', protocol: 'speed', value: 3, middle: '平移另1张你的牌。', bottom: '结束：你可以平移1张你的牌。若如此，翻转此牌。' },
  { defId: 'speed-4', protocol: 'speed', value: 4, middle: '平移1张对手的反面牌。' },
  { defId: 'speed-5', protocol: 'speed', value: 5, middle: '弃1张牌。' },

  // 爱——施中有得（AX01）
  { defId: 'love-1', protocol: 'love', value: 1, middle: '抽对手牌堆顶的牌。', bottom: '结束：你可以把1张手牌给对手。若如此，抽2张牌。' },
  { defId: 'love-2', protocol: 'love', value: 2, middle: '对手抽1张牌。刷新。' },
  { defId: 'love-3', protocol: 'love', value: 3, middle: '随机拿走1张对手的手牌。你把1张手牌给对手。' },
  { defId: 'love-4', protocol: 'love', value: 4, middle: '揭示1张你的手牌。翻转1张牌。' },
  { defId: 'love-5', protocol: 'love', value: 5, middle: '弃1张牌。' },
  { defId: 'love-6', protocol: 'love', value: 6, middle: '对手抽2张牌。' },

  // 恨——极尽鄙夷（AX01）
  { defId: 'hate-0', protocol: 'hate', value: 0, middle: '删除1张牌。' },
  { defId: 'hate-1', protocol: 'hate', value: 1, middle: '弃3张牌。删除1张牌。再删除1张牌。' },
  { defId: 'hate-2', protocol: 'hate', value: 2, middle: '删除你分值最高的牌。删除对手分值最高的牌。' },
  { defId: 'hate-3', protocol: 'hate', value: 3, top: '你的牌被删除后：抽1张牌。' },
  { defId: 'hate-4', protocol: 'hate', value: 4, bottom: '被盖住前：先删除此列分值最低的被盖住的牌。' },
  { defId: 'hate-5', protocol: 'hate', value: 5, middle: '弃1张牌。' },

  // 冷漠——不闻不问（AX01）
  { defId: 'apathy-0', protocol: 'apathy', value: 0, top: '此列每张反面牌给你此列总分加1。' },
  { defId: 'apathy-1', protocol: 'apathy', value: 1, middle: '翻转此列所有其他正面牌。' },
  { defId: 'apathy-2', protocol: 'apathy', value: 2, top: '无效化此列所有牌的中部命令。', bottom: '被盖住前：先翻转此牌。' },
  { defId: 'apathy-3', protocol: 'apathy', value: 3, middle: '翻转1张对手的正面牌。' },
  { defId: 'apathy-4', protocol: 'apathy', value: 4, middle: '你可以翻转1张你的被盖住的正面牌。' },
  { defId: 'apathy-5', protocol: 'apathy', value: 5, middle: '弃1张牌。' },
];
