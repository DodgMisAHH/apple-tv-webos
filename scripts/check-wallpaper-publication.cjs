const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lg-wallpaper-')),app=path.join(dir,'app');fs.mkdirSync(app);
process.env.LG_LAUNCHER_DATA=dir;process.env.LG_LAUNCHER_APP_DIR=app;
const publication=require('../tv/publication.js'),timers=[],calls=[];
fs.writeFileSync(path.join(dir,'.wallpaper-key'),'0123456789ab');fs.writeFileSync(path.join(dir,'settings.json'),'{}');
const server={on(){return this;},listen(){return this;}};
const ctx={Buffer,console:{log(){}},process:{exit(){}},setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},
 require(name){if(name==='./publication')return publication;if(name==='http')return {createServer(){return server;}};
   if(name==='child_process')return {execFile(cmd,args,options,callback){calls.push({cmd,args,options,callback});}};return require(name);}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../tv/wallpaper-server.js'),'utf8'),ctx);
function req(method,url,body,type){const request=new EventEmitter();Object.assign(request,{method,url:url+(url.includes('?')?'&':'?')+'k=0123456789ab',headers:{'content-type':type||'image/jpeg'}});
 const response={writeHead(code){this.code=code;},end(body){this.body=body;this.ended=true;}};ctx.handle(request,response);
 if(body){request.emit('data',body);request.emit('end');}return response;}
function fire(){const ts=timers.splice(0);ts.forEach(t=>t.fn());}
function jpeg(w,h){return Buffer.from([255,216,255,192,0,17,8,h>>8,h&255,w>>8,w&255,3,1,17,0,2,17,0,3,17,0,255,217]);}
function multipart(parts){const out=[];for(const [name,body]of Object.entries(parts)){out.push(Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="'+name+'"; filename="'+name+'.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),body,Buffer.from('\r\n'));}out.push(Buffer.from('--test-boundary--\r\n'));return Buffer.concat(out);}
try {
 const responses=[];for(let i=1;i<=5;i++)responses.push(req('POST','/api/dim?v='+i/10));
 assert.equal(calls.length,0);fire();assert.equal(calls.length,1,'rapid settings changes batch into one worker');
 assert(calls[0].args.includes('--settings'));assert(responses.every(r=>!r.ended),'responses wait for publication');
 const newer=req('POST','/api/dim?v=0.6');calls[0].callback(null,'','');
 assert(responses.every(r=>r.code===200));assert(!newer.ended,'newer change cannot complete with older snapshot');
 fire();assert.equal(calls.length,2);calls[1].callback(null,'','');assert.equal(newer.code,200);
 const notifications=calls.filter(c=>c.cmd==='luna-send');assert.equal(notifications.length,1,'only final batch requests a hot update');
 const params=JSON.parse(notifications[0].args.at(-1)).params;assert(params.settingsChanged&&params.settingsToken);
 assert(params.reload&&params.reloadToken===params.settingsToken,'old launchers receive a fresh compatible reload token');
 const noChange=req('POST','/api/dim?v=0.6');fire();assert.equal(noChange.code,200);assert.equal(calls.length,3,'unchanged settings need no worker');
 const failed=req('POST','/api/dim?v=0.7');fire();calls.at(-1).callback(new Error('fixture publication failed'),'','');assert.equal(failed.code,500);
 const retry=req('POST','/api/dim?v=0.7');const beforeRetry=calls.length;fire();assert.equal(calls.length,beforeRetry+1,'same-value retry republishes after failure');
 assert(!retry.ended);calls.at(-1).callback(null,'','');assert.equal(retry.code,200);
 const photo=jpeg(1920,1080),frost=jpeg(384,216);
 let response=req('POST','/api/upload',multipart({wallpaper:photo,frost}),'multipart/form-data; boundary=test-boundary');
 assert(fs.readFileSync(path.join(dir,'wallpaper.jpg')).equals(photo));assert(fs.readFileSync(path.join(dir,'wallpaper-frost.jpg')).equals(frost));
 fire();calls.at(-1).callback(null,'','');assert.equal(response.code,200);
 const nextPhoto=Buffer.concat([photo,Buffer.from('different photo')]);
 response=req('POST','/api/upload',multipart({wallpaper:nextPhoto,frost}),'multipart/form-data; boundary=test-boundary');
 assert(fs.statSync(path.join(dir,'wallpaper-frost.jpg')).mtimeMs>=fs.statSync(path.join(dir,'wallpaper.jpg')).mtimeMs,'identical supplied frost remains fresh for a new photo');
 fire();calls.at(-1).callback(null,'','');assert.equal(response.code,200);
 response=req('POST','/api/upload',photo);assert(!fs.existsSync(path.join(dir,'wallpaper-frost.jpg')),'old client removes incompatible old frost');
 fire();calls.at(-1).callback(null,'','');assert.equal(response.code,200);
 response=req('POST','/api/upload',jpeg(4000,3000));assert.equal(response.code,400,'decoded wallpaper dimensions are bounded');
 response=req('POST','/api/upload',multipart({wallpaper:photo,frost:jpeg(1920,1080)}),'multipart/form-data; boundary=test-boundary');assert.equal(response.code,400,'frost dimensions are checked');
 response=req('POST','/api/upload',Buffer.alloc(10*1024*1024+1));assert.equal(response.code,413,'request bytes are bounded');
 // Restart before a successful settings receipt exists; an identical save must repair it.
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../tv/wallpaper-server.js'),'utf8'),ctx);
 const restarted=req('POST','/api/dim?v=0.7'),beforeRestart=calls.length;fire();
 assert.equal(calls.length,beforeRestart+1,'unpublished settings survive a server restart');
 assert(!restarted.ended);calls.at(-1).callback(null,'','');assert.equal(restarted.code,200);
 console.log('Settings batching/completion, hot notifications, unchanged saves, multipart/legacy uploads and image bounds passed.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
