const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/app.js','utf8');
let now=new Date(2026,10,1,12,20,45).getTime(),next=0,writes=0;
const timers=new Map(),elements={};
for(const id of ['clock','ampm']){let value='';elements[id]={get textContent(){return value;},set textContent(v){value=v;writes++;}};}
function FakeDate(){return new Date(now);}FakeDate.now=()=>now;
const scope={Date:FakeDate,document:{hidden:false},CONFIG:{clock24:false},
 L:{ampm:['am','pm']},$:id=>elements[id],
 setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout(id){timers.delete(id);}};
vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('  var clockTimer ='),source.indexOf('  /** Shows the Wi-Fi')),scope);
scope.updateClock();const first=writes;assert.equal(elements.clock.textContent,'12:20');
scope.updateClock();assert.equal(writes,first,'Unchanged clock must not mutate text');
scope.scheduleClock();assert.equal(timers.size,1);const entry=[...timers.values()][0];assert.equal(entry.ms,15020);
now+=entry.ms;timers.clear();entry.fn();assert.equal(elements.clock.textContent,'12:21');assert.equal(writes,first+1);assert.equal(timers.size,1);
scope.document.hidden=true;scope.scheduleClock();assert.equal(timers.size,0);
now+=180000;scope.document.hidden=false;scope.updateClock();scope.scheduleClock();assert.equal(elements.clock.textContent,'12:24');assert.equal(timers.size,1);
console.log('Minute-aligned clock, changed-text-only updates and hidden/resume scheduling passed.');
