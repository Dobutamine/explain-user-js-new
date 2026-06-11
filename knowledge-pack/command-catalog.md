# Explain — command catalog (bot-facing)

This is the **exhaustive** list of model actions you may currently propose. It is
generated from the webapp's allowlist + parameter schema, so anything NOT listed here
will be **rejected** by the app — do not invent commands, models, properties, or
arguments outside this catalog.

See `command-protocol.md` for HOW to emit a command (the fenced-block format and the
rules on when to do so). This file is just the vocabulary.

Values are in the **clinical/display unit shown** for each field (the app converts to
engine-internal units itself). Stay within the stated range.

**Enabled commands: 26.** Snapshot — regenerate with
`node scripts/build_command_catalog.mjs` after the allowlist changes.

---
### `call` Ventilator.switch_ventilator() — switch ventilator on/off

- arguments (in order):
  - `is_enabled` — state (type boolean)

```json
{"op":"call","model":"Ventilator","target":"switch_ventilator","args":[true],"reason":"turn mechanical ventilation on/off (arg: boolean)"}
```

### `call` Ventilator.set_fio2() — fio2

- arguments (in order):
  - `fio2` — new fio2 (type number, range min 0.21, max 1)

```json
{"op":"call","model":"Ventilator","target":"set_fio2","args":[0.21],"reason":"set inspired O2 fraction (0.21–1.0)"}
```

### `call` Ventilator.set_ettube_diameter() — endotracheal tube diameter (mm)

- arguments (in order):
  - `ettube_diameter` — new diameter (mm) (type number, unit mm)

```json
{"op":"call","model":"Ventilator","target":"set_ettube_diameter","args":[0],"reason":"set endotracheal tube diameter (mm)"}
```

### `call` Ventilator.set_ettube_length() — endotracheal tube length (mm)

- arguments (in order):
  - `ettube_length` — new length (mm) (type number, unit mm)

```json
{"op":"call","model":"Ventilator","target":"set_ettube_length","args":[0],"reason":"set endotracheal tube length (mm)"}
```

### `setProp` Ventilator.vent_mode — ventilator mode

- type: list · choices: PC, PRVC, PS
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"vent_mode","value":"PC","reason":"ventilation mode (PC/PRVC/PS)"}
```

### `setProp` Ventilator.vent_rate — ventilator rate (/min)

- type: number · unit: /min · range: min 0, max 100
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"vent_rate","value":0,"reason":"ventilator rate (/min)"}
```

### `setProp` Ventilator.insp_time — inspiration time (s)

- type: number · unit: s · range: min 0.1, max 5
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"insp_time","value":0.1,"reason":"inspiration time (s)"}
```

### `setProp` Ventilator.tidal_volume — tidal volume (mL)

- type: number · unit: mL · range: min 1, max 500
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"tidal_volume","value":1,"reason":"target tidal volume (mL)"}
```

### `setProp` Ventilator.pip_cmh2o — peak inspiratory pressure (cmH2O)

- type: number · unit: cmH2O · range: min 5, max 50
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"pip_cmh2o","value":5,"reason":"peak inspiratory pressure (cmH2O)"}
```

### `setProp` Ventilator.pip_cmh2o_max — max peak inspiratory pressure (cmH2O)

- type: number · unit: cmH2O · range: min 5, max 50
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"pip_cmh2o_max","value":5,"reason":"max peak inspiratory pressure, PRVC (cmH2O)"}
```

### `setProp` Ventilator.peep_cmh2o — positive end expiratory pressure (cmH2O)

- type: number · unit: cmH2O · range: min 0, max 20
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ventilator","target":"peep_cmh2o","value":0,"reason":"positive end-expiratory pressure (cmH2O)"}
```

### `setProp` Heart.heart_rate_ref — reference heart rate (bpm)

- type: number · unit: bpm · range: min 10, max 300
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Heart","target":"heart_rate_ref","value":10,"reason":"reference heart rate (bpm)"}
```

### `setProp` Heart.ans_sens — ans sensitivity

- type: number · range: min 0, max 1
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Heart","target":"ans_sens","value":0,"reason":"autonomic sensitivity of the heart (0–1)"}
```

### `setProp` Ans.ans_active — ANS active

- type: boolean
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Ans","target":"ans_active","value":true,"reason":"autonomic nervous system on/off"}
```

### `setProp` Breathing.breathing_enabled — spont breathing enabled

- type: boolean
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Breathing","target":"breathing_enabled","value":true,"reason":"spontaneous breathing on/off"}
```

### `setProp` Breathing.minute_volume_ref — reference minute volume (L/kg/min)

- type: number · unit: L/kg/min
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Breathing","target":"minute_volume_ref","value":0,"reason":"reference minute volume (L/kg/min)"}
```

### `setProp` Metabolism.met_active — metabolism enabled

- type: boolean
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Metabolism","target":"met_active","value":true,"reason":"metabolism on/off"}
```

### `setProp` Metabolism.vo2 — vo2 (ml/kg/min)

- type: number · unit: ml/kg/min
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Metabolism","target":"vo2","value":0,"reason":"oxygen consumption VO2 (mL/kg/min)"}
```

### `call` Drugs.administer_bolus() — administer IV bolus

- arguments (in order):
  - `drug` — drug (type list, choices adrenaline, noradrenaline)
  - `dose` — dose (mcg) (type number, unit mcg, range min 0, max 1000)

```json
{"op":"call","model":"Drugs","target":"administer_bolus","args":["adrenaline",0],"reason":"IV bolus (args: drug name, dose in mcg 0–1000)"}
```

### `call` Drugs.set_infusion() — set infusion

- arguments (in order):
  - `drug` — drug (type list, choices adrenaline, noradrenaline)
  - `rate` — rate (mcg/kg/min) (type number, unit mcg/kg/min, range min 0, max 100)

```json
{"op":"call","model":"Drugs","target":"set_infusion","args":["adrenaline",0],"reason":"continuous infusion (args: drug name, rate mcg/kg/min)"}
```

### `setProp` Drugs.drugs_running — drugs running

- type: boolean
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Drugs","target":"drugs_running","value":true,"reason":"drug engine on/off"}
```

### `call` Resuscitation.switch_cpr() — switch cpr on/off

- arguments (in order):
  - `cpr_enabled` — state (type boolean)

```json
{"op":"call","model":"Resuscitation","target":"switch_cpr","args":[true],"reason":"start/stop CPR (arg: boolean)"}
```

### `call` Resuscitation.set_fio2() — set cpr fio2

- arguments (in order):
  - `vent_fio2` — new fio2 (type number, range min 0, max 1)

```json
{"op":"call","model":"Resuscitation","target":"set_fio2","args":[0],"reason":"set CPR ventilation FiO2 (0–1)"}
```

### `setProp` Resuscitation.chest_comp_freq — chest compressions frequency (/min)

- type: number · unit: /min · range: min 10, max 150
- `value` is in the unit shown above (the same number a clinician reads in the UI).

```json
{"op":"setProp","model":"Resuscitation","target":"chest_comp_freq","value":10,"reason":"chest compression frequency (/min)"}
```

### `start` — start the realtime simulation loop

```json
{"op":"start","reason":"start the realtime simulation loop"}
```

### `stop` — stop the realtime simulation loop

```json
{"op":"stop","reason":"stop the realtime simulation loop"}
```
