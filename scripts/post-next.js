// キューから次の 1 件を投稿する。1 回の実行で投稿は最大 1 件。
//
//   npm run post            DRY_RUN=true なら内容の表示とチェックだけ
//   npm run post -- --yes   確認プロンプトを省略（Actions など対話できない環境用）
//   --ignore-schedule       予定時刻前でも対象にする（DRY_RUN のときだけ有効。事前チェック用）
//
// 実際に投稿するには .env（または Actions の env）で DRY_RUN=false にする。
import { createInterface } from 'node:readline/promises';
import { config, mask } from '../src/client.js';
import {
  loadQueue,
  pickNext,
  validate,
  buildCaption,
  imageUrl,
  checkReachable,
  markPublished,
  markError,
} from '../src/publish/queue.js';
import {
  publishingLimit,
  createImageContainer,
  createCarouselContainer,
  createReelContainer,
  waitUntilReady,
  publishContainer,
  findPublishedWithCaption,
} from '../src/publish/instagram.js';

async function confirm(question) {
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) {
    console.error('対話できない環境です。投稿するなら --yes を付けて実行してください。');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

async function checkLimit() {
  let limit;
  try {
    limit = await publishingLimit();
  } catch (err) {
    console.warn(`上限   : 取得できませんでした（${mask(err.message)}）`);
    return;
  }
  if (limit.used === null) return;
  console.log(`上限   : 直近 24 時間で ${limit.used} / ${limit.max ?? '?'} 件`);
  if (limit.max !== null && limit.used >= limit.max) throw new Error('投稿上限に達しています');
}

async function main() {
  let next = null;
  let dryRun = true;
  try {
    dryRun = config().dryRun;
    const ignoreSchedule = dryRun && process.argv.includes('--ignore-schedule');
    next = pickNext(loadQueue(), ignoreSchedule ? new Date(8.64e15) : new Date());
    if (!next) {
      console.log('投稿対象がありません（status が ready で、予定時刻を過ぎたものが無い）');
      return 0;
    }

    const { item } = next;
    const caption = buildCaption(item);
    const urls = item.type === 'reel' ? [imageUrl(item.video)] : (item.images || []).map(imageUrl);

    console.log(`対象   : ${next.file}（id ${item.id} / ${item.type}）`);
    console.log(item.type === 'reel' ? '動画   :' : `画像   : ${urls.length} 枚`);
    urls.forEach((u) => console.log(`  - ${u}`));
    console.log('本文   :');
    console.log(caption.split('\n').map((l) => `  | ${l}`).join('\n'));

    const errors = validate(item);
    for (const u of urls) {
      const problem = await checkReachable(u);
      if (problem) errors.push(problem);
    }
    if (errors.length) {
      console.error('\n投稿できません:');
      errors.forEach((e) => console.error(`  - ${e}`));
      if (!dryRun) markError(next, errors.join(' / '));
      return 1;
    }

    await checkLimit();

    // 前回の実行で公開済みなのに、キューの更新（commit）だけ失敗していた場合に備える
    const existingId = await findPublishedWithCaption(caption);
    if (existingId) {
      console.log(`\n同じ本文の投稿がすでにあります（media_id ${existingId}）。投稿しません。`);
      if (!dryRun) console.log(`キューを投稿済みにしました → ${markPublished(next, existingId)}`);
      return 0;
    }

    if (dryRun) {
      console.log('\nDRY_RUN=true のため投稿していません。チェックはすべて通りました。');
      return 0;
    }

    if (!(await confirm('\nこの内容で Instagram に公開します。よろしいですか？ [y/N] '))) {
      console.log('中止しました');
      return 0;
    }

    let containerId;
    if (item.type === 'image') {
      containerId = await createImageContainer(urls[0], { caption });
    } else if (item.type === 'reel') {
      containerId = await createReelContainer(urls[0], caption);
    } else {
      const children = [];
      for (const u of urls) children.push(await createImageContainer(u, { carouselItem: true }));
      for (const id of children) await waitUntilReady(id);
      containerId = await createCarouselContainer(children, caption);
    }
    // 動画は Instagram 側の変換に時間がかかる（最大 5 分待つ）
    await waitUntilReady(containerId, item.type === 'reel' ? { tries: 60, intervalMs: 5000 } : {});

    const mediaId = await publishContainer(containerId);
    const dest = markPublished(next, mediaId);
    console.log(`\n公開しました（media_id ${mediaId}）→ ${dest}`);
  } catch (err) {
    console.error('失敗:', mask(err.message));
    // 本番で失敗したら、その投稿を error にして再挑戦を止める（5 分おきに失敗し続けないように）
    if (next && !dryRun) {
      markError(next, mask(err.message));
      console.error(`${next.item.id} を status=error にしました。原因を直してから ready に戻してください。`);
    }
    return 1;
  }
  return 0;
}

// process.exit() は Windows で通信の後始末と競合して落ちるため、exitCode で終了する
process.exitCode = await main();
