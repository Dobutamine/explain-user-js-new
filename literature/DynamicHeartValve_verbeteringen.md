# Verbeterplan — dynamisch hartklepmodel (toekomstige uitbreidingen)

> Companion van `literature/DynamicHeartValve_implementatieplan.md` (het uitgevoerde implementatieplan). Dit document verzamelt verbeteringen die **later** doorgevoerd kunnen worden.

## Context
Het dynamische klepmodel (`enable_dynamics` op `HeartValve`, Korakianitis & Shi 2006) is geïmplementeerd en wordt gebruikt voor tuning in `public/model_definitions/term_neonate_birgit.json`. Tijdens het inspecteren en tunen zijn verbeteringen naar voren gekomen die nu niet strikt nodig zijn, maar later waarde toevoegen. Dit document verzamelt ze — met de **area-gebaseerde CQ-invoer** als hoofditem — plus een geprioriteerde backlog.

---

## Verbetering 1 (eerste stap) — Instelbare klepdiameter per klep (CQ uit diameter)

Per klep moet de **klepdiameter** in de UI instelbaar zijn, waarbij standaard **altijd de CQ van de standaarddiameter** wordt gebruikt (huidig gedrag), en **alleen wanneer een diameter wordt ingevuld** de CQ uit die waarde wordt berekend. Per klep onafhankelijk (invullen óf standaard houden). Backward-compatible.

### Motivatie
- `cq` is nu een abstracte coëfficiënt in `ml/(s·√mmHg)`; klinisch denk je in **klepdiameter** (echo, mm). Fysisch is `CQ` sowieso de orifice-constante `CQ = 50·C_d·EOA` (formule 6 + vereenvoudigde Bernoulli), dus dit is een **herparametrisatie**, geen nieuw model.

### Afleiding: `CQ = 50·C_d·EOA` (formule 6 + vereenvoudigde Bernoulli)
Formule 6 bij volledig open klep (AR=1): `Q = CQ·√ΔP` (Q in ml/s, ΔP in mmHg).
Orifice-flow = oppervlakte × snelheid: `Q = A·v`.
Snelheid uit de vereenvoudigde klinische Bernoulli `ΔP[mmHg] = 4·v²`:
```
v = ½·√ΔP   (m/s, ΔP in mmHg)
```
- De **4** in `4v²` = `½·ρ / 133,3`: de volledige Bernoulli `ΔP = ½·ρ·v²` geeft druk in **pascal** (ρ_bloed≈1060 kg/m³); delen door 133,3 zet Pa→mmHg (`½·1060/133,3 ≈ 4`).

Eenheden matchen — `A` in cm², `Q` in ml/s → `v` in cm/s (×100):
```
v = ½·√ΔP m/s = 50·√ΔP cm/s
Q = A·v = A[cm²] · 50·√ΔP = 50 · A · √ΔP   [ml/s]
```
Vergelijk met `Q = CQ·√ΔP`:
```
CQ = 50 · A_EOA[cm²]        (met discharge-coëff.: CQ = 50·C_d·EOA)
```
- De **50** = ½ (uit Bernoulli) × 100 (m/s→cm/s); het draagt de eenheid `cm/(s·√mmHg)`.
- Met `EOA = π·(d/2)²` en `d` in mm (radius `d/20` cm) volgt de code-formule: `cq = 50·cd·π·(d/20)²`.
- Eenheidscontrole: `[CQ] = [50]·[A] = cm/(s·√mmHg) · cm² = cm³/(s·√mmHg) = ml/(s·√mmHg)` ✓.

### Ontwerp (opt-in override, per klep)
Nieuwe config-props op `HeartValve`:
- **`diameter`** (mm, default `0`) — de UI-override. `0` = niet ingevuld → gebruik de standaard-`cq`. `> 0` → bereken `cq` uit deze diameter.
- **`cd`** (default `1.0`) — discharge-coëfficiënt.
- **`area_fraction`** (default `1.0`) — orifice-splitsfactor; `0.5` voor de twee tricuspidalis-paden (één klep-orifice over twee instroompaden).
- **`diameter_ref`** (mm, read-only) — de standaarddiameter per klep, puur ter info in de UI.
- `cq` blijft de **standaard/fallback** (gebruikt bij `diameter = 0`), en wordt **niet overschreven** (zodat `diameter = 0` de standaard herstelt).

Afleiding (mm → cm radius = `d/20`; area in cm²), berekend in `calc_model` vóór de bestaande factor-lagen:
```
cq_base = (diameter > 0)
          ? 50 · cd · π · (diameter/20)² · area_fraction    // uit ingevulde diameter
          : cq                                              // standaard/fallback
cq_eff  = cq_base + (cq_factor-1)·cq_base + (cq_factor_ps-1)·cq_base + (cq_factor_scaling_ps-1)·cq_base
```
Live verstelbaar via `setPropValue("LV_AA.diameter", 7.0, …)` (pikt de volgende step op).

### Bestanden
- `explain/component_models/HeartValve.js` — props `diameter`/`cd`/`area_fraction`/`diameter_ref`; `cq_base`-logica in `calc_model`.
- `src/model-interface/registry.ts` (`HeartValve`-blok): `diameter` (basic), `diameter_ref` (basic, readonly), `cd` (advanced), `area_fraction` (advanced), `cq_eff` (readonly output); `cq` blijft (basic) als standaard/fallback.
- `public/model_definitions/term_neonate_birgit.json` — per klep `diameter: 0`, `cd: 1`, `area_fraction` (1; **0.5** tricuspidalis) en `diameter_ref` toevoegen; `cq` blijft.

| Klep | name | diameter_ref (mm) | area_fraction | cq (standaard) |
|---|---|---|---|---|
| aorta | `LV_AA` | 6,5 | 1 | 17 |
| pulmonalis | `RV_PA` | 8,0 | 1 | 25 |
| aorta (TGA) | `LV_PA` | 6,5 | 1 | 17 |
| pulm. (TGA) | `RV_AA` | 8,0 | 1 | 25 |
| mitralis | `LA_LV` | 11,0 | 1 | 48 |
| tricuspidalis | `RAIVCI_RV` | 12,0 | 0,5 | 28 |
| tricuspidalis | `RASVC_RV` | 12,0 | 0,5 | 28 |

Consistentiecheck: `50·π·(6,5/20)² ≈ 17` en `50·π·(12/20)²·0,5 ≈ 28` → `diameter_ref` reproduceert de bestaande `cq`.

### Verificatie
- **Regressie**: `diameter = 0` overal → `cq_base = cq` → simulatie identiek aan nu.
- **Override**: `LV_AA.diameter = 6,5` → `cq_eff ≈ 17`; `= 8` → `cq_eff ≈ 25` en flow neemt toe; alleen die klep verandert.
- **Tricuspidalis**: `diameter = 12` op beide paden met `area_fraction 0.5` → `cq_eff ≈ 28` per pad.
- Statisch: JSON valide, veldnamen consistent, geen JS/TS-diagnostics. Live-check (UI-slider op `diameter`, plot `cq_eff`/flow) in de host-app.

### Kanttekeningen
- **Overlap met `theta_max`**: `diameter`/`eoa` = orifice-/annulusgrootte; `theta_max` = bladexcursie. Beide beïnvloeden de effectieve opening → semantiek vastleggen (zie verbetering 3).
- `cd` en de "50" zijn aannames (vereenvoudigde Bernoulli); `cd` is exposeerbaar om de bias bij te stellen.

---

## Backlog — overige verbeteringen (geprioriteerd)

### 2. Robuustere flow↔druk-koppeling (numerieke stabiliteit) — **hoog**
- Probleem: het volume wordt één keer per engine-step verplaatst (ΔP constant over de substeps), wat bij hoge CQ systolische reverse-flow-oscillatie geeft (waargenomen tijdens tuning).
- Opties: (a) volume **per substep** verplaatsen met herlezen druk; (b) globaal kleinere `modeling_stepsize`; (c) impliciete/gedempte behandeling van de koppeling; (d) meer demping via `kf`.
- Effort middel; risico: raakt de step-lus → goed regressietesten tegen de lineaire baseline.

### 3. Ziekte-semantiek verhelderen — **middel**
- Leg per ziektebeeld de knop vast en documenteer/preset het:
  - stenose (annulus/orifice-vernauwing) → `eoa`↓ (of `theta_max`↓ voor bladrestrictie),
  - regurgitatie (onvolledige sluiting) → `theta_min`↑,
  - vermijd dubbel-tunen van `eoa` én `theta_max` zonder duidelijke reden.

### 4. Betere defaults — **laag**
- Constructor `cq = 350` is een arbitraire placeholder; overweeg neutraler (bv. `0`, zodat een vergeten `cq` direct opvalt) of afleiden uit `eoa`.
- `theta_min` default `5°` geeft een kleine lek, en dynamische modus negeert `no_back_flow`; overweeg default `0` (competente klep) of een expliciete "competent"-preset.

### 5. Tricuspidalis als één dynamische klep — **laag/middel**
- Nu twee parallelle dynamische kleppen (`RAIVCI_RV`, `RASVC_RV`, elk eigen θ). Fysiologisch getrouwer: één gedeeld leaflet/orifice met behoud van de twee instroom-splitsing. Vergt herstructurering.

### 6. Robuustere integrator voor de stijve leaflet-ODE — **laag**
- Nu semi-impliciete Euler met vaste `n_substeps`. Overweeg adaptieve stap of een impliciete behandeling van de `−kf·dθ`-dempterm voor stabiliteit bij hoge `kp`.

---

## Aanbevolen volgorde
1. **Verbetering 1 (area-CQ)** en **2 (stabiliteit)** eerst — die raken direct de bruikbaarheid en de lopende tuning.
2. **3 (semantiek)** daarna, voor duidelijkheid bij ziekte-simulaties.
3. **4–6** zijn nice-to-have, op te pakken wanneer het uitkomt.
