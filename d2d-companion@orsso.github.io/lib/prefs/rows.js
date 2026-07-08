import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export function createSwitchRow(group, title, subtitle = null) {
    const row = new Adw.SwitchRow({title, subtitle});
    group.add(row);
    return row;
}

export function connectSwitch(row, callback, state) {
    row.connect('notify::active', () => {
        if (!state.syncing)
            callback(row.active);
    });
}

export function createSpinRow(
    group,
    title,
    lower,
    upper,
    step,
    callback,
    state,
    subtitle = null,
) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits: 0,
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

// For values picked by feel.
export function createScaleRow(group, title, lower, upper, step, callback, state) {
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 10,
    });
    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment,
        draw_value: false,
        width_request: 190,
        valign: Gtk.Align.CENTER,
    });
    const row = new Adw.ActionRow({title, activatable_widget: scale});
    row.add_suffix(scale);
    adjustment.connect('value-changed', () => {
        if (!state.syncing)
            callback(adjustment.value);
    });
    group.add(row);
    return {row, adjustment, scale};
}

export function createComboRow(group, title, entries, callback, state) {
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

export function setComboValue(control, value) {
    const index = control.values.indexOf(value);
    const row = control.row;
    row.selected = Math.max(0, index);
}

// Keep the budget explanation out of the main row.
export function createHelpButton(text) {
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
