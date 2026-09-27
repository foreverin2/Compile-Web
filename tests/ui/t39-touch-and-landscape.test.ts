import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './source-text';

/**
 * G5/T39（触屏拖动 + 手机横屏）的**源码守卫**。
 *
 * ## 为什么要有这一份（本任务的三条硬约束都只有浏览器里才看得见）
 *
 * T39 修的是"用户在真机上只能点不能拖"，而修法刻意避开三个红线文件
 * （`render.ts` / `render-net.ts` / `styles.css`）⇒ 全部逻辑落在一个新模块 + 一张新样式表里。
 * 这些约束都是**结构性的**，用文本守卫钉住最便宜：
 *
 *  1. **只在触摸指针上启用**：`touch-bridge.ts` 里每个 `pointer*` 处理器都必须先看
 *     `pointerType === 'touch'`；设备连触摸能力都没有时**一个监听器都不装**（这是"鼠标设备
 *     零影响"最强的那种写法，浏览器里已由判据③实测：`__t39Touch.enabled === false`、
 *     `bridges === 0`）。
 *  2. **不做坐标换算**：落点判据是 `render.ts` 里的 `document.elementFromPoint(clientX, clientY)`，
 *     桥只把指针的视口坐标原样转发 ⇒ 本文件里**不该出现** `getBoundingClientRect` 这类
 *     自己算坐标的写法（CSS 旋转档下算了就是错的）。
 *  3. **三种能力按顺序试、每种都 try/catch**：全屏 → 方向锁 → CSS 旋转；且**真的横过来之后
 *     必须把旋转类摘掉**（T39 修复轮实测踩到的双重旋转：`press()` 那次旋转是按"当时还竖屏"
 *     加的，之后设备真转了，若只摘门不摘类，`#app` 会在横屏视口里再转 90°）。
 *
 * 注意：本文件**不能**证明"真机上拖得动"（那是 CDP 夹具
 * `.superpowers/g5-T39/t39-cdp.mjs` 与用户真机的事）；它只证明这些结构性约束没被改回去。
 */

// 与 `net-body-layer-rules.test.ts` 同款读法（本仓的 `tests/node-types.d.ts` 只声明了
// `readFileSync(path)` + `subarray(…).toString('utf8')` 这条窄签名）
const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const readMain = (): string =>
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');

const BRIDGE = stripComments(read('touch-bridge.ts'));
const PHONE = stripComments(read('phone-landscape.ts'));
const TOUCH_CSS = read('styles-touch.css');
const MAIN = stripComments(readMain());

describe('G5/T39 · 触屏桥只在触摸指针上启用，且不做坐标换算', () => {
  it('每个 pointer 处理器都先判 `pointerType !== \'touch\'` 就返回（鼠标一个都进不来）', () => {
    const handlers = ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel'] as const;
    for (const h of handlers) {
      const at = BRIDGE.indexOf(`function ${h}(`);
      expect(at, `触屏桥里找不到 ${h}（结构被改动？）`).toBeGreaterThan(-1);
      const body = BRIDGE.slice(at, BRIDGE.indexOf('\n}', at));
      expect(body, `${h} 没有把鼠标指针挡在门外`).toContain("e.pointerType !== 'touch'");
    }
  });

  /**
   * ★ 修复轮（评审 A1）：下面那条只钉"装监听器的顺序"，**钉不住"启用算法"本身** ——
   * 评审把 `probe.enabled` 改成恒真，13 条腿全绿而桌面观感一字不差。这一条把启用判据
   * **逐字**钉住，同时钉住"分流计数记在 pointerType 门之前"（判据③ 改成断言分流事实的依据）。
   */
  it('启用判据逐字钉住（`maxTouchPoints > 0 || coarse || anyCoarse`），且分流计数在 pointerType 门之前', () => {
    expect(BRIDGE).toContain('probe.enabled = maxTouchPoints > 0 || coarse || anyCoarse;');
    expect(BRIDGE, '`probe.enabled` 被改成恒真/别的算法了').not.toContain('probe.enabled = true');
    expect(BRIDGE, '没有按指针类型分流的计数（判据③ 靠它）').toContain('pointerDownSeen');
    const at = BRIDGE.indexOf('function onPointerDown(');
    const body = BRIDGE.slice(at, BRIDGE.indexOf('\n}', at));
    const seen = body.indexOf('notePointerSeen(probe.pointerDownSeen');
    const gate = body.indexOf("if (e.pointerType !== 'touch') return;");
    expect(seen, 'onPointerDown 里没有记分流计数').toBeGreaterThan(-1);
    expect(gate, 'onPointerDown 里没有 pointerType 门').toBeGreaterThan(-1);
    expect(seen, '分流计数必须记在 pointerType 门**之前**（否则鼠标永远数不到）').toBeLessThan(gate);
  });

  it('每张手牌/每个草稿卡都能被"卡级（冒泡）"计数（夹具的第三层读数靠它）', () => {
    // 夹具那份计数器不在这棵源码树里；这里只钉"卡上确实挂着 mousedown 处理器"这一前提
    // （`render.ts` 是红线，所以断言它仍然是 `card.addEventListener('mousedown'`）。
    const render = stripComments(read('render.ts'));
    expect(render).toContain("node.addEventListener('mousedown'");
    expect(render).toContain("card.addEventListener('mousedown'");
  });
  it('设备没有触摸能力时**一个监听器都不装**（`probe.enabled` 之前不留 addEventListener）', () => {
    const at = BRIDGE.indexOf('export function initTouchBridge(');
    expect(at).toBeGreaterThan(-1);
    const body = BRIDGE.slice(at, BRIDGE.indexOf('\n}', at));
    const gate = body.indexOf('if (!probe.enabled) return probe;');
    expect(gate, '没有"无触摸能力就直接返回"的那一句').toBeGreaterThan(-1);
    const firstListener = body.indexOf('addEventListener');
    expect(firstListener, '装监听器的那一段不见了').toBeGreaterThan(-1);
    expect(gate, '有监听器装在能力判定**之前**').toBeLessThan(firstListener);
    // 三个指针事件 + 三个兼容鼠标事件 + click + blur/visibilitychange 全在那句之后
    expect(body.slice(gate).match(/addEventListener/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('只转发视口坐标：合成事件里带 clientX/clientY，且本文件不自己算矩形', () => {
    expect(BRIDGE).toContain('clientX: x');
    expect(BRIDGE).toContain('clientY: y');
    expect(BRIDGE, '按下点必须是浏览器自己命中测试出来的那个元素').toContain('document.elementFromPoint(e.clientX, e.clientY)');
    expect(BRIDGE, '桥里出现了自己算坐标的写法（旋转档下算出来的坐标是错的）').not.toContain('getBoundingClientRect');
  });

  it('原生 click 一律不拦（"点卡选中 → 点槽打出"靠的就是它）', () => {
    // 拦截名单只有这三个兼容鼠标事件
    expect(BRIDGE).toContain("for (const type of ['mousedown', 'mousemove', 'mouseup'] as const)");
    const at = BRIDGE.indexOf('function blockCompatMouse(');
    const body = BRIDGE.slice(at, BRIDGE.indexOf('\n}', at));
    expect(body).not.toContain("'click'");
  });
});

describe('G5/T39 · 触屏样式表（新文件，不碰红线 styles.css）', () => {
  it('可拖面（挡板 / 卡 / 草稿卡）都写了 `touch-action: none`', () => {
    const block = TOUCH_CSS.slice(TOUCH_CSS.indexOf('/* ===== 1)'), TOUCH_CSS.indexOf('/* ===== 2)'));
    for (const sel of ['.hand-shield', '.card', '.draft-card']) {
      expect(block, `${sel} 不在同一条 touch-action: none 规则里`).toContain(sel);
    }
    expect(block).toContain('touch-action: none');
  });

  it('旋转规则是 `html.t39-rot90 #app` 且交换了 vw/vh（宽 = 100vh、高 = 100vw）', () => {
    expect(TOUCH_CSS).toContain('html.t39-rot90 #app');
    const at = TOUCH_CSS.indexOf('html.t39-rot90 #app {');
    const body = TOUCH_CSS.slice(at, TOUCH_CSS.indexOf('}', at));
    expect(body).toContain('width: 100vh');
    expect(body).toContain('height: 100vw');
    expect(body).toContain('transform: rotate(90deg) translateY(-100%)');
    expect(body).toContain('transform-origin: top left');
  });

  it('红线 styles.css 里没有任何 `touch-action`（触屏样式只在新表里）', () => {
    expect(read('styles.css')).not.toContain('touch-action');
    expect(read('render.ts')).not.toContain('touch-action');
  });
});

describe('G5/T39 · 手机横屏：判定门限、三种能力、双重旋转的修法', () => {
  it('判定 = 粗指针（或触摸点）**且**屏幕短边 <= 500', () => {
    expect(PHONE).toContain("matchMedia('(pointer: coarse)')");
    expect(PHONE).toContain("matchMedia('(any-pointer: coarse)')");
    expect(PHONE).toContain('navigator.maxTouchPoints');
    expect(PHONE).toContain('const PHONE_SHORT_SIDE_MAX = 500;');
    expect(PHONE).toContain('shortSide <= PHONE_SHORT_SIDE_MAX');
  });

  it('全屏与方向锁各在自己的 try/catch 里，且失败不抛出（走 CSS 旋转那条路）', () => {
    const at = PHONE.indexOf('async function press(');
    const body = PHONE.slice(at, PHONE.indexOf('\n}', at));
    expect(body).toContain('requestFullscreen');
    expect((body.match(/catch \(err\)/g) ?? []).length, '两个能力必须各自 try/catch').toBeGreaterThanOrEqual(2);
    expect(body).toContain("o.lock('landscape')");
    expect(body).toContain('if (window.innerHeight > window.innerWidth) applyRotation();');
  });

  it('真的横过来之后必须摘掉旋转类（否则是双重旋转）', () => {
    const at = PHONE.indexOf('function syncGate(');
    const body = PHONE.slice(at, PHONE.indexOf('\n}', at));
    expect(body, 'syncGate 里没有"不竖屏就清掉旋转类"的那一句').toContain('if (detect().portrait === false && detect().rotated) clearRotation();');
  });

  it('门只在"手机 + 竖屏 + 还没旋转"这一格存在，其余一律摘掉', () => {
    const at = PHONE.indexOf('function syncGate(');
    const body = PHONE.slice(at, PHONE.indexOf('\n}', at));
    expect(body).toContain('const need = d.isPhone && d.portrait && !d.rotated;');
    expect(body).toContain('removeGate();');
  });

  /**
   * ★★ 第三轮复验（缺陷 M3）：**陈旧按钮**那条修复原来**没有任何源码腿** —— 评审把
   * `syncPin` 里"换过代而这一代没有该按钮就摘掉"的三行原样拿掉，20 条腿**全绿**，
   * 只有浏览器档能抓（定点探针第二代 `pinnedNext=1`、真对局里 `stepChanged=false`）。
   *
   * 这一条把那段行为钉在源码上：`live === null` 那一支里**必须**同时有
   * "这一代换过了（`genChanged`）"与"把陈旧节点摘掉（`existing.remove()`）"。
   * 只查 `existing.remove()` 是不够的（另一支里也有一句同名调用）⇒ 这里**切出这一支**再判。
   */
  it('陈旧按钮必须被摘掉（`live === null` 那一支里要有 genChanged + existing.remove()）', () => {
    const at = PHONE.indexOf('function syncPin(');
    expect(at, '找不到 syncPin（结构被改动？）').toBeGreaterThan(-1);
    const body = PHONE.slice(at, PHONE.indexOf('\n}', at));
    const branchAt = body.indexOf('if (live === null) {');
    expect(branchAt, 'syncPin 里没有"这一代没有这个按钮"那一支').toBeGreaterThan(-1);
    const branch = body.slice(branchAt, body.indexOf('  }', branchAt) + 3);
    expect(branch, '那一支里没有"换过代"的判断 ⇒ 会留一个绑着上一帧 nextAction 的陈旧按钮').toContain('genChanged');
    expect(branch, '那一支里没有摘除陈旧节点的动作 ⇒ 屏上会留一个点了没反应的「下一步」').toContain('existing.remove()');
    // 反面：旧写法（直接 return existing !== null）不许回来
    expect(body, '旧写法回来了（这一代没有按钮时留着旧的）').not.toContain('if (live === null) return existing !== null;');
    // 渲染代的记录点：钉的时候要记，判断才有依据
    expect(body, '没有记录渲染代（pinGen）').toContain('pinGen = gen');
  });
});

describe('G5/T39 修复轮 · 整页等比缩放 (a) + 关键按钮钉视口 (b)', () => {
  it('样式表里有两条缩放规则（旋转档多带 rotate 那一段）与"overflow 改 visible"那一条', () => {
    expect(TOUCH_CSS).toContain('html.t39-fit:not(.t39-rot90) #app');
    expect(TOUCH_CSS).toContain('html.t39-fit.t39-rot90 #app');
    expect(TOUCH_CSS).toContain('scale(var(--t39-k');
    // 负方向溢出的内容**必须**能画出来（第一轮的根因是 overflow: auto 把它裁掉了）
    const at = TOUCH_CSS.indexOf('html.t39-fit #app {');
    expect(at, '`html.t39-fit #app` 那条规则不见了').toBeGreaterThan(-1);
    const body = TOUCH_CSS.slice(at, TOUCH_CSS.indexOf('}', at));
    expect(body, '缩放档里 `#app` 必须改成 overflow: visible').toContain('overflow: visible');
  });

  it('两个关键按钮各有"钉到视口角"的规则（position: fixed + 视口角）', () => {
    for (const cls of ['.t39-pin-next', '.t39-pin-choice']) {
      expect(TOUCH_CSS, `${cls} 的固定规则不见了`).toContain(cls);
    }
    const pin = TOUCH_CSS.slice(TOUCH_CSS.indexOf('html.t39-fit .t39-pin {'), TOUCH_CSS.indexOf('.t39-pin.t39-pin-next'));
    expect(pin, '`.t39-pin` 不是 position: fixed').toContain('position: fixed');
    const next = TOUCH_CSS.slice(TOUCH_CSS.indexOf('.t39-pin.t39-pin-next'), TOUCH_CSS.indexOf('.t39-pin.t39-pin-choice'));
    expect(next, '「下一步」没钉在视口角落（right/bottom）').toMatch(/right:\s*\d+px/);
    expect(next).toMatch(/bottom:\s*\d+px/);
  });

  it('缩放算法：k 有地板、有"整块棋盘 vs 主判据那一族"两级目标、按钮从 #app 挪到 body', () => {
    expect(PHONE).toContain('const K_FLOOR = 0.5;');
    expect(PHONE).toContain('function syncFit(');
    expect(PHONE).toContain('const useUnion = unionBox !== null && kUnion >= K_FLOOR;');
    expect(PHONE, '没有记"整块棋盘要多少 k"（如实报"放不下"靠它）').toContain('kUnionNeeded');
    expect(PHONE, '没有把棋盘与主判据分开的两级目标').toContain('boardFit');
    // (b)：必须真的把按钮挪出 #app（带 transform 的祖先当 fixed 包含块 ⇒ 留在里面钉不到视口）
    const at = PHONE.indexOf('function syncPin(');
    const body = PHONE.slice(at, PHONE.indexOf('\n}', at));
    expect(body).toContain('document.body.appendChild(live);');
    expect(PHONE).toContain("syncPin(app, ['.next-btn'], PIN_NEXT_CLASS);");
    expect(PHONE).toContain("syncPin(app, ['.choice-confirm'], PIN_CHOICE_CLASS);");
    // 每帧重画都会换掉按钮节点 ⇒ 必须有 MutationObserver 重新钉
    expect(PHONE).toContain('new MutationObserver(');
  });

  it('缩放类的名字与三个 CSS 变量在 JS / CSS 两侧一致（任一侧改名就红）', () => {
    expect(PHONE).toContain("const FIT_CLASS = 't39-fit';");
    expect(TOUCH_CSS).toContain('.t39-fit');
    for (const v of ['--t39-k', '--t39-tx', '--t39-ty']) {
      expect(TOUCH_CSS, `样式表没读 ${v}`).toContain(v);
      expect(PHONE, `JS 没写 ${v}`).toContain(`'${v}'`);
    }
  });

  it('缩放档只在"手机 + 横屏布局"生效（桌面/平板不许被加类）', () => {
    expect(PHONE).toContain('const on = d.isPhone && landscapeLayout;');
    expect(PHONE).toContain('const landscapeLayout = d.rotated || !d.portrait;');
    const at = PHONE.indexOf('function syncFit(');
    const body = PHONE.slice(at, PHONE.indexOf('\n  } finally {', at));
    expect(body, '不在缩放档时必须把类摘掉').toContain('clearFit()');
  });
});

describe('G5/T39 · main.ts 的接线（只有 import 与两行调用）', () => {
  it('两张新表/两个新模块都 import 了，且 styles-touch.css 排在 styles.css **之后**', () => {
    const iStyles = MAIN.indexOf("import './ui/styles.css';");
    const iTouch = MAIN.indexOf("import './ui/styles-touch.css';");
    expect(iStyles).toBeGreaterThan(-1);
    expect(iTouch, 'styles-touch.css 没被 import').toBeGreaterThan(-1);
    expect(iTouch, 'styles-touch.css 必须排在 styles.css 之后（同权重时靠后者胜）').toBeGreaterThan(iStyles);
    expect(MAIN).toContain("import { initTouchBridge } from './ui/touch-bridge';");
    expect(MAIN).toContain("import { initPhoneLandscape } from './ui/phone-landscape';");
  });

  it('启动时两行调用都接上了（就两行，不带参数）', () => {
    const boot = MAIN.slice(MAIN.indexOf('exposeMatchProbe();'));
    expect(boot).toContain('initTouchBridge();');
    expect(boot).toContain('initPhoneLandscape();');
    // 全文件各只出现一次**调用**（import 那两行不带括号）
    expect((MAIN.match(/initTouchBridge\(/g) ?? []).length).toBe(1);
    expect((MAIN.match(/initPhoneLandscape\(/g) ?? []).length).toBe(1);
  });
});
