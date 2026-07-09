import {NeighborRadius} from '../motion/catalog.js';
import {LiveRegistry} from './liveRegistry.js';

export class MotionSurface {
    #controllerFactory;
    #onMeasured;
    #recipe;
    #registry = new LiveRegistry();

    constructor({controllerFactory, recipe, onMeasured = () => {}}) {
        this.#controllerFactory = controllerFactory;
        this.#recipe = recipe;
        this.#onMeasured = onMeasured;
    }

    get controllers() {
        return this.#registry.icons;
    }

    getController(appIcon) {
        return this.#registry.getIcon(appIcon);
    }

    setRecipe(recipe) {
        this.#recipe = recipe;
        for (const controller of this.controllers)
            controller.setRecipe(recipe);
    }

    refreshStyles() {
        for (const controller of this.controllers)
            controller.refreshStyle?.();
    }

    addBox(box, position) {
        const group = new NeighborGroup();
        let addedId = 0;
        const added = this.#registry.addBox(box, () => {
            if (addedId)
                box.disconnect(addedId);
            group.dispose();
        }, () => {
            group.onBoxDestroyed();
        });
        if (!added)
            return false;
        for (const container of box.get_children())
            this.#registerContainer(container, position, group);
        addedId = box.connect('child-added', (_box, container) => {
            this.#registerContainer(container, position, group);
        });
        return true;
    }

    dispose() {
        this.#registry.disable();
    }

    #registerContainer(container, position, group) {
        const icon = container?.child ?? container;
        const bin = icon?.icon?._iconBin;
        if (!bin || this.#registry.getIcon(icon))
            return;

        const controller = this.#controllerFactory({
            icon,
            bin,
            position,
            recipe: this.#recipe,
            onHoverChanged: (changed, hovered) => group.setHovered(changed, hovered),
            onDestroyed: destroyed => group.remove(destroyed),
            onMeasured: measurement => this.#onMeasured(measurement),
        });
        group.add(controller, container, boxChildren(container));
        this.#registry.addIcon(icon, controller);
    }
}

class NeighborGroup {
    #entries = [];
    #hovered = null;

    add(controller, container, orderedContainers) {
        this.#entries.push({controller, container});
        this.#entries.sort((first, second) =>
            orderedContainers.indexOf(first.container) -
            orderedContainers.indexOf(second.container));
        this.#syncNeighbors();
    }

    remove(controller) {
        const index = this.#entries.findIndex(entry => entry.controller === controller);
        if (index === -1)
            return;
        this.#entries.splice(index, 1);
        if (this.#hovered === controller)
            this.#hovered = null;
        // Survivors shift by one index, so their distances change too.
        this.#syncNeighbors();
    }

    setHovered(controller, hovered) {
        this.#hovered = hovered ? controller : this.#hovered === controller ? null : this.#hovered;
        this.#syncNeighbors();
    }

    dispose() {
        this.#hovered = null;
        this.#syncNeighbors();
        this.#entries = [];
    }

    onBoxDestroyed() {
        this.#hovered = null;
        this.#entries = [];
    }

    #syncNeighbors() {
        const hoveredIndex = this.#entries.findIndex(
            entry => entry.controller === this.#hovered);
        for (let index = 0; index < this.#entries.length; index++) {
            const distance = hoveredIndex === -1
                ? Infinity
                : Math.abs(index - hoveredIndex);
            // Beyond any possible radius the transform is identity; collapse
            // to Infinity so far icons never see a change to apply.
            this.#entries[index].controller.setNeighborDistance(
                distance > NeighborRadius.MAX ? Infinity : distance);
        }
    }
}

function boxChildren(container) {
    return container.get_parent()?.get_children() ?? [container];
}
