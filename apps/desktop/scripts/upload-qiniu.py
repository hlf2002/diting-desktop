#!/usr/bin/env python3
"""七牛云 Kodo 上传：把发布产物传到固定 key（不带版本号），供官网/内部分发。

用法：
  python3 scripts/upload-qiniu.py <本地文件> <key> [--bucket res-7373]

凭据读取顺序（与 qiniu-kodo-manager 技能一致）：
  1. 环境变量 QINIU_AK / QINIU_SK
  2. ~/.config/qiniu/credentials（两行 ak=xxx / sk=xxx）

实现策略：
  - 装了 qiniu SDK（如 ~/.venvs/qiniu）时走官方分片续传（version=v2），大文件最稳；
  - 没有 SDK 时退化为标准库流式表单上传（不把整个文件读进内存），带重试与
    「incorrect region, please use up-z2.qiniup.com」自动换域名。
两条路径上传后都调 /stat 核对 md5 + fsize，与本地不一致即判失败。
"""

import argparse
import base64
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

CRED_PATH = os.path.expanduser("~/.config/qiniu/credentials")
UC_HOST = "https://uc.qiniu.com"
RS_HOST = "https://rs.qiniu.com"
DEFAULT_UPLOAD_HOST = "upload.qiniu.com"
DEFAULT_BUCKET = "res-7373"


def load_credentials():
    ak = os.environ.get("QINIU_AK", "").strip()
    sk = os.environ.get("QINIU_SK", "").strip()
    if ak and sk:
        return ak, sk
    try:
        with open(CRED_PATH, encoding="utf-8") as f:
            creds = {}
            for line in f:
                line = line.strip()
                if "=" in line:
                    k, v = line.split("=", 1)
                    creds[k.strip()] = v.strip()
        return creds.get("ak", ""), creds.get("sk", "")
    except OSError:
        return "", ""


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def qbox_token(ak, sk, path_query):
    digest = hmac.new(sk.encode(), (path_query + "\n").encode(), hashlib.sha1).digest()
    return f"{ak}:{base64.urlsafe_b64encode(digest).decode()}"


def upload_token(ak, sk, bucket, key, expires=7200):
    policy = json.dumps(
        {"scope": f"{bucket}:{key}", "deadline": int(time.time()) + expires},
        separators=(",", ":"),
    )
    b64 = base64.urlsafe_b64encode(policy.encode()).decode()
    digest = hmac.new(sk.encode(), b64.encode(), hashlib.sha1).digest()
    return f"{ak}:{base64.urlsafe_b64encode(digest).decode()}:{b64}"


def resolve_upload_host(ak: str, bucket: str) -> str:
    """查空间所在 region 的上传域名（res-7373 在华南 z2 → up-z2.qiniup.com）。"""
    try:
        url = f"{UC_HOST}/v4/query?ak={ak}&bucket={urllib.parse.quote(bucket)}"
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        for host_info in data.get("hosts", []):
            domains = (host_info.get("up") or {}).get("domains") or []
            if domains:
                return domains[0]
    except Exception as exc:  # 查不到就用全局域名，失败后按返回的提示改
        print(f"[qiniu] region query failed ({exc!r}), try {DEFAULT_UPLOAD_HOST}")
    return DEFAULT_UPLOAD_HOST


def upload_with_sdk(bucket, key, path):
    import qiniu  # type: ignore  # pyright: ignore[reportMissingImports]

    ak, sk = load_credentials()
    token = qiniu.Auth(ak, sk).upload_token(bucket, key, 7200)
    if hasattr(qiniu, "put_file_v2"):
        ret, info = qiniu.put_file_v2(token, key, path)
    else:  # 旧版 SDK 只有 put_file(version="v2")
        ret, info = qiniu.put_file(token, key, path, version="v2", part_size=4 * 1024 * 1024)
    return info.status_code, ret or {}, str(info)


def upload_form(host, bucket, key, path):
    """标准库流式表单上传（不把整个文件读进内存）。"""
    ak, sk = load_credentials()
    token = upload_token(ak, sk, bucket, key)
    boundary = "----diting" + uuid.uuid4().hex
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    head = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n{token}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n{key}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="{os.path.basename(path)}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    total = len(head) + os.path.getsize(path) + len(tail)

    conn = http.client.HTTPSConnection(host, timeout=3600)
    try:
        conn.putrequest("POST", "/")
        conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        conn.putheader("Content-Length", str(total))
        conn.endheaders()
        conn.send(head)
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 22), b""):
                conn.send(chunk)
        conn.send(tail)
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8", "replace")
        status = resp.status
    finally:
        conn.close()
    try:
        ret = json.loads(raw)
    except json.JSONDecodeError:
        ret = {"raw": raw}
    return status, ret, raw


def remote_stat(ak, sk, bucket, key):
    entry = base64.urlsafe_b64encode(f"{bucket}:{key}".encode()).decode()
    path = f"/stat/{entry}"
    req = urllib.request.Request(f"{RS_HOST}{path}", method="GET")
    req.add_header("Authorization", "QBox " + qbox_token(ak, sk, path))
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("key")
    ap.add_argument("--bucket", default=os.environ.get("QINIU_BUCKET", DEFAULT_BUCKET))
    ap.add_argument("--skip-verify", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(args.path):
        sys.exit(f"FATAL: 文件不存在 {args.path}")
    size = os.path.getsize(args.path)
    local_md5 = md5_of(args.path)
    ak, sk = load_credentials()
    if not ak or not sk:
        sys.exit("FATAL: 缺七牛 AK/SK（环境变量 QINIU_AK/QINIU_SK 或 ~/.config/qiniu/credentials）")

    try:
        import qiniu  # noqa: F401  # pyright: ignore[reportMissingImports]

        use_sdk = True
    except ImportError:
        use_sdk = False

    host = "" if use_sdk else resolve_upload_host(ak, args.bucket)
    print(f"[qiniu] {args.bucket}:{args.key} <- {args.path} ({size} bytes, md5 {local_md5})")
    mode = "sdk-resumable" if use_sdk else f"stdlib-form-stream@{host}"
    print(f"[qiniu] mode: {mode}")

    last_err = ""
    for attempt in range(1, 4):
        status, ret = 0, {}
        try:
            if use_sdk:
                status, ret, last_err = upload_with_sdk(args.bucket, args.key, args.path)
            else:
                status, ret, last_err = upload_form(host, args.bucket, args.key, args.path)
        except Exception as exc:  # 网络/签名等异常一律重试
            status, ret, last_err = 0, {}, repr(exc)
        if status == 200:
            break
        # 七牛返回「incorrect region, please use up-z2.qiniup.com」时立刻换域名重试
        for token in str(last_err).split():
            if token.startswith(("upload-", "up-")):
                host = token.strip("\\\",{}")
                print(f"[qiniu] region hint -> {host}")
        print(f"[qiniu] attempt {attempt} failed: status={status} info={last_err}")
        if attempt < 3:
            time.sleep(2 * attempt)
    else:
        sys.exit(f"FATAL: 七牛上传失败 {args.bucket}:{args.key}")

    print(f"[qiniu] uploaded key={args.key} fsize={ret.get('fsize')} hash={ret.get('hash')}")

    if args.skip_verify:
        return
    for wait in range(1, 6):
        try:
            info = remote_stat(ak, sk, args.bucket, args.key)
        except Exception as exc:
            print(f"[qiniu] stat retry {wait}: {exc!r}")
            time.sleep(2)
            continue
        if info.get("fsize") == size and info.get("md5") == local_md5:
            print(f"[qiniu] verified size={size} md5={local_md5}")
            return
        print(f"[qiniu] stat mismatch (try {wait}): {info.get('fsize')} / {info.get('md5')}")
        time.sleep(2)
    sys.exit(f"FATAL: 七牛对象校验不一致（期望 size={size} md5={local_md5}）")


if __name__ == "__main__":
    main()
