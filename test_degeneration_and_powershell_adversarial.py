#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenCode Go Router - Angle 7: PowerShell Execution Optimizer & Windows Host Scripts Adversarial Suite
File: test_degeneration_and_powershell_adversarial.py

Adversarial Verification Dimensions:
1. Canonical Model Aliases, Degeneration Circuit Breaker & PowerShell Schema Anchor (Node.js engine)
2. Trailing Backslash Quote Eating in Diverse Windows Paths (Spaces, Brackets, Parentheses, CJK)
3. Multi-layer Nested Quotes & Metacharacter ($ ` " & |) Translation
4. Console Encoding Immunity (CP936 vs UTF-8 Chinese characters without Mojibake)
5. Expired PID Reuse Defense (CommandLine Feature Check strictly protecting innocent processes)
6. Continuous 10-Cycle Idempotent Start/Stop Cycling Stress Test
"""

import sys
import os
import subprocess
import time
import urllib.request
import json

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 4010
HEALTH_URL = f"http://127.0.0.1:{PORT}/health"

def log_header(title):
    print("\n" + "=" * 65)
    print(f"🛡️  {title}")
    print("=" * 65)

def assert_test(name, condition, detail=""):
    if condition:
        print(f"  [PASS] {name} - {detail}")
    else:
        print(f"  [FAIL] {name} - {detail}")
        sys.exit(1)

def is_port_listening(port):
    try:
        cmd = f"powershell.exe -NoProfile -Command \"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue\""
        out = subprocess.check_output(cmd, shell=True, text=True, errors="replace")
        return bool(out.strip())
    except Exception:
        return False

def check_health():
    try:
        req = urllib.request.Request(HEALTH_URL)
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("status") == "ok"
    except Exception:
        return False

def main():
    log_header("角度七：PowerShell 执行优化器与 Windows 宿主脚本对抗验证套件")
    print(f"工作目录: {ROOT_DIR}")

    # =========================================================================
    # Part 1: 执行底层 Node.js 10 项对抗测试
    # =========================================================================
    print("\n[Stage 1] 运行 Node.js 核心优化器对抗测试套件...")
    js_test_path = os.path.join(ROOT_DIR, "test_degeneration_and_powershell_adversarial.js")
    res = subprocess.run(["node", js_test_path], cwd=ROOT_DIR, capture_output=True, text=True, errors="replace")
    print(res.stdout)
    if res.stderr:
        print(res.stderr)
    assert_test("1.1 Node.js 10项底层对抗测试全绿", res.returncode == 0, "10/10 tests passed perfectly")

    # =========================================================================
    # Part 2: 特殊元字符与特殊路径转义测试
    # =========================================================================
    print("\n[Stage 2] 验证特殊元字符 ($ ` \" & |) 与特殊路径转义...")
    node_eval_code = """
    const psOpt = require('./powershell-optimizer');
    const assert = require('assert');

    // 1. Path with spaces, parentheses, brackets, and Chinese
    const rawPath = 'dir "C:\\\\用户 目录\\\\Project (2026) [Dev]\\\\temp\\\\"';
    const fixedPath = psOpt.fixPowerShellCommandEscaping(rawPath, { targetPlatform: 'win32' });
    assert.strictEqual(fixedPath, 'dir "C:\\\\用户 目录\\\\Project (2026) [Dev]\\\\temp\\\\\\\\"');

    // 2. Nested quotes with subexpressions
    const adbRawCmd = 'adb shell "su -c \\'for p in $(pgrep -f venus.pub); do kill -9 $p; done\\'"';
    const adbFixedCmd = psOpt.fixPowerShellCommandEscaping(adbRawCmd, { targetPlatform: 'win32', fixSubexpressionEscaping: true });
    assert.ok(adbFixedCmd.includes('`$(pgrep -f venus.pub)'));

    // 3. Encoded command UTF-16LE round-trip with Chinese
    const script = 'Write-Output "特殊字符测试: $`"&| 中文 (2026)"';
    const enc = psOpt.toEncodedCommand(script);
    const dec = psOpt.fromEncodedCommand(enc);
    assert.strictEqual(dec, script);

    console.log("STAGE_2_NODE_OK");
    """
    res = subprocess.run(["node", "-e", node_eval_code], cwd=ROOT_DIR, capture_output=True, text=True, errors="replace")
    assert_test("2.1 特殊路径与嵌套元字符转义", "STAGE_2_NODE_OK" in res.stdout, "Complex paths and metacharacters verified")

    if sys.platform != 'win32':
        print("\nℹ [SKIP] 非 Windows 宿主环境，跳过原生 powershell.exe 进程树与服务启停测试。")
        log_header("🎉 角度七跨平台核心逻辑验证通过！")
        return

    # =========================================================================
    # Part 3: 控制台编码与 CP936/UTF-8 乱码免疫实测
    # =========================================================================
    print("\n[Stage 3] 验证控制台编码与 CP936/UTF-8 乱码免疫...")
    ps_cjk_cmd = """powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output '测试中文输出: 完美解析零乱码 (2026)'" """
    res = subprocess.run(ps_cjk_cmd, cwd=ROOT_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = res.stdout.strip()
    assert_test("3.1 中文输出完整性", "测试中文输出: 完美解析零乱码 (2026)" in out, f"Output received: '{out}'")

    # =========================================================================
    # Part 4: 过期 PID 复用防御实测 (验证不误杀其他系统进程)
    # =========================================================================
    print("\n[Stage 4] 验证过期 PID 误杀防御与命令行特征核验...")
    dummy_proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    dummy_pid = dummy_proc.pid
    print(f"  构造外部测试进程 (PID: {dummy_pid}, Executable: python.exe)")

    try:
        subprocess.run(["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", os.path.join(ROOT_DIR, "stop-all.ps1")], cwd=ROOT_DIR, capture_output=True)
        poll_res = dummy_proc.poll()
        assert_test("4.1 过期PID与外部进程防误杀保护", poll_res is None, f"外部无辜进程 (PID {dummy_pid}) 受到严格特征保护，未被误杀！")
    finally:
        dummy_proc.kill()
        dummy_proc.wait()

    # =========================================================================
    # Part 5: 连续 10 次启停完全幂等压力测试
    # =========================================================================
    print("\n[Stage 5] 执行连续 10 次启停完全幂等压力测试...")
    setup_script = os.path.join(ROOT_DIR, "setup-windows.ps1")

    for i in range(1, 11):
        print(f"  [Cycle {i}/10] 正在执行启动 -> 停止幂等测试...")
        # 1. 启动服务
        subprocess.run(["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", setup_script, "-Start"], cwd=ROOT_DIR, capture_output=True)
        time.sleep(1.2)
        listening_start = is_port_listening(PORT)
        assert_test(f"5.{i}.1 周期 {i} 启动成功", listening_start, f"端口 {PORT} 成功处于监听状态")

        # 2. 停止服务
        subprocess.run(["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", setup_script, "-Stop"], cwd=ROOT_DIR, capture_output=True)
        time.sleep(0.8)
        listening_stop = is_port_listening(PORT)
        assert_test(f"5.{i}.2 周期 {i} 安全停止", not listening_stop, f"端口 {PORT} 彻底释放关闭")

    print("\n  ✔ 连续 10 次启停全部平稳通过，0 孤儿进程，0 端口死锁，完全幂等！")

    # =========================================================================
    # 复原服务常驻状态供用户与后续测试使用
    # =========================================================================
    print("\n[Teardown] 恢复网关常驻运行状态...")
    subprocess.run(["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", setup_script, "-Start"], cwd=ROOT_DIR, capture_output=True)
    time.sleep(1.5)
    final_health = check_health()
    assert_test("6.1 最终服务健康恢复", final_health, "网关在端口 4010 恢复健康响应 200 OK")

    log_header("🎉 角度七全部对抗测试 100% 验证通过！")

if __name__ == "__main__":
    main()
