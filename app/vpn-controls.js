/* Fixed WireGuard profile commands. Opening Control Centre only reads status. ES5. */
(function () {
  'use strict';
  var ids=['lisbon','uk','us'], changing=false, revision=0;
  var helper='/var/lib/webosbrew/wireguard/scripts/profiles.js';
  function command(action,id){
    if(['status','disconnect','select','connect'].indexOf(action)<0)throw new Error('Unsupported VPN action');
    if(action==='select'||action==='connect'){
      if(ids.indexOf(id)<0)throw new Error('Unsupported VPN preset');
    }else if(id!==null&&typeof id!=='undefined')throw new Error('Unexpected VPN preset');
    return "/usr/bin/node '"+helper+"' '"+action+"'"+((action==='select'||action==='connect')?" '"+id+"'":'');
  }
  function call(action,id,callback){
    var cmd;try{cmd=command(action,id);}catch(e){callback({ok:false,error:e.message});return;}
    if(typeof PalmServiceBridge==='undefined'||!window.LauncherControls||!window.LauncherControls.luna){callback({ok:false,preview:true});return;}
    var write=action!=='status';
    if(changing){callback({ok:false,pending:true});return;}
    if(write){changing=true;revision++;}
    var version=revision,finished=false,timer;
    function finish(result){
      if(finished)return;finished=true;clearTimeout(timer);
      if(write){changing=false;revision++;}
      else if(version!==revision)result={ok:false,stale:true};
      callback(result);
    }
    timer=setTimeout(function(){finish({ok:false,timeout:true});},write?45000:8000);
    try{
      window.LauncherControls.luna('luna://org.webosbrew.hbchannel.service/exec',{command:cmd},function(response){
        try{
          if(!response||response.returnValue===false){finish({ok:false});return;}
          var output=typeof response.stdoutString==='string'?response.stdoutString:'';
          if(!output&&response.stdoutBytes&&typeof atob==='function')output=atob(response.stdoutBytes);
          var data=JSON.parse(output||'{}');
          if(data.ok!==true){finish({ok:false});return;}
          if(typeof data.tunnel!=='boolean'||typeof data.connected!=='boolean'||!Array.isArray(data.profiles))throw new Error('Invalid VPN status');
          // A handshake without a live tunnel must never show Connected.
          data.connected=data.tunnel&&data.connected;
          finish(data);
        }catch(e){finish({ok:false});}
      });
    }catch(e){finish({ok:false});}
  }
  window.VPNControls={call:call,command:command,pending:function(){return changing;}};
})();
