# Synced GIF Editor

GIFをサーバー時刻で同期表示し、別ページの管理画面で配置を編集できるExpressアプリです。

## 使い方

1. `GIF` フォルダーに `.gif` ファイルを入れます。
2. サーバーを起動します。

```bash
npm install
npm start
```

Node.jsコマンドがない場合、このCodex環境のNode.jsでは次の形です。

```bash
HOST=127.0.0.1 PORT=5178 /Users/litlexa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

閲覧ページ:

```text
http://localhost:5178/
```

管理ページ:

```text
http://localhost:5178/admin
```

ローカルの管理パスワード:

```text
admin
```

RenderではEnvironment Variablesに必ず入れてください。

```text
ADMIN_PASSWORD=好きな管理パスワード
```

## Render

```text
Build Command: npm install
Start Command: npm start
```

`render.yaml` も入っています。

## 注意

管理画面で保存した配置は `data/scene.json` に保存されます。Render無料環境では再起動や再デプロイで消える場合があるため、長期運用ではRender Diskか外部DBを使ってください。
