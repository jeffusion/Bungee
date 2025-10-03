# Bungee UI 模块重构任务规划

## 项目概述

对 Bungee 反向代理项目的 UI 模块进行重构，主要目标是实现配置的可视化和动态修改。

**技术栈：**

- Svelte 4 + Vite 6
- TailwindCSS + DaisyUI
- svelte-spa-router (客户端路由)
- Bun runtime (后端)

---

## Phase 1: 核心配置编辑 ✅ 已完成

### 目标

实现路由管理的核心功能，包括 CRUD 操作、上游配置、Headers/Body 修改等。

### 已完成功能

#### 1. 基础架构 ✅

- [x] 状态管理 Store (`packages/ui/src/lib/stores/`)
  - `config.ts` - 配置状态管理
  - `stats.ts` - 统计数据管理
- [x] API 封装 (`packages/ui/src/lib/api/`)
  - `client.ts` - HTTP 客户端
  - `routes.ts` - 路由 CRUD API
  - `config.ts` - 配置 API
  - `stats.ts` - 统计 API
  - `system.ts` - 系统 API
- [x] 类型定义 (`packages/ui/src/lib/types.ts`)

#### 2. 验证逻辑 ✅

- [x] 路由验证器 (`validation/route-validator.ts`)
  - 路径验证
  - Upstream 验证
  - 表达式验证
- [x] Upstream 验证器 (`validation/upstream-validator.ts`)

#### 3. UI 组件 ✅

- [x] `HeadersEditor.svelte` - Headers 修改编辑器
  - 支持 add/remove/replace/default 操作
  - 可折叠的分组界面
- [x] `BodyEditor.svelte` - Body 修改编辑器
  - 支持 add/remove/replace/default 操作
  - JSON 格式化显示
- [x] `UpstreamForm.svelte` - Upstream 配置表单
  - Target URL、Weight、Priority
  - Transformer 选择
  - Headers/Body 嵌套编辑
- [x] `RouteCard.svelte` - 路由卡片展示
  - 显示路由详情
  - 健康状态指示
  - 快捷操作按钮

#### 4. 页面实现 ✅

- [x] `routes/Dashboard.svelte` - 仪表盘
  - 实时统计数据（总请求数、QPS、成功率、平均响应时间）
  - 3 秒自动刷新
- [x] `routes/RoutesIndex.svelte` - 路由列表
  - 搜索/过滤功能
  - 路由卡片展示
  - 新建/编辑/删除/复制操作
- [x] `routes/RouteEditor.svelte` - 路由编辑器
  - 完整的路由配置表单
  - 实时验证
  - Path Rewrite 支持
  - Failover 配置
  - Health Check 配置
- [x] `routes/Configuration.svelte` - 配置页面（简化版）
- [x] `routes/NotFound.svelte` - 404 页面

#### 5. 路由配置 ✅

- [x] App.svelte - 主应用框架
  - 导航栏
  - 手动路由实现（替代 svelte-spa-router 的 Router 组件）
  - 路由条件渲染

### 已解决的技术问题

#### 问题 1: onMount 生命周期钩子不工作 ✅

**原因：** Vite 的模块解析配置缺少 `browser` 条件，导致 Svelte 的浏览器版本代码未被正确加载

**解决方案：** (`packages/ui/vite.config.ts`)

```typescript
resolve: {
  conditions: ['browser', 'module', 'import'],
},
optimizeDeps: {
  exclude: ['svelte-spa-router']
}
```

#### 问题 2: API 路径重复 ✅

**原因：** `routes.ts` 中错误使用了 `/api/config`，与 `API_BASE = '/__ui/api'` 拼接后变成 `/__ui/api/api/config`

**解决方案：** 所有 API 路径直接使用 `/config` 等相对路径

#### 问题 3: UI 请求被计入统计 ✅

**原因：** UI 请求和浏览器自动请求在 `finally` 块执行前未被过滤

**解决方案：** (`packages/core/src/worker.ts:162-181`)

```typescript
// 在 try 块之前处理不需要统计的请求
const uiResponse = await handleUIRequest(req);
if (uiResponse) return uiResponse;

// 健康检查
if (url.pathname === '/health') return ...;

// 浏览器自动请求
if (url.pathname === '/favicon.ico' ||
    url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
  return new Response(null, { status: 404 });
}
```

---

## Phase 2: 监控和图表 ✅ 已完成

### 目标

增强监控能力，提供可视化的性能数据。

### 已完成功能

#### 1. 实时监控面板 ✅

- [x] 图表库集成 (Chart.js 4.5.0 + svelte-chartjs 3.1.5)
- [x] QPS 趋势图 - 显示每时段请求数
- [x] 响应时间趋势图 - 显示平均响应时间（毫秒）
- [x] 错误率监控 - 显示错误百分比趋势
- [x] 错误数趋势图 - 显示累积错误数

#### 2. 图表组件 ✅

- [x] `LineChart.svelte` - 通用折线图组件
  - 支持多数据集
  - 自定义颜色和样式
  - 响应式设计
  - 工具提示和图例
- [x] `MonitoringCharts.svelte` - 监控面板组件
  - 4 个监控图表
  - 自动刷新（10秒间隔）
  - 时间范围选择器（10秒/1分钟/5分钟）
  - 2列网格布局

#### 3. 历史数据查询 ✅

- [x] 时间范围选择器 - 支持 10s/1m/5m 三种采样间隔
- [x] 数据自动刷新 - 每 10 秒更新一次

#### 4. Dashboard 集成 ✅

- [x] 集成到 Dashboard 页面
- [x] 统计卡片 + 趋势图表的完整展示
- [x] 加载状态和错误处理

### 技术实现

**新增文件：**
- `packages/ui/src/lib/components/LineChart.svelte` - 通用折线图组件
- `packages/ui/src/lib/components/MonitoringCharts.svelte` - 监控面板组件
- `packages/ui/src/lib/types.ts` - 类型定义文件

**依赖：**
- `chart.js@4.5.0` - 图表核心库
- `svelte-chartjs@3.1.5` - Svelte 封装

---

## Phase 3: 高级配置 ✅ 已完成

### 目标

支持更复杂的配置功能。

### 已完成功能

#### 1. 全局配置编辑 ✅

- [x] 服务器基础配置（端口、workers 数量等）
- [x] 日志级别配置
- [x] 性能调优参数
- [x] 双模式编辑器（表单/JSON）
- [x] 导入/导出配置文件

#### 2. 表达式引擎 ✅

- [x] 可视化表达式编辑器组件 (`ExpressionEditor.svelte`)
- [x] 表达式测试工具
- [x] 8个常用表达式模板库
- ⚠️ **注意**：组件已创建但暂未集成，等待后端支持条件路由功能

#### 3. Transformer 配置 ✅

- [x] Transformer 编辑器组件 (`TransformerEditor.svelte`)
- [x] API 格式转换预览（Anthropic ↔ Gemini/OpenAI）
- [x] 集成到 RouteEditor（路由级）和 UpstreamForm（upstream级）
- [x] 5种转换器支持

#### 4. 批量操作 ⚠️

- [x] 批量导入路由（JSON格式）
- [x] 批量导出所有路由
- [x] 路由模板功能（7个预配置模板）
- [ ] **批量修改配置** - 待实现

### 技术实现

**新增组件：**
- `ExpressionEditor.svelte` - 表达式可视化编辑器（暂未集成）
- `TransformerEditor.svelte` - Transformer配置和预览
- `RouteTemplates.svelte` - 路由模板选择器

**修改文件：**
- `Configuration.svelte` - 完整重写，双模式编辑器
- `RouteEditor.svelte` - 添加路由级Transformer配置和模板集成
- `UpstreamForm.svelte` - 集成TransformerEditor替换简单下拉框
- `RoutesIndex.svelte` - 添加导入/导出功能

---

## Phase 4: 监控高级功能 ⏳ 待实现

### 目标

增强监控能力，提供更细粒度的性能分析。

### 计划功能

#### 1. 路由级监控

- [ ] 单个路由的性能指标
- [ ] Upstream 健康状态可视化
- [ ] 请求分布热力图
- [ ] 响应时间分布直方图

#### 2. 历史数据查询

- [ ] 时间范围选择器（扩展更多选项）
- [ ] 数据导出功能 (CSV/JSON)
- [ ] 自定义指标聚合

---

## Phase 5: 系统管理 🚧 进行中

### 目标

提供完整的系统管理能力。

### 已完成功能

#### 系统操作 ✅

- [x] 热重载配置 (`routes/Configuration.svelte`)
  - 一键热重载按钮
  - 加载状态指示
  - Toast 成功/失败通知
  - 自动刷新配置显示

### 计划功能

#### 1. 配置版本管理

- [ ] 配置历史记录
- [ ] 版本对比（diff）
- [ ] 回滚功能
- [ ] 配置备份/恢复

#### 2. 安全与权限

- [ ] 用户认证（如需要）
- [ ] 操作审计日志
- [ ] 敏感信息脱敏

#### 3. 系统操作（继续）

- [ ] 服务状态监控
- [ ] Worker 管理
- [ ] 优雅重启

#### 4. 告警与通知

- [ ] 性能阈值告警
- [ ] Upstream 故障通知
- [ ] 自定义告警规则
- [ ] Webhook 集成

---

## 当前进度总结

### ✅ 已完成

- **Phase 1** - 核心配置编辑（所有功能）
  - 基础架构搭建
  - 核心 CRUD 功能
  - 表单验证
  - 实时统计展示
  - 技术难点攻克（onMount、API路径、统计过滤）

- **Phase 2** - 监控和图表（所有功能）
  - Chart.js 集成
  - 4 个趋势图表（QPS、响应时间、错误率、错误数）
  - 时间范围选择器
  - 自动刷新机制
  - Dashboard 集成

- **用户体验优化**（Option B）
  - ConfirmDialog 确认对话框组件
  - Toast 通知系统（4种类型）
  - 按钮加载状态指示器
  - 操作错误处理改进

- **Phase 4** - 系统管理（部分完成）
  - 热重载配置功能

- **Phase 3** - 高级配置（基本完成）
  - 全局配置编辑（双模式 + 导入/导出）
  - Transformer 配置与预览（已集成）
  - 路由模板系统（7个模板）
  - 批量导入/导出路由
  - ExpressionEditor 组件（已创建，待后端支持）

### 🚧 进行中

- Phase 5: 系统管理（热重载功能已完成，其他功能待开发）

### ⏳ 待开始

- Phase 4: 监控高级功能（路由级监控、健康状态可视化）
- Phase 3: 批量修改配置功能

---

## 下一步行动

### 优先级 P0（立即执行）

无（Phase 1 和 Phase 2 已完成）

### 优先级 P1（短期规划）

1. **Phase 3 - 批量修改配置**
   - 批量更新多个路由的配置
   - 批量修改 Transformer
   - 批量修改 Headers/Body

2. **Phase 4 - 监控高级功能**
   - 单个路由的性能指标
   - Upstream 健康状态可视化
   - 请求分布热力图
   - 历史数据导出

3. **Phase 5 - 系统管理（继续）**
   - 配置版本管理
   - 操作日志记录
   - Worker 管理界面
   - 服务状态监控

### 优先级 P2（中期规划）

1. **性能与体验优化**
   - 响应式设计完善（移动端适配）
   - 键盘快捷键
   - 暗色主题
   - 国际化支持（i18n）

2. **告警与通知系统**
   - 性能阈值告警
   - Upstream 故障通知
   - 自定义告警规则
   - Webhook 集成

---

## 技术债务与改进点

### 代码质量

- [ ] 补充单元测试
- [ ] 补充集成测试
- [ ] 代码注释完善

### 用户体验

- [ ] 响应式设计优化（移动端适配）
- [ ] 键盘快捷键支持
- [ ] 国际化支持（i18n）
- [ ] 暗色主题支持

### 性能优化

- [ ] 虚拟滚动（长列表优化）
- [ ] 请求防抖/节流
- [ ] 数据缓存策略

### 可访问性

- [ ] 修复表单 label 关联警告
- [ ] ARIA 属性完善
- [ ] 键盘导航支持

---

## 关键文件索引

### 前端核心文件

```
packages/ui/src/
├── App.svelte                    # 主应用入口
├── main.ts                       # 应用启动
├── lib/
│   ├── stores/                   # 状态管理
│   │   ├── config.ts            # 配置 store
│   │   ├── stats.ts             # 统计 store
│   │   └── toast.ts             # Toast 通知 store (UX 优化)
│   ├── api/                      # API 层
│   │   ├── client.ts            # HTTP 客户端
│   │   ├── routes.ts            # 路由 API
│   │   ├── config.ts            # 配置 API
│   │   ├── stats.ts             # 统计 API
│   │   └── system.ts            # 系统 API
│   ├── validation/               # 验证逻辑
│   │   ├── route-validator.ts
│   │   └── upstream-validator.ts
│   ├── components/               # 组件库
│   │   ├── HeadersEditor.svelte
│   │   ├── BodyEditor.svelte
│   │   ├── UpstreamForm.svelte
│   │   ├── RouteCard.svelte
│   │   ├── LineChart.svelte     # 通用折线图 (Phase 2)
│   │   ├── MonitoringCharts.svelte # 监控面板 (Phase 2)
│   │   ├── ConfirmDialog.svelte # 确认对话框 (UX 优化)
│   │   ├── Toast.svelte         # Toast 通知 (UX 优化)
│   │   ├── ToastContainer.svelte # Toast 容器 (UX 优化)
│   │   ├── ExpressionEditor.svelte # 表达式编辑器 (Phase 3, 待集成)
│   │   ├── TransformerEditor.svelte # Transformer配置 (Phase 3)
│   │   └── RouteTemplates.svelte # 路由模板 (Phase 3)
│   └── types.ts                  # 类型定义
└── routes/                       # 页面
    ├── Dashboard.svelte
    ├── RoutesIndex.svelte
    ├── RouteEditor.svelte
    ├── Configuration.svelte     # 包含热重载功能 (Phase 4)
    └── NotFound.svelte
```

### 后端核心文件

```
packages/core/src/
├── worker.ts                     # 请求处理核心（统计过滤逻辑）
├── ui/
│   ├── server.ts                # UI 请求处理
│   └── assets.ts                # 静态资源
└── api/
    ├── router.ts                # API 路由
    ├── handlers/                # API 处理器
    │   ├── config.ts
    │   ├── stats.ts
    │   └── system.ts
    └── collectors/
        └── stats-collector.ts   # 统计收集器
```

### 配置文件

- `packages/ui/vite.config.ts` - Vite 配置（包含 onMount 修复）
- `packages/ui/svelte.config.js` - Svelte 配置
- `packages/ui/tailwind.config.js` - Tailwind 配置
- `packages/ui/tsconfig.json` - TypeScript 配置

---

## 备注

### 开发环境启动

```bash
# UI 开发模式
cd packages/ui && bun run dev

# 后端开发模式
bun --watch packages/core/src/main.ts

# 完整构建
bun run build
```

### 重要提醒

1. **onMount 问题**：必须保持 vite.config.ts 中的 `resolve.conditions` 配置
2. **API 路径**：所有 API 调用使用相对路径，不要加 `/api` 前缀
3. **统计过滤**：不统计 UI 请求需要在 try 块之前返回
4. **路由方式**：使用手动条件渲染，不使用 svelte-spa-router 的 Router 组件

---

*文档更新时间: 2025-10-03*
