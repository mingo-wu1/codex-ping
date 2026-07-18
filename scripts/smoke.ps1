param(
  [string]$BaseUrl = "http://127.0.0.1:8791",
  [string]$AdminToken = "local-test-admin"
)

$ErrorActionPreference = "Stop"
$jsonHeaders = @{ "content-type" = "application/json" }

$merchantResult = Invoke-RestMethod "$BaseUrl/api/merchants" -Method Post -Headers $jsonHeaders -Body (@{
  displayName = "Hancock Store"
  entityType = "individual"
  operatingRegions = @("CN")
  policyAcceptances = @(@{ id = "cn-general-goods"; version = "1" })
} | ConvertTo-Json -Depth 8)
$merchant = $merchantResult.merchant
$merchantHeaders = @{ "content-type" = "application/json"; authorization = "Bearer $($merchantResult.merchantToken)" }

Invoke-RestMethod "$BaseUrl/api/merchants/$($merchant.id)/verify" -Method Post -Headers @{
  "content-type" = "application/json"
  "x-admin-token" = $AdminToken
} -Body '{"level":"basic"}' | Out-Null

$listingResult = Invoke-RestMethod "$BaseUrl/api/listings" -Method Post -Headers $merchantHeaders -Body (@{
  merchantId = $merchant.id
  title = "Electric toothbrush Sonic"
  summary = "Soft brush, USB-C charging"
  category = "personal-care"
  priceMinor = 19900
  currency = "CNY"
  shippingRegions = @("CN")
  policyId = "cn-general-goods"
  policyVersion = "1"
} | ConvertTo-Json -Depth 8)
$listing = $listingResult.listing

$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
$imageResult = Invoke-RestMethod "$BaseUrl/api/images?merchant=$($merchant.id)" -Method Post -Headers @{
  authorization = "Bearer $($merchantResult.merchantToken)"
} -ContentType "image/png" -Body $png
$imageResponse = Invoke-WebRequest $imageResult.url -UseBasicParsing
if ($imageResponse.StatusCode -ne 200) { throw "image upload failed" }

Invoke-RestMethod "$BaseUrl/api/listings/$($listing.id)/compliance" -Method Post -Headers @{
  "content-type" = "application/json"
  "x-admin-token" = $AdminToken
} -Body '{"status":"active","policyId":"cn-general-goods","policyVersion":"1"}' | Out-Null

$search = Invoke-RestMethod "$BaseUrl/api/listings?q=toothbrush&max_price_minor=30000&currency=CNY&ship_to=CN&sort=price"
if ($search.listings.Count -lt 1) { throw "listing search failed" }

$preview = Invoke-RestMethod "$BaseUrl/api/orders/preview" -Method Post -Headers $jsonHeaders -Body (@{
  listingId = $listing.id
  quantity = 1
} | ConvertTo-Json)

$orderResult = Invoke-RestMethod "$BaseUrl/api/orders" -Method Post -Headers $jsonHeaders -Body (@{
  listingId = $listing.id
  quantity = 1
  buyerId = "Luffy"
  buyerConfirmed = $true
} | ConvertTo-Json)
$order = $orderResult.order
$orderHeaders = @{ "content-type" = "application/json"; authorization = "Bearer $($orderResult.orderToken)" }

$checkout = Invoke-RestMethod "$BaseUrl/api/orders/$($order.id)/checkout" -Method Post -Headers $orderHeaders -Body '{}'
$checkoutUri = [Uri]$checkout.checkoutUrl
$secret = [System.Web.HttpUtility]::ParseQueryString($checkoutUri.Query).Get("secret")
Start-Sleep -Milliseconds 200
$payUrl = "$BaseUrl/api/mock-pay/$($order.id)"
$payBody = @{ secret = $secret } | ConvertTo-Json
try {
  $paid = Invoke-RestMethod $payUrl -Method Post -Headers $jsonHeaders -Body $payBody
} catch {
  Start-Sleep -Milliseconds 500
  $paid = Invoke-RestMethod $payUrl -Method Post -Headers $jsonHeaders -Body $payBody
}
if ($paid.order.status -ne "paid") { throw "payment flow failed" }

foreach ($transition in @(
  @{ status = "accepted" },
  @{ status = "fulfilled" }
)) {
  Invoke-RestMethod "$BaseUrl/api/orders/$($order.id)/status" -Method Post -Headers $merchantHeaders -Body ($transition | ConvertTo-Json) | Out-Null
}
Invoke-RestMethod "$BaseUrl/api/orders/$($order.id)/status" -Method Post -Headers $orderHeaders -Body '{"status":"completed","fulfilledOnTime":true}' | Out-Null

$comment = Invoke-RestMethod "$BaseUrl/api/listings/$($listing.id)/comments" -Method Post -Headers $orderHeaders -Body (@{
  orderId = $order.id
  authorId = "Luffy"
  body = "Verified purchase comment."
} | ConvertTo-Json)
if (-not $comment.comment.verifiedPurchase) { throw "verified comment failed" }

$detail = Invoke-RestMethod "$BaseUrl/api/listings/$($listing.id)"
[pscustomobject]@{
  merchantId = $merchant.id
  listingId = $listing.id
  orderId = $order.id
  orderTotal = $preview.preview.totalMinor
  paid = $true
  completedOrders = $detail.listing.ranking.explanation.completedOrders
  verifiedComment = $comment.comment.verifiedPurchase
  imageUploaded = $true
} | ConvertTo-Json -Depth 5
