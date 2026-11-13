import numpy as np, rasterio, geopandas as gpd, json, pyogrio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from affine import Affine
from scipy.ndimage import zoom, gaussian_filter
from PIL import Image
D="/mnt/user-data/uploads/31_30DaysMapChallange/Day_15_Koblenz_Inivisible Lake/"
B=(385000,5565000,415000,5595000); O='site/data/'
def enc16(a,scale):  # -> RGB png, value=round(a*scale)
    v=np.clip(np.round(a*scale),0,65535).astype(np.uint32)
    return np.dstack([(v>>8).astype(np.uint8),(v&255).astype(np.uint8),np.zeros_like(v,np.uint8)])
with rasterio.open(D+"Koblenz_DGM5_30km.tiff.tif") as r:
    z5=r.read(1)
nd=z5<-1000; print('dem nd',nd.mean()); z5[nd]=np.nanmedian(z5[~nd])
for res in [15,30]:
    f=res//5; z=z5.reshape(6000//f,f,6000//f,f).mean((1,3))
    Image.fromarray(enc16(z,50)).save(O+f'dem{res}.png',optimize=True); print(res,z.shape,z.min(),z.max())
# cold air: 50 m -> 25 m smooth
H=np.load('H50.npy'); H=np.where(H<0,0,H).astype(np.float32)
H25=np.clip(zoom(H,2,order=1),0,None); H25=gaussian_filter(H25,0.8)
Image.fromarray(enc16(H25,400)).save(O+'cold25.png',optimize=True)
# flow grid
s=gpd.read_file('strom.gpkg'); t50=Affine(50,0,385000,0,-50,5595000)
col=((s.geometry.x-385000)/50).astype(int).values; row=((5595000-s.geometry.y)/50).astype(int).values
ok=(col>=0)&(col<600)&(row>=0)&(row<600)
th=s.Stromrichtung.values; q=s.Volumenstromdichte.values
U=np.zeros((600,600),np.float32);V=U.copy();Q=U.copy()
U[row[ok],col[ok]]=np.sin(th[ok]); V[row[ok],col[ok]]=np.cos(th[ok]); Q[row[ok],col[ok]]=q[ok]
img=np.dstack([np.round((U+1)*127.5),np.round((V+1)*127.5),np.clip(np.round(Q/120*255),0,255)]).astype(np.uint8)
Image.fromarray(img).save(O+'flow50.png',optimize=True)
T=np.load('T50.npy'); Ti=np.where(T<-90,0,np.clip((T+6)*20,1,255)).astype(np.uint8)
Image.fromarray(Ti).save(O+'night50.png',optimize=True)
np.save('U50.npy',U);np.save('V50.npy',V);np.save('Q50.npy',Q)
print('flow pts',ok.sum(),'Q max',Q.max())
