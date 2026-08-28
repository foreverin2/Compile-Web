"""将官方 TTS 卡面 PNG 处理为网页可用资源。

映射规则（用户提供 + OCR 验证）：
- CommandSheet.png: 2250x2100 = 6 张 750x1050 卡，从上到下、从左到右 = 最小分值 -> 最大分值（正置）
- A.png: 协议卡 Loading 面（未编译），顺时针 90° 放置 -> 归正 = rotate(-90)
- B.png: 协议卡 Compiled 面（已编译），顺时针 90° 放置 -> 归正 = rotate(-90)
- 输出: public/assets/protocols/<name>/card-<value>.png, protocol-loading.png, protocol-compiled.png
"""
import os
from PIL import Image

SRC_BASE = r"E:\studyE\compile\compile(自制compile+正版compile)\TabletopSimulator_Compile-main\TabletopSimulator_Compile-main\Assets\卡牌\Cards\Protocols（主要卡牌）\Official（官方）"
OUT_BASE = r"E:\studyE\AI大模型相关资料\自己的项目\compile\public\assets\protocols"

# 演示 6 套：defId -> (文件夹名, 分值列表)
PROTOCOLS = {
    "water": ("Water", [0, 1, 2, 3, 4, 5]),
    "fire": ("Fire", [0, 1, 2, 3, 4, 5]),
    "light": ("Light", [0, 1, 2, 3, 4, 5]),
    "darkness": ("Darkness", [0, 1, 2, 3, 4, 5]),
    "life": ("Life", [0, 1, 2, 3, 4, 5]),
    "death": ("Death", [0, 1, 2, 3, 4, 5]),
}


def process_protocol(def_id: str, folder: str, values: list[int]) -> None:
    src = os.path.join(SRC_BASE, "Main 1", folder)
    out_dir = os.path.join(OUT_BASE, def_id)
    os.makedirs(out_dir, exist_ok=True)

    # 1) CommandSheet -> 6 张命令卡
    sheet = Image.open(os.path.join(src, "CommandSheet.png"))
    w, h = sheet.size
    cw, ch = w // 3, h // 2  # 750 x 1050
    assert w % 3 == 0 and h % 2 == 0, f"unexpected sheet size {w}x{h}"
    for i, value in enumerate(values):
        row, col = divmod(i, 3)
        cell = sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        cell.save(os.path.join(out_dir, f"card-{value}.png"))
        print(f"  {def_id} card-{value}.png  ({cell.size})")

    # 2) A/B 协议卡：逆时针 90° 归正
    for fname, out in [("A.png", "protocol-loading.png"), ("B.png", "protocol-compiled.png")]:
        im = Image.open(os.path.join(src, fname))
        im_rot = im.rotate(-90, expand=True)  # 顺时针 90° 放置 -> 逆时针归正
        im_rot.save(os.path.join(out_dir, out))
        print(f"  {def_id} {out}  ({im.size} -> {im_rot.size})")


if __name__ == "__main__":
    for def_id, (folder, values) in PROTOCOLS.items():
        print(f"== {def_id} ({folder}) ==")
        process_protocol(def_id, folder, values)
    print("DONE")
