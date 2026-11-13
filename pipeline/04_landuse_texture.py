import numpy as np, geopandas as gpd
from rasterio.features import rasterize
from affine import Affine
from PIL import Image
from scipy.ndimage import gaussian_filter
D="/mnt/user-data/uploads/31_30DaysMapChallange/Day_15_Koblenz_Inivisible Lake/"
B=(385000,5565000,415000,5595000); N=3000; t=Affine(10,0,385000,0,-10,5595000)
cls=np.zeros((N,N),np.uint8)  # 0 open land
w=gpd.read_file(D+"BasisDLM_SHP_RP/DLM_RP_veg02f.shp",bbox=B); print(w.OBJART_TXT.value_counts())
cls[rasterize(w.geometry,(N,N),transform=t)==1]=1
s=gpd.read_file(D+"BasisDLM_SHP_RP/DLM_RP_sie02f.shp",bbox=B)
s['k']=s.OBJART.astype(int).map({41001:2,41006:3,41002:4,41007:3,41008:5,41009:5}).fillna(4).astype(int)
for k in [5,4,3,2]:
    g=s[s.k==k]; cls[rasterize(g.geometry,(N,N),transform=t)==1]=k
g=gpd.read_file(D+"BasisDLM_SHP_RP/DLM_RP_gew01f.shp",bbox=B); cls[rasterize(g.geometry,(N,N),transform=t)==1]=6
np.save('lu10.npy',cls)
pal=np.array([[132,128,92],[44,66,40],[176,164,150],[160,150,140],[150,146,140],[96,120,74],[40,62,74]],np.float32)
rng=np.random.default_rng(1); img=pal[cls]
n=gaussian_filter(rng.standard_normal((N,N)),2)*14+gaussian_filter(rng.standard_normal((N,N)),12)*30
img=np.clip(img+n[...,None]*np.array([1,1,0.8]),0,255).astype(np.uint8)
Image.fromarray(img).save('site/data/landuse10.jpg',quality=88)
print(np.bincount(cls.ravel())/cls.size)
