/**
 * 协议显示名改名表（**唯一出处**）：外部原文的写法 → 本作显示名（2026-09-28 建）。
 *
 * 同一套协议在两个外部文档里写法不同，本作显示名统一成一种：
 *   - 外部卡面 / `compile3文本.txt`：写「僵化」；用户 2026-09-27 要求本作显示名用「死板」。
 *   - 外部评分源 `Compile45套协议卡组评分与阵容推荐.txt`：同一套写「刚性」；
 *     另外两套历史改名（本仓显示名早就不是源里的写法，2026-09-28 一并登记）：
 *     「愤怒」→「暴怒」、「柔性」→「灵活」。
 *
 * 两个消费方（都只替换**外部那一侧**，本仓 `src/data/**` 里已经是显示名）：
 *   - `tools/sync-card-texts.mjs`：`npm run texts:check` 比对前换算协议名与卡行协议名，
 *     所以卡面原文写「僵化」也仍然是 0 差异；它还会用下面的「改名表自检」核对本仓 data。
 *   - `tools/parse-ratings.mjs`：生成 `src/data/protocolRatings.ts` 时换算 name
 *     与评述/搭配/流派正文里的卡名，**否则重跑那个一次性脚本会把用户要的显示名改回去**。
 *
 * 改这张表要同时想到两侧。钉它的测试：
 *   `tests/data/protocol-display-renames.test.ts`（表内容 + 本仓 data 两侧一致）、
 *   `tests/data/parse-ratings-rename.test.ts`（真跑脚本，输出里必须是显示名）。
 */
export const EXPECTED_RENAMES = {
  '僵化': '死板',
  '刚性': '死板',
  '愤怒': '暴怒',
  '柔性': '灵活',
};

/** 整体匹配（协议名）：表上没有的照原样返回 */
export function toDisplayName(sourceName) {
  return Object.prototype.hasOwnProperty.call(EXPECTED_RENAMES, sourceName)
    ? EXPECTED_RENAMES[sourceName]
    : sourceName;
}

/** 文本级替换（评述/搭配/流派正文里也夹着卡名，如「刚性7」→「死板7」） */
export function applyDisplayRenames(text) {
  let out = text;
  for (const [from, to] of Object.entries(EXPECTED_RENAMES)) out = out.split(from).join(to);
  return out;
}
