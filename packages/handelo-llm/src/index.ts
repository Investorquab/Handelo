export type LlmProvider = "groq" | "openai" | "anthropic";

export interface JsonGenerationRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  generateJson<T>(request: JsonGenerationRequest): Promise<T>;
}

const MODELS: Record<LlmProvider,string> = {
  groq: "openai/gpt-oss-120b",
  openai: "gpt-5.6-luna",
  anthropic: "claude-sonnet-5",
};

function providerFromKey(key: string): LlmProvider {
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  throw new Error("Unsupported API key. Handelo currently recognizes Groq (gsk_), OpenAI (sk-), and Anthropic (sk-ant-) keys.");
}

function jsonText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

async function requestJson(url: string, key: string, body: unknown, headers: Record<string,string>) {
  const response = await fetch(url,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
  const raw = await response.text();
  if (!response.ok) throw new Error(`LLM request failed (${response.status}): ${raw.slice(0,500)}`);
  try { return JSON.parse(raw) as Record<string,unknown>; }
  catch { throw new Error("LLM returned invalid JSON response."); }
}

class OpenAiCompatibleClient implements LlmClient {
  constructor(public readonly provider:"groq"|"openai", private readonly key:string) {}
  get model(){ return MODELS[this.provider]; }
  async generateJson<T>(request:JsonGenerationRequest):Promise<T>{
    const url=this.provider==="groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const payload={
      model:this.model,
      messages:[{role:"system",content:request.system},{role:"user",content:request.user}],
      temperature:0,
      response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},
    };
    const result=await requestJson(url,this.key,payload,{Authorization:`Bearer ${this.key}`});
    const choices=result.choices as Array<Record<string,unknown>>|undefined;
    const content=(choices?.[0]?.message as Record<string,unknown>|undefined)?.content;
    if(typeof content!=="string") throw new Error("LLM did not return a text response.");
    return JSON.parse(jsonText(content)) as T;
  }
}

class AnthropicClient implements LlmClient {
  readonly provider="anthropic" as const;
  readonly model=MODELS.anthropic;
  constructor(private readonly key:string){}
  async generateJson<T>(request:JsonGenerationRequest):Promise<T>{
    const result=await requestJson("https://api.anthropic.com/v1/messages",this.key,{
      model:this.model,max_tokens:1200,system:request.system,
      messages:[{role:"user",content:request.user}],
      tools:[{name:request.schemaName,description:"Return the requested structured result.",input_schema:request.schema}],
      tool_choice:{type:"tool",name:request.schemaName},
    },{"x-api-key":this.key,"anthropic-version":"2023-06-01"});
    const content=result.content as Array<Record<string,unknown>>|undefined;
    const tool=content?.find(block=>block.type==="tool_use");
    if(!tool?.input) throw new Error("Anthropic did not return the requested structured result.");
    return tool.input as T;
  }
}

export function createLlmClient(apiKey = process.env.HANDELO_API_KEY ?? process.env.API_KEY ?? ""):LlmClient {
  const key=apiKey.trim();
  if(!key) throw new Error("Missing HANDELO_API_KEY (or API_KEY).");
  const provider=providerFromKey(key);
  return provider==="anthropic" ? new AnthropicClient(key) : new OpenAiCompatibleClient(provider,key);
}
