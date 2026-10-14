import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const image=new Resvg(fs.readFileSync('resources/mochila.svg'),{fitTo:{mode:'width',value:256}}).render().asPng();
fs.writeFileSync('resources/mochila.png',image);
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
fs.writeFileSync('resources/mochila.ico',Buffer.concat([header,image]));
console.log('Iconos originales de Mochila generados.');
