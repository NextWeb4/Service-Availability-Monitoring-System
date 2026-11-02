<<<<<<< HEAD
# History Uptime Console

一个零外部依赖的本地自托管可用性监控台。它借鉴 Uptime Kuma 的低摩擦自托管、心跳条带、事件时间线和状态页体验，用 Node.js 内置模块实现，适合直接在 Windows 上运行。

## 启动

```powershell
npm start
```

默认地址是 <http://localhost:3000>，只读状态页是 <http://localhost:3000/status>。可用环境变量：

- `PORT`：服务端口，默认 `3000`
- `DATA_DIR`：JSONL 数据目录，默认 `<项目>/data`
- `DISABLE_SCHEDULER=1`：禁用周期调度，常用于测试

## 功能

- 100 类探测，分为 HTTP 与内容、网络与传输、数据库与缓存、消息与协调、目录/代理/远程、邮件与文件服务、可观测性、基础设施与研发、应用与数据平台 9 组。
- 包含 MongoDB、SQL Server、Cassandra、Kafka、RabbitMQ、NATS、LDAP/LDAPS、SOCKS5、SNMP、WHOIS、Docker、Kubernetes、Vault、GitLab、Keycloak、Nextcloud、Jellyfin、Immich、Home Assistant 等；`GET /api/meta` 返回完整分类目录，页面直接使用该目录。
- 顶部“全局间隔”统一管理服务端默认检查频率，以及控制台和状态页的数据轮询；支持 1/5/10/30/60 秒，API 可设置 1 到 86400 秒。
- 新监控默认使用全局间隔；取消勾选可指定单独间隔。已有监控的“改间隔”只修改该项，留空恢复全局；旧版已保存的单项间隔继续保留。
- 24 小时 / 7 天在线率、平均延迟、P95 延迟和最近 40 次心跳条带。
- 本地 JSONL 心跳历史、异常/恢复事件时间线、JSON 导入导出。
- 重复历史记录按监控、时间和状态去重；导入时会重建历史异常与恢复事件。
- 管理控制台负责创建、暂停、手动检查和删除；状态页提供只读视图。
- 管理台与状态页提供搜索、状态/类型筛选、排序和 10/25/50 项分页；默认使用紧凑列表，也可切换卡片视图。列表在固定区域滚动，自动更新保留筛选和页码。
- 新增监控与历史导入使用弹窗，事件时间线可折叠，避免监控数量增加时整页不断变长。

图标使用本地打包的 [Lucide](https://github.com/lucide-icons/lucide)，许可证保留在 `public/icons/LICENSE`，无需外部 CDN。

## 数据

运行后数据保存在：

- `data/monitors.jsonl`
- `data/heartbeats.jsonl`
- `data/events.jsonl`
- `data/settings.jsonl`

导出地址是 `/api/export`，导入接口是 `POST /api/import`。最小导入格式：

```json
[
  {
    "name": "官网",
    "type": "http",
    "target": "https://example.com",
    "time": "2026-08-26T10:00:00Z",
    "status": "up",
    "responseTime": 120
  }
]
```

`status` 支持 `up/down/online/offline/ok/true/false` 和 Uptime Kuma 风格的数值状态；也可以提供 ISO 时间戳、毫秒耗时和错误信息。

## 验证

```powershell
npm test
```

18 项测试覆盖核心统计、历史规范化、事件重建、API 导入导出、100 类目录与检查路由、协议交互、57 类 HTTP 健康端点，以及真实服务调度的全局/单项间隔行为。测试使用本地 HTTP/TCP/UDP fixture，不代表已连接全部 100 类产品的生产部署。

## 探测目标

类型由 4 类通用 HTTP 检查、39 类网络/协议检查和 57 类 HTTP 服务端点组成。TCP 建连、协议握手和应用健康检查的检测范围不同，页面消息显示实际结果。

服务端点类型填写 `hostname` 或 `hostname:port` 时使用对应默认端口和健康路径。完整 HTTP(S) URL 保留指定协议和端口；非根路径（含查询参数）作为完整端点，根路径使用该类型的默认健康路径。反向代理部署可直接填写实际端点 URL。

部分产品需要先启用健康端点。TLS 检查使用系统信任的证书；允许返回 401/403 的 API 模板会明确显示“可达，需要认证”，该结果只说明端点可达。Vault 封印/未初始化、Airflow 调度器异常、Consul/Nomad 无 leader 等状态会判为异常。

=======
# Service-Availability-Monitoring-System
>>>>>>> 6bf966f9487d55b9d600463224bc49e27de95440
