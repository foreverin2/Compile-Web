#!/usr/bin/env python3
"""独立算出的参考向量（T50 判据 1）。

为什么是 Python：Node 侧的实现用的就是 `crypto.createHmac('sha1', …)`，
**用同一个库算一遍再拿它验自己等于没验**。CPython 的 `hmac` + `hashlib` 是**另一份独立实现**
（它的 HMAC 按 RFC 2104 自己拼 ipad/opad 再调 OpenSSL，与 Node 的调用路径无关）。
本脚本产出的 `vectors.json` 由 `tests/cred.test.mjs` 读入比对 —— 那是"两条独立读数"。

跑法（本目录）：
    python tools/listen.mjs  # 不对，那是 Node 的；本文件是 Python：
    python make-reference-vectors.py > reference-vectors.json

向量来源分两类：
  1. **RFC 2202 / RFC 2104 附录**里公开的 HMAC-SHA1 测试向量（第三方、可外部复核）；
  2. 本服务实际会签的 `expiry:scope` 形状（用同一份"和服务器约定一致的密钥"，但由 Python 算）。
"""
import base64
import hashlib
import hmac
import json
import sys

# ── 1. RFC 2202 的 HMAC-SHA1 测试向量（第三方原文，键与消息都是十六进制）──────────
RFC2202 = [
    (1, "0b" * 20, "4869205468657265"),
    (2, "4a656665", "7768617420646f2079612077616e7420666f72206e6f7468696e673f"),
    (3, "aa" * 20, "dd" * 50),
    (4, "0102030405060708090a0b0c0d0e0f10111213141516171819", "cd" * 50),
    (6, "aa" * 80, "54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374"),
    (7, "aa" * 80, "5468697320697320612074657374207573696e672061206c6172676572207468616e20626c6f636b2d73697a65206b657920616e642061206c6172676572207468616e20626c6f636b2d73697a6520646174612e20546865206b6579206e6565647320746f20626520686173686564206265666f7265206265696e6720757365642062792074686520484d414320616c676f726974686d2e"),
]


def b64(text: str) -> str:
    return base64.b64encode(text).decode("ascii")


def main() -> int:
    out = {
        "generatedBy": "server/turn-cred/make-reference-vectors.py",
        "python": sys.version.split()[0],
        "rfc2202": [],
        "service": [],
    }
    for idx, key_hex, msg_hex in RFC2202:
        key = bytes.fromhex(key_hex)
        msg = bytes.fromhex(msg_hex)
        digest = hmac.new(key, msg, hashlib.sha1).digest()
        out["rfc2202"].append({
            "case": idx,
            "keyHex": key_hex,
            "msgHex": msg_hex,
            "macHex": digest.hex(),
            "macBase64": base64.b64encode(digest).decode("ascii"),
        })

    # ── 2. 服务实际会签的形状：username = "<expiry>:<scope>"，credential = b64(HMAC-SHA1(secret, username))
    secret = "ref-secret-not-a-real-key"
    for expiry, scope in [(1700000000, "player"), (1700000060, "player"), (1700000000, "host"), (2000000000, "player")]:
        username = f"{expiry}:{scope}"
        digest = hmac.new(secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()
        out["service"].append({
            "secret": secret,
            "expiry": expiry,
            "scope": scope,
            "username": username,
            "credential": base64.b64encode(digest).decode("ascii"),
            "credentialHex": digest.hex(),
        })

    # 自证：这一组向量不是恒真 —— 换一个字节的密钥/消息，摘要必须变
    a = hmac.new(secret.encode("utf-8"), b"1700000000:player", hashlib.sha1).digest()
    b = hmac.new(secret.encode("utf-8"), b"1700000000:playeR", hashlib.sha1).digest()
    c = hmac.new(("x" + secret).encode("utf-8"), b"1700000000:player", hashlib.sha1).digest()
    out["sensitivity"] = {
        "lastByteOfMessage": a.hex() != b.hex(),
        "oneByteOfKey": a.hex() != c.hex(),
    }
    if not (out["sensitivity"]["lastByteOfMessage"] and out["sensitivity"]["oneByteOfKey"]):
        print("自证失败：向量对输入不敏感", file=sys.stderr)
        return 1

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
