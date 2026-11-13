# The Invisible Lake · Koblenz after sunset

**#30DayMapChallenge 2026 · Day 15 · Inside out**

Two hours after sunset, cold air drains off the Hunsrück and the Westerwald and pools in the Rhine and Moselle valleys. Koblenz sits at the bottom of a lake you cannot see. This 3D map makes it visible.

**Live map:** https://barisparlatangiller.github.io/30DMC26-D15-InsideOut-Koblenz-Invisible-Lake/

## What the map shows

- **Cold-air lake:** the modelled cold-air layer, drawn on top of the terrain. The colour and opacity get stronger with depth. The colours follow the LfU RLP legend classes (10–20 m `#d4ecf8`, 20–30 m `#82e9fb`, 30–40 m `#33d4f1`, 40–50 m `#1598f6`, and so on).
- **Flow:** particles advected through the modelled flow field. Direction comes from `Stromrichtung`. Speed is volume-flux density divided by layer height (m/s), shown 300 times faster than real time.
- **Buildings:** LoD2 CityGML with real roof geometry.
- **Residential areas:** Basis-DLM `AX_Wohnbauflaeche` plus `AX_FlaecheGemischterNutzung`.
- **Satellite night temperature:** LfU RLP Cold-/Hot-Spots, night of 6 Aug 2024. The colours are the official LfU legend.
- **Cross-section:** a terrain profile along any line, with the cold-air layer above it.

## Key numbers (city of Koblenz, 105 km²)

| | |
|---|---|
| Residential land under ≥ 20 m of cold air | **60 %** (10.8 of 18.0 km²) |
| Residential land under ≥ 10 m | 76 % |
| Residential land with < 5 m (plateaus) | 10 % |
| Cold air over the Deutsches Eck | 49 m |
| Deepest cold air in the city | 103 m |

Computed on the 50 m model grid. A residential cell counts if its centre lies in a residential polygon.

## Data

| Data | Source | Licence |
|---|---|---|
| Cold-air height, volume-flux density, flow points, hour 2 after sunset (50 m) | DWD ORKA-DE, provided by LfU Rheinland-Pfalz | CC BY 4.0 |
| Cold-/Hot-Spots, night | LfU Rheinland-Pfalz | CC BY 4.0 |
| DGM1 (resampled to 5/15/30 m), LoD2, Basis-DLM, DOP20 | © GeoBasis-DE / LVermGeo RP | dl-de/by-2.0 |

## Limits

- This is a model for a clear, calm summer night (autochthonous weather). On windy or cloudy nights the lake does not form.
- The model has a 50 m grid and does not resolve single streets or courtyards. Buildings are part of the model's land use; they are not obstacles in this 3D view.
- The fill animation in the video is illustrative. The model provides the state at 2 h after sunset, not the filling process.
- The satellite night temperature is a surface temperature from one night, given relative to the district mean. Rivers stay warm at night and raise the values near the water.

## Pipeline

`pipeline/01–05_*.py` clip and convert the source data into `docs/data`. `pipeline/ortho.py` runs in GitHub Actions and fetches the orthophoto. `pipeline/film.mjs` records the 12 s video frame by frame (Playwright).

Built by Barış Parlatangiller with Claude (AI).
