import type { BotBinding } from './bot.js';
export declare const ALLOWED: string[];
export declare function careers(context: { request: Request; env?: { BOT?: BotBinding } }): Promise<Response>;
