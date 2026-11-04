/** Deployment-owned limits for private installations. No HTTP/MCP caller can supply these. */
export interface RoomLimits { participants:number; requestsPerMinute:number; messagesPerMinute:number; retainedMessages:number }
export function roomLimits(env:Record<string,string|undefined>=process.env):RoomLimits{
 const value=(key:string,fallback:number,max:number)=>{const raw=env[key];if(raw==null||raw==='')return fallback;const n=Number(raw);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`Invalid ${key}: expected an integer between 1 and ${max}`);return n;};
 return {participants:value('OPENCHATNET_PARTICIPANT_LIMIT',3,256),requestsPerMinute:value('OPENCHATNET_REQUESTS_PER_MINUTE',120,10000),messagesPerMinute:value('OPENCHATNET_MESSAGES_PER_MINUTE',300,3000),retainedMessages:value('OPENCHATNET_RETAINED_MESSAGES',1000,50000)};
}
