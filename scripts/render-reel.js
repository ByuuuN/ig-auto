// スライド画像 + VOICEVOX のナレーション + 字幕から、リール用の縦長動画（1080x1920）を作る。
// Windows のローカル専用。VOICEVOX を起動しておくこと（エンジンが 127.0.0.1:50021 で動く）。
//
//   node scripts/render-reel.js 001-autoscribe
//
// 入力: content/reels/<name>/script.json（台本）と content/assets/<slides>-NN.jpg（スライド画像）
// 出力: content/assets/<id>.mp4
//
// 1 シーン = スライド 1 枚。シーンの中でゆっくりズームし、字幕はナレーションの 1 文ごとに切り替える。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = 1080;
const H = 1920;
const FPS = 30;
const GAP = 0.25; // 文と文のあいだの間（秒）
const TAIL = 0.35; // シーンの最後の間（秒）
const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

const name = process.argv[2];
if (!name) {
  console.error('使い方: node scripts/render-reel.js <content/reels のフォルダ名>');
  process.exit(1);
}
const dir = resolve('content/reels', name);
const script = JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'reel-'));

// ---------- 音声 ----------

async function tts(text) {
  const q = await fetch(`${ENGINE}/audio_query?${new URLSearchParams({ text, speaker: script.speaker })}`, { method: 'POST' });
  if (!q.ok) throw new Error(`VOICEVOX audio_query → HTTP ${q.status}（VOICEVOX は起動していますか？）`);
  const query = await q.json();
  query.speedScale = script.speed ?? 1.1;
  query.prePhonemeLength = 0.05;
  query.postPhonemeLength = 0.1;
  const s = await fetch(`${ENGINE}/synthesis?speaker=${script.speaker}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`VOICEVOX synthesis → HTTP ${s.status}`);
  return Buffer.from(await s.arrayBuffer());
}

// WAV を「形式」と「PCM データ」に分ける（VOICEVOX は 16bit PCM）
function parseWav(buf) {
  let p = 12;
  let fmt = null;
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12) };
    if (id === 'data') return { ...fmt, pcm: buf.subarray(p + 8, p + 8 + size) };
    p += 8 + size;
  }
  throw new Error('WAV の data が見つかりません');
}

function writeWav(file, { channels, rate }, pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([h, pcm]));
}

const silence = (fmt, sec) => Buffer.alloc(Math.round(sec * fmt.rate) * fmt.channels * 2);
const seconds = (fmt, pcm) => pcm.length / (fmt.rate * fmt.channels * 2);

// ---------- 画像 ----------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function framesHtml(frames) {
  const slideUrl = (n) => pathToFileURL(resolve('content/assets', `${script.slides}-${String(n).padStart(2, '0')}.jpg`)).href;
  const body = frames.map((f) => f.kind === 'base'
    ? `<section class="f base"><div class="credit">VOICEVOX:${esc(script.speaker_name)}</div><img src="${slideUrl(f.slide)}"></section>`
    : `<section class="f sub"><div class="band">${esc(f.text)}</div></section>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: transparent; }
    .f { width: ${W}px; height: ${H}px; position: relative; display: none; font-family: "Noto Sans JP", "Yu Gothic UI", sans-serif; }
    .f.on { display: block; }
    .base { background: #f6f3ec; }
    .credit { position: absolute; right: 64px; top: 236px; font-size: 26px; font-weight: 700; color: #8a8f99; }
    .base img { position: absolute; left: 90px; top: 540px; width: 900px; border-radius: 28px;
      box-shadow: 0 16px 48px rgba(27,30,36,.16); }
    .sub .band { position: absolute; left: 60px; right: 60px; top: 300px; min-height: 250px; white-space: pre-line;
      display: flex; align-items: center; justify-content: center; text-align: center;
      padding: 28px 44px; border-radius: 28px; background: #1b1e24; color: #fff;
      font-size: 58px; font-weight: 900; line-height: 1.45; letter-spacing: .01em; }
  </style>${body}<script>
    const n = Number(new URLSearchParams(location.search).get('n'));
    document.querySelectorAll('.f')[n - 1].classList.add('on');
  </script>`;
}

function shoot(html, n, out, transparent) {
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, `--user-data-dir=${join(work, 'profile')}`, '--allow-file-access-from-files',
    '--virtual-time-budget=3000', `--screenshot=${out}`];
  if (transparent) args.push('--default-background-color=00000000');
  execFileSync(CHROME, [...args, `${pathToFileURL(html).href}?n=${n}`], { stdio: 'ignore' });
  if (!existsSync(out)) throw new Error(`画像の書き出しに失敗: ${out}`);
}

// ---------- 組み立て ----------

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

async function main() {
  // 1. フレームの一覧（シーンごとに土台 1 枚 + 字幕 n 枚）
  const frames = [];
  for (const scene of script.scenes) {
    scene.base = frames.push({ kind: 'base', slide: scene.slide });
    for (const line of scene.lines) line.frame = frames.push({ kind: 'sub', text: line.text });
  }
  const html = join(work, 'frames.html');
  writeFileSync(html, framesHtml(frames));
  frames.forEach((f, i) => shoot(html, i + 1, join(work, `f${i + 1}.png`), f.kind === 'sub'));
  console.log(`画像 ${frames.length} 枚を書き出しました`);

  // 2. 音声とシーンごとの動画
  const list = [];
  let total = 0;
  for (const [si, scene] of script.scenes.entries()) {
    let fmt = null;
    const parts = [];
    const cues = [];
    let t = 0;
    for (const [li, line] of scene.lines.entries()) {
      const wav = parseWav(await tts(line.yomi || line.text.split('\n').join('')));
      fmt = wav;
      const dur = seconds(fmt, wav.pcm);
      const gap = li < scene.lines.length - 1 ? GAP : TAIL;
      cues.push({ frame: line.frame, start: t, end: t + dur + gap });
      parts.push(wav.pcm, silence(fmt, gap));
      t += dur + gap;
    }
    const audio = join(work, `s${si}.wav`);
    writeWav(audio, fmt, Buffer.concat(parts));

    const n = Math.round(t * FPS);
    const inputs = ['-framerate', String(FPS), '-loop', '1', '-t', t.toFixed(3), '-i', join(work, `f${scene.base}.png`)];
    for (const c of cues) inputs.push('-framerate', String(FPS), '-loop', '1', '-t', t.toFixed(3), '-i', join(work, `f${c.frame}.png`));
    inputs.push('-i', audio);

    // 2 倍に拡大してからズームすると、揺れ（ジッター）が目立たない
    let filter = `[0:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.04*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}[v0]`;
    cues.forEach((c, i) => {
      filter += `;[v${i}][${i + 1}:v]overlay=enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[v${i + 1}]`;
    });
    const seg = join(work, `seg${si}.mp4`);
    ffmpeg([...inputs, '-filter_complex', filter, '-map', `[v${cues.length}]`, '-map', `${cues.length + 1}:a`,
      '-t', t.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', seg]);
    list.push(`file '${seg.replace(/\\/g, '/')}'`);
    total += t;
    console.log(`シーン ${si + 1}/${script.scenes.length}（${t.toFixed(1)} 秒）`);
  }

  // 3. つなげる
  const listFile = join(work, 'list.txt');
  writeFileSync(listFile, list.join('\n'));
  mkdirSync('content/assets', { recursive: true });
  const out = resolve('content/assets', `${script.id}.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]);
  console.log(`\n書き出しました: ${out}（${total.toFixed(1)} 秒）`);
}

try {
  await main();
} catch (err) {
  console.error('失敗:', err.message);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
