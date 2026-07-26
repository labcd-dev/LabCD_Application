import json
import os
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from matplotlib import pyplot as plt

logs_dir = Path("./.logs")
logs_dir.mkdir(exist_ok=True)
LOG_FILE = logs_dir / f"control_system_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"

class SharedBuffer:
    def __init__(self):
        self.history = []
        self.best_params = None
        self.best_metrics = {'mse': float('inf')}
        self.controller_type = None
        self.scenario = None
        self.param_ranges = None  # Initialized in suggest_controller
        self.latest_juror_feedback = None
        self.system_name = None
        self.system_description = None
        self.control_objective = None
        self.current_scenario_metrics = None  # NEW: {'tokens_in': 0, 'tokens_out': 0, 'cost': 0.0}

    def add_entry(self, params, metrics, trajectory, control_signals, errors, feedback=None):
        entry = {
            'timestamp': time.time(),
            'iteration': len(self.history) + 1,
            'params': params,
            'metrics': metrics,
            'trajectory': trajectory,
            'control_signals': control_signals,
            'errors': errors,
            'feedback': feedback,
            'param_ranges': self.param_ranges  # Store the current param_ranges
        }
        self.history.append(entry)
        if metrics['mse'] < self.best_metrics['mse']:
            self.best_params = params
            self.best_metrics = metrics

    def get_last_entry(self):
        return self.history[-1] if self.history else None

    def get_entries(self, n=3):
        return self.history[-n:] if len(self.history) >= n else self.history

    def get_best_entries(self, n=3):
        sorted_entries = sorted(self.history, key=lambda e: e['metrics']['mse'])
        return sorted_entries[:n]

    def clear_history(self):
        """Clear history for new scenario or controller type"""
        self.history = []
        self.best_params = None
        self.best_metrics = {'mse': float('inf')}

    # def save_state(self, filename):
    #     with open(filename, 'wb') as f:
    #         pickle.dump(self.__dict__, f)
    #
    # def load_state(self, filename):
    #     with open(filename, 'rb') as f:
    #         data = pickle.load(f)
    #     self.__dict__.update(data)


def log_to_file(message, also_print=False):
    """Write message to log file and optionally print to console"""
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"{message}\n")

    if also_print:
        print(message)

def generate_scenario_report_json(full_path: str) -> None:
    """Generate report for a scenario using data loaded from a JSON file."""
    # current_directory = os.getcwd()
    # parent_directory = os.path.abspath(os.path.join(current_directory, ".."))
    # json_path = os.path.join(parent_directory, json_filename)

    # Load JSON data
    with open(full_path, "r") as f:
        scenario_data = json.load(f)

    scenario_level = scenario_data["scenario_level"]
    controller_type = scenario_data["controller_type"]
    seed = scenario_data["seed"]
    history = scenario_data["history"]

    if not history:
        print("No history data found.")
        return

    # NEW: Extract metrics from JSON
    scenario_metrics = scenario_data.get("scenario_metrics",
                                         {'tokens_in': 0, 'tokens_out': 0, 'time': 0.0, 'cost': 0.0})

    # Determine parameters to plot based on controller type
    first_entry = history[0]
    if controller_type == "FSF":
        fsf_params = [k for k in first_entry["params"].keys() if k.startswith('K') and k[1:].isdigit()]
        fsf_params.sort(key=lambda x: int(x[1:]) if x[1:].isdigit() else 0)
        params_to_plot = fsf_params
    else:
        pid_params = ['Kp', 'Ki', 'Kd']
        params_to_plot = [p for p in pid_params if p in first_entry["params"]]

    # Identify segments where param_ranges are constant
    segments = []
    start = 0
    for i in range(1, len(history)):
        if history[i]["param_ranges"] != history[i - 1]["param_ranges"]:
            segments.append((start, i, history[start]["param_ranges"]))
            start = i
    if history:
        segments.append((start, len(history), history[start]["param_ranges"]))

    # Range change indices
    range_change_indices = [seg[1] for seg in segments[:-1]]

    # Initialize figure
    plt.figure(figsize=(10, 8))
    ax = plt.subplot(221)

    # Plot parameter evolution
    iterations = range(len(history))
    colors = ['r', 'g', 'b', 'c', 'm', 'y', 'k']  # Color cycle

    for i, param in enumerate(params_to_plot):
        color = colors[i % len(colors)]
        marker_style = '-o' if i < len(colors) else '--s'
        values = [e["params"].get(param, 0) for e in history]
        ax.plot(iterations, values, color + marker_style, label=param)

    # Plot shaded areas for parameter ranges
    N = len(history)
    for start, end, ranges in segments:
        if start >= end:
            continue
        for param, (min_val, max_val) in ranges.items():
            if param in params_to_plot:
                color = colors[params_to_plot.index(param) % len(colors)]
                xmin = start / (N - 1) if N > 1 else 0
                xmax = (end - 1) / (N - 1) if N > 1 else 1
                ax.axhspan(min_val, max_val, xmin=xmin, xmax=xmax, color=color, alpha=0.2)

    # Add vertical lines for range changes
    for idx in range_change_indices:
        ax.axvline(x=idx, color='k', linestyle='--', alpha=0.5)
        ax.text(idx, ax.get_ylim()[1] * 0.95, "Range\nChange", fontsize=8, ha='center', va='top',
                bbox=dict(facecolor='white', alpha=0.5))

    ax.set_xlabel('Iteration')
    ax.set_ylabel('Parameter Value')
    ax.set_title(f'Controller Parameter Evolution - {controller_type}')
    ax.legend()
    ax.grid(True)

    # Performance metrics plots
    # MSE Plot
    plt.subplot(222)
    mse_values = [e["metrics"]["mse"] for e in history]
    plt.semilogy(iterations, mse_values, 'r-o', label='MSE', linewidth=2, markersize=4)
    if len(iterations) > 10:
        window_size = max(1, int(len(iterations) / 5))
        moving_avg = np.convolve(mse_values, np.ones(window_size) / window_size, mode='valid')
        plt.semilogy(iterations[window_size - 1:], moving_avg, 'b-', label=f'MovAvg({window_size})', linewidth=2)
    for idx in range_change_indices:
        plt.axvline(x=idx, color='black', linestyle='--', alpha=0.7, linewidth=2)
    plt.xlabel('Iteration')
    plt.ylabel('MSE (log scale)')
    plt.title('Mean Squared Error Evolution')
    plt.legend()
    plt.grid(True, alpha=0.3)

    # Settling Time Plot
    plt.subplot(223)
    settling_times = [e["metrics"]["settling_time"] for e in history]
    plt.plot(iterations, settling_times, 'g-o', linewidth=2, markersize=4)
    for idx in range_change_indices:
        plt.axvline(x=idx, color='black', linestyle='--', alpha=0.7, linewidth=2)
    plt.xlabel('Iteration')
    plt.ylabel('Time (s)')
    plt.title('Settling Time Evolution')
    plt.grid(True, alpha=0.3)

    # Overshoot Plot
    plt.subplot(224)
    overshoots = [e["metrics"]["overshoot"] for e in history]
    plt.plot(iterations, overshoots, 'b-o', linewidth=2, markersize=4)
    for idx in range_change_indices:
        plt.axvline(x=idx, color='black', linestyle='--', alpha=0.7, linewidth=2)
    plt.xlabel('Iteration')
    plt.ylabel('Overshoot (rad)')
    plt.title('Maximum Overshoot Evolution')
    plt.grid(True, alpha=0.3)

    # Save plot
    plt.tight_layout()
    # plot_filename = f"scenario_report_{Path(full_path).stem}.png"
    # plt.savefig(plot_filename, dpi=300, bbox_inches='tight') #$$$$$$$
    # plt.close() #$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$

    # Generate text summary
    report = f"\n=== Scenario {scenario_level} Optimization Summary ===\n"
    report += f"Controller Type: {controller_type}\n"
    report += f"Total iterations: {len(history)}\n"

    if range_change_indices:
        report += f"Parameter range changes at iterations: {range_change_indices}\n"
        report += f"Number of range reconsiderations: {len(range_change_indices)}\n"
        report += f"\nParameter Range Evolution:\n"
        for start, end, ranges in segments:
            if start < end:
                report += f"  Iterations {start}-{end - 1}: "
                if controller_type == "FSF":
                    fsf_items = [(k, v) for k, v in ranges.items() if k in params_to_plot]
                    fsf_items.sort(key=lambda x: int(x[0][1:]) if x[0][1:].isdigit() else 0)
                    range_strs = [f"{param}=[{min_val:.2f}, {max_val:.2f}]" for param, (min_val, max_val) in fsf_items]
                else:
                    range_strs = [f"{param}=[{min_val:.2f}, {max_val:.2f}]" for param, (min_val, max_val) in
                                  ranges.items() if param in params_to_plot]
                report += " ".join(range_strs) + "\n"

    # Find best parameters and metrics
    if history:
        best_entry = min(history, key=lambda x: x["metrics"]["mse"])
        best_params = best_entry["params"]
        best_metrics = best_entry["metrics"]

        report += f"\nBest parameters found:\n"
        for param in params_to_plot:
            if param in best_params:
                report += f"  {param}: {best_params[param]:.4f}\n"

        report += f"Best MSE: {best_metrics['mse']:.4f}\n"
        report += f"Settling Time: {best_metrics.get('settling_time', 'N/A'):.2f}s\n"
        report += f"Overshoot: {best_metrics.get('overshoot', 'N/A'):.4f}\n"
        report += f"Rise Time: {best_metrics.get('rise_time', 'N/A'):.2f}s\n"
        report += f"Zero-Crossings: {best_metrics.get('zero_crossings', 'N/A')}\n"
        report += f"Control Effort: {best_metrics.get('control_effort', 'N/A'):.4f}\n"
        report += f"Control Zero-Crossings: {best_metrics.get('control_zero_crossings', 'N/A')}\n"
        report += f"Stable: {'Yes' if best_metrics.get('stable', False) else 'No'}\n"

    report += f"\n=== Scenario Metrics ===\n"
    report += f"Total Tokens In: {scenario_metrics['tokens_in']}\n"
    report += f"Total Tokens Out: {scenario_metrics['tokens_out']}\n"
    report += f"Wall Clock Time: {scenario_metrics['time']:.2f}s\n"
    report += f"Estimated Cost: ${scenario_metrics['cost']:.6f}\n"

    # Output report
    print(report)  # Alternatively, use log_to_file(report, True) if logging is preferred
