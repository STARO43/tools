#!/usr/bin/env python3
"""Generate a sample "document" image with Russian text for OCR demo/testing."""
from PIL import Image, ImageDraw, ImageFont

W, H = 920, 660
img = Image.new("RGB", (W, H), "#f7f6f2")
d = ImageDraw.Draw(img)

# subtle paper border
d.rectangle([20, 20, W - 21, H - 21], outline="#9aa0a6", width=2)

reg = "/usr/share/fonts/truetype/dejavu/"
title_font = ImageFont.truetype(reg + "DejaVuSans-Bold.ttf", 40)
h2_font = ImageFont.truetype(reg + "DejaVuSans-Bold.ttf", 28)
body_font = ImageFont.truetype(reg + "DejaVuSans.ttf", 27)
mono_font = ImageFont.truetype(reg + "DejaVuSansMono.ttf", 24)

x = 60
y = 64
d.text((x, y), "ОТЧЁТ О ТЕСТИРОВАНИИ № 42", font=title_font, fill="#1a1a1a")
y += 84
d.line([x, y, W - 60, y], fill="#1a1a1a", width=3)
y += 28

rows = [
    ("Система: ", "TuxOCR 1.0 (PP-OCRv5)"),
    ("Дата: ", "10 ноября 2026 года"),
    ("Оператор: ", "tux@localhost"),
]
for label, value in rows:
    d.text((x, y), label, font=h2_font, fill="#1a1a1a")
    wl = d.textlength(label, font=h2_font)
    d.text((x + wl, y), value, font=body_font, fill="#333333")
    y += 46

y += 18
d.line([x, y, W - 60, y], fill="#888888", width=1)
y += 24

paragraph = [
    "Проверка распознавания русского текста",
    "выполнена успешно. Контрольное слово:",
    "берёзка-33, код подтверждения 7215-XY.",
    "",
    "Скорость обработки: 987 символов в секунду.",
    "Точность распознавания: не ниже 97,5%.",
]
for line in paragraph:
    d.text((x, y), line, font=body_font, fill="#222222")
    y += 40

y += 22
d.text((x, y), "Статус: ДОПУЩЕНО", font=h2_font, fill="#00552e")
y += 54
d.text((x, y), "// подпись: ___________________ /tux/", font=mono_font, fill="#444444")

img.save("/home/z/my-project/public/sample/report-ru.png", optimize=True)
print("saved", img.size)
