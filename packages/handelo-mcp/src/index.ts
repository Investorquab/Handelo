import { marketClientFromEnv } from "@handelo/market";

type JsonRpc={jsonrpc:"2.0";id?:number|string;method:string;params?:Record<string,unknown>};
const market=marketClientFromEnv();

const tools=[
  {name:"handelo_market_lookup",description:"Resolve a tokenized stock on BSC and return live token/reference price and market status.",inputSchema:{type:"object",properties:{ticker:{type:"string"}},required:["ticker"]}},
  {name:"handelo_market_search",description:"Search BSC tokenized-stock representations.",inputSchema:{type:"object",properties:{ticker:{type:"string"}},required:["ticker"]}}
];

function reply(id:number|string|undefined,result:unknown){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\\n");}
function error(id:number|string|undefined,code:number,message:string){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,error:{code,message}})+"\\n");}

function validateJsonRpc(value: unknown): JsonRpc {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON-RPC message");
  const message=value as Record<string,unknown>;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || !message.method.trim()) throw new Error("Invalid JSON-RPC message");
  if (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number") throw new Error("Invalid JSON-RPC message");
  if (message.params !== undefined && (!message.params || typeof message.params !== "object" || Array.isArray(message.params))) throw new Error("Invalid JSON-RPC params");
  return value as JsonRpc;
}

class InvalidToolArgumentsError extends Error {}

function readTicker(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new InvalidToolArgumentsError("arguments must be an object");
  const ticker=(args as Record<string,unknown>).ticker;
  if (typeof ticker !== "string" || !ticker.trim()) throw new InvalidToolArgumentsError("ticker is required");
  const normalized=ticker.trim().toUpperCase();
  if (normalized.length > 20) throw new InvalidToolArgumentsError("ticker is too long");
  return normalized;
}

async function handle(message:JsonRpc){
  if(message.method==="initialize") return reply(message.id,{protocolVersion:"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"handelo-mcp",version:"0.1.0"}});
  if(message.method==="notifications/initialized") return;
  if(message.method==="tools/list") return reply(message.id,{tools});
  if(message.method!=="tools/call") return error(message.id,-32601,"Method not found");
  const name=String(message.params?.name??"");
  const args=message.params?.arguments;
  try{
    if(name==="handelo_market_lookup"){
      const ticker=readTicker(args);
      const asset=await market.find(ticker);
      return reply(message.id,{content:[{type:"text",text:JSON.stringify({ticker:asset.underlyingTicker,tokenSymbol:asset.tokenSymbol,provider:asset.platformId,tokenPrice:asset.tokenPrice,referencePrice:asset.referencePrice,market:asset.statusInfo,contract:asset.tokenContractAddress},null,2)}]});
    }
    if(name==="handelo_market_search"){
      const ticker=readTicker(args);
      const results=await market.search(ticker);
      return reply(message.id,{content:[{type:"text",text:JSON.stringify(results,null,2)}]});
    }
    return error(message.id,-32602,"Unknown tool: "+name);
  }catch(e){
    if(e instanceof InvalidToolArgumentsError) return error(message.id,-32602,e.message);
    return error(message.id,-32000,e instanceof Error?e.message:String(e));
  }
}

let buffer="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",async(chunk)=>{
  buffer+=chunk;
  let index=buffer.indexOf("\n");
  while(index>=0){
    const line=buffer.slice(0,index).trim();
    buffer=buffer.slice(index+1);
    index=buffer.indexOf("\n");
    if(!line) continue;
    try{await handle(validateJsonRpc(JSON.parse(line)));}
    catch(e){error(undefined,-32700,e instanceof Error?e.message:"Invalid JSON-RPC message");}
  }
});