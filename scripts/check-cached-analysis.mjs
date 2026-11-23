// Offline replay of an actual cached failure. Every provider is disabled.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import express from 'express';
const sourceRoot=path.resolve('data/test-out/template-ui-review');const stored=JSON.parse(fs.readFileSync(path.join(sourceRoot,'db.json'),'utf8'));
const original=stored.contents.find(e=>e.id==='0wa264LS3V');if(!original||original.operation!=='analyze')throw Error('Cached failed analysis not found');
process.env.DATA_DIR=path.resolve('data/test-out/cached-analysis-recovery',crypto.randomUUID());
const dst=path.join(process.env.DATA_DIR,'contents',original.id);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.cpSync(path.join(sourceRoot,'contents',original.id),dst,{recursive:true});
const {contentRoutes}=await import('../src/content-routes.js');const db={users:{[original.userId]:structuredClone(stored.users[original.userId])},contents:[structuredClone(original)],jobs:[]};let providerCalls=0;
const blocked=async()=>{providerCalls++;throw Error('No provider call allowed during cache recovery');};
const app=express();app.use(express.json());const auth=(req,res,next)=>{req.user=db.users[original.userId];req.token='offline';next();};const wrap=fn=>async(req,res,next)=>{try{await fn(req,res,next);}catch(e){res.status(e.status||500).json({error:e.message});}};
const routes=contentRoutes(app,{db,save:()=>{},requireUser:auth,wrap,providers:{json:blocked,image:blocked,transcribe:blocked}});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/content/${original.id}/retry`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cacheOnly:true})});assert.equal(response.status,202);await routes.idle();const e=db.contents[0];assert.equal(providerCalls,0);assert.equal(e.status,'awaiting');assert.equal(e.observed.products[0].brand,'');assert(e.question?.choices.some(c=>c.label==='مرکباتی و تازه'));assert.equal(e.fields.scent,undefined);
 const missing=structuredClone(original);missing.id='cache-miss';const missingDir=path.join(process.env.DATA_DIR,'contents',missing.id);fs.mkdirSync(missingDir,{recursive:true});fs.copyFileSync(path.join(dst,missing.source.file),path.join(missingDir,missing.source.file));db.contents.push(missing);
 const miss=await fetch(`http://127.0.0.1:${server.address().port}/api/content/${missing.id}/retry`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cacheOnly:true})});assert.equal(miss.status,202);await routes.idle();assert.equal(missing.status,'error');assert.equal(providerCalls,0);
 const out={id:e.id,status:e.status,question:e.question.text,providerCalls,cacheMissCannotCallProvider:true,sourcePreserved:JSON.stringify(e.source)===JSON.stringify(original.source),replayDirectory:process.env.DATA_DIR};fs.writeFileSync(path.join(process.env.DATA_DIR,'verified.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}finally{server.close();}
