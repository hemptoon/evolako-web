/* Evolako 29.09.2026: «Moj nalog» (app.evolako.rs) u meniju i futeru: EN/RU i jezik sajta u linku (?lang=) */
var BVQ=window.BVQ=window.BVQ||[];
BVQ.push(["en2","1vx5nes§My account"]);
BVQ.push(["ru2","1vx5nes§Мой аккаунт"]);
(function(){
/* RU meni je najduzi: na 1280-1339 px (sa klasicnim skrolbarom) stavka ne staje, pa se tu ne prikazuje; futer ima link */
try{var s=document.createElement('style');s.textContent='@media (min-width:1280px) and (max-width:1339px){html[lang="ru"] .mega-nav__item-nalog{display:none!important}}';(document.head||document.documentElement).appendChild(s)}catch(e){}
function lg(){var l=(document.documentElement.getAttribute('lang')||'sr').toLowerCase().slice(0,2);return l==='en'||l==='ru'?l:'sr'}
function upd(){var l=lg();var a=document.querySelectorAll('a[href^="https://app.evolako.rs"]');for(var i=0;i<a.length;i++){try{var u=new URL(a[i].href);if(u.searchParams.get('lang')!==l){u.searchParams.set('lang',l);a[i].setAttribute('href',u.href)}}catch(e){}}}
function go(){upd();setTimeout(upd,800);try{new MutationObserver(upd).observe(document.documentElement,{attributes:true,attributeFilter:['lang']})}catch(e){}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();