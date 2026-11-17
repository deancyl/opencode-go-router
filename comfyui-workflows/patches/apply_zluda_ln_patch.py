#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ComfyUI ZLUDA LayerNorm Stability Patch
---------------------------------------
Prevents hipModuleLaunchKernelExt 0xC0000005 Access Violation on AMD RDNA3 (gfx1103)
by providing a stable CPU fallback for layer_norm when running under ZLUDA.
"""

import sys
import os

patch_code = '''
    # Safe LayerNorm patch for ZLUDA to avoid hipModuleLaunchKernelExt 0xC0000005 access violation
    _orig_ln = torch.nn.functional.layer_norm
    def _safe_zluda_layer_norm(input, normalized_shape, weight=None, bias=None, eps=1e-5):
        if input.is_cuda:
            input_cpu = input.to("cpu", dtype=torch.float32)
            w_cpu = weight.to("cpu", dtype=torch.float32) if weight is not None else None
            b_cpu = bias.to("cpu", dtype=torch.float32) if bias is not None else None
            res_cpu = _orig_ln(input_cpu, normalized_shape, w_cpu, b_cpu, eps)
            return res_cpu.to(input.device, dtype=input.dtype)
        return _orig_ln(input, normalized_shape, weight, bias, eps)
    torch.nn.functional.layer_norm = _safe_zluda_layer_norm
    print("  ::  Enabled safe layer_norm fallback for ZLUDA stability")
'''

def apply_patch(comfy_root: str):
    targets = [
        os.path.join(comfy_root, "comfy", "zluda.py"),
        os.path.join(comfy_root, "comfy", "customzluda", "zluda.py")
    ]
    for file_path in targets:
        if not os.path.exists(file_path):
            continue
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        if "_safe_zluda_layer_norm" not in content:
            marker = 'print("  ::  ZLUDA initialization complete")'
            if marker in content:
                new_content = content.replace(marker, patch_code + "\n    " + marker)
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"[Patch] Applied LayerNorm patch to {file_path}")
            else:
                print(f"[Patch] Marker not found in {file_path}, skipping.")
        else:
            print(f"[Patch] {file_path} already patched.")

if __name__ == "__main__":
    comfy_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    apply_patch(comfy_dir)
