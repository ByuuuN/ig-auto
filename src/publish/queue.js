// 投稿キュー（content/queue/*.json）の読み込みと投稿前チェック。
//
// status の流れ: draft → ready → published
//   draft     下書き。投稿対象にならない
//   ready     投稿してよい。scheduled_for が null か過去なら対象
//   published 投稿済み（content/published/ に移動される）
//   error     投稿に失敗した。自動では再挑戦しない。原因を直してから ready に戻す
import { readdirSync, readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';

export const QUEUE_DIR = process.env.QUEUE_DIR || 'content/queue';
export const PUBLISHED_DIR = process.env.PUBLISHED_DIR || 'content/published';
export const ASSETS_DIR = process.env.ASSETS_DIR || 'content/assets';

const CAPTION_MAX = 2200;
const HASHTAG_MAX = 30;
const CAROUSEL_MAX = 10;
const RATIO_MIN = 4 / 5; // 縦長の限界
const RATIO_MAX = 1.91; // 横長の限界
const VIDEO_MAX_MB = 95; // GitHub の 1 ファイル上限（100MB）より少し小さく
const REEL_MIN_SEC = 3;
const REEL_MAX_SEC = 15 * 60;

export function loadQueue() {
  if (!existsSync(QUEUE_DIR)) return [];
  return readdirSync(QUEUE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = join(QUEUE_DIR, f);
      return { file, item: JSON.parse(readFileSync(file, 'utf8')) };
    });
}

export function pickNext(entries, now = new Date()) {
  const ready = entries
    .filter(({ item }) => item.status === 'ready')
    .filter(({ item }) => !item.scheduled_for || new Date(item.scheduled_for) <= now);
  ready.sort(
    (a, b) =>
      String(a.item.scheduled_for || '').localeCompare(String(b.item.scheduled_for || '')) ||
      String(a.item.id).localeCompare(String(b.item.id))
  );
  return ready[0] || null;
}

export function buildCaption(item) {
  const tags = (item.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`));
  return [item.caption || '', tags.join(' ')].filter(Boolean).join('\n\n');
}

// JPEG のヘッダから幅・高さを読む（依存を増やさないため自前で解析）
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// ffprobe があれば長さを調べる（GitHub Actions など無い環境では null）
function videoSeconds(path) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
    return Number(out.trim());
  } catch {
    return null;
  }
}

function validateVideo(name) {
  if (!name) return ['type=reel には video（動画のファイル名）が必要です'];
  if (extname(name).toLowerCase() !== '.mp4') return [`${name}: MP4 にしてください`];
  const path = join(ASSETS_DIR, name);
  if (!existsSync(path)) return [`${name}: ${ASSETS_DIR} にありません`];
  const errors = [];
  const mb = statSync(path).size / 1024 / 1024;
  if (mb > VIDEO_MAX_MB) errors.push(`${name}: ${mb.toFixed(0)}MB は大きすぎます（${VIDEO_MAX_MB}MB まで）`);
  const sec = videoSeconds(path);
  if (sec !== null && (sec < REEL_MIN_SEC || sec > REEL_MAX_SEC)) errors.push(`${name}: 長さ ${sec.toFixed(1)} 秒は範囲外です（3 秒〜15 分）`);
  return errors;
}

// 問題の一覧を返す。空なら投稿可能
export function validate(item) {
  const errors = [];
  const images = item.images || [];

  if (!['image', 'carousel', 'reel'].includes(item.type)) errors.push(`未対応の type です: ${item.type}`);
  if (item.type === 'reel') errors.push(...validateVideo(item.video));
  if (item.type === 'image' && images.length !== 1) errors.push('type=image は画像 1 枚にしてください');
  if (item.type === 'carousel' && (images.length < 2 || images.length > CAROUSEL_MAX)) {
    errors.push(`type=carousel は画像 2〜${CAROUSEL_MAX} 枚にしてください（現在 ${images.length} 枚）`);
  }

  for (const name of item.type === 'reel' ? [] : images) {
    if (!['.jpg', '.jpeg'].includes(extname(name).toLowerCase())) {
      errors.push(`${name}: JPEG（.jpg）にしてください`);
      continue;
    }
    const path = join(ASSETS_DIR, name);
    if (!existsSync(path)) {
      errors.push(`${name}: ${ASSETS_DIR} にありません`);
      continue;
    }
    const size = jpegSize(readFileSync(path));
    if (!size) {
      errors.push(`${name}: 中身が JPEG ではありません（拡張子だけ変えた PNG など）`);
      continue;
    }
    const ratio = size.width / size.height;
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
      errors.push(`${name}: 縦横比 ${size.width}x${size.height} は範囲外です（4:5 〜 1.91:1）`);
    }
  }

  const caption = buildCaption(item);
  if ([...caption].length > CAPTION_MAX) errors.push(`キャプションが ${CAPTION_MAX} 文字を超えています`);
  if ((caption.match(/#[^\s#]+/g) || []).length > HASHTAG_MAX) {
    errors.push(`ハッシュタグは ${HASHTAG_MAX} 個までです`);
  }

  return errors;
}

export function imageUrl(name) {
  const base = process.env.ASSET_BASE_URL;
  if (!base || base.includes('<')) throw new Error('ASSET_BASE_URL が設定されていません（.env を確認）');
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
}

// Instagram は公開 URL から画像を取りに来る。push し忘れをここで検出する
export async function checkReachable(url) {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) return `${url} → HTTP ${res.status}（画像を push しましたか？）`;
  return null;
}

// 公開リポジトリに残すので、ID のような長い数字と URL のパスは伏せる
export function sanitizeError(message) {
  return String(message)
    .replace(/(GET|POST) \/\S+/g, '$1 (API)')
    .replace(/\d{10,}/g, '***')
    .slice(0, 300);
}

export function markError({ file, item }, message) {
  const failed = { ...item, status: 'error', last_error: sanitizeError(message), last_error_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(failed, null, 2) + '\n');
}

export function markPublished({ file, item }, mediaId) {
  mkdirSync(PUBLISHED_DIR, { recursive: true });
  const done = { ...item, status: 'published', media_id: mediaId, published_at: new Date().toISOString() };
  const dest = join(PUBLISHED_DIR, basename(file));
  writeFileSync(file, JSON.stringify(done, null, 2) + '\n');
  renameSync(file, dest);
  return dest;
}
