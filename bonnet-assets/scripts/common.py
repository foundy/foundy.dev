import os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.abspath(os.path.join(ROOT, '..', 'public', 'prototypes', 'assets'))
COLORS = ['green', 'red', 'skyblue', 'yellow']
OUT = os.path.join(ROOT, 'out')
os.makedirs(OUT, exist_ok=True)


def load(color, angle='front', aligned=True):
    ap = os.path.join(OUT, f'aligned-{color}-{angle}.png')
    if aligned and os.path.exists(ap):
        return np.array(Image.open(ap).convert('RGB'))
    return np.array(Image.open(os.path.join(SRC, f'bonnet-{color}-{angle}.webp')).convert('RGB'))


def save_png(arr, path):
    Image.fromarray(arr).save(path, optimize=True)
