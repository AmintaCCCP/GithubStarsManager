# AI搜索功能测试指南

## 测试步骤

### 1. 基础功能测试
1. 打开应用，确保有一些仓库数据
2. 在搜索框中输入关键词（如 "react"）
3. 点击紫色的"AI搜索"按钮
4. 观察控制台输出和搜索结果

### 2. 预期行为
- 控制台应该显示：
  ```
  🔍 Starting AI search for query: react
  🤖 AI Config found: true/false Active AI Config ID: xxx
  📋 Available AI Configs: x
  🔧 AI Configs: [...]
  🚀 Calling AI service...
  🤖 AI Service: Starting enhanced search for: react
  🔄 AI Service: Using enhanced basic search with intelligent ranking
  ✨ AI Service: Enhanced search completed, results: x
  ✅ AI search completed, results: x
  🎯 Final filtered results: x
  📋 Final filtered repositories: [...]
  ```

### 3. 搜索结果验证
- 搜索结果应该按相关度排序
- 名称匹配的仓库应该排在前面
- 描述匹配的仓库应该排在中间
- 标签匹配的仓库应该排在后面
- 热门仓库（高star数）应该有额外加分

### 4. 常见问题排查

#### 问题1：点击AI搜索后没有反应
- 检查控制台是否有错误信息
- 确认搜索框中有输入内容
- 检查是否有AI配置（如果没有配置，会使用基础搜索）

#### 问题2：搜索结果不正确
- 检查控制台中的搜索结果数量
- 确认搜索词是否正确
- 检查是否有其他过滤器影响结果

#### 问题3：搜索结果排序不合理
- 检查仓库的名称、描述、标签是否包含搜索词
- 确认评分算法是否正确工作

## 调试信息

当前AI搜索使用的是增强的基础搜索算法，包含以下评分规则：

### 评分权重
- 仓库名称匹配：0.4分
- 完整名称匹配：0.35分
- 描述匹配：0.3分
- 自定义描述匹配：0.32分
- Topics匹配：0.25分
- AI标签匹配：0.22分
- 自定义标签匹配：0.24分
- AI总结匹配：0.15分
- 平台匹配：0.18分
- 语言匹配：0.12分

### 额外加分
- 精确名称匹配：+0.5分
- 名称包含完整查询：+0.3分
- 热度加分：log10(stars + 1) * 0.05

## 测试用例

### 测试用例1：名称匹配
- 搜索："react"
- 预期：名称包含"react"的仓库排在前面

### 测试用例2：描述匹配
- 搜索："machine learning"
- 预期：描述中包含机器学习相关内容的仓库

### 测试用例3：标签匹配
- 搜索："frontend"
- 预期：标签中包含前端相关的仓库

### 测试用例4：多词搜索
- 搜索："web framework"
- 预期：同时匹配web和framework的仓库排在前面

### 测试用例5：中文搜索
- 搜索："前端框架"
- 预期：能够匹配相关的前端框架仓库

## 成功标准

✅ AI搜索按钮点击后有响应
✅ 控制台显示完整的搜索流程日志
✅ 搜索结果按相关度正确排序
✅ 高相关度的仓库排在前面
✅ 无相关结果时显示空列表
✅ 搜索性能良好（< 1秒响应）

如果以上标准都满足，说明AI搜索功能工作正常。