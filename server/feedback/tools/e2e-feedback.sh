#!/usr/bin/env bash
# Compile 反馈后端：端到端实测（2026-10-01）。在服务器上跑。
#
# 用法：bash e2e-feedback.sh
#
# 打哪个地址：**默认直连 127.0.0.1:8790**（服务本身）。
# nginx 那一段用"自测 0"单独验（只打只读接口，不吃额度）。
#
# 两个刻意的设计，都是为了**可重复跑**：
#  1. 每个请求都带 `X-Forwarded-For: 203.0.113.77`（文档保留地址，不是真机器）。
#     服务端 FEEDBACK_TRUST_PROXY=1，限流键就是这个假 IP ⇒ 每次跑都是干净的额度桶，
#     而且**不会污染真外网 IP 的额度**（真前端还要用）。
#  2. 跑之前把数据目录里的 items/trash 清空、rate/ 清空，跑完同样清空 ——
#     自测数据不留痕（要留证据的读数下面都会打印出来）。
#
# 密码：从 /etc/feedback.env 读（600，只有 root 读得到），**不回显**。

set -uo pipefail

BASE=http://127.0.0.1:8790
PUBLIC=http://8.130.97.243
DATA=/var/lib/compile-feedback
WORK=/tmp/fb-e2e
FAKE_IP=203.0.113.77
XFF=(-H "X-Forwarded-For: $FAKE_IP")
# 打印命令时用它替换真密码（`req` 会把整条 curl 打出来，绝不能让密码进日志）
MASK='<密码已隐去>'

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

LINE() { echo; echo "======== $* ========"; }
# 打印"命令 -> 状态码 + 报文"，报文截断到 300 字符（够看，不刷屏）
req() {
  local desc="$1"; shift
  local out
  out=$(curl -sS -o "$WORK/body.out" -w '%{http_code}' "${XFF[@]}" "$@" 2>"$WORK/curl.err")
  echo "--- $desc"
  # ★ 把命令行里的真密码替换掉再打印（这条脚本的输出会被贴进回报）
  echo "    curl ${XFF[*]} ${*//$PASS/$MASK}"
  echo "    -> HTTP $out"
  echo -n "    body: "; head -c 300 "$WORK/body.out"; echo
  if [ -s "$WORK/curl.err" ]; then echo "    (curl stderr: $(head -c 200 "$WORK/curl.err"))"; fi
}

PASS=$(grep -m1 '^FEEDBACK_PASSWORD=' /etc/feedback.env | cut -d= -f2-)
if [ -z "$PASS" ]; then echo "读不到 /etc/feedback.env 里的密码，退出"; exit 2; fi

LINE "自测前的状态与清理"
echo "items: $(ls "$DATA/items" | wc -l) 项；trash: $(ls "$DATA/trash" | wc -l) 项；rate: $(ls "$DATA/rate" | wc -l) 个文件"
find "$DATA/items" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null
find "$DATA/trash" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null
# ★ 额度记账**也要清**：额度记在磁盘上、重启不清零，不清就会拿上一轮的 5 份把自己挡在门外
#   （第一次跑这脚本时就是这么红的：自测 1 直接 429）
rm -f "$DATA/rate"/*.json 2>/dev/null
systemctl restart feedback
sleep 1
echo "清空后：items: $(ls "$DATA/items" | wc -l) 项；trash: $(ls "$DATA/trash" | wc -l) 项；rate: $(ls "$DATA/rate" | wc -l) 个文件（并已重启服务让内存里的额度缓存丢掉）"
echo "日志从这一行之后的内容都是本次自测产生的：$(date -Is)"

# ---- 素材 ----
# 最小合法 PNG（1x1），用 printf 生成，不依赖 base64
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > shot.png
printf '这是一条日志\n第二行\n' > note.log
printf 'MZ fake exe\n' > evil.exe
head -c 11000000 /dev/urandom > big.png   # 11MB，超过 10MB 上限
ls -l shot.png note.log evil.exe big.png
SHOT_HASH=$(sha256sum shot.png | cut -d' ' -f1)
echo "shot.png sha256: $SHOT_HASH"

# ===========================================================================
LINE "自测 0：nginx 那一段（外网只读接口，不吃额度）"
echo "外网 GET /feedback/list（无 Cookie） -> HTTP $(curl -sS -o "$WORK/x.out" -w '%{http_code}' "$PUBLIC/feedback/list")  $(cat "$WORK/x.out")"
echo "外网 GET /feedback/item -> HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC/feedback/item?id=zzzz-9")（期望 401）"
echo "外网 GET /feedback/healthz -> HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC/feedback/healthz")（期望 403，只放 127.0.0.1）"
echo "本机打同一路径（Host 顶到本站，remote_addr=127.0.0.1） -> HTTP $(curl -sS -o "$WORK/hz.out" -w '%{http_code}' -H 'Host: 8.130.97.243' http://127.0.0.1/feedback/healthz)  $(head -c 160 "$WORK/hz.out")"
echo "外网 /turn-cred -> HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC/turn-cred")（期望 200，turn-cred 没被动过）"
echo "本站静态首页 -> HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC/")（期望 200）"
echo "站点部署标记 -> $(curl -sSI "$PUBLIC/" | grep -i x-compile-deploy | tr -d '\r')"

# ===========================================================================
LINE "自测 1：正常投稿（带 1 个 png）⇒ 200 + 磁盘上真出现 meta.json 与附件"
BEFORE_ITEMS=$(ls "$DATA/items" | wc -l)
req "正常投稿（kind=bug，带 shot.png）" -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='测试投稿：第三回合闪退' -F author='测试员' \
  -F body='点结束回合后直接白屏，控制台没有报错。' \
  -F "files=@shot.png;type=image/png"
NORMAL_BODY=$(curl -sS "${XFF[@]}" -X POST "$BASE/feedback/submit" \
  -F kind=protocol -F title='测试投稿二：协议不符' -F author='测试员2' \
  -F body='按规则应该不能出这张牌，实际出了。' \
  -F "files=@note.log;type=text/plain")
echo "第二份投稿（用来自测 list/item/file 与已读/删除）：$NORMAL_BODY"
ID=$(echo "$NORMAL_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -z "$ID" ]; then echo "**拿不到 id，后面的自测没法做，退出**"; exit 1; fi
AFTER_ITEMS=$(ls "$DATA/items" | wc -l)
echo "items 目录：投稿前 $BEFORE_ITEMS 项 -> 现在 $AFTER_ITEMS 项"
echo "--- 磁盘实况：$DATA/items/$ID/"
ls -l "$DATA/items/$ID/"
echo "--- meta.json 内容："
cat "$DATA/items/$ID/meta.json"
echo "--- 落盘的 shot.png 与本地逐字节一致吗（sha256 对比）："
STORED_PNG=$(find "$DATA/items" -name 'shot.png' | head -1)
echo "    落盘路径: $STORED_PNG"
echo "    本地: $SHOT_HASH"
echo "    落盘: $(sha256sum "$STORED_PNG" | cut -d' ' -f1)"
if [ "$SHOT_HASH" = "$(sha256sum "$STORED_PNG" | cut -d' ' -f1)" ]; then echo "    => 一致"; else echo "    => **不一致**"; fi

# ===========================================================================
LINE "自测 2：缺字段 / 字段不合法 ⇒ 400"
req "只给 kind，title/author/body 全缺" -X POST "$BASE/feedback/submit" -F kind=bug
req "kind 不在取值里" -X POST "$BASE/feedback/submit" -F kind=other -F title=t -F author=a -F body=b
req "title 全空白" -X POST "$BASE/feedback/submit" -F kind=bug -F title='   ' -F author=a -F body=b
req "body 全空白" -X POST "$BASE/feedback/submit" -F kind=bug -F title=t -F author=a -F body='  '
req "title 81 个字" -X POST "$BASE/feedback/submit" -F kind=bug -F title="$(printf 'x%.0s' $(seq 81))" -F author=a -F body=b
req "author 41 个字" -X POST "$BASE/feedback/submit" -F kind=bug -F title=t -F author="$(printf 'y%.0s' $(seq 41))" -F body=b

# ===========================================================================
LINE "自测 3：非法扩展名 ⇒ 415"
req "evil.exe" -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='非法扩展名' -F author=a -F body=b \
  -F "files=@evil.exe;type=application/octet-stream"

# ===========================================================================
LINE "自测 4：超大文件（11MB > 10MB）⇒ 413"
req "big.png（11MB）" -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='超大附件' -F author=a -F body=b \
  -F "files=@big.png;type=image/png"
echo "--- 确认没有任何 big.png 落盘（下面应为空）："
find "$DATA" -name 'big*.png' | head

# ===========================================================================
LINE "自测 5：同一个投稿带 6 个附件 ⇒ 400（契约上限 5 个）"
req "六个附件" -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='六个附件' -F author=a -F body=b \
  -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png" \
  -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png"

# ===========================================================================
LINE "自测 6：登录 —— 错误密码 ⇒ 401；正确密码 ⇒ 200 + Cookie"
WRONG_CODE=$(curl -sS "${XFF[@]}" -o "$WORK/wrong.out" -w '%{http_code}' \
  -X POST "$BASE/feedback/login" -H 'content-type: application/json' \
  --data '{"password":"definitely-not-the-password"}')
echo "错误密码 -> HTTP $WRONG_CODE  body: $(cat "$WORK/wrong.out")"
echo "   （上面这一句用的就是字面量 definitely-not-the-password，不是真密码）"
rm -f "$WORK/jar.txt"
LOGIN_CODE=$(curl -sS "${XFF[@]}" -o "$WORK/login.out" -w '%{http_code}' -c "$WORK/jar.txt" \
  -X POST "$BASE/feedback/login" -H 'content-type: application/json' \
  --data "{\"password\":\"$PASS\"}")
echo "正确密码 -> HTTP $LOGIN_CODE  body: $(cat "$WORK/login.out")"
echo "--- Set-Cookie 响应头（token 值已隐去）："
curl -sS "${XFF[@]}" -D - -o /dev/null -X POST "$BASE/feedback/login" -H 'content-type: application/json' \
  --data "{\"password\":\"$PASS\"}" | grep -i '^set-cookie:' | sed -E 's/(fb_session=)[0-9a-f]+/\1<token 已隐去>/'
echo "--- cookie jar（token 已隐去）："
sed -E 's/(fb_session\t)[^\t]+/\1<token 已隐去>/' "$WORK/jar.txt"
req "表单方式登录（契约：JSON 或表单均可）" -X POST "$BASE/feedback/login" --data-urlencode "password=$PASS"
req "不带 password 字段" -X POST "$BASE/feedback/login" -H 'content-type: application/json' --data '{}'

# ===========================================================================
LINE "自测 7：带 / 不带 Cookie 访问 list / item / file"
req "不带 Cookie GET /feedback/list" "$BASE/feedback/list"
req "不带 Cookie GET /feedback/item" "$BASE/feedback/item?id=$ID"
req "不带 Cookie GET /feedback/file" "$BASE/feedback/file?id=$ID&name=note.log"
req "带 Cookie GET /feedback/list" -b "$WORK/jar.txt" "$BASE/feedback/list"
req "带 Cookie GET /feedback/item" -b "$WORK/jar.txt" "$BASE/feedback/item?id=$ID"
req "带 Cookie GET /feedback/file" -b "$WORK/jar.txt" -D "$WORK/file.hdr" "$BASE/feedback/file?id=$ID&name=note.log"
echo "--- file 的响应头："
grep -iE 'content-type|content-disposition|cache-control|content-length' "$WORK/file.hdr" | tr -d '\r'
echo "--- file 的字节数：$(wc -c < "$WORK/body.out")，期望 $(wc -c < "$WORK/note.log")"

# ===========================================================================
LINE "自测 8：路径穿越尝试"
PASSWD_HASH_BEFORE=$(sha256sum /etc/passwd | cut -d' ' -f1)
echo "/etc/passwd sha256（事前）: $PASSWD_HASH_BEFORE"
: > "$WORK/traversal.txt"
for evil in '../../etc/passwd' '..%2F..%2Fetc%2Fpasswd' '/etc/passwd' 'meta.json' 'x/../../meta.json' '....//....//etc/passwd'; do
  code=$(curl -sS "${XFF[@]}" -o "$WORK/t.out" -w '%{http_code}' -b "$WORK/jar.txt" \
    --get --data-urlencode "id=$ID" --data-urlencode "name=$evil" "$BASE/feedback/file")
  echo "  name=$evil -> HTTP $code  body: $(head -c 120 "$WORK/t.out")"
  cat "$WORK/t.out" >> "$WORK/traversal.txt"
done
echo "  另外试 id 也穿越（delete 契约要求 400）："
code=$(curl -sS "${XFF[@]}" -o "$WORK/t.out" -w '%{http_code}' -b "$WORK/jar.txt" \
  -X POST "$BASE/feedback/delete" -H 'content-type: application/json' \
  --data '{"id":"../../etc/passwd"}')
echo "  delete id=../../etc/passwd -> HTTP $code  body: $(cat "$WORK/t.out")"
req "file 的 id 也穿越" -b "$WORK/jar.txt" --get --data-urlencode 'id=../../etc/passwd' --data-urlencode 'name=passwd' "$BASE/feedback/file"
PASSWD_HASH_AFTER=$(sha256sum /etc/passwd | cut -d' ' -f1)
echo "/etc/passwd sha256（事后）: $PASSWD_HASH_AFTER"
if [ "$PASSWD_HASH_BEFORE" = "$PASSWD_HASH_AFTER" ]; then echo "  => 一致，没有被读到/改装"; else echo "  => **变了，出事了**"; fi
if grep -q 'root:x:' "$WORK/traversal.txt" "$WORK/t.out"; then echo "  => **报文里读到了 /etc/passwd 的内容**"; else echo "  => 所有报文里都没有 root:x:（没读到 /etc/passwd）"; fi

# ===========================================================================
LINE "自测 9：追加需求 —— 标记已读 / 未读"
req "标已读" -b "$WORK/jar.txt" -X POST "$BASE/feedback/read" \
  -H 'content-type: application/json' --data "{\"id\":\"$ID\",\"read\":true}"
curl -sS "${XFF[@]}" -b "$WORK/jar.txt" "$BASE/feedback/list" > "$WORK/list1.json"
python3 - "$WORK/list1.json" "$ID" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
target = [i for i in d['items'] if i['id'] == sys.argv[2]][0]
print('  list: total=%d unread=%d' % (d['total'], d['unread']))
print('  该条: read=%r readAt=%r fileCount=%r' % (target['read'], target['readAt'], target['fileCount']))
PYEOF
echo "--- meta.json 磁盘上的 read/readAt（不是只改了内存）："
python3 -c "import json; d=json.load(open('$DATA/items/$ID/meta.json',encoding='utf-8')); print('  read=%r readAt=%r' % (d.get('read'), d.get('readAt')))"
req "标回未读" -b "$WORK/jar.txt" -X POST "$BASE/feedback/read" \
  -H 'content-type: application/json' --data "{\"id\":\"$ID\",\"read\":false}"
curl -sS "${XFF[@]}" -b "$WORK/jar.txt" "$BASE/feedback/list" > "$WORK/list2.json"
python3 - "$WORK/list2.json" "$ID" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
target = [i for i in d['items'] if i['id'] == sys.argv[2]][0]
print('  标回未读后: total=%d unread=%d 该条 read=%r readAt=%r' % (d['total'], d['unread'], target['read'], target['readAt']))
PYEOF
req "read 用不存在的 id" -b "$WORK/jar.txt" -X POST "$BASE/feedback/read" \
  -H 'content-type: application/json' --data '{"id":"zzzz-9","read":true}'
req "read 不带 Cookie" -X POST "$BASE/feedback/read" \
  -H 'content-type: application/json' --data "{\"id\":\"$ID\",\"read\":true}"
req "read 的 read 不是布尔" -b "$WORK/jar.txt" -X POST "$BASE/feedback/read" \
  -H 'content-type: application/json' --data "{\"id\":\"$ID\",\"read\":\"yes\"}"

# ===========================================================================
LINE "自测 10：追加需求 —— 软删除"
TRASH_BEFORE=$(ls "$DATA/trash" | wc -l)
req "删除该投稿" -b "$WORK/jar.txt" -X POST "$BASE/feedback/delete" \
  -H 'content-type: application/json' --data "{\"id\":\"$ID\"}"
TRASH_AFTER=$(ls "$DATA/trash" | wc -l)
echo "--- trash：$TRASH_BEFORE 项 -> $TRASH_AFTER 项"
ls -l "$DATA/trash"
LATEST_TRASH=$(ls -t "$DATA/trash" | head -1)
echo "--- 进 trash 的那一份里有什么（$LATEST_TRASH）："
ls -l "$DATA/trash/$LATEST_TRASH"
echo "--- items 里还有没有它：$(ls "$DATA/items" | grep -c "$ID") 个匹配（期望 0）"
req "删除后再 list" -b "$WORK/jar.txt" "$BASE/feedback/list"
req "删除后 item" -b "$WORK/jar.txt" "$BASE/feedback/item?id=$ID"
req "删除后 file" -b "$WORK/jar.txt" "$BASE/feedback/file?id=$ID&name=note.log"
req "再删一次（已不存在）" -b "$WORK/jar.txt" -X POST "$BASE/feedback/delete" \
  -H 'content-type: application/json' --data "{\"id\":\"$ID\"}"
req "delete 不带 Cookie" -X POST "$BASE/feedback/delete" \
  -H 'content-type: application/json' --data '{"id":"whatever"}'

# ===========================================================================
LINE "自测 11：限额按**提交份数**计（2026-10-01 改口径）—— 三条硬判据"
QUOTA=$DATA/rate/submits-$(date +%Y-%m-%d).json
q_used() { python3 -c "import json,sys,os;f=sys.argv[1];t=json.load(open(f,encoding='utf-8')) if os.path.exists(f) else {};print(t.get('$FAKE_IP',0))" "$QUOTA" 2>/dev/null || echo "?"; }
q_dump() { if [ -f "$QUOTA" ]; then echo "    $QUOTA = $(cat "$QUOTA")"; else echo "    $QUOTA 还不存在"; fi; }

echo "--- 现在这个 IP 的额度记账："; q_dump
echo "    （自测 1 成功投了 2 份 ⇒ 按新口径应当是 2，而不是附件个数 2）"

echo "① 带 5 个附件的一次提交只占 1 个额度"
BEFORE=$(q_used)
req "一次带 5 个附件" -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='额度口径①：一次五个附件' -F author=a -F body=b \
  -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png"
AFTER=$(q_used)
echo "    额度：$BEFORE 份 -> $AFTER 份（期望 +1，不是 +5）"
q_dump

echo "② 连投 5 次成功、第 6 次 429"
echo "    目前 $AFTER 份；再投 $((5-AFTER)) 次应该都成功，第 6 次 429"
n=$AFTER
while [ "$n" -lt 5 ]; do
  n=$((n+1))
  code=$(curl -sS "${XFF[@]}" -o "$WORK/q.out" -w '%{http_code}' -X POST "$BASE/feedback/submit" \
    -F kind=bug -F title="额度口径②：第 $n 份" -F author=a -F body=b -F "files=@shot.png")
  echo "  第 $n 份投稿 -> HTTP $code  body: $(head -c 200 "$WORK/q.out")"
done
echo "  第 6 份投稿 ->"
code=$(curl -sS "${XFF[@]}" -o "$WORK/q.out" -w '%{http_code}' -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='额度口径②：第 6 份' -F author=a -F body=b -F "files=@shot.png")
echo "    -> HTTP $code  body: $(cat "$WORK/q.out")"
q_dump
echo "  再打一次（确认计数没有被顶过 5）："
code=$(curl -sS "${XFF[@]}" -o "$WORK/q6b.out" -w '%{http_code}' -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='额度口径②：再来一次' -F author=a -F body=b -F "files=@shot.png")
echo "    -> HTTP $code  额度：$(q_used) 份"
q_dump

echo "③ 附件超 5 个仍然 400（这条判据没被改口径影响，而且不占额度）"
BEFORE6=$(q_used)
req "一次带 6 个附件" -X POST "$BASE/feedback/submit" \
  -F kind=bug -F title='额度口径③：六个附件' -F author=a -F body=b \
  -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png" \
  -F "files=@shot.png" -F "files=@shot.png" -F "files=@shot.png"
echo "    额度：$BEFORE6 -> $(q_used) 份（期望不变）"

echo "--- 逐份核对 meta.json 里列的每个 storedAs 是否真在磁盘上（这是最容易悄悄坏掉的一处）："
python3 - "$DATA" <<'PYEOF'
import json, os, sys
root = os.path.join(sys.argv[1], 'items')
bad = 0
att = 0
for name in sorted(os.listdir(root)):
    mpath = os.path.join(root, name, 'meta.json')
    if not os.path.exists(mpath):
        print('  ** %s 没有 meta.json' % name); bad += 1; continue
    m = json.load(open(mpath, encoding='utf-8'))
    files = m.get('files') or []
    for f in files:
        att += 1
        p = os.path.join(root, name, f['storedAs'])
        if not os.path.exists(p):
            print('  ** %s 的 meta 里列了 %s，磁盘上没有' % (name, f['storedAs'])); bad += 1
        elif os.path.getsize(p) != f['size']:
            print('  ** %s/%s 大小不符：meta=%d 实际=%d' % (name, f['storedAs'], f['size'], os.path.getsize(p))); bad += 1
print('  投稿 %d 份，附件 %d 个，对不上的 %d 处' % (len(os.listdir(root)), att, bad))
PYEOF
echo "--- 磁盘上的附件文件总数（应等于上面的附件数）："
find "$DATA/items" -type f ! -name meta.json | wc -l

echo "--- 旧口径的 files-*.json 不参与计数（放一个进 rate/，重启服务看额度有没有被误读）："
LEGACY=$DATA/rate/files-$(date +%Y-%m-%d).json
BEFORE_LEGACY=$(q_used)
echo "{\"$FAKE_IP\": 999}" > "$LEGACY"
systemctl restart feedback; sleep 1
AFTER_LEGACY=$(q_used)
echo "    放了 files-*.json（写着 $FAKE_IP = 999，即旧口径下用过 999 个文件）"
echo "    重启后这个 IP 的额度：$BEFORE_LEGACY 份 -> $AFTER_LEGACY 份（期望不变，说明旧文件没被读成份数）"
echo "    healthz 的 legacyRateFiles：$(curl -sS http://127.0.0.1:8790/feedback/healthz | python3 -c 'import json,sys;print(json.load(sys.stdin)["legacyRateFiles"])')（期望 >= 1：被看见了，但没被读）"
echo "    额度目录里现在有：$(ls "$DATA/rate" | tr '\n' ' ')"

# ===========================================================================
LINE "自测 12：日志里没有正文 / 密码 / cookie"
echo "--- /var/log/feedback.log 命中 '点结束回合后直接白屏' 的行数（期望 0）："
grep -c '点结束回合后直接白屏' /var/log/feedback.log || true
echo "--- 命中密码原文的行数（期望 0）："
grep -c "$PASS" /var/log/feedback.log || true
echo "--- 命中 'fb_session=' 的行数（期望 0）："
grep -c 'fb_session=' /var/log/feedback.log || true
echo "--- 日志尾部 6 行："
tail -6 /var/log/feedback.log

echo
echo "== 跑完了 =="
