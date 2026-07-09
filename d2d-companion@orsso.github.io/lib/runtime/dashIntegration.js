import {Dash} from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DockPosition} from '../motion/catalog.js';
import {MotionSurface} from './motionSurface.js';

export class DashIntegration {
    #box = null;
    #boxDestroyId = 0;
    #controllerFactory;
    #savedClip = false;
    #surface = null;
    #warnings = new Set();

    constructor({controllerFactory}) {
        this.#controllerFactory = controllerFactory;
    }

    get controllers() {
        return this.#surface?.controllers ?? [];
    }

    enable(recipe) {
        if (this.#surface)
            return;
        // Dock extensions serve their dock as the overview dash; those
        // icons belong to the dock integration, not to a second controller.
        if (Main.overview.dash && !(Main.overview.dash instanceof Dash))
            return;
        const box = Main.overview.dash?._box;
        if (!box) {
            this.#warnOnce('missing-box',
                'the overview dash exposes no icon box; dash motion is inactive');
            return;
        }

        this.#surface = new MotionSurface({
            controllerFactory: this.#controllerFactory,
            recipe,
        });
        this.#box = box;
        this.#boxDestroyId = box.connect('destroy', () => {
            this.#box = null;
            this.#boxDestroyId = 0;
        });
        // The dash clips icons to their row; hover motion needs to overflow it.
        this.#savedClip = box.clip_to_allocation;
        box.clip_to_allocation = false;
        this.#surface.addBox(box, DockPosition.BOTTOM);
        this.#surface.refreshStyles();
    }

    disable() {
        if (!this.#surface)
            return;
        this.#surface.dispose();
        this.#surface = null;
        if (this.#box) {
            this.#box.disconnect(this.#boxDestroyId);
            this.#box.clip_to_allocation = this.#savedClip;
        }
        this.#box = null;
        this.#boxDestroyId = 0;
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

    #warnOnce(key, message) {
        if (this.#warnings.has(key))
            return;
        this.#warnings.add(key);
        console.warn(`[d2d-companion] ${message}`);
    }
}
