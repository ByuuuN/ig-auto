// スライド・文字・ずんだもんの立ち絵から、リール用の縦長動画（1080x1920）を作る。
// Windows のローカル専用。VOICEVOX を起動しておくこと（エンジンが 127.0.0.1:50021 で動く）。
//
//   node scripts/render-reel.js 002-autoscribe-hallucination
//
// 入力: content/reels/<name>/script.json（台本）
//   scenes[].kind = "text"  … 大きな文字だけのシーン（冒頭のフック向け）
//   scenes[].kind = "slide" … content/assets/<slides>-NN.jpg を見せるシーン
//   character     … 立ち絵の画像。喋っているあいだ、ゆっくり上下に揺れる
// 出力: content/assets/<id>.mp4
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = 1080;
const H = 1920;
const FPS = 30;
const GAP = 0.2; // 文と文のあいだの間（秒）
const TAIL = 0.3; // シーンの最後の間（秒）
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
  query.speedScale = script.speed ?? 1.15;
  query.prePhonemeLength = 0.05;
  query.postPhonemeLength = 0.1;
  const s = await fetch(`${ENGINE}/synthesis?speaker=${script.speaker}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`VOICEVOX synthesis → HTTP ${s.status}`);
  return Buffer.from(await s.arrayBuffer());
}

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

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const slideUrl = (n) => pathToFileURL(resolve('content/assets', `${script.slides}-${String(n).padStart(2, '0')}.jpg`)).href;

function framesHtml(frames) {
  const body = frames.map((f) => {
    if (f.kind === 'sub') return `<section class="f sub"><div class="band">${esc(f.text)}</div></section>`;
    if (f.kind === 'text') return `<section class="f base text"><div class="hook">${esc(f.title)}</div>${f.note ? `<div class="hooknote">${esc(f.note)}</div>` : ''}<div class="credit">VOICEVOX:${esc(script.speaker_name)}</div></section>`;
    return `<section class="f base"><div class="credit">VOICEVOX:${esc(script.speaker_name)}</div><img src="${slideUrl(f.slide)}"></section>`;
  }).join('\n');

  return `<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: transparent; }
    .f { width: ${W}px; height: ${H}px; position: relative; display: none;
         font-family: "Noto Sans JP", "Yu Gothic UI", sans-serif; color: #1b1e24; }
    .f.on { display: block; }
    .base { background: #f6f3ec; }
    /* Instagram のリールは上 270px・下 670px・左右 65px が UI（キャプションやボタン）に隠れる。
       読ませたいものは y=270～1250 のあいだに置く。立ち絵は左下に立たせる（右下はボタンが並ぶ）。 */
    .credit { position: absolute; right: 60px; top: 175px; font-size: 24px; font-weight: 700; color: #9aa0ab; }
    .base img { position: absolute; left: 30px; top: 250px; width: 1020px; border-radius: 26px;
      box-shadow: 0 16px 48px rgba(27,30,36,.16); }
    .text .hook { position: absolute; left: 60px; right: 60px; top: 380px; text-align: center;
      font-size: 92px; font-weight: 900; line-height: 1.35; letter-spacing: -.01em; white-space: pre-line; }
    .text .hooknote { position: absolute; left: 70px; right: 70px; top: 860px; text-align: center;
      font-size: 40px; font-weight: 700; color: #ff5c35; white-space: pre-line; }
    .sub .band { position: absolute; left: 65px; right: 65px; top: 1040px; white-space: pre-line;
      display: flex; align-items: center; justify-content: center; text-align: center;
      padding: 22px 40px; border-radius: 26px; background: rgba(27,30,36,.92); color: #fff;
      font-size: 54px; font-weight: 900; line-height: 1.35; }
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

// ---------- 口パク・まばたき ----------

const STEP = 0.09; // 口の形を決める間隔（秒）

// 声の大きさから、口の形（0=閉じ 1=半開き 2=開き）を STEP ごとに決める
function mouthLevels(fmt, pcm) {
  const frame = Math.round(STEP * fmt.rate) * fmt.channels;
  const count = Math.floor(pcm.length / 2 / frame);
  const rms = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < frame; j++) {
      const v = pcm.readInt16LE((i * frame + j) * 2);
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / frame));
  }
  const peak = Math.max(...rms, 1);
  return rms.map((v) => (v < peak * 0.1 ? 0 : v < peak * 0.32 ? 1 : 2));
}

// 同じ形が続くところをまとめて [開始秒, 終了秒] の配列にする
function levelRanges(levels, level) {
  const out = [];
  let from = null;
  levels.forEach((v, i) => {
    if (v === level && from === null) from = i;
    if (v !== level && from !== null) {
      out.push([from * STEP, i * STEP]);
      from = null;
    }
  });
  if (from !== null) out.push([from * STEP, levels.length * STEP]);
  return out;
}

// 2〜4 秒おきに 0.12 秒だけ目を閉じる。間隔は固定なので、何度書き出しても同じ動きになる
function blinkRanges(total) {
  const gaps = [2.7, 3.4, 2.2, 4.1];
  const out = [];
  for (let i = 0, t = 1.1; t < total - 0.2; t += gaps[i % gaps.length], i++) out.push([t, t + 0.12]);
  return out;
}

const rangeExpr = (ranges) =>
  ranges.length ? ranges.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+') : null;

// ---------- 組み立て ----------

const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

async function main() {
  const frames = [];
  for (const scene of script.scenes) {
    scene.base = frames.push(scene.kind === 'text'
      ? { kind: 'text', title: scene.title, note: scene.note }
      : { kind: 'slide', slide: scene.slide });
    for (const line of scene.lines) line.frame = frames.push({ kind: 'sub', text: line.text });
  }
  const html = join(work, 'frames.html');
  writeFileSync(html, framesHtml(frames));
  frames.forEach((f, i) => shoot(html, i + 1, join(work, `f${i + 1}.png`), f.kind === 'sub'));
  console.log(`画像 ${frames.length} 枚を書き出しました`);

  // 立ち絵。body・mouth・eye を指定すると口パクとまばたきが付く。image だけなら 1 枚絵のまま
  const charaFile = (p) => {
    const f = resolve(dir, '..', p);
    if (!existsSync(f)) throw new Error(`立ち絵が見つかりません: ${f}`);
    return f;
  };
  const C = script.character;
  const chara = !C ? null
    : C.body
      ? { body: charaFile(C.body), mouth: (C.mouth || []).map(charaFile), eye: (C.eye || []).map(charaFile) }
      : { body: charaFile(C.image), mouth: [], eye: [] };
  const charaFiles = chara ? [chara.body, ...chara.mouth, ...chara.eye] : [];

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
    const pcm = Buffer.concat(parts);
    writeWav(audio, fmt, pcm);

    const n = Math.round(t * FPS);
    const inputs = ['-framerate', String(FPS), '-loop', '1', '-t', t.toFixed(3), '-i', join(work, `f${scene.base}.png`)];
    for (const c of cues) inputs.push('-framerate', String(FPS), '-loop', '1', '-t', t.toFixed(3), '-i', join(work, `f${c.frame}.png`));
    for (const f of charaFiles) inputs.push('-framerate', String(FPS), '-loop', '1', '-t', t.toFixed(3), '-i', f);
    inputs.push('-i', audio);

    // 2 倍に拡大してからズームすると、揺れ（ジッター）が目立たない
    let filter = `[0:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.03*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}[bg]`;
    let last = 'bg';
    // 立ち絵はスライドの上・字幕の下に重ねる（字幕が隠れないように）
    if (chara) {
      const base = cues.length + 1;
      const { width = 620, bob = 10, x = '-90', enter = false } = C;
      // 喋っているあいだ、ゆっくり上下に揺れる。最初のシーンでは画面の外から入ってくる
      // （enter: 'left' なら左から、true なら右から）
      const sign = enter === 'left' ? '-' : '+';
      const xExpr = enter && si === 0 ? `${x}${sign}max(0\\,420*(1-t/0.45))` : x;
      const yExpr = `H-h+40+${bob}*sin(2*PI*t*2.1)`;
      // 土台・口・目を同じ位置に重ねる。enable で出す区間を切り替える
      let k = 0;
      const put = (idx, enable) => {
        const out = `v${k++}`;
        filter += `;[${idx}:v]scale=${width}:-1[p${idx}]`;
        filter += `;[${last}][p${idx}]overlay=x='${xExpr}':y='${yExpr}'${enable ? `:enable='${enable}'` : ''}[${out}]`;
        last = out;
      };
      put(base);
      if (chara.mouth.length) {
        const levels = mouthLevels(fmt, pcm);
        chara.mouth.forEach((_, i) => {
          const e = rangeExpr(levelRanges(levels, i));
          if (e) put(base + 1 + i, e);
        });
      }
      if (chara.eye.length === 2) {
        const blink = rangeExpr(blinkRanges(t));
        const eye = base + 1 + chara.mouth.length;
        put(eye, blink && `not(${blink})`);
        if (blink) put(eye + 1, blink);
      }
    } else {
      filter += `;[bg]null[v0]`;
      last = 'v0';
    }
    cues.forEach((c, i) => {
      filter += `;[${last}][${i + 1}:v]overlay=enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[s${i}]`;
      last = `s${i}`;
    });

    const seg = join(work, `seg${si}.mp4`);
    ffmpeg([...inputs, '-filter_complex', filter, '-map', `[${last}]`, '-map', `${cues.length + charaFiles.length + 1}:a`,
      '-t', t.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', seg]);
    list.push(`file '${seg.replace(/\\/g, '/')}'`);
    total += t;
    console.log(`シーン ${si + 1}/${script.scenes.length}（${t.toFixed(1)} 秒）`);
  }

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
