# Flowloom（フロールーム）

画面遷移図と業務フロー図をブラウザ上で閲覧・整理する、静的なWebアプリです。AIが作成したJSONを読み込み、ノードを自由に配置し、整理後の座標を含めてJSONに保存できます。

## 使い方

GitHub Pagesで公開後は、 https://rinsan1120.github.io/Flowloom/ を開きます。

1. **JSONを開く**、またはJSONファイルを画面へドラッグ＆ドロップします。初回は「小さな図書室」のサンプルでも試せます。
2. 上部の **画面遷移／業務フロー** を切り替えます。業務フローはプルダウンから対象フローを選択できます。
3. ボックスをドラッグして位置を変更します。線とボックスをクリックすると、右側に説明・条件などを表示します。
4. **JSONを保存** で座標を含めたFlowloom形式のファイルをダウンロードします。次回そのファイルを読み込めば配置を復元できます。
5. 設計データを更新した場合は、古い図を開いた状態で新しいJSONを読み込みます。追加・削除件数を確認して更新すると、同じIDの既存配置を維持します。

図を資料に貼りたいときは **PNG保存**／**SVG保存** で、表示中の図（画面遷移、または表示中の業務フロー）を画像でダウンロードできます。PNGは2倍の解像度で書き出します。

「自動整列」は表示中の図の位置を変更します。手動調整した座標を上書きするため、実行後は必要に応じて再配置してください。

**注意:** 自動保存・クラウド同期はありません。ページを閉じる前に必ずJSONをダウンロードしてください。未保存の変更があるときは画面に表示します。

## Flowloom JSONの概要

Flowloom独自形式のバージョンは `1.0` です。以下は構造の最小例です。

```json
{
  "schemaVersion": "1.0",
  "title": "画面と業務の例",
  "screens": [
    { "id": "home", "name": "ホーム", "kind": "screen" },
    { "id": "confirm", "name": "確認", "kind": "dialog" }
  ],
  "transitions": [
    { "id": "start", "from": "home", "to": "confirm", "action": "開始" }
  ],
  "flows": [
    {
      "id": "process",
      "name": "処理を開始する",
      "steps": [
        { "id": "choose", "name": "対象を選択" },
        { "id": "execute", "name": "実行" }
      ],
      "links": [
        { "id": "branch", "from": "choose", "to": "execute", "condition": "対象が選ばれている" }
      ]
    }
  ],
  "layout": {
    "screens": {},
    "flows": {}
  }
}
```

- `screens`: 通常画面・ダイアログ（`kind` は `screen`、`dialog`、`unknown`）。
- `transitions`: 遷移元 `from`、遷移先 `to`、操作名 `action`。任意で `condition`、`note`、`description`。
- `flows`: 業務フローごとに `steps` を並べます。任意で `actor` や工程の説明・条件。分岐・合流・ループが必要な場合は、フローに `links`（`id`、`from`、`to`、任意で `condition`、`note`）を付けます。`links` のあるフローはその接続で描かれ（`condition` は線のラベルになります）、ないフローは `steps` の並び順どおりに直列で描かれます。
- `layout.screens`: 画面IDをキーにした `{ "x": 0, "y": 0 }` 形式の座標。
- `layout.flows`: フローID → 工程ID → 座標。
- IDは名称変更後も維持することを推奨します。安定したIDが配置の引き継ぎに必要です。

空の座標情報は読み込み時に自動配置されます。Flowloom JSONと図の表示はブラウザ内で処理され、外部サーバーへJSONを送信しません。

### domain-blueprintデータの取り込み

旧 `domain-model.json` の `screens`、`navigation`、`flows` を一方向に変換できます。変換後の正式データ形式はFlowloom JSONです。

- `entities`、`relations`、`domains` などは対象外であり、変換時に警告が表示されます。
- 画面種別が明示されていない場合、名前から推定するか「種別不明」として扱います。
- 旧データにIDがない遷移・工程のIDは決定的に生成しますが、名前・条件・順序の変更で配置の継続性が失われる場合があります。
- 既存のdomain-blueprint形式を編集するのではなく、取り込んだ後は **Flowloom形式で保存** してください。

## ローカル開発

Node.js 22（またはVite 7が要求するNode.js 20.19以上）を用意します。

```sh
npm ci
npm run dev
```

表示されたローカルURLをブラウザで開いてください。

```sh
npm test
npm run build
npm run preview
```

`npm test` はJSON変換・検証・配置維持などの単体テストです。

## GitHub Pages公開

`.github/workflows/pages.yml` は `main` へのPushまたは手動実行で、単体テスト・ブラウザスモークテスト・本番ビルドを行い、成功時に `dist` をGitHub Pagesへデプロイします。

リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。公開前にこの設定が必要な場合があります。

PagesのURLは https://rinsan1120.github.io/Flowloom/ です（デプロイ成功後）。

ブラウザスモークテストは実際のChromiumで、サンプルの読込、画面と業務フローの切り替え、遷移線、ドラッグ配置、JSON保存と再読込を確認します。

## 現時点の制約

- 業務フローの分岐・合流・ループはJSONの `links` で表現します。フローの図上編集（図から工程や接続を直接追加・変更すること）は非対応です。
- 図上から画面・遷移・工程を直接追加する機能はありません。構造の変更はJSON側で行います。
- 自動保存・ユーザーアカウント・サーバー保存・外部GitHub連携はありません。
- GitHub Pages上で公開されるのはアプリ本体と架空のサンプルのみです。実プロジェクトのJSONをコミットしないでください。
