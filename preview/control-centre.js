(function () {
  'use strict';
  var entries = [
    {title:'Power Off', kind:'power', detail:'Preview only. A wired-up version would put the TV into standby.'},
    {title:'Wi-Fi', sub:'Network', kind:'wifi', detail:'Preview only. Network status and a shortcut to LG network settings; no Wi-Fi changes are made here.'},
    {title:'Screen Off', kind:'screen', detail:'Preview only. Turn the picture off while leaving audio playing, where supported.'},
    {title:'Sound', sub:'Output', kind:'sound', detail:'Preview only. Volume, mute and sound output controls can be connected to TV services.'},
    {title:'Sleep Timer', kind:'timer', detail:'Preview only. A sleep timer needs verification against this TV’s settings service before wiring it up.'},
    {title:'GeForce NOW', kind:'round game', detail:'Preview only. Launch your installed GeForce NOW app.'},
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
    var symbol=['power','wifi','moon','sound','timer','gamepad','input','image','settings'][i];
    var glyph=document.createElement('span');glyph.className='sfSymbol';glyph.setAttribute('aria-hidden','true');
    glyph.style.webkitMaskImage='url(ui-icons/'+symbol+'.svg)';b.appendChild(glyph);
    var strong=document.createElement('strong');strong.textContent=entry.title;b.appendChild(strong);
    var small=document.createElement('small');small.textContent=entry.sub||'';b.appendChild(small);
    b.addEventListener('mouseenter',function(){focus(i);});
    b.addEventListener('click',function(){focus(i);activate();});tiles.appendChild(b);return b;
  });
  function focus(i){selected=i;buttons.forEach(function(b,n){b.classList.toggle('selected',n===i);});}
  function show(){open=true;detail=false;tiles.hidden=false;detailEl.hidden=true;
    document.body.classList.add('ccOpen');panel.setAttribute('aria-hidden','false');focus(selected);}
  function close(){open=false;document.body.classList.remove('ccOpen');panel.setAttribute('aria-hidden','true');}
  function back(){if(detail){detail=false;tiles.hidden=false;detailEl.hidden=true;}else close();}
  function activate(){detail=true;tiles.hidden=true;detailEl.hidden=false;
    detailEl.querySelector('h2').textContent=entries[selected].title;
    detailEl.querySelector('p').textContent=entries[selected].detail;
    var old=document.getElementById('ccNetworks');if(old)old.parentNode.removeChild(old);
    if(entries[selected].kind==='wifi'){
      var source=document.getElementById('wifiSnapshot');
      var scan=source?JSON.parse(source.textContent):null;
      detailEl.querySelector('p').textContent=scan?'TV scan · '+new Date(scan.scannedAt).toLocaleTimeString()+'. Viewing only; connection unchanged.':'No TV scan available.';
      if(scan){var list=document.createElement('div');list.id='ccNetworks';
        scan.networks.slice().sort(function(a,b){return Number(b.connected)-Number(a.connected);}).forEach(function(n){var row=document.createElement('div');row.className='ccNetwork';
          var name=document.createElement('strong');name.textContent=n.name;row.appendChild(name);
          var info=document.createElement('span');info.textContent=(n.connected?'Connected · ':'')+(n.bars==null?'Signal unknown':n.bars+' signal bar'+(n.bars===1?'':'s'))+(n.secured?' · Secured':'');row.appendChild(info);list.appendChild(row);});
        if(!scan.networks.length)list.textContent='No networks returned by the TV.';
        detailEl.insertBefore(list,document.getElementById('ccDetailBack'));
      }
    }
  }
  document.getElementById('ccClose').addEventListener('click',close);
  document.getElementById('ccShade').addEventListener('click',close);
  document.getElementById('ccDetailBack').addEventListener('click',back);
  document.getElementById('timeRow').addEventListener('click',show);
  window.addEventListener('keydown',function(e){
    var k=e.keyCode;
    if(!open){
      var tile=document.querySelector('.item.focused');
      if(k===38 && tile && tile.classList.contains('dock')){e.preventDefault();e.stopImmediatePropagation();show();}
      return;
    }
    if([13,27,37,38,39,40,461].indexOf(k)<0)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(k===27||k===461){back();return;}
    if(detail){var list=document.getElementById('ccNetworks');if(list&&(k===38||k===40)){list.scrollTop+=(k===40?130:-130);}if(k===13)back();return;}
    var moves={37:[0,0,0,3,3,5,5,6,7],39:[1,1,2,4,4,6,7,8,8],38:[0,1,1,0,2,3,3,4,4],40:[3,2,4,5,7,5,6,7,8]};
    if(moves[k])focus(moves[k][selected]);
    if(k===13)activate();
  },true);
  window.addEventListener('keyup',function(e){if(open && e.keyCode===13){e.preventDefault();e.stopImmediatePropagation();}},true);
  show();
})();
