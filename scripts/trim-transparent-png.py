import struct,sys,zlib
src,dst=sys.argv[1:3]; d=open(src,'rb').read(); p=8; raw=b''
while p<len(d):
 n=struct.unpack('>I',d[p:p+4])[0]; t=d[p+4:p+8]; c=d[p+8:p+8+n]; p+=12+n
 if t==b'IHDR': w,h,dep,col,_,_,inter=struct.unpack('>IIBBBBB',c)
 if t==b'IDAT': raw+=c
 if t==b'IEND': break
assert dep==8 and col==6 and inter==0
s=w*4; dec=zlib.decompress(raw); rows=[]; prev=bytearray(s);q=0
for y in range(h):
 f=dec[q];q+=1; r=bytearray(dec[q:q+s]);q+=s
 for i in range(s):
  a=r[i-4] if i>=4 else 0;b=prev[i];c=prev[i-4] if i>=4 else 0
  if f==1:r[i]=(r[i]+a)&255
  elif f==2:r[i]=(r[i]+b)&255
  elif f==3:r[i]=(r[i]+(a+b)//2)&255
  elif f==4:
   z=a+b-c;pa=abs(z-a);pb=abs(z-b);pc=abs(z-c);r[i]=(r[i]+(a if pa<=pb and pa<=pc else b if pb<=pc else c))&255
 rows.append(r);prev=r
pts=[(x,y) for y,r in enumerate(rows) for x in range(w) if r[x*4+3]];x0=min(x for x,y in pts);x1=max(x for x,y in pts);y0=min(y for x,y in pts);y1=max(y for x,y in pts);o=bytearray()
for y in range(y0,y1+1):o+=b'\0'+rows[y][x0*4:(x1+1)*4]
def ch(t,c):return struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',x1-x0+1,y1-y0+1,8,6,0,0,0))+ch(b'IDAT',zlib.compress(o,9))+ch(b'IEND',b'');open(dst,'wb').write(png);print(w,h,'->',x1-x0+1,y1-y0+1)
