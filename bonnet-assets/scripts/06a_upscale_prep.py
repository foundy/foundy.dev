"""Optional 2x experiment, step 1: dump the 4 front photos as PNG into /tmp/resr/in (input for realesrgan-ncnn-vulkan).
Step 2 (README): run the binary with IDENTICAL settings for all 4 colours. Step 3: 06b_upscale_compare.py."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
os.makedirs('/tmp/resr/in', exist_ok=True)
for c in COLORS:
    save_png(load(c, aligned=False), f'/tmp/resr/in/{c}.png')
