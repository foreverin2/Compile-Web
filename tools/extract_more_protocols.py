"""将官方 TTS 卡面 PNG 处理为网页可用资源（其余 9 套协议：spirit/gravity/psychic/plague/metal/speed/love/hate/apathy）。

映射规则（与阶段 1 一致，用户确认 A/B 原图即正置，不旋转）：
- CommandSheet.png: 2250x2100 = 6 张 750x1050 卡，从上到下、从左到右 = 最小分值 -> 最大分值
- A.png: 协议卡 Loading 面（未编译）——原图正置，直接复制
- B.png: 协议卡 Compiled 面（已编译）——原图正置，直接复制
- 输出: public/assets/protocols/<defId>/card-<value>.png, protocol-loading.png, protocol-compiled.png
"""
import os
from PIL import Image

SRC_BASE = r"E:\studyE\compile\compile(自制compile+正版compile)\TabletopSimulator_Compile-main\TabletopSimulator_Compile-main\Assets\卡牌\Cards\Protocols（主要卡牌）\Official（官方）"
OUT_BASE = r"E:\studyE\AI大模型相关资料\自己的项目\compile\public\assets\protocols"

# defId -> (子目录 Main 1/Aux 1, 文件夹名, 分值列表[按 CommandSheet 顺序递增])
PROTOCOLS = {
    "spirit": ("Main 1", "Spirit", [0, 1, 2, 3, 4, 5]),
    "gravity": ("Main 1", "Gravity", [0, 1, 2, 4, 5, 6]),
    "psychic": ("Main 1", "Psychic", [0, 1, 2, 3, 4, 5]),
    "plague": ("Main 1", "Plague", [0, 1, 2, 3, 4, 5]),
    "metal": ("Main 1", "Metal", [0, 1, 2, 3, 5, 6]),
    "speed": ("Main 1", "Speed", [0, 1, 2, 3, 4, 5]),
    "love": ("Aux 1", "Love", [1, 2, 3, 4, 5, 6]),
    "hate": ("Aux 1", "Hate", [0, 1, 2, 3, 4, 5]),
    "apathy": ("Aux 1", "Apathy", [0, 1, 2, 3, 4, 5]),
}


def process_protocol(def_id: str, sub: str, folder: str, values: list[int]) -> None:
    src = os.path.join(SRC_BASE, sub, folder)
    out_dir = os.path.join(OUT_BASE, def_id)
    os.makedirs(out_dir, exist_ok=True)

    # 1) CommandSheet -> 6 张命令卡
    sheet = Image.open(os.path.join(src, "CommandSheet.png"))
    w, h = sheet.size
    cw, ch = w // 3, h // 2
    assert w % 3 == 0 and h % 2 == 0, f"unexpected sheet size {w}x{h}"
    for i, value in enumerate(values):
        row, col = divmod(i, 3)
        cell = sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        cell.save(os.path.join(out_dir, f"card-{value}.png"))
        print(f"  {def_id} card-{value}.png  ({cell.size})")

    # 2) A/B 协议卡：原图正置，直接复制
    for fname, out in [("A.png", "protocol-loading.png"), ("B.png", "protocol-compiled.png")]:
        im = Image.open(os.path.join(src, fname))
        im.save(os.path.join(out_dir, out))
        print(f"  {def_id} {out}  ({im.size})")


if __name__ == "__main__":
    for def_id, (sub, folder, values) in PROTOCOLS.items():
        print(f"== {def_id} ({sub}/{folder}) ==")
        process_protocol(def_id, sub, folder, values)
    print("DONE")
