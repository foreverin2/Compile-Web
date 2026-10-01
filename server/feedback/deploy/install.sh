# 反馈收集后端：安装脚本。用法见 server/feedback/RUNBOOK.md §2 / §4。
#
#   bash deploy/install.sh <已解包的源码目录> <已写好的 env 文件>
#   FEEDBACK_PASSWORD=... bash deploy/install.sh <已解包的源码目录>
#   bash deploy/install.sh <已解包的源码目录>          # 已有 /etc/feedback.env 时原地升级
#
# 幂等；不会碰到 nginx（那一步在 RUNBOOK §3 手工做，改前先备份）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$(cd "$HERE/.." && pwd)}"
ENV_SRC="${2:-}"

SERVICE_USER=feedback
OPT_DIR=/opt/feedback
DATA_DIR=/var/lib/compile-feedback
LOG_FILE=/var/log/feedback.log
UNIT=/etc/systemd/system/feedback.service
ENV_FILE=/etc/feedback.env

echo "== 0. 检查源码 =="
test -f "$SRC/server.mjs" || { echo "找不到 $SRC/server.mjs"; exit 1; }
test -d "$SRC/lib" || { echo "找不到 $SRC/lib"; exit 1; }

echo "== 1. 专用系统用户 $SERVICE_USER =="
if id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "已存在：$(id "$SERVICE_USER")"
else
  useradd --system --home-dir "/home/$SERVICE_USER" --create-home \
          --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "已创建：$(id "$SERVICE_USER")"
fi

echo "== 2. 源码 -> $OPT_DIR =="
install -d -m 0755 "$OPT_DIR"
rm -rf "$OPT_DIR/lib"
cp -a "$SRC/server.mjs" "$OPT_DIR/server.mjs"
cp -a "$SRC/lib" "$OPT_DIR/lib"
if [ -d "$SRC/deploy" ]; then
  rm -rf "$OPT_DIR/deploy"
  cp -a "$SRC/deploy" "$OPT_DIR/deploy"
fi
find "$OPT_DIR" -type f -exec chmod 0644 {} +
find "$OPT_DIR" -type d -exec chmod 0755 {} +
echo "装了这些文件："
find "$OPT_DIR" -type f | sort

echo "== 3. 数据目录 $DATA_DIR（只有 $SERVICE_USER 能写）=="
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR/items"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR/rate"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR/tmp"
# 软删除的去处：delete 接口把 items/<id>/ 整体移到这里，不 rm（误删可人工捞回）
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR/trash"
ls -ld "$DATA_DIR" "$DATA_DIR"/*

echo "== 4. 日志文件 $LOG_FILE =="
install -o "$SERVICE_USER" -g adm -m 0640 /dev/null "$LOG_FILE"
ls -l "$LOG_FILE"

echo "== 5. 配置 $ENV_FILE（0600，只有 root 读得到）=="
if [ -n "$ENV_SRC" ]; then
  test -f "$ENV_SRC" || { echo "找不到 env 源文件：$ENV_SRC"; exit 2; }
  install -o root -g root -m 0600 "$ENV_SRC" "$ENV_FILE"
  echo "已把 $ENV_SRC 装成 $ENV_FILE（脚本不读也不回显里面的密码）"
  # 暂存的那份（多半在 /tmp 下）用完就删，别把密码留在临时目录里
  case "$ENV_SRC" in
    /tmp/*) rm -f "$ENV_SRC"; echo "已删掉暂存文件 $ENV_SRC" ;;
  esac
elif [ -n "${FEEDBACK_PASSWORD:-}" ]; then
  umask 077
  {
    printf '# Compile 反馈后端配置（2026-10-01）。权限必须是 600：这一行里有后台密码。\n'
    printf 'FEEDBACK_PASSWORD=%s\n' "$FEEDBACK_PASSWORD"
    printf 'FEEDBACK_HOST=127.0.0.1\n'
    printf 'FEEDBACK_PORT=8790\n'
    printf 'FEEDBACK_DATA_DIR=%s\n' "$DATA_DIR"
    printf 'FEEDBACK_LOG_FILE=%s\n' "$LOG_FILE"
    printf 'FEEDBACK_LOG_MAX_BYTES=5242880\n'
    printf '# 走 nginx 反代，IP 取 X-Forwarded-For 的最后一跳（限流键）\n'
    printf 'FEEDBACK_TRUST_PROXY=1\n'
    printf '# 单个附件上限 10MB，一次最多 5 个附件；每 IP 每天最多 5 份提交（契约值，别乱改）\n'
    printf 'FEEDBACK_MAX_FILE_BYTES=10485760\n'
    printf 'FEEDBACK_MAX_FILES=5\n'
    printf 'FEEDBACK_FILES_PER_IP_PER_DAY=5\n'
    printf '# 会话 12 小时（与 Cookie 的 Max-Age=43200 对齐）\n'
    printf 'FEEDBACK_SESSION_TTL=43200\n'
    printf '# 登录失败闸：同一 IP 10 分钟内失败 5 次就 429\n'
    printf 'FEEDBACK_LOGIN_FAIL_MAX=5\n'
    printf 'FEEDBACK_LOGIN_FAIL_WINDOW=600\n'
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo "已写入（密码取自 FEEDBACK_PASSWORD，本脚本不回显密码）"
else
  if [ -f "$ENV_FILE" ]; then
    echo "没给 env 源文件也没给 FEEDBACK_PASSWORD，保留现有的 $ENV_FILE 不动"
    chmod 600 "$ENV_FILE"
  else
    echo "**没有 $ENV_FILE、也没给 env 源文件 / FEEDBACK_PASSWORD**："
    echo "请先准备配置再跑本脚本，例如："
    echo "  sudo bash $0 $SRC /tmp/feedback.env.new"
    exit 2
  fi
fi
ls -l "$ENV_FILE"

echo "== 6. systemd 单元 $UNIT =="
cat > "$UNIT" <<'UNITEOF'
[Unit]
Description=Compile feedback collector (zero-dep Node, 127.0.0.1:8790)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=feedback
Group=feedback
EnvironmentFile=/etc/feedback.env
ExecStart=/usr/local/bin/node /opt/feedback/server.mjs
Restart=always
RestartSec=2
# ---- 加固：照 turn-cred.service 那一套 ----
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
# 只放行这两处可写：数据目录与日志目录
ReadWritePaths=/var/lib/compile-feedback /var/log

[Install]
WantedBy=multi-user.target
UNITEOF
chmod 0644 "$UNIT"

echo "== 7. 先自检配置（缺密码会 exit 2，这是故意的）=="
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
runuser -u "$SERVICE_USER" -- /usr/local/bin/node /opt/feedback/server.mjs --check

echo "== 8. 起服务 =="
systemctl daemon-reload
systemctl enable feedback >/dev/null
# 升级场景：源码换了要真重启，`enable --now` 对一个已经在跑的服务是空操作
systemctl restart feedback
sleep 1
systemctl --no-pager --full status feedback | head -20 || true
echo "---- 本地健康检查 ----"
curl -sS -m 5 http://127.0.0.1:8790/feedback/healthz; echo
