(function () {
  'use strict';
  var entries = [
    {title:'Power Off', kind:'power'},
    {title:'Wi-Fi', sub:'…', kind:'wifi'},
    {title:'Screen Off', kind:'screen'},
    {title:'Sound', sub:'…', kind:'sound'},
    {title:'VPN', sub:'Checking…', kind:'vpn'},
    {title:'Hidden apps', kind:'round hiddenApps'},
    {title:'Inputs', kind:'round inputs'},
    {title:'Wallpaper', kind:'round wallpaper'},
    {title:'Settings', kind:'round settings'}
  ];
  var ccToggle=document.createElement('button');
  ccToggle.id='ccHeaderToggle';ccToggle.setAttribute('aria-label','Control Centre');
  ccToggle.innerHTML='<span class="sfSymbol sfSwitch" aria-hidden="true" style="-webkit-mask-image:url(ui-icons/controls.svg)"></span>';
  var vpnBadge=document.createElement('span');
  vpnBadge.id='ccVpnBadge';vpnBadge.textContent='VPN';vpnBadge.hidden=true;vpnBadge.setAttribute('role','img');vpnBadge.setAttribute('aria-label','VPN connected');
  document.getElementById('timeRow').insertBefore(vpnBadge,document.getElementById('clock'));
  document.getElementById('timeRow').appendChild(ccToggle);
  ccToggle.addEventListener('click',function(e){e.stopPropagation();if(open)close();else show();});
  var selected=0, open=false, detail=false, statusTimer=null;
  var statusPolicy=window.LauncherControls&&window.LauncherControls.statusPolicy;
  var panel=document.getElementById('controlCentre'), tiles=document.getElementById('ccTiles');
  var detailEl=document.getElementById('ccDetail');
  var buttons=entries.map(function(entry,i){
    var b=document.createElement('button');b.className='ccTile '+entry.kind;b.setAttribute('aria-label',entry.title);
    var symbol=['power','wifi','moon','sound',null,null,'input','image','settings'][i];
    var glyph=document.createElement('span');glyph.className='sfSymbol';glyph.setAttribute('aria-hidden','true');
    if(entry.kind==='vpn'){
      glyph.className='sfSymbol ccVpnGlyph';
      glyph.style.webkitMaskImage='url(ui-icons/shield.svg)';
    }else if(entry.kind==='round hiddenApps'){
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
  function show(){clearWifiPrompt();stopWifiScan();viewToken++;open=true;detail=false;tiles.hidden=false;detailEl.hidden=true;detailEl.classList.remove('ccHiddenApps');
    panelActive(true);document.body.classList.add('ccOpen');panel.setAttribute('aria-hidden','false');refreshHiddenLabel();focus(selected);refreshNetworkLabel();clearTimeout(vpnTimer);clearTimeout(statusTimer);
    if(statusPolicy){statusTimer=setTimeout(function(){statusTimer=null;if(!open||document.hidden)return;if(!detail)refreshOutput();refreshVpn();},statusPolicy.initialDelay);}
    else{refreshOutput();refreshVpn();}
    var api=window.LauncherControls;if(api&&api.controlCentreShown)api.controlCentreShown();}
  function close(reason){var wasOpen=open;viewToken++;clearWifiPrompt();stopWifiScan();clearTimeout(statusTimer);statusTimer=null;open=false;panelActive(false);document.body.classList.remove('ccOpen');panel.setAttribute('aria-hidden','true');scheduleVpnRead();
    var api=window.LauncherControls;if(wasOpen&&api&&api.controlCentreHidden)api.controlCentreHidden(reason==='suspend'?'suspend':'dismiss');}
  function back(){if(wifiPrompt){returnToNetworks();return;}if(detail){stopWifiScan();clearActions();show();}else close();}
  function activate(){
    var api=window.LauncherControls, kind=entries[selected].kind;
    if((kind==='power'||kind==='screen')&&window.TVControls.pending(kind==='power'?'powerOff':'screenOff'))return;
    detailEl.classList.remove('hasError');
    clearActions();
    if(kind==='power'||kind==='screen'){
      var turn=kind==='power'?'powerOff':'screenOff', token=viewToken, tile=buttons[selected], screenToken;
      if(window.TVControls.pending(turn))return;
      // Arm before the request: a delayed reply must not undo a firmware wake.
      if(kind==='screen'){screenToken=++screenGeneration;screenBlank=true;wakeRequested=false;wakeKey=null;}
      tile.classList.add('isPending');tile.setAttribute('aria-busy','true');
      tile.querySelector('small').textContent='Please wait…';
      window.TVControls.call(turn,null,function(r){
        tile.classList.remove('isPending');tile.removeAttribute('aria-busy');tile.querySelector('small').textContent='';
        if(kind==='screen'&&screenToken===screenGeneration){if(r.returnValue)wakeScreen();else clearScreenBlank();}
        if(r.returnValue)return;
        if(token!==viewToken||!open)return;
        detail=true;tiles.hidden=true;detailEl.hidden=false;failure(r.errorText||'TV rejected the request.');
      });return;
    }
    if(api && kind==='round settings'){close();api.launch('com.palm.app.settings','Settings');return;}
    if(api && kind==='round wallpaper'){close();api.wallpaper(show);return;}
    detail=true;tiles.hidden=true;detailEl.hidden=false;
    if(kind==='round inputs'){showInputs();return;}
    if(kind==='round hiddenApps'){showHiddenApps();return;}
    if(kind==='vpn'){renderVpn();if(statusPolicy){clearTimeout(vpnTimer);refreshVpn(true);}return;}
    if(kind==='sound'){chooseOutput();return;}
    if(entries[selected].kind==='wifi'){
      var source=document.getElementById('wifiSnapshot');
      var scan=source?JSON.parse(source.textContent):null;
      if(!source && window.LauncherControls && typeof PalmServiceBridge!=='undefined'){
        scanNetworks();return;
      }
      if(scan)renderNetworks(scan.networks);
      else actions([{label:'Open LG Wi-Fi Settings',run:openWifiSettings}]);
    }
  }
  document.getElementById('ccClose').addEventListener('click',close);
  document.getElementById('ccShade').addEventListener('click',function(){if(document.body.classList.contains('wallOpen'))window.LauncherControls.closeWallpaper();else close();});
  document.getElementById('ccDetailBack').addEventListener('click',back);
  document.getElementById('timeRow').addEventListener('click',show);

  var actionButtons=[],actionItems=[],actionIndex=-1,actionSignature='',viewToken=0,outputReadVersion=0;
  function clearActions(){clearWifiPrompt();stopWifiScan();viewToken++;actionButtons=[];actionItems=[];actionIndex=-1;actionSignature='';detailEl.classList.remove('ccHiddenApps');var a=document.getElementById('ccActions');if(a)a.parentNode.removeChild(a);document.getElementById('ccDetailBack').hidden=false;clearNotice();}
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
    actionButtons=items.map(function(item,i){var b=document.createElement('button');b.className='ccAction';b.textContent=item.label;if(item.icon){var icon=document.createElement('span');icon.className='sfSymbol';icon.style.webkitMaskImage='url(ui-icons/'+item.icon+'.svg)';b.insertBefore(icon,b.firstChild);}
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
  function clearNotice(){detailEl.querySelector('p').textContent='';detailEl.classList.remove('hasError');}
  function failure(text){detailEl.querySelector('p').textContent=text;detailEl.classList.add('hasError');}
  var vpnState=null,vpnTimer=null,vpnReading=false,vpnGeneration=0,vpnFailed=false,vpnSuspended=false,vpnReadAt=null;
  var vpnProfiles=[{id:'lisbon',name:'Portugal'},{id:'uk',name:'United Kingdom'},{id:'us',name:'United States'}];
  function vpnName(id){for(var i=0;i<vpnProfiles.length;i++)if(vpnProfiles[i].id===id)return vpnProfiles[i].name;return '';}
  function vpnConfigured(id){
    var profiles=vpnState&&vpnState.profiles||[];
    for(var i=0;i<profiles.length;i++)if(profiles[i].id===id)return profiles[i].configured===true;
    return false;
  }
  function vpnBusy(){return !!(window.VPNControls&&window.VPNControls.pending());}
  function vpnSummary(){
    if(vpnBusy())return 'Updating…';
    if(!vpnState)return vpnFailed?'Unavailable':'Checking…';
    if(vpnState.connected)return 'Connected'+(vpnName(vpnState.active)?' · '+vpnName(vpnState.active):'');
    if(vpnState.tunnel)return 'Connecting…';
    return 'Off';
  }
  function updateVpnLabel(){
    var text=vpnSummary(),tile=buttons[4],connected=!!(vpnState&&vpnState.connected&&!vpnBusy());
    var subtitle=vpnState?(vpnState.tunnel?(vpnName(vpnState.active)||'Unavailable'):'Off'):text;
    if(tile.querySelector('small').textContent!==subtitle)tile.querySelector('small').textContent=subtitle;
    tile.setAttribute('aria-label','VPN, '+text);
    tile.classList.toggle('vpnConnected',connected);
    vpnBadge.hidden=!connected||document.hidden||vpnSuspended;
    vpnBadge.setAttribute('aria-label','VPN connected'+(vpnState&&vpnName(vpnState.active)?' to '+vpnName(vpnState.active):''));
  }
  function stopVpnMonitor(){vpnGeneration++;clearTimeout(vpnTimer);vpnTimer=null;vpnReading=false;}
  function vpnInterval(){
    if(!statusPolicy)return open?5000:15000;
    if(vpnState&&vpnState.tunnel&&!vpnState.connected)return 5000;
    return open&&detail&&entries[selected].kind==='vpn'?statusPolicy.vpnDetailPollInterval:statusPolicy.vpnPollInterval;
  }
  function scheduleVpnRead(delay,force){
    clearTimeout(vpnTimer);
    if(document.hidden||vpnSuspended||(statusPolicy&&!open)||typeof PalmServiceBridge==='undefined')return;
    vpnTimer=setTimeout(function(){refreshVpn(force===true);},delay||vpnInterval());
  }
  function startVpnMonitor(){
    stopVpnMonitor();vpnState=null;vpnReadAt=null;vpnFailed=false;updateVpnLabel();
    if(statusPolicy)scheduleVpnRead(statusPolicy.initialDelay);else refreshVpn();
  }
  function refreshVpn(force){
    if(document.hidden||vpnSuspended||vpnReading)return;
    if(statusPolicy&&force!==true&&vpnReadAt!==null){
      var remaining=vpnInterval()-(Date.now()-vpnReadAt);
      if(remaining>0){scheduleVpnRead(remaining);return;}
    }
    if(vpnBusy()){updateVpnLabel();scheduleVpnRead(open?1000:15000);return;}
    if(!window.VPNControls){vpnFailed=true;updateVpnLabel();return;}
    var generation=vpnGeneration;vpnReading=true;
    window.VPNControls.call('status',null,function(result){
      if(generation!==vpnGeneration||document.hidden||vpnSuspended)return;
      vpnReading=false;
      if(result.stale||result.pending){scheduleVpnRead(500,true);return;}
      vpnReadAt=Date.now();
      vpnState=result.ok?result:null;vpnFailed=!result.ok;updateVpnLabel();
      if(open&&detail&&entries[selected].kind==='vpn')renderVpn();
      scheduleVpnRead();
    });
  }
  function changeVpn(action,id){
    if(vpnBusy()||!window.VPNControls)return;
    // Invalidate a status read that began before this explicit change.
    stopVpnMonitor();var generation=vpnGeneration;
    window.VPNControls.call(action,id,function(result){
      if(generation!==vpnGeneration||document.hidden||vpnSuspended)return;
      vpnReadAt=Date.now();vpnState=result.ok?result:null;vpnFailed=!result.ok;updateVpnLabel();
      if(open&&detail&&entries[selected].kind==='vpn'){
        renderVpn();
        if(!result.ok)failure('Could not update VPN. Check its status before trying again.');
      }
      scheduleVpnRead(result.ok?1000:5000,true);
    });
    updateVpnLabel();
    if(detail&&entries[selected].kind==='vpn')renderVpn();
  }
  function renderVpn(){
    var busy=vpnBusy(),activeId=vpnState&&vpnState.tunnel&&vpnState.active,items=[];
    items.push({key:'vpn-off',label:'Off',current:!!vpnState&&!vpnState.tunnel,disabled:busy||!vpnState,run:function(){if(vpnState.tunnel)changeVpn('disconnect',null);}});
    vpnProfiles.forEach(function(profile){
      items.push({key:'vpn-'+profile.id,label:profile.name,current:activeId===profile.id,disabled:busy||!vpnConfigured(profile.id),run:function(){
        if(activeId!==profile.id)changeVpn('connect',profile.id);
      }});
    });
    actions(items);
    clearNotice();
    if(!busy&&!vpnState&&vpnFailed)failure('VPN unavailable. Open WireGuard to check setup.');
  }
  function hiddenApps(){var api=window.LauncherControls;return api&&api.hiddenApps?api.hiddenApps():[];}
  function refreshHiddenLabel(){
    var count=hiddenApps().length;
    buttons[5].querySelector('small').textContent=count?String(count):'';
  }
  function showHiddenApps(){
    var api=window.LauncherControls;
    // A separate overlay has a different storage origin. Keep launcher
    // preferences in Home rather than silently creating a second hidden list.
    if(api&&api.manageHiddenApps){actions([{key:'manage-hidden',label:'Go to Home to manage hidden apps',run:function(){close();api.manageHiddenApps();}}]);clearNotice();return;}
    var hidden=hiddenApps();refreshHiddenLabel();
    detailEl.classList.add('ccHiddenApps');
    if(!hidden.length){actions([{key:'no-hidden',label:'No apps hidden',disabled:true}]);clearNotice();return;}
    actions(hidden.map(function(app){return {key:app.id,label:app.title,thumbnail:app.mark||app.icon||'icon.png',brand:app.brand||'',subtitle:'Show again',run:function(){
      var api=window.LauncherControls;
      if(api&&api.restoreApp&&api.restoreApp(app.id)){
        showHiddenApps();api.toast(app.title+' is back on your launcher');
      }else{showHiddenApps();failure('This app is no longer available.');}
    }};}));
    clearNotice();
  }
  function validView(token){return token===viewToken&&open&&detail;}
  function call(action,value,done,button,options,onError){
    var token=viewToken;
    if(window.TVControls.pending(action)){
      if(value===null){setTimeout(function(){if(validView(token))call(action,value,done,button,options,onError);},200);}
      return;
    }
    if(button){button.classList.add('isPending');button.setAttribute('aria-busy','true');}
    clearNotice();
    window.TVControls.call(action,value,function(r){
      if(button){button.classList.remove('isPending');button.removeAttribute('aria-busy');}
      if(!validView(token))return;
      if(r.stale){setTimeout(function(){if(validView(token))call(action,value,done,button,{fresh:true},onError);},200);return;}
      if(!r.returnValue){failure(r.errorText||'Could not change this setting.');if(onError)onError(r);return;}clearNotice();done(r);
    },options);
  }
  function outputName(v){return {tv_speaker:'TV speakers',external_arc:'HDMI ARC',external_optical:'Optical',bt_soundbar:'Bluetooth',tv_external_speaker:'TV + optical'}[v]||v;}
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
      clearNotice();actions([{label:'TV speakers',icon:'sound',run:function(){failure('Sound outputs load on the TV.');}},{label:'Optical',icon:'sound',run:function(){failure('Sound outputs load on the TV.');}}]);return;
    }
    var token=viewToken,version=++outputReadVersion;
    if(window.TVControls.pending('output')){
      setTimeout(function(){if(validView(token)&&version===outputReadVersion)chooseOutput();},200);return;
    }
    var names=['soundOutput','outputs','inputs'],data={},cached={},remaining=names.length,error=null;
    names.forEach(function(name){cached[name]=window.TVControls.peek(name);});
    if(cached.soundOutput&&cached.outputs&&cached.inputs)renderOutputs(cached);
    clearNotice();
    names.forEach(function(name){
      window.TVControls.call(name,null,function(r){
        if(!validView(token)||version!==outputReadVersion)return;
        if(r.returnValue)data[name]=r;else error=r.errorText||'Sound outputs unavailable. Try again.';
        remaining--;
        if(remaining)return;
        if(error){failure(error);return;}
        clearNotice();renderOutputs(data);
      },{fresh:true});
    });
  }
  function showInputs(){
    function render(devices){actions(devices.map(function(d){return {key:d.id+':'+d.appId,label:d.label||d.id,icon:'input',current:!!d.activate,run:function(){close();window.LauncherControls.launch(d.appId,d.label);}};}));if(!devices.length)failure('No inputs available.');}
    if(typeof PalmServiceBridge==='undefined'){render((window.TV_APPS||{}).inputs||[]);return;}
    var cached=window.TVControls.peek('inputs');if(cached)render(cached.devices||[]);
    call('inputs',null,function(r){render(r.devices||[]);},null,{fresh:true});
  }
  var wifiPrompt=null,wifiNetworks=[],wifiKeyboardVisible=null;
  function openWifiSettings(){close();window.LauncherControls.launch('com.palm.app.settings','Wi-Fi',{target:'WifiConnection'});}
  function wifiProfile(value){return typeof value==='number'&&isFinite(value)&&value>=0&&value<=2147483647&&Math.floor(value)===value;}
  function wifiPromptCurrent(prompt){return wifiPrompt===prompt&&validView(prompt.token)&&!document.hidden;}
  function clearWifiPrompt(){
    var prompt=wifiPrompt;wifiPrompt=null;
    if(!prompt)return;
    if(prompt.input){prompt.input.value='';if(prompt.input.blur)prompt.input.blur();}
    if(typeof prompt.release==='function')prompt.release();
    if(prompt.box.parentNode)prompt.box.parentNode.removeChild(prompt.box);
    var list=document.getElementById('ccActions');if(list)list.hidden=false;
    detailEl.classList.remove('ccWifiDetail');
  }
  function returnToNetworks(){clearWifiPrompt();viewToken++;clearNotice();renderNetworks(wifiNetworks,false);}
  function wifiControls(prompt){
    var controls=prompt.input?[prompt.input]:[];
    prompt.buttons.forEach(function(button){if(!button.hidden&&!button.disabled)controls.push(button);});return controls;
  }
  function focusWifiControl(prompt,control){
    if(!wifiPromptCurrent(prompt)||!control||control.hidden||control.disabled)return;
    prompt.buttons.forEach(function(button){button.classList.toggle('selected',button===control);});
    prompt.focused=control;interaction();if(control.focus)control.focus();
  }
  function wifiStatus(prompt,text){prompt.status.textContent=text;prompt.status.hidden=!text;}
  function wifiPassword(prompt){
    if(prompt.input)return;
    var label=document.createElement('label');label.setAttribute('for','ccWifiPassword');label.textContent='Password';
    var input=document.createElement('input');input.id='ccWifiPassword';input.type='password';
    input.setAttribute('type','password');input.setAttribute('autocomplete','off');input.setAttribute('autocapitalize','off');
    input.setAttribute('spellcheck','false');input.setAttribute('aria-label','Wi-Fi password');
    input.value='';prompt.input=input;
    input.addEventListener('focus',function(){
      if(wifiPrompt!==prompt)return;prompt.focused=input;
      prompt.buttons.forEach(function(button){button.classList.remove('selected');});
    });
    prompt.form.insertBefore(label,prompt.join);prompt.form.insertBefore(input,prompt.join);
  }
  function configureWifiPrompt(prompt,error){
    if(!wifiPromptCurrent(prompt))return;
    var n=prompt.network,kind=n.securityType;
    prompt.ready=!error&&prompt.supported;prompt.join.disabled=!prompt.ready;
    prompt.settings.hidden=prompt.ready;
    if(!prompt.ready){wifiStatus(prompt,error||'Use LG Wi-Fi Settings for this network.');focusWifiControl(prompt,prompt.settings);return;}
    if(!prompt.useProfile&&kind!=='none'&&kind!=='open')wifiPassword(prompt);
    wifiStatus(prompt,prompt.useProfile?'Use the password saved on your TV.':prompt.input?'':'Join this open network?');
    focusWifiControl(prompt,prompt.input||prompt.join);
  }
  function joinWifi(prompt){
    if(!wifiPromptCurrent(prompt)||!prompt.ready||prompt.busy)return;
    var api=window.WifiControls;
    if(!api||typeof api.join!=='function'){wifiStatus(prompt,'Wi-Fi connections are available on the TV.');return;}
    if(api.pending&&api.pending()){wifiStatus(prompt,'A Wi-Fi connection is already in progress.');return;}
    var n=prompt.network,params={ssid:n.ssid,securityType:n.securityType};
    if(prompt.useProfile)params.profileId=n.profileId;
    else if(prompt.input){
      if(!prompt.input.value){wifiStatus(prompt,'Enter the network password.');focusWifiControl(prompt,prompt.input);return;}
      params.password=prompt.input.value;
    }
    prompt.busy=true;prompt.join.disabled=true;prompt.cancel.textContent='Back';prompt.settings.hidden=true;
    if(prompt.input){prompt.input.value='';prompt.input.disabled=true;}
    wifiStatus(prompt,'Connecting… This may continue after you go back.');focusWifiControl(prompt,prompt.cancel);
    var completed=false,release;
    function done(result){
      completed=true;
      if(!wifiPromptCurrent(prompt))return;
      prompt.release=null;prompt.busy=false;prompt.join.disabled=false;prompt.cancel.textContent='Cancel';
      if(prompt.input){prompt.input.value='';prompt.input.disabled=false;}
      if(result&&result.returnValue===true){
        var connectedKey=n.key||n.name;
        wifiNetworks.forEach(function(network){network.connected=(network.key||network.name)===connectedKey;});
        returnToNetworks();buttons[1].querySelector('small').textContent=n.name;
        if(window.LauncherControls.toast)window.LauncherControls.toast('Connected to '+n.name);
        return;
      }
      var code=result&&result.failureCode;
      if(prompt.useProfile&&(code==='authentication'||code==='connection')&&(n.securityType==='psk'||n.securityType==='wep')){
        prompt.useProfile=false;wifiPassword(prompt);
        wifiStatus(prompt,'Could not use the saved connection. Enter the password to try again.');
      }else wifiStatus(prompt,result&&result.errorText||'Could not connect. Try again.');
      if(code==='permission')prompt.settings.hidden=false;
      focusWifiControl(prompt,code==='permission'?prompt.settings:prompt.input||prompt.join);
    }
    try{release=api.join(params,done);}catch(error){done({returnValue:false,errorText:'Could not connect. Try again.'});}
    // The transport owns its transient copy; do not retain a password in the UI closure.
    if(Object.prototype.hasOwnProperty.call(params,'password'))params.password='';
    if(!completed&&wifiPromptCurrent(prompt))prompt.release=release;
    else if(typeof release==='function')release();
  }
  function openWifiPrompt(network){
    clearWifiPrompt();stopWifiScan();viewToken++;clearNotice();wifiKeyboardVisible=null;
    var box=document.createElement('div');box.id='ccWifiPrompt';box.className='ccWifiPrompt';
    var title=document.createElement('h2');title.id='ccWifiNetwork';title.textContent=network.name;box.appendChild(title);
    var status=document.createElement('p');status.id='ccWifiStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');box.appendChild(status);
    var form=document.createElement('form');form.id='ccWifiForm';form.setAttribute('autocomplete','off');box.appendChild(form);
    var prompt={box:box,form:form,status:status,network:network,token:viewToken,buttons:[],input:null,release:null,busy:false,ready:false,
      useProfile:wifiProfile(network.profileId),supported:!!network.ssid&&network.supported!==false&&['none','open','psk','wep'].indexOf(network.securityType)>=0};
    wifiPrompt=prompt;
    function button(id,label,run){
      var b=document.createElement('button');b.id=id;b.className='ccWifiButton';b.type='button';b.textContent=label;
      b.addEventListener('focus',function(){if(wifiPrompt===prompt){prompt.focused=b;prompt.buttons.forEach(function(other){other.classList.toggle('selected',other===b);});}});
      b.addEventListener('mouseenter',function(){focusWifiControl(prompt,b);});
      b.addEventListener('click',function(){if(wifiPromptCurrent(prompt)&&!b.disabled){interaction();run();}});
      form.appendChild(b);prompt.buttons.push(b);return b;
    }
    prompt.join=button('ccWifiJoin','Join',function(){joinWifi(prompt);});prompt.join.disabled=true;
    prompt.cancel=button('ccWifiCancel','Cancel',returnToNetworks);
    prompt.settings=button('ccWifiSettings','Open LG Wi-Fi Settings',openWifiSettings);prompt.settings.hidden=true;
    form.addEventListener('submit',function(e){e.preventDefault();if(wifiPromptCurrent(prompt))focusWifiControl(prompt,prompt.join);});
    var list=document.getElementById('ccActions');if(list)list.hidden=true;
    detailEl.classList.add('ccWifiDetail');detailEl.insertBefore(box,document.getElementById('ccDetailBack'));
    if(!prompt.supported||prompt.useProfile){configureWifiPrompt(prompt);return;}
    var api=window.WifiControls;
    if(!api||typeof api.profiles!=='function'){configureWifiPrompt(prompt,'Could not check saved networks. Open LG Wi-Fi Settings.');return;}
    wifiStatus(prompt,'Checking saved networks…');focusWifiControl(prompt,prompt.cancel);
    var completed=false,release=api.profiles(function(result){
      completed=true;if(!wifiPromptCurrent(prompt))return;prompt.release=null;
      if(!result||result.returnValue!==true||!Array.isArray(result.profiles)){
        configureWifiPrompt(prompt,'Could not check saved networks. Open LG Wi-Fi Settings.');return;
      }
      for(var i=0;i<result.profiles.length;i++){
        var saved=result.profiles[i],types=saved&&saved.securityTypes;
        if(saved&&saved.ssid===network.ssid&&wifiProfile(saved.profileId)&&(!Array.isArray(types)||!types.length||types.indexOf(network.securityType)>=0)){
          network.profileId=saved.profileId;prompt.useProfile=true;break;
        }
      }
      configureWifiPrompt(prompt);
    });
    if(!completed&&wifiPromptCurrent(prompt))prompt.release=release;
    else if(typeof release==='function')release();
  }
  function renderNetworks(networks,scanning){
    networks=networks.slice().sort(function(a,b){return Number(b.connected)-Number(a.connected);});
    wifiNetworks=networks;
    var list=networks.map(function(n){return {key:n.key||n.name,label:n.name,icon:'wifi',current:n.connected,run:function(){if(!n.connected)openWifiPrompt(n);}};});
    list.push({key:'wifi-settings',label:'Open LG Wi-Fi Settings',run:openWifiSettings});
    actions(list);
    if(!networks.length&&!scanning)failure('No Wi-Fi networks found.');
  }
  var screenBlank=false,screenGeneration=0,wakeRequested=false,wakeKey=null;
  function clearScreenBlank(){screenBlank=false;wakeRequested=false;screenGeneration++;}
  function wakeScreen(){
    if(!screenBlank||!wakeRequested||window.TVControls.pending('screenOn'))return;
    var generation=screenGeneration;
    window.TVControls.call('screenOn',null,function(r){
      if(generation!==screenGeneration)return;
      // Firmware can turn the picture on before this request. Even an unknown
      // failure or timeout must release input instead of trapping every key.
      clearScreenBlank();
      if(!r.returnValue&&!(r.state==='Active'&&Number(r.errorCode)===-102)&&open)window.LauncherControls.toast(r.errorText);
    });
  }
  window.addEventListener('keydown',function(e){
    // Firmware may consume the wake release; a fresh press must still work.
    if(!screenBlank&&e.keyCode===wakeKey&&!e.repeat)wakeKey=null;
    if(!screenBlank&&e.keyCode!==wakeKey)return;
    interaction();e.preventDefault();e.stopImmediatePropagation();
    if(wakeKey===null)wakeKey=e.keyCode;
    if(!screenBlank)return;
    wakeRequested=true;wakeScreen();
  },true);
  // A wake OK (and its repeats) belongs entirely to waking, not Screen Off.
  window.addEventListener('keyup',function(e){if(e.keyCode===wakeKey){wakeKey=null;e.preventDefault();e.stopImmediatePropagation();}},true);
  window.addEventListener('focus',clearScreenBlank);
  document.addEventListener('webOSRelaunch',clearScreenBlank);
  document.addEventListener('keyboardStateChange',function(e){
    if(e.detail&&typeof e.detail.visibility==='boolean')wifiKeyboardVisible=e.detail.visibility;
  });
  window.addEventListener('keydown',function(e){
    var k=e.keyCode;
    if(!open){
      var tile=document.querySelector('.item.focused');
      if(k===38 && (!tile||tile.classList.contains('dock')) && (!window.LauncherControls || window.LauncherControls.canOpen())){e.preventDefault();e.stopImmediatePropagation();show();}
      return;
    }
    if(wifiPrompt){
      var prompt=wifiPrompt,inputFocused=prompt.input&&(e.target===prompt.input||document.activeElement===prompt.input);
      interaction();e.stopImmediatePropagation();
      if(k===27||k===461){e.preventDefault();if(!e.repeat)back();return;}
      if(inputFocused){
        // Let the native keyboard and text field handle editing. Once the TV
        // reports its keyboard hidden, Down can move to the explicit Join action.
        if(k===40&&wifiKeyboardVisible===false){e.preventDefault();focusWifiControl(prompt,prompt.join);}
        return;
      }
      if([8,13,37,38,39,40].indexOf(k)<0)return;
      e.preventDefault();
      if(k===8){if(!e.repeat)back();return;}
      var controls=wifiControls(prompt),at=controls.indexOf(prompt.focused);
      if(k===37||k===38)focusWifiControl(prompt,controls[Math.max(0,at-1)]);
      if(k===39||k===40)focusWifiControl(prompt,controls[Math.min(controls.length-1,at+1)]);
      if(k===13&&!e.repeat&&prompt.focused&&prompt.focused!==prompt.input)prompt.focused.click();
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
  window.addEventListener('keyup',function(e){if(open && e.keyCode===13){
    if(!(wifiPrompt&&wifiPrompt.input&&(e.target===wifiPrompt.input||document.activeElement===wifiPrompt.input)))e.preventDefault();
    e.stopImmediatePropagation();
  }},true);
  var wifiSession=null,wifiCache=[];
  function stopWifiScan(){
    scanGeneration++;
    var session=wifiSession;wifiSession=null;
    if(!session)return;
    clearTimeout(session.timer);
    if(typeof session.release==='function')session.release();
  }
  function scanNetworks(){
    stopWifiScan();
    var session={generation:scanGeneration,token:viewToken,buffer:'',received:false,release:null,timer:null};
    wifiSession=session;
    if(wifiCache.length)renderNetworks(wifiCache,true);
    function current(){return wifiSession===session&&session.generation===scanGeneration&&validView(session.token)&&entries[selected].kind==='wifi';}
    function finish(error){
      if(!current())return;
      stopWifiScan();
      if(!session.received||error){
        renderNetworks(wifiCache,true);
        failure('Could not refresh nearby networks. Open LG Settings to manage Wi-Fi.');
      }else if(!wifiCache.length)renderNetworks([],false);
    }
    function receive(line){
      if(!line.trim())return;
      // Decode complete lines so a UTF-8 SSID split between pipe chunks survives.
      var data=JSON.parse(decodeURIComponent(escape(line)));
      if(data.returnValue!==true||!Array.isArray(data.foundNetworks))throw new Error('Scan unavailable');
      var seen={};
      wifiCache=data.foundNetworks.reduce(function(list,item){
        var n=item&&item.networkInfo;
        if(!n||typeof n!=='object'||(n.available===false&&n.connectState!=='ipConfigured'))return list;
        var ssid=typeof n.ssid==='string'?n.ssid:'',name=n.displayName||ssid||'Hidden network';
        if(typeof name!=='string')return list;
        var types=Array.isArray(n.availableSecurityTypes)?n.availableSecurityTypes.filter(function(value){return typeof value==='string';}):[];
        var security=typeof n.securityType==='string'?n.securityType:types.filter(function(value){return value!=='wps';})[0]||'';
        var key='network:'+String(ssid||name)+':'+JSON.stringify(types);
        if(seen[key])return list;seen[key]=true;
        list.push({key:key,name:name,ssid:ssid,securityType:security,securityTypes:types,
          profileId:wifiProfile(n.profileId)?n.profileId:null,supported:n.supported!==false,
          connected:n.connectState==='ipConfigured'});return list;
      },[]);
      session.received=true;clearNotice();renderNetworks(wifiCache,true);
    }
    session.timer=setTimeout(function(){finish(false);},9000);
    // findnetworks initially returns cached results. Keep its subscription for
    // fresh scan updates; -w is an absolute process bound, not an idle timeout.
    // Releasing HBC's stream stops UI callbacks; its child still exits by 8s.
    var release=window.LauncherControls.luna('luna://org.webosbrew.hbchannel.service/spawn',
      {subscribe:true,command:'exec luna-send -i -w 8000 luna://com.webos.service.wifi/findnetworks \'{"subscribe":true}\''},function(res){
        if(!current())return;
        try {
          var event=res.event||res.type;
          if(res.returnValue===false||res.error){finish(true);return;}
          if(event==='stderrData')return;
          var chunk='';
          if(res.stdoutBytes&&typeof atob==='function')chunk=atob(res.stdoutBytes);
          else if(res.stdoutString)chunk=unescape(encodeURIComponent(res.stdoutString));
          session.buffer+=chunk;
          if(session.buffer.length>131072)throw new Error('Scan response too large');
          var newline;
          while(current()&&(newline=session.buffer.indexOf('\n'))>=0){
            var line=session.buffer.slice(0,newline);session.buffer=session.buffer.slice(newline+1);receive(line);
          }
          if(event==='close'){
            if(session.buffer.trim())receive(session.buffer);
            finish(false);
          }
        }catch(e){finish(true);}
      });
    if(wifiSession===session)session.release=release;
    else if(typeof release==='function')release();
  }
  window.openControlCentre=show;
  window.closeControlCentre=close;
  window.openHiddenApps=function(){show();focus(5);activate();};
  var scanGeneration=0;
  function suspendVpn(){vpnSuspended=true;close('suspend');stopVpnMonitor();updateVpnLabel();}
  function resumeVpn(){vpnSuspended=false;if(!document.hidden)startVpnMonitor();}
  // A retained overlay suspends before its asynchronous native visibility
  // event, preventing replies in that interval from scheduling another poll.
  window.suspendControlCentre=suspendVpn;
  window.resumeControlCentre=function(){if(vpnSuspended)resumeVpn();};
  document.addEventListener('visibilitychange',function(){if(document.hidden){scanGeneration++;suspendVpn();}else{clearScreenBlank();resumeVpn();}});
  window.addEventListener('pagehide',suspendVpn);
  window.addEventListener('pageshow',function(){if(vpnSuspended)resumeVpn();});
  panel.setAttribute('aria-hidden','true');
  startVpnMonitor();
})();
