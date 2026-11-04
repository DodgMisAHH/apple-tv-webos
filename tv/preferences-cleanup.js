/* Optional launcher cleanup. Restore only the fields this tool changes. ES5. */
'use strict';
var fs=require('fs'),vm=require('vm');
var mode=process.argv[2];
if(mode!=='apply'&&mode!=='restore')throw new Error('Use apply or restore');
var data='/home/root/lg-tv-vibehack',file=data+'/settings.json';
var settings=JSON.parse(fs.readFileSync(file,'utf8'));
var original=data+'/recovery/settings-before-cleanup.json';
var defaults=data+'/recovery/cleanup-config-defaults.json';
var ctx={window:{}};
vm.runInNewContext(fs.readFileSync('/media/developer/apps/usr/palm/applications/com.gathin.tvhome/config.js','utf8'),ctx);
var config=ctx.window.CONFIG;
function has(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
if(mode==='apply'){
  if(!fs.existsSync(original))fs.writeFileSync(original,fs.readFileSync(file));
  if(!fs.existsSync(defaults))fs.writeFileSync(defaults,JSON.stringify({hiddenApps:config.hiddenApps||[],liveTvApp:config.liveTvApp||''}));
  var hidden=(settings.hiddenApps||config.hiddenApps||[]).slice();
  ['amazon.alexa.view','amazon.alexapr','google.assistant','com.webos.app.sportsteamsettings',
   'com.webos.app.miracast','com.webos.app.voice','com.webos.app.voiceweb','org.webosbrew.inputhook',
   'com.webos.app.homeconnect','com.webos.app.mediadiscovery'].forEach(function(id){if(hidden.indexOf(id)<0)hidden.push(id);});
  settings.hiddenApps=hidden;
  settings.liveTvApp='';
}else{
  var old=JSON.parse(fs.readFileSync(original,'utf8')),base=JSON.parse(fs.readFileSync(defaults,'utf8'));
  settings.hiddenApps=has(old,'hiddenApps')?old.hiddenApps:base.hiddenApps;
  settings.liveTvApp=has(old,'liveTvApp')?old.liveTvApp:base.liveTvApp;
}
fs.writeFileSync(file+'.tmp',JSON.stringify(settings,null,2)+'\n');fs.renameSync(file+'.tmp',file);
console.log('Launcher cleanup preferences '+mode+' complete; other preferences retained.');
