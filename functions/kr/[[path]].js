// app.evolako.rs/kr/* — careers form of www.evolako.rs (/kr/zemlja, /kr/apply, /kr/file/<id>, CORS preflight):
// Serbia-only rule in site-proxy/kr.js, the rest goes on to the bot (site-proxy/bot.js)
import { careers } from '../../site-proxy/kr.js';
export const onRequest = (context) => careers(context);
