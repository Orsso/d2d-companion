import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DockPosition} from '../motion/catalog.js';
import {LiveRegistry} from './liveRegistry.js';

const DASH_TO_DOCK_UUID = 'dash-to-dock@micxgx.gmail.com';

export class DockIntegration {
    #controllerFactory;
    #generation = 0;
    #manager = null;
    #managerSignals = [];
    #measureId = 0;
    #publishMeasurement;
    #recipe = null;
    #registry = null;
    #stateChangedId = 0;
    #warnings = new Set();

    constructor({controllerFactory, publishMeasurement = () => {}}) {
        this.#controllerFactory = controllerFactory;
        this.#publishMeasurement = publishMeasurement;
    }

    get controllers() {
        return this.#registry?.icons ?? [];
    }

    enable(recipe) {
        if (this.#registry)
            return;
        this.#recipe = recipe;
        this.#registry = new LiveRegistry();
        this.#generation++;
        this.#stateChangedId = Main.extensionManager.connect(
            'extension-state-changed', (_manager, extension) => {
                if (extension.uuid !== DASH_TO_DOCK_UUID)
                    return;
                this.#detachManager();
                this.#attach(++this.#generation);
            });
        this.#attach(this.#generation);
    }

    disable() {
        this.#generation++;
        if (this.#stateChangedId) {
            Main.extensionManager.disconnect(this.#stateChangedId);
            this.#stateChangedId = 0;
        }
        this.#detachManager();
        this.#cancelBudgetMeasure();
        this.#registry?.disable();
        this.#registry = null;
        this.#recipe = null;
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

    getController(appIcon) {
        return this.#registry?.getIcon(appIcon) ?? null;
    }

    async #attach(generation) {
        const extension = Main.extensionManager.lookup(DASH_TO_DOCK_UUID);
        if (!extension) {
            this.#warnOnce('missing-extension',
                'Dash to Dock is not installed; dock motion is inactive');
            return;
        }

        let module;
        try {
            module = await import(`file://${extension.path}/extension.js`);
        } catch (error) {
            this.#warnOnce('import-failed', `cannot import Dash to Dock: ${error.message}`);
            return;
        }

        if (generation !== this.#generation || !this.#registry)
            return;
        if (!module.dockManager) {
            this.#warnOnce('missing-manager',
                'Dash to Dock does not expose its manager; dock motion is inactive');
            return;
        }

        this.#manager = module.dockManager;
        this.#managerSignals = [
            this.#manager.connect('docks-ready', () => this.#scanDocks()),
            this.#manager.connect('destroy', () => this.#detachManager()),
        ];
        this.#scanDocks();
    }

    #detachManager() {
        if (!this.#manager)
            return;
        for (const id of this.#managerSignals)
            this.#manager.disconnect(id);
        this.#managerSignals = [];
        this.#manager = null;
    }

    #scanDocks() {
        const docks = this.#manager?._allDocks;
        if (!Array.isArray(docks)) {
            this.#warnOnce('missing-docks',
                'Dash to Dock does not expose its dock collection; dock motion is inactive');
            return;
        }

        for (const dock of docks) {
            const box = dock?.dash?._box;
            if (!box) {
                this.#warnOnce('missing-box', 'a Dash to Dock instance has no dash box');
                continue;
            }
            this.#hookBox(box, positionFromSide(dock.position));
        }
        this.#scheduleBudgetMeasure();
        this.refreshStyles();
    }

    #hookBox(box, position) {
        const group = new DockMotionGroup();
        let addedId = 0;
        const added = this.#registry.addBox(box, () => {
            if (addedId)
                box.disconnect(addedId);
            group.dispose();
        }, () => {
            group.onBoxDestroyed();
        });
        if (!added)
            return;
        for (const container of box.get_children())
            this.#registerContainer(container, position, group);
        addedId = box.connect('child-added', (_box, container) => {
            this.#registerContainer(container, position, group);
        });
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
            onMeasured: measurement => this.#publishBudget(measurement),
        });
        group.add(controller, container, boxChildren(container));
        this.#registry.addIcon(icon, controller);
    }

    // Populate the prefs readout before the first hover.
    #scheduleBudgetMeasure() {
        this.#cancelBudgetMeasure();
        this.#measureId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#measureId = 0;
            for (const controller of this.controllers) {
                if (this.#publishBudget(controller.measure()))
                    break;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    #cancelBudgetMeasure() {
        if (this.#measureId) {
            GLib.source_remove(this.#measureId);
            this.#measureId = 0;
        }
    }

    #publishBudget(measurement) {
        if (!measurement)
            return false;
        const {budgetPx, iconNormalSize} = measurement;
        if (!(budgetPx > 0) || !(iconNormalSize > 0))
            return false;
        this.#publishMeasurement(budgetPx, iconNormalSize);
        return true;
    }

    #warnOnce(key, message) {
        if (this.#warnings.has(key))
            return;
        this.#warnings.add(key);
        console.warn(`[d2d-companion] ${message}`);
    }
}

class DockMotionGroup {
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
        if (this.#hovered === controller) {
            this.#hovered = null;
            this.#syncNeighbors();
        }
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
            const neighbor = hoveredIndex !== -1 && Math.abs(index - hoveredIndex) === 1;
            this.#entries[index].controller.setNeighborHover(neighbor);
        }
    }
}

function boxChildren(container) {
    return container.get_parent()?.get_children() ?? [container];
}

function positionFromSide(side) {
    switch (side) {
        case St.Side.TOP:
            return DockPosition.TOP;
        case St.Side.LEFT:
            return DockPosition.LEFT;
        case St.Side.RIGHT:
            return DockPosition.RIGHT;
        case St.Side.BOTTOM:
        default:
            return DockPosition.BOTTOM;
    }
}
