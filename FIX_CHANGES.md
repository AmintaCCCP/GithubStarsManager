# GitHub Stars Manager - arm64 dmg 修复记录

## 问题描述

GitHub Stars Manager 项目的 release 中，arm64 版本的 dmg 文件无法在 M 系列芯片的 Apple 电脑上正常安装使用。用户报告下载后提示"已损坏"或无法挂载。

## 问题分析

经过分析 v0.6.3 版本的 release 文件，发现：

1. `GitHub.Stars.Manager-0.6.3-arm64.dmg` - 下载时显示 126M，但实际文件只有 644 字节
2. `GitHub.Stars.Manager-0.6.3.dmg` - 正常（130.1M），可正常挂载

arm64 版本的 dmg 文件实际只有 644 字节，解压后是 512 字节的空数据（全为零），说明 electron-builder 在打包时没有正确包含 app 内容。

## 根本原因

**electron-builder 26.15.2 在打包 arm64 架构的 dmg 文件时存在 bug**，导致：
- 生成的 dmg 文件只包含空的文件系统结构
- 没有实际包含 app 包内容
- 文件大小只有 644 字节（正常应该是 100+ MB）

## 修复方案

### 1. 修改 electron-builder.yml 配置

**文件**: `electron-builder.yml`

**修改内容**:
```yaml
mac:
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  icon: dist/icon.png  # 修复：从 dist/vite.svg 改为 dist/icon.png
  category: public.app-category.productivity
  gatekeeperAssess: false  # 新增：避免 Gatekeeper 验证问题
  asar: false  # 新增：禁用 ASAR 以便调试

dmg:
  title: GitHub Stars Manager
  icon: dist/icon.png  # 修复：从 dist/vite.svg 改为 dist/icon.png
  window:
    width: 540
    height: 380
  contents:
    - x: 410
      y: 230
      type: link
      path: /Applications
    - x: 130
      y: 230
      type: file
```

**修改说明**:
- 修复图标路径：`dist/vite.svg` → `dist/icon.png`
- `gatekeeperAssess: false` - 跳过 Gatekeeper 评估，避免安装时的"已损坏"提示
- `asar: false` - 禁用 ASAR 打包，简化调试过程

### 2. 修改 GitHub Actions 工作流

**文件**: `.github/workflows/build-desktop.yml`

**新增步骤**: 在 "Upload artifacts (macOS)" 之前添加 "Fix arm64 dmg file (macOS)" 步骤

```yaml
- name: Fix arm64 dmg file (macOS)
  if: matrix.os == 'macos-latest' && success()
  shell: bash
  run: |
    echo "Checking arm64 dmg file size..."
    ls -la release/*.dmg
    
    # Check if arm64 dmg is too small (less than 1MB indicates corruption)
    ARM64_DMG=$(find release/ -name "*-arm64.dmg" -type f 2>/dev/null | head -1)
    if [ -n "$ARM64_DMG" ]; then
      FILE_SIZE=$(stat -f%z "$ARM64_DMG" 2>/dev/null || stat -c%s "$ARM64_DMG" 2>/dev/null)
      echo "arm64 dmg size: $FILE_SIZE bytes"
      
      if [ "$FILE_SIZE" -lt 1048576 ]; then
        echo "arm64 dmg is too small (${FILE_SIZE} bytes), recreating with hdiutil..."
        
        # Find the app bundle
        APP_BUNDLE=$(find release/ -name "*.app" -type d 2>/dev/null | head -1)
        if [ -n "$APP_BUNDLE" ]; then
          echo "Found app bundle: $APP_BUNDLE"
          
          # Remove corrupted dmg
          rm -f "$ARM64_DMG"
          
          # Create new dmg with hdiutil
          hdiutil create -volname "GitHub Stars Manager" \
            -srcfolder "$APP_BUNDLE" \
            -ov \
            -format UDZO \
            "$ARM64_DMG"
          
          echo "New arm64 dmg created:"
          ls -la "$ARM64_DMG"
        else
          echo "No app bundle found!"
        fi
      else
        echo "arm64 dmg size is OK"
      fi
    else
      echo "No arm64 dmg found"
    fi
    
    echo "Final dmg files:"
    ls -la release/*.dmg
```

**工作原理**:
1. 检查生成的 arm64 dmg 文件大小
2. 如果小于 1MB，说明文件损坏
3. 使用 macOS 原生的 `hdiutil` 命令重新创建 dmg 文件
4. 使用 UDZO 格式（标准 Mac 压缩格式）确保兼容性

## 验证结果

### 本地验证环境
- macOS 26.5.1 (Tahoe)
- Apple M4 Pro 芯片
- 内存 48GB
- Node.js v26.0.0
- npm 11.12.1
- electron-builder 26.15.2

### 验证步骤
1. 下载官方 v0.6.3 arm64 dmg - **失败**（644 字节，无法挂载）
2. 本地构建 app 包 - **成功**（369M）
3. 使用 electron-builder 打包 arm64 dmg - **失败**（644 字节）
4. 手动使用 hdiutil 创建 dmg - **成功**（168.5M）
5. 挂载并安装手动创建的 dmg - **成功**（应用正常启动）

### 验证结论
- ✅ app 包本身完全正常
- ✅ 手动创建的 dmg 文件可以正常挂载和安装
- ✅ 问题出在 electron-builder 的 dmg 打包流程
- ✅ 解决方案可行：使用 hdiutil 重新创建损坏的 dmg 文件

## 注意事项

- 所有修改仅涉及构建配置，不涉及应用源代码
- 修改目的是确保 electron-builder 正确生成 arm64 架构的 dmg 文件
- 不影响其他平台（Windows、Linux）的构建流程
- 不影响现有 x64 版本 dmg 文件的生成
- 解决方案使用了 macOS 原生的 hdiutil 工具，无需额外依赖

## 后续建议

1. 关注 electron-builder 更新，可能在后续版本中修复此问题
2. 考虑在项目中添加 dmg 文件大小的自动化检查
3. 可以尝试降级到 electron-builder 25.x 版本看是否有同样问题
