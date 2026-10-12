# Changelog

## [0.9.0](https://github.com/AmintaCCCP/GithubStarsManager/compare/v0.8.6...v0.9.0) (2026-10-12)


### Features

* **ai:** 支持局域网地址 API 接入点并放行明文 HTTP (closes [#439](https://github.com/AmintaCCCP/GithubStarsManager/issues/439)) ([3270e26](https://github.com/AmintaCCCP/GithubStarsManager/commit/3270e261341150cb3a197b4f7bdef2c4199b8a53))
* **ai:** 支持局域网地址 API 接入点并放行明文 HTTP (closes [#439](https://github.com/AmintaCCCP/GithubStarsManager/issues/439)) ([fe20ac2](https://github.com/AmintaCCCP/GithubStarsManager/commit/fe20ac274280f199707a867aa9373eaa210e6439))
* **lists:** 支持推送单个或多个选中分类到 GitHub Lists ([69cb445](https://github.com/AmintaCCCP/GithubStarsManager/commit/69cb445008f80966ac0aa0c7416707bd97312b15))
* **lists:** 支持推送单个或多个选中分类到 GitHub Lists ([89fdddd](https://github.com/AmintaCCCP/GithubStarsManager/commit/89fdddd09909aea551dd5792601cb509f58348b1))


### Bug Fixes

* **deps:** 修复 KaTeX 与 sharp 安全漏洞 (Dependabot [#60](https://github.com/AmintaCCCP/GithubStarsManager/issues/60), [#63](https://github.com/AmintaCCCP/GithubStarsManager/issues/63)) ([6d1dd80](https://github.com/AmintaCCCP/GithubStarsManager/commit/6d1dd80700b0ee717f79a5da7d0137f32afc91b7))
* **deps:** 修复 KaTeX 与 sharp 安全漏洞并优化测试断言 ([7070909](https://github.com/AmintaCCCP/GithubStarsManager/commit/707090958d5555985bd45bfd84588c5e2fb70cda))
* **lists:** 启动前校验失败时也给出错误提示（落实 CodeRabbit 评审意见） ([8f914c1](https://github.com/AmintaCCCP/GithubStarsManager/commit/8f914c1190ba439bd40f150b81de238e268667b1))
* **lists:** 子集推送时保留与未选分类共享的 list 成员关系（落实 CodeRabbit 评审意见） ([c195ffb](https://github.com/AmintaCCCP/GithubStarsManager/commit/c195ffbcda9db4587c3367e0676af6a3c77e5d1b))
* **lists:** 新的推送状态取消上一轮待执行的 reset（落实 CodeRabbit 评审意见） ([ce6253f](https://github.com/AmintaCCCP/GithubStarsManager/commit/ce6253f6177e429ddf85ebd21c2e7e7aca604e3d))
* **review:** 落实 CodeRabbit 评审意见，加固 SSRF 防护与 IPv6 解析 ([1681003](https://github.com/AmintaCCCP/GithubStarsManager/commit/16810039c34a62ea9d6aaeec43efb095a5c656dd))
* **server:** 升级 better-sqlite3 至 ^12.11.1，修复 Node 24 下 CI 崩溃 ([d6444d1](https://github.com/AmintaCCCP/GithubStarsManager/commit/d6444d1a94acace505e5dccce30d1c42fcc0fb12))
