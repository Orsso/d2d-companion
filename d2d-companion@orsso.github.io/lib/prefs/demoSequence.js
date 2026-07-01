import {PressMode} from '../motion/catalog.js';

// Preview pauses.
export const HOVER_HOLD_MS = 650;
export const PRE_LAUNCH_PAUSE_MS = 520;
export const SETTLE_MS = 850;
export const NEUTRAL_HOLD_MS = 520;

// Intro sweep timing.
export const SWEEP_MS = 1500;
export const SWEEP_SETTLE_MS = 480;

// Slow the short preview transitions.
export const DEMO_TEMPO = 1.5;

export const DemoPhase = Object.freeze({
    HOVER_IN: 'hover-in',
    HOLD: 'hold',
    CLICK: 'click',
    PRE_LAUNCH_PAUSE: 'pre-launch-pause',
    CLICK_LAUNCH: 'click-launch',
    SETTLE: 'settle',
    RESET: 'reset',
    NEUTRAL_HOLD: 'neutral-hold',
});

// A hover that moves nothing has no business in the demo.
export function hoverIsActive(recipe) {
    return recipe.hover.enabled &&
        (recipe.hover.scale > 1 || recipe.hover.lift > 0);
}

export function buildDemoSequence(recipe) {
    const hover = hoverIsActive(recipe);
    const phases = hover ? [DemoPhase.HOVER_IN, DemoPhase.HOLD] : [];
    if (recipe.press.enabled && recipe.press.mode === PressMode.ALL_PRIMARY_CLICKS)
        phases.push(DemoPhase.CLICK);
    phases.push(DemoPhase.PRE_LAUNCH_PAUSE);
    const showsLaunchFeedback = recipe.launch.enabled ||
        recipe.press.enabled && recipe.press.mode === PressMode.LAUNCHES_ONLY;
    if (showsLaunchFeedback)
        phases.push(DemoPhase.CLICK_LAUNCH);
    phases.push(DemoPhase.SETTLE);
    if (hover)
        phases.push(DemoPhase.RESET);
    phases.push(DemoPhase.NEUTRAL_HOLD);
    return phases;
}
