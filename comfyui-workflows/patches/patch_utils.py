#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PyTorch safe globals patch for comfy/utils.py
Prevents safe globals registration exception on older torch builds.
"""

import sys
import os

def apply_patch(comfy_root: str):
    path = os.path.join(comfy_root, "comfy", "utils.py")
    if not os.path.exists(path):
        print(f"[Patch] {path} not found.")
        return
        
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    target = "torch.serialization.add_safe_globals([ModelCheckpoint, scalar, dtype, Float64DType, encode])"
    replacement = "if hasattr(torch.serialization, 'add_safe_globals'):\n        torch.serialization.add_safe_globals([ModelCheckpoint, scalar, dtype, Float64DType, encode])"

    if target in content:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content.replace(target, replacement))
        print(f"[Patch] Successfully applied safe globals patch to {path}")
    else:
        print(f"[Patch] {path} already patched or target not found.")

if __name__ == "__main__":
    comfy_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    apply_patch(comfy_dir)
