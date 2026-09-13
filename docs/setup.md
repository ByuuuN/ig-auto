# セットアップ手順（手作業パート）

ブラウザでの作業。Claude Code では代行できない部分。
詰まった箇所はこのファイルに追記していくこと（後で投稿ネタになる）。

## チェックリスト

- [x] 1. Instagram アカウントをプロアカウント（ビジネス）に切り替え
- [x] 2. Meta 開発者アカウントを作成（Facebook 個人アカウントが前提）
- [x] 3. アプリを作成（ユースケース: Instagramでメッセージとコンテンツを管理）
- [x] 4. 権限を追加（basic / content_publish / manage_comments / manage_insights）
- [x] 5. 役割タブで自分の IG アカウントを Instagram Tester に割り当て、Instagram 側で承認
- [x] 6. 「アカウントを追加」からアクセストークンを発行
- [x] 7. Instagram App ID / トークンを .env に記入
- [x] 8. whoami.js で疎通確認
- [x] 9. GitHub リポジトリを public で作成（画像の raw 配信用）

---

> **方式についての決定（2026-09-07）**
>
> トークンは **App Dashboard の「アカウントを追加」から直接発行**する。
> 自分のアカウント 1 つしか扱わないため、OAuth の認可フローは不要と判断した。
>
> これにより以下が**不要**になった:
> GitHub Pages の有効化 / リダイレクト URI の登録 / 認可 URL / `exchange.js`。
>
> ただし **GitHub リポジトリを public にすること自体は引き続き必要**。
> 画像を raw URL で配信するため（`image_url` は公開 URL でなければならない）。
>
> 他人のアカウントを扱う段階になったら OAuth フローを実装すること。
> 旧手順は git 履歴に残してある。

## 1. プロアカウントへの切り替え

Instagram アプリ → 設定 → アカウントの種類とツール → プロアカウントに切り替える
→ **ビジネス** を選択。

クリエイターでも大半は動くが、ストーリーズの API 投稿はビジネス限定。

## 2. 開発者登録

**前提: Facebook の個人アカウントが必要。**
CLAUDE.md の「Facebook ページの連携は不要」は API 仕様の話で、
developers.facebook.com へのログイン自体には Facebook アカウントが要る。
不要なのは Facebook *ページ*（ビジネスページ）であって、アカウントは別物。

1. **Facebook にログインした状態で** https://developers.facebook.com →「Get Started」
2. Platform Terms と Developer Policies に同意 →「Next」
3. **電話番号とメールアドレスの両方**に確認コードが届く（片方だけではない）
4. 職業を選択

## 3〜4. アプリ作成と Instagram の設定

アプリ作成時のユースケースは
**「Instagramでメッセージとコンテンツを管理」**、
ビジネスポートフォリオは**リンクしない**を選ぶ。
アプリ名に `Instagram` / `Facebook` / `Meta` を含めると弾かれる。

作成後、**左メニューに Instagram という項目は出ない**（現行 UI）。
ダッシュボードの
**「『Instagramでメッセージとコンテンツを管理』ユースケースをカスタマイズ」**
から入る。左メニューの「ビジネス向けFacebookログイン」は既定で付いてくるだけで、使わない。

### App ID を取り違えないこと

- **Meta アプリ ID** — ダッシュボードの URL に出ている数値。**使わない**
- **Instagram App ID** — Business login settings に表示される別の数値。
  `.env` の `IG_APP_ID` に入れるのは**こちら**

この 2 つの混同が、認可 URL が通らない最頻出の原因。

その先の Instagram の設定画面には次の 2 つが並んでいる。

- `API setup with Facebook login` ← **使わない**（ページ連携を要求される）
- `API setup with Instagram login` ← **こちらだけを使う**

App ID / App Secret / リダイレクト URI は、すべてこの下にある。

```
App Dashboard → Instagram → API setup with Instagram login
  → 3. Set up Instagram business login
    → Business login settings
```

ネット上の記事の多くは「プロダクトに Facebook Login を追加せよ」と書いているが、
これは旧方式の情報。この構成では不要。

控えるもの:

| 項目 | 値 |
| --- | --- |
| Instagram App ID | |
| Instagram App Secret | （.env にのみ記入。ここには書かない） |

## 5. GitHub Pages

- リポジトリを **public** で作成（画像の raw 配信に必要）
- Settings → Pages → Source を `main` / `/pages` に設定
- 公開 URL: `https://<username>.github.io/ig-auto/`

## 6. リダイレクト URI

Business login settings の OAuth redirect URI に、上の Pages の URL を登録。
**完全一致**でないと弾かれる（末尾スラッシュの有無も含む）。

## 8. 認可 URL

以下をブラウザで開いて承認する。`<...>` を置換すること。

```
https://www.instagram.com/oauth/authorize
  ?client_id=<IG_APP_ID>
  &redirect_uri=<IG_REDIRECT_URI>
  &response_type=code
  &scope=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments
```

承認後、リダイレクト先の URL に `?code=...` が付く。
pages/index.html がそれを画面に表示するので、コピーする。

**code は数分で失効する。** すぐに次の手順へ進むこと。
末尾に `#_` が付いている場合は取り除く。

## トラブル時の切り分け

| 症状 | 原因になりやすい点 |
| --- | --- |
| Invalid platform app | ホストが graph.facebook.com になっている |
| redirect_uri mismatch | 登録した URI と完全一致していない |
| Invalid scope | 旧スコープ名（business_basic 等）を使っている |
| code が使えない | 失効した / 末尾の `#_` が残っている |
| 画像が投稿できない | PNG を渡している / URL が非公開 |
| 60 日後に全部失敗する | トークンの refresh を忘れている |
| SMS が届かない | 国番号 +81 / 先頭の 0 を抜いた番号になっているか |
| 登録が「認証待ち」で進まない | メール側の認証が先。迷惑メールも確認する |
| 「この変更は今行えません」 | 普段使っていない端末での操作。常用の端末・ブラウザでやり直す |
| Business login settings が見当たらない | Facebook login 側の画面を開いている |
| 認可 URL が通らない | client_id に Meta アプリ ID を入れている（正しくは Instagram App ID） |

## メモ

- アプリの役割は、ユースケース画面では左メニューがアイコンのみに縮んでいて見つけにくい。
  `https://developers.facebook.com/apps/<Meta アプリ ID>/roles/roles/` を直接開くのが確実
- GitHub の新規作成画面で「何かがおかしくなりました！」と出ても、作成自体は成功していることがある。
  再度作成する前に `https://github.com/<user>/ig-auto` を開いて確認する
- テスター招待の承認は PC ブラウザの instagram.com → 設定 → アプリとウェブサイト で行う
- **ダッシュボードに表示される ID は `IG_USER_ID` に使えない。**
  `npm run whoami` が返す `user_id`（17841… で始まる 17 桁）を使う
