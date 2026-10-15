import fs from 'node:fs';

// Snapshot the manifest and SVGs for visual review at picker size in both themes.
const logos=JSON.parse(fs.readFileSync('lib/vehicle-make-logos.json'));
let html=`<!doctype html><meta charset="utf-8"><title>Vehicle logo audit</title><style>body{margin:0;font:14px system-ui;background:#eee}h1,p{margin:18px}main{display:grid;grid-template-columns:repeat(4,1fr)}article{display:grid;grid-template-columns:1fr 1fr}.theme{background:#fff;color:#171717;padding:16px 12px;text-align:center}.dark{background:#171717;color:#fff}.logos{height:78px;display:flex;align-items:center;justify-content:space-around;gap:12px}img{object-fit:contain;filter:grayscale(1)}.dark img{filter:grayscale(1) invert(1)}span{display:block;margin-top:10px;font-size:12px}</style><h1>Vehicle manufacturer logo audit · ${Object.keys(logos).length} makes</h1><p>Enlarged (64px) and picker size (20px), light and dark. Captions are audit labels only.</p><main>`;
for(const [key,file] of Object.entries(logos).sort()) {let uri='data:image/svg+xml;base64,'+fs.readFileSync('public/vehicle-logos/'+file).toString('base64'); html+='<article>'+['light','dark'].map(theme=>`<div class="theme ${theme}"><div class="logos"><img src="${uri}" width="64" height="64"><img src="${uri}" width="20" height="20"></div><span>${key}</span></div>`).join('')+'</article>';}
html+='</main>';fs.writeFileSync('docs/testing/artifacts/vehicle-logos/audit.html',html);
console.log(`Wrote audit.html for ${Object.keys(logos).length} manufacturer logos.`);
