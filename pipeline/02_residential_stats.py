import numpy as np, geopandas as gpd, rasterio
from rasterio.features import rasterize
from rasterio.warp import reproject, Resampling
from affine import Affine
D="/mnt/user-data/uploads/31_30DaysMapChallange/Day_15_Koblenz_Inivisible Lake/"
B=(385000,5565000,415000,5595000)
t50=Affine(50,0,385000,0,-50,5595000)
H=np.load('H50.npy'); H=np.where(H<0,0,H); ko=np.load('ko50.npy')
# night anomaly to 50m
T=np.full(H.shape,-999,np.float32)
with rasterio.open(D+"Cold-HotSpots_Nacht_Landkreise_Ebene_LfU_RLP/ColdHotSpots_Forest2_060824_Nacht_EPSG25832_Landkreise.tif") as r:
    reproject(rasterio.band(r,1),T,dst_transform=t50,dst_crs=r.crs,resampling=Resampling.nearest,dst_nodata=-999)
print('T vals',np.unique(T[ko],return_counts=True))
s=gpd.read_file(D+"BasisDLM_SHP_RP/DLM_RP_sie02f.shp",bbox=B)
print(s.OBJART_TXT.value_counts())
res=s[s.OBJART.isin(['41001','41006',41001,41006])]
kg=gpd.read_file('koblenz.gpkg').geometry.iloc[0]
resk=res[res.intersects(kg)].copy(); resk['geometry']=resk.intersection(kg)
R=rasterize(((g,1) for g in resk.geometry),out_shape=H.shape,transform=t50)==1
print('res cells',R.sum(),'area km2',resk.area.sum()/1e6)
for th in [0.01,10,20,30,50]:
    print(f'res H>={th}: {(H[R]>=th).mean():.3f}')
print('res H median', np.median(H[R]))
v=T>-99
for name,mask in [('res lake>=20',R&(H>=20)&v),('res dry<5',R&(H<5)&v),('all ko lake',ko&(H>=20)&v),('all ko dry',ko&(H<5)&v)]:
    print(name,mask.sum(),'meanT',T[mask].mean().round(2),'hot share',(T[mask]>=2).mean().round(3),'cool share',(T[mask]<=-1).mean().round(3))
np.save('R50.npy',R); np.save('T50.npy',T); resk.to_file('res_koblenz.gpkg')
