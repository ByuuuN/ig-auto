# ig-auto

Instagram ビジネスアカウントへの投稿・分析を自動化するパイプライン。
**Instagram API with Instagram Login**（`graph.instagram.com`）を使用。

## 状態

- [x] ディレクトリ雛形
- [x] Meta アプリ作成（docs/setup.md）
- [x] トークン取得（ダッシュボードで発行）
- [x] 疎通確認（`npm run whoami`）
- [ ] トークンの自動更新
- [ ] 投稿の自動化
- [ ] インサイト取得

## はじめかた

1. `docs/setup.md` のチェックリストを上から進める
2. `cp .env.example .env` してトークン等を記入
3. `npm run whoami` で疎通確認

依存パッケージは無い（Node 20+ 標準機能のみ）。

## 注意

- このリポジトリは **public**（画像の raw 配信のため）
- トークン・Secret は `.env` のみ。コミット禁止
- 投稿系は `DRY_RUN=true` がデフォルト
