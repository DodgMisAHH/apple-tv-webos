/* Fixed-purpose root-backed TV controls. No browser preview writes to the TV. ES5. */
(function(){
  'use strict';
  var timers=['off','10','20','30','60','90','120','180','240'];
  var outputs=['tv_speaker','external_arc','external_optical','bt_soundbar','tv_external_speaker'];
  function request(action,value){
    var audio='luna://com.webos.service.audio/master/', settings='luna://com.webos.settingsservice/';
    switch(action){
      case 'inputs':return ['luna://com.webos.service.eim/getAllInputStatus',{}];
      case 'soundOutput':return ['luna://com.webos.service.audio/getSoundOutput',{}];
      case 'outputs':return [settings+'getSystemSettingValues',{category:'sound',key:'soundOutput'}];
      case 'audio':return [audio+'getVolume',{}];
      case 'volumeDown':return [audio+'volumeDown',{}];
      case 'volumeUp':return [audio+'volumeUp',{}];
      case 'mute':if(typeof value!=='boolean')break;return [audio+'muteVolume',{mute:value}];
      case 'timer':return [settings+'getSystemSettings',{category:'time',keys:['sleepTimer']}];
      case 'setTimer':if(timers.indexOf(value)<0)break;return [settings+'setSystemSettings',{category:'time',settings:{sleepTimer:value}}];
      case 'output':if(outputs.indexOf(value)<0)break;return [settings+'setSystemSettings',{category:'sound',settings:{soundOutput:value}}];
      case 'powerOff':return ['luna://com.webos.service.tvpower/power/powerOff',{reason:'remoteKey'}];
      case 'screenOff':return ['luna://com.webos.service.tvpower/power/turnOffScreen',{}];
      case 'screenOn':return ['luna://com.webos.service.tvpower/power/turnOnScreen',{}];
    }
    throw new Error('Unsupported control value');
  }
  function quote(s){return "'"+s.replace(/'/g,"'\\''")+"'";}
  var pending={}, reads={}, cache={}, revisions={};
  var ttl={soundOutput:1500,audio:1500,timer:1500,inputs:5000,outputs:15000};
  function group(action){
    if(['volumeDown','volumeUp','mute'].indexOf(action)>=0)return 'audio';
    if(action==='setTimer')return 'timer';
    if(action==='output')return 'soundOutput';
    if(['powerOff','screenOff','screenOn'].indexOf(action)>=0)return 'power';
    return '';
  }
  function invalidate(action){
    delete cache[action];revisions[action]=(revisions[action]||0)+1;
    // Existing listeners complete with stale=true; a new caller can start a fresh read.
    delete reads[action];
  }
  function invalidateWrite(key){invalidate(key);if(key==='soundOutput')invalidate('audio');}
  function peek(action){var c=cache[action];return c && Date.now()-c.at<30000?c.data:null;}
  function call(action,value,cb,options){
    var spec;try{spec=request(action,value);}catch(e){cb({returnValue:false,errorText:e.message});return;}
    if(typeof PalmServiceBridge==='undefined'){cb({returnValue:false,preview:true,errorText:'Preview only · changes are available on the TV.'});return;}
    var key=group(action), writes=!!key, existing=cache[action];
    if(writes&&pending[key]){cb({returnValue:false,pending:true,errorText:'Please wait for the current change.'});return;}
    if(!writes){
      if(!(options&&options.fresh)&&existing&&Date.now()-existing.at<ttl[action]){cb(existing.data);return;}
      if(reads[action]){reads[action].callbacks.push(cb);return;}
    }
    if(writes){pending[key]=true;invalidateWrite(key);}
    var entry={callbacks:[cb],revision:revisions[action]||0}, finished=false;
    if(!writes)reads[action]=entry;
    function done(r){
      if(finished)return;finished=true;clearTimeout(timer);
      if(writes){pending[key]=false;invalidateWrite(key);}
      else {
        if(reads[action]===entry)delete reads[action];
        if(entry.revision!==(revisions[action]||0)||pending[action])r={returnValue:false,stale:true};
        else if(r.returnValue)cache[action]={at:Date.now(),data:r};
      }
      entry.callbacks.forEach(function(fn){fn(r);});
    }
    var timer=setTimeout(function(){done({returnValue:false,errorText:'TV did not respond. Check its current setting before retrying.'});},6500);
    try { window.LauncherControls.luna('luna://org.webosbrew.hbchannel.service/exec',{
      command:'luna-send -w 4500 -n 1 '+quote(spec[0])+' '+quote(JSON.stringify(spec[1]))
    },function(r){try{var data=JSON.parse(r.stdoutString||'{}');if(data.returnValue!==true){data.returnValue=false;data.errorText=data.errorText||r.errorText||'TV rejected the request';}done(data);}catch(e){done({returnValue:false,errorText:e.message});}}); }
    catch(e){done({returnValue:false,errorText:e.message});}
  }
  window.TVControls={call:call,request:request,peek:peek,pending:function(action){return !!pending[group(action)||action];}};
})();
