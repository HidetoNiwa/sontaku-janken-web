# 忖度じゃんけん

相手の手をカメラで読み、必ず負ける手を出すじゃんけんです。映像と勝負の記録は、遊んでいるブラウザの中だけに残ります。

公開時のアドレスは次です。

https://tech.hahahahaha-nnn.work/sontaku/

## 手元で開く

このリポジトリの直下で、次を実行します。

```
python -m http.server 8780
```

ブラウザで http://127.0.0.1:8780/sontaku/ を開きます。`sontaku` フォルダの中のファイルを直接開くと、カメラとモジュールが動かないブラウザがあります。

## Cloudflare

Git 連携でこのリポジトリの `main` を使います。プロジェクト名は `sontaku-janken` にします。`wrangler.jsonc` の `name` と同じである必要があります。

- ビルドコマンドは空
- デプロイコマンドは `npx wrangler deploy`
- プレビューコマンドは `npx wrangler preview`
- ルートディレクトリは空（リポジトリの直下）

デプロイ後は `https://sontaku-janken.<account>.workers.dev/sontaku/` で確認します。

独自ドメインは、Pages のプロジェクトができてから `tech.hahahahaha-nnn.work` を追加します。DNS は ConoHa のまま、表示された向き先へ `tech` の CNAME を足します。

## フォルダ

| 場所 | 内容 |
| --- | --- |
| `sontaku/` | ページ、判定、フォント、手のモデル、MediaPipe、Chart.js |
| `_headers` | カメラをこのサイトだけに限り、他のサイトからの埋め込みを拒否する |

手のモデル、認識ライブラリ、グラフ、フォントは、このリポジトリから配信します。
