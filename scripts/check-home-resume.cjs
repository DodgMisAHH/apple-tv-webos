const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('app/app.js','utf8');
const code=s.slice(s.indexOf('  function launchParameters('),s.indexOf("  document.addEventListener('visibilitychange'"));
let handler,reloads=0,resumes=0,settings=[];
const palm={launchParams:'{"reload":true,"reloadToken":"install"}'};
const scope={window:{PalmSystem:palm,LauncherSettings:{refresh(token){settings.push(token);}}},PalmSystem:palm,document:{addEventListener(n,fn){handler=fn;}},location:{reload(){reloads++;}},resume(){resumes++;}};
vm.createContext(scope);vm.runInContext(code,scope);
handler({detail:{}});assert.equal(reloads,0);assert.equal(resumes,1); // stale install parameters
handler({detail:{home:true,reload:false}});assert.equal(reloads,0);assert.equal(resumes,2); // explicit Home overrides stale Palm params
handler({detail:'{"home":true,"reload":false}'});assert.equal(reloads,0);
handler({detail:{reload:true,reloadToken:'wallpaper'}});assert.equal(reloads,1);
handler({detail:{reload:true,reloadToken:'wallpaper'}});assert.equal(reloads,1); // duplicate notification
handler({detail:{reload:true,reloadToken:'wallpaper2'}});assert.equal(reloads,2);
const before=resumes;handler({detail:{settingsChanged:true,settingsToken:'dim-1'}});
assert.deepEqual(settings,['dim-1']);assert.equal(reloads,2);assert.equal(resumes,before);
console.log('Home resume, stale reload suppression, explicit reloads and in-place settings notification passed.');
