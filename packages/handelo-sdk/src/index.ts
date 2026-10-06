import { HandeloAgent, type AgentResult } from "@handelo/agent";

export interface HandeloClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class HandeloApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HandeloApiError";
    this.status = status;
  }
}
export interface ChatRequest { message:string; }
export interface HandeloClient {
  chat(request:ChatRequest):Promise<AgentResult>;
}

export function normalizeChatMessage(message:string):string{
  const normalized=message.trim();
  if(!normalized) throw new Error("message is required");
  return normalized;
}

export function createHandeloClient(options:HandeloClientOptions={}):HandeloClient{
  if(options.baseUrl){
    const base=options.baseUrl.replace(/\/$/,"");
    return {
      async chat(request){
        const message=normalizeChatMessage(request.message);
        const requestFetch=options.fetch ?? globalThis.fetch;
        if(!requestFetch) throw new Error("fetch is required for the remote Handelo client");
        const headers:Record<string,string>={"content-type":"application/json"};
        if(options.apiKey) headers["x-handelo-api-key"]=options.apiKey;
        const response=await requestFetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({message})});
        const raw=await response.text();
        let payload:AgentResult & {error?:string};
        try{ payload=JSON.parse(raw) as AgentResult & {error?:string}; }
        catch{ throw new Error(`Handelo API returned invalid JSON (HTTP ${response.status}).`); }
        if(!response.ok) throw new HandeloApiError(payload.error??`Handelo API request failed with ${response.status}`, response.status);
        return payload;
      }
    };
  }
  const agent=new HandeloAgent({llmApiKey:options.apiKey});
  return {chat:({message})=>agent.run(normalizeChatMessage(message))};
}
