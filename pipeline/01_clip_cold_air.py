import rasterio, numpy as np, pyogrio, geopandas as gpd
from rasterio.windows import from_bounds
from rasterio.features import rasterize
D="/mnt/user-data/uploads/31_30DaysMapChallange/Day_15_Koblenz_Inivisible Lake/"
K=D+"Kaltluft_50m_OrkaDE_DWD_RLP_LfU_Stunde2/"
B=(385000,5565000,415000,5595000)
def clip(f):
    with rasterio.open(f) as r:
        w=from_bounds(*B,r.transform); a=r.read(1,window=w,boundless=True,fill_value=r.nodata); t=r.window_transform(w); return a,t,r.nodata
H,tH,ndH=clip(K+"Kaltlufthoehen007200_ORKADE_RLP.tif")
V,_,_=clip(K+"Volumenstromdichte_klassifiziert007200_ORKADE_RLP.tif")
print(H.shape, tH, np.nanmin(H[H!=ndH]), np.nanmax(H), (H==ndH).mean())
print('H pct', np.percentile(H[H!=ndH],[1,10,25,50,75,90,99]))
print('V classes', np.unique(V,return_counts=True))
g=gpd.read_file(D+"BasisDLM_SHP_RP/DLM_RP_geb01f.shp",bbox=B)
ko=g[g.BEZ_GEM=='Koblenz']; print(ko[['BEZ_GEM','EWZ','SCH']], ko.area.sum()/1e6)
ko.to_file('koblenz.gpkg')
m=rasterize(ko.geometry,out_shape=H.shape,transform=tH)==1
print('Koblenz H pct', np.percentile(H[m],[10,25,50,75,90]))
np.save('H50.npy',H); np.save('V50.npy',V); np.save('ko50.npy',m)
