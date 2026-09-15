# Smart Release Recommender

V1.1 Release processor 示例。它只读取宿主提供的脱敏 Release/Asset 元数据，根据当前操作系统和 CPU 架构匹配文件名，不读取 Token，也不自行联网。

安装后需明确批准：

- `releases:read`：读取脱敏 Release 和 Asset 元数据。
- `downloads:create`：允许用户从推荐结果触发宿主下载。

下载按钮由 GithubStarsManager 渲染。插件只返回 `recommendedAssetId`、`confidence` 和 `reason`；宿主会再次确认 Asset 归属、显示保存对话框并执行下载。
