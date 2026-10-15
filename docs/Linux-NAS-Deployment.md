# Linux 与 NAS 私有服务器部署指南 (Linux/NAS Guide)

本文档面向 **Debian、Ubuntu、fnOS (飞牛私有云)、群晖 Synology (DSM 7+)、TrueNAS、Unraid** 及其他 Linux 服务器用户，提供高可用守护部署与配置全解。

---

## 🐧 平台支持矩阵

| 平台类型 | 守护模式 | 路径特征 | 推荐安装方式 |
| :--- | :--- | :--- | :--- |
| **fnOS (飞牛私有云)** | systemd --user / nohup | `/vol1` ~ `/vol4` 多存储卷 | `install.sh` 远程极速安装 |
| **群晖 Synology DSM (7.x)** | systemd / nohup 回退 | `/volume1` ~ `/volumeX` 存储卷 | `./setup-linux.sh` 本地向导 |
| **Debian / Ubuntu Server** | systemd --user | `/home/<user>/` 标准用户目录 | `curl ... | bash` 极速安装 |
| **Docker 容器环境** | 容器 Entrypoint | 挂载卷映射路径 | `setup-linux.sh --all` 静默部署 |

---

## 🚀 推荐部署步骤

### 1. 运行一键配置向导
在 NAS 终端中执行：
```bash
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash
```
或下载仓库后本地运行：
```bash
git clone https://github.com/deancyl/opencode-go-router.git ~/.opencode-go-router
cd ~/.opencode-go-router
chmod +x *.sh
./setup-linux.sh
```

### 2. 菜单项功能说明
- `[1] 一键全自动全套配置`：推荐新机器首选。自动安装依赖、生成网关配置、注册守护常驻、并绑定本地 OpenCode / OpenChamber / OMO / Goal；
- `[2] 仅部署/更新 4010 网关后台服务`：仅更新网关本身，不修改客户端现有绑定；
- `[3] 配置双账号密钥与 Web 访问安全密码`：设置两个 OpenCode 订阅密钥及管理面板访问密码；
- `[4] 一键绑定本地客户端`：重新执行客户端无损合流与生态接入；
- `[7] 查看运行状态与官方配额`：终端实时呈现服务运行指标与 5h/周/月 官方配额；
- `[8] 运行健康体检 (Doctor) 与自动修复`：全盘扫描单复数配置冲突、端口死链、Office 离线补丁并一键自愈。

---

## 🔒 局域网访问与安全门禁

在私有服务器上，网关默认监听 `0.0.0.0:4010`，以便局域网内所有电脑、手机、平板访问。

### 1. 访问密码保护
- 在 `config.json` 中配置 `"uiPassword": "你的密码"`，或在环境变量中设置 `OPENCODE_ROUTER_PASSWORD="你的密码"`；
- 开启后，访问 `/balancer/ui` 管理面板和敏感 API（配置修改、密钥查看、组件更新）时必须进行密码认证；
- 前端基于 HttpOnly Cookie 与 Bearer Token 双重认证机制，保障安全。

### 2. 跨平台多卷挂载自适应
在 fnOS 或群晖 DSM 等多卷存储架构下，OpenChamber 或 OpenCode 的数据目录可能位于 `/vol3/1000/docker/...` 或 `/volume1/docker/...`。
网关内置多卷探测算法，自动搜寻所有挂载点，精确命中并完成配置合流与离线 Office 补丁挂载。

---

## 🛠️ 常用管理指令

```bash
# 启动网关服务：
./start-linux.sh

# 停止网关服务：
./stop-linux.sh

# 查看当前运行状态与连通性：
./status-linux.sh

# 运行自动化体检与自愈：
./setup-linux.sh --doctor
# 或执行自动修复：
./setup-linux.sh --repair
```
