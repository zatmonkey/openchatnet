import Redis from 'ioredis';
import type { Store } from './store';

/** Dedicated Redis for private deployments; construction never opens a connection. */
export function nativeStore(url:string):Store & {close():void} {
  const client=new Redis(url,{lazyConnect:true,maxRetriesPerRequest:1,enableOfflineQueue:true,connectTimeout:5000});
  // Connection details may contain credentials. Callers receive the operation error through the standard service handler.
  client.on('error',()=>{});
  return {
    async eval<T>(script:string,keys:string[],args:(string|number)[]){return await client.eval(script,keys.length,...keys,...args) as T;},
    close(){client.disconnect();},
  };
}
