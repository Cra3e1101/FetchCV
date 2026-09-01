from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "FetchCV_LOGO.png"
TARGETS = (SOURCE, ROOT / "public" / "FetchCV_LOGO.png")


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    outside = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if outside[index]:
            return
        red, green, blue, _ = pixels[x, y]
        # The solid black pixel outline is the boundary. Everything bright and
        # connected to an image edge is the baked checkerboard background.
        if max(red, green, blue) <= 72:
            return
        outside[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    for y in range(height):
        for x in range(width):
            if outside[y * width + x]:
                pixels[x, y] = (255, 255, 255, 0)

    for target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, optimize=True)
    image.save(
        ROOT / "FetchCV_LOGO.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    transparent = sum(outside)
    if transparent < width * height // 4:
        raise RuntimeError("Background segmentation did not find the outer canvas")
    print(f"saved {width}x{height} RGBA logo; transparent pixels={transparent}")


if __name__ == "__main__":
    main()
