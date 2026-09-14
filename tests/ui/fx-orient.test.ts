import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RENDERERS } from '../../src/ui/fx-dom-contract';
import { orientOf, orientToCwCcw, orientToFxRot, stripOrientClasses, cloneTransformOf, cloneBoxSwaps, type CardOrient } from '../../src/ui/fx-orient';
import { cloneBoxFrom } from '../../src/ui/fx/clone-orient';

/** 最小桩：只需 classList.contains —— 避免引入 jsdom */
const node = (...cls: string[]) => ({ classList: { contains: (c: string) => cls.includes(c) } }) as unknown as Element;

describe('FX 朝向单一出处（G2）', () => {
  it('从类名读出四种朝向', () => {
    expect(orientOf(node())).toBe(0);
    expect(orientOf(node('rot-cw'))).toBe(90);
    expect(orientOf(node('rot-ccw'))).toBe(-90);
    expect(orientOf(node('rot-180'))).toBe(180);
  });

  it('同时带多个类时按优先级判定，且 180 优先于 90', () => {
    expect(orientOf(node('card', 'rot-180', 'rot-cw'))).toBe(180);
  });

  it('空节点/缺 classList 安全退化为 0', () => {
    expect(orientOf(null)).toBe(0);
    expect(orientOf(undefined)).toBe(0);
    expect(orientOf({} as unknown as Element)).toBe(0);
  });

  it('orientToCwCcw 与旧约定等价（热座页行为不变）', () => {
    expect(orientToCwCcw(0)).toEqual({ cw: false, ccw: false, flip180: false });
    expect(orientToCwCcw(90)).toEqual({ cw: true, ccw: false, flip180: false });
    expect(orientToCwCcw(-90)).toEqual({ cw: false, ccw: true, flip180: false });
    expect(orientToCwCcw(180)).toEqual({ cw: false, ccw: false, flip180: true });
  });

  it('±90 交换布局盒宽高，0/180 不交换', () => {
    for (const o of [90, -90] as CardOrient[]) expect(cloneBoxSwaps(o)).toBe(true);
    for (const o of [0, 180] as CardOrient[]) expect(cloneBoxSwaps(o)).toBe(false);
  });

  it('transform 字符串与 CSS 侧一致', () => {
    expect(cloneTransformOf(0)).toBe('');
    expect(cloneTransformOf(90)).toBe('rotate(90deg)');
    expect(cloneTransformOf(-90)).toBe('rotate(-90deg)');
    expect(cloneTransformOf(180)).toBe('rotate(180deg)');
  });
});

/**
 * `cloneBoxFrom` 的几何契约。
 *
 * 背景：浮层卡（飞行幽灵卡）沿用既有 buildFxCardAt 的约定 —— 元素用**未旋转**的尺寸建盒，
 * 再绕**中心**用 transform 旋到目标朝向。因此 `cloneBoxFrom` 的入参 srcRect 是
 * 「屏幕上看到的足迹盒」（已含旋转），它必须做逆运算、还原出未旋转的布局盒。
 *
 * 关键事实（本块的核心）：180° 的 |cos|/|sin| 与 0° 完全相同 —— 180° 是点对称
 * (x,y) → (−x,−y)，矩形仍映射为同宽同高的轴对齐矩形，只是内容倒置。
 * 所以 180° 与 0° 的**布局盒尺寸一致**，仅 transform 不同；只有 ±90° 才交换宽高。
 * 这正是 180° 不能复用 ±90° 路径的原因。
 */
describe('浮层卡朝向几何（G2）', () => {
  /**
   * 测试自述的浏览器足迹公式：w×h 的盒子绕**中心**旋转 θ 后的轴对齐包围盒尺寸
   *   W(θ) = w·|cos θ| + h·|sin θ|
   *   H(θ) = w·|sin θ| + h·|cos θ|
   * 四个朝向都是四分之一转的整数倍，故把 cos/sin 归整到精确的 0/1 —— 否则 IEEE754 的
   * `sin(90°) = 0.9999999999999999` 会在**测试这一侧**引入浮点噪声（与被测代码无关）。
   */
  const footprint = (w: number, h: number, o: CardOrient) => {
    const t = (o * Math.PI) / 180;
    const c = Math.abs(Math.round(Math.cos(t)));
    const s = Math.abs(Math.round(Math.sin(t)));
    return { width: w * c + h * s, height: w * s + h * c };
  };

  const ORIENTS: CardOrient[] = [0, 90, -90, 180];
  const SWAPPING: CardOrient[] = [90, -90];
  const NON_SWAPPING: CardOrient[] = [0, 180];

  it('足迹公式本身先对：±90° 互换，0°/180° 不互换', () => {
    const w = 100;
    const h = 60;
    // ±90°：W = w·0 + h·1 = h，H = w·1 + h·0 = w —— 宽高互换
    for (const o of SWAPPING) expect(footprint(w, h, o)).toEqual({ width: h, height: w });
    // 0°/180°：|cos|=1、|sin|=0 → W = w，H = h —— 尺寸不变
    for (const o of NON_SWAPPING) expect(footprint(w, h, o)).toEqual({ width: w, height: h });
  });

  it('往返：已知布局盒 → 浏览器足迹 → cloneBoxFrom 必须还原原布局盒（四种朝向）', () => {
    const w = 100;
    const h = 60;
    for (const o of ORIENTS) {
      const layout = { w, h, transform: cloneTransformOf(o), swapped: cloneBoxSwaps(o) };
      // 1) 模拟浏览器：未旋转布局盒 + 朝向 → 屏幕足迹
      const screen = footprint(layout.w, layout.h, o);
      // 2) cloneBoxFrom 做逆运算：屏幕足迹 → 应当构建的未旋转布局盒
      const recovered = cloneBoxFrom(screen, o);
      // 3) 必须逐字段还原原始布局盒（四分之一转下足迹是精确整数，可要求严格相等）
      expect(recovered).toEqual(layout);
      // 4) 再用还原出的盒子重算足迹，必须等于最初那块屏幕足迹（闭环）
      expect(footprint(recovered.w, recovered.h, o)).toEqual(screen);
    }
  });

  it('100×60 源足迹的逐朝向显式期望（回归时会指名道姓地失败）', () => {
    const src = { width: 100, height: 60 };
    const table: Array<[CardOrient, string, number, number, boolean]> = [
      [0, '', 100, 60, false],
      [90, 'rotate(90deg)', 60, 100, true],
      [-90, 'rotate(-90deg)', 60, 100, true],
      [180, 'rotate(180deg)', 100, 60, false],
    ];
    for (const [o, transform, w, h, swapped] of table) {
      expect(cloneBoxFrom(src, o), `${o}°`).toEqual({ w, h, transform, swapped });
    }
  });

  it('决定性对比：180° 与 0° 的盒完全相同，仅 transform 不同（故 180° 不能复用 ±90° 路径）', () => {
    const src = { width: 100, height: 60 };
    const box0 = cloneBoxFrom(src, 0);
    const box180 = cloneBoxFrom(src, 180);
    const box90 = cloneBoxFrom(src, 90);

    // 尺寸与 swapped 完全一致：180° 不改变几何
    expect({ w: box180.w, h: box180.h, swapped: box180.swapped })
      .toEqual({ w: box0.w, h: box0.h, swapped: box0.swapped });
    // 唯一差异是 transform
    expect(box180.transform).toBe('rotate(180deg)');
    expect(box0.transform).toBe('');
    expect(box180).not.toEqual(box0);
    // 反证：若把 180° 当 ±90° 处理，几何会被错误地互换
    expect({ w: box180.w, h: box180.h }).not.toEqual({ w: box90.w, h: box90.h });
    expect(cloneBoxFrom(src, 180)).not.toEqual(cloneBoxFrom(src, 90));
  });
});

/**
 * `orientToFxRot` / `stripOrientClasses` 的契约（G2 Task 2 新增出口）。
 *
 * 背景（陷阱 #3）：`--fx-rot` 只接受**裸角度**（`'90deg'`），而 `cloneTransformOf()` 返回的是
 * **完整 transform 函数串**（`'rotate(90deg)'`）。把后者赋给 `--fx-rot` 会得到
 * `rotate(rotate(90deg))` → 计算值非法 → 整条内联 transform（连带组合的 translate/scale）
 * 被静默丢弃。所以这两个出口必须**分开**，且 `orientToFxRot` 的输出永远不含 `rotate(`。
 */
describe('orientToFxRot / stripOrientClasses（G2 Task 2 新增出口）', () => {
  it('orientToFxRot 只产出裸角度（不得是完整 transform 函数串）', () => {
    expect(orientToFxRot(0)).toBe('0deg');
    expect(orientToFxRot(90)).toBe('90deg');
    expect(orientToFxRot(-90)).toBe('-90deg');
    expect(orientToFxRot(180)).toBe('180deg');
    for (const o of [0, 90, -90, 180] as CardOrient[]) {
      expect(orientToFxRot(o), `${o}° 不是裸角度形态`).toMatch(/^-?\d+deg$/);
      expect(orientToFxRot(o), `${o}° 混入了 rotate( 函数串`).not.toContain('rotate(');
      // 与完整函数串明确区分（0° 除外：两者语义恰好都是"无旋转"，此处只断言非混用形态）
      if (o !== 0) expect(orientToFxRot(o), `${o}° 与 cloneTransformOf 混淆`).not.toBe(cloneTransformOf(o));
    }
  });

  it('stripOrientClasses 三个朝向类一起摘（只摘 ±90° 会漏掉 180°）', () => {
    const calls: string[][] = [];
    const stub = { classList: { remove: (...c: string[]) => { calls.push(c); } } } as unknown as Element;
    stripOrientClasses(stub);
    expect(calls).toEqual([['rot-cw', 'rot-ccw', 'rot-180']]);
    expect(calls[0], 'rot-180 未被摘除').toContain('rot-180');
  });

  it('stripOrientClasses 对空节点 / 缺 classList / 缺 remove 安全静默', () => {
    expect(() => stripOrientClasses(null)).not.toThrow();
    expect(() => stripOrientClasses(undefined)).not.toThrow();
    expect(() => stripOrientClasses({} as unknown as Element)).not.toThrow();
    expect(() => stripOrientClasses({ classList: {} } as unknown as Element)).not.toThrow();
  });
});

/**
 * 取出源码里每个 `setProperty('--fx-rot', X)` 调用：`arg` = 第二实参 X（已 trim），
 * `text` = **整个调用**（`setProperty(` 到配对闭括号，含跨行内容，已折叠空白以便比较）。
 *
 * 为什么不用一条正则（G2 Task 2F2 · Important-A 的假红/假绿都出在这里）：
 *  - `[^)]*`：实参里含括号（`orientToFxRot(orient)`）会被截断成 `orientToFxRot(orient`；
 *  - `[^;]*?`：要求整句同行 —— 把写入折成多行（合法的格式化写法）会让它一个都取不到；
 *  - 尾随逗号：多行实参常写成 `setProperty(\n  '--fx-rot',\n  orientToFxRot(orient),\n)`，
 *    实参后面多一个 `,` —— 拿到的字符串就成了 `orientToFxRot(orient),`；
 *  - **属性名与 `(` 之间可能有换行/缩进** —— 所以锚点是 `setProperty(`，属性名要**解析出来后校验**，
 *    不能把 `setProperty('--fx-rot'` 当成一个字面量去找（我第一版就是这么错的：多行写法会被
 *    **整条跳过**，于是"两个写入点"只找到 1 个 → 守卫对多行混用 `cloneTransformOf` 完全瞎掉）。
 * 所以这里**按括号配对扫描**，再按**顶层逗号**切分，天然容忍换行、尾随逗号与嵌套括号。
 *
 * `text` 同时喂给 5a 的"同现"检查：只按**行**判同现会被"把实参折到下一行"绕过
 * （实测：`setProperty(\n '--fx-rot',\n cloneTransformOf(orient),\n)` 在旧的逐行 5a 下全绿）。
 */
function rotWritesOf(src: string): Array<{ arg: string; text: string }> {
  const out: Array<{ arg: string; text: string }> = [];
  const head = 'setProperty(';
  let from = 0;
  for (;;) {
    const at = src.indexOf(head, from);
    if (at === -1) break;
    from = at + head.length;
    const open = at + head.length - 1;                 // `(` 的位置
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === '`') {     // 跳过字符串里的括号/逗号
        const quote = ch;
        i += 1;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === quote) break;
          i += 1;
        }
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    // 按**顶层**逗号切分实参列表（嵌套括号里的逗号不算）
    const args: string[] = [];
    let cur = '';
    let d = 0;
    for (let i = open + 1; i < end; i += 1) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        const quote = ch;
        cur += ch;
        i += 1;
        while (i < end) {
          cur += src[i];
          if (src[i] === '\\') { i += 1; if (i < end) cur += src[i]; i += 1; continue; }
          if (src[i] === quote) break;
          i += 1;
        }
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') d += 1;
      if (ch === ')' || ch === ']' || ch === '}') d -= 1;
      if (ch === ',' && d === 0) { args.push(cur); cur = ''; continue; }
      cur += ch;
    }
    args.push(cur);
    // 属性名必须**正好**是 '--fx-rot'（`'--fx-rotation'` 不算）；属性名与 `(` 之间的换行/缩进被 trim 掉
    if (args.length > 1 && args[0].trim() === "'--fx-rot'") {
      out.push({ arg: args[1].trim(), text: src.slice(at, end + 1).replace(/\s+/g, ' ') });
    }
  }
  return out;
}

/**
 * G2 源码守卫：朝向判定必须走单一出处。
 * 起因：加 180° 时若只改其中几处，会出现"有的浮层卡正、有的倒"这种极难排查的不一致。
 * 局限（必须如实写在注释里）：源码文本守卫只能证明"类名不再被裸写"与"单一出处被引用"，
 * 证明不了运行时朝向真的对 —— 那靠 G2 的用户实机抽查（计划「用户验收」第 3 项）。
 */
describe('G2 · 朝向判定单一出处（源码守卫）', () => {
  /**
   * G2 Task 2F：模块清单改为**磁盘发现**，不再硬编码。
   *
   * 起因（评审 Important-3）：原来的 `FX_FILES` 是 6 个模块的硬编码子集，而 Task 3 要新建
   * `src/ui/render-net.ts` —— 它不在清单里，于是主反向守卫**结构上**拦不住它的裸判定
   * （新渲染器可以裸写 `classList.contains('rot-180')` 而所有守卫保持绿色）。
   * 同一份教训在 `tests/ui/fx-dom-contract.test.ts:169-177` 的 RENDERERS 发现守卫里已经写过一次：
   * 「漏登记比没有守卫更糟，因为它读起来像已验收」。
   *
   * 三类（互斥）：
   *   - **单一出处** `fx-orient.ts`：唯一的**读取**出处（判定侧）—— `ORIENT_CLASSES` + `orientOf` 的
   *     读取必须命名这三个类名；它的存在理由就是"朝向判定只能在这里发生"。
   *   - **产出方** = **在 `RENDERERS` 注册表里登记过**的渲染器（G2 Task 2F2 起不再按文件名判定）：
   *     渲染器要挂朝向类名（render.ts:116/:227），允许。
   *   - **FX 消费者** 其余全部（`src/ui/`、`src/ui/fx/`、`src/ui/effects/` 下的 `.ts`）：**零命中**
   *     带引号的 `'rot-cw'`/`'rot-ccw'`/`'rot-180'` 字面量
   *     （沿用原有正则 `/['"]rot-(cw|ccw|180)['"]/`，抓带引号的字面量，避开中文注释里的 `.rot-cw` 散文）。
   *
   * 豁免集合**恰好**是 `fx-orient.ts` ∪ 已登记渲染器 ∪ 契约数据文件的精确文件名
   * （不是"名字里含 render 就算"这类宽匹配）：
   *   - `src/ui/fx-dom-contract.ts`：契约**数据**，把 `'.rot-cw'` 这类钩子字符串当数据登记，
   *     是"声明"不是"判定"；它出现在豁免里是**精确文件名**，不是模式匹配。
   */
  const uiRoot = new URL('../../src/ui/', import.meta.url);
  const readUiFile = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, uiRoot))).subarray(0, 8 * 1024 * 1024).toString('utf8');

  /**
   * 磁盘发现的全部 `src/ui/**` 模块（相对路径；每个已知目录各自非递归）。
   * 同时返回每个目录各自发现到的文件数 —— 那个「> 0」的断言放在 `it` 里跑（而不是模块作用域里），
   * 否则目录写错会让整个测试文件在收集阶段就崩掉，读者只看到 "0 test" 而不是一条清楚的守卫失败。
   */
  const { discovered, perDirCounts } = (() => {
    const out: string[] = [];
    const counts: Array<[string, number]> = [];
    // 三个目录：`src/ui/`（前缀空）、`src/ui/fx/`、`src/ui/effects/`。
    // ⚠️ 简报写的是「`src/ui/*.ts` 与 `src/ui/fx/*.ts` 两个目录」，但实际磁盘上还有
    // `src/ui/effects/index.ts` —— 而它正是最大的 FX 消费者（2285 行）。只扫两个目录会
    // 把它从消费者的发现结果里漏掉（原 FX_FILES 清单里有它），那等于**缩小**守卫面。
    // 故按实际目录结构扫三个；若将来新增目录，`LEGACY_CONSUMERS` 覆盖断言会立刻报红。
    // ⚠️ 发现是**非递归**的（复评 §5.3 提示）：若把新模块放进更深的子目录（如
    // `src/ui/net/render-net.ts`），它既不会被扫到、也不会出现在豁免断言里 —— 不报红，
    // 但也**不受守卫**。新增目录时必须同步这份前缀清单。计划 Task 3 用的是顶层
    // `src/ui/render-net.ts`，按计划执行是安全的。
    for (const prefix of ['', 'fx/', 'effects/'] as const) {
      // 目录路径写错/改名 → 发现结果为空 → 下面「三类都非空」的断言立刻报红（而不是静默全绿）。
      // 这里吞掉 readdirSync 的异常（目录不存在会 throw）：让守卫以**断言失败**的形式报红，
      // 比一个 ENOENT 崩掉整个测试文件更清楚地指出问题所在。
      let files: string[] = [];
      try {
        files = readdirSync(fileURLToPath(new URL(prefix, uiRoot))).filter((f) => f.endsWith('.ts'));
      } catch { files = []; }
      counts.push([`src/ui/${prefix}`, files.length]);
      for (const f of files) out.push(`${prefix}${f}`);
    }
    return { discovered: out, perDirCounts: counts };
  })();

  /** 单一出处：唯一的**读取**出处（判定侧）—— 必须在 `ORIENT_CLASSES` / `orientOf` 里命名这三个类名。
   *  （产出方 `render*.ts` 与契约数据 `fx-dom-contract.ts` 也会出现这些字符串，但它们不是"读取侧"。） */
  const SOLE_SOURCE = 'fx-orient.ts';
  /** 契约数据文件：登记钩子字符串为数据，不做朝向判定（精确文件名豁免）。 */
  const CONTRACT_DATA = 'fx-dom-contract.ts';
  /**
   * 产出方 = **在契约数据文件的 `RENDERERS` 注册表里登记过**的文件（不是"名字匹配 render*"）。
   *
   * 为什么不能按名字豁免（G2 Task 2F2 · Important-B）：
   *   `/^render.*\.ts$/` 同时承担了「发现」与「豁免」两个职责，于是任何名字以 render 开头、
   *   但其实不是渲染器的模块（如 `render-net-utils.ts`）会被静默豁免出「FX 消费者零命中」；
   *   而 ±90° 断言只查 cw|ccw、不查 180 → 它里面的 `'rot-180'` 落在**两条断言之间的缝隙**里。
   *   评审实测：新建 `render-net-probe2.ts` 只写 `classList.add('rot-180')` 时 20/20 全绿。
   * 结论：**发现可以用文件名，豁免必须用注册表**。注册表是 `src/ui/fx-dom-contract.ts` 导出的
   * `RENDERERS`（唯一出处，两个测试文件共用），未登记者自动落回 `consumers` 被零命中断言扫到。
   */
  const registered = new Set<string>(RENDERERS.map((r) => r.file));
  const producers = discovered.filter((f) => registered.has(f));
  /** 热座渲染器：唯一允许产出 ±90° 的渲染器（两位玩家坐在同一块屏幕前，各自看得正）。
   *  显式具名常量而不是宽模式 —— 「谁能豁免」必须是逐文件名的、可复核的决定。 */
  const HOTSEAT = 'render.ts';
  /** FX 消费者：其余全部 —— 必须零命中带引号的朝向类名字面量。 */
  const consumers = discovered.filter((f) => f !== SOLE_SOURCE && !producers.includes(f) && f !== CONTRACT_DATA);

  /** 原有 6 个消费者必须仍在发现结果里（保留原语义：这些模块不能被漏扫） */
  const LEGACY_CONSUMERS = ['effects/index.ts', 'fx-gen2.ts', 'fx-gen3.ts', 'fx-gen3-swap.ts', 'gen3-control.ts', 'compiled-gen3.ts'];

  it('磁盘发现的三类都非空，且豁免集合恰好等于 单一出处 ∪ 已登记渲染器 ∪ 契约数据（防目录写错静默全绿 / 防宽匹配扩大豁免）', () => {
    // 每个被扫的目录都必须发现到 .ts（路径写错 → 空 → 报红；发现结果为空则下面全部静默绿）
    const emptyDirs = perDirCounts.filter(([, n]) => n === 0).map(([d]) => d);
    expect(emptyDirs, `以下目录发现 0 个 .ts（路径写错/改名？发现结果为空则守卫静默全绿）：\n${emptyDirs.join('\n')}`).toEqual([]);
    const groups: Array<[string, string[]]> = [['单一出处', [SOLE_SOURCE]], ['产出方（已登记渲染器）', producers], ['FX 消费者', consumers]];
    const empty = groups.filter(([, files]) => files.length === 0).map(([name]) => name);
    expect(empty, `以下类别在磁盘上发现 0 个文件（目录路径写错？发现结果为空则守卫静默全绿）：\n${empty.join('\n')}`).toEqual([]);
    // 豁免集合必须**恰好**是这三类里的非消费者部分 —— 任何额外豁免都会体现在这里
    const exempt = [...discovered].filter((f) => !consumers.includes(f)).sort();
    expect(exempt, '豁免集合不等于 单一出处 ∪ 已登记渲染器 ∪ 契约数据（不得扩大豁免）')
      .toEqual([SOLE_SOURCE, CONTRACT_DATA, ...producers].sort());
    for (const f of LEGACY_CONSUMERS) {
      expect(consumers, `原有的 FX 消费者 ${f} 未被磁盘发现结果覆盖`).toContain(f);
    }
    expect(producers, '当前生产渲染器 render.ts 未被认定为产出方').toContain(HOTSEAT);
    expect(discovered.length, '磁盘发现结果过少（目录路径可能写错）').toBeGreaterThan(LEGACY_CONSUMERS.length);
  });

  /**
   * G2 Task 2F2 · Important-B：注册表与磁盘的**双向**一致性。
   *
   * 豁免判据从「名字匹配 `render*`」改成「在 `RENDERERS` 里登记过」之后，必须补这两条，
   * 否则"名字像渲染器"仍能逃过（未登记 → 落回 consumers，被零命中断言扫到 → 其实已经安全了），
   * 而更危险的反方向是：注册表里写了一个**磁盘上不存在**的文件 → 它被当作"已登记产出方"
   * 而静默缩小了「消费者零命中」的检查面（豁免面被拼写错误撑大）。
   */
  it('磁盘上每个 render*.ts 都必须在 RENDERERS 里登记（否则"名字像渲染器"就能逃过豁免判据）', () => {
    const discoveredRenderers = discovered.filter((f) => /^render.*\.ts$/.test(f));
    const unregistered = discoveredRenderers.filter((f) => !registered.has(f));
    expect(unregistered, `以下 src/ui/render*.ts 未登记进 RENDERERS（注册表在 src/ui/fx-dom-contract.ts）：\n${unregistered.join('\n')}`).toEqual([]);
    // 发现侧本身不能空（否则这条断言恒真）
    expect(discoveredRenderers.length, '磁盘上一个 render*.ts 都没发现（发现路径写错？）').toBeGreaterThan(0);
  });

  it('RENDERERS 里每个 file 都必须在磁盘上存在（拼错文件名不得静默缩小豁免面）', () => {
    const absent = [...registered].filter((f) => !discovered.includes(f));
    expect(absent, `RENDERERS 里登记了磁盘上不存在的文件（拼错？豁免面被撑大）：\n${absent.join('\n')}`).toEqual([]);
    expect(registered.size, 'RENDERERS 为空（豁免判据失效）').toBeGreaterThan(0);
  });

  // 1) 反向：FX 消费者不得裸写朝向类名（注释里写 `.rot-cw` 不算 —— 只抓带引号的字面量）
  it('FX 模块不得再裸写朝向类名（必须经 orientOf/ORIENT_CLASSES 消费）', () => {
    const bad: string[] = [];
    for (const f of consumers) {
      let src: string;
      try { src = readUiFile(f); } catch { continue; } // 文件不存在则跳过（模块清单允许演进）
      src.split('\n').forEach((line, i) => {
        if (/['"]rot-(cw|ccw|180)['"]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad, `以下位置仍在裸写朝向类名，请改走 fx-orient.ts 的 orientOf()：\n${bad.join('\n')}`).toEqual([]);
  });

  /**
   * I-3 新增：把 G2 Task 3 的硬约束 2 变成机检（这是本次修里最有价值的一项）。
   *
   * 计划 Task 3 正文：「**`.rot-cw`/`.rot-ccw` 在远程页不产出**；改为产出朝向标记
   * （自己不加类 = 0°，对手加 `.rot-180`）」——理由：远程页自己正立、对手 180°，
   * ±90° 会**交换布局盒宽高**故不适用。
   *
   * 于是：**已登记的渲染器**里除热座页（`HOTSEAT`）之外的任何文件，不得含 `'rot-cw'`/`'rot-ccw'` 字面量。
   * 这条守卫会在 Task 3 阶段自动抓错（`render-net.ts` 一写 ±90° 就红），无需再往清单里加名字。
   *
   * ⚠️ 判据是**带引号的**字面量：中文注释里写 `.rot-cw`（不带引号）不会命中 ——
   * 但**不要把带引号的类名写进注释**（如 `// 不产出 'rot-cw'`），那会被当成产出而报红。
   */
  it('除热座渲染器外的已登记渲染器（远程页）不得产出热座专属的 ±90° 朝向类', () => {
    const bad: string[] = [];
    for (const f of producers) {
      if (f === HOTSEAT) continue; // 热座页的产出方，允许 ±90°
      const src = readUiFile(f);
      src.split('\n').forEach((line, i) => {
        if (/['"]rot-(cw|ccw)['"]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad, `以下非热座渲染器产出了 ±90° 朝向类（远程页用「自己 0° / 对手 180°」，±90° 会交换布局盒宽高）：\n${bad.join('\n')}`).toEqual([]);
  });

  // 2) 正向：effects/index.ts 与 fx-gen3.ts 确实 import/使用了 orientOf（防止靠删代码过关）
  it('effects/index.ts 与 fx-gen3.ts 确实从 fx-orient 消费单一出处', () => {
    for (const f of ['effects/index.ts', 'fx-gen3.ts']) {
      const src = readUiFile(f);
      expect(src, `${f} 未引用 orientOf`).toMatch(/\borientOf\b/);
      expect(src, `${f} 未从 fx-orient 引入`).toMatch(/from '[^']*fx-orient'/);
    }
  });

  // 3) 产出方仍在产出：render.ts 必须仍在**产出点**上挂三种朝向类（防止靠删/改产出过关）
  it('render.ts 仍在产出三种朝向类（防止靠删产出过关）', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/ui/render.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8');
    // ⚠️ 必须钉**产出表达式**，不能对整文件做子串查找。两个假绿来源（评审实测）：
    //    - `rot-cw` 会被**中文注释** render.ts:196（`.rot-cw`）满足；
    //    - `rot-180` 会被**类名镜像行** render.ts:1443（把邻居的类名 toggle 到编译卡面克隆上）满足。
    //    两条都与"产出"无关，所以 `expect(src).toContain('rot-cw')` 这类写法对产出点完全失效
    //    （把 :227 改成 'rot-clockwise' —— 热座页所有场上卡立刻直立 —— 仍然全绿）。
    //
    // 两个产出点（BASE 实际写法，行号仅作参考）：
    //    - render.ts:227 `renderStackSlot` 内，场上卡按 owner 挂 ±90°：
    //      `node.classList.add(card.owner === 0 ? 'rot-cw' : 'rot-ccw');`
    //    - render.ts:116 `renderProtocol` 内，P2 协议图 180°（`.protocol-img`）：
    //      `img.className = 'protocol-img' + (player === 1 ? ' rot-180' : '');`
    // 条件分支与类名一起钉住：只钉类名的话，把 `card.owner === 0` 反过来（P1/P2 朝向互换）
    // 仍然全绿 —— 那同样会让热座页所有场上卡朝向错。
    const missing: string[] = [];
    if (!/classList\.add\(card\.owner === 0 \? 'rot-cw' : 'rot-ccw'\)/.test(src)) {
      missing.push("场上卡产出表达式（renderStackSlot 的 `classList.add(card.owner === 0 ? 'rot-cw' : 'rot-ccw')`）");
    }
    if (!/'protocol-img' \+ \(player === 1 \? ' rot-180' : ''\)/.test(src)) {
      missing.push("协议图 180° 产出表达式（renderProtocol 的 `'protocol-img' + (player === 1 ? ' rot-180' : '')`）");
    }
    expect(missing, `render.ts 丢失/改变了朝向产出表达式（产出点是热座观感的唯一来源，不得顺手删）：\n${missing.join('\n')}`).toEqual([]);
    // 两个产出表达式已覆盖全部三个类名（rot-cw/rot-ccw 在第一条，rot-180 在第二条）；
    // 这里再逐个给出可读的失败信息，防止有人只改其中一支
    for (const c of ['rot-cw', 'rot-ccw', 'rot-180']) {
      expect(src, `render.ts 丢失产出类 ${c}（产出点是热座观感的唯一来源，不得顺手删）`).toContain(c);
    }
  });

  // 4) stripOrientClasses 确实被 playRiseFade 使用（effects/index.ts 含 'stripOrientClasses('）
  it('playRiseFade 的克隆用 stripOrientClasses 清理朝向', () => {
    expect(readUiFile('effects/index.ts'), '克隆去类未走 stripOrientClasses（会漏摘 rot-180）').toContain('stripOrientClasses(');
  });

  // 5) orientToFxRot 只产出**裸角度**：不得出现 --fx-rot 与 cloneTransformOf 同现的行，
  //    且**每个**写入 --fx-rot 的值都不得是完整 transform 函数串（`rotate(…)`）
  it('--fx-rot 不得与完整 transform 函数串（cloneTransformOf）混用', () => {
    const src = readUiFile('effects/index.ts');
    // 每个 `setProperty('--fx-rot', …)` 调用：arg = 第二实参，text = 整个调用（已折叠空白）
    const calls = rotWritesOf(src);
    // 5a) `--fx-rot` 与 `cloneTransformOf` 不得出现在**同一个调用**里。
    //     原实现是逐行比较；这里改成按**调用**比较 —— 逐行版对一个完全等价的多行写法
    //     （`setProperty(\n '--fx-rot',\n cloneTransformOf(orient),\n)`）是瞎的（我实测过：全绿）。
    const bad = calls
      .filter(({ text }) => text.includes('cloneTransformOf'))
      .map(({ text }) => text);
    expect(bad, `--fx-rot 只吃裸角度，混用完整函数串会让整条内联 transform 静默失效：\n${bad.join('\n')}`).toEqual([]);
    // 5b) 钉**写入值的不变量**（而不是某个具体写法）。原实现只做 5a，而 effects/index.ts:164 的注释里
    //     同时含 `--fx-rot` 与 `cloneTransformOf` —— 5a 完全可以被注释解释，且它证明不了
    //     「真正写值的那一处没被换成完整函数串」。
    //
    // ⚠️ G2 Task 2F2 · Important-A：这里**不能**把写法钉死成 `orientToFxRot(orient)`。
    //     评审实测：改成中间变量 `const fxRot = orientToFxRot(orient); setProperty('--fx-rot', fxRot)`
    //     是语义完全等价、且更易调试的写法，却被旧正则判红（假红），失败消息还误述成"混入了
    //     cloneTransformOf 的函数串"。**拒绝正确代码的守卫会被绕过或删掉** —— 那正是它要防的事。
    //     所以断言改成两条**不变量**：
    //       (i)  写入值必须是「对 `orientToFxRot` 的调用」或「一个标识符」（= 上游已算好的裸角度），
    //            变量名不限（`orient` / `fxRot` / `currentOrient` 都合法）；
    //       (ii) 写入值**不得含 `rotate(`**（完整 transform 函数串的判别特征）—— 这条才是真正要防的，
    //            它同时覆盖「将来合法的第三种写入形态」（例如 `FX_ROT[orient]` 只要不含 rotate( 就通过）。
    // 提取：见 rotWritesOf（括号配对 + 顶层逗号切分）—— 容忍实参里的括号、跨行写入与尾随逗号。
    const writes = calls.map(({ arg }) => arg);
    // 「找不到写入点」的失败消息必须**带上实际找到的写入点清单** —— 否则删掉两个写入点中的一个
    // （如只删 ±90° 分支、留下 180° 分支）时，读者只看得到"数量不对"，看不出漏了哪一个。
    expect(writes.length, `effects/index.ts 里找不到 --fx-rot 的写入点（产出路径被删/改了写法？）；实际找到 ${writes.length} 处：\n`
      + writes.map((w, i) => `  [${i + 1}] ${w}`).join('\n')).toBeGreaterThan(0);
    const isOrientCall = (w: string): boolean => /^orientToFxRot\([A-Za-z_$][\w$]*\)$/.test(w);
    const isIdentifier = (w: string): boolean => /^[A-Za-z_$][\w$]*$/.test(w);
    const badForms = writes.filter((w) => !(isOrientCall(w) || isIdentifier(w)));
    expect(badForms, '--fx-rot 的写入值必须是 对 orientToFxRot(<标识符>) 的调用 或 一个标识符（上游已算好的裸角度）：\n'
      + badForms.map((w) => `  实际取到的实参：${w}`).join('\n')).toEqual([]);
    // 连写两次会拿到字符串再进属性值（`'0degdeg'` 之类），也是错形态 —— 单独点出来，别让它蒙混
    const nested = writes.filter((w) => (w.match(/orientToFxRot\(/g) ?? []).length > 1);
    expect(nested, '--fx-rot 的写入值把 orientToFxRot 套了两次（会得到非法角度串）：\n'
      + nested.map((w) => `  实际取到的实参：${w}`).join('\n')).toEqual([]);
    const withRotate = writes.filter((w) => w.includes('rotate('));
    expect(withRotate, '--fx-rot 的写入值含 rotate( —— 那是完整 transform 函数串，会让整条内联 transform 静默失效：\n'
      + withRotate.map((w) => `  实际取到的实参：${w}`).join('\n')).toEqual([]);
    // 反空集合守卫（二）：**每个** `setProperty(` 之后紧跟的第一实参如果是 `'--fx-rot'`，都必须被提取到；
    // 漏掉任何一处（例如属性名与 `(` 之间被折行）就报红，而不是静默少查一处。
    // （不能用「setProperty( 的总出现次数 == calls.length」—— 该文件里还有 12 处与 --fx-rot 无关的
    //  setProperty 调用，那样会恒红。见上面 rotWritesOf 注释里我踩过的那个坑。）
    const expectedRotWrites = (src.match(/setProperty\(\s*'--fx-rot'/g) ?? []).length;
    expect(calls.length, `rotWritesOf 漏掉了写入点：源码里 setProperty( 后紧跟 '--fx-rot' 有 ${expectedRotWrites} 处，只提取到 ${calls.length} 处`)
      .toBe(expectedRotWrites);
    // 反空集合守卫（三）：两个旋转分支（±90° 与 180°）**各有一处** `--fx-rot` 写入。
    // 数量少于 2 → 说明有人删掉了其中一个分支的写入（只删一处时上面的 `> 0` 抓不到）。
    // 这是**有意**的数量约束：新增第三个朝向分支时必须同步更新这里的数字，失败消息会说明。
    expect(writes.length, `--fx-rot 的写入点数应为 2（±90° 与 180° 分支各一处），实际 ${writes.length} 处：\n`
      + writes.map((w, i) => `  [${i + 1}] ${w}`).join('\n')
      + '\n（若本次有意新增/删除旋转分支，请同步更新本断言的期望值）').toBe(2);
  });
});
