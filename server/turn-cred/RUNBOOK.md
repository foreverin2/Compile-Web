# RUNBOOK：TURN 凭据签发服务（方案 B1）

对象：`server/turn-cred/`（零依赖 Node 服务）+ 客户端（`src/ui/turn-cred.ts` / `net-browser.ts`）+
coturn 侧配置（**由协调侧在那台 ECS 上执行，本文件只写步骤与校验命令**）。

本机读数（2026-09-28，`E:\...\compile`）见文末"本机已验证 / 未验证"两节；
线上那台 `8.130.97.243` 与 nginx 这一轮**一个字节都没动**。

---

## 0. 上线三步（**必须同一批完成，否则中继会断**）

**当前代码的状态（本机做通 B1 这一轮）**：`src/main.ts` 的缺省端点是**空串**（"没配"），
`src/ui/net-browser.ts` 里留着 `PRE_LAUNCH_FALLBACK_CREDENTIAL`（那对**临时**静态凭据）——
**故意**这样：发版必须保持今天线上的行为，而线上 coturn 还是 `lt-cred-mech`、`/turn-cred` 也还不存在。

1. **起签发服务**（§1 + §2）：systemd + nginx 同源反代 `/turn-cred` ⇒
   `curl -sS https://<站点>/turn-cred` 能拿到 JSON。**这一步不影响线上**（没人请求它）。
2. **改缺省端点 + 删静态兜底 + 部署新前端**：把 `src/main.ts` 的 `let turnCredEndpoint = ''`
   改成 `'/turn-cred'`，**同时**删掉 `src/ui/net-browser.ts` 的 `PRE_LAUNCH_FALLBACK_CREDENTIAL`
   与 `usesPreLaunchFallback` 那条支路（删完 `readIceServers` 在"没配端点"时就只剩降级那一档），
   再 `npm run build`、把新产物发上去。
   ⚠️ **这一刻旧 coturn 还没切**：新前端换来的 REST 凭据在旧 coturn 上**验不过**
   ⇒ 这两步之间中继不可用（同网直连不受影响，客户端自动降级并在屏上写"这一轮没有中继可用"）。
   ⇒ 第 2、3 步要连着做，中间别过夜。
3. **切 coturn（并行第二实例，§5）**：起 `3479` 的 REST 实例 ⇒ 把 `TURN_URLS` 指过去
   （`systemctl restart turn-cred`）⇒ 确认新前端拿到 `:3479` 的凭据。这一刻中继回到可用；
   旧 `3478` 留到确认没人用旧前端再下线。

回滚按逆序：③ 先切回旧 coturn 配置（§8②）⇒ ② 前端切回旧产物（§8①）⇒ ① 签发服务留着无害。

---

## 0.1 切换前后的两条硬事实（先读这两条，再动手）

1. **coturn 的 `user=…` 与 TURN REST 不能共存**（`turnserver --help` 原文：
   `Cannot be used with TURN REST API.`）⇒ 配置改成 `use-auth-secret` 的**同一刻**，
   所有还带着旧静态密码的客户端（就是线上那份 JS）**立刻失去中继**，直到新版前端上线。
   ⇒ **选没人玩的时候切，并与前端部署同时进行**。
2. **切换之后旧前端只能直连**（同网可用、跨网要看运气）。这不是故障，是 B1 的既定代价；
   零停机的正解是下面 §5 的"并行第二个 coturn 实例"。

---

## 1. 装在哪、怎么起（systemd）

签发服务与 coturn 同机（同一台 ECS），**只监听 `127.0.0.1`**，由 nginx 同源反代出去。

```bash
sudo install -d -m 0755 /opt/turn-cred
sudo cp -r server/turn-cred /opt/turn-cred/          # lib/ + server.mjs（reference-vectors.json 与 tests/ 可不带）
sudo install -d -m 0700 /etc/turn-cred
# 密钥：32 字节随机（十六进制），只让 root 读
sudo sh -c 'head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" > /etc/turn-cred/secret'
sudo chmod 600 /etc/turn-cred/secret
sudo sh -c 'printf "TURN_CRED_SECRET_FILE=/etc/turn-cred/secret\n" > /etc/turn-cred/env'
sudo sh -c 'printf "TURN_CRED_DENY_FILE=/etc/turn-cred/deny.txt\nTURN_CRED_LOG_FILE=/var/log/turn-cred.log\nTURN_CRED_TRUST_PROXY=1\n" >> /etc/turn-cred/env'
sudo install -m 0644 /dev/null /etc/turn-cred/deny.txt
```

`/etc/systemd/system/turn-cred.service`：

```ini
[Unit]
Description=Compile TURN credential issuer (B1)
After=network-online.target

[Service]
Type=simple
User=nobody
EnvironmentFile=/etc/turn-cred/env
ExecStart=/usr/bin/node /opt/turn-cred/turn-cred/server.mjs
Restart=always
RestartSec=2
# 只监听本机（TURN_CRED_HOST 缺省就是 127.0.0.1）
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log

[Install]
WantedBy=multi-user.target
```

启之前先自检（**缺密钥会 `exit 2`，服务不会起来** —— 这是故意的，别把它当故障）：

```bash
sudo -u nobody env $(cat /etc/turn-cred/env | xargs) node /opt/turn-cred/turn-cred/server.mjs --check
# 期望输出里含：realm=compile-turn urls=turn:8.130.97.243:3478 ttl=600(max 900) 限流=10/分钟、并发 3
sudo systemctl daemon-reload && sudo systemctl enable --now turn-cred
curl -sS http://127.0.0.1:8788/healthz
```

## 2. nginx：**同源**反代（免 CORS）

前端默认就打同源的 `/turn-cred`（`DEFAULT_TURN_CRED_SETTINGS.endpoint`），所以**不用配 CORS**，
也不会有 http 混内容问题。在站点 server 块里加：

```nginx
location = /turn-cred {
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    # ★ 必须：服务端按**最后一跳**取客户端 IP 做限流（TURN_CRED_TRUST_PROXY=1 时才信）
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 5s;
}
location = /healthz-turn-cred {          # 监控用；别把 /healthz 这个名字占掉
    proxy_pass http://127.0.0.1:8788/healthz;
    allow 127.0.0.1; deny all;
}
# 这个接口带凭据：只允许 HTTPS（前置条件：域名备案 + 证书就绪）
```

校验：`sudo nginx -t && sudo systemctl reload nginx && curl -sS https://<站点>/turn-cred | head -c 200`

## 3. coturn 侧（**协调侧执行**）

### 3.1 现有三根保险丝要保留（`docs/2026-09-28-账号体系与中继凭据-待开发方案.md` §3）

`total-quota` / `max-bps` / `bps-capacity` / `max-allocate-lifetime` **一个字都别删**，
它们与 REST 鉴权正交（一个管配额、一个管身份）。改之前先备份：

```bash
sudo cp -a /etc/turnserver.conf /etc/turnserver.conf.bak-$(date +%Y%m%d-%H%M)
# 协调侧已有 .bak-20260928；再备份一份，回滚靠它
```

### 3.2 改成 TURN REST（**一次性**，与前端部署同时进行）

```diff
-user=compile:PsN4kLbZ3sesnKzmSt7R9Ct6
+use-auth-secret
+static-auth-secret=<与 /etc/turn-cred/secret 逐字相同的那个串>
```

`realm=compile-turn` **保持不动**（签发服务缺省也是 `compile-turn`；`realm` 只影响鉴权域，
不影响已经建立的分配）。改完：

```bash
sudo turnserver --help | grep -A2 'use-auth-secret'   # 先确认这个版本认得这两项
sudo systemctl restart coturn
sudo journalctl -u coturn -n 50 --no-pager | grep -i 'auth\|realm\|error'
```

校验（**用签发服务真签一份，别手抄**）：

```bash
CRED=$(curl -sS https://<站点>/turn-cred)
echo "$CRED"
# 拿 username/credential 用 turnutils_uclient 或本机浏览器探针打一次，看有没有 relay 候选：
#   turnutils_uclient -u "$(echo $CRED | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')" \
#     -w "$(echo $CRED | sed -n 's/.*"credential":"\([^"]*\)".*/\1/p')" -y 8.130.97.243
```

## 4. 密钥怎么生成与轮换

- 生成：`head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'`（64 个十六进制字符，无引号无空格）。
- **轮换（不停机）**：`static-auth-secret` 只有**一个**，改它就必须同时改 `/etc/turn-cred/secret`
  并重启两个进程 ⇒ 轮换本身有秒级窗口（新凭据签得出来、coturn 还认旧密钥 ⇒ 那一瞬间分配会 401）。
  做法：`systemctl stop turn-cred`（前端立刻降级直连，**不会白屏、不会挂**）→ 改两处密钥 →
  `systemctl restart coturn` → `systemctl start turn-cred`。
  ⇒ 这就是"**换密钥不用重新部署前端**"的落地形态（前端一个字节都没改）。
- 泄漏处置：同上，整条吊销；`deny.txt` 只是补刀，不替代换密钥。

## 5. 零停机切换：**并行起第二个 coturn 实例**（推荐做法）

思路：旧 `3478` 实例（`lt-cred-mech`）继续服务**旧前端**，新 `3479` 实例（REST）服务**新前端**；
两个实例的**中继端口段不许重叠**。确认没有旧前端在用了，再下线旧的。

### 5.1 新实例（`/etc/turnserver-rest.conf`）

```ini
listening-port=3479
# 旧实例是 49152-49200 ⇒ 新实例用 49201-49249（**不许重叠**）
min-port=49201
max-port=49249
use-auth-secret
static-auth-secret=<与 /etc/turn-cred/secret 逐字相同>
realm=compile-turn
# 现有三根保险丝照抄（配额不因换鉴权方式而失效）
total-quota=48
max-bps=65536
bps-capacity=1250000
max-allocate-lifetime=600
# 日志分开，便于按实例看
log-file=/var/log/turnserver-rest.log
simple-log
```

**起之前先确认端口段没被占**（`ss -lunp | grep -E '3479|4920[1-9]|492[1-4][0-9]'` 应为空）。
**版本差异提示**：`min-port` / `max-port` 在部分打包版本里拼写是 `min-port`/`max-port`，
另一些只认 `--min-port`/`--max-port`（命令行等价形式）。落地前先 `turnserver --help | grep -i 'min-port'`
对一次；两项都认不出时用命令行参数起，别猜。

`/etc/systemd/system/coturn-rest.service`（照抄发行版那份 unit，把
`ExecStart` 指向 `/etc/turnserver-rest.conf`、`Description` 改名，两个实例才能同时活着）：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coturn-rest
sudo ss -lunp | grep 3479
sudo journalctl -u coturn-rest -n 30 --no-pager
```

### 5.2 切前端指向 `3479`

```bash
TURN_URLS=turn:8.130.97.243:3479 node /opt/turn-cred/turn-cred/server.mjs --check
sudo sed -i 's|^TURN_URLS=.*|TURN_URLS=turn:8.130.97.243:3479|' /etc/turn-cred/env
sudo systemctl restart turn-cred
curl -sS https://<站点>/turn-cred | head -c 200     # urls 里应当是 :3479
```

旧客户端此刻**仍然**走 `3478`（旧实例没动）⇒ **这一刻谁都不会掉线**（这就是"零停机"的全部内容）。
**但**：客户端是拿服务端给的 URL 的，切完之后**新**会话走 `3479`、老会话仍留在 `3478`，两段并存。

### 5.3 下线旧实例（确认没人用之后）

```bash
sudo journalctl -u coturn --since '-2h' | grep -c 'allocation'   # 观察一段时间，确认没有新分配
sudo systemctl disable --now coturn
# 旧前端产物也留着（/var/www 目录快照），回滚要用
```

## 6. 限流参数怎么调（`/etc/turn-cred/env`）

| 变量 | 缺省 | 含义 | 调的时候注意 |
|---|---|---|---|
| `TURN_CRED_PER_IP_PER_MINUTE` | 10 | 每个 IP 每分钟最多签发几次 | 一家 Wi-Fi 两台设备开局各取一次 ⇒ 10 很宽；被刷就降到 5 |
| `TURN_CRED_PER_IP_CONCURRENT` | 3 | 每个 IP 同时有效的凭据份数 | 一份凭据够多开；重连会换新凭据 ⇒ 别低于 3 |
| `TURN_CRED_TTL` | 600 | 凭据默认有效期（秒） | 与 coturn 的 `max-allocate-lifetime=600` 对齐；客户端不传 `?ttl=` 时就用它 |
| `TURN_CRED_TTL_MAX` | 900 | 客户端能要到的**上限** | 要多了夹到它（日志 `ttl-capped`） |
| `TURN_CRED_TTL_MIN` | 60 | **下限**（T50 评审 P0 之后才真正生效） | 要少了夹到它（日志 `ttl-clamped`）：几秒的凭据对玩家没用，还照样占并发额度 |
| `TURN_CRED_TRUST_PROXY` | 关 | 信 `X-Forwarded-For` 的最后一跳 | **走 nginx 时必须开**，否则所有人共用一个 IP 限额 |
| `TURN_CRED_LOG_MAX_BYTES` | 5242880 | 日志轮转阈值 | 超了就写成 `<log>.1` |

改完 `sudo systemctl restart turn-cred`；`curl /healthz` 会回**当前生效**的限额（照它核，别照文档）。

## 7. 怎么看日志与封禁

```bash
sudo tail -f /var/log/turn-cred.log
# 字段：ts / level / ip / method / result / scope / ttl / expiry / credFp
# result 取值：listening | healthz | issued | denied | rate-limited:rate | rate-limited:concurrent |
#              ttl-capped | ttl-clamped | bad-scope | bad-ttl | not-found | method-not-allowed
# ★ credFp 是凭据 sha1 的前 8 位（比对用），日志里**没有**凭据原文
sudo grep -c 'result=issued' /var/log/turn-cred.log
sudo grep 'result=rate-limited' /var/log/turn-cred.log | tail -20    # 谁在刷
```

封一个 IP（**热加载，不用重启**，最多 5 秒生效；写坏了不会让服务挂，只是保留旧清单并在 stderr 记一条）：

```bash
echo '203.0.113.7' | sudo tee -a /etc/turn-cred/deny.txt
curl -sS -o /dev/null -w '%{http_code}\n' https://<站点>/turn-cred   # 从那个 IP 打，期望 403
```

## 8. 回滚（两条，都要会）

**① 前端切回旧产物**（旧产物里是静态密码 ⇒ 需要旧 coturn 实例还在）：

```bash
sudo cp -a /var/www/<站点>.bak-20260928/. /var/www/<站点>/     # 用协调侧那份目录快照
sudo systemctl reload nginx
# 旧静态密码那对凭据在 public/probe.html 里还留着（冻结件），但**不要在正式前端里再内联**
```

**② coturn 切回 `lt-cred-mech`**（新前端此刻会降级直连，不报错）：

```bash
sudo cp -a /etc/turnserver.conf.bak-20260928 /etc/turnserver.conf
sudo systemctl restart coturn
sudo journalctl -u coturn -n 30 --no-pager     # 看 realm 与 user= 是否回来了
```

两条的顺序：**先切 coturn 回去**（旧密码立刻可用），**再切前端**（否则中间有一段两边都不通中继）。

## 9. 本机已验证 / 未验证（2026-09-28，交付这一轮）

**已验证（本机）**：
- 服务起得来、`/healthz` 与 `/turn-cred` 的形状与文档一致；密钥缺 ⇒ `--check` `exit 2`；
- HMAC 与 RFC 2202 的公开向量 + Python 独立算出的向量逐字相同；
- 限流（429 + 可读报文）、deny（403 + 热加载）、TTL **两头封**（封顶 900 / 下限 60）、日志不记凭据原文都有单测；
- 客户端侧：2 秒上界（计时器可控地"到点"）、到期前续期、失败不写缓存、四种失败各有名字；
- 端到端降级：停掉服务 ⇒ 邀请码照出、ICE 里没有 `turn:`、屏上有"这一轮没有中继可用，只能试直连"。

**未验证（要协调侧在那台机器上做）**：
- §1/§2 的 systemd 与 nginx 步骤**没有在真服务器上跑过**（本轮不许 ssh 改配置）；
- §3.2 的 coturn REST 配置、§5 的第二个实例与端口段**没有真起过**；
- `min-port`/`max-port` 在两边的拼写差异需要在服务器上用 `turnserver --help` 对一次；
- 真机中继连通（拿到凭据 ⇒ relay 候选 ⇒ 连上）只在本机以"只走 relay 的探针"验过，
  线上那台 `3478` 本轮**没有**拿来做实验（任务书判据 2 的明令）。
