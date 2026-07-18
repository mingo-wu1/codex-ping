# Codex Market Board

一个面向 Codex/终端代理的公开交易索引。网页负责公开、可审计的数据；搜索、比较、询价和下单主要发生在 Codex 对话中。

当前仓库包含一个可以端到端运行的 MVP：

- Cloudflare Worker + Durable Object 持久化 API
- R2 商品图片上传
- 商家、商品、合规、订单、评论与公开规则
- 基于真实成交的可解释排名
- 模拟支付闭环与 Stripe Checkout/webhook 适配器
- 自然语言 Python 客户端和 Codex skill
- 公开交易黑板页面与自动测试

## 核心原则

1. 黑板公开摘要，不公开聊天、收货地址或支付凭证。
2. 排名依赖真实付款、退款和争议数据，不接受付费买榜。
3. 评论可以存在，但不提供简单“好评率”排序。
4. 合规是持续审核过程，不以商家声明代替法律判断。
5. 支付通过适配器接入；MVP 不保存卡号等敏感支付信息。

## 开发

```bash
npm install
npm test
npm run dev
```

本地服务默认是 `http://127.0.0.1:8787`。若要运行完整冒烟测试：

```powershell
# 另一个终端在 8791 端口启动，并配置仅用于本地的管理令牌
npx wrangler dev --port 8791 --var ADMIN_TOKEN:local-test-admin --var ALLOW_MOCK_PAYMENTS:true
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1
```

冒烟测试覆盖商家注册和验证、商品发布和审核、图片上传、搜索、订单确认、模拟付款、履约、买家确认收货、真实成交统计和已成交评论。

## 安装 Codex 客户端

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Server https://your-worker.example
```

macOS / Linux：

```bash
chmod +x install.sh
./install.sh https://your-worker.example
```

重启 Codex 后可以直接说：

```text
$marketboard 我叫路飞
$marketboard 找300元以内的电动牙刷
$marketboard 看 lst_xxx
$marketboard 买 lst_xxx
$marketboard 确认买 lst_xxx
$marketboard 付款 ord_xxx
$marketboard 订单 ord_xxx
$marketboard 确认收货 ord_xxx
```

商家可以说：

```text
$marketboard 商家入驻 女帝商店
$marketboard 上传图 C:\商品\牙刷.png
$marketboard 发布 声波电动牙刷 199 CNY
$marketboard 商家订单
$marketboard 接单 ord_xxx
$marketboard 已发货 ord_xxx
```

## 部署

1. 创建 R2 bucket：`wrangler r2 bucket create codex-market-board-images`
2. 设置管理密钥：`wrangler secret put ADMIN_TOKEN`
3. 设置付款签名密钥：`wrangler secret put PAYMENT_SIGNING_SECRET`
4. 部署：`npm run deploy`

生产环境必须关闭模拟付款：

```text
ALLOW_MOCK_PAYMENTS=false
PAYMENT_PROVIDER=stripe
```

Stripe 模式还需配置 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`，并把 webhook 指向 `/api/stripe/webhook`。商家 Stripe Connect 账户由管理员写入 `/api/merchants/:id/payment-account`，不会出现在公开黑板。

不要在代码、聊天或 Git 仓库中保存真实密钥、银行卡信息、身份证件或收货地址。

完整范围见 [docs/PRD.md](docs/PRD.md)。
