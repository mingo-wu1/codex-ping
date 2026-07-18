export const BOARD_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>交易黑板</title>
<style>
  :root{color-scheme:light;--ink:#161616;--muted:#696969;--line:#dedbd2;--paper:#f6f3ea;--card:#fffdf7;--accent:#1e5b45}
  *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
  header,main{max-width:1040px;margin:auto;padding:24px}header{display:flex;gap:20px;align-items:end;justify-content:space-between;border-bottom:1px solid var(--line)}
  h1{font:700 34px/1.1 Georgia,serif;margin:0}.sub{color:var(--muted);max-width:580px}.search{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;margin:24px 0}
  input,select,button{font:inherit;border:1px solid var(--line);border-radius:6px;padding:11px;background:white}button{background:var(--accent);color:white;border-color:var(--accent);cursor:pointer}
  #status{color:var(--muted);min-height:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{background:var(--card);border:1px solid var(--line);padding:18px;border-radius:8px}
  .price{font-size:22px;font-weight:700}.meta,.score{color:var(--muted);font-size:13px}.pill{display:inline-block;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:12px}dialog{max-width:660px;border:1px solid var(--line);border-radius:8px;padding:24px}pre{white-space:pre-wrap}
  @media(max-width:700px){header{display:block}.search{grid-template-columns:1fr}h1{margin-bottom:10px}}
</style>
<header><div><h1>交易黑板</h1><div class="sub">公开商品摘要、规则和真实成交数据。让 Codex 帮你搜索、比较和交易。</div></div><div class="pill">No paid ranking</div></header>
<main>
  <form id="search" class="search">
    <input id="q" placeholder="例如：电动牙刷" aria-label="搜索商品">
    <input id="max" type="number" min="0" placeholder="最高价格">
    <select id="sort"><option value="trust">可信成交</option><option value="price">价格从低到高</option></select>
    <button>搜索</button>
  </form>
  <div id="status"></div><section id="results" class="grid"></section>
</main>
<dialog id="detail"><button id="close" style="float:right">关闭</button><div id="detailBody"></div></dialog>
<script>
const searchForm=document.querySelector('#search');
const queryInput=document.querySelector('#q');
const maxInput=document.querySelector('#max');
const sortSelect=document.querySelector('#sort');
const statusElement=document.querySelector('#status');
const resultsElement=document.querySelector('#results');
const detailDialog=document.querySelector('#detail');
const detailBodyElement=document.querySelector('#detailBody');
const closeButton=document.querySelector('#close');
const money=(minor,currency)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency}).format(minor/100);
async function load(){
  statusElement.textContent='正在读取公开黑板…';
  const params=new URLSearchParams({q:queryInput.value,sort:sortSelect.value});
  if(maxInput.value)params.set('max_price_minor',Math.round(Number(maxInput.value)*100));
  const response=await fetch('/api/listings?'+params);const data=await response.json();
  if(!response.ok){statusElement.textContent=data.error;return}statusElement.textContent='找到 '+data.listings.length+' 个公开商品';
  resultsElement.replaceChildren(...data.listings.map(item=>{const el=document.createElement('article');el.className='card';el.innerHTML='<div class="pill"></div><h2></h2><div class="price"></div><p></p><div class="score"></div><button>查看透明数据</button>';el.querySelector('.pill').textContent=item.category;el.querySelector('h2').textContent=item.title;el.querySelector('.price').textContent=money(item.priceMinor,item.currency);el.querySelector('p').textContent=item.summary;el.querySelector('.score').textContent='商家：'+item.merchant.displayName+' · 样本 '+item.ranking.explanation.sampleSize+' 笔 · 可信分 '+item.ranking.score;el.querySelector('button').onclick=()=>show(item.id);return el;}));
}
async function show(id){const r=await fetch('/api/listings/'+id);const {listing}=await r.json();detailBodyElement.innerHTML='<h2></h2><p></p><pre></pre>';detailBodyElement.querySelector('h2').textContent=listing.title;detailBodyElement.querySelector('p').textContent=listing.summary;detailBodyElement.querySelector('pre').textContent=JSON.stringify({price:money(listing.priceMinor,listing.currency),merchant:listing.merchant,compliance:listing.compliance,ranking:listing.ranking,comments:listing.comments},null,2);detailDialog.showModal()}
searchForm.addEventListener('submit',event=>{event.preventDefault();load()});closeButton.addEventListener('click',()=>detailDialog.close());load();
</script>
</html>`;
