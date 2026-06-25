import { Resistor } from "../base_models/Resistor";

export class HeartValve extends Resistor {
  // static properties
  static model_type = "HeartValve";

  constructor(model_ref, name = "") {
    // call the constructor of the parent class (Resistor)
    super(model_ref, name);

    // ----- dynamic valve model (Korakianitis & Shi 2006) -----
    // mode switch: when false (default) this model behaves exactly like the
    // linear Resistor it inherits from; when true the dynamic leaflet model runs.
    this.enable_dynamics = false;

    // orifice flow coefficient CQ (ml/(s*sqrt(mmHg))) - paper units
    this.cq = 350.0;

    // leaflet motion coefficients (K = k/I in the paper), paper units
    this.kp = 5500.0; // pressure effect (rad/(s^2*mmHg))
    this.kf = 50.0; // frictional effect (1/s)
    this.kb = 2.0; // blood-motion / velocity effect
    this.kv = 3.5; // vortex effect

    // leaflet opening limits, in DEGREES (so they can be filled in directly in
    // the UI and the model definition JSON). Converted to radians inside calc_model.
    this.theta_max = 75.0; // fully open angle (degrees)
    this.theta_min = 5.0; // fully closed angle (degrees); raise for regurgitation

    // number of internal integration sub-steps per model step. The leaflet ODE is
    // stiff (kp ~ 5500) relative to the engine stepsize, so we sub-step for stability.
    this.n_substeps = 5;

    // CQ factor layers (only CQ uses the factor/effective-value pattern; the
    // geometric angles are edited/tweened directly, see theta_max/theta_min).
    this.cq_factor = 1.0; // non-persistent (resets every step)
    this.cq_factor_ps = 1.0; // persistent
    this.cq_factor_scaling_ps = 1.0; // persistent scaling (ModelScaler)

    // dynamic state (radians)
    this.theta = 0.0; // leaflet angle theta(t) (rad)
    this.dtheta = 0.0; // leaflet angular velocity dtheta/dt (rad/s)

    // dependent output
    this.ar = 0.0; // opening area ratio (0 = closed, 1 = fully open)

    // local variables
    this.cq_eff = 0.0; // calculated effective flow coefficient
  }

  // overrides Resistor.calc_model: branch between the linear and dynamic model
  calc_model() {
    // linear mode -> run the unchanged Resistor behaviour and return
    if (!this.enable_dynamics) {
      super.calc_model();
      return;
    }

    // ----- dynamic Korakianitis & Shi valve model -----

    // find the up- and downstream components and store the references
    this._comp_from = this._model_engine.models[this.comp_from];
    this._comp_to = this._model_engine.models[this.comp_to];

    // effective flow coefficient (factor/effective-value pattern, CQ only)
    this.cq_eff =
      this.cq +
      (this.cq_factor - 1) * this.cq +
      (this.cq_factor_ps - 1) * this.cq +
      (this.cq_factor_scaling_ps - 1) * this.cq;

    // reset the non-persistent factor
    this.cq_factor = 1.0;

    // convert the configured leaflet limits from degrees to radians (cos/sin use radians)
    const theta_max_rad = (this.theta_max * Math.PI) / 180.0;
    const theta_min_rad = (this.theta_min * Math.PI) / 180.0;

    // get the pressures of the connected compartments incl. the external pressures
    const p_up = this._comp_from.pres + this.p1_ext;
    const p_down = this._comp_to.pres + this.p2_ext;

    // reset the external pressures
    this.p1_ext = 0.0;
    this.p2_ext = 0.0;

    // reset the current flow
    this.flow = 0.0;

    // return if no flow is allowed across this valve
    if (this.no_flow) {
      this._prev_flow = 0.0;
      return;
    }

    const dp = p_up - p_down;
    const sign = dp >= 0.0 ? 1.0 : -1.0;
    const abs_dp = Math.abs(dp);

    // sub-step the leaflet ODE; the pressure difference is held constant across
    // the sub-steps of one engine step and the flow is accumulated.
    const n = this.n_substeps > 0 ? this.n_substeps : 1;
    const dt = this._t / n;
    let q_accum = 0.0; // accumulated orifice flow in ml/s (paper units)

    const denom = Math.pow(1.0 - Math.cos(theta_max_rad), 2);

    for (let i = 0; i < n; i++) {
      const cos_t = Math.cos(this.theta);

      // opening area ratio (Eq. 8)
      this.ar = Math.pow(1.0 - cos_t, 2) / denom;

      // orifice flow (Eq. 6) in ml/s; sign follows the pressure gradient
      const q = sign * this.cq_eff * this.ar * Math.sqrt(abs_dp);

      // leaflet angular acceleration (Eq. 14); vortex term only for forward flow
      let d2 = this.kp * dp * cos_t - this.kf * this.dtheta + this.kb * q * cos_t;
      if (q >= 0.0) {
        d2 -= this.kv * q * Math.sin(2.0 * this.theta);
      }

      // semi-implicit (symplectic) Euler integration
      this.dtheta += d2 * dt;
      this.theta += this.dtheta * dt;

      // clamp the leaflet angle to [theta_min, theta_max] and rest against the stop
      if (this.theta > theta_max_rad) {
        this.theta = theta_max_rad;
        if (this.dtheta > 0.0) this.dtheta = 0.0;
      } else if (this.theta < theta_min_rad) {
        this.theta = theta_min_rad;
        if (this.dtheta < 0.0) this.dtheta = 0.0;
      }

      q_accum += q;
    }

    // mean flow over the engine step, converted from ml/s to L/s (engine units)
    this.flow = q_accum / n / 1000.0;

    // move the volume using the inherited volume_out/volume_in handshake, taking
    // care not to remove volume that the source compartment cannot supply
    if (this.flow >= 0.0) {
      const vol_not_removed = this._comp_from.volume_out(this.flow * this._t);
      this._comp_to.volume_in(this.flow * this._t - vol_not_removed, this._comp_from);
    } else {
      const vol_not_removed = this._comp_to.volume_out(-this.flow * this._t);
      this._comp_from.volume_in(-this.flow * this._t - vol_not_removed, this._comp_to);
    }

    // store the previous flow (used for consistency with the linear path)
    this._prev_flow = this.flow;
  }
}
