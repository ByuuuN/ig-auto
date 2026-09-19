# Instagram 自動投稿パイプライン

## 目的

自分の Instagram ビジネスアカウントに対して、投稿の生成・予約投稿・
インサイト取得を自動化する。運用にかける時間は 1 日 30 分以内。
最終的な目的は副業としての収益化であり、追加の金銭的支出は行わない。

## API 仕様（最重要・間違えやすい）

使用するのは **Instagram API with Instagram Login**。
ネット上の記事の多くは Facebook Login 方式なので、そのままコピーすると必ず失敗する。

- ホストは `graph.instagram.com`（`graph.facebook.com` ではない）
- Facebook ページの連携は **不要**
- 認証は Business Login for Instagram
- **トークンは App Dashboard の「アカウントを追加」→「トークンを生成」で発行する。**
  自分のアカウント 1 つだけを扱うため、OAuth の認可フロー（コード交換）は実装しない。
  他人のアカウントを扱う段階になったら改めて実装する
- `IG_USER_ID` は `npm run whoami` が返す `user_id`（17841… で始まる）を使う。
  ダッシュボードに表示される ID は別物
- 対象は Instagram プロアカウント（ビジネス）のみ
- スコープは `instagram_` 接頭辞つきのものだけを使う:
  - `instagram_business_basic`
  - `instagram_business_content_publish`
  - `instagram_business_manage_comments`
  - `instagram_business_manage_insights`（インサイト取得に必要）
  - （必要になれば `instagram_business_manage_messages`）
- 旧スコープ名（`business_basic` 等）は廃止済み。使わない
- `instagram_content_publish`（`business` なし）は**別物**。旧 Facebook ログイン方式の
  権限で、この構成では機能しない。ダッシュボードの一覧で隣接していて紛らわしい
- **スコープはトークン発行時に確定する。** 後から権限を足しても既存のトークンには
  反映されない。追加したらトークンを取り直すこと
- この方式では広告関連とタグ付けのエンドポイントは利用できない

## 技術的な制約

- 画像は **JPEG**。PNG は弾かれる報告が多い
- `image_url` は **外部から到達可能な公開 URL** が必須。
  ローカルファイルの直接アップロードはできない
- メディアコンテナは作成後 **24 時間で失効**
- レート制限は **200 calls / hour**
- 長期アクセストークンは **60 日で失効**。refresh が必須
- 投稿は「コンテナ作成 → media_publish」の 2 段階

## インフラ方針（無料枠のみ）

金銭的支出を発生させないこと。有料プランや従量課金のサービスを提案しない。

| 用途 | 使うもの |
| --- | --- |
| 定期実行 | GitHub Actions（cron） |
| 画像ホスティング | 本リポジトリの公開 raw URL |
| トークン保管 | Actions Secrets / ローカルは .env |

- `pages/` の OAuth コールバックは現在未使用（将来 OAuth を実装する場合のために残している）
- Vercel の Hobby プランは商用利用不可のため使わない
- データベースは現段階では導入しない

## セキュリティ

- **このリポジトリは public である**
- アクセストークン・App Secret は `.env` のみに置く。コミット禁止
- ログやエラー出力にトークンを含めない。必ずマスクする
- スクリーンショットを扱う場合、cookie・セッション情報・
  個人 ID が写り込んでいないか確認してから配置する
- 新しく生成するファイルに認証情報を書き込まない

## 実行時のルール

- 投稿など外部に影響を与えるコードは `DRY_RUN=true` をデフォルトにする
- 公開系 API を呼ぶ前に、実行内容を出力して確認を求める
- ループ内から `media_publish` を呼ばない（連投はスパム判定の原因になる）
- 認証が通っていない段階で投稿系のコードを書かない

## AI 会社の運用

社長（本人）の下に、秘書室と 3 つの部署を置いて運用する。設定はこの PC の中だけに置く（`.claude/` と
`content/ideas.md`・`content/facts.md` は `.gitignore` 済み。公開リポジトリには載せない）。

| 役職 | 実体 | 仕事 |
| --- | --- | --- |
| 秘書室 | メインの Claude（`/brief`・`/new-post`） | 朝の報告、各部署への仕事の振り分け、承認後の予約 |
| 企画部 | `.claude/agents/kikaku.md` | ネタ候補を根拠つきで出す。ネタ帳の管理 |
| 制作部 | `.claude/agents/seisaku.md` | スライドと本文を作り、下書きにする |
| 校閲・法務部 | `.claude/agents/kouetsu.md` | 事実・誇大表現・PR 表記・情報漏れを公開前にチェック |

- 数字と体験談は `content/facts.md`（社長が確認した事実）か素材ファイルにあるものだけを使う
- 公開の承認・返信の送信・実体験の中身は社長の仕事。AI に任せない
- Pro プランのため、集計はスクリプト（`npm run brief`・`npm run insights`）で行い、AI の使用量を抑える

## 実装の順序

1. ~~`src/client.js` — API ラッパ~~ 完了
2. ~~`scripts/whoami.js` — 疎通確認~~ 完了（2026-09-13 疎通 OK）
3. ~~`src/auth/refresh.js` — 長期トークンの更新~~ 完了（`npm run auth:refresh`）
4. 投稿系 — `scripts/post-next.js` 実装済み。DRY_RUN でのテストのみ済、実投稿は未実施
5. ~~インサイト取得~~ 完了（`npm run insights`。記録は `data/insights/`、Git に含めない）
