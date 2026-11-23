import {build} from 'esbuild';
import fs from 'node:fs';
const result=await build({entryPoints:['web/main.tsx'],bundle:true,outdir:'public/ui',entryNames:'app-[hash]',chunkNames:'chunk-[hash]',assetNames:'asset-[hash]',format:'esm',splitting:true,minify:true,sourcemap:false,metafile:true,target:['es2022'],jsx:'automatic',external:['../fonts/*'],define:{'process.env.NODE_ENV':'"production"'}});
const main=Object.entries(result.metafile.outputs).find(([,v])=>v.entryPoint==='web/main.tsx');
if(!main)throw Error('UI entry was not generated');
const js=main[0].replace(/^public\//,''),css=main[1].cssBundle?.replace(/^public\//,'');
fs.writeFileSync('public/index.html',`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#7760d9"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><title>محتواساز · استودیوی تو</title><link rel="manifest" href="manifest.json"><link rel="icon" href="icon.svg"><link rel="preload" href="fonts/Vazirmatn.woff2" as="font" type="font/woff2" crossorigin>${css?`<link rel="stylesheet" href="${css}">`:''}</head><body><div id="app"></div><script src="media-prep.js"></script><script type="module" src="${js}"></script></body></html>`);
fs.writeFileSync('public/ui/build.json',JSON.stringify({entry:js,css,builtAt:new Date().toISOString()}));
console.log(`React UI built: ${js} (${Math.round(fs.statSync('public/'+js).size/1024)} KB)`);
