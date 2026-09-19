/**
 * 予約投稿の「時計役」。Google Apps Script で動かす。
 *
 * GitHub Actions の予約実行（schedule）は数時間遅れることがあるため、
 * 5 分おきにキューを確認し、予定時刻を過ぎた投稿があれば
 * workflow_dispatch で post ワークフローを起動する。
 * 実際の投稿・二重投稿の防止は GitHub Actions 側（scripts/post-next.js）が行う。
 *
 * 準備（docs/setup.md の「予約投稿の時計役」を参照）:
 *   1. このコードを Apps Script のプロジェクトに貼る
 *   2. スクリプト プロパティ GITHUB_TOKEN に GitHub のトークンを登録する
 *   3. setup() を 1 回実行する（5 分おきのトリガーが作られる）
 *   4. testDryRun() で起動できるか確かめる（投稿はしない）
 */

const OWNER = 'ByuuuN';
const REPO = 'ig-auto';
const WORKFLOW = 'post.yml';
const QUEUE_PATH = 'content/queue';

function tick() {
  const due = findDueItem_();
  if (!due) return;

  if (hasActiveRun_()) {
    console.log('実行中のワークフローがあるため、今回は起動しません');
    return;
  }
  dispatch_('false');
  console.log('起動しました: ' + due);
}

/** 投稿はせず、ワークフローを起動できるかだけ確かめる */
function testDryRun() {
  dispatch_('true');
  console.log('DRY_RUN で起動しました。GitHub の Actions タブで結果を確認してください');
}

/** 5 分おきのトリガーを作り直す */
function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  console.log('5 分おきのトリガーを作成しました');
}

/** トリガーを止める（予約投稿を止めたいとき） */
function stop() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('トリガーを削除しました');
}

function findDueItem_() {
  const now = new Date();
  const files = api_('GET', `/repos/${OWNER}/${REPO}/contents/${QUEUE_PATH}?ref=main`);
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue;
    const raw = api_('GET', `/repos/${OWNER}/${REPO}/contents/${QUEUE_PATH}/${encodeURIComponent(f.name)}?ref=main`,
      null, 'application/vnd.github.raw+json');
    let item;
    try {
      item = JSON.parse(raw);
    } catch (e) {
      console.warn(f.name + ' を読めませんでした');
      continue;
    }
    if (item.status !== 'ready') continue;
    if (!item.scheduled_for || new Date(item.scheduled_for) <= now) return f.name;
  }
  return null;
}

function hasActiveRun_() {
  const res = api_('GET', `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`);
  return (res.workflow_runs || []).some((r) => r.status !== 'completed');
}

function dispatch_(dryRun) {
  api_('POST', `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    { ref: 'main', inputs: { dry_run: dryRun } });
}

function api_(method, path, body, accept) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('スクリプト プロパティ GITHUB_TOKEN が設定されていません');
  const res = UrlFetchApp.fetch('https://api.github.com' + path, {
    method: method.toLowerCase(),
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    contentType: body ? 'application/json' : undefined,
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  // エラー時もトークンは出力しない（本文だけを出す）
  if (code >= 300) throw new Error(`GitHub API ${method} ${path.split('?')[0]} → HTTP ${code}: ${res.getContentText().slice(0, 200)}`);
  const text = res.getContentText();
  if (!text) return null;
  return accept && accept.includes('raw') ? text : JSON.parse(text);
}
