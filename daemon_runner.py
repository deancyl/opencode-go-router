import subprocess, time, sys, os, shutil

root_dir = os.path.dirname(os.path.abspath(__file__))
server_js = os.path.join(root_dir, 'server.js')

# Dynamically resolve node executable path
node_exe = shutil.which('node') or shutil.which('node.exe')
if not node_exe:
    candidates = [
        r'C:\Program Files\nodejs\node.exe',
        r'C:\Program Files (x86)\nodejs\node.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\node\node.exe'),
        '/usr/bin/node',
        '/usr/local/bin/node',
        os.path.expanduser('~/.bun/bin/bun')
    ]
    for c in candidates:
        if os.path.exists(c):
            node_exe = c
            break
if not node_exe:
    node_exe = 'node'

CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

print(f"[Supervisor] Starting background node server ({node_exe}) from {root_dir}...")
sys.stdout.flush()

while True:
    try:
        kwargs = {'cwd': root_dir}
        if CREATE_NO_WINDOW:
            kwargs['creationflags'] = CREATE_NO_WINDOW
        p = subprocess.Popen([node_exe, server_js], **kwargs)
        print(f"[Supervisor] Node process running with PID: {p.pid}")
        sys.stdout.flush()
        p.wait()
    except Exception as e:
        print(f"[Supervisor Error] {e}")
        sys.stdout.flush()
        time.sleep(2)
    time.sleep(1)
