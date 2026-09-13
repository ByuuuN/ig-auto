# ig-auto

Instagram ビジネスアカウントへの投稿・分析を自動化するパイプライン。
**Instagram API with Instagram Login**（`graph.instagram.com`）を使用。

## 状態

- [x] ディレクトリ雛形
- [ ] Meta アプリ作成（docs/setup.md）
- [ ] トークン取得
- [ ] 疎通確認
- [ ] 投稿の自動化
- [ ] インサイト取得

## はじめかた

```bash
cp .env.example .env
git init
git add .gitignore
git commit -m "chore: add gitignore first"
git add .
git commit -m "chore: scaffold"
```

`.gitignore` を先にコミットすること。順番を逆にすると認証情報が履歴に残る。

その後 `docs/setup.md` のチェックリストを上から進める。

## 注意

- このリポジトリは **public**（画像の raw 配信のため）
- トークン・Secret は `.env` のみ。コミット禁止
- 投稿系は `DRY_RUN=true` がデフォルト
