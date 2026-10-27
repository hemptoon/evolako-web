/* Evolako 29.09.2026: kviz i /preporuka — e-mail (opciono), Evolako pismo (saglasnost site-2026-09-29), skriveno polje Jezik */
var BVQ=window.BVQ=window.BVQ||[];
BVQ.push(["en2","s0wbre§E-mail (optional)§u8j6jf§Charging tips by e-mail — once a month, unsubscribe in every letter."]);
BVQ.push(["ru2","s0wbre§E-mail (необязательно)§u8j6jf§Советы о зарядке на почту — раз в месяц, отписка в каждом письме."]);
(function(){
var H={sr:'Proveri adresu — npr. marko@primer.rs.',en:'Check the address, e.g. marko@primer.rs.',ru:'Проверь адрес, например marko@primer.rs.'};
function lg(){var l=(document.documentElement.getAttribute('lang')||'sr').toLowerCase().slice(0,2);return l==='en'||l==='ru'?l:'sr'}
function set(){var j=document.querySelectorAll('input[name="Jezik"]');for(var i=0;i<j.length;i++)j[i].value=lg()}
function hint(inp){var v=inp.value.trim(),ok=!v||/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),box=inp.closest('.bv-osmo-polje');if(!box)return;
var h=box.parentNode.querySelector('.evo-nl-hint');if(!h){h=document.createElement('div');h.className='bv-osmo-hint evo-nl-hint';box.parentNode.appendChild(h)}
h.textContent=H[lg()];h.style.display=ok?'none':'block'}
function go(){set();try{new MutationObserver(set).observe(document.documentElement,{attributes:true,attributeFilter:['lang']})}catch(e){}
var e=document.querySelectorAll('input[name="Email"]');for(var i=0;i<e.length;i++){e[i].addEventListener('blur',function(){hint(this)});e[i].addEventListener('input',function(){if(!this.value.trim())hint(this)})}
document.addEventListener('submit',set,true)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();