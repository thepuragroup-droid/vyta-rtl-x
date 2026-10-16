"""
Bold versions of the email icons: thickens each navy icon's strokes and
writes <name>-navy-bold.png beside it. The cover benefit lists (Welcome 2,
Cart 2) use these.

Usage:
  python3 scripts/email-icons-bold.py public/images/email/icons public/images/email/icons 5

The last argument is how far the strokes grow (an odd number of pixels).
"""
import sys, glob, os
from PIL import Image, ImageFilter
src_dir, out_dir, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
for f in sorted(glob.glob(f'{src_dir}/*-navy.png')):
    im = Image.open(f).convert('RGBA')
    r, g, b, a = im.split()
    # Thicken the strokes: grow the alpha outward, then soften the edge.
    a2 = a.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.GaussianBlur(0.6))
    color = Image.new('RGBA', im.size, (7, 32, 58, 255))  # the ink navy
    color.putalpha(a2)
    out = os.path.join(out_dir, os.path.basename(f).replace('-navy.png', '-navy-bold.png'))
    color.save(out, optimize=True)
    print(os.path.basename(out))
