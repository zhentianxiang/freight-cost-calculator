# Freight Cost Calculator (外贸报价计算器)

这是一个专为外贸行业设计的 CFR 报价自动计算器。它集成了货物成本计算、货代费用方案对比、实时汇率获取以及专业 Excel 导出功能。

## 功能特点

- **自动测算**：货物成本、货代费用、客户报价与净利润实时联动。
- **多方案对比**：支持多个货代方案对比，自动推荐最优（总成本最低）方案。
- **专业导出**：一键导出客户版（简洁）和内部留存版（含成本明细）的专业 Excel 表格。
- **归档系统**：支持将报价记录保存到服务器，随时查看历史记录或重新加载。
- **响应式设计**：适配 PC 和移动端。

## 技术栈

- **前端**：Vanilla JS, CSS3, HTML5
- **后端**：Go (Golang) + [Excelize](https://github.com/qax-os/excelize)
- **容器化**：Docker + Docker Compose
- **网关**：Nginx

## 快速启动

1. 确保已安装 Docker 和 Docker Compose。
2. 在项目根目录运行：
   ```bash
   docker-compose up -d
   ```
3. 访问 `http://localhost:8080` 即可开始使用。

## 目录结构

- `quote-service/cmd/server/`: Go 后端服务入口
- `quote-service/cmd/export/`: 命令行 Excel 导出入口
- `quote-service/internal/httpapi/`: HTTP 路由与接口处理
- `quote-service/internal/quote/`: 报价数据模型、计算逻辑与 Excel 生成
- `quote-service/internal/archive/`: 报价归档文件存储
- `quote-service/internal/runner/`: 命令行任务封装
- `quote-service/Dockerfile`: Go 后端镜像构建
- `nginx/`: Nginx 配置文件及 Dockerfile
- `index.html`: 前端主页面
- `quote-app.js`: 前端页面控制、接口调用与 PI 交互
- `quote-calculator.css`: 前端样式
- `docker-compose.yml`: 服务编排配置
