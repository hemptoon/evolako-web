// app.evolako.rs/s/p — pageview counter of www.evolako.rs (script evocounter in Webflow); see site-proxy/bot.js
import { toBot } from '../../site-proxy/bot.js';
export const onRequest = (context) => toBot(context);
