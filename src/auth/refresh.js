// 長期トークン（60 日）を更新し、.env を書き換える。
// - 発行から 24 時間以上経ったトークンでないと更新できない
// - 失効したトークンは更新できない。その場合はダッシュボードで再発行する
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { config, mask } from '../client.js';

const ENV_PATH = '.env';

async function refresh(token) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) {
    const e = data.error || {};
    throw new Error(`HTTP ${res.status}: ${e.message || res.statusText}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return data; // { access_token, token_type, expires_in }
}

function setEnv(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

try {
  const { token } = config();
  const data = await refresh(token);
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  const days = Math.floor(data.expires_in / 86400);

  if (!existsSync(ENV_PATH)) {
    // Actions など .env が無い環境。値は出力しない
    console.log(`更新OK（有効期限 ${days} 日）。.env が無いため保存していません。`);
  } else {
    let env = readFileSync(ENV_PATH, 'utf8');
    env = setEnv(env, 'IG_ACCESS_TOKEN', data.access_token);
    env = setEnv(env, 'IG_TOKEN_EXPIRES_AT', expiresAt.toISOString());
    writeFileSync(`${ENV_PATH}.tmp`, env);
    renameSync(`${ENV_PATH}.tmp`, ENV_PATH);

    console.log('トークンを更新しました');
    console.log(`  有効期限: ${expiresAt.toLocaleString('ja-JP')}（${days} 日後）`);
  }
} catch (err) {
  console.error('更新失敗:', mask(err.message));
  process.exitCode = 1;
}
