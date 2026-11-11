function zipCRC(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function joinBytes(parts){const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;}
export function appendZipEntry(archive,filename,content){
 const endOffset=archive.length-22,view=new DataView(archive.buffer,archive.byteOffset,archive.length);if(view.getUint32(endOffset,true)!==0x06054b50)throw Error('Neispravan ZIP paket.');
 const count=view.getUint16(endOffset+10,true),centralSize=view.getUint32(endOffset+12,true),centralOffset=view.getUint32(endOffset+16,true),name=new TextEncoder().encode(filename),data=typeof content==='string'?new TextEncoder().encode(content):content,crc=zipCRC(data);
 const local=new Uint8Array(30),l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,0x21,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);
 const central=new Uint8Array(46),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,centralOffset,true);
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,count+1,true);e.setUint16(10,count+1,true);e.setUint32(12,centralSize+central.length+name.length,true);e.setUint32(16,centralOffset+local.length+name.length+data.length,true);
 return joinBytes([archive.slice(0,centralOffset),local,name,data,archive.slice(centralOffset,centralOffset+centralSize),central,name,end]);
}
