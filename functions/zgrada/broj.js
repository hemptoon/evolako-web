// app.evolako.rs/zgrada/broj — how many residents of a building signed up (www.evolako.rs/prijavi-zgradu); see site-proxy/bot.js
import { toBot } from '../../site-proxy/bot.js';
export const onRequest = (context) => toBot(context);
