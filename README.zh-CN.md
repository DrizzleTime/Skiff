<div align="right">
  <a href="./README.md">English</a>
</div>

<div align="center">
  <img src="src-tauri/icons/tray.png" alt="Skiff" width="64" height="64" />

  <p>
    Skiff 是一个本地跨平台磁盘清理工具，用于在删除前检查缓存、应用、重复文件和大文件。
  </p>

  <p>
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111" />
    <img alt="Rust" src="https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white" />
    <img alt="Linux" src="https://img.shields.io/badge/Linux-supported-FCC624?logo=linux&logoColor=111111" />
    <img alt="macOS" src="https://img.shields.io/badge/macOS-supported-000000?logo=apple&logoColor=white" />
    <img alt="Windows" src="https://img.shields.io/badge/Windows-supported-0078D4?logo=windows&logoColor=white" />
    <img alt="Bun" src="https://img.shields.io/badge/Bun-runtime-000000?logo=bun&logoColor=white" />
  </p>
</div>

## 界面预览

Skiff 提供两种主要流程：经典清理界面用于直接检查和处理文件，AI 空间分析界面用于理解空间占用并获取清理建议。

### 经典清理工具界面

查看磁盘占用、缓存清理目标、大文件、重复文件和应用清理项。

<a href="https://shiyu.dev/uploads/2026/06/3d31c75b-196d-473c-88f9-0f04a78ec0c8.png">
  <img src="https://shiyu.dev/uploads/2026/06/3d31c75b-196d-473c-88f9-0f04a78ec0c8.png" alt="Skiff 经典清理工具界面" width="100%" />
</a>

### AI 智能空间分析界面

基于本地扫描结果分析空间占用，并给出可理解的清理建议。

<a href="https://shiyu.dev/uploads/2026/06/5efe71a7-0751-415f-b772-662866e429f1.png">
  <img src="https://shiyu.dev/uploads/2026/06/5efe71a7-0751-415f-b772-662866e429f1.png" alt="Skiff AI 智能空间分析界面" width="100%" />
</a>

## 功能

- **磁盘总览**：读取当前用户主目录所在磁盘的总容量、已用空间、可用空间、使用比例和磁盘位置。
- **垃圾清理**：扫描并清理平台相关的常见缓存目录，例如系统缓存、浏览器缓存、开发工具缓存、Linux Flatpak 和 Arch 包缓存、macOS Homebrew 缓存。
- **大文件扫描**：默认扫描用户常用目录中的大文件，支持选择后移入系统回收站。
- **重复文件扫描**：按文件大小、内容哈希和逐字节比对查找重复文件，选择后移入系统回收站。
- **应用清理**：读取 Linux 软件包、macOS 应用与 Homebrew 包，或 Windows 卸载注册表项，支持筛选、搜索、选择和确认卸载。
- **清理记录**：展示最近清理、移动到回收站、应用卸载和 Agent 清理结果；主界面保留最近 50 次记录。
- **设置**：调整文件扫描路径、大文件扫描阈值、重复文件扫描阈值和高级功能入口显示。自定义路径必须位于当前用户 HOME 目录内。
- **托盘行为**：关闭主窗口时隐藏到托盘，而不是直接退出应用。

## 安全边界

Skiff 会执行真实的文件删除和软件包卸载操作。当前实现有以下边界：

- 本地应用和 CLI 支持 Linux、macOS、Windows。每个平台有独立的清理目标列表。
- 垃圾清理会删除预定义缓存目录的内容，部分包管理缓存会调用系统命令。
- 大文件和重复文件处理只允许作用于当前用户 HOME 目录下的普通文件，默认会移入系统回收站，而不是直接永久删除。清空回收站后才不可恢复。
- 大文件和重复文件默认只扫描桌面、文档、下载、媒体、代码/项目目录和常见云盘目录；`.config`、`AppData`、macOS `Library` 等应用数据目录需要在设置中手动加入。
- 重复文件识别会先按大小分组，再计算内容哈希，最后逐字节确认内容一致。
- 应用卸载会调用平台登记的卸载机制：
  - APT：`apt-get remove -y`
  - RPM：优先 `dnf remove -y`，其次 `yum remove -y`、`zypper --non-interactive remove`，最后 `rpm -e`
  - Pacman：`pacman -R --noconfirm -- <package>`
  - Flatpak：`flatpak uninstall -y --app`
  - macOS `.app`：将应用包移入废纸篓
  - Homebrew：`brew uninstall --formula` 或 `brew uninstall --cask`
  - Windows：读取注册表中的 `UninstallString` / `QuietUninstallString` 并执行
- Linux 中需要管理员权限的命令会优先通过 `pkexec` 启动。macOS 和 Windows 可能显示系统原生授权提示。
- Flatpak 应用数据清理属于高风险操作，会删除应用配置、登录状态、本地数据库和其他本地应用数据。
- CLI 中的删除、清理和卸载命令必须显式传入 `--yes`，否则不会执行。
- CLI 的 `files delete` 和桌面端文件处理一样，会把文件移入系统回收站。
- 当前仓库中的 macOS 和 Windows 本地构建没有配置代码签名、Apple 公证或 Windows 签名。

## 普通用户使用

从 [GitHub Releases](https://github.com/DrizzleTime/Skiff/releases) 下载对应系统的安装包。当前发布产物面向 Linux、macOS ARM64 和 Windows。

macOS 和 Windows 安装包目前未签名。系统可能显示安全警告；这是分发信任问题，不代表应用已经通过平台签名验证。

## 技术栈

- 桌面框架：Tauri 2
- 后端：Rust 2021
- 前端：React 19、TypeScript、Vite
- 样式和组件：Tailwind CSS 4、lucide-react、自定义 CSS
- 包管理：Bun
- 本地设置：类 Unix 系统使用 `~/.config/skiff/settings.json`，Windows 使用对应的用户配置目录。

## 开发

### 环境要求

- Linux、macOS 或 Windows 桌面环境
- Rust stable
- Bun
- Tauri 2 所需平台依赖。Linux 需要 WebKitGTK 等桌面库。

### 安装依赖

```bash
bun install
```

### 启动前端开发服务器

```bash
bun run dev
```

前端开发服务器由 Vite 提供。

### 启动桌面应用开发模式

```bash
bun run tauri dev
```

Tauri 配置中使用的前端开发地址是：

```text
http://localhost:1420
```

## 构建

### 构建前端

```bash
bun run build
```

该命令会先执行 TypeScript 检查，再生成 Vite 构建产物到 `dist/`。

### 构建桌面安装包

```bash
bun run tauri build
```

本地平台安装包命令：

```bash
bun run tauri:build:linux
bun run tauri:build:mac
bun run tauri:build:windows
```

Tauri 会根据 `src-tauri/tauri.conf.json` 为当前操作系统生成桌面应用和安装包。Windows 命令会生成 NSIS `.exe` 安装器。macOS 和 Windows 的正式分发仍需要在仓库外配置签名。

## CLI

`skiff` 无参数时启动桌面界面；传入子命令时进入 CLI 模式。

```bash
skiff info
skiff disk
skiff cleanup scan
skiff cleanup run --ids thumbnail-cache,go-cache --yes
skiff files large --min-size 500M --limit 80
skiff files duplicates --min-size 10M --group-limit 40
skiff files delete --path /home/user/Downloads/example.iso --yes
skiff agents scan
skiff agents clean --ids <id> --yes
skiff packages scan --include-system
skiff packages uninstall --ids pacman:example --yes
```

所有命令都支持 `--json` 输出结构化结果，适合服务器脚本、cron 或 systemd 调用：

```bash
skiff --json cleanup scan
```

默认使用当前进程的 `HOME`。服务器环境中如果需要清理指定用户目录，可以传入 `--home`：

```bash
skiff --home /home/deploy --json files large --min-size 1G
```

会修改磁盘状态的 CLI 命令必须加 `--yes`：

- `cleanup run`
- `files delete`
- `agents clean`
- `packages uninstall`

## 友链

- [Linux.do](https://linux.do)

## 许可

MIT。详见 [LICENSE](./LICENSE)。
