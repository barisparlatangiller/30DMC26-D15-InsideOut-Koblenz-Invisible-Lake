import numpy as np, glob, mapbox_earcut as ec
from lxml import etree
G="{http://www.opengis.net/gml}"; B="{http://www.opengis.net/citygml/building/1.0}"
files=sorted(glob.glob("/mnt/user-data/uploads/31_30DaysMapChallange/Day_15_Koblenz_Inivisible Lake/LoD2_*.gml"))
tris=[];kinds=[];nb=0
def tri(poly):
    P=np.array(poly).reshape(-1,3)
    if len(P)>3 and np.allclose(P[0],P[-1]): P=P[:-1]
    if len(P)<3: return None
    n=np.cross(P[1:]-P[0],np.roll(P[1:]-P[0],-1,axis=0)).sum(0)
    ax=np.argmax(np.abs(n)); Q=np.delete(P,ax,axis=1)
    idx=ec.triangulate_float64(Q,np.array([len(Q)],dtype=np.uint32))
    return P[idx.reshape(-1,3)] if len(idx) else None
for f in files:
    for ev,el in etree.iterparse(f,tag=[B+"RoofSurface",B+"WallSurface",B+"Building"]):
        if el.tag==B+"Building": nb+=1; el.clear(); continue
        k=0 if el.tag==B+"RoofSurface" else 1
        for pl in el.iter(G+"posList"):
            t=tri([float(v) for v in pl.text.split()])
            if t is not None: tris.append(t); kinds.append(np.full(len(t),k,np.uint8))
        el.clear()
T=np.concatenate(tris); K=np.concatenate(kinds)
print('buildings',nb,'tris',len(T),'roof',(K==0).sum(), 'xyz min',T.reshape(-1,3).min(0),'max',T.reshape(-1,3).max(0))
np.save('lod2_tris.npy',T.astype(np.float64)); np.save('lod2_kind.npy',K)
