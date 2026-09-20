# 后端部署说明（宝塔面板，避免覆盖上传时丢数据）

## 为什么会丢

服务端「你的内容」不在代码里，而在这几个地方：

| 位置（在 `poolux-api/` 目录内） | 内容 |
| --- | --- |
| `data.db` + `data.db-wal` + `data.db-shm` | SQLite 数据库：资源、模板、相册、首页作品、团队成员、站点设置、入站提醒、设备名单、管理员账号 |
| `uploads/` | 你上传的图片和字体文件本体（含 `uploads/fonts/`） |
| `.env` | `GITHUB_TOKEN` / `GITHUB_REPO` 等密钥 |
| `apk-jobs/` | APK 打包任务与产物 |

而本机 `poolux-api/` 里也有同名的 `data.db`、`uploads/`（本地开发数据）。所以只要「整目录覆盖」上传，
就等于用本机的数据替换服务器的真实数据 —— 添加过的模板、改过的密码都会没了。

现在有两道保险：

1. **`dist/` 里只有前端文件**。后端部署包挪到了 `dist-server/`，整包上传 `dist/` 到网站根目录，
   不可能再碰到服务器上的 `poolux-api`。
2. **后端包只含代码**。`npm run package:api` 产出的 zip 在打包时会自动校验，
   一旦混入 `data.db` / `data.db-wal` / `data.db-shm` / `uploads` / `apk-jobs` / `.env` 就直接报错、不产出包。

再加上把数据目录通过 `POOLUX_DATA_DIR` 挪到网站目录之外，覆盖代码就永远碰不到数据。

---

## 一次性改造（在服务器上做，只做一次）

顺序很重要：先上传支持新配置的代码，再搬数据。这样中途任何一步失败，数据都还在原位。

### 第 0 步：先备份（不要跳过）

宝塔 → 文件 → 进入 `poolux-api` 目录，勾选 `data.db`、`data.db-wal`、`data.db-shm`、`uploads`、`.env`、`apk-jobs` → 右上角「压缩」→ 得到一个 zip，下载到本机。

也可以先登录网站后台，打开 `https://你的域名/api/backup` 下载一份 `poolux-backup-*.tar.gz`。

### 第 1 步：找到后端目录和运行方式

- 宝塔 → 网站 → 看你的站点根目录（常见是 `/www/wwwroot/你的域名`），里面应该有 `poolux-api` 文件夹。
- 宝塔 → 网站 → Node 项目（或「PM2 管理器」）→ 找到运行 `poolux-api/server.js` 的那个项目，记下它的「项目目录」，并注意端口（默认 3001）。

如果找不到，到宝塔 → 文件里搜 `server.js`；还是找不到就把截图发我。

### 第 2 步：停止服务

在上面那个 Node 项目 / PM2 里点「停止」。如果面板开了「监听文件自动重启」，先关掉再操作。

### 第 3 步：上传并解压新代码

1. 本机执行（在 `D:\_网站\Poolux` 下）：
   ```powershell
   npm run build
   ```
   产物有两个，都在 `dist-server/` 下：
   - `poolux-api.zip`：后端代码包（只含代码，不含 `data.db`、`uploads/`、`.env`、`apk-jobs/`）
   - `poolux-web.zip`：前端静态包（`dist/` 的内容，覆盖解压到网站根目录即可）

   只想重新打包、不想重新构建时，可以单独跑 `npm run package:api` 或 `npm run package:web`。

2. 宝塔 → 文件 → 进入 `poolux-api` 目录 → 上传 `poolux-api.zip`。

3. 右键这个 zip → 「解压」：
   - 解压到：**当前目录**（也就是 `poolux-api`）
   - 遇到同名文件选择**覆盖**
   - **不要先删除 `poolux-api` 目录**，直接覆盖；zip 里没有数据文件，所以不会影响 `data.db` 和 `uploads/`

4. 解压后删掉 zip（可选）。压缩包里没有 `node_modules`，服务器上原有的继续用；如果本次没有新增依赖，**不需要执行 `npm install`**。

### 第 4 步：把数据搬到网站目录之外

1. 宝塔 → 文件 → 新建目录 `/www/poolux-data`（也可以叫别的名字，全英文、不带空格）。
2. 进入 `poolux-api`，勾选 `data.db`、`data.db-wal`、`data.db-shm`、`uploads`、`apk-jobs` → 「剪切」。
3. 进入 `/www/poolux-data` → 「粘贴」。
4. 确认 `/www/poolux-data` 里有 `data.db`、`uploads`（以及 `apk-jobs`），而 `poolux-api` 里这几项已经不在了。
5. 在 `/www/poolux-data` 上右键 → 权限：所有者设为 `www`，权限 `755`，勾选「应用到子目录」，确定。

> 三个 db 文件必须一起搬，只动其中一个会让数据库损坏。

### 第 5 步：加环境变量

宝塔 → 文件 → 进入 `poolux-api` → 右键 `.env` → 编辑，在末尾追加一行：

```
POOLUX_DATA_DIR=/www/poolux-data
```

保存。

> 如果 `poolux-api` 里没有 `.env`（比如被覆盖掉了），从 `.env.example` 复制一份，填好 `GITHUB_TOKEN`、`GITHUB_REPO`、`PUBLIC_BASE_URL`，再加这一行。

### 第 6 步：启动并验证

1. 回到 Node 项目 / PM2 → 「启动」。启动日志里应能看到：
   - `[paths] 数据目录: /www/poolux-data`
   - `[poolux-api] 运行在 http://localhost:3001`
2. 依次检查（下面两个 `/api/debug` 接口已加鉴权，需要先在同一个浏览器里登录后台，再打开链接）：
   - 浏览器打开 `https://你的域名/api/health` → 应显示 `{"ok":true}`
   - 打开 `https://你的域名/api/debug/uploads` → `dir` 应该是 `/www/poolux-data/uploads`，`count` 和你以前的上传数量一致
   - 打开 `https://你的域名/api/debug/gallery` → 相册记录里 `exists` 应该都是 `true`
   - 登录网站后台，确认资源/模板/相册/字体都在
   - 后台上传一张新图片，再到 `/www/poolux-data/uploads` 里确认文件出现了
3. 确认无误后，可以删掉服务器上旧的 `poolux-api/data.db`（如果它还残留的话，正常已经被搬走了）。

> 如果第 4 步忘了搬（或搬了 `data.db` 但没搬 `uploads`），程序启动时发现新目录里没有 `data.db`、而 `poolux-api/data.db` 还在，会自动复制过去，日志里会打印 `[paths] 已把…复制到…`。看到这行说明是自动补救的，检查数据正常后再删掉旧副本。

---

## 以后每次部署（只做这两步）

1. 本机：`npm run build`（它会依次构建前端、生成后端包 `dist-server/poolux-api.zip` 和前端包 `dist-server/poolux-web.zip`）。
2. 宝塔：把 `dist-server/poolux-api.zip` 上传到 `poolux-api` 目录 → 解压覆盖 → 在 Node 项目里点「重启」→ 打开 `/api/health` 确认正常。

前端静态文件：把 `dist/` 里的内容上传到网站根目录（覆盖即可）。
**`dist/` 里已经没有后端目录了**，所以这一步不可能再动到 `poolux-api`、`data.db` 和 `uploads`；
后端代码只在第 2 步那个 zip 里更新。

> 上传前想再确认一次的话：`dist/` 里应该只有 `assets/`、`index.html`、图片、字体等前端文件，
> 看不到 `poolux-api` 文件夹，也没有 `data.db`。

---

## 备份与还原

- 备份：登录后台后打开 `https://你的域名/api/backup`，得到数据目录的 `tar.gz`。建议每次部署前都下载一份。
- 还原：停服务 → 把 `tar.gz` 解压，内容覆盖回 `/www/poolux-data` → 确认 `data.db`、`uploads` 在位 → 启动。
- 如果宝塔开启了「文件回收站」：宝塔 → 文件 → 回收站，之前误删/覆盖掉的文件可能可以在这里找回。

## 注意

- `data.db-wal`、`data.db-shm` 必须和 `data.db` 一起搬、一起备份。
- 不要用本机的 `.env` 覆盖服务器 `.env`（本机通常没有 `GITHUB_TOKEN`，覆盖后 APK 打包会失效）。
- 数据目录不要放在网站根目录里面，否则将来清理/重建网站时容易被一起删掉。
