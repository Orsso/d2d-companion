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
        this.eases = 0;
        this.parentProbes = 0;
        this.removedTransitions = 0;
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
        this.parentProbes++;
        return null;
    }

    remove_transition() {
        this.removedTransitions++;
    }

    ease() {
        this.eases++;
    }
}

function makeController(profile = 'expressive') {
    const hoverEvents = [];
    const icon = new FakeIcon();
    const bin = new FakeBin();
    const controller = new IconMotionController({
        icon,
        bin,
        position: 'bottom',
        recipe: getBuiltInRecipe(profile),
        onHoverChanged: (_controller, hovered) => hoverEvents.push(hovered),
    });
    return {controller, icon, bin, hoverEvents};
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

test('press dim settles back even with two controllers on the same bin', () => {
    const icon = new FakeIcon();
    const bin = new FakeBin();
    const recipe = getBuiltInRecipe('subtle');
    const controllers = [
        new IconMotionController({icon, bin, position: 'bottom', recipe}),
        new IconMotionController({icon, bin, position: 'bottom', recipe}),
    ];
    for (let click = 0; click < 3; click++) {
        icon.emit('button-press-event', {get_button: () => 1});
        icon.pressed = true;
        icon.emit('notify::pressed');
        icon.pressed = false;
        icon.emit('notify::pressed');
        icon.emit('clicked');
    }
    assertEqual(bin.opacity, 255);
    assertEqual(controllers.length, 2);
});

test('hover with an unchanged transform does not ease', () => {
    const {icon, bin} = makeController('subtle');
    hoverIcon(icon, true);
    hoverIcon(icon, false);
    hoverIcon(icon, true);
    assertEqual(bin.eases, 0);
});

test('press dim lands without easing an unchanged transform', () => {
    const {icon, bin} = makeController('subtle');
    icon.emit('button-press-event', {get_button: () => 1});
    assertEqual(bin.opacity, 228);
    assertEqual(bin.eases, 0);
});

test('setRecipe reapplies even when the transform is unchanged', () => {
    const {controller, bin} = makeController('subtle');
    controller.setRecipe(getBuiltInRecipe('subtle'));
    assertEqual(bin.eases, 1);
});

test('beginLaunch snaps instantly even when the transform is unchanged', () => {
    const {controller, icon, bin} = makeController('subtle');
    hoverIcon(icon, true);
    controller.beginLaunch(true);
    assertEqual(bin.removedTransitions, 4);
});

test('neighbor updates without a neighbor effect skip the transform work', () => {
    const {controller, bin} = makeController('balanced');
    controller.setNeighborDistance(1);
    controller.setNeighborDistance(Infinity);
    assertEqual(bin.parentProbes, 0);
    assertEqual(bin.eases, 0);
});

test('neighbor updates with a neighbor effect still ease', () => {
    const {controller, bin} = makeController('expressive');
    controller.setNeighborDistance(1);
    assertEqual(bin.eases, 1);
});

test('endLaunch does not replay the hover notification', () => {
    const {controller, icon, hoverEvents} = makeController();
    hoverIcon(icon, true);
    controller.beginLaunch(true);
    controller.endLaunch();
    assertDeepEqual(hoverEvents, [true]);
});
