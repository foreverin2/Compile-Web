# RUNBOOK：Compile 反馈收集后端

对象：`server/feedback/`（零依赖 Node 服务）+ `deploy/install.sh` + nginx 里的 `/feedback/` 反代。
前端在 `src/ui/feedback-screen.ts` 那一侧由另一个 agent 写，两边按**同一份接口契约**对齐
（契约原文见下 §1，服务端逐字实现，不许自行发挥）。

本文件里所有命令都是**在服务器上以 root 跑**的（`ssh root@8.130.97.243`）。

---

## 0. 上线记录：**2026-10-01 已完成**（`8.130.97.243`）

| 项 | 值 |
|---|---|
| 服务地址 | `http://127.0.0.1:8790`（只监听本机），外网走 `http://8.130.97.243/feedback/...` |
| systemd 单元 | `feedback.service`（用户 `feedback`，`enabled` + `active`） |
| 数据目录 | `/var/lib/compile-feedback/`（`feedback:feedback 0700`） |
| 日志 | `/var/log/feedback.log`（`feedback:adm 0640`，5MB 自轮转） |
| 配置 | `/etc/feedback.env`（`root:root 0600`，密码只在这里） |
| 源码 | `/opt/feedback/`（`server.mjs` + `lib/` + `deploy/` + `tools/`） |
| nginx | 站点 `/etc/nginx/sites-available/compile` 里新增 `location = /feedback/healthz` 与 `location ^~ /feedback/`；备份 `compile.bak-20261001-1223` |
| 站点部署标记 | `X-Compile-Deploy: b2-feedback-20261001`（`curl -sSI http://8.130.97.243/ \| grep -i x-compile`） |
| 没碰的东西 | `turn-cred.service`（仍在 `127.0.0.1:8788`）、端口 3080 / 5173、`/var/www/compile` 的静态文件、站点里原有的每个 location |

**2026-10-01 当天晚些时候又改了一次口径并重新部署**（用户追加要求）：限额从"每天最多 5 个文件"
改成"**每天最多 5 次成功的投稿**"（按份数计）。改动落在 `lib/rate-limit.mjs`（`FileQuota` -> `SubmitQuota`，
记账文件 `files-<日期>.json` -> `submits-<日期>.json`）、`lib/handler.mjs`、`lib/config.mjs`、
`lib/validate.mjs`、`server.mjs`、`tests/feedback/server.test.ts`、`tools/e2e-feedback.sh` 与本文件。
`/opt/feedback` 与仓库 11 个源文件 sha256 逐个相同；服务重启后 `healthz` 回
`{"ok":true,...,"submitsPerIpPerDay":5,...,"legacyRateFiles":0}`。实测读数见 §9。

**2026-10-02 又修了一处**（全量测试跑出来的 2 条红）：`SubmitQuota.tableFor()` 在"缓存里没有
这个日期键"时**直接当空表**，不走盘。产线里恰好看不出问题（构造函数装的日期与请求的日期都是
"今天"），但跨天那一瞬间会把额度误判成 0。现在改成"缓存 miss ⇒ `readDayFromDisk`"，
并补了"冷缓存读盘"与"并发 12 份"两条用例（都用变异验证过会反向变红）。
另外把测试里的日期夹具从写死的 `2026-10-01` 改成锚在真今天 —— 写死过去日期会被 `prune()`
当过期文件清掉，让用例以夹具的方式变红。详见 §5.2。

**2026-10-02 部署后又抓到一处自己的疏漏**：上面那条"旧 `files-*.json` 被无视"的日志原先写在
`readDayFromDisk` 的早退分支里 ⇒ 今天一旦已经有过成功投稿，重启后**这条提示永远不出现**
（而运维最需要看到它的时刻恰恰是升级之后）。现在挪到构造函数里、每进程报一次
（`reportLegacyFilesOnce`），并补了一条"今天已有 submits 文件时也要报"的用例。
部署后实测：日志里出现 `"result":"legacy-rate-file-ignored"`，`legacy:["files-2026-10-02.json"]`。

上线当天的实测读数见 §9（命令与输出都在那儿）。

---

## 1. 接口契约（**前端照这份写，服务端照这份实现**）

全部同源挂在 `/feedback/...` 下，nginx 反代到 `127.0.0.1:8790`。
所有响应带 `Cache-Control: no-store`；同源，不需要 CORS，不处理 `OPTIONS`。
失败一律是 `{ ok: false, error: '<中文原因>' }` + 对应状态码。

### `POST /feedback/submit`（无需登录）

`multipart/form-data`：`kind`（`protocol` \| `bug`）、`title`、`author`、`body`、附件字段名 `files`（0..5 个）。

| 判据 | 不满足时 |
|---|---|
| `kind` 必须是 `protocol` 或 `bug` | 400 |
| `title` 去首尾空白后 1..80 字 | 400 |
| `author` 去首尾空白后 1..40 字 | 400 |
| `body` 去首尾空白后 1..5000 字 | 400 |
| 一次最多 5 个附件 | 400 |
| 每个文件 <= 10MB | 413 |
| 扩展名白名单 `png jpg jpeg gif webp pdf txt md log json csv`（大小写不敏感） | 415 |
| 每个 IP **每天最多 5 次成功的投稿**（按**份数**计：一次提交带 0 / 1 / 5 个附件都只占 1 份） | 429（带 `Retry-After`） |

成功：`200 {"ok":true,"id":"<id>"}`。落盘：`items/<id>/meta.json` + 附件原件。
`id` 形状 = `<毫秒时间戳 base36>-<8 字节随机 hex>`（例：`mup16fh8-7263ccc0d77f1701`）。

> ★ **限额口径在 2026-10-01 当天改过一次**（用户拍板）：原来是"每 IP 每天最多 5 个文件"
> （按附件个数计），现在是"**每 IP 每天最多 5 次成功的投稿**"（按份数计）。
> 一次提交不管带 0 个还是 5 个附件，都只占 **1** 个额度；第 6 次 429。
> 每次提交内部"附件最多 5 个"是**另一条独立判据**（超了仍然 400），不受这次改动影响。
> 旧口径的记账文件怎么处理见 §5 与 §6。
> 被拒的那次不占额度（记账只在**真正落盘成功之后**做）。

### `POST /feedback/login`

JSON `{"password":"..."}` 或表单 `password=...` 均可。
对：`200 {"ok":true}` + `Set-Cookie: fb_session=<token>; HttpOnly; SameSite=Strict; Path=/feedback; Max-Age=43200`。
错：`401 {"ok":false,"error":"密码不对"}`。
同一 IP **10 分钟内失败 >= 5 次**：一律 `429`（连密码都不再比）。
会话在**服务端内存**里（token -> 过期时刻），**重启即失效**（契约明确说可接受）。

### `GET /feedback/list`（需会话）

`200 { ok:true, items:[{ id, kind, title, author, createdAt, fileCount, read, readAt }], unread, total }`
**最新的在最前**；`unread` 是未读条数、`total` 是总数。

### `GET /feedback/item?id=<id>`（需会话）

`200 { ok:true, item:{ id, kind, title, author, body, createdAt, read, readAt, files:[{name,size}] } }`
**不回** `ip`、**不回**任何服务器绝对路径。找不到：404 `{"ok":false,"error":"没有这份投稿。"}`

### `GET /feedback/file?id=<id>&name=<name>`（需会话）

返回附件字节，`Content-Disposition: inline`，图片 / PDF 给对 `Content-Type`，另带 `X-Content-Type-Options: nosniff`。
`name` 必须**逐字命中**该 item 的清单（防路径穿越），不命中：404。

### `POST /feedback/read`（需会话，2026-10-01 追加）

JSON `{"id":"...","read":true|false}`（`false` 是"标回未读"）。
`200 {"ok":true,"id":"...","read":true}`；`id` 不存在 404 `{"ok":false,"error":"找不到这条反馈"}`；
`read` 不是布尔 400；`id` 带路径分隔符或 `..` 400。
改的是 `meta.json` 里的 `read` / `readAt`（标已读记此刻、标回未读把 `readAt` 清回 `null`）。

### `POST /feedback/delete`（需会话，2026-10-01 追加）

JSON `{"id":"..."}`。**软删除**：把 `items/<id>/` 整个目录**移到** `trash/<id>-<时间戳>/`，**不是 rm**。
`200 {"ok":true,"id":"..."}`；`id` 不存在 404 同上；`id` 带路径分隔符或 `..` 400。
删除后 `list` 里不再出现；`item` / `file` 对已删除的 `id` 一律 404。

### `GET /feedback/healthz`（**只从 127.0.0.1**）

nginx 上 `allow 127.0.0.1; deny all;`，外网访问是 403。回条数、会话数、当前限额，用于监控。

---

## 2. 首次安装（新机器从零到能跑）

```bash
# 0) 本地把源码打成一个包传上去（Windows 上就是 tar + scp）
#    tar -czf feedback-src.tgz server/feedback
#    scp feedback-src.tgz root@8.130.97.243:/tmp/
ssh root@8.130.97.243
mkdir -p /tmp/feedback-src && tar -xzf /tmp/feedback-src.tgz -C /tmp/feedback-src

# 1) 准备配置：复制模板，把 FEEDBACK_PASSWORD 换成真密码。
#    仓库里的模板是 deploy/feedback.env.example（里面是 __SET_ME__ 占位），
#    **别把真密码写回仓库**。
cp /tmp/feedback-src/server/feedback/deploy/feedback.env.example /tmp/feedback.env.new
vi /tmp/feedback.env.new        # 只改 FEEDBACK_PASSWORD 那一行
chmod 600 /tmp/feedback.env.new

# 2) 一条命令装完（建用户 / 铺源码 / 建数据目录 / 写单元 / 自检 / 起服务）
bash /tmp/feedback-src/server/feedback/deploy/install.sh \
     /tmp/feedback-src/server/feedback /tmp/feedback.env.new
#    脚本会把 /tmp/feedback.env.new 装成 /etc/feedback.env 并删掉暂存文件

# 3) 本机自检
curl -sS http://127.0.0.1:8790/feedback/healthz; echo
```

期望输出（2026-10-01 实测；字段名跟着新口径改成了 `submitsPerIpPerDay`）：

```
{"ok":true,"service":"feedback","items":0,"trash":0,"sessions":0,
 "submitsPerIpPerDay":5,"maxFileBytes":10485760,"maxFilesPerItem":5,"legacyRateFiles":0}
```

`legacyRateFiles` 是"旧口径（`files-*.json`）还剩几个没清"的个数，只报数不读内容（见 §6）。

自检那一步（`install.sh` 的 §7）会打印配置摘要，形如：

```
[feedback] 配置 OK：127.0.0.1:8790 数据 /var/lib/compile-feedback 密码来源=env:FEEDBACK_PASSWORD
单文件上限=10485760 单次附件上限=5 每IP每天份数=5 会话=43200s 登录失败闸=5/600s
信代理=true 请求体上限=53477376 日志=/var/log/feedback.log
```

**缺密码时服务拒绝启动**（`--check` 退 2）——这是故意的，别把它当故障：
一个没有密码的反馈后台等于谁都能看投稿。

---

## 3. nginx：同源反代 `/feedback/`

改之前**先备份**，改完 `nginx -t` 通过才 reload：

```bash
cp -a /etc/nginx/sites-available/compile /etc/nginx/sites-available/compile.bak-$(date +%Y%m%d-%H%M)
vi /etc/nginx/sites-available/compile      # 在 server 块里加下面两段
nginx -t && systemctl reload nginx
```

```nginx
    # 服务自己的健康检查只给本机（与 /healthz-turn-cred 同一个口径）
    location = /feedback/healthz {
        allow 127.0.0.1; deny all;
        proxy_pass http://127.0.0.1:8790/feedback/healthz;
    }

    # 同源反代：前端打 /feedback/... ，这里原样转发给 127.0.0.1:8790。
    # proxy_pass 后面**不带路径**，nginx 会把 /feedback/xxx 整个原样转过去。
    location ^~ /feedback/ {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # ★ 服务端按最后一跳取客户端 IP（FEEDBACK_TRUST_PROXY=1 时才信）
        #   这一条是"每 IP 每天 5 次投稿"与"登录失败限流"的键
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        # 附件最大 10MB，nginx 默认只放 1MB —— 放到 16m，**让服务端自己判 413**
        # 并回契约里那句 JSON；真超了 16m，下面 error_page 兜一个同样的 JSON。
        client_max_body_size 16m;
        client_body_timeout 120s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        add_header Cache-Control "no-store" always;
        error_page 413 = @feedback_too_large;
    }
    location @feedback_too_large {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        return 413 '{"ok":false,"error":"附件太大了：单个文件上限 10MB（超过这个数的请求会在服务端被直接拒掉，不会落盘）。"}';
    }
```

**两条容易踩的**：

1. `location ^~ /feedback/` 会盖住站点里**其它** `/feedback` 开头的路径。
   要放静态文件进去就别放这个前缀下面，或者把它改成更精确的 location。
2. `client_max_body_size` 是**全局 1MB 默认值**的坑：不改的话 10MB 附件在 nginx 那一层就被拒，
   客户端拿到的是 nginx 的 413 页面（HTML），不是契约里的 JSON。所以这里放到 16m。

校验：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://8.130.97.243/feedback/list        # 401（无 Cookie）
curl -sS http://8.130.97.243/feedback/list; echo                                   # {"ok":false,"error":"未登录"}
curl -sS -o /dev/null -w '%{http_code}\n' http://8.130.97.243/feedback/healthz     # 403（只放本机）
curl -sS -o /dev/null -w '%{http_code}\n' http://8.130.97.243/turn-cred            # 200（turn-cred 没被动）
```

---

## 4. 升级（换一版代码）

```bash
# 本地：tar -czf feedback-src.tgz server/feedback && scp feedback-src.tgz root@8.130.97.243:/tmp/
ssh root@8.130.97.243
rm -rf /tmp/feedback-src && mkdir -p /tmp/feedback-src && tar -xzf /tmp/feedback-src.tgz -C /tmp/feedback-src
# 不带第二个参数 ⇒ 保留现有 /etc/feedback.env（不会把线上密码清空）
bash /tmp/feedback-src/server/feedback/deploy/install.sh /tmp/feedback-src/server/feedback
curl -sS http://127.0.0.1:8790/feedback/healthz; echo
journalctl -u feedback -n 30 --no-pager
```

`install.sh` 是幂等的，重复跑只会整体替换 `/opt/feedback` 里的源码再重启。
**升级会清掉内存里的会话**（所有人要重新输一次密码）——契约说这是可接受的。

回滚：把上一版源码重新打一次包走同一条命令即可（代码与数据是分开的，`/var/lib` 一个字节都不会动）。

---

## 5. 数据长什么样，怎么看

```bash
# 概览
ls /var/lib/compile-feedback/items | wc -l          # 投稿份数
ls /var/lib/compile-feedback/trash | wc -l          # 已软删除的份数
cat /var/lib/compile-feedback/rate/submits-$(date +%Y-%m-%d).json   # 今天每个 IP 已经交了几份
#   ↑ 形如 {"203.0.113.7":3,"198.51.100.9":5} —— 数字是**份数**（一次提交算 1，不管带几个附件）

# 一份投稿
cat /var/lib/compile-feedback/items/<id>/meta.json
ls -l /var/lib/compile-feedback/items/<id>/

# 最近 10 份（按时间倒序，只看标题）
for d in $(ls -t /var/lib/compile-feedback/items | head -10); do
  python3 -c "import json;m=json.load(open('/var/lib/compile-feedback/items/$d/meta.json'));\
print(m['createdAt'], m['id'], m['kind'], 'read=%s' % m['read'], m['title'])"
done

# 把某一份整个打包拉回本地看
tar -czf /tmp/item-<id>.tgz -C /var/lib/compile-feedback/items <id>
```

`meta.json` 字段：`id / kind / title / author / body / createdAt / ip / read / readAt / files[]`。
`files[]` 每项是 `{ name, size, storedAs }` —— `name` 是净化后的文件名，`storedAs` 是磁盘上的基名
（重名会自动加 `-1` / `-2`）。**接口回的 `name` 就是 `storedAs`。**

### 5.1 两代额度记账文件（改口径留下的）

| 文件 | 什么时候写的 | 数字的含义 | 现在读不读 |
|---|---|---|---|
| `rate/submits-<日期>.json` | 2026-10-01 改口径之后 | **提交份数**（一次提交 = 1） | 读，这就是当前额度 |
| `rate/files-<日期>.json` | 2026-10-01 改口径之前 | **附件个数**（一次带 5 个附件 = 5） | **不读**，也不自动删 |

为什么旧文件不能接着用：两个数字**不是一回事**（一次带 5 个附件的提交，旧文件记 5、新口径只算 1），
换算不回去 ⇒ 宁可从零开始记，也不要把旧数据误读成"份数"把正常用户挡在门外。
**代价**：升级当天，改口径之前已经投过稿的 IP 会重新拿到 5 份额度（多放几份，可以接受）。

于是 `rate/` 下会同时躺着两代文件。要看/要清：

```bash
ls -l /var/lib/compile-feedback/rate/                 # 两代都在
cat /var/lib/compile-feedback/rate/submits-*.json      # 当前额度（份）
cat /var/lib/compile-feedback/rate/files-*.json        # 旧口径的历史，仅供对账
curl -sS http://127.0.0.1:8790/feedback/healthz | python3 -m json.tool | grep legacyRateFiles
```

被无视的旧文件**会在日志里说一次**（启动时无条件报，与"今天投过没有"无关）：

```bash
grep legacy-rate-file-ignored /var/log/feedback.log
```

### 5.2 额度文件的保留窗口与"冷缓存读盘"（2026-10-02 修的）

两条与时间有关的规则，排查额度问题时先记住这两条：

1. **只保留今天与昨天的 `submits-*.json`**。`prune()` 会把**早于昨天**的记账文件删掉
   （额度按天分，隔两天就没用了）。所以别指望在 `rate/` 里翻到上个月的额度记录。
2. **缓存里没有某个日期键时，一定去盘上读一次**（`tableFor` 缓存 miss ⇒ `readDayFromDisk`）。
   也就是说"进程今天启动过，但请求跨到了第二天"这种情况不会把额度误判成 0
   （早先的实现是"缓存 miss 就当空表"，只在跨天那一瞬间出问题，已修）。

   > 这一条也是自己给自己提的醒：写单测时**日期夹具要锚在真今天**，不要写死 `new Date(2026, 9, 1)`。
   > 写死一个过去的日期时，新建实例的 `prune()` 会把那个日期当成过期文件清掉，
   > 于是"重启后额度还在吗"这条用例会以**夹具的方式**变红，看着像实现坏了。
   > 现在的夹具用 `Date.now()` 推今天/昨天/明天（见 `tests/feedback/server.test.ts` 里那段注释）。

备份（整个数据目录，含 trash）：

```bash
tar -czf /root/compile-feedback-$(date +%Y%m%d).tgz -C /var/lib compile-feedback
```

---

## 6. 日志、轮转与排错

```bash
tail -f /var/log/feedback.log
# 一行一条 JSON：ts / level / ip / method / path / status / result + 该事件的少量字段
# result 取值：listening | healthz | submitted | rejected:xxx | rate-limited:submits-per-day |
#              login-ok | login-failed | rate-limited:login-failures | unauthenticated |
#              list | item | item-not-found | file | attachment-not-found | read-set |
#              deleted | trash-move-failed | meta-write-failed | method-not-allowed | not-found

grep -c '"result":"submitted"' /var/log/feedback.log          # 一共收了多少份
grep '"status":429' /var/log/feedback.log | tail -20          # 谁在被限流
grep '"result":"login-failed"' /var/log/feedback.log          # 有人猜密码
grep '"result":"file"' /var/log/feedback.log | tail            # 谁在下载附件
```

**日志里没有**：密码原文、会话 token、`Cookie` 头、投稿正文、客户端原始文件名
（只记净化后的 `storedAs`）。要看正文就去读 `items/<id>/meta.json`。
`feedback.log` 超过 `FEEDBACK_LOG_MAX_BYTES`（缺省 5MB）自己轮转成 `feedback.log.1`；
再要更长的历史用 `journalctl -u feedback`（stdout/stderr 也进 journal）。

### 6.1 额度怎么清零 / 怎么查某个 IP 交了没

额度按天记在 `rate/submits-<日期>.json` 里（`{"IP": 份数}`），跨天自动重算。
**要立刻给某个 IP（或所有人）恢复额度**，把这个文件删掉再重启服务即可 ——
进程启动时会重新读这个文件，读不到就是空表：

```bash
# ① 只清今天这一个 IP 的额度
python3 - <<'PY'
import json, os, datetime
f = '/var/lib/compile-feedback/rate/submits-%s.json' % datetime.date.today()
t = json.load(open(f, encoding='utf-8')) if os.path.exists(f) else {}
t.pop('203.0.113.7', None)          # 换成要放行的 IP
json.dump(t, open(f, 'w', encoding='utf-8'))
PY
systemctl restart feedback          # 让内存里那份缓存丢掉

# ② 今天所有人的额度全清（明天自然也会清，这只用于"现在就要放行"）
rm -f /var/lib/compile-feedback/rate/submits-$(date +%Y-%m-%d).json
systemctl restart feedback

# ③ 清掉旧口径（files-*）的历史文件 —— 只影响看起来干不干净，不影响额度
rm -f /var/lib/compile-feedback/rate/files-*.json
```

查"这个 IP 今天还能交几份"：

```bash
IP=203.0.113.7
python3 -c "import json,datetime;f='/var/lib/compile-feedback/rate/submits-%s.json'%datetime.date.today();\
import os;t=json.load(open(f,encoding='utf-8')) if os.path.exists(f) else {};\
print('已交', t.get('$IP',0), '份，还剩', 5-t.get('$IP',0), '份')"
```

**注意**：额度记在磁盘上，所以**重启不清零**（这是有意的：不然重启一下就又能刷）。
只有登录失败闸在内存里，重启会清。

常见故障：

| 现象 | 先看这里 |
|---|---|
| 外网 `/feedback/list` 是 502 | `systemctl status feedback`；`curl -sS 127.0.0.1:8790/feedback/healthz` |
| 服务起不来、`exit 2` | `journalctl -u feedback -n 30`；多半是 `/etc/feedback.env` 缺 `FEEDBACK_PASSWORD` 或读不到 |
| 所有人都被算成同一个 IP（额度一开局就用光） | `/etc/feedback.env` 里的 `FEEDBACK_TRUST_PROXY=1` 在不在；nginx 有没有转发 `X-Forwarded-For` |
| 10MB 附件返回的是 HTML 413 页面 | nginx 的 `client_max_body_size` 没放到 16m |
| 登录一下就被 429 | 同一 IP 10 分钟内失败过 5 次。重启服务可立刻清空这个计数（在内存里） |
| 投稿被 429，但看着"没交几份" | 看 `rate/submits-<今天>.json` 里这个 IP 的数字（单位是**份**，一次提交算 1）；日志里 `rate-limited:submits-per-day` 那条带 `used` |
| 升级后 `rate/` 里同时有 `submits-` 与 `files-` | 正常，见 §5.1；旧文件不参与计数，可留可删 |
| 投稿成功但 `list` 里没有 | 看 `journalctl -u feedback` 有没有 `write-failed`；再看 `/var/lib/compile-feedback/tmp` 有没有残留 |
| 改完 nginx 起不来 | `nginx -t`；回滚：`cp -a /etc/nginx/sites-available/compile.bak-<ts> /etc/nginx/sites-available/compile` |

重启与查看状态：

```bash
systemctl restart feedback
systemctl status feedback --no-pager
systemctl show feedback -p User -p ProtectSystem -p NoNewPrivileges -p ReadWritePaths
ss -ltnp | grep 8790          # 应当只出现在 127.0.0.1
```

---

## 7. 删除、捞回与彻底清空

`POST /feedback/delete` 是**软删除**：目录被移到 `trash/<id>-<时间戳>/`，原件一个字节没动。

```bash
# 看 trash 里有什么
ls -l /var/lib/compile-feedback/trash

# 捞回一份（把目录移回 items/，名字改回 id）
ID=<id>; DIR=$(ls -d /var/lib/compile-feedback/trash/$ID-* | head -1)
mv "$DIR" "/var/lib/compile-feedback/items/$ID"
chown -R feedback:feedback "/var/lib/compile-feedback/items/$ID"
# 之后 list / item / file 立刻又能看到它（meta.json 里的 read 状态一并回来）

# 彻底清空 trash（**不可恢复**，先确认再敲）
ls -l /var/lib/compile-feedback/trash        # 看一眼
rm -rf /var/lib/compile-feedback/trash/*
```

真要**永久删除**一份还在 `items/` 里的投稿（接口只提供软删除）：

```bash
rm -rf /var/lib/compile-feedback/items/<id>
```

---

## 8. 轮换后台密码

密码只在 `/etc/feedback.env` 里，改完重启即可（会话在内存里，重启会一起失效 —— 这正好）：

```bash
cp -a /etc/feedback.env /root/feedback.env.bak-$(date +%Y%m%d-%H%M)   # 先备份（600）
vi /etc/feedback.env                                                  # 改 FEEDBACK_PASSWORD
chmod 600 /etc/feedback.env
systemctl restart feedback
journalctl -u feedback -n 5 --no-pager
```

改完通知前端使用人新密码；旧的会话已全部作废（重启清空内存会话表）。
**别把新密码写进仓库、别贴进聊天记录**——仓库里的模板永远是 `__SET_ME__`。

顺带记一条：`/etc/feedback.env` 的权限必须是 600。systemd 会以 `root` 读它再降权到 `feedback`，
所以 `feedback` 用户本身读不到这个文件（`ls -l` 应是 `-rw------- root root`）。

---

## 9. 端到端实测记录（2026-10-01，服务器上 `curl` 实测）

跑法：把测试脚本传上去 `bash /tmp/e2e-feedback.sh`，全部请求打
`http://127.0.0.1:8790/feedback/...`（服务本身），另用外网地址验 nginx 那一段。
每个请求都带 `X-Forwarded-For: 203.0.113.77`（文档保留地址）⇒ 限流桶是干净可重复的，
**不占用真外网 IP 的额度**。

**先说结论**：下面每一条都当场拿到了期望的状态码与报文，一轮跑完没有反例。

| 用例 | 命令（要点） | 实测 |
|---|---|---|
| 正常投稿（1 个 png） | `curl -X POST .../submit -F kind=bug -F title=... -F files=@shot.png` | `200 {"ok":true,"id":"mup15qij-efb6f6791e15d24d"}`；`items/<id>/` 下真出现 `meta.json` + `shot.png`，**sha256 与本地逐字节相同**（`ebf4f635a17d…9d2a`） |
| 缺字段 | 只发 `-F kind=bug` | `400 {"ok":false,"error":"标题去掉首尾空白后要在 1 到 80 个字之间（现在 0 个字）。"}` |
| `kind` 取值不对 | `-F kind=other` | `400 kind 必须是 protocol 或 bug 这两个之一（投稿类型不对）。` |
| 正文全空白 | `-F body='  '` | `400 正文去掉首尾空白后要在 1 到 5000 个字之间（现在 0 个字）。` |
| 非法扩展名 | `-F files=@evil.exe` | `415 附件的扩展名不在白名单里。只收这几种附件：png jpg jpeg gif webp pdf txt md log json csv。` |
| 超大文件 11MB | `-F files=@big.png`（11 000 000 字节） | `413 附件太大了：单个文件上限 10MB（…不会落盘）。` 且磁盘上**没有**任何 `big*.png` |
| 一次带 6 个附件 | 六个 `-F files=@shot.png` | `400 一次最多带 5 个附件，这次带了 6 个。` |
| 错误密码 | `--data '{"password":"definitely-not-the-password"}'` | `401 {"ok":false,"error":"密码不对"}` |
| 正确密码 | `--data "{\"password\":\"<真密码>\"}"` | `200 {"ok":true}` + `set-cookie: fb_session=<token>; HttpOnly; SameSite=Strict; Path=/feedback; Max-Age=43200` |
| 表单方式登录 | `--data-urlencode password=<真密码>` | `200 {"ok":true}`（契约说两种都收） |
| 带 Cookie `list` | `-b jar.txt` | `200`，`items` 最新在前，带 `read` / `readAt` / `fileCount` / `unread` / `total` |
| 带 Cookie `item` | `-b jar.txt .../item?id=<id>` | `200`，含 `body` 与 `files:[{name,size}]`，**没有 `ip`、没有绝对路径** |
| 带 Cookie `file` | `-b jar.txt .../file?id=<id>&name=note.log` | `200`，`content-type: text/plain; charset=utf-8`、`content-disposition: inline; filename="note.log"`、`cache-control: no-store`、字节数 29 = 原文件 29 |
| 不带 Cookie | `list` / `item` / `file` 三个 | 都是 `401 {"ok":false,"error":"未登录"}` |
| **路径穿越** | `name=../../etc/passwd`、`..%2F..%2Fetc%2Fpasswd`、`/etc/passwd`、`meta.json`、`x/../../meta.json`、`....//....//etc/passwd` | 六个全是 `404 {"ok":false,"error":"这个附件不在该投稿里。"}`；`file?id=../../etc/passwd` 也是 404；`delete` 的 `id=../../etc/passwd` 是 `400 id 里不能有路径分隔符或 ..`。**事前/事后 `/etc/passwd` 的 sha256 都是 `48c944fa…e42e`，所有报文里都没有 `root:x:`** ⇒ 没有任何仓库外文件被读到 |
| 第 6 份 429（新口径） | 连投 6 次、每次 1 个附件 | 前 5 次 `200`，第 6 次 `429 {"ok":false,"error":"今天从你这个网络地址已经提交过 5 份反馈了（每天最多 5 份），请明天再来。"}`；额度文件 `rate/submits-2026-10-01.json` 记到 `5`；再打一次还是 429、计数仍是 `5`（没被顶过） |
| ① 一次 5 个附件只占 1 份 | `-F files=@shot.png` × 5 | `200`；额度 `2 份 -> 3 份`（**只 +1**，不是 +5）；5 个附件都落盘 |
| ② 连投 5 份后第 6 份 429 | 连投到 5 份再打一次 | 第 4、5 份 `200`；第 6 份 `429 {"ok":false,"error":"今天从你这个网络地址已经提交过 5 份反馈了（每天最多 5 份），请明天再来。"}` |
| ③ 超 5 个附件仍然 400 且不占额度 | `-F files=@shot.png` × 6 | `400 {"ok":false,"error":"一次最多带 5 个附件，这次带了 6 个。"}`；额度 `5 -> 5 份`（**没变**） |
| 旧口径文件不被误读 | 往 `rate/` 放一个写着该 IP = 999 的 `files-<今天>.json`，重启服务 | 额度 `5 份 -> 5 份`（**没变**，说明旧文件没被读成"份数"）；`healthz` 的 `legacyRateFiles` 报 `1`（被看见、没被读）；`rate/` 下两代文件并存 |
| 标已读 | `POST /read {"id":..,"read":true}` | `200 {"ok":true,"id":..,"read":true}`；`list` 里 `unread` 由 2 变 1、该条 `read=true` / `readAt="2026-10-01T04:24:42.700Z"`；`meta.json` 磁盘上同样是 `read=true readAt=…` |
| 标回未读 | `{"id":..,"read":false}` | `200`；`unread` 回到 2，该条 `read=false` / `readAt=null` |
| 标已读：id 不存在 | `{"id":"zzzz-9","read":true}` | `404 {"ok":false,"error":"找不到这条反馈"}` |
| 标已读：无 Cookie | 不带 `-b` | `401 {"ok":false,"error":"未登录"}` |
| 标已读：`read` 不是布尔 | `{"read":"yes"}` | `400 {"ok":false,"error":"read 必须是 true 或 false。"}` |
| 软删除 | `POST /delete {"id":..}` | `200 {"ok":true,"id":..}`；`trash/` 多出 `mup15qiw-…-2026-10-01T042443011Z/`，里面有 `meta.json`（403 字节）与 `note.log`（29 字节）——**不是 rm，原件都在** |
| 删除后 | `list` / `item` / `file` | `list` 里不再出现该条（`total` 由 2 变 1）；`item` 404「没有这份投稿。」；`file` 404 |
| 重复删除 | 再删一次同一个 id | `404 {"ok":false,"error":"找不到这条反馈"}` |
| 删除：无 Cookie | 不带 `-b` | `401 {"ok":false,"error":"未登录"}` |
| 日志不含敏感内容 | `grep` 正文 / 密码 / `fb_session=` | 命中数分别是 0 / 0 / 0 |
| meta 与磁盘一致性 | 逐份核对 `meta.files[].storedAs` 是否真在磁盘上、大小是否相符 | 4 份投稿、8 个附件、**对不上的 0 处**（改口径那一轮实测） |

`/etc/passwd` 没有被读到的自证方式（可重复）：

```bash
sha256sum /etc/passwd                       # 事前
curl -sS -b jar.txt --get --data-urlencode 'id=<id>' --data-urlencode 'name=../../etc/passwd' \
  http://127.0.0.1:8790/feedback/file       # 404
sha256sum /etc/passwd                       # 事后，应与事前逐字相同
```

---

## 10. 本机已验证 / 未验证

**已验证（2026-10-02，本地 `npx vitest run tests/feedback/server.test.ts`，54 条全绿）**：

- 文件名净化：两种路径分隔符、`..`、控制字符、隐藏文件前缀、超长截断、重名加序号、扩展名大小写；
- multipart 解析：多段、空 `filename` 段、二进制里的 CRLF 与"像 boundary 的字节"；
- 字段口径：`kind` 取值、`title` 1..80、`author` 1..40、`body` 1..5000、缺字段；
- 额度与闸门：按 IP 每天 5 **份提交**（2026-10-01 改口径，**重启后从磁盘恢复**）、跨天重算、
  一次带 5 个附件只占 1 份、混合 5 份后第 6 次 429、超 5 个附件仍然 400 且不占额度、
  旧口径 `files-*.json` 不被读成"份数"（且**今天已有 submits 文件时也会**记一条
  `legacy-rate-file-ignored`）、登录失败 5 次 / 10 分钟；
- **冷缓存读盘**（2026-10-02 补）：盘上有某天的计数、实例的缓存里没有那个日期键 ⇒
  也必须读回来（这条用变异验证过：把 `readDayFromDisk` 换回 `{}` 立即变红）；
- **并发**：12 份同时进来（0/1/5 个附件混合）只有 5 份成功、计数正好 5、
  计数文件仍是完整 JSON 且无 `.tmp` 残留（这条钉住"查-记在同一个同步段里"）；
- 会话：token 形状、过期、数量上限、`Set-Cookie` 逐字（且**不带 `Secure`** —— 线上是 http，
  带了浏览器不存 cookie，后台直接登不进去）、cookie 头解析；
- **路径穿越**：`resolveAttachment` 只在清单命中时才拼路径，穿越串一律 `null`；
- 追加需求：`read` 默认 false、老 meta 缺字段按未读算、`setRead` 两个方向、`list` 的 `unread`/`total`、
  软删除后 `items` 消失而 `trash` 有原件、`read`/`delete` 的 400/401/404。

**已验证（2026-10-01，服务器实测）**：§0 的部署四件（systemd / nginx / 权限 / 数据目录）与 §9 的整张表。

**未验证 / 已知边界**：

- 并发压力（几十人同时投稿）**没测**。当前实现是"整个请求体先进内存再解析"，
  单份投稿最坏 ~51MB 内存峰值；单人项目的反馈箱够用，真上量要改成流式写盘。
- 浏览器真机（真前端 `src/ui/feedback-screen.ts` 那一侧）**没测** —— 那是另一个 agent 那一半；
  本文件只保证服务端按契约回。
- 站点是 http，Cookie **没有 `Secure`**。等上了 https 要在 `lib/auth.mjs` 的 `sessionCookie` 里加上，
  并同步改本 RUNBOOK。
- 会话表在内存里，重启即失效（契约允许）。没做持久化。

---

## 11. 安全提示（2026-10-01）

**本服务的口令不是秘密。** 用户指定的那个口令与前端 src/ui/devmode.ts 的 devmode 硬编码口令
是**同一个串**，而 devmode.ts 被打进公开 bundle（任何人下载前端 JS 就能搜到；docs/handoff-2026-08-31.md
里也写过）。也就是说：读到 bundle 的人可以调用本服务的接口，**列出 / 读取 / 删除全部反馈**（含署名与附件）。

- 这是 2026-10-01 反馈功能上线时就存在的情况，**用户当天知情并明确选择"就用现在这个口令，不改"**。
- 本文档不写出口令本身；它只在 /etc/feedback.env（root:root 0600）里。
- 如果哪天要收紧：换一个**只写进 /etc/feedback.env** 的独立口令（不要在仓库/前端任何地方出现），
  systemctl restart feedback 即可；或者把 devmode 那个硬编码口令从公开 bundle 里拿掉（那是另一件事）。
- 服务端侧与口令无关的防线都已生效：只监听 127.0.0.1、外网必须过 nginx、所有管理接口都要会话、
  附件名做路径穿越防护、每 IP 每天 5 份额度、日志不写正文/口令/cookie。
