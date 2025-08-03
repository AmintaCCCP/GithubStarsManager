# 版本管理说明

## 目录结构

- `version-info.xml` - 存储所有版本信息的XML文件
- `README.md` - 本说明文件

## 版本更新流程

### 1. 更新版本信息

使用脚本自动更新版本：

```bash
npm run update-version 0.1.3 "修复搜索功能bug" "添加新的过滤选项" "优化界面响应速度"
```

这个命令会：
- 更新 `package.json` 中的版本号
- 在 `version-info.xml` 中添加新版本记录
- 更新 `src/services/updateService.ts` 中的当前版本号

### 2. 手动更新（不推荐）

如果需要手动更新 `version-info.xml`，请按照以下格式：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<versions>
  <version>
    <number>0.1.3</number>
    <releaseDate>2025-01-03</releaseDate>
    <changelog>
      <item>修复搜索功能bug</item>
      <item>添加新的过滤选项</item>
      <item>优化界面响应速度</item>
    </changelog>
    <downloadUrl>https://github.com/AmintaCCCP/GithubStarsManager/releases/download/v0.1.3/github-stars-manager-0.1.3.dmg</downloadUrl>
  </version>
</versions>
```

### 3. 发布流程

1. 使用 `npm run update-version` 更新版本信息
2. 提交更改到 Git 仓库：
   ```bash
   git add .
   git commit -m "chore: bump version to v0.1.3"
   git push origin main
   ```
3. 在 GitHub 上创建对应的 Release，并上传构建好的安装包
4. 确保下载链接与 XML 中的 `downloadUrl` 一致

## XML 文件格式说明

- `number`: 版本号，格式为 x.y.z
- `releaseDate`: 发布日期，格式为 YYYY-MM-DD
- `changelog`: 更新日志，每个 `<item>` 代表一条更新内容
- `downloadUrl`: 对应版本的下载链接

## 注意事项

1. 版本号必须遵循语义化版本规范（Semantic Versioning）
2. 每次发布新版本时，确保 GitHub Release 中的下载链接可用
3. XML 文件会被应用程序通过网络请求读取，确保文件格式正确
4. 建议在发布前先在本地测试更新检查功能