# grilljev-demo

会議の**音声から、業務フロー（UML シーケンス図）をリアルタイムに立ち上げる**デモアプリ。

話しながら図が育ち、雑談は図に入らず、ファシリテーターが「いま聞くべき 1 問」を投げかけます。
[TypeSafe AI の Jev](https://docs.typesafe.ai/)（クラウドの判定モデル）と、ローカルで動く LLM・音声認識を組み合わせた
**ハイブリッド構成**です。

> これは技術デモです。閾値やプロンプトは少数のサンプルで調整したもので、実際の会議での精度は保証しません。

## 何をするか

1. **音声を文字起こし**する（ローカルの whisper.cpp。音声は外に出ない）
2. 発話ごとに、**業務の話か雑談か**、誰が誰に何をするのかを Jev が判定し、**図に足す**
3. ステップ名・新しい登場人物の名前・分岐の条件文は、**ローカル LLM（gemma）が書き**、次の発話で Jev が**検証**する
4. ファシリテーターが、gemma で問いの候補を書き、Jev が「いま出すべき 1 問」を選ぶ
5. 会話が別の業務に移ったら検知し、**対象業務（共通認識）の貼り替え**を確認する
6. できた図を **`.drawio` / `.mmd` / `.svg`** で書き出す（draw.io で開いて手で編集できる）

## 3 つのモデルの役割分担

| | 担当 | 得意なこと |
|---|---|---|
| **whisper.cpp**（ローカル） | 文字起こし | 音声 → 日本語テキスト |
| **Jev**（TypeSafe AI・クラウド） | **判定** | 選択肢から 1 つ選ぶ／確率を返す。**テキストを生成しない** |
| **gemma**（llama.cpp・ローカル） | **生成** | 短い文言（ステップ名、問いかけ、業務名）を書く |

Jev は「既存のアクター一覧・ステップ一覧・未解決の論点」をそのまま選択肢にした**閉じた選択**を、1 リクエストに十数問まとめて
約 0.3 秒で返します（質問は並列評価されるので、増やしても遅くなりません）。gemma に同じことをさせると選択肢の外を返しますが、
逆に文言を書くのは Jev にはできません。**gemma が書いたものは、次の発話の Jev リクエストに相乗りさせて必ず検証**します
（発話に無い情報が足されていないか、既存アクターの言い換えではないか）。

## 外部に送られるデータ

- **音声は外に出ません。**（ブラウザ → 自分のマシンの whisper-server のみ）
- **Jev（`api.typesafe.ai`）には、文字起こしテキストと、図の要素（業務名・アクター名・ステップ名・問いの文）が送られます。**
  従量課金です。1 発話につき 1 リクエスト（入力約 3,000 トークン）が目安です。
- API キーはサーバ側（Route Handler）でしか読みません。ブラウザには出ません。
- `JEV_BACKEND=local` にすると、判定もローカルで行い、**外部には何も送りません**（下の「ローカル判定器」）。

## 必要なもの

- Node.js 22.5 以上（Next.js 16。`node:sqlite` を使うため）
- **whisper.cpp**: `whisper-server` と、日本語向けのモデル（動作確認は `ggml-large-v3-turbo-q5_0.bin`）
- **llama.cpp**: `llama-server` と、gemma 系の instruct モデル（動作確認は `gemma-4-12b-it` Q4_K_M と `gemma-4-E4B-it` Q4_K_M。常駐させているのは後者）
- **TypeSafe AI の API キー**（[コンソール](https://console.typesafe.ai/)で発行）
- Web Audio が使えるブラウザ（Chrome で確認）とマイク

動作確認は Apple Silicon の macOS で行っています。他の環境は未確認です。

## セットアップ

```bash
git clone https://github.com/Takashi-Matsumura/grilljev-demo.git
cd grilljev-demo
npm install
cp .env.example .env.local   # TYPESAFE_API_KEY を書く
```

3 つのバックエンドを起動します（それぞれ別のターミナル）。

```bash
# 1. ローカル LLM（gemma）。ポート 8080
llama-server -m /path/to/gemma-instruct.gguf --port 8080

# 2. 文字起こし（whisper）。ポート 8178
#    モデルは ~/.local/share/whisper-models/ggml-large-v3-turbo-q5_0.bin に置く
npm run whisper

# 3. アプリ。ポート 3000
npm run dev
```

http://localhost:3000 を開きます。画面右上の心拍アイコンで、3 つのバックエンドの状態を確認できます
（Jev はキーの有無だけを見ます。課金される外部 API なので、疎通確認では呼びません）。

### llama-server（gemma）の常駐化（ポート 8080）

毎回ターミナルで起動しなくて済むように、llama-server を launchd に登録して常駐させています。

動作確認した環境: Mac Studio 2025（Apple M4 Max・メモリ 36GB）、Homebrew の `llama.cpp`（version 9590）。

```bash
brew install llama.cpp          # /opt/homebrew/bin/llama-server が入る
mkdir -p ~/Models/llama.cpp/gemma-4-E4B-it
```

モデルは `~/Models/llama.cpp/gemma-4-E4B-it/` に置きます。

- 本体: `gemma-4-E4B-it-Q4_K_M.gguf`（約 5.3GB）
- 画像入力用のプロジェクタ: `mmproj-gemma-4-E4B-it-Q8_0.gguf`（約 0.56GB）。このアプリは画像を使わないので、無くても動きます
  （そのときは plist の `--mmproj` の 2 行を消す）

手元のファイルは入手元を特定できませんでした（Hugging Face の現在の配布物とハッシュが一致しない。配布元の更新と思われます）。
同等のものは、たとえば次のように入手できます。

```bash
hf download unsloth/gemma-4-E4B-it-GGUF gemma-4-E4B-it-Q4_K_M.gguf \
  --local-dir ~/Models/llama.cpp/gemma-4-E4B-it
hf download ggml-org/gemma-4-E4B-it-GGUF mmproj-gemma-4-E4B-it-Q8_0.gguf \
  --local-dir ~/Models/llama.cpp/gemma-4-E4B-it
```

`~/Library/LaunchAgents/jp.co.occ.ted.llama-server.plist`（`/Users/<you>` は自分のホームディレクトリに置き換える）:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>jp.co.occ.ted.llama-server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/llama-server</string>
    <string>-m</string><string>/Users/<you>/Models/llama.cpp/gemma-4-E4B-it/gemma-4-E4B-it-Q4_K_M.gguf</string>
    <string>--mmproj</string><string>/Users/<you>/Models/llama.cpp/gemma-4-E4B-it/mmproj-gemma-4-E4B-it-Q8_0.gguf</string>
    <string>-ngl</string><string>999</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8080</string>
    <string>--ctx-size</string><string>16384</string>
    <string>--parallel</string><string>4</string>
    <string>--cache-ram</string><string>2048</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/llama-server.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/llama-server.err.log</string>
</dict>
</plist>
```

- `-ngl 999`: 全層を GPU（Metal）に載せる
- `--ctx-size 16384 --parallel 4`: 4 本を同時に処理する。コンテキストは 4 本で分けるので、1 本あたり 4096 トークン
  （ステップ名・問いの候補・推奨回答が並行して来るため）
- `--cache-ram 2048`: プロンプトのキャッシュに使うメモリの上限（MiB）（既定は 8192）

```bash
# 登録して起動
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.co.occ.ted.llama-server.plist
# 状態（PID が出ていれば起動中）
launchctl list | grep llama-server
# 設定を変えたら再読み込み（kickstart では plist は読み直されない）
launchctl bootout gui/$(id -u)/jp.co.occ.ted.llama-server
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.co.occ.ted.llama-server.plist
# 再起動だけなら
launchctl kickstart -k gui/$(id -u)/jp.co.occ.ted.llama-server
# ログ
tail -f /tmp/llama-server.err.log
# 動作確認（モデル名が返れば OK）
curl -s http://127.0.0.1:8080/v1/models
```

`llama-server` は `model` の名前を見ないので、`.env.local` の `LLAMA_MODEL` は既定の `gemma` のままで動きます。

### 環境変数（`.env.local`）

| 変数 | 既定 | 説明 |
|---|---|---|
| `TYPESAFE_API_KEY` | （必須） | Jev の API キー。`NEXT_PUBLIC_` を付けないこと。`JEV_BACKEND=local` なら不要 |
| `JEV_BACKEND` | `typesafe` | 判定器。`local` にするとローカルの OpenAI 互換サーバで判定する |
| `JEV_LOCAL_BASE_URL` | `http://127.0.0.1:8090` | ローカル判定器のサーバ |
| `JEV_LOCAL_MODEL` | （空） | ローカル判定器のモデル名。空ならサーバの `/v1/models` の先頭（キャッシュ内の全モデルが並ぶので、明示を推奨） |
| `JEV_LOCAL_TIMEOUT_MS` | `20000` | ローカル判定器の応答を待つ上限 |
| `LLAMA_BASE_URL` | `http://localhost:8080` | llama-server |
| `LLAMA_MODEL` | `gemma` | llama-server に渡すモデル名 |
| `LLAMA_IDLE_TIMEOUT_MS` | `120000` | トークンが届かない無音がこの時間続いたらアボート |
| `WHISPER_BASE_URL` | `http://127.0.0.1:8178` | whisper-server |
| `SESSIONS_DIR` | `./sessions` | 会議の保存先 |

### ローカル判定器（Jev の代わり）

`JEV_BACKEND=local` にすると、Jev と同じ質問を、ローカルの OpenAI 互換サーバ（動作確認は
DiffusionGemma `mlx-community/diffusiongemma-26B-A4B-it-4bit` をポート 8090 で起動したもの）に答えさせます
（`lib/jev-local.ts`）。呼び出し側・画面はそのままで、Jev コンソールには送り先としてローカルのサーバが出ます。

Jev との違い:

- **確率はモデルの自己申告**です。拡散モデルは logprobs も構造化出力も使えないため、各答えに
  確からしさ p を付けさせ、Jev の形（noul の P(true)、choice の確率分布、score の期待値）に組み直します。
  自己申告は 0.7〜1.0 に偏るので、Jev より言い切り寄りになります。閾値（`lib/analysis/thresholds.ts`）は Jev に合わせたままです。
- 1 回 4〜8 秒かかります（Jev より遅い）。
- 崩れた選択肢 id（`__none__` → `__none`）は近いものに寄せ、寄せられない問は「回答なし」になります。

#### DiffusionGemma のセットアップ（ポート 8090）

動作確認した環境: Mac Studio 2025（Apple M4 Max・メモリ 36GB）、macOS 27.0、Homebrew の Python 3.12.14、
`mlx-vlm` 0.7.2（`mlx` 0.32.2・`transformers` 5.17.0）。
モデルは約 16GB（4bit）で、推論中のピークメモリは約 17.5GB でした。gemma（8080）と同時に載せて動いています。

```bash
brew install python@3.12

mkdir -p ~/diffusiongemma && cd ~/diffusiongemma
/opt/homebrew/opt/python@3.12/bin/python3.12 -m venv .venv
.venv/bin/pip install "mlx-vlm==0.7.2"

# モデルを先に落としておく（約 16GB。~/.cache/huggingface/hub に入る）
.venv/bin/hf download mlx-community/diffusiongemma-26B-A4B-it-4bit

# 手で起動して確かめる（Ctrl+C で止める）
.venv/bin/python -m mlx_vlm.server --host 127.0.0.1 --port 8090
```

- **モデルは起動時ではなく、最初のリクエストで読み込まれます**（`model` に指定された名前で読む。約 7 秒）。
  2 回目以降は速くなります。
- `/v1/models` は、読み込み済みのモデルだけでなく **HF キャッシュにある全モデル**を返します。
  そのため `.env.local` では `JEV_LOCAL_MODEL` を明示してください（空だと、キャッシュ内で名前順が先頭のモデルが選ばれます）。
- `--host 127.0.0.1` で起動します（既定は `0.0.0.0` で、LAN に公開されてしまいます）。
- mlx-vlm 0.7.2 では `logprobs` を付けると HTTP 500 になり、`response_format` は拒否されます（拡散モデルは非対応）。
  アダプタはどちらも使いません。

#### 常駐化（launchd）

ログイン時に自動で起動し、落ちたら再起動するように、LaunchAgent に登録します。
`/Users/<you>` は自分のホームディレクトリに置き換えてください（plist では `~` が使えません）。

`~/Library/LaunchAgents/jp.co.occ.ted.diffusiongemma.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>jp.co.occ.ted.diffusiongemma</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/<you>/diffusiongemma/.venv/bin/python</string>
    <string>-m</string><string>mlx_vlm.server</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8090</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/<you>/diffusiongemma</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/diffusiongemma.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/diffusiongemma.err.log</string>
</dict>
</plist>
```

```bash
# 登録して起動
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.co.occ.ted.diffusiongemma.plist
# 状態（PID が出ていれば起動中）
launchctl list | grep diffusiongemma
# 再起動（plist を変えたときは bootout → bootstrap で読み直す）
launchctl kickstart -k gui/$(id -u)/jp.co.occ.ted.diffusiongemma
# 停止して登録解除
launchctl bootout gui/$(id -u)/jp.co.occ.ted.diffusiongemma
# ログ（モデルの読み込み・リクエストごとの所要時間は err 側に出る）
tail -f /tmp/diffusiongemma.err.log
```

#### 動作確認と `.env.local`

```bash
curl -s http://127.0.0.1:8090/health        # "status":"healthy"
curl -s http://127.0.0.1:8090/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"mlx-community/diffusiongemma-26B-A4B-it-4bit","messages":[{"role":"user","content":"こんにちは"}],"max_tokens":16}'
```

```bash
# .env.local
JEV_BACKEND=local
JEV_LOCAL_BASE_URL=http://127.0.0.1:8090
JEV_LOCAL_MODEL=mlx-community/diffusiongemma-26B-A4B-it-4bit
JEV_LOCAL_TIMEOUT_MS=20000
```

アプリの画面右上の心拍アイコンで、Jev の欄に「ローカル判定器 http://127.0.0.1:8090（モデル名）」が出れば接続できています。

## 使い方

トップページ（`/`）で「業務名」（必須）と「関係部署」（任意）を入れて会議を始めます。
保存済みの会議は一覧から開いて再開でき、名前の変更・削除（確認つき）もできます。会議は `/s/<slug>` で開きます。

画面は既定で2列（文字起こし／図）、**開発者モード**（右上のトグル、既定オフ）を ON にすると
Jev コンソールが加わり3列になります。会議の内容（図・過去の図・文字起こし）は、変更の 1.5 秒後に自動で
保存されます（SQLite、`sessions/sessions.db`。`.gitignore` 済み）。再開時、処理中だった行は「中断」扱いになります。

- **左: 文字起こし**
  - **録音ボタン**: 正方形の大きなボタン。押すと録音を開始し、録音中は赤くなって白い丸が心拍のように
    鼓動します。直下に、マイクの音量メーターと状態（停止中・待機中・発話を検出 など）を表示します
  - **Whisper**: 見出しの横の静的なラベル。音声認識にローカルの whisper.cpp を使っていることを示すだけで、
    ON/OFF はありません（Jev と違い課金が無いため）
  - **Jev トグル**: ON の間、確定した文字起こしを 1 行ずつ Jev へ送って判定し、図に反映します。
    OFF にすると、文字起こしは続きますが図は動きません（課金を止めたいときに使う）
  - **語彙ヒント**: 対象業務名・登場人物名・書類やシステムの名前を、図が育つのに合わせて**自動で**
    whisper へ渡します（`lib/transcript/vocab.ts`。Jev/gemma をすでに経た語彙なので、新たに呼び直さない）。
    自動分はラベルの右にキャプションで出ます。まだ図に出ていない語彙だけ、下の欄に手で足せます
    （自動分を上書きしません）
  - 開発者モードを ON にすると、下に**開発用サンプル**が出て、マイクなしで台本を Jev に流せます（後述）
- **中: 図** — 上から図タブ・目的と共通認識の充足度（目的／きっかけ／頻度）を固定で表示し、その下に
  Mermaid の業務フロー図だけが残りの高さいっぱいで単独スクロールします。未確定のステップは点線で「（仮）」
  と出ます。最下段は固定バーで、要対応・業務分掌・書き出しをまとめます（後述）。ファシリテーターの問いは、
  自動問いかけが ON のときだけ図の上にフローティングカードで浮かせて出します（後述）
- **右: Jev コンソール**（折りたためる） — Jev に送った質問と、返ってきた確率を、1 回ごとに確認できます
  （質問と回答／送信 JSON／受信 JSON）。

### 開発用サンプル

マイクがなくても、動作を再現できます（開発者モードON）。台本を「▶ 自動再生」か「⏭ ステップ実行」（1 行ずつ）で流すと、
1 行ごとに実際に Jev を呼んで判定します（課金あり）。台本の想定と一致したかを各行に表示します。

- **題材「このアプリの仕組み」（Jev 専用）**: このアプリ自身の仕組みを業務に見立てた台本です。
  ブラウザ / サーバー / whisper / Jev / gemma / Mermaid の 6 者で、発話が図になるまでの流れ（次節）を、自分自身で図にできます。
  会議を始めるとき、関係部署にこの 6 者を入れて作ってください（他の初期設定の会議で題材だけ切り替えると、
  6 者が新しい登場人物として扱われ、ほぼ全部が仮ステップになります）。

### ファシリテーター

gemma が問いの候補を 3 つ書き、Jev が「根拠が薄い問い」「すでに答えが出ている問い」を捨てて 1 問を選びます。
決め手に欠けるときは**何も出さず黙ります**。

- **自動問いかけ**の ON/OFF は、右上の心拍アイコン（バックエンドの状態ダイアログ）から切り替えます。既定は ON。
- ON のあいだ、間が空いたときなどに自動で問いを出し、業務フロー図の上にフローティングカードで浮かせて表示します
  （「答えた」「保留にする」「別の問いにする」で操作）。OFF にすると、新しい問いは出さなくなります。
- 1 度に出すのは 1 問。答え・保留になるまで次は出しません。
- 答えないまま業務の話が 2 回続くと、保留にして先へ進みます。
- 業務の目的が未確定なら、目的（存在意義）を最優先で問います。

### 対象業務の変化

会話が別の業務へ移ったと Jev が判断すると（直近 3 発話の平均）、確認バナーを出します。**自動では何も変えません。**

- **図を分ける**: いまの図を「過去」のタブ（読み取り専用）に残し、新しい対象業務で図を始める（登場人物は引き継ぐ）
- **対象を差し替える／広げる**: 図はそのまま、対象業務の名前だけを変える
- **同じ業務として続ける**: 何も変えない（以後 5 分は出さない）

### 要対応

図の下の固定バーにある「要対応 N」を開くと、**確認待ちのステップ**（確信の低い仮ステップの承認/却下）と
**未解決の論点**を1つのリストにまとめて確認できます。承認すると確定（実線）、却下すると取り消し
（履歴には残ります）。いま参加者に出している問い（ファシリテーターのカード）は、ここには重複して出しません。
例外・暗黙知・属人化の印が付いたステップは、名前の末尾に［例外］［暗黙知］［属人］が付き、
リストの最下部にも件数の総括が出ます。過去のタブでは操作できません（読み取り専用）。

### 業務分掌ドキュメント

図の下の固定バーの「業務分掌を作る」で、Markdown を作ります（表示・`.md` 保存・コピー）。
関係者・ステップ表・フロー図・論点はモデルからコードで作り、gemma が書くのは「概要」と「改善候補」だけです
（AI の文であることを文中に明記。gemma が落ちていても表と図は作れます）。

### 図の書き出し

図の下の固定バーの「書き出し ▾」から、いま見ている図（過去のタブなら過去の図）を保存できます。
ファイル名は「対象業務名-YYYYMMDD-HHmm.拡張子」です。すべてブラウザ内で作るので、図の内容は外に出ません。
全画面表示は図の右上のアイコン（⛶）から開けます。

| 形式 | 用途 |
|---|---|
| `.drawio` | [draw.io（diagrams.net）](https://app.diagrams.net/)で開いて手編集できる。非圧縮の mxGraph XML |
| `.mmd` | Mermaid のコード。GitHub や Obsidian でそのまま描画できる |
| `.svg` | 画面に描画された図そのもの（画像として使える） |

`.drawio` では、人・部署は人型、システム・社外は箱型のライフラインになり、`alt` / `opt` / `loop` は枠と条件付きで描かれます。
返答は点線、確信の低い仮ステップは灰色の点線と「（仮）」、書類・システム名は付箋（図の右端）になります。

## 仕組み: 発話が図になるまで

1 つの発話が図の矢印になるまでに、次の段階を通ります。**Jev は選ぶだけで、図を描くのはコードです。**

| 段階 | 何をするか | どこで動くか | ファイル |
|---|---|---|---|
| 判定 | 発話と図の現状を送り、16 問（雑談か・誰から誰へか・依頼か返答か・重複か…）に確率で答えてもらう | Jev（外部 API） | `lib/analysis/questions.ts` |
| 解釈 | 回答を閾値と比べ、「図への変更（ops）」の一覧に直す | Next.js のサーバー（`/api/analyze`） | `lib/analysis/interpret.ts` |
| 適用 | 変更を図のデータ（`FlowModel`）に反映する。唯一の変更口 | ブラウザ | `lib/model/reducer.ts` の `applyOps` |
| 変換 | 図のデータから Mermaid のコードを毎回書き直す | ブラウザ | `lib/render/mermaid.ts` の `toMermaid` |
| 描画 | Mermaid が SVG の絵にする | ブラウザ | `mermaid` ライブラリ |

ステップは、処理が終わった順ではなく**話した順**に並びます（`lib/analysis/place.ts`。遅れて届いた結果も、話した順の位置に差し込みます）。

その後、gemma がステップ名を作り（約 2 秒）、次の発話の判定で Jev が検証します。

### 例: 「ブラウザは、その文字を Jev に送って…判定してもらいます」

- Jev の回答: 行う側=ブラウザ(0.98) / 相手=Jev(0.99) / 依頼して返事を待つ(0.98) / 雑談の確率 0.03 / 既存ステップと同じではない
- 解釈: 確信度 `min(0.98, 0.99)` が閾値 0.7 以上、具体性も足りる → 実線で確定
- 変更: `step.add  ブラウザ → Jev  sync  確信 0.98`
- Mermaid: `A1->>A3: 文字を送り判定を依頼する`（返答なら `-->>`、仮ステップも点線で「（仮）」付き）

### なぜ間に「図のデータ」を挟むのか

Mermaid のテキストは、あとから 1 行だけ直すのが大変です（「その前に…」の中間挿入、「実は違う」の取り消しなど）。
そこで、並び順（`order`）や状態を持つデータを正とし、Mermaid のコードはそこから毎回作り直します。
保存・`.drawio` / `.mmd` の書き出し・業務分掌ドキュメントも、同じデータから作ります。
Jev の質問と回答は、右端の Jev コンソールで 1 回ずつ確認できます。

## ディレクトリ構成

```
app/
  page.tsx                 会議の一覧と新規作成
  s/[slug]/page.tsx        会議（Studio）。保存済みの内容を読んで再開
  components/              画面（studio / mic-transcriber / diagram-pane / jev-console ほか）
    use-pipeline.ts        判定 → 図の更新 → gemma の後続処理 → 検証 の流れ
    use-facilitator.ts     ファシリテーター
    use-scope-shift.ts     対象業務の変化の検知
  api/
    transcribe/            音声 → whisper-server
    analyze/               1 発話 → Jev（十数問を 1 リクエスト）
    label/                 gemma: ステップ名・登場人物・分岐の条件文
    facilitate/            gemma: 問いの候補 → Jev: 選別
    scope-shift/           gemma: 新しい業務名の候補 → Jev: 選別
    sessions/              会議の保存（一覧・作成・取得・自動保存・削除）
    summarize/             図 → 業務分掌ドキュメント（gemma は概要と改善候補だけ）
    health/                バックエンドの疎通確認
lib/
  model/                   業務フローの正規化モデルと、変更の唯一の入口（applyOps）
  analysis/                Jev への質問の組み立てと、回答 → 図の変更（閾値は thresholds.ts）
  facilitator/  scope/     問いかけ・対象業務の変化
  audio/                   マイク → 16kHz WAV（AudioWorklet + RMS ベースの発話区間検出）
  render/                  モデル → Mermaid（mermaid.ts）/ draw.io の XML（layout.ts で座標計算 → drawio.ts）/ 書き出しの補助（export.ts）
  store/                   会議の SQLite 保存（node:sqlite。slug の検証）
  summary/                 業務分掌ドキュメントの Markdown 生成
  jev.ts  llm.ts           Jev / llama-server のクライアント
prompts/                   gemma に渡すプロンプト（Markdown。dev では毎回読み直す）
```

## 設計上のポイント

- **モデルが唯一の真実**: 図も保存も `FlowModel` から作ります。変更は `ModelOp`（差分）で表し、不正な op は例外にせず無視します。
- **確信のないものを確信ありげに描かない**: Jev の確信度が低いステップは点線で描き、「（仮）」を付けます。
- **判定と生成を分ける**: Jev は選ぶだけ、gemma は書くだけ。生成物は必ず Jev が検証します。
- **gemma の思考は止める**: gemma は既定だと短い JSON を返すのにも思考を挟み、実測で 14 秒かかりました。
  `enable_thinking: false` で 1.3 秒になります（`lib/llm.ts`）。
- **非同期の書き込みでも id が衝突しない**: gemma の後続処理は Jev の待ち行列を待たせず、別に走ります。
  そのため、Jev の解釈は**適用する瞬間の最新モデル**で id を採番し直します（`lib/analysis/rebase.ts`）。
- **閾値は 1 箇所に集約**: `lib/analysis/thresholds.ts`、`lib/facilitator/trigger.ts`、`lib/facilitator/pick.ts`、`lib/scope/drift.ts`。
  実測で調整した値には、根拠をコメントに残しています。

## 既知の制限

- **話者分離はしません。** 「私がやります」のような一人称の主語は、原理的に特定できません（確信が低くなり、点線の仮ステップになります）。
- 新しい登場人物を含むステップは、承認するまで点線（仮）のままです。
- 保存はファイル 1 つで、複数のタブ・人が同じ会議を同時に開く使い方は想定していません（後から保存した方が勝ちます）。
- `.drawio` にはアクティベーション（実行の帯）と、論点・暗黙知などのバッジは含みません。付箋は図の右端にまとめて置きます。
  draw.io で開いて崩れないことは実際に確認しています。ブラウザのダウンロード操作（保存フォルダへの保存）そのものは、動作確認の対象に含めていません。
- 入れ子のシーケンス図（サブフロー）は未対応です。「1 ステップの細分化」は、別の図として詳細化します。
- Jev の料金・レート制限は公開情報では確認できていません。連続 3 回失敗すると 5 分休止します。
- 自動の問いかけは、Jev が「いまは黙る」と判断し続けると、約 30 秒ごとに Jev と gemma を呼び続けます（上限なし）。

## ロードマップ

- [x] 音声の文字起こし（whisper.cpp）
- [x] 業務フローのモデルと、Mermaid での表示
- [x] Jev による判定（雑談の除外・アクター・重複・論点）
- [x] gemma による文言の生成と、Jev による検証
- [x] ファシリテーター（問いの生成・選別、図の上へのフローティング表示）
- [x] 対象業務の変化の検知と、図の分割
- [x] 図の書き出し（`.drawio` / `.mmd` / `.svg`）
- [x] セッションの保存と再開、確認待ちの承認、業務分掌ドキュメント
- [x] 図の全画面表示（⌘/Ctrl+ホイールで拡大縮小、スペース+ドラッグで移動）
- [x] 開発者モード（既定オフ。確度・rev・トークン数・生JSON・開発用サンプルなど、
      会議の進行に要らない内部情報をまとめて隠す）

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ（3000） |
| `npm run whisper` | whisper-server を 8178 で起動 |
| `npm run build` / `npm start` | 本番ビルド / 起動 |
| `npm run typecheck` | 型チェック |
| `npm run lint` | ESLint |

## 技術スタック

Next.js 16（App Router / Turbopack）・React 19・Tailwind CSS v4・[Mermaid](https://mermaid.js.org/)。
Jev・llama-server・whisper-server は、SDK を使わず素の `fetch` で呼んでいます。

> このリポジトリの Next.js は、これまでのバージョンから破壊的変更があります。実装前に
> `node_modules/next/dist/docs/` の該当ガイドを読んでください（`AGENTS.md` 参照）。

## ライセンス

[MIT License](./LICENSE) © 2026 Takashi Matsumura
