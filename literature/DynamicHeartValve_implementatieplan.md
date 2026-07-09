# Implementatieplan — dynamisch hartklepmodel (Korakianitis & Shi 2006) naast het bestaande klepmodel

## Status: uitgevoerd (2026-06-19)
- ✅ **Stap 1** — `explain/component_models/HeartValve.js`: `enable_dynamics`-modus + dynamisch Korakianitis-model toegevoegd (lineaire weg delegeert naar `super.calc_model()`).
- ✅ **Stap 2** — `src/model-interface/registry.ts`: `HeartValve`-blok uitgebreid met `enable_dynamics`, `cq`, `theta_max`/`theta_min`, `kp`/`kf`/`kb`/`kv`/`n_substeps`, `cq_factor_ps` en read-only `theta`/`ar`.
- ✅ **Stap 3** — disease via directe hoek-tweens: geen aparte codewijziging nodig (werkt out-of-the-box via de bestaande `TaskScheduler` + de `theta_max`/`theta_min`-props).
- ✅ **Stap 4** — `public/model_definitions/term_neonate_birgit.json`: dynamisch blok op alle 7 kleppen (`enable_dynamics:false`); tricuspidalis `RAIVCI_RV`/`RASVC_RV` omgezet `Resistor`→`HeartValve`; shunt `RAIVCI_RASVC` blijft `Resistor`.
- ✅ **Geverifieerd**: JSON valide (7 dynamische kleppen), geen JS/TS-diagnostics, regressie gegarandeerd op codeniveau (flags uit ⇒ `super.calc_model()`; tricuspid lineair ≡ `Resistor`). `term_neonate`-baseline onaangeraakt.
- ⏳ **Nog te doen (in host-app, kan niet vanuit deze map)**: run-verificatie tegen de `term_neonate`-baseline + per-klep `cq`-tuning voor de neonaat (zie sectie Verificatie).

## Context

De huidige `HeartValve` (`explain/component_models/HeartValve.js`) is een lege `Resistor`-subklasse: lineaire wet `Q=ΔP/R` met harde `no_back_flow`-schakelaar. De toegevoegde paper (`literature/Korakianitis en Shi - 2006 …pdf`) beschrijft een **dynamisch klepmodel** waarin de leaflet-hoek θ een toestandsvariabele is (2e-orde ODE), met een orifice-flowwet en ziekte als parameterverandering (stenose→θ_max↓, regurgitatie→θ_min↑).

**Doel & harde eisen van de gebruiker:**
1. **Beide klepmodellen kunnen testen** (oud lineair én nieuw dynamisch), naast elkaar.
2. **Per klep kunnen bepalen welk model draait** — de mitralis kan lineair zijn terwijl de aortaklep dynamisch is, binnen hetzelfde scenario.
3. **Bij álle kleppen staan de dynamische parameters al in de JSON** (met `enable_dynamics: false`), zodat per-klep schakelen alleen een flag-omzetten is — geen params toevoegen. Dit geldt voor alle 4 anatomische kleppen, **inclusief de tricuspidalis**.

We breiden daarom het bestaande `HeartValve`-type **uit met een dynamische modus** (flag `enable_dynamics`, default `false`) in plaats van een tweede kleptype toe te voegen. Per klep schakelen = die flag op de entry zetten (of live togglen via `setPropValue`); beide modellen testen = de flag aan/uit of via A/B-scenario's. Default `false` → de bestaande lineaire weg blijft draaien en scenario's gedragen zich identiek.

## Het Korakianitis & Shi model (kern)
- **Leaflet-ODE** (Eq.14, K=k/I): `d²θ/dt² = ΔP·K_p·cosθ − K_f·dθ/dt + K_b·Q·cosθ − K_v·Q·sin2θ` (vortex-term alleen bij Q≥0)
- **Openingsoppervlak** (Eq.8): `AR = (1−cosθ)² / (1−cosθ_max)²`
- **Orifice-flow** (Eq.6): `Q = ±CQ·AR·√|ΔP|`, teken naar ΔP — dit is de compacte 1-regel-vorm van de stuksgewijze Eq.(6), met `± = sgn(ΔP)` en `√|ΔP|` als gemeenschappelijke grootte van beide takken. Onderliggend is dit de klassieke orifice/Bernoulli-relatie `Q=C_d·A·√(2ΔP/ρ)`, waarbij `C_d·√(2/ρ)·A_max` in `CQ` zit en de variabele opening in `AR`.
  - **Richtingsafspraak**: `Q` = flow van `comp_from` (upstream, druk `P_up`) naar `comp_to` (downstream, druk `P_down`); positief = voorwaarts. Bloed stroomt van hoog naar laag, dus `P_up>P_down → Q>0` (voorwaarts) en `P_up<P_down → Q<0` (terugstroom). Voorbeeld aortaklep `LV_AA` (from=LV, to=AA): **systole** `P_lv>P_aorta → Q>0`, LV→aorta (normale uitstroom); **diastole** `P_lv<P_aorta → Q<0`, aorta→LV (regurgitatie/lek mits klep open). Dit is identiek aan de bestaande `Resistor`-conventie (`Resistor.js:104`, `if(_p1_t>=_p2_t)` → voorwaarts positief), zodat `Heart.js` (`flow>0` = voorwaarts) blijft werken.
  - **⚠️ Teken-noot**: zoals Eq.(6) *letterlijk gedrukt* staat, heeft de terugstroom-tak (`P_up<P_down`) géén minteken — beide takken leveren positieve Q, wat fysiologisch onjuist is (voorwaarts pompen bij hogere achterdruk). De gangbare/correcte interpretatie geeft die tak een **negatief** teken: `Q=−CQ·AR·√(P_down−P_up)`. De `±…√|ΔP|`-vorm hierboven (en `sign(dP)*…` in de pseudocode) gebruikt bewust deze getekende versie, zodat regurgitatie/reverse-flow ontstaat wanneer `AR>0` blijft (θ_min>0) en `ΔP<0`. Dit is dus een bewuste correctie t.o.v. de letterlijke gedrukte tekst, geen 1-op-1 overname.
- **Gezond**: θ_max=75°, θ_min=5°; K_p≈5500, K_f≈50, K_b≈2, K_v≈3.5; CQ≈350–400 ml/(s·√mmHg)
- **Ziekte = parameters**: stenose → θ_max↓; regurgitatie → θ_min↑ (lekspleet). θ geclampt op [θ_min, θ_max].

---

## Implementatiestappen

### Stap 1 — Bestaande `HeartValve` uitbreiden met een dynamische modus (`explain/component_models/HeartValve.js`)
**Geen nieuwe klasse en geen nieuw `model_type`.** `HeartValve` blijft een `Resistor`-subklasse, maar krijgt een schakelaar `enable_dynamics` (boolean, default `false`):
- `enable_dynamics = false` (default) → ongewijzigd lineair gedrag: `calc_model()` delegeert naar `super.calc_model()` (de bestaande `Resistor.calc_resistance()` + `calc_flow()`). Bestaande scenario's gedragen zich byte-voor-byte identiek.
- `enable_dynamics = true` → het dynamische θ-ODE + orifice-pad.

Per klep schakelen = `enable_dynamics` op die entry zetten; live togglen kan zelfs via `setPropValue("LV_AA.enable_dynamics", true)` (boolean = directe swap, TaskScheduler type 1) zonder rebuild.

Wijzigingen in de klasse (nu mét eigen constructor i.p.v. de lege subklasse):
- **Constructor**: roep `super(...)` (erft `r_*`, `comp_from/to`, de `volume_out`/`volume_in` "volume-not-removed" handshake `Resistor.js:114-116, 137-138`, `flow`, `no_flow`, `_prev_flow`). Voeg toe: config `enable_dynamics=false`, `cq, kp, kf, kb, kv, n_substeps=5`; **`theta_max`, `theta_min` als direct bewerkbare/tweenbare basis-hoeken in graden** (zo vul je ze in UI én JSON in graden in; default `theta_max=75`, `theta_min=5`); géén factor-laag voor de hoeken — alleen CQ krijgt `cq_factor/_ps/_scaling_ps` (allometrisch scaling-aangrijpingspunt); interne state `theta`, `dtheta` in radialen; output `ar`. `calc_model` converteert de hoeken graden→radialen bij gebruik (`cos`/`sin` werken in radialen).
- **Override `calc_model()`** met een vertakking:
```
calc_model():
  if (!enable_dynamics) { super.calc_model(); return; }   // bestaande lineaire weg, ongemoeid
  // --- dynamische weg ---
  _comp_from=models[comp_from]; _comp_to=models[comp_to]
  bereken cq_eff via factorlaag (alleen CQ); reset non-persist factor
  theta_max_rad=theta_max*π/180; theta_min_rad=theta_min*π/180   // config in graden → radialen
  p_up=_comp_from.pres+p1_ext; p_down=_comp_to.pres+p2_ext; reset p_ext; flow=0
  if no_flow: _prev_flow=0; return
  dP=p_up-p_down; Q_accum=0; dt=_t/n_substeps
  for i in 1..n_substeps:        // sub-stepping: engine=0.0005s, ODE stijf (K_p≈5500)
    cosT=cos(theta); ar=(1-cosT)^2/(1-cos(theta_max_rad))^2
    Q = sign(dP)*cq_eff*ar*sqrt(|dP|)         // ODE intern in paper-units (mL,mmHg)
    d2 = kp*dP*cosT - kf*dtheta + kb*Q*cosT
    if Q>=0: d2 -= kv*Q*sin(2*theta)
    dtheta += d2*dt; theta += dtheta*dt
    clamp theta in [theta_min_rad, theta_max_rad]; zero dtheta tegen de stop
    Q_accum += Q
  flow = (Q_accum/n_substeps)/1000            // mL/s -> L/s
  if flow>=0: vnr=_comp_from.volume_out(flow*_t); _comp_to.volume_in(flow*_t-vnr,_comp_from)
  else:       vnr=_comp_to.volume_out(-flow*_t); _comp_from.volume_in(-flow*_t-vnr,_comp_to)
  _prev_flow = flow
```
- **`.flow`-contract** (L/s, positief = voorwaarts) blijft in béide modi gelijk → `Heart.js` systoledetectie ongewijzigd.
- **Regurgitatie valt vanzelf uit**: θ_min>0 → AR nooit 0 → bij ΔP<0 lekt Q<0 terug. In de dynamische modus wordt `no_back_flow` genegeerd (θ_min bepaalt de lek).
- **Units**: draai de ODE in native paper-units; converteer alleen Q→L/s (`/1000`) zodat CQ én K-coëfficiënten op gepubliceerde waarden blijven (anders koppelen K_b/K_v ×1000 mee).
- **Geen registratiewijziging nodig**: `HeartValve` staat al geëxporteerd in `explain/ModelIndex.js`.

### Stap 2 — UI-schema (`src/model-interface/registry.ts`)
**Breid het bestaande `"HeartValve"`-blok uit** (rond regels 2648–2767) — niet vervangen: de lineaire velden (`r_for`/`r_back`/`r_k`/`r_*_factor_ps`) blijven, want ze worden gebruikt in de lineaire modus. Voeg toe:
- `enable_dynamics` (boolean, basic) — de modusschakelaar
- `cq` (number, basic); **`theta_max`/`theta_min` (number, basic, in graden — géén `factor`, want de prop staat al in graden)** — dit zijn de knoppen voor stenose (θ_max) en regurgitatie (θ_min)
- `kp`/`kf`/`kb`/`kv`/`n_substeps` (number, `edit_mode:"advanced"`)
- `cq_factor_ps` (type `"factor"`) — alleen CQ heeft een factor-laag
- read-only outputs: `theta` (intern radialen → toon in graden via `factor: 180/π`), `ar`
(De dynamische velden zijn alleen zinvol bij `enable_dynamics=true`; zet ze op `advanced`/`extra` zodat de basis-UI niet vervuilt.)

### Stap 3 — Disease-parameters via directe tweens op de hoeken
Beide ziektes zijn nu **directe numerieke tweens op de basis-hoekprops** (symmetrisch, geen factor-laag). De `TaskScheduler` type-0 tween schrijft direct naar base-params, dus dit werkt out-of-the-box.
- **Stenose** = `theta_max` verlagen (bv. 75→50): `setPropValue("LV_AA.theta_max", 50, it, at)` — kleinere maximale opening → kleiner orifice → hogere gradiënt.
- **Regurgitatie** = `theta_min` verhogen (bv. 0→25): `setPropValue("LV_AA.theta_min", 25, it, at)` — klep sluit niet volledig → lekspleet → terugstroom in diastole.
- Waarden in graden (zelfde eenheid als UI/JSON); `it`/`at` = tween-duur/-vertraging zoals gebruikelijk.

### Stap 4 — Dynamisch blok op álle kleppen pré-invullen + per-klep schakelen
Alle kleppen leven onder `Heart.components` in `public/model_definitions/term_neonate_birgit.json`. We geven **elke klep-entry het volledige dynamische blok met `enable_dynamics: false`**. De constructor (Stap 1) geeft deze props al defaults, dus de engine heeft de keys niet strikt nodig — maar door ze expliciet in de JSON te zetten staan ze klaar in bestand én UI, en is per-klep schakelen louter de flag omzetten. Met alle flags `false` draait het scenario identiek aan nu (**regressie-veilig**).

**De 7 klep-entries (onder `Heart.components`):**
- 5 bestaande `HeartValve`: `LA_LV` (regel 4990), `RV_PA` (5074), `RV_AA` (5102, uit), `LV_AA` (5130), `LV_PA` (5158, uit).
- **Tricuspidalis**: zet `RAIVCI_RV` (5014) en `RASVC_RV` (5042) om van `model_type: "Resistor"` → `"HeartValve"`. Dat is **gedrag-behoudend in lineaire modus** (`HeartValve` met `enable_dynamics:false` ≡ `Resistor`, want de override delegeert naar `super.calc_model()`), dus regressie-veilig. Het modelleert de tricuspidalis als **twee parallelle dynamische instroompaden**, elk met eigen leaflet-θ — consistent met de bestaande twee-resistor-splitsing (IVC- en SVC-zijde). **`RAIVCI_RASVC` blijft `Resistor`** (intra-atriale shunt, geen klep).

**Dynamisch blok per klep** (Korakianitis-startwaarden; `cq`/`kv` per kleptype, rest gemeenschappelijk):

| Klep | name | rol | cq | kv | kp/kf/kb | θmax/θmin | n_substeps |
|---|---|---|---|---|---|---|---|
| mitralis | `LA_LV` | inflow | 400 | 3.5 | 5500/50/2 | 75/5 | 5 |
| tricuspidalis | `RAIVCI_RV` | inflow | 400 | 3.5 | 5500/50/2 | 75/5 | 5 |
| tricuspidalis | `RASVC_RV` | inflow | 400 | 3.5 | 5500/50/2 | 75/5 | 5 |
| aorta | `LV_AA` | outflow | 350 | 7 | 5500/50/2 | 75/5 | 5 |
| pulmonalis | `RV_PA` | outflow | 350 | 3.5 | 5500/50/2 | 75/5 | 5 |
| pulm. (TGA) | `RV_AA` | outflow | 350 | 3.5 | 5500/50/2 | 75/5 | 5 |
| aorta (TGA) | `LV_PA` | outflow | 350 | 7 | 5500/50/2 | 75/5 | 5 |

JSON-keys om aan elke entry toe te voegen (graden voor de hoeken):
```json
"enable_dynamics": false,
"cq": <zie tabel>, "kp": 5500, "kf": 50, "kb": 2, "kv": <zie tabel>,
"theta_max": 75, "theta_min": 5, "n_substeps": 5
```
State `theta`/`dtheta`/`ar` initialiseert de constructor; niet nodig in JSON. De lineaire velden (`r_for`/`r_back`/`r_k`/…) blijven staan voor de lineaire modus.

**Per klep schakelen — drie wegen:**
1. **JSON**: `"enable_dynamics": true` op de gewenste entry (begininstelling van het scenario).
2. **UI**: de `enable_dynamics`-checkbox per klep (Stap 2).
3. **Live**: `setPropValue("LV_AA.enable_dynamics", true)` tijdens de run, zonder rebuild.

**Beide modellen testen:**
- **In-place togglen**: omdat het dynamische blok overal voorgevuld staat met `enable_dynamics:false`, zet je per klep de flag aan/uit in `term_neonate_birgit` zelf — geen tweede bestand nodig.
- **A/B-vergelijking**: gebruik het **ongewijzigde `term_neonate`-scenario als lineaire baseline** naast `term_neonate_birgit` met (sommige) kleppen dynamisch. Er hoeft dus **géén aparte kopie of `index.json`-entry** gemaakt te worden — alle wijzigingen gaan in `term_neonate_birgit`.

**Tuning**: de `cq`/`kv` zijn volwassen paper-waarden → her-tunen voor de neonaat (risico #3). Hieronder twee methodes om `cq` te bepalen: **methode 1** (flow-matching tegen de lineaire `r_for`) en **methode 2** (uit de effectieve klepopening via Bernoulli). **Methode 2 is toegepast** op de huidige JSON-waarden.

#### Methode 1 (referentie) — flow-matching tegen de lineaire `r_for`
Laat het dynamische model bij **volledig open klep (AR≈1)** dezelfde flow passeren als de lineaire klep met `r_for=55`.

- Lineair (L/s): `Q_lin = ΔP / r_for`
- Dynamisch, AR=1 (ml/s → `/1000` voor L/s): `Q_dyn = CQ · √ΔP / 1000`

Gelijkstellen bij een representatieve open-klep-gradiënt `ΔP_rep` en oplossen naar CQ:
```
CQ · √ΔP_rep / 1000 = ΔP_rep / r_for
CQ · √ΔP_rep        = 1000 · ΔP_rep / r_for
CQ                  = 1000 · ΔP_rep / (r_for · √ΔP_rep)
CQ                  = 1000 · √ΔP_rep / r_for        (want ΔP_rep / √ΔP_rep = √ΔP_rep)
CQ                  = (1000 / 55) · √ΔP_rep ≈ 18,2 · √ΔP_rep
```
Eenheidscontrole: `(ml/L · √mmHg) / (mmHg·s/L) = ml/(s·√mmHg)` ✓ — precies de eenheid van CQ.
Let op: de match is **exact bij de gekozen `ΔP_rep`**; lineair is ∝ΔP, orifice ∝√ΔP, dus daarbuiten lopen ze uiteen. `ΔP_rep` = de typische gradiënt waarbij de klep openstaat (semilunair ~5, AV-kleppen ~2 mmHg).

`CQ = 18,2 · √ΔP_rep`:

| ΔP_rep (mmHg) | 1 | 2 | 3 | 5 | 8 | 10 |
|---|---|---|---|---|---|---|
| CQ | 18 | 26 | 32 | 41 | 51 | 57 |

De per-klep referentiewaarden (bij ΔP_rep semilunair ~5, AV ~2 mmHg) komen dan uit op ~40 (aorta), ~35 (pulmonalis) en ~26 (AV-kleppen). Dit is de **referentiemethode**; de toegepaste waarden komen uit methode 2 hieronder.

#### Methode 2 (toegepast) — CQ uit de effectieve klepopening (Bernoulli)
`CQ` is fysisch de orifice-constante uit formule 6 + Bernoulli. Bij AR=1 is `Q = A·v`, met `v` uit de vereenvoudigde klinische Bernoulli `ΔP[mmHg] = 4·v²` → `v = ½·√ΔP` (m/s). Met `A` in cm² en `Q` in ml/s (v van m/s→cm/s, ×100):
```
Q[ml/s] = 50 · A[cm²] · √ΔP     →     CQ = 50 · A_EOA[cm²]     (met discharge-coëff.: CQ = 50·C_d·EOA)
```
- De **50** = ½ (uit Bernoulli) × 100 (m/s→cm/s); de **4** in `4v²` = ½·ρ / 133,3 (ρ_bloed≈1060 kg/m³, Pa→mmHg).
- Zo koppel je `CQ` aan een **meetbare klepdiameter** i.p.v. aan de kunstmatige `r_for`.

Neonatale annulus­diameters (typische term-waarden — pas aan naar je eigen referentie/z-scores), `A = π·(d/2)²`, `C_d≈1`:

| Klep | name | d (mm) | A (cm²) | split | **CQ = 50·A** |
|---|---|---|---|---|---|
| aorta | `LV_AA` | 6,5 | 0,332 | 1 | **17** |
| pulmonalis | `RV_PA` | 8,0 | 0,503 | 1 | **25** |
| aorta (TGA) | `LV_PA` | 6,5 | 0,332 | 1 | **17** |
| pulm. (TGA) | `RV_AA` | 8,0 | 0,503 | 1 | **25** |
| mitralis | `LA_LV` | 11,0 | 0,950 | 1 | **48** |
| tricuspidalis | `RAIVCI_RV` | 12,0 | 1,131 | ÷2 | **28** |
| tricuspidalis | `RASVC_RV` | 12,0 | 1,131 | ÷2 | **28** |

- **Tricuspidalis**: één klep-orifice (d≈12 mm) verdeeld over de twee parallelle instroompaden → elk pad `50·A/2 ≈ 28` (samen = de volledige tricuspidalis). Dit vervangt de eerdere flow-match-aanname ("elk pad zijn eigen `r_for`").
- Een realistische `C_d` (~0,8) schaalt alle waarden ~20% omlaag; hanteer dat bij verder tunen.
- **Toegepast in `term_neonate_birgit.json` (2026-07-01)**: bovenstaande CQ-waarden (17 / 25 / 48 / 28). Startpunten — verfijn per klep tegen de lineaire baseline.

**Let op (welk JSON-bestand bewerken)**: `Model.load` haalt het scenario op via `/model_definitions/<name>.json` (`explain/Model.js:65`), en Quasar serveert dat vanaf `public/`. Bewerk dus **`public/model_definitions/term_neonate_birgit.json`** — dat is de bron én de enige plek waar dit scenario staat. `dist/model_definitions/` is build-output (gegenereerd door `quasar build`; bevat dit scenario niet eens) → niet handmatig bewerken, wordt bij een rebuild overschreven. Er is in deze repo géén aparte top-level `model_definitions/`-kopie om mee te synchroniseren.

## Bestanden
| Actie | Pad |
|------|-----|
| **Wijzig** (modus + dynamiek toevoegen) | `explain/component_models/HeartValve.js` |
| Wijzig (bestaand blok uitbreiden) | `src/model-interface/registry.ts` |
| **Wijzig** (dyn. blok op alle 7 kleppen; 2 tricuspid `Resistor`→`HeartValve`) | `public/model_definitions/term_neonate_birgit.json` |
| Referentie / A/B-baseline (niet wijzigen) | `public/model_definitions/term_neonate.json` |
| Referentie (niet wijzigen) | `explain/base_models/Resistor.js`, `BaseModelClass.js`, `Heart.js`, `ModelIndex.js` (export staat er al) |

## Verificatie (engine draait niet vanuit deze map)
- **Regressie (belangrijkst)**: met het dynamische blok voorgevuld maar `enable_dynamics:false` overal, moet `term_neonate_birgit` *identiek* draaien (de override delegeert naar `super.calc_model()`; extra JSON-keys zijn ongebruikte props). Dit dekt óók de tricuspid-conversie: `RAIVCI_RV`/`RASVC_RV` als `HeartValve` in lineaire modus moeten exact dezelfde flow geven als de oude `Resistor`. Vergelijk een paar steps output vóór/na.
- **Statisch**: nieuwe veldnamen consistent tussen `HeartValve`-klasse, registry-blok en JSON; `enable_dynamics` aanwezig op de entries die dynamisch moeten. Geen ModelIndex-check nodig (`HeartValve` al geëxporteerd).
- **Geïsoleerde wiskunde-check** (los node-snippet, niet committen): voer sinusvormige ΔP door het dynamische pad → θ blijft in [θ_min,θ_max], geen NaN/Inf, `dtheta` divergeert niet bij `n_substeps=5`.
- **In host-app — beide modi naast elkaar**:
  - Zet `enable_dynamics:true` op de kleppen in `term_neonate_birgit`; vergelijk met de ongewijzigde `term_neonate`-baseline: CO en LV/AA-drukken in dezelfde range na CQ-tuning.
  - Kwalitatief vs paper: three-stage leaflet-beweging (`theta`-t), dicrotic notch in AA-druk, reverse-flow piek bij sluiting (kort negatieve `flow`), stenose (`theta_max`↓ → gradiënt↑), regurgitatie (`theta_min`↑ → aanhoudend negatieve diastolische flow).
  - **Per-klep**: zet `enable_dynamics:true` op één klep en de rest `false` → bevestig dat alleen die klep dynamisch gedrag toont.

## Belangrijkste risico's
1. **Numerieke stijfheid** op 0.0005 s — Euler kan oscilleren; mitigatie `n_substeps`, eventueel semi-impliciete dempterm (`−K_f·dθ/dt`).
2. **Unit-conversie** in CQ en Q-gekoppelde K_b/K_v — mitigatie: ODE in native units, alleen Q→L/s converteren.
3. **Hertuning circuit** — √-wet verandert hemodynamiek; CQ per klep voor de neonaat fitten zodat klepflow de CO van de lineaire baseline benadert. Geen drop-in.
4. **Hoeken direct bewerkbaar (geen factor-laag)**: θ_max/θ_min zijn geometrische hoeken die niet allometrisch hoeven te schalen; direct tweenen is intuïtiever én lost het "baseline 0 niet optilbaar via factor"-probleem op. Alleen CQ houdt zijn factor-laag als scaling-aangrijpingspunt.
5. **Per-substep ΔP constant** is benadering t.o.v. de monolithische solver van de paper; acceptabel, documenteren.
6. **Gedeelde klasse**: alle `HeartValve`-instances draaien nu de `enable_dynamics`-check. Bij `false` is dat één if + `super.calc_model()` → verwaarloosbaar, maar dek het af met de regressietest hierboven zodat bestaande scenario's gegarandeerd ongewijzigd blijven.
