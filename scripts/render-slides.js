// content/slides/<id>/index.html の各スライドを JPEG に書き出す（Windows のローカル専用）。
//
//   node scripts/render-slides.js 001-autoscribe
//   node scripts/render-slides.js 001-autoscribe --theme dark --only 1,4 --out tmp/
//
// → content/assets/001-autoscribe-01.jpg, -02.jpg, ...
//   --theme  配色を切り替えて書き出す（比較用。既定は HTML に書かれた配色）
//   --only   指定した番号のスライドだけ書き出す
//   --out    書き出し先（既定は content/assets）
// Chrome のヘッドレス機能で PNG を撮り、PowerShell（System.Drawing）で JPEG に変換する。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WIDTH = 1080;
const HEIGHT = 1350;
const QUALITY = 92;

const CHROME = process.env.CHROME_PATH ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync);

const [id, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : null;
};
const theme = opt('theme');
const outDir = resolve(opt('out') || 'content/assets');
const only = opt('only') ? new Set(opt('only').split(',').map(Number)) : null;

if (!id) {
  console.error('使い方: node scripts/render-slides.js <スライドのフォルダ名>');
  process.exit(1);
}
if (!CHROME) {
  console.error('Chrome が見つかりません。CHROME_PATH を指定してください。');
  process.exit(1);
}

const html = resolve('content/slides', id, 'index.html');
if (!existsSync(html)) {
  console.error(`${html} がありません`);
  process.exit(1);
}
const count = (readFileSync(html, 'utf8').match(/<section class="slide/g) || []).length;
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'slides-'));

try {
  const outputs = [];
  for (let i = 1; i <= count; i++) {
    if (only && !only.has(i)) continue;
    const png = join(work, `${i}.png`);
    const suffix = theme ? `-${theme}` : '';
    const jpg = join(outDir, `${id}-${String(i).padStart(2, '0')}${suffix}.jpg`);
    const url = `${pathToFileURL(html).href}?n=${i}${theme ? `&theme=${theme}` : ''}`;
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`, `--user-data-dir=${join(work, 'profile')}`,
      '--virtual-time-budget=3000', `--screenshot=${png}`, url,
    ], { stdio: 'ignore' });
    if (!existsSync(png)) throw new Error(`${i} 枚目の書き出しに失敗しました`);
    outputs.push([png, jpg]);
  }

  // JPEG 変換はまとめて 1 回の PowerShell で行う
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    '$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq "image/jpeg"',
    '$params = New-Object System.Drawing.Imaging.EncoderParameters 1',
    `$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]${QUALITY})`,
    ...outputs.map(([png, jpg]) =>
      `$img = [System.Drawing.Image]::FromFile('${png}'); $img.Save('${jpg}', $codec, $params); $img.Dispose()`),
  ].join('; ');
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });

  outputs.forEach(([, jpg]) => console.log(jpg));
  console.log(`${outputs.length} 枚を書き出しました`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
