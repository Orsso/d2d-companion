import {
    CUSTOM_DEFAULTS,
    DEFAULT_PROFILE,
    Easing,
    LaunchEffect,
    PressEffect,
    PressMode,
    Profile,
    getBuiltInRecipe,
    isBuiltInProfile,
} from '../d2d-companion@orsso.github.io/lib/motion/catalog.js';
import {
    customValuesFromRecipe,
    resolveRecipe,
    validateRecipe,
} from '../d2d-companion@orsso.github.io/lib/motion/resolver.js';

test('subtle is the default profile', () => {
    assertEqual(DEFAULT_PROFILE, Profile.SUBTLE);
});

test('built-in recipes match the presets', () => {
    const subtle = getBuiltInRecipe(Profile.SUBTLE);
    const balanced = getBuiltInRecipe(Profile.BALANCED);
    const expressive = getBuiltInRecipe(Profile.EXPRESSIVE);

    assertEqual(subtle.hover.enabled, false);
    assertEqual(subtle.press.mode, PressMode.ALL_PRIMARY_CLICKS);
    assertEqual(subtle.press.effect, PressEffect.DIM);
    assertEqual(subtle.launch.effect, LaunchEffect.BOUNCE);
    assertEqual(subtle.launch.speed, 0.75);
    assertEqual(subtle.launch.repeatPause, 400);
    assertEqual(balanced.hover.enabled, true);
    assertEqual(balanced.hover.scale, 1.10);
    assertEqual(balanced.press.mode, PressMode.LAUNCHES_ONLY);
    assertEqual(balanced.launch.effect, LaunchEffect.PULSE);
    assertEqual(balanced.launch.repeatPause, 0);
    assertEqual(expressive.hover.easing, Easing.EASE_OUT_BACK);
    assertEqual(expressive.launch.effect, LaunchEffect.STRETCH);
    assertEqual(expressive.launch.repeatPause, 0);
});

test('built-in recipes are copied', () => {
    const first = getBuiltInRecipe(Profile.BALANCED);
    first.hover.scale = 9;
    assertEqual(getBuiltInRecipe(Profile.BALANCED).hover.scale, 1.10);
});

test('unknown profiles resolve to the default preset', () => {
    const recipe = resolveRecipe('unknown', CUSTOM_DEFAULTS);
    assertEqual(recipe.id, Profile.SUBTLE);
    assertEqual(recipe.launch.effect, LaunchEffect.BOUNCE);
});

test('custom profile keeps valid values', () => {
    const custom = customValuesFromRecipe(getBuiltInRecipe(Profile.EXPRESSIVE));
    custom.hover.scale = 1.27;
    const recipe = resolveRecipe(Profile.CUSTOM, custom);
    assertEqual(recipe.id, Profile.CUSTOM);
    assertEqual(recipe.hover.scale, 1.27);
});

test('recipe validation clamps values', () => {
    const invalid = customValuesFromRecipe(getBuiltInRecipe(Profile.BALANCED));
    invalid.hover.scale = 5;
    invalid.hover.duration = -5;
    invalid.press.mode = 'invalid';
    invalid.launch.effect = 'invalid';
    invalid.launch.speed = 0;
    invalid.launch.repeatPause = 5000;

    const recipe = validateRecipe(invalid);
    assertEqual(recipe.hover.scale, 1.30);
    assertEqual(recipe.hover.duration, 50);
    assertEqual(recipe.press.mode, PressMode.ALL_PRIMARY_CLICKS);
    assertEqual(recipe.launch.effect, LaunchEffect.BOUNCE);
    assertEqual(recipe.launch.speed, 0.50);
    assertEqual(recipe.launch.repeatPause, 1000);
});

test('presets declare their press effects', () => {
    assertEqual(getBuiltInRecipe(Profile.SUBTLE).press.effect, PressEffect.DIM);
    assertEqual(getBuiltInRecipe(Profile.BALANCED).press.effect, PressEffect.SQUASH);
    assertEqual(getBuiltInRecipe(Profile.EXPRESSIVE).press.effect, PressEffect.SQUASH);
});

test('invalid press effects fall back to the default preset effect', () => {
    const invalid = customValuesFromRecipe(getBuiltInRecipe(Profile.BALANCED));
    invalid.press.effect = 'invalid';
    assertEqual(validateRecipe(invalid).press.effect, PressEffect.DIM);
});

test('stock is a valid launch effect', () => {
    const custom = customValuesFromRecipe(getBuiltInRecipe(Profile.BALANCED));
    custom.launch.effect = LaunchEffect.STOCK;
    assertEqual(resolveRecipe(Profile.CUSTOM, custom).launch.effect,
        LaunchEffect.STOCK);
});

test('profile ids stay stable', () => {
    assertEqual(isBuiltInProfile(Profile.SUBTLE), true);
    assertEqual(isBuiltInProfile(Profile.CUSTOM), false);
    assertEqual(isBuiltInProfile('other'), false);
});
