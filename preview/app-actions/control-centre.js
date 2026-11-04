/* Preview-only Control Centre: installed launcher files are not changed. */
(function () {
  'use strict';
  var entries = [
    {title:'Power Off', kind:'power', detail:'Preview only. A wired-up version would put the TV into standby.'},
    {title:'Wi-Fi', sub:'…', kind:'wifi', detail:'Preview only. Network status and a shortcut to LG network settings; no Wi-Fi changes are made here.'},
    {title:'Screen Off', kind:'screen', detail:'Preview only. Turn the picture off while leaving audio playing, where supported.'},
    {title:'Sound', sub:'…', kind:'sound', detail:'Preview only. Volume, mute and sound output controls can be connected to TV services.'},
    {title:'Sleep Timer', kind:'timer', detail:'Preview only. A sleep timer needs verification against this TV’s settings service before wiring it up.'},
    {title:'Hidden apps', kind:'round hiddenApps', detail:''},
    {title:'Inputs', kind:'round inputs', detail:'Preview only. Select an HDMI input.'},
    {title:'Wallpaper', kind:'round wallpaper', detail:'Preview only. Open the existing wallpaper chooser.'},
    {title:'Settings', kind:'round settings', detail:'Preview only. Open the full LG settings panel.'}
  ];
  var ccToggle=document.createElement('button');
  ccToggle.id='ccHeaderToggle';ccToggle.setAttribute('aria-label','Control Centre');
  ccToggle.innerHTML='<span class="sfSymbol sfSwitch" aria-hidden="true" style="-webkit-mask-image:url(ui-icons/controls.svg)"></span>';
  document.getElementById('timeRow').appendChild(ccToggle);
  ccToggle.addEventListener('click',function(e){e.stopPropagation();if(open)close();else show();});
  var selected=0, open=false, detail=false;
  var panel=document.getElementById('controlCentre'), tiles=document.getElementById('ccTiles');
  var detailEl=document.getElementById('ccDetail');
  var buttons=entries.map(function(entry,i){
    var b=document.createElement('button');b.className='ccTile '+entry.kind;b.setAttribute('aria-label',entry.title);
    var symbol=['power','wifi','moon','sound','timer',null,'input','image','settings'][i];
    var glyph=document.createElement('span');glyph.className='sfSymbol';glyph.setAttribute('aria-hidden','true');
    if(entry.kind==='round hiddenApps'){
      glyph.className='ccHiddenGlyph';
      glyph.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A12 12 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3 3.8M6.2 6.2A21 21 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    }else glyph.style.webkitMaskImage='url(ui-icons/'+symbol+'.svg)';b.appendChild(glyph);
    var strong=document.createElement('strong');strong.textContent=entry.title;b.appendChild(strong);
    var small=document.createElement('small');small.textContent=entry.sub||'';b.appendChild(small);
    b.addEventListener('mouseenter',function(){focus(i);});
    b.addEventListener('click',function(){focus(i);activate();});tiles.appendChild(b);return b;
  });
  function interaction(){var api=window.LauncherControls;if(api&&api.noteInteraction)api.noteInteraction();}
  function panelActive(active){var api=window.LauncherControls;if(api&&api.setPanelActive)api.setPanelActive('controlCentre',active);}
  function focus(i){
    if(!buttons[i]||buttons[i].hidden)return;
    if(i===selected&&buttons[i].classList.contains('selected'))return;
    if(buttons[selected])buttons[selected].classList.remove('selected');
    selected=i;buttons[i].classList.add('selected');interaction();
    if(open&&!detail)viewToken++;
  }
  function show(){viewToken++;open=true;detail=false;tiles.hidden=false;detailEl.hidden=true;detailEl.classList.remove('ccHiddenApps');
    panelActive(true);document.body.classList.add('ccOpen');panel.setAttribute('aria-hidden','false');refreshHiddenLabel();focus(selected);refreshNetworkLabel();refreshOutput();}
  function close(){viewToken++;scanGeneration++;open=false;panelActive(false);document.body.classList.remove('ccOpen');panel.setAttribute('aria-hidden','true');}
  function back(){if(detail){scanGeneration++;clearActions();show();}else close();}
  function activate(){
    var api=window.LauncherControls, kind=entries[selected].kind;
    if((kind==='power'||kind==='screen')&&window.TVControls.pending(kind==='power'?'powerOff':'screenOff'))return;
    detailEl.classList.remove('hasError');
    clearActions();
    if(kind==='power'||kind==='screen'){
      var turn=kind==='power'?'powerOff':'screenOff', token=viewToken, tile=buttons[selected];
      if(window.TVControls.pending(turn))return;
      tile.classList.add('isPending');tile.setAttribute('aria-busy','true');
      tile.querySelector('small').textContent='Please wait…';
      window.TVControls.call(turn,null,function(r){
        tile.classList.remove('isPending');tile.removeAttribute('aria-busy');tile.querySelector('small').textContent='';
        if(r.returnValue){if(kind==='screen')screenBlank=true;return;}
        if(token!==viewToken||!open)return;
        detail=true;tiles.hidden=true;detailEl.hidden=false;failure(r.errorText||'TV rejected the request.');
      });return;
    }
    if(api && kind==='round settings'){close();api.launch('com.palm.app.settings','Settings');return;}
    if(api && kind==='round wallpaper'){close();api.wallpaper(show);return;}
    detail=true;tiles.hidden=true;detailEl.hidden=false;
    detailEl.querySelector('h2').textContent=entries[selected].title;
    detailEl.querySelector('p').textContent=entries[selected].detail;
    if(kind==='round inputs'){showInputs();return;}
    if(kind==='round hiddenApps'){showHiddenApps();return;}
    if(['sound','timer'].indexOf(kind)>=0){openFunctional(kind);return;}
    if(entries[selected].kind==='wifi'){
      var source=document.getElementById('wifiSnapshot');
      var scan=source?JSON.parse(source.textContent):null;
      if(!source && window.LauncherControls && typeof PalmServiceBridge!=='undefined'){
        status('Scanning Wi-Fi networks…');
        scanNetworks();return;
      }
      detailEl.querySelector('p').textContent=scan?'TV scan · '+new Date(scan.scannedAt).toLocaleTimeString()+'. Viewing only; connection unchanged.':'No TV scan available.';
      if(scan)renderNetworks(scan.networks);
      else actions([{label:'Open LG Wi-Fi Settings',run:openWifiSettings}]);
    }
  }
  document.getElementById('ccClose').addEventListener('click',close);
  document.getElementById('ccShade').addEventListener('click',function(){if(document.body.classList.contains('wallOpen'))window.LauncherControls.closeWallpaper();else close();});
  document.getElementById('ccDetailBack').addEventListener('click',back);
  document.getElementById('timeRow').addEventListener('click',show);

  var actionButtons=[],actionItems=[],actionIndex=-1,actionSignature='',viewToken=0,outputReadVersion=0;
  function clearActions(){viewToken++;actionButtons=[];actionItems=[];actionIndex=-1;actionSignature='';detailEl.classList.remove('ccHiddenApps');var a=document.getElementById('ccActions');if(a)a.parentNode.removeChild(a);document.getElementById('ccDetailBack').hidden=false;status('');}
  function selectAction(i,scroll){
    var next=Math.max(0,Math.min(i,actionButtons.length-1));
    if(!actionButtons[next]||next===actionIndex)return;
    if(actionButtons[actionIndex])actionButtons[actionIndex].classList.remove('selected');
    actionIndex=next;var b=actionButtons[next];b.classList.add('selected');interaction();
    var box=b.parentNode;
    if(scroll&&box.scrollHeight>box.clientHeight){
      var top=b.offsetTop,bottom=top+b.offsetHeight;
      if(top<box.scrollTop)box.scrollTop=top;
      else if(bottom>box.scrollTop+box.clientHeight)box.scrollTop=bottom-box.clientHeight;
    }
  }
  function actions(items){
    var signature=JSON.stringify(items.map(function(item){return [item.key||item.label,item.label,item.icon||'',!!item.current,item.thumbnail||'',item.subtitle||'',!!item.disabled];}));
    if(signature===actionSignature){actionItems=items;return;}actionSignature=signature;
    var previous=actionItems[actionIndex], previousKey=previous&&(previous.key||previous.label), match=0;
    var old=document.getElementById('ccActions'),scroll=old?old.scrollTop:0;if(old)old.parentNode.removeChild(old);
    var box=document.createElement('div');box.id='ccActions';
    actionItems=items;actionIndex=-1;
    actionButtons=items.map(function(item,i){var b=document.createElement('button');b.className='ccAction';b.textContent=item.label;if(item.icon || (entries[selected].kind==='timer' && item.label!=='Back')){var icon=document.createElement('span');icon.className='sfSymbol';icon.style.webkitMaskImage='url(ui-icons/'+(item.icon||'timer')+'.svg)';b.insertBefore(icon,b.firstChild);}
      if(item.thumbnail){
        b.textContent='';b.classList.add('ccHiddenApp');b.setAttribute('aria-label',item.label+', Show again');
        var thumb=document.createElement('span');thumb.className='ccHiddenIcon card'+(item.brand?' brand-'+item.brand:'');
        var picture=document.createElement('img');picture.src=item.thumbnail;picture.alt='';
        picture.onerror=function(){picture.style.display='none';thumb.textContent=item.label.charAt(0);};thumb.appendChild(picture);b.appendChild(thumb);
        var copy=document.createElement('span');copy.className='ccHiddenCopy';
        var name=document.createElement('strong');name.textContent=item.label;copy.appendChild(name);
        var hint=document.createElement('small');hint.textContent=item.subtitle;copy.appendChild(hint);b.appendChild(copy);
        var arrow=document.createElement('span');arrow.className='ccRestoreArrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');b.appendChild(arrow);
      }
      if(item.disabled){b.disabled=true;b.setAttribute('aria-disabled','true');b.classList.add('ccEmpty');}
      if((item.key||item.label)===previousKey)match=i;
      if(item.current){var check=document.createElement('span');check.className='ccCheck';check.textContent='✓';b.appendChild(check);b.setAttribute('aria-label',item.label+', current');}
      b.addEventListener('mouseenter',function(){selectAction(i);});b.addEventListener('click',function(){if(actionItems[i].disabled)return;interaction();selectAction(i);actionItems[i].run(b);});box.appendChild(b);return b;});
    detailEl.insertBefore(box,document.getElementById('ccDetailBack'));box.scrollTop=scroll;document.getElementById('ccDetailBack').hidden=true;selectAction(match);
  }
  function status(text){detailEl.querySelector('p').textContent=text;detailEl.classList.remove('hasError');detailEl.classList.toggle('hasStatus',!!text);}
  function failure(text){status(text);detailEl.classList.add('hasError');}
  function hiddenApps(){var api=window.LauncherControls;return api&&api.hiddenApps?api.hiddenApps():[];}
  function refreshHiddenLabel(){
    var count=hiddenApps().length;
    buttons[5].querySelector('small').textContent=count?String(count):'';
  }
  function showHiddenApps(){
    var hidden=hiddenApps();refreshHiddenLabel();
    detailEl.classList.add('ccHiddenApps');
    if(!hidden.length){actions([{key:'no-hidden',label:'No apps hidden',disabled:true}]);status('');return;}
    actions(hidden.map(function(app){return {key:app.id,label:app.title,thumbnail:app.mark||app.icon||'icon.png',brand:app.brand||'',subtitle:'Show again',run:function(){
      var api=window.LauncherControls;
      if(api&&api.restoreApp&&api.restoreApp(app.id)){
        showHiddenApps();api.toast(app.title+' is back on your launcher');
      }else{showHiddenApps();failure('This app is no longer available.');}
    }};}));
    status('');
  }
  function validView(token){return token===viewToken&&open&&detail;}
  function call(action,value,done,button,options,onError){
    var token=viewToken;
    if(window.TVControls.pending(action)){
      if(value===null){status('Applying current change…');setTimeout(function(){if(validView(token))call(action,value,done,button,options,onError);},200);}
      return;
    }
    if(button){button.classList.add('isPending');button.setAttribute('aria-busy','true');}
    status('Please wait…');
    window.TVControls.call(action,value,function(r){
      if(button){button.classList.remove('isPending');button.removeAttribute('aria-busy');}
      if(!validView(token))return;
      if(r.stale){setTimeout(function(){if(validView(token))call(action,value,done,button,{fresh:true},onError);},200);return;}
      if(!r.returnValue){failure(r.errorText||'Could not change this setting.');if(onError)onError(r);return;}status('');done(r);
    },options);
  }
  function outputName(v){return {tv_speaker:'TV speakers',external_arc:'HDMI ARC',external_optical:'Optical',bt_soundbar:'Bluetooth',tv_external_speaker:'TV + optical'}[v]||v;}
  function openFunctional(kind){
    if(kind==='timer'){
      var currentTimer=null,timerBusy=false,timerReading=false;
      var durations=[['120','2 Hours'],['60','1 Hour'],['30','30 Minutes']];
      function markTimer(){actionButtons.forEach(function(b,i){var old=b.querySelector('.ccCheck');if(old)old.parentNode.removeChild(old);var active=durations[i][0]===currentTimer;b.setAttribute('aria-label',durations[i][1]+(active?', active':''));if(active){var check=document.createElement('span');check.className='ccCheck';check.textContent='✓';b.appendChild(check);}});}
      function loadTimer(){
        if(timerReading)return;timerReading=true;
        call('timer',null,function(r){timerReading=false;currentTimer=String(r.settings.sleepTimer);markTimer();status('');},null,null,function(){timerReading=false;});
      }

      actions(durations.map(function(d){return {label:d[1],run:function(button){
        if(timerBusy)return;
        if(currentTimer===null){loadTimer();return;}
        var value=currentTimer===d[0]?'off':d[0];
        timerBusy=true;
        function failed(){timerBusy=false;}
        call('setTimer',value,function(){call('timer',null,function(r){timerBusy=false;currentTimer=String(r.settings.sleepTimer);markTimer();window.LauncherControls.toast(currentTimer==='off'?'Sleep timer off':'Sleep timer set for '+currentTimer+' minutes');status('');},null,{fresh:true},failed);},button,null,failed);
      }};}));
      loadTimer();
    }else if(kind==='sound'){chooseOutput();}
  }
  function refreshNetworkLabel(){
    var source=document.getElementById('wifiLabel');
    buttons[1].querySelector('small').textContent=source&&source.textContent?source.textContent:'Not connected';
  }
  var networkLabel=document.getElementById('wifiLabel');
  if(networkLabel && typeof MutationObserver!=='undefined')new MutationObserver(refreshNetworkLabel).observe(networkLabel,{childList:true,characterData:true,subtree:true});
  var currentOutput=null;
  function updateOutput(value){if(!value)return;currentOutput=value;buttons[3].querySelector('small').textContent=outputName(value);}
  function refreshOutput(done){
    if(typeof PalmServiceBridge==='undefined'){buttons[3].querySelector('small').textContent='On TV';if(done)done();return;}
    var cached=window.TVControls.peek('soundOutput');
    if(cached)updateOutput(cached.soundOutput);
    window.TVControls.call('soundOutput',null,function(r){
      if(!open||detail)return;
      if(r.stale){setTimeout(function(){if(open&&!detail)refreshOutput(done);},200);return;}
      if(r.returnValue)updateOutput(r.soundOutput);if(done)done(r);
    });
  }
  function renderOutputs(data){
    var available=((data.outputs.values||{}).arrayExt||[]).filter(function(o){return o.active&&o.visible;}).map(function(o){return o.value;});
    updateOutput(data.soundOutput.soundOutput);
    // Optical has no reliable cable-presence signal. ARC requires a detected ARC device.
    var choices=['tv_speaker','external_optical'];if(data.inputs.arcDevice)choices.push('external_arc');
    if(currentOutput&&choices.indexOf(currentOutput)<0)choices.push(currentOutput);
    choices=choices.filter(function(v){return available.indexOf(v)>=0;});
    actions(choices.map(function(v){return {key:v,label:outputName(v),icon:'sound',current:v===currentOutput,run:function(button){
      if(v===currentOutput||window.TVControls.pending('output'))return;
      outputReadVersion++;
      call('output',v,function(){updateOutput(v);chooseOutput();},button);
    }};}));
    if(!choices.length)failure('No sound outputs available.');
  }
  function chooseOutput(){
    if(typeof PalmServiceBridge==='undefined'){
      status('');actions([{label:'TV speakers',icon:'sound',run:function(){failure('Sound outputs load on the TV.');}},{label:'Optical',icon:'sound',run:function(){failure('Sound outputs load on the TV.');}}]);return;
    }
    var token=viewToken,version=++outputReadVersion;
    if(window.TVControls.pending('output')){
      status('Applying sound output…');
      setTimeout(function(){if(validView(token)&&version===outputReadVersion)chooseOutput();},200);return;
    }
    var names=['soundOutput','outputs','inputs'],data={},cached={},remaining=names.length,error=null;
    names.forEach(function(name){cached[name]=window.TVControls.peek(name);});
    if(cached.soundOutput&&cached.outputs&&cached.inputs)renderOutputs(cached);
    status(actionButtons.length?'Refreshing sound outputs…':'Loading sound outputs…');
    names.forEach(function(name){
      window.TVControls.call(name,null,function(r){
        if(!validView(token)||version!==outputReadVersion)return;
        if(r.returnValue)data[name]=r;else error=r.errorText||'Sound outputs unavailable. Try again.';
        remaining--;
        if(remaining)return;
        if(error){failure(error);return;}
        status('');renderOutputs(data);
      },{fresh:true});
    });
  }
  function showInputs(){
    function render(devices){actions(devices.map(function(d){return {key:d.id+':'+d.appId,label:d.label||d.id,icon:'input',current:!!d.activate,run:function(){close();window.LauncherControls.launch(d.appId,d.label);}};}));if(!devices.length)failure('No inputs available.');}
    if(typeof PalmServiceBridge==='undefined'){render((window.TV_APPS||{}).inputs||[]);return;}
    var cached=window.TVControls.peek('inputs');if(cached)render(cached.devices||[]);
    call('inputs',null,function(r){render(r.devices||[]);},null,{fresh:true});
  }
  function openWifiSettings(){close();window.LauncherControls.launch('com.palm.app.settings','Wi-Fi',{target:'network'});}
  function renderNetworks(networks){
    networks.sort(function(a,b){return Number(b.connected)-Number(a.connected);});
    actions(networks.map(function(n){return {label:n.name,icon:'wifi',current:n.connected,run:function(){if(!n.connected)openWifiSettings();}};}));
    if(!networks.length)failure('No Wi-Fi networks found.');
  }
  var screenBlank=false;
  window.addEventListener('keydown',function(e){if(!screenBlank)return;interaction();e.preventDefault();e.stopImmediatePropagation();if(window.TVControls.pending('screenOn'))return;window.TVControls.call('screenOn',null,function(r){if(r.returnValue)screenBlank=false;else if(open)window.LauncherControls.toast(r.errorText);});},true);
  window.addEventListener('keydown',function(e){
    var k=e.keyCode;
    if(!open){
      var tile=document.querySelector('.item.focused');
      if(k===38 && (!tile||tile.classList.contains('dock')) && (!window.LauncherControls || window.LauncherControls.canOpen())){e.preventDefault();e.stopImmediatePropagation();show();}
      return;
    }
    if([8,13,27,37,38,39,40,461].indexOf(k)<0)return;
    interaction();
    e.preventDefault();e.stopImmediatePropagation();
    if(k===8||k===27||k===461){if(!e.repeat)back();return;}
    if(detail && actionButtons.length){if(k===38)selectAction(actionIndex-1,true);if(k===40)selectAction(actionIndex+1,true);if(k===13&&!e.repeat)actionButtons[actionIndex].click();return;}
    if(detail){if(k===13)back();return;}
    var moves={37:[0,0,0,3,3,5,5,6,7],39:[1,1,2,4,4,6,7,8,8],38:[0,1,1,0,2,3,3,4,4],40:[3,2,4,5,7,5,6,7,8]};
    if(moves[k])focus(moves[k][selected]);
    if(k===13&&!e.repeat)activate();
  },true);
  window.addEventListener('keyup',function(e){if(open && e.keyCode===13){e.preventDefault();e.stopImmediatePropagation();}},true);
  function scanNetworks(){
    var generation=++scanGeneration,token=viewToken;
    var timeout=setTimeout(function(){if(generation===scanGeneration && open && detail && entries[selected].kind==='wifi'){failure('Scan unavailable. Open LG Settings to manage Wi-Fi.');}},7000);
    window.LauncherControls.luna('luna://org.webosbrew.hbchannel.service/exec',
      {command:'luna-send -w 4000 -n 1 luna://com.webos.service.wifi/findnetworks {}'},function(res){
        clearTimeout(timeout);
        if(generation!==scanGeneration || !validView(token) || entries[selected].kind!=='wifi')return;
        try {
          var data=JSON.parse(res.stdoutString||'{}');
          if(!data.returnValue)throw new Error('Scan unavailable');
          status('');renderNetworks((data.foundNetworks||[]).map(function(n){return {name:n.networkInfo.ssid||'Hidden network',connected:n.networkInfo.connectState==='ipConfigured'};}));
        }catch(e){failure('Scan unavailable. Open LG Settings to manage Wi-Fi.');}
      });
  }
  window.openControlCentre=show;
  window.openHiddenApps=function(){show();focus(5);activate();};
  var scanGeneration=0;
  document.addEventListener('visibilitychange',function(){if(document.hidden){scanGeneration++;close();}});
  panel.setAttribute('aria-hidden','true');
})();
