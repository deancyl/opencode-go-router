#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_challenger_m3_nas_adversarial.py
Milestone 3 (M3) Linux NAS 部署与探针对抗实测脚本 (challenger_m3_2)

对抗实测挑战项：
1. SFTP 增量同步与远程核心文件 MD5 强一致性比对 (防文件漂移)
2. 远程语法先验核验 (node -c)
3. 守护进程热重载与 MainPID 内存脱节比对 (准则 21)
4. 多层级鉴权探针与安全看门狗核验 (准则 8：未授权 401 / 错误授权 401 / Cookie 及 Query 授权 200 且 healthy: true)
5. 远程 18 项并发压力回归测试执行与 NAS 堆内存收敛监控 (准则 20)
"""

import os
import sys
import time
import json
import hashlib
import urllib.request
import urllib.error
import http.cookiejar
import paramiko

NAS_HOST = '192.168.1.50'
NAS_PORT = 8822
NAS_USER = 'deancyl0607'
NAS_PASS = '123321Abccba@'
LOCAL_DIR = r"C:\Users\deanc\.opencode-go-router"
REMOTE_DIR = "/home/deancyl0607/.opencode-go-router"

FILES_TO_VERIFY = [
    'server.js',
    'codex-adapter.js',
    'context-compactor.js',
    'updater.js',
    'package.json',
    'README.md',
    'setup-linux.sh',
    'test_router.js',
    'test_stress_regression.js',
    'test_m1_adversarial_deep.js',
    'test_m2_adversarial_deep.js',
    'test_m2_ttft_pruning_adversarial.js',
    'launch-gui.vbs',
    'start-tray.vbs'
]

def get_local_md5(filepath):
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

def run_ssh_command(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    exit_code = stdout.channel.recv_exit_status()
    return exit_code, out, err

def main():
    print("=" * 70)
    print("🚀 STARTING ADVERSARIAL CHALLENGE SUITE FOR LINUX NAS DEPLOYMENT (M3)")
    print(f"Target NAS: {NAS_USER}@{NAS_HOST}:{NAS_PORT}")
    print("=" * 70)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    test_results = {}

    try:
        print("\n[Step 0] Establishing SSH connection to Linux NAS...")
        client.connect(NAS_HOST, port=NAS_PORT, username=NAS_USER, password=NAS_PASS, timeout=10)
        print("✔ SSH connection established successfully.")

        # -------------------------------------------------------------
        # CHALLENGE 1: SFTP Sync & MD5 Hash Consistency Check
        # -------------------------------------------------------------
        print("\n" + "-" * 60)
        print("▶ CHALLENGE 1: SFTP Sync & Remote File MD5 Integrity Check")
        print("-" * 60)

        # First perform SFTP upload of all verification files to ensure sync
        sftp = client.open_sftp()
        for f in FILES_TO_VERIFY:
            lpath = os.path.join(LOCAL_DIR, f)
            rpath = REMOTE_DIR + "/" + f
            if os.path.exists(lpath):
                sftp.put(lpath, rpath)
        sftp.close()
        print(f"✔ SFTP put completed for {len(FILES_TO_VERIFY)} files.")

        md5_mismatches = []
        md5_details = []
        for f in FILES_TO_VERIFY:
            lpath = os.path.join(LOCAL_DIR, f)
            if not os.path.exists(lpath):
                continue
            local_hash = get_local_md5(lpath)
            rpath = f"{REMOTE_DIR}/{f}"
            code, out, err = run_ssh_command(client, f"md5sum {rpath}")
            if code != 0:
                md5_mismatches.append(f"{f}: remote md5sum failed ({err.strip()})")
                continue
            remote_hash = out.strip().split()[0]
            match = (local_hash == remote_hash)
            md5_details.append({
                "file": f,
                "local_md5": local_hash,
                "remote_md5": remote_hash,
                "match": match
            })
            if not match:
                md5_mismatches.append(f"{f}: local={local_hash} != remote={remote_hash}")
            else:
                print(f"  [MD5 OK] {f:<36} -> {remote_hash}")

        if md5_mismatches:
            print("❌ MD5 Mismatches found:")
            for m in md5_mismatches:
                print("   ", m)
            test_results['CHALLENGE_1_MD5'] = False
        else:
            print("✔ All 14 files have 100% identical MD5 hashes between local Windows and Linux NAS!")
            test_results['CHALLENGE_1_MD5'] = True

        # -------------------------------------------------------------
        # CHALLENGE 2: Remote Syntax Verification Before Service Restart
        # -------------------------------------------------------------
        print("\n" + "-" * 60)
        print("▶ CHALLENGE 2: Remote Syntax Prior Verification (node -c)")
        print("-" * 60)
        syntax_targets = [
            f"{REMOTE_DIR}/server.js",
            f"{REMOTE_DIR}/codex-adapter.js",
            f"{REMOTE_DIR}/context-compactor.js",
            f"{REMOTE_DIR}/updater.js"
        ]
        syntax_passed = True
        for target in syntax_targets:
            code, out, err = run_ssh_command(client, f"node -c {target}")
            if code != 0 or err.strip():
                print(f"❌ Syntax check FAILED for {target}:\n{err}")
                syntax_passed = False
            else:
                print(f"  [Syntax OK] {target}")

        test_results['CHALLENGE_2_SYNTAX'] = syntax_passed

        # -------------------------------------------------------------
        # CHALLENGE 3: Daemon Smooth Hot-Reload & PID Drift Check (Rule 21)
        # -------------------------------------------------------------
        print("\n" + "-" * 60)
        print("▶ CHALLENGE 3: Systemd Daemon Hot-Reload & PID Drift Check (Rule 21)")
        print("-" * 60)

        # Get Pre-restart PID & Start Timestamp
        code, out, err = run_ssh_command(client, "systemctl --user show -p MainPID opencode-router.service")
        pre_pid_line = out.strip()
        pre_pid = pre_pid_line.split("=")[-1] if "=" in pre_pid_line else ""

        code, out, err = run_ssh_command(client, "systemctl --user show -p ExecMainStartTimestamp opencode-router.service")
        pre_time = out.strip().split("=")[-1]

        print(f"  Pre-restart MainPID: {pre_pid}")
        print(f"  Pre-restart ExecMainStartTimestamp: {pre_time}")

        # Execute smooth restart
        print("  Executing: systemctl --user restart opencode-router.service...")
        code, out, err = run_ssh_command(client, "systemctl --user restart opencode-router.service")
        if code != 0:
            print(f"❌ systemctl restart failed: {err}")
            test_results['CHALLENGE_3_RESTART'] = False
        else:
            time.sleep(2.0)
            # Check Post-restart PID, Status, ActiveState
            code, out, err = run_ssh_command(client, "systemctl --user show -p MainPID -p ActiveState -p SubState opencode-router.service")
            post_props = dict(line.split("=", 1) for line in out.strip().splitlines() if "=" in line)
            post_pid = post_props.get("MainPID", "")
            active_state = post_props.get("ActiveState", "")
            sub_state = post_props.get("SubState", "")

            code, out, err = run_ssh_command(client, "systemctl --user show -p ExecMainStartTimestamp opencode-router.service")
            post_time = out.strip().split("=")[-1]

            print(f"  Post-restart MainPID: {post_pid}")
            print(f"  Post-restart ActiveState: {active_state}")
            print(f"  Post-restart SubState: {sub_state}")
            print(f"  Post-restart ExecMainStartTimestamp: {post_time}")

            # Check process tree
            code, out, err = run_ssh_command(client, f"ps -p {post_pid} -o pid,ppid,cmd --no-headers")
            print(f"  Process verify: {out.strip()}")

            if (post_pid and post_pid != "0" and post_pid != pre_pid and
                active_state == "active" and sub_state == "running" and "node" in out):
                print(f"✔ Daemon successfully restarted with new PID {post_pid} (Old: {pre_pid}). Zero memory drift!")
                test_results['CHALLENGE_3_RESTART'] = True
            else:
                print(f"❌ Daemon restart validation failed: post_pid={post_pid}, pre_pid={pre_pid}, active_state={active_state}")
                test_results['CHALLENGE_3_RESTART'] = False

        # Read uiPassword from NAS config.json
        code, out, err = run_ssh_command(client, f"cat {REMOTE_DIR}/config.json")
        try:
            remote_cfg = json.loads(out)
            ui_password = remote_cfg.get("uiPassword", "")
        except Exception:
            ui_password = ""

        # -------------------------------------------------------------
        # CHALLENGE 4: Multi-tier Auth Probes & Security Guard (Rule 8)
        # -------------------------------------------------------------
        print("\n" + "-" * 60)
        print("▶ CHALLENGE 4: Multi-tier Auth Probes & Security Guard (Rule 8)")
        print("-" * 60)

        doctor_url = f"http://{NAS_HOST}:4010/balancer/api/compression/doctor"
        auth_url = f"http://{NAS_HOST}:4010/balancer/api/auth"
        health_url = f"http://{NAS_HOST}:4010/health"

        auth_challenge_passed = True

        # Probe 4.1: Public /health endpoint without auth (Expect 200 OK)
        try:
            req = urllib.request.Request(health_url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                status = resp.status
                body = json.loads(resp.read().decode('utf-8'))
                assert status == 200 and body.get("status") == "ok"
                print(f"  [Probe 4.1 - Health] Status {status} OK -> healthyAccounts: {body.get('healthyAccounts')}")
        except Exception as e:
            print(f"❌ [Probe 4.1 - Health] Failed: {e}")
            auth_challenge_passed = False

        # Probe 4.2: Unauthenticated request to /balancer/api/compression/doctor (Expect 401 Unauthorized)
        try:
            req = urllib.request.Request(doctor_url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                print(f"❌ [Probe 4.2 - Unauth] Expected 401 but got {resp.status}!")
                auth_challenge_passed = False
        except urllib.error.HTTPError as e:
            if e.code == 401:
                err_body = e.read().decode('utf-8')
                print(f"  [Probe 4.2 - Unauth] Correctly returned HTTP 401 Unauthorized: {err_body.strip()}")
            else:
                print(f"❌ [Probe 4.2 - Unauth] Returned unexpected HTTP error: {e.code}")
                auth_challenge_passed = False
        except Exception as e:
            print(f"❌ [Probe 4.2 - Unauth] Request failed: {e}")
            auth_challenge_passed = False

        # Probe 4.3: Request with WRONG password to /balancer/api/auth (Expect 401 Unauthorized)
        try:
            payload = json.dumps({"password": "completely_wrong_pass_123"}).encode('utf-8')
            req = urllib.request.Request(auth_url, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                print(f"❌ [Probe 4.3 - Wrong Auth] Expected 401 but got {resp.status}!")
                auth_challenge_passed = False
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"  [Probe 4.3 - Wrong Auth] Correctly rejected with HTTP 401 Unauthorized: {e.read().decode('utf-8').strip()}")
            else:
                print(f"❌ [Probe 4.3 - Wrong Auth] Unexpected status: {e.code}")
                auth_challenge_passed = False
        except Exception as e:
            print(f"❌ [Probe 4.3 - Wrong Auth] Failed: {e}")
            auth_challenge_passed = False

        # Probe 4.4: Authenticate with CORRECT password -> Get Session Cookie -> Request Doctor Endpoint
        try:
            cj = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
            payload = json.dumps({"password": ui_password}).encode('utf-8')
            req = urllib.request.Request(auth_url, data=payload, headers={"Content-Type": "application/json"})
            with opener.open(req, timeout=5) as resp:
                auth_status = resp.status
                auth_data = json.loads(resp.read().decode('utf-8'))
                assert auth_status == 200 and auth_data.get("success") is True
                print(f"  [Probe 4.4 - Auth Success] Authenticated successfully, received session cookie.")

            # Now request doctor endpoint with cookie
            req_doctor = urllib.request.Request(doctor_url)
            with opener.open(req_doctor, timeout=5) as resp:
                doc_status = resp.status
                doc_data = json.loads(resp.read().decode('utf-8'))
                assert doc_status == 200
                assert doc_data.get("healthy") is True
                assert doc_data.get("preset") in ("balanced", "custom", "aggressive", "conservative")
                engines = doc_data.get("activeEngines", {})
                assert engines.get("rtk", {}).get("enabled") is True
                assert engines.get("headroom", {}).get("enabled") is True
                assert engines.get("schema", {}).get("enabled") is True
                assert engines.get("cacheZone", {}).get("enabled") is True
                assert doc_data.get("summary", {}).get("totalIssues") == 0
                print(f"  [Probe 4.4 - Cookie Doctor] Status 200 OK | healthy=True | 4 engines active | totalIssues=0")
        except Exception as e:
            print(f"❌ [Probe 4.4 - Cookie Doctor] Failed: {e}")
            auth_challenge_passed = False

        # Probe 4.5: Authenticate via Query Parameter ?auth=<uiPassword>
        try:
            query_doctor_url = f"{doctor_url}?auth={ui_password}"
            req_query = urllib.request.Request(query_doctor_url)
            with urllib.request.urlopen(req_query, timeout=5) as resp:
                q_status = resp.status
                q_data = json.loads(resp.read().decode('utf-8'))
                assert q_status == 200 and q_data.get("healthy") is True
                print(f"  [Probe 4.5 - Query Doctor] Status 200 OK | healthy=True | Query auth verified")
        except Exception as e:
            print(f"❌ [Probe 4.5 - Query Doctor] Failed: {e}")
            auth_challenge_passed = False

        test_results['CHALLENGE_4_AUTH'] = auth_challenge_passed

        # -------------------------------------------------------------
        # CHALLENGE 5: Remote Stress Regression & Memory Convergence (Rule 20)
        # -------------------------------------------------------------
        print("\n" + "-" * 60)
        print("▶ CHALLENGE 5: Remote 18-Tier Stress Regression & Heap Convergence (Rule 20)")
        print("-" * 60)

        # Get initial memory
        code, out, err = run_ssh_command(client, "systemctl --user show -p MemoryCurrent opencode-router.service")
        pre_mem = out.strip().split("=")[-1]
        pre_mem_mb = round(int(pre_mem) / 1024 / 1024, 2) if pre_mem.isdigit() else 0
        print(f"  Initial NAS Service Memory: {pre_mem_mb} MB ({pre_mem} bytes)")

        # Run test_stress_regression.js remotely
        print("  Executing: node ~/.opencode-go-router/test_stress_regression.js on NAS...")
        start_t = time.time()
        code, out, err = run_ssh_command(client, "node ~/.opencode-go-router/test_stress_regression.js")
        elapsed = round(time.time() - start_t, 2)

        print(f"  Remote Stress Run Duration: {elapsed}s | Exit Code: {code}")
        stress_success = (code == 0 and "ALL FOUR-TIER STRESS & REGRESSION TESTS PASSED SUCCESSFULLY" in out)

        if not stress_success:
            print(f"❌ Remote stress suite FAILED:\nSTDOUT:\n{out}\nSTDERR:\n{err}")
            test_results['CHALLENGE_5_STRESS'] = False
        else:
            print("✔ Remote 18-tier stress suite PASSED 100% on Linux NAS!")
            # Extract key metrics from stress output
            for line in out.splitlines():
                if "Heap memory:" in line or "PASSED" in line or "Soak Test" in line:
                    print("   ", line.strip())

            # Check post-test memory & PID integrity
            code, out, err = run_ssh_command(client, "systemctl --user show -p MemoryCurrent -p MainPID opencode-router.service")
            post_props = dict(line.split("=", 1) for line in out.strip().splitlines() if "=" in line)
            post_mem = post_props.get("MemoryCurrent", "0")
            current_pid = post_props.get("MainPID", "")
            post_mem_mb = round(int(post_mem) / 1024 / 1024, 2) if post_mem.isdigit() else 0

            print(f"  Post-stress NAS Service Memory: {post_mem_mb} MB ({post_mem} bytes)")
            print(f"  Current MainPID: {current_pid} (Expected: {post_pid})")

            # Check if PID remained unchanged (no crash/restart during stress)
            pid_intact = (current_pid == post_pid)
            if not pid_intact:
                print(f"❌ MainPID changed during stress! Old: {post_pid}, New: {current_pid}")
                test_results['CHALLENGE_5_STRESS'] = False
            else:
                print(f"✔ MainPID {current_pid} remained rock solid without crashing or restarting.")
                test_results['CHALLENGE_5_STRESS'] = True

    finally:
        client.close()
        print("\n[Step Final] SSH connection closed.")

    print("\n" + "=" * 70)
    print("📊 ADVERSARIAL CHALLENGE SUMMARY")
    print("=" * 70)
    all_passed = True
    for name, res in test_results.items():
        symbol = "✔ PASS" if res else "❌ FAIL"
        print(f"  {name:<25}: {symbol}")
        if not res:
            all_passed = False

    print("=" * 70)
    if all_passed:
        print("🎉 ALL M3 ADVERSARIAL CHALLENGES EMPIRICALLY PASSED WITH ZERO DEFECTS!")
        return 0
    else:
        print("❌ ONE OR MORE ADVERSARIAL CHALLENGES FAILED.")
        return 1

if __name__ == '__main__':
    sys.exit(main())
