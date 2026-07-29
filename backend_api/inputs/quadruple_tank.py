import numpy as np

def dynamics(t, x, u):
    A1, A2, A3, A4 = 0.5, 0.5, 0.5, 0.5
    a1, a2, a3, a4 = 0.05, 0.05, 0.05, 0.05
    g, gamma1, gamma2 = 9.81, 0.4, 0.4
    # Heights are physical levels; clamp so sqrt never sees negatives.
    h1, h2, h3, h4 = np.maximum(x[:4], 0.0)
    xdot = [-a1/A1*np.sqrt(2*g*h1) + a3/A1*np.sqrt(2*g*h3) + gamma1/A1*u,
            -a2/A2*np.sqrt(2*g*h2) + a4/A2*np.sqrt(2*g*h4) + gamma2/A2*u,
            -a3/A3*np.sqrt(2*g*h3) + (1-gamma2)/A3*u,
            -a4/A4*np.sqrt(2*g*h4) + (1-gamma1)/A4*u]
    return np.array(xdot)
