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

## Cloudflare Pages

Git 連携でこのリポジトリの `main` を使います。

- フレームワークは None
- ビルドコマンドは空
- 出力ディレクトリはリポジトリのルート

出力を `sontaku` にすると、`/sontaku/` では開けなくなり、直下の `_headers` も読まれません。デプロイ後は `https://<project>.pages.dev/sontaku/` で確認します。

独自ドメインは、Pages のプロジェクトができてから `tech.hahahahaha-nnn.work` を追加します。DNS は ConoHa のまま、表示された向き先へ `tech` の CNAME を足します。

## フォルダ

| 場所 | 内容 |
| --- | --- |
| `sontaku/` | ページ、判定、フォント、手のモデル、MediaPipe、Chart.js |
| `_headers` | カメラをこのサイトだけに限り、他のサイトからの埋め込みを拒否する |

手のモデル、認識ライブラリ、グラフ、フォントは、このリポジトリから配信します。
