# 检查更新功能实现指南

## 功能概述

已成功为 GitHub Stars Manager 添加了完整的检查更新功能，包括：

1. **版本信息管理** - 使用XML格式存储版本信息
2. **自动更新检查** - 应用启动时自动检查更新
3. **手动更新检查** - 设置页面中的检查更新按钮
4. **更新提示界面** - 美观的更新对话框
5. **版本管理工具** - 自动化版本更新脚本

## 文件结构

```
├── versions/
│   ├── version-info.xml      # 版本信息XML文件
│   └── README.md            # 版本管理说明
├── src/
│   ├── services/
│   │   └── updateService.ts  # 更新检查服务
│   └── components/
│       └── UpdateChecker.tsx # 更新检查组件
├── scripts/
│   └── update-version.js     # 版本更新脚本
└── test-update.html         # 功能测试页面
```

## 使用方法

### 1. 发布新版本

使用自动化脚本更新版本：

```bash
npm run update-version 0.1.4 "新增功能A" "修复bug B" "优化性能C"
```

这个命令会自动：
- 更新 `package.json` 中的版本号
- 在 `versions/version-info.xml` 中添加新版本记录
- 更新 `src/services/updateService.ts` 中的当前版本号

### 2. 提交到仓库

```bash
git add .
git commit -m "chore: bump version to v0.1.4"
git push origin main
```

### 3. 创建GitHub Release

1. 在GitHub仓库中创建新的Release
2. 标签名称：`v0.1.4`
3. 上传构建好的安装包（如 `github-stars-manager-0.1.4.dmg`）
4. 确保下载链接与XML中的URL一致

## 功能特性

### 自动检查更新
- 应用启动3秒后自动检查更新
- 静默检查，不影响用户体验
- 发现新版本时在控制台记录日志

### 手动检查更新
- 设置页面中的"检查更新"按钮
- 实时显示检查状态
- 显示详细的更新信息

### 更新提示界面
- 美观的模态对话框
- 显示版本号和发布日期
- 详细的更新日志列表
- 一键跳转到下载页面

### 版本比较算法
- 支持语义化版本号（x.y.z）
- 智能比较版本大小
- 处理不同长度的版本号

## XML文件格式

```xml
<?xml version="1.0" encoding="UTF-8"?>
<versions>
  <version>
    <number>0.1.3</number>
    <releaseDate>2025-01-04</releaseDate>
    <changelog>
      <item>添加检查更新功能</item>
      <item>优化用户界面</item>
      <item>修复已知bug</item>
    </changelog>
    <downloadUrl>https://github.com/AmintaCCCP/GithubStarsManager/releases/download/v0.1.3/github-stars-manager-0.1.3.dmg</downloadUrl>
  </version>
</versions>
```

## 测试方法

### 本地测试
1. 打开 `test-update.html` 文件
2. 点击"检查更新"按钮
3. 验证功能是否正常工作

### 应用内测试
1. 启动应用，等待3秒观察控制台日志
2. 进入设置页面，点击"检查更新"
3. 验证更新对话框是否正确显示

## 注意事项

1. **版本号格式**：必须使用 x.y.z 格式的语义化版本号
2. **XML文件编码**：确保使用UTF-8编码
3. **下载链接**：确保GitHub Release中的下载链接可用
4. **网络请求**：更新检查需要网络连接
5. **CORS问题**：本地测试时可能遇到跨域问题

## 错误处理

- 网络连接失败时显示友好错误信息
- XML解析错误时提供详细错误描述
- 版本比较异常时使用默认处理逻辑

## 多语言支持

更新功能已集成应用的多语言系统：
- 中文界面显示中文提示
- 英文界面显示英文提示
- 自动根据应用语言设置调整

## 未来扩展

可以考虑添加的功能：
1. 自动下载更新包
2. 增量更新支持
3. 更新进度显示
4. 更新历史记录
5. 跳过版本功能

## 技术实现

- **前端框架**：React + TypeScript
- **HTTP请求**：Fetch API
- **XML解析**：DOMParser
- **版本比较**：自定义算法
- **UI组件**：Tailwind CSS + Lucide Icons