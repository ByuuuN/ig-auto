// graph.instagram.com の薄いラッパ。
// 依存を増やさないため fetch（Node 20+ 標準）と process.loadEnvFile を使う。

try {
  process.loadEnvFile();
} catch {
  // .env が無い環境（GitHub Actions など）では環境変数を直接使う
}

const HOST = 'https://graph.instagram.com';

export function config() {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) throw new Error('IG_ACCESS_TOKEN が設定されていません（.env を確認）');
  return {
    token,
    userId: process.env.IG_USER_ID || null,
    version: process.env.IG_API_VERSION || 'v23.0',
    dryRun: process.env.DRY_RUN !== 'false',
  };
}

// ログやエラーにトークンが出ないようにする
export function mask(text) {
  const token = process.env.IG_ACCESS_TOKEN;
  let out = String(text);
  if (token) out = out.split(token).join('***');
  return out.replace(/access_token=[^&\s"]+/g, 'access_token=***');
}

async function request(method, path, params = {}) {
  const { token, version } = config();
  const url = new URL(`${HOST}/${version}/${path.replace(/^\//, '')}`);
  const body = new URLSearchParams({ ...params, access_token: token });

  let res;
  if (method === 'GET') {
    url.search = body.toString();
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    const err = new Error(
      mask(`${method} /${path} → HTTP ${res.status}: ${e.message || res.statusText}` +
        (e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : ''))
    );
    err.status = res.status;
    err.code = e.code;
    throw err;
  }
  return data;
}

export const get = (path, params) => request('GET', path, params);
export const post = (path, params) => request('POST', path, params);
