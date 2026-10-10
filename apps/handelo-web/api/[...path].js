import { timingSafeEqual } from "node:crypto";
export const config = { api: { bodyParser: false, responseLimit: false } };
const MAX_BODY_BYTES = 64 * 1024;
const SAFE_NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "ENETUNREACH", "EHOSTUNREACH",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"
]);
function safeEqual(a0,b0){const a=Buffer.from(String(a0??"")),b=Buffer.from(String(b0??""));return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);}
function decodeBasic(value){if(typeof value!=="string"||!value.startsWith("Basic "))return null;try{const s=Buffer.from(value.slice(6),"base64").toString("utf8");const i=s.indexOf(":");return i<1?null:{username:s.slice(0,i),password:s.slice(i+1)};}catch{return null;}}
function publicRead(method,path){return method==="GET"&&(path==="markets"||path==="earnings"||path.startsWith("earnings/")||path==="gap-radar"||path.startsWith("gap-radar/"));}
function reject(res,status,error,authRequired=false){res.statusCode=status;res.setHeader("content-type","application/json; charset=utf-8");res.setHeader("cache-control","no-store");if(authRequired){res.setHeader("www-authenticate",'Basic realm="Handelo Workspace", charset="UTF-8"');res.setHeader("x-handelo-auth-required","1");}res.end(JSON.stringify({error}));}
function proxyFailure(res,stage,error,upstreamUrl){
 const raw=String(error?.cause?.code||error?.code||"").toUpperCase();
 const code=SAFE_NETWORK_CODES.has(raw)?raw:"UNKNOWN";
 const name=error instanceof Error?error.name:"UnknownError";
 console.error("[handelo-proxy] upstream failure",JSON.stringify({stage,code,name,host:upstreamUrl.host}));
 if(res.headersSent){if(!res.writableEnded&&!res.destroyed)res.end();return;}
 res.statusCode=502;
 res.setHeader("content-type","application/json; charset=utf-8");
 res.setHeader("cache-control","no-store");
 res.setHeader("x-handelo-proxy-stage",stage);
 res.setHeader("x-handelo-proxy-code",code);
 res.end(JSON.stringify({error:"Could not reach the Handelo API.",diagnostic:{stage,code}}));
}
export default async function handler(req,res){
 const origin=String(process.env.HANDELO_API_ORIGIN||"").trim().replace(/\/+$/,"");
 const apiKey=String(process.env.HANDELO_CLIENT_API_KEY||"").trim();
 const expectedUser=String(process.env.HANDELO_WEB_USERNAME||"");const expectedPass=String(process.env.HANDELO_WEB_PASSWORD||"");
 if(!origin||!apiKey)return reject(res,503,"Handelo API proxy is not configured in Vercel.");
 const incoming=new URL(req.url||"/","https://handelo.invalid");const method=String(req.method||"GET").toUpperCase();
 if(!["GET","POST","OPTIONS"].includes(method)){res.setHeader("allow","GET, POST, OPTIONS");return reject(res,405,"Method not allowed.");}
 if(!incoming.pathname.startsWith("/api/"))return reject(res,404,"Not found.");
 const path=incoming.pathname.slice(5);const segments=path.split("/");
 if(!path||segments.some(s=>!s||s==="."||s===".."||!/^[A-Za-z0-9._-]+$/.test(s)))return reject(res,400,"Invalid API path.");
 if(!publicRead(method,path)){if(!expectedUser||!expectedPass)return reject(res,503,"Handelo workspace login is not configured in Vercel.");const supplied=decodeBasic(req.headers.authorization);if(!supplied||!safeEqual(supplied.username,expectedUser)||!safeEqual(supplied.password,expectedPass))return reject(res,401,"Sign in to access the Handelo workspace.",true);}
 let body;
 if(method==="POST"){const chunks=[];let size=0;try{for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>MAX_BODY_BYTES)return reject(res,413,"Request body is too large.");chunks.push(b);}body=Buffer.concat(chunks);}catch{return reject(res,400,"Could not read request body.");}}
 const upstreamUrl=new URL("/api/"+segments.map(encodeURIComponent).join("/"),origin);upstreamUrl.search=incoming.search;
 const headers={"x-handelo-api-key":apiKey,"accept":String(req.headers.accept||"application/json")};if(req.headers["content-type"])headers["content-type"]=req.headers["content-type"];if(req.headers["last-event-id"])headers["last-event-id"]=req.headers["last-event-id"];
 let upstream;
 try{upstream=await fetch(upstreamUrl,{method,headers,...(body&&body.length?{body,duplex:"half"}:{})});}
 catch(error){return proxyFailure(res,"fetch",error,upstreamUrl);}
 res.statusCode=upstream.status;res.setHeader("cache-control",upstream.headers.get("cache-control")||"no-store");res.setHeader("content-type",upstream.headers.get("content-type")||"application/json; charset=utf-8");const retry=upstream.headers.get("retry-after");if(retry)res.setHeader("retry-after",retry);if(!upstream.body)return res.end();
 if((upstream.headers.get("content-type")||"").includes("text/event-stream")){res.setHeader("x-accel-buffering","no");res.flushHeaders?.();}
 try{for await(const chunk of upstream.body){if(res.destroyed)break;if(!res.write(Buffer.from(chunk)))await new Promise(resolve=>res.once("drain",resolve));}res.end();}
 catch(error){return proxyFailure(res,"upstream_stream",error,upstreamUrl);}
}
