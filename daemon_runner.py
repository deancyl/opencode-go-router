import subprocess, time, sys, os

node_exe = r'C:\Program Files\nodejs\node.exe'
server_js = r'C:\Users\deanc\.opencode-go-router\server.js'
root_dir = r'C:\Users\deanc\.opencode-go-router'

CREATE_NO_WINDOW = 0x08000000

print("[Supervisor] Starting background node server with CREATE_NO_WINDOW...")
sys.stdout.flush()

while True:
    try:
        p = subprocess.Popen(
            [node_exe, server_js],
            cwd=root_dir,
            creationflags=CREATE_NO_WINDOW
        )
        print(f"[Supervisor] Node process running with PID: {p.pid}")
        sys.stdout.flush()
        p.wait()
    except Exception as e:
        print(f"[Supervisor Error] {e}")
        sys.stdout.flush()
        time.sleep(2)
    time.sleep(1)
