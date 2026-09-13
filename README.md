# ig-auto

Instagram ビジネスアカウントへの投稿・分析を自動化するパイプライン。
**Instagram API with Instagram Login**（`graph.instagram.com`）を使用。

## 状態

- [x] ディレクトリ雛形
- [x] Meta アプリ作成（docs/setup.md）
- [x] トークン取得（ダッシュボードで発行）
- [x] 疎通確認（`npm run whoami`）
- [x] トークンの更新（`npm run auth:refresh`、手動）
- [ ] 初回の実投稿
- [ ] 投稿の自動化（Actions の cron）
- [ ] インサイト取得

## はじめかた

1. `docs/setup.md` のチェックリストを上から進める
2. `cp .env.example .env` してトークン等を記入
3. `npm run whoami` で疎通確認

依存パッケージは無い（Node 20+ 標準機能のみ）。

## 投稿のしかた

1. 画像（JPEG、縦横比 4:5〜1.91:1）を `content/assets/` に置く
2. `content/queue/<id>.json` を作る（`example.json` を参照）
   - `type`: `image`（1 枚）または `carousel`（2〜10 枚）
   - `status`: `draft` のうちは投稿されない。投稿してよければ `ready`
   - `scheduled_for`: `null` なら即時。ISO 形式の日時ならその時刻以降
3. **画像を commit して push する**（Instagram は公開 URL から画像を取りに来る）
4. `npm run post` — DRY_RUN=true なら内容とチェック結果の表示だけ
5. 問題なければ `DRY_RUN=false npm run post` — 確認に `y` と答えると公開される

投稿済みのものは `content/published/` に移動する。1 回の実行で投稿は 1 件だけ。

## 注意

- このリポジトリは **public**（画像の raw 配信のため）
- トークン・Secret は `.env` のみ。コミット禁止
- 投稿系は `DRY_RUN=true` がデフォルト
