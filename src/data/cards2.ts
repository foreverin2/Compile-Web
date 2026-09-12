import type { CardDef, ProtocolDef } from '../core/models/types';

/**
 * 2代（官方 MN02）全部协议定义（15 套）与全部卡牌定义（每套 6 张）。
 *
 * 权威文本源：`E:\studyE\compile\正版compile\compile2\compile2文本.txt`（用户指定为准，
 * 2026-09-03；2026-09-04 用户再次更新该文件——正版与 `自制compile\compile1\` 下为
 * 同内容镜像副本）。文本为中文（游戏 UI 语言）；格式 `甲x：A/B/C`：A=顶部指令、B=中部指令、
 * C=底部指令；「空」= 无该指令。
 *
 * 本模块独立于 `cards.ts`（1代）。2026-09-03 用户拍板「直接并入协议选择池」：DEMO 池 =
 * 1代 + 2代 共 30 套（见 data/demo.ts）。2代 90 张卡效果尚未注册——引擎对未注册效果
 * 安全空转（EFFECTS[defId]?.middle/triggers 可选链），可正常打出/编译但卡文本无实际
 * 效果；后续按协议分任务实现（见 docs/handoff §9）。
 *
 * 译名：现行译名 = 幸运/明镜/和平/混乱/恐惧/明晰/腐化/时间/战争/勇气/寒冰/烟雾/同化/
 * 多元/统一（defId：luck/mirror/peace/chaos/fear/clarity/corruption/time/war/courage/
 * ice/smoke/assimilation/diversity/unity，与 1代 无冲突）。2026-09-04 用户拍板：
 * 除「混乱/腐化」外全部跟随 txt 标题（diversity「多样性」→「多元」、ice「冰」→「寒冰」；
 * txt「混沌/腐败」不采用）。
 *
 * 转写规则（无损改写，均已注明）：
 *  - 数量词阿拉伯数字化（三→3、两张→2张…）；补全句末句号
 *  - 明显笔误修正（仅剩两处，均为本文件初版独有、txt 未含）：`战争2`「它」→「对手」；
 *    `烟雾2` 衍字「牌」删去（txt 原「每有一张牌正面朝下的卡牌」）
 *  - 自称协议名照 txt：多元/统一 等直接照录（无归一；旧「多元→多样性」归一已随
 *    2026-09-04 用户改 txt 撤销）
 *  - 术语不改写：偏转/阈值/总阈值/召回/中央效果/切洗/正面朝下 等保留原文——其精确语义
 *    （如偏转=Shift=平移）留待效果实现阶段逐张裁决（按惯例附原文问用户）
 *  - 异文注释：txt 与自制 docx 排版稿语义冲突处以 `// txt:…/docx:…` 注释标记，不自行裁决
 *  - 卡面图片（英文扫描）为唯一视觉权威；本数据文本仅作效果实现语义源
 *
 * commands/loadingText：commands 依自制 docx 协议正面关键词（寒冰=平移,阻止…）并与
 * 2代说明书.PDF 英文关键词（ICE: SHIFT,PREVENT…）交叉，冲突处取 PDF 语义；
 * loadingText = 各协议四字座右铭，2026-09-04 起跟随 compile2文本.txt 标题副题
 * （txt「XX——四字」，用户更新版；旧值取自制 docx 协议正面 4 字题，如滑腻如冰/一目了然，
 * 已整体替换）。loadingText 当前为数据储备（UI 未展示），后续座右铭展示需求用此字段。
 *
 * 卡面资源为 JPEG（英文扫描源照片；1代 为官方 TTS PNG）。UI 取图统一走 data/demo 的
 * cardImgSrc/protocolImgSrc/protocolImgExt（世代扩展名规则：MN01/AX01=.png、MN02/AX02=.jpg）。
 *
 * 分值集合（依 txt 卡文逐条核对）：寒冰1-6、明镜0-5、和平1-6、混乱0-5、恐惧0-5、明晰0-5、
 * 腐化{0,1,2,3,5,6}、时间0-5、战争0-5、勇气{0,1,2,3,5,6}、幸运0-5、烟雾0-5、
 * 同化{0,1,2,4,5,6}、多元{0,1,3,4,5,6}、统一0-5。
 *
 * 权威源修订（用户 2026-09-03 23:54 改 txt，本文件已同步）：三处「被覆盖或为被覆盖」
 * →「被覆盖或未被覆盖」（腐化3/同化0，与初版转写修正一致）；「空?」→「空」= 确认无
 * 底部指令（腐化3/时间3/同化0，初版即未落 bottom 字段）；时间3「反面打出」→
 * 「正面朝下打出」（同义，面朝下=反面，跟用户用词）。
 *
 * 权威源修订 2（用户 2026-09-04 22:11 改 txt，本文件已同步）：明晰4「弃牌堆吸[错字]入
 * 牌库」→「洗入牌库」；烟雾1「翻转你的1张卡牌」语序对齐 txt「翻转1张你的卡牌」；
 * diversity 协议名与卡文指代「多样性」→「多元」；ice 协议名「冰」→「寒冰」；
 * 15 套 loadingText（座右铭）→ txt 标题副题批（幸运孤注一掷/明镜照见本真/和平暂得安歇/
 * 混乱祸福难料/明晰吾道已明/寒冰寒锐诡谲/烟雾弥天障雾/恐惧速速退避/腐化独恶殃众/战争
 * 鏖战何归/勇气逆焰燎原/时间溯往前行/同化互通相契/多元殊异成锋/统一合众则刚）。
 *
 * 权威源修订 3（用户 2026-09-05 改 txt「compile2文本修改记录.txt」，本文件已同步 7/8 处）：
 *   【1】腐化3 删「或未被覆盖」（仅翻被覆盖的正面卡）；【2】腐化0 补「除此牌外的」；
 *   【3】恐惧4 →「对手随机弃置1张牌」（原「抽取对手的1张卡牌然后弃置」，操作方式错误）；
 *   【4】混乱0 底 回合结束→回合开始；【5】统一4 顶 回合结束→回合开始；
 *   【7】勇气1 补「对手的」（删除对象限对手牌）；【8】多元6 至少4种→至少3种。
 *   【6】时间2 洗入弃牌堆效果 中部→底部：**未同步**——用户 2026-09-06 拍板维持中部主动
 *   （compile-apo 亦作 middle on_play；英文卡面待用户复核后再定，见 docs/handoff §12 待办）。
 */

export const ALL_PROTOCOLS_2: ProtocolDef[] = [
  // 2代 基础版 12 套（MN02）。中文名除「混乱/腐化」外均跟随 compile2文本.txt 标题
  // （用户 2026-09-04 拍板：txt「混沌/腐败」不采用，保留游戏内「混乱/腐化」；冰→寒冰）。
  { defId: 'ice', name: '寒冰', set: 'MN02', commands: ['平移', '阻止'], loadingText: '寒锐诡谲' },
  { defId: 'mirror', name: '明镜', set: 'MN02', commands: ['平移', '复制'], loadingText: '照见本真' },
  { defId: 'peace', name: '和平', set: 'MN02', commands: ['相互弃牌', '抽牌'], loadingText: '暂得安歇' },
  { defId: 'chaos', name: '混乱', set: 'MN02', commands: ['抽牌', '重排', '被覆盖'], loadingText: '祸福难料' },
  { defId: 'fear', name: '恐惧', set: 'MN02', commands: ['平移', '弃牌'], loadingText: '速速退避' },
  { defId: 'clarity', name: '透彻', set: 'MN02', commands: ['抽牌', '揭示'], loadingText: '吾道已明' },
  { defId: 'corruption', name: '腐化', set: 'MN02', commands: ['翻转', '弃牌'], loadingText: '独恶殃众' },
  { defId: 'time', name: '时间', set: 'MN02', commands: ['弃牌', '弃牌堆'], loadingText: '溯往前行' },
  { defId: 'war', name: '战争', set: 'MN02', commands: ['反击', '弃牌'], loadingText: '鏖战何归' },
  { defId: 'courage', name: '勇气', set: 'MN02', commands: ['抽牌', '对比'], loadingText: '逆焰燎原' },
  { defId: 'luck', name: '幸运', set: 'MN02', commands: ['随机', '删除', '打出'], loadingText: '孤注一掷' },
  { defId: 'smoke', name: '迷雾', set: 'MN02', commands: ['反面打出', '平移'], loadingText: '弥天障雾' },
  // 2代 拓展 3 套（AX02，协议卡面编号待卡面核对）
  { defId: 'assimilation', name: '同化', set: 'AX02', commands: ['交换', '打出'], loadingText: '互通相契' },
  { defId: 'diversity', name: '多元', set: 'AX02', commands: ['打出', '对比', '编译'], loadingText: '殊异成锋' },
  { defId: 'unity', name: '联合', set: 'AX02', commands: ['覆盖', '翻转', '编译'], loadingText: '合众则刚' },
];

export const ALL_CARD_DEFS_2: CardDef[] = [
  // 幸运——投掷骰子
  { defId: 'luck-0', protocol: 'luck', value: 0, middle: '宣告1个数字。抽取3张牌。从中揭示1张阈值与你宣告数字相同的牌，你可以打出它。' },
  { defId: 'luck-1', protocol: 'luck', value: 1, middle: '从牌库顶端反面打出1张牌。翻转那张牌，无视中央效果。' },
  { defId: 'luck-2', protocol: 'luck', value: 2, middle: '弃置你牌库顶端的牌，抽取与其阈值相同的牌。' },
  { defId: 'luck-3', protocol: 'luck', value: 3, middle: '宣告1个协议。从对手牌库顶端弃置1张牌，若此牌与宣告协议相同，删除1张牌。' },
  { defId: 'luck-4', protocol: 'luck', value: 4, middle: '从牌库顶端弃置1张牌。删除1张被覆盖或未被覆盖的阈值相同的卡牌。' },
  { defId: 'luck-5', protocol: 'luck', value: 5, middle: '你弃置1张牌。' },

  // 明镜——真理的映像
  { defId: 'mirror-0', protocol: 'mirror', value: 0, top: '此链路中，对手每有1张牌，你的总阈值就加1。' },
  { defId: 'mirror-1', protocol: 'mirror', value: 1, bottom: '回合结束：你可以选择对手的1张牌，复制其中央效果。' },
  // 明镜2 异文：docx 作「互换你任意两栈中的所有的牌」（交换两链路的所有牌 vs 交换两链路位置）
  { defId: 'mirror-2', protocol: 'mirror', value: 2, middle: '整体交换你两条链路中的牌。' },
  { defId: 'mirror-3', protocol: 'mirror', value: 3, middle: '翻转你的1张牌。在同一链路中翻转对手的1张牌。' },
  { defId: 'mirror-4', protocol: 'mirror', value: 4, bottom: '当对手抽牌时：你抽1张牌。' },
  { defId: 'mirror-5', protocol: 'mirror', value: 5, middle: '你弃置1张牌。' },

  // 和平——尽我们所能暂停危机
  { defId: 'peace-1', protocol: 'peace', value: 1, middle: '所有玩家弃置所有手牌。', bottom: '回合结束：若你没有手牌，抽取1张牌。' },
  { defId: 'peace-2', protocol: 'peace', value: 2, middle: '抽取1张牌。反面打出1张牌。' },
  { defId: 'peace-3', protocol: 'peace', value: 3, middle: '你可以弃置一张牌。翻转一张阈值大于你当前手牌数的卡牌。' },
  { defId: 'peace-4', protocol: 'peace', value: 4, bottom: '在对手回合中你弃置卡牌时：抽1张牌。' },
  { defId: 'peace-5', protocol: 'peace', value: 5, middle: '你弃置1张牌。' },
  { defId: 'peace-6', protocol: 'peace', value: 6, middle: '若你手牌数超过1，翻转此牌。' },

  // 混乱——不可预测，当心！
  { defId: 'chaos-0', protocol: 'chaos', value: 0, middle: '在每条链路中，各翻转1张被覆盖的牌。', bottom: '回合开始：你从对手的牌库中抽取1张牌。对手从你的牌库中抽取1张牌。' },
  { defId: 'chaos-1', protocol: 'chaos', value: 1, middle: '重新排列你的协议。重新排列对手的协议。' },
  { defId: 'chaos-2', protocol: 'chaos', value: 2, middle: '偏转1张你的被覆盖的卡牌。' },
  { defId: 'chaos-3', protocol: 'chaos', value: 3, bottom: '此牌可以无视协议限制打在任意链路中。' },
  { defId: 'chaos-4', protocol: 'chaos', value: 4, bottom: '回合结束：弃置所有手牌，抽取相同数目的卡牌。' },
  { defId: 'chaos-5', protocol: 'chaos', value: 5, middle: '你弃置1张牌。' },

  // 明晰——我能看得清我自己路
  { defId: 'clarity-0', protocol: 'clarity', value: 0, top: '此链路中，你每有1张牌，总阈值就加1。' },
  { defId: 'clarity-1', protocol: 'clarity', value: 1, top: '回合开始：揭示你的牌库顶端的卡牌。你可以弃置牌库顶端的卡牌。', middle: '对手揭示其手牌。', bottom: '当此牌被覆盖时：抽3张牌。' },
  { defId: 'clarity-2', protocol: 'clarity', value: 2, middle: '揭示你的牌库。从中抽取1张阈值为1的卡牌。切洗你的牌库。打出1张阈值为1的卡牌。' },
  { defId: 'clarity-3', protocol: 'clarity', value: 3, middle: '揭示你的牌库。从中抽取1张阈值为5的卡牌。切洗你的卡牌。' },
  { defId: 'clarity-4', protocol: 'clarity', value: 4, middle: '你可以将弃牌堆洗入牌库。' },
  { defId: 'clarity-5', protocol: 'clarity', value: 5, middle: '你弃置1张牌。' },

  // 冰——寒冷，强大，平滑
  { defId: 'ice-1', protocol: 'ice', value: 1, middle: '你可以偏转此牌。', bottom: '对手在此链路出牌后：他要弃置1张牌。' },
  { defId: 'ice-2', protocol: 'ice', value: 2, middle: '偏转1张其它牌。' },
  { defId: 'ice-3', protocol: 'ice', value: 3, top: '回合结束：当这张牌被覆盖时，你可以偏转此牌。' },
  { defId: 'ice-4', protocol: 'ice', value: 4, bottom: '此牌不可被翻转。' },
  { defId: 'ice-5', protocol: 'ice', value: 5, middle: '你弃置1张牌。' },
  { defId: 'ice-6', protocol: 'ice', value: 6, top: '如果你有手牌，那么你不可以抽牌。' },

  // 烟雾——使人迷茫的笼罩
  { defId: 'smoke-0', protocol: 'smoke', value: 0, middle: '从你的牌库顶端向每条有正面朝下的卡牌的链路反面打出1张牌。' },
  { defId: 'smoke-1', protocol: 'smoke', value: 1, middle: '翻转1张你的卡牌。你可以偏转此牌。' },
  { defId: 'smoke-2', protocol: 'smoke', value: 2, top: '此链路中，每有1张正面朝下的卡牌，总阈值就加1。' },
  { defId: 'smoke-3', protocol: 'smoke', value: 3, middle: '在1条有正面朝下的卡牌的链路中反面打出1张卡牌。' },
  { defId: 'smoke-4', protocol: 'smoke', value: 4, middle: '偏转1张被覆盖的、正面朝下的卡牌。' },
  { defId: 'smoke-5', protocol: 'smoke', value: 5, middle: '你弃置1张牌。' },

  // 恐惧——你给路打油！！！
  { defId: 'fear-0', protocol: 'fear', value: 0, top: '在你的回合内，对手无法触发中央效果。', middle: '偏转或翻转1张卡牌。' },
  // 恐惧1 异文：docx 作「对手弃掉其手牌，并抽取弃牌数减一张牌」（弃牌数-1，语义以弃牌数为准待裁决）
  { defId: 'fear-1', protocol: 'fear', value: 1, middle: '抽2张牌。对手弃置所有手牌，然后抽取手牌数-1的卡牌。' },
  { defId: 'fear-2', protocol: 'fear', value: 2, middle: '召回对手的1张牌。' },
  { defId: 'fear-3', protocol: 'fear', value: 3, middle: '偏转1张对手在此链路中的被覆盖或未被覆盖的卡牌。' },
  // 恐惧4：2026-09-05 txt 修改记录【3】修订（操作方式错误）：「抽取对手的1张卡牌，然后将其弃置」
  //   →「对手随机弃置1张牌」（英文 Your opponent discards 1 random card.；与 docx「随机弃」口径一致）
  { defId: 'fear-4', protocol: 'fear', value: 4, middle: '对手随机弃置1张牌。' },
  { defId: 'fear-5', protocol: 'fear', value: 5, middle: '你弃置1张牌。' },

  // 腐化——一颗老鼠屎，坏了一锅粥
  { defId: 'corruption-0', protocol: 'corruption', value: 0, top: '回合开始：在此链路中，翻转1张除此牌外的被覆盖或未被覆盖的正面朝上的卡牌。', bottom: '此牌可以打在任意一方的任意协议处。' },
  { defId: 'corruption-1', protocol: 'corruption', value: 1, middle: '召回1张卡牌。', bottom: '当对手的卡牌被召回时：将那张牌正面朝下放回他的牌库。' },
  { defId: 'corruption-2', protocol: 'corruption', value: 2, top: '当你弃牌后：对手弃置1张牌。', middle: '抽1张牌。弃置1张牌。' },
  // 腐化3：2026-09-05 txt 修改记录【1】修订（效果范围错误）：2026-09-03 所改「被覆盖或未被覆盖」
  //  撤销 → 仅「被覆盖」（英文 You may flip 1 face-up covered card.；空?→空=无底部指令）
  { defId: 'corruption-3', protocol: 'corruption', value: 3, middle: '你可以翻转1张被覆盖的正面朝上的卡牌。' },
  { defId: 'corruption-5', protocol: 'corruption', value: 5, middle: '你弃置1张牌。' },
  { defId: 'corruption-6', protocol: 'corruption', value: 6, top: '回合结束：你弃置1张牌或删除此牌。' },

  // 战争——愤怒与冲突，但目的是？
  { defId: 'war-0', protocol: 'war', value: 0, top: '当你刷新时：你可以翻转此牌。', bottom: '当对手抽牌时：你可以删除1张卡牌。' },
  { defId: 'war-1', protocol: 'war', value: 1, bottom: '当对手刷新时：弃置任意数目的卡牌，然后刷新。' },
  { defId: 'war-2', protocol: 'war', value: 2, middle: '翻转1张牌。', bottom: '当对手编译后：对手弃置所有手牌。' },
  { defId: 'war-3', protocol: 'war', value: 3, middle: '抽取1张牌。', bottom: '当对手弃牌后：你可以反面打出1张卡牌。' },
  { defId: 'war-4', protocol: 'war', value: 4, middle: '对手弃置1张牌。' },
  { defId: 'war-5', protocol: 'war', value: 5, middle: '你弃置1张牌。' },

  // 勇气——面对逆境的火焰
  { defId: 'courage-0', protocol: 'courage', value: 0, top: '回合开始：若你没有手牌，抽取1张牌。', middle: '抽取1张牌。', bottom: '回合结束：你可以弃置1张牌，若你这么做，对手弃置1张牌。' },
  { defId: 'courage-1', protocol: 'courage', value: 1, middle: '在1条对手总阈值更大的链路中删除对手的1张牌。' },
  { defId: 'courage-2', protocol: 'courage', value: 2, middle: '抽取1张牌。', bottom: '回合结束：此链路中，若对手总阈值更大，抽取1张牌。' },
  { defId: 'courage-3', protocol: 'courage', value: 3, bottom: '回合结束：你可以将此牌偏转进入对手总阈值最大的链路中。' },
  { defId: 'courage-5', protocol: 'courage', value: 5, middle: '你弃置1张牌。' },
  { defId: 'courage-6', protocol: 'courage', value: 6, bottom: '回合结束：若此链路中对手总阈值更大，翻转此牌。' },

  // 时间——追忆过往
  { defId: 'time-0', protocol: 'time', value: 0, middle: '从弃牌堆中打出1张牌。将你的弃牌堆洗入牌库。' },
  { defId: 'time-1', protocol: 'time', value: 1, middle: '翻转1张被覆盖的卡牌。将牌库所有牌放入弃牌堆。' },
  { defId: 'time-2', protocol: 'time', value: 2, top: '当你切洗牌库时：抽取1张牌。你可以偏转此牌。', middle: '若你的弃牌堆有牌，你可以将弃牌堆洗入牌库。' },
  // 时间3：用户 2026-09-03 修订 txt（反面打出→正面朝下打出；空?→空=无底部指令）；
  // 「打出于其它链路」的「于」照录 txt——若语义为「至/在」需效果阶段按卡面确认（docx 作「将其面朝下放入一列中」）
  { defId: 'time-3', protocol: 'time', value: 3, middle: '揭示1张弃牌堆的牌。将其正面朝下打出于其它链路。' },
  { defId: 'time-4', protocol: 'time', value: 4, middle: '抽2张牌。弃置2张牌。' },
  { defId: 'time-5', protocol: 'time', value: 5, middle: '你弃置1张牌。' },

  // 多元——不同是我们的力量
  { defId: 'diversity-0', protocol: 'diversity', value: 0, middle: '若场上有6张不同协议的卡牌，将多元协议翻转至已编译。', bottom: '回合结束：你可以将1张不是多元的卡牌打入此链路。' },
  { defId: 'diversity-1', protocol: 'diversity', value: 1, middle: '偏转1张牌。抽取与此链路中不同协议的卡牌数相同的卡牌。' },
  { defId: 'diversity-3', protocol: 'diversity', value: 3, top: '若此链路中有任何非多元的正面朝上的卡牌，你的总阈值加2。' },
  { defId: 'diversity-4', protocol: 'diversity', value: 4, middle: '翻转1张阈值小于场上不同协议卡牌数目的牌。' },
  { defId: 'diversity-5', protocol: 'diversity', value: 5, middle: '你弃置1张牌。' },
  { defId: 'diversity-6', protocol: 'diversity', value: 6, top: '回合结束：若场上没有至少3种不同协议的卡牌，删除此牌。' },

  // 同化——完全改变与理解
  // 同化0：用户 2026-09-03 修订 txt（为被覆盖→未被覆盖；空?→空=无底部指令）
  { defId: 'assimilation-0', protocol: 'assimilation', value: 0, middle: '将对手一张无论是否被覆盖的正面朝下的卡牌加入手牌。' },
  { defId: 'assimilation-1', protocol: 'assimilation', value: 1, middle: '弃置1张牌。刷新。', bottom: '当有人刷新时：从对手的牌库中抽取1张牌。弃置1张牌到对手的弃牌堆。' },
  { defId: 'assimilation-2', protocol: 'assimilation', value: 2, bottom: '回合结束：将对手牌库顶端的牌反面打在此链路。' },
  { defId: 'assimilation-4', protocol: 'assimilation', value: 4, middle: '从对手牌库顶端抽取1张牌。对手从你的牌库顶端抽取1张牌。' },
  { defId: 'assimilation-5', protocol: 'assimilation', value: 5, middle: '你弃置1张牌。' },
  { defId: 'assimilation-6', protocol: 'assimilation', value: 6, bottom: '回合结束：将牌库顶端的牌反面打在对手的一侧。' },

  // 统一——团结使我们强大
  { defId: 'unity-0', protocol: 'unity', value: 0, middle: '若场上有其它联合牌，翻转或抽取1张牌。', bottom: '当此牌被联合牌覆盖时：翻转或抽取1张牌。' },
  { defId: 'unity-1', protocol: 'unity', value: 1, top: '回合开始：若此牌被覆盖，你可以偏转此牌。', middle: '若场上有5张或以上的联合卡牌，编译联合协议并删除那条链路中所有的卡牌。', bottom: '联合卡牌可以正面朝上打在此链路。' },
  { defId: 'unity-2', protocol: 'unity', value: 2, middle: '抽取与场上联合牌数目相等的牌。' },
  { defId: 'unity-3', protocol: 'unity', value: 3, middle: '如果场上有其它联合牌，你可以翻转1张正面朝上的卡牌。' },
  { defId: 'unity-4', protocol: 'unity', value: 4, top: '回合开始：若你没有手牌，揭示你的牌库，抽取其中所有的联合卡牌，然后切洗你的牌库。' },
  { defId: 'unity-5', protocol: 'unity', value: 5, middle: '你弃置1张牌。' },
];




