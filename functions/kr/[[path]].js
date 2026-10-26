// app.evolako.rs/kr/* — careers form of www.evolako.rs (/kr/apply, /kr/file/<id>, CORS preflight); see site-proxy/bot.js
import { toBot } from '../../site-proxy/bot.js';
export const onRequest = (context) => toBot(context);
