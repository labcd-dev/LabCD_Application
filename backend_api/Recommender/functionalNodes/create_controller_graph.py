from backend_api.Recommender.states import OverallState
from backend_api.http.config import RESULTS_DIR
import json
import os
from graphviz import Digraph
from langchain_core.messages import SystemMessage


def create_controller_graph(messages: OverallState, writer):
    writer({"progress": 0.9, "text": "ðŸŽ¨ Creating Controller Graph..."})

    # Create graph with better styling
    dot = Digraph(comment='Controller Graph')
    dot.attr(rankdir='LR',
             splines='spline',  # Straight lines
             bgcolor='#f8f9fa',  # Light background
             fontname='Arial',
             fontsize='12')

    signal_mapping = {}

    # Style main nodes
    dot.node("System", "System",
             shape='rectangle',
             style='filled,rounded',
             fillcolor='#4e79a7',
             fontcolor='white',
             fontsize='14',
             width='1.2',
             height='0.8')

    dot.node("Target", "Target",
             shape='rectangle',
             style='filled,rounded',
             fillcolor='#59a14f',
             fontcolor='white',
             fontsize='14',
             width='1.2',
             height='0.8')

    json_data = messages["control_loop_analysis"]
    structure = json.loads(json_data)

    i = 1
    loop_index = 1

    # Color palette for loops
    loop_colors = ['#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f']

    for loop in structure["pid_loops"]:
        color = loop_colors[(loop_index - 1) % len(loop_colors)]

        # Create a cluster for each pid_loop with better styling
        with dot.subgraph(name=f'cluster_{loop_index}') as c:
            # Customize the container appearance
            c.attr(label=loop["loop_name"],
                   style='rounded,filled',
                   fillcolor='#ffffff',
                   color=color,
                   fontsize='13',
                   fontname='Arial Bold',
                   fontcolor=color,
                   penwidth='2')

            for controller in loop["controllers"]:
                nodeName = f'node_{i}'
                name = controller["controlled_variable"] + "_control"
                inputSignal = controller["controlled_variable_in_equation"]
                outputSignal = controller["output_variable_in_equation"]

                if outputSignal.startswith("X_sp"):
                    number_str = outputSignal.split('[')[1].split(']')[0]
                    n = int(number_str)
                    outputSignal = f'X[{n}]'
                # elif "_sp" in outputSignal:

                signals = {inputSignal: "to", outputSignal: "from"}
                names = {inputSignal: controller["controlled_variable"], outputSignal: controller["output_signal"]}
                for signal, ky in signals.items():
                    if signal not in signal_mapping:
                        arrow = {"name": names[signal], ky: nodeName}
                        signal_mapping[signal] = arrow
                    else:
                        arrow = signal_mapping[signal]
                        arrow[ky] = nodeName
                        signal_mapping[signal] = arrow

                # Add nodes to the cluster with better styling
                c.node(nodeName, name,
                       shape='rectangle',
                       style='filled,rounded',
                       fillcolor='#f0f0f5',
                       color='#333333',
                       fontname='Arial',
                       fontsize='11',
                       width='1.5',
                       height='0.6')
                i += 1

        loop_index += 1

    # Style edges
    for edg in signal_mapping.values():
        edge_attrs = {
            'fontname': 'Arial',
            'fontsize': '10',
            'color': '#666666',
            'arrowsize': '0.8'
        }

        if "from" not in edg:
            dot.edge("Target", edg["to"], edg["name"], **edge_attrs)
        elif "to" not in edg:
            dot.edge(edg["from"], "System", edg["name"], **edge_attrs)
        else:
            dot.edge(edg["from"], edg["to"], edg["name"], **edge_attrs)

    # Save the graph to plots directory
    controller_json = messages.get("controller_json", {})
    controller_graph = messages.get("controller_graph", {})
    process = messages.get("control_design_process")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    filepath = os.path.join(
        str(RESULTS_DIR),
        f"{messages['file_name']}_controller_graph_{process}"
    )
    key = f"{process}_controller"

    controller_json[key] = json_data
    controller_graph[key] = filepath + ".png"

    dot.render(filepath, format="png", cleanup=True)

    response = SystemMessage(content=f"Graph saved as: {filepath}.png")

    return {"messages": [response], "controller_graph": controller_graph, "controller_json": controller_json}


def _parse_controller_structure(controller):
    if isinstance(controller, dict):
        return controller
    if isinstance(controller, str):
        stripped = controller.strip()
        if not stripped:
            raise ValueError("Controller JSON is empty")
        return json.loads(stripped)
    raise ValueError(f"Unexpected controller type: {type(controller).__name__}")


def find_trimming_parameters(controller, system_identification):
    signal_mapping = {}
    i = 0
    pid_loops = _parse_controller_structure(controller)["pid_loops"]
    for loop in pid_loops:
        for controller in loop["controllers"]:
            nodeName = f'node_{i}'
            name = controller["controlled_variable"] + "_control"
            inputSignal = controller["controlled_variable_in_equation"]
            outputSignal = controller["output_variable_in_equation"]

            if outputSignal.startswith("X_sp"):
                number_str = outputSignal.split('[')[1].split(']')[0]
                n = int(number_str)
                outputSignal = f'X[{n}]'
            # elif "_sp" in outputSignal:

            signals = {inputSignal: "to", outputSignal: "from"}
            names = {inputSignal: controller["controlled_variable_in_equation"],
                     outputSignal: controller["output_signal"]}
            for signal, ky in signals.items():
                if signal not in signal_mapping:
                    arrow = {"name": names[signal], ky: nodeName}
                    signal_mapping[signal] = arrow
                else:
                    arrow = signal_mapping[signal]
                    arrow[ky] = nodeName
                    signal_mapping[signal] = arrow

            i += 1

    trimming_params = []
    for edg in signal_mapping.values():
        if "from" not in edg:
            trimming_params.append(edg["name"])

    return get_name_from_state(trimming_params, system_identification)


def get_name_from_state(states, system_identification):
    name_of_states = []
    for param in states:
        for state in system_identification["state_variables"]:
            if state["variable_in_equation"] == param:
                name_of_states.append(state["variable_name"])

    return name_of_states


def get_states_and_inputs(system_identification):
    states_inputs = []
    for state in system_identification["state_variables"]:
        states_inputs.append(state["variable_name"])
    # for state in system_identification["inputs"]:
    #     states_inputs.append(state["variable_name"])

    return states_inputs

