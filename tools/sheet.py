#!/usr/bin/env python3
"""ChatGPT 가 준 그림을 스프라이트 시트에 행으로 붙인다.

    python3 tools/sheet.py evening-night/art/hero.png dash.png --rows 19
    python3 tools/sheet.py evening-night/art/mob.png  puff.png --rows 12,13 --content-h 76

원본은 마젠타(#FF00FF) 배경에 한 동작이 한 줄씩 들어 있는 큰 그림이다.
키잉 → 글자·번호 제거 → 밴드/프레임 분할 → 축소 → 칸에 정렬 → 시트에 덧붙임.
자세한 배경은 docs/art-guide.md 참고. (numpy, pillow 필요)
"""
import argparse
import numpy as np
from PIL import Image

CELL = 96
BOTTOM = 94          # 기존 시트의 발 위치 (실측)

import numpy as np
from PIL import Image


def key_magenta(path):
    """마젠타 배경을 투명으로.

    단색 배경만 지우면 안티에일리어싱된 가장자리에 마젠타가 남아 분홍 테두리가 생긴다.
    그래서 '마젠타 정도' = min(R,B) - G 를 재서, 확실한 내부 픽셀의 최댓값보다
    더 마젠타에 가까운 픽셀은 배경으로 본다. (외곽선 #4A3550 이 +21 이라 그 위로 잡는다.)
    형태학적 침식이 아니라 색으로 고르는 것이라 둥실이의 얇은 술 끈이 살아남는다.
    """
    im = Image.open(path).convert('RGB')
    a = np.array(im).astype(np.int16)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    solid = (G < 75) & (R > 135) & (B > 125) & (R - G > 90) & (B - G > 80)
    score = np.minimum(R, B) - G

    inner = solid.copy()                      # 배경을 6px 부풀려서 '확실한 내부'를 남긴다
    for _ in range(6):
        inner = (inner | np.roll(inner, 1, 0) | np.roll(inner, -1, 0)
                 | np.roll(inner, 1, 1) | np.roll(inner, -1, 1))
    inner = ~inner
    thr = int(np.clip(score[inner].max() if inner.any() else 21, 0, 30))

    bg = solid | (score > thr)
    rgba = np.dstack([np.array(im), np.where(bg, 0, 255).astype(np.uint8)])
    return rgba, bg


def components(mask):
    """4-이웃 연결 요소. scipy 없이 BFS."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    cur = 0
    out = []
    ys, xs = np.where(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        stack = [(y0, x0)]
        lab[y0, x0] = cur
        pix = []
        while stack:
            y, x = stack.pop()
            pix.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = cur
                    stack.append((ny, nx))
        out.append(np.array(pix))
    return out


def drop_labels(rgba, max_h=62, ratio=0.55):
    """흰 글자·노란 번호를 지운다. 높이가 작고 흰/노랑 비율이 높은 덩어리만."""
    al = rgba[:, :, 3] > 16
    removed = 0
    for pix in components(al):
        ys, xs = pix[:, 0], pix[:, 1]
        if ys.max() - ys.min() + 1 > max_h:
            continue
        c = rgba[ys, xs, :3].astype(np.int16)
        R, G, B = c[:, 0], c[:, 1], c[:, 2]
        white = (R > 200) & (G > 200) & (B > 200)
        yellow = (R > 190) & (G > 170) & (B < 130)
        if (white | yellow).mean() > ratio:
            rgba[ys, xs, 3] = 0
            removed += 1
    return removed


def bands(rgba, gap=6):
    """행 투영 → 가로 밴드"""
    rows = (rgba[:, :, 3] > 16).any(axis=1)
    out, s = [], None
    run = 0
    for y, v in enumerate(rows):
        if v:
            if s is None:
                s = y
            run = 0
        elif s is not None:
            run += 1
            if run >= gap:
                out.append((s, y - run + 1))
                s = None
    if s is not None:
        out.append((s, len(rows)))
    return out


def cols(rgba, y0, y1, gap=12):
    """열 투영 → 프레임"""
    strip = rgba[y0:y1]
    c = (strip[:, :, 3] > 16).any(axis=0)
    out, s = [], None
    run = 0
    for x, v in enumerate(c):
        if v:
            if s is None:
                s = x
            run = 0
        elif s is not None:
            run += 1
            if run >= gap:
                out.append((s, x - run + 1))
                s = None
    if s is not None:
        out.append((s, len(c)))
    return out


def frames_of(path, strip_labels=True, band_gap=6, col_gap=12):
    rgba, _ = key_magenta(path)
    if strip_labels:
        drop_labels(rgba)
    out = []
    for (y0, y1) in bands(rgba, band_gap):
        band = []
        for (x0, x1) in cols(rgba, y0, y1, col_gap):
            sub = rgba[y0:y1, x0:x1]
            a = sub[:, :, 3] > 16
            ys, xs = np.where(a)
            band.append(Image.fromarray(
                sub[ys.min():ys.max() + 1, xs.min():xs.max() + 1]))
        out.append(band)
    return out


def face_h(rgba):
    """가장 큰 살색 덩어리(얼굴)의 높이. 자세가 달라도 얼굴 크기는 같아서 배율 기준으로 좋다."""
    c = rgba[:, :, :3].astype(np.int16)
    a = rgba[:, :, 3] > 16
    R, G, B = c[:, :, 0], c[:, :, 1], c[:, :, 2]
    skin = a & (R > 200) & (G > 150) & (G < 230) & (B > 95) & (B < 205) & (R - B > 55) & (R - G > 25)
    comps = components(skin)
    if not comps:
        return None
    ys = max(comps, key=len)[:, 0]
    return ys.max() - ys.min() + 1


def shrink(im, scale):
    """알파를 곱한 뒤 줄이고 다시 나눈다 (가장자리 검정 테두리 방지)."""
    a = np.array(im).astype(np.float32)
    al = a[:, :, 3:4] / 255.0
    pm = np.dstack([a[:, :, :3] * al, a[:, :, 3]])
    w = max(1, int(round(im.size[0] * scale)))
    h = max(1, int(round(im.size[1] * scale)))
    small = np.array(Image.fromarray(pm.astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    alp = np.clip(small[:, :, 3:4], 0, 255)
    rgb = np.where(alp > 0, small[:, :, :3] / np.maximum(alp / 255.0, 1e-4), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alp]).astype(np.uint8))


def body_center(rgba):
    """가장 넓은 가로줄의 중심 = 몸통 가운데. 술이 흔들려도 안 흔들린다."""
    a = rgba[:, :, 3] > 16
    widths = a.sum(axis=1)
    y = int(np.argmax(widths))
    xs = np.where(a[y])[0]
    return (xs.min() + xs.max()) / 2


def place(frame, cx=None):
    """96칸 가운데(가로) · 아래(세로)에 앉힌다."""
    cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    a = np.array(frame)
    w, h = frame.size
    if cx is None:
        cx = w / 2
    x = int(round(CELL / 2 - cx))
    y = BOTTOM - h
    cell.alpha_composite(frame, (max(0, min(CELL - w, x)) if w <= CELL else 0, max(0, y)))
    return cell


def row_image(cells, cols):
    row = Image.new('RGBA', (CELL * cols, CELL), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        row.alpha_composite(c, (i * CELL, 0))
    return row


def append_rows(sheet_path, rows, out_path):
    """기존 팔레트는 인덱스까지 그대로 두고, 새 행만 남는 팔레트 칸에 넣는다.
       전체를 다시 양자화하면 이미 잘 나온 그림의 색이 틀어진다 (실측 최대 56)."""
    old = Image.open(sheet_path)
    assert old.mode == 'P', old.mode
    opal = old.getpalette()
    oalpha = bytearray(old.info.get('transparency', b''))
    used = int(np.array(old).max()) + 1
    oalpha += bytes([255]) * (used - len(oalpha))          # tRNS 가 짧으면 불투명으로 채운다

    band = Image.new('RGBA', (old.size[0], CELL * len(rows)), (0, 0, 0, 0))
    for i, r in enumerate(rows):
        band.alpha_composite(r, (0, i * CELL))
    room = 256 - used
    q = band.quantize(colors=room, method=Image.FASTOCTREE)
    # RGBA 양자화는 알파를 팔레트에 넣는다. info['transparency'] 를 읽으면 조용히 불투명해진다.
    rgba_pal = q.getpalette('RGBA')
    nused = int(np.array(q).max()) + 1
    npal, nalpha = [], bytearray()
    for i in range(nused):
        npal += rgba_pal[i * 4:i * 4 + 3]
        nalpha.append(rgba_pal[i * 4 + 3])
    print(f'  기존 {used}색 + 새 {nused}색 = {used + nused} / 256')

    out = Image.new('P', (old.size[0], old.size[1] + band.size[1]))
    a = np.zeros((out.size[1], out.size[0]), np.uint8)
    a[:old.size[1]] = np.array(old)
    a[old.size[1]:] = np.array(q) + used
    out.frombytes(a.tobytes())
    pal = list(opal[:used * 3]) + list(npal)
    out.putpalette(pal + [0] * (768 - len(pal)))
    out.info['transparency'] = bytes(oalpha[:used]) + bytes(nalpha[:nused])
    out.save(out_path, optimize=True, transparency=out.info['transparency'])
    return old, out


def build_rows(src, cols, content_h=None, scale=None, center_body=False):
    """원본에서 캐릭터 밴드만 뽑아 96칸 행 이미지들로 만든다."""
    bands = [b for b in frames_of(src, strip_labels=True)
             if np.median([im.size[1] for im in b]) >= 62]
    if scale is None:
        tallest = max(im.size[1] for b in bands for im in b)
        scale = content_h / tallest
        print(f'  가장 큰 프레임 {tallest}px → 칸 안 {content_h}px, 배율 {scale:.4f}')
    rows = []
    for band in bands:
        cells = []
        for f in band:
            s = shrink(f, scale)
            cells.append(place(s, body_center(np.array(s)) if center_body else None))
        rows.append(row_image(cells, cols))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet', help='붙일 대상 시트 (hero.png / mob.png)')
    ap.add_argument('source', help='ChatGPT 가 준 원본 그림')
    ap.add_argument('--rows', required=True, help='붙일 행 번호. 예: 19 또는 12,13')
    ap.add_argument('--content-h', type=int, default=76,
                    help='칸 안 내용 높이. 심통이 76, 주인공은 --face-scale 을 쓴다')
    ap.add_argument('--face-scale', metavar='SHEET',
                    help='배율을 이 시트의 얼굴 높이에 맞춘다 (주인공용)')
    ap.add_argument('--center-body', action='store_true',
                    help='가장 넓은 가로줄 중심으로 정렬 (술이 흔들리는 심통이용)')
    ap.add_argument('-o', '--out', help='결과 파일 (기본: 시트를 덮어씀)')
    a = ap.parse_args()

    want = [int(r) for r in a.rows.split(',')]
    scale = None
    if a.face_scale:
        sheet = np.array(Image.open(a.face_scale).convert('RGBA'))
        ref = [face_h(sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL])
               for r in range(sheet.shape[0] // CELL) for c in range(3)]
        ref = [v for v in ref if v]
        src = [face_h(np.array(f)) for b in frames_of(a.source, strip_labels=True)
               for f in b if f.size[1] >= 62]
        src = [v for v in src if v]
        scale = float(np.median(ref)) / float(np.median(src))
        print(f'  얼굴 높이  시트 {np.median(ref):.0f}px / 원본 {np.median(src):.0f}px → 배율 {scale:.4f}')

    old = Image.open(a.sheet)
    cols = old.size[0] // CELL
    rows = build_rows(a.source, cols, a.content_h, scale, a.center_body)
    have = old.size[1] // CELL
    if want != list(range(have, have + len(rows))):
        raise SystemExit(f'--rows {a.rows} 인데 시트에 {have}행이 있고 원본은 {len(rows)}줄이다. '
                         f'붙일 수 있는 행은 {have}..{have + len(rows) - 1} 이다.')
    o, n = append_rows(a.sheet, rows, a.out or a.sheet)
    print(f'{a.sheet}  {o.size} → {n.size}')


if __name__ == '__main__':
    main()
