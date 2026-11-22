"""앱 아이콘 생성: python3 tools/make_icons.py (Pillow 필요)"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
BG = (53, 84, 209)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def make(size, maskable=False, rounded=True):
    s = size * 4  # 크게 그린 뒤 축소해서 가장자리를 부드럽게
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, s, s], fill=BG)
    else:
        d.rounded_rectangle([0, 0, s, s], radius=int(s * 0.22), fill=BG)
    scale = 0.62 if maskable else 0.8  # maskable은 안전 영역 안쪽에
    font = ImageFont.truetype(FONT, int(s * 0.36 * scale))
    text = "800"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    cx, cy = s / 2, s * 0.47
    d.text((cx - w / 2 - box[0], cy - h / 2 - box[1]), text, font=font, fill="white")
    # 밑줄 (진행 바 느낌)
    bw, bh = s * 0.46 * scale / 0.8, s * 0.045 * scale / 0.8
    top = cy + h / 2 + s * 0.06 * scale / 0.8
    d.rounded_rectangle([cx - bw / 2, top, cx + bw / 2, top + bh], radius=bh / 2, fill=(255, 255, 255, 90))
    d.rounded_rectangle([cx - bw / 2, top, cx - bw / 2 + bw * 0.62, top + bh], radius=bh / 2, fill=(255, 210, 90))
    return img.resize((size, size), Image.LANCZOS)


make(192).save(f"{OUT}/icon-192.png")
make(512).save(f"{OUT}/icon-512.png")
make(512, maskable=True).save(f"{OUT}/icon-maskable-512.png")
# iOS는 모서리를 알아서 둥글게 깎으므로 꽉 찬 사각형으로
make(180, rounded=False).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
print("done")
