import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root=process.cwd();
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".webmanifest":"application/manifest+json"};
http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
    const file=path.resolve(root,"."+(pathname.endsWith("/") ? pathname+"index.html" : pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(body);
  } catch {res.writeHead(404).end();}
}).listen(4173,"127.0.0.1",()=>console.log("Notebook test server ready"));
