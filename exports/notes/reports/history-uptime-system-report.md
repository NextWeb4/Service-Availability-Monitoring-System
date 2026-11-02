# History Uptime Console 完成报告

日期：2026-11-02  
工作区：`E:\Codex\DS`

## 交付结果

管理台：http://localhost:3000  
只读状态页：http://localhost:3000/status

本轮将原有 20 类扩展为 100 类，分为 9 组。完整类型从服务端 `GET /api/meta` 加载，页面显示“100 类”，避免前后端目录不同步。类型由 4 类通用 HTTP、39 类网络/协议和 57 类 HTTP 服务端点组成。

| 分类 | 示例 |
| --- | --- |
| HTTP 与内容 | 状态码、关键字、JSON 字段、正则 |
| 网络与传输 | TCP、Ping、DNS、SSL、WebSocket、NTP、SIP、SNMP、WHOIS |
| 数据库与缓存 | Redis/TLS、Memcached、MySQL、PostgreSQL、MongoDB、SQL Server、Cassandra |
| 消息与协调 | MQTT、AMQP、Kafka、ZooKeeper、Beanstalkd、Gearman、NATS |
| 目录、代理与远程 | LDAP/LDAPS、SOCKS5、VNC、XMPP、IRC |
| 邮件与文件服务 | SMTP/SMTPS、IMAP/IMAPS、POP3/POP3S、FTP/FTPS、SSH |
| 可观测性 | Prometheus、Grafana、Loki、Alertmanager、Thanos、Jaeger、OpenTelemetry |
| 基础设施与研发 | Docker、Kubernetes、Vault、GitLab、Jenkins、Harbor、Keycloak、Proxmox |
| 应用与数据平台 | Nextcloud、Jellyfin、Immich、Home Assistant、Airflow、Metabase、Matrix |

## 间隔规则

- 顶部“全局间隔”保存到 `data/settings.jsonl`，统一管理跟随项的服务端检查频率及两个页面的数据轮询。
- 新监控默认跟随全局，可在创建时取消勾选并设置单独间隔。
- “改间隔”仅覆盖当前监控，留空恢复跟随全局。
- 旧版保存的单项间隔继续生效。正式数据仍保留 3 项原监控及其历史，原全局 1 秒设置保留。
- 首次加载先获取服务端设置再启动轮询；页面轮询使用串行定时器。
- 调度器按检查开始时间计算下一次检查，共享运行中的 Promise，防止手动/自动检查重叠。

## 关键实现与修复

`lib/core.js` 管理类型目录、输入规范化和全局/单项间隔。`lib/checker.js` 提供相应检查。`server.js` 暴露目录/设置 API 并执行周期调度。前端根据类型禁用隐藏字段，避免隐藏必填项阻止提交或同名字段相互覆盖。

协议修复包括 Kafka ApiVersions 帧、AMQP Connection.Start、MSSQL PRELOGIN 偏移、Cassandra SUPPORTED、SIP Via、MQTT 拒绝码和 MongoDB OP_MSG hello/BSON ok 解析。健康端点修复包括 Keycloak 默认 9000 端口、Vault 封印/未初始化、Airflow 组件健康、Consul/Nomad leader、Harbor healthy 响应。

完整 HTTP(S) URL 保留协议/端口，非根路径及查询参数作为完整端点；裸主机使用服务默认端口/路径。允许 401/403 的 API 模板明确显示“可达，需要认证”，不表示完成鉴权后的应用健康检查。

## 验证证据

实施阶段完整 `npm test`：18 项通过，0 失败、0 跳过。5 个运行时 JS 文件的 `node --check` 通过。此后仅修改说明和证据文件。

- 目录测试验证 100 类都有检查路由。
- 57 类 HTTP fixture 分别验证预期路径、健康响应和 HTTP 503；另验证 Vault/Airflow/leader 等异常状态。
- 本地 socket/UDP fixture 验证选定协议字节、握手与拒绝响应。
- 真实调度测试使用 650ms 上游响应；全局 1 秒的检查起始间距为 1010、990、1027ms。全局改 5 后跟随项变 5，单独项仍为 3。
- 浏览器下拉框实测 100 个 option、9 个 optgroup。
- 管理台 1 秒轮询请求偏移为 2、1018、2035、3052ms，连续出现不同页面更新时间。
- 管理台 5 秒轮询请求偏移为 3993、9005ms，间距 5012ms。
- 通过页面创建 HTTP 和 JSON 监控。JSON 期望值“1”保存成功；全局改为 5 后检查异常，改回 1 后恢复。
- 单项改为 3 秒后，全局 1/5 秒切换不覆盖该项；WHOIS 表单只提交对应查询字段。
- 状态页显示“1 秒”并连续自动更新；390px 页面无横向溢出。管理台 1440px/390px 截图已检查，手机尺寸无越界控件。
- 两个页面浏览器脚本错误列表为空。
- 正式服务首页、状态页、目录 API、状态 API 均返回 200；目录为 100 类/9 组，原 3 项监控仍存在。

详细观测：[browser-verification.json](browser-verification.json)  
截图：[管理台桌面](console-desktop.png)、[管理台手机](console-mobile.png)、[状态页手机](status-mobile.png)。

## 检测范围

验证使用本地服务和 fixture，并未部署 100 个独立生产产品。TCP 建连、协议握手和 HTTP 应用健康检查具有不同检测范围。部分服务需启用健康端点；TLS 使用可信证书。当前系统仍是本地监控台，没有增加登录鉴权或通知渠道。

## 执行记录

已沿用先前两条并行 Agent 审计结论并完成修复。当前环境未提供 kb_router/kb_read_file、Burp 或 http_probe，且本地无对应 kb 目录；本机接口验证使用 Node 内置 fetch。协议与健康端点依据本地实现、fixture 及已核对的产品官方资料：
[Keycloak](https://www.keycloak.org/observability/health)、
[Vault](https://developer.hashicorp.com/vault/api-docs/system/health)、
[Airflow](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/logging-monitoring/check-health.html)。


