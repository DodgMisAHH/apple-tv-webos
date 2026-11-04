#!/usr/bin/env python3
"""Build launcher wallpaper assets from a licensed photo (Pillow)."""
import argparse
from pathlib import Path
from PIL import Image, ImageOps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wallpaper-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'app')
    args = parser.parse_args()
    (args.output / 'wallpapers').mkdir(parents=True, exist_ok=True)
    photo = ImageOps.fit(Image.open(args.wallpaper_source).convert('RGB'), (1920, 1080),
                        method=Image.Resampling.LANCZOS, centering=(.5, .5))
    photo.save(args.output / 'wallpapers' / 'misty.jpg', quality=88, optimize=True,
               progressive=True, subsampling=0)
    photo.resize((32, 18), Image.Resampling.BILINEAR).resize((384, 216), Image.Resampling.BILINEAR).save(
        args.output / 'wallpapers' / 'misty-frost.jpg', quality=80, optimize=True)
    print('Wallpaper 1920x1080; frost texture 384x216.')


if __name__ == '__main__':
    main()
