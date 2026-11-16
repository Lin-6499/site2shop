import {readFile} from 'node:fs/promises';
import {load} from 'cheerio';
const source=JSON.parse(await readFile('../voidresearch-shopyy/artifacts/1d747f2a90c538eca774c16aec4e17fa10163cfa533d67bc28ee78dcd87291da.json','utf8'));
const $=load(source.structure);
console.log(JSON.stringify({forms:$('div.min-h-screen > section:has(form)').map((_,n)=>({heading:$(n).find('h1,h2,h3').map((_,h)=>$(h).text()).get(),rootClass:$(n).attr('class'),formCount:$(n).find('form').length,inputs:$(n).find('input').map((_,i)=>({id:$(i).attr('id'),placeholder:$(i).attr('placeholder')})).get()})).get()}));
console.log(JSON.stringify({order:$('div.min-h-screen').first().children().map((_,n)=>({tag:n.tagName,id:$(n).attr('id'),headings:$(n).find('h1,h2,h3').map((_,h)=>$(h).text()).get()})).get()}));
for(const id of ['hero','batch-testing','quality','assurance-newsletter']){const old=load(await readFile(`../voidresearch-shopyy/staging/composers/${id}.htm`,'utf8'),null,false);console.log(JSON.stringify({id,oldElements:old('*').length,oldHeadings:old('h1,h2,h3').map((_,n)=>old(n).text()).get()}));}
console.log(JSON.stringify({sections:$('div.min-h-screen').first().children('section').map((_,n)=>({id:$(n).attr('id'),elements:$(n).find('*').length+1,text:$(n).text().slice(0,250),images:$(n).find('img').length,links:$(n).find('a').map((_,a)=>$(a).attr('href')).get()})).get()}));
