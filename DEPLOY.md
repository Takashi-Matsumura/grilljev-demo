# 社内デプロイ手順（Docker / Colima）

会議の音声から業務フロー図を立ち上げるデモを、Mac Studio 上の Colima でコンテナとして
社内に公開する手順。

## ⚠ 先に読む: マイクは HTTPS でしか動かない

このアプリの中心機能は**ブラウザのマイク録音**（`navigator.mediaDevices.getUserMedia`）です。
ブラウザはこの API を **secure context（HTTPS、または localhost）でしか許可しません**。

- `http://<ホストのIP>:8050` を他の端末で開くと、**録音ボタンが機能しません**
- 文字起こし・図の生成・開発用サンプルの再生は HTTP でも動きます

そのため既定では **127.0.0.1 にだけ公開**し、LAN へは Caddy の HTTPS 経由で出します
（後述「HTTPS で社内公開する」）。

## アーキテクチャ

```
        社内の端末（Chrome）
              │ HTTPS  https://grilljev.es.example.co.jp
              ▼
   ┌─────────────────────────────┐
   │ Mac Studio (M3 Ultra)       │
   │                             │
   │  box3-prod-caddy :443       │  tls internal（BoX3 Internal CA）
   │        │ host.docker.internal:8050
   │        ▼                    │
   │  grilljev-demo (container)  │  Next.js standalone :3000
   │        │                    │
   │        │ host.docker.internal
   │        ├──► :8178 whisper-server      （launchd 常駐）
   │        ├──► :8080 llama-server/gemma  （launchd 常駐）
   │        └──► :8091 mlx-vlm/DiffusionGemma（launchd 常駐）
   └─────────────────────────────┘
```

- **モデルはコンテナに載せない。** Metal GPU を使うため、3 つともホスト側の launchd 常駐プロセス。
  コンテナからは `host.docker.internal` で呼ぶ。
- 3 つとも `127.0.0.1` にだけ bind しているが、Colima の `host.docker.internal`
  （= 192.168.5.2）経由でコンテナから到達できる。**0.0.0.0 に開き直す必要はない**
  （検証済み。LAN へ不用意に晒さないこと）。
- 判定器は既定でローカルの DiffusionGemma。**外部への送信は無い**。

## 前提

- Colima が起動していること（`colima status`）
- ホスト側の 3 サービスが動いていること

```bash
launchctl list | grep -E "whisper|diffusiongemma|llama-server"
curl -s http://127.0.0.1:8178/ >/dev/null && echo "whisper ok"
curl -s http://127.0.0.1:8080/health && echo
curl -s http://127.0.0.1:8091/health && echo
```

- このマシンの compose は**スタンドアロン版**。`docker compose`（プラグイン）は未導入なので
  `docker-compose`（ハイフンあり）を使う。

## 手順

```bash
cd ~/projects/grilljev-demo

# 1. ランタイム起動（未起動なら）
colima start

# 2. compose 用の環境変数を用意（必要なら値を編集）
#    ※ アプリのローカル開発用 .env.local とは別物。compose が読むのは .env。
cp .env.docker.example .env

# 3. ビルド & 起動
docker-compose up -d --build

# 4. ログ確認
docker-compose logs -f app
```

## 動作確認

```bash
# コンテナの稼働状態（healthcheck が healthy になるか）
docker-compose ps

# アプリの応答
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8050/

# コンテナ → ホスト側 3 サービスの疎通（3 つとも ok:true になること）
curl -s http://127.0.0.1:8050/api/health | python3 -m json.tool

# 判定器を通した推論（図への変更が返ること）
curl -s -X POST http://127.0.0.1:8050/api/analyze -H 'Content-Type: application/json' -d '{
  "utterance": "営業担当が、受注が確定したら受注書を作成して経理部に送ります。",
  "utteranceId": "u1", "recent": [], "verify": [],
  "model": {"rev":1,"updatedAt":"2026-01-01T00:00:00.000Z",
    "scope":{"title":"受注処理","purpose":"","trigger":"","frequency":""},
    "actors":[{"id":"A1","name":"営業担当","kind":"person","aliases":[],"lane":0,"addedAtRev":1},
              {"id":"A2","name":"経理部","kind":"role","aliases":[],"lane":1,"addedAtRev":1}],
    "steps":[],"branches":[],"issues":[]}}'
```

## 社内検証環境: IP アドレスで見せる

`.env` で `APP_BIND=0.0.0.0` にすると、`http://<ホストのIP>:8050`（例 `http://172.16.2.222:8050`）で
社内の端末から開ける。

```bash
sed -i "" "s|^APP_BIND=.*|APP_BIND=0.0.0.0|" .env
docker-compose up -d
```

**ただし平文 HTTP なので、このままでは録音（マイク）が使えない。** 実測:

| URL | `isSecureContext` | `navigator.mediaDevices` |
|---|---|---|
| `http://172.16.2.222:8050/` | `false` | **`undefined`** |
| `http://localhost:8050/` | `true` | `object` |

文字起こし以外（開発用サンプルの再生・図の生成・書き出し・業務分掌）は動くので、
録音を使わないデモならこのままでよい。録音も試したい場合は、次のどちらかを取る。

### A. 検証者の Chrome に例外を入れる（インフラ作業なし）

各端末で 1 回だけ設定する。

1. `chrome://flags/#unsafely-treat-insecure-origin-as-secure` を開く
2. `http://172.16.2.222:8050` を入力して **Enabled** にする
3. Chrome を再起動する

これで `isSecureContext` が `true` になり、マイクが使えるようになる（実測で確認）。
フラグ名のとおり安全側の扱いを外すので、**検証環境の URL にだけ**入れること。

### B. IP アドレスに証明書を出す（端末ごとの設定は CA の導入だけ）

Caddy の `tls internal` は IP アドレスにも証明書を出せる。下の HTTPS 公開の手順で
サイト名をホスト名でなく `https://172.16.2.222` にする。利用者端末には
BoX3 Internal CA のルート証明書が要る（次節を参照）。

## HTTPS で社内公開する

マイクを使うにはここまでやる必要がある。既存の BoX3 Caddy（`box3-prod-caddy`）に
サイトを 1 つ足すのが最短。Caddy コンテナからは `host.docker.internal:8050` に到達できる
（127.0.0.1 バインドのままでよい。検証済み）。

1. `~/projects/ted-box3/docker/caddy/Caddyfile` に追記:

```caddyfile
# ===================================================================
# grilljev.es.example.co.jp : 会議 → 業務フロー図デモ
# ===================================================================
grilljev.es.example.co.jp {
	tls internal

	encode zstd gzip

	# 音声（WAV）を whisper に中継するので、上限を上げておく
	request_body {
		max_size 50MB
	}

	reverse_proxy host.docker.internal:8050 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		header_up X-Real-IP {remote_host}

		# 判定は 1 回 3 秒前後、要約はさらに長い。既定 60s だと切れる。
		transport http {
			read_timeout 10m
			write_timeout 10m
		}
	}
}
```

2. Caddy を再読み込み:

```bash
docker exec box3-prod-caddy caddy reload --config /etc/caddy/Caddyfile
```

3. **社内 DNS で `grilljev.es.example.co.jp` を この Mac Studio の IP に向ける**
   （`box.es.example.co.jp` と同じ仕組み。ここは情報システム側の作業）。

4. **利用者の端末に BoX3 Internal CA のルート証明書を入れる**。
   `box.es.example.co.jp` を使っている端末なら導入済み。未導入なら:

```bash
docker cp box3-prod-caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt
# この root.crt を端末の証明書ストア（信頼されたルート証明機関）へ
```

証明書が入っていないと、ブラウザが警告を出すだけでなく **secure context にならず
マイクが使えない**ので、ここは省略できない。

## 運用

```bash
docker-compose ps                 # 状態
docker-compose logs -f app        # ログ
docker-compose restart app        # 再起動
docker-compose up -d --build      # コード更新後の入れ替え
docker-compose down               # 停止（volume は残る）
```

コンテナは `restart: unless-stopped`。Colima ごと再起動しても、Colima が上がれば復帰する。
Colima 自体は `jp.example.ted.colima` の LaunchAgent でログイン時に起動する。

## データの永続化とバックアップ

会議データ（図・文字起こし）は SQLite 1 ファイル。named volume `grilljev-demo_sessions` に入る。

```bash
# volume を tar に書き出す
docker run --rm -v grilljev-demo_sessions:/data -v "$PWD":/backup alpine \
  tar czf /backup/grilljev-sessions-$(date +%Y%m%d).tar.gz -C /data .

# 復元
docker run --rm -v grilljev-demo_sessions:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/grilljev-sessions-YYYYMMDD.tar.gz"
```

## 環境変数

compose が読むのは `.env`（`.env.docker.example` からコピー）。
既定値は `docker-compose.yml` 側に書いてあるので、変えたいものだけ `.env` に書く。

| 変数 | 既定 | 説明 |
|---|---|---|
| `APP_PORT` | `8050` | ホスト側の公開ポート |
| `APP_BIND` | `127.0.0.1` | 公開する bind アドレス。LAN に平文で出すときだけ `0.0.0.0` |
| `JEV_BACKEND` | `local` | 判定器。`local` = ホストの DiffusionGemma（外部送信なし）|
| `JEV_LOCAL_BASE_URL` | `http://host.docker.internal:8091` | ローカル判定器 |
| `JEV_LOCAL_MODEL` | `mlx-community/diffusiongemma-26B-A4B-it-bf16` | 非量子化 bf16 |
| `TYPESAFE_API_KEY` | （空）| Jev（クラウド・従量課金）を使うときだけ設定 |
| `LLAMA_BASE_URL` | `http://host.docker.internal:8080` | gemma |
| `WHISPER_BASE_URL` | `http://host.docker.internal:8178` | 文字起こし |
| `SESSIONS_DIR` | `/data/sessions` | volume のマウント先。変えない |

## トラブルシュート

**録音ボタンを押しても何も起きない**
HTTPS で開けているか確認する。`http://` や、証明書が信頼されていない `https://` では
マイクが使えない。この場合は「この URL では録音できません」と画面に出る。

**平文 HTTP で動かない機能がないか**
secure context を要る Web API は、`http://<IP>` では存在せず、呼ぶと TypeError になる。
このアプリで使っているのは次の 3 つで、いずれも受け皿を用意してある。

| API | 用途 | 平文 HTTP での挙動 |
|---|---|---|
| `navigator.mediaDevices` | 録音 | 使えない。画面に理由を出す |
| `crypto.randomUUID` | 行・記録の id | `lib/id.ts` の `newId()` が `getRandomValues` で代替する |
| `navigator.clipboard` | 業務分掌のコピー | `execCommand("copy")` に落とす |

新しく Web API を使うときは、secure context を要らないか確認すること
（要るなら握りつぶさず、画面に理由を出す）。

**`/api/health` で whisper / llama / jev が `ok:false`**
ホスト側の launchd プロセスが落ちている。`launchctl list | grep -E "whisper|diffusiongemma"`
で確認し、`launchctl kickstart -k gui/$(id -u)/jp.co.example.ted.diffusiongemma` で再起動。

**コンテナから外部 URL は引けるのにホストに届かない**
社内プロキシがコンテナに注入されている（`~/.docker/config.json`）。compose で
`NO_PROXY=localhost,127.0.0.1,host.docker.internal` を渡しているか確認する。

**`docker compose` が unknown command**
このマシンはスタンドアロン版。`docker-compose`（ハイフンあり）を使う。

**ビルドが `Failed to fetch Geist from Google Fonts` で落ちる**
`app/layout.tsx` が `next/font/google` を使っており、ビルド時に fonts.googleapis.com を見に行く。
Docker が `~/.docker/config.json` から自動で入れるのは `HTTPS_PROXY` だけで `HTTP_PROXY` が無く、
Next.js は後者も見るため到達できずに落ちる。`docker-compose.yml` の `build.args` で両方渡している。
中継（`jp.example.ted.docker-proxy-relay`、ホストの :3128）が止まっていると同じ症状になるので確認する:

```bash
launchctl list | grep docker-proxy-relay
curl -s -o /dev/null -w "%{http_code}\n" -x http://127.0.0.1:3128 https://fonts.googleapis.com/
```

中継の場所が違う環境では `.env` の `BUILD_PROXY` で上書きする。
外部に出られない環境で動かすなら、`next/font/local` でフォントを同梱するのが確実。

**判定が遅い / タイムアウトする**
DiffusionGemma bf16 は初回リクエストでモデル（約 52GB）を読む。2 回目以降は速い。
`JEV_LOCAL_TIMEOUT_MS` を伸ばすか、事前に一度叩いて温めておく。
