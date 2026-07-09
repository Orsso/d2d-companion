import {getBuiltInRecipe} from '../d2d-companion@orsso.github.io/lib/motion/catalog.js';
import {IconMotionController} from '../d2d-companion@orsso.github.io/lib/runtime/iconMotionController.js';

class FakeIcon {
    constructor() {
        this.nextId = 1;
        this.handlers = new Map();
        this.hover = false;
        this.urgent = false;
        this.pressed = false;
    }

    connect(signal, callback) {
        const id = this.nextId++;
        this.handlers.set(id, {signal, callback});
        return id;
    }

    connect_after(signal, callback) {
        return this.connect(signal, callback);
    }

    disconnect(id) {
        this.handlers.delete(id);
    }

    emit(signal, ...args) {
        for (const handler of [...this.handlers.values()]) {
            if (handler.signal === signal)
                handler.callback(this, ...args);
        }
    }
}

class FakeBin {
    constructor() {
        this.scale_x = 1;
        this.scale_y = 1;
        this.translation_x = 0;
        this.translation_y = 0;
        this.opacity = 255;
        this.offscreen_redirect = 0;
    }

    get_pivot_point() {
        return [0, 0];
    }

    set_pivot_point() {}

    set_scale(x, y) {
        this.scale_x = x;
        this.scale_y = y;
    }

    get_parent() {
        return null;
    }

    remove_transition() {}

    ease() {}
}

function makeController() {
    const hoverEvents = [];
    const icon = new FakeIcon();
    const controller = new IconMotionController({
        icon,
        bin: new FakeBin(),
        position: 'bottom',
        recipe: getBuiltInRecipe('expressive'),
        onHoverChanged: (_controller, hovered) => hoverEvents.push(hovered),
    });
    return {controller, icon, hoverEvents};
}

function hoverIcon(icon, hovered) {
    icon.hover = hovered;
    icon.emit('notify::hover');
}

test('hover changes notify the neighbor group', () => {
    const {icon, hoverEvents} = makeController();
    hoverIcon(icon, true);
    hoverIcon(icon, false);
    assertDeepEqual(hoverEvents, [true, false]);
});

test('beginLaunch leaves the neighbor group hover in place', () => {
    const {controller, icon, hoverEvents} = makeController();
    hoverIcon(icon, true);
    controller.beginLaunch(true);
    assertDeepEqual(hoverEvents, [true]);
});

test('hover changes mid-launch still reach the neighbor group', () => {
    const {controller, icon, hoverEvents} = makeController();
    hoverIcon(icon, true);
    controller.beginLaunch(true);
    hoverIcon(icon, false);
    hoverIcon(icon, true);
    assertDeepEqual(hoverEvents, [true, false, true]);
});

test('endLaunch does not replay the hover notification', () => {
    const {controller, icon, hoverEvents} = makeController();
    hoverIcon(icon, true);
    controller.beginLaunch(true);
    controller.endLaunch();
    assertDeepEqual(hoverEvents, [true]);
});
