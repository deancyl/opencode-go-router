#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
daemon_runner.py - OpenCode Go Router 生产级跨平台后台守护进程
特性：
1. 信号捕获与优雅停机转发 (SIGTERM/SIGINT/SIGHUP -> Node 子进程 flush 落盘与优雅退出)
2. 异常闪退阶梯退避防拉死机制 (Crash-Loop Backoff: 1s -> 2s -> ... -> 最大 60s)
3. 严格有界日志轮转 (10MB 自动轮转为 router.log.1，防止占满 NAS 磁盘配额)
4. 子进程管道缓冲实时主动排空 (杜绝 64KB OS Pipe 挂死与僵死孤儿进程)
5. 进程 PID 文件安全生命周期管理 (启动写入、退出自动清理)
"""

import os
import sys
import time
import shutil
import signal
import atexit
import threading
import subprocess

root_dir = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = root_dir
SERVER_JS = os.path.join(ROOT_DIR, 'server.js')
PID_FILE = os.environ.get('OPENCODE_PID_FILE') or os.path.join(ROOT_DIR, '.router.pid')
LOG_FILE = os.environ.get('OPENCODE_LOG_FILE') or os.path.join(ROOT_DIR, 'router.log')
LOG_BACKUP = LOG_FILE + '.1'
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10 MB

CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

shutdown_requested = False
current_child = None
current_child_lock = threading.Lock()

class BoundedLogRotator:
    """线程安全的有界日志写入与轮转器 (支持延迟打开与共享防锁)"""
    def __init__(self, log_path, backup_path, max_bytes):
        self.log_path = log_path
        self.backup_path = backup_path
        self.max_bytes = max_bytes
        self.lock = threading.Lock()
        self._file = None

    def _ensure_file(self):
        if self._file and not self._file.closed:
            return True
        try:
            self._check_rotation()
            self._file = open(self.log_path, 'a', encoding='utf-8', errors='replace')
            return True
        except Exception:
            return False

    def _check_rotation(self):
        try:
            if os.path.exists(self.log_path) and os.path.getsize(self.log_path) >= self.max_bytes:
                if self._file and not self._file.closed:
                    try:
                        self._file.flush()
                        self._file.close()
                    except Exception:
                        pass
                if os.path.exists(self.backup_path):
                    try:
                        os.remove(self.backup_path)
                    except Exception:
                        pass
                try:
                    os.rename(self.log_path, self.backup_path)
                except Exception:
                    pass
        except Exception:
            pass

    def write(self, data_str):
        with self.lock:
            try:
                if not self._ensure_file():
                    return
                self._file.write(data_str)
                self._file.flush()
                if os.path.exists(self.log_path) and os.path.getsize(self.log_path) >= self.max_bytes:
                    try:
                        if self._file and not self._file.closed:
                            self._file.close()
                    except Exception:
                        pass
                    self._ensure_file()
            except Exception:
                pass

    def close(self):
        with self.lock:
            try:
                if self._file and not self._file.closed:
                    self._file.flush()
                    self._file.close()
            except Exception:
                pass

_log_rotator_instance = None
def get_log_rotator():
    global _log_rotator_instance
    if _log_rotator_instance is None:
        _log_rotator_instance = BoundedLogRotator(LOG_FILE, LOG_BACKUP, MAX_LOG_SIZE)
    return _log_rotator_instance

def log_message(prefix, msg):
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    formatted = f"[{timestamp}] [{prefix}] {msg}\n"
    sys.stdout.write(formatted)
    sys.stdout.flush()
    try:
        get_log_rotator().write(formatted)
    except Exception:
        pass

def resolve_node_executable():
    """解析可用的 node / bun 可执行文件路径"""
    custom_node = os.environ.get('OPENCODE_NODE') or os.environ.get('NODE_PATH')
    if custom_node and os.path.exists(custom_node):
        return custom_node

    candidates = [
        shutil.which('node'),
        shutil.which('node.exe'),
        shutil.which('bun'),
        '/usr/bin/node',
        '/usr/local/bin/node',
        '/bin/node',
        os.path.expanduser('~/.bun/bin/bun'),
        os.path.expanduser('~/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | tail -n 1)/bin/node'),
        r'C:\Program Files\nodejs\node.exe',
        r'C:\Program Files (x86)\nodejs\node.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\node\node.exe')
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return 'node'

def write_pid_file(pid):
    try:
        with open(PID_FILE, 'w', encoding='utf-8') as f:
            f.write(str(pid) + '\n')
    except Exception as e:
        log_message('Supervisor Error', f"Failed to write PID file {PID_FILE}: {e}")

def cleanup_pid_file():
    try:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
    except Exception:
        pass

atexit.register(cleanup_pid_file)

def handle_shutdown_signal(signum, frame):
    """优雅捕获停止信号并转发给 Node 子进程"""
    global shutdown_requested, current_child
    if shutdown_requested:
        return
    shutdown_requested = True
    sig_name = getattr(signal, 'Signals', {}).get(signum, f"Signal {signum}") if hasattr(signal, 'Signals') else f"Signal {signum}"
    log_message('Supervisor', f"Captured {sig_name}, initiating graceful shutdown...")

    with current_child_lock:
        child = current_child

    if child and child.poll() is None:
        try:
            log_message('Supervisor', f"Forwarding termination signal to child Node process (PID: {child.pid})...")
            if sys.platform != 'win32':
                child.send_signal(signal.SIGTERM)
            else:
                child.terminate()
        except Exception as e:
            log_message('Supervisor Error', f"Failed to signal child: {e}")

def pump_stream(stream, prefix):
    """主动排空子进程流，杜绝 64KB OS Pipe 挂死并写入轮转日志"""
    try:
        rotator = get_log_rotator()
        for line in iter(stream.readline, ''):
            if not line:
                break
            rotator.write(f"[{prefix}] {line}")
    except Exception:
        pass
    finally:
        try:
            stream.close()
        except Exception:
            pass

def main():
    global current_child, shutdown_requested

    # 注册系统停止信号
    signal.signal(signal.SIGINT, handle_shutdown_signal)
    signal.signal(signal.SIGTERM, handle_shutdown_signal)
    if hasattr(signal, 'SIGHUP'):
        signal.signal(signal.SIGHUP, handle_shutdown_signal)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, handle_shutdown_signal)

    # 记录 Supervisor 自身 PID
    write_pid_file(os.getpid())

    node_bin = resolve_node_executable()
    log_message('Supervisor', f"Starting resilient gateway supervisor (Node: {node_bin}, Dir: {ROOT_DIR})")

    backoff_delay = 1.0
    max_backoff = 60.0
    stable_uptime_threshold = 30.0

    while not shutdown_requested:
        start_time = time.time()
        kwargs = {
            'cwd': ROOT_DIR,
            'stdout': subprocess.PIPE,
            'stderr': subprocess.PIPE,
            'text': True,
            'bufsize': 1,
            'encoding': 'utf-8',
            'errors': 'replace'
        }
        if CREATE_NO_WINDOW:
            kwargs['creationflags'] = CREATE_NO_WINDOW

        try:
            child = subprocess.Popen([node_bin, SERVER_JS], **kwargs)
            with current_child_lock:
                current_child = child

            log_message('Supervisor', f"Node gateway process spawned with PID: {child.pid}")

            # 启动守护线程主动排空 stdout/stderr
            t_out = threading.Thread(target=pump_stream, args=(child.stdout, 'Node:stdout'), daemon=True)
            t_err = threading.Thread(target=pump_stream, args=(child.stderr, 'Node:stderr'), daemon=True)
            t_out.start()
            t_err.start()

            # 轮询等待子进程退出
            while child.poll() is None:
                if shutdown_requested:
                    break
                time.sleep(0.5)

            if shutdown_requested:
                log_message('Supervisor', "Waiting up to 5s for child process to flush state and shutdown cleanly...")
                try:
                    child.wait(timeout=5.0)
                    log_message('Supervisor', "Child process exited cleanly.")
                except subprocess.TimeoutExpired:
                    log_message('Supervisor Warning', "Child process timed out after 5s; sending SIGKILL...")
                    try:
                        child.kill()
                        child.wait(timeout=2.0)
                    except Exception:
                        pass
                break

            # 子进程自行退出 / 崩溃
            exit_code = child.poll()
            uptime = time.time() - start_time
            log_message('Supervisor Warning', f"Child Node process exited with code {exit_code} (uptime: {uptime:.1f}s)")

            # Crash-Loop Backoff 阶梯退避
            if uptime >= stable_uptime_threshold:
                backoff_delay = 1.0
                log_message('Supervisor', f"Process ran stably ({uptime:.1f}s >= {stable_uptime_threshold}s). Resetting backoff to 1.0s.")
            else:
                backoff_delay = min(backoff_delay * 2.0, max_backoff)
                log_message('Supervisor Warning', f"Process died quickly. Increasing backoff to {backoff_delay:.1f}s to prevent crash-loop.")

            # 细粒度可中断等待
            sleep_step = 0.2
            slept = 0.0
            while slept < backoff_delay and not shutdown_requested:
                time.sleep(min(sleep_step, backoff_delay - slept))
                slept += sleep_step

        except Exception as e:
            log_message('Supervisor Error', f"Exception in supervisor process loop: {e}")
            if shutdown_requested:
                break
            time.sleep(2.0)

    log_message('Supervisor', "Supervisor loop terminated. Cleaning up resources...")
    cleanup_pid_file()
    if _log_rotator_instance:
        _log_rotator_instance.close()
    sys.exit(0)

if __name__ == '__main__':
    main()
