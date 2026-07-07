import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    Easing,
    LaunchEffect,
    PressEffect,
    PressMode,
    Profile,
    getBuiltInRecipe,
} from './lib/motion/catalog.js';
import {OVERSHOOT_RESERVE, fitHoverToBudget} from './lib/motion/transforms.js';
import {MotionPreview} from './lib/prefs/motionPreview.js';
import {SettingsEditor} from './lib/prefs/settingsEditor.js';

const PRESET_DETAILS = Object.freeze([
    [Profile.SUBTLE, 'Subtle'],
    [Profile.BALANCED, 'Lively'],
    [Profile.EXPRESSIVE, 'Expressive'],
]);

export default class D2DCompanionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const editor = new SettingsEditor(settings);
        const state = {syncing: false};
        const controls = {};

        window.search_enabled = true;

        const essentials = new Adw.PreferencesPage({
            name: 'essentials',
            title: 'Basics',
            icon_name: 'applications-graphics-symbolic',
        });
        const advanced = new Adw.PreferencesPage({
            name: 'advanced',
            title: 'More',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(essentials);
        window.add(advanced);

        const profileGroup = new Adw.PreferencesGroup({
            title: 'Profiles',
            description: 'Hover to preview. Click to apply.',
        });
        const customBadge = new Gtk.Label({label: 'Custom'});
        customBadge.add_css_class('accent');
        customBadge.add_css_class('caption-heading');
        customBadge.set_visible(false);
        profileGroup.set_header_suffix(customBadge);
        controls.customBadge = customBadge;

        const profileRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            homogeneous: true,
            margin_top: 6,
            margin_bottom: 6,
        });
        profileGroup.add(profileRow);
        essentials.add(profileGroup);

        controls.profiles = new Map();
        for (const [profile, title] of PRESET_DETAILS) {
            const recipe = getBuiltInRecipe(profile);
            const {button, preview} = createProfileCard(title, recipe);
            button.connect('clicked', () => onProfileClicked({
                window,
                editor,
                profile,
                state,
                settings,
                controls,
            }));
            const hover = new Gtk.EventControllerMotion();
            hover.connect('enter', () => preview.playLoop());
            hover.connect('leave', () => preview.stopLoop());
            button.add_controller(hover);
            profileRow.append(button);
            controls.profiles.set(profile, {button, preview});
        }

        const featureGroup = new Adw.PreferencesGroup({title: 'Motion'});
        controls.hoverEnabled = createSwitchRow(
            featureGroup, 'Hover magnification', 'Scale and lift the pointed icon');
        controls.pressEnabled = createSwitchRow(
            featureGroup, 'Press feedback', 'Squash or dim the pressed icon');
        controls.launchEnabled = createSwitchRow(
            featureGroup, 'Launch animation', 'Animate cold starts and new windows');
        controls.hoverBackground = createSwitchRow(
            featureGroup, 'Show hover background',
            'Keep the tile shown under the pointed icon (off hides it)');
        controls.focusedAppBackground = createSwitchRow(
            featureGroup, 'Show focused app background',
            'Keep the tile shown behind the focused app (off hides it)');
        essentials.add(featureGroup);

        connectSwitch(controls.hoverEnabled, enabled =>
            editor.setFeatureEnabled('hover', enabled), state);
        connectSwitch(controls.pressEnabled, enabled =>
            editor.setFeatureEnabled('press', enabled), state);
        connectSwitch(controls.launchEnabled, enabled =>
            editor.setFeatureEnabled('launch', enabled), state);
        connectSwitch(controls.hoverBackground, enabled =>
            editor.setBackgroundVisible('hover', enabled), state);
        connectSwitch(controls.focusedAppBackground, enabled =>
            editor.setBackgroundVisible('focusedApp', enabled), state);

        const navigationGroup = new Adw.PreferencesGroup();
        const advancedRow = new Adw.ActionRow({
            title: 'More Settings',
            subtitle: 'Timing, effects, and repeats',
            activatable: true,
        });
        advancedRow.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
        advancedRow.connect('activated', () => window.set_visible_page_name('advanced'));
        navigationGroup.add(advancedRow);
        essentials.add(navigationGroup);

        buildAdvancedPage(advanced, controls, editor, settings, state);

        // The focused app tile is a Dash to Dock concept.
        if (!dashToDockEnabled()) {
            for (const row of [controls.focusedAppBackground,
                controls.advancedFocusedAppBackground]) {
                row.sensitive = false;
                row.subtitle = 'Requires Dash to Dock';
            }
        }

        const sync = () => syncControls(settings, editor, controls, state);
        const changedId = settings.connect('changed', sync);
        sync();
        window.connect('close-request', () => {
            settings.disconnect(changedId);
            for (const {preview} of controls.profiles.values())
                preview.stop();
            return false;
        });
    }
}

function buildAdvancedPage(page, controls, editor, settings, state) {
    const budgetGroup = new Adw.PreferencesGroup();
    const budgetRow = new Adw.ActionRow({
        title: 'Hover room',
        subtitle: 'Measured from the dock',
    });
    budgetRow.add_suffix(createHelpButton(
        'Dash to Dock clips icons at the dock edge. Magnification and lift share ' +
        'the space that is left; a smaller icon size in Dash to Dock usually ' +
        'leaves more room. The overview dash is not clipped, so the full ' +
        'values apply there.'));
    controls.budgetRow = budgetRow;
    budgetGroup.add(budgetRow);
    page.add(budgetGroup);

    const hoverGroup = new Adw.PreferencesGroup({title: 'Hover'});
    controls.hoverScale = createSpinRow(
        hoverGroup, 'Magnification', 1, 1.30, 0.01, 2,
        value => editor.edit('custom-hover-scale', value), state);
    controls.hoverLift = createSpinRow(
        hoverGroup, 'Outward lift', 0, 12, 1, 0,
        value => editor.edit('custom-hover-lift', Math.round(value)), state, 'px');
    controls.hoverDuration = createSpinRow(
        hoverGroup, 'Duration', 50, 500, 10, 0,
        value => editor.edit('custom-hover-duration', Math.round(value)), state, 'ms');
    controls.hoverEasing = createComboRow(
        hoverGroup, 'Easing',
        [
            ['Linear', Easing.LINEAR],
            ['Ease out (quad)', Easing.EASE_OUT_QUAD],
            ['Ease out (cubic)', Easing.EASE_OUT_CUBIC],
            ['Ease out (back)', Easing.EASE_OUT_BACK],
        ], value => editor.edit('custom-hover-easing', value), state);
    controls.neighborScale = createSpinRow(
        hoverGroup, 'Neighbor scale', 1, 1.15, 0.01, 2,
        value => editor.edit('custom-neighbor-scale', value), state);
    page.add(hoverGroup);

    const pressGroup = new Adw.PreferencesGroup({title: 'Press'});
    controls.pressMode = createComboRow(
        pressGroup, 'Trigger',
        [
            ['Launches only', PressMode.LAUNCHES_ONLY],
            ['All primary clicks', PressMode.ALL_PRIMARY_CLICKS],
        ], value => editor.edit('custom-press-mode', value), state);
    controls.pressEffect = createComboRow(
        pressGroup, 'Effect',
        [
            ['Squash', PressEffect.SQUASH],
            ['Dim', PressEffect.DIM],
        ], value => editor.edit('custom-press-effect', value), state);
    controls.pressIntensity = createSpinRow(
        pressGroup, 'Intensity', 0, 1, 0.05, 2,
        value => editor.edit('custom-press-intensity', value), state);
    controls.pressDuration = createSpinRow(
        pressGroup, 'Duration', 50, 300, 10, 0,
        value => editor.edit('custom-press-duration', Math.round(value)), state, 'ms');
    page.add(pressGroup);

    const launchGroup = new Adw.PreferencesGroup({title: 'Launch'});
    controls.launchEffect = createComboRow(
        launchGroup, 'Effect',
        [
            ['Pulse', LaunchEffect.PULSE],
            ['Bounce', LaunchEffect.BOUNCE],
            ['Stretch', LaunchEffect.STRETCH],
            ['Stock zoom', LaunchEffect.STOCK],
        ], value => editor.edit('custom-launch-effect', value), state);
    controls.launchIntensity = createSpinRow(
        launchGroup, 'Intensity', 0, 1, 0.05, 2,
        value => editor.edit('custom-launch-intensity', value), state);
    controls.launchSpeed = createSpinRow(
        launchGroup, 'Speed', 0.50, 2, 0.05, 2,
        value => editor.edit('custom-launch-speed', value), state);
    controls.launchRepeat = createSwitchRow(
        launchGroup, 'Repeat while starting', 'Stop when the application is running');
    connectSwitch(controls.launchRepeat, enabled =>
        editor.edit('custom-launch-repeat', enabled), state);
    controls.launchRepeatPause = createSpinRow(
        launchGroup, 'Repeat pause', 0, 1000, 50, 0,
        value => editor.edit('custom-launch-repeat-pause', Math.round(value)),
        state, 'ms');
    controls.launchMaxDuration = createSpinRow(
        launchGroup, 'Maximum duration', 500, 15000, 500, 0,
        value => editor.edit('custom-launch-max-duration', Math.round(value)), state, 'ms');
    controls.bounceDecay = createSpinRow(
        launchGroup, 'Bounce decay', 0, 1, 0.05, 2,
        value => editor.edit('custom-bounce-decay', value), state);
    controls.pulseCount = createSpinRow(
        launchGroup, 'Pulse count', 1, 4, 1, 0,
        value => editor.edit('custom-pulse-count', Math.round(value)), state);
    controls.stretchElasticity = createSpinRow(
        launchGroup, 'Stretch elasticity', 0, 1, 0.05, 2,
        value => editor.edit('custom-stretch-elasticity', value), state);
    page.add(launchGroup);

    const appearanceGroup = new Adw.PreferencesGroup({title: 'Appearance'});
    const hoverRow = createSwitchRow(
        appearanceGroup, 'Show hover background',
        'Keep the tile shown under the pointed icon (off hides it)');
    connectSwitch(hoverRow, enabled =>
        editor.setBackgroundVisible('hover', enabled), state);
    controls.advancedHoverBackground = hoverRow;
    const focusRow = createSwitchRow(
        appearanceGroup, 'Show focused app background',
        'Keep the tile shown behind the focused app (off hides it)');
    connectSwitch(focusRow, enabled =>
        editor.setBackgroundVisible('focusedApp', enabled), state);
    controls.advancedFocusedAppBackground = focusRow;
    page.add(appearanceGroup);

    const resetGroup = new Adw.PreferencesGroup();
    const resetRow = new Adw.ActionRow({
        title: 'Reset Custom',
        subtitle: 'Copy the Subtle profile into Custom',
    });
    const resetButton = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
    resetButton.add_css_class('destructive-action');
    resetButton.connect('clicked', () => editor.resetCustom());
    resetRow.add_suffix(resetButton);
    resetGroup.add(resetRow);
    page.add(resetGroup);
}

function syncControls(settings, editor, controls, state) {
    state.syncing = true;
    const profile = editor.profile;
    const recipe = editor.recipe;

    for (const [id, card] of controls.profiles) {
        card.preview.setRecipe(getBuiltInRecipe(id));
        card.preview.setSelected(id === profile);
        card.button.active = id === profile;
    }
    controls.customBadge.set_visible(profile === Profile.CUSTOM);

    controls.hoverEnabled.active = recipe.hover.enabled;
    controls.pressEnabled.active = recipe.press.enabled;
    controls.launchEnabled.active = recipe.launch.enabled;
    controls.hoverBackground.active =
        settings.get_boolean('show-hover-background');
    controls.advancedHoverBackground.active = controls.hoverBackground.active;
    controls.focusedAppBackground.active =
        settings.get_boolean('show-focused-app-background');
    controls.advancedFocusedAppBackground.active =
        controls.focusedAppBackground.active;

    controls.hoverScale.value = recipe.hover.scale;
    controls.hoverLift.value = recipe.hover.lift;
    applyHoverBudget(
        controls, recipe,
        settings.get_double('measured-hover-budget'),
        settings.get_double('measured-icon-size'));
    controls.hoverDuration.value = recipe.hover.duration;
    setComboValue(controls.hoverEasing, recipe.hover.easing);
    controls.neighborScale.value = recipe.hover.neighborScale;
    setComboValue(controls.pressMode, recipe.press.mode);
    setComboValue(controls.pressEffect, recipe.press.effect);
    controls.pressIntensity.value = recipe.press.intensity;
    controls.pressDuration.value = recipe.press.duration;
    setComboValue(controls.launchEffect, recipe.launch.effect);
    controls.launchIntensity.value = recipe.launch.intensity;
    controls.launchSpeed.value = recipe.launch.speed;
    controls.launchRepeat.active = recipe.launch.repeat;
    controls.launchRepeatPause.value = recipe.launch.repeatPause;
    controls.launchMaxDuration.value = recipe.launch.maxDuration;
    controls.bounceDecay.value = recipe.launch.bounceDecay;
    controls.pulseCount.value = recipe.launch.pulseCount;
    controls.stretchElasticity.value = recipe.launch.stretchElasticity;
    const stockLaunch = recipe.launch.effect === LaunchEffect.STOCK;
    controls.launchIntensity.visible = !stockLaunch;
    controls.launchSpeed.visible = !stockLaunch;
    controls.launchRepeat.visible = !stockLaunch;
    controls.launchRepeatPause.visible = recipe.launch.repeat && !stockLaunch;
    controls.launchMaxDuration.visible = !stockLaunch;
    controls.bounceDecay.visible = recipe.launch.effect === LaunchEffect.BOUNCE;
    controls.pulseCount.visible = recipe.launch.effect === LaunchEffect.PULSE;
    controls.stretchElasticity.visible =
        recipe.launch.effect === LaunchEffect.STRETCH;
    state.syncing = false;
}

function createProfileCard(title, recipe) {
    const button = new Gtk.ToggleButton({hexpand: true});
    button.add_css_class('card');
    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 6,
        margin_end: 6,
    });
    const preview = new MotionPreview({recipe});
    const titleLabel = new Gtk.Label({label: title});
    titleLabel.add_css_class('caption-heading');
    content.append(preview);
    content.append(titleLabel);
    button.set_child(content);
    return {button, preview};
}

function onProfileClicked({window, editor, profile, state, settings, controls}) {
    if (state.syncing)
        return;
    if (editor.profile !== Profile.CUSTOM) {
        if (profile === editor.profile) {
            syncControls(settings, editor, controls, state);
            return;
        }
        editor.selectProfile(profile);
        return;
    }
    const title = PRESET_DETAILS.find(([id]) => id === profile)?.[1] ?? profile;
    const dialog = new Adw.MessageDialog({
        transient_for: window,
        modal: true,
        heading: `Switch to ${title}?`,
        body: `Your Custom recipe will be abandoned and replaced by the ${title} preset values.`,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('switch', 'Switch');
    dialog.set_response_appearance('switch', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
        if (response === 'switch')
            editor.switchFromCustomToPreset(profile);
        else
            syncControls(settings, editor, controls, state);
    });
    dialog.present();
}

function dashToDockEnabled() {
    const shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
    return shellSettings.get_strv('enabled-extensions')
        .includes('dash-to-dock@micxgx.gmail.com');
}

function createSwitchRow(group, title, subtitle = null) {
    const row = new Adw.SwitchRow({title, subtitle});
    group.add(row);
    return row;
}

function connectSwitch(row, callback, state) {
    row.connect('notify::active', () => {
        if (!state.syncing)
            callback(row.active);
    });
}

function createSpinRow(
    group,
    title,
    lower,
    upper,
    step,
    digits,
    callback,
    state,
    subtitle = null,
) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 10,
        }),
    });
    row.connect('notify::value', () => {
        if (!state.syncing)
            callback(row.value);
    });
    group.add(row);
    return row;
}

// Keep the budget explanation out of the main row.
function createHelpButton(text) {
    const label = new Gtk.Label({
        label: text,
        wrap: true,
        max_width_chars: 34,
        xalign: 0,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
    });
    const popover = new Gtk.Popover();
    popover.set_child(label);
    const button = new Gtk.MenuButton({
        icon_name: 'help-about-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Why this limit?',
        popover,
    });
    button.add_css_class('flat');
    return button;
}

function createComboRow(group, title, entries, callback, state) {
    const model = new Gtk.StringList();
    for (const [label] of entries)
        model.append(label);
    const values = entries.map(([, value]) => value);
    const row = new Adw.ComboRow({title, model});
    row.connect('notify::selected', () => {
        if (!state.syncing)
            callback(values[row.selected]);
    });
    group.add(row);
    return {row, values};
}

function setComboValue(control, value) {
    const index = control.values.indexOf(value);
    const row = control.row;
    row.selected = Math.max(0, index);
}

// Show how much room the dock leaves for hover motion.
function applyHoverBudget(controls, recipe, budgetPx, iconSize) {
    const budgetRow = controls.budgetRow;
    const scaleRow = controls.hoverScale;
    const liftRow = controls.hoverLift;

    if (!(budgetPx > 0) || !(iconSize > 0)) {
        budgetRow.subtitle = 'No dock measured yet; full motion applies';
        scaleRow.subtitle = 'Outward magnification on hover';
        liftRow.subtitle = 'Outward rise on hover, in pixels';
        return;
    }

    const overshoot =
        recipe.hover.easing === Easing.EASE_OUT_BACK ? OVERSHOOT_RESERVE : 0;
    const fit = fitHoverToBudget(
        recipe.hover.scale, recipe.hover.lift, iconSize, budgetPx, overshoot);
    const room = Math.round(budgetPx);
    const scaleUse = Math.max(0, iconSize * (fit.hoverScale - 1));
    const liftUse = Math.max(0, fit.lift);
    const reach = iconSize * Math.max(0, recipe.hover.scale - 1) +
        Math.max(0, recipe.hover.lift);
    const reduced = reach > budgetPx / (1 + overshoot) + 0.01;

    budgetRow.subtitle = `About ${room} px of room per icon, updates with your dock`;
    scaleRow.subtitle = reduced
        ? `Reduced to fit the dock: ~${scaleUse.toFixed(1)} of ${room} px`
        : `Uses ~${scaleUse.toFixed(1)} of ${room} px`;
    liftRow.subtitle = reduced
        ? `Reduced to fit the dock: ~${liftUse.toFixed(1)} of ${room} px`
        : `Uses ~${liftUse.toFixed(1)} of ${room} px`;
}
