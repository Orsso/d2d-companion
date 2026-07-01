import {PressMode, getBuiltInRecipe, Profile} from '../d2d-companion@orsso.github.io/lib/motion/catalog.js';
import {
    buildDemoSequence,
    DemoPhase,
    hoverIsActive,
} from '../d2d-companion@orsso.github.io/lib/prefs/demoSequence.js';

test('all-primary preset shows a plain click before the launch click', () => {
    const sequence = buildDemoSequence(getBuiltInRecipe(Profile.EXPRESSIVE));
    assertDeepEqual(sequence, [
        DemoPhase.HOVER_IN,
        DemoPhase.HOLD,
        DemoPhase.CLICK,
        DemoPhase.PRE_LAUNCH_PAUSE,
        DemoPhase.CLICK_LAUNCH,
        DemoPhase.SETTLE,
        DemoPhase.RESET,
        DemoPhase.NEUTRAL_HOLD,
    ]);
});

test('launches-only preset skips the plain click but keeps the launch click', () => {
    const sequence = buildDemoSequence(getBuiltInRecipe(Profile.BALANCED));
    assertEqual(getBuiltInRecipe(Profile.BALANCED).press.mode, PressMode.LAUNCHES_ONLY);
    assertDeepEqual(sequence, [
        DemoPhase.HOVER_IN,
        DemoPhase.HOLD,
        DemoPhase.PRE_LAUNCH_PAUSE,
        DemoPhase.CLICK_LAUNCH,
        DemoPhase.SETTLE,
        DemoPhase.RESET,
        DemoPhase.NEUTRAL_HOLD,
    ]);
});

test('inert hover drops the hover phases entirely', () => {
    const sequence = buildDemoSequence(getBuiltInRecipe(Profile.SUBTLE));
    assertDeepEqual(sequence, [
        DemoPhase.CLICK,
        DemoPhase.PRE_LAUNCH_PAUSE,
        DemoPhase.CLICK_LAUNCH,
        DemoPhase.SETTLE,
        DemoPhase.NEUTRAL_HOLD,
    ]);
});

test('disabling launch drops the launch click', () => {
    const recipe = getBuiltInRecipe(Profile.EXPRESSIVE);
    recipe.launch.enabled = false;
    const sequence = buildDemoSequence(recipe);
    assertDeepEqual(sequence, [
        DemoPhase.HOVER_IN,
        DemoPhase.HOLD,
        DemoPhase.CLICK,
        DemoPhase.PRE_LAUNCH_PAUSE,
        DemoPhase.SETTLE,
        DemoPhase.RESET,
        DemoPhase.NEUTRAL_HOLD,
    ]);
});

test('launch-only press feedback keeps the launch click when the effect is disabled', () => {
    const recipe = getBuiltInRecipe(Profile.BALANCED);
    recipe.launch.enabled = false;

    const sequence = buildDemoSequence(recipe);

    assertEqual(sequence.includes(DemoPhase.CLICK), false);
    assertEqual(sequence.includes(DemoPhase.CLICK_LAUNCH), true);
});

test('hover activity requires the toggle and a visible transform', () => {
    const recipe = getBuiltInRecipe(Profile.BALANCED);
    assertEqual(hoverIsActive(recipe), true);
    recipe.hover.scale = 1;
    recipe.hover.lift = 0;
    assertEqual(hoverIsActive(recipe), false);
    recipe.hover.lift = 3;
    assertEqual(hoverIsActive(recipe), true);
    recipe.hover.enabled = false;
    assertEqual(hoverIsActive(recipe), false);
});
