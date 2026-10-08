import json, os, base64, time

settings_file = r'C:\Users\deanc\.config\openchamber\settings.json'
projects_dir = r'C:\Users\deanc\.config\openchamber\projects'

with open(settings_file, 'r', encoding='utf-8') as f:
    settings = json.load(f)

existing_projects = settings.get('projects', [])

target_projects = [
    {
        'path': r'D:\opencode\RootMyGalaxy',
        'label': 'RootMyGalaxy',
        'color': 'primary'
    },
    {
        'path': r'D:\opencode\工作交接',
        'label': '工作交接',
        'color': 'accent'
    },
    {
        'path': r'D:\分行大润发薪福通\0910',
        'label': '分行大润发薪福通(0910)',
        'color': 'warning'
    },
    {
        'path': r'D:\opencode\treefrogUI',
        'label': 'treefrogUI',
        'color': 'pink'
    },
    {
        'path': r'D:\opencode\opencli',
        'label': 'opencli',
        'color': 'success'
    },
    {
        'path': r'D:\opencode\视频会议转录',
        'label': '视频会议转录',
        'color': 'secondary'
    },
    {
        'path': r'D:\opencode\default',
        'label': '默认工作区(default)',
        'color': 'neutral'
    }
]

now_ms = int(time.time() * 1000)

for p_info in target_projects:
    norm_path = p_info['path'].replace('/', '\\')
    norm_path_fwd = norm_path.replace('\\', '/')
    p_id = 'path_' + base64.urlsafe_b64encode(norm_path_fwd.encode('utf-8')).decode('utf-8').rstrip('=')
    
    # Check if project file exists
    p_file = os.path.join(projects_dir, p_id + '.json')
    if not os.path.exists(p_file):
        with open(p_file, 'w', encoding='utf-8') as pf:
            json.dump({'version': 1, 'scheduledTasks': []}, pf, indent=2)
        print(f'Created project file: {p_id}.json')
    
    # Add to existing_projects if not present
    found = False
    for p in existing_projects:
        if p['path'].replace('/', '\\').lower() == norm_path.lower():
            found = True
            p['label'] = p_info['label']
            p['color'] = p_info['color']
            break
    if not found:
        existing_projects.append({
            'id': p_id,
            'path': norm_path,
            'label': p_info['label'],
            'color': p_info['color'],
            'addedAt': now_ms,
            'lastOpenedAt': now_ms
        })
        print(f"Added project to settings: {p_info['label']}")

root_id = 'path_' + base64.urlsafe_b64encode('D:/opencode/RootMyGalaxy'.encode('utf-8')).decode('utf-8').rstrip('=')
settings['projects'] = existing_projects
settings['activeProjectId'] = root_id
settings['lastDirectory'] = r'D:\opencode\RootMyGalaxy'

with open(settings_file, 'w', encoding='utf-8') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

print('Updated settings.json successfully!')
for p in settings['projects']:
    print(f" - {p['label']} -> {p['path']} ({p['id']})")
