// インサイトを記録する（読み取りのみ）。記録は data/insights/ に保存し、Git には含めない。
//
//   npm run insights
//
// - account.csv  : 実行ごとに 1 行。フォロワー数と直近 7 日の合計
// - posts.csv    : 実行ごとに投稿の数だけ行を追加。投稿ごとの伸びを追える
// - demographics/: フォロワーの年齢・性別・地域（実行日ごとの JSON）
// Excel で開けるよう、CSV は BOM 付き UTF-8 で書く。
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { mask } from '../src/client.js';
import { accountSnapshot, accountTotals, recentPosts, demographics } from '../src/insights/collect.js';

const DIR = process.env.INSIGHTS_DIR || 'data/insights';
const ACCOUNT_CSV = join(DIR, 'account.csv');
const POSTS_CSV = join(DIR, 'posts.csv');

const ACCOUNT_COLS = ['recorded_at', 'followers', 'following', 'posts',
  'reach_7d', 'views_7d', 'profile_views_7d', 'accounts_engaged_7d', 'interactions_7d', 'website_clicks_7d', 'new_follows_7d'];
const POST_COLS = ['recorded_at', 'posted_at', 'title', 'type', 'reach', 'views', 'likes', 'comments',
  'saved', 'shares', 'total_interactions', 'profile_visits', 'follows', 'permalink', 'id'];

const jst = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function appendCsv(file, cols, rows) {
  if (!existsSync(file)) writeFileSync(file, '﻿' + cols.join(',') + '\n');
  appendFileSync(file, rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\n') + '\n');
}

// 前回の記録（CSV の最終行）
function lastRow(file, cols) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split('\n');
  if (lines.length < 2) return null;
  const vals = lines[lines.length - 1].split(',');
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
}

const diff = (now, prev) => {
  if (prev === undefined || prev === '' || now === null || now === undefined) return '';
  const d = Number(now) - Number(prev);
  return d === 0 ? '（±0）' : `（${d > 0 ? '+' : ''}${d}）`;
};

async function main() {
  mkdirSync(join(DIR, 'demographics'), { recursive: true });
  const recordedAt = jst(new Date());

  const [snap, totals, posts, demo] = await Promise.all([accountSnapshot(), accountTotals(7), recentPosts(), demographics()]);
  const prev = lastRow(ACCOUNT_CSV, ACCOUNT_COLS);

  const account = {
    recorded_at: recordedAt,
    ...snap,
    reach_7d: totals.reach,
    views_7d: totals.views,
    profile_views_7d: totals.profile_views,
    accounts_engaged_7d: totals.accounts_engaged,
    interactions_7d: totals.total_interactions,
    website_clicks_7d: totals.website_clicks,
    new_follows_7d: totals.new_follows,
  };
  appendCsv(ACCOUNT_CSV, ACCOUNT_COLS, [account]);
  appendCsv(POSTS_CSV, POST_COLS, posts.map((p) => ({ ...p, recorded_at: recordedAt, posted_at: jst(p.posted_at) })));
  writeFileSync(join(DIR, 'demographics', `${recordedAt.slice(0, 10)}.json`), JSON.stringify(demo, null, 2) + '\n');

  console.log(`記録しました（${recordedAt}）→ ${DIR}/`);
  if (prev) console.log(`前回の記録: ${prev.recorded_at}`);
  console.log('');
  console.log(`フォロワー     ${account.followers}${diff(account.followers, prev?.followers)}`);
  console.log(`フォロー中     ${account.following}${diff(account.following, prev?.following)}`);
  console.log(`投稿数         ${account.posts}`);
  console.log(`直近7日 リーチ ${account.reach_7d} / 表示 ${account.views_7d} / プロフィール閲覧 ${account.profile_views_7d} / 新規フォロー ${account.new_follows_7d}`);
  console.log('');
  console.log('投稿ごと（新しい順）');
  for (const p of posts) {
    const rate = p.reach ? ` 保存率 ${((p.saved / p.reach) * 100).toFixed(1)}%` : '';
    console.log(`  ${jst(p.posted_at)}  リーチ ${p.reach ?? '-'} / 保存 ${p.saved ?? '-'} / いいね ${p.likes} / コメント ${p.comments} / フォロー ${p.follows ?? '-'}${rate}`);
    console.log(`    ${p.title}`);
  }
}

try {
  await main();
} catch (err) {
  console.error('失敗:', mask(err.message));
  process.exitCode = 1;
}
