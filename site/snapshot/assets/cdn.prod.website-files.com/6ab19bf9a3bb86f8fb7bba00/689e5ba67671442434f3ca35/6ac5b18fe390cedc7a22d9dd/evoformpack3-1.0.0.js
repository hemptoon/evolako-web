(function(){
var N={start:'START',wallbox:'WALLBOX',zgrada:'ZGRADA',plus:'WALLBOX PLUS',premium:'WALLBOX PREMIUM',ugradnja:'samo ugradnja'};
var CSS='#bv-paket-note{display:flex;flex-wrap:wrap;align-items:baseline;gap:9px;margin:0 0 20px;padding:13px 16px;border:1px solid rgba(13,17,26,.12);border-left:3px solid #8CA23A;border-radius:12px;background:rgba(217,244,91,.18);font-size:14.5px;line-height:1.5;color:#0D111A}#bv-paket-note b{font-weight:800;letter-spacing:.03em}#bv-paket-note a{margin-left:auto;color:#5C6270;font-size:13.5px;text-decoration:underline;text-underline-offset:3px}#bv-paket-note a:hover{color:#0D111A}';
function fixCta(){
var L={'bv-cta-start':'start','bv-cta-wallbox':'wallbox','bv-cta-zgrada':'zgrada'},i,e;
for(i in L){e=document.getElementById(i);if(e)e.setAttribute('href','/kontakt?paket='+L[i])}
}
function init(){
var p=location.pathname.replace(/\/+$/,'')||'/';
if(p==='/paketi-i-cene'){fixCta();return}
if(p!=='/kontakt')return;
var m=location.search.match(/[?&]paket=(start|wallbox|zgrada|plus|premium|ugradnja)/i);if(!m)return;
var k=m[1].toLowerCase(),h=document.getElementById('kk-paket');
if(h)h.value=k;
var slot=document.getElementById('kt-form-slot');
if(slot&&!document.getElementById('bv-paket-note')){
var s=document.createElement('style');s.textContent=CSS;document.head.appendChild(s);
var d=document.createElement('div');d.id='bv-paket-note';
var t=document.createElement('span');t.textContent=k==='ugradnja'?'Tvoj izbor:':'Tvoj izbor: paket';
var b=document.createElement('b');b.textContent=N[k];
var a=document.createElement('a');a.href='/paketi-i-cene';a.textContent='Promeni';
d.appendChild(t);d.appendChild(b);d.appendChild(a);
slot.insertBefore(d,slot.firstChild);
}
try{history.replaceState(null,'',location.pathname+location.search.replace(/([?&])paket=[a-z]+&?/i,'$1').replace(/[?&]$/,'')+location.hash)}catch(e){}
}
if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);
})();