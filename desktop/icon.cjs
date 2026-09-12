const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.whenReady().then(async()=>{
const w=new BrowserWindow({width:1024,height:1024,show:false,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
const svg=fs.readFileSync('companion/cat.svg','utf8');
await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;background:#141a1f;width:1024px;height:1024px}svg{width:1024px;height:1024px}</style>'+svg));
await new Promise(r=>setTimeout(r,300));fs.mkdirSync('build',{recursive:true});fs.writeFileSync('build/icon.png',(await w.webContents.capturePage()).resize({width:1024,height:1024}).toPNG());app.quit();
});
