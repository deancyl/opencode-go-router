# Air-Gapped Office 全格式离线安全预览引擎 (Office Engine)

本文档介绍 OpenChamber 内嵌的 **Office 全格式本地离线安全预览引擎**的设计原理、安全红线与使用方式。

---

## 🛡️ 离线安全红线 (Air-Gapped Safety)

在日常私有编码与工作流中，项目经常涉及商业合同、财务报表、需求文档与敏感架构设计。
- **严禁公网云端预览 iframe**：绝大部分 Web 客户端采用微软或谷歌的云端公网预览服务（如 `view.officeapps.live.com`），这会将本地私有文件上传到第三方服务器，存在严重的安全合规隐患；
- **100% 纯本地离线解析沙箱**：OpenCode Go Router 提供的预览引擎在浏览器与桌面沙箱内纯本地运行（基于本地 JS 离线解析驱动），零网络外发、零第三方云端依赖，绝对保障敏感数据私密性。

---

## 📄 支持格式与渲染能力

| 文件类型 | 扩展名 | 离线解析技术 | 高性能特性 |
| :--- | :--- | :--- | :--- |
| **Word 文档** | `.docx`, `.doc` | `docx-preview` 本地渲染器 | 高保真排版、图文混排、表格样式 |
| **Excel 表格** | `.xlsx`, `.xls` | SheetJS 本地工作表解析 | 1000行虚拟分页切片，防止超大表格卡死浏览器 |
| **PowerPoint 演示文稿** | `.pptx`, `.ppt` | 本地幻灯片矢量解构引擎 | 幻灯片逐页翻页浏览、大纲与图表展示 |

---

## ⚡ 双轨原生联动：在本地应用中打开

在 OpenChamber 文件预览界面的右上角，内嵌了 **【在本地应用中打开】** 快捷按钮：
- 用户点击后，智能网关通过安全的本地系统调用接口（`/balancer/api/open-file`）；
- 毫秒级唤起系统安装的原厂办公软件（如 Microsoft Office、WPS Office 等）；
- 配备严格的扩展名白名单与路径穿越防御机制，杜绝恶意脚本执行。

---

## 跨平台挂载与还原命令

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\patch-openchamber-office.ps1 -Install
powershell -ExecutionPolicy Bypass -File .\patch-openchamber-office.ps1 -Status
powershell -ExecutionPolicy Bypass -File .\patch-openchamber-office.ps1 -Rollback

# Linux / NAS (Bash)
./patch-openchamber-office.sh install
./patch-openchamber-office.sh status
./patch-openchamber-office.sh rollback
```
网关在每次执行一键体检（Doctor）或更新 OpenChamber 时，均会自动检测补丁挂载状态并自动重挂载，保障离线预览持久可用。
