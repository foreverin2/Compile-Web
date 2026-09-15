import type { CardDef, ProtocolDef } from '../core/models/types';

/**
 * 3代（官方 MN03）全部协议定义（15 套）与全部卡牌定义（每套 6 张）。
 *
 * 权威文本源：`E:\studyE\compile\正版compile\compile3\compile3文本.txt`（用户指定为准，
 * 2026-09-06 入库）。卡面图资源：`…\compile3\卡图\卡牌\Front\Not Rounded`（90 张，按
 * 「协议名+点数」命名）与 `…\compile3\卡图\协议\Not Rounded`（30 张，1=未编译 2=已编译）。
 * 用户 2026-09-06 拍板：**3代 图为成品方向（卡牌竖向正置、协议横向正置），直接使用不旋转**，
 * 与 1/2代（协议图竖版存储 + CSS rotate 横显）不同——UI 展示按世代（MN03/AX03）跳过旋转。
 *
 * 世代/扩展：基础 12 套 = 嫉妒/暴食/贪婪/色欲/傲慢/怠惰/暴怒/伏击/支点/压制/动量/新星
 * （txt 行 2 明列）；拓展 3 套 = 惰性/僵化/灵活（txt 末尾三套，卡图扫描尺寸亦不同，
 * 对应 1/2代 AX 拓展惯例）。set：MN03 / AX03。
 *
 * 资源命名修正（2026-09-06 用户操作）：协议图「懒惰」→「怠惰」、「2压垮」→「2压制」；
 * 卡牌图「懒惰0-5.png」→「怠惰0-5.png」（本会话已同步改名后入库）。
 *
 * 转写规则（同 cards.ts/cards2.ts）：数量词阿拉伯数字化（一张→1张、两张→2张…）；
 * 句末补句号；「空」= 无该指令不落字段；术语照录（**不归一**）。
 * 2026-09-13 文本同步：位移（shift）指令用词**全世代统一为「偏转」**（1代 txt 的「平移」
 * 亦已改写、2/3代原即「偏转」）；部分「链路」改写为「堆叠」。卡牌文本按 txt 照录
 * （引擎内部仍以 shift/线/堆叠为同一概念，仅文本用词不同；用词出处见 core/log.ts shiftTerm）。
 * 分值集合（依卡图文件名与 txt 核对）：嫉妒0-5/暴食0-5/贪婪0-5/色欲{0,2,3,4,5,6}/
 * 傲慢{0,2,3,4,5,6}/怠惰0-5/暴怒0-5/伏击0-5/支点0-5/压制1-6/动量{0,1,3,4,5,6}/
 * 新星0-5/惰性0-5/僵化{1,2,3,4,5,7}/灵活0-5。
 *
 * ⚠️ 效果未实现（2026-09-06 用户指示「先做卡图，不要求做效果」）：引擎对未注册卡安全空转
 * （EFFECTS[defId]?.middle/triggers 可选链）。本文件卡文为图鉴/开发者模式展示数据源，
 * 效果按后续批次裁决实现（见 docs/handoff §14）。
 */
export const ALL_PROTOCOLS_3: ProtocolDef[] = [
  // 3代 基础 12 套（MN03）
  { defId: 'envy', name: '嫉妒', set: 'MN03', commands: ['追赶', '翻转'], loadingText: '据为己有' },
  { defId: 'gluttony', name: '暴食', set: 'MN03', commands: ['抽牌', '清缓存', '删除'], loadingText: '欲壑难填' },
  { defId: 'greed', name: '贪婪', set: 'MN03', commands: ['弃牌', '重复效果'], loadingText: '贪得无厌' },
  { defId: 'lust', name: '色欲', set: 'MN03', commands: ['强制打出', '控制权'], loadingText: '惑乱人心' },
  { defId: 'pride', name: '傲慢', set: 'MN03', commands: ['领先', '偏转', '抽牌'], loadingText: '矜己自崇' },
  { defId: 'sloth', name: '怠惰', set: 'MN03', commands: ['弃牌', '翻转'], loadingText: '迁延因循' },
  { defId: 'wrath', name: '暴怒', set: 'MN03', commands: ['删除', '反面朝下'], loadingText: '睚眦必报' },
  { defId: 'ambush', name: '伏击', set: 'MN03', commands: ['翻转', '抽牌', '反面朝下'], loadingText: '潜形晦迹' },
  { defId: 'fulcrum', name: '支点', set: 'MN03', commands: ['抽牌', '交换', '手牌数量'], loadingText: '扭转乾坤' },
  { defId: 'overwhelm', name: '压制', set: 'MN03', commands: ['反面打出', '放大优势'], loadingText: '势压万钧' },
  { defId: 'momentum', name: '动量', set: 'MN03', commands: ['编译后', '抽牌'], loadingText: '蓄势待发' },
  { defId: 'nova', name: '新星', set: 'MN03', commands: ['堆叠数量', '偏转', '重排'], loadingText: '璀璨爆发' },
  // 3代 拓展 3 套（AX03）
  { defId: 'inertia', name: '惰性', set: 'AX03', commands: ['无效化', '正面朝上', '对称效果'], loadingText: '寂然不动' },
  { defId: 'rigidity', name: '僵化', set: 'AX03', commands: ['反面打出', '阻止'], loadingText: '坚不可摧' },
  { defId: 'flexibility', name: '灵活', set: 'AX03', commands: ['选择', '偏转', '抽牌'], loadingText: '随机应变' },
];

export const ALL_CARD_DEFS_3: CardDef[] = [
  // 嫉妒——据为己有
  { defId: 'envy-0', protocol: 'envy', value: 0, top: '此链路中，你的总阈值增加对手在此链路中最高阈值卡牌的阈值。' },
  { defId: 'envy-1', protocol: 'envy', value: 1, middle: '若对手拥有控制权，你可以翻转1张牌。', bottom: '开始：若对手拥有控制权，获得控制权。' },
  { defId: 'envy-2', protocol: 'envy', value: 2, middle: '抽取等同于对手手牌数量的牌。' },
  { defId: 'envy-3', protocol: 'envy', value: 3, bottom: '当对手在此链路打出1张牌后：从你的牌库顶端反面打出1张牌到此链路。' },
  { defId: 'envy-4', protocol: 'envy', value: 4, middle: '若对手已编译的协议比你多，翻转1张牌。' },
  { defId: 'envy-5', protocol: 'envy', value: 5, middle: '弃1张牌。' },

  // 暴食——欲壑难填
  { defId: 'gluttony-0', protocol: 'gluttony', value: 0, top: '当你清缓存后：从你的牌库顶端反面打出1张牌。', middle: '回手1张其他牌。抽1张牌。' },
  { defId: 'gluttony-1', protocol: 'gluttony', value: 1, middle: '抽2张牌。', bottom: '当任意玩家清缓存后：删除1张牌。' },
  { defId: 'gluttony-2', protocol: 'gluttony', value: 2, middle: '抽取等同于你手牌数量的牌。' },
  { defId: 'gluttony-3', protocol: 'gluttony', value: 3, top: '结束：若此牌被1张正面朝上的牌覆盖，删除那张牌。', middle: '抽2张牌。' },
  { defId: 'gluttony-4', protocol: 'gluttony', value: 4, bottom: '当你刷新后：抽1张牌。' },
  { defId: 'gluttony-5', protocol: 'gluttony', value: 5, middle: '弃1张牌。' },

  // 贪婪——贪得无厌
  { defId: 'greed-0', protocol: 'greed', value: 0, middle: '弃置你的手牌。删除1张牌。', bottom: '当你删除牌后：抽1张牌。' },
  { defId: 'greed-1', protocol: 'greed', value: 1, bottom: '结束：在1条你有至少10点阈值且总阈值高于对手的链路中编译。' },
  { defId: 'greed-2', protocol: 'greed', value: 2, middle: '对手弃1张牌。', bottom: '开始：你可以回手1张你的牌。' },
  { defId: 'greed-3', protocol: 'greed', value: 3, middle: '偏转你在此堆叠中1张被覆盖的牌。' },
  { defId: 'greed-4', protocol: 'greed', value: 4, middle: '你可以弃置手牌。若你达成该条件，翻转1张牌。' },
  { defId: 'greed-5', protocol: 'greed', value: 5, middle: '弃1张牌。' },

  // 色欲——惑乱人心
  { defId: 'lust-0', protocol: 'lust', value: 0, top: '每位玩家在此链路的总阈值增加10。', middle: '获得控制权。', bottom: '若你拥有控制权，对手无法编译。' },
  { defId: 'lust-2', protocol: 'lust', value: 2, middle: '你可以将对手1张被覆盖的牌偏转到此链路。', bottom: '你的牌可以无视协议限制打在此堆叠中。' },
  { defId: 'lust-3', protocol: 'lust', value: 3, middle: '对手随机揭示手牌中的1张牌。将那张牌反面打出在对手一侧。', bottom: '结束：你可以失去控制权。若你达成该条件，翻转1张牌。' },
  { defId: 'lust-4', protocol: 'lust', value: 4, middle: '揭示你的手牌。对手失去控制权。', bottom: '当对手获得控制权后：抽1张牌。' },
  { defId: 'lust-5', protocol: 'lust', value: 5, middle: '弃1张牌。' },
  { defId: 'lust-6', protocol: 'lust', value: 6, middle: '弃1张牌。对手在此链路反面打出1张牌。' },

  // 傲慢——矜己自崇
  { defId: 'pride-0', protocol: 'pride', value: 0, top: '当你编译后：刷新。', middle: '若你拥有控制权，偏转1张其他牌。否则，偏转1张你的牌。' },
  { defId: 'pride-2', protocol: 'pride', value: 2, middle: '你每有1条总阈值高于对手的链路就抽1张牌。', bottom: '开始：若你在此链路总阈值高于对手，抽1张牌。' },
  { defId: 'pride-3', protocol: 'pride', value: 3, middle: '翻转1张你的反面朝下的牌。' },
  { defId: 'pride-4', protocol: 'pride', value: 4, middle: '若你拥有控制权，你可以将对手1张牌偏转到此链路。' },
  { defId: 'pride-5', protocol: 'pride', value: 5, middle: '弃1张牌。' },
  { defId: 'pride-6', protocol: 'pride', value: 6, top: '当对手获得控制权后：翻转此牌。', middle: '若对手拥有控制权，翻转此牌。' },

  // 怠惰——迁延因循
  { defId: 'sloth-0', protocol: 'sloth', value: 0, top: '若此牌被1张怠惰牌覆盖，你在此链路的总阈值增加5。', middle: '你每有1条总阈值低于对手的链路就抽1张牌。' },
  { defId: 'sloth-1', protocol: 'sloth', value: 1, middle: '回手1张其他牌。若回手的是你的牌，刷新。', bottom: '当你刷新后：从你的牌库顶端反面打出1张牌到此堆叠。' },
  { defId: 'sloth-2', protocol: 'sloth', value: 2, middle: '翻转1张你被覆盖的牌。', bottom: '开始：你可以将手牌中的1张牌放回牌库底端。' },
  { defId: 'sloth-3', protocol: 'sloth', value: 3, middle: '对手弃2张牌。' },
  { defId: 'sloth-4', protocol: 'sloth', value: 4, bottom: '当此牌将被覆盖时：先翻转1张正面朝上的牌。' },
  { defId: 'sloth-5', protocol: 'sloth', value: 5, middle: '弃1张牌。' },

  // 暴怒——睚眦必报
  { defId: 'wrath-0', protocol: 'wrath', value: 0, top: '此链路中所有最高阈值的牌不计入玩家的总阈值。', middle: '从你的牌库顶端反面打出1张牌到此堆叠。' },
  { defId: 'wrath-1', protocol: 'wrath', value: 1, middle: '抽1张牌。', bottom: '结束：失去控制权。若你达成该条件，删除1张正面朝上的牌。' },
  { defId: 'wrath-2', protocol: 'wrath', value: 2, middle: '翻转牌最多的1条链路中所有正面朝上的牌。' },
  { defId: 'wrath-3', protocol: 'wrath', value: 3, middle: '翻转1张正面朝上的牌。' },
  { defId: 'wrath-4', protocol: 'wrath', value: 4, middle: '失去控制权。若你达成该条件，对手弃2张牌。' },
  { defId: 'wrath-5', protocol: 'wrath', value: 5, middle: '弃1张牌。' },

  // 伏击——潜形晦迹
  { defId: 'ambush-0', protocol: 'ambush', value: 0, middle: '抽3张牌。翻转1张你的反面朝下的牌。' },
  { defId: 'ambush-1', protocol: 'ambush', value: 1, middle: '翻转你所有其他阈值为0和1的牌。每翻转1张牌抽1张牌。' },
  { defId: 'ambush-2', protocol: 'ambush', value: 2, middle: '偏转你阈值最低的被覆盖的牌。' },
  { defId: 'ambush-3', protocol: 'ambush', value: 3, middle: '翻转对手阈值最高的正面朝上的被覆盖的牌。' },
  { defId: 'ambush-4', protocol: 'ambush', value: 4, middle: '若你有1张未被覆盖的反面朝下的牌，抽1张牌。' },
  { defId: 'ambush-5', protocol: 'ambush', value: 5, middle: '弃1张牌。' },

  // 支点——扭转乾坤
  { defId: 'fulcrum-0', protocol: 'fulcrum', value: 0, top: '开始：若你手牌恰好为0张，对手弃2张牌。', middle: '若你手牌恰好为0张，对手弃1张牌。' },
  { defId: 'fulcrum-1', protocol: 'fulcrum', value: 1, middle: '翻转所有其他正面朝上的牌。交换你的左堆叠与右堆叠。' },
  { defId: 'fulcrum-2', protocol: 'fulcrum', value: 2, middle: '若你手牌恰好为2张，删除对手1张牌。' },
  { defId: 'fulcrum-3', protocol: 'fulcrum', value: 3, middle: '抽1张牌。交换你的左协议与右协议的位置。' },
  { defId: 'fulcrum-4', protocol: 'fulcrum', value: 4, middle: '若你手牌恰好为4张，抽1张牌。' },
  { defId: 'fulcrum-5', protocol: 'fulcrum', value: 5, middle: '弃1张牌。' },

  // 压制——势压万钧
  { defId: 'overwhelm-1', protocol: 'overwhelm', value: 1, middle: '在每条你总阈值高于对手的链路中，从你的牌库顶端反面打出1张牌。' },
  { defId: 'overwhelm-2', protocol: 'overwhelm', value: 2, top: '结束：在每条链路中从你的牌库顶端反面打出1张牌。翻转此牌。', middle: '对手在每条链路中从其牌库顶端反面打出1张牌。' },
  { defId: 'overwhelm-3', protocol: 'overwhelm', value: 3, bottom: '结束：若你手牌有5张或以上，从你的牌库顶端反面打出1张牌到此堆叠。' },
  { defId: 'overwhelm-4', protocol: 'overwhelm', value: 4, middle: '若你场上的牌比对手多，删除对手阈值最低的被覆盖的牌。' },
  { defId: 'overwhelm-5', protocol: 'overwhelm', value: 5, middle: '弃1张牌。' },
  { defId: 'overwhelm-6', protocol: 'overwhelm', value: 6, top: '开始：若对手在此链路总阈值高于你，翻转此牌。' },

  // 动量——蓄势待发
  { defId: 'momentum-0', protocol: 'momentum', value: 0, middle: '在每条有已编译协议的链路中，从你的牌库顶端反面打出1张牌。' },
  { defId: 'momentum-1', protocol: 'momentum', value: 1, top: '当任意玩家编译后：从你的牌库顶端反面打出1张牌到此堆叠。', bottom: '当任意玩家重排协议后：弃1张牌。抽1张牌。' },
  { defId: 'momentum-3', protocol: 'momentum', value: 3, middle: '抽2张牌。' },
  { defId: 'momentum-4', protocol: 'momentum', value: 4, middle: '重排你的协议。' },
  { defId: 'momentum-5', protocol: 'momentum', value: 5, middle: '弃1张牌。' },
  { defId: 'momentum-6', protocol: 'momentum', value: 6, top: '当任意玩家编译后：删除此牌。', middle: '弃1张牌。' },

  // 新星——璀璨爆发
  { defId: 'nova-0', protocol: 'nova', value: 0, top: '开始：在1条你恰好有5张牌的链路中，删除所有正面朝上的牌。', middle: '拥有控制权的玩家交换你的2张协议的位置。', bottom: '结束：在1张未被覆盖的新星牌下方，从你的牌库顶端反面打出1张牌。' },
  { defId: 'nova-1', protocol: 'nova', value: 1, middle: '对手弃等同于此堆叠中牌数量的牌。' },
  { defId: 'nova-2', protocol: 'nova', value: 2, middle: '若此牌覆盖着1张新星牌，你可以重排你的协议。否则，获得控制权。', bottom: '当你重排协议后：你可以偏转1张反面朝下的牌。' },
  { defId: 'nova-3', protocol: 'nova', value: 3, middle: '偏转1张阈值小于此堆叠中牌数量的牌。' },
  { defId: 'nova-4', protocol: 'nova', value: 4, middle: '翻转1张阈值小于此堆叠中牌数量的牌。' },
  { defId: 'nova-5', protocol: 'nova', value: 5, middle: '弃1张牌。' },

  // 惰性——寂然不动
  { defId: 'inertia-0', protocol: 'inertia', value: 0, top: '此链路中所有其他牌的顶部指令无效。', middle: '翻转另1条链路中1张无论是否被覆盖的正面朝上的牌。' },
  { defId: 'inertia-1', protocol: 'inertia', value: 1, middle: '对手弃2张牌。', bottom: '此链路中所有其他牌的底部指令无效。' },
  { defId: 'inertia-2', protocol: 'inertia', value: 2, middle: '翻转1条链路中所有阈值最高的正面朝上的牌。' },
  { defId: 'inertia-3', protocol: 'inertia', value: 3, middle: '在每条其他链路中反面打出1张牌。对手在此链路中反面打出1张牌。' },
  { defId: 'inertia-4', protocol: 'inertia', value: 4, middle: '弃置你的牌库。对手弃置其牌库。' },
  { defId: 'inertia-5', protocol: 'inertia', value: 5, middle: '弃1张牌。' },

  // 僵化——坚不可摧
  { defId: 'rigidity-1', protocol: 'rigidity', value: 1, middle: '翻转对手1张正面朝上的牌。', bottom: '结束：在每条对手有未被覆盖的反面牌的链路中以反面打出1张牌到己方对应的链路中。' },
  { defId: 'rigidity-2', protocol: 'rigidity', value: 2, bottom: '在你用行动反面打出1张牌后：从你的牌库顶端反面打出1张牌到同一堆叠。' },
  { defId: 'rigidity-3', protocol: 'rigidity', value: 3, middle: '在此牌正下方反面打出1张牌。' },
  { defId: 'rigidity-4', protocol: 'rigidity', value: 4, bottom: '当此牌将被1张反面朝下的牌覆盖时：先抽1张牌。' },
  { defId: 'rigidity-5', protocol: 'rigidity', value: 5, middle: '弃1张牌。' },
  { defId: 'rigidity-7', protocol: 'rigidity', value: 7, top: '结束：对手选择抽1张牌或打出1张牌。', middle: '弃1张牌。', bottom: '此牌不能被翻转或偏转。' },

  // 灵活——随机应变
  { defId: 'flexibility-0', protocol: 'flexibility', value: 0, middle: '回手或偏转1张牌。' },
  { defId: 'flexibility-1', protocol: 'flexibility', value: 1, middle: '翻转或偏转你的1张牌。' },
  { defId: 'flexibility-2', protocol: 'flexibility', value: 2, top: '结束：若此牌被1张反面朝下的牌覆盖，你可以偏转那张牌。', middle: '抽1张牌。' },
  { defId: 'flexibility-3', protocol: 'flexibility', value: 3, middle: '偏转对手的1张牌，或交换你的2个协议。' },
  { defId: 'flexibility-4', protocol: 'flexibility', value: 4, bottom: '结束：你可以抽2张牌。若你达成该条件，翻转此牌。' },
  { defId: 'flexibility-5', protocol: 'flexibility', value: 5, middle: '弃1张牌。' },
];

