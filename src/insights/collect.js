// アカウントと投稿のインサイトを取得する（読み取りのみ）。
import { get, config } from '../client.js';

const POST_METRICS = ['reach', 'views', 'saved', 'shares', 'total_interactions', 'profile_visits', 'follows'];
const ACCOUNT_METRICS = ['reach', 'views', 'profile_views', 'accounts_engaged', 'total_interactions', 'website_clicks'];

const unix = (d) => String(Math.floor(d.getTime() / 1000));

export async function accountSnapshot() {
  const me = await get('me', { fields: 'followers_count,follows_count,media_count' });
  return { followers: me.followers_count, following: me.follows_count, posts: me.media_count };
}

// 直近 days 日の合計値
export async function accountTotals(days = 7, now = new Date()) {
  const { userId } = config();
  const since = new Date(now.getTime() - days * 86400000);
  const params = { period: 'day', since: unix(since), until: unix(now) };

  const totals = {};
  const res = await get(`${userId}/insights`, { ...params, metric: ACCOUNT_METRICS.join(','), metric_type: 'total_value' });
  for (const d of res.data || []) totals[d.name] = d.total_value?.value ?? null;

  // 新規フォロー数（日ごとの値を合計する）
  const fc = await get(`${userId}/insights`, { ...params, metric: 'follower_count' });
  totals.new_follows = (fc.data?.[0]?.values || []).reduce((sum, v) => sum + (v.value || 0), 0);
  return totals;
}

export async function recentPosts(limit = 25) {
  const res = await get('me/media', {
    fields: 'id,timestamp,media_type,permalink,caption,like_count,comments_count',
    limit: String(limit),
  });
  const posts = [];
  for (const m of res.data || []) {
    const metrics = {};
    try {
      const ins = await get(`${m.id}/insights`, { metric: POST_METRICS.join(',') });
      for (const d of ins.data || []) metrics[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null;
    } catch {
      // 投稿直後など、インサイトがまだ無いことがある
    }
    posts.push({
      id: m.id,
      posted_at: m.timestamp,
      type: m.media_type,
      title: (m.caption || '').split('\n')[0].slice(0, 40),
      permalink: m.permalink,
      likes: m.like_count ?? null,
      comments: m.comments_count ?? null,
      ...metrics,
    });
  }
  return posts;
}

export async function demographics() {
  const { userId } = config();
  const out = {};
  for (const breakdown of ['age', 'gender', 'city']) {
    const res = await get(`${userId}/insights`, {
      metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown,
    });
    const rows = res.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
    out[breakdown] = Object.fromEntries(
      rows.sort((a, b) => b.value - a.value).map((r) => [r.dimension_values[0], r.value]),
    );
  }
  return out;
}
