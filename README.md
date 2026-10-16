# Cardfolio

面向个人用户的信用卡档案、年费、免年费进度和站内提醒 Web 应用。

## 当前状态

MVP 已完成并形成可运行基线，具备真实账号会话、信用卡管理、免年费进度、年费事件及处理历史、提醒中心、月/列表日历、搜索筛选、JSON 导出、账户删除请求和审计日志。

默认使用共享内存仓储便于本地演示，开发服务器重启后数据会清空。设置 USE_DATABASE=true 后切换到 PostgreSQL；生产环境必须使用 PostgreSQL。完整交付范围和生产边界见 [MVP 交付说明](./docs/MVP-DELIVERY.md)。

## 服务器一键安装

Linux 服务器安装 Docker 和 Compose 插件后，将域名解析到服务器并放行 TCP 80/443，替换下面的域名后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/HightBigger/CardCalendar/v0.1.4/scripts/install.sh | bash -s -- cards.example.com
```

自动下载版本、生成配置和数据库密码、构建镜像、迁移数据库并启动 HTTPS。默认安装到 `~/cardfolio`，重跑会保留配置和数据；已有反向代理可追加 `--no-proxy`。完整参数、更新和运维见 [部署说明](./docs/DEPLOYMENT.md)。

## 本地运行

~~~bash
npm install --legacy-peer-deps --no-audit --no-fund
cp .env.example .env
npm run dev
~~~

打开 http://localhost:3000。

前端使用真实注册/登录会话。.env.example 默认关闭 AUTH_DEV_HEADER；只有本地调试旧脚本时才临时设置为 true，通过 x-user-id 请求头访问 API，生产环境必须保持关闭。

本地开发的侧边导航提供“新功能预览”，入口为 `/dev/workbench`，用于体验第 21、22 节的活动、周期计划和统一待办。预览使用示例数据，不保存到登录账户。普通账户页的新功能仍受开关控制，部分私人活动和自定义待办接口尚未接入；第 23 节银行活动目录需启用 PostgreSQL 和对应开关。具体接入状态见 [前端交付说明](./docs/FRONTEND-IMPLEMENTATION.md) 和 [目录交付说明](./docs/CC-23-DELIVERY.md)。

## 数据库

使用 PostgreSQL 时执行：

~~~bash
docker compose up -d postgres
npm run db:migrate
~~~

在 .env 设置 USE_DATABASE=true 后重启 npm run dev。

迁移文件在 db/migrations/，执行脚本会记录已应用文件并支持重复运行。

无需本地 PostgreSQL 时，可运行 npm run db:verify 自动启动一个临时 PostgreSQL 实例，依次执行迁移和 10 张表的冒烟检查，结束后自动清理。

## 后台任务

后台任务入口（需已连接 PostgreSQL）：

npm run worker

worker 会注册 calendar.reconcile（生成未来 12 个月年费事件）和 reminder.dispatch（按用户提醒规则生成提醒）任务。

同时注册 account.cleanup，用于异步清理已提交删除申请的账户数据。

## MVP 功能

- 邮箱注册、登录、退出和个人时区设置
- 信用卡新增、编辑、查看、归档与恢复
- 免年费进度追加、编辑、撤销和达标状态
- 年费事件处理：待确认、已免除、已扣费、已退费、无需处理及状态历史
- 未来 90 天概览、月/列表日历、提醒中心、逾期提示和自定义规则
- 卡片搜索、筛选和排序
- JSON 全量导出、账户删除请求和关键操作审计

## 质量检查

~~~bash
npm run typecheck
npm test
npm run test:e2e
npm run db:verify
npm run build
~~~

## 规划文档

- 产品需求文档：docs/PRD.md
- 技术方案：docs/TECHNICAL.md
- 数据库设计：docs/DATABASE.md
- MVP 交付说明：docs/MVP-DELIVERY.md
- 生产部署与运行：docs/DEPLOYMENT.md
