// 秘書室の朝の報告用に、事実だけを集める（読み取りのみ・AI は使わない）。
//
//   npm run brief
//
// 予約の状況、直近の投稿の数字、トークンの期限、自動投稿の仕組みの状態、ネタ帳の残りを出す。
// 秘書（Claude）はこの出力をもとに「社長へのお願い」をまとめる。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mask } from '../src/client.js';
import { loadQueue } from '../src/publish/queue.js';
import { accountSnapshot, recentPosts } from '../src/insights/collect.js';

const REPO = 'ByuuuN/ig-auto';
const jst = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
const daysUntil = (d) => Math.floor((new Date(d) - Date.now()) / 86400000);

function section(title) {
  console.log(`\n## ${title}`);
}

function queueStatus() {
  section('予約・下書き');
  const items = loadQueue().map((e) => e.item).filter((i) => i.id !== '0001');
  const ready = items.filter((i) => i.status === 'ready')
    .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
  const drafts = items.filter((i) => i.status === 'draft');
  for (const i of items.filter((x) => x.status === 'error')) {
    console.log(`- **投稿に失敗して止まっている**: ${i.id}（${jst(i.last_error_at)}）${i.last_error}`);
  }
  if (!ready.length) console.log('- 予約済みの投稿: なし');
  for (const i of ready) console.log(`- 予約済み: ${i.id}（${i.scheduled_for ? jst(i.scheduled_for) : '即時'}）`);
  for (const i of drafts) console.log(`- 下書き: ${i.id}`);

  const pubDir = 'content/published';
  const published = existsSync(pubDir)
    ? readdirSync(pubDir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(pubDir, f), 'utf8')))
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    : [];
  if (published[0]) {
    const last = published[0];
    console.log(`- 最後の投稿: ${last.id}（${jst(last.published_at)}、${Math.floor((Date.now() - new Date(last.published_at)) / 86400000)} 日前）`);
  }
}

async function numbers() {
  section('数字');
  const snap = await accountSnapshot();
  console.log(`- フォロワー ${snap.followers} / フォロー中 ${snap.following} / 投稿 ${snap.posts}`);

  const csv = 'data/insights/account.csv';
  if (existsSync(csv)) {
    const lines = readFileSync(csv, 'utf8').replace(/^﻿/, '').trim().split('\n');
    const last = lines[lines.length - 1].split(',');
    if (lines.length > 1) console.log(`- 前回の記録（${last[0]}）からのフォロワー増減: ${snap.followers - Number(last[1])}`);
  }

  const posts = await recentPosts(3);
  for (const p of posts) {
    console.log(`- ${jst(p.posted_at)} ${p.title.slice(0, 24)}… リーチ ${p.reach ?? '-'} / 保存 ${p.saved ?? '-'} / いいね ${p.likes} / コメント ${p.comments}`);
  }
}

function expiries() {
  section('期限');
  const ig = process.env.IG_TOKEN_EXPIRES_AT;
  const pat = process.env.GITHUB_PAT_EXPIRES_AT;
  if (ig) console.log(`- Instagram トークン: ${jst(ig)}（残り ${daysUntil(ig)} 日）`);
  else console.log('- Instagram トークン: 期限が .env に記録されていない');
  if (pat) console.log(`- 時計役の GitHub トークン: ${pat.slice(0, 10)}（残り ${daysUntil(pat)} 日）`);
}

async function pipelineHealth() {
  section('自動投稿の仕組み');
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=10`);
  if (!res.ok) {
    console.log(`- GitHub Actions の状態を取得できなかった（HTTP ${res.status}）`);
    return;
  }
  const runs = (await res.json()).workflow_runs || [];
  const recent = runs.filter((r) => Date.now() - new Date(r.created_at) < 3 * 86400000);
  const failed = recent.filter((r) => r.conclusion && r.conclusion !== 'success');
  console.log(`- 直近 3 日の実行: ${recent.length} 回（失敗 ${failed.length} 回）`);
  for (const r of failed) console.log(`  - 失敗: ${jst(r.created_at)} ${r.event} ${r.html_url}`);
}

function ideas() {
  section('ネタ帳');
  const file = 'content/ideas.md';
  if (!existsSync(file)) {
    console.log('- ネタ帳がない');
    return;
  }
  const text = readFileSync(file, 'utf8');
  const open = (text.match(/^- \[ \]/gm) || []).length;
  const done = (text.match(/^- \[x\]/gim) || []).length;
  console.log(`- 未着手 ${open} 件 / 済み ${done} 件`);
}

console.log(`# 朝の報告の材料（${jst(new Date())} 時点）`);
queueStatus();
for (const [name, fn] of [['数字', numbers], ['仕組み', pipelineHealth]]) {
  try {
    await fn();
  } catch (err) {
    console.log(`- ${name}を取得できなかった: ${mask(err.message)}`);
  }
}
expiries();
ideas();
