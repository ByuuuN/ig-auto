// 投稿 API。コンテナ作成 → 準備完了を待つ → media_publish の 2 段階。
// media_publish はこのファイルの publishContainer からしか呼ばないこと。
import { get, post, config } from '../client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function userPath(suffix) {
  const { userId } = config();
  if (!userId) throw new Error('IG_USER_ID が設定されていません（npm run whoami で確認）');
  return `${userId}/${suffix}`;
}

// 直近 24 時間の投稿数と上限
export async function publishingLimit() {
  const res = await get(userPath('content_publishing_limit'), { fields: 'quota_usage,config' });
  const row = res.data?.[0] || {};
  return { used: row.quota_usage ?? null, max: row.config?.quota_total ?? null };
}

// 同じ本文の投稿が直近にあれば、その media_id を返す（再実行による二重投稿の防止）
export async function findPublishedWithCaption(caption, { limit = 10 } = {}) {
  const res = await get(userPath('media'), { fields: 'id,caption', limit: String(limit) });
  const norm = (t) => String(t || '').replace(/\r\n/g, '\n').trim();
  const hit = (res.data || []).find((m) => norm(m.caption) === norm(caption));
  return hit ? hit.id : null;
}

export async function createImageContainer(imageUrl, { caption, carouselItem = false } = {}) {
  const params = { image_url: imageUrl };
  if (carouselItem) params.is_carousel_item = 'true';
  else if (caption) params.caption = caption;
  return (await post(userPath('media'), params)).id;
}

// リール。thumb_offset はカバーに使う位置（ミリ秒）
export async function createReelContainer(videoUrl, caption, { thumbOffsetMs = 1000 } = {}) {
  const params = { media_type: 'REELS', video_url: videoUrl, share_to_feed: 'true', thumb_offset: String(thumbOffsetMs) };
  if (caption) params.caption = caption;
  return (await post(userPath('media'), params)).id;
}

export async function createCarouselContainer(childIds, caption) {
  const params = { media_type: 'CAROUSEL', children: childIds.join(',') };
  if (caption) params.caption = caption;
  return (await post(userPath('media'), params)).id;
}

// コンテナが FINISHED になるまで待つ。画像なら通常は数秒、動画は数十秒〜数分
export async function waitUntilReady(containerId, { tries = 10, intervalMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const { status_code: status } = await get(containerId, { fields: 'status_code' });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`コンテナ ${containerId} が ${status} になりました`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`コンテナ ${containerId} が時間内に準備完了になりませんでした`);
}

export async function publishContainer(containerId) {
  return (await post(userPath('media_publish'), { creation_id: containerId })).id;
}
