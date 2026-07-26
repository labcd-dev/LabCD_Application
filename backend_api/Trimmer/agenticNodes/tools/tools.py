"""
Specialized tools for system trimming workflow:
- solve_equilibrium: numerical optimization for equilibrium points
- compute_jacobian: linearization via numerical differentiation
- analyze_stability: eigenvalue-based stability analysis
- validate_constraints: constraint satisfaction checking
"""

import numpy as np
from scipy.optimize import (
    minimize, minimize_scalar, basinhopping, brute, differential_evolution,
    shgo, dual_annealing, direct, least_squares, root_scalar, brentq, brenth,
    ridder, bisect, newton, toms748, root, fsolve, fixed_point, broyden1, broyden2
)
from scipy.linalg import eigvals
import warnings


def recursive_flatten(obj):
    """Recursively flatten nested lists/arrays into a single list."""
    if isinstance(obj, (list, tuple, np.ndarray)):
        flat = []
        for item in obj:
            flat.extend(recursive_flatten(item))
        return flat
    else:
        return [obj]

def solve_equilibrium(system_f, initial_guess, params, n_x, n_u, strategy, bounds,
                      tolerance=1e-10, operating_conditions=None, state_vars=None,
                      penalty_factor=100.0):
    """
    Tool: Find equilibrium point where f(x_e, u_e) = 0, optionally penalizing deviations from desired states.

    Args:
        system_f: dynamics function f(x, u, params)
        initial_guess: np.array of shape (n_x + n_u,)
        params: dict of system parameters
        n_x: number of states
        n_u: number of inputs
        strategy: 'minimize' or 'least_squares' or 'fsolve'
        bounds: dict with x_min, x_max, u_min, u_max
        tolerance: convergence tolerance
        operating_conditions: optional dict to specify desired states
        penalty_factor: weight for penalizing deviations from desired_x

    Returns:
        x_e, u_e: equilibrium state and input
        converged: bool
        cost: final optimization cost
        trace_entry: dict for logging
    """
    # Validate that system_f is callable
    if not callable(system_f):
        raise ValueError(f"system_f must be callable, got {type(system_f)}")

    # Sanitize params to ensure no None values that could cause TypeError in system_f
    defaults = {
        'm': 1.0, 'g': 9.81, 'rho': 1.225, 'Cd_u': 0.1, 'Cd_w': 0.1,
        'A_u': 1.0, 'A_w': 1.0, 'Iy': 1.0
    }
    for key in params:
        if params[key] is None or (isinstance(params[key], (int, float)) and params[key] == 0.0):
            params[key] = defaults.get(key, 0.0)
    
    # Check if operating conditions violate bounds immediately
    if operating_conditions and bounds and state_vars:
        x_min = bounds.get('x_min')
        x_max = bounds.get('x_max')
        for op_name, op_val in operating_conditions.items():
            # Find index of the variable in state_vars
            idx = state_vars.index(op_name) if op_name in state_vars else -1
            
            if idx != -1:
                try:
                    val = float(op_val)
                    if x_min and idx < len(x_min) and x_min[idx] is not None and val < x_min[idx]:
                        print(f"  ⚠ Warning: Operating condition '{op_name}'={val} is below lower bound {x_min[idx]}. Solver may fail.")
                    if x_max and idx < len(x_max) and x_max[idx] is not None and val > x_max[idx]:
                        print(f"  ⚠ Warning: Operating condition '{op_name}'={val} is above upper bound {x_max[idx]}. Solver may fail.")
                except (ValueError, TypeError):
                    pass

    # ------------------------------------------------------------------
    # Normalize bounds entries so they have correct lengths (n_x and n_u).
    # Accept scalars, single-item lists, or lists shorter/longer than required.
    # Pad with the last value when shorter, or truncate when longer.
    # ------------------------------------------------------------------
    if bounds is None:
        bounds = {}

    def _normalize_bound_entry(entry, length, name):
        if entry is None:
            return None
        arr = np.asarray(entry)
        # Scalar -> repeat
        if arr.ndim == 0:
            return np.full(length, float(arr))
        # 1D array
        flat = arr.flatten()
        if flat.size == length:
            return flat.astype(float)
        if flat.size == 1:
            return np.full(length, float(flat[0]))
        if flat.size < length:
            # pad with last value
            pad = np.full(length - flat.size, float(flat[-1]))
            return np.concatenate([flat.astype(float), pad])
        # larger -> truncate
        return flat[:length].astype(float)

    try:
        x_min = _normalize_bound_entry(bounds.get('x_min'), n_x, 'x_min')
        x_max = _normalize_bound_entry(bounds.get('x_max'), n_x, 'x_max')
        u_min = _normalize_bound_entry(bounds.get('u_min'), n_u, 'u_min')
        u_max = _normalize_bound_entry(bounds.get('u_max'), n_u, 'u_max')
    except Exception:
        # On any failure, fall back to None to allow solvers to proceed with no bounds
        x_min = x_max = u_min = u_max = None

    # Update bounds dict with normalized arrays (or None)
    bounds = bounds or {}
    if x_min is not None: bounds['x_min'] = x_min
    if x_max is not None: bounds['x_max'] = x_max
    if u_min is not None: bounds['u_min'] = u_min
    if u_max is not None: bounds['u_max'] = u_max

    # Ensure default wide bounds exist for solvers that require bounds
    # (match behavior in base_code: set large default ranges when missing)
    if bounds.get('x_min') is None:
        bounds['x_min'] = [-1e8] * n_x
    if bounds.get('x_max') is None:
        bounds['x_max'] = [1e8] * n_x
    if bounds.get('u_min') is None:
        bounds['u_min'] = [-1e8] * n_u
    if bounds.get('u_max') is None:
        bounds['u_max'] = [1e8] * n_u

    # Convert scalar bounds to lists if necessary (also handle numpy arrays)
    if isinstance(bounds.get('x_min'), (int, float)):
        bounds['x_min'] = [float(bounds['x_min'])] * n_x
    if isinstance(bounds.get('x_max'), (int, float)):
        bounds['x_max'] = [float(bounds['x_max'])] * n_x
    if isinstance(bounds.get('u_min'), (int, float)):
        bounds['u_min'] = [float(bounds['u_min'])] * n_u
    if isinstance(bounds.get('u_max'), (int, float)):
        bounds['u_max'] = [float(bounds['u_max'])] * n_u

    # Enforce strict inequality for solver bounds: lb < ub. If equality or lb>ub
    # occurs, adjust upper bound slightly to ensure feasibility.
    try:
        x_min_arr = np.array(bounds['x_min'], dtype=float)
        x_max_arr = np.array(bounds['x_max'], dtype=float)
        u_min_arr = np.array(bounds['u_min'], dtype=float)
        u_max_arr = np.array(bounds['u_max'], dtype=float)

        eps = 1e-8
        # Ensure same lengths
        if x_min_arr.size != n_x:
            x_min_arr = np.resize(x_min_arr, n_x)
        if x_max_arr.size != n_x:
            x_max_arr = np.resize(x_max_arr, n_x)
        if u_min_arr.size != n_u:
            u_min_arr = np.resize(u_min_arr, n_u)
        if u_max_arr.size != n_u:
            u_max_arr = np.resize(u_max_arr, n_u)

        # Fix cases where lower >= upper
        x_max_arr = np.maximum(x_max_arr, x_min_arr + eps)
        u_max_arr = np.maximum(u_max_arr, u_min_arr + eps)

        bounds['x_min'] = x_min_arr.tolist()
        bounds['x_max'] = x_max_arr.tolist()
        bounds['u_min'] = u_min_arr.tolist()
        bounds['u_max'] = u_max_arr.tolist()
    except Exception:
        # If anything goes wrong, leave bounds as-is and let downstream logic handle it
        pass

    # Normalize strategy if provided as dict: {'method': 'least_squares', 'options': {...}}
    strategy_options = {}
    if isinstance(strategy, dict):
        strategy_options = strategy.get('options', {}) or {}
        method = strategy.get('method') or strategy.get('name') or strategy.get('strategy')
        if method:
            strategy = method

    # Ensure initial_guess is a numpy array
    initial_guess = np.array(initial_guess)
    if initial_guess.shape[0] != n_x + n_u:
        raise ValueError(f"initial_guess length {initial_guess.shape[0]} does not match n_x + n_u = {n_x + n_u}")

    # For trimming, translational position states (e.g., X/Y/Z) are typically
    # arbitrary and their derivatives need not be zero at steady motion.
    translational_position_names = {
        "x", "y", "z",
        "xpos", "ypos", "zpos",
        "x_pos", "y_pos", "z_pos",
        "posx", "posy", "posz",
        "position_x", "position_y", "position_z",
        "north", "east", "down", "n", "e", "d"
    }
    residual_state_mask = np.ones(n_x, dtype=bool)
    if state_vars is not None:
        for i in range(min(len(state_vars), n_x)):
            name = str(state_vars[i]).strip().lower()
            if name in translational_position_names:
                residual_state_mask[i] = False
    if not np.any(residual_state_mask):
        residual_state_mask[:] = True
    residual_state_indices = np.where(residual_state_mask)[0]
    n_eq = len(residual_state_indices)

    def eq_func(z):
        """Equilibrium condition: f(x, u) = 0"""
        try:
            x = np.asarray(z[:n_x], dtype=np.float64)
            u = np.asarray(z[n_x:], dtype=np.float64)

            # Call system_f with proper arrays
            f_val = system_f(x, u, params)

            # Ensure f_val is a 1D array of scalars
            if f_val is None:
                raise ValueError("system_f returned None")

            # Recursively flatten f_val to handle nested structures

            f_val_flat = recursive_flatten(f_val)
            f_val = np.array(f_val_flat, dtype=np.float64)

            if len(f_val) != n_x:
                if len(f_val) == n_x * n_x:
                    raise ValueError(f"system_f returned array with length {len(f_val)} (n_x^2), expected {n_x}. "
                                     f"This often indicates a broadcasting error (e.g. adding (n,) and (n,1) arrays). Check system_f code.")
                raise ValueError(f"system_f returned array with length {len(f_val)}, expected {n_x}. Shape: {f_val.shape}")

            return f_val[residual_state_indices]
        except Exception as e:
            raise RuntimeError(f"Error in eq_func: {e}. z={z}, n_x={n_x}, n_u={n_u}") from e

    # ------------------------------------------------------------------
    # Map operating_conditions -> desired values for a SUBSET of states.
    #
    # Example:
    #   state_vars = ["v", "q", "h", "k"]
    #   operating_conditions = {"v": 100.0, "h": 1000.0}
    # Then v and h should be treated as "fixed"/desired; q and k remain free.
    #
    # We build:
    #   desired_x_vec[i] = desired value for state i if constrained, else NaN
    # and use only those indices in the penalty terms.
    # ------------------------------------------------------------------
    desired_x_vec = None
    desired_mask = None

    if operating_conditions is not None and isinstance(operating_conditions, dict) and state_vars is not None:
        desired_x_vec = np.full(n_x, np.nan, dtype=float)

        for op_name, op_val in operating_conditions.items():
            # Try to match operating-condition name to a state variable.
            # We support exact match ("v") and common suffix patterns ("v_desired", "v_trim").
            candidate_names = [op_name]
            suffixes = ["_desired", "_des", "_trim", "_target", "_ref"]
            for sfx in suffixes:
                if op_name.endswith(sfx):
                    candidate_names.append(op_name[: -len(sfx)])

            matched_index = None
            for cand in candidate_names:
                if cand in state_vars:
                    matched_index = state_vars.index(cand)
                    break

            if matched_index is not None and 0 <= matched_index < n_x:
                try:
                    desired_x_vec[matched_index] = float(op_val)
                except (TypeError, ValueError):
                    # If it cannot be converted to float, skip this condition
                    continue

        # Build mask of constrained states (those with a finite desired value)
        desired_mask = np.isfinite(desired_x_vec)
        if not np.any(desired_mask):
            # No valid mapping found -> no state penalties
            desired_x_vec = None
            desired_mask = None

    # ------------------------------------------------------------------
    # Handle constrained states: if any states are fixed via operating_conditions,
    # modify the problem to solve only for free variables.
    # ------------------------------------------------------------------
    if desired_mask is not None and np.any(desired_mask):
        # Identify free state indices
        free_state_indices = [i for i in range(n_x) if not desired_mask[i]]
        # Assume inputs are free (could extend to fix inputs if needed)
        free_input_indices = list(range(n_u))
        n_free = len(free_state_indices) + len(free_input_indices)

        # Adjust initial_guess to only free variables
        free_initial_guess = np.concatenate([
            initial_guess[free_state_indices],
            initial_guess[n_x + np.array(free_input_indices)]
        ])

        # Adjust bounds for free variables
        free_bounds = None
        if bounds.get('x_min') is not None and bounds.get('x_max') is not None and bounds.get('u_min') is not None and bounds.get('u_max') is not None:
            x_min_free = np.array(bounds['x_min'])[free_state_indices]
            x_max_free = np.array(bounds['x_max'])[free_state_indices]
            u_min_free = np.array(bounds['u_min'])[free_input_indices]
            u_max_free = np.array(bounds['u_max'])[free_input_indices]
            free_bounds = [(x_min_free[i], x_max_free[i]) for i in range(len(free_state_indices))] + \
                          [(u_min_free[j], u_max_free[j]) for j in range(len(free_input_indices))]
        else:
            free_bounds = None

        # Define eq_func for free variables
        def eq_func_free(z):
            try:
                free_x = z[:len(free_state_indices)]
                free_u = z[len(free_state_indices):]
                
                # Construct x array with proper float conversion
                x = np.zeros(n_x, dtype=np.float64)
                for idx, val in zip(free_state_indices, free_x):
                    x[idx] = float(val)  # Ensure scalar float
                for idx in range(n_x):
                    if desired_mask[idx]:
                        x[idx] = float(desired_x_vec[idx])  # Ensure scalar float
                
                # Construct u array with proper float conversion
                u = np.asarray(free_u, dtype=np.float64)
                
                # Call system_f with proper arrays
                f_val = system_f(x, u, params)

                # Ensure f_val is a 1D array of scalars
                if f_val is None:
                    raise ValueError("system_f returned None")

                # Recursively flatten f_val to handle nested structures

                f_val_flat = recursive_flatten(f_val)
                f_val = np.array(f_val_flat, dtype=np.float64)

                if len(f_val) != n_x:
                    if len(f_val) == n_x * n_x:
                        raise ValueError(f"system_f returned array with length {len(f_val)} (n_x^2), expected {n_x}. "
                                         f"This often indicates a broadcasting error (e.g. adding (n,) and (n,1) arrays). Check system_f code.")
                    raise ValueError(f"system_f returned array with length {len(f_val)}, expected {n_x}. Shape: {f_val.shape}")

                return f_val[residual_state_indices]
            except Exception as e:
                raise RuntimeError(f"Error in eq_func_free: {e}. z={z}") from e

        # For penalty-based methods, augment residuals with constraint penalties
        def augmented_eq_func_free(z):
            f_val = eq_func_free(z)
            if desired_x_vec is not None and desired_mask is not None:
                # Add penalty terms for constrained states to help solver
                free_x = z[:len(free_state_indices)]
                free_u = z[len(free_state_indices):]
                x = np.full(n_x, np.nan)
                for idx, val in zip(free_state_indices, free_x):
                    x[idx] = val
                for idx in range(n_x):
                    if desired_mask[idx]:
                        x[idx] = desired_x_vec[idx]
                
                # Add penalty residuals for constraint violations
                diff = x[desired_mask] - desired_x_vec[desired_mask]
                penalty_residuals = np.sqrt(penalty_factor) * diff
                # Return concatenated residuals
                return np.concatenate([f_val, penalty_residuals])
            return f_val

        # Define cost_func for free variables
        def cost_func_free(z):
            try:
                f_val = eq_func_free(z)
                cost = np.sum(f_val**2)
                return cost
            except Exception as e:
                return np.inf

        # Define Jacobian for cost function
        def cost_jac_free(z):
            try:
                f_val = eq_func_free(z)
                # Numerical Jacobian
                eps = 1e-7
                n_z = len(z)
                J = np.zeros((len(f_val), n_z))
                for j in range(n_z):
                    z_pert = z.copy()
                    z_pert[j] += eps
                    f_pert = eq_func_free(z_pert)
                    J[:, j] = (f_pert - f_val) / eps
                jac = 2 * f_val @ J
                return jac
            except Exception as e:
                return np.zeros_like(z)

    else:
        # No constraints: use original approach
        free_state_indices = list(range(n_x))
        free_input_indices = list(range(n_u))
        n_free = n_x + n_u
        free_initial_guess = initial_guess
        free_bounds = None  # Will set below
        eq_func_free = eq_func
        augmented_eq_func_free = None
        cost_func_free = None
        cost_jac_free = None

    # Define counts for free variables (used in constrained strategies)
    num_free_states = len(free_state_indices)
    num_free_inputs = len(free_input_indices)

    # Set up bounds for optimization
    if bounds.get('x_min') is not None and bounds.get('x_max') is not None and bounds.get('u_min') is not None and bounds.get('u_max') is not None:
        x_min, x_max = np.array(bounds['x_min']), np.array(bounds['x_max'])
        u_min, u_max = np.array(bounds['u_min']), np.array(bounds['u_max'])
        opt_bounds = [(x_min[i], x_max[i]) for i in range(n_x)] + \
                     [(u_min[j], u_max[j]) for j in range(n_u)]
    else:
        opt_bounds = None
        x_min = x_max = u_min = u_max = None
    
    # Define Jacobian function for analytical gradients
    def jac_func(z):
        """Numerical Jacobian of eq_func for better optimization performance."""
        eps = 1e-7
        f0 = eq_func(z)
        n_f = len(f0)
        n_z = len(z)
        J = np.zeros((n_f, n_z))
        for j in range(n_z):
            z_pert = z.copy()
            z_pert[j] += eps
            f_pert = eq_func(z_pert)
            J[:, j] = (f_pert - f0) / eps
        return J

    try:
        # Define cost function for minimization strategies
        def cost_func(z):
            f_val = eq_func(z)
            cost = np.sum(f_val**2)
            if desired_x_vec is not None and desired_mask is not None:
                x = z[:n_x]
                diff = x[desired_mask] - desired_x_vec[desired_mask]
                cost += penalty_factor * np.sum(diff**2)
            return cost

        # Define Jacobian for cost function
        def cost_jac(z):
            f_val = eq_func(z)
            J = jac_func(z)
            jac = 2 * f_val @ J
            if desired_x_vec is not None and desired_mask is not None:
                x = z[:n_x]
                penalty_grad = np.zeros_like(z)
                for i in range(n_x):
                    if desired_mask[i]:
                        penalty_grad[i] = 2 * penalty_factor * (x[i] - desired_x_vec[i])
                jac += penalty_grad
            return jac

        if strategy == 'minimize':
            if desired_mask is not None and np.any(desired_mask):
                # Substitution method for constrained problems
                target_func = cost_func_free
                guess = free_initial_guess
                jac = cost_jac_free
                bounds_to_use = free_bounds

                with warnings.catch_warnings():
                    warnings.simplefilter("default")
                    res = minimize(target_func, guess, method='L-BFGS-B',
                                 jac=jac, bounds=bounds_to_use, options={'ftol': tolerance})

                # Reconstruct full solution from free variables
                full_sol = np.full(n_x + n_u, np.nan)
                if np.any(desired_mask):
                    full_sol[:n_x][desired_mask] = desired_x_vec[desired_mask]
                if num_free_states > 0:
                    full_sol[:n_x][free_state_indices] = res.x[:num_free_states]
                if len(res.x) > num_free_states:
                    full_sol[n_x:] = res.x[num_free_states:]

                x_e, u_e = full_sol[:n_x], full_sol[n_x:]
                cost = res.fun
                converged = res.success and cost < tolerance
                message = res.message

            else:
                # Original method for unconstrained problems
                with warnings.catch_warnings():
                    warnings.simplefilter("default")
                    res = minimize(cost_func, initial_guess, method='L-BFGS-B',
                                 jac=cost_jac, bounds=opt_bounds, options={'ftol': tolerance})

                x_e, u_e = res.x[:n_x], res.x[n_x:]
                cost = res.fun
                converged = res.success and cost < tolerance
                message = res.message

        elif strategy == 'minimize_scalar':
            # For 1D problems only
            if len(initial_guess) != 1:
                raise ValueError("minimize_scalar is for 1D problems only")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = minimize_scalar(cost_func, bounds=opt_bounds[0] if opt_bounds else None, options={'xtol': tolerance})

            x_e = np.array([res.x]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res.x]) if n_u == 1 else np.full(n_u, np.nan)
            cost = res.fun
            converged = res.success and cost < tolerance
            message = "Converged" if converged else "Not converged"

        elif strategy == 'basinhopping':
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = basinhopping(cost_func, initial_guess, minimizer_kwargs={'method': 'L-BFGS-B', 'bounds': opt_bounds, 'options': {'ftol': tolerance}})

            x_e, u_e = res.x[:n_x], res.x[n_x:]
            cost = res.fun
            converged = cost < tolerance
            message = "Global minimum found" if converged else "Global minimum not found"

        elif strategy == 'brute':
            # Brute force grid search - requires ranges
            if opt_bounds is None:
                raise ValueError("brute requires bounds")
            ranges = tuple((b[0], b[1], 10) for b in opt_bounds)  # 10 points per dimension
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = brute(cost_func, ranges)

            x_e, u_e = res[:n_x], res[n_x:]
            cost = cost_func(res)
            converged = cost < tolerance
            message = "Grid search completed"

        elif strategy == 'differential_evolution':
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                if opt_bounds is not None:
                    bounds_de = [(b[0], b[1]) for b in opt_bounds]
                    res = differential_evolution(cost_func, bounds_de, tol=tolerance)
                else:
                    raise ValueError("differential_evolution requires bounds")

            x_e, u_e = res.x[:n_x], res.x[n_x:]
            cost = res.fun
            converged = res.success and cost < tolerance
            message = res.message

        elif strategy == 'shgo':
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                if opt_bounds is not None:
                    bounds_shgo = [(b[0], b[1]) for b in opt_bounds]
                    res = shgo(cost_func, bounds_shgo, options={'ftol': tolerance})
                else:
                    raise ValueError("shgo requires bounds")

            x_e, u_e = res.x[:n_x], res.x[n_x:]
            cost = res.fun
            converged = res.success and cost < tolerance
            message = "SHGO completed"

        elif strategy == 'dual_annealing':
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                if opt_bounds is not None:
                    bounds_da = [(b[0], b[1]) for b in opt_bounds]
                    res = dual_annealing(cost_func, bounds_da)
                else:
                    raise ValueError("dual_annealing requires bounds")

            x_e, u_e = res.x[:n_x], res.x[n_x:]
            cost = res.fun
            converged = res.success and cost < tolerance
            message = res.message

        elif strategy == 'direct':
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                if opt_bounds is not None:
                    bounds_direct = [(b[0], b[1]) for b in opt_bounds]
                    res = direct(cost_func, bounds_direct, eps=tolerance)
                else:
                    raise ValueError("direct requires bounds")

            x_e, u_e = res.x[:n_x], res.x[n_x:]
            cost = res.fun
            converged = cost < tolerance
            message = "DIRECT completed"

        elif strategy == 'least_squares':
            # Use least_squares for better convergence on nonlinear problems.
            if desired_mask is not None and np.any(desired_mask):
                target_func = eq_func_free
                guess = free_initial_guess

                # Prepare bounds for free variables
                if free_bounds is not None:
                    # free_bounds is list of tuples [(min, max), ...]
                    # least_squares requires ([min, ...], [max, ...])
                    lb = [b[0] if b[0] is not None else -np.inf for b in free_bounds]
                    ub = [b[1] if b[1] is not None else np.inf for b in free_bounds]
                    ls_bounds = (np.array(lb), np.array(ub))
                else:
                    ls_bounds = (-np.inf, np.inf)

                with warnings.catch_warnings():
                    warnings.simplefilter("default")
                    try:
                        res = least_squares(target_func, guess, jac='3-point',
                                          bounds=ls_bounds,
                                          ftol=tolerance, xtol=tolerance, gtol=tolerance,
                                          **strategy_options)
                    except Exception as e:
                        # If least_squares fails with constrained version, try without Jacobian
                        res = least_squares(target_func, guess,
                                          bounds=ls_bounds,
                                          ftol=tolerance, xtol=tolerance, gtol=tolerance,
                                          **strategy_options)

                # Auto-Scaling Retry: If failed, try normalizing the equations
                if not (res.success and np.sum(res.fun**2) < tolerance):
                    # Calculate scaling factors to normalize residuals to ~1.0
                    f0 = target_func(guess)
                    # Avoid division by zero and extreme scaling
                    scales = 1.0 / (np.abs(f0) + 1.0) 
                    scales = np.clip(scales, 1e-8, 1e8)
                    
                    def scaled_target_func(z):
                        return target_func(z) * scales

                    with warnings.catch_warnings():
                        warnings.simplefilter("default")
                        try:
                            res_scaled = least_squares(scaled_target_func, guess, jac='3-point',
                                              bounds=ls_bounds,
                                              ftol=tolerance, xtol=tolerance, gtol=tolerance,
                                              **strategy_options)
                            # If scaled attempt improved the cost (unscaled), keep it
                            cost_scaled = np.sum(target_func(res_scaled.x)**2)
                            if cost_scaled < np.sum(res.fun**2):
                                res = res_scaled
                        except Exception:
                            pass # Fallback to original result if scaling fails

                # Reconstruct full solution from free variables
                x_e = np.zeros(n_x)
                # Set fixed states
                if np.any(desired_mask):
                    x_e[desired_mask] = desired_x_vec[desired_mask]
                # Set free states
                if len(free_state_indices) > 0:
                    x_e[free_state_indices] = res.x[:len(free_state_indices)]
                
                # Extract inputs
                u_e = res.x[len(free_state_indices):] if len(res.x) > len(free_state_indices) else np.zeros(n_u)

                cost = np.sum(res.fun**2) if hasattr(res, 'fun') else np.inf
                converged = res.success and cost < tolerance
                message = res.message if hasattr(res, 'message') else "Constrained optimization completed"
                if res.success and not converged:
                    message += f" (Cost {cost:.2e} > tol {tolerance:.2e})"

            else:
                target_func = eq_func
                guess = initial_guess

                if opt_bounds is not None:
                    lb = np.array([b[0] if b[0] is not None else -np.inf for b in opt_bounds])
                    ub = np.array([b[1] if b[1] is not None else np.inf for b in opt_bounds])
                    ls_bounds = (lb, ub)
                else:
                    ls_bounds = (-np.inf, np.inf)

                with warnings.catch_warnings():
                    warnings.simplefilter("default")
                    try:
                        res = least_squares(target_func, guess, jac='3-point',
                                          bounds=ls_bounds,
                                          ftol=tolerance, xtol=tolerance, gtol=tolerance,
                                          **strategy_options)
                    except Exception as e:
                        # If least_squares fails, try without Jacobian
                        res = least_squares(target_func, guess,
                                          bounds=ls_bounds,
                                          ftol=tolerance, xtol=tolerance, gtol=tolerance,
                                          **strategy_options)

                # Auto-Scaling Retry: If failed, try normalizing the equations
                if not (res.success and np.sum(res.fun**2) < tolerance):
                    # Calculate scaling factors to normalize residuals to ~1.0
                    f0 = target_func(guess)
                    # Avoid division by zero and extreme scaling
                    scales = 1.0 / (np.abs(f0) + 1.0)
                    scales = np.clip(scales, 1e-8, 1e8)
                    
                    def scaled_target_func(z):
                        return target_func(z) * scales

                    with warnings.catch_warnings():
                        warnings.simplefilter("default")
                        try:
                            res_scaled = least_squares(scaled_target_func, guess, jac='3-point',
                                              bounds=ls_bounds,
                                              ftol=tolerance, xtol=tolerance, gtol=tolerance,
                                              **strategy_options)
                            # If scaled attempt improved the cost (unscaled), keep it
                            cost_scaled = np.sum(target_func(res_scaled.x)**2)
                            if cost_scaled < np.sum(res.fun**2):
                                res = res_scaled
                        except Exception:
                            pass # Fallback to original result if scaling fails

                x_e, u_e = res.x[:n_x], res.x[n_x:]
                cost = np.sum(res.fun**2) if hasattr(res, 'fun') else np.inf
                converged = res.success and cost < tolerance
                message = res.message if hasattr(res, 'message') else "Optimization completed"
                if res.success and not converged:
                    message += f" (Cost {cost:.2e} > tol {tolerance:.2e})"

            # Cost is sum of squares of all residuals

        elif strategy == 'root_scalar':
            # For 1D root finding
            if len(initial_guess) != 1:
                raise ValueError("root_scalar is for 1D problems only")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = root_scalar(eq_func, bracket=opt_bounds[0] if opt_bounds else None, xtol=tolerance)

            x_e = np.array([res.root]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res.root]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res.root]))[0])
            converged = res.converged and cost < tolerance
            message = "Converged" if converged else "Not converged"

        elif strategy == 'brentq':
            # Bracketing root finding for 1D
            if len(initial_guess) != 1 or opt_bounds is None:
                raise ValueError("brentq requires 1D problem with bounds")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = brentq(eq_func, opt_bounds[0][0], opt_bounds[0][1], xtol=tolerance)

            x_e = np.array([res]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res]))[0])
            converged = cost < tolerance
            message = "Root found" if converged else "Root not found"

        elif strategy == 'brenth':
            # Similar to brentq with hyperbolic extrapolation
            if len(initial_guess) != 1 or opt_bounds is None:
                raise ValueError("brenth requires 1D problem with bounds")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = brenth(eq_func, opt_bounds[0][0], opt_bounds[0][1], xtol=tolerance)

            x_e = np.array([res]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res]))[0])
            converged = cost < tolerance
            message = "Root found" if converged else "Root not found"

        elif strategy == 'ridder':
            # Ridder's method for 1D root finding
            if len(initial_guess) != 1 or opt_bounds is None:
                raise ValueError("ridder requires 1D problem with bounds")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = ridder(eq_func, opt_bounds[0][0], opt_bounds[0][1], xtol=tolerance)

            x_e = np.array([res]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res]))[0])
            converged = cost < tolerance
            message = "Root found" if converged else "Root not found"

        elif strategy == 'bisect':
            # Simple bisection for 1D root finding
            if len(initial_guess) != 1 or opt_bounds is None:
                raise ValueError("bisect requires 1D problem with bounds")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = bisect(eq_func, opt_bounds[0][0], opt_bounds[0][1], xtol=tolerance)

            x_e = np.array([res]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res]))[0])
            converged = cost < tolerance
            message = "Root found" if converged else "Root not found"

        elif strategy == 'newton':
            # Newton-Raphson for 1D
            if len(initial_guess) != 1:
                raise ValueError("newton is for 1D problems only")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = newton(eq_func, initial_guess[0], tol=tolerance)

            x_e = np.array([res]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res]))[0])
            converged = cost < tolerance
            message = "Root found" if converged else "Root not found"

        elif strategy == 'toms748':
            # TOMS Algorithm 748 for 1D root finding
            if len(initial_guess) != 1 or opt_bounds is None:
                raise ValueError("toms748 requires 1D problem with bounds")
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = toms748(eq_func, opt_bounds[0][0], opt_bounds[0][1], xtol=tolerance)

            x_e = np.array([res]) if n_x == 1 else np.full(n_x, np.nan)
            u_e = np.array([res]) if n_u == 1 else np.full(n_u, np.nan)
            cost = abs(eq_func(np.array([res]))[0])
            converged = cost < tolerance
            message = "Root found" if converged else "Root not found"

        elif strategy == 'root':
            # General nonlinear system solver.
            # This is suitable when the number of free variables equals the number of residual equations.
            if desired_mask is not None and np.any(desired_mask):
                target_func = eq_func_free
                guess = free_initial_guess
                num_free_states = len(free_state_indices)

                # Ensure number of free variables matches number of equations
                if len(guess) != n_eq:
                    warnings.warn(f"For 'root' with operating conditions, n_free ({len(guess)}) != n_eq ({n_eq}). Switching to 'least_squares'.")
                    return solve_equilibrium(system_f, initial_guess, params, n_x, n_u, 'least_squares', bounds, tolerance, operating_conditions, state_vars, penalty_factor)
            else:
                target_func = eq_func
                guess = initial_guess
                # This case is problematic if n_u > 0, as we have more variables than equations.
                if n_eq != len(guess):
                    warnings.warn(f"root requires n_vars ({len(guess)}) == n_eq ({n_eq}). Switching to 'least_squares'.")
                    return solve_equilibrium(system_f, initial_guess, params, n_x, n_u, 'least_squares', bounds, tolerance, operating_conditions, state_vars, penalty_factor)
            
            with warnings.catch_warnings():
                warnings.simplefilter("default")
                res = root(target_func, guess, tol=tolerance)

            # Reconstruct the full solution vector if we only solved for free variables
            if desired_mask is not None and np.any(desired_mask):
                full_sol = np.full(n_x + n_u, np.nan)
                # Fill in the fixed state values from operating conditions
                if np.any(desired_mask):
                    full_sol[:n_x][desired_mask] = desired_x_vec[desired_mask]
                # Fill in the solved free state values
                if num_free_states > 0:
                    full_sol[:n_x][free_state_indices] = res.x[:num_free_states]
                # Fill in the solved free input values
                if len(res.x) > num_free_states:
                    full_sol[n_x:] = res.x[num_free_states:]
            else:
                full_sol = res.x
            
            x_e, u_e = full_sol[:n_x], full_sol[n_x:]
            cost = np.sum(res.fun**2) if hasattr(res, 'fun') else np.inf
            converged = res.success and cost < tolerance
            message = res.message

        elif strategy == 'fixed_point':
            # Fixed point iteration
            if desired_mask is not None and np.any(desired_mask):
                target_func = eq_func_free
                guess = free_initial_guess
                num_free_states = len(free_state_indices)
                if len(guess) != n_eq:
                    raise ValueError(f"For 'fixed_point' with operating conditions, the number of free variables ({len(guess)}) must equal the number of residual equations ({n_eq}).")
            else:
                target_func = eq_func
                guess = initial_guess
                if n_eq != len(guess):
                    raise ValueError(f"'fixed_point' requires the number of variables ({len(guess)}) to equal the number of residual equations ({n_eq}). Use 'operating_conditions'.")

            def fixed_point_func(z):
                return z - target_func(z)  # Simple fixed point formulation

            with warnings.catch_warnings():
                warnings.simplefilter("default")
                sol = fixed_point(fixed_point_func, guess, xtol=tolerance)

            cost = np.sum(target_func(sol)**2)
            converged = cost < tolerance

            # Reconstruct the full solution vector
            if desired_mask is not None and np.any(desired_mask):
                full_sol = np.full(n_x + n_u, np.nan)
                if np.any(desired_mask):
                    full_sol[:n_x][desired_mask] = desired_x_vec[desired_mask]
                if num_free_states > 0:
                    full_sol[:n_x][free_state_indices] = sol[:num_free_states]
                if len(sol) > num_free_states:
                    full_sol[n_x:] = sol[num_free_states:]
            else:
                full_sol = sol
            
            x_e, u_e = full_sol[:n_x], full_sol[n_x:]
            message = "Fixed point found" if converged else "Fixed point not found"

        elif strategy == 'broyden1':
            # Quasi-Newton method
            if desired_mask is not None and np.any(desired_mask):
                target_func = eq_func_free
                guess = free_initial_guess
                num_free_states = len(free_state_indices)
                if len(guess) != n_eq:
                    raise ValueError(f"For 'broyden1' with operating conditions, the number of free variables ({len(guess)}) must equal the number of residual equations ({n_eq}).")
            else:
                target_func = eq_func
                guess = initial_guess
                if n_eq != len(guess):
                    raise ValueError(f"'broyden1' requires the number of variables ({len(guess)}) to equal the number of residual equations ({n_eq}). Use 'operating_conditions'.")

            with warnings.catch_warnings():
                warnings.simplefilter("default")
                sol = broyden1(target_func, guess, xtol=tolerance)

            cost = np.sum(target_func(sol)**2)
            converged = cost < tolerance

            # Reconstruct the full solution vector
            if desired_mask is not None and np.any(desired_mask):
                full_sol = np.full(n_x + n_u, np.nan)
                if np.any(desired_mask):
                    full_sol[:n_x][desired_mask] = desired_x_vec[desired_mask]
                if num_free_states > 0:
                    full_sol[:n_x][free_state_indices] = sol[:num_free_states]
                if len(sol) > num_free_states:
                    full_sol[n_x:] = sol[num_free_states:]
            else:
                full_sol = sol
            
            x_e, u_e = full_sol[:n_x], full_sol[n_x:]
            message = "Root found" if converged else "Root not found"

        elif strategy == 'broyden2':
            # Another quasi-Newton method
            if desired_mask is not None and np.any(desired_mask):
                target_func = eq_func_free
                guess = free_initial_guess
                num_free_states = len(free_state_indices)
                if len(guess) != n_eq:
                    raise ValueError(f"For 'broyden2' with operating conditions, the number of free variables ({len(guess)}) must equal the number of residual equations ({n_eq}).")
            else:
                target_func = eq_func
                guess = initial_guess
                if n_eq != len(guess):
                    raise ValueError(f"'broyden2' requires the number of variables ({len(guess)}) to equal the number of residual equations ({n_eq}). Use 'operating_conditions'.")

            with warnings.catch_warnings():
                warnings.simplefilter("default")
                sol = broyden2(target_func, guess, xtol=tolerance)

            cost = np.sum(target_func(sol)**2)
            converged = cost < tolerance

            # Reconstruct the full solution vector
            if desired_mask is not None and np.any(desired_mask):
                full_sol = np.full(n_x + n_u, np.nan)
                if np.any(desired_mask):
                    full_sol[:n_x][desired_mask] = desired_x_vec[desired_mask]
                if num_free_states > 0:
                    full_sol[:n_x][free_state_indices] = sol[:num_free_states]
                if len(sol) > num_free_states:
                    full_sol[n_x:] = sol[num_free_states:]
            else:
                full_sol = sol
            
            x_e, u_e = full_sol[:n_x], full_sol[n_x:]
            message = "Root found" if converged else "Root not found"

        elif strategy == 'fsolve':
            # Determine which function and initial guess to use.
            # This is suitable when the number of free variables equals the number of residual equations.
            if desired_mask is not None and np.any(desired_mask):
                target_func = eq_func_free
                guess = free_initial_guess
                num_free_states = len(free_state_indices)

                # Ensure number of free variables matches number of equations
                if len(guess) != n_eq:
                    warnings.warn(f"For 'fsolve' with operating conditions, n_free ({len(guess)}) != n_eq ({n_eq}). Switching to 'least_squares'.")
                    return solve_equilibrium(system_f, initial_guess, params, n_x, n_u, 'least_squares', bounds, tolerance, operating_conditions, state_vars, penalty_factor)
            else:
                target_func = eq_func
                guess = initial_guess
                # This case is problematic if n_u > 0, as we have more variables than equations.
                if n_eq != len(guess):
                    warnings.warn(f"fsolve requires n_vars ({len(guess)}) == n_eq ({n_eq}). Switching to 'least_squares'.")
                    return solve_equilibrium(system_f, initial_guess, params, n_x, n_u, 'least_squares', bounds, tolerance, operating_conditions, state_vars, penalty_factor)

            with warnings.catch_warnings():
                warnings.simplefilter("default")
                sol, info_dict, ier, mesg = fsolve(target_func, guess, full_output=True)

            # Reconstruct the full solution vector if we only solved for free variables
            if desired_mask is not None and np.any(desired_mask):
                full_sol = np.full(n_x + n_u, np.nan)
                # Fill in the fixed state values from operating conditions
                if np.any(desired_mask):
                    full_sol[:n_x][desired_mask] = desired_x_vec[desired_mask]
                # Fill in the solved free state values
                if num_free_states > 0:
                    full_sol[:n_x][free_state_indices] = sol[:num_free_states]
                # Fill in the solved free input values
                if len(sol) > num_free_states:
                    full_sol[n_x:] = sol[num_free_states:]
            else:
                full_sol = sol

            x_e, u_e = full_sol[:n_x], full_sol[n_x:]
            cost = np.sum(info_dict['fvec']**2) if info_dict and 'fvec' in info_dict else np.inf
            converged = (ier == 1) and cost < tolerance
            message = mesg

        else:
            raise ValueError(f"Unknown strategy: {strategy}")

    except Exception as e:
        import traceback
        x_e = np.full(n_x, np.nan)
        u_e = np.full(n_u, np.nan)
        cost = np.inf
        converged = False
        message = str(e)
        error_trace = traceback.format_exc()
        print(f"[DEBUG] Exception in solve_equilibrium: {e}")
        print(f"[DEBUG] Traceback:\n{error_trace}")
        return x_e, u_e, converged, cost, message, {
            "tool": "solve_equilibrium",
            "error": str(e),
            "traceback": error_trace,
            "params": {"strategy": strategy}
        }

    trace_entry = {
        "tool": "solve_equilibrium",
        "params": {
            "initial_guess": initial_guess.tolist(),
            "strategy": strategy
        },
        "result": {
            "x_e": x_e.tolist() if x_e is not None else None,
            "u_e": u_e.tolist() if u_e is not None else None,
            "cost": float(cost),
            "converged": bool(converged)
        }
    }

    return x_e, u_e, converged, cost, message, trace_entry


def compute_jacobian(system_f, x_e, u_e, params, eps=1e-7):
    """
    Tool: Compute linearization matrices A and B via numerical differentiation. 
 
    A = ∂f/∂x|_(x_e,u_e)
    B = ∂f/∂u|_(x_e,u_e)
 
    Args:
        system_f: dynamics function f(x, u, params)

    Returns:
        A: np.array of shape (n_x, n_x)
        B: np.array of shape (n_x, n_u)
        trace_entry: dict for logging
    """
    if x_e is None or u_e is None:
        trace_entry = {
            "tool": "compute_jacobian",
            "error": "Equilibrium not found",
            "params": {},
            "result": {}
        }
        return None, None, trace_entry

    n_x = len(x_e)
    n_u = len(u_e)
    A = np.zeros((n_x, n_x))
    B = np.zeros((n_x, n_u))

    # Compute f0 and flatten it to ensure it's a 1D array
    f0_raw = system_f(x_e, u_e, params)
    f0 = np.array(recursive_flatten(f0_raw), dtype=np.float64)

    # Compute A: partial derivatives w.r.t. states
    for i in range(n_x):
        x_pert = x_e.copy()
        x_pert[i] += eps
        f_pert_raw = system_f(x_pert, u_e, params)
        f_pert = np.array(recursive_flatten(f_pert_raw), dtype=np.float64)
        A[:, i] = (f_pert - f0) / eps

    # Compute B: partial derivatives w.r.t. inputs
    for j in range(n_u):
        u_pert = u_e.copy()
        u_pert[j] += eps
        f_pert_raw = system_f(x_e, u_pert, params)
        f_pert = np.array(recursive_flatten(f_pert_raw), dtype=np.float64)
        B[:, j] = (f_pert - f0) / eps

    trace_entry = {
        "tool": "compute_jacobian",
        "params": {
            "equilibrium": {"x_e": x_e.tolist(), "u_e": u_e.tolist()},
            "eps": eps
        },
        "result": {
            "A": A.tolist(),
            "B": B.tolist(),
            "A_condition_number": float(np.linalg.cond(A))
        }
    }

    return A, B, trace_entry


def analyze_stability(A):
    """
    Tool: Analyze stability via eigenvalue analysis.

    Classification:
    - Asymptotically stable: all Re(λ) < 0
    - Marginally stable: all Re(λ) ≤ 0, at least one Re(λ) = 0
    - Unstable: at least one Re(λ) > 0

    Returns:
        eigenvalues: list of complex eigenvalue strings
        eigvals_complex: array of complex eigenvalues
        classification: stability classification string
        trace_entry: dict for logging
    """
    if A is None:
        trace_entry = {
            "tool": "analyze_stability",
            "error": "Jacobian not computed",
            "params": {},
            "result": {}
        }
        return None, None, "unknown", trace_entry

    eigvals_complex = eigvals(A)
    real_parts = np.real(eigvals_complex)
    imag_parts = np.imag(eigvals_complex)

    # Tolerance for numerical zero
    tol = 1e-8

    if np.all(real_parts < -tol):
        classification = "asymptotically stable"
    elif np.all(real_parts < tol) and np.any(np.abs(real_parts) < tol):
        classification = "marginally stable"
    else:
        classification = "unstable"

    # Format eigenvalues for output
    eigenvalues = []
    for ev in eigvals_complex:
        if abs(ev.imag) < tol:
            eigenvalues.append(f"{ev.real:.6f}")
        else:
            eigenvalues.append(f"{ev.real:.6f} + {ev.imag:.6f}j")

    trace_entry = {
        "tool": "analyze_stability",
        "params": {
            "A_shape": list(A.shape)
        },
        "result": {
            "eigenvalues": eigenvalues,
            "real_parts": real_parts.tolist(),
            "imaginary_parts": imag_parts.tolist(),
            "classification": classification
        }
    }

    return eigenvalues, eigvals_complex, classification, trace_entry


def validate_constraints(x_e, u_e, bounds):
    """
    Tool: Validate physical realizability of equilibrium point.

    Checks if equilibrium point lies within specified bounds.

    Returns:
        feasible: bool indicating if all constraints are satisfied
        trace_entry: dict for logging
    """
    x_min = bounds.get('x_min')
    x_max = bounds.get('x_max')
    u_min = bounds.get('u_min')
    u_max = bounds.get('u_max')

    if x_min is not None and x_max is not None:
        x_min = np.array(x_min)
        x_max = np.array(x_max)
        x_feasible = np.all((x_min <= x_e) & (x_e <= x_max))
    else:
        x_feasible = True

    if u_min is not None and u_max is not None:
        u_min = np.array(u_min)
        u_max = np.array(u_max)
        u_feasible = np.all((u_min <= u_e) & (u_e <= u_max))
    else:
        u_feasible = True

    feasible = bool(x_feasible and u_feasible)

    # Detailed constraint violations
    violations = []
    if x_min is not None and x_max is not None:
        for i, (x_val, x_lo, x_hi) in enumerate(zip(x_e, x_min, x_max)):
            if x_val < x_lo:
                violations.append(f"x[{i}]={x_val:.4f} < {x_lo}")
            elif x_val > x_hi:
                violations.append(f"x[{i}]={x_val:.4f} > {x_hi}")

    if u_min is not None and u_max is not None:
        for j, (u_val, u_lo, u_hi) in enumerate(zip(u_e, u_min, u_max)):
            if u_val < u_lo:
                violations.append(f"u[{j}]={u_val:.4f} < {u_lo}")
            elif u_val > u_hi:
                violations.append(f"u[{j}]={u_val:.4f} > {u_hi}")

    trace_entry = {
        "tool": "validate_constraints",
        "params": {
            "equilibrium": {"x_e": x_e.tolist(), "u_e": u_e.tolist()},
            "bounds": bounds
        },
        "result": {
            "feasible": bool(feasible),
            "x_feasible": bool(x_feasible),
            "u_feasible": bool(u_feasible),
            "violations": violations
        }
    }

    return bool(feasible), trace_entry