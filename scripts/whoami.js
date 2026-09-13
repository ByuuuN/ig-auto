// 疎通確認。読み取りのみで、アカウントには何も書き込まない。
import { get, config, mask } from '../src/client.js';

try {
  const { userId } = config();
  const me = await get('me', {
    fields: 'user_id,username,name,account_type,media_count',
  });

  console.log('疎通OK');
  console.log(`  username     : @${me.username}`);
  console.log(`  account_type : ${me.account_type}`);
  console.log(`  media_count  : ${me.media_count}`);
  console.log(`  user_id      : ${me.user_id}`);

  const exp = process.env.IG_TOKEN_EXPIRES_AT;
  if (exp) {
    const days = Math.floor((new Date(exp) - Date.now()) / 86400000);
    console.log(`  token 期限   : ${new Date(exp).toLocaleDateString('ja-JP')}（残り ${days} 日）`);
    if (days <= 14) console.warn(`\n注意: トークンの期限が近いです。npm run auth:refresh を実行してください。`);
  }

  if (me.account_type !== 'BUSINESS') {
    console.warn(`\n注意: account_type が ${me.account_type} です。ストーリーズの API 投稿はビジネス限定。`);
  }
  if (userId && userId !== String(me.user_id) && userId !== String(me.id)) {
    console.warn(`\n注意: .env の IG_USER_ID と API の user_id が一致しません。API の値に差し替えてください。`);
  }
} catch (err) {
  console.error('疎通失敗:', mask(err.message));
  process.exit(1);
}
