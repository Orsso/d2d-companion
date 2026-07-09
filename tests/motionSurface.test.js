import {MotionSurface} from '../d2d-companion@orsso.github.io/lib/runtime/motionSurface.js';

class FakeActor {
    constructor() {
        this.nextId = 1;
        this.handlers = new Map();
        this.parent = null;
        this.children = [];
    }

    connect(signal, callback) {
        const id = this.nextId++;
        this.handlers.set(id, {signal, callback});
        return id;
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

    destroy() {
        this.emit('destroy');
        this.handlers.clear();
    }

    get_parent() {
        return this.parent;
    }

    get_children() {
        return this.children;
    }

    add_child(child) {
        child.parent = this;
        this.children.push(child);
        this.emit('child-added', child);
    }
}

class FakeController {
    constructor(options) {
        this.options = options;
        this.recipes = [];
        this.neighbor = null;
        this.refreshCount = 0;
        this.disposeCount = 0;
    }

    setRecipe(recipe) {
        this.recipes.push(recipe);
    }

    setNeighborDistance(distance) {
        this.neighbor = distance;
    }

    refreshStyle() {
        this.refreshCount++;
    }

    dispose() {
        this.disposeCount++;
        this.options.onDestroyed(this);
    }

    onTargetDestroyed() {
        this.options.onDestroyed(this);
    }
}

function makeIcon() {
    const icon = new FakeActor();
    icon.icon = {_iconBin: {}};
    return icon;
}

function makeContainer(icon) {
    const container = new FakeActor();
    container.child = icon;
    return container;
}

function makeBox(iconCount) {
    const box = new FakeActor();
    const icons = [];
    for (let index = 0; index < iconCount; index++) {
        const icon = makeIcon();
        const container = makeContainer(icon);
        container.parent = box;
        box.children.push(container);
        icons.push(icon);
    }
    return {box, icons};
}

function makeSurface({onMeasured} = {}) {
    const controllers = [];
    const surface = new MotionSurface({
        controllerFactory: options => {
            const controller = new FakeController(options);
            controllers.push(controller);
            return controller;
        },
        recipe: 'recipe-1',
        onMeasured,
    });
    return {surface, controllers};
}

test('addBox registers a controller per icon container', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(3);
    assertEqual(surface.addBox(box, 'bottom'), true);
    assertEqual(controllers.length, 3);
    assertEqual(controllers[0].options.position, 'bottom');
    assertEqual(controllers[0].options.recipe, 'recipe-1');
});

test('containers without an icon bin are skipped', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(1);
    const separator = new FakeActor();
    separator.parent = box;
    box.children.push(separator);
    surface.addBox(box, 'bottom');
    assertEqual(controllers.length, 1);
});

test('child-added registers late containers', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(1);
    surface.addBox(box, 'bottom');
    box.add_child(makeContainer(makeIcon()));
    assertEqual(controllers.length, 2);
});

test('addBox refuses the same box twice', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(2);
    assertEqual(surface.addBox(box, 'bottom'), true);
    assertEqual(surface.addBox(box, 'bottom'), false);
    assertEqual(controllers.length, 2);
});

test('getController maps the icon actor to its controller', () => {
    const {surface, controllers} = makeSurface();
    const {box, icons} = makeBox(2);
    surface.addBox(box, 'bottom');
    assertEqual(surface.getController(icons[1]), controllers[1]);
    assertEqual(surface.getController(new FakeActor()), null);
});

test('setRecipe reaches every controller', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(2);
    surface.addBox(box, 'bottom');
    surface.setRecipe('recipe-2');
    assertDeepEqual(controllers.map(c => c.recipes), [['recipe-2'], ['recipe-2']]);
});

test('refreshStyles touches every controller', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(2);
    surface.addBox(box, 'bottom');
    surface.refreshStyles();
    assertDeepEqual(controllers.map(c => c.refreshCount), [1, 1]);
});

test('hovering an icon sends each controller its distance', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(4);
    surface.addBox(box, 'bottom');
    controllers[1].options.onHoverChanged(controllers[1], true);
    assertDeepEqual(controllers.map(c => c.neighbor), [1, 0, 1, 2]);
});

test('unhover pushes every distance to infinity', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(3);
    surface.addBox(box, 'bottom');
    controllers[1].options.onHoverChanged(controllers[1], true);
    controllers[1].options.onHoverChanged(controllers[1], false);
    assertEqual(controllers.every(c => c.neighbor === Infinity), true);
});

test('distances beyond the maximum radius collapse to infinity', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(6);
    surface.addBox(box, 'bottom');
    controllers[0].options.onHoverChanged(controllers[0], true);
    assertEqual(controllers[3].neighbor, 3);
    assertEqual(controllers[4].neighbor, Infinity);
    assertEqual(controllers[5].neighbor, Infinity);
});

test('removing a non-hovered icon resyncs the distances', () => {
    const {surface, controllers} = makeSurface();
    const {box, icons} = makeBox(4);
    surface.addBox(box, 'bottom');
    controllers[2].options.onHoverChanged(controllers[2], true);
    icons[1].destroy();
    assertEqual(controllers[0].neighbor, 1);
});

test('a destroyed icon leaves the neighbor group', () => {
    const {surface, controllers} = makeSurface();
    const {box, icons} = makeBox(3);
    surface.addBox(box, 'bottom');
    icons[1].destroy();
    controllers[0].options.onHoverChanged(controllers[0], true);
    assertEqual(controllers[2].neighbor, 1);
});

test('dispose disposes controllers and stops watching the box', () => {
    const {surface, controllers} = makeSurface();
    const {box} = makeBox(2);
    surface.addBox(box, 'bottom');
    surface.dispose();
    assertDeepEqual(controllers.map(c => c.disposeCount), [1, 1]);
    box.add_child(makeContainer(makeIcon()));
    assertEqual(controllers.length, 2);
    assertEqual(box.handlers.size, 0);
});

test('onMeasured flows through the controller options', () => {
    const measured = [];
    const {surface, controllers} = makeSurface(
        {onMeasured: measurement => measured.push(measurement)});
    const {box} = makeBox(1);
    surface.addBox(box, 'bottom');
    controllers[0].options.onMeasured('measurement');
    assertDeepEqual(measured, ['measurement']);
});
