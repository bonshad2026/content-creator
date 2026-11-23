// Isolated UI review: real local API/transport, explicitly mocked AI, no paid calls.
import fs from 'node:fs';import path from 'node:path';import express from 'express';
process.env.DATA_DIR=path.resolve('data/test-out/content-ui-review');delete process.env.GAPGPT_API_KEY;
const {contentRoutes}=await import('../src/content-routes.js'),{contentCatalog}=await import('../src/content-catalog.js'),{uploadRoutes}=await import('../src/uploads.js'),{inspectContentMedia}=await import('../src/content-media.js');
const file=path.join(process.env.DATA_DIR,'review.json');fs.mkdirSync(process.env.DATA_DIR,{recursive:true});const db=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{users:{review:{id:'review',name:'بررسی رابط',phone:'09120000000',usage:{}}},jobs:[],edits:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(db));const app=express();app.use(express.json());
const user={...db.users.review,plan:{name:'آزمایشی'}};
app.get('/api/config',(_req,res)=>res.json({edition:'content-v1',demoMode:true,smsEnabled:false,maxUploadBytes:25*1048576,model:'UI-MOCK'}));
app.post('/api/auth/send',(_req,res)=>res.json({phone:'09120000000',devCode:'12345'}));app.post('/api/auth/verify',(_req,res)=>res.json({token:'content-ui-review',user}));
const auth=(req,res,next)=>{if(req.get('x-creator-token')!=='content-ui-review')return res.sendStatus(401);req.user=db.users.review;req.token='content-ui-review';next();};
app.get('/api/me',auth,(_req,res)=>res.json(user));app.get(['/api/jobs','/api/edits'],auth,(_req,res)=>res.json([]));
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res,next);}catch(e){res.status(e.status||500).json({error:e.message});}};
uploadRoutes(app,{db,save,requireUser:auth,wrap,validateUpload:inspectContentMedia,maxBytes:25*1048576});
contentRoutes(app,{db,save,requireUser:auth,wrap,providers:{json:async spec=>{if(spec.system.startsWith('Inspect'))return {data:{products:[{name:'کرم آبرسان',brand:'لافارر',visibleText:['Hydrating Cream']}],certain:true,question:'',choices:[]}};if(spec.system.startsWith('Compare'))return {data:{identityPreserved:true,productCount:1,reason:''}};return {data:{caption:'روتین روزانه‌ات، با یک انتخاب تازه.\nکرم آبرسان لافارر؛ برای اطلاعات و سفارش پیام بده.\n\n#مراقبت_پوست #لافارر'}};},image:async spec=>{await new Promise(r=>setTimeout(r,1800));fs.copyFileSync('data/test-out/single-photo-splash/result-attempt-2.png',spec.output,fs.constants.COPYFILE_EXCL);spec.onGeneration(null);},transcribe:async()=>({segments:[{text:'برای معرفی محصولم یک کپشن کوتاه می‌خواهم.'}]})}});
app.use(express.static('public'));app.listen(3026,'127.0.0.1',()=>console.log('Isolated mocked UI review http://127.0.0.1:3026/'));
