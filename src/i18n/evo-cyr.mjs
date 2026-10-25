/* evo-cyr.mjs — srpska latinica -> ćirilica, ista pravila kao na evolako.rs (Evolako i18n v3, 13.10.2026).
   Izvor istine: claude/Evolako_i18n_v3_Source_2026-10-13.md (projekat). Ne menjati pravila samo ovde — sajt i aplikacije moraju da daju isti rezultat.
   cyr(s): vraca string na cirilici; brendovi, jedinice, kodovi (MID, DC, START...), e-mail, adrese sajtova i engleske fraze ostaju latinicom. */
const CC=new Map();
/* ---- SR latinica -> cirilica ---- */
var CM={a:'а',b:'б',c:'ц',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'ј',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',r:'р',s:'с',t:'т',u:'у',v:'в',z:'з','č':'ч','ć':'ћ','đ':'ђ','š':'ш','ž':'ж'};
function S(s){var o={},a=s.split(' '),i;for(i=0;i<a.length;i++)if(a[i])o[a[i]]=1;return o}
/* tacno ovako napisano ostaje latinicom: skracenice, nazivi paketa, brendovi, engleske reci */
var KX=S('AC ADAC AI API BFF BIG CC CCS CE CSV CT DC DIN DIY DLM EN EPBD EUR EV EVO FAQ FF GPS GSM HD HTML ID IK IP IPS LAN LED LTE MCB MID MINI NFC OCPP OEM OK PDF PLUS PNG PREMIUM PRO RCBO RCD RFID RSD RU SEO SIL SKU SMS SR START SUV SVG UGRADNJA URL USB USD UV VAT VDE ZE ZGRADA Pro Max Mini Plus Premium Start Open Map Kia Zoe Audi Golf Spring Copy Stay Plug Nine Charge Adria Plaza Crowne Benz Sealion Proace Pulsar Onest Monta Apple Mercator Inn Fashion Center Cupra Jaguar Lucid Rivian Seal Leaf Corsa Macan Megane Delhaize Maps End Office Building Serbia Bank ABB GO LAKE MIND CEEFOR IKEA Airport Cars Comerc Eco Energised Generale Societe Inc Residence Retail Roaming Shop Sun Nets Orion Face Optic Store');
/* engleske reci (samo malim slovima) */
var KL=S('html form success failure has lake sun shop eco inc cars airport residence retail roaming an and at assembly basic bill billing bills board building buildings cars centre certified chargers charging clipboard controls copy database day destination distribution document duty electric electricity email every example for get heavy home houses in including installation installs it license live login map markup meter month monthly next offline online open optional or owner packages people please plug price provides residents schedule socket solves space stay submit takes templates text the wait who with working works app apps');
/* pocetak reci sa velikim slovom (sve padeske forme) */
var KP=['evolak','blokvolt','iochar','tesl','viber','telegram','instagram','facebook','google','android','cloudflare','supabase','resend','spacemail','spaceship','europcar','bloomberg','voltimum','turnstile','mercedes','renault','dacia','porsche','nissan','destination','database','electric','english','belgrade','packages','please','submit','schedule','controls','license','example','mitsubishi','chevrolet','cadillac','polestar','citro','peugeot','linkedin','youtube','whatsapp','webflow','posthog','maplibre','openstreetmap','openfreemap'];
var UN=S('A V W Wh kW kWh kVA VA mA Hz h MW MWh kWp Ah GWh');
var TIP=S('tip tipa tipu tipom tipovi klasa klase klasi klasu model modela modelu modelom modul modula faza faze fazi verzija serija varijanta kategorija kategorije razred plan');
var FR=/ch|ph|tion|ll|ss|tt|pp|ff|cc|gg|zz|bb|kk/i;
/* viseclani nazivi koji ostaju latinicom; engleske kratke reci samo za prepoznavanje engleskih recenica */
var PHR=/SIL Open Font License|Open Charge Map|(?:Google|Apple|Yandex) Maps|Electrify Serbia|West End|ProCredit Bank|EV Database|Hyatt Regency|Crowne Plaza|Square Nine|Tesla Destination|Model [3SXY]\b|Plus Code|Be Energised|Societe Generale/g;
var EW=S('to of on by is as be we you your our from more all no not one this that will can are was has have new free per via');
var CHK=/@|:\/\/|^www\.|\.(rs|com|net|org|eu|io|me|ba|hr|mk|app|dev|info)\b|^_|&|^e-mail|^plug-in|^[#$]/i;
var LT=/[A-Za-zÀ-ÖØ-öø-ɏ]+/g,LTs=/[A-Za-zÀ-ÖØ-öø-ɏ]/;
function kp(r){var l=r.toLowerCase(),i;for(i=0;i<KP.length;i++)if(l.indexOf(KP[i])===0)return 1;return 0}
function keep(r,b,a,a2,pw,pn){
 if(/[^A-Za-zČĆĐŠŽčćđšž]|[qwxyQWXY]/.test(r))return 1;
 if(/[a-zčćđšž][A-ZČĆĐŠŽ]/.test(r))return 1;
 if(/^[abvgd]$/.test(r)&&/\d/.test(b)&&!/[\dA-Za-z\u0400-\u04FF]/.test(a))return 0;
 if(/[\d°′″'"]/.test(b)||/\d/.test(a)||(a==='-'&&/\d/.test(a2)))return 1;
 if(pn&&!b&&UN[r])return 1;
 if(KX[r])return 1;
 var up=r===r.toUpperCase(),lo=r===r.toLowerCase();
 if(r.length>1&&up)return /^[IVXLCDM]+$/.test(r)?1:0;
 if(r.length===1&&up)return TIP[pw]||a==='+'?1:0;
 if(lo&&KL[r])return 1;
 if(!lo&&kp(r))return 1;
 return FR.test(r)&&r.toLowerCase()!=='bb'?1:0}
function tl(r){
 var lo=r.toLowerCase(),cp=r.length>1&&r===r.toUpperCase(),o='',i=0,t,c,d;
 var nx=/^(injek|konjunk|konjug)/.test(lo)?lo.indexOf('nj'):-1,dx=/^(nadživ|nadžnj|odžal|podžanr|podžup|nadžup)/.test(lo)?lo.indexOf('dž'):-1;
 for(;i<r.length;i++){
  t=lo.substr(i,2);
  if((t==='lj'||t==='nj'||t==='dž')&&i!==nx&&i!==dx){d=t==='lj'?'љ':t==='nj'?'њ':'џ';o+=(cp||r.charAt(i)!==lo.charAt(i))?d.toUpperCase():d;i++;continue}
  c=CM[lo.charAt(i)];
  if(!c){o+=r.charAt(i);continue}
  o+=(cp||r.charAt(i)!==lo.charAt(i))?c.toUpperCase():c}
 return o}
function ck(c,pw,pn){
 return c.replace(LT,function(r,ix){
  var k=keep(r,c.charAt(ix-1),c.charAt(ix+r.length),c.charAt(ix+r.length+1),pw,pn);
  pw=r.toLowerCase();pn=0;
  return k?r:tl(r)})}
function cs(s){
 var p=s.split(/(\s+)/),o='',pw='',pn=0,i,c,m;
 for(i=0;i<p.length;i++){c=p[i];
  if(!c||!/\S/.test(c)){o+=c;continue}
  if(CHK.test(c)||(/\d/.test(c)&&!/[a-zčćđšž]/.test(c))){o+=c;pw='';pn=/\d/.test(c)&&!LTs.test(c)&&!/\.$/.test(c)?1:0;continue}
  o+=ck(c,pw,pn);
  m=c.match(LT);pw=m?m[m.length-1].toLowerCase():pw;
  pn=/\d/.test(c)&&!LTs.test(c)&&!/\.$/.test(c)?1:0}
 return o}
function en(s){var w=s.match(/[A-Za-z]+/g),i,n=0;if(!w||w.length<2||/[čćđšžČĆĐŠŽ]/.test(s))return 0;for(i=0;i<w.length;i++)if(KL[w[i].toLowerCase()]||EW[w[i].toLowerCase()])n++;return n/w.length>=0.6}
function cy(s){
 if(s==null||!LTs.test(s))return s;
 var v=CC.get(s);if(v!==undefined)return v;
 var o='',i=0,m;
 if(en(s))o=s;else{PHR.lastIndex=0;while((m=PHR.exec(s))){o+=cs(s.slice(i,m.index))+m[0];i=m.index+m[0].length}o+=cs(s.slice(i))}
 if(CC.size<20000)CC.set(s,o);
 return o}


export function cyr(s){return cy(s)}
export default cyr;
