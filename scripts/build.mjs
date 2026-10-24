import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('public/assets',{recursive:true});
for(const name of ['index.html','app.js','style.css','tweed.css'])await copyFile('dashboard/'+name,'public/'+name);
const origins=JSON.parse(await readFile('dashboard/assets/ORIGINS.json','utf8'));
for(const [name,url]of Object.entries(origins)){
 const result=await fetch(url);if(!result.ok)throw Error('Falha no asset de marca: '+name);
 await writeFile('public/assets/'+name,Buffer.from(await result.arrayBuffer()));
}
