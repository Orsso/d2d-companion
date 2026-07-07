import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DockPosition} from '../motion/catalog.js';
import {MotionSurface} from './motionSurface.js';

const DASH_TO_DOCK_UUID = 'dash-to-dock@micxgx.gmail.com';

export class DockIntegration {
    #controllerFactory;
    #generation = 0;
    #manager = null;
    #managerSignals = [];
    #measureId = 0;
    #publishMeasurement;
    #stateChangedId = 0;
    #surface = null;
    #warnings = new Set();

    constructor({controllerFactory, publishMeasurement = () => {}}) {
        this.#controllerFactory = controllerFactory;
        this.#publishMeasurement = publishMeasurement;
    }

    get controllers() {
        return this.#surface?.controllers ?? [];
    }

    enable(recipe) {
        if (this.#surface)
            return;
        this.#surface = new MotionSurface({
            controllerFactory: this.#controllerFactory,
            recipe,
            onMeasured: measurement => this.#publishBudget(measurement),
        });
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
        this.#surface?.dispose();
        this.#surface = null;
    }

    setRecipe(recipe) {
        this.#surface?.setRecipe(recipe);
    }

    refreshStyles() {
        this.#surface?.refreshStyles();
    }

    getController(appIcon) {
        return this.#surface?.getController(appIcon) ?? null;
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

        if (generation !== this.#generation || !this.#surface)
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
            this.#surface.addBox(box, positionFromSide(dock.position));
        }
        this.#scheduleBudgetMeasure();
        this.refreshStyles();
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
