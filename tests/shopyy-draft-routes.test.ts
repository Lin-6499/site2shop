import test from 'node:test';
import assert from 'node:assert/strict';
import {shopyyDraftRoute} from '../src/shopyy/draft-routes.js';
test('draft route adapter preserves content context without crossing platform boundaries',()=>{
 for(const path of ['/','/products/example','/collections/all','/pages/coa-report?tab=1#details','/search?q=abc','/blogs/news']){
 const u=new URL(shopyyDraftRoute(path),'https://pepsss.zenshop.cn');for(const [key,value]of Object.entries({theme_id:'504457',preview:'1',is_theme_edit:'1'}))assert.equal(u.searchParams.get(key),value);
 }
 for(const path of ['/cart','/account/login','/checkout','/orders/1','//another.invalid/pages/a','https://example.com/pages/a'])assert.equal(shopyyDraftRoute(path),path);
 assert.equal(shopyyDraftRoute('/pages/a?theme_id=old&theme_id=other&x=1#part'),'/pages/a?theme_id=504457&x=1&preview=1&is_theme_edit=1#part');
});
