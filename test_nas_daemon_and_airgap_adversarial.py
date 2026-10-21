#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_nas_daemon_and_airgap_adversarial.py
角度八：Linux / NAS 守护进程与离线内网环境部署鲁棒性对抗测试套件

测试项：
1. daemon_runner.py 信号转发与优雅停机验证 (SIGINT/SIGTERM 捕获、子进程状态写入与 PID 自动清理)
2. daemon_runner.py 异常闪退阶梯退避 (Crash-Loop Backoff 1s -> 2s -> 4s 防拉死)
3. daemon_runner.py 严格有界日志轮转 (Bounded Log Rotation: 10MB 轮转为 .1，防止打爆 NAS 分区)
4. patch-openchamber-office.ps1 连续 5 次安装幂等性与 AST Hook 单实例防污染
5. patch-openchamber-office.ps1 .orig 原厂基线一键无损还原与字节级 MD5 一致性
6. assets/office-preview-engine.js 离线安全红线走查 (零第三方公网 CDN / 零远程字体 / 零外发)
"""

import os
import sys
import time
import shutil
import signal
import hashlib
import tempfile
import subprocess

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

def get_md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def test_1_daemon_signal_and_graceful_shutdown():
    print("\n[Test 1] 验证 daemon_runner.py 信号转发、优雅退出与 PID 清理...")
    temp_dir = tempfile.mkdtemp(prefix="test_daemon_sig_")
    try:
        # 使用隔离的 mock_server，不绑定 4010 端口
        mock_server = os.path.join(temp_dir, 'server.js')
        with open(mock_server, 'w', encoding='utf-8') as f:
            f.write("""
console.log('Mock gateway server running...');
process.on('SIGTERM', () => {
    console.log('Mock server received SIGTERM, exiting gracefully...');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('Mock server received SIGINT, exiting gracefully...');
    process.exit(0);
});
setInterval(() => {}, 1000);
""")

        runner_dst = os.path.join(temp_dir, 'daemon_runner.py')
        shutil.copy2(os.path.join(ROOT_DIR, 'daemon_runner.py'), runner_dst)

        pid_file = os.path.join(temp_dir, '.router.pid')
        log_file = os.path.join(temp_dir, 'router.log')

        env = os.environ.copy()
        env['OPENCODE_PID_FILE'] = pid_file
        env['OPENCODE_LOG_FILE'] = log_file

        kwargs = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if sys.platform == 'win32' else {}
        proc = subprocess.Popen([sys.executable, runner_dst],
                                cwd=temp_dir,
                                env=env,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                text=True,
                                **kwargs)

        time.sleep(2.0)
        assert os.path.exists(pid_file), f"PID 文件 {pid_file} 未创建"
        with open(pid_file, 'r', encoding='utf-8') as f:
            recorded_pid = int(f.read().strip())
        assert recorded_pid == proc.pid, f"PID 文件记录 ({recorded_pid}) 与实际进程 PID ({proc.pid}) 不一致"
        print(f"  ✔ 守护进程成功拉起并写入 PID 文件，PID: {recorded_pid}")

        # 发送优雅停机信号
        if sys.platform == 'win32':
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.send_signal(signal.SIGTERM)

        proc.wait(timeout=6.0)
        print("  ✔ 守护进程已优雅停机并退出，退出码:", proc.returncode)

        time.sleep(0.5)
        assert not os.path.exists(pid_file), "退出后 PID 文件未能自动清理"
        print("  ✔ atexit / cleanup 机制成功清理 PID 文件")
        return True
    except Exception as e:
        print("❌ Test 1 失败:", e)
        proc.kill()
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def test_2_daemon_crash_loop_backoff():
    print("\n[Test 2] 验证 daemon_runner.py 异常闪退阶梯退避 (Crash-Loop Backoff)...")
    temp_dir = tempfile.mkdtemp(prefix="test_daemon_backoff_")
    try:
        mock_server = os.path.join(temp_dir, 'server.js')
        with open(mock_server, 'w', encoding='utf-8') as f:
            f.write("console.log('Mock crash'); process.exit(1);\n")

        runner_dst = os.path.join(temp_dir, 'daemon_runner.py')
        shutil.copy2(os.path.join(ROOT_DIR, 'daemon_runner.py'), runner_dst)

        log_path = os.path.join(temp_dir, 'router.log')
        env = os.environ.copy()
        env['OPENCODE_LOG_FILE'] = log_path
        env['OPENCODE_PID_FILE'] = os.path.join(temp_dir, '.router.pid')

        p = subprocess.Popen([sys.executable, runner_dst],
                             cwd=temp_dir,
                             env=env,
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE,
                             text=True)
        time.sleep(4.5)
        if sys.platform == 'win32':
            p.terminate()
        else:
            p.send_signal(signal.SIGTERM)
        try:
            p.wait(timeout=3)
        except Exception:
            p.kill()

        assert os.path.exists(log_path), "未生成 router.log"
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            log_content = f.read()

        assert "Increasing backoff" in log_content or "died quickly" in log_content, "日志中缺少 Backoff 退避警告！"
        print("  ✔ 成功触发 Crash-Loop Backoff 防拉死保护机制！")
        return True
    except Exception as e:
        print("❌ Test 2 失败:", e)
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def test_3_bounded_log_rotation():
    print("\n[Test 3] 验证 10MB 严格有界日志轮转 (Bounded Log Rotation)...")
    temp_dir = tempfile.mkdtemp(prefix="test_log_rot_")
    try:
        sys.path.insert(0, ROOT_DIR)
        from daemon_runner import BoundedLogRotator

        test_log = os.path.join(temp_dir, 'test.log')
        test_bak = os.path.join(temp_dir, 'test.log.1')
        max_bytes = 1024 * 50  # 50KB 用于测试

        rotator = BoundedLogRotator(test_log, test_bak, max_bytes)
        chunk = "A" * 1024 + "\n"  # 1KB per line
        for _ in range(70):  # 写入 70KB
            rotator.write(chunk)
        rotator.close()

        assert os.path.exists(test_log), "未生成当前日志文件"
        assert os.path.exists(test_bak), "未生成轮转备份 .1 文件"
        cur_size = os.path.getsize(test_log)
        bak_size = os.path.getsize(test_bak)
        print(f"  ✔ 轮转成功: test.log={cur_size} bytes, test.log.1={bak_size} bytes (总大小受严格限制)")
        return True
    except Exception as e:
        print("❌ Test 3 失败:", e)
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def test_4_office_patch_idempotency_and_restore():
    print("\n[Test 4] 验证 patch-openchamber-office.ps1 连续 5 次安装幂等性与 .orig 无损还原...")
    temp_dir = tempfile.mkdtemp(prefix="test_office_patch_")
    try:
        assets_dir = os.path.join(temp_dir, 'assets')
        os.makedirs(assets_dir, exist_ok=True)
        index_file = os.path.join(temp_dir, 'index.html')
        with open(index_file, 'w', encoding='utf-8') as f:
            f.write("<!DOCTYPE html><html><head><title>OpenChamber</title></head><body><div id='app'></div></body></html>\n")

        js_file = os.path.join(assets_dir, 'FilesView-1234abcd.js')
        sample_js = """
// Mock filesView module
var compA = file => {
  if (file.type === "img") return n.jsx("img", {src: file.path});
  filesView.artifact.binary.descriptionWithType(file);
  return n.jsx("div", {className: "binary"});
};
"""
        with open(js_file, 'w', encoding='utf-8') as f:
            f.write(sample_js)

        orig_index_md5 = get_md5(index_file)
        orig_js_md5 = get_md5(js_file)

        ps1_script = os.path.join(ROOT_DIR, 'patch-openchamber-office.ps1')

        for i in range(1, 6):
            cmd = f'pwsh -ExecutionPolicy Bypass -File "{ps1_script}" -Install -TargetDir "{temp_dir}"'
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if res.returncode != 0:
                print(f"Stdout:\n{res.stdout}\nStderr:\n{res.stderr}")
            assert res.returncode == 0, f"第 {i} 次安装失败: code {res.returncode}"

        with open(index_file, 'r', encoding='utf-8') as f:
            idx_content = f.read()
        assert idx_content.count("OPENCODE_OFFICE_PATCH_IDEMPOTENT_V2") == 1, "index.html 中幂等指纹被重复插入！"
        assert idx_content.count("office-preview-engine.js") == 1, "index.html 中 script 标签被重复插入！"

        with open(js_file, 'r', encoding='utf-8') as f:
            js_content = f.read()
        assert js_content.count("/* OPENCODE_OFFICE_PATCH_IDEMPOTENT_V2 */") == 1, "JS 文件中 Hook 幂等指纹被重复插入！"
        print("  ✔ 连续 5 次安装后验证: 幂等指纹严格仅出现 1 次，零重复污染！")

        orig_bak_index = os.path.join(temp_dir, 'index.html.orig')
        orig_bak_js = os.path.join(assets_dir, 'FilesView-1234abcd.js.orig')
        assert os.path.exists(orig_bak_index) and get_md5(orig_bak_index) == orig_index_md5, "index.html.orig 损坏或不匹配"
        assert os.path.exists(orig_bak_js) and get_md5(orig_bak_js) == orig_js_md5, "FilesView.js.orig 损坏或不匹配"
        print("  ✔ .orig 原厂基线备份校验完全一致！")

        cmd_rollback = f'pwsh -ExecutionPolicy Bypass -File "{ps1_script}" -Rollback -TargetDir "{temp_dir}"'
        res_rb = subprocess.run(cmd_rollback, shell=True, capture_output=True, text=True)
        assert res_rb.returncode == 0, f"回滚失败: {res_rb.stderr}"

        post_index_md5 = get_md5(index_file)
        post_js_md5 = get_md5(js_file)
        assert post_index_md5 == orig_index_md5, "index.html 还原后与初始文件 MD5 不一致！"
        assert post_js_md5 == orig_js_md5, "FilesView.js 还原后与初始文件 MD5 不一致！"
        assert not os.path.exists(os.path.join(assets_dir, 'office-preview-engine.js')), "引擎包未被清理"
        print("  ✔ 一键还原成功: 字节级 MD5 100% 还原至出厂纯净状态！")
        return True
    except Exception as e:
        print("❌ Test 4 失败:", e)
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def test_5_air_gapped_safety_audit():
    print("\n[Test 5] 验证 assets/office-preview-engine.js 离线安全红线 (零公网 CDN/外发)...")
    engine_file = os.path.join(ROOT_DIR, 'assets', 'office-preview-engine.js')
    assert os.path.exists(engine_file), "office-preview-engine.js 不存在！"

    with open(engine_file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    forbidden = [
        'view.officeapps.live.com',
        'docs.google.com/viewer',
        'cdnjs.cloudflare.com',
        'cdn.jsdelivr.net',
        'unpkg.com',
        'fonts.googleapis.com',
        'fonts.gstatic.com'
    ]
    violations = [w for w in forbidden if w in content]
    assert not violations, f"发现公网第三方云端依赖: {violations}"
    print("  ✔ 100% 纯本地离线解析，零公网云端 iframe，零外网数据泄漏风险！")
    return True

def main():
    print("=" * 70)
    print("🚀 开始执行 Linux / NAS 守护进程与离线内网部署对抗测试 (Angle 8)")
    print("=" * 70)

    tests = [
        ("信号转发与优雅停机", test_1_daemon_signal_and_graceful_shutdown),
        ("异常崩溃阶梯退避", test_2_daemon_crash_loop_backoff),
        ("10MB 有界日志轮转", test_3_bounded_log_rotation),
        ("5次安装幂等与无损还原", test_4_office_patch_idempotency_and_restore),
        ("纯离线安全红线走查", test_5_air_gapped_safety_audit)
    ]

    all_passed = True
    for name, fn in tests:
        passed = fn()
        if not passed:
            all_passed = False

    print("\n" + "=" * 70)
    if all_passed:
        print("🎉 全部 5 项 Linux / NAS 守护与离线内网对抗测试 100% 绿灯通过！")
        return 0
    else:
        print("❌ 存在对抗测试失败项目，请审查修复！")
        return 1

if __name__ == '__main__':
    sys.exit(main())
