export interface BotBinding { fetch(request: Request): Promise<Response> }
export declare function toBot(context: { request: Request; env?: { BOT?: BotBinding } }): Promise<Response>;
