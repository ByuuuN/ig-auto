"""立ち絵の PSD から、口パク・まばたき用のパーツを書き出す（ローカル専用）。

    python tools/zundamon/export_parts.py

入力: content/reels/_shared/zundamon-src/*.psd（坂本アヒル氏の配布素材。Git には含めない）
出力: content/reels/_shared/ に以下の PNG（すべて同じ大きさ・同じ位置。重ねるとズレない）

    zundamon-upper.png       これまでどおりの立ち絵（口を閉じ、目を開いた状態）
    zundamon-body.png        口と目を描いていない土台
    zundamon-mouth-0.png     口（閉じ）
    zundamon-mouth-1.png     口（半開き）
    zundamon-mouth-2.png     口（開き）
    zundamon-eye-0.png       目（開き）
    zundamon-eye-1.png       目（閉じ＝まばたき用）

render-reel.js は土台の上に口と目を重ね、声の大きさに合わせて口を切り替える。

必要なもの: Python 3.11 以上と psd-tools。初回だけ次を実行する。

    python -m venv .venv
    .venv\\Scripts\\activate
    pip install psd-tools
"""
import glob
import os
import sys

try:
    from psd_tools import PSDImage
except ImportError:
    sys.exit('psd-tools がありません。`pip install psd-tools` を実行してください。')

SRC_DIR = 'content/reels/_shared/zundamon-src'
OUT_DIR = 'content/reels/_shared'

# 上半身の切り出し位置。全部のパーツに同じ矩形を使うので、重ねたときにズレない
CROP = (258, 109, 964, 963)

MOUTH_GROUP = '!口'
EYE_GROUP = '!目'
# 閉じ → 半開き → 開き。声が大きいほど後ろのものを使う
MOUTHS = ['んー', 'ほあ', 'んあー']
# 開いた目と、閉じた目（まばたき）
EYES = ['目セット', 'にっこり']


def find_group(psd, name):
    for layer in psd:
        if layer.name == name:
            return layer
    sys.exit(f'PSD に「{name}」のグループがありません')


def show_only(group, name):
    """グループの中の 1 枚だけを表示する。name が None なら全部隠す"""
    found = name is None
    for layer in group:
        on = layer.name.lstrip('*') == name
        layer.visible = on
        found = found or on
    if not found:
        sys.exit(f'「{group.name}」に「{name}」がありません')


def save(psd, path):
    psd.composite().crop(CROP).save(path)
    print(path)


def save_layer(psd, group, name, path):
    """グループの中の 1 枚だけを、土台と同じ大きさ・同じ位置で書き出す。
    レイヤー単体で合成するので、背景や体は入らない（重ねて使うため）"""
    for layer in group:
        if layer.name.lstrip('*') == name:
            was = layer.visible
            layer.visible = True
            img = layer.composite(viewport=psd.viewbox)
            layer.visible = was
            img.crop(CROP).save(path)
            print(path)
            return
    sys.exit(f'「{group.name}」に「{name}」がありません')


def main():
    files = glob.glob(os.path.join(SRC_DIR, '*.psd'))
    if not files:
        sys.exit(f'{SRC_DIR} に PSD がありません')
    psd = PSDImage.open(files[0])
    mouth = find_group(psd, MOUTH_GROUP)
    eye = find_group(psd, EYE_GROUP)

    out = lambda name: os.path.join(OUT_DIR, name)

    # これまでどおりの立ち絵（差し替えても今までの動画と同じ見た目になる）
    show_only(mouth, MOUTHS[0])
    show_only(eye, EYES[0])
    save(psd, out('zundamon-upper.png'))

    # 土台（口と目を消したもの）
    show_only(mouth, None)
    show_only(eye, None)
    save(psd, out('zundamon-body.png'))

    # 口と目は、土台に重ねるパーツとして 1 枚ずつ書き出す
    for i, name in enumerate(MOUTHS):
        save_layer(psd, mouth, name, out(f'zundamon-mouth-{i}.png'))
    for i, name in enumerate(EYES):
        save_layer(psd, eye, name, out(f'zundamon-eye-{i}.png'))

    print('\n書き出しました。中身は Git に含めません（.gitignore 済み）。')


if __name__ == '__main__':
    main()
