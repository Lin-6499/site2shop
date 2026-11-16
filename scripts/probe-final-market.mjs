import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
 const context = await browser.newContext({locale:'en-US',viewport:{width:1920,height:1080}});
 const page = await context.newPage();
 for(const url of ['https://haroldhome.co/products/home-state-dad-hat?country=US&currency=USD']){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(2000);
  const result = await page.evaluate(()=>({url:location.href,canonical:document.querySelector('link[rel="canonical"]')?.href,country:window.Shopify?.country,currency:window.Shopify?.currency,price:document.querySelector('.product-price-final')?.textContent?.trim(),localization:[...document.querySelectorAll('form[action*="localization"]')].map(n=>n.outerHTML),widgets:[...document.querySelectorAll('#product-content-area .payment-icons,#product-content-area .edt,#product-content-area .product-social-sharing')].map(n=>({html:n.outerHTML.slice(0,1800),class:n.className})),scripts:[...document.scripts].map(n=>n.src).filter(n=>/delivery|estimated|edt/i.test(n))}));
  console.log(JSON.stringify(result,null,2));
 }
}finally{await browser.close();}
