"""将《译世界》2代（官方 MN02）英文版卡面扫描处理为网页可用资源。

输入: E:\\studyE\\compile\\正版compile\\compile2\\英文版
  - 1<名>.jpg  协议卡「加载中」面（loading）—— 750x1050（烟雾为 1760x2400 PNG）
  - 2<名>.jpg  协议卡「已编译」面（compiled）—— 750x1050（冰为 864x1207）
  - 3<名>.jpg  6 张指令卡拼版 —— 2250x2100 = 2 行 x 3 列 x 750x1050，行优先、分值升序
    例外: 3同化3多样性3统一.jpg = 6750x2100 = 2 行 x 9 列（左块=同化、中块=多样性、右块=统一，
    每块内部同 2 行 x 3 列升序）——布局约定经用户确认（2026-09-03）。

输出: public/assets/protocols/<defId>/{card-<value>.jpg x6, protocol-loading.jpg, protocol-compiled.jpg}
与 1代 目录同名同构；文件格式用 JPEG（源即扫描照片；1代 为官方 TTS PNG，格式差异不影响 <img>）。
分值集合（权威: compile2文本.txt 卡文转写）：冰1-6、明镜0-5、和平1-6、混乱0-5、恐惧0-5、
明晰0-5、腐化{0,1,2,3,5,6}、时间0-5、战争0-5、勇气{0,1,2,3,5,6}、幸运0-5、烟雾0-5、
同化{0,1,2,4,5,6}、多样性{0,1,3,4,5,6}、统一0-5。
"""
import os
from PIL import Image, ImageOps

SRC_BASE = r"E:\studyE\compile\正版compile\compile2\英文版"
OUT_BASE = r"E:\studyE\AI大模型相关资料\自己的项目\compile\public\assets\protocols"
JPEG_QUALITY = 92

# 中文文件名 -> (defId, set, 分值集合[按拼版格位升序])
PROTOCOLS: dict[str, tuple[str, str, list[int]]] = {
    "冰":     ("ice",           "MN02", list(range(1, 7))),
    "明镜":   ("mirror",        "MN02", list(range(0, 6))),
    "和平":   ("peace",         "MN02", list(range(1, 7))),
    "混乱":   ("chaos",         "MN02", list(range(0, 6))),
    "恐惧":   ("fear",          "MN02", list(range(0, 6))),
    "明晰":   ("clarity",       "MN02", list(range(0, 6))),
    "腐化":   ("corruption",    "MN02", [0, 1, 2, 3, 5, 6]),
    "时间":   ("time",          "MN02", list(range(0, 6))),
    "战争":   ("war",           "MN02", list(range(0, 6))),
    "勇气":   ("courage",       "MN02", [0, 1, 2, 3, 5, 6]),
    "幸运":   ("luck",          "MN02", list(range(0, 6))),
    "烟雾":   ("smoke",         "MN02", list(range(0, 6))),
    "同化":   ("assimilation",  "AX02", [0, 1, 2, 4, 5, 6]),
    "多样性": ("diversity",     "AX02", [0, 1, 3, 4, 5, 6]),
    "统一":   ("unity",         "AX02", list(range(0, 6))),
}
# 组合拼版：左/中/右块对应协议（6750x2100 = 3 块 x 2250x2100）
COMBINED_SHEET = "3同化3多样性3统一.jpg"
COMBINED_BLOCKS = [("同化", 0), ("多样性", 1), ("统一", 2)]


def open_upright(path: str) -> Image.Image:
    im = Image.open(path)
    return ImageOps.exif_transpose(im).convert("RGB")


def save_jpeg(im: Image.Image, path: str) -> None:
    im.save(path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def crop_sheet(sheet: Image.Image, name: str, def_id: str, values: list[int], out_dir: str,
               x0: int = 0) -> None:
    w, h = sheet.size
    assert h == 2100 and w >= x0 + 2250, f"{name} 拼版尺寸异常 {w}x{h} (x0={x0})"
    cw, ch = 750, 1050
    for i, value in enumerate(values):
        row, col = divmod(i, 3)
        cell = sheet.crop((x0 + col * cw, row * ch, x0 + (col + 1) * cw, (row + 1) * ch))
        assert cell.size == (750, 1050), cell.size
        save_jpeg(cell, os.path.join(out_dir, f"card-{value}.jpg"))
    print(f"  {name} -> {def_id}: cards {values}")


def main() -> None:
    os.makedirs(OUT_BASE, exist_ok=True)
    for name, (def_id, _set, values) in PROTOCOLS.items():
        out_dir = os.path.join(OUT_BASE, def_id)
        os.makedirs(out_dir, exist_ok=True)
        # 1) 协议面：1X = loading / 2X = compiled（原图正置，仅转 JPEG，保持原生分辨率）
        for prefix, out_name in (("1", "protocol-loading.jpg"), ("2", "protocol-compiled.jpg")):
            src = os.path.join(SRC_BASE, f"{prefix}{name}.jpg")
            if not os.path.exists(src):
                src = os.path.join(SRC_BASE, f"{prefix}{name}.png")
            im = open_upright(src)
            w, h = im.size
            # 尺寸断言：绝大多数 750x1050；烟雾 loading 1760x2400、冰 compiled 864x1207 两例外
            assert (w, h) in ((750, 1050), (1760, 2400), (864, 1207)), f"{name} {out_name} 尺寸异常 {w}x{h}"
            save_jpeg(im, os.path.join(out_dir, out_name))
            print(f"  {name} {out_name}  {im.size}")
        # 2) 指令卡：3X 拼版（组合图则取对应块）
        sheet_path = os.path.join(SRC_BASE, f"3{name}.jpg")
        block_x0 = 0
        if os.path.exists(sheet_path):
            sheet = open_upright(sheet_path)
        else:
            block_map = {n: b for n, b in COMBINED_BLOCKS}
            assert name in block_map, f"缺少 {name} 拼版图"
            combined = open_upright(os.path.join(SRC_BASE, COMBINED_SHEET))
            assert combined.size == (6750, 2100), combined.size
            sheet = combined
            block_x0 = block_map[name] * 2250
        crop_sheet(sheet, name, def_id, values, out_dir, x0=block_x0)
    print("DONE")


if __name__ == "__main__":
    main()
