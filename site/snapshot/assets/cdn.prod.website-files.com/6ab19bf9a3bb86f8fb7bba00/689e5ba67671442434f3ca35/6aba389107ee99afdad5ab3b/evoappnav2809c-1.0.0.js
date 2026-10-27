/* Evolako 28.09.2026: EN/RU za meni (bez 'odmah'), liniju o aplikaciji u futeru i napomenu liste cekanja */
var BVQ=window.BVQ=window.BVQ||[];
BVQ.push(["en2","82wzhf§3 questions, 30 seconds — recommendation on screen§8z17qm§The iPhone and Android app is coming soon.§jcdo4f§Let me know when it’s out →§vvtfht§We’ll let you know when the app is out — leave your name and number or email."]);
BVQ.push(["ru2","82wzhf§3 вопроса, полминуты — рекомендация на экране§8z17qm§Приложение для iPhone и Android скоро выйдет.§jcdo4f§Сообщите мне, когда выйдет →§vvtfht§Сообщим, когда приложение выйдет, — оставь имя и номер или e-mail."]);
/* Evolako 28.09.2026: /kontakt?paket=aplikacija -> skriveno polje Paket='aplikacija' + napomena (lista cekanja za aplikaciju) */
(function(){if(!/^\/kontakt\/?$/.test(location.pathname)||!/[?&]paket=aplikacija(&|$)/.test(location.search))return;
function go(){var f=document.querySelector('input[name="Paket"]');if(!f)return;f.value='aplikacija';
var fm=f.closest('form');if(!fm||document.getElementById('evo-app-note'))return;
var d=document.createElement('div');d.id='evo-app-note';d.textContent="Javićemo ti kad aplikacija izađe — ostavi ime i broj ili e-mail.";
d.style.cssText='margin:0 0 18px;padding:12px 16px;border-radius:12px;border:1px solid rgba(46,107,255,.35);background:rgba(46,107,255,.08);font-size:14.5px;line-height:1.5';
fm.insertBefore(d,fm.firstChild);}
function later(){setTimeout(go,0);setTimeout(go,600)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',later);else later();})();
/* spacing of the app line under the language chips (page CSS sets .v3-fintro p margin to 0) */
(function(){var s=document.createElement('style');s.textContent='html body .v3-fintro p.v3-fapp{margin-top:14px}';(document.head||document.documentElement).appendChild(s);})();